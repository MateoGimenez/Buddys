import { afterEach, describe, expect, it } from 'vitest';
import { ROLES } from '../src/domain/perfil.js';
import {
  CAPACIDADES,
  PLAZO_DESHACER_LAVADO_MINUTOS,
  deshacerLavadoHasta,
  puedeBorrarTurnos,
  puedeDeshacerCualquierLavado,
  puedeDeshacerLavado,
} from '../src/domain/permisos.js';
import { type TestContext, NOW, addUser, closeAllContexts, createClient, createTestContext, loginClient } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Forma de pago del lavado (cierre de caja) y "deshacer" un lavado recién registrado
 * (migración 20261113100000_forma_pago_deshacer_lavado). NOW: 2026-10-16 12:00 en La Rioja.
 */

const LAVADO = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;
const FORMA_MSG = 'La forma de pago tiene que ser una de: efectivo, transferencia, debito, credito, otro, o null.';
const PLAZO_MSG = 'Pasaron más de 5 minutos: pedile a un encargado que lo borre desde la planilla.';

async function equipo() {
  const context = await createTestContext();
  const duenoId = await addUser(context, { email: 'dueno@b.test', rol: 'superadmin', nombre: 'Dueño' });
  const anaId = await addUser(context, { email: 'ana@b.test', rol: 'admin', nombre: 'Ana' });
  const francoId = await addUser(context, { email: 'franco@b.test', rol: 'empleado', nombre: 'Franco' });
  const nicoId = await addUser(context, { email: 'nico@b.test', rol: 'empleado', nombre: 'Nico' });
  return {
    context,
    duenoId,
    anaId,
    francoId,
    nicoId,
    dueno: await loginClient(context, 'dueno@b.test'),
    admin: await loginClient(context, 'ana@b.test'),
    franco: await loginClient(context, 'franco@b.test'),
    nico: await loginClient(context, 'nico@b.test'),
  };
}

async function fila(context: TestContext, id: string) {
  const { rows } = await context.db.sql.query(
    'SELECT forma_pago, registrado_por::text AS registrado_por, updated_at FROM buddys.bookings WHERE id = $1::uuid',
    [id],
  );
  return rows[0];
}

const avanzar = (context: TestContext, ms: number) => {
  context.clock.current = new Date(NOW.getTime() + ms);
};

describe('forma de pago al registrar un lavado', () => {
  it('se guarda y vuelve en el lavado, visible para todos los roles (el empleado también la carga)', async () => {
    const { context, admin, franco, francoId } = await equipo();
    const r1 = await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, formaPago: 'transferencia' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.lavado.formaPago).toBe('transferencia');

    const r2 = await franco.post('/api/admin/lavados', { ...LAVADO, monto: 8000, formaPago: 'efectivo' });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body.lavado).toMatchObject({ formaPago: 'efectivo', monto: null, trabajador: { id: francoId } });
    expect(await fila(context, r2.body.lavado.id as string)).toMatchObject({ forma_pago: 'efectivo', registrado_por: francoId });

    const lista = await franco.get('/api/admin/lavados');
    expect(lista.body.lavados.map((l: { formaPago: string }) => l.formaPago)).toEqual(['transferencia', 'efectivo']);
  });

  it('es opcional (null = sin indicar) y se valida contra la lista de formas', async () => {
    const { admin } = await equipo();
    expect((await admin.post('/api/admin/lavados', LAVADO)).body.lavado.formaPago).toBeNull();
    expect((await admin.post('/api/admin/lavados', { ...LAVADO, formaPago: null })).body.lavado.formaPago).toBeNull();
    for (const formaPago of ['bitcoin', '', 3, 'EFECTIVO']) {
      const r = await admin.post('/api/admin/lavados', { ...LAVADO, formaPago });
      expect(r.status, String(formaPago)).toBe(400);
      expect(r.body.error.fields).toEqual({ formaPago: FORMA_MSG });
    }
  });

  it('la respuesta trae deshacerHasta: la creación + 5 minutos', async () => {
    const { admin } = await equipo();
    const r = await admin.post('/api/admin/lavados', LAVADO);
    expect(r.body.deshacerHasta).toBe('2026-10-16T15:05:00.000Z');
    expect(r.body.lavado.createdAt).toBe(NOW.toISOString());
    expect(Object.keys(r.body as object).sort()).toEqual(['deshacerHasta', 'lavado']);
  });
});

