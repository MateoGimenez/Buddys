import { formatearNumero } from '../lib/formato.js';
import type { Rol } from './perfil.js';
import { puedeVerCostosInventario } from './permisos.js';

/**
 * Inventario del taller (contrato: reportes/2026-10-27_17_finanzas-inventario-documentos.md, "Inventario").
 *
 * Insumos con stock decimal (hasta 2 decimales) y un historial de movimientos con signo (compra +, uso -, ajuste +/-).
 * Los costos y los valores en pesos (`costoUnitario`, `valorEnStock`, `costoTotal`, `valorTotal`) son plata: el
 * empleado nunca los recibe (ver `vistaDeInsumo`, `vistaDeMovimiento` y `vistaDeListaDeInsumos`).
 */

export const UNIDADES = ['unidad', 'litro', 'ml', 'kg', 'g', 'par', 'caja'] as const;
export type Unidad = (typeof UNIDADES)[number];

/**
 * Tipos de movimiento. `devolucion` (positivo) lo crea solo el sistema, al deshacer o corregir un lavado que descontó
 * su receta (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md, reglas 4 y 5): no se carga a mano.
 */
export const TIPOS_MOVIMIENTO = ['compra', 'uso', 'ajuste', 'devolucion'] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

/** Los que se pueden cargar a mano (POST /api/admin/insumos/:id/movimientos). */
export const TIPOS_MOVIMIENTO_MANUAL = ['compra', 'uso', 'ajuste'] as const satisfies readonly TipoMovimiento[];

/** Mismos topes que los CHECK de las tablas insumos y movimientos_stock. */
export const INSUMO_NOMBRE_MAX = 80;
export const INSUMO_CATEGORIA_MAX = 40;
export const INSUMO_COSTO_MAX = 99_999_999;
export const CANTIDAD_MAX = 999_999;
export const MOVIMIENTO_NOTA_MAX = 200;
export const MOVIMIENTO_PROVEEDOR_MAX = 80;
export const COSTO_TOTAL_MAX = 99_999_999;

export interface Insumo {
  id: string;
  nombre: string;
  categoria: string | null;
  unidad: Unidad;
  stock: number;
  stockMinimo: number;
  /** Pesos por unidad. null = sin costo cargado (y siempre null para el empleado). */
  costoUnitario: number | null;
  activo: boolean;
  /** stockMinimo > 0 && stock <= stockMinimo. */
  bajoStock: boolean;
  /** round(stock x costoUnitario); null si no hay costo (y siempre null para el empleado). */
  valorEnStock: number | null;
  updatedAt: string;
}

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  /** Con signo: compra +, uso -, ajuste +/-, devolucion +. */
  cantidad: number;
  /** null si no tiene (y siempre null para el empleado). */
  costoTotal: number | null;
  proveedor: string | null;
  nota: string | null;
  persona: { id: string; nombre: string } | null;
  turnoId: string | null;
  /** true = lo generó la receta de un lavado (origen = receta): su descuento o su devolución. */
  automatico: boolean;
  createdAt: string;
}

export type FiltroActivo = 'true' | 'false' | 'todos';

export interface FiltroInsumos {
  /** Texto buscado en nombre y categoría (los comodines los escapa el repositorio). */
  q?: string;
  /** true = solo los de stock bajo. */
  bajoStock?: boolean;
  activo: FiltroActivo;
  limit: number;
  offset: number;
}

export interface ListaInsumos {
  insumos: Insumo[];
  /** Cantidad de insumos del filtro completo. */
  total: number;
  /** Insumos activos con stock bajo en TODO el inventario (no solo en el filtro ni en la página). */
  bajoStock: number;
  /** Suma de valorEnStock de los insumos activos de todo el inventario; null para el empleado. */
  valorTotal: number | null;
}

export interface ListaMovimientos {
  movimientos: Movimiento[];
  total: number;
}

export interface NuevoInsumo {
  nombre: string;
  categoria: string | null;
  unidad: Unidad;
  stockInicial: number;
  stockMinimo: number;
  costoUnitario: number | null;
}

