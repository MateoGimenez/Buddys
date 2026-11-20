import {
  BAN_DE_BAJA,
  BUCKET_AVATARES,
  type CambiosPerfil,
  type Perfil,
  type PerfilConHistorial,
  type PerfilRepository,
  ROLES,
  type Rol,
  SinSuperadminError,
  emailDeBaja,
  rutaFoto,
} from '../domain/perfil.js';
import { puedeAsignarRol, puedeGestionarA } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import {
  type CambiosCuenta,
  ContrasenaDebilError,
  DatosRechazadosError,
  EmailEnUsoError,
  EmailInvalidoError,
  type SupabaseAdminClient,
} from '../lib/supabase-admin.js';
import { AuthRateLimitedError, AuthUnavailableError } from '../lib/supabase-auth.js';
import type { SupabaseStorageClient } from '../lib/supabase-storage.js';
import type { UsuarioSesion } from './auth.js';

export interface UsuarioServiceDeps {
  perfiles: PerfilRepository;
  /** Cliente de la API admin de Supabase Auth. undefined = falta SUPABASE_SECRET_KEY (alta, baja, email y contraseña => 503). */
  admin: SupabaseAdminClient | undefined;
  /** Supabase Storage (fotos de perfil). undefined = falta SUPABASE_SECRET_KEY: no hay fotos que borrar. */
  storage?: SupabaseStorageClient | undefined;
  logger: Logger;
  now: () => Date;
}

export interface NuevoUsuario {
  email: string;
  password: string;
  nombre: string | null;
  rol: Rol;
  activo: boolean;
}

export type CambiosUsuario = CambiosPerfil & CambiosCuenta;

/** Resultado de DELETE /api/admin/usuarios/:id: sin historial se borra; con historial se da de baja. */
export type ResultadoEliminar = { resultado: 'eliminado' } | { resultado: 'baja'; usuario: PerfilConHistorial };

const NOT_FOUND_MESSAGE = 'No encontramos ese usuario.';
const SOLO_EMPLEADOS_MESSAGE = 'Con tu rol solo podés gestionar empleados.';
const SOLO_ROL_EMPLEADO_MESSAGE = 'Con tu rol solo podés crear y editar empleados.';
const DADO_DE_BAJA_MESSAGE = 'Ese usuario está dado de baja.';
const CAMBIO_EN_EL_MEDIO_MESSAGE = 'Ese usuario cambió mientras lo editabas. Actualizá la lista y probá de nuevo.';
const BAJA_A_MEDIAS_MESSAGE =
  'No pudimos terminar la baja en el servicio de usuarios. Quedó desactivado; probá eliminarlo de nuevo en unos minutos.';
const SIN_CLAVE_ADMIN_MESSAGE =
  'El servidor no tiene configurada la clave de administración de Supabase (SUPABASE_SECRET_KEY): no se pueden crear ' +
  'ni eliminar usuarios, ni cambiarles el email o la contraseña.';
const AUTH_UNAVAILABLE_MESSAGE = 'No pudimos comunicarnos con el servicio de usuarios. Probá de nuevo en unos minutos.';

