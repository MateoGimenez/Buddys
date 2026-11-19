import { afterEach, describe, expect, it } from 'vitest';
import { type NewBooking, TurnoCerradoError } from '../src/domain/booking.js';
import { DestacadoInactivoError, type NuevoServicio, OrdenInvalidoError, ServicioExisteError } from '../src/domain/servicios.js';
import { ROLES, SinSuperadminError } from '../src/domain/perfil.js';
import { type Repositories, createPostgresRepositories } from '../src/repositories/index.js';
import { NOW } from './helpers.js';
import { type PgliteDatabase, createPgliteDatabase } from './pglite.js';

/**
 * Repositorios sobre Postgres (PGlite en memoria con las migraciones de supabase/migrations/), usados como el rol
 * dedicado de producción (buddys_app): si le faltara un GRANT o una policy, estos tests fallan.
 */

const opened: PgliteDatabase[] = [];
afterEach(async () => {
  for (const database of opened.splice(0)) await database.close();
});

async function open(): Promise<{ repositories: Repositories; db: PgliteDatabase }> {
  const db = await createPgliteDatabase();
  opened.push(db);
  return { repositories: createPostgresRepositories(db.appSql), db };
}

async function repos(): Promise<Repositories> {
  return (await open()).repositories;
}

function newBooking(overrides: Partial<NewBooking> = {}): NewBooking {
  return {
    nombre: 'Juan Pérez',
    telefono: '0380 15-4123456',
    email: 'juan@example.com',
    vehiculoTipo: 'auto',
    vehiculoModelo: 'Toyota Corolla',
    servicioId: 'pulido',
    fechaPreferida: '2026-10-20',
    franja: 'manana',
    comentario: 'Rayones en el capot',
    ...overrides,
  };
}

