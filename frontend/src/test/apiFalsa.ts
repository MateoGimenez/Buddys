import { vi } from 'vitest';
import type { RespuestaFalsa } from './fixtures';

export interface Pedido {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Manejador = RespuestaFalsa | ((p: Pedido) => RespuestaFalsa);

/**
 * fetch falso. Las rutas se escriben "METODO /api/ruta" (sin query). Un arreglo de respuestas se consume en orden
 * (la última se repite). Guarda cada pedido para revisarlo.
 */
export function apiFalsa(rutas: Record<string, Manejador | Manejador[]>) {
  const pedidos: Pedido[] = [];
  const usadas = new Map<string, number>();

  const fetchFalso = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost:5173');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const pedido: Pedido = { method, path: url.pathname + url.search, headers, body };
    pedidos.push(pedido);

    const clave = `${method} ${url.pathname}`;
    const definida = rutas[clave];
    if (!definida) {
      return Promise.resolve(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `Sin mock: ${clave}` } }), { status: 404 }));
    }
    let manejador: Manejador;
    if (Array.isArray(definida)) {
      const i = usadas.get(clave) ?? 0;
      usadas.set(clave, i + 1);
      manejador = definida[Math.min(i, definida.length - 1)] as Manejador;
    } else {
      manejador = definida;
    }
    const r = typeof manejador === 'function' ? manejador(pedido) : manejador;
    const texto = r.body === undefined ? null : JSON.stringify(r.body);
    return Promise.resolve(new Response(texto, { status: r.status, headers: texto ? { 'Content-Type': 'application/json' } : {} }));
  });

  vi.stubGlobal('fetch', fetchFalso);
  return { pedidos, fetchFalso, de: (method: string, path: string) => pedidos.filter((p) => p.method === method && p.path.startsWith(path)) };
}
