import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushSender } from '../src/domain/push.js';
import { armarCsv } from '../src/lib/csv.js';
import { sinDatosPersonales } from '../src/routes/errores-cliente.js';
import { createPostgresRepositories } from '../src/repositories/index.js';
import { CajaService } from '../src/services/caja.js';
import { addUser, closeAllContexts, createClient, createTestContext, loginAs } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Contrato 2026-11-15 (reportes/2026-11-15_03_contrato-mejoras.md): gastos fijos (10), cierre de caja (11), tarjeta de
 * sellos e inactivos (14), insumos que se descuentan solos (15), CSV (16), errores del panel (26) y avisos push (7).
 */

const LAVADO = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('gastos fijos mensuales (función 10)', () => {
  it('el superadmin los carga; cuentan el día 1 de cada mes en estadísticas sin tocar el listado de gastos', async () => {
    const context = await createTestContext();
    const { client: dueno, id: duenoId } = await loginAs(context, 'superadmin');
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado, id: empId } = await loginAs(context, 'empleado');
    const r = await dueno.post('/api/admin/gastos-fijos', {
      concepto: 'Sueldo de Beto',
      monto: 300000,
      categoria: 'sueldos',
      perfilId: empId,
      desde: '2026-09',
    });
    expect(r.status).toBe(201);
    expect(r.body.gastoFijo).toMatchObject({ activo: true, desde: '2026-09', hasta: null, perfil: { id: empId } });
    await dueno.post('/api/admin/gastos-fijos', { concepto: 'Alquiler', monto: 100000, categoria: 'alquiler' });

    const lista = await admin.get('/api/admin/gastos-fijos');
    expect(lista.body.totalMensual).toBe(400000);
    expect((await admin.post('/api/admin/gastos-fijos', { concepto: 'x', monto: 1, categoria: 'otros' })).status).toBe(403);
    expect((await empleado.get('/api/admin/gastos-fijos')).status).toBe(403);

    const stats = await admin.get('/api/admin/estadisticas?desde=2026-09-01&hasta=2026-10-16');
    expect(stats.body.periodo).toMatchObject({ gastos: 700000, gastosFijos: 700000 });
    expect(stats.body.gastosPorCategoria).toEqual([
      { categoria: 'sueldos', monto: 600000 },
      { categoria: 'alquiler', monto: 100000 },
    ]);
    expect((await admin.get('/api/admin/gastos')).body.total).toBe(0);
    const hoy = await admin.get('/api/admin/estadisticas?desde=2026-10-02&hasta=2026-10-16');
    expect(hoy.body.periodo.gastosFijos).toBe(0);

    const baja = await dueno.patch(`/api/admin/gastos-fijos/${String(r.body.gastoFijo.id)}`, { activo: false });
    expect(baja.body.gastoFijo).toMatchObject({ activo: true, hasta: '2026-10' });
    const noviembre = await admin.get('/api/admin/estadisticas?desde=2026-11-01&hasta=2026-11-30');
    expect(noviembre.status).toBe(200);
    expect(duenoId).toBeDefined();
    expect((await dueno.patch(`/api/admin/gastos-fijos/${String(r.body.gastoFijo.id)}`, { hasta: '2026-01' })).status).toBe(400);
    expect((await dueno.delete(`/api/admin/gastos-fijos/${String(r.body.gastoFijo.id)}`)).status).toBe(204);
  });
});

