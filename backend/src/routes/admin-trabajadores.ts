import { Router } from 'express';
import type { PerfilRepository } from '../domain/perfil.js';
import { puedeRegistrarCobro } from '../domain/permisos.js';
import { requirePermiso } from '../middleware/require-session.js';
import type { PerfilService } from '../services/perfil.js';

/**
 * Quién puede figurar como "el que hizo el trabajo". Detrás de requireSession; solo admin y superadmin (el empleado
 * no elige a otra persona: al completar un turno queda él).
 */
export function adminTrabajadoresRouter(deps: { perfiles: PerfilRepository; perfil: PerfilService }): Router {
  const { perfiles, perfil } = deps;
  const router = Router();

  router.use(requirePermiso(puedeRegistrarCobro, 'Con tu rol no podés elegir quién hizo un trabajo.'));

  // GET /api/admin/trabajadores => { trabajadores: [{ id, nombre, rol, avatarUrl }] }: personas ACTIVAS de cualquier
  // rol, por nombre. avatarUrl: URL firmada de su foto de perfil (vence en 1 hora) o null.
  router.get('/', async (_req, res) => {
    res.json({ trabajadores: await perfil.trabajadoresConAvatar(await perfiles.trabajadores()) });
  });

  return router;
}
