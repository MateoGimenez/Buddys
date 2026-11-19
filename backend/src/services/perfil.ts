import { randomUUID } from 'node:crypto';
import {
  AVATAR_LECTURA_SEGUNDOS,
  AVATAR_TAMANO_MAX,
  type AvatarRepository,
  type ContentTypeAvatar,
  EXTENSION_AVATAR,
  SUBIDA_VALE_MS,
} from '../domain/avatar.js';
import type { Perfil, PerfilRepository, PersonaActiva, Rol } from '../domain/perfil.js';
import { puedeEditarPerfilPropio } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { ContrasenaDebilError, DatosRechazadosError, type SupabaseAdminClient } from '../lib/supabase-admin.js';
import { AuthRateLimitedError, AuthUnavailableError } from '../lib/supabase-auth.js';
import type { SupabaseStorageClient } from '../lib/supabase-storage.js';
import type { AuthService, UsuarioSesion } from './auth.js';
import type { ResultadoConciliacion } from './fotos.js';

export const AVATARES_APAGADOS_MESSAGE = 'Las fotos de perfil no están configuradas en el servidor.';
export const AVATARES_STORAGE_MESSAGE =
  'No pudimos hablar con el almacenamiento de fotos. Probá de nuevo en unos minutos.';
export const SIN_PENDIENTE_MESSAGE = 'No hay ninguna foto pendiente de confirmar: pedí una subida nueva.';
export const AVATAR_SIN_SUBIR_MESSAGE = 'Todavía no subiste la foto: subila y volvé a confirmar.';
export const AVATAR_VENCIDO_MESSAGE = 'La subida venció: pedí otra.';
export const AVATAR_INVALIDO_MESSAGE =
  'La foto subida no es válida (tiene que ser JPG o WebP de hasta 512 KB): pedí otra subida.';
export const CLAVE_ACTUAL_MAL_MESSAGE = 'La contraseña actual no es correcta.';
export const SIN_EMAIL_MESSAGE = 'Tu usuario no tiene email: pedile a un superadmin que te cambie la contraseña.';
const SIN_CLAVE_ADMIN_MESSAGE =
  'El servidor no tiene configurada la clave de administración de Supabase (SUPABASE_SECRET_KEY): no se puede cambiar ' +
  'la contraseña desde el panel.';
const AUTH_UNAVAILABLE_MESSAGE = 'No pudimos comunicarnos con el servicio de usuarios. Probá de nuevo en unos minutos.';
const SIN_PERMISO_MESSAGE = 'Con tu rol no podés editar tu perfil.';
const NOT_FOUND_MESSAGE = 'No encontramos tu perfil.';

/** Cuántos objetos revisa como mucho una pasada de la conciliación (carpetas y objetos por carpeta). */
const CONCILIACION_MAX = 1000;
/** Una URL firmada guardada se reusa mientras le quede al menos esto (el panel la usa un rato largo). */
const CACHE_MARGEN_MS = 10 * 60_000;
/** Tope de URLs guardadas (alcanza de sobra para un equipo chico; si se pasa, se vacía). */
const CACHE_MAX = 500;

/** La foto de perfil tal como sale por la API: URL firmada de lectura y cuándo vence. */
export interface AvatarJson {
  avatarUrl: string | null;
  avatarVenceEl: string | null;
}

const SIN_AVATAR: AvatarJson = { avatarUrl: null, avatarVenceEl: null };

/** El perfil propio tal como sale por la API (GET y PATCH /api/admin/perfil, confirmar la foto). */
export interface PerfilJson extends AvatarJson {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
  creadoEl: string;
}

/** El usuario de la sesión tal como lo ve el panel (login, refresh y /api/auth/me): nunca tokens ni el session_id. */
export interface UsuarioPublico extends AvatarJson {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
}

