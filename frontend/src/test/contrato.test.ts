import { describe, expect, it } from 'vitest';
import type { AlertasStock, Consumo, ParaComprar, PlanillaDelDia, Receta, Turno, Usuario } from '../api/types';
import {
  alertas,
  consumoNoviembre,
  consumoVacio,
  errores,
  fx,
  lavado,
  paraComprar,
  planillaAdmin,
  planillaEmpleado,
  real,
  recetaBasico,
  usuarioAdmin,
} from './fixtures';

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
  it('login, /me y refresh devuelven { usuario: { id, email, nombre, rol, fotoVersion } }', () => {
    for (const clave of ['loginAdmin', 'meAdmin', 'meEmpleado', 'refreshOk']) {
      expect(real[clave]?.status, clave).toBe(200);
      const u = cuerpo<{ usuario: Usuario }>(clave).usuario;
      expect(Object.keys(u).sort(), clave).toEqual(['email', 'fotoVersion', 'id', 'nombre', 'rol']);
      expect(u.fotoVersion === null || typeof u.fotoVersion === 'string', clave).toBe(true);
    }
    expect(cuerpo<{ usuario: Usuario }>('meAdminConFoto').usuario.fotoVersion).toMatch(/Z$/);
  });

  it('el perfil (GET, PATCH, PUT y DELETE de /api/admin/perfil) tiene la forma del usuario de la sesión', () => {
    const claves = Object.keys(usuarioAdmin).sort();
    for (const clave of ['perfilAdmin', 'perfilEmpleado', 'perfilSinFotos']) {
      const body = cuerpo<{ perfil: Usuario; fotosDisponibles: boolean }>(clave);
      expect(Object.keys(body).sort(), clave).toEqual(['fotosDisponibles', 'perfil']);
      expect(Object.keys(body.perfil).sort(), clave).toEqual(claves);
    }
    expect(cuerpo<{ fotosDisponibles: boolean }>('perfilSinFotos').fotosDisponibles).toBe(false);
    for (const clave of ['perfilPatchNombre', 'perfilPatchPassword', 'perfilFotoSube', 'perfilFotoQuita']) {
      expect(real[clave]?.status, clave).toBe(200);
      expect(Object.keys(cuerpo<object>(clave)), clave).toEqual(['perfil']);
      expect(Object.keys(cuerpo<{ perfil: Usuario }>(clave).perfil).sort(), clave).toEqual(claves);
    }
    expect(cuerpo<{ perfil: Usuario }>('perfilFotoSube').perfil.fotoVersion).toMatch(/Z$/);
    expect(cuerpo<{ perfil: Usuario }>('perfilFotoQuita').perfil.fotoVersion).toBeNull();
    // Los errores del perfil que usan los tests son los del backend.
    expect(errores.fotoInvalida).toMatchObject({ status: 400, body: { error: { fields: { foto: 'Subí una foto JPG, PNG o WebP.' } } } });
    expect(errores.fotoPesada).toMatchObject({ status: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE' } } });
    expect(errores.passwordActualMal).toMatchObject({ status: 400, body: { error: { fields: { passwordActual: 'La contraseña actual no es correcta.' } } } });
    expect(errores.passwordLimite).toMatchObject({ status: 429, body: { error: { code: 'RATE_LIMITED' } } });
    expect(real.fotoAjenaEmpleado?.status).toBe(403);
    expect(usuarioAdmin.rol).toBe('superadmin');
  });

  it('un lavado armado para los tests tiene las mismas claves que el que devuelve POST /api/admin/lavados', () => {
    const delBackend = cuerpo<{ lavado: Turno }>('lavadoAdmin').lavado;
    expect(forma(lavado({ id: 'x', monto: 1 }))).toEqual(forma(delBackend));
    expect(real.lavadoAdmin?.status).toBe(201);
  });

  it('POST /api/admin/lavados devuelve { lavado, deshacerHasta } con deshacerHasta = creación + 5 minutos', () => {
    for (const clave of ['lavadoAdmin', 'lavadoAdminMinimo', 'lavadoEmpleado']) {
      const { lavado: l, deshacerHasta } = cuerpo<{ lavado: Turno; deshacerHasta: string }>(clave);
      expect(Object.keys(cuerpo<object>(clave)).sort(), clave).toEqual(['deshacerHasta', 'lavado']);
      expect(Date.parse(deshacerHasta) - Date.parse(l.createdAt), clave).toBe(5 * 60_000);
    }
  });

  it('el cierre de caja de los tests sigue el orden del backend (con y sin importes)', () => {
    // Con importes: más cobrado primero. Sin importes: más lavados primero; empate por el orden de las formas, null al final.
    const ordenAdmin = (p: PlanillaDelDia) => p.resumen.porFormaPago.map((f) => f.total ?? 0);
    expect(ordenAdmin(planillaAdmin('2026-10-16'))).toEqual([...ordenAdmin(planillaAdmin('2026-10-16'))].sort((a, b) => b - a));
    for (const p of [planillaEmpleado('2026-10-16'), cuerpo<PlanillaDelDia>('planillaEmpleado')]) {
      const cantidades = p.resumen.porFormaPago.map((f) => f.cantidad);
      expect(cantidades).toEqual([...cantidades].sort((a, b) => b - a));
    }
    const formasEmpleado = planillaEmpleado('2026-10-16').resumen.porFormaPago.map((f) => f.formaPago);
    expect(formasEmpleado.at(-1)).toBeNull();
  });

  it('la planilla de los tests tiene la forma de GET /api/admin/lavados', () => {
    const delBackend = cuerpo<PlanillaDelDia>('planillaAdmin');
    expect(forma(planillaAdmin('2026-10-16'))).toEqual(forma(delBackend));
    expect(forma(planillaEmpleado('2026-10-16'))).toEqual(forma(cuerpo<PlanillaDelDia>('planillaEmpleado')));
  });

  it('sin ranking: ni la planilla ni las estadísticas traen porTrabajador; cada lavado trae registradoPor', () => {
    for (const clave of ['planillaAdmin', 'planillaEmpleado', 'planillaVacia']) {
      expect(cuerpo<PlanillaDelDia>(clave).resumen, clave).not.toHaveProperty('porTrabajador');
    }
    for (const clave of ['estadisticasMes', 'estadisticasAnio', 'estadisticasVacio']) {
      expect(fx[clave]?.body, clave).not.toHaveProperty('porTrabajador');
      expect(fx[clave]?.body, clave).not.toHaveProperty('completadosSinTrabajador');
    }
    // El empleado también recibe quién registró cada lavado (es un nombre, no un importe).
    const delEmpleado = cuerpo<PlanillaDelDia>('planillaEmpleado').lavados;
    expect(delEmpleado.every((l) => l.registradoPor === null || typeof l.registradoPor.nombre === 'string')).toBe(true);
    expect(delEmpleado.map((l) => l.registradoPor?.nombre)).toContain('Beto');
    expect(cuerpo<{ lavado: Turno }>('lavadoAdmin').lavado.registradoPor).toEqual({ id: usuarioAdmin.id, nombre: 'Ana' });
    // Turnos de la web: registradoPor null (backend, lista de turnos).
    const turnos = (fx.listaAdmin?.body as { bookings: Turno[] }).bookings;
    expect(turnos.some((t) => t.origen === 'web' && t.registradoPor === null)).toBe(true);
  });

  it('al empleado el backend le manda los montos en null (lavado, planilla y corrección de nota)', () => {
    expect(cuerpo<{ lavado: Turno }>('lavadoEmpleado').lavado.monto).toBeNull();
    const p = cuerpo<PlanillaDelDia>('planillaEmpleado');
    expect(p.lavados.every((l) => l.monto === null)).toBe(true);
    expect(p.resumen.total).toBeNull();
    expect(p.resumen.porFormaPago.length).toBeGreaterThan(0);
    expect(p.resumen.porFormaPago.every((f) => f.total === null)).toBe(true);
    expect(cuerpo<{ booking: Turno }>('patchEmpleado').booking.monto).toBeNull();
    // y la fixture del empleado respeta lo mismo
    const f = planillaEmpleado('2026-10-16');
    expect(f.lavados.every((l) => l.monto === null) && f.resumen.total === null).toBe(true);
  });

  it('recetas, alertas, para comprar y consumo (contrato 06): misma forma que el contrato del backend, y los fixtures salen de ahí', () => {
    const pares: [string, string][] = [
      ['recetasAdmin', 'recetasAdmin'],
      ['recetasEmpleado', 'recetasEmpleado'],
      ['recetaPut', 'recetaPut'],
      ['alertasAdmin', 'alertasAdmin'],
      ['paraComprarAdmin', 'paraComprarAdmin'],
      ['consumoAdmin', 'consumoAdmin'],
      ['recetaPutInsumoInvalido', 'error400RecetaInsumo'],
      ['recetaPutVehiculoNoOfrecido', 'error400RecetaVehiculo'],
      ['recetaPutEmpleado', 'error403RecetaEmpleado'],
      ['alertasEmpleado', 'error403AlertasEmpleado'],
      ['paraComprarEmpleado', 'error403ParaComprarEmpleado'],
      ['consumoEmpleado', 'error403ConsumoEmpleado'],
    ];
    for (const [delPanel, delBackend] of pares) {
      expect(real[delPanel]?.status, delPanel).toBe(fx[delBackend]?.status);
      expect(forma(real[delPanel]?.body), delPanel).toEqual(forma(fx[delBackend]?.body));
    }
    // Los mensajes de error son los mismos (el panel los muestra tal cual).
    expect(real.recetaPutInsumoInvalido?.body).toEqual(fx.error400RecetaInsumo?.body);
    expect(real.consumoEmpleado?.body).toEqual(fx.error403ConsumoEmpleado?.body);

    // Los fixtures de los tests son esas respuestas.
    expect(recetaBasico()).toEqual(cuerpo<{ recetas: Receta[] }>('recetasAdmin').recetas[0]);
    expect(alertas(2)).toEqual(cuerpo<AlertasStock>('alertasAdmin'));
    expect(forma(alertas(3))).toEqual(forma(fx.alertasAdmin?.body));
    expect(paraComprar()).toEqual(cuerpo<ParaComprar>('paraComprarAdmin'));
    expect(consumoNoviembre()).toEqual(cuerpo<Consumo>('consumoAdmin'));
    expect(Object.keys(consumoVacio()).sort()).toEqual(Object.keys(fx.consumoAdmin?.body as object).sort());
    expect(consumoVacio().porInsumo).toEqual([]);

    // Tipos que el panel da por sentados (api/types.ts).
    for (const p of [cuerpo<ParaComprar>('paraComprarAdmin'), fx.paraComprarAdmin?.body as ParaComprar]) {
      expect(typeof p.costoTotalEstimado).toBe('number'); // nunca null: 0 si nada tiene costo
      expect(p.costoTotalEstimado).toBe(p.items.reduce((a, i) => a + (i.costoEstimado ?? 0), 0));
    }
    expect(consumoVacio().costoPorLavado).toBeNull();
    expect(consumoVacio().lavados.serie.length).toBeGreaterThan(0); // con ceros, no vacía
    expect(typeof consumoNoviembre().costoPorLavado).toBe('number');
    // El empleado ve las recetas sin costos.
    expect(JSON.stringify(real.recetasEmpleado?.body)).not.toMatch(/costo/i);
    expect(JSON.stringify(fx.recetasEmpleado?.body)).not.toMatch(/costo/i);
  });

  it('los errores que usan los tests son los del backend', () => {
    expect(errores.sinSesion).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHORIZED' } } });
    expect(errores.vencida).toMatchObject({ status: 401, body: { error: { code: 'SESSION_EXPIRED' } } });
    expect(errores.credenciales).toMatchObject({ status: 401, body: { error: { code: 'INVALID_CREDENTIALS' } } });
    expect(errores.prohibidoEmpleado).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    // El empleado no puede pedir la lista de trabajadores: el panel no la pide (ver registrar.test.tsx).
    expect(real.trabajadoresEmpleado?.status).toBe(403);
    // Deshacer e idLocal: los códigos que el panel distingue.
    expect(errores.plazoVencido).toMatchObject({ status: 403, body: { error: { code: 'PLAZO_DESHACER_VENCIDO' } } });
    expect(errores.deshacerAjeno).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    expect(errores.conComprobante).toMatchObject({ status: 409, body: { error: { code: 'TURNO_CON_COMPROBANTE' } } });
    expect(errores.idLocalAjeno).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
    // Logout siempre 204, sin body; un POST sin Content-Type JSON es 415.
    expect(real.logout?.status).toBe(204);
    expect(real.postSinContentType?.status).toBe(415);
  });
});
