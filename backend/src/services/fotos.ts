import { randomUUID } from 'node:crypto';
import type { BookingRepository } from '../domain/booking.js';
import {
  type ContentTypeFoto,
  EXTENSION_FOTO,
  FOTO_TAMANO_MAX,
  type Foto,
  type FotoRepository,
  LECTURA_SEGUNDOS,
  MAX_FOTOS_POR_TURNO,
  MaximoFotosError,
  SUBIDA_VALE_MS,
  type TipoFoto,
} from '../domain/fotos.js';
import { puedeBorrarFoto, puedeSubirFotos } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { SupabaseStorageClient } from '../lib/supabase-storage.js';
import { NOT_FOUND_MESSAGE } from './agenda.js';
import type { UsuarioSesion } from './auth.js';

export const FOTOS_APAGADAS_MESSAGE = 'Las fotos no están configuradas en el servidor.';
export const FOTOS_STORAGE_MESSAGE = 'No pudimos hablar con el almacenamiento de fotos. Probá de nuevo en unos minutos.';
export const FOTO_NOT_FOUND = 'No encontramos esa foto.';
export const MAXIMO_FOTOS_MESSAGE = `Ya hay ${String(MAX_FOTOS_POR_TURNO)} fotos en este lavado: borrá una para subir otra.`;
export const FOTO_AJENA_MESSAGE = 'Solo podés borrar una foto que subiste vos, hasta 5 minutos después de subirla.';
export const CONFIRMAR_AJENA_MESSAGE = 'Solo puede confirmar la foto quien la subió.';
export const FOTO_SIN_SUBIR_MESSAGE = 'Todavía no subiste la foto: subila y volvé a confirmar.';
export const SUBIDA_VENCIDA_MESSAGE = 'La subida venció: pedí otra.';
export const FOTO_INVALIDA_MESSAGE = 'La foto subida no es válida (tiene que ser JPG o WebP de hasta 1,5 MB): pedí otra subida.';
const SIN_PERMISO_MESSAGE = 'Con tu rol no podés subir fotos.';

/** Cuántos objetos revisa como mucho una pasada de la conciliación (carpetas y objetos por carpeta). */
const CONCILIACION_MAX = 1000;

export interface FotoServiceDeps {
  fotos: FotoRepository;
  bookings: BookingRepository;
  /** undefined = sin SUPABASE_SECRET_KEY: la función queda apagada (sin errores). */
  storage: SupabaseStorageClient | undefined;
  logger: Logger;
  now: () => Date;
}

/** Una foto tal como sale por la API (sin la ruta del bucket). */
export interface FotoJson {
  id: string;
  tipo: TipoFoto;
  contentType: ContentTypeFoto;
  tamano: number;
  estado: Foto['estado'];
  creadaPor: { id: string; nombre: string } | null;
  createdAt: string;
}

export const fotoJson = (foto: Foto): FotoJson => ({
  id: foto.id,
  tipo: foto.tipo,
  contentType: foto.contentType,
  tamano: foto.tamano,
  estado: foto.estado,
  creadaPor: foto.creadaPor,
  createdAt: foto.createdAt,
});

/** Lo que hizo una pasada de la conciliación (solo cantidades). */
export interface ResultadoConciliacion {
  pendientesVencidas: number;
  borrados: number;
  huerfanos: number;
}

/**
 * Fotos antes/después (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 13).
 *
 * Flujo: POST .../fotos (la foto nace 'pendiente' y se devuelve la URL firmada de subida, que Supabase deja usar 2
 * horas) -> el panel sube el archivo con PUT a esa URL -> POST .../fotos/:fotoId/confirmar (el backend mira en Storage
 * que el objeto exista con un tipo y un tamaño válidos y la pasa a 'lista'). Solo se listan las 'lista'; las
 * pendientes cuentan para el tope de 6.
 *
 * Como el token de subida sigue valiendo después de borrar la fila, todo borrado deja el objeto anotado en
 * fotos_a_borrar (trigger de la base) y `conciliar` (al arrancar y cada hora) lo vuelve a borrar cuando el token
 * vence, borra las pendientes vencidas y los objetos del bucket que la base no conoce.
 *
 * Permisos (domain/permisos.ts): subir y ver, todos los roles en cualquier turno; confirmar, quien la subió (o admin);
 * borrar, admin y superadmin siempre, el empleado la suya hasta 5 minutos. En el log: ids, quién y cantidades; nunca
 * URLs ni tokens.
 */
export class FotoService {
  constructor(private readonly deps: FotoServiceDeps) {}

  get disponible(): boolean {
    return this.deps.storage !== undefined;
  }

