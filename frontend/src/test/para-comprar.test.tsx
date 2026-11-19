import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textoParaComprar } from '../lib/compras';
import { apiFalsa } from './apiFalsa';
import { SHAMPOO_ID, conStock, insumoStock, listaInsumos, listaInsumosEmpleado, paraComprar, permisosAdmin, permisosEmpleado, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';

/** El texto del contrato, al pie de la letra (con la fecha de hoy en La Rioja). */
const TEXTO = 'Para comprar — Buddys Wash Detail (17/11/2026)\n• Paños de microfibra: 10 unidades\n• Shampoo: 1,5 litros';

function sesion(quien: 'admin' | 'empleado', extra: Record<string, unknown> = {}) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: quien === 'admin' ? usuarioAdmin : usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: conStock(quien === 'admin' ? permisosAdmin() : permisosEmpleado()) },
    'GET /api/admin/insumos': { status: 200, body: quien === 'admin' ? listaInsumos() : listaInsumosEmpleado() },
    'GET /api/admin/insumos/para-comprar': { status: 200, body: paraComprar() },
    'GET /api/admin/insumos/alertas': { status: 200, body: { bajoStock: 2, insumos: [] } },
    ...extra,
  } as Parameters<typeof apiFalsa>[0];
}

beforeEach(() => {
  // Solo el reloj de fechas: hoy es 17/11/2026 en La Rioja (los timers siguen reales para user-event).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'share');
});

describe('Para comprar: el texto para el proveedor', () => {
  it('sale exactamente en el formato del contrato y sin precios', () => {
    expect(textoParaComprar(paraComprar().items, '2026-11-17')).toBe(TEXTO);
    expect(textoParaComprar([{ nombre: 'Cera', unidad: 'litro', sugerido: 1.5 }, { nombre: 'Guantes', unidad: 'par', sugerido: 1 }], '2026-11-03')).toBe(
      'Para comprar — Buddys Wash Detail (03/11/2026)\n• Cera: 1,5 litros\n• Guantes: 1 par',
    );
  });
});