describe('cierre de caja con arqueo (función 11)', () => {
  it('compara lo contado con lo esperado (lavados + señas), un cierre por día, corregir solo el superadmin', async () => {
    const context = await createTestContext();
    const { client: dueno } = await loginAs(context, 'superadmin');
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 15000, formaPago: 'efectivo' });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 5000, formaPago: 'transferencia' });
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 2000 });
    await admin.post('/api/admin/turnos', {
      nombre: 'Juan',
      telefono: '3804123456',
      vehiculoTipo: 'auto',
      servicioIds: ['pulido'],
      fecha: '2026-10-20',
      franja: 'manana',
      sena: { monto: 10000, formaPago: 'efectivo' },
    });

    const abierta = await admin.get('/api/admin/caja');
    expect(abierta.body).toMatchObject({ fecha: '2026-10-16', cierre: null });
    expect(abierta.body.esperado).toMatchObject({ sinIndicar: 2000, total: 32000 });
    expect(abierta.body.esperado.formas).toContainEqual({ formaPago: 'efectivo', esperado: 25000 });

    const cierra = await admin.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 24500, transferencia: 5000 }, nota: 'Faltan 500' });
    expect(cierra.status).toBe(201);
    expect(cierra.body.cierre).toMatchObject({ diferencia: -500, contadoTotal: 29500, nota: 'Faltan 500', cambiosDespues: false });
    expect(cierra.body.cierre.formas).toContainEqual({ formaPago: 'debito', esperado: 0, contado: null, diferencia: null });

    const otra = await admin.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 25000 } });
    expect(otra.status).toBe(403);
    expect((await admin.delete('/api/admin/caja/2026-10-16')).status).toBe(403);
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 1000, formaPago: 'efectivo' });
    expect((await admin.get('/api/admin/caja')).body.cierre.cambiosDespues).toBe(true);
    const corrige = await dueno.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 26000, transferencia: 5000 } });
    expect(corrige.status).toBe(200);
    expect(corrige.body.cierre.diferencia).toBe(0);

    expect((await admin.get('/api/admin/caja/cierres')).body.total).toBe(1);
    expect((await empleado.get('/api/admin/caja')).status).toBe(403);
    expect((await admin.put('/api/admin/caja/2026-10-17', { contado: { efectivo: 0 } })).status).toBe(400);
    expect((await admin.put('/api/admin/caja/2026-10-15', { contado: {} })).status).toBe(400);
    expect((await dueno.delete('/api/admin/caja/2026-10-16')).status).toBe(204);
  });
});

describe('tarjeta de sellos e inactivos (función 14)', () => {
  it('la configura solo el superadmin y el progreso sigue la config', async () => {
    const context = await createTestContext();
    const { client: dueno } = await loginAs(context, 'superadmin');
    const { client: admin } = await loginAs(context, 'admin');
    expect((await admin.get('/api/admin/fidelizacion')).body.config).toMatchObject({ sellosCada: 10, premio: 'gratis', inactivosDias: 30 });
    expect((await admin.put('/api/admin/fidelizacion', { sellosCada: 3, premio: 'gratis', inactivosDias: 30 })).status).toBe(403);
    const malo = await dueno.put('/api/admin/fidelizacion', { sellosCada: 3, premio: 'descuento', inactivosDias: 30 });
    expect(malo.body.error.fields.premioPorcentaje).toBeDefined();
    const ok = await dueno.put('/api/admin/fidelizacion', { sellosCada: 2, premio: 'descuento', premioPorcentaje: 50, inactivosDias: 30 });
    expect(ok.status).toBe(200);
    for (let i = 0; i < 2; i++) await admin.post('/api/admin/lavados', { ...LAVADO, telefono: '3804123456' });
    const h = await admin.get('/api/admin/clientes/historial?telefono=3804123456');
    expect(h.body.cliente.sellos).toEqual({ visitas: 2, sellos: 2, cada: 2, faltan: 0, proximoEsPremio: true, premio: 'descuento', porcentaje: 50 });
  });

  it('inactivos: con teléfono, hace 30 días o más, sin turno futuro, con link "te extrañamos"', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-09-15', nombre: 'Ana Gómez', telefono: '3804111111', vehiculoModelo: 'Gol' });
    await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-10-05', telefono: '3804222222' });
    await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-09-20' });
    const r = await admin.get('/api/admin/clientes/inactivos');
    expect(r.status).toBe(200);
    expect(r.body.dias).toBe(30);
    expect(r.body.total).toBe(1);
    expect(r.body.clientes[0]).toMatchObject({ telefonoWhatsapp: '5493804111111', nombre: 'Ana Gómez', diasSinVenir: 31, visitas: 1 });
    expect(decodeURIComponent(String(r.body.clientes[0].whatsapp).split('text=')[1] ?? '')).toBe(
      'Hola Ana! Hace un tiempo que no te vemos por Buddys Wash Detail. ¿Le damos una mano a tu Gol? Te esperamos.',
    );
    expect((await admin.get('/api/admin/clientes/inactivos?dias=7')).body.total).toBe(2);
    expect((await empleado.get('/api/admin/clientes/inactivos')).status).toBe(403);
  });
});

