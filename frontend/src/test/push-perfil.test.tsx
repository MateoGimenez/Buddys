import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Permisos } from '../api/types';
import { claveABytes } from '../lib/push';
import { apiFalsa } from './apiFalsa';
import { perfilReal, permisosAdmin, permisosEmpleado } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin, sesionEmpleado } from './sesiones';

// "Avisos en este celular" (Mi perfil). Notification, PushManager y el service worker son falsos; la API, la de
// backend/README.md ("Avisos push"): GET /estado, POST y DELETE /suscripciones.

/** Una clave pública VAPID con la forma real: 65 bytes en base64url (87 caracteres). */
const CLAVE = `B${'A'.repeat(86)}`;
const OTRA_CLAVE = `B${'Q'.repeat(86)}`;
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dispositivo-de-prueba';
const KEYS = { p256dh: `B${'x'.repeat(86)}`, auth: 'a'.repeat(22) };

const estadoOk = { status: 200, body: { disponible: true, clavePublica: CLAVE } };
const estadoApagado = { status: 200, body: { disponible: false, clavePublica: null } };
/** El proxy sin backend: el cliente lo traduce a "El servidor no responde". */
const servidorCaido = { status: 503 };

function suscripcionFalsa(clave = CLAVE) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: claveABytes(clave).buffer, userVisibleOnly: true },
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: KEYS }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}
type Suscripcion = ReturnType<typeof suscripcionFalsa>;

/** Instala Notification, PushManager y navigator.serviceWorker falsos. */
interface OpcionesNavegador {
  permiso?: NotificationPermission;
  respuesta?: NotificationPermission;
  previa?: Suscripcion | null;
}

function navegador({ permiso = 'default', respuesta = 'granted', previa = null }: OpcionesNavegador = {}) {
  const estado = { permiso, actual: previa };
  const nueva = suscripcionFalsa();
  const requestPermission = vi.fn(() => {
    estado.permiso = respuesta;
    return Promise.resolve(respuesta);
  });
  const NotificationFalsa = {
    get permission() {
      return estado.permiso;
    },
    requestPermission,
  };
  const subscribe = vi.fn<(opciones: PushSubscriptionOptionsInit) => Promise<Suscripcion>>(() => {
    estado.actual = nueva;
    return Promise.resolve(nueva);
  });
  const registro = {
    pushManager: { getSubscription: vi.fn(() => Promise.resolve(estado.actual)), subscribe },
  };
  vi.stubGlobal('Notification', NotificationFalsa);
  vi.stubGlobal('PushManager', {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve(registro), ready: Promise.resolve(registro) },
  });
  return { requestPermission, subscribe, nueva };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

function sesion(extra: Record<string, unknown> = {}) {
  return { ...sesionAdmin(), 'GET /api/admin/perfil': { status: 200, body: perfilReal('perfilAdmin') }, ...extra };
}

async function bloque() {
  const titulo = await screen.findByRole('heading', { name: 'Avisos en este celular' });
  const seccion = titulo.closest('section');
  if (!seccion) throw new Error('El bloque no es una sección');
  return within(seccion);
}

