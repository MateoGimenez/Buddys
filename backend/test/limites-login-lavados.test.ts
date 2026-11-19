import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppConfig, DEFAULT_RATE_LIMITS } from '../src/config.js';
import { ADMIN_PASSWORD, addUser, closeAllContexts, createTestContext, loginAs, rawPost } from './helpers.js';

/*
 * Límites aprobados por el dueño (objetivo E):
 *  - Login: 5 fallos en 15 min por IP + email (normalizado) y 30 por IP sola. Todo el lavadero comparte WiFi: que
 *    uno se equivoque no puede dejar afuera a los demás.
 *  - Lavados: 60 por minuto por usuario para POST y DELETE /api/admin/lavados; los reintentos del mismo idLocal no
 *    cuentan (la cola sin conexión se vacía de golpe cuando vuelve la señal).
 * Supertest sale siempre de 127.0.0.1: todos los pedidos de un test son "la misma IP".
 */

afterEach(closeAllContexts);

const SIN_TOPE = { windowMs: 60_000, limit: 10_000 };
const LIMITADO = 'Hiciste demasiados intentos fallidos. Esperá unos minutos antes de volver a probar.';

function limites(cambios: Partial<AppConfig['rateLimits']>): AppConfig['rateLimits'] {
  return { ...DEFAULT_RATE_LIMITS, api: SIN_TOPE, ...cambios };
}

const login = (context: { app: Parameters<typeof rawPost>[0] }, email: string, password: string) =>
  rawPost(context.app, '/api/auth/login').send({ email, password });

describe('POST /api/auth/login: fallos por persona y por IP', () => {
  it('dos personas en la misma IP: una se equivoca 5 veces y queda frenada; la otra igual entra', async () => {
    const context = await createTestContext({ config: { rateLimits: limites({}) } });
    await addUser(context, { email: 'franco@buddys.test', rol: 'empleado' });
    await addUser(context, { email: 'lucia@buddys.test', rol: 'empleado' });

    for (let intento = 1; intento <= 5; intento++) {
      expect((await login(context, 'franco@buddys.test', 'equivocada-123')).status).toBe(401);
    }
    // El email se normaliza: con mayúsculas y espacios es la misma persona.
    const frenado = await login(context, '  Franco@Buddys.TEST ', ADMIN_PASSWORD);
    expect(frenado.status).toBe(429);
    expect(frenado.body.error).toEqual({ code: 'RATE_LIMITED', message: LIMITADO });

    expect((await login(context, 'lucia@buddys.test', ADMIN_PASSWORD)).status).toBe(200);
    // La clave del limitador no deja el email en los logs.
    expect(context.logger.lines.join('\n')).not.toContain('franco@buddys.test');
  });

  it('el tope por IP frena el barrido de muchas cuentas aunque cada una falle una sola vez', async () => {
    const context = await createTestContext({ config: { rateLimits: limites({ loginFailuresIp: { windowMs: 60_000, limit: 6 } }) } });
    await addUser(context, { email: 'lucia@buddys.test', rol: 'empleado' });
    for (let i = 1; i <= 6; i++) {
      expect((await login(context, `cuenta${String(i)}@buddys.test`, 'equivocada-123')).status).toBe(401);
    }
    const r = await login(context, 'lucia@buddys.test', ADMIN_PASSWORD);
    expect(r.status).toBe(429);
    expect(r.body.error).toEqual({ code: 'RATE_LIMITED', message: LIMITADO });
  });

  it('con el email mal formado cuenta solo la IP', async () => {
    const context = await createTestContext({ config: { rateLimits: limites({ loginFailuresIp: { windowMs: 60_000, limit: 3 } }) } });
    for (let i = 1; i <= 3; i++) {
      expect((await login(context, 'no-es-un-email', 'x')).status).toBe(400);
    }
    expect((await login(context, 'otra@buddys.test', 'x')).status).toBe(429);
  });

  it('los intentos que la persona ya tiene frenados no gastan el cupo de la IP', async () => {
    const context = await createTestContext({ config: { rateLimits: limites({ loginFailuresIp: { windowMs: 60_000, limit: 10 } }) } });
    await addUser(context, { email: 'lucia@buddys.test', rol: 'empleado' });
    for (let i = 1; i <= 20; i++) await login(context, 'franco@buddys.test', 'equivocada-123'); // 5 fallos + 15 frenados
    expect((await login(context, 'lucia@buddys.test', ADMIN_PASSWORD)).status).toBe(200);
  });
});

describe('POST y DELETE /api/admin/lavados: 60 por minuto por usuario', () => {
  const LAVADO = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;
  const contexto = () =>
    createTestContext({ config: { rateLimits: limites({ loginFailures: SIN_TOPE, loginFailuresIp: SIN_TOPE }) } });

  it('el pedido 61 responde 429; otra persona sigue registrando', async () => {
    const context = await contexto();
    const { client: franco } = await loginAs(context, 'empleado', 'franco@buddys.test');
    const { client: lucia } = await loginAs(context, 'empleado', 'lucia@buddys.test');
    const primero = await franco.post('/api/admin/lavados', LAVADO);
    expect(primero.status).toBe(201);
    // El DELETE también cuenta.
    expect((await franco.delete(`/api/admin/lavados/${String(primero.body.lavado.id)}`)).status).toBe(204);
    for (let i = 3; i <= 60; i++) {
      expect((await franco.post('/api/admin/lavados', LAVADO)).status).toBe(201);
    }
    const r61 = await franco.post('/api/admin/lavados', LAVADO);
    expect(r61.status).toBe(429);
    expect(r61.body.error.code).toBe('RATE_LIMITED');
    expect((await lucia.post('/api/admin/lavados', LAVADO)).status).toBe(201);
  }, 60_000);

  it('70 reintentos del mismo idLocal no lo disparan (y después se puede seguir registrando)', async () => {
    const context = await contexto();
    const { client: franco } = await loginAs(context, 'empleado', 'franco@buddys.test');
    const body = { ...LAVADO, idLocal: randomUUID() };
    expect((await franco.post('/api/admin/lavados', body)).status).toBe(201);
    for (let i = 1; i <= 70; i++) {
      expect((await franco.post('/api/admin/lavados', body)).status).toBe(200);
    }
    expect((await franco.post('/api/admin/lavados', LAVADO)).status).toBe(201);
  }, 60_000);
});
