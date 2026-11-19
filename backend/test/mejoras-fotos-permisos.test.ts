import { afterEach, describe, expect, it } from 'vitest';
import { conciliarFotos } from '../src/app.js';
import { ROLES } from '../src/domain/perfil.js';
import {
  CAPACIDADES,
  puedeBorrarFoto,
  puedeCambiarEtapa,
  puedeCerrarCaja,
  puedeConfigurarFidelizacion,
  puedeCrearTurnos,
  puedeEditarGastosFijos,
  puedeExportar,
  puedeReabrirCaja,
  puedeSubirFotos,
  puedeVerGastosFijos,
  puedeVerInactivos,
  recibeAvisosDeEquipo,
} from '../src/domain/permisos.js';
import { SUPABASE_URL } from './supabase-fake.js';
import { closeAllContexts, createTestContext, loginAs, testConfig } from './helpers.js';

afterEach(closeAllContexts);

/**
 * Supabase Storage falso (sin red): firma subidas y lecturas, responde HEAD con el tamaño y el tipo de lo "subido",
 * lista carpetas y borra. `subir` simula el PUT del panel; `objetos` es el bucket.
 */
function storageFalso() {
  const objetos = new Map<string, { tamano: number; tipo: string; creado: string }>();
  const pedidos: { metodo: string; url: string; apikey: string | null; body: unknown }[] = [];
  let caido = false;
  const base = `${SUPABASE_URL}/storage/v1`;
  const fetchFn = ((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const metodo = init?.method ?? 'GET';
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    pedidos.push({ metodo, url, apikey: headers.get('apikey'), body });
    if (caido) return Promise.resolve(new Response('caído', { status: 500 }));
    const ruta = url.replace(base, '');
    if (ruta.startsWith('/object/upload/sign/')) return Promise.resolve(Response.json({ url: `${ruta}?token=subida` }));
    if (ruta.startsWith('/object/sign/')) return Promise.resolve(Response.json({ signedURL: `${ruta}?token=lectura` }));
    if (metodo === 'HEAD') {
      const objeto = objetos.get(ruta.replace('/object/authenticated/lavados-fotos/', ''));
      return Promise.resolve(
        objeto === undefined
          ? new Response(null, { status: 400 })
          : new Response(null, { status: 200, headers: { 'content-length': String(objeto.tamano), 'content-type': objeto.tipo } }),
      );
    }
    if (ruta === '/object/list/lavados-fotos') {
      const { prefix } = body as { prefix: string };
      const nombres = [...objetos.entries()];
      const lista =
        prefix === ''
          ? [...new Set(nombres.map(([k]) => k.split('/')[0] ?? ''))].map((name) => ({ name, id: null }))
          : nombres.filter(([k]) => k.startsWith(`${prefix}/`)).map(([k, o]) => ({ name: k.slice(prefix.length + 1), id: k, created_at: o.creado }));
      return Promise.resolve(Response.json(lista));
    }
    if (metodo === 'DELETE') {
      for (const p of (body as { prefixes: string[] }).prefixes) objetos.delete(p);
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response('no', { status: 404 }));
  }) as typeof fetch;
  return {
    fetchFn,
    pedidos,
    objetos,
    /** El PUT del panel a la URL de subida. */
    subir(urlSubida: string, tamano: number, tipo: string, creado = '2026-10-16T15:00:00.000Z') {
      const ruta = urlSubida.replace(`${base}/object/upload/sign/lavados-fotos/`, '').split('?')[0] ?? '';
      objetos.set(ruta, { tamano, tipo, creado });
    },
    caer: () => {
      caido = true;
    },
  };
}

const FOTO = { tipo: 'antes', contentType: 'image/webp', tamano: 500_000 } as const;
const HORAS = (n: number) => n * 60 * 60_000;

