import { afterEach, describe, expect, it } from 'vitest';
import { type TestContext, addUser, closeAllContexts, createClient, createTestContext, loginClient, rawPost, validBooking } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Un lavado (un auto) con varios servicios (migración 20261113120000_lavado_varios_servicios): POST /api/admin/lavados
 * con servicioIds (y servicioId suelto por compatibilidad), `servicios` en las respuestas con la foto del precio de
 * lista (null para el empleado), PATCH de servicioIds, estadísticas que cuentan cada servicio, comprobante y
 * seguimiento con los nombres unidos. NOW: 2026-10-16 12:00 en La Rioja.
 */

const HOY = '2026-10-16';

interface ServicioJson {
  id: string;
  nombre: string;
  precioLista: number | null;
}

async function equipo() {
  const context = await createTestContext();
  const anaId = await addUser(context, { email: 'ana@b.test', rol: 'admin', nombre: 'Ana' });
  const francoId = await addUser(context, { email: 'franco@b.test', rol: 'empleado', nombre: 'Franco' });
  const admin = await loginClient(context, 'ana@b.test');
  const franco = await loginClient(context, 'franco@b.test');
  // Precios de lista: lavado-basico 20.000 (auto) / 25.000 (suv); encerado 10.000 (auto); pulido "Consultá".
  await admin.patch('/api/admin/servicios/lavado-basico', { precioDesde: 20000, precioDesdeSuv: 25000 }).expect(200);
  await admin.patch('/api/admin/servicios/encerado', { precioDesde: 10000 }).expect(200);
  return { context, anaId, francoId, admin, franco };
}

async function filasDe(context: TestContext, bookingId: string) {
  const { rows } = await context.db.pg.query<{ servicio_id: string; orden: number; precio_lista: number | null }>(
    'SELECT servicio_id, orden, precio_lista FROM buddys.lavado_servicios WHERE booking_id = $1::uuid ORDER BY orden',
    [bookingId],
  );
  return rows;
}

