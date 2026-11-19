import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CUERPO_FOTO_PLAZO_MS, CUERPO_PLAZO_MS, type PlazosCuerpo } from '../src/middleware/plazo-cuerpo.js';
import { ORIGIN, type TestContext, closeAllContexts, cookieHeader, createTestContext, loginAs } from './helpers.js';

/*
 * Plazo para recibir el cuerpo (middleware/plazo-cuerpo.ts): un Content-Length mentido ya no deja la conexión
 * colgada hasta server.requestTimeout (30 s). 10 s para todo, 30 s para la foto de perfil.
 * Se mide con un socket crudo cuánto tarda el servidor en cerrar la conexión. Un test usa los plazos reales (tarda
 * ~10 s); el resto los acorta con `plazosCuerpo` para ser rápidos, con márgenes amplios para no ser frágiles.
 */

afterEach(closeAllContexts);

const PASSWORD = 'clave-de-prueba-123';

interface Envio {
  /** Cabeceras y el principio del cuerpo. */
  inicio: string;
  /** Bytes que se siguen mandando de a uno, cada `goteoMs` (para probar que el plazo es total). */
  goteo?: { bytes: string; cadaMs: number };
}

/** Abre la app en un puerto, manda el pedido y devuelve a los cuántos ms cerró el servidor y qué respondió. */
async function medirCierre(context: TestContext, envio: Envio, esperaMaxMs: number): Promise<{ ms: number; respuesta: string }> {
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1');
      const partes: Buffer[] = [];
      const inicio = Date.now();
      let intervalo: NodeJS.Timeout | undefined;
      const terminar = () => {
        clearTimeout(tope);
        clearInterval(intervalo);
        socket.destroy();
        resolve({ ms: Date.now() - inicio, respuesta: Buffer.concat(partes).toString('utf8') });
      };
      const tope = setTimeout(terminar, esperaMaxMs);
      socket.on('data', (chunk: Buffer) => partes.push(chunk));
      socket.on('close', terminar);
      socket.on('error', terminar);
      socket.write(envio.inicio);
      if (envio.goteo !== undefined) {
        const restantes = envio.goteo.bytes.split(''); // solo ASCII
        intervalo = setInterval(() => {
          const byte = restantes.shift();
          if (byte !== undefined && !socket.destroyed) socket.write(byte);
        }, envio.goteo.cadaMs);
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

/** Un login JSON que promete `declarado` bytes y manda solo `{"email":`. */
function loginMentido(declarado: number): string {
  return [
    'POST /api/auth/login HTTP/1.1',
    'Host: 127.0.0.1',
    `Origin: ${ORIGIN}`,
    'Content-Type: application/json',
    `Content-Length: ${String(declarado)}`,
    '',
    '{"email":',
  ].join('\r\n');
}

async function cookieDe(context: TestContext): Promise<string> {
  await loginAs(context, 'empleado', 'plazo@buddys.test');
  const login = await request(context.app)
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('Content-Type', 'application/json')
    .send({ email: 'plazo@buddys.test', password: PASSWORD });
  expect(login.status).toBe(200);
  return cookieHeader(login);
}

function fotoMentida(cookie: string): string {
  return [
    'PUT /api/admin/perfil/foto HTTP/1.1',
    'Host: 127.0.0.1',
    `Origin: ${ORIGIN}`,
    `Cookie: ${cookie}`,
    'Content-Type: image/png',
    'Content-Length: 50000',
    '',
    '\x89PNG',
  ].join('\r\n');
}

const CORTOS: PlazosCuerpo = { generalMs: 300, fotoMs: 1_500 };

describe('plazo para recibir el cuerpo', () => {
  it('los plazos de producción son 10 s y 30 s (la foto)', () => {
    expect(CUERPO_PLAZO_MS).toBe(10_000);
    expect(CUERPO_FOTO_PLAZO_MS).toBe(30_000);
  });

  it('con los plazos reales, un Content-Length mentido se corta antes de 10 s + margen (no a los 30 s)', async () => {
    const context = await createTestContext();
    const { ms, respuesta } = await medirCierre(context, { inicio: loginMentido(500) }, 20_000);
    expect(respuesta).toBe(''); // nunca se procesa
    expect(ms).toBeGreaterThanOrEqual(CUERPO_PLAZO_MS - 200);
    expect(ms).toBeLessThan(CUERPO_PLAZO_MS + 2_000);
  }, 25_000);

  it('el plazo es total: mandar un byte cada tanto no lo estira', async () => {
    const context = await createTestContext({ plazosCuerpo: CORTOS });
    const { ms, respuesta } = await medirCierre(
      context,
      { inicio: loginMentido(500), goteo: { bytes: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', cadaMs: 50 } },
      5_000,
    );
    expect(respuesta).toBe('');
    expect(ms).toBeLessThan(1_200);
  });

  it('la foto mantiene su plazo más largo: sigue abierta cuando el resto ya se cortó, y después se corta', async () => {
    const context = await createTestContext({ plazosCuerpo: CORTOS });
    const cookie = await cookieDe(context);
    const { ms, respuesta } = await medirCierre(context, { inicio: fotoMentida(cookie) }, 6_000);
    expect(respuesta).toBe('');
    expect(ms).toBeGreaterThanOrEqual(CORTOS.fotoMs - 100);
    expect(ms).toBeLessThan(CORTOS.fotoMs + 1_500);
    expect(context.storage.calls).toHaveLength(0);
  });

  it('un cuerpo que llega entero (aunque en partes) se procesa normal', async () => {
    const context = await createTestContext({ plazosCuerpo: { generalMs: 1_000, fotoMs: 1_000 } });
    const cuerpo = JSON.stringify({ email: 'nadie@buddys.test', password: 'x' });
    const cabeceras = [
      'POST /api/auth/login HTTP/1.1',
      'Host: 127.0.0.1',
      `Origin: ${ORIGIN}`,
      'Content-Type: application/json',
      'Connection: close',
      `Content-Length: ${String(Buffer.byteLength(cuerpo))}`,
      '',
      '',
    ].join('\r\n');
    const { respuesta } = await medirCierre(
      context,
      { inicio: cabeceras + cuerpo.slice(0, 10), goteo: { bytes: cuerpo.slice(10), cadaMs: 5 } },
      5_000,
    );
    expect(respuesta).toMatch(/^HTTP\/1\.1 (400|401) /);
  });
});
