import { afterEach, describe, expect, it } from 'vitest';
import { conciliarAvatares } from '../src/app.js';
import { DEFAULT_RATE_LIMITS } from '../src/config.js';
import { ROLES } from '../src/domain/perfil.js';
import { CAPACIDADES, puedeEditarPerfilPropio } from '../src/domain/permisos.js';
import { ADMIN_PASSWORD, closeAllContexts, createClient, createTestContext, loginAs, testConfig } from './helpers.js';
import { SUPABASE_URL } from './supabase-fake.js';

afterEach(closeAllContexts);

const BUCKET = 'perfiles-avatares';
const NOW_ISO = '2026-10-16T15:00:00.000Z';

/**
 * Supabase Storage falso (sin red) para el bucket de las fotos de perfil: firma subidas y lecturas (una o en lote),
 * responde HEAD con el tamaño y el tipo de lo "subido", lista carpetas y borra. `subir` simula el PUT del panel.
 */
function storageFalso() {
  const objetos = new Map<string, { tamano: number; tipo: string; creado: string }>();
  const pedidos: { metodo: string; ruta: string; apikey: string | null }[] = [];
  let caido = false;
  const base = `${SUPABASE_URL}/storage/v1`;
  const fetchFn = ((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const metodo = init?.method ?? 'GET';
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    const ruta = url.replace(base, '');
    pedidos.push({ metodo, ruta, apikey: headers.get('apikey') });
    if (caido) return Promise.resolve(new Response('caído', { status: 500 }));
    if (ruta.startsWith('/object/upload/sign/')) return Promise.resolve(Response.json({ url: `${ruta}?token=subida` }));
    if (ruta === `/object/sign/${BUCKET}`) {
      const { paths } = body as { paths: string[] };
      return Promise.resolve(
        Response.json(paths.map((p) => ({ path: p, signedURL: `/object/sign/${BUCKET}/${p}?token=lectura`, error: null }))),
      );
    }
    if (ruta.startsWith('/object/sign/')) return Promise.resolve(Response.json({ signedURL: `${ruta}?token=lectura` }));
    if (metodo === 'HEAD') {
      const objeto = objetos.get(ruta.replace(`/object/authenticated/${BUCKET}/`, ''));
      return Promise.resolve(
        objeto === undefined
          ? new Response(null, { status: 400 })
          : new Response(null, { status: 200, headers: { 'content-length': String(objeto.tamano), 'content-type': objeto.tipo } }),
      );
    }
    if (ruta === `/object/list/${BUCKET}`) {
      const { prefix } = body as { prefix: string };
      const nombres = [...objetos.entries()];
      const lista =
        prefix === ''
          ? [...new Set(nombres.map(([k]) => k.split('/')[0] ?? ''))].map((name) => ({ name, id: null }))
          : nombres
              .filter(([k]) => k.startsWith(`${prefix}/`))
              .map(([k, o]) => ({ name: k.slice(prefix.length + 1), id: k, created_at: o.creado }));
      return Promise.resolve(Response.json(lista));
    }
    if (metodo === 'DELETE') {
      for (const p of (body as { prefixes: string[] }).prefixes) objetos.delete(p);
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response('no', { status: 404 }));
  }) as typeof fetch;
  return {
    fetchFn,
    pedidos,
    objetos,
    /** El PUT del panel a la URL de subida. Devuelve la ruta en el bucket. */
    subir(urlSubida: string, tamano: number, tipo: string, creado = NOW_ISO): string {
      const ruta = urlSubida.replace(`${base}/object/upload/sign/${BUCKET}/`, '').split('?')[0] ?? '';
      objetos.set(ruta, { tamano, tipo, creado });
      return ruta;
    },
    caer: () => {
      caido = true;
    },
  };
}

const esperar = () => new Promise((resolve) => setTimeout(resolve, 20));

async function contexto(config = {}) {
  const storage = storageFalso();
  const context = await createTestContext({ storageFetch: storage.fetchFn, config });
  return { storage, context };
}