/** Cambios de un PATCH: undefined = no se toca; null (donde se permite) = vaciar. */
export interface CambiosInsumo {
  nombre?: string;
  categoria?: string | null;
  unidad?: Unidad;
  stockMinimo?: number;
  costoUnitario?: number | null;
  activo?: boolean;
}

/** Lo que se pide registrar, ya validado en su formato. */
export type PedidoMovimiento =
  | { tipo: 'uso'; cantidad: number; nota: string | null; turnoId: string | null }
  | { tipo: 'compra'; cantidad: number; costoTotal: number | null; proveedor: string | null; nota: string | null }
  | { tipo: 'ajuste'; stockReal: number; nota: string | null };

export interface ResultadoMovimiento {
  insumo: Insumo;
  /** null si un ajuste no cambió nada (el stock ya era el real). */
  movimiento: Movimiento | null;
  /** El insumo si este movimiento lo hizo cruzar su mínimo (hay que avisar después del COMMIT); si no, null. */
  aviso: InsumoBajo | null;
}

/**
 * Un insumo que acaba de cruzar su stock mínimo (de stock > mínimo a stock <= mínimo, con mínimo > 0). Ya quedó
 * marcado con aviso_bajo_at: el push sale después del COMMIT (regla 6).
 */
export interface InsumoBajo {
  id: string;
  nombre: string;
  unidad: Unidad;
  stock: number;
  stockMinimo: number;
}

/** GET /api/admin/insumos/alertas: los insumos activos con stock bajo, los más lejos del mínimo primero. */
export interface AlertasDeStock {
  bajoStock: number;
  insumos: InsumoBajo[];
}

/** Un renglón de "Para comprar" (regla 8). */
export interface ItemParaComprar {
  insumoId: string;
  nombre: string;
  categoria: string | null;
  unidad: Unidad;
  stock: number;
  stockMinimo: number;
  /** max(2 x mínimo - stock, 0): entero para unidad, par y caja; 2 decimales para el resto. */
  sugerido: number;
  /** round(sugerido x costo_unitario), o null sin costo cargado. */
  costoEstimado: number | null;
}

export interface ParaComprar {
  items: ItemParaComprar[];
  /** Suma de los costoEstimado que no son null (0 si no hay ninguno). */
  costoTotalEstimado: number;
}

/** Cómo se agrupa la serie de lavados del consumo: día hasta 62 días, semana (clave del lunes) hasta 200, mes. */
export type AgrupadoConsumo = 'dia' | 'semana' | 'mes';
export const MAX_DIAS_CONSUMO_POR_DIA = 62;
export const MAX_DIAS_CONSUMO_POR_SEMANA = 200;

export interface ConsumoDeInsumo {
  insumoId: string;
  nombre: string;
  unidad: Unidad;
  /** Usos (en positivo) menos devoluciones, por la fecha del movimiento en La Rioja. Siempre > 0. */
  consumido: number;
  /** round(consumido x costo_unitario de hoy), o null sin costo cargado. */
  costo: number | null;
}

/** Lo que calcula la base para GET /api/admin/consumo. */
export interface DatosDeConsumo {
  /** Lavados de mostrador completados del rango. */
  total: number;
  /** Con ceros donde no hubo lavados. Clave YYYY-MM-DD (día o lunes de la semana) o YYYY-MM (mes). */
  serie: { clave: string; cantidad: number }[];
  porInsumo: ConsumoDeInsumo[];
  /** Suma de los costos que no son null. */
  costoInsumos: number;
}

/** Quién registra y cuándo, para el movimiento y el gasto de una compra. */
export interface ContextoMovimiento {
  perfilId: string;
  /** Hoy en La Rioja (YYYY-MM-DD): la fecha del gasto de una compra. */
  hoy: string;
  ahora: Date;
}

/** El uso supera el stock: `disponible` es lo que queda. */
export class StockInsuficienteError extends Error {
  constructor(
    readonly disponible: number,
    readonly unidad: Unidad,
  ) {
    super('No alcanza el stock.');
    this.name = 'StockInsuficienteError';
  }
}

