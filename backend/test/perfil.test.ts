import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS } from '../src/config.js';
import { verifyPostgresSchema } from '../src/db/postgres.js';
import {
  type Client,
  ORIGIN,
  type TestContext,
  addUser,
  closeAllContexts,
  createClient,
  createTestContext,
  loginAs,
  loginClient,
} from './helpers.js';
import { createPgliteDatabase } from './pglite.js';
import { WEAK_PASSWORD_MARK } from './supabase-fake.js';

/*
 * Mi perfil y foto de perfil (contrato reportes/2026-11-17_04_perfil-y-foto.md). Las imágenes se generan acá con sharp;
 * Supabase Auth y Storage son los falsos de test/ (ningún request sale a la red).
 */

afterEach(closeAllContexts);

const PASSWORD = 'clave-de-prueba-123';
const DOS_MB = 2 * 1024 * 1024;

const lienzo = (width = 400, height = 300) =>
  sharp({ create: { width, height, channels: 3, background: '#c33' } });

const jpg = () => lienzo().jpeg().toBuffer();
const png = () => lienzo().png().toBuffer();
const webp = () => lienzo().webp().toBuffer();

/** Una JPG con EXIF (copyright) y GPS (latitud): lo que NO tiene que quedar en la foto guardada. */
const jpgConExifYGps = () =>
  lienzo()
    .withExif({ IFD0: { Copyright: 'Buddys' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '29/1 24/1 0/1' } })
    .jpeg()
    .toBuffer();

async function gifAnimado(): Promise<Buffer> {
  const cuadros = await Promise.all(
    ['#f00', '#0f0', '#00f'].map((color) =>
      sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer(),
    ),
  );
  return sharp(cuadros, { join: { animated: true } }).gif().toBuffer();
}

/** Sube `bytes` como foto con ese Content-Type (el body va binario, como lo manda el panel). */
function subir(client: Client, bytes: Buffer | string, tipo: string, origin = ORIGIN) {
  return client.agent.put('/api/admin/perfil/foto').set('Origin', origin).set('Content-Type', tipo).send(bytes);
}

function fotoGuardada(context: TestContext, id: string): Uint8Array | undefined {
  return context.storage.objetos.get(`avatares/${id}.webp`)?.bytes;
}

async function fotoEnBase(context: TestContext, id: string): Promise<unknown> {
  const { rows } = await context.db.sql.query('SELECT foto_actualizada_at FROM buddys.perfiles WHERE id = $1::uuid', [id]);
  return rows[0]?.foto_actualizada_at ?? null;
}