/**
 * Gestión de usuarios del panel (superadmin, y admin solo sobre empleados; la ruta exige puedeGestionarUsuarios).
 *  - Alta: crea el usuario en Supabase Auth (email confirmado, contraseña elegida por quien lo da de alta). El trigger
 *    de auth.users crea su perfil (empleado, inactivo) y acá se le pone el rol, el nombre y si está activo.
 *  - Edición: rol, activo y nombre en el perfil; email y contraseña en Supabase Auth (el trigger copia el email).
 *    "Recuperar la contraseña" es esto: se le asigna una nueva.
 *  - Eliminar: sin historial, se borra de Supabase Auth (perfil y sesiones en cascada). Con historial se da de baja:
 *    queda inactivo, con eliminado_at, baneado en Auth y con el email liberado; sus lavados siguen con su nombre.
 * Reglas, en este orden (contrato 2026-11-17_03):
 *  1. sobre uno mismo: no se cambia el propio rol, ni se desactiva ni se elimina (409 CONFLICT);
 *  2. admin sobre un admin o superadmin (editar o eliminar): 403 FORBIDDEN;
 *  3. admin que crea o pasa a alguien a un rol que no es empleado: 403 FORBIDDEN;
 *  4. nunca queda el sistema sin un superadmin activo (lo garantiza un trigger de la base, también ante dos cambios
 *     simultáneos; la baja pone activo = false, así que también la cubre): 409 CONFLICT;
 *  5. un usuario dado de baja no se edita ni se vuelve a dar de baja: 409 CONFLICT.
 * La regla 2 se vuelve a mirar en la escritura (TOCTOU): el UPDATE y la baja solo tocan la fila si su rol sigue siendo
 * uno que quien pide puede gestionar, y antes de borrarlo de Auth se relee. Si en el medio lo ascendieron: 403.
 * Cambiarle la contraseña o el email a OTRA persona le cierra todas las sesiones (buddys_private.cerrar_sesiones); la
 * baja también. Si uno cambia su propia contraseña por acá, su sesión sigue abierta.
 */
/** Los roles que `actor` puede editar o dar de baja: salen de puedeGestionarA (domain/permisos.ts, CAPACIDADES). */
function rolesGestionables(actor: UsuarioSesion): Rol[] {
  return ROLES.filter((rol) => puedeGestionarA(actor.rol, rol));
}

export class UsuarioService {
  constructor(private readonly deps: UsuarioServiceDeps) {}

  /** true si están disponibles el alta, la baja y el cambio de email o contraseña. */
  get gestionCuentas(): boolean {
    return this.deps.admin !== undefined;
  }

  /** Todos, incluidos los dados de baja, con su historial (una sola consulta), los más viejos primero. */
  list(): Promise<PerfilConHistorial[]> {
    return this.deps.perfiles.list();
  }

  async create(actor: UsuarioSesion, nuevo: NuevoUsuario): Promise<PerfilConHistorial> {
    if (!puedeAsignarRol(actor.rol, nuevo.rol)) throw AppError.forbidden(SOLO_ROL_EMPLEADO_MESSAGE); // regla 3
    const admin = this.requireAdmin();
    const id = await this.callAuth(() => admin.createUser(nuevo.email, nuevo.password));

    let perfil: Perfil;
    try {
      perfil = await this.updatePerfil(actor, id, { rol: nuevo.rol, activo: nuevo.activo, nombre: nuevo.nombre });
    } catch (error) {
      // Compensación: sin esto quedaría un usuario a medio configurar y el reintento chocaría con "email en uso".
      // Si el borrado también falla, el usuario queda como lo dejó el trigger: empleado e inactivo (no entra).
      try {
        await admin.deleteUser(id);
        this.deps.logger.warn(`Alta revertida id=${id}: no se pudo configurar el perfil`);
      } catch {
        this.deps.logger.error(`Alta a medias id=${id}: no se pudo configurar el perfil ni revertir (queda inactivo)`);
      }
      throw error;
    }
    this.deps.logger.info(`Usuario creado id=${id} por=${actor.id} rol=${perfil.rol} activo=${String(perfil.activo)}`);
    // Recién creado: todavía no puede tener historial.
    return { ...perfil, tieneHistorial: false };
  }

