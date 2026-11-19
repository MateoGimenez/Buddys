import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Client,
  type TestContext,
  addUser,
  closeAllContexts,
  countRows,
  createClient,
  createTestContext,
  loginAs,
  MemoryLogger,
  NOW,
  loginClient,
  testConfig,
  validBooking,
} from './helpers.js';
import { type Perfil, type PerfilConHistorial, type PerfilRepository, SinSuperadminError } from '../src/domain/perfil.js';
import type { SupabaseAdminClient } from '../src/lib/supabase-admin.js';
import { AuthUnavailableError } from '../src/lib/supabase-auth.js';
import { UsuarioService } from '../src/services/usuarios.js';
import { SECRET_KEY, WEAK_PASSWORD_MARK } from './supabase-fake.js';

afterEach(closeAllContexts);

async function crearTurno(context: TestContext): Promise<string> {
  const response = await createClient(context.app).post('/api/bookings', validBooking());
  return String(response.body.booking.id);
}

describe('matriz de roles sobre los turnos (la regla vive en el backend)', () => {
  it('empleado: ve turnos y puede marcarlos completados; no confirma, no cancela, no borra, no gestiona usuarios', async () => {
    const context = await createTestContext();
    const id = await crearTurno(context);
    const { client } = await loginAs(context, 'empleado');

    expect((await client.get('/api/admin/bookings')).status).toBe(200);
    for (const estado of ['confirmado', 'cancelado', 'pendiente']) {
      const response = await client.patch(`/api/admin/bookings/${id}`, { estado });
      expect(response.status, estado).toBe(403);
      expect(response.body.error).toEqual({
        code: 'FORBIDDEN',
        message: 'Con tu rol solo podés marcar los turnos como completados.',
      });
    }
    expect((await client.patch(`/api/admin/bookings/${id}`, { estado: 'completado' })).body.booking.estado).toBe('completado');

    const borrar = await client.delete(`/api/admin/bookings/${id}`);
    expect(borrar.status).toBe(403);
    expect(borrar.body.error.message).toBe('Con tu rol no podés borrar turnos.');
    const usuarios = await client.get('/api/admin/usuarios');
    expect(usuarios.status).toBe(403);
    expect(usuarios.body.error).toEqual({ code: 'FORBIDDEN', message: 'Con tu rol no podés gestionar usuarios.' });
  });

  it('admin: cambia a cualquier estado y borra, y entra a la gestión de usuarios (solo empleados)', async () => {
    const context = await createTestContext();
    const id = await crearTurno(context);
    const { client } = await loginAs(context, 'admin');

    expect((await client.patch(`/api/admin/bookings/${id}`, { estado: 'cancelado' })).status).toBe(200);
    expect((await client.delete(`/api/admin/bookings/${id}`)).status).toBe(204);

    expect((await client.get('/api/admin/usuarios')).status).toBe(200);
    expect((await client.patch(`/api/admin/usuarios/${randomUUID()}`, { activo: true })).status).toBe(404);
  });

  it('superadmin: todo lo del admin', async () => {
    const context = await createTestContext();
    const id = await crearTurno(context);
    const { client } = await loginAs(context, 'superadmin');

    expect((await client.patch(`/api/admin/bookings/${id}`, { estado: 'confirmado' })).status).toBe(200);
    expect((await client.delete(`/api/admin/bookings/${id}`)).status).toBe(204);
  });
});

describe('gestión de usuarios (superadmin)', () => {
  it('lista los perfiles y activa a un usuario nuevo con un rol y un nombre', async () => {
    const context = await createTestContext();
    const { client, id: superId } = await loginAs(context, 'superadmin', 'jefe@buddys.test');
    // Un usuario recién creado en Supabase: el trigger lo deja como empleado inactivo.
    const { rows } = await context.db.sql.query(
      "INSERT INTO auth.users (email) VALUES ('Nuevo@Buddys.test') RETURNING id::text AS id",
    );
    const nuevoId = String(rows[0]?.id);

    const list = await client.get('/api/admin/usuarios');
    expect(list.status).toBe(200);
    expect(list.body.usuarios).toEqual([
      expect.objectContaining({ id: superId, email: 'jefe@buddys.test', rol: 'superadmin', activo: true, gestionable: false }),
      {
        id: nuevoId,
        email: 'nuevo@buddys.test',
        nombre: null,
        rol: 'empleado',
        activo: false,
        eliminadoAt: null,
        tieneHistorial: false,
        gestionable: true,
        fotoVersion: null,
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      },
    ]);

    const patched = await client.patch(`/api/admin/usuarios/${nuevoId}`, { rol: 'admin', activo: true, nombre: '  Lucía  ' });
    expect(patched.status).toBe(200);
    expect(patched.body.usuario).toMatchObject({ id: nuevoId, rol: 'admin', activo: true, nombre: 'Lucía' });
    expect(patched.body.usuario.updatedAt).toBe('2026-10-16T15:00:00.000Z');
    expect(context.logger.text).toContain(`Usuario actualizado id=${nuevoId} por=${superId} campos=rol,activo,nombre`);
    expect(context.logger.text).not.toContain('nuevo@buddys.test');
  });

  it('no puede quitarse su propio rol ni desactivarse, y no se puede dejar el sistema sin superadmin activo', async () => {
    const context = await createTestContext();
    const { client, id: yo } = await loginAs(context, 'superadmin');

    const degradarme = await client.patch(`/api/admin/usuarios/${yo}`, { rol: 'admin' });
    expect(degradarme.status).toBe(409);
    expect(degradarme.body.error.code).toBe('CONFLICT');
    expect((await client.patch(`/api/admin/usuarios/${yo}`, { activo: false })).status).toBe(409);
    expect((await client.patch(`/api/admin/usuarios/${yo}`, { nombre: 'Yo' })).status).toBe(200); // lo demás sí

    // Dos superadmins: uno puede degradar al otro, pero no al último (lo frena el trigger de la base).
    const otro = await addUser(context, { email: 'otro@buddys.test', rol: 'superadmin' });
    expect((await client.patch(`/api/admin/usuarios/${otro}`, { rol: 'admin' })).status).toBe(200);
    // Ahora "yo" es el último: aunque la API no lo frenara (por ejemplo, dos cambios simultáneos), la base sí.
    await expect(
      context.db.appSql.query("UPDATE buddys.perfiles SET activo = false WHERE id = $1::uuid", [yo]),
    ).rejects.toThrow(/sin ningún superadmin activo/);
  });

  it('validación estricta: campo desconocido, rol inválido, body vacío => 400; id inexistente o mal formado => 404', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    const otro = await addUser(context, { email: 'otro@buddys.test', rol: 'empleado' });

    const invalidos = [
      { telefono: '123' },
      { rol: 'dueño' },
      { email: 'no-es-email' },
      { password: 'corta' },
      { activo: 'si' },
      { nombre: 'x'.repeat(81) },
      {},
    ];
    for (const body of invalidos) {
      const response = await client.patch(`/api/admin/usuarios/${otro}`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await client.patch(`/api/admin/usuarios/${randomUUID()}`, { activo: true })).status).toBe(404);
    expect((await client.patch('/api/admin/usuarios/123', { activo: true })).status).toBe(404);
  });
});