describe('fotos antes/después (función 13): pedir URL -> PUT -> confirmar', () => {
  it('nace pendiente (no se lista), se confirma verificando el objeto en Storage, y la secret key nunca sale', async () => {
    const storage = storageFalso();
    const context = await createTestContext({ storageFetch: storage.fetchFn });
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);

    const r = await empleado.post(`/api/admin/lavados/${id}/fotos`, FOTO);
    expect(r.status).toBe(201);
    expect(r.body.foto).toMatchObject({ tipo: 'antes', contentType: 'image/webp', estado: 'pendiente' });
    expect(r.body.foto.path).toBeUndefined();
    const fotoId = String(r.body.foto.id);
    expect(r.body.subida).toEqual({
      url: `${SUPABASE_URL}/storage/v1/object/upload/sign/lavados-fotos/${id}/${fotoId}.webp?token=subida`,
      metodo: 'PUT',
      headers: { 'Content-Type': 'image/webp' },
      venceEl: '2026-10-16T17:00:00.000Z',
    });
    expect(storage.pedidos[0]?.apikey).toBe(testConfig().supabase.secretKey);
    expect(JSON.stringify(r.body)).not.toContain(String(testConfig().supabase.secretKey));
    expect((await empleado.get(`/api/admin/lavados/${id}/fotos`)).body.fotos).toEqual([]);

    const antes = await empleado.post(`/api/admin/lavados/${id}/fotos/${fotoId}/confirmar`);
    expect(antes.status).toBe(409);
    expect(antes.body.error.message).toBe('Todavía no subiste la foto: subila y volvé a confirmar.');
    storage.subir(String(r.body.subida.url), 480_000, 'image/webp');
    const { client: otro } = await loginAs(context, 'empleado', 'otro@buddys.test');
    expect((await otro.post(`/api/admin/lavados/${id}/fotos/${fotoId}/confirmar`)).status).toBe(403);
    const ok = await empleado.post(`/api/admin/lavados/${id}/fotos/${fotoId}/confirmar`);
    expect(ok.status).toBe(200);
    expect(ok.body.foto.estado).toBe('lista');
    const lista = await empleado.get(`/api/admin/lavados/${id}/fotos`);
    expect(lista.body.fotos).toHaveLength(1);
    expect(lista.body.fotos[0].url).toContain('/object/sign/lavados-fotos/');
  });

  it('confirmar rechaza un archivo de otro tipo o más grande (borra objeto y foto) y una subida vencida', async () => {
    const storage = storageFalso();
    const context = await createTestContext({ storageFetch: storage.fetchFn });
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    const grande = await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO);
    storage.subir(String(grande.body.subida.url), 1_572_865, 'image/webp');
    const r = await admin.post(`/api/admin/lavados/${id}/fotos/${String(grande.body.foto.id)}/confirmar`);
    expect(r.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storage.objetos.size).toBe(0);
    const png = await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO);
    storage.subir(String(png.body.subida.url), 1000, 'image/png');
    expect((await admin.post(`/api/admin/lavados/${id}/fotos/${String(png.body.foto.id)}/confirmar`)).status).toBe(400);

    const tarde = await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO);
    storage.subir(String(tarde.body.subida.url), 1000, 'image/webp');
    // El token venció (sin mover el reloj de la app: vencería también la sesión).
    await context.db.sql.query("UPDATE buddys.lavado_fotos SET created_at = '2026-10-16T12:00:00Z', subida_vence_at = '2026-10-16T14:00:00Z' WHERE id = $1::uuid", [
      String(tarde.body.foto.id),
    ]);
    const vencida = await admin.post(`/api/admin/lavados/${id}/fotos/${String(tarde.body.foto.id)}/confirmar`);
    expect(vencida.status).toBe(409);
    expect(vencida.body.error.message).toBe('La subida venció: pedí otra.');
  });

  it('las pendientes cuentan para el tope de 6; borrar no libera el objeto hasta que vence el token (conciliación)', async () => {
    const storage = storageFalso();
    const context = await createTestContext({ storageFetch: storage.fetchFn });
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    const pedidas = [];
    for (let i = 0; i < 6; i++) pedidas.push(await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO));
    expect((await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO)).status).toBe(409);

    // El ataque: pedir la URL, borrar la fila y subir igual con el token (que sigue valiendo 2 horas).
    const primera = pedidas[0]?.body;
    expect((await admin.delete(`/api/admin/lavados/${id}/fotos/${String(primera.foto.id)}`)).status).toBe(204);
    storage.subir(String(primera.subida.url), 1_000_000, 'image/webp');
    const anotada = await context.db.sql.query('SELECT path, borrar_desde FROM buddys.fotos_a_borrar');
    expect(anotada.rows).toHaveLength(1);
    expect(await conciliarFotos(context.app)).toEqual({ pendientesVencidas: 0, borrados: 0, huerfanos: 0 });
    expect(storage.objetos.size).toBe(1);

    // Pasan las 2 horas: la conciliación borra el objeto subido a escondidas y las 5 pendientes vencidas.
    context.clock.current = new Date(context.clock.current.getTime() + HORAS(2) + 1000);
    // Las 5 pendientes quedan anotadas con su plazo ya vencido: en la misma pasada se borran sus objetos (6 en total).
    expect(await conciliarFotos(context.app)).toMatchObject({ pendientesVencidas: 5, borrados: 6 });
    expect(storage.objetos.size).toBe(0);
    expect((await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.lavado_fotos')).rows[0]?.n).toBe(0);
    expect(await conciliarFotos(context.app)).toEqual({ pendientesVencidas: 0, borrados: 0, huerfanos: 0 });
    expect((await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.fotos_a_borrar')).rows[0]?.n).toBe(0);
  });

  it('la conciliación borra objetos del bucket sin fila (más de 2 horas) y no toca una subida en curso', async () => {
    const storage = storageFalso();
    const context = await createTestContext({ storageFetch: storage.fetchFn });
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    const buena = await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO);
    storage.subir(String(buena.body.subida.url), 1000, 'image/webp', '2026-10-16T10:00:00.000Z');
    await admin.post(`/api/admin/lavados/${id}/fotos/${String(buena.body.foto.id)}/confirmar`);
    storage.objetos.set(`${id}/11111111-1111-4111-8111-111111111111.webp`, { tamano: 1, tipo: 'image/webp', creado: '2026-10-16T10:00:00.000Z' });
    storage.objetos.set(`${id}/22222222-2222-4222-8222-222222222222.webp`, { tamano: 1, tipo: 'image/webp', creado: '2026-10-16T14:30:00.000Z' });
    expect(await conciliarFotos(context.app)).toMatchObject({ huerfanos: 1 });
    expect([...storage.objetos.keys()].sort()).toEqual([`${id}/${String(buena.body.foto.id)}.webp`, `${id}/22222222-2222-4222-8222-222222222222.webp`].sort());
  });

  it('borrar el turno deja anotados los objetos de sus fotos; el empleado borra la suya solo 5 minutos', async () => {
    const storage = storageFalso();
    const context = await createTestContext({ storageFetch: storage.fetchFn });
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    const suya = String((await empleado.post(`/api/admin/lavados/${id}/fotos`, FOTO)).body.foto.id);
    const ajena = String((await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO)).body.foto.id);
    expect((await empleado.delete(`/api/admin/lavados/${id}/fotos/${ajena}`)).status).toBe(403);
    context.clock.current = new Date(context.clock.current.getTime() + 6 * 60_000);
    expect((await empleado.delete(`/api/admin/lavados/${id}/fotos/${suya}`)).status).toBe(403);
    expect((await admin.delete(`/api/admin/lavados/${id}/fotos/${suya}`)).status).toBe(204);
    expect((await admin.delete(`/api/admin/lavados/${id}/fotos/${suya}`)).status).toBe(404);
    expect((await admin.delete(`/api/admin/lavados/${id}`)).status).toBe(204);
    expect((await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.fotos_a_borrar')).rows[0]?.n).toBe(2);
  });

  it('pedir URLs de subida tiene rate limit por usuario', async () => {
    const storage = storageFalso();
    const base = testConfig();
    const context = await createTestContext({
      storageFetch: storage.fetchFn,
      config: { rateLimits: { ...base.rateLimits, fotos: { windowMs: 60_000, limit: 2 } } },
    });
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    expect((await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO)).status).toBe(201);
    expect((await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO)).status).toBe(201);
    expect((await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO)).status).toBe(429);
  });

  it('con Storage caído: pedir la URL es 503 y no queda la foto', async () => {
    const storage = storageFalso();
    const context = await createTestContext({ storageFetch: storage.fetchFn });
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    storage.caer();
    expect((await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO)).status).toBe(503);
    expect((await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.lavado_fotos')).rows[0]?.n).toBe(0);
    expect(await conciliarFotos(context.app)).toEqual({ pendientesVencidas: 0, borrados: 0, huerfanos: 0 });
  });

  it('sin SUPABASE_SECRET_KEY queda apagada sin errores', async () => {
    const base = testConfig();
    const context = await createTestContext({ config: { supabase: { ...base.supabase, secretKey: undefined } } });
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' })).body.lavado.id);
    expect((await admin.get(`/api/admin/lavados/${id}/fotos`)).body).toEqual({ disponible: false, fotos: [] });
    const r = await admin.post(`/api/admin/lavados/${id}/fotos`, FOTO);
    expect(r.status).toBe(503);
    expect(r.body.error.message).toBe('Las fotos no están configuradas en el servidor.');
    expect(await conciliarFotos(context.app)).toBeUndefined();
    expect((await admin.delete(`/api/admin/lavados/${id}`)).status).toBe(204);
  });
});