describe('PATCH /api/admin/bookings/:id con formaPago', () => {
  it('admin y superadmin la cambian y la borran (null) sin mover updated_at; el empleado recibe 403', async () => {
    const { context, admin, dueno, franco } = await equipo();
    const { id } = (await franco.post('/api/admin/lavados', { ...LAVADO, formaPago: 'efectivo' })).body.lavado as { id: string };
    const antes = (await fila(context, id))?.updated_at;
    avanzar(context, 60_000);

    const r1 = await admin.patch(`/api/admin/bookings/${id}`, { formaPago: 'debito' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.booking.formaPago).toBe('debito');
    const r2 = await dueno.patch(`/api/admin/bookings/${id}`, { formaPago: null });
    expect(r2.body.booking.formaPago).toBeNull();
    expect((await fila(context, id))?.updated_at).toEqual(antes);

    const r3 = await franco.patch(`/api/admin/bookings/${id}`, { formaPago: 'credito' });
    expect(r3.status).toBe(403);
    expect(r3.body.error.code).toBe('FORBIDDEN');
    expect((await fila(context, id))?.forma_pago).toBeNull();
  });

  it('va junto con el cobro, la nota o el estado, y también en un turno web', async () => {
    const { context, admin, nicoId } = await equipo();
    const { id } = (await admin.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    const r = await admin.patch(`/api/admin/bookings/${id}`, { monto: 5000, trabajadorId: nicoId, formaPago: 'credito', notasInternas: 'ok' });
    expect(r.body.booking).toMatchObject({ monto: 5000, formaPago: 'credito', notasInternas: 'ok' });

    const { rows } = await context.db.sql.query(
      `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado)
       VALUES ('Web', '12345678', 'auto', 'pulido', '2026-10-20', 'manana', 'pendiente') RETURNING id::text AS id`,
    );
    const web = String(rows[0]?.id);
    const reprogramado = await admin.patch(`/api/admin/bookings/${web}`, { fechaConfirmada: '2026-10-21', franjaConfirmada: 'tarde', formaPago: 'transferencia' });
    expect(reprogramado.status, JSON.stringify(reprogramado.body)).toBe(200);
    expect(reprogramado.body.booking).toMatchObject({ fechaConfirmada: '2026-10-21', formaPago: 'transferencia' });
    const completado = await admin.patch(`/api/admin/bookings/${web}`, { estado: 'completado', monto: 1000, formaPago: 'otro' });
    expect(completado.body.booking).toMatchObject({ estado: 'completado', formaPago: 'otro', origen: 'web' });
  });

  it('valida el valor; solo formaPago alcanza para que el body no esté vacío', async () => {
    const { admin } = await equipo();
    const { id } = (await admin.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    const r = await admin.patch(`/api/admin/bookings/${id}`, { formaPago: 'cheque' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields).toEqual({ formaPago: FORMA_MSG });
    expect((await admin.patch(`/api/admin/bookings/${id}`, {})).status).toBe(400);
  });
});

describe('GET /api/admin/lavados: resumen.porFormaPago (cierre de caja)', () => {
  it('una entrada por forma usada (null = sin indicar), más cobrado primero; sin cancelados ni otros días', async () => {
    const { admin, franco } = await equipo();
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, formaPago: 'efectivo' });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 12000, formaPago: 'efectivo' });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 30000, formaPago: 'transferencia' });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 5000 });
    await admin.post('/api/admin/lavados', { ...LAVADO, formaPago: 'debito' }); // sin monto
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 99000, formaPago: 'credito', fecha: '2026-10-15' });
    const cancelado = (await admin.post('/api/admin/lavados', { ...LAVADO, monto: 70000, formaPago: 'otro' })).body.lavado as { id: string };
    await admin.patch(`/api/admin/bookings/${cancelado.id}`, { estado: 'cancelado' });

    const r = await admin.get('/api/admin/lavados');
    expect(r.status).toBe(200);
    expect(r.body.resumen.total).toBe(57000);
    expect(r.body.resumen.porFormaPago).toEqual([
      { formaPago: 'transferencia', cantidad: 1, total: 30000 },
      { formaPago: 'efectivo', cantidad: 2, total: 22000 },
      { formaPago: null, cantidad: 1, total: 5000 },
      { formaPago: 'debito', cantidad: 1, total: 0 },
    ]);

    // El empleado: las mismas formas y cantidades, total null y un orden que no depende de lo cobrado.
    const e = await franco.get('/api/admin/lavados');
    expect(e.body.resumen.porFormaPago).toEqual([
      { formaPago: 'efectivo', cantidad: 2, total: null },
      { formaPago: 'transferencia', cantidad: 1, total: null },
      { formaPago: 'debito', cantidad: 1, total: null },
      { formaPago: null, cantidad: 1, total: null },
    ]);
    expect(JSON.stringify(e.body)).not.toMatch(/30000|22000|57000/);

    const ayer = await admin.get('/api/admin/lavados?fecha=2026-10-15');
    expect(ayer.body.resumen.porFormaPago).toEqual([{ formaPago: 'credito', cantidad: 1, total: 99000 }]);
  });

  it('un día sin lavados: lista vacía', async () => {
    const { admin } = await equipo();
    expect((await admin.get('/api/admin/lavados')).body.resumen.porFormaPago).toEqual([]);
  });
});

