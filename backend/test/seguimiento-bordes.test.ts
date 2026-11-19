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

/*
 * Casos límite del contrato 2026-11-17_05 (seguimiento sin ranking): `registradoPor` en todas las respuestas del panel
 * con turnos (también historial de cliente y búsqueda) y en ninguna pública; el nombre sin email entero también tras
 * una baja real; "Mis trabajos" en el borde de año con el servidor en UTC, en un 29/02, y sin contar dos veces.
 */

afterEach(closeAllContexts);

const LAVADO = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;

async function conTz<T>(tz: string, fn: () => Promise<T>): Promise<T> {
  const antes = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

async function turno(
  context: TestContext,
  t: { fecha: string; trabajador?: string | null; registradoPor?: string | null; estado?: string },
): Promise<string> {
  const { rows } = await context.db.sql.query(
    `INSERT INTO buddys.bookings
       (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, trabajador_id, registrado_por)
     VALUES ('Cliente', '12345678', 'auto', 'pulido', $1::date, 'manana', $2, $3::uuid, $4::uuid)
     RETURNING id::text AS id`,
    [t.fecha, t.estado ?? 'completado', t.trabajador ?? null, t.registradoPor ?? null],
  );
  return String(rows[0]?.id);
}

describe('registradoPor en historial de cliente y búsqueda; nunca en lo público', () => {
  it('el empleado lo recibe en ?cliente= y ?q=; /api/turnos/:id y POST /api/bookings no lo traen', async () => {
    const context = await createTestContext();
    const anaId = await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    await addUser(context, { email: 'franco@buddys.test', rol: 'empleado', nombre: 'Franco' });
    const admin = await loginClient(context, 'ana@buddys.test');
    const franco = await loginClient(context, 'franco@buddys.test');

    const lavado = await admin.post('/api/admin/lavados', {
      ...LAVADO,
      monto: 7777,
      nombre: 'Zacarías Buscable',
      telefono: '+54 9 380 412-3456',
    });
    expect(lavado.status, JSON.stringify(lavado.body)).toBe(201);
    const web = await rawPost(context.app, '/api/bookings').send(validBooking({ nombre: 'Zacarías Web' }));
    expect(web.status, JSON.stringify(web.body)).toBe(201);
    expect(web.body.booking).not.toHaveProperty('registradoPor');
    expect(web.body.booking).not.toHaveProperty('trabajador');

    for (const ruta of ['/api/admin/bookings?cliente=5493804123456', '/api/admin/bookings?q=zacarias']) {
      const response = await franco.get(ruta);
      expect(response.status, ruta).toBe(200);
      const lista = response.body.bookings as { id: string; registradoPor: unknown; monto: unknown }[];
      expect(lista.length, ruta).toBeGreaterThan(0);
      for (const b of lista) expect(b, ruta).toHaveProperty('registradoPor');
      expect(lista.find((b) => b.id === lavado.body.lavado.id)?.registradoPor, ruta).toEqual({ id: anaId, nombre: 'Ana' });
      expect(JSON.stringify(response.body), ruta).not.toContain('7777');
    }
    const buscado = (await franco.get('/api/admin/bookings?q=zacarias')).body.bookings as { id: string; registradoPor: unknown }[];
    expect(buscado.find((b) => b.id === web.body.booking.id)?.registradoPor).toBeNull();

    for (const id of [String(lavado.body.lavado.id), String(web.body.booking.id)]) {
      const publico = await createClient(context.app).get(`/api/turnos/${id}`);
      expect(publico.status).toBe(200);
      expect(JSON.stringify(publico.body)).not.toMatch(/registradoPor|trabajador|Ana/);
    }
  });

  it('id mal formado en el PATCH: el mismo 404 que uno inexistente (README), nunca un 500', async () => {
    const context = await createTestContext();
    await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    const admin = await loginClient(context, 'ana@buddys.test');
    for (const id of ['no-es-uuid', '123', "1' OR '1'='1"]) {
      const response = await admin.patch(`/api/admin/bookings/${encodeURIComponent(id)}`, { notasInternas: 'x' });
      expect(response.status, id).toBe(404);
      expect(response.body.error.code, id).toBe('NOT_FOUND');
    }
  });
});

describe('nombre de quien registró tras una baja real (sin nombre cargado)', () => {
  it('el empleado ve la parte antes de la @, nunca el email', async () => {
    const context = await createTestContext();
    await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    const sinNombre = await addUser(context, { email: 'lucia.perez@correo.test', rol: 'empleado', nombre: null });
    await addUser(context, { email: 'franco@buddys.test', rol: 'empleado', nombre: 'Franco' });
    const admin = await loginClient(context, 'ana@buddys.test');
    const lucia = await loginClient(context, 'lucia.perez@correo.test');
    const franco = await loginClient(context, 'franco@buddys.test');

    const { id } = (await lucia.post('/api/admin/lavados', LAVADO)).body.lavado as { id: string };
    const baja = await admin.delete(`/api/admin/usuarios/${sinNombre}`);
    expect(baja.body, JSON.stringify(baja.body)).toMatchObject({ resultado: 'baja' });

    for (const ruta of ['/api/admin/lavados', '/api/admin/bookings', '/api/admin/agenda?desde=2026-10-16&hasta=2026-10-16']) {
      const response = await franco.get(ruta);
      expect(response.status, ruta).toBe(200);
      expect(JSON.stringify(response.body), ruta).not.toMatch(/@correo\.test|buddys\.invalid|baja\+/);
    }
    const lavados = (await franco.get('/api/admin/lavados')).body.lavados as { id: string; registradoPor: unknown }[];
    expect(lavados.find((l) => l.id === id)?.registradoPor).toEqual({ id: sinNombre, nombre: 'lucia.perez' });
  });
});

describe('"Mis trabajos" en los bordes', () => {
  it('31/12 a las 23:30 de La Rioja con el servidor en UTC (ya es 1/1): cuenta diciembre, incluido un turno web que completé', async () => {
    await conTz('UTC', async () => {
      const context = await createTestContext({ now: new Date('2027-01-01T02:30:00.000Z') });
      const anaId = await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
      const betoId = await addUser(context, { email: 'beto@buddys.test', rol: 'empleado', nombre: 'Beto' });
      const beto = await loginClient(context, 'beto@buddys.test');

      // Registrado por mí ahora (fecha por omisión = hoy en La Rioja = 31/12).
      const mio = await beto.post('/api/admin/lavados', { ...LAVADO, monto: 4321 });
      expect(mio.status, JSON.stringify(mio.body)).toBe(201);
      expect(mio.body.lavado.fechaPreferida).toBe('2026-12-31');
      // Turno web que completé (sin registrado_por).
      const web = await rawPost(context.app, '/api/bookings').send(validBooking({ fechaPreferida: '2026-12-31' }));
      expect(web.status, JSON.stringify(web.body)).toBe(201);
      const completado = await beto.patch(`/api/admin/bookings/${String(web.body.booking.id)}`, { estado: 'completado' });
      expect(completado.status, JSON.stringify(completado.body)).toBe(200);
      expect(completado.body.booking).toMatchObject({ registradoPor: null, trabajador: { id: betoId } });
      // Lo registré yo y figura otro trabajador: cuenta una sola vez.
      await turno(context, { fecha: '2026-12-01', trabajador: anaId, registradoPor: betoId });
      // Registrado por Ana con trabajador Beto: de Ana.
      await turno(context, { fecha: '2026-12-15', trabajador: betoId, registradoPor: anaId });
      // Fuera del mes: 30/11 y 1/1.
      await turno(context, { fecha: '2026-11-30', registradoPor: betoId });
      await turno(context, { fecha: '2027-01-01', registradoPor: betoId });

      const mias = await beto.get('/api/admin/estadisticas/mias');
      expect(mias.status).toBe(200);
      expect(mias.body.rango).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
      expect(mias.body.completados).toBe(3);
      expect(mias.body.serie).toHaveLength(31);
      expect(mias.body.serie[0]).toEqual({ clave: '2026-12-01', completados: 1 });
      expect(mias.body.serie[14]).toEqual({ clave: '2026-12-15', completados: 0 });
      expect(mias.body.serie[30]).toEqual({ clave: '2026-12-31', completados: 2 });
      expect(JSON.stringify(mias.body)).not.toMatch(/ingresos|monto|4321/);

      // Pasada la medianoche de La Rioja: enero, solo el del 1/1.
      context.clock.current = new Date('2027-01-01T03:00:00.000Z');
      const enero = await (await loginClient(context, 'beto@buddys.test')).get('/api/admin/estadisticas/mias');
      expect(enero.body.rango).toEqual({ desde: '2027-01-01', hasta: '2027-01-01' });
      expect(enero.body.completados).toBe(1);

      // Año entero: por mes, sin contar dos veces.
      const anio = await beto.get('/api/admin/estadisticas/mias?desde=2026-01-01&hasta=2026-12-31');
      expect(anio.body.completados).toBe(4);
      expect(anio.body.serie[10]).toEqual({ clave: '2026-11', completados: 1 });
      expect(anio.body.serie[11]).toEqual({ clave: '2026-12', completados: 3 });
    });
  });

  it('29/02 de un bisiesto entra en la serie diaria', async () => {
    const context = await createTestContext();
    const betoId = await addUser(context, { email: 'beto@buddys.test', rol: 'empleado', nombre: 'Beto' });
    const beto = await loginClient(context, 'beto@buddys.test');
    await turno(context, { fecha: '2028-02-29', registradoPor: betoId });
    await turno(context, { fecha: '2028-02-29', trabajador: betoId });
    const { body } = await beto.get('/api/admin/estadisticas/mias?desde=2028-02-28&hasta=2028-03-01');
    expect(body.serie).toEqual([
      { clave: '2028-02-28', completados: 0 },
      { clave: '2028-02-29', completados: 2 },
      { clave: '2028-03-01', completados: 0 },
    ]);
    expect(body.completados).toBe(2);
  });
});

describe('compatibilidad: POST /api/admin/lavados con trabajadorId', () => {
  it('el admin anota a otra persona: trabajador es ella, registradoPor es el admin, y cuenta en "mis trabajos" del admin', async () => {
    const context = await createTestContext();
    const anaId = await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    const betoId = await addUser(context, { email: 'beto@buddys.test', rol: 'empleado', nombre: 'Beto' });
    const admin = await loginClient(context, 'ana@buddys.test');
    const beto = await loginClient(context, 'beto@buddys.test');
    const response = await admin.post('/api/admin/lavados', { ...LAVADO, trabajadorId: betoId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.lavado).toMatchObject({
      trabajador: { id: betoId, nombre: 'Beto' },
      registradoPor: { id: anaId, nombre: 'Ana' },
    });
    expect((await admin.get('/api/admin/estadisticas/mias')).body.completados).toBe(1);
    expect((await beto.get('/api/admin/estadisticas/mias')).body.completados).toBe(0);
    // El empleado sigue sin poder anotar a otro.
    expect((await beto.post('/api/admin/lavados', { ...LAVADO, trabajadorId: anaId })).status).toBe(403);
  });
});
