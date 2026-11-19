import type { Unidad } from './inventario.js';

/**
 * Insumos que se descuentan solos (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 15). La "receta" de
 * un servicio dice qué insumos usa y cuánto por vehículo. Al completar un lavado o turno se registran solas las
 * salidas de stock (movimientos 'uso' automáticos) y se devuelven si sale de completado, cambia de servicios o se
 * borra: lo hace la función buddys.sincronizar_insumos_turno dentro de la transacción del turno.
 */

/** Hasta cuántos insumos lleva la receta de un servicio. */
export const MAX_INSUMOS_RECETA = 20;

export interface ItemReceta {
  insumoId: string;
  /** Cantidad para auto (y para cualquier vehículo sin la suya). */
  cantidad: number;
  /** null = usa `cantidad`. */
  cantidadSuv: number | null;
  cantidadPickup: number | null;
  cantidadMoto: number | null;
}

export interface ItemRecetaConInsumo extends ItemReceta {
  nombre: string;
  unidad: Unidad;
  stock: number;
  bajoStock: boolean;
}

/** Un insumo de la receta no existe o está inactivo. */
export class InsumoDeRecetaInvalidoError extends Error {
  constructor() {
    super('Un insumo de la receta no existe o está inactivo.');
    this.name = 'InsumoDeRecetaInvalidoError';
  }
}

export interface RecetaRepository {
  /** La receta del servicio, por nombre del insumo. */
  obtener(servicioId: string): Promise<ItemRecetaConInsumo[]>;
  /** Reemplaza la receta entera en una transacción. Lanza InsumoDeRecetaInvalidoError. */
  reemplazar(servicioId: string, items: readonly ItemReceta[]): Promise<ItemRecetaConInsumo[]>;
}
