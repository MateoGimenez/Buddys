import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fx } from './fixtures';
import { apiFalsa } from './apiFalsa';
import { gastoFijoCreado, gastosFijosLista, resp, sesionMejoras } from './fixtures-finanzas';
import { renderApp } from './render';

const gastosVacio = { status: 200, body: { gastos: [], total: 0, suma: 0 } };

async function seccionFijos() {
  return (await screen.findByRole('heading', { name: 'Gastos fijos' })).closest('section') as HTMLElement;
}

// Formularios largos con user-event: con la máquina cargada pasan de los 5 s por defecto.
describe('Gastos fijos mensuales', { timeout: 20_000 }, () => {
  it('el superadmin ve la lista, el total por mes y que cuentan el día 1', async () => {
    apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/gastos': gastosVacio,
      'GET /api/admin/gastos-fijos': { status: 200, body: gastosFijosLista() },
    });
    renderApp('/gastos');
    const fijos = await seccionFijos();
    expect(await within(fijos).findByText('$ 450.000')).toBeInTheDocument();
    expect(fijos).toHaveTextContent('el día 1 de cada mes');
    expect(within(fijos).getByText('Sueldo de Beto')).toBeInTheDocument();
    expect(fijos).toHaveTextContent('Sueldos · Beto · Desde octubre de 2026, todos los meses');
    expect(within(fijos).getAllByRole('button', { name: 'Editar' })).toHaveLength(2);
  });

  it('crea un gasto fijo de sueldo con POST', async () => {
    const api = apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/gastos': gastosVacio,
      'GET /api/admin/gastos-fijos': { status: 200, body: gastosFijosLista() },
      'POST /api/admin/gastos-fijos': { status: 201, body: gastoFijoCreado() },
    });
    const { user } = renderApp('/gastos');
    const fijos = await seccionFijos();
    await user.click(within(fijos).getByRole('button', { name: 'Nuevo gasto fijo' }));
    const form = within(fijos).getByRole('form', { name: 'Nuevo gasto fijo' });
    await user.type(within(form).getByLabelText('Qué es'), 'Sueldo de Beto');
    await user.type(within(form).getByLabelText('Monto por mes'), '300000');
    await user.selectOptions(within(form).getByLabelText('De quién es el sueldo (opcional)'), 'Beto');
    await user.click(within(form).getByRole('button', { name: 'Guardar gasto fijo' }));
    await within(fijos).findByRole('button', { name: 'Nuevo gasto fijo' });
    const [post] = api.de('POST', '/api/admin/gastos-fijos');
    expect(post?.body).toMatchObject({ concepto: 'Sueldo de Beto', monto: 300000, categoria: 'sueldos', perfilId: expect.any(String) as string });
    expect((post?.body as { desde: string }).desde).toMatch(/^\d{4}-\d{2}$/);
  });

  it('al cambiar el monto avisa que cambia todos los meses, y "Dejar de contar" manda activo: false', async () => {
    const api = apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/gastos': gastosVacio,
      'GET /api/admin/gastos-fijos': { status: 200, body: gastosFijosLista() },
      'PATCH /api/admin/gastos-fijos/00000000-0000-4000-8000-000000000032': resp('gastoFijoDesactiva'),
    });
    const { user } = renderApp('/gastos');
    const fijos = await seccionFijos();
    await within(fijos).findByText('Sueldo de Beto');
    await user.click(within(fijos).getAllByRole('button', { name: 'Editar' })[1] as HTMLElement);
    const monto = within(fijos).getByLabelText('Monto por mes');
    await user.clear(monto);
    await user.type(monto, '350000');
    expect(within(fijos).getByText('El monto nuevo cambia todos los meses')).toBeInTheDocument();
    await user.click(within(fijos).getByRole('button', { name: 'Cancelar' }));

    await user.click(within(fijos).getAllByRole('button', { name: 'Dejar de contar' })[1] as HTMLElement);
    await within(fijos).findAllByRole('button', { name: 'Editar' });
    expect(api.de('PATCH', '/api/admin/gastos-fijos/').map((p) => p.body)).toEqual([{ activo: false }]);
  });

  it('el admin los ve pero no los puede cambiar', async () => {
    apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/gastos': gastosVacio,
      'GET /api/admin/gastos-fijos': { status: 200, body: gastosFijosLista() },
    });
    renderApp('/gastos');
    const fijos = await seccionFijos();
    await within(fijos).findByText('Alquiler del local');
    expect(within(fijos).queryByRole('button', { name: 'Nuevo gasto fijo' })).toBeNull();
    expect(within(fijos).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(fijos).queryByRole('button', { name: 'Borrar' })).toBeNull();
  });

  it('el empleado no llega a Gastos ni a los gastos fijos (ni se piden)', async () => {
    const api = apiFalsa({ ...sesionMejoras('empleado') });
    renderApp('/gastos');
    expect(await screen.findByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gastos fijos' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).queryByRole('link', { name: 'Gastos' })).toBeNull();
    expect(api.de('GET', '/api/admin/gastos-fijos')).toHaveLength(0);
    expect(api.de('GET', '/api/admin/gastos')).toHaveLength(0);
  });

  it('Números muestra la parte fija de los gastos del período', async () => {
    apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/estadisticas': fx.estadisticasConFijos as { status: number; body: unknown },
      'GET /api/admin/metas/actual': fx.metasActual as { status: number; body: unknown },
    });
    renderApp('/numeros');
    expect(await screen.findByText('De eso, fijos del mes')).toBeInTheDocument();
    expect(screen.getByText('De eso, fijos del mes').nextElementSibling).toHaveTextContent('$ 450.000');
    expect(screen.getByText('Descuentos hechos').nextElementSibling).toHaveTextContent('$ 1.000');
  });
});
