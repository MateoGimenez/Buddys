import { expect } from 'vitest';
import { permisosAdmin, permisosEmpleado, serviciosAdmin, trabajadores, usuarioAdmin, usuarioEmpleado } from './fixtures';

/** El idLocal que manda el panel en cada POST de lavado: un uuid. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const unUuid = () => expect.stringMatching(UUID_RE) as unknown as string;

/** Rutas de una sesión de Ana (superadmin) con catálogo y equipo. */
export function sesionAdmin() {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
    'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    'GET /api/admin/trabajadores': { status: 200, body: trabajadores() },
  };
}

/** Rutas de una sesión de Beto (empleado). */
export function sesionEmpleado() {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
  };
}
