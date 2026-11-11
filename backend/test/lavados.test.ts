import { afterEach, describe, expect, it } from 'vitest';
import {
  type TestContext,
  addUser,
  closeAllContexts,
  createClient,
  createTestContext,
  loginClient,
  rawPost,
  validBooking,
} from './helpers.js';

afterEach(closeAllContexts);

/** NOW de los tests: 2026-10-16 12:00 en La Rioja (viernes). */
const HOY = '2026-10-16';

async function equipo(options: Parameters<typeof createTestContext>[0] = {}) {
  const context = await createTestContext(options);
  const anaId = await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
  const francoId = await addUser(context, { email: 'franco@buddys.test', rol: 'empleado', nombre: 'Franco' });
  const nicoId = await addUser(context, { email: 'nico@buddys.test', rol: 'empleado', nombre: 'Nico' });
  const admin = await loginClient(context, 'ana@buddys.test');
  const franco = await loginClient(context, 'franco@buddys.test');
  return { context, admin, franco, anaId, francoId, nicoId };
}

const LAVADO = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;

async function filaDe(context: TestContext, id: string) {
  const { rows } = await context.db.sql.query(
    'SELECT monto, trabajador_id::text AS trabajador_id, origen, estado, telefono FROM buddys.bookings WHERE id = $1::uuid',
    [id],
  );
  return rows[0];
}

