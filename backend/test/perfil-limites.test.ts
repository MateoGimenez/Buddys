import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { crc32 } from 'node:zlib';
import request from 'supertest';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS } from '../src/config.js';
import { Semaforo } from '../src/lib/semaforo.js';
import { FOTO_PROCESOS_MAX, procesarFoto, semaforoFotos } from '../src/services/perfil.js';
import {
  type Client,
  ORIGIN,
  type TestContext,
  closeAllContexts,
  cookieHeader,
  createTestContext,
  loginAs,
} from './helpers.js';

/*
 * Casos límite de Mi perfil y la foto (contrato reportes/2026-11-17_04_perfil-y-foto.md), revisión de pruebas
 * 2026-11-18. Complementa test/perfil.test.ts.
 */

afterEach(closeAllContexts);

const PASSWORD = 'clave-de-prueba-123';
const DOS_MB = 2 * 1024 * 1024;
const FOTO_INVALIDA = 'Subí una foto JPG, PNG o WebP.';

const lienzo = (width = 400, height = 300, background = '#c33') =>
  sharp({ create: { width, height, channels: 3, background } });

function subir(client: Client, bytes: Buffer | string, tipo: string) {
  return client.agent.put('/api/admin/perfil/foto').set('Origin', ORIGIN).set('Content-Type', tipo).send(bytes);
}

function fotoGuardada(context: TestContext, id: string): Uint8Array | undefined {
  return context.storage.objetos.get(`avatares/${id}.webp`)?.bytes;
}

/** Inserta un chunk tEXt (keyword "Comment") antes del IEND de un PNG, con `relleno` bytes de texto. */
function pngConTexto(png: Buffer, relleno: number): Buffer {
  const iend = png.length - 12;
  const data = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.alloc(relleno, 0x61)]);
  const tipo = Buffer.from('tEXt', 'latin1');
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tipo, data])));
  return Buffer.concat([png.subarray(0, iend), largo, tipo, data, crc, png.subarray(iend)]);
}

/** Un PNG válido de exactamente `total` bytes (rellenado con un chunk de texto). */
async function pngDeTamano(total: number): Promise<Buffer> {
  const base = await lienzo(64, 64).png().toBuffer();
  const relleno = total - base.length - 12 - 'Comment\0'.length;
  const resultado = pngConTexto(base, relleno);
  expect(resultado.length).toBe(total);
  return resultado;
}

/**
 * Manda bytes crudos por TCP a la app (para Content-Length mentido o chunked sin largo, que supertest no arma) y
 * devuelve el status y el cuerpo de la primera respuesta.
 */
async function httpCrudo(
  context: TestContext,
  armar: (host: string) => Buffer,
  esperaMs = 5_000,
): Promise<{ status: number; body: string }> {
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const crudo = await new Promise<string>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      const partes: Buffer[] = [];
      const terminar = () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(Buffer.concat(partes).toString('utf8'));
      };
      const timer = setTimeout(terminar, esperaMs);
      socket.on('data', (chunk: Buffer) => {
        partes.push(chunk);
        const texto = Buffer.concat(partes).toString('utf8');
        const fin = texto.indexOf('\r\n\r\n');
        const largo = /content-length: (\d+)/i.exec(texto)?.[1];
        if (fin >= 0 && largo !== undefined && Buffer.byteLength(texto) >= fin + 4 + Number(largo)) terminar();
      });
      socket.on('end', terminar);
      socket.on('error', terminar);
      socket.write(armar(`127.0.0.1:${String(port)}`));
    });
    const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(crudo)?.[1] ?? 0);
    return { status, body: crudo.slice(crudo.indexOf('\r\n\r\n') + 4) };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

async function cookieDe(context: TestContext, rol: 'empleado' | 'admin'): Promise<{ cookie: string; id: string }> {
  const { id } = await loginAs(context, rol, `${rol}-crudo@buddys.test`);
  const login = await request(context.app)
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('Content-Type', 'application/json')
    .send({ email: `${rol}-crudo@buddys.test`, password: PASSWORD });
  expect(login.status).toBe(200);
  return { cookie: cookieHeader(login), id };
}

function cabeceras(host: string, cookie: string, extra: string[]): string {
  return [
    'PUT /api/admin/perfil/foto HTTP/1.1',
    `Host: ${host}`,
    `Origin: ${ORIGIN}`,
    `Cookie: ${cookie}`,
    'Content-Type: image/png',
    'Connection: close',
    ...extra,
    '',
    '',
  ].join('\r\n');
}

