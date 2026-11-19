import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { tipoFoto } from '../schemas/perfil.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Solo se compara el media type; el charset lo resuelve express.json. */
function isJsonContentType(header: string | undefined): boolean {
  return header?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * La ÚNICA excepción al JSON: PUT /api/admin/perfil/foto manda la imagen tal cual (image/jpeg, image/png o image/webp).
 * Un formulario de otro sitio tampoco puede mandar esos tipos sin un preflight CORS (que la política rechaza), así que la
 * defensa es la misma. Se compara la ruta exacta (relativa a /api) y el método: cualquier otra variante pide JSON.
 */
const RUTA_FOTO = '/admin/perfil/foto';
/** El 415 de esa ruta habla de la foto, no de JSON (mismo texto que el 400 de una foto inválida). */
const FOTO_TIPO_MESSAGE = 'Subí una foto JPG, PNG o WebP.';

export const esRutaFoto = (method: string, path: string) => method === 'PUT' && path === RUTA_FOTO;

/**
 * Defensa CSRF para POST/PUT/PATCH/DELETE (se suma a SameSite=Strict de la cookie):
 *  1. Si el pedido trae `Origin`, tiene que ser EXACTAMENTE uno de los FRONTEND_ORIGIN (si no: 403 FORBIDDEN_ORIGIN).
 *     Los navegadores siempre mandan Origin en pedidos cross-origin; su ausencia indica un cliente que no es
 *     un navegador (curl, scripts), que no está expuesto a CSRF.
 *  2. Exige `Content-Type: application/json` (si no: 415). Un formulario HTML de otro sitio no puede
 *     enviar ese tipo sin pasar por un preflight CORS, que la política CORS rechaza.
 * Los pedidos sin body (logout, delete) también deben declarar el Content-Type; el body vacío se acepta.
 * Excepción: la foto de perfil (ver RUTA_FOTO). El control de Origin del paso 1 vale igual para ella.
 * Se monta en /api: `req.path` es relativo a /api.
 */
export function requestGuard(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      next(AppError.forbiddenOrigin());
      return;
    }
    const contentType = req.headers['content-type'];
    if (esRutaFoto(req.method, req.path)) {
      // En esta ruta solo valen los tres tipos de imagen (ni siquiera JSON).
      if (tipoFoto(contentType) === undefined) next(AppError.unsupportedMediaType(FOTO_TIPO_MESSAGE));
      else next();
      return;
    }
    if (!isJsonContentType(contentType)) {
      next(AppError.unsupportedMediaType());
      return;
    }
    next();
  };
}
