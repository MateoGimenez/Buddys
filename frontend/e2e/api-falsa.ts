// La API del panel, falsa y con memoria, para las pruebas de punta a punta. Cada respuesta sale de las respuestas
// reales que usan los tests de unidad (src/test/respuestas-reales.json y el contrato del backend, vía
// src/test/fixtures.ts): acá solo se guarda el estado (sesión y lavados del día) entre pedidos.
import type { Page, Route } from '@playwright/test';
import type { FormaPago, NuevoLavado, PlanillaDelDia, ResumenFormaPago, Turno, Usuario } from '../src/api/types';
import { lavado, permisosAdmin, permisosEmpleado, real, serviciosAdmin, trabajadores } from '../src/test/fixtures';

type Quien = 'admin' | 'empleado';

export interface ApiFalsa {
  lavados: Turno[];
  pedidos: { metodo: string; ruta: string; cuerpo: unknown }[];
  /** Perfil de quien entró (contrato 2026-11-16): nombre y foto cambian con PATCH y la subida en tres pasos. */
  perfil: { nombre: string | null; avatarUrl: string | null; subida: 'nada' | 'pedida' | 'subida'; clave: string };
  /** Cuántas subidas a Storage fallan antes de andar (para probar Reintentar). */
  fallasDeSubida: number;
}

/** Storage falso: la URL de subida y la foto que se ve (un SVG, para no depender de archivos). */
export const STORAGE = 'https://storage.test';
const FOTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2742b8"/><circle cx="20" cy="15" r="7" fill="#fff3c2"/><rect x="8" y="25" width="24" height="15" rx="7" fill="#fff3c2"/></svg>';

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });

function respuestaReal(clave: string) {
  const r = real[clave];
  if (!r) throw new Error(`Falta la respuesta real ${clave}`);
  return r;
}

/** Lo que muestra la planilla, armado como el backend: para el empleado, sin ningún importe. */
function planilla(fecha: string, todos: Turno[], quien: Quien): PlanillaDelDia {
  const delDia = todos.filter((l) => l.fechaPreferida === fecha);
  const conImportes = quien === 'admin';
  const porForma = new Map<FormaPago | null, ResumenFormaPago>();
  for (const l of delDia) {
    const f = porForma.get(l.formaPago) ?? { formaPago: l.formaPago, cantidad: 0, total: conImportes ? 0 : null };
    f.cantidad++;
    if (f.total !== null) f.total += l.monto ?? 0;
    porForma.set(l.formaPago, f);
  }
  return {
    fecha,
    lavados: delDia.map((l) => (conImportes ? l : { ...l, monto: null })),
    resumen: {
      cantidad: delDia.length,
      total: conImportes ? delDia.reduce((a, l) => a + (l.monto ?? 0), 0) : null,
      sinMonto: delDia.filter((l) => l.monto === null).length,
      porFormaPago: [...porForma.values()].sort((a, b) => (b.total ?? b.cantidad) - (a.total ?? a.cantidad)),
    },
  };
}

function hoyEnLaRioja(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/La_Rioja' }).format(new Date());
}

