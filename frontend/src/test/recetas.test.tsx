import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Receta } from '../api/types';
import { apiFalsa, type Pedido } from './apiFalsa';
import {
  CERA_ID,
  PANOS_ID,
  SHAMPOO_ID,
  conStock,
  listaInsumos,
  permisosAdmin,
  permisosEmpleado,
  recetaBasico,
  serviciosAdmin,
  usuarioAdmin,
  usuarioEmpleado,
} from './fixtures';
import { renderApp } from './render';

function sesion(quien: 'admin' | 'empleado', extra: Record<string, unknown> = {}) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: quien === 'admin' ? usuarioAdmin : usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: conStock(quien === 'admin' ? permisosAdmin() : permisosEmpleado()) },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    'GET /api/admin/recetas': { status: 200, body: { recetas: [recetaBasico()] } },
    'GET /api/admin/insumos': { status: 200, body: listaInsumos() },
    'GET /api/admin/insumos/alertas': { status: 200, body: { bajoStock: 0, insumos: [] } },
    ...extra,
  } as Parameters<typeof apiFalsa>[0];
}

async function hojaDe(nombre: string): Promise<HTMLElement> {
  return (await screen.findByRole('heading', { name: nombre })).closest('li') as HTMLElement;
}

/** Responde el PUT con la receta que quedaría: la del pedido aplicada sobre la de Lavado Básico. */
function guardarComo(p: Pedido) {
  const body = p.body as { vehiculo: string | null; items: { insumoId: string; cantidad: number }[] };
  const nombres = Object.fromEntries(listaInsumos().insumos.map((i) => [i.id, i]));
  const renglones = body.items.map((it) => ({ insumoId: it.insumoId, nombre: nombres[it.insumoId]?.nombre ?? '?', unidad: nombres[it.insumoId]?.unidad ?? 'unidad', cantidad: it.cantidad }));
  const receta: Receta = recetaBasico();
  if (body.vehiculo === null) receta.general = renglones;
  else if (renglones.length) receta.porVehiculo = { ...receta.porVehiculo, [body.vehiculo]: renglones };
  else receta.porVehiculo = Object.fromEntries(Object.entries(receta.porVehiculo).filter(([k]) => k !== body.vehiculo));
  return { status: 200, body: { receta } };
}

