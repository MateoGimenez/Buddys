import { Router } from 'express';
import {
  type Insumo,
  type Movimiento,
  vistaDeInsumo,
  vistaDeListaDeInsumos,
  vistaDeMovimiento,
} from '../domain/inventario.js';
import {
  puedeGestionarInventario,
  puedeRegistrarUsoInsumos,
  puedeVerConsumoInventario,
  puedeVerInventario,
} from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { estadisticasQuerySchema } from '../schemas/admin.js';
import { parseOrThrow } from '../schemas/common.js';
import {
  actualizarInsumoSchema,
  crearInsumoSchema,
  insumoIdSchema,
  listarInsumosQuerySchema,
  listarMovimientosQuerySchema,
  movimientoSchema,
} from '../schemas/inventario.js';
import { INSUMO_NOT_FOUND, type InventarioService } from '../services/inventario.js';

const SIN_VER_MESSAGE = 'Con tu rol no podés ver el inventario.';
const SIN_GESTIONAR_MESSAGE = 'Con tu rol no podés crear ni editar insumos.';
const SIN_COMPRAS_MESSAGE = 'Con tu rol solo podés registrar el uso de los insumos, no compras ni ajustes.';
const SIN_CONSUMO_MESSAGE = 'Con tu rol no podés ver el consumo, la lista para comprar ni los avisos de stock bajo.';
export const DEVOLUCION_MANUAL_MESSAGE =
  'Las devoluciones las registra el sistema al deshacer o corregir un lavado: no se cargan a mano.';

/** Las claves exactas del contrato. El costo y el valor ya vienen en null para el empleado (vistaDeInsumo). */
function insumoJson(insumo: Insumo) {
  return {
    id: insumo.id,
    nombre: insumo.nombre,
    categoria: insumo.categoria,
    unidad: insumo.unidad,
    stock: insumo.stock,
    stockMinimo: insumo.stockMinimo,
    costoUnitario: insumo.costoUnitario,
    activo: insumo.activo,
    bajoStock: insumo.bajoStock,
    valorEnStock: insumo.valorEnStock,
    updatedAt: insumo.updatedAt,
  };
}

function movimientoJson(movimiento: Movimiento) {
  return {
    id: movimiento.id,
    tipo: movimiento.tipo,
    cantidad: movimiento.cantidad,
    costoTotal: movimiento.costoTotal,
    proveedor: movimiento.proveedor,
    nota: movimiento.nota,
    persona: movimiento.persona,
    turnoId: movimiento.turnoId,
    createdAt: movimiento.createdAt,
  };
}

/** Un id con formato inválido no puede existir: se trata igual que uno inexistente (404). */
function parseId(value: unknown): string {
  const parsed = insumoIdSchema.safeParse(value);
  if (!parsed.success) throw AppError.notFound(INSUMO_NOT_FOUND);
  return parsed.data.toLowerCase();
}

/**
 * Inventario (contrato: reportes/2026-10-27_17_finanzas-inventario-documentos.md). Detrás de requireSession.
 *  - ver (listar insumos y movimientos) y registrar el uso: todos los roles;
 *  - crear y editar insumos, compras y ajustes: solo admin y superadmin (403 antes de validar).
 * El empleado NUNCA recibe costos ni valores en pesos: toda respuesta pasa por las vistas de domain/inventario.ts.
 */
