import { type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import type { Logger } from '../lib/logger.js';
import { parseOrThrow } from '../schemas/common.js';

/*
 * Errores del frontend (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 26). Decisión del dueño:
 * registro propio, sin servicio externo y SIN guardarlos en la base: una línea en el log, recortada y sin datos
 * personales. Dos entradas: con sesión (POST /api/admin/errores-cliente, rate limit por usuario) y sin sesión para la
 * pantalla de login (POST /api/errores-cliente, rate limit estricto por IP). Las dos pasan por el chequeo de Origin
 * (CSRF) y el tope de 10 kb del body como cualquier pedido.
 */

const texto = (max: number, campo: string) =>
  z.string({ error: `Revisá ${campo}.` }).max(max, { error: `${campo} puede tener hasta ${String(max)} caracteres.` });

export const errorClienteSchema = z.strictObject({
  mensaje: texto(1000, 'el mensaje').min(1, { error: 'Falta el mensaje del error.' }),
  stack: texto(8000, 'el stack').optional(),
  url: texto(2000, 'la URL'),
  userAgent: texto(500, 'el navegador'),
  version: texto(40, 'la versión').optional(),
});

/**
 * Saca lo que puede ser personal o secreto: emails, tokens largos (JWT, claves), UUID y números de 6 o más dígitos
 * (teléfonos, documentos, importes).
 */
export function sinDatosPersonales(valor: string): string {
  return valor
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .replace(/\d[\d .-]{4,}\d/g, (m) => (m.replace(/\D/g, '').length >= 6 ? '[numero]' : m));
}

/** Solo el path de la URL (sin query ni hash, donde suele haber datos), recortado. */
function soloPath(url: string): string {
  try {
    return sinDatosPersonales(new URL(url, 'http://panel.local').pathname).slice(0, 120);
  } catch {
    return '(url inválida)';
  }
}

const recortar = (valor: string, max: number): string => {
  const limpio = sinDatosPersonales(valor.replace(/\s+/g, ' ').trim());
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
};

function registrar(logger: Logger, quien: string, body: unknown, res: Response): void {
  const error = parseOrThrow(errorClienteSchema, body ?? {});
  const stack = error.stack === undefined ? '' : ` stack="${recortar(error.stack.split('\n').slice(0, 3).join(' | '), 600)}"`;
  logger.warn(
    `Error del panel ${quien} version=${recortar(error.version ?? '-', 40)} url=${soloPath(error.url)} ` +
      `mensaje="${recortar(error.mensaje, 200)}" navegador="${recortar(error.userAgent, 120)}"${stack}`,
  );
  res.status(204).end();
}

/** POST /api/admin/errores-cliente (detrás de requireSession): 204. */
export function adminErroresClienteRouter(deps: { logger: Logger; limiter: RequestHandler }): Router {
  const router = Router();
  router.post('/', deps.limiter, (req, res) => {
    const usuario = (res.locals as { usuario?: { id: string } }).usuario;
    registrar(deps.logger, `usuario=${usuario?.id ?? 'desconocido'}`, req.body, res);
  });
  return router;
}

/** POST /api/errores-cliente (sin sesión, para la pantalla de login): 204. */
export function publicErroresClienteRouter(deps: { logger: Logger; limiter: RequestHandler }): Router {
  const router = Router();
  router.post('/', deps.limiter, (req, res) => {
    registrar(deps.logger, 'usuario=anonimo', req.body, res);
  });
  return router;
}