describe('Receta de un servicio', () => {
  it('el encargado ve una pestaña general y una por vehículo que ofrece el servicio', async () => {
    apiFalsa(sesion('admin'));
    const { user } = renderApp('/servicios');
    const pulido = await hojaDe('Pulido');
    await user.click(within(pulido).getByRole('button', { name: 'Editar' }));
    const tabs = within(pulido).getAllByRole('tab').map((t) => t.textContent);
    // Pulido solo se ofrece para auto.
    expect(tabs).toEqual(['General', 'Auto']);

    const basico = await hojaDe('Lavado Básico');
    await user.click(within(basico).getByRole('button', { name: 'Editar' }));
    const nombres = within(basico).getAllByRole('tab').map((t) => t.firstChild?.textContent);
    expect(nombres).toEqual(['General', 'Auto', 'SUV', 'Pick-up', 'Moto']);
    expect(within(basico).getByRole('tab', { name: 'General, 2 insumos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('edita la receta general y guarda solo esa variante', async () => {
    const api = apiFalsa(sesion('admin', { 'PUT /api/admin/servicios/lavado-basico/receta': guardarComo }));
    const { user } = renderApp('/servicios');
    const basico = await hojaDe('Lavado Básico');
    await user.click(within(basico).getByRole('button', { name: 'Editar' }));

    const general = within(basico).getByRole('tabpanel', { name: /^General/ });
    // El orden del backend (por nombre): cera y después shampoo.
    expect(within(general).getByLabelText('Insumo 1')).toHaveValue('Cera líquida');
    expect(within(general).getByLabelText('Insumo 2')).toHaveValue('Shampoo');
    expect(within(general).getByLabelText('Cantidad (litros)')).toHaveValue('0,05');
    const cera = within(general).getByLabelText('Cantidad (ml)');
    await user.clear(cera);
    await user.type(cera, '40');

    await user.click(within(general).getByRole('button', { name: 'Agregar insumo' }));
    // Se busca sin acentos ni mayúsculas, como en el selector.
    await user.type(within(general).getByLabelText('Insumo 3'), 'paños de microfibra');
    expect(within(general).getByLabelText('Cantidad (unidades)')).toBeInTheDocument();
    await user.type(within(general).getByLabelText('Cantidad (unidades)'), '2');
    expect(within(basico).getByRole('tab', { name: /^General.*sin guardar/ })).toBeInTheDocument();

    await user.click(within(general).getByRole('button', { name: 'Guardar la receta general' }));
    await waitFor(() => { expect(api.de('PUT', '/api/admin/servicios/lavado-basico/receta')).toHaveLength(1); });
    expect(api.de('PUT', '/api/admin/servicios/lavado-basico/receta')[0]?.body).toEqual({
      vehiculo: null,
      items: [
        { insumoId: CERA_ID, cantidad: 40 },
        { insumoId: SHAMPOO_ID, cantidad: 0.05 },
        { insumoId: PANOS_ID, cantidad: 2 },
      ],
    });
    expect(await within(general).findByText('Receta guardada.')).toBeInTheDocument();
    expect(within(basico).getByRole('tab', { name: 'General, 3 insumos' })).toBeInTheDocument();
  });

  it('cada vehículo se guarda aparte; vaciar la variante la borra (items: [])', async () => {
    const api = apiFalsa(sesion('admin', { 'PUT /api/admin/servicios/lavado-basico/receta': guardarComo }));
    const { user } = renderApp('/servicios');
    const basico = await hojaDe('Lavado Básico');
    await user.click(within(basico).getByRole('button', { name: 'Editar' }));

    // Con el teclado: de General a Pick-up con las flechas (la selección sigue al foco).
    within(basico).getByRole('tab', { name: /^General/ }).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    const tab = within(basico).getByRole('tab', { name: /^Pick-up/ });
    expect(tab).toHaveFocus();
    expect(tab).toHaveAttribute('aria-selected', 'true');

    const pickup = within(basico).getByRole('tabpanel', { name: /^Pick-up/ });
    expect(within(pickup).getByLabelText('Cantidad (litros)')).toHaveValue('0,08');
    await user.click(within(pickup).getByRole('button', { name: 'Quitar Shampoo' }));
    await user.click(within(pickup).getByRole('button', { name: 'Quitar Cera líquida' }));
    expect(within(pickup).getByText('Sin receta propia: Pick-up usa la general.')).toBeInTheDocument();
    await user.click(within(pickup).getByRole('button', { name: 'Borrar la receta de Pick-up' }));

    await waitFor(() => { expect(api.de('PUT', '/api/admin/servicios/lavado-basico/receta')).toHaveLength(1); });
    expect(api.de('PUT', '/api/admin/servicios/lavado-basico/receta')[0]?.body).toEqual({ vehiculo: 'pickup', items: [] });
  });

  it('no manda nada con un insumo que no está en la lista o repetido', async () => {
    const api = apiFalsa(sesion('admin'));
    const { user } = renderApp('/servicios');
    const basico = await hojaDe('Lavado Básico');
    await user.click(within(basico).getByRole('button', { name: 'Editar' }));
    const general = within(basico).getByRole('tabpanel', { name: /^General/ });

    await user.click(within(general).getByRole('button', { name: 'Agregar insumo' }));
    await user.type(within(general).getByLabelText('Insumo 3'), 'Silicona');
    await user.type(within(general).getAllByLabelText(/^Cantidad/)[2] as HTMLElement, '1');
    await user.click(within(general).getByRole('button', { name: 'Agregar insumo' }));
    await user.type(within(general).getByLabelText('Insumo 4'), 'Shampoo');
    await user.type(within(general).getAllByLabelText(/^Cantidad/)[3] as HTMLElement, '0,1');
    await user.click(within(general).getByRole('button', { name: 'Guardar la receta general' }));

    expect(within(general).getByText('Elegí un insumo de la lista.')).toBeInTheDocument();
    expect(within(general).getByText('Ese insumo ya está más arriba: sumá la cantidad ahí.')).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/servicios')).toHaveLength(0);
  });

  it('muestra el error del backend en el renglón que corresponde', async () => {
    apiFalsa(
      sesion('admin', {
        'PUT /api/admin/servicios/lavado-basico/receta': {
          status: 400,
          body: { error: { code: 'VALIDATION', message: 'Revisá los datos.', fields: { 'items.1.insumoId': 'Ese insumo no existe o está inactivo.' } } },
        },
      }),
    );
    const { user } = renderApp('/servicios');
    const basico = await hojaDe('Lavado Básico');
    await user.click(within(basico).getByRole('button', { name: 'Editar' }));
    const general = within(basico).getByRole('tabpanel', { name: /^General/ });
    await user.click(within(general).getByRole('button', { name: 'Guardar la receta general' }));

    const error = await within(general).findByText('Ese insumo no existe o está inactivo.');
    // items.1 es el segundo renglón: el shampoo.
    expect(within(general).getByLabelText('Insumo 2')).toHaveAttribute('aria-invalid', 'true');
    expect(within(general).getByLabelText('Insumo 1')).not.toHaveAttribute('aria-invalid');
    expect(error).toBeInTheDocument();
  });

  it('antes de cerrar la edición con la receta sin guardar, pregunta', async () => {
    const api = apiFalsa(sesion('admin'));
    const { user } = renderApp('/servicios');
    const basico = await hojaDe('Lavado Básico');
    await user.click(within(basico).getByRole('button', { name: 'Editar' }));
    const general = within(basico).getByRole('tabpanel', { name: /^General/ });
    await user.click(within(general).getByRole('button', { name: 'Quitar Cera líquida' }));

    await user.click(within(basico).getByRole('button', { name: 'Cancelar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'La receta tiene cambios sin guardar' });
    // Seguir editando: no se pierde nada.
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(within(general).queryByLabelText('Insumo 2')).toBeNull();
    expect(within(basico).getByRole('tab', { name: /^General.*sin guardar/ })).toBeInTheDocument();

    await user.click(within(basico).getByRole('button', { name: 'Cancelar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cerrar sin guardarlos' }));
    expect(within(basico).queryByRole('button', { name: 'Guardar la receta general' })).toBeNull();
    expect(within(basico).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/servicios')).toHaveLength(0);
  });

  it('al encargado le marca los servicios sin receta', async () => {
    apiFalsa(sesion('admin'));
    renderApp('/servicios');
    await hojaDe('Lavado Básico');
    const pulido = await hojaDe('Pulido');
    expect(pulido).toHaveTextContent('Sin receta: este servicio no descuenta insumos.');
    expect(await hojaDe('Lavado Básico')).not.toHaveTextContent('Sin receta');
  });

  it('el empleado ve la receta en solo lectura, sin costos ni forma de cambiarla', async () => {
    const api = apiFalsa(sesion('empleado'));
    const { user } = renderApp('/servicios');
    const basico = await hojaDe('Lavado Básico');
    expect(within(basico).queryByRole('button', { name: 'Editar' })).toBeNull();

    await user.click(within(basico).getByText('Receta'));
    const general = within(basico).getByRole('tabpanel', { name: /^General/ });
    expect(general).toHaveTextContent('Shampoo');
    expect(general).toHaveTextContent('30 ml');
    await user.click(within(basico).getByRole('tab', { name: /^Pick-up/ }));
    expect(within(basico).getByRole('tabpanel', { name: /^Pick-up/ })).toHaveTextContent('0,08 litros');
    await user.click(within(basico).getByRole('tab', { name: /^SUV/ }));
    expect(within(basico).getByRole('tabpanel', { name: /^SUV/ })).toHaveTextContent('Usa la general');

    expect(within(basico).queryByRole('textbox')).toBeNull();
    expect(basico).not.toHaveTextContent('$');
    // Ni la lista de insumos (con costos) se pide.
    expect(api.de('GET', '/api/admin/insumos')).toHaveLength(0);
  });
});