describe('exportar a CSV (función 16)', () => {
  it('UTF-8 con BOM, punto y coma, coma decimal y sin fórmulas; el empleado no exporta', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    await admin.post('/api/admin/lavados', { ...LAVADO, monto: 15000, nombre: '=HYPERLINK("x")', formaPago: 'efectivo' });
    await admin.post('/api/admin/gastos', { fecha: '2026-10-16', categoria: 'insumos', descripcion: 'Cera; grande', monto: 1500 });
    const r = await admin.get('/api/admin/exportar/planilla.csv?desde=2026-10-01&hasta=2026-10-31');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toBe('attachment; filename="planilla_2026-10-01_2026-10-31.csv"');
    expect(r.text.startsWith('﻿Fecha;Franja;')).toBe(true);
    expect(r.text).toContain(`;"'=HYPERLINK(""x"")";`);
    expect(r.text).toContain(';efectivo;15000;0;;;15000\r\n');
    const g = await admin.get('/api/admin/exportar/gastos.csv?desde=2026-10-01&hasta=2026-10-31');
    expect(g.text).toContain('2026-10-16;manual;insumos;"Cera; grande";;1500');
    const e = await admin.get('/api/admin/exportar/estadisticas.csv?desde=2026-10-01&hasta=2026-10-31');
    expect(e.text).toContain('Margen;0,9');
    expect((await empleado.get('/api/admin/exportar/planilla.csv?desde=2026-10-01&hasta=2026-10-31')).status).toBe(403);
    expect((await admin.get('/api/admin/exportar/planilla.csv?desde=2026-10-31&hasta=2026-10-01')).status).toBe(400);
    expect(armarCsv([[-500, 1.5, '-x', '+y', '@z']])).toBe("﻿-500;1,5;'-x;'+y;'@z\r\n");
  });
});

describe('errores del panel (función 26)', () => {
  it('con y sin sesión: 204, una línea recortada sin datos personales, nada en la base', async () => {
    const context = await createTestContext();
    const { client: admin, id } = await loginAs(context, 'admin');
    const body = {
      mensaje: 'Falló para juan@mail.com tel 3804123456',
      stack: 'Error: x\n at a\n at b\n at c\n at d',
      url: 'http://localhost:5173/admin/planilla?telefono=3804123456',
      userAgent: 'Mozilla/5.0',
      version: '1.2.3',
    };
    expect((await admin.post('/api/admin/errores-cliente', body)).status).toBe(204);
    expect((await createClient(context.app).post('/api/errores-cliente', body)).status).toBe(204);
    const lineas = context.logger.lines.filter((l) => l.includes('Error del panel'));
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain(`usuario=${id}`);
    expect(lineas[1]).toContain('usuario=anonimo');
    expect(context.logger.text).not.toMatch(/juan@mail|3804123456/);
    expect(lineas[0]).toContain('url=/admin/planilla ');
    expect(lineas[0]).not.toContain('at d');
    expect((await admin.post('/api/admin/errores-cliente', { mensaje: 'x' })).status).toBe(400);
    expect((await admin.post('/api/admin/errores-cliente', { ...body, extra: 1 })).status).toBe(400);
    expect(sinDatosPersonales('token eyJhbGciOi.eyJzdWIi.firma')).toBe('token [token]');
  });

  it('sin sesión hay rate limit estricto por IP', async () => {
    const context = await createTestContext({
      config: {
        rateLimits: {
          api: { windowMs: 60_000, limit: 1000 },
          bookings: { windowMs: 60_000, limit: 1000 },
          loginFailures: { windowMs: 60_000, limit: 1000 },
          loginFailuresIp: { windowMs: 60_000, limit: 1000 },
          perfilPassword: { windowMs: 60_000, limit: 1000 },
          perfilFoto: { windowMs: 60_000, limit: 1000 },
          lavados: { windowMs: 60_000, limit: 1000 },
          seguimiento: { windowMs: 60_000, limit: 1000 },
          pdf: { windowMs: 60_000, limit: 1000 },
          erroresCliente: { windowMs: 60_000, limit: 1000 },
          erroresClientePublico: { windowMs: 60_000, limit: 2 },
          fotos: { windowMs: 60_000, limit: 1000 },
        },
      },
    });
    const body = { mensaje: 'x', url: '/', userAgent: 'ua' };
    const client = createClient(context.app);
    expect((await client.post('/api/errores-cliente', body)).status).toBe(204);
    expect((await client.post('/api/errores-cliente', body)).status).toBe(204);
    expect((await client.post('/api/errores-cliente', body)).status).toBe(429);
  });
});

