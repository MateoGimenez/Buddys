import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261117130000_cerrar_sesiones_usuario (auditoría del objetivo A, B3) sobre una base que YA tiene
 * usuarios con sesiones abiertas: primero las anteriores, después los datos, después la nueva (dos veces: es
 * idempotente).
 */

const NUEVA = '20261117130000_cerrar_sesiones_usuario.sql';
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

async function persona(pg: PGlite, email: string, sesiones: number): Promise<string> {
  const { rows } = await pg.query<{ id: string }>('INSERT INTO auth.users (email) VALUES ($1) RETURNING id::text AS id', [email]);
  const id = String(rows[0]?.id);
  for (let i = 0; i < sesiones; i++) {
    await pg.query('INSERT INTO auth.sessions (id, user_id) VALUES (gen_random_uuid(), $1::uuid)', [id]);
  }
  return id;
}

/** Corre `text` con SET LOCAL ROLE `rol` (rol fijo del test, no dato de usuario). */
async function comoRol<T>(pg: PGlite, rol: string, text: string, params: unknown[] = []): Promise<T[]> {
  return pg.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${rol}`);
    return (await tx.query<T>(text, params)).rows;
  });
}

const sesionesDe = async (pg: PGlite, id: string) =>
  (await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id = $1::uuid', [id])).rows[0]?.n;

describe(`migración ${NUEVA}`, () => {
  it('buddys_app borra todas las sesiones de UN usuario y sabe cuántas; las de los demás quedan', async () => {
    const pg = await baseAntes();
    const ana = await persona(pg, 'ana@buddys.test', 3);
    const beto = await persona(pg, 'beto@buddys.test', 1);
    await aplicarNueva(pg);
    await aplicarNueva(pg); // idempotente

    const primera = await comoRol<{ n: number }>(pg, 'buddys_app', 'SELECT buddys_private.cerrar_sesiones($1::uuid) AS n', [ana]);
    expect(primera).toEqual([{ n: 3 }]);
    expect(await sesionesDe(pg, ana)).toBe(0);
    expect(await sesionesDe(pg, beto)).toBe(1);
    // Sin sesiones, o un usuario que no existe: 0, sin error.
    expect(await comoRol(pg, 'buddys_app', 'SELECT buddys_private.cerrar_sesiones($1::uuid) AS n', [ana])).toEqual([{ n: 0 }]);
    expect(
      await comoRol(pg, 'buddys_app', 'SELECT buddys_private.cerrar_sesiones($1::uuid) AS n', ['22222222-2222-4222-8222-222222222222']),
    ).toEqual([{ n: 0 }]);
  });

  it('SECURITY DEFINER con search_path vacío; EXECUTE solo para buddys_app; buddys_app sigue sin tocar auth', async () => {
    const pg = await baseAntes();
    const ana = await persona(pg, 'ana@buddys.test', 1);
    await aplicarNueva(pg);

    const { rows } = await pg.query<{ prosecdef: boolean; proconfig: string[] | null; esquema: string }>(
      `SELECT p.prosecdef, p.proconfig, n.nspname AS esquema
       FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
       WHERE p.proname = 'cerrar_sesiones'`,
    );
    expect(rows).toEqual([{ prosecdef: true, proconfig: ['search_path=""'], esquema: 'buddys_private' }]);

    const { rows: permisos } = await pg.query<{ rol: string; puede: boolean }>(
      `SELECT r AS rol, has_function_privilege(r, 'buddys_private.cerrar_sesiones(uuid)', 'EXECUTE') AS puede
       FROM unnest(ARRAY['buddys_app', 'anon', 'authenticated', 'service_role']) AS r`,
    );
    expect(permisos).toEqual([
      { rol: 'buddys_app', puede: true },
      { rol: 'anon', puede: false },
      { rol: 'authenticated', puede: false },
      { rol: 'service_role', puede: false },
    ]);
    const { rows: publico } = await pg.query<{ publico: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_proc AS p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
         WHERE p.proname = 'cerrar_sesiones' AND a.grantee = 0
       ) AS publico`,
    );
    expect(publico).toEqual([{ publico: false }]);

    for (const rol of ['anon', 'authenticated', 'service_role']) {
      await expect(comoRol(pg, rol, 'SELECT buddys_private.cerrar_sesiones($1::uuid)', [ana]), rol).rejects.toThrow();
    }
    // La función no le abre el esquema auth: directo, buddys_app no puede borrar ni leer sesiones.
    await expect(comoRol(pg, 'buddys_app', 'DELETE FROM auth.sessions')).rejects.toThrow();
    await expect(comoRol(pg, 'buddys_app', 'SELECT * FROM auth.sessions')).rejects.toThrow();
    expect(await sesionesDe(pg, ana)).toBe(1);
  });
});
