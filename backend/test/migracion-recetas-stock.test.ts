import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261117120000_recetas_stock sobre una base que YA tiene insumos y movimientos (como producción):
 * primero las anteriores, después datos viejos, después la nueva (dos veces: es idempotente).
 * También prueba las consultas que va a usar el backend (receta de un lavado, para comprar, consumo y serie).
 */

const NUEVA = '20261117120000_recetas_stock.sql';
const abiertas: PGlite[] = [];
afterEach(async () => {
  for (const pg of abiertas.splice(0)) if (!pg.closed) await pg.close();
});

const leer = (file: string) => readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

async function baseAntes(): Promise<PGlite> {
  const pg = await PGlite.create();
  abiertas.push(pg);
  // eslint-disable-next-line no-restricted-syntax -- constante del propio test
  await pg.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    if (file >= NUEVA) continue; // solo las anteriores
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  return pg;
}

// eslint-disable-next-line no-restricted-syntax -- migración versionada
const aplicarNueva = (pg: PGlite) => pg.exec(leer(NUEVA));

async function base(): Promise<PGlite> {
  const pg = await baseAntes();
  await aplicarNueva(pg);
  return pg;
}

async function insumo(pg: PGlite, nombre: string, o: { unidad?: string; stock?: number; minimo?: number; costo?: number | null; activo?: boolean } = {}): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO buddys.insumos (nombre, unidad, stock, stock_minimo, costo_unitario, activo, categoria)
     VALUES ($1, $2, $3, $4, $5, $6, 'Limpieza') RETURNING id::text AS id`,
    [nombre, o.unidad ?? 'ml', o.stock ?? 0, o.minimo ?? 0, o.costo ?? null, o.activo ?? true],
  );
  return String(rows[0]?.id);
}

const receta = (pg: PGlite, servicio: string, vehiculo: string | null, insumoId: string, cantidad: number) =>
  pg.query('INSERT INTO buddys.recetas (servicio_id, vehiculo, insumo_id, cantidad) VALUES ($1, $2, $3::uuid, $4)', [servicio, vehiculo, insumoId, cantidad]);

const movimiento = (pg: PGlite, insumoId: string, tipo: string, cantidad: number, extra = '') =>
  // eslint-disable-next-line no-restricted-syntax -- columnas fijas del propio test
  pg.query(`INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad${extra ? ', costo_total' : ''}) VALUES ($1::uuid, $2, $3${extra ? ', 100' : ''})`, [
    insumoId,
    tipo,
    cantidad,
  ]);

/** Receta de un lavado: $1 servicios (text[]), $2 vehículo. Insumo, cantidad total y los servicios que lo piden. */
const SQL_RECETA_DE_LAVADO = `
  WITH pedidos AS (SELECT DISTINCT unnest($1::text[]) AS servicio_id),
  candidatas AS (
    SELECT r.servicio_id, r.insumo_id, r.cantidad, r.vehiculo,
           bool_or(r.vehiculo IS NOT NULL) OVER (PARTITION BY r.servicio_id) AS hay_variante
    FROM buddys.recetas r
    JOIN pedidos p ON p.servicio_id = r.servicio_id
    WHERE r.vehiculo = $2 OR r.vehiculo IS NULL
  )
  SELECT i.id::text AS insumo_id, i.nombre, i.unidad, sum(c.cantidad)::float8 AS cantidad,
         string_agg(DISTINCT s.nombre, ' + ' ORDER BY s.nombre) AS servicios
  FROM candidatas c
  JOIN buddys.insumos i ON i.id = c.insumo_id AND i.activo
  JOIN buddys.servicios s ON s.id = c.servicio_id
  WHERE (c.vehiculo IS NOT NULL) = c.hay_variante
  GROUP BY i.id
  ORDER BY i.id`;

/** Para comprar (regla 8). */
const SQL_PARA_COMPRAR = `
  SELECT i.id::text AS insumo_id, i.nombre, i.categoria, i.unidad,
         i.stock::float8 AS stock, i.stock_minimo::float8 AS stock_minimo, s.sugerido::float8 AS sugerido,
         CASE WHEN i.costo_unitario IS NULL THEN NULL ELSE round(s.sugerido * i.costo_unitario)::int END AS costo_estimado
  FROM buddys.insumos i
  CROSS JOIN LATERAL (
    SELECT CASE WHEN i.unidad IN ('unidad', 'par', 'caja') THEN ceil(greatest(2 * i.stock_minimo - i.stock, 0))
                ELSE round(greatest(2 * i.stock_minimo - i.stock, 0), 2) END AS sugerido
  ) s
  WHERE i.activo AND i.stock_minimo > 0 AND i.stock <= i.stock_minimo
  ORDER BY i.categoria NULLS LAST, lower(i.nombre), i.id`;

/** Consumo por insumo entre $1 y $2 (fechas de La Rioja, inclusive): uso en positivo menos devoluciones. */
const SQL_CONSUMO_POR_INSUMO = `
  SELECT i.id::text AS insumo_id, i.nombre, i.unidad, sum(-m.cantidad)::float8 AS consumido,
         CASE WHEN i.costo_unitario IS NULL THEN NULL ELSE round(sum(-m.cantidad) * i.costo_unitario)::int END AS costo
  FROM buddys.movimientos_stock m
  JOIN buddys.insumos i ON i.id = m.insumo_id
  WHERE m.tipo IN ('uso', 'devolucion')
    AND m.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Argentina/La_Rioja')
    AND m.created_at <  (($2::date + 1)::timestamp AT TIME ZONE 'America/Argentina/La_Rioja')
  GROUP BY i.id
  ORDER BY consumido DESC, i.nombre`;

/** Serie de lavados de mostrador completados, con ceros. $3 = 'day' | 'week' | 'month' (constante del backend). */
const SQL_SERIE_LAVADOS = `
  WITH serie AS (
    SELECT g::date AS clave
    FROM generate_series(date_trunc($3, $1::date::timestamp), $2::date::timestamp, ('1 ' || $3)::interval) g
  ),
  lavados AS (
    SELECT date_trunc($3, coalesce(b.fecha_confirmada, b.fecha_preferida)::timestamp)::date AS clave, count(*)::int AS cantidad
    FROM buddys.bookings b
    WHERE b.origen = 'mostrador' AND b.estado = 'completado'
      AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
    GROUP BY 1
  )
  SELECT to_char(s.clave, CASE WHEN $3 = 'month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) AS clave,
         coalesce(l.cantidad, 0) AS cantidad
  FROM serie s LEFT JOIN lavados l ON l.clave = s.clave
  ORDER BY s.clave`;

async function lavado(pg: PGlite, fecha: string, estado = 'completado', origen = 'mostrador') {
  await pg.query(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, monto)
     VALUES ('C', '3804000000', 'auto', 'pulido', $1::date, 'manana', $2, $3, CASE WHEN $2 = 'completado' THEN 1000 END)`,
    [fecha, estado, origen],
  );
}