describe('Para comprar', () => {
  it('lista lo bajo con el sugerido de cada uno, agrupado por categoría', async () => {
    apiFalsa(sesion('admin'));
    renderApp('/insumos?ver=comprar');
    expect(await screen.findByRole('heading', { name: 'Shampoo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Para comprar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Accesorios' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Químicos' })).toBeInTheDocument();
    const shampoo = screen.getByRole('heading', { name: 'Shampoo' }).closest('li') as HTMLElement;
    expect(shampoo).toHaveTextContent('Comprar 1,5 litros');
    expect(shampoo).toHaveTextContent('Hay 0,5 litros · mínimo 1');
    expect(screen.getByText('Mandar la lista')).toBeInTheDocument();
  });

  it('Copiar pone el texto en el portapapeles', async () => {
    apiFalsa(sesion('admin'));
    const { user } = renderApp('/insumos?ver=comprar');
    const copiar = await screen.findByRole('button', { name: 'Copiar' });
    const escribir = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(copiar);
    expect(escribir).toHaveBeenCalledWith(TEXTO);
    expect(await screen.findByText('Lista copiada. Pegala en el chat del proveedor.')).toBeInTheDocument();
  });

  it('si no se puede copiar, lo dice y deja ver el mensaje para copiarlo a mano', async () => {
    apiFalsa(sesion('admin'));
    const { user } = renderApp('/insumos?ver=comprar');
    const copiar = await screen.findByRole('button', { name: 'Copiar' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('No', 'NotAllowedError'));
    await user.click(copiar);
    expect(await screen.findByText('No se pudo copiar. Abrí “Ver el mensaje” y copialo a mano.')).toBeInTheDocument();
    expect(document.querySelector('.comprar-mensaje')?.textContent).toBe(TEXTO);
  });

  it('sin navigator.share, WhatsApp es un enlace a wa.me con el texto codificado', async () => {
    apiFalsa(sesion('admin'));
    renderApp('/insumos?ver=comprar');
    const enlace = await screen.findByRole('link', { name: 'Compartir por WhatsApp' });
    expect(enlace).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(TEXTO)}`);
    expect(enlace.getAttribute('href')).toBe(
      'https://wa.me/?text=Para%20comprar%20%E2%80%94%20Buddys%20Wash%20Detail%20(17%2F11%2F2026)%0A%E2%80%A2%20Pa%C3%B1os%20de%20microfibra%3A%2010%20unidades%0A%E2%80%A2%20Shampoo%3A%201%2C5%20litros',
    );
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('con navigator.share, comparte el mismo texto', async () => {
    const compartir = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: compartir, configurable: true });
    apiFalsa(sesion('admin'));
    const { user } = renderApp('/insumos?ver=comprar');
    await user.click(await screen.findByRole('button', { name: 'Compartir por WhatsApp' }));
    expect(compartir).toHaveBeenCalledWith({ text: TEXTO });
  });

  it('Cargar compra abre la carga existente con la cantidad sugerida', async () => {
    const api = apiFalsa(
      sesion('admin', {
        'GET /api/admin/insumos/para-comprar': [
          { status: 200, body: paraComprar() },
          { status: 200, body: { items: paraComprar().items.filter((i) => i.insumoId !== SHAMPOO_ID), costoTotalEstimado: 0 } },
        ],
        [`POST /api/admin/insumos/${SHAMPOO_ID}/movimientos`]: {
          status: 201,
          body: { insumo: insumoStock({ id: SHAMPOO_ID, nombre: 'Shampoo', unidad: 'litro', stock: 2, stockMinimo: 1 }) },
        },
      }),
    );
    const { user } = renderApp('/insumos?ver=comprar');
    const shampoo = (await screen.findByRole('heading', { name: 'Shampoo' })).closest('li') as HTMLElement;
    await user.click(within(shampoo).getByRole('button', { name: 'Cargar compra de Shampoo' }));
    const campo = within(shampoo).getByLabelText('Cuánto se compró (litros)');
    expect(campo).toHaveValue('1,5');
    await user.type(within(shampoo).getByLabelText('Costo total (opcional)'), '18000');
    await user.click(within(shampoo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => { expect(api.de('POST', `/api/admin/insumos/${SHAMPOO_ID}/movimientos`)).toHaveLength(1); });
    expect(api.de('POST', `/api/admin/insumos/${SHAMPOO_ID}/movimientos`)[0]?.body).toEqual({ tipo: 'compra', cantidad: 1.5, costoTotal: 18000 });
    expect(await screen.findByText('Compra anotada: +1,5 litros de Shampoo.')).toBeInTheDocument();
    // La lista se vuelve a pedir: el shampoo ya no está bajo.
    await waitFor(() => { expect(screen.queryByRole('heading', { name: 'Shampoo' })).toBeNull(); });
    expect(screen.getByRole('heading', { name: 'Paños de microfibra' })).toBeInTheDocument();
    expect(api.de('GET', '/api/admin/insumos/para-comprar')).toHaveLength(2);
  });

  it('el costo estimado es el total del backend; si ningún insumo tiene costo (total 0) no muestra "$ 0"', async () => {
    apiFalsa(sesion('admin'));
    const { unmount } = renderApp('/insumos?ver=comprar');
    expect((await screen.findByText('Costo estimado')).parentElement).toHaveTextContent('Costo estimado $ 13.500');
    unmount();

    const sinCostos = { items: paraComprar().items.map((i) => ({ ...i, costoEstimado: null })), costoTotalEstimado: 0 };
    apiFalsa(sesion('admin', { 'GET /api/admin/insumos/para-comprar': { status: 200, body: sinCostos } }));
    renderApp('/insumos?ver=comprar');
    expect(await screen.findByRole('button', { name: 'Copiar' })).toBeInTheDocument();
    expect(screen.queryByText('Costo estimado')).toBeNull();
  });

  it('sin nada bajo, lo dice y no ofrece mandar una lista vacía', async () => {
    apiFalsa(sesion('admin', { 'GET /api/admin/insumos/para-comprar': { status: 200, body: { items: [], costoTotalEstimado: 0 } } }));
    renderApp('/insumos?ver=comprar');
    expect(await screen.findByText('No falta nada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copiar' })).toBeNull();
  });

  it('el empleado no tiene las vistas: con ?ver=comprar ve el stock y no se pide la lista', async () => {
    const api = apiFalsa(sesion('empleado'));
    renderApp('/insumos?ver=comprar');
    expect(await screen.findByRole('heading', { name: 'Cera líquida' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Vistas de insumos' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver qué comprar' })).toBeNull();
    expect(api.de('GET', '/api/admin/insumos/para-comprar')).toHaveLength(0);
  });
});
