import { describe, expect, it } from 'vitest';
import type { Permisos, UsuarioEquipo } from '../api/types';
import { equipo, fx, permisosEncargado, real } from './fixtures';

/**
 * Equipo (contrato 03): los usuarios armados a mano para los tests de Equipo tienen que tener la forma de lo que
 * devuelve el backend de verdad (backend/test/fixtures/respuestas-api.json y respuestas-reales.json).
 * `fotoVersion` es del contrato 04 (foto en la lista del equipo): el backend la manda en cada usuario.
 */
const SIN_FOTO = (claves: string[]) => [...claves].sort();

function usuariosDe(body: unknown): UsuarioEquipo[] {
  return (body as { usuarios: UsuarioEquipo[] }).usuarios;
}

describe('contrato del equipo (GET/POST/PATCH/DELETE /api/admin/usuarios)', () => {
  it('cada usuario de los tests tiene las mismas claves que los del backend (vista del admin y del superadmin)', () => {
    const aMano = SIN_FOTO(Object.keys(equipo('ana').usuarios[0] ?? {}));
    for (const clave of ['usuariosVistaAdmin', 'usuariosVistaSuperadmin']) {
      const r = fx[clave];
      expect(r?.status, clave).toBe(200);
      for (const u of usuariosDe(r?.body)) expect(SIN_FOTO(Object.keys(u)), clave).toEqual(aMano);
      expect(Object.keys(r?.body ?? {}).sort(), clave).toEqual(['gestionCuentas', 'usuarios']);
    }
    for (const u of usuariosDe(real.usuariosAdmin?.body)) expect(SIN_FOTO(Object.keys(u))).toEqual(aMano);
    expect(usuariosDe(real.usuariosAdminConFoto?.body)[0]?.fotoVersion).toMatch(/Z$/);
  });

  it('alta, edición y baja devuelven { usuario } / { resultado } con el mismo usuario', () => {
    const aMano = SIN_FOTO(Object.keys(equipo('ana').usuarios[0] ?? {}));
    expect(fx.usuarioCreaEmpleado?.status).toBe(201);
    for (const clave of ['usuarioCreaEmpleado', 'usuarioPatchEmpleado']) {
      expect(SIN_FOTO(Object.keys((fx[clave]?.body as { usuario: object }).usuario)), clave).toEqual(aMano);
    }
    expect(fx.usuarioEliminado).toEqual({ status: 200, body: { resultado: 'eliminado' } });
    const baja = fx.usuarioBaja?.body as { resultado: string; usuario: UsuarioEquipo };
    expect(baja.resultado).toBe('baja');
    expect(SIN_FOTO(Object.keys(baja.usuario))).toEqual(aMano);
    // Un dado de baja llega sin email, inactivo, con fecha y sin acciones (como el Ezequiel de los tests).
    expect(baja.usuario).toMatchObject({ email: null, activo: false, gestionable: false, tieneHistorial: true });
    expect(baja.usuario.eliminadoAt).toMatch(/Z$/);
  });

  it('el admin no recibe emails de otros admins ni de superadmins (backend y fixture a mano)', () => {
    const delBackend = usuariosDe(fx.usuariosVistaAdmin?.body);
    // Sí recibe el suyo (gestionable: false por ser él mismo) y el de los empleados.
    for (const u of delBackend) {
      if (u.rol === 'empleado') expect(u.email).not.toBeNull();
    }
    for (const u of equipo('carla').usuarios) {
      if (u.rol !== 'empleado' && u.nombre !== 'Carla') expect(u.email, u.nombre ?? u.id).toBeNull();
    }
  });

  it('la capacidad usuarios.gestionar de los tests es la que manda GET /api/admin/permisos', () => {
    const delBackend = (fx.permisosAdmin?.body as Permisos).capacidades.find((c) => c.id === 'usuarios.gestionar');
    const aMano = permisosEncargado().capacidades.find((c) => c.id === 'usuarios.gestionar');
    expect(aMano).toEqual(delBackend);
  });

  it('los errores del equipo que usan los tests son los del backend', () => {
    expect(fx.error403UsuarioCreaAdmin?.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'Con tu rol solo podés crear y editar empleados.' },
    });
    expect(fx.error403UsuarioGestionarAdmin?.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'Con tu rol solo podés gestionar empleados.' },
    });
    expect(fx.error409UsuarioDadoDeBaja?.body).toEqual({ error: { code: 'CONFLICT', message: 'Ese usuario está dado de baja.' } });
    expect(real.usuariosEmpleado).toEqual(fx.error403UsuariosEmpleado);
  });
});