describe('turnos', () => {
  it('crea un turno pendiente y lo devuelve con el mismo mapeo (camelCase, fechas ISO, telefonoWhatsapp)', async () => {
    const { bookings } = await repos();

    const created = await bookings.create(newBooking(), NOW);
    const minimal = await bookings.create(
      newBooking({ email: null, vehiculoModelo: null, comentario: null, telefono: '12345678', franja: 'tarde' }),
      NOW,
    );

    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      nombre: 'Juan Pérez',
      telefono: '0380 15-4123456',
      telefonoWhatsapp: '5493804123456',
      email: 'juan@example.com',
      vehiculoTipo: 'auto',
      vehiculoModelo: 'Toyota Corolla',
      origen: 'web',
      servicioId: 'pulido',
      fechaPreferida: '2026-10-20',
      franja: 'manana',
      fechaConfirmada: null,
      franjaConfirmada: null,
      comentario: 'Rayones en el capot',
      estado: 'pendiente',
      notasInternas: null,
      turnosDelCliente: 1,
      monto: null,
      trabajador: null,
      registradoPor: null,
      formaPago: null,
      // El trigger bookings_servicio_principal le dio su fila en lavado_servicios (pulido: "Consultá").
      servicios: [{ id: 'pulido', nombre: 'Pulido', precioLista: null }],
      createdAt: '2026-10-16T15:00:00.000Z',
      updatedAt: '2026-10-16T15:00:00.000Z',
    });
    expect(minimal).toMatchObject({ email: null, vehiculoModelo: null, comentario: null, telefonoWhatsapp: null, turnosDelCliente: null });
  });

  it('lista más nuevos primero (estable con el mismo created_at), filtra por estado y pagina con total', async () => {
    const { bookings } = await repos();
    const ids: string[] = [];
    for (const nombre of ['Ana', 'Beto', 'Caro', 'Dani']) {
      ids.push((await bookings.create(newBooking({ nombre }), NOW)).id);
    }
    await bookings.updateEstado(ids[1] ?? '', 'confirmado', NOW);
    await bookings.updateEstado(ids[3] ?? '', 'confirmado', NOW);

    const all = await bookings.list({ limit: 50, offset: 0 });
    expect(all.total).toBe(4);
    expect(all.bookings.map((booking) => booking.nombre)).toEqual(['Dani', 'Caro', 'Beto', 'Ana']);

    const page = await bookings.list({ limit: 2, offset: 1 });
    expect(page).toMatchObject({ total: 4, bookings: [{ nombre: 'Caro' }, { nombre: 'Beto' }] });

    const confirmados = await bookings.list({ estado: 'confirmado', limit: 1, offset: 0 });
    expect(confirmados.total).toBe(2);
    expect(confirmados.bookings.map((booking) => booking.nombre)).toEqual(['Dani']);

    expect(await bookings.list({ estado: 'cancelado', limit: 50, offset: 0 })).toEqual({ bookings: [], total: 0 });
  });

  it('cambia el estado (y updatedAt), borra, y un id inexistente o mal formado no existe', async () => {
    const { bookings } = await repos();
    const { id } = await bookings.create(newBooking(), NOW);
    const later = new Date('2026-10-17T10:30:00.000Z');

    const updated = await bookings.updateEstado(id, 'completado', later);
    expect(updated).toMatchObject({ id, estado: 'completado', createdAt: NOW.toISOString(), updatedAt: later.toISOString() });

    const missing = '00000000-0000-4000-8000-000000000000';
    for (const unknown of [missing, 'no-es-un-uuid']) {
      expect(await bookings.updateEstado(unknown, 'cancelado', later)).toBeUndefined();
      expect(await bookings.delete(unknown)).toBe(false);
    }

    expect(await bookings.delete(id)).toBe(true);
    expect(await bookings.delete(id)).toBe(false);
    expect((await bookings.list({ limit: 50, offset: 0 })).total).toBe(0);
  });

  it('reprogramar guarda fecha/franja confirmadas (y el estado si viene), null vuelve a la pedida', async () => {
    const { bookings } = await repos();
    const { id } = await bookings.create(newBooking(), NOW);
    const later = new Date('2026-10-17T10:30:00.000Z');

    const movido = await bookings.reprogramar(id, { confirmada: { fecha: '2026-10-25', franja: 'tarde' } }, later);
    expect(movido).toMatchObject({
      id,
      estado: 'pendiente',
      fechaPreferida: '2026-10-20',
      franja: 'manana',
      fechaConfirmada: '2026-10-25',
      franjaConfirmada: 'tarde',
      updatedAt: later.toISOString(),
    });

    const confirmado = await bookings.reprogramar(
      id,
      { confirmada: { fecha: '2026-10-26', franja: 'manana' }, estado: 'confirmado' },
      later,
    );
    expect(confirmado).toMatchObject({ estado: 'confirmado', fechaConfirmada: '2026-10-26', franjaConfirmada: 'manana' });

    const vuelta = await bookings.reprogramar(id, { confirmada: null }, later);
    expect(vuelta).toMatchObject({ estado: 'confirmado', fechaConfirmada: null, franjaConfirmada: null });

    for (const unknown of ['00000000-0000-4000-8000-000000000000', 'no-es-un-uuid']) {
      expect(await bookings.reprogramar(unknown, { confirmada: null }, later)).toBeUndefined();
    }
  });

  it('reprogramar un turno cancelado o completado lanza TurnoCerradoError y no lo modifica', async () => {
    const { bookings } = await repos();
    for (const estado of ['cancelado', 'completado'] as const) {
      const { id } = await bookings.create(newBooking(), NOW);
      await bookings.updateEstado(id, estado, NOW);
      const intento = bookings.reprogramar(id, { confirmada: { fecha: '2026-10-25', franja: 'tarde' } }, NOW);
      await expect(intento).rejects.toBeInstanceOf(TurnoCerradoError);
      await expect(intento).rejects.toMatchObject({ estado });
    }
    const { bookings: todos } = await bookings.list({ limit: 50, offset: 0 });
    expect(todos.map((booking) => booking.fechaConfirmada)).toEqual([null, null]);
  });

  it('agenda: no cancelados con fecha de agenda en el rango, por fecha, franja y llegada', async () => {
    const { bookings } = await repos();
    const crear = async (nombre: string, fechaPreferida: string, franja: 'manana' | 'tarde') =>
      (await bookings.create(newBooking({ nombre, fechaPreferida, franja }), NOW)).id;

    await crear('Martes tarde', '2026-10-20', 'tarde');
    const movido = await crear('Movido al lunes', '2026-10-22', 'tarde');
    await crear('Martes mañana', '2026-10-20', 'manana');
    const cancelado = await crear('Cancelado', '2026-10-20', 'manana');
    await crear('Fuera', '2026-10-26', 'manana');
    const afuera = await crear('Movido afuera', '2026-10-21', 'manana');
    await bookings.updateEstado(cancelado, 'cancelado', NOW);
    await bookings.reprogramar(movido, { confirmada: { fecha: '2026-10-19', franja: 'manana' } }, NOW);
    await bookings.reprogramar(afuera, { confirmada: { fecha: '2026-11-03', franja: 'manana' } }, NOW);

    const semana = await bookings.agenda('2026-10-19', '2026-10-25');
    expect(semana.map((booking) => booking.nombre)).toEqual(['Movido al lunes', 'Martes mañana', 'Martes tarde']);
    expect(await bookings.agenda('2026-11-03', '2026-11-03')).toMatchObject([{ nombre: 'Movido afuera' }]);
    expect(await bookings.agenda('2027-01-01', '2027-01-31')).toEqual([]);
  });
});