describe('PUT /api/admin/perfil/foto: Content-Type fuera de los tres', () => {
  it('415 con el mensaje de la foto (también con JSON); el resto de la API sigue con el mensaje general', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const foto = await lienzo().png().toBuffer();

    for (const tipo of ['text/plain', 'image/gif', 'image/svg+xml', 'application/json', 'multipart/form-data; boundary=x']) {
      const response = await subir(client, tipo === 'application/json' ? '{}' : foto, tipo);
      expect(response.status, tipo).toBe(415);
      expect(response.body.error, tipo).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', message: FOTO_INVALIDA });
    }
    // Sin Content-Type.
    const sinTipo = await client.agent.put('/api/admin/perfil/foto').set('Origin', ORIGIN);
    expect(sinTipo.status).toBe(415);
    expect(sinTipo.body.error.message).toBe(FOTO_INVALIDA);

    // La excepción está acotada: otros métodos y rutas siguen con el mensaje de JSON.
    const general = 'El formato de la solicitud no es válido. Tiene que enviarse como JSON.';
    for (const [metodo, ruta] of [
      ['post', '/api/admin/perfil/foto'],
      ['patch', '/api/admin/perfil'],
      ['put', '/api/admin/perfil/foto/otra'],
      ['put', '/api/admin/metas/2026-10'],
    ] as const) {
      const response = await client.agent[metodo](ruta).set('Origin', ORIGIN).set('Content-Type', 'text/plain').send('x');
      expect(response.status, `${metodo} ${ruta}`).toBe(415);
      expect(response.body.error.message, `${metodo} ${ruta}`).toBe(general);
    }
    expect(context.storage.calls).toHaveLength(0);
  });
});