describe('POST /api/admin/lavados (Registrar lavado)', () => {
  it('admin registra un lavado a nombre de otra persona: nace completado, de mostrador y con su cobro', async () => {
    const { context, admin, nicoId } = await equipo();
    const response = await admin.post('/api/admin/lavados', {
      ...LAVADO,
      monto: 12000,
      trabajadorId: nicoId,
      nombre: 'Juan',
      telefono: '+54 9 380 412-3456',
      vehiculoModelo: 'Gol AB123CD',
      notasInternas: 'Pagó en efectivo',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.lavado).toMatchObject({
      origen: 'mostrador',
      estado: 'completado',
      servicioId: 'lavado-basico',
      vehiculoTipo: 'auto',
      vehiculoModelo: 'Gol AB123CD',
      nombre: 'Juan',
      telefono: '+54 9 380 412-3456',
      telefonoWhatsapp: '5493804123456',
      fechaPreferida: HOY,
      franja: 'manana',
      monto: 12000,
      trabajador: { id: nicoId, nombre: 'Nico' },
      notasInternas: 'Pagó en efectivo',
      turnosDelCliente: 1,
    });
    expect(await filaDe(context, response.body.lavado.id as string)).toMatchObject({ monto: 12000, trabajador_id: nicoId });
  });

  it('con lo mínimo: hoy, franja según la hora, a nombre de quien registra, sin teléfono y sin monto', async () => {
    const { context, admin, anaId } = await equipo();
    const manana = await admin.post('/api/admin/lavados', LAVADO);
    expect(manana.status, JSON.stringify(manana.body)).toBe(201);
    expect(manana.body.lavado).toMatchObject({
      nombre: 'Cliente de mostrador',
      telefono: null,
      telefonoWhatsapp: null,
      turnosDelCliente: null,
      fechaPreferida: HOY,
      franja: 'manana',
      monto: null,
      trabajador: { id: anaId },
    });

    context.clock.current = new Date('2026-10-16T18:30:00.000Z'); // 15:30 en La Rioja
    const tarde = await loginClient(context, 'ana@buddys.test');
    expect((await tarde.post('/api/admin/lavados', LAVADO)).body.lavado.franja).toBe('tarde');
  });

  it('se puede cargar uno de días anteriores (hasta 31) con su franja, pero no uno futuro', async () => {
    const { admin } = await equipo();
    const ayer = await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-10-15', franja: 'tarde' });
    expect(ayer.status).toBe(201);
    expect(ayer.body.lavado).toMatchObject({ fechaPreferida: '2026-10-15', franja: 'tarde' });

    expect((await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-09-15' })).status).toBe(201);
    const viejo = await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-09-14' });
    expect(viejo.status).toBe(400);
    expect(Object.keys(viejo.body.error.fields as object)).toEqual(['fecha']);
    const futuro = await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-10-17' });
    expect(futuro.status).toBe(400);
    expect(futuro.body.error.fields.fecha).toMatch(/futura/);
  });

  it('el empleado registra a su nombre con el monto, pero no lo ve en la respuesta ni puede anotar a otro', async () => {
    const { context, franco, francoId, nicoId } = await equipo();
    const response = await franco.post('/api/admin/lavados', { ...LAVADO, monto: 15000 });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.lavado).toMatchObject({ monto: null, trabajador: { id: francoId, nombre: 'Franco' } });
    expect(await filaDe(context, response.body.lavado.id as string)).toMatchObject({ monto: 15000, trabajador_id: francoId });

    expect((await franco.post('/api/admin/lavados', { ...LAVADO, trabajadorId: francoId })).status).toBe(201);
    const otro = await franco.post('/api/admin/lavados', { ...LAVADO, trabajadorId: nicoId });
    expect(otro.status).toBe(403);
    expect(otro.body.error.code).toBe('FORBIDDEN');
  });

  it('valida el servicio, el vehículo, el trabajador, el monto y rechaza campos desconocidos', async () => {
    const { context, admin } = await equipo();
    const campos = async (body: Record<string, unknown>) => {
      const response = await admin.post('/api/admin/lavados', body);
      expect(response.status, JSON.stringify(response.body)).toBe(400);
      return Object.keys((response.body.error.fields ?? {}) as object);
    };

    expect(await campos({ ...LAVADO, servicioId: 'no-existe' })).toEqual(['servicioId']);
    await context.db.sql.query("UPDATE buddys.servicios SET activo = false WHERE id = 'encerado'");
    expect(await campos({ ...LAVADO, servicioId: 'encerado' })).toEqual(['servicioId']);
    await context.db.sql.query("UPDATE buddys.servicios SET vehiculos = '{auto}' WHERE id = 'pulido'");
    expect(await campos({ servicioId: 'pulido', vehiculoTipo: 'moto' })).toEqual(['servicioId']);
    expect(await campos({ servicioId: 'lavado-basico' })).toEqual(['vehiculoTipo']);
    expect(await campos({ ...LAVADO, monto: -1 })).toEqual(['monto']);
    expect(await campos({ ...LAVADO, monto: 10.5 })).toEqual(['monto']);
    expect(await campos({ ...LAVADO, telefono: '123' })).toEqual(['telefono']);
    expect(await campos({ ...LAVADO, trabajadorId: 'x' })).toEqual(['trabajadorId']);
    expect(await campos({ ...LAVADO, trabajadorId: '11111111-1111-4111-8111-111111111111' })).toEqual(['trabajadorId']);
    expect(await campos({ ...LAVADO, estado: 'pendiente' })).toEqual(['estado']);
  });

  it('un trabajador desactivado no se puede elegir', async () => {
    const { context, admin, nicoId } = await equipo();
    await context.db.sql.query('UPDATE buddys.perfiles SET activo = false WHERE id = $1::uuid', [nicoId]);
    const response = await admin.post('/api/admin/lavados', { ...LAVADO, trabajadorId: nicoId });
    expect(response.status).toBe(400);
    expect(Object.keys(response.body.error.fields as object)).toEqual(['trabajadorId']);
  });

  it('sin sesión: 401; desde otro origen: 403 (CSRF)', async () => {
    const { context } = await equipo();
    expect((await createClient(context.app).post('/api/admin/lavados', LAVADO)).status).toBe(401);
    const admin = await loginClient(context, 'ana@buddys.test');
    const ajeno = await admin.agent
      .post('/api/admin/lavados')
      .set('Origin', 'https://otro-sitio.example')
      .set('Content-Type', 'application/json')
      .send(LAVADO);
    expect(ajeno.status).toBe(403);
  });

  it('no guarda importes ni datos del cliente en el log', async () => {
    const { context, admin } = await equipo();
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 987654, nombre: 'Secreto', telefono: '3804111222' });
    expect(context.logger.text).toMatch(/Lavado registrado id=/);
    for (const dato of ['987654', 'Secreto', '3804111222']) expect(context.logger.text).not.toContain(dato);
  });
});

