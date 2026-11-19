import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENTO_ENVIADOS } from '../lib/cola';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { BETO_ID, catalogoBuddys, planillaAdmin, registrado } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin } from './sesiones';

/** Simula la preferencia del sistema "reducir movimiento" (jsdom no trae matchMedia). */
function preferencia(reducir: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: reducir && media.includes('prefers-reduced-motion: reduce'),
      media,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
}

/** La planilla de hoy y, al recargar, la misma con un lavado más por $ 30.000. */
function dosVersiones() {
  const antes = planillaAdmin(hoy());
  const despues = planillaAdmin(hoy());
  despues.resumen = {
    ...despues.resumen,
    cantidad: 4,
    total: 102000,
  };
  return [
    { status: 200, body: antes },
    { status: 200, body: despues },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('con "reducir movimiento"', () => {
  it('los números de la caja saltan al valor nuevo sin contar (no pide cuadros de animación)', async () => {
    preferencia(true);
    const cuadros = vi.spyOn(window, 'requestAnimationFrame');
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': dosVersiones() });
    renderApp('/planilla');
    expect(await screen.findAllByText('$ 72.000')).toHaveLength(2);
    const pedidosAntes = cuadros.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event(EVENTO_ENVIADOS));
    });
    expect(await screen.findAllByText('$ 102.000')).toHaveLength(2);
    expect(cuadros.mock.calls.length).toBe(pedidosAntes);
  });

  it('registrar sigue funcionando igual: el talón aparece con su tilde y el resumen al pie', async () => {
    preferencia(true);
    apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/servicios': { status: 200, body: catalogoBuddys() },
      'POST /api/admin/lavados': { status: 201, body: registrado({ trabajador: { id: BETO_ID, nombre: 'Beto' } }) },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: 'SUV' }));
    await user.click(screen.getByRole('checkbox', { name: /Nivel I\b(?!I)/ }));
    expect(screen.getByText('1 servicio')).toBeInTheDocument();
    expect(screen.getByLabelText('Cuánto se cobró')).toHaveValue('30.000');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    const talon = await screen.findByRole('status');
    expect(talon).toHaveTextContent('Lavado registrado');
    expect(talon.querySelector('.talon-tilde')).not.toBeNull();
  });
});

describe('con movimiento', () => {
  it('un total que cambia cuenta hasta el valor nuevo y termina exacto', async () => {
    preferencia(false);
    // Cuadros "de mentira" cada 16 ms (jsdom no dibuja).
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': dosVersiones() });
    renderApp('/planilla');
    // Al abrir no cuenta desde cero: el primer dibujo ya es el valor.
    expect(await screen.findAllByText('$ 72.000')).toHaveLength(2);

    act(() => {
      window.dispatchEvent(new Event(EVENTO_ENVIADOS));
    });
    expect(await screen.findAllByText('$ 102.000', undefined, { timeout: 2000 })).toHaveLength(2);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