describe('GET y PATCH /api/admin/perfil', () => {
  it('cada rol ve su perfil con fotoVersion y fotosDisponibles; login, /me y refresh traen fotoVersion', async () => {
    const context = await createTestContext();
    for (const rol of ['superadmin', 'admin', 'empleado'] as const) {
      const { client, id } = await loginAs(context, rol);
      const response = await client.get('/api/admin/perfil');
      expect(response.status, rol).toBe(200);
      expect(response.body).toEqual({
        perfil: { id, email: `${rol}@buddys.test`, nombre: null, rol, fotoVersion: null },
        fotosDisponibles: true,
      });
      expect((await client.get('/api/auth/me')).body.usuario).toEqual(response.body.perfil);
    }
    await addUser(context, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    const ana = createClient(context.app);
    const login = await ana.post('/api/auth/login', { email: 'ana@buddys.test', password: PASSWORD });
    expect(Object.keys(login.body.usuario).sort()).toEqual(['email', 'fotoVersion', 'id', 'nombre', 'rol']);
    expect(login.body.usuario.fotoVersion).toBeNull();
    const refresh = await ana.post('/api/auth/refresh');
    expect(refresh.status).toBe(200);
    expect(refresh.body.usuario).toEqual(login.body.usuario);
  });

  it('PATCH del nombre se refleja en /api/auth/me (y en la lista de usuarios); null o "" lo borran', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');

    const response = await client.patch('/api/admin/perfil', { nombre: '  Beto  ' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      perfil: { id, email: 'empleado@buddys.test', nombre: 'Beto', rol: 'empleado', fotoVersion: null },
    });
    expect((await client.get('/api/auth/me')).body.usuario.nombre).toBe('Beto');
    expect((await client.patch('/api/admin/perfil', { nombre: '' })).body.perfil.nombre).toBeNull();
    expect((await client.patch('/api/admin/perfil', { nombre: 'Beto' })).body.perfil.nombre).toBe('Beto');
    expect((await client.patch('/api/admin/perfil', { nombre: null })).body.perfil.nombre).toBeNull();
    expect(context.logger.text).toContain(`Perfil actualizado id=${id} campos=nombre`);
  });

  it('validación estricta: body vacío, campo desconocido (rol), nombre largo y contraseñas sueltas => 400', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');

    const vacio = await client.patch('/api/admin/perfil', {});
    expect(vacio.status).toBe(400);
    expect(vacio.body.error.message).toBe('Indicá al menos un cambio: nombre o contraseña.');
    // Nadie se cambia el rol desde su perfil.
    expect((await client.patch('/api/admin/perfil', { rol: 'superadmin' })).body.error.fields).toEqual({
      rol: 'Este campo no está permitido.',
    });
    expect((await client.patch('/api/admin/perfil', { nombre: 'x'.repeat(81) })).status).toBe(400);
    expect((await client.patch('/api/admin/perfil', { passwordActual: PASSWORD })).body.error.fields).toEqual({
      passwordNueva: 'Ingresá la contraseña nueva.',
    });
    expect((await client.patch('/api/admin/perfil', { passwordNueva: 'nueva-clave-123' })).body.error.fields).toEqual({
      passwordActual: 'Ingresá tu contraseña actual.',
    });
    expect(
      (await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'corta' })).body.error.fields,
    ).toHaveProperty('passwordNueva');
  });
});