describe('POST /api/admin/lavados con varios servicios', () => {
  it('guarda la lista en el orden elegido, con la foto del precio de lista; servicioId es el primero', async () => {
    const { context, admin } = await equipo();
    const response = await admin.post('/api/admin/lavados', {
      servicioIds: ['encerado', 'lavado-basico', 'pulido'],
      vehiculoTipo: 'suv',
      monto: 30000,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.lavado).toMatchObject({ servicioId: 'encerado', vehiculoTipo: 'suv', monto: 30000 });
    expect(response.body.lavado.servicios).toEqual([
      { id: 'encerado', nombre: 'Encerado', precioLista: null }, // sin precio de SUV: "Consultá" (no cae al de auto)
      { id: 'lavado-basico', nombre: 'Lavado Básico', precioLista: 25000 },
      { id: 'pulido', nombre: 'Pulido', precioLista: null },
    ]);
    const id = response.body.lavado.id as string;
    expect(await filasDe(context, id)).toEqual([
      { servicio_id: 'encerado', orden: 0, precio_lista: null },
      { servicio_id: 'lavado-basico', orden: 1, precio_lista: 25000 },
      { servicio_id: 'pulido', orden: 2, precio_lista: null },
    ]);

    // Es una foto: si después cambia el precio del catálogo, el lavado conserva el de ese momento.
    await admin.patch('/api/admin/servicios/lavado-basico', { precioDesdeSuv: 99000 }).expect(200);
    const { body } = await admin.get(`/api/admin/lavados?fecha=${HOY}`);
    expect(body.lavados[0].servicios[1]).toEqual({ id: 'lavado-basico', nombre: 'Lavado Básico', precioLista: 25000 });
  });

  it('compatibilidad: un servicioId suelto vale como [servicioId]; los dos juntos o ninguno => 400 en servicioIds', async () => {
    const { context, admin } = await equipo();
    const viejo = await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' });
    expect(viejo.status).toBe(201);
    expect(viejo.body.lavado.servicios).toEqual([{ id: 'lavado-basico', nombre: 'Lavado Básico', precioLista: 20000 }]);
    expect(viejo.body.lavado.servicioId).toBe('lavado-basico');

    const ambos = await admin.post('/api/admin/lavados', {
      servicioId: 'lavado-basico',
      servicioIds: ['lavado-basico'],
      vehiculoTipo: 'auto',
    });
    expect(ambos.status).toBe(400);
    expect(Object.keys(ambos.body.error.fields as object)).toEqual(['servicioIds']);

    const ninguno = await admin.post('/api/admin/lavados', { vehiculoTipo: 'auto' });
    expect(ninguno.status).toBe(400);
    expect(Object.keys(ninguno.body.error.fields as object)).toEqual(['servicioIds']);

    const { rows } = await context.db.pg.query<{ n: number }>('SELECT count(*)::int AS n FROM buddys.bookings');
    expect(rows[0]?.n).toBe(1);
  });

  const invalidos: [string, unknown][] = [
    ['lista vacía', []],
    ['repetidos', ['pulido', 'pulido']],
    ['más de 10', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11']],
    ['un id mal formado', ['pulido', 'Pulido!']],
    ['un texto en vez de lista', 'pulido'],
    ['números', [1]],
    ['inexistente', ['pulido', 'no-existe']],
    ['inactivo', ['pulido', 'encerado']],
    ['no se ofrece para el vehículo', ['lavado-basico', 'pulido']],
  ];

  it.each(invalidos)('servicioIds inválido (%s) => 400 en fields.servicioIds y no guarda nada', async (_label, servicioIds) => {
    const { context, admin } = await equipo();
    await admin.patch('/api/admin/servicios/encerado', { activo: false }).expect(200);
    await admin.patch('/api/admin/servicios/pulido', { vehiculos: ['auto'] }).expect(200);
    const response = await admin.post('/api/admin/lavados', { servicioIds, vehiculoTipo: 'moto' });
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(response.body.error.fields as object)).toEqual(['servicioIds']);
    const { rows } = await context.db.pg.query<{ n: number }>('SELECT count(*)::int AS n FROM buddys.lavado_servicios');
    expect(rows[0]?.n).toBe(0);
  });

  it('el mensaje dice qué servicio no se ofrece para el vehículo', async () => {
    const { admin } = await equipo();
    await admin.patch('/api/admin/servicios/pulido', { vehiculos: ['auto'] }).expect(200);
    const response = await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico', 'pulido'], vehiculoTipo: 'moto' });
    expect(response.body.error.fields).toEqual({ servicioIds: '"Pulido" no se ofrece para Moto. Sacalo de la lista.' });
  });

  it('acepta hasta 10 servicios distintos', async () => {
    const { context, admin } = await equipo();
    const ids = Array.from({ length: 10 }, (_, i) => `extra-${String(i)}`);
    for (const id of ids) {
      await admin
        .post('/api/admin/servicios', { id, nombre: `Extra ${id}`, resumen: 'Algo más.', descripcion: 'Algo más.' })
        .expect(201);
    }
    const response = await admin.post('/api/admin/lavados', { servicioIds: ids, vehiculoTipo: 'auto' });
    expect(response.status).toBe(201);
    expect((response.body.lavado.servicios as ServicioJson[]).map((s) => s.id)).toEqual(ids);
    expect((await filasDe(context, response.body.lavado.id as string)).map((f) => f.orden)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('el reintento con el mismo idLocal devuelve el original con sus servicios (200)', async () => {
    const { admin } = await equipo();
    const datos = {
      servicioIds: ['lavado-basico', 'encerado'],
      vehiculoTipo: 'auto',
      idLocal: '7f1c2d3e-4b5a-4c6d-8e7f-001122334455',
    };
    const primero = await admin.post('/api/admin/lavados', datos);
    expect(primero.status).toBe(201);
    const reintento = await admin.post('/api/admin/lavados', datos);
    expect(reintento.status).toBe(200);
    expect(reintento.body.lavado).toEqual(primero.body.lavado);
  });

  it('el empleado registra varios servicios pero nunca recibe los precios de lista (ni el monto)', async () => {
    const { franco, admin } = await equipo();
    const response = await franco.post('/api/admin/lavados', {
      servicioIds: ['lavado-basico', 'encerado'],
      vehiculoTipo: 'auto',
      monto: 30000,
    });
    expect(response.status).toBe(201);
    expect(response.body.lavado.monto).toBeNull();
    expect(response.body.lavado.servicios).toEqual([
      { id: 'lavado-basico', nombre: 'Lavado Básico', precioLista: null },
      { id: 'encerado', nombre: 'Encerado', precioLista: null },
    ]);
    for (const url of [`/api/admin/lavados?fecha=${HOY}`, '/api/admin/bookings', `/api/admin/agenda?desde=${HOY}&hasta=${HOY}`]) {
      const { body } = await franco.get(url);
      expect(JSON.stringify(body), url).not.toMatch(/"precioLista":\d/);
    }
    // El admin sí los ve.
    const { body } = await admin.get(`/api/admin/lavados?fecha=${HOY}`);
    expect((body.lavados[0].servicios as ServicioJson[]).map((s) => s.precioLista)).toEqual([20000, 10000]);
  });

  it('en la planilla y el ranking cuenta como UN lavado', async () => {
    const { admin, anaId } = await equipo();
    await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico', 'encerado', 'pulido'], vehiculoTipo: 'auto', monto: 30000 }).expect(201);
    await admin.post('/api/admin/lavados', { servicioIds: ['pulido'], vehiculoTipo: 'auto', monto: 5000 }).expect(201);
    const { body } = await admin.get(`/api/admin/lavados?fecha=${HOY}`);
    expect(body.resumen).toMatchObject({ cantidad: 2, total: 35000 });
    expect(body.resumen.porTrabajador).toEqual([{ trabajador: { id: anaId, nombre: 'Ana' }, cantidad: 2, total: 35000 }]);
  });

  it('deshacer el lavado se lleva sus servicios (ON DELETE CASCADE)', async () => {
    const { context, admin } = await equipo();
    const creado = await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico', 'encerado'], vehiculoTipo: 'auto' });
    const id = creado.body.lavado.id as string;
    expect(await filasDe(context, id)).toHaveLength(2);
    await admin.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await filasDe(context, id)).toEqual([]);
  });
});

describe('estadísticas por servicio: cada servicio cuenta', () => {
  it('servicios más pedidos cuenta cada servicio; los ingresos se reparten por precio de lista (o en partes iguales)', async () => {
    const { admin, franco } = await equipo();
    // 30.000 entre lavado-basico (lista 20.000) y encerado (lista 10.000): 20.000 y 10.000.
    await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico', 'encerado'], vehiculoTipo: 'auto', monto: 30000 }).expect(201);
    // 9.000 entre lavado-basico y pulido ("Consultá": sin precio): partes iguales, 4.500 y 4.500.
    await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico', 'pulido'], vehiculoTipo: 'auto', monto: 9000 }).expect(201);
    // Lo registra Franco: cuenta en sus trabajos.
    await franco.post('/api/admin/lavados', { servicioIds: ['encerado', 'pulido'], vehiculoTipo: 'auto' }).expect(201);

    const { body } = await admin.get(`/api/admin/estadisticas?desde=${HOY}&hasta=${HOY}`);
    const porId = new Map((body.porServicio as { servicioId: string }[]).map((fila) => [fila.servicioId, fila]));
    expect(porId.get('lavado-basico')).toMatchObject({ pedidos: 2, completados: 2, ingresos: 24500 });
    expect(porId.get('encerado')).toMatchObject({ pedidos: 2, completados: 2, ingresos: 10000 });
    expect(porId.get('pulido')).toMatchObject({ pedidos: 2, completados: 2, ingresos: 4500 });
    expect(body.porServicio[0].pedidos).toBe(2);
    // El total del período y el ranking cuentan turnos, no servicios.
    expect(body.periodo).toMatchObject({ turnos: 3, completados: 3, ingresos: 39000 });
    expect((body.porTrabajador as { completados: number }[]).reduce((s, f) => s + f.completados, 0)).toBe(3);

    const mias = await franco.get(`/api/admin/estadisticas/mias?desde=${HOY}&hasta=${HOY}`);
    expect(mias.body.completados).toBe(1);
    expect(mias.body.porServicio).toEqual([
      { servicioId: 'encerado', nombre: 'Encerado', completados: 1 },
      { servicioId: 'pulido', nombre: 'Pulido', completados: 1 },
    ]);
  });
});

describe('PATCH /api/admin/bookings/:id con servicioIds', () => {
  it('admin cambia la lista y el principal; los que quedan conservan su foto, los nuevos toman el precio vigente', async () => {
    const { context, admin } = await equipo();
    const creado = await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico', 'pulido'], vehiculoTipo: 'auto', monto: 1000 });
    const id = creado.body.lavado.id as string;
    await admin.patch('/api/admin/servicios/lavado-basico', { precioDesde: 77777 }).expect(200);
    context.clock.current = new Date('2026-10-16T15:01:00.000Z');

    const response = await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['encerado', 'lavado-basico'] });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.booking).toMatchObject({ servicioId: 'encerado', monto: 1000 });
    expect(response.body.booking.servicios).toEqual([
      { id: 'encerado', nombre: 'Encerado', precioLista: 10000 },
      { id: 'lavado-basico', nombre: 'Lavado Básico', precioLista: 20000 }, // la foto de antes, no 77.777
    ]);
    // El servicio se ve en el seguimiento: mueve updated_at.
    expect(response.body.booking.updatedAt).toBe('2026-10-16T15:01:00.000Z');
    const { rows } = await context.db.pg.query<{ servicio_id: string }>('SELECT servicio_id FROM buddys.bookings WHERE id = $1::uuid', [id]);
    expect(rows[0]?.servicio_id).toBe('encerado');

    // La misma lista otra vez no escribe nada.
    context.clock.current = new Date('2026-10-16T15:02:00.000Z');
    const igual = await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['encerado', 'lavado-basico'] });
    expect(igual.status, JSON.stringify(igual.body)).toBe(200);
    expect(igual.body.booking.updatedAt).toBe('2026-10-16T15:01:00.000Z');
  });

  it('junto con otros cambios, en la misma escritura; validaciones y permisos', async () => {
    const { context, admin, franco } = await equipo();
    const turno = await rawPost(context.app, '/api/bookings').send(validBooking({ servicioId: 'pulido', vehiculoTipo: 'auto' }));
    const id = (turno.body as { booking: { id: string } }).booking.id;

    const ok = await admin.patch(`/api/admin/bookings/${id}`, {
      estado: 'confirmado',
      notasInternas: 'Suma encerado',
      servicioIds: ['pulido', 'encerado'],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.booking).toMatchObject({ estado: 'confirmado', notasInternas: 'Suma encerado', servicioId: 'pulido' });
    expect((ok.body.booking.servicios as ServicioJson[]).map((s) => s.id)).toEqual(['pulido', 'encerado']);

    // El empleado no cambia servicios (403, antes de leer nada) y nada cambia.
    const prohibido = await franco.patch(`/api/admin/bookings/${id}`, { servicioIds: ['lavado-basico'] });
    expect(prohibido.status).toBe(403);
    expect(prohibido.body.error.code).toBe('FORBIDDEN');

    // Validaciones: 400 en fields.servicioIds y no se escribe nada (tampoco el estado que venía al lado).
    await admin.patch('/api/admin/servicios/lavado-basico', { activo: false }).expect(200);
    for (const servicioIds of [[], ['pulido', 'pulido'], ['lavado-basico'], ['no-existe'], 'pulido']) {
      const malo = await admin.patch(`/api/admin/bookings/${id}`, { estado: 'cancelado', servicioIds });
      expect(malo.status, JSON.stringify(servicioIds)).toBe(400);
      expect(Object.keys(malo.body.error.fields as object)).toEqual(['servicioIds']);
    }
    const { body } = await admin.get('/api/admin/bookings');
    expect(body.bookings[0]).toMatchObject({ estado: 'confirmado' });
    expect((body.bookings[0].servicios as ServicioJson[]).map((s) => s.id)).toEqual(['pulido', 'encerado']);

    // 404 si el turno no existe.
    expect((await admin.patch('/api/admin/bookings/11111111-1111-4111-8111-111111111111', { servicioIds: ['pulido'] })).status).toBe(404);
  });

  it('también al reprogramar; el seguimiento, el comprobante y su PDF dicen los nombres unidos con " + "', async () => {
    const { context, admin } = await equipo();
    const turno = await rawPost(context.app, '/api/bookings').send(validBooking({ servicioId: 'pulido', vehiculoTipo: 'auto' }));
    const id = (turno.body as { booking: { id: string } }).booking.id;
    const reprogramado = await admin.patch(`/api/admin/bookings/${id}`, {
      fechaConfirmada: '2026-10-21',
      franjaConfirmada: 'tarde',
      servicioIds: ['pulido', 'encerado'],
    });
    expect(reprogramado.status, JSON.stringify(reprogramado.body)).toBe(200);
    expect(reprogramado.body.booking).toMatchObject({ fechaConfirmada: '2026-10-21', servicioId: 'pulido' });

    const seguimiento = await createClient(context.app).get(`/api/turnos/${id}`);
    expect(seguimiento.body.turno.servicioNombre).toBe('Pulido + Encerado');

    await admin.patch(`/api/admin/bookings/${id}`, { estado: 'completado', monto: 50000 }).expect(200);
    const comprobante = await admin.post(`/api/admin/bookings/${id}/comprobante`, { formaPago: 'efectivo' });
    expect(comprobante.status).toBe(201);
    expect(comprobante.body.comprobante.servicioNombre).toBe('Pulido + Encerado');
  });
});