describe('alta, cambio de email o contraseña y baja de usuarios (superadmin, API admin de Supabase Auth)', () => {
  const NUEVO = {
    email: '  Lucia@Buddys.test ',
    password: 'clave-nueva-123',
    nombre: 'Lucía',
    rol: 'admin',
    activo: true,
  };

  it('crea el usuario en Supabase Auth; el trigger crea su perfil y queda con el rol, el nombre y el estado pedidos', async () => {
    const context = await createTestContext();
    const { client, id: superId } = await loginAs(context, 'superadmin');

    const list = await client.get('/api/admin/usuarios');
    expect(list.body.gestionCuentas).toBe(true);

    const created = await client.post('/api/admin/usuarios', NUEVO);
    expect(created.status).toBe(201);
    expect(created.body.usuario).toMatchObject({
      email: 'lucia@buddys.test',
      nombre: 'Lucía',
      rol: 'admin',
      activo: true,
    });
    const nuevoId = String(created.body.usuario.id);
    expect(await countRows(context.db, 'perfiles')).toBe(2);

    // La secret key va solo en apikey (sin Authorization) y nunca se loguea, ni la contraseña ni el email.
    expect(context.supabase.calls.at(-1)).toEqual({ path: '/admin/users', method: 'POST', apikey: SECRET_KEY, bearer: false });
    expect(context.logger.text).toContain(`Usuario creado id=${nuevoId} por=${superId} rol=admin activo=true`);
    for (const secreto of [SECRET_KEY, NUEVO.password, 'lucia@buddys.test']) {
      expect(context.logger.text).not.toContain(secreto);
    }

    // Y puede entrar al panel con esa contraseña.
    const lucia = await loginClient(context, 'lucia@buddys.test', NUEVO.password);
    expect((await lucia.get('/api/admin/bookings')).status).toBe(200);
  });

  it('alta: email repetido => 409; contraseña débil para Supabase => 400 en password; datos inválidos => 400', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin', 'jefe@buddys.test');

    const repetido = await client.post('/api/admin/usuarios', { ...NUEVO, email: 'JEFE@buddys.test' });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error).toEqual({
      code: 'CONFLICT',
      message: 'Ya existe un usuario con ese email.',
      fields: { email: 'Ya existe un usuario con ese email.' },
    });

    const debil = await client.post('/api/admin/usuarios', { ...NUEVO, password: `muy-${WEAK_PASSWORD_MARK}-123` });
    expect(debil.status).toBe(400);
    expect(Object.keys(debil.body.error.fields)).toEqual(['password']);

    const invalidos = [
      { ...NUEVO, password: '1234567' },
      { ...NUEVO, password: 'ñ'.repeat(37) }, // 37 caracteres, 74 bytes: supera el tope de bcrypt
      { ...NUEVO, email: 'no-es-email' },
      { ...NUEVO, rol: 'dueño' },
      { ...NUEVO, extra: true },
      { email: NUEVO.email, password: NUEVO.password },
    ];
    for (const body of invalidos) {
      const response = await client.post('/api/admin/usuarios', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await countRows(context.db, 'perfiles')).toBe(1);
  });

  it('cambia la contraseña (recuperación) y el email de otro usuario; el perfil copia el email nuevo', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    const otro = await addUser(context, { email: 'olvidadizo@buddys.test', rol: 'empleado' });

    const clave = await client.patch(`/api/admin/usuarios/${otro}`, { password: 'otra-clave-456' });
    expect(clave.status).toBe(200);
    expect(context.supabase.passwordOf('olvidadizo@buddys.test')).toBe('otra-clave-456');
    expect(context.logger.text).toContain('campos=password');
    expect(context.logger.text).not.toContain('otra-clave-456');

    const email = await client.patch(`/api/admin/usuarios/${otro}`, { email: 'Nuevo.Mail@Buddys.test', nombre: 'Pepe' });
    expect(email.status).toBe(200);
    expect(email.body.usuario).toMatchObject({ id: otro, email: 'nuevo.mail@buddys.test', nombre: 'Pepe' });
    await loginClient(context, 'nuevo.mail@buddys.test', 'otra-clave-456');

    // El superadmin también puede cambiar su propia contraseña.
    const { client: jefe, id: jefeId } = await loginAs(context, 'superadmin', 'jefe@buddys.test');
    expect((await jefe.patch(`/api/admin/usuarios/${jefeId}`, { password: 'mi-clave-nueva' })).status).toBe(200);

    expect((await client.patch(`/api/admin/usuarios/${otro}`, { email: 'jefe@buddys.test' })).status).toBe(409);
  });

  it('elimina a otro usuario (perfil y sesiones en cascada); no puede eliminarse a sí mismo', async () => {
    const context = await createTestContext();
    const { client, id: yo } = await loginAs(context, 'superadmin');
    const otroId = await addUser(context, { email: 'chau@buddys.test', rol: 'empleado' });
    const otro = await loginClient(context, 'chau@buddys.test');

    const borrar = await client.delete(`/api/admin/usuarios/${otroId}`);
    expect(borrar.status).toBe(200);
    expect(borrar.body).toEqual({ resultado: 'eliminado' });
    expect(await countRows(context.db, 'perfiles')).toBe(1);
    expect(context.logger.text).toContain(`Usuario eliminado id=${otroId} por=${yo} resultado=eliminado`);
    expect(context.logger.text).not.toContain('chau@buddys.test');
    // Su sesión abierta deja de servir en el request siguiente (ya no tiene perfil: NO_ACCESS).
    const despues = await otro.get('/api/admin/bookings');
    expect(despues.status).toBe(403);
    expect(despues.body.error.code).toBe('NO_ACCESS');
    expect(await context.supabase.sessionCount()).toBe(1);

    expect((await client.delete(`/api/admin/usuarios/${otroId}`)).status).toBe(404);
    expect((await client.delete('/api/admin/usuarios/123')).status).toBe(404);
    const yoMismo = await client.delete(`/api/admin/usuarios/${yo}`);
    expect(yoMismo.status).toBe(409);
    expect(yoMismo.body.error.message).toBe('No podés eliminar tu propio usuario.');
  });

  it('elimina a otro superadmin activo (el trigger de "al menos un superadmin" corre como el rol de Supabase Auth)', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    const otroSuper = await addUser(context, { email: 'otro-super@buddys.test', rol: 'superadmin' });

    const borrar = await client.delete(`/api/admin/usuarios/${otroSuper}`);
    expect(borrar.status, JSON.stringify(borrar.body)).toBe(200);
    expect(borrar.body).toEqual({ resultado: 'eliminado' });
    expect(await countRows(context.db, 'perfiles')).toBe(1);

    // En Supabase, el trigger AFTER DELETE de la cascada corre como supabase_auth_admin (sin USAGE sobre buddys):
    // tiene que ser SECURITY DEFINER o el borrado falla con 42501. PGlite no reproduce ese detalle, así que se verifica
    // la definición: los dos triggers usan la función privada, que nadie más puede ejecutar.
    const { rows: triggers } = await context.db.sql.query(
      `SELECT t.tgname, p.pronamespace::regnamespace::text AS esquema, p.prosecdef,
              has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') AS auth_exec,
              has_function_privilege('buddys_app', p.oid, 'EXECUTE') AS app_exec
       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid = 'buddys.perfiles'::regclass AND t.tgname LIKE 'perfiles_al_menos_un_superadmin%'
       ORDER BY t.tgname`,
    );
    expect(triggers).toEqual(
      ['perfiles_al_menos_un_superadmin', 'perfiles_al_menos_un_superadmin_al_borrar'].map((tgname) => ({
        tgname,
        esquema: 'buddys_private',
        prosecdef: true,
        auth_exec: false,
        app_exec: false,
      })),
    );

    // Y el último superadmin activo sigue protegido aunque lo borre Supabase Auth directamente.
    const { rows } = await context.db.sql.query("SELECT id::text AS id FROM buddys.perfiles WHERE rol_id = 'superadmin'");
    await expect(
      context.db.authSql.query('DELETE FROM auth.users WHERE id = $1::uuid', [String(rows[0]?.id)]),
    ).rejects.toThrow(/sin ningún superadmin activo/);
  });

  it('el empleado recibe 403 en todo; el admin, 403 sobre un admin (alta, contraseña y baja), sin tocar Supabase', async () => {
    const context = await createTestContext();
    const empleadoVictima = await addUser(context, { email: 'victima@buddys.test', rol: 'empleado' });
    const adminVictima = await addUser(context, { email: 'otro-admin@buddys.test', rol: 'admin' });
    const { client: empleado } = await loginAs(context, 'empleado');
    expect((await empleado.post('/api/admin/usuarios', { ...NUEVO, rol: 'empleado' })).status).toBe(403);
    expect((await empleado.patch(`/api/admin/usuarios/${empleadoVictima}`, { password: 'hackeada-123' })).status).toBe(403);
    expect((await empleado.delete(`/api/admin/usuarios/${empleadoVictima}`)).status).toBe(403);

    const { client: admin } = await loginAs(context, 'admin');
    expect((await admin.post('/api/admin/usuarios', NUEVO)).status).toBe(403);
    expect((await admin.patch(`/api/admin/usuarios/${adminVictima}`, { password: 'hackeada-123' })).status).toBe(403);
    expect((await admin.delete(`/api/admin/usuarios/${adminVictima}`)).status).toBe(403);
    expect(context.supabase.calls.some((call) => call.path.startsWith('/admin/'))).toBe(false);
  });

  it('sin SUPABASE_SECRET_KEY: lista con gestionCuentas=false; alta, baja, email y contraseña => 503; rol y nombre siguen', async () => {
    const context = await createTestContext({ config: { supabase: { ...testConfig().supabase, secretKey: undefined } } });
    const { client } = await loginAs(context, 'superadmin');
    const otro = await addUser(context, { email: 'otro@buddys.test', rol: 'empleado' });

    expect((await client.get('/api/admin/usuarios')).body.gestionCuentas).toBe(false);
    const respuestas = [
      await client.post('/api/admin/usuarios', NUEVO),
      await client.patch(`/api/admin/usuarios/${otro}`, { password: 'otra-clave-456' }),
      await client.patch(`/api/admin/usuarios/${otro}`, { email: 'x@buddys.test' }),
      await client.delete(`/api/admin/usuarios/${otro}`),
    ];
    for (const response of respuestas) {
      expect(response.status).toBe(503);
      expect(response.body.error.message).toMatch(/SUPABASE_SECRET_KEY/);
    }
    expect((await client.patch(`/api/admin/usuarios/${otro}`, { nombre: 'Otro' })).status).toBe(200);
  });

  it('Supabase caído o limitando => 503 / 429, sin filtrar la contraseña', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    context.supabase.mode = 'down';
    expect((await client.post('/api/admin/usuarios', NUEVO)).status).toBe(503);
    context.supabase.mode = 'rate';
    expect((await client.post('/api/admin/usuarios', NUEVO)).status).toBe(429);
    context.supabase.mode = 'error';
    expect((await client.post('/api/admin/usuarios', NUEVO)).status).toBe(503);
    expect(context.logger.text).not.toContain(NUEVO.password);
  });
});

