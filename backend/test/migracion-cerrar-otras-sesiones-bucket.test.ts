import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261117140000_cerrar_otras_sesiones_bucket (auditoría de seguridad del objetivo B, M1 y B2) sobre una
 * base que YA tiene usuarios con sesiones abiertas: primero las anteriores, después los datos, después la nueva (dos
 * veces: es idempotente). PGlite no tiene Storage: el bloque del bucket no corre; con un storage.buckets mínimo (las
 * columnas reales que usa la migración, como en migracion-perfil-foto.test.ts) sí.
 */

const NUEVA = '20261117140000_cerrar_otras_sesiones_bucket.sql';
const abiertas: PGlite[] = [];
afterEach(async () => {
  for (const pg of abiertas.splice(0)) if (!pg.closed) await pg.close();
});

const leer = (file: string) => readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

async function baseAntes(antesDeMigrar = ''): Promise<PGlite> {
  const pg = await PGlite.create();
  abiertas.push(pg);
  // eslint-disable-next-line no-restricted-syntax -- constante del propio test
  await pg.exec(SUPABASE_STUB + antesDeMigrar);
  for (const file of migrationFiles()) {
    if (file >= NUEVA) continue; // solo las anteriores
    // eslint-disable-next-line no-restricted-syntax -- migraciones versionadas
    await pg.exec(leer(file));
  }
  return pg;
}

// eslint-disable-next-line no-restricted-syntax -- migración versionada
const aplicarNueva = (pg: PGlite) => pg.exec(leer(NUEVA));

/** Lo mínimo de storage.buckets de Supabase (id, name, public, file_size_limit, allowed_mime_types y otras). */
const STORAGE_STUB = `
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text
  );
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`;