describe('cambiar la contraseña propia', () => {
  it('la actual incorrecta: 400 en fields.passwordActual y no cambia nada', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');

    const response = await client.patch('/api/admin/perfil', { passwordActual: 'otra-clave-999', passwordNueva: 'nueva-clave-123' });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'La contraseña actual no es correcta.',
      fields: { passwordActual: 'La contraseña actual no es correcta.' },
    });
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe(PASSWORD);
    expect(context.supabase.calls.some((call) => call.path.startsWith('/admin/'))).toBe(false);
  });

  it('la correcta: verifica con grant_type=password, cierra al toque esa sesión, cambia por la API admin y la sesión sigue', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    expect(await context.supabase.sessionCount()).toBe(1);
    context.supabase.calls.length = 0;

    const response = await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' });
    expect(response.status).toBe(200);
    expect(response.body.perfil).toMatchObject({ id, rol: 'empleado' });
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe('nueva-clave-123');
    // Login de verificación, logout de ESA sesión (con su token) y el cambio por la API admin (con la secret key).
    expect(context.supabase.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /token?grant_type=password',
      'POST /logout?scope=local',
      `PUT /admin/users/${id}`,
    ]);
    expect(context.supabase.calls[1]?.bearer).toBe(true);
    // Solo queda la sesión del panel: la de verificación se cerró.
    expect(await context.supabase.sessionCount()).toBe(1);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    // Nunca la contraseña ni el email en el log.
    expect(context.logger.text).toContain(`Contraseña cambiada id=${id}`);
    expect(context.logger.text).not.toContain('nueva-clave-123');
    expect(context.logger.text).not.toContain(PASSWORD);
    // La nueva sirve para entrar.
    await expect(loginClient(context, 'empleado@buddys.test', 'nueva-clave-123')).resolves.toBeDefined();
  });

  it('cierra las OTRAS sesiones de esa persona: la otra da 401, la actual sigue y las de los demás no se tocan', async () => {
    const context = await createTestContext();
    const { client: actual, id } = await loginAs(context, 'empleado');
    const otra = await loginClient(context, 'empleado@buddys.test', PASSWORD);
    const { client: ajena } = await loginAs(context, 'admin');
    expect((await otra.get('/api/auth/me')).status).toBe(200);
    expect(await context.supabase.sessionCount()).toBe(3);

    const response = await actual.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' });
    expect(response.status).toBe(200);

    expect((await otra.get('/api/auth/me')).status).toBe(401);
    expect((await otra.get('/api/admin/perfil')).status).toBe(401);
    expect((await actual.get('/api/auth/me')).status).toBe(200);
    expect((await actual.patch('/api/admin/perfil', { nombre: 'Lu' })).status).toBe(200);
    expect((await ajena.get('/api/auth/me')).status).toBe(200);
    expect(await context.supabase.sessionCount()).toBe(2);
    expect(context.logger.text).toContain(`Otras sesiones cerradas id=${id} cantidad=1`);
  });

  it('si no se pueden cerrar las otras sesiones, la contraseña igual queda cambiada (200) y el log solo lleva ids', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    // Sin la función en la base (como si faltara la migración): la llamada falla.
    await context.db.sql.query('DROP FUNCTION buddys_private.cerrar_otras_sesiones(uuid, uuid)');

    const response = await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' });
    expect(response.status).toBe(200);
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe('nueva-clave-123');
    expect(context.logger.text).toMatch(new RegExp(`No se pudieron cerrar las otras sesiones id=${id} sesion=[0-9a-f-]{36}`));
    expect(context.logger.text).not.toContain('empleado@buddys.test');
    expect(context.logger.text).not.toContain('nueva-clave-123');
  });

  it('nombre y contraseña juntos; una nueva débil para Supabase => 400 en fields.passwordNueva', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'admin');

    const debil = await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: `muy-${WEAK_PASSWORD_MARK}-123` });
    expect(debil.status).toBe(400);
    expect(Object.keys(debil.body.error.fields)).toEqual(['passwordNueva']);
    expect(await context.supabase.sessionCount()).toBe(1);

    const ambos = await client.patch('/api/admin/perfil', { nombre: 'Carla', passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' });
    expect(ambos.status).toBe(200);
    expect(ambos.body.perfil.nombre).toBe('Carla');
    expect(context.supabase.passwordOf('admin@buddys.test')).toBe('nueva-clave-123');
  });

  it('límite: más de 5 intentos en 15 minutos => 429, contados por usuario (el nombre no cuenta)', async () => {
    const context = await createTestContext({
      config: {
        rateLimits: {
          ...DEFAULT_RATE_LIMITS,
          api: { windowMs: 60_000, limit: 10_000 },
          loginFailures: { windowMs: 60_000, limit: 10_000 },
        },
      },
    });
    const { client } = await loginAs(context, 'empleado');
    const { client: otro } = await loginAs(context, 'admin');
    const intento = { passwordActual: 'mal-mal-mal-1', passwordNueva: 'nueva-clave-123' };

    for (let i = 0; i < 5; i += 1) expect((await client.patch('/api/admin/perfil', intento)).status).toBe(400);
    const limitado = await client.patch('/api/admin/perfil', { ...intento, passwordActual: PASSWORD });
    expect(limitado.status).toBe(429);
    expect(limitado.body.error.code).toBe('RATE_LIMITED');
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe(PASSWORD);
    // Cambiar el nombre sigue andando; otro usuario no está limitado.
    expect((await client.patch('/api/admin/perfil', { nombre: 'Beto' })).status).toBe(200);
    expect((await otro.patch('/api/admin/perfil', intento)).status).toBe(400);
  });

  it('Supabase caído => 503; sin SUPABASE_SECRET_KEY => 503 (el nombre sí se cambia)', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    context.supabase.mode = 'down';
    expect((await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' })).status).toBe(503);
    context.supabase.mode = 'ok';

    const sinClave = await createTestContext({
      config: { supabase: { ...context.config.supabase, secretKey: undefined } },
    });
    const { client: sinClaveClient } = await loginAs(sinClave, 'empleado');
    const response = await sinClaveClient.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect((await sinClaveClient.patch('/api/admin/perfil', { nombre: 'Beto' })).status).toBe(200);
  });
});