export interface PerfilServiceDeps {
  perfiles: PerfilRepository;
  avatares: AvatarRepository;
  /** Cliente del bucket perfiles-avatares. undefined = sin SUPABASE_SECRET_KEY: fotos de perfil apagadas. */
  storage: SupabaseStorageClient | undefined;
  /** API admin de Supabase Auth (cambiar la contraseña). undefined = sin SUPABASE_SECRET_KEY. */
  admin: SupabaseAdminClient | undefined;
  auth: AuthService;
  logger: Logger;
  now: () => Date;
}

/**
 * El perfil propio de cada usuario (contrato: reportes/2026-11-16_04_contrato-perfil.md): nombre, foto de perfil y
 * contraseña. Todo es SIEMPRE sobre el usuario de la sesión: no hay ningún id en la URL.
 *
 * Foto de perfil: mismo flujo de 3 pasos que las fotos de los lavados (services/fotos.ts): pedirSubida (queda como
 * pendiente y se devuelve la URL firmada de subida, que Supabase deja usar 2 horas) -> el panel hace el PUT ->
 * confirmar (HEAD en Storage: existe, es JPG/WebP y pesa hasta 512 KB; pasa a vigente). La foto que deja de usarse
 * la anota el trigger de la base en avatares_a_borrar; acá se borra enseguida y `conciliar` (al arrancar y cada
 * hora) la vuelve a borrar, saca las pendientes vencidas y borra los objetos del bucket que la base no conoce.
 *
 * Las URLs de lectura (1 hora) se firman en lote y se guardan en memoria mientras les queden más de 10 minutos: el
 * panel pide /api/auth/me y los listados seguido y no hace falta ir a Storage cada vez. Si Storage falla, la foto sale
 * null (nunca un error). En el log: ids y cantidades; nunca URLs, tokens ni contraseñas.
 */
export class PerfilService {
  private readonly cache = new Map<string, { url: string; venceMs: number }>();

  constructor(private readonly deps: PerfilServiceDeps) {}

  /** true si las fotos de perfil están prendidas (hay SUPABASE_SECRET_KEY). */
  get fotosDisponibles(): boolean {
    return this.deps.storage !== undefined;
  }

  private storage(): SupabaseStorageClient {
    if (this.deps.storage === undefined) throw AppError.serviceUnavailable(AVATARES_APAGADOS_MESSAGE);
    return this.deps.storage;
  }

  private permitido(actor: UsuarioSesion): void {
    if (!puedeEditarPerfilPropio(actor.rol)) throw AppError.forbidden(SIN_PERMISO_MESSAGE);
  }

  // ---------------------------------------------------------------------------------------------------
  // URLs firmadas de lectura
  // ---------------------------------------------------------------------------------------------------

  /** URL firmada de lectura de cada ruta (las que no se pudieron firmar no aparecen). Nunca lanza. */
  async firmar(rutas: readonly (string | null)[]): Promise<Map<string, AvatarJson>> {
    const resultado = new Map<string, AvatarJson>();
    const storage = this.deps.storage;
    if (storage === undefined) return resultado;
    const ahora = this.deps.now().getTime();
    const faltan: string[] = [];
    for (const ruta of new Set(rutas)) {
      if (ruta === null) continue;
      const guardada = this.cache.get(ruta);
      if (guardada !== undefined && guardada.venceMs - ahora > CACHE_MARGEN_MS) {
        resultado.set(ruta, { avatarUrl: guardada.url, avatarVenceEl: new Date(guardada.venceMs).toISOString() });
      } else {
        faltan.push(ruta);
      }
    }
    if (faltan.length === 0) return resultado;
    let urls: Map<string, string>;
    try {
      urls = await storage.urlsDeLectura(faltan, AVATAR_LECTURA_SEGUNDOS);
    } catch {
      this.deps.logger.warn(`Perfil: no se pudieron firmar ${String(faltan.length)} fotos de perfil`);
      return resultado;
    }
    const venceMs = ahora + AVATAR_LECTURA_SEGUNDOS * 1000;
    if (this.cache.size + urls.size > CACHE_MAX) this.cache.clear();
    for (const [ruta, url] of urls) {
      this.cache.set(ruta, { url, venceMs });
      resultado.set(ruta, { avatarUrl: url, avatarVenceEl: new Date(venceMs).toISOString() });
    }
    return resultado;
  }

