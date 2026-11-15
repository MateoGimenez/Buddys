import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { BETO_ID, errores, registrado, type RespuestaFalsa } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin, sesionEmpleado, unUuid } from './sesiones';

describe('Forma de pago al registrar', () => {
  it('se elige con una ficha, se saca tocándola de nuevo y viaja en el lavado', async () => {
    const api = apiFalsa({
      ...sesionAdmin(),
      'POST /api/admin/lavados': { status: 201, body: registrado({ servicioId: 'lavado-basico', formaPago: 'efectivo' }) },
    });
    const { user } = renderApp('/registrar');
    const pago = await screen.findByRole('group', { name: 'Cómo pagó' });
    // A la vista (no dentro de "Más datos") y sin elegir de entrada.
    expect(pago.closest('details')).toBeNull();
    const fichas = within(pago).getAllByRole('radio');
    expect(fichas).toHaveLength(5);
    for (const f of fichas) expect(f).not.toBeChecked();

    const transferencia = within(pago).getByRole('radio', { name: 'Transferencia' });
    await user.click(transferencia);
    expect(transferencia).toBeChecked();
    await user.click(transferencia);
    expect(transferencia).not.toBeChecked();

    await user.click(within(pago).getByRole('radio', { name: 'Efectivo' }));
    await user.click(screen.getByRole('checkbox', { name: /Lavado Básico/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    const talon = await screen.findByRole('status');
    expect(talon).toHaveTextContent('Lavado registrado');
    expect(talon).toHaveTextContent('Efectivo');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toMatchObject({ servicioIds: ['lavado-basico'], formaPago: 'efectivo' });
    // El formulario queda sin forma de pago para el próximo.
    expect(within(pago).getByRole('radio', { name: 'Efectivo' })).not.toBeChecked();
  });

  it('el empleado también la carga, y la ayuda de la nota ya no habla de la forma de pago', async () => {
    const api = apiFalsa({
      ...sesionEmpleado(),
      'POST /api/admin/lavados': {
        status: 201,
        body: registrado({ monto: null, formaPago: 'debito', trabajador: { id: BETO_ID, nombre: 'Beto' } }),
      },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Premium/ }));
    await user.click(screen.getByRole('radio', { name: 'Débito' }));
    expect(screen.getByLabelText('Nota')).not.toHaveAccessibleDescription(/forma de pago/i);
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    const talon = await screen.findByRole('status');
    expect(talon).toHaveTextContent('Débito');
    expect(talon).not.toHaveTextContent('$');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toEqual({
      servicioIds: ['lavado-premium'],
      vehiculoTipo: 'auto',
      monto: null,
      formaPago: 'debito',
      idLocal: unUuid(),
    });
  });
});

describe('Deshacer el lavado recién registrado', () => {
  async function registrarUno(rutas: Record<string, RespuestaFalsa>, opciones?: Parameters<typeof renderApp>[1]) {
    const api = apiFalsa({ ...sesionAdmin(), ...rutas });
    const { user } = renderApp('/registrar', opciones);
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    return { api, user };
  }

  it('borra el lavado con DELETE y el talón pasa a "Lavado borrado"', async () => {
    const { api, user } = await registrarUno({
      'POST /api/admin/lavados': { status: 201, body: registrado({ id: 'nuevo' }) },
      'DELETE /api/admin/lavados/nuevo': { status: 204 },
    });
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));

    expect(await screen.findByText('Lavado borrado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Ya no cuenta en la planilla.');
    const [del] = api.de('DELETE', '/api/admin/lavados/nuevo');
    expect(del?.headers['Content-Type']).toBe('application/json');
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveFocus();
    await user.click(cerrar);
    expect(screen.queryByText('Lavado borrado')).toBeNull();
  });

  it('un doble toque en "Deshacer" manda un solo DELETE', async () => {
    const { api } = await registrarUno({
      'POST /api/admin/lavados': { status: 201, body: registrado({ id: 'nuevo' }) },
      'DELETE /api/admin/lavados/nuevo': { status: 204 },
    });
    const boton = screen.getByRole('button', { name: 'Deshacer' });
    act(() => {
      boton.click();
      boton.click();
    });
    await screen.findByText('Lavado borrado');
    expect(api.de('DELETE', '/api/admin/lavados/nuevo')).toHaveLength(1);
  });

  it('si el backend dice que se venció el plazo, muestra su mensaje y ya no ofrece deshacer', async () => {
    const { user } = await registrarUno({
      'POST /api/admin/lavados': { status: 201, body: registrado({ id: 'nuevo' }) },
      'DELETE /api/admin/lavados/nuevo': errores.plazoVencido,
    });
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pasaron más de 5 minutos: pedile a un encargado que lo borre');
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
    expect(screen.getByText('Lavado registrado')).toBeInTheDocument();
  });

  it('si ya tiene comprobante (409), lo explica', async () => {
    const { user } = await registrarUno({
      'POST /api/admin/lavados': { status: 201, body: registrado({ id: 'nuevo' }) },
      'DELETE /api/admin/lavados/nuevo': errores.conComprobante,
    });
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya tiene un comprobante');
  });

  it('cuenta para atrás 10 segundos y después el botón desaparece', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await registrarUno(
        { 'POST /api/admin/lavados': { status: 201, body: registrado({ id: 'nuevo' }) } },
        { advanceTimers: vi.advanceTimersByTime },
      );
      const boton = screen.getByRole('button', { name: 'Deshacer' });
      expect(boton).toHaveTextContent(/Deshacer\s*(10|9) s/);
      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      expect(boton).toHaveTextContent(/Deshacer\s*[56] s/);
      act(() => {
        vi.advanceTimersByTime(6_500);
      });
      expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
      expect(screen.getByText('Lavado registrado')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el backend da menos tiempo que la pantalla, manda el plazo del backend', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await registrarUno(
        {
          'POST /api/admin/lavados': {
            status: 201,
            body: registrado({ id: 'nuevo' }, new Date(Date.now() + 3_000).toISOString()),
          },
        },
        { advanceTimers: vi.advanceTimersByTime },
      );
      expect(screen.getByRole('button', { name: 'Deshacer' })).toHaveTextContent(/Deshacer\s*[123] s/);
      act(() => {
        vi.advanceTimersByTime(3_500);
      });
      expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
