import { Router } from 'express';
import { puedeDefinirRecetas, puedeVerInventario } from '../domain/permisos.js';
import type { Receta } from '../domain/recetas.js';
import { AppError } from '../lib/errors.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';
import { varianteRecetaSchema } from '../schemas/recetas.js';
import { servicioIdSchema } from '../schemas/servicios.js';
import { type RecetaService, SERVICIO_NOT_FOUND } from '../services/recetas.js';

const SIN_VER_MESSAGE = 'Con tu rol no podés ver el inventario.';
const SIN_DEFINIR_MESSAGE = 'Con tu rol podés ver las recetas, pero no cambiarlas.';

/** Las claves exactas del contrato. Las recetas no llevan costos: todos los roles reciben lo mismo. */
function recetaJson(receta: Receta) {
  return { servicioId: receta.servicioId, general: receta.general, porVehiculo: receta.porVehiculo };
}

/**
 * Recetas (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md). Se monta en /api/admin, detrás de requireSession.
 *  - GET /api/admin/recetas => { recetas }: todos los roles (inventario.ver), sin costos.
 *  - PUT /api/admin/servicios/:id/receta { vehiculo, items } => { receta }: admin y superadmin (inventario.recetas;
 *    403 antes de validar). Reemplaza esa variante; items: [] la borra.
 */
export function adminRecetasRouter(deps: { recetas: RecetaService }): Router {
  const { recetas } = deps;
  const router = Router();

  router.get('/recetas', requirePermiso(puedeVerInventario, SIN_VER_MESSAGE), async (_req, res) => {
    res.json({ recetas: (await recetas.listar()).map(recetaJson) });
  });

  router.put('/servicios/:id/receta', requirePermiso(puedeDefinirRecetas, SIN_DEFINIR_MESSAGE), async (req, res) => {
    // Un id con formato inválido no puede existir: 404, igual que uno inexistente.
    const parsed = servicioIdSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound(SERVICIO_NOT_FOUND);
    const variante = parseOrThrow(varianteRecetaSchema, req.body ?? {});
    res.json({ receta: recetaJson(await recetas.reemplazar(getUsuario(res), parsed.data, variante)) });
  });

  return router;
}
