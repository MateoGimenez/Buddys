import { afterEach, describe, expect, it } from 'vitest';
import { closeAllContexts, createTestContext, loginAs } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Contrato 2026-11-15 (reportes/2026-11-15_03_contrato-mejoras.md): etapas del auto (9), descuentos (12), turnos con
 * seña (8) e historial/búsqueda de clientes (6). Siempre: el empleado nunca recibe importes.
 */

const LAVADO = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;

describe('etapas del auto en el lavadero (función 9)', () => {
  it('nace entregado por defecto o en la etapa pedida, con su link de WhatsApp', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const ya = await admin.post('/api/admin/lavados', { ...LAVADO, monto: 1000 });
    expect(ya.status).toBe(201);
    expect(ya.body.lavado).toMatchObject({ etapa: 'entregado', whatsappListo: null, descuento: 0, sena: null, saldo: 1000 });
    const espera = await admin.post('/api/admin/lavados', {
      ...LAVADO,
      etapa: 'espera',
      nombre: 'Juan Pérez',
      telefono: '0380 15-4123456',
      vehiculoModelo: 'Gol AB123CD',
    });
    expect(espera.body.lavado.etapa).toBe('espera');
    const link = String(espera.body.lavado.whatsappListo);
    expect(link.startsWith('https://wa.me/5493804123456?text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1] ?? '')).toBe(
      'Hola Juan! Tu Gol AB123CD ya está listo en Buddys Wash Detail: ya podés pasar a retirarlo.',
    );
  });

  it('sin nombre ni modelo el mensaje saluda sin nombre y usa el tipo de vehículo', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const r = await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'moto', telefono: '3804123456' });
    expect(decodeURIComponent(String(r.body.lavado.whatsappListo).split('text=')[1] ?? '')).toBe(
      'Hola! Tu moto ya está listo en Buddys Wash Detail: ya podés pasar a retirarlo.',
    );
  });

  it('en curso: los de hoy no entregados, por etapa; PATCH avanza y retrocede', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const a = await admin.post('/api/admin/lavados', { ...LAVADO, etapa: 'lavando' });
    const b = await admin.post('/api/admin/lavados', { ...LAVADO, etapa: 'espera' });
    await admin.post('/api/admin/lavados', { ...LAVADO });
    let curso = await admin.get('/api/admin/lavados/en-curso');
    expect(curso.status).toBe(200);
    expect(curso.body.resumen).toEqual({ espera: 1, lavando: 1, listo: 0 });
    expect(curso.body.lavados.map((l: { id: string }) => l.id)).toEqual([b.body.lavado.id, a.body.lavado.id]);

    context.clock.current = new Date(context.clock.current.getTime() + 60_000);
    const listo = await admin.patch(`/api/admin/lavados/${String(a.body.lavado.id)}/etapa`, { etapa: 'listo' });
    expect(listo.status).toBe(200);
    expect(listo.body.lavado).toMatchObject({ etapa: 'listo', etapaDesde: context.clock.current.toISOString() });
    const vuelve = await admin.patch(`/api/admin/lavados/${String(a.body.lavado.id)}/etapa`, { etapa: 'entregado' });
    expect(vuelve.body.lavado.etapa).toBe('entregado');
    curso = await admin.get('/api/admin/lavados/en-curso');
    expect(curso.body.resumen).toEqual({ espera: 1, lavando: 0, listo: 0 });
  });

  it('el empleado mueve solo los suyos; 400 con una etapa inválida; 404 en un turno web', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const { client: otro } = await loginAs(context, 'empleado', 'otro@buddys.test');
    const suyo = await empleado.post('/api/admin/lavados', { ...LAVADO, etapa: 'espera' });
    const ajeno = await admin.post('/api/admin/lavados', { ...LAVADO, etapa: 'espera' });
    expect((await empleado.patch(`/api/admin/lavados/${String(suyo.body.lavado.id)}/etapa`, { etapa: 'lavando' })).status).toBe(200);
    const r = await empleado.patch(`/api/admin/lavados/${String(ajeno.body.lavado.id)}/etapa`, { etapa: 'lavando' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe('Solo podés cambiar la etapa de tus lavados.');
    expect((await otro.patch(`/api/admin/lavados/${String(suyo.body.lavado.id)}/etapa`, { etapa: 'listo' })).status).toBe(403);
    const mal = await admin.patch(`/api/admin/lavados/${String(suyo.body.lavado.id)}/etapa`, { etapa: 'volando' });
    expect(mal.status).toBe(400);
    expect(mal.body.error.fields.etapa).toBeDefined();
    const { rows } = await context.db.sql.query(
      "INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja) VALUES ('X', '12345678', 'auto', 'pulido', '2026-10-20', 'manana') RETURNING id::text AS id",
    );
    expect((await admin.patch(`/api/admin/lavados/${String(rows[0]?.id)}/etapa`, { etapa: 'listo' })).status).toBe(404);
  });
});

