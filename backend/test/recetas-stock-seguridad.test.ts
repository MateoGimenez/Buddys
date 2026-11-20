import { afterEach, describe, expect, it } from 'vitest';
import { type SqlClient, verifyPostgresSchema } from '../src/db/postgres.js';
import { PostgresInventarioRepository } from '../src/repositories/postgres/inventario.js';
import { textoDeUnaLinea } from '../src/schemas/finanzas.js';
import { createServicioSchema } from '../src/schemas/servicios.js';
import { nombreSchema } from '../src/schemas/usuarios.js';
import { type Client, type TestContext, addUser, closeAllContexts, createTestContext, loginClient } from './helpers.js';
import { createPgliteDatabase } from './pglite.js';

afterEach(closeAllContexts);

/*
 * Hallazgos de la auditoría de seguridad del objetivo D (reportes/2026-11-17_06_recetas-stock-avisos.md): el origen
 * del movimiento no sale de la nota, los separadores de línea de Unicode, el orden de los bloqueos de un uso vinculado
 * a un lavado. La CSP está en security.test.ts.
 */

async function equipo() {
  const context = await createTestContext();
  await context.db.sql.query("UPDATE buddys.servicios SET activo = true, vehiculos = ARRAY['auto','suv','pickup','moto'] WHERE id IN ('lavado-basico', 'encerado')");
  await addUser(context, { email: 'ana@s.test', rol: 'admin', nombre: 'Ana' });
  await addUser(context, { email: 'beto@s.test', rol: 'empleado', nombre: 'Beto' });
  return { context, admin: await loginClient(context, 'ana@s.test'), empleado: await loginClient(context, 'beto@s.test') };
}

async function insumo(admin: Client, nombre: string, stockInicial: number): Promise<string> {
  const r = await admin.post('/api/admin/insumos', { nombre, unidad: 'ml', stockInicial });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.insumo.id);
}

async function stock(context: TestContext, id: string): Promise<number> {
  const { rows } = await context.db.sql.query('SELECT stock::float8 AS s FROM buddys.insumos WHERE id = $1::uuid', [id]);
  return Number(rows[0]?.s);
}

describe('origen de los movimientos: nunca sale de la nota', () => {
  it('un uso manual con la nota "Receta: ..." y el turno de un lavado no se devuelve cuando un admin corrige el lavado', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, 'Shampoo', 100);
    const receta = await admin.put('/api/admin/servicios/lavado-basico/receta', { vehiculo: null, items: [{ insumoId: shampoo, cantidad: 10 }] });
    expect(receta.status).toBe(200);
    const lavado = await empleado.post('/api/admin/lavados', { servicioIds: ['lavado-basico'], vehiculoTipo: 'auto' });
    expect(lavado.status).toBe(201);
    const turnoId = String(lavado.body.lavado.id);
    expect(await stock(context, shampoo)).toBe(90);

    // El ataque: un uso manual que se hace pasar por el de la receta.
    const falso = await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, {
      tipo: 'uso',
      cantidad: 30,
      nota: 'Receta: Lavado completo',
      turnoId,
    });
    expect(falso.status, JSON.stringify(falso.body)).toBe(201);
    expect(await stock(context, shampoo)).toBe(60);

    // El admin corrige el lavado (otro servicio, sin receta): se devuelve solo lo de la receta (10), no el uso manual.
    await admin.patch(`/api/admin/bookings/${turnoId}`, { servicioIds: ['encerado'] }).expect(200);
    expect(await stock(context, shampoo)).toBe(70);

    const { rows } = await context.db.sql.query(
      `SELECT tipo, origen, cantidad::float8 AS cantidad FROM buddys.movimientos_stock
       WHERE turno_id = $1::uuid ORDER BY created_at, id`,
      [turnoId],
    );
    expect(rows).toEqual([
      { tipo: 'uso', origen: 'receta', cantidad: -10 },
      { tipo: 'uso', origen: 'manual', cantidad: -30 },
      { tipo: 'devolucion', origen: 'receta', cantidad: 10 },
    ]);

    // Deshacer el lavado devuelve todo lo que queda vinculado (el uso manual también), cada cosa con su origen.
    await admin.delete(`/api/admin/lavados/${turnoId}`).expect(204);
    expect(await stock(context, shampoo)).toBe(100);
    const devoluciones = await context.db.sql.query(
      "SELECT origen, cantidad::float8 AS cantidad FROM buddys.movimientos_stock WHERE insumo_id = $1::uuid AND tipo = 'devolucion' ORDER BY origen, cantidad",
      [shampoo],
    );
    expect(devoluciones.rows).toEqual([
      { origen: 'manual', cantidad: 30 },
      { origen: 'receta', cantidad: 10 },
    ]);
  });

  it('la API manual no puede poner origen: 400 por campo desconocido y lo cargado a mano queda en manual', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, 'Shampoo', 100);
    for (const body of [
      { tipo: 'uso', cantidad: 1, origen: 'receta' },
      { tipo: 'compra', cantidad: 1, origen: 'receta' },
      { tipo: 'ajuste', stockReal: 5, origen: 'receta' },
    ]) {
      const r = await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 1, nota: 'Receta: x' }).expect(201);
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 1 }).expect(201);
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'ajuste', stockReal: 50 }).expect(201);
    const { rows } = await context.db.sql.query('SELECT DISTINCT origen FROM buddys.movimientos_stock WHERE insumo_id = $1::uuid', [shampoo]);
    expect(rows).toEqual([{ origen: 'manual' }]);
  });
});

