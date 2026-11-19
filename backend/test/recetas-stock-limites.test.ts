import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { PushSender } from '../src/domain/push.js';
import { generarClavesVapid } from '../src/scripts/vapid-cli.js';
import { type Client, type TestContext, addUser, closeAllContexts, createTestContext, loginClient } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Casos límite del objetivo D (reportes/2026-11-17_06_recetas-stock-avisos.md): servicios que comparten insumo,
 * decimales, deshacer después de cambios en el medio, orden cruzado de bloqueos, idLocal repetido, bordes de los
 * avisos y del resumen de consumo. Complementa recetas-stock.test.ts. NOW: 2026-10-16 12:00 en La Rioja.
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

async function equipo() {
  const send = vi.fn<PushSender['send']>(() => Promise.resolve());
  const context = await createTestContext({ config: { push: PUSH_CONFIG }, pushSender: { send } });
  await context.db.sql.query(
    "UPDATE buddys.servicios SET activo = true, vehiculos = ARRAY['auto','suv','pickup','moto'] WHERE id IN ('lavado-basico', 'encerado', 'pulido')",
  );
  await addUser(context, { email: 'dueno@l.test', rol: 'superadmin', nombre: 'Dueño' });
  await addUser(context, { email: 'ana@l.test', rol: 'admin', nombre: 'Ana' });
  const empleadoId = await addUser(context, { email: 'beto@l.test', rol: 'empleado', nombre: 'Beto' });
  return {
    context,
    admin: await loginClient(context, 'ana@l.test'),
    empleado: await loginClient(context, 'beto@l.test'),
    empleadoId,
    send,
  };
}

async function insumo(admin: Client, datos: Record<string, unknown>): Promise<string> {
  const r = await admin.post('/api/admin/insumos', { unidad: 'ml', ...datos });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.insumo.id);
}

