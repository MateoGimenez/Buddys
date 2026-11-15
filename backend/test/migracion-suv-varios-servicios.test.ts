import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migraciones 20261113110000_vehiculos_suv_pickup y 20261113120000_lavado_varios_servicios sobre una base que YA tiene
 * datos con 'camioneta' (como producción): primero las anteriores, después los datos viejos, después las nuevas (dos
 * veces: son idempotentes).
 */

const SUV = '20261113110000_vehiculos_suv_pickup.sql';
const VARIOS = '20261113120000_lavado_varios_servicios.sql';
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
    if (file >= SUV) break; // solo las anteriores
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  return pg;
}

// eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
const aplicar = (pg: PGlite, file: string) => pg.exec(leer(file));

const VIEJO = new Date('2026-11-01T10:00:00Z');

async function datosViejos(pg: PGlite): Promise<{ camioneta: string; auto: string }> {
  await pg.query(
    `UPDATE buddys.servicios SET precio_desde_camioneta = 33000, duracion_estimada_camioneta = '3 h',
            vehiculos = '{auto,camioneta}' WHERE id = 'pulido'`,
  );
  await pg.query("UPDATE buddys.servicios SET vehiculos = '{camioneta}' WHERE id = 'encerado'");
  const insertar = async (tipo: string, servicio: string) =>
    (
      await pg.query<{ id: string }>(
        `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, monto, trabajador_id)
         VALUES ('Cliente', '12345678', $1, $2, '2026-11-01', 'manana', 'completado', 5000, NULL) RETURNING id::text AS id`,
        [tipo, servicio],
      )
    ).rows[0]?.id ?? '';
  const camioneta = await insertar('camioneta', 'pulido');
  const auto = await insertar('auto', 'encerado');
  await pg.query('UPDATE buddys.bookings SET updated_at = $1', [VIEJO]);
  await pg.query('UPDATE buddys.servicios SET updated_at = $1', [VIEJO]);
  return { camioneta, auto };
}

describe('migración vehiculos_suv_pickup sobre datos con camioneta', () => {
  it('camioneta pasa a suv en turnos y servicios, copia precio y duración, y no mueve updated_at', async () => {
    const pg = await baseAntes();
    const { camioneta, auto } = await datosViejos(pg);
    await aplicar(pg, SUV);
    await aplicar(pg, SUV);

    const turnos = await pg.query<{ id: string; vehiculo_tipo: string; updated_at: Date }>(
      'SELECT id::text AS id, vehiculo_tipo, updated_at FROM buddys.bookings ORDER BY seq',
    );
    expect(turnos.rows).toEqual([
      { id: camioneta, vehiculo_tipo: 'suv', updated_at: VIEJO },
      { id: auto, vehiculo_tipo: 'auto', updated_at: VIEJO },
    ]);

    const servicios = await pg.query<Record<string, unknown>>(
      `SELECT id, vehiculos, precio_desde_suv, precio_desde_pickup, duracion_suv, duracion_pickup, categoria, updated_at
       FROM buddys.servicios WHERE id IN ('pulido', 'encerado', 'lavado-basico') ORDER BY id`,
    );
    expect(servicios.rows).toEqual([
      { id: 'encerado', vehiculos: ['suv'], precio_desde_suv: null, precio_desde_pickup: null, duracion_suv: null, duracion_pickup: null, categoria: null, updated_at: VIEJO },
      { id: 'lavado-basico', vehiculos: ['auto', 'suv', 'moto'], precio_desde_suv: null, precio_desde_pickup: null, duracion_suv: null, duracion_pickup: null, categoria: null, updated_at: VIEJO },
      { id: 'pulido', vehiculos: ['auto', 'suv'], precio_desde_suv: 33000, precio_desde_pickup: null, duracion_suv: '3 h', duracion_pickup: null, categoria: null, updated_at: VIEJO },
    ]);

    // Las columnas de camioneta ya no están; el trigger de updated_at volvió a andar.
    const columnas = await pg.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'buddys' AND table_name = 'servicios' AND column_name LIKE '%camioneta%'",
    );
    expect(columnas.rows).toEqual([]);
    await pg.query("UPDATE buddys.bookings SET notas_internas = 'x' WHERE id = $1::uuid", [auto]);
    const movido = await pg.query<{ updated_at: Date }>('SELECT updated_at FROM buddys.bookings WHERE id = $1::uuid', [auto]);
    expect(movido.rows[0]?.updated_at.getTime()).toBeGreaterThan(VIEJO.getTime());
  });

  it('CHECK nuevos: camioneta ya no entra; suv y pickup sí; default de vehiculos con los cuatro', async () => {
    const pg = await baseAntes();
    await aplicar(pg, SUV);
    await expect(
      pg.query("INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja) VALUES ('a', '12345678', 'camioneta', 'pulido', '2026-11-01', 'manana')"),
    ).rejects.toThrow(/bookings_vehiculo_tipo_valido/);
    for (const tipo of ['suv', 'pickup']) {
      await pg.query(
        "INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja) VALUES ('a', '12345678', $1, 'pulido', '2026-11-01', 'manana')",
        [tipo],
      );
    }
    await expect(pg.query("UPDATE buddys.servicios SET vehiculos = '{camioneta}' WHERE id = 'pulido'")).rejects.toThrow(/servicios_vehiculos_valido/);
    await pg.query("UPDATE buddys.servicios SET vehiculos = '{auto,suv,pickup,moto}' WHERE id = 'pulido'");
    await pg.query("INSERT INTO buddys.servicios (id, nombre, resumen, descripcion) VALUES ('nuevo', 'Nuevo', 'r', 'd')");
    const { rows } = await pg.query<{ vehiculos: string[] }>("SELECT vehiculos FROM buddys.servicios WHERE id = 'nuevo'");
    expect(rows[0]?.vehiculos).toEqual(['auto', 'suv', 'pickup', 'moto']);
  });
});