describe('PUT /api/admin/perfil/foto', () => {
  it('acepta JPG, PNG y WebP reales: guarda WebP de 256×256 en Storage y fotoVersion pasa a la fecha', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');

    for (const [tipo, bytes] of [
      ['image/jpeg', await jpg()],
      ['image/png', await png()],
      ['image/webp', await webp()],
    ] as const) {
      context.clock.current = new Date(context.clock.current.getTime() + 60_000);
      const response = await subir(client, bytes, tipo);
      expect(response.status, tipo).toBe(200);
      expect(response.body.perfil).toMatchObject({ id, fotoVersion: context.clock.current.toISOString() });
      const guardada = fotoGuardada(context, id);
      expect(guardada, tipo).toBeDefined();
      const metadata = await sharp(guardada).metadata();
      expect({ format: metadata.format, width: metadata.width, height: metadata.height }, tipo).toEqual({
        format: 'webp',
        width: 256,
        height: 256,
      });
    }
    expect(await fotoEnBase(context, id)).not.toBeNull();
    expect((await client.get('/api/auth/me')).body.usuario.fotoVersion).toBe(context.clock.current.toISOString());

    // Siempre a la misma ruta, con upsert y la secret key SOLO en apikey.
    const subidas = context.storage.calls.filter((call) => call.method === 'POST');
    expect(subidas).toHaveLength(3);
    for (const call of subidas) {
      expect(call).toMatchObject({
        path: `/storage/v1/object/avatares/${id}.webp`,
        apikey: context.config.supabase.secretKey,
        bearer: false,
        upsert: 'true',
        contentType: 'image/webp',
      });
    }
    expect(context.storage.objetos.size).toBe(1);
  });

  it('la salida no tiene EXIF, GPS ni perfil ICC (se sube una JPG con EXIF y GPS)', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'admin');
    const original = await jpgConExifYGps();
    const exif = (await sharp(original).metadata()).exif;
    expect(exif?.toString('latin1')).toContain('Buddys');
    expect(exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true); // puntero al IFD de GPS (0x8825, little endian)

    expect((await subir(client, original, 'image/jpeg')).status).toBe(200);
    const metadata = await sharp(fotoGuardada(context, id)).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.hasProfile).toBe(false);
    expect(metadata.orientation).toBeUndefined();
  });

  it('rechaza lo que no es la imagen que dice ser: 400 en fields.foto y no toca Storage ni el perfil', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    const animado = await gifAnimado();
    const webpAnimado = await sharp(animado, { animated: true }).webp().toBuffer();
    expect((await sharp(webpAnimado, { animated: true }).metadata()).pages).toBe(3);
    const truncada = (await jpg()).subarray(0, 200);

    const casos: [string, Buffer | string, string][] = [
      ['PNG con Content-Type de JPG', await png(), 'image/jpeg'],
      ['JPG con Content-Type de WebP', await jpg(), 'image/webp'],
      ['HTML renombrado', '<!doctype html><html><body><script>alert(1)</script></body></html>', 'image/png'],
      ['SVG renombrado', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/png'],
      ['GIF animado como PNG', animado, 'image/png'],
      ['WebP animado', webpAnimado, 'image/webp'],
      ['JPG cortada', truncada, 'image/jpeg'],
      ['solo la firma de PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'image/png'],
    ];
    for (const [caso, bytes, tipo] of casos) {
      const response = await subir(client, bytes, tipo);
      expect(response.status, caso).toBe(400);
      expect(response.body.error, caso).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Subí una foto JPG, PNG o WebP.',
        fields: { foto: 'Subí una foto JPG, PNG o WebP.' },
      });
    }
    // Sin body.
    expect((await client.agent.put('/api/admin/perfil/foto').set('Origin', ORIGIN).set('Content-Type', 'image/png')).status).toBe(400);
    expect(context.storage.calls).toHaveLength(0);
    expect(await fotoEnBase(context, id)).toBeNull();
  });

  it('una "bomba" de píxeles (48 MP en pocos KB) => 400', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const bomba = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomba.length).toBeLessThan(DOS_MB);

    const response = await subir(client, bomba, 'image/png');
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ foto: 'Subí una foto JPG, PNG o WebP.' });
    expect(context.storage.calls).toHaveLength(0);
  });

  it('más de 2 MB => 413 con el mensaje del contrato', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const pesada = Buffer.alloc(3 * 1024 * 1024, 0);
    pesada.set([0xff, 0xd8, 0xff], 0);

    const response = await subir(client, pesada, 'image/jpeg');
    expect(response.status).toBe(413);
    expect(response.body.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'La foto pesa más de 2 MB. Elegí una más liviana.',
    });
    expect(context.storage.calls).toHaveLength(0);
  });

  it('Content-Type que no es imagen aceptada => 415; la excepción es solo para esta ruta y método; Origin igual que siempre', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const foto = await png();

    expect((await subir(client, 'hola', 'text/plain')).status).toBe(415);
    expect((await subir(client, foto, 'image/gif')).status).toBe(415);
    expect((await subir(client, '<svg/>', 'image/svg+xml')).status).toBe(415);
    expect((await subir(client, foto, 'multipart/form-data; boundary=x')).status).toBe(415);
    // Otras rutas y otros métodos siguen pidiendo JSON.
    const patchImagen = await client.agent.patch('/api/admin/perfil').set('Origin', ORIGIN).set('Content-Type', 'image/png').send(foto);
    expect(patchImagen.status).toBe(415);
    const postImagen = await client.agent.post('/api/admin/perfil/foto').set('Origin', ORIGIN).set('Content-Type', 'image/png').send(foto);
    expect(postImagen.status).toBe(415);
    const otraRuta = await client.agent.put('/api/admin/metas/2026-10').set('Origin', ORIGIN).set('Content-Type', 'image/png').send(foto);
    expect(otraRuta.status).toBe(415);
    // El control de Origin no cambia.
    const otroSitio = await subir(client, foto, 'image/png', 'https://malo.example');
    expect(otroSitio.status).toBe(403);
    expect(otroSitio.body.error.code).toBe('FORBIDDEN_ORIGIN');
    expect(context.storage.calls).toHaveLength(0);
  });

  it('sin sesión => 401 (no se procesa nada)', async () => {
    const context = await createTestContext();
    const anonimo = createClient(context.app);
    expect((await subir(anonimo, await png(), 'image/png')).status).toBe(401);
    expect(context.storage.calls).toHaveLength(0);
  });

  it('Storage caído => 503 y el perfil no cambia; sin SUPABASE_SECRET_KEY => fotosDisponibles false y 503', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    context.storage.mode = 'error';
    const response = await subir(client, await png(), 'image/png');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(await fotoEnBase(context, id)).toBeNull();
    context.storage.mode = 'down';
    expect((await subir(client, await png(), 'image/png')).status).toBe(503);
    expect(context.logger.text).not.toContain('proyecto-test.supabase.co');

    const sinClave = await createTestContext({
      config: { supabase: { ...context.config.supabase, secretKey: undefined } },
    });
    const { client: sinClaveClient } = await loginAs(sinClave, 'empleado');
    expect((await sinClaveClient.get('/api/admin/perfil')).body.fotosDisponibles).toBe(false);
    expect((await subir(sinClaveClient, await png(), 'image/png')).status).toBe(503);
    expect((await sinClaveClient.delete('/api/admin/perfil/foto')).status).toBe(503);
    expect(sinClave.storage.calls).toHaveLength(0);
  });
});

