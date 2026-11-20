import { Router } from 'express';
import { puedeCrearTurnos } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import { getUsuario } from '../middleware/require-session.js';
import { bookingIdSchema } from '../schemas/admin.js';
import { parseOrThrow } from '../schemas/common.js';
import { crearTurnoSchema, senaSchema } from '../schemas/turnos.js';
import { NOT_FOUND_MESSAGE } from '../services/agenda.js';
import {
  SIN_PERMISO_SENA_MESSAGE,
  SIN_PERMISO_TURNOS_MESSAGE,
  type TurnoPanelService,
  rangosTurnoPanel,
} from '../services/turnos.js';

/** Un id con formato inválido no puede existir: 404, igual que uno inexistente. */
function parseId(raw: string): string {
  const parsed = bookingIdSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(NOT_FOUND_MESSAGE);
  return parsed.data.toLowerCase();
}

/**
 * Turnos con seña creados desde el panel (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 8). Detrás de
 * requireSession. Permiso turnos.crear (admin y superadmin): el empleado recibe 403 antes de validar el body.
 *  - POST   /api/admin/turnos { nombre, telefono, email?, vehiculoTipo, vehiculoModelo?, servicioIds, fecha, franja,
 *           comentario?, notasInternas?, sena? } => 201 { turno }
 *  - PUT    /api/admin/turnos/:id/sena { monto, formaPago, fecha? } => { turno }
 *  - DELETE /api/admin/turnos/:id/sena => 204
 * Ver, reprogramar, completar y borrar: como cualquier turno (/api/admin/bookings, /api/admin/agenda).
 */
export function adminTurnosRouter(deps: { turnos: TurnoPanelService; now: () => Date }): Router {
  const { turnos, now } = deps;
  const router = Router();

  router.post('/', async (req, res) => {
    const usuario = getUsuario(res);
    if (!puedeCrearTurnos(usuario.rol)) throw AppError.forbidden(SIN_PERMISO_TURNOS_MESSAGE);
    const rangos = rangosTurnoPanel(now());
    const datos = parseOrThrow(crearTurnoSchema(rangos.turno, rangos.sena), req.body ?? {});
    res.status(201).json({ turno: await turnos.crear(usuario, datos) });
  });

  router.put('/:id/sena', async (req, res) => {
    const usuario = getUsuario(res);
    if (!puedeCrearTurnos(usuario.rol)) throw AppError.forbidden(SIN_PERMISO_SENA_MESSAGE);
    const id = parseId(req.params.id);
    const sena = parseOrThrow(senaSchema(rangosTurnoPanel(now()).sena), req.body ?? {});
    res.json({ turno: await turnos.cambiarSena(usuario, id, sena) });
  });

  router.delete('/:id/sena', async (req, res) => {
    const usuario = getUsuario(res);
    if (!puedeCrearTurnos(usuario.rol)) throw AppError.forbidden(SIN_PERMISO_SENA_MESSAGE);
    await turnos.cambiarSena(usuario, parseId(req.params.id), null);
    res.status(204).end();
  });

  return router;
}
