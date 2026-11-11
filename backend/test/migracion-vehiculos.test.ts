import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261101110000_servicios_por_vehiculo aplicada sobre una base que YA tiene servicios (como el Supabase
 * de producción) y el seed de precios iniciales (supabase/seeds/, fuera de las migraciones).
 */

const NUEVA = '20261101110000_servicios_por_vehiculo.sql';
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
    if (file >= NUEVA) break; // solo las anteriores: las posteriores se aplican sobre esta
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  return pg;
}

// eslint-disable-next-line no-restricted-syntax -- migración versionada
const aplicarNueva = (pg: PGlite) => pg.exec(leer(NUEVA));

describe('migración de servicios por vehículo sobre una base con servicios existentes', () => {
  it('los servicios que ya existen quedan en los tres vehículos y nada más cambia', async () => {
    expect(migrationFiles()).toContain(NUEVA);
    const pg = await baseAntes();
    await pg.exec(
      "UPDATE buddys.servicios SET precio_desde = 45000, activo = false WHERE id = 'pulido'; UPDATE buddys.servicios SET updated_at = '2026-09-02T10:00:00Z';",
    );
    const antes = await pg.query('SELECT id, nombre, precio_desde, activo, destacado, orden FROM buddys.servicios ORDER BY orden');
    await aplicarNueva(pg);

    const { rows } = await pg.query<{ vehiculos: string[]; updated_at: Date }>('SELECT vehiculos, updated_at FROM buddys.servicios');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.vehiculos).toEqual(['auto', 'camioneta', 'moto']);
      expect(row.updated_at.toISOString()).toBe('2026-09-02T10:00:00.000Z');
    }
    expect((await pg.query('SELECT id, nombre, precio_desde, activo, destacado, orden FROM buddys.servicios ORDER BY orden')).rows).toEqual(
      antes.rows,
    );
  });

  it('compatibilidad hacia atrás: un INSERT y un UPDATE del backend viejo (sin la columna) siguen andando como buddys_app', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    await pg.exec('SET ROLE buddys_app');
    try {
      await pg.query(
        `INSERT INTO buddys.servicios (id, nombre, resumen, descripcion, incluye, glosario, duracion_estimada, precio_desde, destacado, activo, orden, updated_at)
         VALUES ('viejo', 'Viejo', 'r', 'd', '[]'::jsonb, '[]'::jsonb, NULL, 100, false, true, 60, now())`,
      );
      await pg.query("UPDATE buddys.servicios SET nombre = 'Viejo 2', updated_at = now() WHERE id = 'viejo'");
      const { rows } = await pg.query<{ vehiculos: string[] }>("SELECT vehiculos FROM buddys.servicios WHERE id = 'viejo'");
      expect(rows[0]?.vehiculos).toEqual(['auto', 'camioneta', 'moto']);
    } finally {
      await pg.exec('RESET ROLE');
    }
  });

  it('CHECK: de 1 a 3, sin repetidos, solo auto/camioneta/moto, sin null ni vacío; los subconjuntos válidos pasan', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    for (const valido of [['auto'], ['moto', 'auto'], ['camioneta', 'moto'], ['auto', 'camioneta', 'moto']]) {
      await pg.query("UPDATE buddys.servicios SET vehiculos = $1::text[] WHERE id = 'pulido'", [valido]);
    }
    const invalidos: unknown[] = [[], ['auto', 'auto'], ['bici'], ['auto', 'camioneta', 'moto', 'auto'], ['Auto'], ['auto', null], null];
    for (const invalido of invalidos) {
      await expect(
        pg.query("UPDATE buddys.servicios SET vehiculos = $1::text[] WHERE id = 'pulido'", [invalido]),
        JSON.stringify(invalido),
      ).rejects.toThrow(/servicios_vehiculos_valido|not-null|null value/);
    }
  });

  it('GRANT mínimo: buddys_app lee, inserta y actualiza la columna; anon, authenticated y service_role nada', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const priv = async (rol: string, permiso: string) =>
      (await pg.query<{ ok: boolean }>("SELECT has_column_privilege($1, 'buddys.servicios', 'vehiculos', $2) AS ok", [rol, permiso])).rows[0]?.ok;
    for (const permiso of ['SELECT', 'INSERT', 'UPDATE']) {
      expect(await priv('buddys_app', permiso), permiso).toBe(true);
      for (const rol of ['anon', 'authenticated', 'service_role']) expect(await priv(rol, permiso), `${rol} ${permiso}`).toBe(false);
    }
    const fn = async (rol: string) =>
      (
        await pg.query<{ ok: boolean }>(
          "SELECT has_function_privilege($1, 'buddys.servicio_vehiculos_valido(text[])', 'EXECUTE') AS ok",
          [rol],
        )
      ).rows[0]?.ok;
    expect(await fn('buddys_app')).toBe(true);
    for (const rol of ['anon', 'authenticated', 'service_role']) expect(await fn(rol), rol).toBe(false);
  });
});
