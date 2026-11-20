import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPostgresSchema, type SqlClient } from '../src/db/postgres.js';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Las nueve migraciones de las mejoras (20261115100000 a 20261115180000) sobre una base que YA tiene datos, como
 * producción: primero todas las anteriores, después turnos, lavados, metas e insumos viejos, después las nuevas en
 * orden y DOS veces (son idempotentes). Al final el backend nuevo tiene que arrancar (verifyPostgresSchema con el rol
 * de la app).
 */

const PRIMERA = '20261115100000_lavados_etapa_descuento.sql';
const abiertas: PGlite[] = [];
afterEach(async () => {
  for (const pg of abiertas.splice(0)) if (!pg.closed) await pg.close();
});

const leer = (file: string) => readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
const nuevas = () => migrationFiles().filter((file) => file >= PRIMERA && file < '20261116');

async function baseAntes(): Promise<PGlite> {
  const pg = await PGlite.create();
  abiertas.push(pg);
  // eslint-disable-next-line no-restricted-syntax -- constante del propio test
  await pg.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    if (file >= PRIMERA) continue;
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  return pg;
}

async function aplicarNuevas(pg: PGlite): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
  for (const file of nuevas()) await pg.exec(leer(file));
}

/** SqlClient con el rol de la app (como en producción). */
function comoApp(pg: PGlite): SqlClient {
  const run = async (tx: Pick<PGlite, 'query'>, text: string, params: readonly unknown[]) => {
    const r = await tx.query<Record<string, unknown>>(text, [...params]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const client: SqlClient = {
    query: (text, params = []) =>
      pg.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE buddys_app');
        return run(tx, text, params);
      }),
    transaction: (fn) =>
      pg.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE buddys_app');
        const dentro: SqlClient = { query: (text, params = []) => run(tx, text, params), transaction: (f) => f(dentro) };
        return fn(dentro);
      }),
  };
  return client;
}

const FECHA_VIEJA = '2026-11-10T10:00:00.000Z';

async function datosViejos(pg: PGlite) {
  const web = await pg.query<{ id: string }>(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen)
     VALUES ('Juan', '+5493804123456', 'auto', 'limpieza-nivel-1', '2026-11-20', 'manana', 'pendiente', 'web')
     RETURNING id::text AS id`,
  );
  const mostrador = await pg.query<{ id: string }>(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, monto,
                                  created_at)
     VALUES ('Cliente', NULL, 'auto', 'limpieza-nivel-1', '2026-11-10', 'manana', 'completado', 'mostrador', 25000,
             '2026-11-10T09:00:00Z')
     RETURNING id::text AS id`,
  );
  await pg.query("INSERT INTO buddys.metas_mensuales (mes, ingresos_objetivo) VALUES ('2026-11-01', 1000000)");
  const insumo = await pg.query<{ id: string }>(
    "INSERT INTO buddys.insumos (nombre, unidad, stock) VALUES ('Shampoo', 'litro', 10) RETURNING id::text AS id",
  );
  await pg.query("INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad) VALUES ($1::uuid, 'compra', 10)", [
    insumo.rows[0]?.id,
  ]);
  await pg.query('UPDATE buddys.bookings SET updated_at = $1::timestamptz', [FECHA_VIEJA]);
  return { webId: String(web.rows[0]?.id), mostradorId: String(mostrador.rows[0]?.id) };
}

