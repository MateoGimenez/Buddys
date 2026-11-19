import { type RequestHandler, Router } from 'express';
import { AppError } from '../lib/errors.js';
import { getUsuario } from '../middleware/require-session.js';
import { bookingIdSchema } from '../schemas/admin.js';
import { parseOrThrow } from '../schemas/common.js';
import { subirFotoSchema } from '../schemas/fotos.js';
import { NOT_FOUND_MESSAGE } from '../services/agenda.js';
import { FOTO_NOT_FOUND, type FotoService } from '../services/fotos.js';

/** Un id con formato inválido no puede existir: 404, igual que uno inexistente. */
function parseId(raw: string | undefined, mensaje: string): string {
  const parsed = bookingIdSchema.safeParse(raw);
  if (!parsed.success) throw AppError.notFound(mensaje);
  return parsed.data.toLowerCase();
}

/**
 * Fotos antes/después de un lavado o turno (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 13). Se
 * monta en /api/admin/lavados/:id/fotos (mergeParams), detrás de requireSession. Los permisos los aplica FotoService.
 *  - POST   /api/admin/lavados/:id/fotos { tipo, contentType, tamano } => 201 { foto, subida } (rate limit por usuario)
 *  - POST   /api/admin/lavados/:id/fotos/:fotoId/confirmar => { foto } (después del PUT a subida.url)
 *  - GET    /api/admin/lavados/:id/fotos => { disponible, fotos }
 *  - DELETE /api/admin/lavados/:id/fotos/:fotoId => 204
 */
export function adminFotosRouter(deps: { fotos: FotoService; limiter: RequestHandler }): Router {
  const { fotos, limiter } = deps;
  const router = Router({ mergeParams: true });

  router.post('/', limiter, async (req, res) => {
    const bookingId = parseId((req.params as { id?: string }).id, NOT_FOUND_MESSAGE);
    const datos = parseOrThrow(subirFotoSchema, req.body ?? {});
    res.status(201).json(await fotos.subir(getUsuario(res), bookingId, datos));
  });

  router.get('/', async (req, res) => {
    const bookingId = parseId((req.params as { id?: string }).id, NOT_FOUND_MESSAGE);
    res.json(await fotos.listar(getUsuario(res), bookingId));
  });

  router.post('/:fotoId/confirmar', async (req, res) => {
    const params = req.params as { id?: string; fotoId?: string };
    const bookingId = parseId(params.id, NOT_FOUND_MESSAGE);
    res.json(await fotos.confirmar(getUsuario(res), bookingId, parseId(params.fotoId, FOTO_NOT_FOUND)));
  });

  router.delete('/:fotoId', async (req, res) => {
    const params = req.params as { id?: string; fotoId?: string };
    const bookingId = parseId(params.id, NOT_FOUND_MESSAGE);
    await fotos.borrar(getUsuario(res), bookingId, parseId(params.fotoId, FOTO_NOT_FOUND));
    res.status(204).end();
  });

  return router;
}
