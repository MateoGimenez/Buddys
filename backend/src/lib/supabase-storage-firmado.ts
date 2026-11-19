import { z } from 'zod';
import type { FetchFn } from './supabase-auth.js';

/** Tope de cada llamada a Supabase Storage: el panel no puede quedar colgado. */
export const STORAGE_FIRMADO_TIMEOUT_MS = 5_000;

/** Storage no respondió, respondió un error o algo inesperado. Nunca incluye la URL, la clave ni el cuerpo. */
export class StorageFirmadoNoDisponibleError extends Error {
  constructor(readonly status: number | undefined) {
    super(`Supabase Storage no respondió como se esperaba${status === undefined ? '' : ` (${String(status)})`}`);
    this.name = 'StorageFirmadoNoDisponibleError';
  }
}

const subidaSchema = z.object({ url: z.string().startsWith('/object/upload/sign/').max(4096) });
const lecturaSchema = z.object({ signedURL: z.string().startsWith('/object/sign/').max(4096) });
const lecturaLoteSchema = z
  .array(
    z.object({
      path: z.string().max(200).nullable().optional(),
      signedURL: z.string().max(4096).nullable(),
      error: z.string().max(500).nullable().optional(),
    }),
  )
  .max(1000);
const listadoSchema = z.array(
  z.object({
    name: z.string().max(200),
    id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  }),
);

/** Lo que Storage dice de un objeto subido. */
export interface InfoObjeto {
  tamano: number;
  contentType: string;
}

/** Una entrada del listado de una carpeta: un objeto (con fecha) o una subcarpeta (id null). */
export interface EntradaListado {
  nombre: string;
  esCarpeta: boolean;
  /** ISO 8601; null en las carpetas. */
  creadoEl: string | null;
}

/** Una ruta de objeto: <uuid>/<uuid>.<jpg|webp>. Se valida antes de armar cualquier URL (nada de "../"). */
const RUTA = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|webp)$/;

/**
 * Cliente mínimo de Supabase Storage para UN bucket PRIVADO (una instancia por bucket: `lavados-fotos`, función 13 del
 * contrato 2026-11-15, y `perfiles-avatares`, contrato 2026-11-16_04), del lado del servidor. Como SupabaseAdminClient: la secret key va SOLO en la cabecera `apikey` (no es un JWT: el gateway
 * de Supabase arma el Authorization), nunca se loguea ni llega al navegador. Solo devuelve URLs FIRMADAS y cortas:
 *  - subida: /storage/v1/object/upload/sign/<bucket>/<ruta>?token=... (la vigencia la fija Supabase: 2 horas, de un
 *    solo uso; el bucket limita tipo y tamaño);
 *  - lectura: /storage/v1/object/sign/<bucket>/<ruta>?token=... (vence en los segundos pedidos).
 * Nunca hay URLs públicas permanentes: el bucket es privado.
 */
