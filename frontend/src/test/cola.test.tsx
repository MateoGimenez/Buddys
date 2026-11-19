import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LavadoEnCola } from '../lib/cola';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { ANA_ID, errores, registrado } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin, UUID_RE } from './sesiones';

const CLAVE = 'buddys.cola-lavados.v1';

function enCola(): LavadoEnCola[] {
  return JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as LavadoEnCola[];
}

function sinSenal() {
  return vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
}

function vuelveLaSenal(linea: ReturnType<typeof sinSenal>) {
  linea.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
}

async function registrarBasico(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
  await user.click(screen.getByRole('radio', { name: 'Efectivo' }));
  await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
}

describe('Cola sin conexión de "Registrar lavado"', () => {
  it('sin señal guarda el lavado en el celular con fecha y franja, sin pedir nada a la API', async () => {
    const api = apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    await screen.findByRole('checkbox', { name: /Lavado Básico/ });
    sinSenal();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();

    await registrarBasico(user);

    expect(await screen.findByText('Guardado sin conexión')).toBeInTheDocument();
    expect(screen.getByText('Se envía solo cuando vuelva la señal.')).toBeInTheDocument();
    expect(screen.getByText('1 lavado por enviar')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(0);
    const [guardado] = enCola();
    expect(guardado?.idLocal).toMatch(UUID_RE);
    expect(guardado?.datos.idLocal).toBe(guardado?.idLocal);
    expect(guardado?.datos).toMatchObject({ servicioIds: ['lavado-basico'], formaPago: 'efectivo', fecha: hoy() });
    expect(['manana', 'tarde']).toContain(guardado?.datos.franja);
    // Sin "Deshacer": todavía no existe en el servidor.
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
  });

  it('si el pedido falla por red, lo encola', async () => {
    const api = apiFalsa({
      ...sesionAdmin(),
      'POST /api/admin/lavados': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const { user } = renderApp('/registrar');
    await registrarBasico(user);
    expect(await screen.findByText('Guardado sin conexión')).toBeInTheDocument();
    const [intento] = api.de('POST', '/api/admin/lavados');
    // Se guarda con el mismo idLocal del intento: si aquel sí llegó, el reintento no lo duplica.
    const [guardado] = enCola();
    expect((intento?.body as { idLocal: string }).idLocal).toMatch(UUID_RE);
    expect(guardado?.idLocal).toBe((intento?.body as { idLocal: string }).idLocal);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('si el registro tarda más de 8 s lo corta y lo encola; el reintento lleva el mismo idLocal', async () => {
    // El plazo lo maneja el test: AbortSignal.timeout devuelve una señal que se corta a mano.
    const plazos: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const c = new AbortController();
      plazos.push(c);
      return c.signal;
    });
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    const responder = api.fetchFalso.getMockImplementation();
    if (!responder) throw new Error('apiFalsa sin implementación');
    let posts = 0;
    // El primer POST queda colgado (señal floja) hasta que se vence el plazo; el siguiente contesta.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const respuesta = responder(input, init);
        if (init?.method === 'POST' && input === '/api/admin/lavados' && posts++ === 0) {
          const signal = init.signal;
          return new Promise<Response>((_, rechazar) => {
            signal?.addEventListener('abort', () => {
              rechazar(signal.reason as Error);
            });
          });
        }
        return respuesta;
      }),
    );
    const { user } = renderApp('/registrar');
    await registrarBasico(user);
    await vi.waitFor(() => {
      expect(plazos).toHaveLength(1);
    });
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(screen.queryByText('Guardado sin conexión')).toBeNull();

    act(() => {
      plazos[0]?.abort(new DOMException('Se venció el plazo.', 'TimeoutError'));
    });
    // Lo mismo que sin señal: talón de "Guardado sin conexión", sin error.
    expect(await screen.findByText('Guardado sin conexión')).toBeInTheDocument();
    expect(screen.getByText('Se envía solo cuando vuelva la señal.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(enCola()).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => {
      expect(enCola()).toHaveLength(0);
    });
    const [primero, segundo] = api.de('POST', '/api/admin/lavados');
    const idLocal = (primero?.body as { idLocal: string }).idLocal;
    expect(idLocal).toMatch(UUID_RE);
    expect((segundo?.body as { idLocal: string }).idLocal).toBe(idLocal);
  });

  it('el plazo es solo de registrar: los otros pedidos salen sin señal de corte', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const api = apiFalsa(sesionAdmin());
    renderApp('/registrar');
    await screen.findByRole('checkbox', { name: /Lavado Básico/ });
    expect(api.fetchFalso).toHaveBeenCalled();
    for (const [, init] of api.fetchFalso.mock.calls) expect(init?.signal).toBeUndefined();
    expect(timeout).not.toHaveBeenCalled();
  });

  it('un error de la API (4xx) no se encola: se muestra como siempre', async () => {
    apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': errores.validacionLavado });
    const { user } = renderApp('/registrar');
    await registrarBasico(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisá los datos ingresados.');
    expect(enCola()).toHaveLength(0);
    expect(screen.queryByText(/por enviar/)).toBeNull();
  });

  it('cuando vuelve la señal lo manda una sola vez, con la fecha de cuando se guardó', async () => {
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    const { user } = renderApp('/registrar');
    await screen.findByRole('checkbox', { name: /Lavado Básico/ });
    const linea = sinSenal();
    await registrarBasico(user);
    await screen.findByText('1 lavado por enviar');

    vuelveLaSenal(linea);
    await vi.waitFor(() => {
      expect(enCola()).toHaveLength(0);
    });
    expect(screen.queryByText(/por enviar/)).toBeNull();
    // Otro "online" no lo vuelve a mandar.
    vuelveLaSenal(linea);
    const enviados = api.de('POST', '/api/admin/lavados');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.body).toMatchObject({ servicioIds: ['lavado-basico'], formaPago: 'efectivo', fecha: hoy(), idLocal: expect.stringMatching(UUID_RE) as unknown });
  });

  it('al abrir la app manda lo pendiente; si la API lo rechaza (4xx) lo saca y avisa con el detalle', async () => {
    const pendiente: LavadoEnCola = {
      idLocal: 'local-1',
      usuarioId: ANA_ID,
      datos: { servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: null, fecha: '2026-09-01', franja: 'manana' },
      servicio: 'Lavado Básico',
      guardadoEn: '2026-09-01T12:00:00.000Z',
    };
    localStorage.setItem(CLAVE, JSON.stringify([pendiente]));
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': errores.validacionLavado });
    renderApp('/registrar');

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Un lavado guardado sin conexión no se pudo registrar');
    expect(alerta).toHaveTextContent('Lavado Básico, 01/09/2026');
    expect(alerta).toHaveTextContent('Solo se pueden registrar lavados de los últimos 31 días.');
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(1);
    expect(enCola()).toHaveLength(0);
  });

  it('lo guardado por otra persona en este celular no se manda con esta sesión', async () => {
    const ajeno: LavadoEnCola = {
      idLocal: 'local-2',
      usuarioId: 'otra-persona',
      datos: { servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: null, fecha: hoy(), franja: 'manana' },
      servicio: 'Lavado Básico',
      guardadoEn: new Date().toISOString(),
    };
    localStorage.setItem(CLAVE, JSON.stringify([ajeno]));
    const api = apiFalsa(sesionAdmin());
    renderApp('/registrar');
    await screen.findByRole('checkbox', { name: /Lavado Básico/ });
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(0);
    expect(screen.queryByText(/por enviar/)).toBeNull();
    expect(enCola()).toHaveLength(1);
  });

  it('si el envío anterior sí había llegado, el reintento recibe 200 con el mismo lavado: no duplica ni avisa error', async () => {
    const id = '6f1c2b0a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
    const pendiente: LavadoEnCola = {
      idLocal: id,
      usuarioId: ANA_ID,
      datos: { servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: null, fecha: hoy(), franja: 'manana', idLocal: id },
      servicio: 'Lavado Básico',
      guardadoEn: new Date().toISOString(),
    };
    localStorage.setItem(CLAVE, JSON.stringify([pendiente]));
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 200, body: registrado({ id: 'ya-estaba' }) } });
    renderApp('/registrar');
    await screen.findByRole('checkbox', { name: /Lavado Básico/ });
    await vi.waitFor(() => {
      expect(enCola()).toHaveLength(0);
    });
    const enviados = api.de('POST', '/api/admin/lavados');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.body).toMatchObject({ idLocal: id });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/por enviar/)).toBeNull();
  });

  it('lo guardado antes con un id local que no es uuid se pasa a uuid y se manda con ese', async () => {
    const viejo: LavadoEnCola = {
      idLocal: 'k3x9-abc',
      usuarioId: ANA_ID,
      datos: { servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: null, fecha: hoy(), franja: 'manana' },
      servicio: 'Lavado Básico',
      guardadoEn: new Date().toISOString(),
    };
    localStorage.setItem(CLAVE, JSON.stringify([viejo]));
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    renderApp('/registrar');
    await vi.waitFor(() => {
      expect(api.de('POST', '/api/admin/lavados')).toHaveLength(1);
    });
    expect((api.de('POST', '/api/admin/lavados')[0]?.body as { idLocal: string }).idLocal).toMatch(UUID_RE);
  });

  it('lo guardado antes de SUV y pick-up con vehículo "camioneta" se manda como suv (el backend ya no acepta camioneta)', async () => {
    const viejo = {
      idLocal: '7a2d3c1b-4e5f-4a6b-9c7d-8e9f0a1b2c3d',
      usuarioId: ANA_ID,
      datos: { servicioId: 'lavado-basico', vehiculoTipo: 'camioneta', monto: null, fecha: hoy(), franja: 'manana' },
      servicio: 'Lavado Básico',
      guardadoEn: new Date().toISOString(),
    };
    localStorage.setItem(CLAVE, JSON.stringify([viejo]));
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    renderApp('/registrar');
    await vi.waitFor(() => {
      expect(api.de('POST', '/api/admin/lavados')).toHaveLength(1);
    });
    const body = api.de('POST', '/api/admin/lavados')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ servicioId: 'lavado-basico', vehiculoTipo: 'suv' });
    expect(body).not.toHaveProperty('servicioIds');
  });

  it('si el idLocal es de otra persona (409), lo saca de la cola y avisa', async () => {
    const id = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
    localStorage.setItem(
      CLAVE,
      JSON.stringify([
        {
          idLocal: id,
          usuarioId: ANA_ID,
          datos: { servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: null, fecha: hoy(), franja: 'manana', idLocal: id },
          servicio: 'Lavado Básico',
          guardadoEn: new Date().toISOString(),
        } satisfies LavadoEnCola,
      ]),
    );
    apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': errores.idLocalAjeno });
    renderApp('/registrar');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese lavado ya lo registró otra persona.');
    expect(enCola()).toHaveLength(0);
  });
});
