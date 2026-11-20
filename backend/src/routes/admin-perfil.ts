import express, { type RequestHandler, Router } from 'express';
import type { Perfil } from '../domain/perfil.js';
import { puedeEditarPerfil } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import { getUsuario, requirePermiso } from '../middleware/require-session.js';
import { parseOrThrow } from '../schemas/common.js';
import { FOTO_MAX_BYTES, TIPOS_FOTO, tipoFoto, updatePerfilSchema } from '../schemas/perfil.js';
import { usuarioIdSchema } from '../schemas/usuarios.js';
import type { PerfilService } from '../services/perfil.js';
import { publicUsuario } from './auth.js';

const FOTO_PESADA_MESSAGE = 'La foto pesa más de 2 MB. Elegí una más liviana.';
const SIN_FOTO_MESSAGE = 'Ese usuario no tiene foto.';

/** El perfil propio: misma forma que el usuario de la sesión ({ id, email, nombre, rol, fotoVersion }). */
function toJson(perfil: Perfil) {
  return publicUsuario(perfil);
}

/**
 * El body de la foto, binario y con tope de 2 MB, SOLO en PUT /api/admin/perfil/foto (el resto de la API lee JSON de
 * 10 kb). inflate: false, como en el JSON: nada comprimido. Si se pasa del tope, 413 con un mensaje propio.
 */
function fotoBody(): RequestHandler {
  const raw = express.raw({ type: [...TIPOS_FOTO], limit: FOTO_MAX_BYTES, inflate: false });
  return (req, res, next) => {
    raw(req, res, (error?: unknown) => {
      const tipo = (error as { type?: unknown } | undefined)?.type;
      next(tipo === 'entity.too.large' ? AppError.payloadTooLarge(FOTO_PESADA_MESSAGE) : error);
    });
  };
}

/**
 * Mi perfil (contrato 2026-11-17_04), detrás de requireSession. Todos los roles (perfil.editar).
 * `passwordLimiter` cuenta los intentos de cambiar la contraseña por usuario (5 cada 15 minutos) y `fotoLimiter` las
 * subidas de foto por usuario (10 cada 15 minutos).
 */
export function adminPerfilRouter(deps: {
  perfil: PerfilService;
  passwordLimiter: RequestHandler;
  fotoLimiter: RequestHandler;
}): Router {
  const { perfil, passwordLimiter, fotoLimiter } = deps;
  const router = Router();

  router.use(requirePermiso(puedeEditarPerfil, 'Con tu rol no podés editar tu perfil.'));

  // GET /api/admin/perfil => { perfil, fotosDisponibles }
  router.get('/', async (_req, res) => {
    res.json({ perfil: toJson(await perfil.get(getUsuario(res))), fotosDisponibles: perfil.fotosDisponibles });
  });

  // PATCH /api/admin/perfil { nombre?, passwordActual? + passwordNueva? } => { perfil }
  router.patch('/', passwordLimiter, async (req, res) => {
    const cambios = parseOrThrow(updatePerfilSchema, req.body ?? {});
    if (Object.keys(cambios).length === 0) {
      throw AppError.validation(undefined, 'Indicá al menos un cambio: nombre o contraseña.');
    }
    res.json({ perfil: toJson(await perfil.actualizar(getUsuario(res), cambios)) });
  });

  // PUT /api/admin/perfil/foto (body: la imagen; image/jpeg, image/png o image/webp; hasta 2 MB) => { perfil }
  // El límite va ANTES de fotoBody(): un pedido limitado responde 429 sin leer el cuerpo.
  router.put('/foto', fotoLimiter, fotoBody(), async (req, res) => {
    const tipo = tipoFoto(req.headers['content-type']);
    // request-guard ya dejó pasar solo esos tres tipos; sin body (o vacío) no hay foto.
    if (tipo === undefined || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw AppError.validation({ foto: 'Subí una foto JPG, PNG o WebP.' }, 'Subí una foto JPG, PNG o WebP.');
    }
    res.json({ perfil: toJson(await perfil.subirFoto(getUsuario(res), req.body, tipo)) });
  });

  // DELETE /api/admin/perfil/foto => { perfil } (también si no tenía foto)
  router.delete('/foto', async (_req, res) => {
    res.json({ perfil: toJson(await perfil.quitarFoto(getUsuario(res))) });
  });

  return router;
}

/** El ETag de una versión: entre comillas, como pide HTTP. */
const etagDe = (version: string) => `"${version}"`;

/** If-None-Match coincide con la versión (lista separada por comas, W/ débil o *). */
function coincideEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((valor) => {
    const limpio = valor.trim().replace(/^W\//, '');
    return limpio === '*' || limpio === etag;
  });
}

/**
 * GET /api/admin/usuarios/:id/foto => 200 image/webp | 304 | 403 | 404. Se monta en /admin/usuarios ANTES del router
 * de usuarios (que exige gestionar usuarios): la foto propia la ve cualquier rol; la de otros, quien gestiona usuarios
 * (lo decide PerfilService).
 *  - Cache-Control: private, max-age=86400, immutable si `?v=` es la versión actual (la URL cambia con cada foto);
 *    si no, private, no-cache (se revalida con el ETag).
 *  - Es una imagen, nunca un documento: nosniff y CSP default-src 'none'.
 */
export function adminFotoUsuarioRouter(deps: { perfil: PerfilService }): Router {
  const { perfil } = deps;
  const router = Router();

  router.get('/:id/foto', async (req, res) => {
    const parsed = usuarioIdSchema.safeParse(req.params.id);
    if (!parsed.success) throw AppError.notFound(SIN_FOTO_MESSAGE);
    const { bytes, version } = await perfil.leerFoto(getUsuario(res), parsed.data.toLowerCase());

    const etag = etagDe(version);
    res.setHeader('Cache-Control', req.query.v === version ? 'private, max-age=86400, immutable' : 'private, no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    if (coincideEtag(req.headers['if-none-match'], etag)) {
      res.status(304).end();
      return;
    }
    res.type('image/webp').send(Buffer.from(bytes));
  });

  return router;
}
