import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { verifyPostgresSchema } from '../src/db/postgres.js';
import { type InsumoBajo, agrupadoDeConsumo, textoAvisoStock } from '../src/domain/inventario.js';
import { ROLES } from '../src/domain/perfil.js';
import { CAPACIDADES, puedeDefinirRecetas, puedeVerConsumoInventario } from '../src/domain/permisos.js';
import type { PushSender } from '../src/domain/push.js';
import { notaDeReceta } from '../src/repositories/postgres/stock.js';
import { generarClavesVapid } from '../src/scripts/vapid-cli.js';
import { createPgliteDatabase } from './pglite.js';
import { type Client, type TestContext, addUser, closeAllContexts, createTestContext, loginClient } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Recetas, descuento automático de stock, devoluciones y avisos de stock bajo
 * (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md, "Pruebas que tienen que existir", parte backend).
 * NOW: 2026-10-16 12:00 en La Rioja.
 */

const vapid = generarClavesVapid();
const PUSH_CONFIG: NonNullable<AppConfig['push']> = {
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  subject: 'mailto:dueno@buddys.test',
};
const P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const AUTH = Buffer.alloc(16, 9).toString('base64url');
const endpoint = (nombre: string) => `https://fcm.googleapis.com/fcm/send/${nombre}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

interface Equipo {
  context: TestContext;
  dueno: Client;
  admin: Client;
  empleado: Client;
  adminId: string;
  empleadoId: string;
  send: ReturnType<typeof vi.fn<PushSender['send']>>;
}

/** Superadmin, admin y empleado; tres servicios activos para todos los vehículos. Con push y un envío falso. */
async function equipo(opciones: { falla?: boolean } = {}): Promise<Equipo> {
  const send = vi.fn<PushSender['send']>(() => (opciones.falla === true ? Promise.reject(new Error('caído')) : Promise.resolve()));
  const context = await createTestContext({ config: { push: PUSH_CONFIG }, pushSender: { send } });
  await context.db.sql.query(
    "UPDATE buddys.servicios SET activo = true, vehiculos = ARRAY['auto','suv','pickup','moto'] WHERE id IN ('lavado-basico', 'encerado', 'pulido')",
  );
  await addUser(context, { email: 'dueno@r.test', rol: 'superadmin', nombre: 'Dueño' });
  const adminId = await addUser(context, { email: 'ana@r.test', rol: 'admin', nombre: 'Ana' });
  const empleadoId = await addUser(context, { email: 'beto@r.test', rol: 'empleado', nombre: 'Beto' });
  return {
    context,
    dueno: await loginClient(context, 'dueno@r.test'),
    admin: await loginClient(context, 'ana@r.test'),
    empleado: await loginClient(context, 'beto@r.test'),
    adminId,
    empleadoId,
    send,
  };
}

async function insumo(admin: Client, datos: Record<string, unknown>): Promise<string> {
  const r = await admin.post('/api/admin/insumos', { unidad: 'ml', ...datos });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.insumo.id);
}

async function receta(admin: Client, servicio: string, vehiculo: string | null, items: { insumoId: string; cantidad: number }[]) {
  const r = await admin.put(`/api/admin/servicios/${servicio}/receta`, { vehiculo, items });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.receta as Record<string, unknown>;
}

async function lavar(client: Client, servicioIds: string[], vehiculoTipo = 'auto'): Promise<string> {
  // Con monto: sin él sale además el aviso "lavado sin monto" a los encargados (mejoras 2026-11-15), que acá no se mide.
  const r = await client.post('/api/admin/lavados', { servicioIds, vehiculoTipo, monto: 1000 });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.lavado.id);
}

async function stock(context: TestContext, id: string): Promise<number> {
  const { rows } = await context.db.sql.query('SELECT stock::float8 AS stock FROM buddys.insumos WHERE id = $1::uuid', [id]);
  return Number(rows[0]?.stock);
}

async function avisado(context: TestContext, id: string): Promise<boolean> {
  const { rows } = await context.db.sql.query('SELECT aviso_bajo_at IS NOT NULL AS ok FROM buddys.insumos WHERE id = $1::uuid', [id]);
  return rows[0]?.ok === true;
}

async function movimientos(context: TestContext, insumoId: string) {
  const { rows } = await context.db.sql.query(
    `SELECT tipo, cantidad::float8 AS cantidad, nota, turno_id::text AS turno_id, perfil_id::text AS perfil_id
     FROM buddys.movimientos_stock WHERE insumo_id = $1::uuid AND tipo IN ('uso', 'devolucion')
     ORDER BY created_at, CASE tipo WHEN 'devolucion' THEN 0 ELSE 1 END, id`, // en una corrección: primero devuelve, después descuenta
    [insumoId],
  );
  return rows;
}

/** Un dispositivo de esa persona (directo en la base: también para un usuario inactivo, que no puede entrar). */
async function dispositivo(context: TestContext, email: string, nombre: string): Promise<void> {
  await context.db.sql.query(
    `INSERT INTO buddys.push_suscripciones (perfil_id, endpoint, p256dh, auth)
     SELECT id, $2, $3, $4 FROM buddys.perfiles WHERE email = $1`,
    [email, endpoint(nombre), P256DH, AUTH],
  );
}

describe('recetas: GET y PUT', () => {
  it('PUT reemplaza una variante y devuelve la receta entera; GET la ve cualquier rol, sin costos; [] la borra', async () => {
    const { admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', costoUnitario: 5 });
    const cera = await insumo(admin, { nombre: 'Cera', unidad: 'g' });

    const general = await receta(admin, 'lavado-basico', null, [
      { insumoId: shampoo, cantidad: 50 },
      { insumoId: cera, cantidad: 10.5 },
    ]);
    expect(general).toEqual({
      servicioId: 'lavado-basico',
      general: [
        { insumoId: cera, nombre: 'Cera', unidad: 'g', cantidad: 10.5 },
        { insumoId: shampoo, nombre: 'Shampoo', unidad: 'ml', cantidad: 50 },
      ],
      porVehiculo: {},
    });
    const conPickup = await receta(admin, 'lavado-basico', 'pickup', [{ insumoId: shampoo, cantidad: 80 }]);
    expect(conPickup.porVehiculo).toEqual({ pickup: [{ insumoId: shampoo, nombre: 'Shampoo', unidad: 'ml', cantidad: 80 }] });

    // Reemplaza (no suma): la general queda solo con el shampoo.
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 40 }]);
    const visto = await empleado.get('/api/admin/recetas');
    expect(visto.status).toBe(200);
    expect(visto.body).toEqual({
      recetas: [
        {
          servicioId: 'lavado-basico',
          general: [{ insumoId: shampoo, nombre: 'Shampoo', unidad: 'ml', cantidad: 40 }],
          porVehiculo: { pickup: [{ insumoId: shampoo, nombre: 'Shampoo', unidad: 'ml', cantidad: 80 }] },
        },
      ],
    });
    expect(JSON.stringify(visto.body)).not.toMatch(/costo/i);

    // items: [] borra la variante; sin renglones, el servicio no aparece en el GET.
    await receta(admin, 'lavado-basico', 'pickup', []);
    const vacia = await receta(admin, 'lavado-basico', null, []);
    expect(vacia).toEqual({ servicioId: 'lavado-basico', general: [], porVehiculo: {} });
    expect((await admin.get('/api/admin/recetas')).body).toEqual({ recetas: [] });
  });

  it('errores: 403 empleado (antes de validar), 404 servicio, 400 insumo inexistente o inactivo, vehículo, repetidos y rangos', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo' });
    const viejo = await insumo(admin, { nombre: 'Viejo' });
    await admin.patch(`/api/admin/insumos/${viejo}`, { activo: false }).expect(200);

    expect((await empleado.put('/api/admin/servicios/lavado-basico/receta', { cualquier: 1 })).status).toBe(403);
    expect((await admin.put('/api/admin/servicios/no-existe/receta', { vehiculo: null, items: [] })).status).toBe(404);
    expect((await admin.put('/api/admin/servicios/NO VALIDO/receta', { vehiculo: null, items: [] })).status).toBe(404);

    const malos = async (body: unknown) => {
      const r = await admin.put('/api/admin/servicios/lavado-basico/receta', body);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      return r.body.error.fields as Record<string, string>;
    };
    expect(await malos({ vehiculo: null, items: [{ insumoId: '11111111-1111-4111-8111-111111111111', cantidad: 1 }] })).toEqual({
      'items.0.insumoId': 'Ese insumo no existe o está inactivo.',
    });
    expect(await malos({ vehiculo: null, items: [{ insumoId: shampoo, cantidad: 1 }, { insumoId: viejo, cantidad: 1 }] })).toEqual({
      'items.1.insumoId': 'Ese insumo no existe o está inactivo.',
    });
    expect(await malos({ vehiculo: null, items: [{ insumoId: 'x', cantidad: 1 }] })).toEqual({
      'items.0.insumoId': 'Ese insumo no existe o está inactivo.',
    });
    expect(Object.keys(await malos({ vehiculo: null, items: [{ insumoId: shampoo, cantidad: 1 }, { insumoId: shampoo.toUpperCase(), cantidad: 2 }] }))).toEqual([
      'items.1.insumoId',
    ]);
    expect(Object.keys(await malos({ vehiculo: null, items: [{ insumoId: shampoo, cantidad: 0 }] }))).toEqual(['items.0.cantidad']);
    expect(Object.keys(await malos({ vehiculo: null, items: [{ insumoId: shampoo, cantidad: 100000 }] }))).toEqual(['items.0.cantidad']);
    expect(Object.keys(await malos({ vehiculo: null, items: [{ insumoId: shampoo, cantidad: 1.234 }] }))).toEqual(['items.0.cantidad']);
    expect(Object.keys(await malos({ vehiculo: 'camion', items: [] }))).toEqual(['vehiculo']);
    expect(Object.keys(await malos({ items: [] }))).toEqual(['vehiculo']);
    expect(Object.keys(await malos({ vehiculo: null, items: [], otro: 1 }))).toEqual(['otro']);
    const muchos = Array.from({ length: 31 }, () => ({ insumoId: shampoo, cantidad: 1 }));
    expect(Object.keys(await malos({ vehiculo: null, items: muchos }))).toContain('items');

    // Un vehículo que el servicio no ofrece.
    await context.db.sql.query("UPDATE buddys.servicios SET vehiculos = ARRAY['auto'] WHERE id = 'lavado-basico'");
    expect(await malos({ vehiculo: 'moto', items: [] })).toEqual({ vehiculo: 'Ese servicio no se ofrece para ese vehículo.' });
    // Nada de lo rechazado quedó guardado.
    expect((await admin.get('/api/admin/recetas')).body).toEqual({ recetas: [] });
  });
});

describe('descuento al registrar un lavado (reglas 1 a 3)', () => {
  it('usa la receta del vehículo y si no la general; suma varios servicios; saltea un insumo inactivo', async () => {
    const { context, admin, adminId } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 1000 });
    const cera = await insumo(admin, { nombre: 'Cera', unidad: 'g', stockInicial: 500 });
    const silicona = await insumo(admin, { nombre: 'Silicona', stockInicial: 100 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 50 }, { insumoId: silicona, cantidad: 5 }]);
    await receta(admin, 'lavado-basico', 'pickup', [{ insumoId: shampoo, cantidad: 80 }]);
    await receta(admin, 'encerado', null, [{ insumoId: cera, cantidad: 20 }, { insumoId: shampoo, cantidad: 10 }]);

    // Auto: la general de cada servicio, sumada por insumo.
    const auto = await lavar(admin, ['lavado-basico', 'encerado'], 'auto');
    expect(await stock(context, shampoo)).toBe(940);
    expect(await stock(context, cera)).toBe(480);
    expect(await stock(context, silicona)).toBe(95);
    expect(await movimientos(context, shampoo)).toEqual([
      { tipo: 'uso', cantidad: -60, nota: 'Receta: Encerado + Lavado Básico', turno_id: auto, perfil_id: adminId },
    ]);
    expect((await movimientos(context, cera))[0]).toMatchObject({ nota: 'Receta: Encerado' });

    // Pickup: la variante reemplaza a la general del lavado básico (sin silicona); el encerado sigue con la general.
    await lavar(admin, ['lavado-basico', 'encerado'], 'pickup');
    expect(await stock(context, shampoo)).toBe(850);
    expect(await stock(context, silicona)).toBe(95);

    // Silicona inactiva: se saltea.
    await admin.patch(`/api/admin/insumos/${silicona}`, { activo: false }).expect(200);
    await lavar(admin, ['lavado-basico']);
    expect(await stock(context, silicona)).toBe(95);
    expect(await stock(context, shampoo)).toBe(800);

    // Un servicio sin receta no descuenta nada.
    await lavar(admin, ['pulido']);
    expect(await stock(context, shampoo)).toBe(800);
  });

  it('el stock nunca frena el lavado: descuenta lo que hay, queda en 0 y el movimiento dice lo que faltó', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 30, stockMinimo: 10 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 50 }]);
    const id = await lavar(empleado, ['lavado-basico']);
    expect(await stock(context, shampoo)).toBe(0);
    expect(await movimientos(context, shampoo)).toMatchObject([
      { tipo: 'uso', cantidad: -30, nota: 'Receta: Lavado Básico. Faltaron 20 ml según la receta', turno_id: id },
    ]);
    // Sin stock no hay movimiento, pero el lavado se registra igual.
    await lavar(empleado, ['lavado-basico']);
    expect(await movimientos(context, shampoo)).toHaveLength(1);
    const lista = await admin.get(`/api/admin/insumos/${shampoo}/movimientos`);
    expect(lista.body.movimientos[0]).toMatchObject({ tipo: 'uso', cantidad: -30 });
  });

  it('todo en la misma transacción: si algo falla después del INSERT del lavado, no queda ni el lavado ni el descuento', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 50 }]);
    await context.db.pg.exec(`
      CREATE FUNCTION public.falla_uso() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falla de prueba'; END $$;
      CREATE TRIGGER falla_uso BEFORE INSERT ON buddys.movimientos_stock FOR EACH ROW WHEN (NEW.tipo = 'uso')
        EXECUTE FUNCTION public.falla_uso();`);
    const antes = (await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.bookings')).rows[0]?.n;
    const r = await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico'], vehiculoTipo: 'auto' });
    expect(r.status).toBe(500);
    expect((await context.db.sql.query('SELECT count(*)::int AS n FROM buddys.bookings')).rows[0]?.n).toBe(antes);
    expect(await stock(context, shampoo)).toBe(100);
  });

  it('concurrencia: dos lavados a la vez sobre el mismo insumo dan el stock final correcto y no se traban', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 1000 });
    const cera = await insumo(admin, { nombre: 'Cera', stockInicial: 1000 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 50 }, { insumoId: cera, cantidad: 7 }]);
    await receta(admin, 'encerado', null, [{ insumoId: cera, cantidad: 20 }, { insumoId: shampoo, cantidad: 5 }]);
    const pedidos = [
      admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico'], vehiculoTipo: 'auto' }),
      empleado.post('/api/admin/lavados', { servicioIds: ['encerado', 'lavado-basico'], vehiculoTipo: 'auto' }),
      admin.post('/api/admin/lavados', { servicioIds: ['encerado'], vehiculoTipo: 'suv' }),
    ];
    const respuestas = await Promise.all(pedidos);
    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await stock(context, shampoo)).toBe(1000 - 50 - 55 - 5);
    expect(await stock(context, cera)).toBe(1000 - 7 - 27 - 20);
  });

  it('notaDeReceta recorta los servicios a 200 caracteres, sin perder lo que faltó', () => {
    const largo = 'Servicio con nombre larguísimo '.repeat(10);
    const nota = notaDeReceta(largo, 20, 'ml');
    expect(Array.from(nota)).toHaveLength(200);
    expect(nota.startsWith('Receta: Servicio')).toBe(true);
    expect(nota.endsWith('…. Faltaron 20 ml según la receta')).toBe(true);
    expect(Array.from(notaDeReceta(largo, 0, 'ml'))).toHaveLength(200);
    expect(notaDeReceta('Pulido', 1.5, 'litro')).toBe('Receta: Pulido. Faltaron 1,5 litros según la receta');
  });
});

describe('deshacer y corregir un lavado (reglas 4 y 5)', () => {
  it('deshacer devuelve exactamente lo descontado, también si el stock había quedado en 0', async () => {
    const { context, admin, empleado, empleadoId } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 30 });
    const cera = await insumo(admin, { nombre: 'Cera', stockInicial: 100 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 50 }, { insumoId: cera, cantidad: 10 }]);
    const id = await lavar(empleado, ['lavado-basico']);
    expect(await stock(context, shampoo)).toBe(0);
    // Entre medio entra una compra: deshacer devuelve lo descontado (30), no "lo que faltaba".
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 5 }).expect(201);

    expect((await empleado.delete(`/api/admin/lavados/${id}`)).status).toBe(204);
    expect(await stock(context, shampoo)).toBe(35);
    expect(await stock(context, cera)).toBe(100);
    const movs = await movimientos(context, shampoo);
    // El lavado ya no existe: turno_id quedó en null (ON DELETE SET NULL); la devolución es de quien deshizo.
    expect(movs).toEqual([
      { tipo: 'uso', cantidad: -30, nota: 'Receta: Lavado Básico. Faltaron 20 ml según la receta', turno_id: null, perfil_id: empleadoId },
      { tipo: 'devolucion', cantidad: 30, nota: 'Lavado deshecho', turno_id: null, perfil_id: empleadoId },
    ]);
    // El historial lo muestra con el tipo nuevo.
    const lista = await admin.get(`/api/admin/insumos/${shampoo}/movimientos`);
    expect(lista.body.movimientos.map((m: { tipo: string }) => m.tipo)).toContain('devolucion');
  });

  it('borrar un lavado desde la planilla (DELETE /bookings/:id) también devuelve el stock', async () => {
    const { context, admin, adminId } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 40 }]);
    const id = await lavar(admin, ['lavado-basico']);
    expect((await admin.delete(`/api/admin/bookings/${id}`)).status).toBe(204);
    expect(await stock(context, shampoo)).toBe(100);
    expect((await movimientos(context, shampoo)).at(-1)).toMatchObject({ tipo: 'devolucion', cantidad: 40, perfil_id: adminId });
  });

  it('PATCH con servicioIds recalcula el descuento: devuelve la receta vieja y descuenta la nueva', async () => {
    const { context, admin, adminId } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 1000 });
    const cera = await insumo(admin, { nombre: 'Cera', stockInicial: 1000 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 50 }]);
    await receta(admin, 'encerado', null, [{ insumoId: cera, cantidad: 20 }, { insumoId: shampoo, cantidad: 5 }]);
    const id = await lavar(admin, ['lavado-basico']);
    // Un uso manual vinculado al lavado no es de la receta: la corrección no lo devuelve.
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 3, turnoId: id }).expect(201);
    expect(await stock(context, shampoo)).toBe(947);

    const r = await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['encerado'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stock(context, shampoo)).toBe(1000 - 3 - 5);
    expect(await stock(context, cera)).toBe(980);
    expect(await movimientos(context, shampoo)).toEqual([
      { tipo: 'uso', cantidad: -50, nota: 'Receta: Lavado Básico', turno_id: id, perfil_id: adminId },
      { tipo: 'uso', cantidad: -3, nota: null, turno_id: id, perfil_id: adminId },
      { tipo: 'devolucion', cantidad: 50, nota: 'Lavado corregido', turno_id: id, perfil_id: adminId },
      { tipo: 'uso', cantidad: -5, nota: 'Receta: Encerado', turno_id: id, perfil_id: adminId },
    ]);

    // Otra corrección: devuelve solo lo de la receta vigente (5), no lo que ya se devolvió.
    await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['lavado-basico', 'encerado'] }).expect(200);
    expect(await stock(context, shampoo)).toBe(1000 - 3 - 55);
    expect(await stock(context, cera)).toBe(980);

    // Y deshacerlo devuelve todo lo neto, también el uso manual vinculado.
    await admin.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await stock(context, shampoo)).toBe(1000);
    expect(await stock(context, cera)).toBe(1000);
  });
});

describe('avisos de stock bajo (reglas 6 y 7)', () => {
  it('avisa una vez al cruzar el mínimo, solo a admins y superadmins activos; no repite; vuelve a avisar después de una compra y otro cruce', async () => {
    const { context, admin, empleado, send } = await equipo();
    for (const [email, nombre] of [
      ['dueno@r.test', 'dueno'],
      ['ana@r.test', 'ana'],
      ['beto@r.test', 'beto'],
    ] as const) {
      await dispositivo(context, email, nombre);
    }
    await addUser(context, { email: 'inactivo@r.test', rol: 'admin', activo: false });
    await dispositivo(context, 'inactivo@r.test', 'inactivo');

    const shampoo = await insumo(admin, { nombre: 'Shampoo', unidad: 'litro', stockInicial: 2, stockMinimo: 1 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 0.75 }]);

    await lavar(empleado, ['lavado-basico']); // 2 -> 1,25: todavía no
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(await avisado(context, shampoo)).toBe(false);

    await lavar(empleado, ['lavado-basico']); // 1,25 -> 0,5: cruza
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    const destinos = send.mock.calls.map(([destino]) => destino.endpoint).sort();
    expect(destinos).toEqual([endpoint('ana'), endpoint('dueno')]);
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toEqual({
      tipo: 'stock',
      titulo: 'Queda poco: Shampoo',
      cuerpo: 'Hay 0,5 litro (mínimo 1 litro). Mirá la lista para comprar.',
      url: '/insumos?ver=comprar',
      pendientes: 0,
    });
    expect(await avisado(context, shampoo)).toBe(true);

    // El siguiente lavado (0,5 -> 0) no repite el aviso.
    await lavar(empleado, ['lavado-basico']);
    await tick();
    expect(send).toHaveBeenCalledTimes(2);

    // Una compra que lo sube por encima del mínimo limpia la marca; el próximo cruce vuelve a avisar.
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 1.5 }).expect(201);
    expect(await avisado(context, shampoo)).toBe(false);
    await lavar(empleado, ['lavado-basico']); // 1,5 -> 0,75
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(4);
    });
  });

  it('registrar y deshacer en bucle no repite el aviso: la devolución no limpia la marca (auditoría, hallazgo medio)', async () => {
    const { context, admin, empleado, send } = await equipo();
    await dispositivo(context, 'ana@r.test', 'ana');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', unidad: 'litro', stockInicial: 1.5, stockMinimo: 1 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 0.75 }]);

    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      const id = await lavar(empleado, ['lavado-basico']); // 1,5 -> 0,75: queda bajo
      const r = await empleado.delete(`/api/admin/lavados/${id}`); // vuelve a 1,5
      expect(r.status, JSON.stringify(r.body)).toBe(204);
    }
    await tick();
    expect(await stock(context, shampoo)).toBe(1.5);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await avisado(context, shampoo)).toBe(true);

    // Recién una compra de un admin rearma el aviso.
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 1 }).expect(201);
    expect(await avisado(context, shampoo)).toBe(false);
  });

  it('cualquier salida avisa (uso manual y ajuste); varios insumos en un pedido = un solo aviso; cambiar el mínimo reinicia', async () => {
    const { context, admin, send } = await equipo();
    await dispositivo(context, 'ana@r.test', 'ana');
    const a = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100, stockMinimo: 50 });
    const b = await insumo(admin, { nombre: 'Cera', stockInicial: 100, stockMinimo: 50 });
    const c = await insumo(admin, { nombre: 'Paños', unidad: 'unidad', stockInicial: 10, stockMinimo: 5 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: a, cantidad: 60 }, { insumoId: b, cantidad: 60 }]);

    await lavar(admin, ['lavado-basico']);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({
      tipo: 'stock',
      titulo: 'Quedan poco 2 insumos',
      url: '/insumos?ver=comprar',
    });

    // Uso manual que cruza.
    await admin.post(`/api/admin/insumos/${c}/movimientos`, { tipo: 'uso', cantidad: 6 }).expect(201);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    expect(JSON.parse(String(send.mock.calls[1]?.[1]))).toMatchObject({
      titulo: 'Queda poco: Paños',
      cuerpo: 'Hay 4 unidades (mínimo 5 unidades). Mirá la lista para comprar.',
    });

    // Cambiar el mínimo limpia la marca; un ajuste hacia abajo que cruza vuelve a avisar.
    await admin.patch(`/api/admin/insumos/${c}`, { stockMinimo: 2 }).expect(200);
    expect(await avisado(context, c)).toBe(false);
    await admin.post(`/api/admin/insumos/${c}/movimientos`, { tipo: 'ajuste', stockReal: 1 }).expect(201);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(3);
    });
    // Un ajuste hacia arriba (por encima del mínimo) limpia la marca.
    await admin.post(`/api/admin/insumos/${c}/movimientos`, { tipo: 'ajuste', stockReal: 9 }).expect(201);
    expect(await avisado(context, c)).toBe(false);
  });

  it('si el push falla, el lavado igual queda (y el stock descontado)', async () => {
    const { context, admin, send } = await equipo({ falla: true });
    await dispositivo(context, 'ana@r.test', 'ana');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 10, stockMinimo: 5 });
    await receta(admin, 'lavado-basico', null, [{ insumoId: shampoo, cantidad: 8 }]);
    const r = await admin.post('/api/admin/lavados', { servicioIds: ['lavado-basico'], vehiculoTipo: 'auto' });
    expect(r.status).toBe(201);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(await stock(context, shampoo)).toBe(2);
    expect(await avisado(context, shampoo)).toBe(true);
  });

  it('textoAvisoStock: uno, varios y más de tres', () => {
    const i = (nombre: string): InsumoBajo => ({ id: nombre, nombre, unidad: 'ml', stock: 0, stockMinimo: 100 });
    expect(textoAvisoStock([i('Shampoo')]).cuerpo).toBe('Hay 0 ml (mínimo 100 ml). Mirá la lista para comprar.');
    expect(textoAvisoStock([i('A'), i('B'), i('C')])).toEqual({
      titulo: 'Quedan poco 3 insumos',
      cuerpo: 'A, B y C. Mirá la lista para comprar.',
      url: '/insumos?ver=comprar',
    });
    expect(textoAvisoStock([i('A'), i('B'), i('C'), i('D'), i('E')]).cuerpo).toBe('A, B, C y 2 más. Mirá la lista para comprar.');
  });
});

describe('alertas y para comprar', () => {
  it('alertas: los activos bajos, por stock / mínimo; para comprar: sugerido entero para contables y con decimales para el resto', async () => {
    const { admin, empleado } = await equipo();
    const panos = await insumo(admin, { nombre: 'Paños', categoria: 'Accesorios', unidad: 'unidad', stockInicial: 3.5, stockMinimo: 5, costoUnitario: 1200 });
    const shampoo = await insumo(admin, { nombre: 'Shampoo', categoria: 'Lavado', unidad: 'litro', stockInicial: 0.5, stockMinimo: 1.25 });
    const cera = await insumo(admin, { nombre: 'Cera', categoria: 'Lavado', unidad: 'kg', stockInicial: 0.33, stockMinimo: 0.5, costoUnitario: 999 });
    await insumo(admin, { nombre: 'Sobra', stockInicial: 10, stockMinimo: 2 });
    const inactivo = await insumo(admin, { nombre: 'Inactivo', stockMinimo: 5 });
    await admin.patch(`/api/admin/insumos/${inactivo}`, { activo: false }).expect(200);

    const alertas = await admin.get('/api/admin/insumos/alertas');
    expect(alertas.status).toBe(200);
    expect(alertas.body).toEqual({
      bajoStock: 3,
      insumos: [
        { id: shampoo, nombre: 'Shampoo', unidad: 'litro', stock: 0.5, stockMinimo: 1.25 },
        { id: cera, nombre: 'Cera', unidad: 'kg', stock: 0.33, stockMinimo: 0.5 },
        { id: panos, nombre: 'Paños', unidad: 'unidad', stock: 3.5, stockMinimo: 5 },
      ],
    });

    const lista = await admin.get('/api/admin/insumos/para-comprar');
    expect(lista.status).toBe(200);
    expect(lista.body).toEqual({
      items: [
        { insumoId: panos, nombre: 'Paños', categoria: 'Accesorios', unidad: 'unidad', stock: 3.5, stockMinimo: 5, sugerido: 7, costoEstimado: 8400 },
        { insumoId: cera, nombre: 'Cera', categoria: 'Lavado', unidad: 'kg', stock: 0.33, stockMinimo: 0.5, sugerido: 0.67, costoEstimado: 669 },
        { insumoId: shampoo, nombre: 'Shampoo', categoria: 'Lavado', unidad: 'litro', stock: 0.5, stockMinimo: 1.25, sugerido: 2, costoEstimado: null },
      ],
      costoTotalEstimado: 9069,
    });

    expect((await empleado.get('/api/admin/insumos/alertas')).status).toBe(403);
    expect((await empleado.get('/api/admin/insumos/para-comprar')).status).toBe(403);
  });

  it('sin nada bajo: listas vacías y total 0', async () => {
    const { admin } = await equipo();
    expect((await admin.get('/api/admin/insumos/alertas')).body).toEqual({ bajoStock: 0, insumos: [] });
    expect((await admin.get('/api/admin/insumos/para-comprar')).body).toEqual({ items: [], costoTotalEstimado: 0 });
  });

  it('POST de un movimiento devolucion: 400 para quien gestiona (no se crea a mano) y 403 para el empleado', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 10 });
    const r = await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'devolucion', cantidad: 5 });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.tipo).toMatch(/no se cargan a mano/);
    expect((await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'devolucion', cantidad: 5 })).status).toBe(403);
    expect(await stock(context, shampoo)).toBe(10);
  });
});

describe('GET /api/admin/consumo', () => {
  async function conDatos() {
    const e = await equipo();
    const shampoo = await insumo(e.admin, { nombre: 'Shampoo', costoUnitario: 5 });
    const cera = await insumo(e.admin, { nombre: 'Cera' });
    const devuelto = await insumo(e.admin, { nombre: 'Devuelto', costoUnitario: 3 });
    const mov = (id: string, tipo: string, cantidad: number, at: string) =>
      e.context.db.sql.query(
        'INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, created_at) VALUES ($1::uuid, $2, $3, $4::timestamptz)',
        [id, tipo, cantidad, at],
      );
    await mov(shampoo, 'uso', -50, '2026-11-01T03:00:00Z'); // 1/11 00:00 en La Rioja: entra
    await mov(shampoo, 'uso', -30, '2026-11-01T02:59:59Z'); // 31/10 en La Rioja: no entra
    await mov(shampoo, 'devolucion', 20, '2026-11-15T12:00:00Z');
    await mov(shampoo, 'compra', 1000, '2026-11-10T12:00:00Z');
    await mov(shampoo, 'ajuste', -7, '2026-11-10T12:00:00Z');
    await mov(cera, 'uso', -1.5, '2026-12-01T02:59:59Z'); // 30/11 en La Rioja: entra
    await mov(devuelto, 'uso', -10, '2026-11-05T12:00:00Z');
    await mov(devuelto, 'devolucion', 10, '2026-11-05T13:00:00Z'); // consumo 0: no se muestra
    const lavado = (fecha: string, estado = 'completado', origen = 'mostrador') =>
      e.context.db.sql.query(
        `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen, monto)
         VALUES ('C', '3804000000', 'auto', 'pulido', $1::date, 'manana', $2, $3, CASE WHEN $2 = 'completado' THEN 1000 END)`,
        [fecha, estado, origen],
      );
    for (const fecha of ['2026-11-02', '2026-11-02', '2026-11-30', '2026-12-28', '2026-12-31', '2027-01-01', '2027-01-09']) await lavado(fecha);
    await lavado('2026-11-03', 'cancelado');
    await lavado('2026-11-03', 'completado', 'web');
    return { ...e, shampoo, cera };
  }

  it('por día (con ceros), consumo por insumo con devoluciones restadas, costos y costo por lavado', async () => {
    const { admin, shampoo, cera } = await conDatos();
    const r = await admin.get('/api/admin/consumo?desde=2026-11-01&hasta=2026-11-30');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['costoInsumos', 'costoPorLavado', 'lavados', 'porInsumo', 'rango']);
    expect(r.body.rango).toEqual({ desde: '2026-11-01', hasta: '2026-11-30', agrupado: 'dia' });
    expect(r.body.lavados.total).toBe(3);
    expect(r.body.lavados.serie).toHaveLength(30);
    expect(r.body.lavados.serie.slice(0, 3)).toEqual([
      { clave: '2026-11-01', cantidad: 0 },
      { clave: '2026-11-02', cantidad: 2 },
      { clave: '2026-11-03', cantidad: 0 },
    ]);
    expect(r.body.lavados.serie.at(-1)).toEqual({ clave: '2026-11-30', cantidad: 1 });
    expect(r.body.porInsumo).toEqual([
      { insumoId: shampoo, nombre: 'Shampoo', unidad: 'ml', consumido: 30, costo: 150 },
      { insumoId: cera, nombre: 'Cera', unidad: 'ml', consumido: 1.5, costo: null },
    ]);
    expect(r.body.costoInsumos).toBe(150);
    expect(r.body.costoPorLavado).toBe(50);
  });

  it('por semana (lunes, cruzando mes y año) y por mes, con ceros; sin lavados el costo por lavado es null', async () => {
    const { admin } = await conDatos();
    const semanas = await admin.get('/api/admin/consumo?desde=2026-11-01&hasta=2027-01-17');
    expect(semanas.body.rango.agrupado).toBe('semana');
    // 2026-11-01 es domingo: la primera semana es la del lunes 26/10.
    expect(semanas.body.lavados.serie[0]).toEqual({ clave: '2026-10-26', cantidad: 0 });
    expect(semanas.body.lavados.serie[1]).toEqual({ clave: '2026-11-02', cantidad: 2 });
    const porClave = new Map(semanas.body.lavados.serie.map((p: { clave: string; cantidad: number }) => [p.clave, p.cantidad]));
    expect(porClave.get('2026-11-30')).toBe(1); // lunes 30/11: la semana que cruza a diciembre
    expect(porClave.get('2026-12-28')).toBe(3); // la semana del cambio de año
    expect(porClave.get('2027-01-04')).toBe(1);
    expect(porClave.get('2027-01-11')).toBe(0);
    expect(semanas.body.lavados.total).toBe(7);

    const meses = await admin.get('/api/admin/consumo?desde=2026-02-01&hasta=2027-01-31');
    expect(meses.body.rango.agrupado).toBe('mes');
    expect(meses.body.lavados.serie).toHaveLength(12);
    expect(meses.body.lavados.serie.slice(-3)).toEqual([
      { clave: '2026-11', cantidad: 3 },
      { clave: '2026-12', cantidad: 2 },
      { clave: '2027-01', cantidad: 2 },
    ]);

    const vacio = await admin.get('/api/admin/consumo?desde=2026-01-01&hasta=2026-01-31');
    expect(vacio.body).toMatchObject({ lavados: { total: 0 }, porInsumo: [], costoInsumos: 0, costoPorLavado: null });
  });

  it('por omisión el mes actual de La Rioja; errores de rango como /estadisticas; el empleado recibe 403 antes de validar', async () => {
    const { admin, empleado } = await equipo();
    const r = await admin.get('/api/admin/consumo');
    expect(r.body.rango).toEqual({ desde: '2026-10-01', hasta: '2026-10-16', agrupado: 'dia' });
    expect((await admin.get('/api/admin/consumo?desde=2026-13-01')).status).toBe(400);
    expect((await admin.get('/api/admin/consumo?desde=2026-10-10&hasta=2026-10-01')).body.error.fields.hasta).toBeDefined();
    expect((await admin.get('/api/admin/consumo?desde=2025-01-01&hasta=2026-10-01')).status).toBe(400);
    expect((await empleado.get('/api/admin/consumo')).status).toBe(403);
    expect((await empleado.get('/api/admin/consumo?desde=basura')).status).toBe(403);
  });

  it('agrupadoDeConsumo: día hasta 62, semana hasta 200, mes con más', () => {
    expect([1, 62, 63, 200, 201, 366].map(agrupadoDeConsumo)).toEqual(['dia', 'dia', 'semana', 'semana', 'mes', 'mes']);
  });
});

describe('permisos y esquema', () => {
  it('capacidades nuevas: inventario.recetas e inventario.consumo, solo admin y superadmin; push.activar con el texto nuevo', () => {
    const recetas = CAPACIDADES.find((c) => c.id === 'inventario.recetas');
    const consumo = CAPACIDADES.find((c) => c.id === 'inventario.consumo');
    expect(recetas?.texto).toBe('Definir qué insumos usa cada servicio');
    expect(consumo?.texto).toBe('Ver el consumo de insumos, la lista para comprar y los avisos de stock bajo');
    expect(CAPACIDADES.find((c) => c.id === 'push.activar')?.texto).toBe(
      'Activar los avisos en su propio dispositivo (turnos nuevos y, para admin y superadmin, stock bajo)',
    );
    for (const rol of ROLES) {
      expect(puedeDefinirRecetas(rol), rol).toBe(rol !== 'empleado');
      expect(puedeVerConsumoInventario(rol), rol).toBe(rol !== 'empleado');
      expect(recetas?.roles[rol]).toBe(rol === 'empleado' ? 'no' : 'si');
      expect(consumo?.roles[rol]).toBe(rol === 'empleado' ? 'no' : 'si');
    }
  });

  it('verifyPostgresSchema exige buddys.recetas, insumos.aviso_bajo_at y el tipo devolucion', async () => {
    const db = await createPgliteDatabase();
    try {
      await expect(verifyPostgresSchema(db.appSql)).resolves.toBeUndefined();
      await db.pg.exec(`
        ALTER TABLE buddys.movimientos_stock DROP CONSTRAINT movimientos_stock_tipo_valido;
        ALTER TABLE buddys.movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_valido CHECK (tipo IN ('compra', 'uso', 'ajuste')) NOT VALID;`);
      await expect(verifyPostgresSchema(db.appSql)).rejects.toThrow(/recetas_stock.*|tipo 'devolucion'/s);
      await db.pg.exec('ALTER TABLE buddys.insumos DROP COLUMN aviso_bajo_at; DROP TABLE buddys.recetas;');
      await expect(verifyPostgresSchema(db.appSql)).rejects.toThrow(/recetas, insumos\.aviso_bajo_at, tipo 'devolucion'/);
    } finally {
      await db.close();
    }
  });
});