/** Registra un lavado de hoy hecho por `trabajadorId` (lo carga `client`, admin o superadmin). Devuelve su id. */
async function lavadoDe(client: Client, trabajadorId: string): Promise<string> {
  const response = await client.post('/api/admin/lavados', {
    servicioId: 'lavado-basico',
    vehiculoTipo: 'auto',
    monto: 15000,
    formaPago: 'efectivo',
    trabajadorId,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return String(response.body.lavado.id);
}

async function perfilEnBase(context: TestContext, id: string) {
  const { rows } = await context.db.sql.query(
    'SELECT nombre, email, activo, eliminado_at FROM buddys.perfiles WHERE id = $1::uuid',
    [id],
  );
  return rows[0];
}

describe('gestión de usuarios: el admin gestiona solo empleados (contrato 2026-11-17_03)', () => {
  const EMPLEADO = { email: 'nueva@buddys.test', password: 'clave-nueva-123', nombre: 'Nueva', rol: 'empleado', activo: true };

  it('crea un empleado (201) pero no un admin ni un superadmin (403)', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'admin');

    const creado = await client.post('/api/admin/usuarios', EMPLEADO);
    expect(creado.status).toBe(201);
    expect(creado.body.usuario).toMatchObject({
      email: 'nueva@buddys.test',
      rol: 'empleado',
      eliminadoAt: null,
      tieneHistorial: false,
      gestionable: true,
    });

    for (const rol of ['admin', 'superadmin']) {
      const response = await client.post('/api/admin/usuarios', { ...EMPLEADO, email: `${rol}-nuevo@buddys.test`, rol });
      expect(response.status, rol).toBe(403);
      expect(response.body.error).toEqual({ code: 'FORBIDDEN', message: 'Con tu rol solo podés crear y editar empleados.' });
    }
    expect(await countRows(context.db, 'perfiles')).toBe(2);
  });

  it('no edita ni elimina a un admin o superadmin (403), ni asciende a un empleado (403)', async () => {
    const context = await createTestContext();
    const otroAdmin = await addUser(context, { email: 'otro-admin@buddys.test', rol: 'admin' });
    const superadmin = await addUser(context, { email: 'jefe@buddys.test', rol: 'superadmin' });
    const empleado = await addUser(context, { email: 'emple@buddys.test', rol: 'empleado' });
    const { client } = await loginAs(context, 'admin');

    for (const id of [otroAdmin, superadmin]) {
      for (const response of [
        await client.patch(`/api/admin/usuarios/${id}`, { nombre: 'X' }),
        await client.patch(`/api/admin/usuarios/${id}`, { activo: false }),
        await client.delete(`/api/admin/usuarios/${id}`),
      ]) {
        expect(response.status).toBe(403);
        expect(response.body.error).toEqual({ code: 'FORBIDDEN', message: 'Con tu rol solo podés gestionar empleados.' });
      }
    }
    for (const rol of ['admin', 'superadmin']) {
      const ascender = await client.patch(`/api/admin/usuarios/${empleado}`, { rol });
      expect(ascender.status, rol).toBe(403);
      expect(ascender.body.error.message).toBe('Con tu rol solo podés crear y editar empleados.');
    }
    // A un empleado sí lo edita (y dejarlo como empleado no es "cambiar de rol").
    const editar = await client.patch(`/api/admin/usuarios/${empleado}`, { nombre: 'Emple', rol: 'empleado', activo: false });
    expect(editar.status).toBe(200);
    expect(editar.body.usuario).toMatchObject({ nombre: 'Emple', activo: false, gestionable: true });
    const { rows } = await context.db.sql.query("SELECT count(*)::int AS n FROM buddys.perfiles WHERE rol_id <> 'empleado'");
    expect(rows[0]?.n).toBe(3);
  });

  it('ve el email de los empleados y el suyo, no el de otros admins ni superadmins; gestionable según quién pide', async () => {
    const context = await createTestContext();
    const jefe = await addUser(context, { email: 'jefe@buddys.test', rol: 'superadmin' });
    const otroAdmin = await addUser(context, { email: 'otro-admin@buddys.test', rol: 'admin' });
    const empleado = await addUser(context, { email: 'emple@buddys.test', rol: 'empleado' });
    const { client, id: yo } = await loginAs(context, 'admin', 'yo@buddys.test');

    const lista = await client.get('/api/admin/usuarios');
    expect(lista.status).toBe(200);
    const porId = new Map((lista.body.usuarios as { id: string }[]).map((u) => [u.id, u]));
    expect(porId.get(jefe)).toMatchObject({ email: null, gestionable: false });
    expect(porId.get(otroAdmin)).toMatchObject({ email: null, gestionable: false });
    expect(porId.get(empleado)).toMatchObject({ email: 'emple@buddys.test', gestionable: true });
    expect(porId.get(yo)).toMatchObject({ email: 'yo@buddys.test', gestionable: false });
    expect(JSON.stringify(lista.body)).not.toMatch(/jefe@|otro-admin@/);

    // El superadmin ve todos los emails y gestiona a todos menos a sí mismo.
    const { client: superCliente, id: superId } = await loginAs(context, 'superadmin', 'super2@buddys.test');
    const vistos = (await superCliente.get('/api/admin/usuarios')).body.usuarios as { id: string; email: string | null; gestionable: boolean }[];
    expect(vistos.every((u) => u.email !== null)).toBe(true);
    expect(vistos.filter((u) => !u.gestionable).map((u) => u.id)).toEqual([superId]);
  });

  it('el admin tampoco se edita a sí mismo por acá (409 en rol y activo; 403 en lo demás: es admin)', async () => {
    const context = await createTestContext();
    const { client, id: yo } = await loginAs(context, 'admin');
    expect((await client.patch(`/api/admin/usuarios/${yo}`, { rol: 'empleado' })).status).toBe(409);
    expect((await client.patch(`/api/admin/usuarios/${yo}`, { activo: false })).status).toBe(409);
    expect((await client.delete(`/api/admin/usuarios/${yo}`)).status).toBe(409);
    expect((await client.patch(`/api/admin/usuarios/${yo}`, { nombre: 'Yo' })).status).toBe(403);
  });
});

