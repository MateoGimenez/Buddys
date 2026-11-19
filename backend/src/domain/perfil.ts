/** Roles del panel (mismos ids que buddys.roles). */
export const ROLES = ['superadmin', 'admin', 'empleado'] as const;
export type Rol = (typeof ROLES)[number];

/** Perfil de un usuario de Supabase Auth (tabla buddys.perfiles), tal como sale por la API. */
export interface Perfil {
  /** UUID de auth.users. */
  id: string;
  /** null si el usuario de Auth no tiene email (no pasa con usuarios creados por email). */
  email: string | null;
  nombre: string | null;
  rol: Rol;
  activo: boolean;
  /** ISO 8601: cuándo se lo dio de baja (inactivo para siempre, baneado en Auth y con el email liberado). null = no. */
  eliminadoAt: string | null;
  /**
   * ISO 8601: cuándo se subió la foto actual (foto_actualizada_at). Es la versión de la foto (ETag y `?v=` en la URL).
   * null = sin foto.
   */
  fotoVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Un perfil con su historial: true si aparece en algún turno o lavado (trabajador o quien lo registró), gasto,
 * movimiento de stock, presupuesto o comprobante. Con historial, "eliminar" lo da de baja en vez de borrarlo.
 */
export interface PerfilConHistorial extends Perfil {
  tieneHistorial: boolean;
}

/**
 * Email con el que queda en Supabase Auth alguien dado de baja: libera su email real (se puede usar en una cuenta
 * nueva) y no es de nadie (.invalid no existe).
 */
/** Dominio reservado de los emails de baja: ninguna cuenta puede tenerlo a mano (schemas/usuarios.ts). */
export const DOMINIO_DE_BAJA = 'buddys.invalid';

export function emailDeBaja(id: string): string {
  return `baja+${id}@${DOMINIO_DE_BAJA}`;
}

/** Duración del ban en Supabase Auth de alguien dado de baja: 100 años, o sea para siempre. */
export const BAN_DE_BAJA = '876000h';

/** Bucket privado de Supabase Storage con las fotos de perfil (migración perfil_foto). */
export const BUCKET_AVATARES = 'avatares';

/** Ruta fija de la foto de un perfil dentro del bucket: no se guarda en la base. */
export function rutaFoto(id: string): string {
  return `${id}.webp`;
}

/** Tope de buddys.perfiles.nombre (mismo que el esquema de la API). */
export const NOMBRE_MAX = 80;

/**
 * Tope ABSOLUTO de una sesión del panel desde el login, aunque se siga refrescando. En el plan Free de Supabase
 * el refresh token no vence: sin este tope, una sesión (o un refresh token robado) se renovaría para siempre.
 * Lo aplica la base (buddys_private.sesion_vigente, contra auth.sessions.created_at). 12 h: una jornada del
 * taller sin volver a ingresar.
 */
export const SESION_MAX_SEGUNDOS = 12 * 60 * 60;

/**
 * Una persona activa del panel, para elegir "quién hizo el trabajo". `nombre` es su nombre o, si no tiene, la parte de
 * su email antes de la @ (nunca el email entero: esta lista la ve también el empleado).
 */
export interface PersonaActiva {
  id: string;
  nombre: string;
  rol: Rol;
}

/** Un rol del panel tal como está en buddys.roles. */
export interface RolInfo {
  id: Rol;
  nombre: string;
  descripcion: string;
}

/** Cambios que un superadmin puede hacer sobre un perfil. Lo que no viene, no cambia. */
export interface CambiosPerfil {
  rol?: Rol;
  activo?: boolean;
  /** null borra el nombre. */
  nombre?: string | null;
}

/** El cambio dejaría el sistema sin ningún superadmin activo (lo detecta un trigger de la base). */
export class SinSuperadminError extends Error {
  constructor() {
    super('No se puede dejar el sistema sin ningún superadmin activo.');
    this.name = 'SinSuperadminError';
  }
}

/**
 * Puerto de persistencia de perfiles. Los perfiles los crea un trigger sobre auth.users y se borran en cascada con el
 * usuario de Auth: acá no hay create ni delete (el alta y el borrado pasan por la API admin de Supabase Auth). Con
 * historial no se borran (las FK son ON DELETE RESTRICT): se dan de baja con darDeBaja.
 */
export interface PerfilRepository {
  /**
   * Perfil del usuario de la sesión y si la sesión de Supabase (session_id del JWT) sigue vigente en auth.sessions.
   * Una sola consulta por request. undefined si el usuario no tiene perfil.
   */
  findForSession(userId: string, sessionId: string): Promise<{ perfil: Perfil; sesionVigente: boolean } | undefined>;
  /** Todos los perfiles (también los dados de baja) con su historial, los más viejos primero. UNA sola consulta. */
  list(): Promise<PerfilConHistorial[]>;
  /** Si aparece en algún turno, lavado, gasto, movimiento de stock, presupuesto o comprobante. */
  tieneHistorial(id: string): Promise<boolean>;
  /** Las personas ACTIVAS de cualquier rol, ordenadas por nombre (sin distinguir mayúsculas). */
  trabajadores(): Promise<PersonaActiva[]>;
  /** Los tres roles con su nombre y descripción, de más a menos permisos. */
  roles(): Promise<RolInfo[]>;
  /** undefined si no existe. */
  findById(id: string): Promise<Perfil | undefined>;
  /**
   * Solo escribe si el rol que tiene AHORA está en `rolesGestionables` (los de quien pide): así, si en el medio alguien
   * lo ascendió, no se pisa (TOCTOU). undefined si no existe, está dado de baja (no se edita) o su rol ya no es
   * gestionable: el servicio vuelve a leer para saber cuál fue. Lanza SinSuperadminError si dejaría el sistema sin
   * superadmin activo.
   */
  update(id: string, cambios: CambiosPerfil, now: Date, rolesGestionables: readonly Rol[]): Promise<Perfil | undefined>;
  /**
   * Paso 1 de la baja, en una transacción: activo = false, eliminado_at = now y, si no tenía nombre, la parte de su
   * email antes de la @ (recortada a NOMBRE_MAX; si queda vacía, "Usuario dado de baja"), así sus lavados viejos siguen
   * mostrando algo reconocible sin exponer el email. También cierra sus sesiones (cerrarSesiones). Devuelve el perfil y
   * el nombre que tenía antes (para revertirBaja). undefined si no existe, ya estaba dado de baja o su rol no está en
   * `rolesGestionables` (lo bloquea con FOR UPDATE). Lanza SinSuperadminError.
   */
  darDeBaja(
    id: string,
    now: Date,
    rolesGestionables: readonly Rol[],
  ): Promise<{ perfil: Perfil; nombreAnterior: string | null } | undefined>;
  /**
   * Borra sus sesiones de Supabase Auth (buddys_private.cerrar_sesiones): cada pedido con una de ellas da 401 en el
   * siguiente request. Devuelve cuántas cerró (0 si no tenía o el id no es un UUID).
   */
  cerrarSesiones(id: string): Promise<number>;
  /**
   * Borra sus sesiones de Supabase Auth MENOS `sesionActual` (buddys_private.cerrar_otras_sesiones): al cambiar la
   * propia contraseña, la sesión desde la que se cambió sigue y las demás dan 401 en el siguiente request. Devuelve
   * cuántas cerró (0 si no tenía otras o algún id no es un UUID).
   */
  cerrarOtrasSesiones(id: string, sesionActual: string): Promise<number>;
  /**
   * Deshace el paso 1 si falló Supabase Auth: vuelve eliminado_at a null y el nombre al anterior, pero lo deja
   * INACTIVO (sin acceso). undefined si no existe.
   */
  revertirBaja(id: string, nombreAnterior: string | null, now: Date): Promise<Perfil | undefined>;
  /**
   * Pone (o con null, borra) la versión de la foto: foto_actualizada_at (el trigger perfiles_set_updated_at también
   * mueve updated_at). También sobre un dado de baja (al darlo de baja se le borra la foto). undefined si no existe.
   */
  setFoto(id: string, version: Date | null): Promise<Perfil | undefined>;
}