describe('comprobante de un lavado con forma de pago', () => {
  it('sin formaPago usa la del lavado; si viene, manda la que viene', async () => {
    const { admin } = await equipo();
    const a = (await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, formaPago: 'transferencia' })).body.lavado as { id: string };
    const r1 = await admin.post(`/api/admin/bookings/${a.id}/comprobante`, {});
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.comprobante).toMatchObject({ formaPago: 'transferencia', monto: 10000 });

    const b = (await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, formaPago: 'transferencia' })).body.lavado as { id: string };
    const r2 = await admin.post(`/api/admin/bookings/${b.id}/comprobante`, { formaPago: 'efectivo', notas: 'Vuelto' });
    expect(r2.body.comprobante).toMatchObject({ formaPago: 'efectivo', notas: 'Vuelto' });
  });

  it('sin formaPago y el lavado sin forma: el mismo 400 de siempre en fields.formaPago', async () => {
    const { context, admin } = await equipo();
    const { id } = (await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000 })).body.lavado as { id: string };
    const r = await admin.post(`/api/admin/bookings/${id}/comprobante`, { notas: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Revisá los datos ingresados.',
      fields: { formaPago: 'La forma de pago tiene que ser una de: efectivo, transferencia, debito, credito, otro.' },
    });
    expect((await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.comprobantes')).rows[0]?.n).toBe(0);
  });
});

