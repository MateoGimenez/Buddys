import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fx } from './fixtures';
import { apiFalsa } from './apiFalsa';
import { insumosAdmin, movimientosAutomaticos, recetaGet, recetaPut, resp, sesionMejoras } from './fixtures-finanzas';
import { renderApp } from './render';

const lista = () => ({ ...insumosAdmin(), total: 2, bajoStock: 0, valorTotal: 15150 });
const SHAMPOO = '00000000-0000-4000-8000-000000000012';

async function servicio(user: ReturnType<typeof renderApp>['user'], nombre: RegExp) {
  const recetas = (await screen.findByRole('heading', { name: 'Qué usa cada servicio' })).closest('section') as HTMLElement;
  await user.click(await within(recetas).findByRole('button', { name: nombre }));
  return recetas;
}

// Formularios largos con user-event: con la máquina cargada pasan de los 5 s por defecto.
describe('Insumos que se descuentan solos', { timeout: 20_000 }, () => {
  it('muestra lo que usa un servicio, por vehículo', async () => {
    apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/insumos': { status: 200, body: lista() },
      'GET /api/admin/servicios/lavado-basico/insumos': { status: 200, body: recetaGet() },
    });
    const { user } = renderApp('/insumos');
    const recetas = await servicio(user, /Lavado Básico/);
    expect(await within(recetas).findByText(/0,25 litros por auto \(SUV 0,4\)/)).toBeInTheDocument();
  });

  it('el encargado arma la receta y la guarda con PUT', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/insumos': { status: 200, body: lista() },
      'GET /api/admin/servicios/lavado-basico/insumos': { status: 200, body: { servicioId: 'lavado-basico', insumos: [] } },
      'PUT /api/admin/servicios/lavado-basico/insumos': { status: 200, body: recetaPut() },
    });
    const { user } = renderApp('/insumos');
    const recetas = await servicio(user, /Lavado Básico/);
    await user.click(await within(recetas).findByRole('button', { name: 'Agregar insumos' }));
    await user.click(within(recetas).getByRole('button', { name: 'Agregar insumo' }));
    const form = within(recetas).getByRole('form', { name: 'Lo que usa Lavado Básico' });
    await user.selectOptions(within(form).getByLabelText('Insumo'), 'Shampoo ph neutro');
    await user.type(within(form).getByLabelText(/Cuánto por auto/), '0,25');
    await user.click(within(form).getByText('Distinto según el vehículo'));
    await user.type(within(form).getByLabelText('SUV'), '0,4');
    await user.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await within(recetas).findByText('Guardado: desde ahora se descuenta solo.')).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/servicios/lavado-basico/insumos')[0]?.body).toEqual({
      insumos: [{ insumoId: SHAMPOO, cantidad: 0.25, cantidadSuv: 0.4, cantidadPickup: null, cantidadMoto: null }],
    });
  });

  it('el empleado ve la receta pero no la puede cambiar', async () => {
    apiFalsa({
      ...sesionMejoras('empleado'),
      'GET /api/admin/insumos': { status: 200, body: fx.insumosEmpleado?.body ?? lista() },
      'GET /api/admin/servicios/lavado-basico/insumos': { status: 200, body: recetaGet() },
    });
    const { user } = renderApp('/insumos');
    const recetas = await servicio(user, /Lavado Básico/);
    await within(recetas).findByText(/0,25 litros/);
    expect(within(recetas).queryByRole('button', { name: /Cambiar lo que usa|Agregar insumos/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambiar mínimo' })).toBeNull();
  });

  it('los movimientos automáticos llevan su marca', async () => {
    apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/insumos': { status: 200, body: lista() },
      [`GET /api/admin/insumos/${SHAMPOO}/movimientos`]: { status: 200, body: movimientosAutomaticos() },
    });
    const { user } = renderApp('/insumos');
    const fila = (await screen.findByRole('heading', { name: 'Shampoo ph neutro' })).closest('li') as HTMLElement;
    await user.click(within(fila).getByRole('button', { name: 'Movimientos' }));
    const movs = await within(fila).findByRole('list', { name: 'Movimientos de Shampoo ph neutro' });
    const [auto, manual] = within(movs).getAllByRole('listitem');
    expect(auto).toHaveTextContent('UsoAutomático');
    expect(auto).toHaveTextContent('−0,25 litros');
    expect(auto).toHaveTextContent('Descuento automático del lavado');
    expect(manual).not.toHaveTextContent('Automático');
  });

  it('cambiar el stock mínimo manda PATCH con stockMinimo', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/insumos': { status: 200, body: lista() },
      [`PATCH /api/admin/insumos/${SHAMPOO}`]: resp('insumoPatch'),
    });
    const { user } = renderApp('/insumos');
    const fila = (await screen.findByRole('heading', { name: 'Shampoo ph neutro' })).closest('li') as HTMLElement;
    await user.click(within(fila).getByRole('button', { name: 'Cambiar mínimo' }));
    const campo = within(fila).getByLabelText('Avisar cuando queden (litros)');
    await user.clear(campo);
    await user.type(campo, '1,5');
    await user.click(within(fila).getByRole('button', { name: 'Guardar mínimo' }));
    expect(await within(fila).findByText('Avisa cuando queden 1,5 litros.')).toBeInTheDocument();
    expect(api.de('PATCH', `/api/admin/insumos/${SHAMPOO}`)[0]?.body).toEqual({ stockMinimo: 1.5 });
  });
});