describe('DELETE /api/admin/perfil/foto', () => {
  it('borra el objeto y pone fotoVersion en null; sin foto responde 200 igual', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    expect((await subir(client, await png(), 'image/png')).status).toBe(200);

    const response = await client.delete('/api/admin/perfil/foto');
    expect(response.status).toBe(200);
    expect(response.body.perfil).toMatchObject({ id, fotoVersion: null });
    expect(fotoGuardada(context, id)).toBeUndefined();
    expect(await fotoEnBase(context, id)).toBeNull();
    const otraVez = await client.delete('/api/admin/perfil/foto');
    expect(otraVez.status).toBe(200);
    expect(otraVez.body.perfil.fotoVersion).toBeNull();
  });
});

describe('GET /api/admin/usuarios/:id/foto', () => {
  async function conFoto(context: TestContext) {
    const empleado = await loginAs(context, 'empleado');
    const subida = await subir(empleado.client, await png(), 'image/png');
    return { ...empleado, version: String(subida.body.perfil.fotoVersion) };
  }

  it('uno mismo, un admin y un superadmin: 200 image/webp con las cabeceras del contrato', async () => {
    const context = await createTestContext();
    const { client, id, version } = await conFoto(context);
    const { client: admin } = await loginAs(context, 'admin');
    const { client: superadmin } = await loginAs(context, 'superadmin');

    for (const [quien, cliente] of [['uno mismo', client], ['admin', admin], ['superadmin', superadmin]] as const) {
      const response = await cliente.get(`/api/admin/usuarios/${id}/foto?v=${encodeURIComponent(version)}`).buffer(true);
      expect(response.status, quien).toBe(200);
      expect(response.headers['content-type'], quien).toBe('image/webp');
      expect(response.headers['cache-control'], quien).toBe('private, max-age=86400, immutable');
      expect(response.headers.etag, quien).toBe(`"${version}"`);
      expect(response.headers['x-content-type-options'], quien).toBe('nosniff');
      expect(response.headers['content-security-policy'], quien).toBe("default-src 'none'");
      expect(Buffer.compare(response.body as Buffer, Buffer.from((fotoGuardada(context, id)) ?? [])), quien).toBe(0);
    }

    // Sin ?v= (o con una versión vieja): se revalida.
    expect((await admin.get(`/api/admin/usuarios/${id}/foto`)).headers['cache-control']).toBe('private, no-cache');
    expect((await admin.get(`/api/admin/usuarios/${id}/foto?v=vieja`)).headers['cache-control']).toBe('private, no-cache');
    // La lista de usuarios trae la versión.
    const lista = await admin.get('/api/admin/usuarios');
    expect(lista.body.usuarios.find((u: { id: string }) => u.id === id)?.fotoVersion).toBe(version);
  });

  it('304 si coincide If-None-Match; 200 si no', async () => {
    const context = await createTestContext();
    const { client, id, version } = await conFoto(context);

    const igual = await client.get(`/api/admin/usuarios/${id}/foto`).set('If-None-Match', `"${version}"`);
    expect(igual.status).toBe(304);
    expect(igual.headers.etag).toBe(`"${version}"`);
    expect((await client.get(`/api/admin/usuarios/${id}/foto`).set('If-None-Match', `W/"${version}", "otra"`)).status).toBe(304);
    expect((await client.get(`/api/admin/usuarios/${id}/foto`).set('If-None-Match', '"otra"')).status).toBe(200);
  });

  it('el empleado pidiendo la de otro: 403 (exista o no); sin foto o inexistente: 404', async () => {
    const context = await createTestContext();
    const { id } = await conFoto(context);
    const otroEmpleado = await loginAs(context, 'empleado', 'otro@buddys.test');
    const { client: admin, id: adminId } = await loginAs(context, 'admin');

    const ajena = await otroEmpleado.client.get(`/api/admin/usuarios/${id}/foto`);
    expect(ajena.status).toBe(403);
    expect(ajena.body.error.code).toBe('FORBIDDEN');
    expect((await otroEmpleado.client.get('/api/admin/usuarios/11111111-1111-4111-8111-111111111111/foto')).status).toBe(403);
    // La propia sin foto: 404.
    expect((await otroEmpleado.client.get(`/api/admin/usuarios/${otroEmpleado.id}/foto`)).status).toBe(404);
    expect((await admin.get(`/api/admin/usuarios/${adminId}/foto`)).status).toBe(404);
    expect((await admin.get('/api/admin/usuarios/11111111-1111-4111-8111-111111111111/foto')).status).toBe(404);
    expect((await admin.get('/api/admin/usuarios/no-es-un-uuid/foto')).status).toBe(404);
    // Sin sesión: 401.
    expect((await createClient(context.app).get(`/api/admin/usuarios/${id}/foto`)).status).toBe(401);
    // Si la foto no está en Storage (la borraron a mano), 404 y queda en el log.
    context.storage.objetos.clear();
    expect((await admin.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(404);
    expect(context.logger.text).toContain(`Foto de perfil que falta en Storage id=${id}`);
  });
});

describe('eliminar un usuario borra su foto (objetivo A)', () => {
  it('sin historial (se borra): se borra la foto de Storage', async () => {
    const context = await createTestContext();
    const { client: empleado, id } = await loginAs(context, 'empleado');
    expect((await subir(empleado, await png(), 'image/png')).status).toBe(200);
    const { client: admin } = await loginAs(context, 'admin');

    expect((await admin.delete(`/api/admin/usuarios/${id}`)).body).toEqual({ resultado: 'eliminado' });
    expect(fotoGuardada(context, id)).toBeUndefined();
    expect(context.logger.text).toContain(`Foto de perfil borrada id=${id}`);
  });

  it('con historial (baja): se borra la foto y su versión; si Storage falla, la baja sigue y queda en el log', async () => {
    const context = await createTestContext();
    const { client: admin, id: adminId } = await loginAs(context, 'admin');
    const ids: string[] = [];
    for (const email of ['a@buddys.test', 'b@buddys.test']) {
      const { client, id } = await loginAs(context, 'empleado', email);
      expect((await subir(client, await png(), 'image/png')).status).toBe(200);
      await context.db.sql.query(
        "INSERT INTO buddys.gastos (fecha, categoria, descripcion, monto, creado_por) VALUES ('2026-10-14', 'otros', 'x', 100, $1::uuid)",
        [id],
      );
      ids.push(id);
    }
    const [a, b] = ids as [string, string];

    const baja = await admin.delete(`/api/admin/usuarios/${a}`);
    expect(baja.body).toMatchObject({ resultado: 'baja', usuario: { id: a, fotoVersion: null } });
    expect(fotoGuardada(context, a)).toBeUndefined();
    expect(await fotoEnBase(context, a)).toBeNull();

    context.storage.mode = 'error';
    const conFalla = await admin.delete(`/api/admin/usuarios/${b}`);
    expect(conFalla.status).toBe(200);
    expect(conFalla.body.resultado).toBe('baja');
    expect(context.logger.text).toContain(`No se pudo borrar la foto de perfil id=${b} al eliminar el usuario`);
    expect(adminId).toBeDefined();
  });

  it('baja con Storage caído: la versión se borra igual (la foto deja de servirse) y el objeto huérfano queda en el log', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client, id } = await loginAs(context, 'empleado');
    expect((await subir(client, await png(), 'image/png')).status).toBe(200);
    await context.db.sql.query(
      "INSERT INTO buddys.gastos (fecha, categoria, descripcion, monto, creado_por) VALUES ('2026-10-14', 'otros', 'x', 100, $1::uuid)",
      [id],
    );
    expect((await admin.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(200);

    context.storage.mode = 'error';
    const baja = await admin.delete(`/api/admin/usuarios/${id}`);
    expect(baja.status).toBe(200);
    expect(baja.body).toMatchObject({ resultado: 'baja', usuario: { id, fotoVersion: null } });
    expect(await fotoEnBase(context, id)).toBeNull();
    // El objeto sigue en Storage (no se pudo borrar), pero ya no se sirve: con Storage de vuelta, 404.
    expect(fotoGuardada(context, id)).toBeDefined();
    context.storage.mode = 'ok';
    expect((await admin.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(404);
    expect(context.logger.text).toContain(`el objeto avatares/${id}.webp queda huérfano`);
  });
});

describe('arranque: verifyPostgresSchema', () => {
  it('exige perfiles.foto_actualizada_at (migración perfil_foto)', async () => {
    const db = await createPgliteDatabase();
    try {
      await expect(verifyPostgresSchema(db.appSql)).resolves.toBeUndefined();
      await db.sql.query('ALTER TABLE buddys.perfiles DROP COLUMN foto_actualizada_at');
      await expect(verifyPostgresSchema(db.sql)).rejects.toThrow(
        /Faltan columnas en buddys\.perfiles \(foto_actualizada_at\).*perfil_foto/,
      );
    } finally {
      await db.close();
    }
  });
});
