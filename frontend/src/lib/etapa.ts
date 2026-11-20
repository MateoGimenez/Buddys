// Etapas del auto en el lavadero: nombres, el paso que sigue y cuánto hace que está ahí.
import { ETAPAS, type Etapa } from '../api/types';

export const NOMBRE_ETAPA: Record<Etapa, string> = {
  espera: 'En espera',
  lavando: 'Lavando',
  listo: 'Listo',
  entregado: 'Entregado',
};

/** Lo que dice el botón para pasar a la etapa que sigue. */
export const ACCION_ETAPA: Record<Exclude<Etapa, 'entregado'>, string> = {
  espera: 'Empezar a lavar',
  lavando: 'Marcar listo',
  listo: 'Entregar',
};

export function etapaSiguiente(e: Etapa): Etapa | null {
  const i = ETAPAS.indexOf(e);
  return ETAPAS[i + 1] ?? null;
}

/** "hace un momento", "hace 12 min", "hace 1 h 5 min". */
export function tiempoDesde(iso: string | null, ahora: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.floor((ahora - t) / 60_000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${String(min)} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h >= 24) return `hace ${String(Math.floor(h / 24))} ${Math.floor(h / 24) === 1 ? 'día' : 'días'}`;
  return resto ? `hace ${String(h)} h ${String(resto)} min` : `hace ${String(h)} h`;
}