async function receta(admin: Client, servicio: string, items: { insumoId: string; cantidad: number }[]) {
  const r = await admin.put(`/api/admin/servicios/${servicio}/receta`, { vehiculo: null, items });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

async function lavar(client: Client, servicioIds: string[]): Promise<string> {
  const r = await client.post('/api/admin/lavados', { servicioIds, vehiculoTipo: 'auto' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.lavado.id);
}

async function stockTexto(context: TestContext, id: string): Promise<string> {
  const { rows } = await context.db.sql.query('SELECT stock::text AS s FROM buddys.insumos WHERE id = $1::uuid', [id]);
  return String(rows[0]?.s);
}

async function stock(context: TestContext, id: string): Promise<number> {
  return Number(await stockTexto(context, id));
}

async function avisado(context: TestContext, id: string): Promise<boolean> {
  const { rows } = await context.db.sql.query('SELECT aviso_bajo_at IS NOT NULL AS ok FROM buddys.insumos WHERE id = $1::uuid', [id]);
  return rows[0]?.ok === true;
}

async function usos(context: TestContext, insumoId: string) {
  const { rows } = await context.db.sql.query(
    `SELECT tipo, cantidad::float8 AS cantidad, nota, turno_id::text AS turno_id, perfil_id::text AS perfil_id
     FROM buddys.movimientos_stock WHERE insumo_id = $1::uuid AND tipo IN ('uso', 'devolucion') ORDER BY created_at, id`,
    [insumoId],
  );
  return rows;
}

async function dispositivo(context: TestContext, email: string, nombre: string): Promise<void> {
  await context.db.sql.query(
    `INSERT INTO buddys.push_suscripciones (perfil_id, endpoint, p256dh, auth)
     SELECT id, $2, $3, $4 FROM buddys.perfiles WHERE email = $1`,
    [email, endpoint(nombre), P256DH, AUTH],
  );
}

describe('casos límite del stock', () => {
  it('tres servicios que comparten un insumo: un solo movimiento con la suma; deshacer devuelve esa suma', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    await receta(admin, 'encerado', [{ insumoId: shampoo, cantidad: 20 }]);
    await receta(admin, 'pulido', [{ insumoId: shampoo, cantidad: 30 }]);
    const id = await lavar(empleado, ['lavado-basico', 'encerado', 'pulido']);
    expect(await stock(context, shampoo)).toBe(40);
    expect(await usos(context, shampoo)).toMatchObject([{ tipo: 'uso', cantidad: -60, turno_id: id }]);
    await empleado.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await stock(context, shampoo)).toBe(100);
  });

  it('decimales: 0,1 + 0,2 descuenta 0,3 exacto, sin restos de coma flotante', async () => {
    const { context, admin } = await equipo();
    const cera = await insumo(admin, { nombre: 'Cera', unidad: 'litro', stockInicial: 1, stockMinimo: 0.7 });
    await receta(admin, 'lavado-basico', [{ insumoId: cera, cantidad: 0.1 }]);
    await receta(admin, 'encerado', [{ insumoId: cera, cantidad: 0.2 }]);
    const id = await lavar(admin, ['lavado-basico', 'encerado']);
    expect(await stockTexto(context, cera)).toBe('0.70');
    expect((await usos(context, cera))[0]).toMatchObject({ cantidad: -0.3 });
    // 0,7 == mínimo cuenta como bajo: cruzó y avisó.
    expect(await avisado(context, cera)).toBe(true);
    await admin.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await stockTexto(context, cera)).toBe('1.00');
    // Deshacer devuelve el stock pero no rearma el aviso (lo rearman compra, ajuste o cambio de mínimo).
    expect(await avisado(context, cera)).toBe(true);
  });

  it('corregir dos veces (con una compra en el medio) y deshacer no devuelve de más; un segundo DELETE da 404', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    await receta(admin, 'encerado', [{ insumoId: shampoo, cantidad: 25 }]);
    const id = await lavar(admin, ['lavado-basico']);
    await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['encerado'] }).expect(200);
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 7 }).expect(201);
    await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['lavado-basico'] }).expect(200);
    expect(await stock(context, shampoo)).toBe(97);
    await admin.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await stock(context, shampoo)).toBe(107);
    expect((await admin.delete(`/api/admin/lavados/${id}`)).status).toBe(404);
    expect(await stock(context, shampoo)).toBe(107);
  });

  it('insumo desactivado y receta borrada entre el lavado y el deshacer: igual devuelve lo descontado', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    const cera = await insumo(admin, { nombre: 'Cera', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }, { insumoId: cera, cantidad: 5 }]);
    const id = await lavar(admin, ['lavado-basico']);
    await admin.patch(`/api/admin/insumos/${shampoo}`, { activo: false }).expect(200);
    await receta(admin, 'lavado-basico', []);
    await admin.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await stock(context, shampoo)).toBe(100);
    expect(await stock(context, cera)).toBe(100);
  });

  it('lavados a la vez con insumos en orden cruzado (A,B y B,A) no se traban y el stock final es correcto', async () => {
    const { context, admin, empleado } = await equipo();
    const a = await insumo(admin, { nombre: 'A', stockInicial: 500 });
    const b = await insumo(admin, { nombre: 'B', stockInicial: 500 });
    await receta(admin, 'lavado-basico', [{ insumoId: a, cantidad: 1 }, { insumoId: b, cantidad: 2 }]);
    await receta(admin, 'encerado', [{ insumoId: b, cantidad: 3 }, { insumoId: a, cantidad: 4 }]);
    const respuestas = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 === 0 ? admin : empleado).post('/api/admin/lavados', {
          servicioIds: i % 2 === 0 ? ['lavado-basico'] : ['encerado'],
          vehiculoTipo: 'auto',
        }),
      ),
    );
    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(await stock(context, a)).toBe(500 - 3 * 1 - 3 * 4);
    expect(await stock(context, b)).toBe(500 - 3 * 2 - 3 * 3);
  });

  it('el lavado del empleado descuenta aunque el empleado no pueda gestionar inventario', async () => {
    const { context, admin, empleado, empleadoId } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    expect((await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 1 })).status).toBe(403);
    await lavar(empleado, ['lavado-basico']);
    expect(await stock(context, shampoo)).toBe(90);
    expect((await usos(context, shampoo))[0]).toMatchObject({ perfil_id: empleadoId });
  });

  it('doble envío del mismo idLocal (seguido y a la vez): un solo lavado y un solo descuento por idLocal', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    const body = { servicioIds: ['lavado-basico'], vehiculoTipo: 'auto', idLocal: '0b5c6f0e-8a43-4c1e-9d2a-3f1e2d4c5b6a' };
    const primero = await empleado.post('/api/admin/lavados', body);
    const segundo = await empleado.post('/api/admin/lavados', body);
    expect([primero.status, segundo.status]).toEqual([201, 200]);
    expect(segundo.body.lavado.id).toBe(primero.body.lavado.id);
    const otro = { ...body, idLocal: '1c6d7a1f-9b54-4d2f-8e3b-4a2f3e5d6c7b' };
    const juntos = await Promise.all([empleado.post('/api/admin/lavados', otro), empleado.post('/api/admin/lavados', otro)]);
    expect(juntos.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await stock(context, shampoo)).toBe(80);
    expect(await usos(context, shampoo)).toHaveLength(2);
  });

  it('doble clic en deshacer (dos DELETE a la vez): uno borra, el otro da 404, y se devuelve una sola vez', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    const id = await lavar(admin, ['lavado-basico']);
    const r = await Promise.all([admin.delete(`/api/admin/lavados/${id}`), admin.delete(`/api/admin/lavados/${id}`)]);
    expect(r.map((x) => x.status).sort()).toEqual([204, 404]);
    expect(await stock(context, shampoo)).toBe(100);
    expect((await usos(context, shampoo)).filter((m) => m.tipo === 'devolucion')).toHaveLength(1);
  });

  it('ids mal formados al deshacer o corregir: 404 y el stock no cambia', async () => {
    const { context, admin } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    expect((await admin.delete('/api/admin/lavados/no-es-uuid')).status).toBe(404);
    expect((await admin.delete('/api/admin/bookings/no-es-uuid')).status).toBe(404);
    expect((await admin.patch('/api/admin/bookings/no-es-uuid', { servicioIds: ['encerado'] })).status).toBe(404);
    expect(await stock(context, shampoo)).toBe(100);
  });
});

