import { Router } from 'express';
import { puedeConfigurarFidelizacion, puedeVerInactivos } from '../domain/permisos.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { fidelizacionSchema, historialClienteQuerySchema, inactivosQuerySchema } from '../schemas/clientes.js';
import { parseOrThrow } from '../schemas/common.js';
import {
  type ClienteService,
  SIN_PERMISO_FIDELIZACION_MESSAGE,
  SIN_PERMISO_INACTIVOS_MESSAGE,
} from '../services/clientes.js';

/**
 * Clientes (contrato: reportes/2026-11-15_03_contrato-mejoras.md, funciones 6 y 14). Detrás de requireSession.
 *  - GET /api/admin/clientes/historial?telefono=|patente= => { cliente, lavados, total } (todos los roles)
 *  - GET /api/admin/clientes/inactivos?dias=&limit=&offset= => { dias, clientes, total } (admin y superadmin)
 */
export function adminClientesRouter(deps: { clientes: ClienteService }): Router {
  const { clientes } = deps;
  const router = Router();

  router.get('/historial', async (req, res) => {
    const clave = parseOrThrow(historialClienteQuerySchema, req.query);
    res.json(await clientes.historial(getUsuario(res), clave));
  });

  router.get('/inactivos', requirePermiso(puedeVerInactivos, SIN_PERMISO_INACTIVOS_MESSAGE), async (req, res) => {
    const pedido = parseOrThrow(inactivosQuerySchema, req.query);
    res.json(await clientes.inactivos(getUsuario(res), pedido));
  });

  return router;
}

/**
 * Tarjeta de sellos (función 14). Detrás de requireSession.
 *  - GET /api/admin/fidelizacion => { config } (todos los roles)
 *  - PUT /api/admin/fidelizacion { sellosCada, premio, premioPorcentaje?, inactivosDias } => { config } (superadmin)
 */
export function adminFidelizacionRouter(deps: { clientes: ClienteService }): Router {
  const { clientes } = deps;
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json({ config: await clientes.fidelizacion() });
  });

  router.put('/', requirePermiso(puedeConfigurarFidelizacion, SIN_PERMISO_FIDELIZACION_MESSAGE), async (req, res) => {
    const cambios = parseOrThrow(fidelizacionSchema, req.body ?? {});
    res.json({ config: await clientes.guardarFidelizacion(getUsuario(res), cambios) });
  });

  return router;
}
