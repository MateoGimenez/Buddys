import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { planillaAdmin, planillaEmpleado } from './fixtures';
import { lavadoConDescuento, patchDescuento, sesion } from './fixtures-mejoras';
import { renderApp } from './render';


describe('Descuentos', () => {
  it('en Registrar el monto sugerido resta el descuento, el motivo es obligatorio y va en el talón', async () => {
    const api = apiFalsa({
      ...sesion('superadmin'),
      'POST /api/admin/lavados': { status: 201, body: lavadoConDescuento() },
    });
    const { user } = renderApp('/registrar');
    // Lavado Básico de auto: $ 12.000 de lista.
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    expect(screen.getByLabelText('Cuánto se cobró')).toHaveValue('12.000');
    await user.click(screen.getByRole('button', { name: 'Agregar descuento' }));
    await user.type(screen.getByLabelText('Descuento'), '2000');
    expect(screen.getByLabelText('Cuánto se cobró')).toHaveValue('10.000');

    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    expect(await screen.findByText('Escribí el motivo del descuento.')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(0);

    await user.type(screen.getByLabelText('Motivo del descuento'), 'Cliente frecuente');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    expect(await screen.findByText('Lavado registrado')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toMatchObject({
      monto: 10000,
      descuento: 2000,
      descuentoMotivo: 'Cliente frecuente',
    });
    expect(screen.getByText(/descuento de \$ 2\.000 \(Cliente frecuente\)/)).toBeInTheDocument();
  });

  it('sin descuento no manda las claves', async () => {
    const api = apiFalsa({ ...sesion('superadmin'), 'POST /api/admin/lavados': { status: 201, body: lavadoConDescuento() } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    const body = api.de('POST', '/api/admin/lavados')[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('descuento');
    expect(body).not.toHaveProperty('descuentoMotivo');
  });

  it('en Corregir se carga el descuento con su motivo y se ve en la copia', async () => {
    const dia = planillaAdmin(hoy());
    const original = { ...dia.lavados[0], descuento: 0, descuentoMotivo: null } as (typeof dia.lavados)[number];
    dia.lavados = [original];
    const corregido = { ...patchDescuento().booking, id: original.id, fechaPreferida: hoy() };
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': [{ status: 200, body: dia }, { status: 200, body: { ...dia, lavados: [corregido] } }],
      [`PATCH /api/admin/bookings/${original.id}`]: { status: 200, body: { booking: corregido } },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Corregir' }));
    await user.type(screen.getByLabelText('Descuento'), '1000');
    await user.type(screen.getByLabelText('Motivo del descuento'), 'Promo');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/Descuento de \$ 1\.000/)).toHaveTextContent('Promo');
    expect(api.de('PATCH', `/api/admin/bookings/${original.id}`)[0]?.body).toEqual({ descuento: 1000, descuentoMotivo: 'Promo' });
  });

  it('el empleado no ve el descuento en ningún lado', async () => {
    const dia = planillaEmpleado(hoy());
    dia.lavados = dia.lavados.map((l) => ({ ...l, descuento: null, descuentoMotivo: null }));
    apiFalsa({ ...sesion('empleado'), 'GET /api/admin/lavados': { status: 200, body: dia } });
    const { user, unmount } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    expect(screen.queryByRole('button', { name: 'Agregar descuento' })).toBeNull();
    expect(screen.queryByLabelText('Descuento')).toBeNull();
    unmount();
    renderApp('/planilla');
    await screen.findAllByText(/N° 000/);
    expect(screen.queryByText(/Descuento/)).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent('$');
  });
});
