import { Router } from 'express';
import { getUsuario } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';
import { lavadosQuerySchema, registrarLavadoSchema } from '../schemas/lavados.js';
import { type LavadoService, rangoLavado } from '../services/lavados.js';

/**
 * "Registrar lavado" (autos que llegan sin turno). Detrás de requireSession; los permisos los aplica LavadoService.
 *  - POST /api/admin/lavados { servicioId, vehiculoTipo, monto?, trabajadorId?, fecha?, franja?, nombre?, telefono?,
 *    vehiculoModelo?, notasInternas? } => 201 { lavado }
 *  - GET  /api/admin/lavados?fecha=YYYY-MM-DD => { fecha, lavados, resumen } (sin fecha: hoy)
 * Corregir o borrar un lavado: como cualquier turno, PATCH y DELETE /api/admin/bookings/:id.
 */
export function adminLavadosRouter(deps: { lavados: LavadoService; now: () => Date }): Router {
  const { lavados, now } = deps;
  const router = Router();

  router.post('/', async (req, res) => {
    const datos = parseOrThrow(registrarLavadoSchema(rangoLavado(now())), req.body ?? {});
    const lavado = await lavados.registrar(getUsuario(res), datos);
    res.status(201).json({ lavado });
  });

  router.get('/', async (req, res) => {
    const { fecha } = parseOrThrow(lavadosQuerySchema, req.query);
    res.json(await lavados.delDia(getUsuario(res), fecha));
  });

  return router;
}