/** Tope del stock de un insumo (el CHECK de la tabla insumos). */
export const STOCK_MAX = 9_999_999.99;

/** La compra dejaría el stock por encima del tope. */
export class StockExcedidoError extends Error {
  constructor() {
    super('El stock supera el máximo.');
    this.name = 'StockExcedidoError';
  }
}

/** Ya hay un insumo activo con ese nombre (sin distinguir mayúsculas). */
export class NombreDeInsumoRepetidoError extends Error {
  constructor() {
    super('Ya hay un insumo activo con ese nombre.');
    this.name = 'NombreDeInsumoRepetidoError';
  }
}

/** El turno que se quiere vincular al uso no existe. */
export class TurnoInexistenteError extends Error {
  constructor() {
    super('El turno no existe.');
    this.name = 'TurnoInexistenteError';
  }
}

export interface InventarioRepository {
  listar(filtro: FiltroInsumos): Promise<ListaInsumos>;
  /** null si no existe. */
  obtener(id: string): Promise<Insumo | null>;
  /** Lanza NombreDeInsumoRepetidoError. Un stock inicial > 0 deja un ajuste "Stock inicial". */
  crear(nuevo: NuevoInsumo, contexto: ContextoMovimiento): Promise<Insumo>;
  /** null si no existe. Lanza NombreDeInsumoRepetidoError. */
  actualizar(id: string, cambios: CambiosInsumo, ahora: Date): Promise<Insumo | null>;
  /** null si el insumo no existe. */
  listarMovimientos(id: string, limit: number, offset: number): Promise<ListaMovimientos | null>;
  /**
   * Registra el movimiento y cambia el stock en UNA transacción, con un bloqueo por insumo. Una compra con costo
   * crea además su gasto. null si el insumo no existe. Lanza StockInsuficienteError y TurnoInexistenteError.
   */
  registrarMovimiento(
    id: string,
    pedido: PedidoMovimiento,
    contexto: ContextoMovimiento,
  ): Promise<ResultadoMovimiento | null>;
  /** Insumos activos con stock bajo, ordenados por stock / mínimo ascendente. */
  alertas(): Promise<AlertasDeStock>;
  /** Los insumos activos con stock bajo y su cantidad sugerida, por categoría y nombre. */
  paraComprar(): Promise<ParaComprar>;
  /** Lavados y consumo de insumos entre `desde` y `hasta` (YYYY-MM-DD de La Rioja, inclusive). */
  consumo(desde: string, hasta: string, agrupado: AgrupadoConsumo): Promise<DatosDeConsumo>;
}

/* ----------------------------------------------------------------------------------- reglas puras */

/** stockMinimo > 0 && stock <= stockMinimo. */
export function estaBajoStock(stock: number, stockMinimo: number): boolean {
  return stockMinimo > 0 && stock <= stockMinimo;
}

/** Redondea a 2 decimales (las cantidades del inventario tienen a lo sumo 2). */
export function redondear2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** 4,5 / 1.250 (formato es-AR). */
export function formatearCantidad(valor: number): string {
  return formatearNumero(valor, 2);
}

const PLURALES: Readonly<Record<Unidad, string>> = {
  unidad: 'unidades',
  litro: 'litros',
  ml: 'ml',
  kg: 'kg',
  g: 'g',
  par: 'pares',
  caja: 'cajas',
};

/** "litro" / "litros" según la cantidad (1 es singular). */
export function nombreDeUnidad(unidad: Unidad, cantidad: number): string {
  return cantidad === 1 ? unidad : PLURALES[unidad];
}

/** "Solo quedan 0,3 litros." / "Solo queda 1 litro." / "No queda stock de este insumo." */
export function mensajeStockInsuficiente(disponible: number, unidad: Unidad): string {
  if (disponible <= 0) return 'No queda stock de este insumo.';
  const verbo = disponible === 1 ? 'queda' : 'quedan';
  return `Solo ${verbo} ${formatearCantidad(disponible)} ${nombreDeUnidad(unidad, disponible)}.`;
}