describe('arranque: verifyPostgresSchema', () => {
  it('exige movimientos_stock.origen (migración recetas_stock)', async () => {
    const db = await createPgliteDatabase();
    try {
      await expect(verifyPostgresSchema(db.appSql)).resolves.toBeUndefined();
      await db.sql.query('ALTER TABLE buddys.movimientos_stock DROP COLUMN origen');
      await expect(verifyPostgresSchema(db.appSql)).rejects.toThrow(/movimientos_stock\.origen/);
    } finally {
      await db.close();
    }
  });
});

describe('orden de los bloqueos de un uso vinculado a un lavado', () => {
  /** Un SqlClient que anota cada consulta y no devuelve filas (el insumo "no existe": registrarMovimiento corta ahí). */
  function grabador(): { sql: SqlClient; consultas: string[] } {
    const consultas: string[] = [];
    const sql: SqlClient = {
      query: (text) => {
        consultas.push(text);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      transaction: (fn) => fn(sql),
    };
    return { sql, consultas };
  }

  const contexto = { perfilId: '00000000-0000-4000-8000-000000000001', hoy: '2026-10-16', ahora: new Date('2026-10-16T15:00:00Z') };
  const INSUMO = '00000000-0000-4000-8000-0000000000aa';
  const TURNO = '00000000-0000-4000-8000-0000000000bb';

  it('primero el turno (FOR KEY SHARE) y después el insumo, como deshacer y corregir; un insumo inexistente sigue siendo 404', async () => {
    const { sql, consultas } = grabador();
    const repo = new PostgresInventarioRepository(sql);
    const r = await repo.registrarMovimiento(INSUMO, { tipo: 'uso', cantidad: 1, nota: null, turnoId: TURNO }, contexto);
    expect(r).toBeNull(); // sin TurnoInexistenteError: primero se informa el insumo
    const turno = consultas.findIndex((q) => /FROM buddys\.bookings .*FOR KEY SHARE/s.test(q));
    const insumoLock = consultas.findIndex((q) => q.includes('pg_advisory_xact_lock'));
    const insumoFila = consultas.findIndex((q) => /FROM buddys\.insumos .*FOR UPDATE/s.test(q));
    expect(turno).toBe(0);
    expect(insumoLock).toBeGreaterThan(turno);
    expect(insumoFila).toBeGreaterThan(insumoLock);
  });

  it('sin turnoId (o en una compra) no toca bookings', async () => {
    const { sql, consultas } = grabador();
    const repo = new PostgresInventarioRepository(sql);
    await repo.registrarMovimiento(INSUMO, { tipo: 'uso', cantidad: 1, nota: null, turnoId: null }, contexto);
    expect(consultas.some((q) => q.includes('buddys.bookings'))).toBe(false);
  });

  it('con la base real: turno inexistente da 400 en turnoId, insumo inexistente 404, y el uso con turno descuenta', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, 'Shampoo', 100);
    const sinTurno = await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 1, turnoId: TURNO });
    expect(sinTurno.status).toBe(400);
    expect(sinTurno.body.error.fields).toEqual({ turnoId: 'No encontramos ese turno.' });
    const sinInsumo = await admin.post(`/api/admin/insumos/${INSUMO}/movimientos`, { tipo: 'uso', cantidad: 1, turnoId: TURNO });
    expect(sinInsumo.status).toBe(404);
    const lavado = await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico'], vehiculoTipo: 'auto' });
    const conTurno = await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 4, turnoId: lavado.body.lavado.id });
    expect(conTurno.status).toBe(201);
    expect(await stock(context, shampoo)).toBe(96);
  });
});

describe('textos de una línea: también se rechazan U+2028 y U+2029', () => {
  const LS = String.fromCodePoint(0x2028);
  const PS = String.fromCodePoint(0x2029);

  it('textoBase (finanzas e inventario), nombre de usuario y nombre, categoría y duración de servicio', () => {
    const linea = textoDeUnaLinea(80, 'mal');
    expect(linea.safeParse('Shampoo neutro').success).toBe(true);
    for (const sep of [LS, PS, '\n']) {
      expect(linea.safeParse(`Sham${sep}poo`).success).toBe(false);
      expect(nombreSchema.safeParse(`Ana${sep}María`).success).toBe(false);
    }
    expect(nombreSchema.safeParse('Ana María').success).toBe(true);

    const servicio = { id: 'lavado-prueba', nombre: 'Lavado', resumen: 'Rápido', descripcion: 'Por fuera.' };
    const base = createServicioSchema.safeParse(servicio);
    expect(base.success, JSON.stringify(base.error?.issues)).toBe(true);
    for (const campo of ['nombre', 'categoria', 'duracion']) {
      for (const sep of [LS, PS]) {
        expect(createServicioSchema.safeParse({ ...servicio, [campo]: `Uno${sep}dos` }).success, campo).toBe(false);
      }
    }
  });

  it('por la API: un insumo con U+2028 en el nombre da 400', async () => {
    const { admin } = await equipo();
    const r = await admin.post('/api/admin/insumos', { nombre: `Sham${LS}poo`, unidad: 'ml' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields ?? {})).toEqual(['nombre']);
  });
});
