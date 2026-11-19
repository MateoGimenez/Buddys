import type { CategoriaGasto } from './gastos.js';

/**
 * Gastos fijos mensuales: sueldos, alquiler, servicios (contrato: reportes/2026-11-15_03_contrato-mejoras.md,
 * función 10). Decisión del dueño: no hay comisiones, el equipo cobra sueldo fijo a fin de mes.
 *
 * Cada ítem cuenta su monto ENTERO el día 1 de cada mes de vigencia (`desde` <= mes <= `hasta`, o sin fin). No se
 * crean filas en gastos: las estadísticas suman los fijos imputados (función buddys.gastos_fijos_imputados) a los
 * gastos sueltos, así nada se cuenta dos veces. "Activo" = sin `hasta` o con `hasta` en el mes actual o después.
 */

export const GASTO_FIJO_CONCEPTO_MAX = 120;

export interface GastoFijo {
  id: string;
  concepto: string;
  /** Pesos por mes. */
  monto: number;
  categoria: CategoriaGasto;
  /** El empleado de un sueldo. */
  perfil: { id: string; nombre: string } | null;
  /** YYYY-MM: primer mes en que cuenta. */
  desde: string;
  /** YYYY-MM: último mes en que cuenta; null = sin fin. */
  hasta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NuevoGastoFijo {
  concepto: string;
  monto: number;
  categoria: CategoriaGasto;
  perfilId: string | null;
  desde: string;
  creadoPor: string;
}

/** Cambios de un PATCH (ya con `activo` traducido a `hasta`): undefined = no se toca. */
export interface CambiosGastoFijo {
  concepto?: string;
  monto?: number;
  categoria?: CategoriaGasto;
  perfilId?: string | null;
  desde?: string;
  hasta?: string | null;
}

/** ¿Cuenta en el mes YYYY-MM? */
export function vigenteEn(gasto: Pick<GastoFijo, 'desde' | 'hasta'>, mes: string): boolean {
  return gasto.desde <= mes && (gasto.hasta === null || gasto.hasta >= mes);
}

/** Activo = cuenta este mes o va a contar más adelante (hasta sin fin o desde/hasta futuros). */
export function estaActivo(gasto: Pick<GastoFijo, 'desde' | 'hasta'>, mesActual: string): boolean {
  return gasto.hasta === null || gasto.hasta >= mesActual;
}

export interface GastoFijoRepository {
  /** Por categoría y concepto. */
  listar(): Promise<GastoFijo[]>;
  obtener(id: string): Promise<GastoFijo | undefined>;
  crear(nuevo: NuevoGastoFijo): Promise<GastoFijo>;
  /** undefined si no existe. */
  actualizar(id: string, cambios: CambiosGastoFijo, now: Date): Promise<GastoFijo | undefined>;
  /** true si existía. */
  borrar(id: string): Promise<boolean>;
}