describe('capacidades nuevas (contrato 2026-11-15)', () => {
  it('las funciones salen de CAPACIDADES y coinciden con la verdad escrita a mano', () => {
    const pares: [string, (rol: (typeof ROLES)[number]) => boolean][] = [
      ['turnos.crear', puedeCrearTurnos],
      ['clientes.inactivos', puedeVerInactivos],
      ['fidelizacion.configurar', puedeConfigurarFidelizacion],
      ['finanzas.gastos_fijos', puedeEditarGastosFijos],
      ['caja.cerrar', puedeCerrarCaja],
      ['caja.reabrir', puedeReabrirCaja],
      ['fotos.subir', puedeSubirFotos],
      ['finanzas.exportar', puedeExportar],
      ['push.equipo', recibeAvisosDeEquipo],
    ];
    for (const [id, funcion] of pares) {
      const capacidad = CAPACIDADES.find((c) => c.id === id);
      expect(capacidad, id).toBeDefined();
      for (const rol of ROLES) expect(funcion(rol), `${id} ${rol}`).toBe(capacidad?.roles[rol] === 'si');
    }
    const esperado = { superadmin: [true, true, true, true, true, true], admin: [true, true, false, true, false, true], empleado: [false, false, false, false, false, false] };
    for (const rol of ROLES) {
      expect([puedeCrearTurnos(rol), puedeCerrarCaja(rol), puedeReabrirCaja(rol), puedeVerGastosFijos(rol), puedeEditarGastosFijos(rol), puedeExportar(rol)], rol).toEqual(esperado[rol]);
    }
    const lavado = { trabajador: { id: 'a' }, registradoPor: 'b' };
    expect(puedeCambiarEtapa('empleado', 'a', lavado)).toBe(true);
    expect(puedeCambiarEtapa('empleado', 'b', lavado)).toBe(true);
    expect(puedeCambiarEtapa('empleado', 'c', lavado)).toBe(false);
    expect(puedeCambiarEtapa('admin', 'c', lavado)).toBe(true);
    const ahora = new Date('2026-10-16T15:05:00.000Z');
    const foto = { creadaPor: 'a', createdAt: '2026-10-16T15:00:00.000Z' };
    expect(puedeBorrarFoto('empleado', 'a', foto, ahora)).toBe(true);
    expect(puedeBorrarFoto('empleado', 'a', foto, new Date('2026-10-16T15:05:01.000Z'))).toBe(false);
    expect(puedeBorrarFoto('empleado', 'b', foto, ahora)).toBe(false);
    expect(puedeBorrarFoto('admin', 'b', foto, new Date('2027-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('GET /api/admin/permisos muestra las capacidades nuevas a todos los roles', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'empleado');
    const ids = ((await client.get('/api/admin/permisos')).body.capacidades as { id: string }[]).map((c) => c.id);
    for (const id of ['lavados.etapa', 'fotos.subir', 'fotos.borrar', 'turnos.crear', 'caja.cerrar', 'caja.reabrir', 'finanzas.gastos_fijos', 'finanzas.exportar']) {
      expect(ids).toContain(id);
    }
  });
});
