import type { VehiculoTipo } from './booking.js';
import type { Unidad } from './inventario.js';

/**
 * Recetas: qué insumos usa cada servicio y cuánto (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md). Una
 * receta general por servicio (vehiculo = null) y, si hace falta, una variante por vehículo que la reemplaza (regla 1).
 * No lleva costos: el empleado la ve igual que el admin.
 */

/** Mismos topes que el CHECK recetas_cantidad_rango y el contrato (0 a 30 renglones por variante). */
export const RECETA_CANTIDAD_MAX = 99_999;
export const MAX_RENGLONES_RECETA = 30;

export interface RenglonReceta {
  insumoId: string;
  nombre: string;
  unidad: Unidad;
  /** En la unidad del insumo, por lavado. */
  cantidad: number;
}

export interface Receta {
  servicioId: string;
  general: RenglonReceta[];
  /** Solo las claves de los vehículos que tienen renglones. */
  porVehiculo: Partial<Record<VehiculoTipo, RenglonReceta[]>>;
}

/** Una variante a guardar (PUT /api/admin/servicios/:id/receta), ya validada en su formato. */
export interface VarianteReceta {
  /** null = la receta general. */
  vehiculo: VehiculoTipo | null;
  /** Sin insumos repetidos; [] borra la variante. */
  items: { insumoId: string; cantidad: number }[];
}

/** Uno de los insumos pedidos no existe o está inactivo: `indice` es su posición en `items`. */
export class InsumoDeRecetaInvalidoError extends Error {
  constructor(readonly indice: number) {
    super('Ese insumo no existe o está inactivo.');
    this.name = 'InsumoDeRecetaInvalidoError';
  }
}

export interface RecetaRepository {
  /** Una receta por servicio que tenga renglones (de insumos activos), en el orden del catálogo. */
  listar(): Promise<Receta[]>;
  /** La receta entera del servicio (vacía si no tiene renglones). */
  delServicio(servicioId: string): Promise<Receta>;
  /**
   * Reemplaza esa variante en una transacción y devuelve la receta entera del servicio. Lanza
   * InsumoDeRecetaInvalidoError. Que el servicio exista y ofrezca ese vehículo lo verifica el servicio antes.
   */
  reemplazar(servicioId: string, variante: VarianteReceta): Promise<Receta>;
}
