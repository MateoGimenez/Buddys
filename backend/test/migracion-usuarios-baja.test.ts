import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './pglite.js';

/*
 * Migración 20261117100000_usuarios_baja sobre una base que YA tiene perfiles con historial (como producción):
 * primero las anteriores, después datos viejos, después la nueva (dos veces: es idempotente).
 */

const NUEVA = '20261117100000_usuarios_baja.sql';
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

/** Usuario de Auth (el trigger crea su perfil) con rol y activo. */
async function persona(pg: PGlite, email: string, rol = 'empleado', activo = true): Promise<string> {
  const { rows } = await pg.query<{ id: string }>('INSERT INTO auth.users (email) VALUES ($1) RETURNING id::text AS id', [email]);
  const id = String(rows[0]?.id);
  await pg.query('UPDATE buddys.perfiles SET rol_id = $2, activo = $3, nombre = $4 WHERE id = $1::uuid', [id, rol, activo, email.split('@')[0]]);
  return id;
}

async function lavado(pg: PGlite, columna: 'trabajador_id' | 'registrado_por', perfil: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, monto, trabajador_id, registrado_por)
     VALUES ('Cliente', NULL, 'auto', 'pulido', '2026-11-10', 'manana', 'completado', 'mostrador', 1000,
             CASE WHEN $2 = 'trabajador_id' THEN $1::uuid END, CASE WHEN $2 = 'registrado_por' THEN $1::uuid END)
     RETURNING id::text AS id`,
    [perfil, columna],
  );
  return String(rows[0]?.id);
}

/** Un registro de historial por cada FK hacia perfiles. */
const HISTORIAL: Record<string, (pg: PGlite, perfil: string) => Promise<unknown>> = {
  bookings_trabajador_id_fkey: (pg, p) => lavado(pg, 'trabajador_id', p),
  bookings_registrado_por_fkey: (pg, p) => lavado(pg, 'registrado_por', p),
  gastos_creado_por_fkey: (pg, p) =>
    pg.query("INSERT INTO buddys.gastos (fecha, categoria, descripcion, monto, creado_por) VALUES ('2026-11-01', 'otros', 'x', 5, $1::uuid)", [p]),
  movimientos_stock_perfil_fkey: async (pg, p) => {
    const i = await pg.query<{ id: string }>("INSERT INTO buddys.insumos (nombre, unidad) VALUES ('Cera ' || gen_random_uuid(), 'kg') RETURNING id::text AS id");
    await pg.query("INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, perfil_id) VALUES ($1::uuid, 'compra', 1, $2::uuid)", [i.rows[0]?.id, p]);
  },
  presupuestos_creado_por_fkey: (pg, p) =>
    pg.query(
      `INSERT INTO buddys.presupuestos (cliente_nombre, items, total, creado_por)
       VALUES ('Cliente', '[{"cantidad":1,"descripcion":"Lavado","precioUnitario":100}]', 100, $1::uuid)`,
      [p],
    ),
  comprobantes_creado_por_fkey: async (pg, p) => {
    const b = await lavado(pg, 'trabajador_id', p);
    await pg.query(
      `INSERT INTO buddys.comprobantes (booking_id, fecha_emision, forma_pago, cliente_nombre, servicio_nombre, monto, creado_por)
       VALUES ($1::uuid, '2026-11-10', 'efectivo', 'Cliente', 'Lavado', 1000, $2::uuid)`,
      [b, p],
    );
    await pg.query('UPDATE buddys.bookings SET trabajador_id = NULL WHERE id = $1::uuid', [b]); // que solo lo frene el comprobante
  },
};

describe('migración usuarios_baja', () => {
  it('se aplica dos veces sobre perfiles con historial: nada cambia, eliminado_at en null y las FK validadas', async () => {
    const pg = await baseAntes();
    await persona(pg, 'jefe@b.test', 'superadmin');
    const lucia = await persona(pg, 'lucia@b.test');
    const b = await lavado(pg, 'trabajador_id', lucia);
    await pg.query("UPDATE buddys.perfiles SET updated_at = '2026-11-01T10:00:00Z'");

    await aplicarNueva(pg);
    await aplicarNueva(pg);

    const perfiles = await pg.query<{ email: string; activo: boolean; eliminado_at: Date | null; updated_at: Date }>(
      'SELECT email, activo, eliminado_at, updated_at FROM buddys.perfiles ORDER BY email',
    );
    expect(perfiles.rows).toEqual([
      { email: 'jefe@b.test', activo: true, eliminado_at: null, updated_at: new Date('2026-11-01T10:00:00Z') },
      { email: 'lucia@b.test', activo: true, eliminado_at: null, updated_at: new Date('2026-11-01T10:00:00Z') },
    ]);
    const lav = await pg.query<{ trabajador_id: string }>('SELECT trabajador_id::text FROM buddys.bookings WHERE id = $1::uuid', [b]);
    expect(lav.rows[0]?.trabajador_id).toBe(lucia);

    const fks = await pg.query<{ conname: string; confdeltype: string; convalidated: boolean }>(
      `SELECT conname, confdeltype, convalidated FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'buddys.perfiles'::regclass ORDER BY conname`,
    );
    // Las de las mejoras 20261115* siguen en SET NULL acá: las pasa a RESTRICT 20261119100000_unir_ramas.
    expect(fks.rows).toEqual([
      { conname: 'bookings_registrado_por_fkey', confdeltype: 'r', convalidated: true },
      { conname: 'bookings_trabajador_id_fkey', confdeltype: 'r', convalidated: true },
      { conname: 'cierres_caja_cerrado_por_fkey', confdeltype: 'n', convalidated: true },
      { conname: 'comprobantes_creado_por_fkey', confdeltype: 'r', convalidated: true },
      { conname: 'gastos_creado_por_fkey', confdeltype: 'r', convalidated: true },
      { conname: 'gastos_fijos_creado_por_fkey', confdeltype: 'n', convalidated: true },
      { conname: 'gastos_fijos_perfil_fkey', confdeltype: 'n', convalidated: true },
      { conname: 'lavado_fotos_creado_por_fkey', confdeltype: 'n', convalidated: true },
      { conname: 'movimientos_stock_perfil_fkey', confdeltype: 'r', convalidated: true },
      { conname: 'presupuestos_creado_por_fkey', confdeltype: 'r', convalidated: true },
      // Los dispositivos no son historial: siguen en cascada.
      { conname: 'push_suscripciones_perfil_id_fkey', confdeltype: 'c', convalidated: true },
    ]);
  });

  it('CHECK: un dado de baja nunca está activo', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const ana = await persona(pg, 'ana@b.test');
    await expect(pg.query('UPDATE buddys.perfiles SET eliminado_at = now() WHERE id = $1::uuid', [ana])).rejects.toThrow(/perfiles_baja_inactivo/);
    await pg.query('UPDATE buddys.perfiles SET activo = false, eliminado_at = now() WHERE id = $1::uuid', [ana]);
    await expect(pg.query('UPDATE buddys.perfiles SET activo = true WHERE id = $1::uuid', [ana])).rejects.toThrow(/perfiles_baja_inactivo/);
    await pg.query('UPDATE buddys.perfiles SET eliminado_at = NULL, activo = true WHERE id = $1::uuid', [ana]);
  });

  it('GRANT: buddys_app actualiza eliminado_at (y conserva sus columnas), sin INSERT ni DELETE; los roles de la API, nada', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const priv = async (rol: string, columna: string, permiso: string) =>
      (await pg.query<{ ok: boolean }>("SELECT has_column_privilege($1, 'buddys.perfiles', $2, $3) AS ok", [rol, columna, permiso])).rows[0]?.ok;
    for (const columna of ['eliminado_at', 'rol_id', 'activo', 'nombre', 'updated_at']) {
      expect(await priv('buddys_app', columna, 'SELECT'), columna).toBe(true);
      expect(await priv('buddys_app', columna, 'UPDATE'), columna).toBe(true);
    }
    for (const columna of ['id', 'email', 'created_at']) expect(await priv('buddys_app', columna, 'UPDATE'), columna).toBe(false);
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      for (const permiso of ['SELECT', 'INSERT', 'UPDATE']) expect(await priv(rol, 'eliminado_at', permiso), `${rol} ${permiso}`).toBe(false);
    }
    const tabla = async (permiso: string) =>
      (await pg.query<{ ok: boolean }>("SELECT has_table_privilege('buddys_app', 'buddys.perfiles', $1) AS ok", [permiso])).rows[0]?.ok;
    expect(await tabla('INSERT')).toBe(false);
    expect(await tabla('DELETE')).toBe(false);
    const rls = await pg.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'buddys.perfiles'::regclass");
    expect(rls.rows[0]?.rls).toBe(true);

    // La baja como la hace el backend, con el rol de la app.
    await persona(pg, 'jefe@b.test', 'superadmin');
    const ana = await persona(pg, 'ana@b.test');
    await pg.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE buddys_app');
      await tx.query('UPDATE buddys.perfiles SET activo = false, eliminado_at = now(), updated_at = now() WHERE id = $1::uuid', [ana]);
    });
    const r = await pg.query<{ baja: boolean }>('SELECT eliminado_at IS NOT NULL AND NOT activo AS baja FROM buddys.perfiles WHERE id = $1::uuid', [ana]);
    expect(r.rows[0]?.baja).toBe(true);
  });

  it.each(Object.keys(HISTORIAL))('RESTRICT (%s): borrar el usuario en Auth con historial falla y no borra nada', async (fk) => {
    const pg = await baseAntes();
    await persona(pg, 'jefe@b.test', 'superadmin');
    const lucia = await persona(pg, 'lucia@b.test');
    await HISTORIAL[fk]?.(pg, lucia); // historial ANTES de la migración (datos existentes)
    await aplicarNueva(pg);

    // Como Supabase Auth (Authentication > Users > Delete): supabase_auth_admin borra en auth.users y cascada a perfiles.
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE supabase_auth_admin');
        await tx.query('DELETE FROM auth.users WHERE id = $1::uuid', [lucia]);
      }),
    ).rejects.toMatchObject({ code: '23001', message: expect.stringContaining(fk) });

    const quedan = await pg.query<{ n: number }>(
      'SELECT (SELECT count(*) FROM auth.users WHERE id = $1::uuid)::int + (SELECT count(*) FROM buddys.perfiles WHERE id = $1::uuid)::int AS n',
      [lucia],
    );
    expect(quedan.rows[0]?.n).toBe(2);
  });

  it('deja borrar a alguien sin historial (y sus dispositivos se van en cascada)', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    await persona(pg, 'jefe@b.test', 'superadmin');
    const lucia = await persona(pg, 'lucia@b.test');
    const nuevo = await persona(pg, 'nuevo@b.test');
    await lavado(pg, 'trabajador_id', lucia);
    await pg.query('INSERT INTO buddys.push_suscripciones (perfil_id, endpoint, p256dh, auth) VALUES ($1::uuid, $2, $3, $4)', [
      nuevo,
      'https://push.example/x',
      'k'.repeat(87),
      'a'.repeat(22),
    ]);
    await pg.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE supabase_auth_admin');
      await tx.query('DELETE FROM auth.users WHERE id = $1::uuid', [nuevo]);
    });
    const r = await pg.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM buddys.perfiles WHERE id = $1::uuid)::int
            + (SELECT count(*) FROM buddys.push_suscripciones WHERE perfil_id = $1::uuid)::int AS n`,
      [nuevo],
    );
    expect(r.rows[0]?.n).toBe(0);
  });

  it('el trigger del superadmin sigue frenando la baja del último superadmin activo', async () => {
    const pg = await baseAntes();
    await aplicarNueva(pg);
    const jefe = await persona(pg, 'jefe@b.test', 'superadmin');
    const baja = (id: string) =>
      pg.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE buddys_app');
        await tx.query('UPDATE buddys.perfiles SET activo = false, eliminado_at = now() WHERE id = $1::uuid', [id]);
      });
    await expect(baja(jefe)).rejects.toMatchObject({ code: 'MG001' });
    const sigue = await pg.query<{ activo: boolean; eliminado_at: Date | null }>('SELECT activo, eliminado_at FROM buddys.perfiles WHERE id = $1::uuid', [jefe]);
    expect(sigue.rows[0]).toEqual({ activo: true, eliminado_at: null });

    // Con otro superadmin activo, sí.
    await persona(pg, 'otra@b.test', 'superadmin');
    await baja(jefe);
    const despues = await pg.query<{ baja: boolean }>('SELECT eliminado_at IS NOT NULL AND NOT activo AS baja FROM buddys.perfiles WHERE id = $1::uuid', [jefe]);
    expect(despues.rows[0]?.baja).toBe(true);
  });
});
