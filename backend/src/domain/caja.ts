import { type FormaDePago, FORMAS_DE_PAGO } from './comprobantes.js';

/**
 * Cierre de caja con arqueo (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 11).
 *
 * "Esperado" de un día, por forma de pago = lavados de mostrador no cancelados del día (su monto) + saldos de los
 * turnos (web o panel) completados ese día (monto - seña) + señas cobradas ese día. Lo cobrado sin forma de pago va
 * en `sinIndicar` (no se puede arquear). Al cerrar se guarda la FOTO de lo esperado; la diferencia es contado -
 * esperado de las formas que se contaron (efectivo siempre). Un cierre por día. Todo es plata: solo admin y
 * superadmin.
 */

/** Hasta cuántos días para atrás se puede cerrar (o corregir) una caja. */
export const CAJA_DIAS_ATRAS = 366;
/** Tope de un importe del día (el CHECK de la tabla). */
export const CAJA_IMPORTE_MAX = 999_999_999;
export const CAJA_NOTA_MAX = 300;

export type PorForma<T> = Record<FormaDePago, T>;

export interface CajaEsperada {
  porForma: PorForma<number>;
  sinIndicar: number;
}

export interface CierreGuardado {
  fecha: string;
  contado: PorForma<number | null>;
  esperado: PorForma<number>;
  sinIndicar: number;
  diferencia: number;
  nota: string | null;
  cerradoPor: { id: string; nombre: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface NuevoCierre {
  fecha: string;
  contado: PorForma<number | null>;
  esperado: PorForma<number>;
  sinIndicar: number;
  diferencia: number;
  nota: string | null;
  cerradoPor: string;
}

/** contado - esperado de las formas contadas. */
export function diferenciaDe(contado: PorForma<number | null>, esperado: PorForma<number>): number {
  return FORMAS_DE_PAGO.reduce((suma, forma) => {
    const c = contado[forma];
    return c === null ? suma : suma + c - esperado[forma];
  }, 0);
}

export function mismaFoto(a: CajaEsperada, b: Pick<CierreGuardado, 'esperado' | 'sinIndicar'>): boolean {
  return a.sinIndicar === b.sinIndicar && FORMAS_DE_PAGO.every((forma) => a.porForma[forma] === b.esperado[forma]);
}

export interface CajaRepository {
  /** Lo esperado del día, agregado en SQL. */
  esperado(fecha: string): Promise<CajaEsperada>;
  obtener(fecha: string): Promise<CierreGuardado | undefined>;
  /**
   * Cierra un día que no tenía cierre (INSERT ... ON CONFLICT DO NOTHING). undefined si ya había uno (otro cierre
   * entró antes, aunque sea en paralelo): no pisa nada.
   */
  crear(cierre: NuevoCierre): Promise<CierreGuardado | undefined>;
  /** Crea o reemplaza el cierre del día (solo el camino de quien puede corregir: el superadmin). */
  guardar(cierre: NuevoCierre, now: Date): Promise<CierreGuardado>;
  /** true si existía. */
  borrar(fecha: string): Promise<boolean>;
  /** Más nuevos primero, en [desde, hasta]. */
  listar(desde: string, hasta: string, limit: number, offset: number): Promise<{ cierres: CierreGuardado[]; total: number }>;
}
