// Cola sin conexión de "Registrar lavado".
// Si no hay señal (navigator.onLine en false o el fetch falla por red), el lavado se guarda en este dispositivo
// (localStorage) y se manda solo cuando vuelve la conexión o al abrir la app. Solo esto se encola: nada más del panel.
//  - Cada lavado lleva un id local (uuid) que viaja como `idLocal` en el POST, el mismo en cada reintento: si el
//    backend ya lo tiene (la respuesta anterior se perdió por la red), devuelve 200 con ese lavado y no crea otro.
//    Mientras se manda queda trabado, y se saca de la cola apenas la API responde.
//  - Siempre viaja la fecha (y la franja) del momento en que se guardó: si no, al mandarlo mañana quedaría con la
//    fecha de mañana. El backend acepta hasta 31 días atrás; si se pasó, responde 400 y se avisa como rechazado.
//  - Cada lavado queda a nombre de quien lo anotó: si en el celular entra otra persona, no se manda con su sesión.
//  - Lo guardado antes de los servicios múltiples tiene un solo `servicioId`: se manda así (el backend lo acepta) y
//    nunca junto con `servicioIds` (eso es 400).
import { useEffect, useSyncExternalStore } from 'react';
import { ApiError } from '../api/client';
import * as ep from '../api/endpoints';
import type { NuevoLavado, NuevoLavadoLegado } from '../api/types';

export interface LavadoEnCola {
  idLocal: string;
  usuarioId: string;
  datos: (NuevoLavado | NuevoLavadoLegado) & { fecha: string };
  /** Para mostrarlo: los nombres de los servicios ("Nivel II + Motor"). */
  servicio: string;
  guardadoEn: string;
}

export interface LavadoRechazado {
  idLocal: string;
  servicio: string;
  fecha: string;
  mensaje: string;
}

interface Estado {
  cola: LavadoEnCola[];
  rechazados: LavadoRechazado[];
}

const CLAVE = 'buddys.cola-lavados.v1';
export const EVENTO_ENVIADOS = 'buddys:cola-enviada';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un uuid v4 para `idLocal`. */
export function nuevoIdLocal(): string {
  // randomUUID solo existe en contextos seguros (https o localhost): en la red local por http no está.
  const c = crypto as Partial<Crypto> & Pick<Crypto, 'getRandomValues'>;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function leer(): LavadoEnCola[] {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return [];
    const datos = JSON.parse(crudo) as unknown;
    if (!Array.isArray(datos)) return [];
    let migrado = false;
    const cola: LavadoEnCola[] = [];
    for (const l of datos as LavadoEnCola[]) {
      if (typeof l.idLocal !== 'string') continue;
      // Lo guardado antes de que el backend aceptara idLocal: se le da un uuid (una sola vez: queda guardado).
      const id = UUID.test(l.idLocal) ? l.idLocal : nuevoIdLocal();
      if (id === l.idLocal && l.datos.idLocal === id) {
        cola.push(l);
      } else {
        migrado = true;
        cola.push({ ...l, idLocal: id, datos: { ...l.datos, idLocal: id } });
      }
    }
    if (migrado) guardar(cola);
    return cola;
  } catch {
    return [];
  }
}

function guardar(cola: LavadoEnCola[]): boolean {
  try {
    if (cola.length) localStorage.setItem(CLAVE, JSON.stringify(cola));
    else localStorage.removeItem(CLAVE);
    return true;
  } catch {
    return false;
  }
}

let estado: Estado = { cola: leer(), rechazados: [] };
const oyentes = new Set<() => void>();

function cambiar(nuevo: Estado) {
  estado = nuevo;
  for (const o of oyentes) o();
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  // Otra pestaña cambió la cola.
  const alGuardar = (e: StorageEvent) => {
    if (e.key === CLAVE) cambiar({ ...estado, cola: leer() });
  };
  window.addEventListener('storage', alGuardar);
  return () => {
    oyentes.delete(oyente);
    window.removeEventListener('storage', alGuardar);
  };
}

/**
 * Guarda un lavado para mandarlo después, con el mismo idLocal con el que ya se intentó mandar (así, si aquel envío
 * sí llegó, el reintento no lo duplica). Devuelve false si el dispositivo no deja guardar (modo privado, lleno).
 */
export function encolarLavado(
  usuarioId: string,
  datos: NuevoLavado & { fecha: string; idLocal: string },
  servicio: string,
): boolean {
  const item: LavadoEnCola = { idLocal: datos.idLocal, usuarioId, datos, servicio, guardadoEn: new Date().toISOString() };
  const cola = [...leer(), item];
  if (!guardar(cola)) return false;
  cambiar({ ...estado, cola });
  return true;
}

