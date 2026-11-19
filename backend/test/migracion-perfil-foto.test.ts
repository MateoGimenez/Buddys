import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261117110000_perfil_foto sobre una base que YA tiene perfiles (como producción): primero las
 * anteriores, después datos viejos, después la nueva (dos veces: es idempotente). PGlite no tiene Storage: el bloque
 * del bucket no corre; con un storage.buckets mínimo (las columnas reales que usa la migración) sí.
 */

const NUEVA = '20261117110000_perfil_foto.sql';
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

async function persona(pg: PGlite, email: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>('INSERT INTO auth.users (email) VALUES ($1) RETURNING id::text AS id', [email]);
  return String(rows[0]?.id);
}

describe('migración perfil_foto', () => {
  it('se aplica dos veces sobre perfiles existentes sin Storage: todos quedan sin foto y sin tocar updated_at', async () => {
    const pg = await baseAntes();
    await persona(pg, 'jefe@b.test');
    await persona(pg, 'lucia@b.test');
    await pg.query("UPDATE buddys.perfiles SET updated_at = '2026-11-01T10:00:00Z'");

    await aplicarNueva(pg);
    await aplicarNueva(pg);

    const r = await pg.query<{ email: string; foto_actualizada_at: Date | null; updated_at: Date }>(
      'SELECT email, foto_actualizada_at, updated_at FROM buddys.perfiles ORDER BY email',
    );
    expect(r.rows).toEqual([
      { email: 'jefe@b.test', foto_actualizada_at: null, updated_at: new Date('2026-11-01T10:00:00Z') },
      { email: 'lucia@b.test', foto_actualizada_at: null, updated_at: new Date('2026-11-01T10:00:00Z') },
    ]);
    const col = await pg.query<{ data_type: string; is_nullable: string }>(
      "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'buddys' AND table_name = 'perfiles' AND column_name = 'foto_actualizada_at'",
    );
    expect(col.rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);
    const storage = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'storage'");
    expect(storage.rows[0]?.n).toBe(0);
  });

  it('GRANT: buddys_app actualiza foto_actualizada_at (y conserva sus columnas); los roles de la API, nada', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const priv = async (rol: string, columna: string, permiso: string) =>
      (await pg.query<{ ok: boolean }>("SELECT has_column_privilege($1, 'buddys.perfiles', $2, $3) AS ok", [rol, columna, permiso])).rows[0]?.ok;
    for (const columna of ['foto_actualizada_at', 'eliminado_at', 'rol_id', 'activo', 'nombre', 'updated_at']) {
      expect(await priv('buddys_app', columna, 'SELECT'), columna).toBe(true);
      expect(await priv('buddys_app', columna, 'UPDATE'), columna).toBe(true);
    }
    for (const columna of ['id', 'email', 'created_at']) expect(await priv('buddys_app', columna, 'UPDATE'), columna).toBe(false);
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      for (const permiso of ['SELECT', 'INSERT', 'UPDATE']) expect(await priv(rol, 'foto_actualizada_at', permiso), `${rol} ${permiso}`).toBe(false);
    }
    const tabla = async (permiso: string) =>
      (await pg.query<{ ok: boolean }>("SELECT has_table_privilege('buddys_app', 'buddys.perfiles', $1) AS ok", [permiso])).rows[0]?.ok;
    expect(await tabla('INSERT')).toBe(false);
    expect(await tabla('DELETE')).toBe(false);

    // Como el backend al subir y al borrar la foto, con el rol de la app.
    const ana = await persona(pg, 'ana@b.test');
    for (const valor of ['2026-11-17T12:00:00Z', null]) {
      await pg.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE buddys_app');
        await tx.query('UPDATE buddys.perfiles SET foto_actualizada_at = $2, updated_at = now() WHERE id = $1::uuid', [ana, valor]);
      });
      const r = await pg.query<{ f: Date | null }>('SELECT foto_actualizada_at AS f FROM buddys.perfiles WHERE id = $1::uuid', [ana]);
      expect(r.rows[0]?.f).toEqual(valor === null ? null : new Date(valor));
    }
  });

  it('con Storage: crea el bucket privado una sola vez, sin pisar uno existente y sin policies en storage.objects', async () => {
    const pg = await baseAntes();
    // eslint-disable-next-line no-restricted-syntax -- constante del propio test
    await pg.exec(STORAGE_STUB);
    await aplicarNueva(pg);
    await aplicarNueva(pg);

    const b = await pg.query<{ id: string; name: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      'SELECT id, name, public, file_size_limit::int AS file_size_limit, allowed_mime_types FROM storage.buckets',
    );
    expect(b.rows).toEqual([{ id: 'avatares', name: 'avatares', public: false, file_size_limit: 262144, allowed_mime_types: ['image/webp'] }]);
    const policies = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'storage'");
    expect(policies.rows[0]?.n).toBe(0);

    // Si el dueño ya lo había creado (o cambiado) a mano, la migración no lo toca.
    await pg.query("UPDATE storage.buckets SET file_size_limit = 100000 WHERE id = 'avatares'");
    await aplicarNueva(pg);
    const despues = await pg.query<{ file_size_limit: number }>("SELECT file_size_limit::int AS file_size_limit FROM storage.buckets WHERE id = 'avatares'");
    expect(despues.rows).toEqual([{ file_size_limit: 100000 }]);
  });
});
