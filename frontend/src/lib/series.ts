// Series en el tiempo para los gráficos (contrato reportes/2026-11-19_10_graficos.md): de una serie por día se arman
// la de cada semana (clave = el lunes) y la de cada mes (clave = YYYY-MM). Fechas como texto YYYY-MM-DD, sin horas: el
// día de la semana se calcula en UTC para que la zona horaria del celular no lo corra.

export type Agrupado = 'dia' | 'semana' | 'mes';

export interface Punto {
  clave: string;
  valor: number;
}

/** El lunes de la semana de `fecha` (YYYY-MM-DD). */
export function lunesDe(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(a, m - 1, d));
  const desdeLunes = (dia.getUTCDay() + 6) % 7; // 0 = lunes ... 6 = domingo
  dia.setUTCDate(dia.getUTCDate() - desdeLunes);
  return dia.toISOString().slice(0, 10);
}

/** true si la serie viene por día (claves YYYY-MM-DD); una serie por mes (YYYY-MM) no se puede partir en semanas. */
export function esDiaria(puntos: readonly Punto[]): boolean {
  return puntos.length > 0 && puntos.every((p) => p.clave.length === 10);
}

/**
 * Suma una serie diaria por semana o por mes, en orden. La primera y la última semana pueden quedar incompletas
 * (suman solo los días del rango). Con 'dia', o si la serie no es diaria, la devuelve igual.
 */
export function agruparSerie(puntos: readonly Punto[], agrupado: Agrupado): Punto[] {
  if (agrupado === 'dia' || !esDiaria(puntos)) return [...puntos];
  const sumas = new Map<string, number>();
  for (const p of puntos) {
    const clave = agrupado === 'semana' ? lunesDe(p.clave) : p.clave.slice(0, 7);
    sumas.set(clave, (sumas.get(clave) ?? 0) + p.valor);
  }
  return [...sumas.entries()].map(([clave, valor]) => ({ clave, valor }));
}