function sacar(id: string) {
  const cola = leer().filter((l) => l.idLocal !== id);
  guardar(cola);
  cambiar({ ...estado, cola });
}

/**
 * Lo que viaja: con `servicioIds` o, si es de antes, con `servicioId`; nunca los dos. Lo guardado antes de SUV y
 * pick-up puede decir 'camioneta', que el backend ya no acepta: va como 'suv', como hizo la migración con los turnos.
 */
function paraEnviar(guardado: LavadoEnCola['datos']): LavadoEnCola['datos'] {
  const datos =
    (guardado.vehiculoTipo as string) === 'camioneta' ? { ...guardado, vehiculoTipo: 'suv' as const } : guardado;
  if (!('servicioIds' in datos)) return datos;
  const copia: NuevoLavado & { fecha: string; servicioId?: unknown } = { ...datos };
  delete copia.servicioId;
  return copia;
}

/** Un error que dice que el lavado nunca va a entrar tal como está (no conviene reintentarlo). */
function esRechazoDefinitivo(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status);
}

const enviando = new Set<string>();
let vuelta: Promise<number> | null = null;

/** Manda lo que haya en la cola de este usuario, de a uno y en orden. Devuelve cuántos entraron. */
export function enviarCola(usuarioId: string): Promise<number> {
  // Una sola vuelta a la vez. Se suelta en un .finally (asincrónico): si la cola está vacía la vuelta termina sin
  // esperar nada, y soltarla adentro la dejaría trabada para siempre.
  vuelta ??= mandar(usuarioId).finally(() => {
    vuelta = null;
  });
  return vuelta;
}

async function mandar(usuarioId: string): Promise<number> {
  let enviados = 0;
  // Por si otra pestaña (o una versión anterior de la app) dejó algo guardado.
  cambiar({ ...estado, cola: leer() });
  for (const item of leer()) {
    if (item.usuarioId !== usuarioId || enviando.has(item.idLocal)) continue;
    if (!navigator.onLine) break;
    enviando.add(item.idLocal);
    try {
      await ep.registrarLavado(paraEnviar(item.datos));
      sacar(item.idLocal);
      enviados++;
    } catch (err) {
      if (!esRechazoDefinitivo(err)) break; // sin red, sesión vencida o el servidor caído: se reintenta después
      sacar(item.idLocal);
      cambiar({
        ...estado,
        rechazados: [
          ...estado.rechazados,
          { idLocal: item.idLocal, servicio: item.servicio, fecha: item.datos.fecha, mensaje: detalle(err) },
        ],
      });
    } finally {
      enviando.delete(item.idLocal);
    }
  }
  if (enviados > 0) window.dispatchEvent(new Event(EVENTO_ENVIADOS));
  return enviados;
}

function detalle(err: ApiError): string {
  const campos = err.fields ? Object.values(err.fields).filter(Boolean) : [];
  return campos.length ? campos.join(' ') : err.message;
}

export function descartarRechazados() {
  cambiar({ ...estado, rechazados: [] });
}

/** Solo para los tests: vuelve a leer lo guardado. */
export function reiniciarCola() {
  cambiar({ cola: leer(), rechazados: [] });
}

export function useCola(usuarioId: string): { pendientes: LavadoEnCola[]; rechazados: LavadoRechazado[] } {
  const actual = useSyncExternalStore(suscribir, () => estado);
  return { pendientes: actual.cola.filter((l) => l.usuarioId === usuarioId), rechazados: actual.rechazados };
}

/** Manda la cola al abrir la app y cada vez que vuelve la señal. */
export function useEnviarCola(usuarioId: string) {
  useEffect(() => {
    const mandar = () => void enviarCola(usuarioId);
    mandar();
    window.addEventListener('online', mandar);
    return () => {
      window.removeEventListener('online', mandar);
    };
  }, [usuarioId]);
}

function suscribirRed(oyente: () => void) {
  window.addEventListener('online', oyente);
  window.addEventListener('offline', oyente);
  return () => {
    window.removeEventListener('online', oyente);
    window.removeEventListener('offline', oyente);
  };
}

/** true mientras el navegador dice que hay conexión. */
export function useEnLinea(): boolean {
  return useSyncExternalStore(
    suscribirRed,
    () => navigator.onLine,
    () => true,
  );
}
