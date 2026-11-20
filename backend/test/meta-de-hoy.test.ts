import { afterEach, describe, expect, it } from 'vitest';
import { calcularMetaDeHoy } from '../src/domain/metas.js';
import { type TestContext, closeAllContexts, createClient, createTestContext, loginAs } from './helpers.js';

// Contrato: reportes/2026-11-19_09_meta-de-hoy.md. Hoy en los tests: 2026-10-16 (viernes), 12:00 en La Rioja.

afterEach(closeAllContexts);

async function completados(context: TestContext, fecha: string, cantidad: number, monto: number | null = 9000) {
  for (let i = 0; i < cantidad; i++) {
    await context.db.sql.query(
      `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, monto)
       VALUES ('Cliente', '12345678', 'auto', 'pulido', $1::date, 'manana', 'completado', $2)`,
      [fecha, monto],
    );
  }
}

describe('dominio: calcularMetaDeHoy', () => {
  const base = { trabajosObjetivo: 40, hechosHastaAyer: 10, hechosHoy: 3, hoyAbierto: true, diasRestantesSinHoy: 15 };

  it('lo que faltaba al empezar el día, repartido en los días que quedan contando hoy, para arriba', () => {
    // faltan 30 en 16 días = 1,875 → 2
    expect(calcularMetaDeHoy(base)).toEqual({ hechos: 3, objetivo: 2, mesCumplido: false });
  });

  it('el último día del mes pide todo lo que falta', () => {
    expect(calcularMetaDeHoy({ ...base, diasRestantesSinHoy: 0 })).toEqual({ hechos: 3, objetivo: 30, mesCumplido: false });
  });

  it('lo de hoy no corre el objetivo: con 20 hechos hoy, el objetivo sigue siendo 2', () => {
    expect(calcularMetaDeHoy({ ...base, hechosHoy: 20 })).toEqual({ hechos: 20, objetivo: 2, mesCumplido: false });
  });

  it('mes cumplido al empezar el día: objetivo 0 y mesCumplido', () => {
    expect(calcularMetaDeHoy({ ...base, hechosHastaAyer: 45 })).toEqual({ hechos: 3, objetivo: 0, mesCumplido: true });
  });

  it('sin meta de lavados o con el día cerrado no hay meta de hoy', () => {
    expect(calcularMetaDeHoy({ ...base, trabajosObjetivo: null })).toBeNull();
    expect(calcularMetaDeHoy({ ...base, hoyAbierto: false })).toBeNull();
  });
});

