import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { type Options, ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { AppConfig, RateLimitRule } from '../config.js';
import { errorBody } from '../lib/errors.js';
import { emailSchema } from '../schemas/auth.js';
import { getUsuario } from './require-session.js';

function createLimiter(rule: RateLimitRule, message: string, extra: Partial<Options> = {}): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(errorBody('RATE_LIMITED', message));
    },
    ...extra,
  });
}

export interface RateLimiters {
  /** Tope general de toda la API, por IP. */
  api: RequestHandler;
  /** POST /api/bookings: máx. 5 turnos creados por IP cada 15 min (los pedidos rechazados no cuentan). */
  bookings: RequestHandler;
  /**
   * POST /api/auth/login: máx. 5 intentos FALLIDOS por IP + email cada 15 min y 30 por IP sola (los logins correctos
   * no cuentan). Va primero el de la persona: un intento que ella tiene bloqueado no gasta el cupo de la IP, así
   * quien se trabó no deja afuera al resto del lavadero. Con el email mal formado cuenta solo la IP.
   */
  loginFailures: RequestHandler[];
  /** GET /api/turnos/:id: seguimiento del turno (contra el barrido de ids). Cuentan todos los pedidos, también los 404. */
  seguimiento: RequestHandler;
  /** GET de los PDF de presupuestos y comprobantes: cuesta CPU generarlos. */
  pdf: RequestHandler;
  /**
   * PATCH /api/admin/perfil con contraseña: máx. 5 intentos por USUARIO cada 15 min (correctos o no). Cada intento es
   * un login contra Supabase Auth. Va detrás de requireSession y del parser JSON (mira si el body trae contraseña).
   */
  perfilPassword: RequestHandler;
  /**
   * PUT /api/admin/perfil/foto: máx. 10 subidas por USUARIO cada 15 min (salgan bien o no). Va detrás de requireSession
   * y ANTES de leer el cuerpo: un pedido limitado no se lee ni se procesa.
   */
  perfilFoto: RequestHandler;
  /**
   * POST /api/admin/lavados y DELETE /api/admin/lavados/:id: máx. 60 por USUARIO por minuto. Va detrás de
   * requireSession. Un reintento de la cola sin conexión (mismo idLocal de un lavado que ya existe) no se sabe antes de
   * procesarlo: responde 200 en vez de 201 y ahí se descuenta, así la cola que se vacía al volver la señal no se frena.
   */
  lavados: RequestHandler;
}

const LOGIN_FALLIDO_MESSAGE = 'Hiciste demasiados intentos fallidos. Esperá unos minutos antes de volver a probar.';

/** Hash del email normalizado (minúsculas y sin espacios), o undefined si no es un email válido. */
function emailDelLogin(req: Request): string | undefined {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || !('email' in body)) return undefined;
  const parsed = emailSchema.safeParse(body.email);
  // En la clave va un hash: el email no queda en la memoria del limitador ni puede terminar en un log.
  return parsed.success ? createHash('sha256').update(parsed.data).digest('base64url') : undefined;
}

/** La IP como la cuenta express-rate-limit por defecto (las IPv6 se agrupan por subred). */
function ipDe(req: Request): string {
  return ipKeyGenerator(req.ip ?? '');
}

/** ¿El body de PATCH /api/admin/perfil intenta cambiar la contraseña? */
function traePassword(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return 'passwordActual' in body || 'passwordNueva' in body;
}

/**
 * Los contadores viven en memoria del proceso (alcanza para una sola instancia; si el backend se escala a
 * varias instancias hay que pasar a un store compartido). La IP sale de `req.ip`, que depende de TRUST_PROXY.
 */
export function createRateLimiters(rules: AppConfig['rateLimits']): RateLimiters {
  return {
    api: createLimiter(rules.api, 'Hiciste demasiados pedidos seguidos. Esperá un momento y probá de nuevo.'),
    bookings: createLimiter(
      rules.bookings,
      'Enviaste demasiadas solicitudes de turno en poco tiempo. Probá de nuevo en unos minutos o escribinos por WhatsApp.',
      { skipFailedRequests: true },
    ),
    loginFailures: [
      createLimiter(rules.loginFailures, LOGIN_FALLIDO_MESSAGE, {
        skipSuccessfulRequests: true,
        skip: (req) => emailDelLogin(req) === undefined,
        keyGenerator: (req) => `login:${ipDe(req)}:${emailDelLogin(req) ?? ''}`,
      }),
      createLimiter(rules.loginFailuresIp, LOGIN_FALLIDO_MESSAGE, { skipSuccessfulRequests: true }),
    ],
    seguimiento: createLimiter(
      rules.seguimiento,
      'Consultaste tu turno demasiadas veces seguidas. Esperá unos minutos y probá de nuevo.',
    ),
    pdf: createLimiter(rules.pdf, 'Pediste demasiados PDF seguidos. Esperá un momento y probá de nuevo.'),
    perfilPassword: createLimiter(
      rules.perfilPassword,
      'Hiciste demasiados intentos de cambiar la contraseña. Esperá unos minutos antes de volver a probar.',
      {
        skip: (req) => !traePassword(req.body),
        // Por usuario (no por IP): así no lo esquiva cambiando de red ni frena a otros detrás de la misma IP.
        keyGenerator: (_req, res) => `perfil:${getUsuario(res).id}`,
      },
    ),
    perfilFoto: createLimiter(
      rules.perfilFoto,
      'Subiste demasiadas fotos seguidas. Esperá unos minutos antes de volver a probar.',
      // Por usuario, como el de la contraseña.
      { keyGenerator: (_req, res) => `foto:${getUsuario(res).id}` },
    ),
    lavados: createLimiter(rules.lavados, 'Registraste demasiados lavados seguidos. Esperá un minuto y probá de nuevo.', {
      keyGenerator: (_req, res) => `lavados:${getUsuario(res).id}`,
      // "Exitoso" = no cuenta: solo el 200 del POST, que es un reintento del mismo idLocal (uno nuevo responde 201).
      skipSuccessfulRequests: true,
      requestWasSuccessful: (req, res) => req.method === 'POST' && res.statusCode === 200,
    }),
  };
}
