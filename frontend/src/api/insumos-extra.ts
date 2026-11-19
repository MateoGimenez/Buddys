// Movimientos de un insumo y su stock mínimo (mejoras 2026-11-15). Las recetas están en api/endpoints.ts (tanda 06).
import { api, query } from './client';
import type { Insumo, Persona } from './types';

export interface Movimiento {
  id: string;
  tipo: 'uso' | 'compra' | 'ajuste' | 'devolucion';
  /** Con signo: negativo = salió del stock. */
  cantidad: number;
  costoTotal: number | null;
  proveedor: string | null;
  nota: string | null;
  persona: Persona | null;
  turnoId: string | null;
  /** Lo descontó (o devolvió) la receta de un lavado. */
  automatico?: boolean;
  createdAt: string;
}

/** Hasta 20 insumos por servicio. */
export const movimientos = (insumoId: string) =>
  api<{ movimientos: Movimiento[]; total: number }>(
    `/api/admin/insumos/${encodeURIComponent(insumoId)}/movimientos${query({ limit: 20 })}`,
  );
export const cambiarMinimo = (insumoId: string, stockMinimo: number) =>
  api<{ insumo: Insumo }>(`/api/admin/insumos/${encodeURIComponent(insumoId)}`, { method: 'PATCH', body: { stockMinimo } });
