import sharp from 'sharp';
import { BUCKET_AVATARES, type Perfil, type PerfilRepository, ROLES, rutaFoto } from '../domain/perfil.js';
import { puedeGestionarUsuarios } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { Semaforo } from '../lib/semaforo.js';
import { ContrasenaDebilError, DatosRechazadosError, type SupabaseAdminClient } from '../lib/supabase-admin.js';
import { AuthRateLimitedError, AuthUnavailableError, type SupabaseAuthClient } from '../lib/supabase-auth.js';
import { StorageUnavailableError, type SupabaseStorageClient } from '../lib/supabase-storage.js';
import type { TipoFoto } from '../schemas/perfil.js';
import type { UsuarioSesion } from './auth.js';

// Sin caché de libvips: cada foto se procesa una vez y no tiene sentido guardar nada en memoria.
sharp.cache(false);

export interface PerfilServiceDeps {
  perfiles: PerfilRepository;
  /** Login de Supabase Auth: para verificar la contraseña actual (y cerrar enseguida esa sesión). */
  auth: SupabaseAuthClient;
  /** API admin de Supabase Auth. undefined = falta SUPABASE_SECRET_KEY (cambiar la contraseña => 503). */
  admin: SupabaseAdminClient | undefined;
  /** Supabase Storage con la secret key. undefined = falta SUPABASE_SECRET_KEY (sin fotos: 503). */
  storage: SupabaseStorageClient | undefined;
  logger: Logger;
  now: () => Date;
}

export interface CambiosMiPerfil {
  /** null borra el nombre. */
  nombre?: string | null;
  passwordActual?: string;
  passwordNueva?: string;
}

/** Tope de píxeles de la imagen de entrada (40 MP): una "bomba" de píxeles se rechaza antes de decodificarla entera. */
export const FOTO_MAX_PIXELES = 40_000_000;
/** Lado de la foto guardada (cuadrada). */
export const FOTO_LADO = 256;
const FOTO_CALIDAD = 80;
/** Fotos que se re-codifican a la vez como máximo (sharp usa CPU y memoria); las demás esperan, no se rechazan. */
export const FOTO_PROCESOS_MAX = 2;
/** El semáforo de procesarFoto, compartido por todo el proceso. Exportado para los tests. */
export const semaforoFotos = new Semaforo(FOTO_PROCESOS_MAX);

const FOTO_INVALIDA_MESSAGE = 'Subí una foto JPG, PNG o WebP.';
const PASSWORD_ACTUAL_MAL_MESSAGE = 'La contraseña actual no es correcta.';
const SIN_CLAVE_PASSWORD_MESSAGE =
  'El servidor no tiene configurada la clave de administración de Supabase (SUPABASE_SECRET_KEY): no se puede cambiar ' +
  'la contraseña.';
const SIN_CLAVE_FOTO_MESSAGE =
  'El servidor no tiene configurada la clave de Supabase (SUPABASE_SECRET_KEY): no se pueden guardar fotos de perfil.';
const AUTH_UNAVAILABLE_MESSAGE = 'No pudimos comunicarnos con el servicio de usuarios. Probá de nuevo en unos minutos.';
const STORAGE_UNAVAILABLE_MESSAGE = 'No pudimos guardar la foto. Probá de nuevo en unos minutos.';
const NOT_FOUND_MESSAGE = 'No encontramos ese usuario.';
const SIN_FOTO_MESSAGE = 'Ese usuario no tiene foto.';
const FOTO_AJENA_MESSAGE = 'Con tu rol solo podés ver tu propia foto.';

/** Los primeros bytes de cada formato aceptado. WebP: "RIFF", 4 bytes de largo y "WEBP". */
function coincideFirma(bytes: Uint8Array, tipo: TipoFoto): boolean {
  const empieza = (firma: readonly number[], desde = 0) =>
    bytes.length >= desde + firma.length && firma.every((byte, i) => bytes[desde + i] === byte);
  switch (tipo) {
    case 'image/jpeg':
      return empieza([0xff, 0xd8, 0xff]);
    case 'image/png':
      return empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8);
  }
}

/** El formato que tiene que reportar sharp para cada Content-Type. */
const FORMATO_SHARP: Record<TipoFoto, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

const fotoInvalida = () => AppError.validation({ foto: FOTO_INVALIDA_MESSAGE }, FOTO_INVALIDA_MESSAGE);

/**
 * Valida y re-codifica una foto: los primeros bytes tienen que ser los del Content-Type declarado; sharp la tiene que
 * poder decodificar (failOn 'error', tope de 40 MP) y no puede ser animada. Sale 256×256 (recortada al centro), con la
 * orientación del EXIF aplicada, en WebP calidad 80 y SIN metadatos (sharp no copia EXIF, GPS ni ICC si no se pide
 * withMetadata). Cualquier falla => 400 en fields.foto. Como mucho FOTO_PROCESOS_MAX a la vez (semaforoFotos): la
 * firma se mira antes de esperar turno.
 */