export function adminInsumosRouter(deps: { inventario: InventarioService }): Router {
  const { inventario } = deps;
  const router = Router();

  // GET /api/admin/insumos?q=&bajoStock=true&activo=&limit=&offset= => { insumos, total, bajoStock, valorTotal }
  router.get('/', requirePermiso(puedeVerInventario, SIN_VER_MESSAGE), async (req, res) => {
    const query = parseOrThrow(listarInsumosQuerySchema, req.query);
    const lista = await inventario.listar({
      ...(query.q !== undefined && { q: query.q }),
      ...(query.bajoStock !== undefined && { bajoStock: query.bajoStock }),
      activo: query.activo,
      limit: query.limit,
      offset: query.offset,
    });
    const vista = vistaDeListaDeInsumos(getUsuario(res).rol, lista);
    res.json({ insumos: vista.insumos.map(insumoJson), total: vista.total, bajoStock: vista.bajoStock, valorTotal: vista.valorTotal });
  });

  // GET /api/admin/insumos/alertas => { bajoStock, insumos }: la campanita. Solo admin y superadmin.
  router.get('/alertas', requirePermiso(puedeVerConsumoInventario, SIN_CONSUMO_MESSAGE), async (_req, res) => {
    const { bajoStock, insumos } = await inventario.alertas();
    res.json({
      bajoStock,
      insumos: insumos.map((i) => ({ id: i.id, nombre: i.nombre, unidad: i.unidad, stock: i.stock, stockMinimo: i.stockMinimo })),
    });
  });

  // GET /api/admin/insumos/para-comprar => { items, costoTotalEstimado }. Solo admin y superadmin.
  router.get('/para-comprar', requirePermiso(puedeVerConsumoInventario, SIN_CONSUMO_MESSAGE), async (_req, res) => {
    const { items, costoTotalEstimado } = await inventario.paraComprar();
    res.json({
      items: items.map((item) => ({
        insumoId: item.insumoId,
        nombre: item.nombre,
        categoria: item.categoria,
        unidad: item.unidad,
        stock: item.stock,
        stockMinimo: item.stockMinimo,
        sugerido: item.sugerido,
        costoEstimado: item.costoEstimado,
      })),
      costoTotalEstimado,
    });
  });

  // POST /api/admin/insumos { nombre, categoria?, unidad, stockInicial?, stockMinimo?, costoUnitario? } => 201 { insumo }
  router.post('/', requirePermiso(puedeGestionarInventario, SIN_GESTIONAR_MESSAGE), async (req, res) => {
    const datos = parseOrThrow(crearInsumoSchema, req.body ?? {});
    const usuario = getUsuario(res);
    res.status(201).json({ insumo: insumoJson(vistaDeInsumo(usuario.rol, await inventario.crear(usuario, datos))) });
  });

  // PATCH /api/admin/insumos/:id => { insumo }. 404 si no existe; 409 si el nombre ya lo tiene otro insumo activo.
  router.patch('/:id', requirePermiso(puedeGestionarInventario, SIN_GESTIONAR_MESSAGE), async (req, res) => {
    const id = parseId(req.params.id);
    const cambios = parseOrThrow(actualizarInsumoSchema, req.body ?? {});
    if (Object.keys(cambios).length === 0) {
      throw AppError.validation(
        undefined,
        'Indicá al menos un cambio: nombre, categoría, unidad, stock mínimo, costo unitario o activo.',
      );
    }
    const usuario = getUsuario(res);
    res.json({ insumo: insumoJson(vistaDeInsumo(usuario.rol, await inventario.actualizar(usuario, id, cambios))) });
  });

  // GET /api/admin/insumos/:id/movimientos?limit=&offset= => { movimientos, total }
  router.get('/:id/movimientos', requirePermiso(puedeVerInventario, SIN_VER_MESSAGE), async (req, res) => {
    const id = parseId(req.params.id);
    const { limit, offset } = parseOrThrow(listarMovimientosQuerySchema, req.query);
    const lista = await inventario.listarMovimientos(id, limit, offset);
    const { rol, id: perfilId } = getUsuario(res);
    res.json({
      movimientos: lista.movimientos.map((m) => movimientoJson(vistaDeMovimiento(rol, m, perfilId))),
      total: lista.total,
    });
  });

  // POST /api/admin/insumos/:id/movimientos => 201 { insumo, movimiento } (200 { insumo } si un ajuste no cambia nada)
  //  uso:    todos los roles. compra y ajuste: solo admin y superadmin.
  router.post('/:id/movimientos', async (req, res) => {
    const usuario = getUsuario(res);
    const body: unknown = req.body ?? {};
    const tipo = typeof body === 'object' && body !== null && 'tipo' in body ? body.tipo : undefined;
    if (tipo === 'uso') {
      if (!puedeRegistrarUsoInsumos(usuario.rol)) throw AppError.forbidden(SIN_COMPRAS_MESSAGE);
    } else if (!puedeGestionarInventario(usuario.rol)) {
      throw AppError.forbidden(SIN_COMPRAS_MESSAGE);
    }
    const id = parseId(req.params.id);
    // Las devoluciones solo las crea el sistema (deshacer o corregir un lavado): a mano, 400.
    if (tipo === 'devolucion') throw AppError.validation({ tipo: DEVOLUCION_MANUAL_MESSAGE });
    const pedido = parseOrThrow(movimientoSchema, body);
    const resultado = await inventario.registrarMovimiento(usuario, id, pedido);
    const insumo = insumoJson(vistaDeInsumo(usuario.rol, resultado.insumo));
    if (resultado.movimiento === null) {
      res.json({ insumo });
      return;
    }
    res.status(201).json({ insumo, movimiento: movimientoJson(vistaDeMovimiento(usuario.rol, resultado.movimiento, usuario.id)) });
  });

  return router;
}

/**
 * GET /api/admin/consumo?desde=&hasta= (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md). Lavados, consumo
 * por insumo y costo de insumos por lavado. Solo admin y superadmin: el empleado recibe 403 antes de validar nada.
 */
export function adminConsumoRouter(deps: { inventario: InventarioService }): Router {
  const { inventario } = deps;
  const router = Router();

  router.get('/', requirePermiso(puedeVerConsumoInventario, SIN_CONSUMO_MESSAGE), async (req, res) => {
    const query = parseOrThrow(estadisticasQuerySchema, req.query);
    const consumo = await inventario.consumo({
      ...(query.desde !== undefined && { desde: query.desde }),
      ...(query.hasta !== undefined && { hasta: query.hasta }),
    });
    res.json({
      rango: consumo.rango,
      lavados: consumo.lavados,
      porInsumo: consumo.porInsumo.map((fila) => ({
        insumoId: fila.insumoId,
        nombre: fila.nombre,
        unidad: fila.unidad,
        consumido: fila.consumido,
        costo: fila.costo,
      })),
      costoInsumos: consumo.costoInsumos,
      costoPorLavado: consumo.costoPorLavado,
    });
  });

  return router;
}
