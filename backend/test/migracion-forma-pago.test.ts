import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261113100000_forma_pago_deshacer_lavado sobre una base que YA tiene turnos y lavados (como producción):
 * primero las anteriores, después datos viejos, después la nueva (dos veces: es idempotente).
 */

const NUEVA = '20261113100000_forma_pago_deshacer_lavado.sql';
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
    if (file === NUEVA) continue;
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  return pg;
}

// eslint-disable-next-line no-restricted-syntax -- migración versionada
const aplicarNueva = (pg: PGlite) => pg.exec(leer(NUEVA));

async function lavadoViejo(pg: PGlite): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, monto)
     VALUES ('Cliente', NULL, 'auto', 'pulido', '2026-11-10', 'manana', 'completado', 'mostrador', 1000) RETURNING id::text AS id`,
  );
  return String(rows[0]?.id);
}

describe('migración forma_pago_deshacer_lavado', () => {
  it('se aplica dos veces sobre datos existentes: quedan en null y sin tocar updated_at', async () => {
    const pg = await baseAntes();
    const id = await lavadoViejo(pg);
    await pg.query("UPDATE buddys.bookings SET updated_at = '2026-11-10T10:00:00Z'");
    await aplicarNueva(pg);
    await aplicarNueva(pg);
    const { rows } = await pg.query<{ forma_pago: string | null; registrado_por: string | null; updated_at: Date }>(
      'SELECT forma_pago, registrado_por::text, updated_at FROM buddys.bookings WHERE id = $1::uuid',
      [id],
    );
    expect(rows[0]).toEqual({ forma_pago: null, registrado_por: null, updated_at: new Date('2026-11-10T10:00:00Z') });
  });

  it('CHECK de forma_pago, FK de registrado_por con ON DELETE SET NULL, y ninguna mueve updated_at', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const id = await lavadoViejo(pg);
    await expect(pg.query("UPDATE buddys.bookings SET forma_pago = 'bitcoin' WHERE id = $1::uuid", [id])).rejects.toThrow(
      /bookings_forma_pago_valida/,
    );
    await expect(
      pg.query("UPDATE buddys.bookings SET registrado_por = '11111111-1111-4111-8111-111111111111' WHERE id = $1::uuid", [id]),
    ).rejects.toThrow(/bookings_registrado_por_fkey/);

    const persona = (await pg.query<{ id: string }>("INSERT INTO auth.users (email) VALUES ('p@b.test') RETURNING id::text AS id")).rows[0]?.id;
    await pg.query("UPDATE buddys.bookings SET registrado_por = $2::uuid, updated_at = '2026-11-10T10:00:00Z' WHERE id = $1::uuid", [id, persona]);
    await pg.query("UPDATE buddys.bookings SET forma_pago = 'efectivo' WHERE id = $1::uuid", [id]);
    await pg.query('DELETE FROM auth.users WHERE id = $1::uuid', [persona]);
    const { rows } = await pg.query<{ forma_pago: string; registrado_por: string | null; updated_at: Date }>(
      'SELECT forma_pago, registrado_por::text, updated_at FROM buddys.bookings WHERE id = $1::uuid',
      [id],
    );
    expect(rows[0]).toEqual({ forma_pago: 'efectivo', registrado_por: null, updated_at: new Date('2026-11-10T10:00:00Z') });

    // Cambiar otra columna sigue pasando por el trigger.
    await pg.query("UPDATE buddys.bookings SET notas_internas = 'x' WHERE id = $1::uuid", [id]);
    const despues = await pg.query<{ updated_at: Date }>('SELECT updated_at FROM buddys.bookings WHERE id = $1::uuid', [id]);
    expect(despues.rows[0]?.updated_at.getTime()).not.toBe(new Date('2026-11-10T10:00:00Z').getTime());
  });

  it('GRANT mínimo: buddys_app inserta ambas y actualiza solo forma_pago; los roles de la API, nada', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const priv = async (rol: string, columna: string, permiso: string) =>
      (await pg.query<{ ok: boolean }>("SELECT has_column_privilege($1, 'buddys.bookings', $2, $3) AS ok", [rol, columna, permiso]))
        .rows[0]?.ok;
    for (const columna of ['forma_pago', 'registrado_por', 'id_local']) {
      expect(await priv('buddys_app', columna, 'SELECT')).toBe(true);
      expect(await priv('buddys_app', columna, 'INSERT')).toBe(true);
      for (const rol of ['anon', 'authenticated', 'service_role']) {
        for (const permiso of ['SELECT', 'INSERT', 'UPDATE']) expect(await priv(rol, columna, permiso), `${rol} ${permiso}`).toBe(false);
      }
    }
    expect(await priv('buddys_app', 'forma_pago', 'UPDATE')).toBe(true);
    expect(await priv('buddys_app', 'registrado_por', 'UPDATE')).toBe(false);
    expect(await priv('buddys_app', 'id_local', 'UPDATE')).toBe(false);
    const rls = await pg.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'buddys.bookings'::regclass");
    expect(rls.rows[0]?.rls).toBe(true);
  });
});
