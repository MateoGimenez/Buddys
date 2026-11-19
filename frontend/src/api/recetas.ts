// Insumos que se descuentan solos (función 15): la receta de cada servicio, el stock mínimo y los movimientos.
// Contrato: reportes/2026-11-15_03_contrato-mejoras.md; fixtures recetaGet, recetaPut, error403RecetaEmpleado,
// movimientosAutomaticos, insumoPatch.
import { api, query } from './client';
import type { Insumo, Persona, Unidad } from './types';

export interface InsumoDeReceta {
  insumoId: string;
  nombre: string;
  unidad: Unidad;
  /** La de auto (y la de cualquier vehículo que no tenga la suya). */
  cantidad: number;
  cantidadSuv: number | null;
  cantidadPickup: number | null;
  cantidadMoto: number | null;
  stock: number;
  bajoStock: boolean;
}

export interface Receta {
  servicioId: string;
  insumos: InsumoDeReceta[];
}

export interface RenglonReceta {
  insumoId: string;
  cantidad: number;
  cantidadSuv?: number | null;
  cantidadPickup?: number | null;
  cantidadMoto?: number | null;
}

export interface Movimiento {
  id: string;
  tipo: 'uso' | 'compra' | 'ajuste';
  /** Con signo: negativo = salió del stock. */
  cantidad: number;
  costoTotal: number | null;
  proveedor: string | null;
  nota: string | null;
  persona: Persona | null;
  turnoId: string | null;
  /** Lo descontó (o devolvió) solo un lavado. */
  automatico?: boolean;
  createdAt: string;
}

/** Hasta 20 insumos por servicio. */
export const MAX_RENGLONES_RECETA = 20;

export const receta = (servicioId: string) => api<Receta>(`/api/admin/servicios/${encodeURIComponent(servicioId)}/insumos`);
export const guardarReceta = (servicioId: string, insumos: RenglonReceta[]) =>
  api<Receta>(`/api/admin/servicios/${encodeURIComponent(servicioId)}/insumos`, { method: 'PUT', body: { insumos } });
export const movimientos = (insumoId: string) =>
  api<{ movimientos: Movimiento[]; total: number }>(
    `/api/admin/insumos/${encodeURIComponent(insumoId)}/movimientos${query({ limit: 20 })}`,
  );
export const cambiarMinimo = (insumoId: string, stockMinimo: number) =>
  api<{ insumo: Insumo }>(`/api/admin/insumos/${encodeURIComponent(insumoId)}`, { method: 'PATCH', body: { stockMinimo } });
