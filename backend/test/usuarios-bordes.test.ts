import { afterEach, describe, expect, it } from 'vitest';
import { type Client, type TestContext, addUser, closeAllContexts, loginAs, loginClient } from './helpers.js';

/**
 * Casos límite de la gestión de usuarios (contrato 2026-11-17_03), revisión de pruebas: escalada de permisos del admin,
 * ids mal formados, bajas simultáneas, emails largos, nombre en todo el historial y emails de admins.
 */
afterEach(closeAllContexts);

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
    'SELECT nombre, email, activo, eliminado_at, rol_id FROM buddys.perfiles WHERE id = $1::uuid',
    [id],
  );
  return rows[0];
}

describe('admin: no puede escalar permisos por ningún camino', () => {
  it('no crea admins, no asciende empleados, no toca superadmins ni se edita a sí mismo; nada cambia en la base', async () => {
    const context = await createAdminContext();
    const { client, id: yo, empleado, superadmin } = context;

    const intentos = [
      await client.post('/api/admin/usuarios', { email: 'x@buddys.test', password: 'clave-larga-1', rol: 'superadmin', activo: true }),
      await client.patch(`/api/admin/usuarios/${empleado}`, { rol: 'admin' }),
      await client.patch(`/api/admin/usuarios/${empleado}`, { rol: 'superadmin', nombre: 'Jefe' }),
      await client.patch(`/api/admin/usuarios/${superadmin}`, { activo: false }),
      await client.patch(`/api/admin/usuarios/${superadmin}`, { password: 'otra-clave-123' }),
      await client.delete(`/api/admin/usuarios/${superadmin}`),
      await client.patch(`/api/admin/usuarios/${yo}`, { nombre: 'Yo' }),
      await client.patch(`/api/admin/usuarios/${yo}`, { email: 'otro@buddys.test' }),
    ];
    expect(intentos.map((r) => [r.status, r.body.error?.code])).toEqual([
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
    ]);
    // Sobre sí mismo, rol y activo dan 409 (regla 1, va primero); y tampoco se elimina.
    expect((await client.patch(`/api/admin/usuarios/${yo}`, { rol: 'superadmin' })).status).toBe(409);
    expect((await client.delete(`/api/admin/usuarios/${yo}`)).status).toBe(409);

    expect(await perfilEnBase(context.ctx, empleado)).toMatchObject({ rol_id: 'empleado', nombre: 'Emp' });
    expect(await perfilEnBase(context.ctx, superadmin)).toMatchObject({ rol_id: 'superadmin', activo: true });
    expect(await perfilEnBase(context.ctx, yo)).toMatchObject({ rol_id: 'admin' });
    // Ningún intento llegó a Supabase Auth (ni el alta del superadmin, ni la contraseña, ni el borrado).
    expect(context.ctx.supabase.calls.filter((c) => c.path.startsWith('/admin/users'))).toEqual([]);
  });

  it('PATCH sobre un empleado con rol "empleado" (sin cambio real) sí se permite', async () => {
    const { client, empleado } = await createAdminContext();
    const response = await client.patch(`/api/admin/usuarios/${empleado}`, { rol: 'empleado', nombre: 'Emp 2' });
    expect(response.status).toBe(200);
    expect(response.body.usuario).toMatchObject({ rol: 'empleado', nombre: 'Emp 2', gestionable: true });
  });

  it('el admin no recibe emails de admins ni superadmins en ninguna respuesta', async () => {
    const { client, ctx } = await createAdminContext();
    const lista = await client.get('/api/admin/usuarios');
    const texto = JSON.stringify(lista.body);
    expect(texto).not.toContain('jefe@buddys.test');
    expect(texto).not.toContain('otro.admin@buddys.test');
    expect(texto).toContain('emp@buddys.test');
    // Tampoco en la respuesta al crear ni en los permisos.
    const alta = await client.post('/api/admin/usuarios', { email: 'nuevo@buddys.test', password: 'clave-larga-1', rol: 'empleado', activo: true });
    expect(alta.status).toBe(201);
    expect(JSON.stringify((await client.get('/api/admin/permisos')).body)).not.toMatch(/@buddys\.test/);
    expect(ctx.logger.text).not.toMatch(/@buddys\.test/);
  });
});

