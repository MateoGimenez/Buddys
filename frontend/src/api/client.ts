// Cliente HTTP del panel. Reglas del backend (backend/README.md, "Reglas generales"):
//  - Todo pedido que cambia algo (POST, PATCH, PUT, DELETE) lleva Content-Type: application/json, aunque no tenga body.
//  - Las cookies de sesión son HttpOnly: el JS nunca ve tokens; solo se mandan con credentials.
//  - Ante 401 SESSION_EXPIRED en /api/admin/*: POST /api/auth/refresh una vez y se reintenta el pedido.
//  - 401 UNAUTHORIZED / 403 NO_ACCESS: la sesión terminó (al login). 403 FORBIDDEN: solo "tu rol no puede", sigue.

export type CamposConError = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: CamposConError | undefined;

  constructor(status: number, code: string, message: string, fields?: CamposConError) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const MENSAJE_SIN_CONEXION = 'No pudimos conectar con el servidor. Revisá la conexión y probá de nuevo.';
const MENSAJE_GENERICO = 'Algo salió mal. Probá de nuevo en un rato.';

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Opciones {
  method?: Metodo;
  body?: unknown;
  signal?: AbortSignal;
}

// Avisos a la sesión (los escucha SessionProvider).
type Oyente = () => void;
const oyentesFinDeSesion = new Set<Oyente>();

export function alTerminarLaSesion(oyente: Oyente): () => void {
  oyentesFinDeSesion.add(oyente);
  return () => {
    oyentesFinDeSesion.delete(oyente);
  };
}

function avisarFinDeSesion(): void {
  for (const oyente of oyentesFinDeSesion) oyente();
}

function esRutaAdmin(path: string): boolean {
  return path.startsWith('/api/admin/') || path === '/api/admin';
}

function armarPedido(opciones: Opciones): RequestInit {
  const method = opciones.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (opciones.body !== undefined) init.body = JSON.stringify(opciones.body);
  }
  if (opciones.signal) init.signal = opciones.signal;
  return init;
}

async function leerError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string; fields?: CamposConError } };
    const e = data.error;
    if (e?.code && e.message) return new ApiError(res.status, e.code, e.message, e.fields);
  } catch {
    // respuesta sin JSON (por ejemplo, el proxy sin backend)
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError(res.status, 'SERVICE_UNAVAILABLE', 'El servidor no responde. Probá de nuevo en un rato.');
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', MENSAJE_GENERICO);
}

async function enviar(path: string, opciones: Opciones): Promise<Response> {
  try {
    return await fetch(path, armarPedido(opciones));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', MENSAJE_SIN_CONEXION);
  }
}

// Un solo refresco a la vez: si varios pedidos vencen juntos, todos esperan el mismo.
let refrescoEnCurso: Promise<boolean> | null = null;

function refrescarSesion(): Promise<boolean> {
  refrescoEnCurso ??= (async () => {
    try {
      const res = await enviar('/api/auth/refresh', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    } finally {
      queueMicrotask(() => {
        refrescoEnCurso = null;
      });
    }
  })();
  return refrescoEnCurso;
}

/** Hace el pedido y aplica las reglas de sesión. Devuelve la Response ya OK (status 2xx). */
async function pedir(path: string, opciones: Opciones): Promise<Response> {
  let res = await enviar(path, opciones);

  if (res.status === 401 && esRutaAdmin(path)) {
    const error = await leerError(res);
    if (error.code === 'SESSION_EXPIRED') {
      const ok = await refrescarSesion();
      if (!ok) {
        avisarFinDeSesion();
        throw new ApiError(401, 'UNAUTHORIZED', 'Tu sesión terminó. Volvé a ingresar.');
      }
      res = await enviar(path, opciones);
      // Se refrescó una vez y sigue sin sesión: no se reintenta de nuevo, se vuelve al ingreso.
      if (res.status === 401) {
        avisarFinDeSesion();
        throw new ApiError(401, 'UNAUTHORIZED', 'Tu sesión terminó. Volvé a ingresar.');
      }
    } else {
      avisarFinDeSesion();
      throw error;
    }
  }

  if (!res.ok) {
    const error = await leerError(res);
    if (esRutaAdmin(path) && (error.code === 'UNAUTHORIZED' || error.code === 'NO_ACCESS')) avisarFinDeSesion();
    throw error;
  }
  return res;
}

/** Pedido JSON. Un 204 devuelve undefined. */
export async function api<T>(path: string, opciones: Opciones = {}): Promise<T> {
  const res = await pedir(path, opciones);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, 'INTERNAL_ERROR', MENSAJE_GENERICO);
  }
}

/** Descarga un archivo (los PDF) con las mismas reglas de sesión. */
export async function descargar(path: string): Promise<Blob> {
  const res = await pedir(path, { method: 'GET' });
  return res.blob();
}

/** Arma una query string ignorando los vacíos. */
export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Mensaje para mostrar a partir de cualquier error. */
export function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return MENSAJE_GENERICO;
}
