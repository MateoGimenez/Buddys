/** Exportar a CSV (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 16). */

/** Un renglón de la planilla exportada (turnos y lavados no cancelados del rango). */
export interface RenglonPlanilla {
  fecha: string;
  franja: string;
  origen: string;
  estado: string;
  etapa: string | null;
  nombre: string;
  telefono: string | null;
  vehiculoTipo: string;
  vehiculoModelo: string | null;
  servicios: string;
  trabajador: string | null;
  formaPago: string | null;
  monto: number | null;
  descuento: number;
  descuentoMotivo: string | null;
  sena: number | null;
}

/** Un renglón de gastos exportados: sueltos y fijos imputados. */
export interface RenglonGasto {
  fecha: string;
  origen: string;
  categoria: string;
  descripcion: string;
  proveedor: string | null;
  monto: number;
}

/** Tope de renglones de un archivo (un año de un taller chico entra de sobra). */
export const EXPORTAR_MAX_RENGLONES = 20_000;

export interface ExportRepository {
  /** Turnos y lavados no cancelados con fecha de agenda en [desde, hasta], en orden. */
  planilla(desde: string, hasta: string): Promise<RenglonPlanilla[]>;
  /** Gastos sueltos y fijos imputados en [desde, hasta], en orden. */
  gastos(desde: string, hasta: string): Promise<RenglonGasto[]>;
}