describe('ids mal formados o raros', () => {
  it('PATCH y DELETE con ids que no son UUID => 404, sin tocar Supabase ni la base', async () => {
    const context = await createAdminContext();
    for (const id of ['abc', '1', "1' OR '1'='1", '00000000-0000-0000-0000-00000000000g', '%00', 'a'.repeat(500)]) {
      const patch = await context.client.patch(`/api/admin/usuarios/${encodeURIComponent(id)}`, { nombre: 'X' });
      const del = await context.client.delete(`/api/admin/usuarios/${encodeURIComponent(id)}`);
      expect([patch.status, del.status], id).toEqual([404, 404]);
      expect(del.body.error.code).toBe('NOT_FOUND');
    }
    expect(context.ctx.supabase.calls.filter((c) => c.path.startsWith('/admin/users'))).toEqual([]);
  });

  it('UUID en mayúsculas apunta al mismo usuario (y uno mismo en mayúsculas sigue siendo uno mismo)', async () => {
    const { client, empleado, id: yo } = await createAdminContext();
    expect((await client.patch(`/api/admin/usuarios/${empleado.toUpperCase()}`, { nombre: 'Mayus' })).body.usuario).toMatchObject({
      id: empleado,
      nombre: 'Mayus',
    });
    expect((await client.delete(`/api/admin/usuarios/${yo.toUpperCase()}`)).status).toBe(409);
  });
});