export async function procesarFoto(bytes: Uint8Array, tipo: TipoFoto): Promise<Buffer> {
  if (!coincideFirma(bytes, tipo)) throw fotoInvalida();
  return semaforoFotos.usar(() => recodificar(bytes, tipo));
}

/** La parte pesada de procesarFoto (sharp): corre dentro del semáforo. */
async function recodificar(bytes: Uint8Array, tipo: TipoFoto): Promise<Buffer> {
  const opciones = { limitInputPixels: FOTO_MAX_PIXELES, failOn: 'error', animated: true } as const;
  try {
    const metadata = await sharp(bytes, opciones).metadata();
    if (metadata.format !== FORMATO_SHARP[tipo]) throw fotoInvalida();
    // animated: true hace que sharp lea todos los cuadros: más de una página = animada.
    if ((metadata.pages ?? 1) > 1) throw fotoInvalida();
    const alto = metadata.pageHeight ?? metadata.height;
    if (metadata.width * alto > FOTO_MAX_PIXELES) throw fotoInvalida();
    return await sharp(bytes, { limitInputPixels: FOTO_MAX_PIXELES, failOn: 'error' })
      .rotate()
      .resize(FOTO_LADO, FOTO_LADO, { fit: 'cover' })
      .webp({ quality: FOTO_CALIDAD })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    // El detalle de libvips no sale: puede describir el archivo del usuario.
    throw fotoInvalida();
  }
}

/**
 * Mi perfil (contrato 2026-11-17_04): nombre, contraseña y foto propios, para todos los roles; y la foto de cualquiera,
 * para uno mismo o para quien gestiona usuarios.
 *  - Contraseña: se verifica la actual con un login (grant_type=password) con el email de la sesión; si sale bien, esa
 *    sesión de verificación se cierra enseguida (logout scope=local con su token) y después se cambia por la API admin.
 *    La sesión actual sigue abierta y las OTRAS de esa persona se cierran. El tope de intentos lo pone la ruta.
 *  - Foto: se valida y re-codifica (procesarFoto), se sube a Storage (avatares/<id>.webp, upsert) y recién después se
 *    marca foto_actualizada_at: si Storage falla, el perfil no cambia.
 * En los logs: ids y nombres de campos, nunca emails, contraseñas ni tokens.
 */
export class PerfilService {
  constructor(private readonly deps: PerfilServiceDeps) {}

  /** false = falta SUPABASE_SECRET_KEY: el panel esconde subir y quitar la foto. */
  get fotosDisponibles(): boolean {
    return this.deps.storage !== undefined;
  }