describe('integridad en la base', () => {
  it('un turno con un servicio que no está en buddys.servicios se rechaza por la FK', async () => {
    const { bookings } = await repos();

    // BookingService lo frena antes (servicio inexistente o inactivo => 400); esto prueba la última línea de defensa.
    await expect(bookings.create(newBooking({ servicioId: 'teletransporte' }), NOW)).rejects.toThrow(
      /bookings_servicio_id_fkey/,
    );
    expect((await bookings.list({ limit: 50, offset: 0 })).total).toBe(0);
  });
});

describe('perfiles', () => {
  async function usuario(db: PgliteDatabase, email: string, rol = 'empleado', activo = false): Promise<string> {
    const { rows } = await db.sql.query('INSERT INTO auth.users (email) VALUES ($1) RETURNING id::text AS id', [email]);
    const id = String(rows[0]?.id);
    await db.sql.query('UPDATE buddys.perfiles SET rol_id = $2, activo = $3 WHERE id = $1::uuid', [id, rol, activo]);
    return id;
  }

  it('findForSession devuelve el perfil y si la sesión sigue en auth.sessions; un id mal formado no existe', async () => {
    const { repositories, db } = await open();
    const id = await usuario(db, 'Ana@Buddys.test', 'admin', true);
    const sessionId = '11111111-1111-4111-8111-111111111111';

    expect(await repositories.perfiles.findForSession(id, sessionId)).toEqual({
      perfil: {
        id,
        email: 'ana@buddys.test',
        nombre: null,
        rol: 'admin',
        activo: true,
        eliminadoAt: null,
        fotoVersion: null,
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      },
      sesionVigente: false,
    });

    await db.sql.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1::uuid, $2::uuid)', [sessionId, id]);
    expect((await repositories.perfiles.findForSession(id, sessionId))?.sesionVigente).toBe(true);
    await db.sql.query("UPDATE auth.sessions SET not_after = '2000-01-01T00:00:00Z'");
    expect((await repositories.perfiles.findForSession(id, sessionId))?.sesionVigente).toBe(false);

    expect(await repositories.perfiles.findForSession('no-es-un-uuid', sessionId)).toBeUndefined();
    expect(await repositories.perfiles.findForSession('22222222-2222-4222-8222-222222222222', sessionId)).toBeUndefined();

    // setFoto: la versión de la foto (contrato 04). null la borra; id inexistente o mal formado => undefined.
    const conFoto = await repositories.perfiles.setFoto(id, new Date('2026-10-16T15:30:00.000Z'));
    expect(conFoto?.fotoVersion).toBe('2026-10-16T15:30:00.000Z');
    expect((await repositories.perfiles.list()).find((p) => p.id === id)?.fotoVersion).toBe('2026-10-16T15:30:00.000Z');
    expect((await repositories.perfiles.setFoto(id, null))?.fotoVersion).toBeNull();
    expect(await repositories.perfiles.setFoto('22222222-2222-4222-8222-222222222222', null)).toBeUndefined();
    expect(await repositories.perfiles.setFoto('no-es-un-uuid', null)).toBeUndefined();
  });

  it('update cambia solo lo indicado, borra el nombre con null y no deja el sistema sin superadmin activo', async () => {
    const { repositories, db } = await open();
    const jefe = await usuario(db, 'jefe@buddys.test', 'superadmin', true);
    const ana = await usuario(db, 'ana@buddys.test');
    const later = new Date('2026-10-17T10:30:00.000Z');

    expect(await repositories.perfiles.update(ana, { nombre: 'Ana', activo: true }, later, ROLES)).toMatchObject({
      rol: 'empleado',
      activo: true,
      nombre: 'Ana',
      updatedAt: later.toISOString(),
    });
    expect(await repositories.perfiles.update(ana, { nombre: null }, later, ROLES)).toMatchObject({ nombre: null, activo: true });
    expect(await repositories.perfiles.update('22222222-2222-4222-8222-222222222222', { activo: true }, later, ROLES)).toBeUndefined();

    await expect(repositories.perfiles.update(jefe, { rol: 'admin' }, later, ROLES)).rejects.toBeInstanceOf(SinSuperadminError);
    await repositories.perfiles.update(ana, { rol: 'superadmin' }, later, ROLES);
    expect(await repositories.perfiles.update(jefe, { activo: false }, later, ROLES)).toMatchObject({ activo: false });

    expect((await repositories.perfiles.list()).map((perfil) => perfil.email)).toEqual([
      'jefe@buddys.test',
      'ana@buddys.test',
    ]);
  });

  it('list y tieneHistorial: historial por turnos, gastos y demás, en una sola consulta para todo el listado', async () => {
    const { repositories, db } = await open();
    const ana = await usuario(db, 'ana@buddys.test', 'empleado', true);
    const beto = await usuario(db, 'beto@buddys.test', 'empleado', true);
    await db.sql.query(
      `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, trabajador_id)
       VALUES ('Cliente', '12345678', 'auto', 'pulido', '2026-10-16', 'manana', 'completado', $1::uuid)`,
      [ana],
    );
    expect((await repositories.perfiles.list()).map((p) => [p.email, p.tieneHistorial])).toEqual([
      ['ana@buddys.test', true],
      ['beto@buddys.test', false],
    ]);
    expect(await repositories.perfiles.tieneHistorial(ana)).toBe(true);
    expect(await repositories.perfiles.tieneHistorial(beto)).toBe(false);
    expect(await repositories.perfiles.tieneHistorial('no-es-un-uuid')).toBe(false);
  });

  it('darDeBaja: inactivo, eliminado_at y la parte del email antes de la @ como nombre si no tenía; revertirBaja lo deja inactivo y sin baja', async () => {
    const { repositories, db } = await open();
    const jefe = await usuario(db, 'jefe@buddys.test', 'superadmin', true);
    const largo = `${'x'.repeat(90)}@buddys.test`;
    const ana = await usuario(db, largo, 'empleado', true);
    const later = new Date('2026-10-17T10:30:00.000Z');

    const baja = await repositories.perfiles.darDeBaja(ana, later, ROLES);
    expect(baja).toEqual({
      perfil: expect.objectContaining({ id: ana, activo: false, eliminadoAt: later.toISOString(), nombre: largo.slice(0, 80) }),
      nombreAnterior: null,
    });
    // Ya dado de baja: ni otra baja ni edición.
    expect(await repositories.perfiles.darDeBaja(ana, later, ROLES)).toBeUndefined();
    expect(await repositories.perfiles.update(ana, { nombre: 'Otra' }, later, ROLES)).toBeUndefined();
    // Un dado de baja nunca está activo (CHECK de la migración usuarios_baja).
    await expect(db.appSql.query('UPDATE buddys.perfiles SET activo = true WHERE id = $1::uuid', [ana])).rejects.toThrow();

    expect(await repositories.perfiles.revertirBaja(ana, null, later)).toMatchObject({ activo: false, eliminadoAt: null, nombre: null });
    expect(await repositories.perfiles.darDeBaja('22222222-2222-4222-8222-222222222222', later, ROLES)).toBeUndefined();

    // El último superadmin activo no se da de baja (trigger impedir_sin_superadmin).
    await expect(repositories.perfiles.darDeBaja(jefe, later, ROLES)).rejects.toBeInstanceOf(SinSuperadminError);
    expect(await repositories.perfiles.findById(jefe)).toMatchObject({ activo: true, eliminadoAt: null });
  });

  it('update y darDeBaja solo escriben si el rol sigue siendo gestionable (TOCTOU); la baja cierra sus sesiones', async () => {
    const { repositories, db } = await open();
    await usuario(db, 'jefe@buddys.test', 'superadmin', true);
    const ana = await usuario(db, 'ana@buddys.test', 'admin', true);
    const beto = await usuario(db, 'beto@buddys.test', 'empleado', true);
    const later = new Date('2026-10-17T10:30:00.000Z');
    const soloEmpleados = ['empleado'] as const;

    // Ana es admin: quien solo gestiona empleados no la toca, ni la edita ni la da de baja.
    expect(await repositories.perfiles.update(ana, { nombre: 'Ana', activo: false }, later, soloEmpleados)).toBeUndefined();
    expect(await repositories.perfiles.darDeBaja(ana, later, soloEmpleados)).toBeUndefined();
    expect(await repositories.perfiles.findById(ana)).toMatchObject({ nombre: null, activo: true, eliminadoAt: null });

    // Beto es empleado: sí. El rol que se mira es el de antes del cambio.
    expect(await repositories.perfiles.update(beto, { nombre: 'Beto' }, later, soloEmpleados)).toMatchObject({ nombre: 'Beto' });
    for (const sesion of ['33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332']) {
      await db.sql.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1::uuid, $2::uuid)', [sesion, beto]);
    }
    await db.sql.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1::uuid, $2::uuid)', ['33333333-3333-4333-8333-333333333333', ana]);
    expect(await repositories.perfiles.darDeBaja(beto, later, soloEmpleados)).toMatchObject({ perfil: { nombre: 'Beto' } });
    const { rows } = await db.sql.query('SELECT user_id::text AS user_id FROM auth.sessions');
    expect(rows).toEqual([{ user_id: ana }]);

    expect(await repositories.perfiles.cerrarSesiones(ana)).toBe(1);
    expect(await repositories.perfiles.cerrarSesiones(ana)).toBe(0);
    expect(await repositories.perfiles.cerrarSesiones('no-es-un-uuid')).toBe(0);

    // Cerrar las OTRAS sesiones (cambio de la propia contraseña): la actual queda, las de los demás también.
    const [actual, otra1, otra2, deBeto] = [
      '44444444-4444-4444-8444-444444444441',
      '44444444-4444-4444-8444-444444444442',
      '44444444-4444-4444-8444-444444444443',
      '44444444-4444-4444-8444-444444444444',
    ];
    for (const [sesion, user] of [[actual, ana], [otra1, ana], [otra2, ana], [deBeto, beto]] as const) {
      await db.sql.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1::uuid, $2::uuid)', [sesion, user]);
    }
    expect(await repositories.perfiles.cerrarOtrasSesiones(ana, actual)).toBe(2);
    expect(await repositories.perfiles.cerrarOtrasSesiones(ana, actual)).toBe(0);
    expect(await repositories.perfiles.cerrarOtrasSesiones(ana, 'no-es-un-uuid')).toBe(0);
    expect(await repositories.perfiles.cerrarOtrasSesiones('no-es-un-uuid', actual)).toBe(0);
    const { rows: quedan } = await db.sql.query('SELECT id::text AS id FROM auth.sessions ORDER BY id');
    expect(quedan).toEqual([{ id: actual }, { id: deBeto }]);
  });
});