async function anotadas(context: Awaited<ReturnType<typeof createTestContext>>): Promise<string[]> {
  const { rows } = await context.db.sql.query('SELECT path FROM buddys.avatares_a_borrar ORDER BY path');
  return rows.map((row) => String(row.path));
}

describe('perfil propio: GET y PATCH /api/admin/perfil', () => {
  it('cada rol ve SU perfil y cambia SU nombre (2 a 60 caracteres, una línea, estricto)', async () => {
    const { context } = await contexto();
    for (const rol of ROLES) {
      const { client, id } = await loginAs(context, rol);
      const r = await client.get('/api/admin/perfil');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        perfil: {
          id,
          email: `${rol}@buddys.test`,
          nombre: null,
          rol,
          avatarUrl: null,
          avatarVenceEl: null,
          creadoEl: expect.any(String) as string,
        },
      });
      const cambio = await client.patch('/api/admin/perfil', { nombre: '  Juan Pérez  ' });
      expect(cambio.status).toBe(200);
      expect(cambio.body.perfil).toMatchObject({ id, nombre: 'Juan Pérez', rol });
      expect((await client.get('/api/auth/me')).body.usuario).toEqual({
        id,
        email: `${rol}@buddys.test`,
        nombre: 'Juan Pérez',
        rol,
        avatarUrl: null,
        avatarVenceEl: null,
      });
    }
    const { client } = await loginAs(context, 'empleado', 'otro@buddys.test');
    for (const body of [{ nombre: 'J' }, { nombre: 'x'.repeat(61) }, { nombre: 'Juan\nPérez' }, {}, { nombre: 'Juan', rol: 'admin' }]) {
      const r = await client.patch('/api/admin/perfil', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    // El rol no se toca desde el perfil propio.
    expect((await client.get('/api/admin/perfil')).body.perfil.rol).toBe('empleado');
  });

  it('sin sesión: 401', async () => {
    const { context } = await contexto();
    expect((await createClient(context.app).get('/api/admin/perfil')).status).toBe(401);
  });

  it('perfil.propio: todos los roles, desde CAPACIDADES', () => {
    const capacidad = CAPACIDADES.find((c) => c.id === 'perfil.propio');
    expect(capacidad).toBeDefined();
    for (const rol of ROLES) expect(puedeEditarPerfilPropio(rol)).toBe(capacidad?.roles[rol] === 'si');
    expect(ROLES.every(puedeEditarPerfilPropio)).toBe(true);
  });
});