describe('PUT /api/admin/perfil/foto: tamaños y framing', () => {
  it('0 bytes => 400 en fields.foto', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const response = await subir(client, Buffer.alloc(0), 'image/png');
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ foto: FOTO_INVALIDA });
    expect(context.storage.calls).toHaveLength(0);
  });

  it('exactamente 2 MB pasa (PNG real con chunk de texto); 2 MB + 1 byte => 413', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');

    const justa = await pngDeTamano(DOS_MB);
    const ok = await subir(client, justa, 'image/png');
    expect(ok.status).toBe(200);
    expect((await sharp(fotoGuardada(context, id)).metadata()).width).toBe(256);

    const pasada = await pngDeTamano(DOS_MB + 1);
    const grande = await subir(client, pasada, 'image/png');
    expect(grande.status).toBe(413);
    expect(grande.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(context.storage.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('Content-Length mentido: más chico que el cuerpo => 400; más grande => espera el resto y no procesa nada', async () => {
    const context = await createTestContext();
    const { cookie } = await cookieDe(context, 'empleado');
    const foto = await lienzo().png().toBuffer();

    const diceMenos = await httpCrudo(context, (host) =>
      Buffer.concat([Buffer.from(cabeceras(host, cookie, ['Content-Length: 40'])), foto]),
    );
    // Se leen 40 bytes (no es una foto válida) y lo que sobra Node lo toma como otro pedido mal formado: 400.
    expect(diceMenos.status).toBe(400);
    expect(context.storage.calls).toHaveLength(0);

    // body-parser lee (descarta) el cuerpo entero antes de responder 413: si el cliente promete 3 MB y manda menos,
    // la conexión queda esperando hasta que la corta el plazo de la foto (30 s, middleware/plazo-cuerpo.ts). Nunca se procesa.
    const dice3MB = await httpCrudo(
      context,
      (host) => Buffer.concat([Buffer.from(cabeceras(host, cookie, [`Content-Length: ${String(3 * 1024 * 1024)}`])), foto]),
      1_500,
    );
    expect(dice3MB.status).toBe(0);
    expect(context.storage.calls).toHaveLength(0);
  });

  it('Transfer-Encoding: chunked sin Content-Length: el tope de 2 MB se aplica igual (y una chica pasa)', async () => {
    const context = await createTestContext();
    const { cookie, id } = await cookieDe(context, 'empleado');
    const enChunks = (bytes: Buffer, tamano: number): Buffer => {
      const partes: Buffer[] = [];
      for (let i = 0; i < bytes.length; i += tamano) {
        const parte = bytes.subarray(i, i + tamano);
        partes.push(Buffer.from(`${parte.length.toString(16)}\r\n`), parte, Buffer.from('\r\n'));
      }
      partes.push(Buffer.from('0\r\n\r\n'));
      return Buffer.concat(partes);
    };

    const grande = await pngDeTamano(DOS_MB + 1024);
    const rechazada = await httpCrudo(context, (host) =>
      Buffer.concat([Buffer.from(cabeceras(host, cookie, ['Transfer-Encoding: chunked'])), enChunks(grande, 64 * 1024)]),
    );
    expect(rechazada.status).toBe(413);
    expect(rechazada.body).toContain('PAYLOAD_TOO_LARGE');
    expect(fotoGuardada(context, id)).toBeUndefined();

    const chica = await lienzo().png().toBuffer();
    const aceptada = await httpCrudo(context, (host) =>
      Buffer.concat([Buffer.from(cabeceras(host, cookie, ['Transfer-Encoding: chunked'])), enChunks(chica, 500)]),
    );
    expect(aceptada.status).toBe(200);
    expect(fotoGuardada(context, id)).toBeDefined();
  });
});

describe('PUT /api/admin/perfil/foto: imágenes raras', () => {
  it('PNG con chunk de texto, JPG CMYK, PNG 1×1 y 10000×100: 200 y salen 256×256 WebP', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    const cmyk = await lienzo().toColourspace('cmyk').jpeg().toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');

    const casos: [string, Buffer, string][] = [
      ['PNG con tEXt', pngConTexto(await lienzo().png().toBuffer(), 5_000), 'image/png'],
      ['JPG CMYK', cmyk, 'image/jpeg'],
      ['PNG 1×1', await lienzo(1, 1).png().toBuffer(), 'image/png'],
      ['PNG 10000×100', await lienzo(10_000, 100).png().toBuffer(), 'image/png'],
      ['WebP 100×10000', await lienzo(100, 10_000).webp().toBuffer(), 'image/webp'],
    ];
    for (const [caso, bytes, tipo] of casos) {
      const response = await subir(client, bytes, tipo);
      expect(response.status, caso).toBe(200);
      const metadata = await sharp(fotoGuardada(context, id)).metadata();
      expect([metadata.format, metadata.width, metadata.height, metadata.space], caso).toEqual(['webp', 256, 256, 'srgb']);
    }
  });

  it('la salida nunca lleva exif, icc ni xmp (JPG con EXIF+ICC+XMP, PNG con ICC, WebP con XMP, CMYK)', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'admin');
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';
    const jpgCargada = await lienzo()
      .withExif({ IFD0: { Copyright: 'Buddys' } })
      .withIccProfile('p3')
      .withXmp(xmp)
      .jpeg()
      .toBuffer();
    const entrada = await sharp(jpgCargada).metadata();
    expect([entrada.exif !== undefined, entrada.icc !== undefined, entrada.xmp !== undefined]).toEqual([true, true, true]);

    for (const [caso, bytes, tipo] of [
      ['JPG cargada', jpgCargada, 'image/jpeg'],
      ['PNG con ICC', await lienzo().withIccProfile('p3').png().toBuffer(), 'image/png'],
      ['WebP con XMP', await lienzo().withXmp(xmp).webp().toBuffer(), 'image/webp'],
      ['JPG CMYK', await lienzo().toColourspace('cmyk').jpeg().toBuffer(), 'image/jpeg'],
    ] as const) {
      expect((await subir(client, bytes, tipo)).status, caso).toBe(200);
      const metadata = await sharp(fotoGuardada(context, id)).metadata();
      expect({ exif: metadata.exif, icc: metadata.icc, xmp: metadata.xmp }, caso).toEqual({
        exif: undefined,
        icc: undefined,
        xmp: undefined,
      });
    }
  });

  it('EXIF con orientación 6: la foto sale rotada (la mitad izquierda original queda arriba)', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    // 400×200: izquierda roja, derecha azul. Orientación 6 = girar 90° a la derecha para mostrarla.
    const azul = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#00f' } }).png().toBuffer();
    const original = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#f00' } })
      .composite([{ input: azul, left: 200, top: 0 }])
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
    expect((await sharp(original).metadata()).orientation).toBe(6);

    expect((await subir(client, original, 'image/jpeg')).status).toBe(200);
    const { data, info } = await sharp(fotoGuardada(context, id)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i] ?? 0, data[i + 2] ?? 0]; // rojo, azul
    };
    const [rojoArriba, azulArriba] = pixel(200, 20);
    const [rojoAbajo, azulAbajo] = pixel(50, 236);
    // Rotada: arriba rojo, abajo azul. Sin rotar, (200, 20) sería azul y (50, 236) rojo.
    expect(rojoArriba).toBeGreaterThan(200);
    expect(azulArriba).toBeLessThan(60);
    expect(azulAbajo).toBeGreaterThan(200);
    expect(rojoAbajo).toBeLessThan(60);
  });

  it('doble subida simultánea: las dos 200, queda un solo objeto y la versión de la base es la de una respuesta', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    const [a, b] = await Promise.all([
      subir(client, await lienzo(300, 300, '#f00').png().toBuffer(), 'image/png'),
      subir(client, await lienzo(300, 300, '#00f').jpeg().toBuffer(), 'image/jpeg'),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(context.storage.objetos.size).toBe(1);
    const me = await client.get('/api/auth/me');
    expect([a.body.perfil.fotoVersion, b.body.perfil.fotoVersion]).toContain(me.body.usuario.fotoVersion);
    expect((await client.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(200);
  });
});

describe('GET /api/admin/usuarios/:id/foto: acceso y caché', () => {
  async function conFoto(context: TestContext, email = 'empleado@buddys.test') {
    const empleado = await loginAs(context, 'empleado', email);
    const subida = await subir(empleado.client, await lienzo().png().toBuffer(), 'image/png');
    expect(subida.status).toBe(200);
    return { ...empleado, version: String(subida.body.perfil.fotoVersion) };
  }

  it('empleado: la de otro 403 (también de un admin); ids mal formados 404 sin tocar Storage; su id en mayúsculas sirve', async () => {
    const context = await createTestContext();
    const { id } = await conFoto(context);
    const otro = await conFoto(context, 'otro@buddys.test');
    const { id: adminId } = await loginAs(context, 'admin');

    expect((await otro.client.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(403);
    expect((await otro.client.get(`/api/admin/usuarios/${adminId}/foto`)).status).toBe(403);
    context.storage.calls.length = 0;
    for (const malo of ['no-es-un-uuid', "1' OR '1'='1", '%00', '11111111-1111-4111-8111-11111111111', 'x'.repeat(500)]) {
      const response = await otro.client.get(`/api/admin/usuarios/${encodeURIComponent(malo)}/foto`);
      expect(response.status, malo).toBe(404);
      expect(response.body.error.code, malo).toBe('NOT_FOUND');
    }
    expect(context.storage.calls).toHaveLength(0);
    expect((await otro.client.get(`/api/admin/usuarios/${otro.id.toUpperCase()}/foto`)).status).toBe(200);
  });

  it('dado de baja: su foto ya no se sirve (404) y la sesión que tenía no puede pedir nada', async () => {
    const context = await createTestContext();
    const { client, id } = await conFoto(context);
    const { client: admin } = await loginAs(context, 'admin');
    await context.db.sql.query(
      "INSERT INTO buddys.gastos (fecha, categoria, descripcion, monto, creado_por) VALUES ('2026-10-14', 'otros', 'x', 100, $1::uuid)",
      [id],
    );
    expect((await admin.delete(`/api/admin/usuarios/${id}`)).body.resultado).toBe('baja');
    expect((await admin.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(404);
    expect((await client.get(`/api/admin/usuarios/${id}/foto`)).status).toBe(401);
  });

  it('If-None-Match con varias etiquetas, débiles y *; Cache-Control immutable solo con ?v= igual a la versión actual', async () => {
    const context = await createTestContext();
    const { client, id, version } = await conFoto(context);
    const url = `/api/admin/usuarios/${id}/foto`;

    for (const header of [`"a", "b", "${version}"`, `"a",W/"${version}"`, '*', `  "${version}"  `]) {
      expect((await client.get(url).set('If-None-Match', header)).status, header).toBe(304);
    }
    for (const header of ['"a", "b"', `W/"x${version}"`, version, '']) {
      expect((await client.get(url).set('If-None-Match', header)).status, header).toBe(200);
    }

    const cache = async (query: string) => (await client.get(`${url}${query}`)).headers['cache-control'];
    expect(await cache(`?v=${encodeURIComponent(version)}`)).toBe('private, max-age=86400, immutable');
    expect(await cache('')).toBe('private, no-cache');
    expect(await cache(`?v=${encodeURIComponent(version)}&v=${encodeURIComponent(version)}`)).toBe('private, no-cache');
    expect(await cache(`?v[]=${encodeURIComponent(version)}`)).toBe('private, no-cache');

    // Con una foto nueva, la versión vieja deja de ser immutable.
    context.clock.current = new Date(context.clock.current.getTime() + 60_000);
    const nueva = String((await subir(client, await lienzo().jpeg().toBuffer(), 'image/jpeg')).body.perfil.fotoVersion);
    expect(nueva).not.toBe(version);
    expect(await cache(`?v=${encodeURIComponent(version)}`)).toBe('private, no-cache');
    expect(await cache(`?v=${encodeURIComponent(nueva)}`)).toBe('private, max-age=86400, immutable');
    expect((await client.get(url).set('If-None-Match', `"${version}"`)).status).toBe(200);
  });
});

describe('cambiar la contraseña: límites', () => {
  const limites = {
    config: {
      rateLimits: {
        ...DEFAULT_RATE_LIMITS,
        api: { windowMs: 60_000, limit: 10_000 },
        loginFailures: { windowMs: 60_000, limit: 10_000 },
      },
    },
  };

  it('5 intentos por usuario con dos usuarios a la vez: cada uno tiene los suyos', async () => {
    const context = await createTestContext(limites);
    const { client: uno } = await loginAs(context, 'empleado');
    const { client: dos } = await loginAs(context, 'admin');
    const intento = { passwordActual: 'mal-mal-mal-1', passwordNueva: 'nueva-clave-123' };

    const respuestas = await Promise.all(
      Array.from({ length: 7 }, () => [uno.patch('/api/admin/perfil', intento), dos.patch('/api/admin/perfil', intento)]).flat(),
    );
    const estados = (paridad: number) => respuestas.filter((_, i) => i % 2 === paridad).map((r) => r.status).sort();
    expect(estados(0)).toEqual([400, 400, 400, 400, 400, 429, 429]);
    expect(estados(1)).toEqual([400, 400, 400, 400, 400, 429, 429]);
  });

  it('si el cambio posterior falla (Supabase la rechaza), la sesión de verificación igual se cerró', async () => {
    const context = await createTestContext();
    const { client, id } = await loginAs(context, 'empleado');
    context.supabase.calls.length = 0;

    const llamadas = () => context.supabase.calls.map((call) => `${call.method} ${call.path}`);
    // 1) Supabase la rechaza por débil (422).
    const debil = await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'muy-debil-clave-123' });
    expect(debil.status).toBe(400);
    expect(llamadas()).toEqual(['POST /token?grant_type=password', 'POST /logout?scope=local', `PUT /admin/users/${id}`]);
    expect(await context.supabase.sessionCount()).toBe(1);

    // 2) Supabase se cae justo en el cambio (después de verificar): 503 y la verificación ya se había cerrado.
    context.supabase.calls.length = 0;
    const push = context.supabase.calls.push.bind(context.supabase.calls);
    context.supabase.calls.push = (...items) => {
      if (items.some((call) => call.path.startsWith('/admin/users/'))) context.supabase.mode = 'down';
      return push(...items);
    };
    const caido = await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: 'nueva-clave-123' });
    context.supabase.mode = 'ok';
    expect(caido.status).toBe(503);
    expect(llamadas()).toEqual(['POST /token?grant_type=password', 'POST /logout?scope=local', `PUT /admin/users/${id}`]);
    expect(await context.supabase.sessionCount()).toBe(1);
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe(PASSWORD);
  });

  it('la nueva igual a la actual: se acepta (200) y la contraseña sigue siendo la misma', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const response = await client.patch('/api/admin/perfil', { passwordActual: PASSWORD, passwordNueva: PASSWORD });
    expect(response.status).toBe(200);
    expect(context.supabase.passwordOf('empleado@buddys.test')).toBe(PASSWORD);
    expect(await context.supabase.sessionCount()).toBe(1);
  });
});

