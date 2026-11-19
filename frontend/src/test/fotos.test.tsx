import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hoy } from '../lib/format';
import { olvidarDisponibilidadFotos } from '../lib/fotosDisponibles';
import { apiFalsa } from './apiFalsa';
import { planillaAdmin, planillaEmpleado, registrado, BETO_ID } from './fixtures';
import { fotoSubida, fotosLista, sesion } from './fixtures-mejoras';
import { renderApp } from './render';


// En jsdom no hay canvas: la foto "achicada" es un blob chico.
vi.mock('../lib/achicarFoto', () => ({
  achicarFoto: vi.fn(() => Promise.resolve({ blob: new Blob(['x'.repeat(1000)], { type: 'image/webp' }), tipo: 'image/webp' })),
}));

const ID = 'l1';
const RUTA = `/api/admin/lavados/${ID}/fotos`;
const subida = fotoSubida();
const PUT_FIRMADO = `PUT ${new URL(subida.subida.url).pathname}`;
const CONFIRMAR = `POST ${RUTA}/${subida.foto.id}/confirmar`;
const foto = () => new File(['foto'], 'foto.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  olvidarDisponibilidadFotos();
});

describe('Fotos antes/después', () => {
  it('desde la planilla: sacar una foto la pide, la sube a la URL firmada y la confirma', async () => {
    const lista = fotosLista();
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
      [`GET ${RUTA}`]: { status: 200, body: { ...lista, fotos: lista.fotos.slice(0, 1) } },
      [`GET /api/admin/lavados/l2/fotos`]: { status: 200, body: { disponible: true, fotos: [] } },
      [`GET /api/admin/lavados/l3/fotos`]: { status: 200, body: { disponible: true, fotos: [] } },
      [`POST ${RUTA}`]: { status: 201, body: subida },
      [PUT_FIRMADO]: { status: 200, body: {} },
      [CONFIRMAR]: { status: 200, body: { foto: subida.foto } },
    });
    const { user } = renderApp('/planilla');
    const [fotos] = await screen.findAllByRole('button', { name: 'Fotos' }, { timeout: 4000 });
    await user.click(fotos as HTMLElement);
    const seccion = await screen.findByRole('region', { name: /Fotos/ });
    expect(within(seccion).getByRole('img', { name: /Foto de antes/ })).toHaveAttribute('src', lista.fotos[0]?.url);
    await user.upload(within(seccion).getByLabelText('Foto de antes'), foto());

    await vi.waitFor(() => {
      expect(api.de('POST', `${RUTA}/${subida.foto.id}/confirmar`)).toHaveLength(1);
    });
    expect(api.de('POST', RUTA)[0]?.body).toEqual({ tipo: 'antes', contentType: 'image/webp', tamano: 1000 });
    const put = api.pedidos.find((p) => p.method === 'PUT');
    expect(put?.headers).toEqual(subida.subida.headers);
  });

  it('si la subida falla ofrece reintentar, y al reintentar no vuelve a pedir otra URL', async () => {
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: { ...planillaAdmin(hoy()), lavados: planillaAdmin(hoy()).lavados.slice(0, 1) } },
      [`GET ${RUTA}`]: { status: 200, body: { disponible: true, fotos: [] } },
      [`POST ${RUTA}`]: { status: 201, body: subida },
      [PUT_FIRMADO]: [{ status: 500, body: {} }, { status: 200, body: {} }],
      [CONFIRMAR]: { status: 200, body: { foto: subida.foto } },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Fotos' }, { timeout: 4000 }));
    await user.upload(await screen.findByLabelText('Foto de después'), foto());
    expect(await screen.findByText('No pudimos subir la foto. Probá de nuevo en un rato.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await vi.waitFor(() => {
      expect(api.de('POST', `${RUTA}/${subida.foto.id}/confirmar`)).toHaveLength(1);
    });
    expect(api.de('POST', RUTA).filter((p) => !p.path.includes('confirmar'))).toHaveLength(1);
  });

  it('demasiadas fotos seguidas (429) lo dice claro', async () => {
    apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: { ...planillaAdmin(hoy()), lavados: planillaAdmin(hoy()).lavados.slice(0, 1) } },
      [`GET ${RUTA}`]: { status: 200, body: { disponible: true, fotos: [] } },
      [`POST ${RUTA}`]: { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Demasiados pedidos.' } } },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Fotos' }, { timeout: 4000 }));
    await user.upload(await screen.findByLabelText('Foto de antes'), foto());
    expect(await screen.findByText(/Se subieron muchas fotos seguidas/)).toBeInTheDocument();
  });

  it('si la subida venció no ofrece reintentar (hay que sacarla de nuevo)', async () => {
    apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: { ...planillaAdmin(hoy()), lavados: planillaAdmin(hoy()).lavados.slice(0, 1) } },
      [`GET ${RUTA}`]: { status: 200, body: { disponible: true, fotos: [] } },
      [`POST ${RUTA}`]: { status: 201, body: subida },
      [PUT_FIRMADO]: { status: 200, body: {} },
      [CONFIRMAR]: { status: 409, body: { error: { code: 'CONFLICT', message: 'La subida venció: pedí otra.' } } },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Fotos' }, { timeout: 4000 }));
    await user.upload(await screen.findByLabelText('Foto de antes'), foto());
    expect(await screen.findByText('La subida venció: pedí otra.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(screen.getByLabelText('Foto de antes')).toBeInTheDocument();
  });

  it('con las fotos apagadas en el servidor no aparece el botón', async () => {
    apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
      [`GET ${RUTA}`]: { status: 200, body: { disponible: false, fotos: [] } },
    });
    renderApp('/planilla');
    await screen.findAllByRole('button', { name: 'Corregir' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Fotos' })).toBeNull();
  });

  it('con 6 fotos no deja sacar otra; el empleado solo borra la suya reciente', async () => {
    const lista = fotosLista();
    const base = lista.fotos[0];
    if (!base) throw new Error('sin foto');
    // Seis: una de Beto recién subida; el resto, de Ana y de antes.
    lista.fotos = Array.from({ length: 6 }, (_, i) =>
      i === 0
        ? { ...base, id: 'f0', creadaPor: { id: BETO_ID, nombre: 'Beto' }, createdAt: new Date().toISOString() }
        : { ...base, id: 'f' + String(i), creadaPor: { id: 'ana', nombre: 'Ana' } },
    );
    apiFalsa({
      ...sesion('empleado'),
      'GET /api/admin/lavados': { status: 200, body: { ...planillaEmpleado(hoy()), lavados: planillaEmpleado(hoy()).lavados.slice(0, 1) } },
      [`GET ${RUTA}`]: { status: 200, body: lista },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Fotos' }, { timeout: 4000 }));
    expect(await screen.findByText('Ya hay 6 fotos: borrá una para sacar otra.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Foto de antes')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Borrar foto/ })).toHaveLength(1);
  });

  it('en el talón, las fotos son opcionales', async () => {
    const r = registrado({ id: ID });
    apiFalsa({
      ...sesion('superadmin'),
      'POST /api/admin/lavados': { status: 201, body: r },
      [`GET ${RUTA}`]: { status: 200, body: { disponible: true, fotos: [] } },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await user.click(await screen.findByRole('button', { name: 'Fotos' }, { timeout: 4000 }));
    expect(await screen.findByLabelText('Foto de antes')).toHaveAttribute('capture', 'environment');
  });
});
