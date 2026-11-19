import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { type SqlClient, verifyPostgresSchema } from '../src/db/postgres.js';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Las dos migraciones de la foto de perfil (20261116100000 y 20261116110000) sobre una base que YA tiene usuarios,
 * como producción: primero todas las anteriores, después un perfil, después las nuevas DOS veces (son idempotentes).
 * Al final el backend nuevo tiene que arrancar y las reglas de la base se tienen que cumplir.
 */

const PRIMERA = '20261116100000_perfil_avatar.sql';
const abiertas: PGlite[] = [];
afterEach(async () => {
  for (const pg of abiertas.splice(0)) if (!pg.closed) await pg.close();
});

const leer = (file: string) => readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
const nuevas = () => migrationFiles().filter((file) => file >= PRIMERA);

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

async function baseConUsuario(): Promise<{ pg: PGlite; id: string }> {
  const pg = await PGlite.create();
  abiertas.push(pg);
  // eslint-disable-next-line no-restricted-syntax -- constante del propio test
  await pg.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    if (file >= PRIMERA) continue;
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  const { rows } = await pg.query<{ id: string }>("INSERT INTO auth.users (email) VALUES ('ana@buddys.test') RETURNING id::text AS id");
  return { pg, id: String(rows[0]?.id) };
}

describe('migraciones de la foto de perfil (20261116*)', () => {
  it('son dos, van después de todas las anteriores y se pueden aplicar dos veces sobre una base con usuarios', async () => {
    expect(nuevas()).toEqual(['20261116100000_perfil_avatar.sql', '20261116110000_storage_bucket_avatares.sql']);
    const { pg, id } = await baseConUsuario();
    for (let vez = 0; vez < 2; vez++) {
      // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
      for (const file of nuevas()) await pg.exec(leer(file));
    }
    const { rows } = await pg.query('SELECT avatar_path, avatar_pendiente_path, avatar_subida_vence_at FROM buddys.perfiles WHERE id = $1::uuid', [id]);
    expect(rows[0]).toEqual({ avatar_path: null, avatar_pendiente_path: null, avatar_subida_vence_at: null });
    await expect(verifyPostgresSchema(comoApp(pg))).resolves.toBeUndefined();
  });

  it('el CHECK exige el formato y la carpeta del propio perfil; la app solo actualiza las columnas de la foto', async () => {
    const { pg, id } = await baseConUsuario();
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    for (const file of nuevas()) await pg.exec(leer(file));
    const app = comoApp(pg);
    const otro = '11111111-1111-4111-8111-111111111111';
    await expect(app.query('UPDATE buddys.perfiles SET avatar_path = $2 WHERE id = $1::uuid', [id, `${otro}/${otro}.jpg`])).rejects.toThrow();
    await expect(app.query('UPDATE buddys.perfiles SET avatar_path = $2 WHERE id = $1::uuid', [id, `${id}/../x.jpg`])).rejects.toThrow();
    await expect(app.query('UPDATE buddys.perfiles SET avatar_path = $2 WHERE id = $1::uuid', [id, `${id}/${otro}.png`])).rejects.toThrow();
    // Una pendiente sin vencimiento no vale.
    await expect(
      app.query('UPDATE buddys.perfiles SET avatar_pendiente_path = $2 WHERE id = $1::uuid', [id, `${id}/${otro}.jpg`]),
    ).rejects.toThrow();
    await app.query('UPDATE buddys.perfiles SET avatar_path = $2 WHERE id = $1::uuid', [id, `${id}/${otro}.webp`]);
    // La app no inserta en avatares_a_borrar: lo hace solo el trigger.
    await expect(app.query("INSERT INTO buddys.avatares_a_borrar (path, borrar_desde) VALUES ($1, now())", [`${id}/${otro}.jpg`])).rejects.toThrow();
    // Al cambiarla, la anterior queda anotada (con el permiso del trigger, no el de la app).
    await app.query('UPDATE buddys.perfiles SET avatar_path = NULL WHERE id = $1::uuid', [id]);
    const anotadas = await app.query('SELECT path FROM buddys.avatares_a_borrar', []);
    expect(anotadas.rows).toEqual([{ path: `${id}/${otro}.webp` }]);
    // anon y authenticated no ven nada.
    const privilegios = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
       WHERE table_schema = 'buddys' AND table_name = 'avatares_a_borrar' AND grantee IN ('anon', 'authenticated', 'service_role')`,
    );
    expect(privilegios.rows[0]?.n).toBe(0);
  });
});
