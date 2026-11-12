import { describe, expect, it, vi } from 'vitest';
import { alTerminarLaSesion, api, ApiError } from '../api/client';
import { apiFalsa } from './apiFalsa';
import { errores, planillaAdmin, usuarioAdmin } from './fixtures';

describe('cliente de la API', () => {
  it('ante 401 SESSION_EXPIRED refresca una vez y reintenta el pedido', async () => {
    const falsa = apiFalsa({
      'GET /api/admin/lavados': [errores.vencida, { status: 200, body: planillaAdmin('2026-11-12') }],
      'POST /api/auth/refresh': { status: 200, body: { usuario: usuarioAdmin } },
    });
    const r = await api<{ fecha: string }>('/api/admin/lavados?fecha=2026-11-12');
    expect(r.fecha).toBe('2026-11-12');
    expect(falsa.de('POST', '/api/auth/refresh')).toHaveLength(1);
    expect(falsa.de('POST', '/api/auth/refresh')[0]?.headers['Content-Type']).toBe('application/json');
    expect(falsa.de('GET', '/api/admin/lavados')).toHaveLength(2);
  });

  it('si el refresco falla, avisa que terminó la sesión', async () => {
    apiFalsa({
      'GET /api/admin/lavados': errores.vencida,
      'POST /api/auth/refresh': errores.refrescoFallido,
    });
    const fin = vi.fn();
    const quitar = alTerminarLaSesion(fin);
    await expect(api('/api/admin/lavados')).rejects.toMatchObject({ status: 401 });
    expect(fin).toHaveBeenCalledTimes(1);
    quitar();
  });

  it('si después de refrescar el reintento vuelve a dar 401, no refresca de nuevo y termina la sesión', async () => {
    const falsa = apiFalsa({
      'GET /api/admin/lavados': errores.vencida,
      'POST /api/auth/refresh': { status: 200, body: { usuario: usuarioAdmin } },
    });
    const fin = vi.fn();
    const quitar = alTerminarLaSesion(fin);
    await expect(api('/api/admin/lavados')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(falsa.de('POST', '/api/auth/refresh')).toHaveLength(1);
    expect(falsa.de('GET', '/api/admin/lavados')).toHaveLength(2);
    expect(fin).toHaveBeenCalledTimes(1);
    quitar();
  });

  it('un 401 en /api/auth/me (sin sesión) no intenta refrescar', async () => {
    const falsa = apiFalsa({ 'GET /api/auth/me': errores.sinSesion });
    await expect(api('/api/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(falsa.de('POST', '/api/auth/refresh')).toHaveLength(0);
  });

  it('una respuesta sin JSON del proxy (backend caído, 502/503) da un mensaje claro', async () => {
    apiFalsa({ 'GET /api/admin/lavados': { status: 503 } });
    await expect(api('/api/admin/lavados')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });

  it('un 403 FORBIDDEN no cierra la sesión y trae el mensaje de la API', async () => {
    apiFalsa({
      'GET /api/admin/gastos': { status: 403, body: { error: { code: 'FORBIDDEN', message: 'Con tu rol no podés ver los gastos.' } } },
    });
    const fin = vi.fn();
    const quitar = alTerminarLaSesion(fin);
    const err: unknown = await api('/api/admin/gastos').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Con tu rol no podés ver los gastos.');
    expect(fin).not.toHaveBeenCalled();
    quitar();
  });

  it('403 NO_ACCESS termina la sesión', async () => {
    apiFalsa({
      'GET /api/admin/permisos': { status: 403, body: { error: { code: 'NO_ACCESS', message: 'Tu usuario no tiene acceso al panel.' } } },
    });
    const fin = vi.fn();
    const quitar = alTerminarLaSesion(fin);
    await expect(api('/api/admin/permisos')).rejects.toMatchObject({ code: 'NO_ACCESS' });
    expect(fin).toHaveBeenCalledTimes(1);
    quitar();
  });

  it('sin conexión da un mensaje claro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(api('/api/admin/lavados')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('los pedidos que cambian algo llevan Content-Type aunque no tengan body; los GET no', async () => {
    const falsa = apiFalsa({
      'DELETE /api/admin/gastos/x': { status: 204 },
      'GET /api/health': { status: 200, body: { status: 'ok' } },
    });
    await api('/api/admin/gastos/x', { method: 'DELETE' });
    await api('/api/health');
    expect(falsa.de('DELETE', '/api/admin/gastos/x')[0]?.headers['Content-Type']).toBe('application/json');
    expect(falsa.de('GET', '/api/health')[0]?.headers['Content-Type']).toBeUndefined();
  });
});