describe('foto de perfil: pedir URL -> PUT -> confirmar', () => {
  it('flujo completo: la URL de subida va a SU carpeta, confirma con HEAD y la URL firmada sale en perfil, /me, trabajadores y usuarios', async () => {
    const { context, storage } = await contexto();
    const { client: empleado, id } = await loginAs(context, 'empleado');

    const r = await empleado.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 200_000 });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body)).toEqual(['subida']);
    expect(r.body.subida).toEqual({
      url: expect.stringMatching(new RegExp(`^${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${id}/[0-9a-f-]{36}\\.webp\\?token=subida$`)) as string,
      metodo: 'PUT',
      headers: { 'Content-Type': 'image/webp' },
      venceEl: '2026-10-16T17:00:00.000Z',
    });
    expect(storage.pedidos[0]?.apikey).toBe(testConfig().supabase.secretKey);

    const antes = await empleado.post('/api/admin/perfil/avatar/confirmar');
    expect(antes.status).toBe(409);
    expect(antes.body.error.message).toBe('Todavía no subiste la foto: subila y volvé a confirmar.');

    const ruta = storage.subir(String(r.body.subida.url), 180_000, 'image/webp');
    const ok = await empleado.post('/api/admin/perfil/avatar/confirmar');
    expect(ok.status).toBe(200);
    expect(ok.body.perfil).toMatchObject({
      id,
      avatarUrl: `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${ruta}?token=lectura`,
      avatarVenceEl: '2026-10-16T16:00:00.000Z',
    });
    const { rows } = await context.db.sql.query(
      'SELECT avatar_path, avatar_pendiente_path FROM buddys.perfiles WHERE id = $1::uuid',
      [id],
    );
    expect(rows[0]).toEqual({ avatar_path: ruta, avatar_pendiente_path: null });

    const me = await empleado.get('/api/auth/me');
    expect(me.body.usuario.avatarUrl).toContain(`/object/sign/${BUCKET}/${ruta}`);
    expect(me.body.usuario.avatarVenceEl).toBe('2026-10-16T16:00:00.000Z');
    // La ruta del bucket nunca sale tal cual (solo dentro de la URL firmada) y la secret key tampoco.
    expect(JSON.stringify(me.body)).not.toContain('avatarPath');
    expect(JSON.stringify(ok.body)).not.toContain(String(testConfig().supabase.secretKey));

    const { client: admin } = await loginAs(context, 'admin');
    const trabajadores = await admin.get('/api/admin/trabajadores');
    expect(trabajadores.body.trabajadores).toEqual(
      expect.arrayContaining([
        { id, nombre: 'empleado@buddys.test', rol: 'empleado', avatarUrl: expect.stringContaining(ruta) as string },
        expect.objectContaining({ rol: 'admin', avatarUrl: null }),
      ]),
    );
    const { client: superadmin } = await loginAs(context, 'superadmin');
    const usuarios = await superadmin.get('/api/admin/usuarios');
    const delEmpleado = (usuarios.body.usuarios as { id: string; avatarUrl: string | null }[]).find((u) => u.id === id);
    expect(delEmpleado?.avatarUrl).toContain(ruta);
    expect((usuarios.body.usuarios as { avatarUrl: unknown }[]).every((u) => 'avatarUrl' in u)).toBe(true);
    // Firmadas en lote y guardadas: los listados no piden una firma por persona.
    const firmas = storage.pedidos.filter((p) => p.ruta === `/object/sign/${BUCKET}`);
    expect(firmas.length).toBeLessThanOrEqual(1);
  });

  it('reemplazo: la anterior se borra del bucket y queda anotada; pedir otra subida pisa la pendiente', async () => {
    const { context, storage } = await contexto();
    const { client, id } = await loginAs(context, 'admin');
    const primera = await client.post('/api/admin/perfil/avatar', { contentType: 'image/jpeg', tamano: 1000 });
    const rutaVieja = storage.subir(String(primera.body.subida.url), 1000, 'image/jpeg');
    expect((await client.post('/api/admin/perfil/avatar/confirmar')).status).toBe(200);

    // Una subida que se pide y se abandona: la pisa la siguiente y queda anotada.
    const abandonada = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    const rutaAbandonada = String(abandonada.body.subida.url).split(`${BUCKET}/`)[1]?.split('?')[0];
    const segunda = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 2000 });
    const rutaNueva = storage.subir(String(segunda.body.subida.url), 2000, 'image/webp');
    const ok = await client.post('/api/admin/perfil/avatar/confirmar');
    expect(ok.status).toBe(200);
    expect(ok.body.perfil.avatarUrl).toContain(rutaNueva);
    await esperar();
    expect([...storage.objetos.keys()]).toEqual([rutaNueva]);
    expect(await anotadas(context)).toEqual([rutaAbandonada, rutaVieja].sort());
    expect(rutaNueva.startsWith(`${id}/`)).toBe(true);
    // Confirmar otra vez sin pendiente: 409.
    const otra = await client.post('/api/admin/perfil/avatar/confirmar');
    expect(otra.status).toBe(409);
    expect(otra.body.error.message).toBe('No hay ninguna foto pendiente de confirmar: pedí una subida nueva.');
  });

  it('DELETE saca la foto (204), la borra del bucket y la anota; sin foto también responde 204', async () => {
    const { context, storage } = await contexto();
    const { client } = await loginAs(context, 'empleado');
    const r = await client.post('/api/admin/perfil/avatar', { contentType: 'image/jpeg', tamano: 1000 });
    const ruta = storage.subir(String(r.body.subida.url), 1000, 'image/jpeg');
    await client.post('/api/admin/perfil/avatar/confirmar');
    const borrado = await client.delete('/api/admin/perfil/avatar');
    expect(borrado.status).toBe(204);
    await esperar();
    expect(storage.objetos.size).toBe(0);
    expect(await anotadas(context)).toEqual([ruta]);
    expect((await client.get('/api/admin/perfil')).body.perfil).toMatchObject({ avatarUrl: null, avatarVenceEl: null });
    expect((await client.get('/api/auth/me')).body.usuario.avatarUrl).toBeNull();
    expect((await client.delete('/api/admin/perfil/avatar')).status).toBe(204);
  });

  it('venció: 409 y la pendiente se descarta (anotada)', async () => {
    const { context, storage } = await contexto();
    const { client, id } = await loginAs(context, 'empleado');
    const r = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    const ruta = storage.subir(String(r.body.subida.url), 1000, 'image/webp');
    await context.db.sql.query(
      "UPDATE buddys.perfiles SET avatar_subida_vence_at = '2026-10-16T14:00:00Z' WHERE id = $1::uuid",
      [id],
    );
    const tarde = await client.post('/api/admin/perfil/avatar/confirmar');
    expect(tarde.status).toBe(409);
    expect(tarde.body.error.message).toBe('La subida venció: pedí otra.');
    expect(await anotadas(context)).toEqual([ruta]);
    expect((await client.get('/api/admin/perfil')).body.perfil.avatarUrl).toBeNull();
  });

  it('tamaño y tipo: el pedido se valida con zod y el archivo subido con HEAD (400 y se borra)', async () => {
    const { context, storage } = await contexto();
    const { client } = await loginAs(context, 'empleado');
    for (const body of [
      { contentType: 'image/webp', tamano: 524_289 },
      { contentType: 'image/webp', tamano: 0 },
      { contentType: 'image/png', tamano: 1000 },
      { contentType: 'image/webp' },
      { contentType: 'image/webp', tamano: 1000, extra: 1 },
    ]) {
      expect((await client.post('/api/admin/perfil/avatar', body)).status, JSON.stringify(body)).toBe(400);
    }
    const grande = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 524_288 });
    expect(grande.status).toBe(201);
    storage.subir(String(grande.body.subida.url), 524_289, 'image/webp');
    const r = await client.post('/api/admin/perfil/avatar/confirmar');
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('La foto subida no es válida (tiene que ser JPG o WebP de hasta 512 KB): pedí otra subida.');
    await esperar();
    expect(storage.objetos.size).toBe(0);

    const otroTipo = await client.post('/api/admin/perfil/avatar', { contentType: 'image/jpeg', tamano: 1000 });
    storage.subir(String(otroTipo.body.subida.url), 1000, 'image/webp');
    expect((await client.post('/api/admin/perfil/avatar/confirmar')).status).toBe(400);
    expect((await client.get('/api/admin/perfil')).body.perfil.avatarUrl).toBeNull();
  });

  it('Storage caído al confirmar: 503; firmando la lectura: la foto sale null (sin error)', async () => {
    const { context, storage } = await contexto();
    const { client } = await loginAs(context, 'empleado');
    const r = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    storage.subir(String(r.body.subida.url), 1000, 'image/webp');
    storage.caer();
    expect((await client.post('/api/admin/perfil/avatar/confirmar')).status).toBe(503);
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.usuario.avatarUrl).toBeNull();
  });

  it('sin SUPABASE_SECRET_KEY: avatarUrl siempre null y las rutas de la foto y de la clave responden 503', async () => {
    const context = await createTestContext({
      config: { supabase: { ...testConfig().supabase, secretKey: undefined } },
    });
    const { client } = await loginAs(context, 'admin');
    expect((await client.get('/api/admin/perfil')).body.perfil.avatarUrl).toBeNull();
    expect((await client.get('/api/auth/me')).body.usuario).toMatchObject({ avatarUrl: null, avatarVenceEl: null });
    const pedir = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    expect(pedir.status).toBe(503);
    expect(pedir.body.error.message).toBe('Las fotos de perfil no están configuradas en el servidor.');
    expect((await client.post('/api/admin/perfil/avatar/confirmar')).status).toBe(503);
    expect((await client.delete('/api/admin/perfil/avatar')).status).toBe(503);
    expect((await client.post('/api/admin/perfil/clave', { actual: ADMIN_PASSWORD, nueva: 'otra-clave-larga' })).status).toBe(503);
    expect((await client.get('/api/admin/trabajadores')).body.trabajadores[0].avatarUrl).toBeNull();
    expect((await client.patch('/api/admin/perfil', { nombre: 'Ana' })).status).toBe(200);
  });

  it('rate limit propio por usuario para pedir subidas', async () => {
    const { context } = await contexto({
      rateLimits: { ...testConfig().rateLimits, avatar: { windowMs: 60_000, limit: 2 } },
    });
    const { client } = await loginAs(context, 'empleado');
    const { client: otro } = await loginAs(context, 'admin');
    const pedir = (c: typeof client) => c.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    expect((await pedir(client)).status).toBe(201);
    expect((await pedir(client)).status).toBe(201);
    expect((await pedir(client)).status).toBe(429);
    expect((await pedir(otro)).status).toBe(201);
    expect(DEFAULT_RATE_LIMITS.avatar).toEqual({ windowMs: 10 * 60_000, limit: 10 });
  });
});

