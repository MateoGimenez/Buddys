import { Router } from 'express';
import { z } from 'zod';
import { InsumoDeRecetaInvalidoError, type RecetaRepository, MAX_INSUMOS_RECETA } from '../domain/recetas.js';
import { puedeGestionarInventario, puedeVerInventario } from '../domain/permisos.js';
import { CANTIDAD_MAX, redondear2 } from '../domain/inventario.js';
import { SERVICIO_ID_MAX, SERVICIO_ID_REGEX, type ServicioRepository } from '../domain/servicios.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';

const SIN_VER_MESSAGE = 'Con tu rol no podés ver el inventario.';
const SIN_GESTIONAR_MESSAGE = 'Con tu rol no podés cambiar qué insumos usa un servicio.';
const SERVICIO_NOT_FOUND = 'No encontramos ese servicio.';
const CANTIDAD_MSG = `La cantidad tiene que ser mayor que 0 y de hasta ${String(CANTIDAD_MAX)}, con hasta 2 decimales.`;
const INSUMO_MSG = 'Elegí insumos activos del inventario.';

const cantidad = z
  .number({ error: CANTIDAD_MSG })
  .gt(0, { error: CANTIDAD_MSG })
  .max(CANTIDAD_MAX, { error: CANTIDAD_MSG })
  .refine((v) => redondear2(v) === v, { error: CANTIDAD_MSG });

/** PUT /api/admin/servicios/:id/insumos { insumos: [...] } (la receta entera; [] la vacía). Estricto. */
export const recetaSchema = z.strictObject({
  insumos: z
    .array(
      z.strictObject({
        insumoId: z.uuid({ error: INSUMO_MSG }).transform((id) => id.toLowerCase()),
        cantidad,
        cantidadSuv: cantidad.nullable().default(null),
        cantidadPickup: cantidad.nullable().default(null),
        cantidadMoto: cantidad.nullable().default(null),
      }),
      { error: 'Mandá la lista de insumos del servicio.' },
    )
    .max(MAX_INSUMOS_RECETA, { error: `Un servicio puede usar hasta ${String(MAX_INSUMOS_RECETA)} insumos.` })
    .refine((items) => new Set(items.map((i) => i.insumoId)).size === items.length, {
      error: 'No repitas un insumo en la lista.',
    }),
});

const servicioIdSchema = z.string().max(SERVICIO_ID_MAX).regex(SERVICIO_ID_REGEX);

/**
 * Receta de insumos de cada servicio (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 15). Se monta en
 * /api/admin/servicios, detrás de requireSession (las demás rutas del catálogo siguen en admin-servicios.ts).
 *  - GET /api/admin/servicios/:id/insumos => { servicioId, insumos } (quien ve el inventario: todos los roles)
 *  - PUT /api/admin/servicios/:id/insumos { insumos } => { servicioId, insumos } (inventario.gestionar)
 * Las cantidades no son plata: el empleado las ve (no hay costos acá).
 */
export function adminRecetasRouter(deps: { recetas: RecetaRepository; servicios: ServicioRepository; logger: Logger }): Router {
  const { recetas, servicios, logger } = deps;
  const router = Router();

  const servicioExistente = async (raw: unknown): Promise<string> => {
    const parsed = servicioIdSchema.safeParse(raw);
    if (!parsed.success || (await servicios.findById(parsed.data)) === undefined) throw AppError.notFound(SERVICIO_NOT_FOUND);
    return parsed.data;
  };

  router.get('/:id/insumos', requirePermiso(puedeVerInventario, SIN_VER_MESSAGE), async (req, res) => {
    const servicioId = await servicioExistente(req.params.id);
    res.json({ servicioId, insumos: await recetas.obtener(servicioId) });
  });

  router.put('/:id/insumos', requirePermiso(puedeGestionarInventario, SIN_GESTIONAR_MESSAGE), async (req, res) => {
    const servicioId = await servicioExistente(req.params.id);
    const { insumos } = parseOrThrow(recetaSchema, req.body ?? {});
    try {
      const receta = await recetas.reemplazar(servicioId, insumos);
      logger.info(`Receta de insumos guardada servicio=${servicioId} insumos=${String(receta.length)} por=${getUsuario(res).id}`);
      res.json({ servicioId, insumos: receta });
    } catch (error) {
      if (error instanceof InsumoDeRecetaInvalidoError) throw AppError.validation({ insumos: INSUMO_MSG });
      throw error;
    }
  });

  return router;
}
