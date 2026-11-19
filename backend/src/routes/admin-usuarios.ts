import { Router } from 'express';
import type { PerfilConHistorial } from '../domain/perfil.js';
import { puedeGestionarA, puedeGestionarUsuarios } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';
import { createUsuarioSchema, updateUsuarioSchema, usuarioIdSchema } from '../schemas/usuarios.js';
import type { UsuarioSesion } from '../services/auth.js';
import type { UsuarioService } from '../services/usuarios.js';

const NOT_FOUND_MESSAGE = 'No encontramos ese usuario.';

/**
 * El usuario tal como lo ve quien pide (`actor`):
 *  - gestionable: si lo puede editar y eliminar (puedeGestionarA, y que no sea uno mismo ni esté dado de baja).
 *  - email: el superadmin ve todos; el admin, el de los empleados y el suyo propio (cada uno ve siempre el suyo); de
 *    los otros admins y superadmins le llega null. De un dado de baja, null (en Auth es baja+<id>@buddys.invalid).
 */
function toJson(usuario: PerfilConHistorial, actor: UsuarioSesion) {
  const dadoDeBaja = usuario.eliminadoAt !== null;
  const esUnoMismo = usuario.id === actor.id;
  const veEmail = !dadoDeBaja && (esUnoMismo || puedeGestionarA(actor.rol, usuario.rol));
  return {
    id: usuario.id,
    email: veEmail ? usuario.email : null,
    nombre: usuario.nombre,
    rol: usuario.rol,
    activo: usuario.activo,
    eliminadoAt: usuario.eliminadoAt,
    tieneHistorial: usuario.tieneHistorial,
    gestionable: !esUnoMismo && !dadoDeBaja && puedeGestionarA(actor.rol, usuario.rol),
    // La foto la ven quienes gestionan usuarios (GET /api/admin/usuarios/:id/foto?v=<fotoVersion>).
    fotoVersion: usuario.fotoVersion,
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt,
  };
}

function parseId(value: string | undefined): string {
  const parsed = usuarioIdSchema.safeParse(value);
  if (!parsed.success) throw AppError.notFound(NOT_FOUND_MESSAGE);
  return parsed.data.toLowerCase();
}

/**
 * Gestión de usuarios del panel. Detrás de requireSession; todas las rutas exigen puedeGestionarUsuarios (superadmin,
 * y admin solo sobre empleados: el resto de las reglas las aplica UsuarioService).
 */
export function adminUsuariosRouter(deps: { usuarios: UsuarioService }): Router {
  const { usuarios } = deps;
  const router = Router();

  router.use(requirePermiso(puedeGestionarUsuarios, 'Con tu rol no podés gestionar usuarios.'));

  // GET /api/admin/usuarios => { usuarios: [...], gestionCuentas } (los más viejos primero).
  // gestionCuentas = false: falta SUPABASE_SECRET_KEY (no hay alta, baja ni cambio de email o contraseña).
  // Todos, incluidos los dados de baja.
  router.get('/', async (_req, res) => {
    const actor = getUsuario(res);
    res.json({
      usuarios: (await usuarios.list()).map((usuario) => toJson(usuario, actor)),
      gestionCuentas: usuarios.gestionCuentas,
    });
  });

  // POST /api/admin/usuarios { email, password, nombre?, rol, activo } => 201 { usuario }
  router.post('/', async (req, res) => {
    const nuevo = parseOrThrow(createUsuarioSchema, req.body ?? {});
    const actor = getUsuario(res);
    const created = await usuarios.create(actor, nuevo);
    res.status(201).json({ usuario: toJson(created, actor) });
  });

  // PATCH /api/admin/usuarios/:id { rol?, activo?, nombre?, email?, password? } => { usuario }
  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const cambios = parseOrThrow(updateUsuarioSchema, req.body ?? {});
    // zod no agrega las claves que no vinieron: un body vacío queda como {}.
    if (Object.keys(cambios).length === 0) {
      throw AppError.validation(undefined, 'Indicá al menos un cambio: rol, activo, nombre, email o contraseña.');
    }
    const actor = getUsuario(res);
    const updated = await usuarios.update(actor, id, cambios);
    res.json({ usuario: toJson(updated, actor) });
  });

  // DELETE /api/admin/usuarios/:id => 200 { resultado: 'eliminado' } (sin historial: se borra de Supabase Auth)
  //                                  | 200 { resultado: 'baja', usuario } (con historial: queda dado de baja)
  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const actor = getUsuario(res);
    const resultado = await usuarios.remove(actor, id);
    res.json(
      resultado.resultado === 'baja'
        ? { resultado: 'baja', usuario: toJson(resultado.usuario, actor) }
        : { resultado: 'eliminado' },
    );
  });

  return router;
}