describe('conciliación del bucket perfiles-avatares', () => {
  it('descarta pendientes vencidas, borra lo anotado cuando llega su plazo y los huérfanos de más de 2 horas', async () => {
    const { context, storage } = await contexto();
    const { client, id } = await loginAs(context, 'empleado');
    // Foto vigente: no se toca.
    const vigente = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    const rutaVigente = storage.subir(String(vigente.body.subida.url), 1000, 'image/webp', '2026-10-16T10:00:00.000Z');
    await client.post('/api/admin/perfil/avatar/confirmar');
    // Pendiente que nunca se confirma (su objeto sí se subió).
    const pendiente = await client.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    const rutaPendiente = storage.subir(String(pendiente.body.subida.url), 1000, 'image/webp');
    // Huérfano: un objeto que la base no conoce (subido hace más de 2 horas) y uno reciente (se respeta).
    storage.objetos.set(`${id}/11111111-1111-4111-8111-111111111111.jpg`, { tamano: 5, tipo: 'image/jpeg', creado: '2026-10-16T10:00:00.000Z' });
    storage.objetos.set(`${id}/22222222-2222-4222-8222-222222222222.jpg`, { tamano: 5, tipo: 'image/jpeg', creado: NOW_ISO });

    // Todavía no venció nada: solo se va el huérfano viejo.
    expect(await conciliarAvatares(context.app)).toEqual({ pendientesVencidas: 0, borrados: 0, huerfanos: 1 });
    expect([...storage.objetos.keys()].sort()).toEqual(
      [rutaVigente, rutaPendiente, `${id}/22222222-2222-4222-8222-222222222222.jpg`].sort(),
    );

    // Tres horas después: la pendiente venció (se descarta, se anota y se borra en la misma pasada) y el reciente ya es huérfano.
    context.clock.current = new Date('2026-10-16T18:00:00.000Z');
    expect(await conciliarAvatares(context.app)).toEqual({ pendientesVencidas: 1, borrados: 1, huerfanos: 1 });
    expect([...storage.objetos.keys()]).toEqual([rutaVigente]);
    expect(await anotadas(context)).toEqual([]);
    const { rows } = await context.db.sql.query('SELECT avatar_path, avatar_pendiente_path FROM buddys.perfiles WHERE id = $1::uuid', [id]);
    expect(rows[0]).toEqual({ avatar_path: rutaVigente, avatar_pendiente_path: null });
  });

  it('al borrar el usuario (cascada desde Supabase Auth) su foto queda anotada para borrar', async () => {
    const { context, storage } = await contexto();
    const { client: superadmin } = await loginAs(context, 'superadmin');
    const { client: empleado, id } = await loginAs(context, 'empleado');
    const r = await empleado.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 1000 });
    const ruta = storage.subir(String(r.body.subida.url), 1000, 'image/webp');
    await empleado.post('/api/admin/perfil/avatar/confirmar');
    expect((await superadmin.delete(`/api/admin/usuarios/${id}`)).status).toBe(204);
    expect(await anotadas(context)).toEqual([ruta]);
    context.clock.current = new Date('2026-10-16T18:00:00.000Z');
    await conciliarAvatares(context.app);
    expect(storage.objetos.size).toBe(0);
  });
});

