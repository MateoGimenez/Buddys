import { FORMAS_PAGO, type FormaPago } from '../../api/types';
import type { Cierre, Contado } from '../../api/finanzas';
import { enteroDesdeTexto, miles, pesos } from '../../lib/format';

/** Hasta cuántos días atrás se puede cerrar o mirar una caja (lo limita el backend). */
export const DIAS_ATRAS_CAJA = 366;

export type Tono ='falta' | 'sobra' | 'justo';

export function tonoDe(diferencia: number): Tono {
  if (diferencia < 0) return 'falta';
  if (diferencia > 0) return 'sobra';
  return 'justo';
}

/** "Faltan $ 500", "Sobran $ 1.200", "Cierra justo". */
export function textoDiferencia(diferencia: number): string {
  if (diferencia < 0) return `Faltan ${pesos(-diferencia)}`;
  if (diferencia > 0) return `Sobran ${pesos(diferencia)}`;
  return 'Cierra justo';
}

/** Lo que se escribe en cada casilla del arqueo (texto con puntos de miles; vacío = no se contó). */
export type Conteo = Record<FormaPago, string>;

export const CONTEO_VACIO: Conteo = { efectivo: '', transferencia: '', debito: '', credito: '', otro: '' };

/** El conteo de un cierre ya hecho, para corregirlo. */
export function conteoDe(cierre: Cierre): Conteo {
  const c = { ...CONTEO_VACIO };
  for (const f of cierre.formas) c[f.formaPago] = f.contado === null ? '' : miles(String(f.contado));
  return c;
}

/** El body de PUT /api/admin/caja/:fecha. null si falta el efectivo (es obligatorio). */
export function contadoDe(conteo: Conteo): Contado | null {
  const efectivo = enteroDesdeTexto(conteo.efectivo);
  if (efectivo === null) return null;
  const contado: Contado = { efectivo };
  for (const f of FORMAS_PAGO) {
    if (f === 'efectivo') continue;
    const n = enteroDesdeTexto(conteo[f]);
    if (n !== null) contado[f] = n;
  }
  return contado;
}

/**
 * Diferencia en vivo: contado - esperado de las formas contadas (la misma cuenta que el backend). null si todavía no
 * se contó nada.
 */
export function diferenciaEnVivo(conteo: Conteo, esperado: Record<FormaPago, number>): number | null {
  let contadas = 0;
  let dif = 0;
  for (const f of FORMAS_PAGO) {
    const n = enteroDesdeTexto(conteo[f]);
    if (n === null) continue;
    contadas++;
    dif += n - esperado[f];
  }
  return contadas ? dif : null;
}

export function esperadoPorForma(formas: { formaPago: FormaPago; esperado: number }[]): Record<FormaPago, number> {
  const r: Record<FormaPago, number> = { efectivo: 0, transferencia: 0, debito: 0, credito: 0, otro: 0 };
  for (const f of formas) r[f.formaPago] = f.esperado;
  return r;
}
