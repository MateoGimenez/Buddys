import type { TurnoAgenda } from '../../api/agenda';
import type { EstadoTurno, Franja } from '../../api/types';
import { sumarDias } from '../../lib/format';

export type Vista = 'dia' | 'semana';

/** El lunes de la semana de esa fecha. */
export function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

export function rangoDe(vista: Vista, fecha: string): { desde: string; hasta: string } {
  if (vista === 'dia') return { desde: fecha, hasta: fecha };
  const desde = lunesDe(fecha);
  return { desde, hasta: sumarDias(desde, 6) };
}

/** Fecha y franja de agenda: las confirmadas por el taller si están, si no las pedidas. */
export function fechaDeAgenda(t: TurnoAgenda): string {
  return t.fechaConfirmada ?? t.fechaPreferida;
}

export function franjaDeAgenda(t: TurnoAgenda): Franja {
  return t.franjaConfirmada ?? t.franja;
}

/** Los turnos de trabajo (web o panel) agrupados por día, en el orden de la agenda. Los lavados de mostrador no. */
export function porDia(turnos: TurnoAgenda[]): { fecha: string; turnos: TurnoAgenda[] }[] {
  const grupos = new Map<string, TurnoAgenda[]>();
  for (const t of turnos) {
    if (t.origen === 'mostrador') continue;
    const f = fechaDeAgenda(t);
    const g = grupos.get(f);
    if (g) g.push(t);
    else grupos.set(f, [t]);
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, ts]) => ({ fecha, turnos: ts }));
}

export const NOMBRE_ESTADO: Record<EstadoTurno, string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

/** Suma de los precios de lista de los servicios del turno, o null si alguno es "Consultá" (o no se ven precios). */
export function totalDeLista(t: TurnoAgenda): number | null {
  let total = 0;
  for (const s of t.servicios) {
    if (s.precioLista === null) return null;
    total += s.precioLista;
  }
  return t.servicios.length ? total : null;
}

/** Hasta cuántos días adelante se puede dar un turno y cuántos atrás puede ser la fecha de la seña (el backend). */
export const DIAS_ADELANTE = 120;
export const DIAS_SENA_ATRAS = 31;