  async update(actor: UsuarioSesion, id: string, cambios: CambiosUsuario): Promise<PerfilConHistorial> {
    if (id === actor.id) {
      if (cambios.activo === false) {
        throw AppError.conflict('No podés desactivar tu propio usuario.');
      }
      if (cambios.rol !== undefined && cambios.rol !== actor.rol) {
        throw AppError.conflict('No podés cambiar tu propio rol. Pedile a otro superadmin que lo haga.');
      }
    }
    const actual = await this.gestionable(actor, id);
    if (cambios.rol !== undefined && !puedeAsignarRol(actor.rol, cambios.rol)) {
      throw AppError.forbidden(SOLO_ROL_EMPLEADO_MESSAGE); // regla 3
    }
    if (actual.eliminadoAt !== null) throw AppError.conflict(DADO_DE_BAJA_MESSAGE); // regla 5

    const { email, password, ...perfil } = cambios;
    const cambiaCuenta = email !== undefined || password !== undefined;
    const admin = cambiaCuenta ? this.requireAdmin() : undefined;

    // Primero el perfil: es lo que puede chocar con una regla (sin superadmin) y es reversible. Así, si falla, Auth no
    // se tocó. Siempre se actualiza (aunque solo cambien email o contraseña) para dejar constancia en updated_at.
    let updated = await this.updatePerfil(actor, id, perfil);

    if (admin !== undefined) {
      // Defensa: lo que quedó escrito tiene que seguir siendo de alguien que quien pide puede gestionar.
      if (!puedeGestionarA(actor.rol, updated.rol)) throw AppError.forbidden(SOLO_EMPLEADOS_MESSAGE);
      const existe = await this.callAuth(() => admin.updateUser(id, { email, password }));
      if (!existe) throw AppError.notFound(NOT_FOUND_MESSAGE);
      // El trigger de auth.users copió el email nuevo al perfil.
      if (email !== undefined) updated = (await this.deps.perfiles.findById(id)) ?? updated;
      // Con la contraseña o el email nuevos, las sesiones viejas de esa persona no siguen. Las propias, sí.
      if (id !== actor.id) await this.cerrarSesiones(actor, id);
    }

    // Solo ids y nombres de campos: ni emails, ni contraseñas, ni valores de texto.
    const campos = Object.keys(cambios).join(',');
    this.deps.logger.info(`Usuario actualizado id=${id} por=${actor.id} campos=${campos}`);
    return { ...updated, tieneHistorial: await this.deps.perfiles.tieneHistorial(id) };
  }