describe('los lavados cuentan en todo el sistema', () => {
  it('entran en las estadísticas: ingresos y ranking del equipo (quién lava más)', async () => {
    const { admin, francoId, nicoId } = await equipo();
    for (let i = 0; i < 3; i += 1) await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, trabajadorId: francoId });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 25000, trabajadorId: nicoId });

    const stats = await admin.get(`/api/admin/estadisticas?desde=${HOY}&hasta=${HOY}`);
    expect(stats.status, JSON.stringify(stats.body)).toBe(200);
    expect(stats.body.periodo).toMatchObject({ completados: 4, ingresos: 55000 });
    expect(stats.body.porTrabajador.slice(0, 2)).toEqual([
      { id: francoId, nombre: 'Franco', completados: 3, ingresos: 30000 },
      { id: nicoId, nombre: 'Nico', completados: 1, ingresos: 25000 },
    ]);
  });

  it('no ocupan cupo de la agenda: con la franja llena de lavados, la web todavía toma turnos', async () => {
    const { admin, context } = await equipo({ disponibilidad: 'fabrica' }); // 2 por franja
    for (let i = 0; i < 3; i += 1) expect((await admin.post('/api/admin/lavados', { ...LAVADO, franja: 'manana' })).status).toBe(201);

    const agenda = await admin.get(`/api/admin/agenda?desde=${HOY}&hasta=${HOY}`);
    expect(agenda.body.cupos[0]).toMatchObject({ fecha: HOY, ocupadosManana: 0 });
    expect(agenda.body.turnos).toHaveLength(3);
    const turno = await rawPost(context.app, '/api/bookings').send(validBooking({ fechaPreferida: HOY, franja: 'manana' }));
    expect(turno.status, JSON.stringify(turno.body)).toBe(201);
  });

  it('se corrigen y se borran como cualquier turno (PATCH / DELETE de bookings)', async () => {
    const { admin, nicoId } = await equipo();
    const { id } = (await admin.post('/api/admin/lavados', { ...LAVADO, monto: 1000 })).body.lavado as { id: string };
    const corregido = await admin.patch(`/api/admin/bookings/${id}`, { monto: 12000, trabajadorId: nicoId });
    expect(corregido.body.booking).toMatchObject({ monto: 12000, trabajador: { id: nicoId }, origen: 'mostrador' });
    expect((await admin.delete(`/api/admin/bookings/${id}`)).status).toBe(204);
  });

  it('la base exige teléfono en los pedidos web; solo el de mostrador puede no tenerlo', async () => {
    const { context } = await equipo();
    await expect(
      context.db.sql.query(
        "INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja) VALUES ('X', NULL, 'auto', 'pulido', '2026-10-16', 'manana')",
      ),
    ).rejects.toThrow(/bookings_telefono_obligatorio_web/);
    await expect(
      context.db.sql.query(
        "INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, origen) VALUES ('X', NULL, 'auto', 'pulido', '2026-10-16', 'manana', 'otro')",
      ),
    ).rejects.toThrow(/bookings_origen_valido/);
  });
});

