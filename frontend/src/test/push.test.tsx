import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { sesion } from './fixtures-mejoras';
import { renderApp } from './render';


const CLAVE = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

function suscripcionFalsa() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

/** Un navegador con service worker y push. `permiso`: lo que contesta el celular al pedirlo. */
function navegadorConPush(permiso: NotificationPermission, yaSuscripto = false) {
  let actual: ReturnType<typeof suscripcionFalsa> | null = yaSuscripto ? suscripcionFalsa() : null;
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(actual)),
    subscribe: vi.fn(() => {
      actual = suscripcionFalsa();
      return Promise.resolve(actual);
    }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('PushManager', {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(() => Promise.resolve(permiso)) });
  return pushManager;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.unstubAllGlobals();
});

describe('Avisos push en Más', () => {
  it('el encargado los activa: pide permiso, se suscribe con la clave de la API y lo guarda', async () => {
    const pm = navegadorConPush('granted');
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } },
      'POST /api/admin/push/suscripciones': { status: 201, body: { ok: true } },
    });
    const { user } = renderApp('/mas');
    expect(await screen.findByText(/lavado sin monto/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Activar avisos' }));
    expect(await screen.findByText('Activados en este celular.')).toBeInTheDocument();
    expect(pm.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const [post] = api.de('POST', '/api/admin/push/suscripciones');
    expect(post?.body).toMatchObject({ endpoint: ENDPOINT, keys: { auth: 'a'.repeat(22) } });
    expect(post?.body).not.toHaveProperty('expirationTime');
  });

  it('desactivar los saca del celular y del servidor', async () => {
    navegadorConPush('granted', true);
    const api = apiFalsa({
      ...sesion('empleado'),
      'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } },
      'DELETE /api/admin/push/suscripciones': { status: 204 },
    });
    const { user } = renderApp('/mas');
    // El empleado no recibe los avisos del encargado.
    await screen.findByRole('heading', { name: 'Avisos en este celular' });
    expect(screen.queryByText(/lavado sin monto/)).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Desactivar avisos' }));
    expect(await screen.findByText('Apagados en este celular.')).toBeInTheDocument();
    expect(api.de('DELETE', '/api/admin/push/suscripciones')[0]?.body).toEqual({ endpoint: ENDPOINT });
  });

  it('con el permiso denegado explica cómo habilitarlo', async () => {
    navegadorConPush('denied');
    apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } } });
    const { user } = renderApp('/mas');
    await user.click(await screen.findByRole('button', { name: 'Activar avisos' }));
    expect(await screen.findByText('Los avisos están bloqueados')).toBeInTheDocument();
  });

  it('en iPhone sin instalar pide instalar el panel primero', async () => {
    navegadorConPush('granted');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } } });
    renderApp('/mas');
    expect(await screen.findByText('En iPhone, primero instalá el panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar avisos' })).toBeNull();
  });

  it('al cerrar sesión con los avisos activos, los saca del celular y del servidor antes del logout', async () => {
    const pm = navegadorConPush('granted', true);
    const sub = await pm.getSubscription();
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } },
      'DELETE /api/admin/push/suscripciones': { status: 204 },
      'POST /api/auth/logout': { status: 204 },
    });
    const { user } = renderApp('/mas');
    const [boton] = await screen.findAllByRole('button', { name: 'Cerrar sesión' });
    if (!boton) throw new Error('falta el botón');
    await user.click(boton);
    expect(await screen.findByRole('heading', { name: 'Panel del lavadero' })).toBeInTheDocument();
    expect(sub?.unsubscribe).toHaveBeenCalled();
    expect(api.de('DELETE', '/api/admin/push/suscripciones')[0]?.body).toEqual({ endpoint: ENDPOINT });
    const orden = api.pedidos.map((p) => `${p.method} ${p.path}`);
    expect(orden.indexOf('DELETE /api/admin/push/suscripciones')).toBeLessThan(orden.indexOf('POST /api/auth/logout'));
  });

  it('al cerrar sesión sin avisos activos no toca las suscripciones', async () => {
    navegadorConPush('granted');
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } },
      'POST /api/auth/logout': { status: 204 },
    });
    const { user } = renderApp('/mas');
    const [boton] = await screen.findAllByRole('button', { name: 'Cerrar sesión' });
    if (!boton) throw new Error('falta el botón');
    await user.click(boton);
    expect(await screen.findByRole('heading', { name: 'Panel del lavadero' })).toBeInTheDocument();
    expect(api.de('DELETE', '/api/admin/push/suscripciones')).toHaveLength(0);
  });

  it('si borrar la suscripción en el servidor falla, cierra la sesión igual', async () => {
    navegadorConPush('granted', true);
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/push/estado': { status: 200, body: { disponible: true, clavePublica: CLAVE } },
      'DELETE /api/admin/push/suscripciones': { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } },
      'POST /api/auth/logout': { status: 204 },
    });
    const { user } = renderApp('/mas');
    const [boton] = await screen.findAllByRole('button', { name: 'Cerrar sesión' });
    if (!boton) throw new Error('falta el botón');
    await user.click(boton);
    expect(await screen.findByRole('heading', { name: 'Panel del lavadero' })).toBeInTheDocument();
    expect(api.de('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('sin claves VAPID en el servidor no aparece', async () => {
    navegadorConPush('granted');
    const api = apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/push/estado': { status: 200, body: { disponible: false, clavePublica: null } } });
    renderApp('/mas');
    await screen.findByRole('heading', { name: 'Más' });
    await vi.waitFor(() => {
      expect(api.de('GET', '/api/admin/push/estado')).toHaveLength(1);
    });
    expect(screen.queryByRole('heading', { name: 'Avisos en este celular' })).toBeNull();
  });
});