  /** La foto de una ruta (o null) como sale por la API. */
  async avatar(ruta: string | null): Promise<AvatarJson> {
    if (ruta === null) return SIN_AVATAR;
    return (await this.firmar([ruta])).get(ruta) ?? SIN_AVATAR;
  }

  /** El usuario de la sesión para el panel (login, refresh, /me). */
  async usuarioPublico(usuario: UsuarioSesion): Promise<UsuarioPublico> {
    return { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol, ...(await this.avatar(usuario.avatarPath)) };
  }

  /** Suma `avatarUrl` a cada persona activa (GET /api/admin/trabajadores), firmadas en lote. */
  async trabajadoresConAvatar(personas: readonly PersonaActiva[]): Promise<(PersonaActiva & { avatarUrl: string | null })[]> {
    if (this.deps.storage === undefined) return personas.map((p) => ({ ...p, avatarUrl: null }));
    const rutas = await this.deps.avatares.vigentes(personas.map((p) => p.id));
    const firmadas = await this.firmar([...rutas.values()]);
    return personas.map((p) => {
      const ruta = rutas.get(p.id);
      return { ...p, avatarUrl: ruta === undefined ? null : (firmadas.get(ruta)?.avatarUrl ?? null) };
    });
  }

  /** La URL de la foto de cada perfil (GET /api/admin/usuarios), firmadas en lote. */
  async avataresDe(perfiles: readonly Perfil[]): Promise<Map<string, string | null>> {
    const firmadas = await this.firmar(perfiles.map((p) => p.avatarPath));
    return new Map(
      perfiles.map((p) => [p.id, p.avatarPath === null ? null : (firmadas.get(p.avatarPath)?.avatarUrl ?? null)]),
    );
  }

  // ---------------------------------------------------------------------------------------------------
  // Perfil propio
  // ---------------------------------------------------------------------------------------------------