describe('gestión de usuarios: el superadmin gestiona a cualquiera', () => {
  it('crea, edita y elimina admins y superadmins; no se elimina, desactiva ni cambia el rol (409)', async () => {
    const context = await createTestContext();
    const { client, id: yo } = await loginAs(context, 'superadmin');
    const otroAdmin = await addUser(context, { email: 'otro-admin@buddys.test', rol: 'admin' });

    const creado = await client.post('/api/admin/usuarios', {
      email: 'super-nuevo@buddys.test',
      password: 'clave-nueva-123',
      rol: 'superadmin',
      activo: true,
    });
    expect(creado.status).toBe(201);
    expect(creado.body.usuario).toMatchObject({ rol: 'superadmin', gestionable: true, email: 'super-nuevo@buddys.test' });
    const editado = await client.patch(`/api/admin/usuarios/${otroAdmin}`, { rol: 'superadmin', nombre: 'Otro' });
    expect(editado.status).toBe(200);
    expect(editado.body.usuario).toMatchObject({ rol: 'superadmin', nombre: 'Otro', tieneHistorial: false });
    expect((await client.delete(`/api/admin/usuarios/${otroAdmin}`)).body).toEqual({ resultado: 'eliminado' });

    for (const response of [
      await client.delete(`/api/admin/usuarios/${yo}`),
      await client.patch(`/api/admin/usuarios/${yo}`, { activo: false }),
      await client.patch(`/api/admin/usuarios/${yo}`, { rol: 'admin' }),
    ]) {
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    }
  });
});

