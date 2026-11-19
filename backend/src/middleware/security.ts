import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import type { AppConfig } from '../config.js';

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/**
 * Cabeceras de seguridad (helmet), iguales para TODAS las respuestas. Este proceso sirve solo la API (render.yaml:
 * un único Web Service; afuera de /api solo hay el 404 en JSON): nunca entrega HTML, scripts, el service worker ni el
 * manifest. Por eso la CSP es la mínima, "default-src 'none'; frame-ancestors 'none'": nada de lo que responda puede
 * cargar ni ejecutar recursos ni embeberse en un frame.
 * El frontend (la PWA de frontend/, con su sw.js y su manifest.webmanifest en la raíz) se publica aparte, como sitio
 * estático (todavía no está en render.yaml): su CSP la ponen las cabeceras de ese hosting, no este middleware.
 */
export function securityHeaders(config: Pick<AppConfig, 'isProduction'>): RequestHandler {
  const headers = helmet({
    frameguard: { action: 'deny' },
    // HSTS solo en producción (en HTTP local no aplica). Sin includeSubDomains: no se impone HTTPS a otros subdominios.
    strictTransportSecurity: config.isProduction ? { maxAge: 15_552_000, includeSubDomains: false } : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });

  return (req, res, next) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    headers(req, res, next);
  };
}

/**
 * CORS: solo los orígenes de FRONTEND_ORIGIN, con credenciales (cookie de sesión). Se refleja únicamente el
 * origen que coincide; si el Origin del pedido no está en la lista, no se emite ninguna cabecera CORS y el
 * navegador bloquea la lectura de la respuesta.
 */
export function corsPolicy(allowedOrigins: readonly string[]): RequestHandler {
  return cors({
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowedOrigins.includes(origin) ? origin : false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
}

/** Las respuestas de la API (con datos personales) no deben guardarse en cachés del navegador ni de proxies. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
