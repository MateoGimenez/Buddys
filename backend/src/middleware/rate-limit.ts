import type { RequestHandler } from 'express';
import { type Options, rateLimit } from 'express-rate-limit';
import type { AppConfig, RateLimitRule } from '../config.js';
import { errorBody } from '../lib/errors.js';

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
  /** GET de los PDF de presupuestos y comprobantes y de los CSV: cuesta CPU generarlos. */
  pdf: RequestHandler;
  /** POST /api/admin/errores-cliente: por usuario de la sesión (detrás de requireSession). */
  erroresCliente: RequestHandler;
  /** POST /api/errores-cliente (sin sesión): por IP, estricto. */
  erroresClientePublico: RequestHandler;
  /** POST /api/admin/lavados/:id/fotos (pedir una URL de subida): por usuario de la sesión. */
  fotos: RequestHandler;
  /** POST /api/admin/perfil/avatar (pedir una URL de subida de la foto de perfil): por usuario de la sesión. */
  avatar: RequestHandler;
  /** POST /api/admin/perfil/clave: por usuario de la sesión; cuentan todos los intentos. */
  clave: RequestHandler;
}

/**
 * Los contadores viven en memoria del proceso (alcanza para una sola instancia; si el backend se escala a
 * varias instancias hay que pasar a un store compartido). La IP sale de `req.ip`, que depende de TRUST_PROXY.
 */
/** Clave por persona: el usuario que dejó requireSession en res.locals (un id de perfil, no una IP). */
const porUsuario: Options['keyGenerator'] = (_req, res) => {
  const usuario = (res.locals as { usuario?: { id?: unknown } }).usuario;
  return typeof usuario?.id === 'string' ? `usuario:${usuario.id}` : 'usuario:desconocido';
};

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
    erroresCliente: createLimiter(rules.erroresCliente, 'El panel mandó demasiados errores seguidos.', {
      keyGenerator: porUsuario,
    }),
    fotos: createLimiter(rules.fotos, 'Pediste demasiadas subidas de fotos seguidas. Esperá unos minutos.', {
      keyGenerator: porUsuario,
    }),
    avatar: createLimiter(rules.avatar, 'Pediste demasiadas subidas de foto de perfil seguidas. Esperá unos minutos.', {
      keyGenerator: porUsuario,
    }),
    clave: createLimiter(rules.clave, 'Hiciste demasiados intentos de cambiar la contraseña. Esperá unos minutos.', {
      keyGenerator: porUsuario,
    }),
    erroresClientePublico: createLimiter(rules.erroresClientePublico, 'El panel mandó demasiados errores seguidos.'),
  };
}
