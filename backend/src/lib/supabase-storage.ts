import type { FetchFn } from './supabase-auth.js';

/** Tope de cada llamada a Supabase Storage: subir o bajar una foto de 256×256 no puede quedar colgado. */
export const SUPABASE_STORAGE_TIMEOUT_MS = 10_000;

/**
 * Lo más grande que se acepta al bajar un objeto. Las fotos de perfil pesan unos pocos KB (WebP de 256×256) y el bucket
 * tiene un tope de 256 KiB: si viene algo más grande, no es una foto nuestra.
 */
export const STORAGE_MAX_DESCARGA_BYTES = 512 * 1024;

/** Supabase Storage no respondió, respondió 5xx o algo inesperado. Nunca incluye la URL, la clave ni el cuerpo. */
export class StorageUnavailableError extends Error {
  constructor(readonly status: number | undefined) {
    super(
      status === undefined ? 'Supabase Storage no respondió' : `Supabase Storage respondió ${String(status)}`,
    );
    this.name = 'StorageUnavailableError';
  }
}

/**
 * Cliente mínimo de la API REST de Supabase Storage (/storage/v1/object), del lado del servidor y siempre con la secret
 * key. Como en SupabaseAdminClient, la clave va SOLO en la cabecera `apikey`: las claves sb_secret_ no son JWT y el
 * gateway de Supabase arma el Authorization (mandarla como `Authorization: Bearer` la rechaza). Las respuestas de error
 * se leen solo por su status: nada de lo que devuelve Supabase se loguea.
 */
export class SupabaseStorageClient {
  constructor(
    private readonly config: { url: string; secretKey: string },
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Sube (o reemplaza: x-upsert) un objeto. */
  async upload(bucket: string, ruta: string, contenido: Uint8Array, contentType: string): Promise<void> {
    const response = await this.request('POST', bucket, ruta, {
      headers: { 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'no-cache' },
      body: contenido,
    });
    await response.body?.cancel();
    if (response.status !== 200 && response.status !== 201) throw new StorageUnavailableError(response.status);
  }

  /** Baja un objeto. null = no existe. */
  async download(bucket: string, ruta: string): Promise<Uint8Array | null> {
    const response = await this.request('GET', bucket, ruta, {});
    if (await this.esNoEncontrado(response)) return null;
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new StorageUnavailableError(response.status);
    }
    const declarado = Number(response.headers.get('content-length') ?? '0');
    if (declarado > STORAGE_MAX_DESCARGA_BYTES) {
      await response.body?.cancel();
      throw new StorageUnavailableError(response.status);
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      throw new StorageUnavailableError(response.status);
    }
    if (bytes.byteLength > STORAGE_MAX_DESCARGA_BYTES) throw new StorageUnavailableError(response.status);
    return new Uint8Array(bytes);
  }

  /** Borra un objeto. false = no existía. */
  async remove(bucket: string, ruta: string): Promise<boolean> {
    const response = await this.request('DELETE', bucket, ruta, {});
    if (await this.esNoEncontrado(response)) return false;
    await response.body?.cancel();
    if (response.status !== 200 && response.status !== 204) throw new StorageUnavailableError(response.status);
    return true;
  }

  private async request(
    method: 'POST' | 'GET' | 'DELETE',
    bucket: string,
    ruta: string,
    init: { headers?: Record<string, string>; body?: Uint8Array },
  ): Promise<Response> {
    const url = `${this.config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${ruta
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    try {
      return await this.fetchFn(url, {
        method,
        headers: { apikey: this.config.secretKey, ...init.headers },
        ...(init.body !== undefined && { body: init.body }),
        redirect: 'error',
        signal: AbortSignal.timeout(SUPABASE_STORAGE_TIMEOUT_MS),
      });
    } catch {
      // Red caída, DNS o timeout. El error original puede incluir la URL: no se propaga.
      throw new StorageUnavailableError(undefined);
    }
  }

  /**
   * "No existe" en Storage: 404, o (versiones anteriores de la API) 400 con `{ statusCode: "404", error: "not_found" }`.
   * Si es eso, consume el cuerpo; si no, lo deja para quien llama.
   */
  private async esNoEncontrado(response: Response): Promise<boolean> {
    if (response.status === 404) {
      await response.body?.cancel();
      return true;
    }
    if (response.status !== 400) return false;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new StorageUnavailableError(response.status);
    }
    const { statusCode, error } = (typeof json === 'object' && json !== null ? json : {}) as {
      statusCode?: unknown;
      error?: unknown;
    };
    if (statusCode === '404' || statusCode === 404 || error === 'not_found' || error === 'Not found') return true;
    throw new StorageUnavailableError(response.status);
  }
}