  private storage(): SupabaseStorageClient {
    if (this.deps.storage === undefined) throw AppError.serviceUnavailable(FOTOS_APAGADAS_MESSAGE);
    return this.deps.storage;
  }

  private async turnoExiste(bookingId: string): Promise<void> {
    if ((await this.deps.bookings.find(bookingId)) === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
  }

  private async fotoDelTurno(bookingId: string, fotoId: string): Promise<Foto> {
    const foto = await this.deps.fotos.obtener(fotoId);
    if (foto?.bookingId !== bookingId) throw AppError.notFound(FOTO_NOT_FOUND);
    return foto;
  }

  /** Registra la foto como pendiente y devuelve la URL firmada para subirla. Si no se puede firmar, no queda nada. */
  async subir(
    actor: UsuarioSesion,
    bookingId: string,
    datos: { tipo: TipoFoto; contentType: ContentTypeFoto; tamano: number },
  ): Promise<{
    foto: FotoJson;
    subida: { url: string; metodo: 'PUT'; headers: { 'Content-Type': ContentTypeFoto }; venceEl: string };
  }> {
    if (!puedeSubirFotos(actor.rol)) throw AppError.forbidden(SIN_PERMISO_MESSAGE);
    const storage = this.storage();
    await this.turnoExiste(bookingId);
    const id = randomUUID();
    const path = `${bookingId}/${id}.${EXTENSION_FOTO[datos.contentType]}`;
    const ahora = this.deps.now();
    const vence = new Date(ahora.getTime() + SUBIDA_VALE_MS);
    let foto: Foto;
    try {
      foto = await this.deps.fotos.crear({ id, bookingId, path, creadaPor: actor.id, createdAt: ahora, subidaVence: vence, ...datos });
    } catch (error) {
      if (error instanceof MaximoFotosError) throw AppError.conflict(MAXIMO_FOTOS_MESSAGE);
      throw error;
    }
    let url: string;
    try {
      url = await storage.urlDeSubida(path);
    } catch {
      // Sin URL no hay nada subido; igual queda anotada (trigger) por si Storage la llegó a firmar.
      await this.deps.fotos.borrar(id).catch(() => undefined);
      this.deps.logger.warn(`Fotos: no se pudo firmar la subida turno=${bookingId}`);
      throw AppError.serviceUnavailable(FOTOS_STORAGE_MESSAGE);
    }
    this.deps.logger.info(`Foto pedida id=${id} turno=${bookingId} por=${actor.id}`);
    return {
      foto: fotoJson(foto),
      subida: { url, metodo: 'PUT', headers: { 'Content-Type': datos.contentType }, venceEl: vence.toISOString() },
    };
  }

  /**
   * Después del PUT: verifica en Storage que el objeto exista, sea del tipo pedido y pese hasta 1,5 MB, y pasa la foto
   * a 'lista'. 409 si todavía no está subida o si la subida venció (la pendiente se borra); 400 si el archivo no es
   * válido (se borran el objeto y la foto). Una que ya está lista se devuelve igual.
   */
  async confirmar(actor: UsuarioSesion, bookingId: string, fotoId: string): Promise<{ foto: FotoJson }> {
    const storage = this.storage();
    const foto = await this.fotoDelTurno(bookingId, fotoId);
    const esSuya = foto.creadaPor?.id === actor.id;
    if (!esSuya && !puedeBorrarFoto(actor.rol, actor.id, { creadaPor: null, createdAt: foto.createdAt }, this.deps.now())) {
      throw AppError.forbidden(CONFIRMAR_AJENA_MESSAGE);
    }
    if (foto.estado === 'lista') return { foto: fotoJson(foto) };
    if (this.deps.now().getTime() > Date.parse(foto.subidaVence)) {
      await this.deps.fotos.borrar(fotoId);
      throw AppError.conflict(SUBIDA_VENCIDA_MESSAGE);
    }
    let info;
    try {
      info = await storage.info(foto.path);
    } catch {
      throw AppError.serviceUnavailable(FOTOS_STORAGE_MESSAGE);
    }
    if (info === null) throw AppError.conflict(FOTO_SIN_SUBIR_MESSAGE);
    if (info.tamano < 1 || info.tamano > FOTO_TAMANO_MAX || info.contentType !== foto.contentType) {
      await this.deps.fotos.borrar(fotoId);
      this.borrarArchivos([foto.path]);
      this.deps.logger.warn(`Fotos: archivo rechazado al confirmar id=${fotoId} turno=${bookingId}`);
      throw AppError.validation(undefined, FOTO_INVALIDA_MESSAGE);
    }
    const lista = await this.deps.fotos.confirmar(fotoId);
    if (lista === undefined) throw AppError.notFound(FOTO_NOT_FOUND);
    this.deps.logger.info(`Foto confirmada id=${fotoId} turno=${bookingId} por=${actor.id}`);
    return { foto: fotoJson(lista) };
  }

  /** Las fotos listas de un turno con su URL de lectura (5 minutos). Apagada: { disponible: false, fotos: [] }. */
  async listar(
    _actor: UsuarioSesion,
    bookingId: string,
  ): Promise<{ disponible: boolean; fotos: (FotoJson & { url: string | null })[] }> {
    const storage = this.deps.storage;
    if (storage === undefined) return { disponible: false, fotos: [] };
    await this.turnoExiste(bookingId);
    const fotos = await this.deps.fotos.listar(bookingId, true);
    const urls = await Promise.all(
      fotos.map((foto) => storage.urlDeLectura(foto.path, LECTURA_SEGUNDOS).catch(() => null)),
    );
    if (urls.some((url) => url === null)) this.deps.logger.warn(`Fotos: no se pudo firmar la lectura turno=${bookingId}`);
    return { disponible: true, fotos: fotos.map((foto, i) => ({ ...fotoJson(foto), url: urls[i] ?? null })) };
  }

  /**
   * Borra la foto (pendiente o lista). El objeto se borra del bucket enseguida (sin esperar) y queda anotado para
   * volver a borrarlo cuando venza su token de subida (lo hace la conciliación).
   */
  async borrar(actor: UsuarioSesion, bookingId: string, fotoId: string): Promise<void> {
    this.storage();
    const foto = await this.fotoDelTurno(bookingId, fotoId);
    if (!puedeBorrarFoto(actor.rol, actor.id, { creadaPor: foto.creadaPor?.id ?? null, createdAt: foto.createdAt }, this.deps.now())) {
      throw AppError.forbidden(FOTO_AJENA_MESSAGE);
    }
    await this.deps.fotos.borrar(fotoId);
    this.borrarArchivos([foto.path]);
    this.deps.logger.info(`Foto borrada id=${fotoId} turno=${bookingId} por=${actor.id}`);
  }

  /** Las rutas de las fotos de un turno, para borrarlas del bucket después de borrar el turno. undefined si está apagada. */
  async rutasDelTurno(bookingId: string): Promise<string[] | undefined> {
    if (this.deps.storage === undefined) return undefined;
    return (await this.deps.fotos.listar(bookingId, false)).map((foto) => foto.path);
  }

  /** Borra archivos del bucket sin esperar (si falla, la conciliación los vuelve a borrar: quedan anotados). */
  borrarArchivos(rutas: readonly string[]): void {
    const storage = this.deps.storage;
    if (storage === undefined || rutas.length === 0) return;
    void storage.borrar(rutas).catch(() => {
      this.deps.logger.warn(`Fotos: no se pudieron borrar ${String(rutas.length)} archivos del bucket (los reintenta la conciliación)`);
    });
  }

  /**
   * Conciliación del bucket (al arrancar y cada hora): 1) borra las pendientes cuyo token de subida venció; 2) borra
   * del bucket los objetos anotados cuyo plazo llegó y los saca de la lista; 3) borra los objetos del bucket que la
   * base no conoce y que tienen más de 2 horas (una subida en curso no se toca). Nunca se rechaza.
   */
  async conciliar(): Promise<ResultadoConciliacion | undefined> {
    const { storage, fotos, logger } = this.deps;
    if (storage === undefined) return undefined;
    const ahora = this.deps.now();
    const resultado: ResultadoConciliacion = { pendientesVencidas: 0, borrados: 0, huerfanos: 0 };
    try {
      resultado.pendientesVencidas = await fotos.borrarPendientesVencidas(ahora);
      const vencidos = await fotos.aBorrarVencidos(ahora, CONCILIACION_MAX);
      if (vencidos.length > 0) {
        await storage.borrar(vencidos);
        await fotos.quitarDeABorrar(vencidos);
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
        const conocidas = await fotos.rutasConocidas(objetos);
        const huerfanos = objetos.filter((ruta) => !conocidas.has(ruta));
        if (huerfanos.length > 0) {
          await storage.borrar(huerfanos);
          resultado.huerfanos += huerfanos.length;
        }
      }
      if (resultado.pendientesVencidas + resultado.borrados + resultado.huerfanos > 0) {
        logger.info(
          `Fotos: conciliación pendientesVencidas=${String(resultado.pendientesVencidas)} borrados=${String(resultado.borrados)} huerfanos=${String(resultado.huerfanos)}`,
        );
      }
    } catch {
      logger.warn('Fotos: la conciliación del bucket falló (se reintenta en la próxima pasada)');
    }
    return resultado;
  }
}