  /**
   * Sin historial: lo borra de Supabase Auth. Con historial (o si la base frena el borrado porque en el medio alguien
   * le registró algo: FK ON DELETE RESTRICT), lo da de baja.
   */
  async remove(actor: UsuarioSesion, id: string): Promise<ResultadoEliminar> {
    if (id === actor.id) {
      throw AppError.conflict('No podés eliminar tu propio usuario.');
    }
    const perfil = await this.gestionable(actor, id);
    if (perfil.eliminadoAt !== null) throw AppError.conflict(DADO_DE_BAJA_MESSAGE); // regla 5
    const admin = this.requireAdmin();

    if (await this.deps.perfiles.tieneHistorial(id)) return this.darDeBaja(actor, admin, id);

    // Se relee justo antes de borrar en Auth (no se puede bloquear la fila: GoTrue la borra en cascada desde otra
    // conexión y quedaría esperando nuestro lock). Achica la ventana en la que alguien lo asciende en el medio.
    const ahora = await this.gestionable(actor, id);
    if (ahora.eliminadoAt !== null) throw AppError.conflict(DADO_DE_BAJA_MESSAGE);

    let existia: boolean;
    try {
      existia = await this.callAuth(() => admin.deleteUser(id));
    } catch (error) {
      // GoTrue responde 500 sin decir por qué cuando lo frena la base: la FK RESTRICT (le registraron algo entre la
      // consulta y el borrado; SQLSTATE 23001) o el trigger "nunca sin superadmin" (dos superadmins borrándose a la
      // vez). El SQLSTATE no llega hasta acá, así que se vuelve a mirar la base para saber cuál fue.
      if (await this.deps.perfiles.tieneHistorial(id)) return this.darDeBaja(actor, admin, id);
      if (perfil.rol === 'superadmin' && perfil.activo && !(await this.quedaOtroSuperadmin(id))) {
        throw AppError.conflict(new SinSuperadminError().message);
      }
      throw error;
    }
    if (!existia) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Usuario eliminado id=${id} por=${actor.id} resultado=eliminado`);
    if (ahora.fotoVersion !== null) await this.borrarFoto(id, false);
    return { resultado: 'eliminado' };
  }

  /**
   * La baja, en un orden pensado para que un fallo deje las cosas seguras:
   *  1. en la base (una transacción): inactivo, eliminado_at y, si no tenía nombre, la parte de su email antes de la
   *     @ (o "Usuario dado de baja" si queda vacía; nunca el email entero). Desde acá ya no entra
   *     (el middleware revisa `activo` en cada pedido). Lo frena el trigger del superadmin si corresponde (409).
   *  2. en Supabase Auth: email baja+<id>@buddys.invalid (confirmado) y ban por 100 años.
   *  3. si falla el paso 2: se deshacen eliminado_at y el nombre, queda INACTIVO y se responde 503 (se puede reintentar).
   */
  private async darDeBaja(actor: UsuarioSesion, admin: SupabaseAdminClient, id: string): Promise<ResultadoEliminar> {
    const { now, perfiles, logger } = this.deps;
    let paso1: Awaited<ReturnType<PerfilRepository['darDeBaja']>>;
    try {
      paso1 = await perfiles.darDeBaja(id, now(), rolesGestionables(actor));
    } catch (error) {
      if (error instanceof SinSuperadminError) throw AppError.conflict(error.message);
      throw error;
    }
    // Otro pedido lo borró, lo dio de baja o lo ascendió en el medio.
    if (paso1 === undefined) throw await this.noSeEscribio(actor, id);

    let listo: boolean;
    try {
      listo = await admin.banUser(id, emailDeBaja(id), BAN_DE_BAJA);
    } catch {
      listo = false; // el detalle del error de Auth no se loguea
    }
    if (!listo) {
      try {
        await perfiles.revertirBaja(id, paso1.nombreAnterior, now());
        logger.warn(`Baja a medias id=${id} por=${actor.id}: falló Supabase Auth, queda inactivo sin baja`);
      } catch {
        logger.error(`Baja a medias id=${id} por=${actor.id}: falló Supabase Auth y no se pudo revertir la base`);
      }
      throw AppError.serviceUnavailable(BAJA_A_MEDIAS_MESSAGE);
    }

    logger.info(`Usuario eliminado id=${id} por=${actor.id} resultado=baja`);
    if (paso1.perfil.fotoVersion !== null) await this.borrarFoto(id, true);
    // El trigger de auth.users copió el email de baja al perfil.
    const usuario = (await perfiles.findById(id)) ?? paso1.perfil;
    return { resultado: 'baja', usuario: { ...usuario, tieneHistorial: true } };
  }

  /**
   * Borra la foto de alguien eliminado (contrato 2026-11-17_04). Dado de baja, el perfil sigue: PRIMERO se le quita la
   * versión (foto_actualizada_at = null), así la foto deja de servirse aunque Storage esté caído, y después se borra el
   * objeto. Si algo falla, solo queda en el log con el id: no frena la baja (el objeto huérfano no lo ve nadie, el
   * bucket es privado y la API pide el perfil antes de servirla).
   */
  private async borrarFoto(id: string, quedaElPerfil: boolean): Promise<void> {
    const { storage, perfiles, logger } = this.deps;
    if (quedaElPerfil) {
      try {
        await perfiles.setFoto(id, null);
      } catch {
        logger.error(`No se pudo quitar la versión de la foto de perfil id=${id} al eliminar el usuario`);
      }
    }
    try {
      if (storage === undefined) throw new Error('sin Storage');
      await storage.remove(BUCKET_AVATARES, rutaFoto(id));
      logger.info(`Foto de perfil borrada id=${id} (baja del usuario)`);
    } catch {
      logger.warn(
        `No se pudo borrar la foto de perfil id=${id} al eliminar el usuario: el objeto ${BUCKET_AVATARES}/${rutaFoto(id)} queda huérfano`,
      );
    }
  }

  /** El perfil a editar o eliminar, si `actor` lo puede gestionar: 404 si no existe; 403 (regla 2) si no puede. */
  private async gestionable(actor: UsuarioSesion, id: string): Promise<Perfil> {
    const perfil = await this.deps.perfiles.findById(id);
    if (perfil === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    if (!puedeGestionarA(actor.rol, perfil.rol)) throw AppError.forbidden(SOLO_EMPLEADOS_MESSAGE);
    return perfil;
  }

  private async quedaOtroSuperadmin(id: string): Promise<boolean> {
    return (await this.deps.perfiles.list()).some((p) => p.id !== id && p.rol === 'superadmin' && p.activo);
  }

  private requireAdmin(): SupabaseAdminClient {
    if (this.deps.admin === undefined) throw AppError.serviceUnavailable(SIN_CLAVE_ADMIN_MESSAGE);
    return this.deps.admin;
  }

  private async updatePerfil(actor: UsuarioSesion, id: string, cambios: CambiosPerfil): Promise<Perfil> {
    let updated: Perfil | undefined;
    try {
      updated = await this.deps.perfiles.update(id, cambios, this.deps.now(), rolesGestionables(actor));
    } catch (error) {
      if (error instanceof SinSuperadminError) throw AppError.conflict(error.message);
      throw error;
    }
    // No existe, o entre la consulta y el UPDATE lo dieron de baja o le cambiaron el rol a uno que no se gestiona.
    if (updated === undefined) throw await this.noSeEscribio(actor, id);
    return updated;
  }

  /** Por qué el repositorio no escribió (relee el perfil): 404, 409 (dado de baja) o 403 (regla 2). */
  private async noSeEscribio(actor: UsuarioSesion, id: string): Promise<AppError> {
    const actual = await this.deps.perfiles.findById(id);
    if (actual === undefined) return AppError.notFound(NOT_FOUND_MESSAGE);
    if (actual.eliminadoAt !== null) return AppError.conflict(DADO_DE_BAJA_MESSAGE);
    if (!puedeGestionarA(actor.rol, actual.rol)) return AppError.forbidden(SOLO_EMPLEADOS_MESSAGE);
    return AppError.conflict(CAMBIO_EN_EL_MEDIO_MESSAGE);
  }

  /**
   * Corta las sesiones de `id` después de cambiarle la contraseña o el email. El cambio en Auth ya está hecho: si la
   * base falla acá no se responde error (el tope de 12 h de sesión sigue valiendo), pero queda logueado.
   */
  private async cerrarSesiones(actor: UsuarioSesion, id: string): Promise<void> {
    try {
      const cerradas = await this.deps.perfiles.cerrarSesiones(id);
      this.deps.logger.info(`Sesiones cerradas id=${id} por=${actor.id} cantidad=${String(cerradas)}`);
    } catch {
      this.deps.logger.error(`No se pudieron cerrar las sesiones id=${id} por=${actor.id}`);
    }
  }

  /** Traduce los errores de la API admin a respuestas de la API. Nunca loguea emails ni contraseñas. */
  private async callAuth<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof EmailEnUsoError) throw AppError.conflict(error.message, { email: error.message });
      if (error instanceof ContrasenaDebilError) throw AppError.validation({ password: error.message }, error.message);
      if (error instanceof EmailInvalidoError) throw AppError.validation({ email: error.message }, error.message);
      if (error instanceof DatosRechazadosError) throw AppError.validation(undefined, error.message);
      if (error instanceof AuthRateLimitedError) {
        this.deps.logger.warn(error.message);
        throw AppError.rateLimited('Supabase limitó los pedidos. Esperá unos minutos y probá de nuevo.');
      }
      if (error instanceof AuthUnavailableError) {
        this.deps.logger.warn(error.message);
        throw AppError.serviceUnavailable(AUTH_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }
  }
}