describe('avisos push al encargado (función 7)', () => {
  const PUSH = {
    publicKey: 'BOr1cr2rR8m6Xb3K0yYtRrpm8UZb1NUOM7Cb2kE9pSc3dYmV5xT8yS5D2uJ6pYJw6p5QeH0uNsVqvX3xW0lYbU0',
    privateKey: 'q2z4p6u7rDlqY9kW4lV8n0w3s5x7c1b3n5m7k9j1h3g',
    subject: 'mailto:dueno@buddys.test',
  };
  const P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
  const AUTH = Buffer.alloc(16, 9).toString('base64url');

  async function preparar() {
    const send = vi.fn<PushSender['send']>(() => Promise.resolve());
    const context = await createTestContext({ config: { push: PUSH }, pushSender: { send } });
    const dueno = await loginAs(context, 'superadmin');
    const admin = await loginAs(context, 'admin');
    const empleado = await loginAs(context, 'empleado');
    for (const [n, quien] of [dueno, admin, empleado].entries()) {
      await context.db.sql.query(
        'INSERT INTO buddys.push_suscripciones (perfil_id, endpoint, p256dh, auth) VALUES ($1::uuid, $2, $3, $4)',
        [quien.id, `https://fcm.googleapis.com/fcm/send/d${String(n)}`, P256DH, AUTH],
      );
    }
    return { context, send, dueno, admin, empleado };
  }

  it('lavado sin monto: avisa a los encargados menos a quien lo registró, nunca al empleado', async () => {
    const { send, admin } = await preparar();
    await admin.client.post('/api/admin/lavados', LAVADO);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/d0');
    const payload = JSON.parse(String(send.mock.calls[0]?.[1]));
    expect(payload).toEqual({ tipo: 'equipo', titulo: 'Lavado sin monto', cuerpo: 'Se registró un lavado sin monto: completalo desde la planilla.', url: '/admin/lavados', pendientes: 0 });
    send.mockClear();
    await admin.client.post('/api/admin/lavados', { ...LAVADO, monto: 100 });
    await tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('meta cumplida: un solo aviso por mes; cambiar la meta lo vuelve a habilitar', async () => {
    const { send, admin, dueno } = await preparar();
    await dueno.client.put('/api/admin/metas/2026-10', { trabajosObjetivo: 2 });
    await admin.client.post('/api/admin/lavados', { ...LAVADO, monto: 100 });
    await tick();
    expect(send).not.toHaveBeenCalled();
    await admin.client.post('/api/admin/lavados', { ...LAVADO, monto: 100 });
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({ titulo: '¡Meta cumplida!', cuerpo: 'Llegaron a la meta de octubre.' });
    send.mockClear();
    await admin.client.post('/api/admin/lavados', { ...LAVADO, monto: 100 });
    await tick();
    expect(send).not.toHaveBeenCalled();
    await dueno.client.put('/api/admin/metas/2026-10', { trabajosObjetivo: 4 });
    await admin.client.post('/api/admin/lavados', { ...LAVADO, monto: 100 });
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sin claves VAPID no hace nada ni falla', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'admin');
    expect((await client.post('/api/admin/lavados', LAVADO)).status).toBe(201);
    expect(context.logger.text).not.toContain('Aviso push');
  });
});

describe('auditoría de seguridad: caja concurrente y links de WhatsApp', () => {
  it('dos cierres simultáneos del mismo día: entra uno solo (201) y el otro es 409, sin pisar lo contado', async () => {
    const context = await createTestContext();
    const { client: a } = await loginAs(context, 'admin');
    const { client: b } = await loginAs(context, 'admin', 'admin2@buddys.test');
    await a.post('/api/admin/lavados', { ...LAVADO, monto: 15000, formaPago: 'efectivo' });
    const [r1, r2] = await Promise.all([
      a.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 15000 } }),
      b.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 1 } }),
    ]);
    // PGlite atiende de a un pedido: el segundo ya ve el cierre (403). En Postgres pueden cruzarse: ver el test de abajo.
    expect([r1.status, r2.status].sort()).toEqual([201, 403]);
    const ganador = r1.status === 201 ? r1 : r2;
    const guardado = (await a.get('/api/admin/caja')).body.cierre;
    expect(guardado.contadoTotal).toBe(ganador.body.cierre.contadoTotal);
  });

  it('en una carrera real (los dos leen "sin cierre"), el INSERT ON CONFLICT DO NOTHING deja entrar a uno y el otro es 409', async () => {
    const context = await createTestContext();
    const repos = createPostgresRepositories(context.db.appSql);
    // Simula la carrera: los dos pedidos leyeron que el día no tenía cierre antes de que el otro escribiera.
    const real = repos.caja;
    const caja: typeof real = {
      esperado: (fecha) => real.esperado(fecha),
      obtener: () => Promise.resolve(undefined),
      crear: (cierre) => real.crear(cierre),
      guardar: (cierre, now) => real.guardar(cierre, now),
      borrar: (fecha) => real.borrar(fecha),
      listar: (desde, hasta, limit, offset) => real.listar(desde, hasta, limit, offset),
    };
    const service = new CajaService({ caja, logger: context.logger, now: () => context.clock.current });
    const admin = { id: await addUser(context, { email: 'a@t.test', rol: 'admin' }), rol: 'admin' as const, email: 'a@t.test', nombre: null, sessionId: 's1', fotoVersion: null };
    const otro = { id: await addUser(context, { email: 'b@t.test', rol: 'admin' }), rol: 'admin' as const, email: 'b@t.test', nombre: null, sessionId: 's2', fotoVersion: null };
    const contado = (efectivo: number) => ({ contado: { efectivo, transferencia: null, debito: null, credito: null, otro: null }, nota: null });
    const resultados = await Promise.allSettled([service.cerrar(admin, '2026-10-16', contado(100)), service.cerrar(otro, '2026-10-16', contado(1))]);
    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rechazo = resultados.find((r) => r.status === 'rejected');
    expect(rechazo?.status === 'rejected' && rechazo.reason).toMatchObject({ status: 409, code: 'CONFLICT' });
    const guardado = await repos.caja.obtener('2026-10-16');
    const ganador = resultados.find((r) => r.status === 'fulfilled');
    expect(guardado?.contado.efectivo).toBe(ganador?.status === 'fulfilled' ? ganador.value.cierre.contadoTotal : -1);
    // El repositorio solo: un segundo crear no pisa nada.
    expect(await repos.caja.crear({ fecha: '2026-10-16', contado: contado(5).contado, esperado: { efectivo: 0, transferencia: 0, debito: 0, credito: 0, otro: 0 }, sinIndicar: 0, diferencia: 5, nota: null, cerradoPor: admin.id })).toBeUndefined();
  });

  it('el link descarta un nombre que no es solo letras y limpia el modelo; inactivos usa solo turnos completados', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const texto = (link: unknown) => decodeURIComponent(String(link).split('text=')[1] ?? '');
    const r = await admin.post('/api/admin/lavados', {
      ...LAVADO,
      nombre: 'https://evil.example/x',
      telefono: '3804123456',
      vehiculoModelo: 'Gol: visitá http://evil.example/premio ya mismo amigo',
    });
    expect(texto(r.body.lavado.whatsappListo)).toBe(
      'Hola! Tu Gol visitá http evil example p ya está listo en Buddys Wash Detail: ya podés pasar a retirarlo.',
    );
    const digitos = await admin.post('/api/admin/lavados', { ...LAVADO, nombre: 'Juan2 Pérez', telefono: '3804123456' });
    expect(texto(digitos.body.lavado.whatsappListo).startsWith('Hola! Tu auto')).toBe(true);

    await admin.post('/api/admin/lavados', { ...LAVADO, fecha: '2026-09-15', nombre: 'Ana', telefono: '3804111111', vehiculoModelo: 'Corsa' });
    // Un pedido web (texto de afuera, sin completar) del mismo teléfono: no tiene que entrar en el mensaje.
    await context.db.sql.query(
      `INSERT INTO buddys.bookings (nombre, telefono, telefono_whatsapp, vehiculo_tipo, vehiculo_modelo, servicio_id, fecha_preferida, franja, estado)
       VALUES ('Estafa', '3804111111', '5493804111111', 'auto', 'link malo', 'pulido', '2026-09-01', 'manana', 'cancelado')`,
    );
    const inactivos = await admin.get('/api/admin/clientes/inactivos');
    expect(inactivos.body.clientes[0]).toMatchObject({ nombre: 'Ana', vehiculoModelo: 'Corsa' });
    expect(texto(inactivos.body.clientes[0].whatsapp)).toContain('Hola Ana!');
  });
});