/*
 * Decisión del dueño (2026-11-19): un lavado de mostrador no se cancela ni sale de completado por PATCH (409); se
 * deshace desde la planilla, que devuelve el stock. Los turnos web siguen como siempre.
 */
const MOSTRADOR_NO_SE_CANCELA = 'Un lavado de mostrador no se cancela: deshacelo desde la planilla (así vuelve el stock).';

async function turnoWeb(context: TestContext): Promise<string> {
  const { rows } = await context.db.sql.query(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, origen)
     VALUES ('Cliente web', '3804123456', 'auto', 'lavado-basico', '2026-10-20', 'manana', 'pendiente', 'web')
     RETURNING id::text AS id`,
  );
  return String(rows[0]?.id);
}

describe('un lavado de mostrador no se cancela por PATCH', () => {
  it('cancelado, pendiente o confirmado: 409 con el mensaje; nada cambia, ni el stock; deshacerlo sí devuelve', async () => {
    const { context, admin, empleado } = await equipo();
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    const id = await lavar(admin, ['lavado-basico']);
    // El empleado solo puede completar: su 403 va antes.
    expect((await empleado.patch(`/api/admin/bookings/${id}`, { estado: 'cancelado' })).status).toBe(403);
    for (const cambio of [
      { estado: 'cancelado' },
      { estado: 'pendiente' },
      { estado: 'confirmado', notasInternas: 'x' },
      { estado: 'cancelado', servicioIds: ['encerado'] },
      // Por el camino de reprogramar también.
      { estado: 'confirmado', fechaConfirmada: '2026-10-20', franjaConfirmada: 'manana' },
    ]) {
      const r = await admin.patch(`/api/admin/bookings/${id}`, cambio);
      expect(r.status, JSON.stringify(cambio)).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'CONFLICT', message: MOSTRADOR_NO_SE_CANCELA });
    }
    const { rows } = await context.db.sql.query(
      'SELECT estado, notas_internas, servicio_id FROM buddys.bookings WHERE id = $1::uuid',
      [id],
    );
    expect(rows[0]).toEqual({ estado: 'completado', notas_internas: null, servicio_id: 'lavado-basico' });
    expect(await stock(context, shampoo)).toBe(90);
    // Seguir en completado (con nota) sí se puede.
    expect((await admin.patch(`/api/admin/bookings/${id}`, { estado: 'completado', notasInternas: 'ok' })).status).toBe(200);
    expect((await admin.patch('/api/admin/bookings/7b0c2a64-0f43-4a8e-9f37-2a1f1b9a0c11', { estado: 'cancelado' })).status).toBe(404);
    await admin.delete(`/api/admin/lavados/${id}`).expect(204);
    expect(await stock(context, shampoo)).toBe(100);
  });

  it('un turno web se sigue cancelando', async () => {
    const { context, admin } = await equipo();
    const id = await turnoWeb(context);
    const r = await admin.patch(`/api/admin/bookings/${id}`, { estado: 'cancelado' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.booking.estado).toBe('cancelado');
  });
});

describe('casos límite de los avisos', () => {
  it('una compra que deja el stock justo en el mínimo no limpia aviso_bajo_at ni repite el aviso', async () => {
    const { context, admin, send } = await equipo();
    await dispositivo(context, 'ana@l.test', 'ana');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 10, stockMinimo: 5 });
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 8 }).expect(201); // 10 -> 2
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 3 }).expect(201); // 2 -> 5
    expect(await stock(context, shampoo)).toBe(5);
    expect(await avisado(context, shampoo)).toBe(true);
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 1 }).expect(201);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  /*
   * Decisión del dueño (2026-11-19, regla 6): una salida avisa si el insumo queda bajo, no tenía aviso pendiente y el
   * stock bajó en ese pedido. Cubre subir el mínimo con el stock ya por debajo (y los insumos que ya estaban bajos
   * cuando se aplicó la migración): avisa en la próxima salida, una sola vez.
   */
  it('subir el mínimo con el stock ya por debajo no avisa al cambiarlo; avisa en la próxima salida y no se repite', async () => {
    const { context, admin, send } = await equipo();
    await dispositivo(context, 'ana@l.test', 'ana');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 10, stockMinimo: 5 });
    await admin.patch(`/api/admin/insumos/${shampoo}`, { stockMinimo: 20 }).expect(200);
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(await avisado(context, shampoo)).toBe(false);
    expect((await admin.get('/api/admin/insumos/alertas')).body.bajoStock).toBe(1);
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 1 }).expect(201); // 10 -> 9
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(await avisado(context, shampoo)).toBe(true);
    // Otra salida con el aviso pendiente no lo repite.
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'ajuste', stockReal: 8 }).expect(201);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    // Una compra que lo sube por encima del mínimo limpia la marca, y el próximo cruce vuelve a avisar.
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 16 }).expect(201); // 8 -> 24
    expect(await avisado(context, shampoo)).toBe(false);
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 5 }).expect(201); // 24 -> 19
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  it('un insumo bajo sin marca (como al aplicar la migración) avisa en la próxima receta o ajuste negativo, no en una subida', async () => {
    const { context, admin, send } = await equipo();
    await dispositivo(context, 'ana@l.test', 'ana');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 3, stockMinimo: 5 });
    const cera = await insumo(admin, { nombre: 'Cera', stockInicial: 3, stockMinimo: 5 });
    await context.db.sql.query('UPDATE buddys.insumos SET aviso_bajo_at = NULL');
    // Una subida que lo deja todavía bajo no avisa (el stock no bajó); un ajuste sin diferencia no es un movimiento.
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 1 }).expect(201); // 3 -> 4
    await admin.post(`/api/admin/insumos/${cera}/movimientos`, { tipo: 'ajuste', stockReal: 3 }).expect(200);
    await tick();
    expect(send).not.toHaveBeenCalled();
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 1 }]);
    await lavar(admin, ['lavado-basico']); // 4 -> 3
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({ tipo: 'stock', titulo: 'Queda poco: Shampoo' });
    await admin.post(`/api/admin/insumos/${cera}/movimientos`, { tipo: 'ajuste', stockReal: 2 }).expect(201);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    expect(JSON.parse(String(send.mock.calls[1]?.[1]))).toMatchObject({ titulo: 'Queda poco: Cera' });
  });

  it('corregir un lavado con la misma cantidad de receta no avisa aunque el insumo quede bajo sin marca', async () => {
    const { context, admin, send } = await equipo();
    await dispositivo(context, 'ana@l.test', 'ana');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 100, stockMinimo: 5 });
    await receta(admin, 'lavado-basico', [{ insumoId: shampoo, cantidad: 10 }]);
    await receta(admin, 'encerado', [{ insumoId: shampoo, cantidad: 10 }]);
    const id = await lavar(admin, ['lavado-basico']);
    await admin.patch(`/api/admin/insumos/${shampoo}`, { stockMinimo: 95 }).expect(200);
    await admin.patch(`/api/admin/bookings/${id}`, { servicioIds: ['encerado'] }).expect(200);
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(await stock(context, shampoo)).toBe(90);
  });

  it('ni un empleado con dispositivo ni un admin dado de baja reciben avisos de stock', async () => {
    const { context, admin, send } = await equipo();
    await dispositivo(context, 'beto@l.test', 'beto');
    const bajaId = await addUser(context, { email: 'baja@l.test', rol: 'admin' });
    await dispositivo(context, 'baja@l.test', 'baja');
    await context.db.sql.query('UPDATE buddys.perfiles SET activo = false, eliminado_at = now() WHERE id = $1::uuid', [bajaId]);
    await dispositivo(context, 'dueno@l.test', 'dueno');
    const shampoo = await insumo(admin, { nombre: 'Shampoo', stockInicial: 10, stockMinimo: 5 });
    await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 8 }).expect(201);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    await tick();
    expect(send.mock.calls.map(([destino]) => destino.endpoint)).toEqual([endpoint('dueno')]);
  });
});

describe('casos límite del consumo', () => {
  it('63 días va por semana y 201 por mes; 23:30 de La Rioja cae en su día con el proceso en UTC; bisiestos', async () => {
    const tzAntes = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const { context, admin } = await equipo();
      const shampoo = await insumo(admin, { nombre: 'Shampoo', costoUnitario: 2 });
      // 30/11 23:30 en La Rioja = 01/12 02:30 UTC.
      await context.db.sql.query(
        "INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, created_at) VALUES ($1::uuid, 'uso', -4, '2026-11-30T23:30:00-03:00')",
        [shampoo],
      );
      const noviembre = await admin.get('/api/admin/consumo?desde=2026-11-01&hasta=2026-11-30');
      expect(noviembre.body.porInsumo).toEqual([{ insumoId: shampoo, nombre: 'Shampoo', unidad: 'ml', consumido: 4, costo: 8 }]);
      expect(noviembre.body.costoInsumos).toBe(8);
      expect(noviembre.body.costoPorLavado).toBeNull();
      const diciembre = await admin.get('/api/admin/consumo?desde=2026-12-01&hasta=2026-12-31');
      expect(diciembre.body.porInsumo).toEqual([]);

      const conDias = await admin.get('/api/admin/consumo?desde=2026-11-01&hasta=2027-01-01');
      expect(conDias.body.rango.agrupado).toBe('dia');
      expect(conDias.body.lavados.serie).toHaveLength(62);
      expect((await admin.get('/api/admin/consumo?desde=2026-11-01&hasta=2027-01-02')).body.rango.agrupado).toBe('semana');
      expect((await admin.get('/api/admin/consumo?desde=2026-01-01&hasta=2026-07-19')).body.rango.agrupado).toBe('semana');
      const conMeses = await admin.get('/api/admin/consumo?desde=2026-01-01&hasta=2026-07-20');
      expect(conMeses.body.rango.agrupado).toBe('mes');
      expect(conMeses.body.lavados.serie.map((p: { clave: string }) => p.clave)).toEqual([
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
      ]);
      // Bisiesto: 2028-02-29 existe; 2027-02-29 no.
      expect((await admin.get('/api/admin/consumo?desde=2028-02-01&hasta=2028-02-29')).body.lavados.serie).toHaveLength(29);
      expect((await admin.get('/api/admin/consumo?desde=2027-02-29&hasta=2027-03-01')).status).toBe(400);
    } finally {
      if (tzAntes === undefined) delete process.env.TZ;
      else process.env.TZ = tzAntes;
    }
  });

  it('el empleado recibe 403 en consumo, alertas y para comprar con cualquier parámetro, sin montos', async () => {
    const { empleado } = await equipo();
    for (const url of [
      '/api/admin/consumo?desde=2026-99-99&hasta=x',
      '/api/admin/consumo?desde[]=1',
      '/api/admin/insumos/alertas?x=1',
      '/api/admin/insumos/para-comprar',
    ]) {
      const r = await empleado.get(url);
      expect(r.status, url).toBe(403);
      expect(JSON.stringify(r.body)).not.toMatch(/costo|monto/i);
    }
  });
});
