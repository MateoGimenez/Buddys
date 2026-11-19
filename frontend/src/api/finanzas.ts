// Caja con arqueo (función 11), gastos fijos mensuales (función 10) y exportar a CSV (función 16).
// Contrato: reportes/2026-11-15_03_contrato-mejoras.md y backend/test/fixtures/respuestas-api.json
// (cajaAbierta, cajaCierra, cajaCerrada, cajaCierres, gastosFijosLista, gastoFijoCrea, gastoFijoDesactiva,
// estadisticasConFijos). Todo esto es solo para quien ve importes: el empleado recibe 403.
import { api, descargar, query } from './client';
import type { CategoriaGasto, Estadisticas, FormaPago, Persona } from './types';

/* ------------------------------------------------------------------ Caja */

export interface FormaEsperada {
  formaPago: FormaPago;
  esperado: number;
}

/** Lo que debería haber en la caja ese día: lavados de mostrador + señas cobradas + saldos de turnos completados. */
export interface CajaEsperada {
  formas: FormaEsperada[];
  /** Lo cobrado sin forma de pago: no entra en el arqueo de ninguna forma. */
  sinIndicar: number;
  total: number;
}

export interface FormaCerrada {
  formaPago: FormaPago;
  /** La foto de lo esperado al cerrar. */
  esperado: number;
  /** null = esa forma no se contó. */
  contado: number | null;
  diferencia: number | null;
}

export interface Cierre {
  fecha: string;
  formas: FormaCerrada[];
  sinIndicar: number;
  esperadoTotal: number;
  contadoTotal: number;
  /** contado - esperado de las formas contadas: negativo = falta, positivo = sobra. */
  diferencia: number;
  nota: string | null;
  cerradoPor: Persona | null;
  cerradoEl: string;
  actualizadoEl: string;
  /** Lo esperado de hoy ya no coincide con la foto: se tocó un lavado después de cerrar. */
  cambiosDespues: boolean;
}

export interface CajaDelDia {
  fecha: string;
  esperado: CajaEsperada;
  cierre: Cierre | null;
}

/** `efectivo` obligatorio; las demás, omitidas = no se contaron. */
export type Contado = { efectivo: number } & Partial<Record<Exclude<FormaPago, 'efectivo'>, number | null>>;

export const caja = (fecha: string) => api<CajaDelDia>(`/api/admin/caja${query({ fecha })}`);
/** 201 si es un cierre nuevo, 200 si corrige uno (solo superadmin). */
export const cerrarCaja = (fecha: string, contado: Contado, nota: string | null) =>
  api<{ cierre: Cierre }>(`/api/admin/caja/${encodeURIComponent(fecha)}`, {
    method: 'PUT',
    body: nota ? { contado, nota } : { contado },
  });
/** Reabre el día (borra el cierre). Solo superadmin. 204. */
export const reabrirCaja = (fecha: string) =>
  api<undefined>(`/api/admin/caja/${encodeURIComponent(fecha)}`, { method: 'DELETE' });
export const cierresDeCaja = (desde?: string, hasta?: string) =>
  api<{ cierres: Cierre[]; total: number }>(`/api/admin/caja/cierres${query({ desde, hasta, limit: 31 })}`);

/* ------------------------------------------------------------------ Gastos fijos */

export interface GastoFijo {
  id: string;
  concepto: string;
  monto: number;
  categoria: CategoriaGasto;
  /** El empleado del sueldo. */
  perfil: Persona | null;
  activo: boolean;
  /** "YYYY-MM": desde qué mes cuenta (el día 1). */
  desde: string;
  /** "YYYY-MM" | null: último mes que cuenta. */
  hasta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NuevoGastoFijo {
  concepto: string;
  monto: number;
  categoria: CategoriaGasto;
  perfilId?: string | null;
  desde?: string;
}

export type CambioGastoFijo = Partial<{
  concepto: string;
  monto: number;
  categoria: CategoriaGasto;
  perfilId: string | null;
  activo: boolean;
  desde: string;
  hasta: string | null;
}>;

export const gastosFijos = () => api<{ gastosFijos: GastoFijo[]; totalMensual: number }>('/api/admin/gastos-fijos');
export const crearGastoFijo = (datos: NuevoGastoFijo) =>
  api<{ gastoFijo: GastoFijo }>('/api/admin/gastos-fijos', { method: 'POST', body: datos });
export const editarGastoFijo = (id: string, cambio: CambioGastoFijo) =>
  api<{ gastoFijo: GastoFijo }>(`/api/admin/gastos-fijos/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambio });
export const borrarGastoFijo = (id: string) =>
  api<undefined>(`/api/admin/gastos-fijos/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Las estadísticas con las claves nuevas (pueden faltar si el backend es anterior). */
export type EstadisticasConFijos = Estadisticas & {
  periodo: Estadisticas['periodo'] & { gastosFijos?: number; descuentos?: number };
};

/* ------------------------------------------------------------------ Exportar */

export type QueExportar = 'planilla' | 'gastos' | 'estadisticas';

/** CSV para Excel (UTF-8 con BOM, separador ";"). Pasa por el refresco de sesión, como los PDF. */
export const exportarCsv = (que: QueExportar, desde: string, hasta: string) =>
  descargar(`/api/admin/exportar/${que}.csv${query({ desde, hasta })}`);