/** "litro" si 0 < cantidad <= 1, "litros" si no: "Hay 0,5 litro (mínimo 1 litro)" (texto del aviso, regla 7). */
function unidadDelAviso(unidad: Unidad, cantidad: number): string {
  return cantidad > 0 && cantidad <= 1 ? unidad : PLURALES[unidad];
}

/** Lo que dice el push de stock bajo (regla 7), sin plata ni datos de personas. */
export interface TextoAvisoStock {
  titulo: string;
  cuerpo: string;
  url: string;
}

/** URL del panel a la que lleva el aviso: la lista para comprar. */
export const URL_PARA_COMPRAR = '/insumos?ver=comprar';

/**
 * El texto del aviso de stock bajo. Uno: "Queda poco: Shampoo" / "Hay 0,5 litro (mínimo 1 litro). Mirá la lista para
 * comprar.". Varios en el mismo pedido: un solo aviso, "Quedan poco 3 insumos", con los nombres en el cuerpo.
 */
export function textoAvisoStock(insumos: readonly InsumoBajo[]): TextoAvisoStock {
  const [unico] = insumos;
  if (insumos.length === 1 && unico !== undefined) {
    const hay = `${formatearCantidad(unico.stock)} ${unidadDelAviso(unico.unidad, unico.stock)}`;
    const minimo = `${formatearCantidad(unico.stockMinimo)} ${unidadDelAviso(unico.unidad, unico.stockMinimo)}`;
    return {
      titulo: `Queda poco: ${unico.nombre}`,
      cuerpo: `Hay ${hay} (mínimo ${minimo}). Mirá la lista para comprar.`,
      url: URL_PARA_COMPRAR,
    };
  }
  const nombres = insumos.slice(0, 3).map((insumo) => insumo.nombre);
  const resto = insumos.length - nombres.length;
  const lista =
    resto > 0
      ? `${nombres.join(', ')} y ${String(resto)} más`
      : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1) ?? ''}`;
  return {
    titulo: `Quedan poco ${String(insumos.length)} insumos`,
    cuerpo: `${lista}. Mirá la lista para comprar.`,
    url: URL_PARA_COMPRAR,
  };
}

/** La serie del consumo según el largo del rango (días contados inclusive). */
export function agrupadoDeConsumo(dias: number): AgrupadoConsumo {
  if (dias <= MAX_DIAS_CONSUMO_POR_DIA) return 'dia';
  return dias <= MAX_DIAS_CONSUMO_POR_SEMANA ? 'semana' : 'mes';
}

/* ----------------------------------------------------------------------------------- vistas por rol */

/** El insumo tal como lo ve ese rol: el empleado nunca recibe costos ni valores en pesos. */
export function vistaDeInsumo(rol: Rol, insumo: Insumo): Insumo {
  return puedeVerCostosInventario(rol) ? insumo : { ...insumo, costoUnitario: null, valorEnStock: null };
}

/**
 * El movimiento tal como lo ve ese rol: el empleado nunca recibe el costo ni el proveedor, y de las personas solo
 * se ve a sí mismo (no el nombre ni el email de los demás).
 */
export function vistaDeMovimiento(rol: Rol, movimiento: Movimiento, perfilId: string): Movimiento {
  if (puedeVerCostosInventario(rol)) return movimiento;
  const propio = movimiento.persona !== null && movimiento.persona.id === perfilId;
  return { ...movimiento, costoTotal: null, proveedor: null, persona: propio ? movimiento.persona : null };
}

/** La lista tal como la ve ese rol (también `valorTotal`). */
export function vistaDeListaDeInsumos(rol: Rol, lista: ListaInsumos): ListaInsumos {
  if (puedeVerCostosInventario(rol)) return lista;
  return {
    insumos: lista.insumos.map((insumo) => vistaDeInsumo(rol, insumo)),
    total: lista.total,
    bajoStock: lista.bajoStock,
    valorTotal: null,
  };
}
