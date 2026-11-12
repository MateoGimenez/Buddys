import type { Franja, VehiculoTipo, Rol, Servicio } from '../api/types';

/** Zona horaria del taller (la misma que usa el backend para "hoy"). */
export const ZONA = 'America/Argentina/La_Rioja';

const pesosFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const numeroFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** $ 12.500 */
export function pesos(n: number): string {
  return pesosFmt.format(n).replace(/\s/g, ' ');
}

export function numero(n: number): string {
  return numeroFmt.format(n);
}

/** 0.4 -> "40 %" */
export function porcentaje(x: number): string {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(x * 100)} %`;
}

/** Fecha de hoy en Argentina, YYYY-MM-DD. */
export function hoy(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    ahora,
  );
}

/** Suma días a una fecha YYYY-MM-DD (sin zonas: cuenta en UTC). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function primeroDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

export function ultimoDelMes(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}

export function mesAnterior(fecha: string): string {
  return sumarDias(primeroDelMes(fecha), -1);
}

function comoFecha(fecha: string): Date {
  return new Date(`${fecha}T12:00:00Z`);
}

/** "miércoles 12 de noviembre" */
export function fechaLarga(fecha: string): string {
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    comoFecha(fecha),
  );
}

/** "12/11/2026" */
export function fechaCorta(fecha: string): string {
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(
    comoFecha(fecha),
  );
}

/** "12 nov" */
export function diaMes(fecha: string): string {
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(comoFecha(fecha))
    .replace('.', '');
}

/** "noviembre de 2026" para "YYYY-MM" o "YYYY-MM-DD" */
export function nombreMes(fecha: string): string {
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    comoFecha(`${fecha.slice(0, 7)}-15`),
  );
}

/** Hora local de un ISO, "14:05". */
export function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: ZONA, hour12: false }).format(
    new Date(iso),
  );
}

export const NOMBRE_VEHICULO: Record<VehiculoTipo, string> = { auto: 'Auto', camioneta: 'Camioneta', moto: 'Moto' };
export const NOMBRE_FRANJA: Record<Franja, string> = { manana: 'Mañana', tarde: 'Tarde' };
export const NOMBRE_ROL: Record<Rol, string> = { superadmin: 'Dueño (superadmin)', admin: 'Encargado (admin)', empleado: 'Empleado' };

export function precioPara(servicio: Servicio, vehiculo: VehiculoTipo): number | null {
  if (vehiculo === 'camioneta') return servicio.precioDesdeCamioneta;
  if (vehiculo === 'moto') return servicio.precioDesdeMoto;
  return servicio.precioDesde;
}

/** Solo dígitos -> entero, o null si está vacío. */
export function enteroDesdeTexto(texto: string): number | null {
  const digitos = texto.replace(/\D/g, '');
  if (!digitos) return null;
  return Number(digitos);
}

/** Para un input de pesos: "12500" -> "12.500". */
export function miles(texto: string): string {
  const n = enteroDesdeTexto(texto);
  return n === null ? '' : new Intl.NumberFormat('es-AR').format(n);
}

/** Acepta "1,5" o "1.5" -> 1.5. NaN si no es número. */
export function decimalDesdeTexto(texto: string): number {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) return Number.NaN;
  return Number(limpio);
}

/** Número de serie del talonario: 7 -> "0007". */
export function serie(n: number): string {
  return String(n).padStart(4, '0');
}

/** Slug para el id de un servicio nuevo. */
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 64)
    // Después de recortar: si el corte cae en un guion, el id terminaría en "-" y el backend lo rechaza.
    .replace(/^-+|-+$/g, '');
}
