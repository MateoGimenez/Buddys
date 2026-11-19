import { type RequestHandler, type Response, Router } from 'express';
import { type SessionCookies, readAccessToken, readRefreshToken } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';
import { getUsuario } from '../middleware/require-session.js';
import { loginSchema } from '../schemas/auth.js';
import { parseOrThrow } from '../schemas/common.js';
import type { AuthService, UsuarioSesion } from '../services/auth.js';
import type { PerfilService } from '../services/perfil.js';

export interface AuthRouterDeps {
  auth: AuthService;
  /** Firma la URL de la foto de perfil (avatarUrl). */
  perfil: PerfilService;
  cookies: SessionCookies;
  /** Limita los intentos de login FALLIDOS por IP. */
  loginLimiter: RequestHandler;
  requireSession: RequestHandler;
}

export function authRouter({ auth, perfil, cookies, loginLimiter, requireSession }: AuthRouterDeps): Router {
  const router = Router();

  /**
   * Lo que el frontend ve del usuario: { id, email, nombre, rol, avatarUrl, avatarVenceEl }. Nunca tokens, el
   * session_id ni la ruta de la foto en el bucket (solo una URL firmada que vence en 1 hora).
   */
  const sendUsuario = async (res: Response, usuario: UsuarioSesion): Promise<void> => {
    res.json({ usuario: await perfil.usuarioPublico(usuario) });
  };

  // POST /api/auth/login { email, password } => 200 { usuario } + cookies bd_at y bd_rt
  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parseOrThrow(loginSchema, req.body ?? {});
    try {
      const { usuario, tokens } = await auth.login(email, password);
      cookies.set(res, tokens);
      await sendUsuario(res, usuario);
    } catch (error) {
      // Si había una sesión vieja en el navegador, que no quede mezclada con un login fallido.
      if (readAccessToken(req) !== undefined || readRefreshToken(req) !== undefined) cookies.clear(res);
      throw error;
    }
  });

  // POST /api/auth/refresh => 200 { usuario } + cookies nuevas | 401 UNAUTHORIZED | 403 NO_ACCESS
  // El frontend lo llama cuando /api/admin/* responde 401 SESSION_EXPIRED, y después reintenta el pedido.
  router.post('/refresh', async (req, res) => {
    const accessToken = readAccessToken(req);
    const refreshToken = readRefreshToken(req);
    const result = await auth.refreshFromCookies({
      ...(accessToken !== undefined && { accessToken }),
      ...(refreshToken !== undefined && { refreshToken }),
    });
    if (result.status === 'ok') {
      if (result.renewed) cookies.set(res, result.renewed);
      await sendUsuario(res, result.usuario);
      return;
    }
    if (result.status !== 'none') cookies.clear(res);
    throw result.status === 'forbidden' ? AppError.noAccess() : AppError.unauthorized();
  });

  // POST /api/auth/logout => 204. Cierra la sesión en Supabase y borra las cookies. Siempre responde 204.
  router.post('/logout', async (req, res) => {
    const accessToken = readAccessToken(req);
    const refreshToken = readRefreshToken(req);
    if (accessToken !== undefined || refreshToken !== undefined) {
      await auth.logout({
        ...(accessToken !== undefined && { accessToken }),
        ...(refreshToken !== undefined && { refreshToken }),
      });
    }
    cookies.clear(res);
    res.status(204).end();
  });

  // GET /api/auth/me => 200 { usuario: { id, email, nombre, rol, avatarUrl, avatarVenceEl } } | 401 | 403. Si el
  // access token venció, acá sí viaja el refresh token: se refresca solo.
  router.get('/me', requireSession, async (_req, res) => {
    await sendUsuario(res, getUsuario(res));
  });

  return router;
}