describe('servicios', () => {
  const LATER = new Date('2026-10-17T10:30:00.000Z');

  function nuevoServicio(overrides: Partial<NuevoServicio> = {}): NuevoServicio {
    return {
      id: 'tratamiento-ceramico',
      nombre: 'Tratamiento cerámico',
      resumen: 'Protección de larga duración.',
      descripcion: 'Una capa cerámica sobre la pintura.\nDura meses.',
      incluye: ['Lavado', 'Aplicación'],
      glosario: [{ termino: 'Cerámico', significado: 'un recubrimiento duro y brillante.' }],
      duracion: '1 día',
      duracionSuv: '1 día y medio',
      duracionPickup: null,
      duracionMoto: null,
      precioDesde: 150000,
      precioDesdeSuv: 180000,
      precioDesdePickup: 190000,
      precioDesdeMoto: null,
      vehiculos: ['auto', 'suv', 'pickup', 'moto'],
      categoria: 'Protección',
      destacado: false,
      activo: true,
      ...overrides,
    };
  }

  const destacados = async (repositories: Repositories): Promise<string[]> =>
    (await repositories.servicios.list()).filter((servicio) => servicio.destacado).map((servicio) => servicio.id);

  it('el backfill trae los textos del frontend, con lavado-premium destacado, ordenados por orden', async () => {
    const { servicios } = await repos();
    const list = await servicios.list();

    expect(list.map((servicio) => [servicio.id, servicio.orden])).toEqual([
      ['lavado-basico', 10],
      ['lavado-premium', 20],
      ['pulido', 30],
      ['encerado', 40],
      ['restauracion-opticas', 50],
    ]);
    expect(list.filter((servicio) => servicio.destacado).map((servicio) => servicio.id)).toEqual(['lavado-premium']);
    expect(await servicios.findById('pulido')).toEqual({
      id: 'pulido',
      nombre: 'Pulido',
      resumen: expect.stringMatching(/^Corrección de pintura/),
      descripcion: expect.stringMatching(/clay bar/),
      incluye: expect.arrayContaining(['Corrección de pintura en 1 o 2 etapas']),
      glosario: expect.arrayContaining([{ termino: 'Swirls', significado: expect.any(String) }]),
      duracion: 'Alrededor de 1 día',
      duracionSuv: null,
      duracionPickup: null,
      duracionMoto: null,
      precioDesde: null,
      precioDesdeSuv: null,
      precioDesdePickup: null,
      precioDesdeMoto: null,
      // La migración vehiculos_suv_pickup pasó 'camioneta' a 'suv'.
      vehiculos: ['auto', 'suv', 'moto'],
      categoria: null,
      destacado: false,
      activo: true,
      orden: 30,
      updatedAt: expect.stringMatching(/Z$/),
    });
    for (const servicio of list) {
      expect(servicio.incluye.length, servicio.id).toBeGreaterThan(0);
      expect(servicio.glosario.length, servicio.id).toBeGreaterThan(0);
    }
    expect(await servicios.findById('no-existe')).toBeUndefined();
  });

  it('create agrega al final; un id repetido lanza ServicioExisteError sin tocar nada (ni el destacado)', async () => {
    const { repositories } = await open();
    const { servicios } = repositories;

    expect(await servicios.create(nuevoServicio(), NOW)).toEqual({
      ...nuevoServicio(),
      orden: 60,
      updatedAt: NOW.toISOString(),
    });

    await expect(servicios.create(nuevoServicio({ id: 'pulido', destacado: true }), LATER)).rejects.toBeInstanceOf(
      ServicioExisteError,
    );
    expect((await servicios.findById('pulido'))?.nombre).toBe('Pulido');
    expect(await destacados(repositories)).toEqual(['lavado-premium']);
  });

  it('puede haber varios destacados: crear o marcar uno NO desmarca a los demás', async () => {
    const { repositories } = await open();
    const { servicios } = repositories;
    const antes = (await servicios.findById('lavado-premium'))?.updatedAt;

    await servicios.create(nuevoServicio({ destacado: true }), NOW);
    expect(await destacados(repositories)).toEqual(['lavado-premium', 'tratamiento-ceramico']);
    expect((await servicios.findById('lavado-premium'))?.updatedAt).toBe(antes);

    await servicios.update('pulido', { destacado: true }, LATER);
    expect(await destacados(repositories)).toEqual(['lavado-premium', 'pulido', 'tratamiento-ceramico']);

    await servicios.update('pulido', { destacado: false }, LATER);
    expect(await destacados(repositories)).toEqual(['lavado-premium', 'tratamiento-ceramico']);
  });

  it('duración por vehículo: se crea, se edita, null borra y lo que no viene no cambia', async () => {
    const { repositories } = await open();
    const { servicios } = repositories;
    expect(await servicios.create(nuevoServicio(), NOW)).toMatchObject({
      duracion: '1 día',
      duracionSuv: '1 día y medio',
      duracionPickup: null,
      duracionMoto: null,
    });
    expect(
      await servicios.update('tratamiento-ceramico', { duracionMoto: '4 h', duracionPickup: '2 días' }, LATER),
    ).toMatchObject({
      duracionSuv: '1 día y medio',
      duracionPickup: '2 días',
      duracionMoto: '4 h',
    });
    expect(await servicios.update('tratamiento-ceramico', { duracionSuv: null }, LATER)).toMatchObject({
      duracion: '1 día',
      duracionSuv: null,
      duracionPickup: '2 días',
      duracionMoto: '4 h',
    });
    // Precio de pick-up y categoría: null borra; lo que no viene no cambia.
    expect(
      await servicios.update('tratamiento-ceramico', { precioDesdePickup: null, categoria: 'Pulido' }, LATER),
    ).toMatchObject({ precioDesdeSuv: 180000, precioDesdePickup: null, categoria: 'Pulido' });
    expect(await servicios.update('tratamiento-ceramico', { categoria: null }, LATER)).toMatchObject({
      categoria: null,
      precioDesdePickup: null,
    });
  });

  it('desactivar el destacado lo desmarca; destacar un inactivo lanza DestacadoInactivoError sin tocar nada', async () => {
    const { repositories } = await open();
    const { servicios } = repositories;

    expect(await servicios.update('lavado-premium', { activo: false }, LATER)).toMatchObject({
      activo: false,
      destacado: false,
    });
    expect(await destacados(repositories)).toEqual([]);

    await servicios.update('pulido', { destacado: true }, LATER);
    for (const [id, cambios] of [
      ['lavado-premium', { destacado: true }],
      ['encerado', { activo: false, destacado: true }],
    ] as const) {
      await expect(servicios.update(id, cambios, LATER), id).rejects.toBeInstanceOf(DestacadoInactivoError);
    }
    await expect(
      servicios.create(nuevoServicio({ destacado: true, activo: false }), LATER),
    ).rejects.toBeInstanceOf(DestacadoInactivoError);
    expect(await destacados(repositories)).toEqual(['pulido']);
    expect(await servicios.findById('encerado')).toMatchObject({ activo: true });
    expect(await servicios.findById('tratamiento-ceramico')).toBeUndefined();
  });

  it('update cambia solo lo indicado, null borra duración y precio, y un id inexistente no toca nada', async () => {
    const { repositories } = await open();
    const { servicios } = repositories;

    const updated = await servicios.update(
      'encerado',
      { nombre: 'Encerado premium', precioDesde: 30000, incluye: [], activo: false },
      LATER,
    );
    expect(updated).toMatchObject({
      id: 'encerado',
      nombre: 'Encerado premium',
      precioDesde: 30000,
      incluye: [],
      activo: false,
      duracion: '2 a 3 h',
      orden: 40,
      updatedAt: LATER.toISOString(),
    });
    expect(updated?.glosario.length).toBeGreaterThan(0);

    expect(await servicios.update('encerado', { duracion: null, precioDesde: null }, LATER)).toMatchObject({
      duracion: null,
      precioDesde: null,
      precioDesdeSuv: null,
      precioDesdeMoto: null,
      nombre: 'Encerado premium',
    });

    // Marcar como destacado un id que no existe no desmarca al actual.
    expect(await servicios.update('no-existe', { destacado: true }, LATER)).toBeUndefined();
    expect(await destacados(repositories)).toEqual(['lavado-premium']);

    expect((await servicios.list({ soloActivos: true })).map((servicio) => servicio.id)).not.toContain('encerado');
    expect((await servicios.list()).map((servicio) => servicio.id)).toContain('encerado');
  });

  it('reorder guarda posición × 10 y exige exactamente los ids del catálogo (si no, no cambia nada)', async () => {
    const { servicios } = await repos();
    const nuevo = ['restauracion-opticas', 'pulido', 'lavado-basico', 'encerado', 'lavado-premium'];

    const list = await servicios.reorder(nuevo, LATER);
    expect(list.map((servicio) => [servicio.id, servicio.orden])).toEqual(nuevo.map((id, i) => [id, (i + 1) * 10]));
    // Solo cambia updated_at de los que se movieron: encerado sigue en 40.
    expect(list.find((servicio) => servicio.id === 'encerado')?.updatedAt).not.toBe(LATER.toISOString());
    expect(list.find((servicio) => servicio.id === 'pulido')?.updatedAt).toBe(LATER.toISOString());

    for (const ids of [
      nuevo.slice(1), // falta uno
      [...nuevo, 'no-existe'], // sobra uno
      [...nuevo.slice(1), 'pulido'], // repetido y falta uno
      [...nuevo, 'pulido'], // repetido
    ]) {
      await expect(servicios.reorder(ids, NOW), ids.join(',')).rejects.toBeInstanceOf(OrdenInvalidoError);
    }
    expect((await servicios.list()).map((servicio) => servicio.id)).toEqual(nuevo);
  });

  it('la base rechaza por sí sola listas mal formadas y valores fuera de rango', async () => {
    const { db } = await open();
    const statements: [sql: string, constraint: RegExp][] = [
      [`UPDATE buddys.servicios SET incluye = '[""]' WHERE id = 'pulido'`, /servicios_incluye_valido/],
      ["UPDATE buddys.servicios SET incluye = '{}' WHERE id = 'pulido'", /servicios_incluye_valido/],
      [`UPDATE buddys.servicios SET glosario = '[{"termino":"a"}]' WHERE id = 'pulido'`, /servicios_glosario_valido/],
      [
        `UPDATE buddys.servicios SET glosario = '[{"termino":"a","significado":"b","x":1}]' WHERE id = 'pulido'`,
        /servicios_glosario_valido/,
      ],
      ["UPDATE buddys.servicios SET precio_desde = 100000000 WHERE id = 'pulido'", /servicios_precio_tope/],
      ["UPDATE buddys.servicios SET vehiculos = '{}' WHERE id = 'pulido'", /servicios_vehiculos_valido/],
      ["UPDATE buddys.servicios SET vehiculos = '{auto,auto}' WHERE id = 'pulido'", /servicios_vehiculos_valido/],
      ["UPDATE buddys.servicios SET vehiculos = '{auto,bici}' WHERE id = 'pulido'", /servicios_vehiculos_valido/],
      ["UPDATE buddys.servicios SET vehiculos = '{auto,camioneta}' WHERE id = 'pulido'", /servicios_vehiculos_valido/],
      ["UPDATE buddys.servicios SET precio_desde_suv = 100000000 WHERE id = 'pulido'", /servicios_precio_suv_rango/],
      ["UPDATE buddys.servicios SET precio_desde_suv = -1 WHERE id = 'pulido'", /servicios_precio_suv_rango/],
      ["UPDATE buddys.servicios SET precio_desde_pickup = 100000000 WHERE id = 'pulido'", /servicios_precio_pickup_rango/],
      ["UPDATE buddys.servicios SET precio_desde_pickup = -1 WHERE id = 'pulido'", /servicios_precio_pickup_rango/],
      ["UPDATE buddys.servicios SET categoria = '  ' WHERE id = 'pulido'", /servicios_categoria_valida/],
      [`UPDATE buddys.servicios SET categoria = '${'x'.repeat(41)}' WHERE id = 'pulido'`, /servicios_categoria_valida/],
      ["UPDATE buddys.servicios SET precio_desde_moto = 100000000 WHERE id = 'pulido'", /servicios_precio_moto_rango/],
      ["UPDATE buddys.servicios SET precio_desde_moto = -1 WHERE id = 'pulido'", /servicios_precio_moto_rango/],
      ["UPDATE buddys.servicios SET duracion_estimada = '  ' WHERE id = 'pulido'", /servicios_duracion_no_vacia/],
      ["UPDATE buddys.servicios SET duracion_suv = '  ' WHERE id = 'pulido'", /servicios_duracion_suv_valida/],
      [`UPDATE buddys.servicios SET duracion_pickup = '${'x'.repeat(61)}' WHERE id = 'pulido'`, /servicios_duracion_pickup_valida/],
      ["UPDATE buddys.servicios SET duracion_estimada_moto = '' WHERE id = 'pulido'", /servicios_duracion_moto_valida/],
      [`UPDATE buddys.servicios SET duracion_estimada_moto = '${'x'.repeat(61)}' WHERE id = 'pulido'`, /servicios_duracion_moto_valida/],
      ["UPDATE buddys.servicios SET resumen = '' WHERE id = 'pulido'", /servicios_resumen_largo/],
      ["UPDATE buddys.servicios SET activo = false WHERE id = 'lavado-premium'", /servicios_destacado_activo/],
    ];
    for (const [statement, constraint] of statements) {
      await expect(db.appSql.query(statement), statement).rejects.toThrow(constraint);
    }
  });
});
