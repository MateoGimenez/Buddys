import { type RequestHandler, Router } from 'express';
import { getUsuario } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';
import { cambiarClaveSchema, cambiarNombreSchema, pedirAvatarSchema } from '../schemas/perfil.js';
import type { PerfilService } from '../services/perfil.js';

/**
 * El perfil propio (contrato: reportes/2026-11-16_04_contrato-perfil.md). Se monta en /api/admin/perfil, detrás de
 * requireSession. Siempre es el usuario de la sesión (no hay id en la URL); los permisos los aplica PerfilService.
 *  - GET    /api/admin/perfil => { perfil }
 *  - PATCH  /api/admin/perfil { nombre } => { perfil }
 *  - POST   /api/admin/perfil/avatar { contentType, tamano } => 201 { subida } (rate limit por usuario)
 *  - POST   /api/admin/perfil/avatar/confirmar => { perfil } (después del PUT a subida.url)
 *  - DELETE /api/admin/perfil/avatar => 204
 *  - POST   /api/admin/perfil/clave { actual, nueva } => 204 (rate limit estricto por usuario)
 * Sin SUPABASE_SECRET_KEY las rutas de la foto y la de la contraseña responden 503.
 */
export function adminPerfilRouter(deps: {
  perfil: PerfilService;
  avatarLimiter: RequestHandler;
  claveLimiter: RequestHandler;
}): Router {
  const { perfil, avatarLimiter, claveLimiter } = deps;
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await perfil.obtener(getUsuario(res)));
  });

  router.patch('/', async (req, res) => {
    const { nombre } = parseOrThrow(cambiarNombreSchema, req.body ?? {});
    res.json(await perfil.cambiarNombre(getUsuario(res), nombre));
  });

  router.post('/avatar', avatarLimiter, async (req, res) => {
    const datos = parseOrThrow(pedirAvatarSchema, req.body ?? {});
    res.status(201).json(await perfil.pedirSubida(getUsuario(res), datos));
  });

  router.post('/avatar/confirmar', async (_req, res) => {
    res.json(await perfil.confirmar(getUsuario(res)));
  });

  router.delete('/avatar', async (_req, res) => {
    await perfil.borrarAvatar(getUsuario(res));
    res.status(204).end();
  });

  router.post('/clave', claveLimiter, async (req, res) => {
    const { actual, nueva } = parseOrThrow(cambiarClaveSchema, req.body ?? {});
    await perfil.cambiarClave(getUsuario(res), actual, nueva);
    res.status(204).end();
  });

  return router;
}
