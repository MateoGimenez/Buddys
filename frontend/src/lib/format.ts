import type { Franja, FormaPago, VehiculoTipo, Rol, Servicio } from '../api/types';

/** Zona horaria del taller (la misma que usa el backend para "hoy"). */
export const ZONA = 'America/Argentina/La_Rioja';

const pesosFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const numeroFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** Espacio no separable: "$ 12.500" nunca se parte en dos renglones. */
const NBSP = ' ';

/** $ 12.500 (con espacio no separable entre el signo y el número) */
export function pesos(n: number): string {
  return pesosFmt.format(n).replace(/\s/g, NBSP);
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

export const NOMBRE_VEHICULO: Record<VehiculoTipo, string> = { auto: 'Auto', suv: 'SUV', pickup: 'Pick-up', moto: 'Moto' };
export const NOMBRE_FRANJA: Record<Franja, string> = { manana: 'Mañana', tarde: 'Tarde' };
export const NOMBRE_ROL: Record<Rol, string> = { superadmin: 'Dueño (superadmin)', admin: 'Encargado (admin)', empleado: 'Empleado' };

/** El campo de precio de cada vehículo (el de auto es precioDesde). */
export const CAMPO_PRECIO = {
  auto: 'precioDesde',
  suv: 'precioDesdeSuv',
  pickup: 'precioDesdePickup',
  moto: 'precioDesdeMoto',
} as const satisfies Record<VehiculoTipo, keyof Servicio>;

const CAMPO_DURACION = {
  auto: 'duracion',
  suv: 'duracionSuv',
  pickup: 'duracionPickup',
  moto: 'duracionMoto',
} as const satisfies Record<VehiculoTipo, keyof Servicio>;

/** Precio de lista para ese vehículo. null = "Consultá": nunca cae al de auto. */
export function precioPara(servicio: Servicio, vehiculo: VehiculoTipo): number | null {
  return servicio[CAMPO_PRECIO[vehiculo]];
}

export function duracionPara(servicio: Servicio, vehiculo: VehiculoTipo): string | null {
  return servicio[CAMPO_DURACION[vehiculo]];
}

/** Orden de las categorías en Registrar y en Servicios; las que no están acá van después, por nombre. */
export const CATEGORIAS_SERVICIO = ['Lavado', 'Interior', 'Pulido', 'Protección', 'Pre venta', 'Motos'] as const;
export const SIN_CATEGORIA = 'Otros';

/** Agrupa servicios por categoría en el orden canónico, respetando el orden de cada lista dentro del grupo. */
export function porCategoria<T extends { categoria: string | null }>(lista: T[]): { categoria: string; items: T[] }[] {
  const grupos = new Map<string, T[]>();
  for (const s of lista) {
    const c = s.categoria?.trim() || SIN_CATEGORIA;
    const g = grupos.get(c);
    if (g) g.push(s);
    else grupos.set(c, [s]);
  }
  const rango = (c: string) => {
    const i = (CATEGORIAS_SERVICIO as readonly string[]).indexOf(c);
    return i === -1 ? (c === SIN_CATEGORIA ? 1000 : 100) : i;
  };
  return [...grupos.entries()]
    .sort(([a], [b]) => rango(a) - rango(b) || a.localeCompare(b, 'es'))
    .map(([categoria, items]) => ({ categoria, items }));
}

/** Suma de lista de varios servicios para un vehículo. Los "Consultá" no suman: vuelven aparte para avisarlos. */
export function sumaDeLista(servicios: Servicio[], vehiculo: VehiculoTipo): { total: number; aConsultar: Servicio[] } {
  let total = 0;
  const aConsultar: Servicio[] = [];
  for (const s of servicios) {
    const p = precioPara(s, vehiculo);
    if (p === null) aConsultar.push(s);
    else total += p;
  }
  return { total, aConsultar };
}

/** "Nivel II + Motor". */
export function unirServicios(nombres: string[]): string {
  return nombres.join(' + ');
}

/**
 * Los servicios de un lavado, para mostrar. Usa `servicios` del turno; si no viniera (respuesta vieja), el principal
 * con el nombre del catálogo.
 */
export function nombresDelTurno(t: { servicioId: string; servicios?: { nombre: string }[] | undefined }, catalogo?: Map<string, string>): string {
  if (t.servicios?.length) return unirServicios(t.servicios.map((s) => s.nombre));
  return catalogo?.get(t.servicioId) ?? t.servicioId;
}

/** "1 servicio", "3 servicios". */
export function cuantosServicios(n: number): string {
  return n === 1 ? '1 servicio' : `${String(n)} servicios`;
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

export const NOMBRE_PAGO: Record<FormaPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  otro: 'Otro',
};

/** Hora del taller desde la que un lavado cuenta como "tarde" (la misma regla que el backend). */
export const HORA_TARDE = 14;

/** La franja que el backend le pondría a un lavado anotado en este momento. */
export function franjaSegunHora(ahora: Date = new Date()): Franja {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: ZONA }).format(ahora),
  );
  return h % 24 < HORA_TARDE ? 'manana' : 'tarde';
}

/** Las iniciales de un nombre: "Ana López" → "AL", "beto" → "B". Sin nombre, "?". */
export function iniciales(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter((p) => /\p{L}|\d/u.test(p));
  const letras = palabras
    .slice(0, 2)
    .map((p) => (Array.from(p).find((c) => /\p{L}|\d/u.test(c)) ?? '').toLocaleUpperCase('es-AR'))
    .join('');
  return letras || '?';
}