describe('eliminar: sin historial se borra; con historial se da de baja y el nombre sigue en sus lavados', () => {
  it('con un lavado: baja (inactivo, eliminado_at, email liberado y baneado en Auth); el lavado sigue con su nombre', async () => {
    const context = await createTestContext();
    const { client, id: yo } = await loginAs(context, 'superadmin');
    const lucia = await addUser(context, { email: 'lucia@buddys.test', rol: 'empleado', nombre: 'Lucía' });
    const sesionLucia = await loginClient(context, 'lucia@buddys.test');
    const lavado = await lavadoDe(client, lucia);

    const lista = (await client.get('/api/admin/usuarios')).body.usuarios as { id: string; tieneHistorial: boolean }[];
    expect(lista.find((u) => u.id === lucia)?.tieneHistorial).toBe(true);
    expect(lista.find((u) => u.id === yo)?.tieneHistorial).toBe(true); // lo registró él (registrado_por)

    const baja = await client.delete(`/api/admin/usuarios/${lucia}`);
    expect(baja.status).toBe(200);
    expect(baja.body).toEqual({
      resultado: 'baja',
      usuario: {
        id: lucia,
        email: null,
        nombre: 'Lucía',
        rol: 'empleado',
        activo: false,
        eliminadoAt: NOW.toISOString(),
        tieneHistorial: true,
        gestionable: false,
        fotoVersion: null,
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/), // el trigger de auth.users la mueve al copiar el email de baja
      },
    });
    expect(await perfilEnBase(context, lucia)).toMatchObject({
      nombre: 'Lucía',
      email: `baja+${lucia}@buddys.invalid`,
      activo: false,
      eliminado_at: NOW,
    });
    expect(context.supabase.cuentaDe(lucia)).toEqual({ email: `baja+${lucia}@buddys.invalid`, banDuration: '876000h' });
    expect(context.supabase.calls.at(-1)).toMatchObject({ path: `/admin/users/${lucia}`, method: 'PUT' });
    expect(context.logger.text).toContain(`Usuario eliminado id=${lucia} por=${yo} resultado=baja`);
    expect(context.logger.text).not.toMatch(/lucia@buddys\.test|buddys\.invalid/);

    // Su sesión deja de servir (la baja le borra las sesiones: 401); no puede volver a entrar; no aparece para elegir
    // "quién lavó".
    expect((await sesionLucia.get('/api/admin/bookings')).status).toBe(401);
    await expect(loginClient(context, 'lucia@buddys.test')).rejects.toThrow();
    const trabajadores = (await client.get('/api/admin/trabajadores')).body.trabajadores as { id: string }[];
    expect(trabajadores.map((t) => t.id)).not.toContain(lucia);

    // El lavado sigue mostrando su nombre; ella sigue en el listado (dada de baja, sin email ni acciones).
    const dia = (await client.get('/api/admin/lavados')).body.lavados as { id: string; trabajador: unknown }[];
    expect(dia.find((l) => l.id === lavado)?.trabajador).toEqual({ id: lucia, nombre: 'Lucía' });
    const despues = (await client.get('/api/admin/usuarios')).body.usuarios as { id: string }[];
    expect(despues.find((u) => u.id === lucia)).toMatchObject({ email: null, eliminadoAt: NOW.toISOString(), gestionable: false });

    // Dado de baja: no se edita ni se vuelve a dar de baja (409).
    for (const response of [
      await client.patch(`/api/admin/usuarios/${lucia}`, { nombre: 'Otra' }),
      await client.patch(`/api/admin/usuarios/${lucia}`, { activo: true }),
      await client.delete(`/api/admin/usuarios/${lucia}`),
    ]) {
      expect(response.status).toBe(409);
      expect(response.body.error).toEqual({ code: 'CONFLICT', message: 'Ese usuario está dado de baja.' });
    }

    // Su email real quedó libre: se puede crear una cuenta nueva con él.
    const nueva = await client.post('/api/admin/usuarios', {
      email: 'lucia@buddys.test',
      password: 'clave-nueva-123',
      rol: 'empleado',
      activo: true,
    });
    expect(nueva.status).toBe(201);
  });

  it('baja de alguien sin nombre: queda con la parte del email antes de la @ (no el email) y el lavado la muestra', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'admin');
    const sinNombre = await addUser(context, { email: 'sin.nombre@buddys.test', rol: 'empleado', nombre: null });
    const lavado = await lavadoDe(client, sinNombre);

    const baja = await client.delete(`/api/admin/usuarios/${sinNombre}`);
    expect(baja.body).toMatchObject({ resultado: 'baja', usuario: { nombre: 'sin.nombre', email: null } });
    const dia = (await client.get('/api/admin/lavados')).body.lavados as { id: string; trabajador: unknown }[];
    expect(dia.find((l) => l.id === lavado)?.trabajador).toEqual({ id: sinNombre, nombre: 'sin.nombre' });
  });

  it('cuenta como historial: quién registró un lavado, un gasto, un movimiento de stock, un presupuesto', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    const ids = {
      registro: await addUser(context, { email: 'registro@buddys.test', rol: 'admin' }),
      gasto: await addUser(context, { email: 'gasto@buddys.test', rol: 'admin' }),
      movimiento: await addUser(context, { email: 'movimiento@buddys.test', rol: 'empleado' }),
      presupuesto: await addUser(context, { email: 'presupuesto@buddys.test', rol: 'admin' }),
      nada: await addUser(context, { email: 'nada@buddys.test', rol: 'empleado' }),
    };
    await lavadoDe(await loginClient(context, 'registro@buddys.test'), ids.nada);
    await context.db.sql.query('UPDATE buddys.bookings SET trabajador_id = null'); // queda solo registrado_por
    const gasto = await loginClient(context, 'gasto@buddys.test');
    expect((await gasto.post('/api/admin/gastos', { fecha: '2026-10-14', categoria: 'otros', descripcion: 'x', monto: 5 })).status).toBe(201);
    const insumo = await client.post('/api/admin/insumos', { nombre: 'Cera', unidad: 'unidad', stockInicial: 3 });
    const movimiento = await loginClient(context, 'movimiento@buddys.test');
    expect((await movimiento.post(`/api/admin/insumos/${String(insumo.body.insumo.id)}/movimientos`, { tipo: 'uso', cantidad: 1 })).status).toBe(201);
    const presupuesto = await loginClient(context, 'presupuesto@buddys.test');
    expect((await presupuesto.post('/api/admin/presupuestos', { clienteNombre: 'P', items: [{ descripcion: 'L', cantidad: 1, precioUnitario: 1 }] })).status).toBe(201);

    const lista = (await client.get('/api/admin/usuarios')).body.usuarios as { id: string; tieneHistorial: boolean }[];
    const historial = Object.fromEntries(Object.entries(ids).map(([clave, id]) => [clave, lista.find((u) => u.id === id)?.tieneHistorial]));
    expect(historial).toEqual({ registro: true, gasto: true, movimiento: true, presupuesto: true, nada: false });
  });

  it('si en el medio le registran un lavado, la FK RESTRICT frena el borrado y cae a la baja', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    const pepe = await addUser(context, { email: 'pepe@buddys.test', rol: 'empleado', nombre: 'Pepe' });
    context.supabase.antesDeBorrar = async (id) => {
      await context.db.sql.query(
        `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado, trabajador_id)
         VALUES ('Cliente', '12345678', 'auto', 'pulido', '2026-10-16', 'manana', 'completado', $1::uuid)`,
        [id],
      );
    };

    const response = await client.delete(`/api/admin/usuarios/${pepe}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ resultado: 'baja', usuario: { id: pepe, nombre: 'Pepe', activo: false } });
    expect(await perfilEnBase(context, pepe)).toMatchObject({ activo: false, eliminado_at: NOW });
  });

  it('si falla Supabase en el paso 2: 503 y queda inactivo, sin eliminado_at y con su nombre de antes', async () => {
    const context = await createTestContext();
    const { client } = await loginAs(context, 'superadmin');
    const ana = await addUser(context, { email: 'ana@buddys.test', rol: 'empleado', nombre: null });
    await lavadoDe(client, ana);

    context.supabase.mode = 'error';
    const response = await client.delete(`/api/admin/usuarios/${ana}`);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'No pudimos terminar la baja en el servicio de usuarios. Quedó desactivado; probá eliminarlo de nuevo en unos minutos.',
    });
    expect(await perfilEnBase(context, ana)).toEqual({ nombre: null, email: 'ana@buddys.test', activo: false, eliminado_at: null });
    expect(context.logger.text).toContain(`Baja a medias id=${ana}`);

    // Reintentar con Supabase de vuelta termina la baja.
    context.supabase.mode = 'ok';
    expect((await client.delete(`/api/admin/usuarios/${ana}`)).body).toMatchObject({ resultado: 'baja' });
  });
});

describe('UsuarioService: operaciones que tocan Auth y la base (casos a medias)', () => {
  const actor = {
    id: '00000000-0000-4000-8000-000000000001',
    email: null,
    nombre: null,
    rol: 'superadmin' as const,
    fotoVersion: null,
    sessionId: '00000000-0000-4000-8000-000000000002',
  };
  const perfilDe = (id: string, cambios: Partial<Perfil> = {}): Perfil => ({
    id,
    email: 'x@buddys.test',
    nombre: null,
    rol: 'empleado',
    activo: true,
    eliminadoAt: null,
    fotoVersion: null,
    createdAt: '2026-10-16T15:00:00.000Z',
    updatedAt: '2026-10-16T15:00:00.000Z',
    ...cambios,
  });
  const conHistorial = (perfil: Perfil, tieneHistorial = false): PerfilConHistorial => ({ ...perfil, tieneHistorial });

  function servicio(perfiles: Partial<PerfilRepository>, admin: Partial<SupabaseAdminClient>) {
    const logger = new MemoryLogger();
    const service = new UsuarioService({
      perfiles: perfiles as PerfilRepository,
      admin: admin as SupabaseAdminClient,
      logger,
      now: () => NOW,
    });
    return { service, logger };
  }

  it('alta: si falla la configuración del perfil, borra el usuario recién creado en Auth (no queda a medias)', async () => {
    const borrados: string[] = [];
    const { service, logger } = servicio(
      { update: () => Promise.reject(new Error('la base se cayó')) },
      {
        createUser: () => Promise.resolve('11111111-1111-4111-8111-111111111111'),
        deleteUser: (id: string) => {
          borrados.push(id);
          return Promise.resolve(true);
        },
      },
    );
    await expect(
      service.create(actor, { email: 'a@b.test', password: 'clave-larga-1', nombre: null, rol: 'admin', activo: true }),
    ).rejects.toThrow('la base se cayó');
    expect(borrados).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(logger.text).toContain('Alta revertida id=11111111-1111-4111-8111-111111111111');
  });

  it('PATCH con perfil y cuenta: si el perfil choca con una regla, Auth no se toca', async () => {
    let authTocado = false;
    const { service } = servicio(
      {
        findById: (id: string) => Promise.resolve(perfilDe(id, { rol: 'superadmin' })),
        update: () => Promise.reject(new SinSuperadminError()),
      },
      {
        updateUser: () => {
          authTocado = true;
          return Promise.resolve(true);
        },
      },
    );
    await expect(
      service.update(actor, '22222222-2222-4222-8222-222222222222', { rol: 'admin', email: 'nuevo@b.test' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(authTocado).toBe(false);
  });

  it('baja: si Auth falla al borrar al último superadmin activo (carrera), responde 409 y no 503', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const { service } = servicio(
      {
        findById: () => Promise.resolve(perfilDe(id, { rol: 'superadmin' })),
        list: () =>
          Promise.resolve(
            [perfilDe(id, { rol: 'superadmin' }), perfilDe(actor.id, { rol: 'superadmin', activo: false })].map((p) =>
              conHistorial(p),
            ),
          ),
        tieneHistorial: () => Promise.resolve(false),
      },
      { deleteUser: () => Promise.reject(new AuthUnavailableError(500)) },
    );
    await expect(service.remove(actor, id)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });
  it('baja del último superadmin activo (lo frena el trigger en el paso 1): 409 y Auth no se toca', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    let authTocado = false;
    const { service } = servicio(
      {
        findById: () => Promise.resolve(perfilDe(id, { rol: 'superadmin' })),
        tieneHistorial: () => Promise.resolve(true),
        darDeBaja: () => Promise.reject(new SinSuperadminError()),
      },
      {
        banUser: () => {
          authTocado = true;
          return Promise.resolve(true);
        },
      },
    );
    await expect(service.remove(actor, id)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(authTocado).toBe(false);
  });

  it('si Auth no borra y ahora tiene historial (FK RESTRICT), cae a la baja', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    let consultas = 0;
    const baneados: string[] = [];
    const { service, logger } = servicio(
      {
        findById: () => Promise.resolve(perfilDe(id)),
        tieneHistorial: () => Promise.resolve(++consultas > 1),
        darDeBaja: () => Promise.resolve({ perfil: perfilDe(id, { activo: false, eliminadoAt: NOW.toISOString() }), nombreAnterior: null }),
      },
      {
        deleteUser: () => Promise.reject(new AuthUnavailableError(500)),
        banUser: (usuarioId: string, email: string, ban: string) => {
          baneados.push(`${usuarioId} ${email} ${ban}`);
          return Promise.resolve(true);
        },
      },
    );
    await expect(service.remove(actor, id)).resolves.toMatchObject({ resultado: 'baja', usuario: { id, tieneHistorial: true } });
    expect(baneados).toEqual([`${id} baja+${id}@buddys.invalid 876000h`]);
    expect(logger.text).toContain(`resultado=baja`);
  });

  it('si el paso 2 falla y tampoco se puede revertir: 503 igual y queda logueado (sin emails)', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const { service, logger } = servicio(
      {
        findById: () => Promise.resolve(perfilDe(id)),
        tieneHistorial: () => Promise.resolve(true),
        darDeBaja: () => Promise.resolve({ perfil: perfilDe(id, { activo: false }), nombreAnterior: 'Ana' }),
        revertirBaja: () => Promise.reject(new Error('la base se cayó')),
      },
      { banUser: () => Promise.reject(new AuthUnavailableError(500)) },
    );
    await expect(service.remove(actor, id)).rejects.toMatchObject({ status: 503 });
    expect(logger.text).toContain(`Baja a medias id=${id}`);
    expect(logger.text).not.toContain('@');
  });

  describe('auditoría A: TOCTOU sobre el rol (B1) y cierre de sesiones (B3)', () => {
    const admin = { ...actor, rol: 'admin' as const };
    const id = '77777777-7777-4777-8777-777777777777';

    it('PATCH: si el UPDATE no escribe porque en el medio lo ascendieron, relee y responde 403 (Auth no se toca)', async () => {
      let lecturas = 0;
      let authTocado = false;
      const { service } = servicio(
        {
          findById: () => Promise.resolve(perfilDe(id, { rol: ++lecturas === 1 ? 'empleado' : 'admin' })),
          update: () => Promise.resolve(undefined),
        },
        {
          updateUser: () => {
            authTocado = true;
            return Promise.resolve(true);
          },
        },
      );
      await expect(service.update(admin, id, { password: 'clave-larga-1' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(lecturas).toBe(2);
      expect(authTocado).toBe(false);
    });

    it('PATCH: el repositorio recibe solo los roles que quien pide gestiona', async () => {
      const recibidos: unknown[] = [];
      const { service } = servicio(
        {
          findById: () => Promise.resolve(perfilDe(id)),
          update: (_id: string, _c: unknown, _now: Date, roles: readonly string[]) => {
            recibidos.push(roles);
            return Promise.resolve(perfilDe(id, { nombre: 'X' }));
          },
          tieneHistorial: () => Promise.resolve(false),
        },
        {},
      );
      await service.update(admin, id, { nombre: 'X' });
      await service.update(actor, id, { nombre: 'X' });
      expect(recibidos).toEqual([['empleado'], ['superadmin', 'admin', 'empleado']]);
    });

    it('PATCH: si lo escrito ya no es gestionable por quien pide, no se cambia la contraseña en Auth', async () => {
      let authTocado = false;
      const { service } = servicio(
        {
          findById: () => Promise.resolve(perfilDe(id)),
          update: () => Promise.resolve(perfilDe(id, { rol: 'admin' })),
        },
        {
          updateUser: () => {
            authTocado = true;
            return Promise.resolve(true);
          },
        },
      );
      await expect(service.update(admin, id, { password: 'clave-larga-1' })).rejects.toMatchObject({ status: 403 });
      expect(authTocado).toBe(false);
    });

    it('baja: si darDeBaja no escribe porque lo ascendieron, 403; si lo dieron de baja en el medio, 409', async () => {
      let rolLeido: Perfil['rol'] = 'empleado';
      let eliminadoAt: string | null = null;
      let lecturas = 0;
      const { service } = servicio(
        {
          findById: () => Promise.resolve(perfilDe(id, ++lecturas === 1 ? {} : { rol: rolLeido, eliminadoAt })),
          tieneHistorial: () => Promise.resolve(true),
          darDeBaja: () => Promise.resolve(undefined),
        },
        { banUser: () => Promise.reject(new Error('no se tendría que llamar')) },
      );
      rolLeido = 'admin';
      await expect(service.remove(admin, id)).rejects.toMatchObject({ status: 403 });
      lecturas = 0;
      rolLeido = 'empleado';
      eliminadoAt = NOW.toISOString();
      await expect(service.remove(admin, id)).rejects.toMatchObject({ status: 409 });
    });

    it('borrado en Auth: se relee justo antes; si lo ascendieron, 403 y deleteUser no se llama', async () => {
      let lecturas = 0;
      let borrado = false;
      const { service } = servicio(
        {
          findById: () => Promise.resolve(perfilDe(id, { rol: ++lecturas === 1 ? 'empleado' : 'admin' })),
          tieneHistorial: () => Promise.resolve(false),
        },
        {
          deleteUser: () => {
            borrado = true;
            return Promise.resolve(true);
          },
        },
      );
      await expect(service.remove(admin, id)).rejects.toMatchObject({ status: 403 });
      expect(borrado).toBe(false);
    });

    it('si cerrar las sesiones falla, el cambio de contraseña igual responde bien y queda logueado', async () => {
      const { service, logger } = servicio(
        {
          findById: () => Promise.resolve(perfilDe(id)),
          update: () => Promise.resolve(perfilDe(id)),
          tieneHistorial: () => Promise.resolve(false),
          cerrarSesiones: () => Promise.reject(new Error('la base se cayó')),
        },
        { updateUser: () => Promise.resolve(true) },
      );
      await expect(service.update(admin, id, { password: 'clave-larga-1' })).resolves.toMatchObject({ id });
      expect(logger.text).toContain(`No se pudieron cerrar las sesiones id=${id}`);
    });
  });
});