  async get(actor: UsuarioSesion): Promise<Perfil> {
    const perfil = await this.deps.perfiles.findById(actor.id);
    if (perfil === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    return perfil;
  }

  async actualizar(actor: UsuarioSesion, cambios: CambiosMiPerfil): Promise<Perfil> {
    const { passwordActual, passwordNueva } = cambios;
    if (passwordActual !== undefined && passwordNueva !== undefined) {
      await this.cambiarPassword(actor, passwordActual, passwordNueva);
    }
    let perfil: Perfil | undefined;
    if (cambios.nombre !== undefined) {
      // Uno mismo, cualquiera sea su rol: todos los roles son "gestionables" para su propio nombre.
      perfil = await this.deps.perfiles.update(actor.id, { nombre: cambios.nombre }, this.deps.now(), ROLES);
      if (perfil === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    }
    const campos = Object.keys(cambios)
      .filter((campo) => campo !== 'passwordNueva')
      .map((campo) => (campo === 'passwordActual' ? 'password' : campo))
      .join(',');
    this.deps.logger.info(`Perfil actualizado id=${actor.id} campos=${campos}`);
    return perfil ?? this.get(actor);
  }

  async subirFoto(actor: UsuarioSesion, bytes: Uint8Array, tipo: TipoFoto): Promise<Perfil> {
    const storage = this.requireStorage();
    const webp = await procesarFoto(bytes, tipo);
    await this.callStorage(() => storage.upload(BUCKET_AVATARES, rutaFoto(actor.id), webp, 'image/webp'));
    const perfil = await this.deps.perfiles.setFoto(actor.id, this.deps.now());
    if (perfil === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Foto de perfil subida id=${actor.id} bytes=${String(webp.length)}`);
    return perfil;
  }

  /** Borra la foto. Si no tenía, responde igual (idempotente). */
  async quitarFoto(actor: UsuarioSesion): Promise<Perfil> {
    const storage = this.requireStorage();
    await this.callStorage(() => storage.remove(BUCKET_AVATARES, rutaFoto(actor.id)));
    const perfil = await this.deps.perfiles.setFoto(actor.id, null);
    if (perfil === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Foto de perfil quitada id=${actor.id}`);
    return perfil;
  }

  /**
   * La foto de `id` y su versión. Uno mismo, siempre; los demás, solo quien gestiona usuarios (403 antes de mirar si
   * existe: el empleado no puede averiguar quién tiene foto). 404 si no existe o no tiene foto.
   */
  async leerFoto(actor: UsuarioSesion, id: string): Promise<{ bytes: Uint8Array; version: string }> {
    if (id !== actor.id && !puedeGestionarUsuarios(actor.rol)) throw AppError.forbidden(FOTO_AJENA_MESSAGE);
    const perfil = await this.deps.perfiles.findById(id);
    if (perfil?.fotoVersion == null) throw AppError.notFound(SIN_FOTO_MESSAGE);
    const { storage } = this.deps;
    if (storage === undefined) throw AppError.notFound(SIN_FOTO_MESSAGE);
    const bytes = await this.callStorage(() => storage.download(BUCKET_AVATARES, rutaFoto(id)));
    if (bytes === null) {
      // La base dice que tiene foto pero en Storage no está (la borraron a mano): se responde como "sin foto".
      this.deps.logger.warn(`Foto de perfil que falta en Storage id=${id}`);
      throw AppError.notFound(SIN_FOTO_MESSAGE);
    }
    return { bytes, version: perfil.fotoVersion };
  }

  private async cambiarPassword(actor: UsuarioSesion, actual: string, nueva: string): Promise<void> {
    const { admin, auth, logger } = this.deps;
    if (admin === undefined) throw AppError.serviceUnavailable(SIN_CLAVE_PASSWORD_MESSAGE);
    const perfil = await this.get(actor);
    if (perfil.email === null) {
      throw AppError.validation({ passwordActual: PASSWORD_ACTUAL_MAL_MESSAGE }, PASSWORD_ACTUAL_MAL_MESSAGE);
    }
    const email = perfil.email;

    const verificacion = await this.callAuth(() => auth.signInWithPassword(email, actual));
    if (verificacion === null) {
      logger.warn(`Cambio de contraseña rechazado id=${actor.id}: la actual no es correcta`);
      throw AppError.validation({ passwordActual: PASSWORD_ACTUAL_MAL_MESSAGE }, PASSWORD_ACTUAL_MAL_MESSAGE);
    }
    // La sesión que abrió la verificación no se usa para nada: se cierra al toque. Si falla, no frena el cambio.
    try {
      await auth.logout(verificacion.accessToken);
    } catch {
      logger.warn(`No se pudo cerrar la sesión de verificación de la contraseña id=${actor.id}`);
    }

    const existe = await this.callAuth(() => admin.updateUser(actor.id, { password: nueva }));
    if (!existe) throw AppError.notFound(NOT_FOUND_MESSAGE);
    logger.info(`Contraseña cambiada id=${actor.id} por=${actor.id}`);
    await this.cerrarOtrasSesiones(actor);
  }

  /**
   * Después de cambiar la propia contraseña, corta las demás sesiones de esa persona (auditoría del objetivo B, M1):
   * la de este pedido sigue. La contraseña ya cambió: si la base falla acá no se responde error (el tope de 12 h de
   * sesión sigue valiendo), pero queda en el log, solo con ids.
   */
  private async cerrarOtrasSesiones(actor: UsuarioSesion): Promise<void> {
    const { logger, perfiles } = this.deps;
    try {
      const cerradas = await perfiles.cerrarOtrasSesiones(actor.id, actor.sessionId);
      logger.info(`Otras sesiones cerradas id=${actor.id} cantidad=${String(cerradas)}`);
    } catch {
      logger.error(`No se pudieron cerrar las otras sesiones id=${actor.id} sesion=${actor.sessionId}`);
    }
  }

  private requireStorage(): SupabaseStorageClient {
    if (this.deps.storage === undefined) throw AppError.serviceUnavailable(SIN_CLAVE_FOTO_MESSAGE);
    return this.deps.storage;
  }

  private async callStorage<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        this.deps.logger.warn(error.message);
        throw AppError.serviceUnavailable(STORAGE_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }
  }

  /** Traduce los errores de Supabase Auth. Nunca loguea emails ni contraseñas. */
  private async callAuth<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ContrasenaDebilError) {
        throw AppError.validation({ passwordNueva: error.message }, error.message);
      }
      if (error instanceof DatosRechazadosError) {
        throw AppError.validation({ passwordNueva: error.message }, error.message);
      }
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