describe('DELETE /api/admin/lavados/:id (deshacer)', () => {
  it('quien lo registró lo deshace dentro de los 5 minutos (justo a los 5, también)', async () => {
    const { context, franco } = await equipo();
    const { id } = (await franco.post('/api/admin/lavados', { ...LAVADO, monto: 1000 })).body.lavado as { id: string };
    avanzar(context, PLAZO_DESHACER_LAVADO_MINUTOS * 60_000);
    const r = await franco.delete(`/api/admin/lavados/${id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(204);
    expect(await fila(context, id)).toBeUndefined();
    expect(context.logger.text).toMatch(/Lavado deshecho id=/);
  });

  it('pasado el plazo: 403 PLAZO_DESHACER_VENCIDO y el lavado sigue', async () => {
    const { context, franco } = await equipo();
    const { id } = (await franco.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    avanzar(context, 5 * 60_000 + 1);
    const r = await franco.delete(`/api/admin/lavados/${id}`);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: { code: 'PLAZO_DESHACER_VENCIDO', message: PLAZO_MSG } });
    expect(await fila(context, id)).toBeDefined();
  });

  it('un empleado no deshace el lavado de otro (403 FORBIDDEN), aunque esté dentro del plazo', async () => {
    const { context, franco, nico, admin, francoId } = await equipo();
    const propio = (await franco.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    const r = await nico.delete(`/api/admin/lavados/${propio.id}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    // Registrado por el admin a nombre de Franco: Franco lo lavó, pero no lo registró.
    const aNombre = (await admin.post('/api/admin/lavados', { ...LAVADO, trabajadorId: francoId })).body.lavado as { id: string };
    expect((await franco.delete(`/api/admin/lavados/${aNombre.id}`)).status).toBe(403);
    expect(await fila(context, propio.id)).toBeDefined();
  });

  it('admin y superadmin lo borran siempre, aunque sea de otro y hayan pasado horas', async () => {
    const { context, franco, admin, dueno } = await equipo();
    const a = (await franco.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    const b = (await franco.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    avanzar(context, 30 * 60_000);
    expect((await admin.delete(`/api/admin/lavados/${a.id}`)).status).toBe(204);
    expect((await dueno.delete(`/api/admin/lavados/${b.id}`)).status).toBe(204);
  });

  it('un lavado viejo sin registrado_por solo lo borra quien puede borrar turnos', async () => {
    const { context, franco, admin } = await equipo();
    const { id } = (await franco.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    await context.db.sql.query('UPDATE buddys.bookings SET registrado_por = NULL WHERE id = $1::uuid', [id]);
    expect((await franco.delete(`/api/admin/lavados/${id}`)).status).toBe(403);
    expect((await admin.delete(`/api/admin/lavados/${id}`)).status).toBe(204);
  });

  it('con comprobante emitido: 409 TURNO_CON_COMPROBANTE, también para el admin', async () => {
    const { context, franco, admin } = await equipo();
    const { id } = (await franco.post('/api/admin/lavados', { ...LAVADO, monto: 5000, formaPago: 'efectivo' })).body.lavado as { id: string };
    expect((await admin.post(`/api/admin/bookings/${id}/comprobante`, {})).status).toBe(201);
    for (const cliente of [franco, admin]) {
      const r = await cliente.delete(`/api/admin/lavados/${id}`);
      expect(r.status).toBe(409);
      expect(r.body.error).toEqual({
        code: 'TURNO_CON_COMPROBANTE',
        message: 'Este lavado ya tiene un comprobante de pago emitido: no se puede deshacer.',
      });
    }
    expect(await fila(context, id)).toBeDefined();
  });

  it('404 si no existe, si el id es inválido o si es un turno web; 401 sin sesión', async () => {
    const { context, admin } = await equipo();
    expect((await admin.delete('/api/admin/lavados/11111111-1111-4111-8111-111111111111')).status).toBe(404);
    expect((await admin.delete('/api/admin/lavados/nope')).status).toBe(404);
    const { rows } = await context.db.sql.query(
      `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja)
       VALUES ('Web', '12345678', 'auto', 'pulido', '2026-10-20', 'manana') RETURNING id::text AS id`,
    );
    const web = await admin.delete(`/api/admin/lavados/${String(rows[0]?.id)}`);
    expect(web.status).toBe(404);
    expect(web.body.error).toEqual({ code: 'NOT_FOUND', message: 'No encontramos ese lavado.' });
    const { id } = (await admin.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    expect((await createClient(context.app).delete(`/api/admin/lavados/${id}`)).status).toBe(401);
  });
});

describe('POST /api/admin/lavados con idLocal (cola sin conexión del panel)', () => {
  const ID_LOCAL = 'AAAAAAAA-1111-4111-8111-111111111111';
  const cantidad = async (context: TestContext) =>
    (await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.bookings')).rows[0]?.n;

  it('primera vez: 201; el reintento de la misma persona: 200 con el mismo { lavado, deshacerHasta }, sin crear otro', async () => {
    const { context, franco } = await equipo();
    const body = { ...LAVADO, monto: 9000, formaPago: 'efectivo', idLocal: ID_LOCAL };
    const r1 = await franco.post('/api/admin/lavados', body);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const { rows } = await context.db.sql.query('SELECT id_local::text AS id_local FROM buddys.bookings WHERE id = $1::uuid', [
      r1.body.lavado.id,
    ]);
    expect(rows[0]?.id_local).toBe(ID_LOCAL.toLowerCase());

    avanzar(context, 2 * 60_000); // el reintento llega más tarde: deshacerHasta sigue siendo el del original
    const r2 = await franco.post('/api/admin/lavados', body);
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(r2.body).toEqual(r1.body);
    expect(r2.body.lavado.monto).toBeNull(); // el empleado sigue sin ver el importe
    expect(await cantidad(context)).toBe(1);
  });

  it('doble envío simultáneo con el mismo idLocal (doble toque o cola + formulario): uno 201, el otro 200, una fila', async () => {
    const { context, franco } = await equipo();
    const body = { ...LAVADO, formaPago: 'efectivo', idLocal: ID_LOCAL };
    const respuestas = await Promise.all([franco.post('/api/admin/lavados', body), franco.post('/api/admin/lavados', body)]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(respuestas[0].body.lavado.id).toBe(respuestas[1].body.lavado.id);
    expect(await cantidad(context)).toBe(1);
  });

  it('el reintento devuelve el original aunque el servicio se haya desactivado en el medio', async () => {
    const { context, admin } = await equipo();
    const body = { ...LAVADO, idLocal: ID_LOCAL };
    const r1 = await admin.post('/api/admin/lavados', body);
    await context.db.sql.query("UPDATE buddys.servicios SET activo = false WHERE id = 'lavado-basico'");
    const r2 = await admin.post('/api/admin/lavados', body);
    expect(r2.status).toBe(200);
    expect(r2.body.lavado.id).toBe(r1.body.lavado.id);
  });

  it('si ese idLocal lo registró otra persona: 409 CONFLICT y no se crea nada', async () => {
    const { context, franco, nico, admin } = await equipo();
    expect((await franco.post('/api/admin/lavados', { ...LAVADO, idLocal: ID_LOCAL })).status).toBe(201);
    for (const otro of [nico, admin]) {
      const r = await otro.post('/api/admin/lavados', { ...LAVADO, idLocal: ID_LOCAL });
      expect(r.status).toBe(409);
      expect(r.body.error).toEqual({ code: 'CONFLICT', message: 'Ese lavado ya lo registró otra persona.' });
    }
    expect(await cantidad(context)).toBe(1);
  });

  it('idLocal inválido: 400 en fields.idLocal; sin idLocal, cada POST crea uno', async () => {
    const { context, admin } = await equipo();
    const r = await admin.post('/api/admin/lavados', { ...LAVADO, idLocal: 'abc' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields as object)).toEqual(['idLocal']);
    await admin.post('/api/admin/lavados', LAVADO);
    await admin.post('/api/admin/lavados', LAVADO);
    expect(await cantidad(context)).toBe(2);
  });

  it('la base no acepta dos lavados con el mismo id_local', async () => {
    const { context, admin } = await equipo();
    await admin.post('/api/admin/lavados', { ...LAVADO, idLocal: ID_LOCAL });
    await expect(
      context.db.sql.query(
        `INSERT INTO buddys.bookings (nombre, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, id_local)
         VALUES ('X', 'auto', 'pulido', '2026-10-16', 'manana', 'completado', 'mostrador', $1::uuid)`,
        [ID_LOCAL],
      ),
    ).rejects.toThrow(/bookings_id_local_key/);
  });
});

describe('regla de deshacer en domain/permisos.ts', () => {
  const lavado = { registradoPor: 'yo', createdAt: NOW.toISOString() };
  const en = (ms: number) => new Date(NOW.getTime() + ms);

  it('admin y superadmin siempre; el empleado, el suyo y dentro del plazo', () => {
    for (const rol of ROLES) {
      expect(puedeDeshacerCualquierLavado(rol), rol).toBe(puedeBorrarTurnos(rol));
      expect(puedeDeshacerLavado(rol, 'otro', lavado, en(3_600_000)), rol).toBe(rol === 'empleado' ? 'no' : 'si');
    }
    expect(puedeDeshacerLavado('empleado', 'yo', lavado, en(300_000))).toBe('si');
    expect(puedeDeshacerLavado('empleado', 'yo', lavado, en(300_001))).toBe('vencido');
    expect(puedeDeshacerLavado('empleado', 'yo', { ...lavado, registradoPor: null }, en(0))).toBe('no');
    expect(deshacerLavadoHasta('2026-10-16T15:00:00.000Z')).toBe('2026-10-16T15:05:00.000Z');
  });

  it('está en la matriz que ve el usuario', () => {
    const capacidad = CAPACIDADES.find((c) => c.id === 'lavados.deshacer');
    expect(capacidad?.roles).toEqual({ superadmin: 'si', admin: 'si', empleado: 'parcial' });
    for (const rol of ROLES) expect(puedeDeshacerCualquierLavado(rol), rol).toBe(capacidad?.roles[rol] === 'si');
  });
});