  private async perfilJson(id: string): Promise<PerfilJson> {
    const perfil = await this.deps.perfiles.findById(id);
    if (perfil === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    return {
      id: perfil.id,
      email: perfil.email,
      nombre: perfil.nombre,
      rol: perfil.rol,
      ...(await this.avatar(perfil.avatarPath)),
      creadoEl: perfil.createdAt,
    };
  }

  async obtener(actor: UsuarioSesion): Promise<{ perfil: PerfilJson }> {
    this.permitido(actor);
    return { perfil: await this.perfilJson(actor.id) };
  }

  async cambiarNombre(actor: UsuarioSesion, nombre: string): Promise<{ perfil: PerfilJson }> {
    this.permitido(actor);
    const actualizado = await this.deps.perfiles.update(actor.id, { nombre }, this.deps.now());
    if (actualizado === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Perfil: nombre cambiado usuario=${actor.id}`);
    return { perfil: await this.perfilJson(actor.id) };
  }

  // ---------------------------------------------------------------------------------------------------
  // Foto de perfil (3 pasos)
  // ---------------------------------------------------------------------------------------------------

  /** Paso 1: anota la subida pendiente y devuelve la URL firmada para el PUT. Si no se puede firmar, no queda nada. */
  async pedirSubida(
    actor: UsuarioSesion,
    datos: { contentType: ContentTypeAvatar; tamano: number },
  ): Promise<{ subida: { url: string; metodo: 'PUT'; headers: { 'Content-Type': ContentTypeAvatar }; venceEl: string } }> {
    this.permitido(actor);
    const storage = this.storage();
    const path = `${actor.id}/${randomUUID()}.${EXTENSION_AVATAR[datos.contentType]}`;
    const vence = new Date(this.deps.now().getTime() + SUBIDA_VALE_MS);
    if (!(await this.deps.avatares.pedirSubida(actor.id, path, vence))) throw AppError.notFound(NOT_FOUND_MESSAGE);
    let url: string;
    try {
      url = await storage.urlDeSubida(path);
    } catch {
      // Queda anotada para borrar (trigger) por si Storage la llegó a firmar.
      await this.deps.avatares.descartarPendiente(actor.id, path).catch(() => undefined);
      this.deps.logger.warn(`Perfil: no se pudo firmar la subida de la foto usuario=${actor.id}`);
      throw AppError.serviceUnavailable(AVATARES_STORAGE_MESSAGE);
    }
    this.deps.logger.info(`Perfil: foto pedida usuario=${actor.id}`);
    return { subida: { url, metodo: 'PUT', headers: { 'Content-Type': datos.contentType }, venceEl: vence.toISOString() } };
  }

  /**
   * Paso 3 (después del PUT): verifica en Storage que el objeto exista, sea JPG o WebP y pese hasta 512 KB, y lo
   * pasa a foto vigente (la anterior se borra). 409 si no hay subida pendiente, si todavía no se subió o si venció;
   * 400 si el archivo no es válido (se borra).
   */
  async confirmar(actor: UsuarioSesion): Promise<{ perfil: PerfilJson }> {
    this.permitido(actor);
    const storage = this.storage();
    const actual = await this.deps.avatares.obtener(actor.id);
    if (actual === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    const path = actual.pendientePath;
    if (path === null) throw AppError.conflict(SIN_PENDIENTE_MESSAGE);
    if (actual.subidaVence === null || this.deps.now().getTime() > Date.parse(actual.subidaVence)) {
      await this.deps.avatares.descartarPendiente(actor.id, path);
      throw AppError.conflict(AVATAR_VENCIDO_MESSAGE);
    }
    let info;
    try {
      info = await storage.info(path);
    } catch {
      throw AppError.serviceUnavailable(AVATARES_STORAGE_MESSAGE);
    }
    if (info === null) throw AppError.conflict(AVATAR_SIN_SUBIR_MESSAGE);
    const tipoEsperado = path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    if (info.tamano < 1 || info.tamano > AVATAR_TAMANO_MAX || info.contentType !== tipoEsperado) {
      await this.deps.avatares.descartarPendiente(actor.id, path);
      this.borrarArchivos([path]);
      this.deps.logger.warn(`Perfil: foto rechazada al confirmar usuario=${actor.id}`);
      throw AppError.validation(undefined, AVATAR_INVALIDO_MESSAGE);
    }
    const confirmado = await this.deps.avatares.confirmar(actor.id, path);
    if (confirmado === undefined) throw AppError.conflict(SIN_PENDIENTE_MESSAGE);
    if (confirmado.anterior !== null) this.borrarArchivos([confirmado.anterior]);
    this.deps.logger.info(`Perfil: foto confirmada usuario=${actor.id}`);
    return { perfil: await this.perfilJson(actor.id) };
  }

  /** Saca la foto (y una subida pendiente, si había). Sin foto no pasa nada. */
  async borrarAvatar(actor: UsuarioSesion): Promise<void> {
    this.permitido(actor);
    this.storage();
    const rutas = await this.deps.avatares.quitar(actor.id);
    this.borrarArchivos(rutas);
    if (rutas.length > 0) this.deps.logger.info(`Perfil: foto borrada usuario=${actor.id}`);
  }

  /** Borra archivos del bucket sin esperar (si falla, la conciliación los vuelve a borrar: quedan anotados). */
  private borrarArchivos(rutas: readonly string[]): void {
    const storage = this.deps.storage;
    if (storage === undefined || rutas.length === 0) return;
    for (const ruta of rutas) this.cache.delete(ruta);
    void storage.borrar(rutas).catch(() => {
      this.deps.logger.warn(`Perfil: no se pudieron borrar ${String(rutas.length)} fotos del bucket (las reintenta la conciliación)`);
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Contraseña
  // ---------------------------------------------------------------------------------------------------

  /**
   * Cambia la contraseña propia: verifica la actual contra Supabase Auth (un login cuya sesión se cierra enseguida) y
   * pone la nueva con la API admin. 400 si la actual no coincide (sin decir nada más). Nunca loguea contraseñas.
   */
  async cambiarClave(actor: UsuarioSesion, actual: string, nueva: string): Promise<void> {
    this.permitido(actor);
    const admin = this.deps.admin;
    if (admin === undefined) throw AppError.serviceUnavailable(SIN_CLAVE_ADMIN_MESSAGE);
    if (actor.email === null) throw AppError.conflict(SIN_EMAIL_MESSAGE);
    if (!(await this.deps.auth.verificarClave(actor.email, actual))) {
      this.deps.logger.warn(`Perfil: contraseña actual incorrecta usuario=${actor.id}`);
      throw AppError.validation({ actual: CLAVE_ACTUAL_MAL_MESSAGE }, CLAVE_ACTUAL_MAL_MESSAGE);
    }
    let existe: boolean;
    try {
      existe = await admin.updateUser(actor.id, { password: nueva });
    } catch (error) {
      if (error instanceof ContrasenaDebilError) throw AppError.validation({ nueva: error.message }, error.message);
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
    if (!existe) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Perfil: contraseña cambiada usuario=${actor.id}`);
  }

  // ---------------------------------------------------------------------------------------------------
  // Conciliación del bucket
  // ---------------------------------------------------------------------------------------------------

  /**
   * Conciliación del bucket perfiles-avatares (al arrancar y cada hora, junto con la de las fotos): 1) saca las
   * subidas pendientes cuyo token venció; 2) borra del bucket los objetos anotados cuyo plazo llegó y los saca de la
   * lista; 3) borra los objetos del bucket que la base no conoce y que tienen más de 2 horas (una subida en curso no
   * se toca). Nunca se rechaza.
   */
  async conciliar(): Promise<ResultadoConciliacion | undefined> {
    const { storage, avatares, logger } = this.deps;
    if (storage === undefined) return undefined;
    const ahora = this.deps.now();
    const resultado: ResultadoConciliacion = { pendientesVencidas: 0, borrados: 0, huerfanos: 0 };
    try {
      resultado.pendientesVencidas = await avatares.descartarPendientesVencidas(ahora);
      const vencidos = await avatares.aBorrarVencidos(ahora, CONCILIACION_MAX);
      if (vencidos.length > 0) {
        await storage.borrar(vencidos);
        await avatares.quitarDeABorrar(vencidos);
        resultado.borrados = vencidos.length;
      }
      const limite = ahora.getTime() - SUBIDA_VALE_MS;
      const carpetas = (await storage.listar('', CONCILIACION_MAX)).filter((e) => e.esCarpeta && /^[0-9a-f-]{36}$/.test(e.nombre));
      for (const carpeta of carpetas) {
        const objetos = (await storage.listar(carpeta.nombre, CONCILIACION_MAX))
          .filter((e) => !e.esCarpeta && (e.creadoEl === null || Date.parse(e.creadoEl) <= limite))
          .map((e) => `${carpeta.nombre}/${e.nombre}`)
          .filter((ruta) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|webp)$/.test(ruta));
        if (objetos.length === 0) continue;
        const conocidas = await avatares.rutasConocidas(objetos);
        const huerfanos = objetos.filter((ruta) => !conocidas.has(ruta));
        if (huerfanos.length > 0) {
          await storage.borrar(huerfanos);
          resultado.huerfanos += huerfanos.length;
        }
      }
      if (resultado.pendientesVencidas + resultado.borrados + resultado.huerfanos > 0) {
        logger.info(
          `Perfil: conciliación de fotos pendientesVencidas=${String(resultado.pendientesVencidas)} borrados=${String(resultado.borrados)} huerfanos=${String(resultado.huerfanos)}`,
        );
      }
    } catch {
      logger.warn('Perfil: la conciliación del bucket de fotos de perfil falló (se reintenta en la próxima pasada)');
    }
    return resultado;
  }
}
