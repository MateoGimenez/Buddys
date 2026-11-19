import type { RequestHandler } from 'express';
import { type Options, rateLimit } from 'express-rate-limit';
import type { AppConfig, RateLimitRule } from '../config.js';
import { errorBody } from '../lib/errors.js';
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
  /** POST /api/auth/login: máx. 5 intentos FALLIDOS por IP cada 15 min (los logins correctos no cuentan). */
  loginFailures: RequestHandler;
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
    loginFailures: createLimiter(
      rules.loginFailures,
      'Hiciste demasiados intentos fallidos. Esperá unos minutos antes de volver a probar.',
      { skipSuccessfulRequests: true },
    ),
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
  };
}
