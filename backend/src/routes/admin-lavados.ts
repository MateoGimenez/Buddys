import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import { getUsuario } from '../middleware/require-session.js';
import { bookingIdSchema } from '../schemas/admin.js';
import { parseOrThrow } from '../schemas/common.js';
import { lavadosQuerySchema, registrarLavadoSchema } from '../schemas/lavados.js';
import { LAVADO_NOT_FOUND, type LavadoService, rangoLavado } from '../services/lavados.js';

/**
 * "Registrar lavado" (autos que llegan sin turno). Detrás de requireSession; los permisos los aplica LavadoService.
 *  - POST /api/admin/lavados { servicioId, vehiculoTipo, monto?, formaPago?, trabajadorId?, fecha?, franja?, nombre?,
 *    telefono?, vehiculoModelo?, notasInternas?, idLocal? } => 201 { lavado, deshacerHasta } (200 si el idLocal ya
 *    estaba registrado por la misma persona; 409 si por otra)
 *  - GET  /api/admin/lavados?fecha=YYYY-MM-DD => { fecha, lavados, resumen } (sin fecha: hoy)
 *  - DELETE /api/admin/lavados/:id => 204 ("deshacer": quien lo registró, hasta 5 minutos; quien borra turnos, siempre)
 * Corregir o borrar un lavado: como cualquier turno, PATCH y DELETE /api/admin/bookings/:id.
 */
export function adminLavadosRouter(deps: { lavados: LavadoService; now: () => Date }): Router {
  const { lavados, now } = deps;
  const router = Router();

  router.post('/', async (req, res) => {
    const datos = parseOrThrow(registrarLavadoSchema(rangoLavado(now())), req.body ?? {});
    // 201 si se registró; 200 con el original si el idLocal ya estaba (reintento de la cola sin conexión).
    const { lavado, deshacerHasta, creado } = await lavados.registrar(getUsuario(res), datos);
    res.status(creado ? 201 : 200).json({ lavado, deshacerHasta });
  });

  router.get('/', async (req, res) => {
    const { fecha } = parseOrThrow(lavadosQuerySchema, req.query);
    res.json(await lavados.delDia(getUsuario(res), fecha));
  });

  router.delete('/:id', async (req, res) => {
    // Un id con formato inválido no puede existir: 404, igual que uno inexistente.
    const parsed = bookingIdSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound(LAVADO_NOT_FOUND);
    await lavados.deshacer(getUsuario(res), parsed.data.toLowerCase());
    res.status(204).end();
  });

  return router;
}