describe('baja: casos límite', () => {
  it('dos bajas simultáneas del mismo usuario: una da de baja, la otra 409; Auth se toca una sola vez', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    await lavadoDe(client, empleado);
    const otro = await loginClient(ctx, 'otro.empleador@buddys.test');

    const [a, b] = await Promise.all([client.delete(`/api/admin/usuarios/${empleado}`), otro.delete(`/api/admin/usuarios/${empleado}`)]);
    const estados = [a.status, b.status].sort();
    expect(estados).toEqual([200, 409]);
    const conflicto = a.status === 409 ? a : b;
    expect(conflicto.body.error).toEqual({ code: 'CONFLICT', message: 'Ese usuario está dado de baja.' });
    expect(ctx.supabase.calls.filter((c) => c.method === 'PUT' && c.path === `/admin/users/${empleado}`)).toHaveLength(1);
    expect(await perfilEnBase(ctx, empleado)).toMatchObject({ activo: false, eliminado_at: expect.any(Date) });
  });

  it('sin nombre y con email de más de 80 caracteres: el nombre queda recortado a 80 (respeta el CHECK) y se ve en el lavado', async () => {
    const { client, ctx } = await createAdminContext();
    const largo = `${'n'.repeat(100)}@buddys.test`; // 112 caracteres (el email admite hasta 120)
    const id = await addUser(ctx, { email: largo, rol: 'empleado', nombre: null });
    const lavado = await lavadoDe(client, id);

    const baja = await client.delete(`/api/admin/usuarios/${id}`);
    expect(baja.status, JSON.stringify(baja.body)).toBe(200);
    expect(baja.body.usuario.nombre).toBe(largo.slice(0, 80));
    const dia = (await client.get('/api/admin/lavados')).body.lavados as { id: string; trabajador: { nombre: string } }[];
    expect(dia.find((l) => l.id === lavado)?.trabajador.nombre).toBe(largo.slice(0, 80));
    expect(await perfilEnBase(ctx, id)).toMatchObject({ email: `baja+${id}@buddys.invalid` });
  });

  it('el email de baja es por id: dos bajas no chocan entre sí y el email real se puede reusar', async () => {
    const { client, ctx } = await createAdminContext();
    const uno = await addUser(ctx, { email: 'uno@buddys.test', rol: 'empleado', nombre: 'Uno' });
    const dos = await addUser(ctx, { email: 'dos@buddys.test', rol: 'empleado', nombre: 'Dos' });
    await lavadoDe(client, uno);
    await lavadoDe(client, dos);
    expect((await client.delete(`/api/admin/usuarios/${uno}`)).body.resultado).toBe('baja');
    expect((await client.delete(`/api/admin/usuarios/${dos}`)).body.resultado).toBe('baja');
    expect((await perfilEnBase(ctx, uno))?.email).toBe(`baja+${uno}@buddys.invalid`);
    expect((await perfilEnBase(ctx, dos))?.email).toBe(`baja+${dos}@buddys.invalid`);
    expect(ctx.supabase.cuentaDe(uno)?.email).not.toBe(ctx.supabase.cuentaDe(dos)?.email);
  });

  it('el dominio de las bajas (@buddys.invalid) no se puede asignar a mano: no se le "roba" el email de baja a nadie', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    await lavadoDe(client, empleado);
    const reservado = `baja+${empleado}@buddys.invalid`;
    const otro = await addUser(ctx, { email: 'otro@buddys.test', rol: 'empleado', nombre: 'Otro' });

    const alta = await client.post('/api/admin/usuarios', { email: reservado, password: 'clave-larga-1', rol: 'empleado', activo: true });
    expect(alta.status).toBe(400);
    expect(alta.body.error.code).toBe('VALIDATION_ERROR');
    expect(alta.body.error.fields).toHaveProperty('email');
    const patch = await client.patch(`/api/admin/usuarios/${otro}`, { email: ` ${reservado.toUpperCase()} ` });
    expect(patch.status).toBe(400);
    expect(patch.body.error.fields).toHaveProperty('email');
    expect(ctx.supabase.calls.filter((c) => c.path.startsWith('/admin/users'))).toEqual([]);

    // Así, la baja de la persona siempre puede tomar su email de baja.
    expect((await client.delete(`/api/admin/usuarios/${empleado}`)).body.resultado).toBe('baja');
  });

  it('su nombre sigue en lavados, gastos y movimientos de stock; no aparece en /trabajadores ni puede entrar', async () => {
    const context = await createSuperadminContext();
    const { client, ctx } = context;
    const ana = await addUser(ctx, { email: 'ana@buddys.test', rol: 'admin', nombre: 'Ana' });
    const sesionAna = await loginClient(ctx, 'ana@buddys.test');
    const lavado = await lavadoDe(sesionAna, ana);
    const gasto = await sesionAna.post('/api/admin/gastos', { fecha: '2026-10-14', categoria: 'otros', descripcion: 'x', monto: 5 });
    expect(gasto.status).toBe(201);
    const insumo = await sesionAna.post('/api/admin/insumos', { nombre: 'Cera', unidad: 'unidad', stockInicial: 3 });
    const insumoId = String(insumo.body.insumo.id);
    expect((await sesionAna.post(`/api/admin/insumos/${insumoId}/movimientos`, { tipo: 'uso', cantidad: 1 })).status).toBe(201);

    expect((await client.delete(`/api/admin/usuarios/${ana}`)).body.resultado).toBe('baja');

    const dia = (await client.get('/api/admin/lavados')).body.lavados as { id: string; trabajador: { nombre: string } }[];
    expect(dia.find((l) => l.id === lavado)?.trabajador.nombre).toBe('Ana');
    const gastos = (await client.get('/api/admin/gastos')).body.gastos as { creadoPor: { id: string; nombre: string } | null }[];
    expect(gastos.find((g) => g.creadoPor?.id === ana)?.creadoPor?.nombre).toBe('Ana');
    const movimientos = (await client.get(`/api/admin/insumos/${insumoId}/movimientos`)).body.movimientos as {
      persona: { id: string; nombre: string } | null;
    }[];
    expect(movimientos.filter((m) => m.persona?.id === ana).map((m) => m.persona?.nombre)).toContain('Ana');

    const trabajadores = (await client.get('/api/admin/trabajadores')).body.trabajadores as { id: string }[];
    expect(trabajadores.map((t) => t.id)).not.toContain(ana);
    // La baja le borró las sesiones: 401 (antes de B3 daba 403 por estar inactiva).
    expect((await sesionAna.get('/api/admin/usuarios')).status).toBe(401);
    await expect(loginClient(ctx, 'ana@buddys.test')).rejects.toThrow();
    // Y con el email de baja tampoco (está baneado).
    await expect(loginClient(ctx, `baja+${ana}@buddys.invalid`)).rejects.toThrow();
  });

  it('carrera: sin historial al consultar, la FK frena el borrado, cae a la baja y el lavado conserva el nombre', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    let lavado = '';
    ctx.supabase.antesDeBorrar = async () => {
      ctx.supabase.antesDeBorrar = undefined;
      lavado = await lavadoDe(client, empleado);
    };
    const response = await client.delete(`/api/admin/usuarios/${empleado}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.resultado).toBe('baja');
    const dia = (await client.get('/api/admin/lavados')).body.lavados as { id: string; trabajador: { id: string; nombre: string } }[];
    expect(dia.find((l) => l.id === lavado)?.trabajador).toEqual({ id: empleado, nombre: 'Emp' });
  });
});

describe('auditoría A, M1: el email nunca se usa como nombre visible', () => {
  it('sin nombre: en /trabajadores y en la baja se ve la parte del email antes de la @, nunca el email', async () => {
    const { client, ctx } = await createAdminContext();
    const id = await addUser(ctx, { email: 'ana.perez@buddys.test', rol: 'empleado', nombre: null });

    const lista = await client.get('/api/admin/trabajadores');
    expect(lista.status).toBe(200);
    const trabajadores = lista.body.trabajadores as { id: string; nombre: string }[];
    expect(trabajadores.find((t) => t.id === id)?.nombre).toBe('ana.perez');
    expect(JSON.stringify(lista.body)).not.toContain('@');

    const lavado = await lavadoDe(client, id);
    const baja = await client.delete(`/api/admin/usuarios/${id}`);
    expect(baja.status, JSON.stringify(baja.body)).toBe(200);
    expect(baja.body.usuario.nombre).toBe('ana.perez');
    expect(await perfilEnBase(ctx, id)).toMatchObject({ nombre: 'ana.perez' });
    const dia = (await client.get('/api/admin/lavados')).body.lavados as { id: string; trabajador: { nombre: string } }[];
    expect(dia.find((l) => l.id === lavado)?.trabajador.nombre).toBe('ana.perez');
  });

  it('sin nombre ni email en el perfil: /trabajadores dice "Sin nombre" y la baja "Usuario dado de baja"', async () => {
    const { client, ctx } = await createAdminContext();
    const id = await addUser(ctx, { email: 'sin.mail@buddys.test', rol: 'empleado', nombre: null });
    await ctx.db.sql.query('UPDATE buddys.perfiles SET email = NULL WHERE id = $1::uuid', [id]);
    const trabajadores = (await client.get('/api/admin/trabajadores')).body.trabajadores as { id: string; nombre: string }[];
    expect(trabajadores.find((t) => t.id === id)?.nombre).toBe('Sin nombre');

    await lavadoDe(client, id);
    const baja = await client.delete(`/api/admin/usuarios/${id}`);
    expect(baja.status, JSON.stringify(baja.body)).toBe(200);
    expect(await perfilEnBase(ctx, id)).toMatchObject({ nombre: 'Usuario dado de baja' });
  });
});

describe('auditoría A, B1: el rol del objetivo se vuelve a mirar al escribir (TOCTOU)', () => {
  it('lo ascienden a admin entre la consulta y el borrado en Auth: 403 y no se borra', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    // Sin historial: va por el borrado en Auth. Lo ascienden justo después de que el servicio mira su historial.
    const original = ctx.db.appSql.query.bind(ctx.db.appSql);
    let ascendido = false;
    ctx.db.appSql.query = async (text, params) => {
      const result = await original(text, params);
      if (!ascendido && text.includes('AS tiene_historial') && text.includes('WHERE p.id = $1::uuid')) {
        ascendido = true;
        await ctx.db.sql.query("UPDATE buddys.perfiles SET rol_id = 'admin' WHERE id = $1::uuid", [empleado]);
      }
      return result;
    };
    const response = await client.delete(`/api/admin/usuarios/${empleado}`);
    expect(ascendido).toBe(true);
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(ctx.supabase.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    expect(await perfilEnBase(ctx, empleado)).toMatchObject({ rol_id: 'admin', activo: true });
  });

  it('lo ascienden mientras un admin le cambia la contraseña: 403, no se escribe nada ni se toca Auth', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    const original = ctx.db.appSql.query.bind(ctx.db.appSql);
    let ascendido = false;
    ctx.db.appSql.query = async (text, params) => {
      if (!ascendido && text.includes('UPDATE buddys.perfiles AS p')) {
        ascendido = true;
        await ctx.db.sql.query("UPDATE buddys.perfiles SET rol_id = 'admin' WHERE id = $1::uuid", [empleado]);
      }
      return original(text, params);
    };
    const response = await client.patch(`/api/admin/usuarios/${empleado}`, { password: 'clave-robada-1', nombre: 'Pisado' });
    expect(ascendido).toBe(true);
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(await perfilEnBase(ctx, empleado)).toMatchObject({ rol_id: 'admin', nombre: 'Emp' });
    expect(ctx.supabase.calls.filter((c) => c.path.startsWith('/admin/users'))).toEqual([]);
    expect(ctx.supabase.passwordOf('emp@buddys.test')).not.toBe('clave-robada-1');
  });

  it('lo ascienden mientras un admin lo da de baja: 403 y queda como estaba', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    await lavadoDe(client, empleado);
    const original = ctx.db.appSql.transaction.bind(ctx.db.appSql);
    let ascendido = false;
    ctx.db.appSql.transaction = async (fn) => {
      if (!ascendido) {
        ascendido = true;
        await ctx.db.sql.query("UPDATE buddys.perfiles SET rol_id = 'admin' WHERE id = $1::uuid", [empleado]);
      }
      return original(fn);
    };
    const response = await client.delete(`/api/admin/usuarios/${empleado}`);
    expect(ascendido).toBe(true);
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(await perfilEnBase(ctx, empleado)).toMatchObject({ rol_id: 'admin', activo: true, eliminado_at: null });
    expect(ctx.supabase.calls.filter((c) => c.path.startsWith('/admin/users'))).toEqual([]);
  });
});

describe('auditoría A, B3: cambiar la contraseña o el email corta las sesiones de esa persona', () => {
  it('contraseña de otro: sus sesiones abiertas dan 401 en el pedido siguiente; con la nueva vuelve a entrar', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    const sesion1 = await loginClient(ctx, 'emp@buddys.test');
    const sesion2 = await loginClient(ctx, 'emp@buddys.test');
    expect((await sesion1.get('/api/auth/me')).status).toBe(200);

    const response = await client.patch(`/api/admin/usuarios/${empleado}`, { password: 'clave-nueva-789' });
    expect(response.status).toBe(200);
    expect((await sesion1.get('/api/auth/me')).status).toBe(401);
    expect((await sesion2.get('/api/auth/me')).status).toBe(401);
    // La sesión de quien hizo el cambio sigue.
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect(ctx.logger.text).toContain(`Sesiones cerradas id=${empleado}`);
    expect(ctx.logger.text).toContain('cantidad=2');
    const nueva = await loginClient(ctx, 'emp@buddys.test', 'clave-nueva-789');
    expect((await nueva.get('/api/auth/me')).status).toBe(200);
  });

  it('email de otro: también corta sus sesiones; cambiar solo el nombre no', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    const sesion = await loginClient(ctx, 'emp@buddys.test');
    expect((await client.patch(`/api/admin/usuarios/${empleado}`, { nombre: 'Solo nombre' })).status).toBe(200);
    expect((await sesion.get('/api/auth/me')).status).toBe(200);

    expect((await client.patch(`/api/admin/usuarios/${empleado}`, { email: 'emp.nuevo@buddys.test' })).status).toBe(200);
    expect((await sesion.get('/api/auth/me')).status).toBe(401);
  });

  it('el superadmin que cambia su propia contraseña no pierde la sesión actual', async () => {
    const { client, ctx, id } = await createSuperadminContext();
    const response = await client.patch(`/api/admin/usuarios/${id}`, { password: 'mi-clave-nueva-1' });
    expect(response.status).toBe(200);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect(ctx.logger.text).not.toContain('Sesiones cerradas');
  });

  it('la baja también le borra las sesiones', async () => {
    const { client, ctx, empleado } = await createAdminContext();
    await lavadoDe(client, empleado);
    await loginClient(ctx, 'emp@buddys.test');
    const contar = async () =>
      (await ctx.db.sql.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id = $1::uuid', [empleado])).rows[0]?.n;
    expect(await contar()).toBe(1);
    expect((await client.delete(`/api/admin/usuarios/${empleado}`)).body.resultado).toBe('baja');
    expect(await contar()).toBe(0);
  });
});

async function createAdminContext() {
  const { createTestContext } = await import('./helpers.js');
  const ctx = await createTestContext();
  const superadmin = await addUser(ctx, { email: 'jefe@buddys.test', rol: 'superadmin', nombre: 'Jefe' });
  await addUser(ctx, { email: 'otro.admin@buddys.test', rol: 'admin', nombre: 'Otro admin' });
  await addUser(ctx, { email: 'otro.empleador@buddys.test', rol: 'admin', nombre: 'Otro empleador' });
  const empleado = await addUser(ctx, { email: 'emp@buddys.test', rol: 'empleado', nombre: 'Emp' });
  const { client, id } = await loginAs(ctx, 'admin');
  return { ctx, client, id, superadmin, empleado };
}

async function createSuperadminContext() {
  const { createTestContext } = await import('./helpers.js');
  const ctx = await createTestContext();
  const { client, id } = await loginAs(ctx, 'superadmin');
  return { ctx, client, id };
}
