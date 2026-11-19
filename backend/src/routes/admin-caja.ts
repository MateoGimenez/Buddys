import { Router } from 'express';
import { puedeCerrarCaja, puedeReabrirCaja } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { cajaQuerySchema, cerrarCajaSchema, cierresQuerySchema, fechaCajaSchema } from '../schemas/caja.js';
import { parseOrThrow } from '../schemas/common.js';
import { CAJA_CERRADA_MESSAGE, CIERRE_NOT_FOUND, type CajaService } from '../services/caja.js';

const SIN_PERMISO_MESSAGE = 'Con tu rol no podés ver ni cerrar la caja.';

/**
 * Cierre de caja con arqueo (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 11). Detrás de
 * requireSession. Todo es plata: el empleado recibe 403 en todo, antes de validar.
 *  - GET    /api/admin/caja?fecha= => { fecha, esperado, cierre }
 *  - GET    /api/admin/caja/cierres?desde=&hasta=&limit=&offset= => { cierres, total }
 *  - PUT    /api/admin/caja/:fecha { contado, nota? } => 201 / 200 { cierre } (corregir: solo superadmin)
 *  - DELETE /api/admin/caja/:fecha => 204 (reabrir: solo superadmin)
 */
export function adminCajaRouter(deps: { caja: CajaService }): Router {
  const { caja } = deps;
  const router = Router();

  router.use(requirePermiso(puedeCerrarCaja, SIN_PERMISO_MESSAGE));

  router.get('/', async (req, res) => {
    const { fecha } = parseOrThrow(cajaQuerySchema, req.query);
    res.json(await caja.delDia(fecha));
  });

  router.get('/cierres', async (req, res) => {
    res.json(await caja.listar(parseOrThrow(cierresQuerySchema, req.query)));
  });

  router.put('/:fecha', async (req, res) => {
    const fecha = parseOrThrow(fechaCajaSchema, req.params.fecha);
    const datos = parseOrThrow(cerrarCajaSchema, req.body ?? {});
    const { cierre, creado } = await caja.cerrar(getUsuario(res), fecha, datos);
    res.status(creado ? 201 : 200).json({ cierre });
  });

  router.delete('/:fecha', requirePermiso(puedeReabrirCaja, CAJA_CERRADA_MESSAGE), async (req, res) => {
    const parsed = fechaCajaSchema.safeParse(req.params.fecha);
    if (!parsed.success) throw AppError.notFound(CIERRE_NOT_FOUND);
    await caja.reabrir(getUsuario(res), parsed.data);
    res.status(204).end();
  });

  return router;
}