describe('migraciones de las mejoras (20261115*) sobre la base actual con datos', () => {
  it('son nueve, en orden, y la primera va después de todas las anteriores', () => {
    expect(nuevas()).toHaveLength(9);
    expect(nuevas()[0]).toBe(PRIMERA);
    expect(nuevas().at(-1)).toBe('20261115180000_avisos_meta.sql');
  });

  it('sin aplicarlas, el backend nuevo no arranca y dice qué falta', async () => {
    const pg = await baseAntes();
    // Con la tanda del 17/11 en el código, lo primero que falta puede ser de esa tanda: alcanza con que no arranque.
    await expect(verifyPostgresSchema(comoApp(pg))).rejects.toThrow(/Faltan/);
  });

  it('se aplican dos veces sobre datos existentes sin perder ni romper nada, y el backend arranca', async () => {
    const pg = await baseAntes();
    const { webId, mostradorId } = await datosViejos(pg);

    await aplicarNuevas(pg);
    await aplicarNuevas(pg);

    const fila = async (id: string) =>
      (
        await pg.query<Record<string, unknown>>(
          `SELECT etapa, etapa_at, descuento, descuento_motivo, sena_monto, created_at, updated_at
           FROM buddys.bookings WHERE id = $1::uuid`,
          [id],
        )
      ).rows[0];
    const lavado = await fila(mostradorId);
    // El lavado viejo queda entregado desde que se registró, sin descuento y SIN mover updated_at (es un relleno).
    expect(lavado).toMatchObject({ etapa: 'entregado', descuento: 0, descuento_motivo: null, sena_monto: null });
    expect(lavado?.etapa_at).toEqual(lavado?.created_at);
    expect(lavado?.updated_at).toEqual(new Date(FECHA_VIEJA));
    // El turno de la web no tiene etapa.
    expect(await fila(webId)).toMatchObject({ etapa: null, etapa_at: null, descuento: 0, sena_monto: null });

    expect((await pg.query('SELECT * FROM buddys.fidelizacion')).rows).toHaveLength(1);
    expect((await pg.query('SELECT cumplida_avisada_at FROM buddys.metas_mensuales')).rows).toEqual([{ cumplida_avisada_at: null }]);
    expect((await pg.query('SELECT automatico FROM buddys.movimientos_stock')).rows).toEqual([{ automatico: false }]);

    // Las migraciones posteriores (20261116*, foto de perfil) también, como en producción: el backend nuevo las exige.
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    for (const file of migrationFiles().filter((f) => f >= '20261116')) await pg.exec(leer(file));
    await expect(verifyPostgresSchema(comoApp(pg))).resolves.toBeUndefined();
  });

  it('un lavado de mostrador del backend anterior (sin etapa) nace entregado; uno de la web no puede tener etapa', async () => {
    const pg = await baseAntes();
    await aplicarNuevas(pg);
    const { rows } = await pg.query<{ etapa: string; etapa_at: Date | null }>(
      `INSERT INTO buddys.bookings (nombre, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, monto)
       VALUES ('Cliente', 'auto', 'limpieza-nivel-1', '2026-11-16', 'manana', 'completado', 'mostrador', 1000)
       RETURNING etapa, etapa_at`,
    );
    expect(rows[0]?.etapa).toBe('entregado');
    expect(rows[0]?.etapa_at).toBeInstanceOf(Date);
    await expect(
      pg.query(
        `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, etapa)
         VALUES ('Juan', '+5493804123456', 'auto', 'limpieza-nivel-1', '2026-11-20', 'manana', 'pendiente', 'web', 'espera')`,
      ),
    ).rejects.toThrow(/bookings_etapa_solo_mostrador/);
  });

  it('las tablas nuevas tienen RLS y los roles de la API de Supabase no tienen ningún permiso', async () => {
    const pg = await baseAntes();
    await aplicarNuevas(pg);
    const tablas = ['gastos_fijos', 'cierres_caja', 'lavado_fotos', 'fotos_a_borrar', 'fidelizacion', 'servicio_insumos'];
    const rls = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'buddys'::regnamespace AND relname = ANY($1::text[])",
      [tablas],
    );
    expect(rls.rows).toHaveLength(tablas.length);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const tabla of tablas) {
      for (const rol of ['anon', 'authenticated', 'service_role']) {
        for (const permiso of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const { rows } = await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [
            rol,
            `buddys.${tabla}`,
            permiso,
          ]);
          expect(rows[0]?.ok, `${rol} ${permiso} ${tabla}`).toBe(false);
        }
      }
    }
  });
});