export class StorageFirmadoClient {
  constructor(
    private readonly config: { url: string; secretKey: string; bucket: string },
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private get base(): string {
    return `${this.config.url}/storage/v1`;
  }

  /** URL firmada para que el panel suba UN archivo nuevo (sin pisar uno existente) en esa ruta. */
  async urlDeSubida(ruta: string): Promise<string> {
    const response = await this.request('POST', `/object/upload/sign/${this.config.bucket}/${this.verificarRuta(ruta)}`, {});
    const { url } = await this.leer(response, subidaSchema);
    return `${this.base}${url}`;
  }

  /** URL firmada de lectura que vence en `segundos`. */
  async urlDeLectura(ruta: string, segundos: number): Promise<string> {
    const response = await this.request('POST', `/object/sign/${this.config.bucket}/${this.verificarRuta(ruta)}`, {
      expiresIn: segundos,
    });
    const { signedURL } = await this.leer(response, lecturaSchema);
    return `${this.base}${signedURL}`;
  }

  /**
   * URLs firmadas de lectura de varios objetos en UN pedido (POST /object/sign/<bucket> { expiresIn, paths }). Devuelve
   * ruta -> URL; las que Storage no pudo firmar (ej.: el objeto no existe) no aparecen.
   */
  async urlsDeLectura(rutas: readonly string[], segundos: number): Promise<Map<string, string>> {
    if (rutas.length === 0) return new Map();
    const response = await this.request('POST', `/object/sign/${this.config.bucket}`, {
      expiresIn: segundos,
      paths: rutas.map((ruta) => this.verificarRuta(ruta)),
    });
    const firmadas = await this.leer(response, lecturaLoteSchema);
    const urls = new Map<string, string>();
    for (const firmada of firmadas) {
      if (firmada.path === null || firmada.path === undefined || firmada.signedURL === null) continue;
      if (!rutas.includes(firmada.path) || !firmada.signedURL.startsWith('/object/sign/')) continue;
      urls.set(firmada.path, `${this.base}${firmada.signedURL}`);
    }
    return urls;
  }

  /**
   * Tamaño y tipo de un objeto ya subido (HEAD, sin bajar el archivo). null si no existe (el panel todavía no lo
   * subió). Lanza StorageFirmadoNoDisponibleError si Storage no responde.
   */
  async info(ruta: string): Promise<InfoObjeto | null> {
    const response = await this.request('HEAD', `/object/authenticated/${this.config.bucket}/${this.verificarRuta(ruta)}`, undefined);
    await response.body?.cancel();
    if (response.status === 404 || response.status === 400) return null;
    if (response.status !== 200) throw new StorageFirmadoNoDisponibleError(response.status);
    const tamano = Number(response.headers.get('content-length'));
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!Number.isSafeInteger(tamano) || tamano < 0) throw new StorageFirmadoNoDisponibleError(response.status);
    return { tamano, contentType };
  }

  /** Lo que hay en una carpeta del bucket ('' = la raíz), hasta `limite` entradas. */
  async listar(carpeta: string, limite: number): Promise<EntradaListado[]> {
    if (carpeta !== '' && !/^[0-9a-f-]{36}$/.test(carpeta)) throw new StorageFirmadoNoDisponibleError(undefined);
    const response = await this.request('POST', `/object/list/${this.config.bucket}`, {
      prefix: carpeta,
      limit: limite,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
    const entradas = await this.leer(response, listadoSchema);
    return entradas.map((e) => ({
      nombre: e.name,
      esCarpeta: e.id === null || e.id === undefined,
      creadoEl: e.created_at ?? null,
    }));
  }

  /** Borra esos objetos (los que no existen se ignoran). */
  async borrar(rutas: readonly string[]): Promise<void> {
    if (rutas.length === 0) return;
    const response = await this.request('DELETE', `/object/${this.config.bucket}`, {
      prefixes: rutas.map((ruta) => this.verificarRuta(ruta)),
    });
    await response.body?.cancel();
    if (response.status !== 200 && response.status !== 204) throw new StorageFirmadoNoDisponibleError(response.status);
  }

  private verificarRuta(ruta: string): string {
    if (!RUTA.test(ruta)) throw new StorageFirmadoNoDisponibleError(undefined);
    return ruta;
  }

  private async request(method: 'POST' | 'DELETE' | 'HEAD', path: string, body: unknown): Promise<Response> {
    try {
      return await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: {
          apikey: this.config.secretKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-upsert': 'false',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(STORAGE_FIRMADO_TIMEOUT_MS),
      });
    } catch {
      // Red caída, DNS o timeout. El error original puede incluir la URL: no se propaga.
      throw new StorageFirmadoNoDisponibleError(undefined);
    }
  }

  private async leer<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new StorageFirmadoNoDisponibleError(response.status);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new StorageFirmadoNoDisponibleError(response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new StorageFirmadoNoDisponibleError(response.status);
    return parsed.data;
  }
}
