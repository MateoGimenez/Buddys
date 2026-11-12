import { describe, expect, it } from 'vitest';
import type { PlanillaDelDia, Turno, Usuario } from '../api/types';
import { errores, lavado, planillaAdmin, planillaEmpleado, real, usuarioAdmin } from './fixtures';

/** Forma de un valor: las claves de los objetos (recursivo, el primer elemento de cada lista). Las hojas no importan. */
function forma(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.length ? [forma(valor[0])] : [];
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, forma(v)]),
    );
  }
  return 'hoja';
}

function cuerpo<T>(clave: string): T {
  return real[clave]?.body as T;
}

describe('los fixtures del panel tienen la forma de las respuestas reales del backend', () => {
  it('login, /me y refresh devuelven { usuario: { id, email, nombre, rol } }', () => {
    for (const clave of ['loginAdmin', 'meAdmin', 'meEmpleado', 'refreshOk']) {
      expect(real[clave]?.status, clave).toBe(200);
      expect(Object.keys(cuerpo<{ usuario: Usuario }>(clave).usuario).sort(), clave).toEqual(['email', 'id', 'nombre', 'rol']);
    }
    expect(usuarioAdmin.rol).toBe('superadmin');
  });

  it('un lavado armado para los tests tiene las mismas claves que el que devuelve POST /api/admin/lavados', () => {
    const delBackend = cuerpo<{ lavado: Turno }>('lavadoAdmin').lavado;
    expect(forma(lavado({ id: 'x', monto: 1 }))).toEqual(forma(delBackend));
    expect(real.lavadoAdmin?.status).toBe(201);
  });

  it('la planilla de los tests tiene la forma de GET /api/admin/lavados', () => {
    const delBackend = cuerpo<PlanillaDelDia>('planillaAdmin');
    expect(forma(planillaAdmin('2026-10-16'))).toEqual(forma(delBackend));
    expect(forma(planillaEmpleado('2026-10-16'))).toEqual(forma(cuerpo<PlanillaDelDia>('planillaEmpleado')));
  });

  it('al empleado el backend le manda los montos en null (lavado, planilla y corrección de nota)', () => {
    expect(cuerpo<{ lavado: Turno }>('lavadoEmpleado').lavado.monto).toBeNull();
    const p = cuerpo<PlanillaDelDia>('planillaEmpleado');
    expect(p.lavados.every((l) => l.monto === null)).toBe(true);
    expect(p.resumen.total).toBeNull();
    expect(p.resumen.porTrabajador.every((r) => r.total === null)).toBe(true);
    expect(cuerpo<{ booking: Turno }>('patchEmpleado').booking.monto).toBeNull();
    // y la fixture del empleado respeta lo mismo
    const f = planillaEmpleado('2026-10-16');
    expect(f.lavados.every((l) => l.monto === null) && f.resumen.total === null).toBe(true);
  });

  it('los errores que usan los tests son los del backend', () => {
    expect(errores.sinSesion).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHORIZED' } } });
    expect(errores.vencida).toMatchObject({ status: 401, body: { error: { code: 'SESSION_EXPIRED' } } });
    expect(errores.credenciales).toMatchObject({ status: 401, body: { error: { code: 'INVALID_CREDENTIALS' } } });
    expect(errores.prohibidoEmpleado).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    // El empleado no puede pedir la lista de trabajadores: el panel no la pide (ver registrar.test.tsx).
    expect(real.trabajadoresEmpleado?.status).toBe(403);
    // Logout siempre 204, sin body; un POST sin Content-Type JSON es 415.
    expect(real.logout?.status).toBe(204);
    expect(real.postSinContentType?.status).toBe(415);
  });
});