describe('Mi perfil: avisos en este celular', () => {
  it('activar: pide el permiso recién con el toque, se suscribe con la clave de /estado y la manda por POST', async () => {
    const { requestPermission, subscribe } = navegador();
    const api = apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk, 'POST /api/admin/push/suscripciones': { status: 201, body: { ok: true } } }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    expect(b.getByText('Te avisamos cuando queda poco de un insumo.')).toBeInTheDocument();
    const activar = await b.findByRole('button', { name: 'Activar avisos' });
    // Al cargar la pantalla no se pregunta nada.
    expect(requestPermission).not.toHaveBeenCalled();

    await user.click(activar);
    expect(await b.findByText('Activados en este celular')).toBeInTheDocument();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const opciones = subscribe.mock.calls[0]?.[0];
    expect(opciones?.userVisibleOnly).toBe(true);
    expect(opciones?.applicationServerKey).toEqual(claveABytes(CLAVE));
    expect(api.de('POST', '/api/admin/push/suscripciones').map((p) => p.body)).toEqual([
      { endpoint: ENDPOINT, expirationTime: null, keys: KEYS },
    ]);
    expect(b.getByRole('button', { name: 'Desactivar avisos' })).toBeInTheDocument();
    expect(b.queryByRole('button', { name: 'Activar avisos' })).toBeNull();
  });

  it('desactivar: se da de baja en el celular y manda DELETE con el endpoint', async () => {
    const previa = suscripcionFalsa();
    navegador({ permiso: 'granted', previa });
    const api = apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk, 'DELETE /api/admin/push/suscripciones': { status: 204 } }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    expect(await b.findByText('Activados en este celular')).toBeInTheDocument();

    await user.click(b.getByRole('button', { name: 'Desactivar avisos' }));
    expect(await b.findByRole('button', { name: 'Activar avisos' })).toBeInTheDocument();
    expect(previa.unsubscribe).toHaveBeenCalled();
    expect(api.de('DELETE', '/api/admin/push/suscripciones').map((p) => p.body)).toEqual([{ endpoint: ENDPOINT }]);
  });

  it('una suscripción hecha con otra clave del servidor no cuenta como activada y se reemplaza al activar', async () => {
    const vieja = suscripcionFalsa(OTRA_CLAVE);
    const { subscribe } = navegador({ permiso: 'granted', previa: vieja });
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk, 'POST /api/admin/push/suscripciones': { status: 201, body: { ok: true } } }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    await user.click(await b.findByRole('button', { name: 'Activar avisos' }));
    expect(await b.findByText('Activados en este celular')).toBeInTheDocument();
    expect(vieja.unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('si el servidor rechaza el dispositivo: muestra el error y no deja la suscripción a medias', async () => {
    const { nueva } = navegador();
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk, 'POST /api/admin/push/suscripciones': servidorCaido }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    await user.click(await b.findByRole('button', { name: 'Activar avisos' }));
    expect(await b.findByRole('alert')).toHaveTextContent('El servidor no responde');
    expect(nueva.unsubscribe).toHaveBeenCalled();
    expect(b.getByRole('button', { name: 'Activar avisos' })).toBeEnabled();
    expect(b.queryByText('Activados en este celular')).toBeNull();
  });

  it('si la persona cierra la pregunta sin elegir, dice cómo volver a intentarlo', async () => {
    const { subscribe } = navegador({ respuesta: 'default' });
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    await user.click(await b.findByRole('button', { name: 'Activar avisos' }));
    expect(await b.findByRole('alert')).toHaveTextContent('No diste el permiso');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('bloqueado por el navegador: explica cómo destrabarlo y no muestra Activar', async () => {
    const { subscribe } = navegador({ respuesta: 'denied' });
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    await user.click(await b.findByRole('button', { name: 'Activar avisos' }));
    expect(await b.findByText('El navegador bloqueó los avisos')).toBeInTheDocument();
    expect(b.getByText(/elegí\s+Permitir/)).toBeInTheDocument();
    expect(b.queryByRole('button', { name: 'Activar avisos' })).toBeNull();
    expect(b.getByRole('button', { name: 'Ya los permití' })).toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('con el permiso ya bloqueado al entrar, lo muestra de una', async () => {
    navegador({ permiso: 'denied' });
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk }));
    renderApp('/perfil');
    const b = await bloque();
    expect(await b.findByText('El navegador bloqueó los avisos')).toBeInTheDocument();
  });

  it('“Ya los permití” con el permiso todavía bloqueado lo dice; destrabado, vuelve Activar', async () => {
    navegador({ permiso: 'denied' });
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    await user.click(await b.findByRole('button', { name: 'Ya los permití' }));
    expect(await b.findByRole('alert')).toHaveTextContent('Todavía figura bloqueado');
    vi.stubGlobal('Notification', { permission: 'default' });
    await user.click(b.getByRole('button', { name: 'Ya los permití' }));
    expect(await b.findByRole('button', { name: 'Activar avisos' })).toBeInTheDocument();
    expect(b.queryByRole('alert')).toBeNull();
  });

  it('con los avisos apagados en el servidor: lo explica y no hay botón', async () => {
    navegador();
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoApagado }));
    renderApp('/perfil');
    const b = await bloque();
    expect(await b.findByText('Los avisos están apagados por ahora')).toBeInTheDocument();
    expect(b.queryByRole('button')).toBeNull();
  });

  it('un navegador sin push: lo explica, no hay botón y ni pregunta a la API', async () => {
    const api = apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk }));
    renderApp('/perfil');
    const b = await bloque();
    expect(await b.findByText('Este navegador no recibe avisos')).toBeInTheDocument();
    expect(b.queryByRole('button')).toBeNull();
    expect(api.de('GET', '/api/admin/push/estado')).toHaveLength(0);
  });

  it('en iPhone sin instalar: dice que hay que agregarlo a la pantalla de inicio', async () => {
    navegador();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
    apiFalsa(sesion({ 'GET /api/admin/push/estado': estadoOk }));
    renderApp('/perfil');
    const b = await bloque();
    expect(await b.findByText('Instalá el panel para recibir avisos')).toBeInTheDocument();
    expect(b.getByText(/pantalla de inicio/)).toBeInTheDocument();
    expect(b.queryByRole('button')).toBeNull();
  });

  it('si no se puede leer el estado: error con Reintentar', async () => {
    navegador();
    apiFalsa(sesion({ 'GET /api/admin/push/estado': [servidorCaido, estadoOk] }));
    const { user } = renderApp('/perfil');
    const b = await bloque();
    await user.click(await b.findByRole('button', { name: 'Reintentar' }));
    expect(await b.findByRole('button', { name: 'Activar avisos' })).toBeInTheDocument();
  });

  it('el empleado no ve el bloque: con los turnos online apagados no le llega ningún aviso', async () => {
    navegador();
    const api = apiFalsa({ ...sesionEmpleado(), 'GET /api/admin/perfil': { status: 200, body: perfilReal('perfilEmpleado') }, 'GET /api/admin/push/estado': estadoOk });
    renderApp('/perfil');
    expect(await screen.findByRole('heading', { name: 'Mi perfil', level: 1 })).toBeInTheDocument();
    // Puede activar avisos (push.activar), pero no tiene inventario.consumo: el único aviso de hoy no es para él.
    expect(permisosEmpleado().capacidades.find((c) => c.id === 'push.activar')?.roles.empleado).toBe('si');
    await waitFor(() => {
      expect(api.de('GET', '/api/admin/perfil').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('heading', { name: 'Avisos en este celular' })).toBeNull();
    expect(screen.queryByText('Por ahora no hay avisos para tu rol.')).toBeNull();
    expect(api.de('GET', '/api/admin/push/estado')).toHaveLength(0);
  });

  it('si el rol no puede activar avisos, el bloque no aparece', async () => {
    navegador();
    const tabla = permisosAdmin();
    const sinPush: Permisos = {
      ...tabla,
      capacidades: tabla.capacidades.map((c) => (c.id === 'push.activar' ? { ...c, roles: { ...c.roles, superadmin: 'no' } } : c)),
    };
    const api = apiFalsa(sesion({ 'GET /api/admin/permisos': { status: 200, body: sinPush }, 'GET /api/admin/push/estado': estadoOk }));
    renderApp('/perfil');
    expect(await screen.findByRole('heading', { name: 'Mi perfil', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(api.de('GET', '/api/admin/perfil').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('heading', { name: 'Avisos en este celular' })).toBeNull();
    expect(api.de('GET', '/api/admin/push/estado')).toHaveLength(0);
  });
});
