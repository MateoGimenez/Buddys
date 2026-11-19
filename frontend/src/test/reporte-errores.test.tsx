import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { armarReporte, limpiar, reiniciarReporteErrores, reportarError, VERSION } from '../lib/reporteErrores';
import { apiFalsa } from './apiFalsa';
import { fx } from './fixtures';

const ok = fx.errorClienteRegistrado as { status: number; body: unknown };
const registrado = { status: ok.status };

beforeEach(() => {
  reiniciarReporteErrores();
  window.history.replaceState(null, '', '/planilla?telefono=3804123456&email=juan@mail.com#algo');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Reporte de errores del panel', () => {
  it('manda mensaje, stack recortado, path sin query, navegador y versión', async () => {
    const api = apiFalsa({ 'POST /api/admin/errores-cliente': registrado });
    const err = new TypeError('No se pudo leer x de juan@mail.com con el teléfono 3804 123456');
    err.stack = `TypeError: x\n${Array.from({ length: 30 }, (_, i) => `    at f${String(i)} (http://localhost/assets/index.js?token=abc:1:${String(i)})`).join('\n')}`;
    expect(await reportarError(err)).toBe(true);
    const [p] = api.de('POST', '/api/admin/errores-cliente');
    const body = p?.body as { mensaje: string; stack: string; url: string; userAgent: string; version: string };
    expect(body.url).toBe('/planilla');
    expect(body.mensaje).toBe('TypeError: No se pudo leer x de [email] con el teléfono [número]');
    expect(body.stack.split('\n')).toHaveLength(12);
    expect(body.stack).not.toContain('abc');
    expect(body.userAgent).toBe(navigator.userAgent);
    expect(body.version).toBe(VERSION);
    expect(Object.keys(body).sort()).toEqual(['mensaje', 'stack', 'url', 'userAgent', 'version']);
    expect(p?.headers['Content-Type']).toBe('application/json');
  });

  it('no repite el mismo error y manda hasta 5 por minuto', async () => {
    const api = apiFalsa({ 'POST /api/admin/errores-cliente': registrado });
    await reportarError(new Error('uno'));
    await reportarError(new Error('uno'));
    expect(api.de('POST', '/api/admin/errores-cliente')).toHaveLength(1);
    for (let i = 0; i < 10; i++) await reportarError(new Error(`distinto ${String(i)}`));
    expect(api.de('POST', '/api/admin/errores-cliente')).toHaveLength(5);
  });

  it('sin sesión (401) lo manda a la ruta pública; sin conexión lo descarta', async () => {
    const api = apiFalsa({
      'POST /api/admin/errores-cliente': { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x' } } },
      'POST /api/errores-cliente': registrado,
    });
    await reportarError(new Error('en el login'));
    expect(api.de('POST', '/api/errores-cliente')).toHaveLength(1);

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await reportarError(new Error('sin red'))).toBe(false);
    expect(api.pedidos).toHaveLength(2);
  });

  it('nunca manda datos personales sueltos', () => {
    expect(limpiar('Patente para 5493804123456 de ana@buddys.test, token eyJabc.def.ghi')).toBe('Patente para [número] de [email], token [token]');
    expect(armarReporte('texto').mensaje).toBe('texto');
  });

  it('el ErrorBoundary muestra una pantalla amable, reporta y "Volver a intentar" vuelve a dibujar', async () => {
    const api = apiFalsa({ 'POST /api/admin/errores-cliente': registrado });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let romper = true;
    function Fragil() {
      const [n] = useState(0);
      if (romper) throw new Error('pantalla rota');
      return <p>Todo bien {n}</p>;
    }
    render(
      <ErrorBoundary>
        <Fragil />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Algo se trabó en esta pantalla');
    await vi.waitFor(() => {
      expect(api.de('POST', '/api/admin/errores-cliente')).toHaveLength(1);
    });
    expect((api.pedidos[0]?.body as { mensaje: string }).mensaje).toBe('Error: pantalla rota');
    romper = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(screen.getByText('Todo bien 0')).toBeInTheDocument();
  });
});
