import type { FetchFn } from '../src/lib/supabase-auth.js';
import { SECRET_KEY, SUPABASE_URL } from './supabase-fake.js';

export interface StorageCall {
  /** Ruta sin el host (ej.: /storage/v1/object/avatares/<id>.webp). */
  path: string;
  method: string;
  apikey: string | null;
  bearer: boolean;
  upsert: string | null;
  contentType: string | null;
}

/**
 * Supabase Storage falso, en memoria: ningún test hace requests reales. Responde /storage/v1/object/<bucket>/<ruta>
 * (POST con x-upsert, GET y DELETE) con las formas y status de Storage. Como el real con las claves sb_secret_, solo
 * acepta la secret key en `apikey` (en Authorization: Bearer la rechaza: no es un JWT). Un objeto que no existe da 400
 * con { statusCode: "404", error: "not_found" }, como responde la API de Storage.
 */
export class FakeSupabaseStorage {
  readonly calls: StorageCall[] = [];
  /** Los objetos guardados: "<bucket>/<ruta>" => bytes y tipo. */
  readonly objetos = new Map<string, { bytes: Uint8Array; contentType: string }>();
  /** 'down': la red falla; 'error': Storage responde 500. */
  mode: 'ok' | 'down' | 'error' = 'ok';

  readonly fetch: FetchFn = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    this.calls.push({
      path: url.pathname,
      method,
      apikey: headers.get('apikey'),
      bearer: headers.has('Authorization'),
      upsert: headers.get('x-upsert'),
      contentType: headers.get('Content-Type'),
    });
    if (this.mode === 'down') throw new TypeError('fetch failed');
    if (this.mode === 'error') return json(500, { statusCode: '500', error: 'internal', message: 'Internal Server Error' });
    if (url.origin !== SUPABASE_URL || headers.get('apikey') !== SECRET_KEY || headers.has('Authorization')) {
      return json(400, { statusCode: '403', error: 'Unauthorized', message: 'Invalid Compact JWS' });
    }
    const prefijo = '/storage/v1/object/';
    if (!url.pathname.startsWith(prefijo)) return json(404, { statusCode: '404', error: 'not_found' });
    const clave = decodeURIComponent(url.pathname.slice(prefijo.length));

    if (method === 'POST' || method === 'PUT') {
      if (this.objetos.has(clave) && headers.get('x-upsert') !== 'true') {
        return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      }
      const body = init?.body;
      const bytes = body instanceof Uint8Array ? new Uint8Array(body) : new Uint8Array(await new Response(body).arrayBuffer());
      this.objetos.set(clave, { bytes, contentType: headers.get('Content-Type') ?? 'application/octet-stream' });
      return json(200, { Key: clave, Id: 'id-de-prueba' });
    }
    const objeto = this.objetos.get(clave);
    if (objeto === undefined) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    if (method === 'GET') {
      return new Response(new Uint8Array(objeto.bytes), {
        status: 200,
        headers: { 'Content-Type': objeto.contentType, 'Content-Length': String(objeto.bytes.length) },
      });
    }
    if (method === 'DELETE') {
      this.objetos.delete(clave);
      return json(200, { message: 'Successfully deleted' });
    }
    return json(405, { statusCode: '405', error: 'method_not_allowed' });
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
