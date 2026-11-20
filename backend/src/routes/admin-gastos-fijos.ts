import { Router } from 'express';
import { puedeEditarGastosFijos, puedeVerGastosFijos } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';
import { actualizarGastoFijoSchema, crearGastoFijoSchema, gastoFijoIdSchema } from '../schemas/gastos-fijos.js';
import { GASTO_FIJO_NOT_FOUND, type GastoFijoService } from '../services/gastos-fijos.js';

const SIN_VER_MESSAGE = 'Con tu rol no podés ver los gastos fijos.';
const SIN_EDITAR_MESSAGE = 'Solo el superadmin puede cargar o cambiar gastos fijos.';

function parseId(value: unknown): string {
  const parsed = gastoFijoIdSchema.safeParse(value);
  if (!parsed.success) throw AppError.notFound(GASTO_FIJO_NOT_FOUND);
  return parsed.data.toLowerCase();
}

/**
 * Gastos fijos mensuales (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 10). Detrás de requireSession.
 * Ver: admin y superadmin (el empleado, 403 en todo). Cargar, cambiar y borrar: solo el superadmin.
 *  - GET    /api/admin/gastos-fijos => { gastosFijos, totalMensual }
 *  - POST   /api/admin/gastos-fijos => 201 { gastoFijo }
 *  - PATCH  /api/admin/gastos-fijos/:id => { gastoFijo }
 *  - DELETE /api/admin/gastos-fijos/:id => 204
 */
export function adminGastosFijosRouter(deps: { gastosFijos: GastoFijoService }): Router {
  const { gastosFijos } = deps;
  const router = Router();
  const editar = requirePermiso(puedeEditarGastosFijos, SIN_EDITAR_MESSAGE);

  router.use(requirePermiso(puedeVerGastosFijos, SIN_VER_MESSAGE));

  router.get('/', async (_req, res) => {
    res.json(await gastosFijos.listar());
  });

  router.post('/', editar, async (req, res) => {
    const datos = parseOrThrow(crearGastoFijoSchema, req.body ?? {});
    res.status(201).json({ gastoFijo: await gastosFijos.crear(getUsuario(res), datos) });
  });

  router.patch('/:id', editar, async (req, res) => {
    const id = parseId(req.params.id);
    const cambios = parseOrThrow(actualizarGastoFijoSchema, req.body ?? {});
    res.json({ gastoFijo: await gastosFijos.actualizar(getUsuario(res), id, cambios) });
  });

  router.delete('/:id', editar, async (req, res) => {
    await gastosFijos.borrar(getUsuario(res), parseId(req.params.id));
    res.status(204).end();
  });

  return router;
}