async function persona(pg: PGlite, email: string, sesiones: string[]): Promise<string> {
  const { rows } = await pg.query<{ id: string }>('INSERT INTO auth.users (email) VALUES ($1) RETURNING id::text AS id', [email]);
  const id = String(rows[0]?.id);
  for (const sesion of sesiones) {
    await pg.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1::uuid, $2::uuid)', [sesion, id]);
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

const sesiones = async (pg: PGlite) =>
  (await pg.query<{ id: string }>('SELECT id::text AS id FROM auth.sessions ORDER BY id')).rows.map((r) => r.id);

const ACTUAL = '11111111-1111-4111-8111-111111111111';
const OTRA_1 = '11111111-1111-4111-8111-111111111112';
const OTRA_2 = '11111111-1111-4111-8111-111111111113';
const DE_BETO = '11111111-1111-4111-8111-111111111114';
const LLAMADA = 'SELECT buddys_private.cerrar_otras_sesiones($1::uuid, $2::uuid) AS n';

describe(`migración ${NUEVA}: cerrar_otras_sesiones (M1)`, () => {
  it('buddys_app borra las sesiones de UN usuario menos la actual y sabe cuántas; las de los demás quedan', async () => {
    const pg = await baseAntes();
    const ana = await persona(pg, 'ana@buddys.test', [ACTUAL, OTRA_1, OTRA_2]);
    await persona(pg, 'beto@buddys.test', [DE_BETO]);
    await aplicarNueva(pg);
    await aplicarNueva(pg); // idempotente

    expect(await comoRol(pg, 'buddys_app', LLAMADA, [ana, ACTUAL])).toEqual([{ n: 2 }]);
    expect(await sesiones(pg)).toEqual([ACTUAL, DE_BETO]);
    // Sin otras, o un usuario que no existe, o la sesión de otro como "actual": nunca toca lo ajeno.
    expect(await comoRol(pg, 'buddys_app', LLAMADA, [ana, ACTUAL])).toEqual([{ n: 0 }]);
    expect(await comoRol(pg, 'buddys_app', LLAMADA, ['22222222-2222-4222-8222-222222222222', ACTUAL])).toEqual([{ n: 0 }]);
    expect(await comoRol(pg, 'buddys_app', LLAMADA, [ana, DE_BETO])).toEqual([{ n: 1 }]);
    expect(await sesiones(pg)).toEqual([DE_BETO]);
  });

  it('SECURITY DEFINER con search_path vacío; EXECUTE solo para buddys_app; buddys_app sigue sin tocar auth', async () => {
    const pg = await baseAntes();
    const ana = await persona(pg, 'ana@buddys.test', [ACTUAL, OTRA_1]);
    await aplicarNueva(pg);

    const { rows } = await pg.query<{ prosecdef: boolean; proconfig: string[] | null; esquema: string }>(
      `SELECT p.prosecdef, p.proconfig, n.nspname AS esquema
       FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
       WHERE p.proname = 'cerrar_otras_sesiones'`,
    );
    expect(rows).toEqual([{ prosecdef: true, proconfig: ['search_path=""'], esquema: 'buddys_private' }]);

    const { rows: permisos } = await pg.query<{ rol: string; puede: boolean }>(
      `SELECT r AS rol, has_function_privilege(r, 'buddys_private.cerrar_otras_sesiones(uuid, uuid)', 'EXECUTE') AS puede
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
         WHERE p.proname = 'cerrar_otras_sesiones' AND a.grantee = 0
       ) AS publico`,
    );
    expect(publico).toEqual([{ publico: false }]);

    for (const rol of ['anon', 'authenticated', 'service_role']) {
      await expect(comoRol(pg, rol, LLAMADA, [ana, ACTUAL]), rol).rejects.toThrow();
    }
    await expect(comoRol(pg, 'buddys_app', 'DELETE FROM auth.sessions')).rejects.toThrow();
    await expect(comoRol(pg, 'buddys_app', 'SELECT * FROM auth.sessions')).rejects.toThrow();
    expect(await sesiones(pg)).toEqual([ACTUAL, OTRA_1]);
  });
});

describe(`migración ${NUEVA}: bucket avatares privado (B2)`, () => {
  it('sin Storage (PGlite) se aplica sin error', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    await aplicarNueva(pg);
    const { rows } = await pg.query<{ existe: boolean }>("SELECT to_regclass('storage.buckets') IS NOT NULL AS existe");
    expect(rows).toEqual([{ existe: false }]);
  });

  it('un avatares que ya existía público y sin topes queda privado, 256 KiB y solo WebP; los demás buckets no cambian', async () => {
    const pg = await baseAntes(STORAGE_STUB);
    // Creado a mano antes de la migración perfil_foto (que por ON CONFLICT DO NOTHING no lo tocó).
    await pg.query(
      `UPDATE storage.buckets SET public = true, file_size_limit = null, allowed_mime_types = null WHERE id = 'avatares'`,
    );
    await pg.query(
      "INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('publico', 'publico', true, null, null)",
    );
    await pg.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('avatares', 'x.webp')");

    await aplicarNueva(pg);
    await aplicarNueva(pg); // idempotente

    const b = await pg.query<{ id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }>(
      'SELECT id, public, file_size_limit::int AS file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id',
    );
    expect(b.rows).toEqual([
      { id: 'avatares', public: false, file_size_limit: 262144, allowed_mime_types: ['image/webp'] },
      // El de las fotos de los lavados (20261115150000_storage_bucket_fotos), que esta migración no toca.
      { id: 'lavados-fotos', public: false, file_size_limit: 1572864, allowed_mime_types: ['image/jpeg', 'image/webp'] },
      { id: 'publico', public: true, file_size_limit: null, allowed_mime_types: null },
    ]);
    // No toca objetos ni crea policies (la única es la restrictiva del bucket de fotos de lavados, de 20261115150000).
    expect((await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM storage.objects')).rows).toEqual([{ n: 1 }]);
    const policies = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'storage' AND policyname <> 'lavados_fotos_sin_acceso_api'");
    expect(policies.rows[0]?.n).toBe(0);
  });

  it('si avatares no existe, no lo crea (lo crea perfil_foto)', async () => {
    const pg = await baseAntes(STORAGE_STUB);
    await pg.query("DELETE FROM storage.buckets WHERE id = 'avatares'");
    await aplicarNueva(pg);
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM storage.buckets WHERE id = 'avatares'")).rows).toEqual([{ n: 0 }]);
  });
});