describe('GET /api/admin/lavados (planilla del día)', () => {
  it('lista los lavados del día con el total y quién lavó más', async () => {
    const { admin, anaId, francoId, nicoId } = await equipo();
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, trabajadorId: nicoId });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, trabajadorId: francoId });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 12000, trabajadorId: francoId });
    await admin.post('/api/admin/lavados', { ...LAVADO, trabajadorId: anaId });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 5000, fecha: '2026-10-15' });

    const response = await admin.get('/api/admin/lavados');
    expect(response.status).toBe(200);
    expect(response.body.fecha).toBe(HOY);
    expect(response.body.lavados).toHaveLength(4);
    expect(response.body.resumen).toEqual({
      cantidad: 4,
      total: 32000,
      sinMonto: 1,
      porTrabajador: [
        { trabajador: { id: francoId, nombre: 'Franco' }, cantidad: 2, total: 22000 },
        { trabajador: { id: nicoId, nombre: 'Nico' }, cantidad: 1, total: 10000 },
        { trabajador: { id: anaId, nombre: 'Ana' }, cantidad: 1, total: 0 },
      ],
    });

    const ayer = await admin.get('/api/admin/lavados?fecha=2026-10-15');
    expect(ayer.body.resumen).toMatchObject({ cantidad: 1, total: 5000 });
    expect((await admin.get('/api/admin/lavados?fecha=2026-02-30')).status).toBe(400);
  });

  it('el empleado ve los lavados y la cantidad de cada uno, sin importes', async () => {
    const { admin, franco, francoId } = await equipo();
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 10000, trabajadorId: francoId });
    const response = await franco.get('/api/admin/lavados');
    expect(response.body.lavados[0].monto).toBeNull();
    expect(response.body.resumen).toMatchObject({ cantidad: 1, total: null });
    expect(response.body.resumen.porTrabajador[0]).toEqual({ trabajador: { id: francoId, nombre: 'Franco' }, cantidad: 1, total: null });
  });

  it('para el empleado, el orden del ranking no depende de lo cobrado (no revela quién cobró más)', async () => {
    const { admin, franco, francoId, nicoId } = await equipo();
    // Mismo número de lavados; Nico cobró más. Para el admin, Nico primero; para el empleado, por nombre.
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 1000, trabajadorId: francoId });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 50000, trabajadorId: nicoId });
    const ids = (r: { body: { resumen: { porTrabajador: { trabajador: { id: string } }[] } } }) =>
      r.body.resumen.porTrabajador.map((f) => f.trabajador.id);
    expect(ids(await admin.get('/api/admin/lavados'))).toEqual([nicoId, francoId]);
    expect(ids(await franco.get('/api/admin/lavados'))).toEqual([francoId, nicoId]);
  });

  it('un lavado cancelado no cuenta en la planilla', async () => {
    const { admin } = await equipo();
    const { id } = (await admin.post('/api/admin/lavados', { ...LAVADO, monto: 1000 })).body.lavado as { id: string };
    await admin.patch(`/api/admin/bookings/${id}`, { estado: 'cancelado' });
    expect((await admin.get('/api/admin/lavados')).body.resumen).toMatchObject({ cantidad: 0, total: 0 });
  });
});

describe('sistema interno: sin TURNOS_ONLINE no hay rutas públicas', () => {
  it('las rutas de la web dan 404 y el panel sigue funcionando', async () => {
    const context = await createTestContext({ config: { turnosOnline: false } });
    await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    const anonimo = createClient(context.app);
    for (const ruta of ['/api/servicios', `/api/disponibilidad?desde=${HOY}&hasta=${HOY}`, '/api/turnos/11111111-1111-4111-8111-111111111111']) {
      expect((await anonimo.get(ruta)).status, ruta).toBe(404);
    }
    expect((await rawPost(context.app, '/api/bookings').send(validBooking())).status).toBe(404);
    expect((await anonimo.get('/api/health')).status).toBe(200);

    const admin = await loginClient(context, 'ana@buddys.test');
    expect((await admin.post('/api/admin/lavados', { ...LAVADO, monto: 1000 })).status).toBe(201);
  });
});