describe('GET /api/admin/metas/hoy', () => {
  it('los tres roles la ven, solo con cantidades de lavados (nunca pesos)', async () => {
    const context = await createTestContext();
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    const empleado = (await loginAs(context, 'empleado', 'beto@t.test')).client;
    const superadmin = (await loginAs(context, 'superadmin', 'jefe@t.test')).client;
    expect((await admin.put('/api/admin/metas/2026-10', { trabajosObjetivo: 40, ingresosObjetivo: 1_500_000 })).status).toBe(200);
    await completados(context, '2026-10-05', 6);
    await completados(context, '2026-10-15', 4);
    await completados(context, '2026-10-16', 3);
    await completados(context, '2026-09-30', 50); // otro mes: no cuenta

    // Octubre con todos los días abiertos ('libre'): después del 16 quedan 15. Faltan 30 en 16 días → 2.
    const esperado = { fecha: '2026-10-16', lavados: { hechos: 3, objetivo: 2, mesCumplido: false } };
    for (const cliente of [admin, empleado, superadmin]) {
      const r = await cliente.get('/api/admin/metas/hoy');
      expect(r.status).toBe(200);
      expect(r.body).toEqual(esperado);
    }
    // El resto de las metas sigue siendo solo para admin y superadmin.
    expect((await empleado.get('/api/admin/metas/actual')).status).toBe(403);
  });

  it('sin meta de lavados en el mes (solo de ingresos), o sin meta: lavados null', async () => {
    const context = await createTestContext();
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-16', lavados: null });
    await admin.put('/api/admin/metas/2026-10', { ingresosObjetivo: 1_500_000 });
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-16', lavados: null });
  });

  it('hoy cerrado (día especial): lavados null', async () => {
    const context = await createTestContext();
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    await admin.put('/api/admin/metas/2026-10', { trabajosObjetivo: 40 });
    await context.db.sql.query(
      "INSERT INTO buddys.dias_especiales (fecha, abierto, cupo_manana, cupo_tarde, motivo) VALUES ('2026-10-16', false, null, null, 'Cerrado')",
    );
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-16', lavados: null });
  });

  it('el día 1 del mes no hay "hasta ayer": todo lo del mes se reparte desde hoy', async () => {
    const context = await createTestContext({ now: new Date('2026-10-01T15:00:00.000Z') });
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    await admin.put('/api/admin/metas/2026-10', { trabajosObjetivo: 62 });
    await completados(context, '2026-10-01', 1);
    // 62 en los 31 días de octubre → 2
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-01', lavados: { hechos: 1, objetivo: 2, mesCumplido: false } });
  });

  it('cerca de medianoche manda la hora de La Rioja: 23:30 del 31/10 (02:30 UTC del 1/11) es el último día de octubre', async () => {
    const context = await createTestContext({ now: new Date('2026-11-01T02:30:00.000Z') });
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    await admin.put('/api/admin/metas/2026-10', { trabajosObjetivo: 40 });
    await admin.put('/api/admin/metas/2026-11', { trabajosObjetivo: 300 });
    await completados(context, '2026-10-05', 10);
    await completados(context, '2026-10-31', 2);
    await completados(context, '2026-11-01', 5); // noviembre: no cuenta todavía
    // Último día de octubre: pide todo lo que falta (30), sin repartir.
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-31', lavados: { hechos: 2, objetivo: 30, mesCumplido: false } });

    // 00:30 del 1/11 en La Rioja: ya es noviembre (300 en 30 días = 10) y lo de octubre no cuenta.
    context.clock.current = new Date('2026-11-01T03:30:00.000Z');
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-11-01', lavados: { hechos: 5, objetivo: 10, mesCumplido: false } });
  });

  it('los turnos cancelados, pendientes o confirmados no cuentan como lavados', async () => {
    const context = await createTestContext();
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    await admin.put('/api/admin/metas/2026-10', { trabajosObjetivo: 16 });
    for (const estado of ['cancelado', 'pendiente', 'confirmado']) {
      for (const fecha of ['2026-10-10', '2026-10-16']) {
        await context.db.sql.query(
          `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado)
           VALUES ('Cliente', '12345678', 'auto', 'pulido', $1::date, 'manana', $2)`,
          [fecha, estado],
        );
      }
    }
    // Nada completado: faltan 16 en 16 días → 1, y hoy van 0.
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-16', lavados: { hechos: 0, objetivo: 1, mesCumplido: false } });
  });

  it('febrero bisiesto: el 28/2/2028 quedan dos días (28 y 29)', async () => {
    const context = await createTestContext({ now: new Date('2028-02-28T15:00:00.000Z') });
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    await admin.put('/api/admin/metas/2028-02', { trabajosObjetivo: 100 });
    await completados(context, '2028-02-10', 95);
    // Faltan 5 en 2 días → 3.
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2028-02-28', lavados: { hechos: 0, objetivo: 3, mesCumplido: false } });
  });

  it('con el mes ya cumplido al empezar el día: objetivo 0, mesCumplido y los de hoy en hechos', async () => {
    const context = await createTestContext();
    const admin = (await loginAs(context, 'admin', 'ana@t.test')).client;
    await admin.put('/api/admin/metas/2026-10', { trabajosObjetivo: 5 });
    await completados(context, '2026-10-02', 5);
    await completados(context, '2026-10-16', 2);
    expect((await admin.get('/api/admin/metas/hoy')).body).toEqual({ fecha: '2026-10-16', lavados: { hechos: 2, objetivo: 0, mesCumplido: true } });
  });

  it('sin sesión: 401', async () => {
    const context = await createTestContext();
    expect((await createClient(context.app).get('/api/admin/metas/hoy')).status).toBe(401);
  });
});