describe('migración lavado_varios_servicios', () => {
  it('backfill: cada turno existente queda con su servicio (orden 0, sin precio); idempotente', async () => {
    const pg = await baseAntes();
    const { camioneta, auto } = await datosViejos(pg);
    await aplicar(pg, SUV);
    await aplicar(pg, VARIOS);
    await aplicar(pg, VARIOS);
    const { rows } = await pg.query<{ booking_id: string; servicio_id: string; orden: number; precio_lista: number | null }>(
      'SELECT booking_id::text AS booking_id, servicio_id, orden, precio_lista FROM buddys.lavado_servicios ORDER BY servicio_id',
    );
    expect(rows).toEqual([
      { booking_id: auto, servicio_id: 'encerado', orden: 0, precio_lista: null },
      { booking_id: camioneta, servicio_id: 'pulido', orden: 0, precio_lista: null },
    ]);
  });

  it('un turno nuevo (incluso un INSERT a mano) nace con su servicio y la foto del precio para su vehículo', async () => {
    const pg = await baseAntes();
    await aplicar(pg, SUV);
    await aplicar(pg, VARIOS);
    await pg.query("UPDATE buddys.servicios SET precio_desde = 1000, precio_desde_suv = 2000, precio_desde_pickup = 3000 WHERE id = 'pulido'");
    for (const [tipo, esperado] of [['auto', 1000], ['suv', 2000], ['pickup', 3000], ['moto', null]] as const) {
      const id = (
        await pg.query<{ id: string }>(
          "INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja) VALUES ('a', '12345678', $1, 'pulido', '2026-11-01', 'manana') RETURNING id::text AS id",
          [tipo],
        )
      ).rows[0]?.id;
      const { rows } = await pg.query<{ orden: number; precio_lista: number | null }>(
        'SELECT orden, precio_lista FROM buddys.lavado_servicios WHERE booking_id = $1::uuid',
        [id],
      );
      expect(rows, tipo).toEqual([{ orden: 0, precio_lista: esperado }]);
    }
  });

  it('CHECK, FK y CASCADE; buddys_app con SELECT, INSERT y DELETE (sin UPDATE); los roles de la API sin nada', async () => {
    const pg = await baseAntes();
    await aplicar(pg, SUV);
    await aplicar(pg, VARIOS);
    const id = (
      await pg.query<{ id: string }>(
        "INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja) VALUES ('a', '12345678', 'auto', 'pulido', '2026-11-01', 'manana') RETURNING id::text AS id",
      )
    ).rows[0]?.id;
    await expect(pg.query("INSERT INTO buddys.lavado_servicios VALUES ($1::uuid, 'encerado', 10, null)", [id])).rejects.toThrow(/lavado_servicios_orden_rango/);
    await expect(pg.query("INSERT INTO buddys.lavado_servicios VALUES ($1::uuid, 'encerado', 0, null)", [id])).rejects.toThrow(/lavado_servicios_orden_unico/);
    await expect(pg.query("INSERT INTO buddys.lavado_servicios VALUES ($1::uuid, 'no-existe', 1, null)", [id])).rejects.toThrow(/lavado_servicios_servicio_fkey/);
    await expect(pg.query("INSERT INTO buddys.lavado_servicios VALUES ($1::uuid, 'encerado', 1, -1)", [id])).rejects.toThrow(/lavado_servicios_precio_rango/);

    const privilegios = await pg.query<{ rol: string; sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT r AS rol, has_table_privilege(r, 'buddys.lavado_servicios', 'SELECT') AS sel,
              has_table_privilege(r, 'buddys.lavado_servicios', 'INSERT') AS ins,
              has_table_privilege(r, 'buddys.lavado_servicios', 'UPDATE') AS upd,
              has_table_privilege(r, 'buddys.lavado_servicios', 'DELETE') AS del
       FROM unnest(ARRAY['buddys_app', 'anon', 'authenticated', 'service_role']) AS r`,
    );
    expect(privilegios.rows).toEqual([
      { rol: 'buddys_app', sel: true, ins: true, upd: false, del: true },
      { rol: 'anon', sel: false, ins: false, upd: false, del: false },
      { rol: 'authenticated', sel: false, ins: false, upd: false, del: false },
      { rol: 'service_role', sel: false, ins: false, upd: false, del: false },
    ]);
    const rls = await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid = 'buddys.lavado_servicios'::regclass");
    expect(rls.rows[0]?.relrowsecurity).toBe(true);

    await pg.query('DELETE FROM buddys.bookings WHERE id = $1::uuid', [id]);
    const { rows } = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM buddys.lavado_servicios');
    expect(rows[0]?.n).toBe(0);
  });
});

describe('las tres migraciones del 2026-11-13, en orden y dos veces seguidas', () => {
  it('sobre una base con datos con camioneta: mismo resultado, sin errores y sin mover updated_at en la segunda corrida', async () => {
    const CATALOGO = '20261113130000_catalogo_buddys.sql';
    const pg = await baseAntes();
    const { camioneta, auto } = await datosViejos(pg);
    for (const file of [SUV, VARIOS, CATALOGO]) await aplicar(pg, file);

    const foto = async () => ({
      servicios: (
        await pg.query<Record<string, unknown>>(
          `SELECT id, activo, destacado, vehiculos, precio_desde, precio_desde_suv, precio_desde_pickup, precio_desde_moto,
                  categoria, orden, updated_at
           FROM buddys.servicios ORDER BY id`,
        )
      ).rows,
      turnos: (await pg.query('SELECT id::text AS id, vehiculo_tipo, servicio_id, updated_at FROM buddys.bookings ORDER BY seq')).rows,
      lista: (await pg.query('SELECT booking_id::text AS b, servicio_id, orden, precio_lista FROM buddys.lavado_servicios ORDER BY 1, 3')).rows,
    });
    const primera = await foto();
    for (const file of [SUV, VARIOS, CATALOGO]) await aplicar(pg, file);
    expect(await foto()).toEqual(primera);

    expect(primera.servicios.filter((s) => s.activo)).toHaveLength(14);
    expect(primera.servicios.filter((s) => !s.activo).map((s) => s.id)).toEqual(['encerado', 'lavado-basico', 'lavado-premium', 'pulido']);
    expect(primera.turnos).toEqual([
      { id: camioneta, vehiculo_tipo: 'suv', servicio_id: 'pulido', updated_at: VIEJO },
      { id: auto, vehiculo_tipo: 'auto', servicio_id: 'encerado', updated_at: VIEJO },
    ]);
    expect(primera.lista).toHaveLength(2);
  });
});