describe('PUT /api/admin/perfil/foto: límite por usuario (auditoría del objetivo B, B1)', () => {
  it('10 subidas cada 15 minutos por usuario; la 11 => 429 sin leer el cuerpo (ni esperar uno prometido de 3 MB)', async () => {
    const context = await createTestContext({
      config: { rateLimits: { ...DEFAULT_RATE_LIMITS, api: { windowMs: 60_000, limit: 10_000 } } },
    });
    const { cookie, id } = await cookieDe(context, 'empleado');
    const { client: otro, id: otroId } = await loginAs(context, 'admin');
    const foto = await lienzo(64, 64).png().toBuffer();
    const subirConCookie = (bytes: Buffer | string) =>
      request(context.app)
        .put('/api/admin/perfil/foto')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .set('Content-Type', 'image/png')
        .send(bytes);

    // Cuentan todas, salgan bien o no.
    for (let i = 0; i < 9; i += 1) expect((await subirConCookie(foto)).status).toBe(200);
    expect((await subirConCookie('no es una foto')).status).toBe(400);
    const subidas = context.storage.calls.length;

    const limitada = await subirConCookie(foto);
    expect(limitada.status).toBe(429);
    expect(limitada.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Subiste demasiadas fotos seguidas. Esperá unos minutos antes de volver a probar.',
    });
    // Promete 3 MB y manda unos pocos bytes: sin el límite delante, body-parser se quedaría esperando el resto (ver
    // "Content-Length mentido"). Con el límite antes de leer el cuerpo, el 429 sale enseguida.
    const sinLeer = await httpCrudo(
      context,
      (host) => Buffer.concat([Buffer.from(cabeceras(host, cookie, [`Content-Length: ${String(3 * 1024 * 1024)}`])), foto]),
      1_500,
    );
    expect(sinLeer.status).toBe(429);
    expect(context.storage.calls).toHaveLength(subidas);
    expect(fotoGuardada(context, id)).toBeDefined();

    // Otro usuario tiene las suyas.
    expect((await subir(otro, foto, 'image/png')).status).toBe(200);
    expect(fotoGuardada(context, otroId)).toBeDefined();
  });
});