describe('migración recetas_stock', () => {
  it('se aplica dos veces sobre movimientos existentes: nada cambia, CHECK validados y aviso_bajo_at en null', async () => {
    const pg = await baseAntes();
    const shampoo = await insumo(pg, 'Shampoo', { stock: 10, minimo: 2 });
    await movimiento(pg, shampoo, 'compra', 10, 'costo');
    await movimiento(pg, shampoo, 'uso', -1.5);
    await movimiento(pg, shampoo, 'ajuste', -0.5);
    await pg.query("UPDATE buddys.insumos SET updated_at = '2026-11-01T10:00:00Z'");

    await aplicarNueva(pg);
    await aplicarNueva(pg);

    const movs = await pg.query<{ tipo: string; cantidad: number }>(
      'SELECT tipo, cantidad::float8 AS cantidad FROM buddys.movimientos_stock ORDER BY cantidad DESC',
    );
    expect(movs.rows).toEqual([
      { tipo: 'compra', cantidad: 10 },
      { tipo: 'ajuste', cantidad: -0.5 },
      { tipo: 'uso', cantidad: -1.5 },
    ]);
    // Los movimientos que ya existían quedan en origen 'manual' (antes no había recetas).
    const origenes = await pg.query<{ origen: string; n: number }>('SELECT origen, count(*)::int AS n FROM buddys.movimientos_stock GROUP BY origen');
    expect(origenes.rows).toEqual([{ origen: 'manual', n: 3 }]);
    const ins = await pg.query<{ aviso_bajo_at: Date | null; updated_at: Date }>('SELECT aviso_bajo_at, updated_at FROM buddys.insumos');
    expect(ins.rows).toEqual([{ aviso_bajo_at: null, updated_at: new Date('2026-11-01T10:00:00Z') }]);

    const checks = await pg.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
       WHERE conrelid = 'buddys.movimientos_stock'::regclass AND contype = 'c' ORDER BY conname`,
    );
    expect(checks.rows).toEqual(
      expect.arrayContaining([
        { conname: 'movimientos_stock_origen_valido', convalidated: true },
        { conname: 'movimientos_stock_signo', convalidated: true },
        { conname: 'movimientos_stock_tipo_valido', convalidated: true },
      ]),
    );
    const idx = await pg.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'buddys' AND tablename IN ('movimientos_stock', 'recetas') ORDER BY indexname",
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining(['movimientos_stock_consumo_idx', 'movimientos_stock_turno_idx', 'recetas_insumo_idx', 'recetas_servicio_vehiculo_insumo_uidx']),
    );
  });

  it('CHECK de movimientos: devolucion solo positiva y sin costo; los demás tipos como antes', async () => {
    const pg = await base();
    const id = await insumo(pg, 'Cera');
    await movimiento(pg, id, 'devolucion', 1.25);
    await expect(movimiento(pg, id, 'devolucion', -1)).rejects.toThrow(/movimientos_stock_signo/);
    await expect(movimiento(pg, id, 'devolucion', 0)).rejects.toThrow(/movimientos_stock_signo/);
    await expect(movimiento(pg, id, 'devolucion', 1, 'costo')).rejects.toThrow(/movimientos_stock_solo_compra_con_costo/);
    await expect(movimiento(pg, id, 'uso', 1)).rejects.toThrow(/movimientos_stock_signo/);
    await expect(movimiento(pg, id, 'compra', -1)).rejects.toThrow(/movimientos_stock_signo/);
    await expect(movimiento(pg, id, 'ajuste', 0)).rejects.toThrow(/movimientos_stock_signo/);
    // Dos CHECK lo rechazan (tipo y signo): Postgres informa el primero por nombre.
    await expect(movimiento(pg, id, 'regalo', 1)).rejects.toThrow(/movimientos_stock_(signo|tipo_valido)/);
    const def = await pg.query<{ d: string }>("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'movimientos_stock_tipo_valido'");
    expect(def.rows[0]?.d).toMatch(/'devolucion'/);
  });

  it('origen: not null, default manual, solo manual o receta', async () => {
    const pg = await base();
    const id = await insumo(pg, 'Cera');
    await movimiento(pg, id, 'uso', -1);
    const ins = (origen: string | null) =>
      pg.query("INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, origen) VALUES ($1::uuid, 'uso', -1, $2)", [id, origen]);
    await ins('receta');
    await ins('manual');
    await expect(ins('otro')).rejects.toThrow(/movimientos_stock_origen_valido/);
    await expect(ins('')).rejects.toThrow(/movimientos_stock_origen_valido/);
    await expect(ins(null)).rejects.toMatchObject({ code: '23502' });
    const r = await pg.query<{ origen: string; n: number }>('SELECT origen, count(*)::int AS n FROM buddys.movimientos_stock GROUP BY origen ORDER BY origen');
    expect(r.rows).toEqual([
      { origen: 'manual', n: 2 },
      { origen: 'receta', n: 1 },
    ]);
  });

  it('recetas: una vez por variante (null incluido), vehículo y cantidad en rango, FK RESTRICT y updated_at', async () => {
    const pg = await base();
    const shampoo = await insumo(pg, 'Shampoo');
    await receta(pg, 'pulido', null, shampoo, 50);
    await receta(pg, 'pulido', 'pickup', shampoo, 80);
    await receta(pg, 'encerado', null, shampoo, 10);
    await expect(receta(pg, 'pulido', null, shampoo, 60)).rejects.toThrow(/recetas_servicio_vehiculo_insumo_uidx/);
    await expect(receta(pg, 'pulido', 'pickup', shampoo, 60)).rejects.toThrow(/recetas_servicio_vehiculo_insumo_uidx/);
    await expect(receta(pg, 'pulido', 'camioneta', shampoo, 1)).rejects.toThrow(/recetas_vehiculo_valido/);
    await expect(receta(pg, 'pulido', 'auto', shampoo, 0)).rejects.toThrow(/recetas_cantidad_rango/);
    await expect(receta(pg, 'pulido', 'auto', shampoo, 100000)).rejects.toThrow(/recetas_cantidad_rango/);
    await receta(pg, 'pulido', 'auto', shampoo, 99999);
    await expect(receta(pg, 'no-existe', null, shampoo, 1)).rejects.toThrow(/recetas_servicio_fkey/);

    await expect(pg.query("DELETE FROM buddys.servicios WHERE id = 'pulido'")).rejects.toMatchObject({ code: '23001' });
    await expect(pg.query('DELETE FROM buddys.insumos WHERE id = $1::uuid', [shampoo])).rejects.toMatchObject({ code: '23001' });

    await pg.query("UPDATE buddys.recetas SET updated_at = '2026-01-01T00:00:00Z'");
    await pg.query("UPDATE buddys.recetas SET cantidad = 55 WHERE servicio_id = 'pulido' AND vehiculo IS NULL");
    const r = await pg.query<{ reciente: boolean }>("SELECT updated_at > '2026-01-02' AS reciente FROM buddys.recetas WHERE cantidad = 55");
    expect(r.rows).toEqual([{ reciente: true }]);
  });

  it('permisos: buddys_app con lo mínimo en recetas, aviso_bajo_at e inserta devolucion; los roles de la API, nada', async () => {
    const pg = await base();
    const col = async (rol: string, tabla: string, columna: string, permiso: string) =>
      (await pg.query<{ ok: boolean }>('SELECT has_column_privilege($1, $2, $3, $4) AS ok', [rol, tabla, columna, permiso])).rows[0]?.ok;
    const tab = async (rol: string, tabla: string, permiso: string) =>
      (await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [rol, tabla, permiso])).rows[0]?.ok;

    expect(await tab('buddys_app', 'buddys.recetas', 'SELECT')).toBe(true);
    expect(await tab('buddys_app', 'buddys.recetas', 'DELETE')).toBe(true);
    expect(await tab('buddys_app', 'buddys.recetas', 'TRUNCATE')).toBe(false);
    for (const c of ['servicio_id', 'vehiculo', 'insumo_id', 'cantidad']) expect(await col('buddys_app', 'buddys.recetas', c, 'INSERT'), c).toBe(true);
    for (const c of ['id', 'created_at', 'updated_at']) expect(await col('buddys_app', 'buddys.recetas', c, 'INSERT'), c).toBe(false);
    for (const c of ['cantidad', 'updated_at']) expect(await col('buddys_app', 'buddys.recetas', c, 'UPDATE'), c).toBe(true);
    for (const c of ['id', 'servicio_id', 'vehiculo', 'insumo_id', 'created_at']) expect(await col('buddys_app', 'buddys.recetas', c, 'UPDATE'), c).toBe(false);
    expect(await col('buddys_app', 'buddys.insumos', 'aviso_bajo_at', 'UPDATE')).toBe(true);
    expect(await col('buddys_app', 'buddys.insumos', 'aviso_bajo_at', 'INSERT')).toBe(false);
    expect(await tab('buddys_app', 'buddys.insumos', 'DELETE')).toBe(false);
    expect(await col('buddys_app', 'buddys.movimientos_stock', 'origen', 'INSERT')).toBe(true);
    expect(await col('buddys_app', 'buddys.movimientos_stock', 'origen', 'UPDATE')).toBe(false);
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      expect(await col(rol, 'buddys.movimientos_stock', 'origen', 'INSERT'), rol).toBe(false);
      expect(await col(rol, 'buddys.movimientos_stock', 'origen', 'SELECT'), rol).toBe(false);
    }
    expect(await tab('buddys_app', 'buddys.movimientos_stock', 'UPDATE')).toBe(false);
    expect(await tab('buddys_app', 'buddys.movimientos_stock', 'DELETE')).toBe(false);
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await tab(rol, 'buddys.recetas', p), `${rol} ${p}`).toBe(false);
        expect(await tab(rol, 'buddys.insumos', p), `${rol} ${p}`).toBe(false);
      }
    }
    const rls = await pg.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'buddys.recetas'::regclass");
    expect(rls.rows[0]?.rls).toBe(true);
    const pol = await pg.query<{ cmd: string; roles: string[] }>("SELECT cmd, roles FROM pg_policies WHERE schemaname = 'buddys' AND tablename = 'recetas' ORDER BY cmd");
    expect(pol.rows).toEqual([
      { cmd: 'DELETE', roles: ['buddys_app'] },
      { cmd: 'INSERT', roles: ['buddys_app'] },
      { cmd: 'SELECT', roles: ['buddys_app'] },
      { cmd: 'UPDATE', roles: ['buddys_app'] },
    ]);

    // Lo que hace el backend, con el rol de la app: reemplazar una variante, avisar y devolver.
    const shampoo = await insumo(pg, 'Shampoo', { stock: 1, minimo: 2 });
    await pg.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE buddys_app');
      await tx.query("DELETE FROM buddys.recetas WHERE servicio_id = 'pulido' AND vehiculo IS NULL");
      await tx.query("INSERT INTO buddys.recetas (servicio_id, vehiculo, insumo_id, cantidad) VALUES ('pulido', NULL, $1::uuid, 50)", [shampoo]);
      await tx.query("UPDATE buddys.recetas SET cantidad = 40, updated_at = now() WHERE servicio_id = 'pulido'");
      await tx.query('UPDATE buddys.insumos SET aviso_bajo_at = now() WHERE id = $1::uuid', [shampoo]);
      await tx.query("INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota) VALUES ($1::uuid, 'devolucion', 20, 'Lavado deshecho')", [shampoo]);
      await tx.query("INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, origen) VALUES ($1::uuid, 'uso', -5, 'Receta: Pulido', 'receta')", [shampoo]);
    });
    // La app nunca cambia el origen de un movimiento ya grabado.
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE buddys_app');
        await tx.query("UPDATE buddys.movimientos_stock SET origen = 'manual' WHERE origen = 'receta'");
      }),
    ).rejects.toThrow(/permission denied/);
    const r = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM buddys.movimientos_stock WHERE tipo = 'devolucion'");
    expect(r.rows[0]?.n).toBe(1);
  });

  it('SQL receta de un lavado: la del vehículo si hay, si no la general; suma servicios; saltea inactivos', async () => {
    const pg = await base();
    const shampoo = await insumo(pg, 'Shampoo');
    const cera = await insumo(pg, 'Cera');
    const viejo = await insumo(pg, 'Silicona vieja', { activo: false });
    await receta(pg, 'pulido', null, shampoo, 50);
    await receta(pg, 'pulido', null, cera, 5);
    await receta(pg, 'pulido', 'pickup', shampoo, 80); // la pickup no lleva cera
    await receta(pg, 'encerado', null, cera, 10);
    await receta(pg, 'encerado', null, viejo, 3);
    await receta(pg, 'encerado', 'moto', viejo, 1); // la moto tiene variante, pero solo con un inactivo

    const resolver = async (servicios: string[], vehiculo: string) =>
      // eslint-disable-next-line no-restricted-syntax -- SQL constante del propio test (la consulta propuesta al backend)
      (await pg.query<{ insumo_id: string; nombre: string; cantidad: number; servicios: string }>(SQL_RECETA_DE_LAVADO, [servicios, vehiculo])).rows.map(
        (r) => [r.nombre, r.cantidad, r.servicios],
      );
    const orden = (xs: unknown[][]) => [...xs].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    expect(orden(await resolver(['pulido'], 'auto'))).toEqual([
      ['Cera', 5, 'Pulido'],
      ['Shampoo', 50, 'Pulido'],
    ]);
    expect(await resolver(['pulido'], 'pickup')).toEqual([['Shampoo', 80, 'Pulido']]);
    expect(orden(await resolver(['pulido', 'encerado'], 'auto'))).toEqual([
      ['Cera', 15, 'Encerado + Pulido'],
      ['Shampoo', 50, 'Pulido'],
    ]);
    // Moto en encerado: usa su variante (aunque el único insumo esté inactivo), no cae a la general.
    expect(orden(await resolver(['pulido', 'encerado'], 'moto'))).toEqual([
      ['Cera', 5, 'Pulido'],
      ['Shampoo', 50, 'Pulido'],
    ]);
    expect(await resolver(['lavado-basico'], 'auto')).toEqual([]);
    // Ordenado por id de insumo (el orden de los pg_advisory_xact_lock).
    // eslint-disable-next-line no-restricted-syntax -- SQL constante del propio test
    const ids = (await pg.query<{ insumo_id: string }>(SQL_RECETA_DE_LAVADO, [['pulido'], 'auto'])).rows.map((r) => r.insumo_id);
    expect(ids).toEqual([...ids].sort());
  });

  it('SQL para comprar: sugerido entero para contables, con decimales para el resto, y costo estimado', async () => {
    const pg = await base();
    await insumo(pg, 'Paños', { unidad: 'unidad', stock: 3.5, minimo: 5, costo: 1200 }); // 2*5-3.5 = 6.5 -> 7
    await insumo(pg, 'Shampoo', { unidad: 'litro', stock: 0.5, minimo: 1.25 }); // 2,5-0,5 = 2
    await insumo(pg, 'Cera', { unidad: 'kg', stock: 0.33, minimo: 0.5, costo: 999 }); // 0,67
    await insumo(pg, 'Justo', { unidad: 'caja', stock: 2, minimo: 2, costo: 10 }); // en el mínimo: entra, 2
    await insumo(pg, 'Sobra', { unidad: 'ml', stock: 10, minimo: 2 });
    await insumo(pg, 'Sin mínimo', { unidad: 'ml', stock: 0, minimo: 0 });
    await insumo(pg, 'Inactivo', { unidad: 'ml', stock: 0, minimo: 5, activo: false });

    // eslint-disable-next-line no-restricted-syntax -- SQL constante del propio test
    const r = await pg.query<{ nombre: string; sugerido: number; costo_estimado: number | null }>(SQL_PARA_COMPRAR);
    expect(r.rows.map((x) => [x.nombre, x.sugerido, x.costo_estimado])).toEqual([
      ['Cera', 0.67, 669],
      ['Justo', 2, 20],
      ['Paños', 7, 8400],
      ['Shampoo', 2, null],
    ]);
  });

  it('SQL consumo: por fecha de La Rioja, las devoluciones restan, costo null sin costo_unitario; usa el índice nuevo', async () => {
    const pg = await base();
    const shampoo = await insumo(pg, 'Shampoo', { costo: 5 });
    const cera = await insumo(pg, 'Cera');
    const mov = (id: string, tipo: string, cantidad: number, at: string) =>
      pg.query('INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, created_at) VALUES ($1::uuid, $2, $3, $4::timestamptz)', [id, tipo, cantidad, at]);
    await mov(shampoo, 'uso', -50, '2026-11-01T03:00:00Z'); // 1/11 00:00 en La Rioja: entra
    await mov(shampoo, 'uso', -30, '2026-11-01T02:59:59Z'); // 31/10 23:59 en La Rioja: no entra
    await mov(shampoo, 'devolucion', 20, '2026-11-15T12:00:00Z');
    await mov(shampoo, 'compra', 1000, '2026-11-10T12:00:00Z'); // las compras no son consumo
    await mov(shampoo, 'ajuste', -7, '2026-11-10T12:00:00Z'); // los ajustes tampoco
    await mov(cera, 'uso', -1.5, '2026-12-01T02:59:59Z'); // 30/11 23:59 en La Rioja: entra
    await mov(cera, 'uso', -9, '2026-12-01T03:00:00Z'); // 1/12: no entra

    // eslint-disable-next-line no-restricted-syntax -- SQL constante del propio test
    const r = await pg.query<{ nombre: string; consumido: number; costo: number | null }>(SQL_CONSUMO_POR_INSUMO, ['2026-11-01', '2026-11-30']);
    expect(r.rows.map((x) => [x.nombre, x.consumido, x.costo])).toEqual([
      ['Shampoo', 30, 150],
      ['Cera', 1.5, null],
    ]);

    // Con miles de movimientos, el plan usa el índice parcial con INCLUDE (Index Only Scan).
    await pg.query(
      `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, created_at)
       SELECT CASE WHEN g % 2 = 0 THEN $1::uuid ELSE $2::uuid END,
              CASE WHEN g % 10 < 7 THEN 'uso' WHEN g % 10 < 9 THEN 'compra' ELSE 'devolucion' END,
              CASE WHEN g % 10 < 7 THEN -1 ELSE 1 END,
              timestamptz '2025-01-01' + g * interval '35 minutes'
       FROM generate_series(1, 20000) g`,
      [shampoo, cera],
    );
    await pg.query('VACUUM ANALYZE buddys.movimientos_stock');
    // eslint-disable-next-line no-restricted-syntax -- SQL constante del propio test
    const plan = await pg.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${SQL_CONSUMO_POR_INSUMO}`, ['2026-01-01', '2026-01-31']);
    expect(plan.rows.map((x) => x['QUERY PLAN']).join('\n')).toMatch(/Index Only Scan using movimientos_stock_consumo_idx/);
  });

  it('SQL serie de lavados: día, semana (lunes, cruzando mes y año) y mes, con ceros; solo mostrador completados', async () => {
    const pg = await base();
    await lavado(pg, '2026-12-28');
    await lavado(pg, '2026-12-31');
    await lavado(pg, '2027-01-01');
    await lavado(pg, '2027-01-02', 'cancelado');
    await lavado(pg, '2027-01-02', 'completado', 'web');
    await lavado(pg, '2027-01-09');
    await lavado(pg, '2027-02-15');

    const serie = async (desde: string, hasta: string, g: string) =>
      // eslint-disable-next-line no-restricted-syntax -- SQL constante del propio test (la consulta propuesta al backend)
      (await pg.query<{ clave: string; cantidad: number }>(SQL_SERIE_LAVADOS, [desde, hasta, g])).rows.map((r) => [r.clave, r.cantidad]);

    expect(await serie('2026-12-30', '2027-01-03', 'day')).toEqual([
      ['2026-12-30', 0],
      ['2026-12-31', 1],
      ['2027-01-01', 1],
      ['2027-01-02', 0],
      ['2027-01-03', 0],
    ]);
    // 2026-12-28 es lunes: la semana del cambio de año tiene clave 2026-12-28.
    expect(await serie('2026-12-28', '2027-01-17', 'week')).toEqual([
      ['2026-12-28', 3],
      ['2027-01-04', 1],
      ['2027-01-11', 0],
    ]);
    // Si el rango empieza a mitad de semana, la clave es el lunes de esa semana y se cuenta solo desde "desde".
    expect(await serie('2026-12-31', '2027-01-03', 'week')).toEqual([['2026-12-28', 2]]);
    expect(await serie('2026-12-01', '2027-03-31', 'month')).toEqual([
      ['2026-12', 2],
      ['2027-01', 2],
      ['2027-02', 1],
      ['2027-03', 0],
    ]);
  });
});