describe('descuentos (función 12)', () => {
  it('el admin carga descuento con motivo; el empleado no lo carga ni lo ve', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const r = await admin.post('/api/admin/lavados', { ...LAVADO, monto: 9000, descuento: 1000, descuentoMotivo: 'Cliente frecuente' });
    expect(r.status).toBe(201);
    expect(r.body.lavado).toMatchObject({ monto: 9000, descuento: 1000, descuentoMotivo: 'Cliente frecuente' });

    const sinMotivo = await admin.post('/api/admin/lavados', { ...LAVADO, monto: 9000, descuento: 1000 });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.error.fields.descuentoMotivo).toBe('Escribí el motivo del descuento.');
    const motivoSolo = await admin.post('/api/admin/lavados', { ...LAVADO, descuentoMotivo: 'x' });
    expect(motivoSolo.body.error.fields.descuentoMotivo).toBe('Sin descuento no va motivo.');
    const tope = await admin.post('/api/admin/lavados', { ...LAVADO, monto: 99_999_999, descuento: 1, descuentoMotivo: 'x' });
    expect(tope.body.error.fields.descuento).toBeDefined();

    const emp = await empleado.post('/api/admin/lavados', { ...LAVADO, monto: 9000, descuento: 500, descuentoMotivo: 'x' });
    expect(emp.status).toBe(403);
    expect(emp.body.error.message).toBe('Con tu rol no podés cargar descuentos: lo carga un administrador.');

    const planilla = await empleado.get('/api/admin/lavados');
    const visto = planilla.body.lavados.find((l: { id: string }) => l.id === r.body.lavado.id);
    expect(visto).toMatchObject({ monto: null, descuento: null, descuentoMotivo: null, saldo: null });
  });

  it('PATCH: corrige el descuento (sin mover updated_at), se borra si sale de completado y cuenta en estadísticas', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const r = await admin.post('/api/admin/lavados', { ...LAVADO, monto: 9000 });
    const id = String(r.body.lavado.id);
    context.clock.current = new Date(context.clock.current.getTime() + 60_000);
    const p = await admin.patch(`/api/admin/bookings/${id}`, { descuento: 2000, descuentoMotivo: 'Promo' });
    expect(p.status).toBe(200);
    expect(p.body.booking).toMatchObject({ descuento: 2000, descuentoMotivo: 'Promo', updatedAt: r.body.lavado.updatedAt });
    expect((await empleado.patch(`/api/admin/bookings/${id}`, { descuento: 0 })).status).toBe(403);
    expect((await admin.patch(`/api/admin/bookings/${id}`, { descuentoMotivo: 'x' })).status).toBe(400);
    const stats = await admin.get('/api/admin/estadisticas');
    expect(stats.body.periodo.descuentos).toBe(2000);
    const pend = await admin.patch(`/api/admin/bookings/${id}`, { estado: 'pendiente' });
    expect(pend.body.booking).toMatchObject({ descuento: 0, descuentoMotivo: null });
  });
});