/** Instala la API falsa en la página. Arranca sin sesión (pantalla de ingreso). */
export async function apiFalsa(page: Page): Promise<ApiFalsa> {
  let quien: Quien | null = null;
  const estado: ApiFalsa = {
    lavados: [],
    pedidos: [],
    perfil: { nombre: null, avatarUrl: null, subida: 'nada', clave: 'una-clave-cualquiera' },
    fallasDeSubida: 0,
  };
  const catalogo = serviciosAdmin().servicios;
  const vence = () => new Date(Date.now() + 60 * 60_000).toISOString();
  const usuarioReal = () => (quien === 'empleado' ? respuestaReal('meEmpleado') : respuestaReal('meAdmin'));
  /** /me y el login con el nombre y la foto del perfil falso. */
  const usuario = () => {
    const r = usuarioReal();
    const u = (r.body as { usuario: Usuario }).usuario;
    return {
      ...r,
      body: {
        usuario: {
          ...u,
          nombre: estado.perfil.nombre ?? u.nombre,
          avatarUrl: estado.perfil.avatarUrl,
          avatarVenceEl: estado.perfil.avatarUrl ? vence() : null,
        },
      },
    };
  };
  const perfil = () => {
    const u = usuario().body.usuario;
    return { perfil: { ...u, creadoEl: '2026-10-01T12:00:00.000Z' } };
  };

  await page.route(`${STORAGE}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      if (estado.fallasDeSubida > 0) {
        estado.fallasDeSubida--;
        return route.fulfill({ status: 500, body: 'error' });
      }
      estado.perfil.subida = 'subida';
      return route.fulfill({ status: 200, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: FOTO_SVG });
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();
    const ruta = url.pathname;
    const cuerpo: unknown = req.postData() ? req.postDataJSON() : undefined;
    estado.pedidos.push({ metodo, ruta, cuerpo });

    if (ruta === '/api/auth/login' && metodo === 'POST') {
      const { email } = cuerpo as { email: string };
      quien = email.startsWith('beto') ? 'empleado' : 'admin';
      return json(route, 200, usuario().body);
    }
    if (ruta === '/api/auth/refresh') {
      return quien ? json(route, 200, usuario().body) : json(route, 401, respuestaReal('refreshSinSesion').body);
    }
    if (ruta === '/api/auth/logout') {
      quien = null;
      return route.fulfill({ status: 204 });
    }
    if (!quien) return json(route, 401, respuestaReal('meSinSesion').body);
    if (ruta === '/api/auth/me') return json(route, 200, usuario().body);
    if (ruta === '/api/admin/permisos') return json(route, 200, quien === 'admin' ? permisosAdmin() : permisosEmpleado());
    if (ruta === '/api/admin/servicios' && metodo === 'GET') return json(route, 200, { servicios: catalogo });
    if (ruta === '/api/admin/trabajadores') {
      return quien === 'admin' ? json(route, 200, trabajadores()) : json(route, 403, respuestaReal('trabajadoresEmpleado').body);
    }
    if (ruta === '/api/admin/lavados' && metodo === 'GET') {
      return json(route, 200, planilla(url.searchParams.get('fecha') ?? hoyEnLaRioja(), estado.lavados, quien));
    }
    if (ruta === '/api/admin/lavados' && metodo === 'POST') {
      const datos = cuerpo as NuevoLavado & { idLocal: string; fecha?: string };
      const yaEsta = estado.lavados.find((l) => l.id === datos.idLocal);
      const persona = (usuario().body as { usuario: { id: string; nombre: string } }).usuario;
      const nuevo =
        yaEsta ??
        lavado({
          id: datos.idLocal,
          servicios: datos.servicioIds.map((id) => ({ id, nombre: catalogo.find((x) => x.id === id)?.nombre ?? id, precioLista: null })),
          vehiculoTipo: datos.vehiculoTipo,
          vehiculoModelo: datos.vehiculoModelo ?? null,
          monto: datos.monto ?? null,
          formaPago: datos.formaPago ?? null,
          etapa: datos.etapa ?? 'entregado',
          franja: datos.franja ?? 'manana',
          fechaPreferida: datos.fecha ?? hoyEnLaRioja(),
          trabajador: { id: datos.trabajadorId ?? persona.id, nombre: persona.nombre },
          createdAt: new Date().toISOString(),
        });
      if (!yaEsta) estado.lavados.push(nuevo);
      return json(route, yaEsta ? 200 : 201, {
        lavado: quien === 'admin' ? nuevo : { ...nuevo, monto: null },
        deshacerHasta: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    }
    if (ruta === '/api/admin/perfil' && metodo === 'GET') return json(route, 200, perfil());
    if (ruta === '/api/admin/perfil' && metodo === 'PATCH') {
      estado.perfil.nombre = (cuerpo as { nombre: string }).nombre;
      return json(route, 200, perfil());
    }
    if (ruta === '/api/admin/perfil/avatar' && metodo === 'POST') {
      const { contentType } = cuerpo as { contentType: string; tamano: number };
      estado.perfil.subida = 'pedida';
      return json(route, 201, {
        subida: { url: `${STORAGE}/subir/${String(Date.now())}`, metodo: 'PUT', headers: { 'Content-Type': contentType }, venceEl: vence() },
      });
    }
    if (ruta === '/api/admin/perfil/avatar/confirmar' && metodo === 'POST') {
      if (estado.perfil.subida !== 'subida') {
        return json(route, 409, { error: { code: 'CONFLICT', message: 'Todavía no subiste la foto: subila y volvé a confirmar.' } });
      }
      estado.perfil.subida = 'nada';
      estado.perfil.avatarUrl = `${STORAGE}/avatars/${String(Date.now())}.svg`;
      return json(route, 200, perfil());
    }
    if (ruta === '/api/admin/perfil/avatar' && metodo === 'DELETE') {
      estado.perfil.avatarUrl = null;
      return route.fulfill({ status: 204 });
    }
    if (ruta === '/api/admin/perfil/clave' && metodo === 'POST') {
      const { actual, nueva } = cuerpo as { actual: string; nueva: string };
      if (actual !== estado.perfil.clave) {
        return json(route, 400, { error: { code: 'VALIDATION_ERROR', message: 'La contraseña actual no es correcta.', fields: { actual: 'La contraseña actual no es correcta.' } } });
      }
      estado.perfil.clave = nueva;
      return route.fulfill({ status: 204 });
    }
    const borrar = /^\/api\/admin\/lavados\/([^/]+)$/.exec(ruta);
    if (borrar && metodo === 'DELETE') {
      estado.lavados = estado.lavados.filter((l) => l.id !== decodeURIComponent(borrar[1] ?? ''));
      return route.fulfill({ status: 204 });
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: `Sin mock: ${metodo} ${ruta}` } });
  });
  return estado;
}

/** Entra al panel con la pantalla de ingreso, como lo haría una persona. */
export async function ingresar(page: Page, email = 'ana@buddys.test') {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('una-clave-cualquiera');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // El encargado arranca en Hoy y el empleado en Registrar: las pruebas siguen desde Registrar.
  const titulo = page.getByRole('heading', { level: 1, name: /^(Hoy|Registrar lavado)$/ });
  await titulo.waitFor();
  if ((await titulo.textContent()) === 'Hoy') await page.getByRole('link', { name: 'Registrar', exact: true }).click();
  await page.getByRole('heading', { name: 'Registrar lavado' }).waitFor();
}
