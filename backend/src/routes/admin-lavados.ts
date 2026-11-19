import { type RequestHandler, Router } from 'express';
import { AppError } from '../lib/errors.js';
import { getUsuario } from '../middleware/require-session.js';
import { bookingIdSchema } from '../schemas/admin.js';
import { parseOrThrow } from '../schemas/common.js';
import { etapaSchema, lavadosQuerySchema, registrarLavadoSchema } from '../schemas/lavados.js';
import { LAVADO_NOT_FOUND, type LavadoService, rangoLavado } from '../services/lavados.js';

/**
 * "Registrar lavado" (autos que llegan sin turno). Detrás de requireSession; los permisos los aplica LavadoService.
 *  - POST /api/admin/lavados { servicioId, vehiculoTipo, monto?, formaPago?, trabajadorId?, fecha?, franja?, nombre?,
 *    telefono?, vehiculoModelo?, notasInternas?, idLocal? } => 201 { lavado, deshacerHasta } (200 si el idLocal ya
 *    estaba registrado por la misma persona; 409 si por otra)
 *  - GET  /api/admin/lavados?fecha=YYYY-MM-DD => { fecha, lavados, resumen } (sin fecha: hoy)
 *  - DELETE /api/admin/lavados/:id => 204 ("deshacer": quien lo registró, hasta 5 minutos; quien borra turnos, siempre)
 *  - GET /api/admin/lavados/en-curso => { fecha, lavados, resumen } (los de hoy que no se entregaron)
 *  - PATCH /api/admin/lavados/:id/etapa { etapa } => { lavado } (admin: todos; empleado: los suyos)
 * Las fotos (/api/admin/lavados/:id/fotos) van en routes/admin-fotos.ts.
 * Corregir o borrar un lavado: como cualquier turno, PATCH y DELETE /api/admin/bookings/:id.
 */
export function adminLavadosRouter(deps: {
  lavados: LavadoService;
  now: () => Date;
  /** 60 por usuario por minuto para POST y DELETE; los reintentos del mismo idLocal no cuentan. */
  limiter: RequestHandler;
}): Router {
  const { lavados, now, limiter } = deps;
  const router = Router();

  router.post('/', limiter, async (req, res) => {
    const datos = parseOrThrow(registrarLavadoSchema(rangoLavado(now())), req.body ?? {});
    // 201 si se registró; 200 con el original si el idLocal ya estaba (reintento de la cola sin conexión).
    const { lavado, deshacerHasta, creado } = await lavados.registrar(getUsuario(res), datos);
    res.status(creado ? 201 : 200).json({ lavado, deshacerHasta });
  });

  router.get('/', async (req, res) => {
    const { fecha } = parseOrThrow(lavadosQuerySchema, req.query);
    res.json(await lavados.delDia(getUsuario(res), fecha));
  });

  router.get('/en-curso', async (_req, res) => {
    res.json(await lavados.enCurso(getUsuario(res)));
  });

  router.patch('/:id/etapa', async (req, res) => {
    const parsed = bookingIdSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound(LAVADO_NOT_FOUND);
    const { etapa } = parseOrThrow(etapaSchema, req.body ?? {});
    res.json({ lavado: await lavados.cambiarEtapa(getUsuario(res), parsed.data.toLowerCase(), etapa) });
  });

  router.delete('/:id', limiter, async (req, res) => {
    // Un id con formato inválido no puede existir: 404, igual que uno inexistente.
    const parsed = bookingIdSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound(LAVADO_NOT_FOUND);
    await lavados.deshacer(getUsuario(res), parsed.data.toLowerCase());
    res.status(204).end();
  });

  return router;
}