describe('turnos con seña desde el panel (función 8)', () => {
  const turno = {
    nombre: 'Juan Pérez',
    telefono: '+54 9 380 412-3456',
    vehiculoTipo: 'auto',
    vehiculoModelo: 'Corolla AB123CD',
    servicioIds: ['pulido', 'encerado'],
    fecha: '2026-10-20',
    franja: 'manana',
    sena: { monto: 20000, formaPago: 'transferencia' },
  };

  it('el admin lo crea confirmado con seña; el empleado no puede y no ve la plata', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const r = await admin.post('/api/admin/turnos', turno);
    expect(r.status).toBe(201);
    expect(r.body.turno).toMatchObject({
      origen: 'panel',
      estado: 'confirmado',
      etapa: null,
      sena: { monto: 20000, formaPago: 'transferencia', fecha: '2026-10-16' },
      servicios: [{ id: 'pulido' }, { id: 'encerado' }],
    });
    const e = await empleado.post('/api/admin/turnos', turno);
    expect(e.status).toBe(403);
    const agenda = await empleado.get('/api/admin/agenda?desde=2026-10-19&hasta=2026-10-25');
    expect(agenda.body.turnos[0].sena).toEqual({ monto: null, formaPago: 'transferencia', fecha: '2026-10-16' });
  });

  it('al completarlo el monto es el total, el saldo descuenta la seña y no puede ser menor que la seña', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const id = String((await admin.post('/api/admin/turnos', turno)).body.turno.id);
    const menor = await admin.patch(`/api/admin/bookings/${id}`, { estado: 'completado', monto: 10000 });
    expect(menor.status).toBe(400);
    expect(menor.body.error.fields.monto).toBe('El total no puede ser menor que la seña que ya se cobró.');
    const ok = await admin.patch(`/api/admin/bookings/${id}`, { estado: 'completado', monto: 50000 });
    expect(ok.body.booking).toMatchObject({ monto: 50000, saldo: 30000 });
    const put = await admin.put(`/api/admin/turnos/${id}/sena`, { monto: 60000, formaPago: 'efectivo' });
    expect(put.status).toBe(400);
    expect((await admin.delete(`/api/admin/turnos/${id}/sena`)).status).toBe(204);
  });

  it('valida la seña (fecha futura, forma de pago) y los servicios', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const r = await admin.post('/api/admin/turnos', { ...turno, sena: { monto: 1, formaPago: 'bitcoin', fecha: '2026-10-17' } });
    expect(r.status).toBe(400);
    expect(r.body.error.fields['sena.formaPago']).toBeDefined();
    expect(r.body.error.fields['sena.fecha']).toBeDefined();
    const s = await admin.post('/api/admin/turnos', { ...turno, servicioIds: ['no-existe'] });
    expect(s.status).toBe(400);
    expect(s.body.error.fields.servicioIds).toBeDefined();
  });
});

describe('historial y búsqueda de clientes (función 6)', () => {
  it('por teléfono y por patente, con resumen; el empleado sin total gastado', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    const { client: empleado } = await loginAs(context, 'empleado');
    const datos = { ...LAVADO, nombre: 'Juan', telefono: '0380 15-4123456', vehiculoModelo: 'Gol AB-123-CD' };
    await admin.post('/api/admin/lavados', { ...datos, monto: 10000 });
    await admin.post('/api/admin/lavados', { ...datos, servicioIds: ['lavado-basico', 'encerado'], servicioId: undefined, monto: 5000 });
    await admin.post('/api/admin/lavados', { ...LAVADO, vehiculoModelo: 'Fiat AB 123 CD', monto: 3000 });

    const tel = await admin.get('/api/admin/clientes/historial?telefono=0380%2015-4123456');
    expect(tel.status).toBe(200);
    expect(tel.body.cliente).toMatchObject({
      tipo: 'telefono',
      clave: '5493804123456',
      nombre: 'Juan',
      visitas: 2,
      ultimaVisita: '2026-10-16',
      totalGastado: 15000,
      vehiculos: ['Gol AB-123-CD'],
    });
    expect(tel.body.cliente.serviciosMasHechos[0]).toMatchObject({ servicioId: 'lavado-basico', cantidad: 2 });
    expect(tel.body.cliente.sellos).toMatchObject({ visitas: 2, sellos: 2, cada: 10, faltan: 8, proximoEsPremio: false });
    expect(tel.body.total).toBe(2);

    const pat = await empleado.get('/api/admin/clientes/historial?patente=ab123cd');
    expect(pat.body.cliente).toMatchObject({ tipo: 'patente', clave: 'AB123CD', visitas: 3, totalGastado: null });
    expect(pat.body.lavados.every((l: { monto: unknown }) => l.monto === null)).toBe(true);

    const busqueda = await admin.get('/api/admin/bookings?q=ab%20123%20cd');
    expect(busqueda.body.total).toBe(3);
    expect((await admin.get('/api/admin/clientes/historial?patente=ZZZ999')).status).toBe(404);
    const dos = await admin.get('/api/admin/clientes/historial?patente=AB123CD&telefono=3804123456');
    expect(dos.status).toBe(400);
    expect(dos.body.error.fields.telefono).toBe('Mandá telefono o patente, uno solo.');
  });

  it('la búsqueda por patente escapa los comodines', async () => {
    const context = await createTestContext();
    const { client: admin } = await loginAs(context, 'admin');
    await admin.post('/api/admin/lavados', { ...LAVADO, vehiculoModelo: 'Gol AB123CD' });
    expect((await admin.get('/api/admin/bookings?q=%25%25%25%25%25')).body.total).toBe(0);
    expect((await admin.get('/api/admin/bookings?q=_____')).body.total).toBe(0);
  });
});
