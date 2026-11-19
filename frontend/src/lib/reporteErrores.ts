// Reporte de errores del panel (función 26): window.onerror, unhandledrejection y el ErrorBoundary de React mandan un
// resumen a POST /api/admin/errores-cliente (con sesión) o, si responde 401, a POST /api/errores-cliente (sin sesión,
// el login). Nunca se manda el cuerpo de un formulario ni datos personales: solo el mensaje y el stack (recortados y
// limpios de emails, números largos y tokens), el path de la URL sin query ni hash, el navegador y la versión.
// Sin conexión se descarta. Cada error distinto se manda una sola vez por carga de página y hasta 5 por minuto.
import { version } from '../../package.json' with { type: 'json' };

export const VERSION = version;

const MAX_POR_MINUTO = 5;
const VENTANA_MS = 60_000;
const MAX_MENSAJE = 1000;
const MAX_STACK = 4000;
const RENGLONES_STACK = 12;

const enviados = new Set<string>();
let marcas: number[] = [];

/** Saca lo que podría ser un dato personal o un secreto antes de que salga del navegador. */
export function limpiar(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[token]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .replace(/\d[\d\s.-]{4,}\d/g, (m) => (m.replace(/\D/g, '').length >= 6 ? '[número]' : m))
    .replace(/([?&][^=\s]+=)[^&\s)]+/g, '$1[…]');
}

function recortarStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return limpiar(stack.split('\n').slice(0, RENGLONES_STACK).join('\n')).slice(0, MAX_STACK);
}

export interface ReporteError {
  mensaje: string;
  stack?: string;
  url: string;
  userAgent: string;
  version: string;
}

/** Arma el reporte (sin enviarlo). */
export function armarReporte(error: unknown): ReporteError {
  let mensaje: string;
  let stack: string | undefined;
  if (error instanceof Error) {
    mensaje = `${error.name}: ${error.message}`;
    stack = error.stack;
  } else if (typeof error === 'string') {
    mensaje = error;
  } else {
    mensaje = 'Error desconocido';
  }
  const limpio = recortarStack(stack);
  return {
    mensaje: limpiar(mensaje).slice(0, MAX_MENSAJE) || 'Error sin mensaje',
    ...(limpio ? { stack: limpio } : {}),
    url: window.location.pathname.slice(0, 2000),
    userAgent: navigator.userAgent.slice(0, 500),
    version: VERSION.slice(0, 40),
  };
}

async function postear(ruta: string, reporte: ReporteError): Promise<number> {
  const res = await fetch(ruta, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reporte),
    keepalive: true,
  });
  return res.status;
}

/**
 * Manda un error. Devuelve true si salió (para los tests). Usa fetch directo (no el cliente de la API): un 401 acá no
 * tiene que cerrar la sesión ni pedir refresco.
 */
export async function reportarError(error: unknown): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    // Los errores de red ya los ve la persona en pantalla: no son fallas del panel.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NETWORK') return false;
    const reporte = armarReporte(error);
    // Mismo mensaje en el mismo lugar del código (sin línea ni columna) = el mismo error.
    const firma = `${reporte.mensaje}|${(reporte.stack?.split('\n')[1] ?? '').replace(/:\d+:\d+/g, '')}`;
    if (enviados.has(firma)) return false;
    const ahora = Date.now();
    marcas = marcas.filter((t) => ahora - t < VENTANA_MS);
    if (marcas.length >= MAX_POR_MINUTO) return false;
    enviados.add(firma);
    marcas.push(ahora);
    const status = await postear('/api/admin/errores-cliente', reporte);
    if (status === 401) await postear('/api/errores-cliente', reporte);
    return true;
  } catch {
    // El reporte nunca rompe nada (ni se reporta a sí mismo).
    return false;
  }
}

let instalado = false;

/** Escucha los errores sin atrapar de toda la página. Una sola vez. */
export function iniciarReporteErrores(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  window.addEventListener('error', (e) => {
    void reportarError(e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    void reportarError(e.reason);
  });
}

/** Para los tests: vuelve a cero la memoria de enviados y el límite. */
export function reiniciarReporteErrores(): void {
  enviados.clear();
  marcas = [];
}
