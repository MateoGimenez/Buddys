import type { RequestHandler } from 'express';
import { esRutaFoto } from './request-guard.js';

/** Tiempo para recibir el cuerpo entero de un pedido común (JSON de pocos KB). */
export const CUERPO_PLAZO_MS = 10_000;
/** La foto de perfil (hasta 2 MB desde el celular) tiene más tiempo: el mismo que server.requestTimeout. */
export const CUERPO_FOTO_PLAZO_MS = 30_000;

export interface PlazosCuerpo {
  generalMs: number;
  fotoMs: number;
}

/**
 * Corta la conexión si el cuerpo no termina de llegar a tiempo, contado desde que llegan las cabeceras.
 * Un `Content-Length` mentido (promete más bytes de los que manda) o un goteo de bytes dejarían el pedido
 * esperando hasta server.requestTimeout (30 s, src/index.ts, que Node además revisa cada 30 s): esto lo baja a
 * 10 s para todo menos la foto de perfil. Es un plazo total, no de inactividad: mandar un byte cada tanto no lo
 * estira. Una vez recibido el cuerpo no corre más, así que no corta un pedido que tarda en procesarse.
 * Se monta en /api, antes de los parsers: `req.path` es relativo a /api (igual que en requestGuard).
 */
export function plazoDelCuerpo(
  plazos: PlazosCuerpo = { generalMs: CUERPO_PLAZO_MS, fotoMs: CUERPO_FOTO_PLAZO_MS },
): RequestHandler {
  return (req, _res, next) => {
    // Sin cuerpo pendiente (GET, o el cuerpo ya llegó con las cabeceras): no hay nada que esperar.
    if (req.complete) {
      next();
      return;
    }
    const ms = esRutaFoto(req.method, req.path) ? plazos.fotoMs : plazos.generalMs;
    const timer = setTimeout(() => {
      // Si el cuerpo llegó entero pero nadie lo leyó todavía, no es un cliente lento: se deja seguir.
      if (!req.complete) req.socket.destroy();
    }, ms);
    timer.unref();
    const limpiar = () => {
      clearTimeout(timer);
    };
    req.once('end', limpiar);
    req.once('close', limpiar);
    next();
  };
}