describe('cambiar la contraseña: POST /api/admin/perfil/clave', () => {
  it('verifica la actual contra Supabase Auth, cierra esa sesión de prueba y cambia la clave (204)', async () => {
    const { context } = await contexto();
    const { client, id } = await loginAs(context, 'empleado');
    const sesiones = await context.supabase.sessionCount();
    const r = await client.post('/api/admin/perfil/clave', { actual: ADMIN_PASSWORD, nueva: 'una-clave-nueva-123' });
    expect(r.status).toBe(204);
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe('una-clave-nueva-123');
    // La sesión que abrió la verificación se cerró: quedan las mismas que antes.
    expect(await context.supabase.sessionCount()).toBe(sesiones);
    // La sesión del panel sigue andando.
    expect((await client.get('/api/admin/perfil')).body.perfil.id).toBe(id);
    // Nunca se loguean contraseñas.
    const log = context.logger.lines.join('\n');
    expect(log).not.toContain(ADMIN_PASSWORD);
    expect(log).not.toContain('una-clave-nueva-123');
    expect(log).toContain(`contraseña cambiada usuario=${id}`);
  });

  it('400 si la actual no coincide (sin decir más), si la nueva es corta o igual a la actual; estricto', async () => {
    const { context } = await contexto();
    const { client } = await loginAs(context, 'admin');
    const mal = await client.post('/api/admin/perfil/clave', { actual: 'no-es-esta', nueva: 'una-clave-nueva-123' });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'La contraseña actual no es correcta.',
      fields: { actual: 'La contraseña actual no es correcta.' },
    });
    const corta = await client.post('/api/admin/perfil/clave', { actual: ADMIN_PASSWORD, nueva: 'corta' });
    expect(corta.status).toBe(400);
    expect(corta.body.error.fields.nueva).toBeDefined();
    const igual = await client.post('/api/admin/perfil/clave', { actual: ADMIN_PASSWORD, nueva: ADMIN_PASSWORD });
    expect(igual.status).toBe(400);
    expect(igual.body.error.fields.nueva).toBe('La contraseña nueva tiene que ser distinta de la actual.');
    expect((await client.post('/api/admin/perfil/clave', { actual: ADMIN_PASSWORD, nueva: 'una-clave-nueva-123', otra: 1 })).status).toBe(400);
    expect(context.supabase.passwordOf('admin@buddys.test')).toBe(ADMIN_PASSWORD);
    expect(context.logger.lines.join('\n')).not.toContain('no-es-esta');
  });

  it('una contraseña que Supabase rechaza por débil: 400 en el campo nueva', async () => {
    const { context } = await contexto();
    const { client } = await loginAs(context, 'empleado');
    const r = await client.post('/api/admin/perfil/clave', { actual: ADMIN_PASSWORD, nueva: 'clave-debil-larga' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.nueva).toBeDefined();
  });

  it('rate limit estricto por usuario: cuentan todos los intentos', async () => {
    const { context } = await contexto({
      rateLimits: { ...testConfig().rateLimits, clave: { windowMs: 60_000, limit: 2 } },
    });
    const { client } = await loginAs(context, 'empleado');
    const intento = () => client.post('/api/admin/perfil/clave', { actual: 'no-es-esta', nueva: 'una-clave-nueva-123' });
    expect((await intento()).status).toBe(400);
    expect((await intento()).status).toBe(400);
    expect((await intento()).status).toBe(429);
    expect(DEFAULT_RATE_LIMITS.clave).toEqual({ windowMs: 15 * 60_000, limit: 5 });
  });
});