describe('procesarFoto: semáforo (auditoría del objetivo B, B1)', () => {
  it('como mucho 2 a la vez; las demás esperan (no se rechazan) y una que falla libera su lugar', async () => {
    expect(FOTO_PROCESOS_MAX).toBe(2);
    const foto = await lienzo(300, 300).png().toBuffer();
    const rota = Buffer.concat([foto.subarray(0, 16), Buffer.alloc(200, 0x61)]); // firma PNG, contenido roto

    const pedidos = [foto, rota, foto, foto, foto].map((bytes) =>
      procesarFoto(bytes, 'image/png').then(
        (salida) => ({ ok: true, salida }),
        (error: unknown) => ({ ok: false, error }),
      ),
    );
    // Sin await en el medio: dos ya tomaron lugar y tres esperan.
    expect(semaforoFotos.ocupados).toBe(2);
    expect(semaforoFotos.esperando).toBe(3);

    const resultados = await Promise.all(pedidos);
    expect(resultados.map((r) => r.ok)).toEqual([true, false, true, true, true]);
    for (const r of resultados) {
      if (r.ok && 'salida' in r) expect((await sharp(r.salida).metadata()).width).toBe(256);
    }
    expect(semaforoFotos.ocupados).toBe(0);
    expect(semaforoFotos.esperando).toBe(0);
  });

  it('una firma que no coincide se rechaza sin esperar turno', async () => {
    expect(semaforoFotos.ocupados).toBe(0);
    await expect(procesarFoto(Buffer.from('hola'), 'image/png')).rejects.toMatchObject({ status: 400 });
    expect(semaforoFotos.esperando).toBe(0);
  });

  it('Semaforo: nunca más de `max` a la vez, atiende en orden de llegada y libera aunque la tarea falle', async () => {
    const semaforo = new Semaforo(2);
    let corriendo = 0;
    let maximo = 0;
    const orden: number[] = [];
    const sueltas: (() => void)[] = [];
    const tarea = (n: number, falla = false) => () =>
      new Promise<number>((resolve, reject) => {
        corriendo += 1;
        maximo = Math.max(maximo, corriendo);
        orden.push(n);
        sueltas.push(() => {
          corriendo -= 1;
          if (falla) reject(new Error('falló'));
          else resolve(n);
        });
      });

    const todas = [1, 2, 3, 4, 5].map((n) => semaforo.usar(tarea(n, n === 1)).catch(() => -1));
    await Promise.resolve();
    expect(orden).toEqual([1, 2]);
    while (sueltas.length > 0) {
      sueltas.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await Promise.all(todas)).toEqual([-1, 2, 3, 4, 5]);
    expect(orden).toEqual([1, 2, 3, 4, 5]);
    expect(maximo).toBe(2);
    expect(semaforo.ocupados).toBe(0);
    expect(() => new Semaforo(0)).toThrow();
  });
});
