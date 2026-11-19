import { randomBytes, randomUUID } from 'node:crypto';
import {
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from 'jose';
import type { FetchFn } from '../src/lib/supabase-auth.js';
import type { PgliteDatabase } from './pglite.js';

/**
 * Supabase Auth falso para los tests: ningún test hace requests reales a Supabase.
 *  - Un par de claves ES256 generado acá; el backend lo recibe como JWKS local (mismo verificador que en producción).
 *  - `fetch` responde /auth/v1/token (password y refresh_token, con rotación y detección de reuso) y /auth/v1/logout
 *    con las formas y status de GoTrue. Las sesiones se guardan en auth.sessions de PGlite, como en Supabase.
 *  - Con la secret key, también la API admin (/auth/v1/admin/users): escribe en auth.users de PGlite como
 *    supabase_auth_admin (el rol de Auth en Supabase), así corren el trigger que crea el perfil y los borrados en
 *    cascada con los mismos permisos que en Supabase.
 */

export const SUPABASE_URL = 'https://proyecto-test.supabase.co';
export const SUPABASE_ISSUER = `${SUPABASE_URL}/auth/v1`;
export const PUBLISHABLE_KEY = 'sb_publishable_clave-de-prueba-0123456789';
export const SECRET_KEY = 'sb_secret_clave-de-prueba-0123456789';
/** La API admin falsa rechaza por débil (422 weak_password) toda contraseña que contenga esto. */
export const WEAK_PASSWORD_MARK = 'debil';
export const TEST_KID = 'clave-de-prueba';
export const ACCESS_TOKEN_TTL_SECONDS = 3600;

const keyPair = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(keyPair.publicKey);

export const TEST_PRIVATE_KEY = keyPair.privateKey;
/** El JWKS "del proyecto" (solo la clave pública), como /auth/v1/.well-known/jwks.json. */
export const TEST_JWKS: JWTVerifyGetKey = createLocalJWKSet({
  keys: [{ ...publicJwk, kid: TEST_KID, alg: 'ES256', use: 'sig' }],
});

export interface TokenOverrides {
  alg?: 'ES256';
  key?: Parameters<SignJWT['sign']>[0];
  kid?: string;
  iss?: string;
  aud?: string;
  /** Segundos desde epoch. */
  iat?: number;
  exp?: number;
  claims?: JWTPayload;
}

/** Firma un access token con la forma de los de Supabase (por defecto, válido para el proyecto de prueba). */
export async function signAccessToken(
  userId: string,
  sessionId: string,
  now: Date,
  overrides: TokenOverrides = {},
): Promise<string> {
  const iat = overrides.iat ?? Math.floor(now.getTime() / 1000);
  return new SignJWT({
    role: 'authenticated',
    session_id: sessionId,
    aal: 'aal1',
    is_anonymous: false,
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: overrides.alg ?? 'ES256', kid: overrides.kid ?? TEST_KID, typ: 'JWT' })
    .setIssuer(overrides.iss ?? SUPABASE_ISSUER)
    .setAudience(overrides.aud ?? 'authenticated')
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(overrides.exp ?? iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(overrides.key ?? TEST_PRIVATE_KEY);
}

interface FakeUser {
  id: string;
  password: string;
  /** ban_duration de la API admin (ej. "876000h"): baneado, no puede iniciar sesión ni refrescar. */
  banDuration?: string;
}

interface RefreshTokenState {
  sessionId: string;
  userId: string;
  used: boolean;
}

export interface FakeCall {
  /** Ruta + query, sin el host (ej.: /token?grant_type=password). */
  path: string;
  method: string;
  apikey: string | null;
  bearer: boolean;
}

export class FakeSupabaseAuth {
  readonly calls: FakeCall[] = [];
  /** 'down': la red falla; 'error': Supabase responde 500; 'rate': 429. Se aplica a todos los pedidos. */
  mode: 'ok' | 'down' | 'error' | 'rate' = 'ok';
  /**
   * Se corre justo antes de borrar un usuario por la API admin (DELETE /admin/users/:id): para simular algo que pasa
   * entre la consulta del servicio y el borrado (ej.: alguien le registra un lavado y lo frena la FK RESTRICT).
   */
  antesDeBorrar: ((id: string) => Promise<void>) | undefined;

  private readonly users = new Map<string, FakeUser>();
  private readonly refreshTokens = new Map<string, RefreshTokenState>();

  constructor(
    private readonly db: PgliteDatabase,
    private readonly now: () => Date,
  ) {}

  addUser(email: string, password: string, id: string): void {
    this.users.set(email.toLowerCase(), { id, password });
  }

  readonly fetch: FetchFn = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const path = `${url.pathname.replace('/auth/v1', '')}${url.search}`;
    const method = init?.method ?? 'GET';
    this.calls.push({ path, method, apikey: headers.get('apikey'), bearer: headers.has('Authorization') });

    if (this.mode === 'down') throw new TypeError('fetch failed');
    if (this.mode === 'error') return json(500, { code: 500, msg: 'Internal Server Error' });
    if (this.mode === 'rate') return json(429, { code: 429, error_code: 'over_request_rate_limit' });
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
    if (url.origin === SUPABASE_URL && url.pathname.startsWith('/auth/v1/admin/')) {
      // La API admin solo acepta la secret key, y solo en apikey (no es un JWT: en Authorization la rechaza).
      if (headers.get('apikey') !== SECRET_KEY) return json(401, { message: 'Invalid API key' });
      if (headers.has('Authorization')) return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return this.admin(method, url.pathname.replace('/auth/v1/admin/', ''), body);
    }
    if (url.origin !== SUPABASE_URL || headers.get('apikey') !== PUBLISHABLE_KEY) {
      return json(401, { message: 'Invalid API key' });
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      return this.passwordGrant(body);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return this.refreshGrant(body);
    }
    if (url.pathname === '/auth/v1/logout') {
      return this.logout(headers.get('Authorization'));
    }
    return json(404, { code: 404, msg: 'Not found' });
  };

  /** Cantidad de sesiones vivas en auth.sessions. */
  async sessionCount(): Promise<number> {
    const { rows } = await this.db.sql.query('SELECT count(*)::int AS n FROM auth.sessions');
    return Number(rows[0]?.n);
  }

  /** Contraseña actual de un usuario (para comprobar los cambios hechos por la API admin). */
  passwordOf(email: string): string | undefined {
    return this.users.get(email.toLowerCase())?.password;
  }

  /** Email actual y ban de un usuario por id (para comprobar la baja hecha por la API admin). */
  cuentaDe(id: string): { email: string; banDuration: string | undefined } | undefined {
    const entry = [...this.users.entries()].find(([, user]) => user.id === id);
    return entry ? { email: entry[0], banDuration: entry[1].banDuration } : undefined;
  }

  private async admin(method: string, path: string, body: Record<string, unknown>): Promise<Response> {
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : undefined;
    const password = typeof body.password === 'string' ? body.password : undefined;
    if (password?.includes(WEAK_PASSWORD_MARK)) {
      return json(422, { code: 422, error_code: 'weak_password', msg: 'Password should be stronger' });
    }
    if (email !== undefined && this.users.has(email)) {
      return json(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
    }

    if (method === 'POST' && path === 'users') {
      if (email === undefined || password === undefined) return json(400, { code: 400, error_code: 'validation_failed' });
      const { rows } = await this.db.authSql.query('INSERT INTO auth.users (email) VALUES ($1) RETURNING id::text AS id', [email]);
      const id = String(rows[0]?.id);
      this.users.set(email, { id, password });
      return json(200, { id, aud: 'authenticated', role: 'authenticated', email });
    }

    const match = /^users\/([0-9a-f-]{36})$/.exec(path);
    const entry = match ? [...this.users.entries()].find(([, user]) => user.id === match[1]) : undefined;
    if (match === null || entry === undefined) {
      return json(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
    }
    const [currentEmail, user] = entry;

    if (method === 'PUT') {
      if (email !== undefined) {
        await this.db.authSql.query('UPDATE auth.users SET email = $2 WHERE id = $1::uuid', [user.id, email]);
        this.users.delete(currentEmail);
        this.users.set(email, user);
      }
      if (password !== undefined) user.password = password;
      if (typeof body.ban_duration === 'string') user.banDuration = body.ban_duration === 'none' ? undefined : body.ban_duration;
      return json(200, { id: user.id, aud: 'authenticated', role: 'authenticated', email: email ?? currentEmail });
    }
    if (method === 'DELETE') {
      await this.antesDeBorrar?.(user.id);
      try {
        await this.db.authSql.query('DELETE FROM auth.users WHERE id = $1::uuid', [user.id]);
      } catch {
        // Ej.: el trigger que impide quedarse sin superadmin o una FK ON DELETE RESTRICT (SQLSTATE 23001). GoTrue
        // responde 500 con un error de base de datos genérico, sin el SQLSTATE.
        return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error deleting user' });
      }
      this.users.delete(currentEmail);
      return json(200, {});
    }
    return json(405, { code: 405, msg: 'Method not allowed' });
  }

  private async passwordGrant(body: Record<string, unknown>): Promise<Response> {
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
    const user = this.users.get(email);
    if (user === undefined || user.password !== body.password) {
      return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (user.banDuration !== undefined) {
      return json(400, { code: 400, error_code: 'user_banned', msg: 'User is banned' });
    }
    const sessionId = randomUUID();
    await this.db.sql.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1::uuid, $2::uuid)', [sessionId, user.id]);
    return this.issue(user.id, sessionId);
  }

  private async refreshGrant(body: Record<string, unknown>): Promise<Response> {
    const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const state = this.refreshTokens.get(token);
    if (state === undefined) {
      return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    }
    if (state.used) {
      // Detección de reuso: se revoca la sesión entera.
      await this.endSession(state.sessionId);
      return json(400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token' });
    }
    const { rows } = await this.db.sql.query('SELECT 1 FROM auth.sessions WHERE id = $1::uuid', [state.sessionId]);
    if (rows.length === 0) {
      return json(400, { code: 400, error_code: 'session_not_found', msg: 'Invalid Refresh Token' });
    }
    state.used = true;
    return this.issue(state.userId, state.sessionId);
  }

  private async logout(authorization: string | null): Promise<Response> {
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    try {
      const { payload } = await jwtVerify(token, TEST_JWKS, {
        algorithms: ['ES256'],
        issuer: SUPABASE_ISSUER,
        audience: 'authenticated',
        currentDate: this.now(),
      });
      await this.endSession(String(payload.session_id));
      return new Response(null, { status: 204 });
    } catch {
      return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    }
  }

  private async endSession(sessionId: string): Promise<void> {
    await this.db.sql.query('DELETE FROM auth.sessions WHERE id = $1::uuid', [sessionId]);
    for (const state of this.refreshTokens.values()) {
      if (state.sessionId === sessionId) state.used = true;
    }
  }

  private async issue(userId: string, sessionId: string): Promise<Response> {
    const refreshToken = randomBytes(12).toString('base64url');
    this.refreshTokens.set(refreshToken, { sessionId, userId, used: false });
    const accessToken = await signAccessToken(userId, sessionId, this.now());
    return json(200, {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      expires_at: Math.floor(this.now().getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      user: { id: userId, aud: 'authenticated', role: 'authenticated' },
    });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
