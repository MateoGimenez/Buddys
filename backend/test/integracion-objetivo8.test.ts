import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../src/config.js';
import { type TestContext, addUser, closeAllContexts, createClient, createTestContext, loginClient } from './helpers.js';

afterEach(closeAllContexts);

/*
 * Objetivo 8, de punta a punta por la API (app de test + PGlite) y contrato de la API.
 *
 * 1. El flujo del taller: completar con cobro, estadísticas, empleado, corrección, baja de la persona, vuelta a pendiente.
 * 2. Las respuestas REALES del backend se guardan en test/fixtures/respuestas-api.json y el test
 *    frontend/src/api/contrato-backend.test.ts las pasa por los esquemas estrictos del panel. Para regenerarlas:
 *    ACTUALIZAR_FIXTURES=1 npx vitest run test/integracion-objetivo8.test.ts (sin la variable, el test verifica que el
 *    archivo guardado coincide con lo que devuelve el backend hoy: si el contrato cambia y nadie regeneró, falla).
 */

async function turno(context: TestContext, fecha: string, estado = 'confirmado', servicio = 'pulido'): Promise<string> {
  const { rows } = await context.db.sql.query(
    `INSERT INTO buddys.bookings (nombre, telefono, vehiculo_tipo, servicio_id, fecha_preferida, franja, estado)
     VALUES ('Cliente Largo Nombre', '12345678', 'auto', $1, $2::date, 'manana', $3) RETURNING id::text AS id`,
    [servicio, fecha, estado],
  );
  return String(rows[0]?.id);
}

describe('flujo completo: cobro, estadísticas, empleado, baja de la persona y vuelta a pendiente', () => {
  it('los números siguen a cada paso', async () => {
    const context = await createTestContext();
    await addUser(context, { email: 'ana@t.test', rol: 'admin', nombre: 'Ana' });
    const beto = await addUser(context, { email: 'beto@t.test', rol: 'empleado', nombre: 'Beto' });
    const carla = await addUser(context, { email: 'carla@t.test', rol: 'empleado', nombre: 'Carla' });
    const admin = await loginClient(context, 'ana@t.test');
    const empleado = await loginClient(context, 'beto@t.test');
    const t1 = await turno(context, '2026-10-16');
    const t2 = await turno(context, '2026-10-16', 'confirmado', 'encerado');
    const stats = async () => (await admin.get('/api/admin/estadisticas')).body;

    // 1. el admin completa con monto y trabajador
    const r1 = await admin.patch(`/api/admin/bookings/${t1}`, { estado: 'completado', monto: 60000, trabajadorId: carla });
    expect(r1.status).toBe(200);
    let s = await stats();
    expect(s.periodo).toMatchObject({ completados: 1, ingresos: 60000, ticketPromedio: 60000, completadosSinMonto: 0 });
    expect(s.porTrabajador).toEqual([{ id: carla, nombre: 'Carla', completados: 1, ingresos: 60000 }]);
    expect(s.resumen.hoy.actual).toEqual({ completados: 1, ingresos: 60000, gastos: 0, ganancia: 60000 });

    // 2. el empleado completa otro: queda él, sin monto
    const r2 = await empleado.patch(`/api/admin/bookings/${t2}`, { estado: 'completado' });
    expect(r2.status).toBe(200);
    expect(r2.body.booking).toMatchObject({ monto: null, trabajador: { id: beto, nombre: 'Beto' } });
    s = await stats();
    expect(s.periodo).toMatchObject({ completados: 2, ingresos: 60000, completadosSinMonto: 1, ticketPromedio: 60000 });
    expect(s.porTrabajador.map((f: { nombre: string }) => f.nombre).sort()).toEqual(['Beto', 'Carla']);
    const mias = (await empleado.get('/api/admin/estadisticas/mias')).body;
    expect(mias.completados).toBe(1);
    expect(mias.porServicio).toEqual([{ servicioId: 'encerado', nombre: 'Encerado', completados: 1 }]);
    expect(JSON.stringify(mias)).not.toMatch(/60000|ingresos|monto/);

    // 3. el admin le carga el cobro
    const r3 = await admin.patch(`/api/admin/bookings/${t2}`, { monto: 40000 });
    expect(r3.status).toBe(200);
    s = await stats();
    expect(s.periodo).toMatchObject({ ingresos: 100000, completadosSinMonto: 0, ticketPromedio: 50000 });
    expect(s.completadosSinTrabajador).toBe(0);

    // 4. se borra a Carla: su trabajo queda "Sin asignar" y no se pierde el ingreso
    await context.db.sql.query('DELETE FROM auth.users WHERE id = $1::uuid', [carla]);
    s = await stats();
    expect(s.periodo.ingresos).toBe(100000);
    expect(s.porTrabajador).toContainEqual({ id: null, nombre: 'Sin asignar', completados: 1, ingresos: 60000 });
    expect(s.completadosSinTrabajador).toBe(1);
    const lista = (await admin.get('/api/admin/bookings')).body.bookings as { id: string; monto: number | null; trabajador: unknown }[];
    expect(lista.find((b) => b.id === t1)).toMatchObject({ monto: 60000, trabajador: null });

    // 5. vuelve a pendiente: se limpia el cobro y bajan los ingresos
    const r5 = await admin.patch(`/api/admin/bookings/${t1}`, { estado: 'pendiente' });
    expect(r5.status).toBe(200);
    expect(r5.body.booking).toMatchObject({ estado: 'pendiente', monto: null, trabajador: null });
    s = await stats();
    expect(s.periodo).toMatchObject({ completados: 1, ingresos: 40000, ticketPromedio: 40000 });
    expect(s.completadosSinTrabajador).toBe(0);
    expect(s.resumen.hoy.actual).toEqual({ completados: 1, ingresos: 40000, gastos: 0, ganancia: 40000 });
  });
});

/* ---------- Respuestas reales de la API (contrato para un frontend futuro) ---------- */

/** Supabase Storage falso para las fotos (sin red): firma subidas y lecturas con un token fijo. */
const storageFalso = ((input: string, init?: RequestInit) => {
  if (init?.method === 'HEAD') {
    return Promise.resolve(new Response(null, { status: 200, headers: { 'content-length': '523000', 'content-type': 'image/webp' } }));
  }
  const ruta = input.replace(/^https:\/\/[^/]+\/storage\/v1/, '');
  if (ruta.startsWith('/object/upload/sign/')) return Promise.resolve(Response.json({ url: `${ruta}?token=token-de-subida` }));
  // Firma en lote (fotos de perfil): POST /object/sign/<bucket> { expiresIn, paths }.
  const lote = /^\/object\/sign\/([a-z-]+)$/.exec(ruta);
  if (lote !== null) {
    const { paths } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { paths: string[] };
    return Promise.resolve(
      Response.json(paths.map((p) => ({ path: p, signedURL: `/object/sign/${String(lote[1])}/${p}?token=token-de-lectura`, error: null }))),
    );
  }
  if (ruta.startsWith('/object/sign/')) return Promise.resolve(Response.json({ signedURL: `${ruta}?token=token-de-lectura` }));
  return Promise.resolve(Response.json([]));
}) as typeof fetch;

const FIXTURES = path.join(BACKEND_ROOT, 'test', 'fixtures', 'respuestas-api.json');

/** Ids y fechas de hora aleatorios se reemplazan por valores estables, en orden de aparición. */
function normalizar(valor: unknown): unknown {
  const ids = new Map<string, string>();
  const texto = JSON.stringify(valor)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
      if (!ids.has(id)) ids.set(id, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(id) ?? id;
    })
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '2026-10-16T15:00:00.000Z');
  return JSON.parse(texto);
}

describe('respuestas reales del backend (contrato de la API)', () => {
  it('coinciden con las guardadas en test/fixtures/respuestas-api.json (ACTUALIZAR_FIXTURES=1 las regenera)', async () => {
    const context = await createTestContext({ storageFetch: storageFalso });
    const ana = await addUser(context, { email: 'ana@t.test', rol: 'admin', nombre: 'Ana' });
    await addUser(context, { email: 'beto@t.test', rol: 'empleado', nombre: 'Beto' });
    await addUser(context, { email: 'sin@t.test', rol: 'empleado', nombre: null });
    const admin = await loginClient(context, 'ana@t.test');
    const empleado = await loginClient(context, 'beto@t.test');

    const a = await turno(context, '2026-10-16');
    const b = await turno(context, '2026-10-16', 'confirmado', 'encerado');
    const c = await turno(context, '2026-10-15', 'pendiente');
    const d = await turno(context, '2026-09-20', 'confirmado');
    await turno(context, '2026-10-14', 'cancelado');
    const capturas: Record<string, { status: number; body: unknown }> = {};
    const cap = (nombre: string, res: { status: number; body: unknown }) => {
      capturas[nombre] = { status: res.status, body: res.body };
    };

    cap('patchAdminCompleta', await admin.patch(`/api/admin/bookings/${a}`, { estado: 'completado', monto: 60000, trabajadorId: ana }));
    cap('patchEmpleadoCompleta', await empleado.patch(`/api/admin/bookings/${b}`, { estado: 'completado' }));
    cap('patchAdminCompletaSinCobro', await admin.patch(`/api/admin/bookings/${d}`, { estado: 'completado' }));
    cap('error400Monto', await admin.patch(`/api/admin/bookings/${c}`, { monto: 5 }));
    cap('error400MontoRango', await admin.patch(`/api/admin/bookings/${a}`, { monto: 100000000 }));
    cap('error400Trabajador', await admin.patch(`/api/admin/bookings/${c}`, { trabajadorId: ana }));
    cap('error400TrabajadorInexistente', await admin.patch(`/api/admin/bookings/${a}`, { trabajadorId: '11111111-1111-4111-8111-111111111111' }));
    cap('error403EmpleadoMonto', await empleado.patch(`/api/admin/bookings/${c}`, { monto: 5 }));
    cap('error403EmpleadoCorrige', await empleado.patch(`/api/admin/bookings/${a}`, { notasInternas: 'x', trabajadorId: ana }));
    cap('error403EstadisticasEmpleado', await empleado.get('/api/admin/estadisticas'));

    // Objetivo 10 (M1): gastos, metas y datos del taller. Los gastos van ANTES de las estadísticas que los suman.
    cap('gastoCrea', await admin.post('/api/admin/gastos', { fecha: '2026-10-14', categoria: 'insumos', descripcion: 'Cera en pasta y paños', monto: 12500, proveedor: 'Distribuidora Norte' }));
    cap('gastoCreaSinProveedor', await admin.post('/api/admin/gastos', { fecha: '2026-10-02', categoria: 'alquiler', descripcion: 'Alquiler del local', monto: 90000 }));
    await admin.post('/api/admin/gastos', { fecha: '2026-09-20', categoria: 'servicios', descripcion: 'Luz y agua', monto: 8000 });
    await context.db.sql.query(
      "INSERT INTO buddys.gastos (fecha, categoria, descripcion, monto, origen) VALUES ('2026-10-10', 'insumos', 'Compra: Shampoo (5 litro)', 6000, 'inventario')",
    );
    cap('error400GastoFechaFutura', await admin.post('/api/admin/gastos', { fecha: '2026-10-17', categoria: 'otros', descripcion: 'x', monto: 5 }));
    cap('error400GastoMonto', await admin.post('/api/admin/gastos', { fecha: '2026-10-14', categoria: 'otros', descripcion: 'x', monto: 0 }));
    cap('gastosLista', await admin.get('/api/admin/gastos'));
    cap('gastosFiltrados', await admin.get('/api/admin/gastos?categoria=insumos&q=cera&limit=1'));
    const inventario = (capturas.gastosLista?.body as { gastos: { id: string; origen: string }[] }).gastos.find((g) => g.origen === 'inventario');
    cap('error409GastoDeInventario', await admin.patch(`/api/admin/gastos/${String(inventario?.id)}`, { monto: 1 }));
    cap('error403GastosEmpleado', await empleado.get('/api/admin/gastos'));
    cap('metaPut', await admin.put('/api/admin/metas/2026-10', { ingresosObjetivo: 1500000, trabajosObjetivo: 40 }));
    await admin.put('/api/admin/metas/2026-09', { ingresosObjetivo: 50000 });
    cap('error400MetaVacia', await admin.put('/api/admin/metas/2026-08', {}));
    cap('metasActual', await admin.get('/api/admin/metas/actual'));
    cap('metasAnio', await admin.get('/api/admin/metas?anio=2026'));
    cap('error403MetasEmpleado', await empleado.get('/api/admin/metas/actual'));
    cap('tallerGet', await admin.get('/api/admin/taller'));
    cap('tallerPut', await admin.put('/api/admin/taller', { nombre: 'Buddys Wash Detail', telefono: '5493804781737', direccion: 'Calle Olta Pasaje N2, La Rioja', instagram: 'buddys', cuit: '20-12345678-9', leyendaPdf: 'Gracias por confiar en nosotros.' }));
    cap('error400Taller', await admin.put('/api/admin/taller', { nombre: '', telefono: '380-478', instagram: '@buddys', cuit: '123' }));
    cap('error403TallerEmpleado', await empleado.get('/api/admin/taller'));

    cap('listaAdmin', await admin.get('/api/admin/bookings'));
    cap('listaEmpleado', await empleado.get('/api/admin/bookings'));
    cap('agendaAdmin', await admin.get('/api/admin/agenda?desde=2026-10-14&hasta=2026-10-16'));
    cap('agendaEmpleado', await empleado.get('/api/admin/agenda?desde=2026-10-14&hasta=2026-10-16'));
    cap('trabajadores', await admin.get('/api/admin/trabajadores'));
    cap('estadisticasMes', await admin.get('/api/admin/estadisticas'));
    cap('estadisticasAnio', await admin.get('/api/admin/estadisticas?desde=2026-01-01&hasta=2026-12-31'));
    cap('estadisticasVacio', await admin.get('/api/admin/estadisticas?desde=2020-01-01&hasta=2020-01-07'));
    cap('misTrabajos', await empleado.get('/api/admin/estadisticas/mias'));
    cap('misTrabajosAnio', await empleado.get('/api/admin/estadisticas/mias?desde=2026-01-01&hasta=2026-12-31'));
    cap('permisosEmpleado', await empleado.get('/api/admin/permisos'));
    cap('permisosAdmin', await admin.get('/api/admin/permisos'));

    // Objetivo 10 (M2/M3): inventario, presupuestos y comprobantes. Van al FINAL: una compra con costo crea un gasto del
    // mes, y las capturas de gastos y estadísticas de arriba no tienen que cambiar.
    cap('insumoCrea', await admin.post('/api/admin/insumos', { nombre: 'Shampoo ph neutro', categoria: 'Lavado', unidad: 'litro', stockInicial: 5, stockMinimo: 2, costoUnitario: 1200 }));
    cap('insumoCreaSinCosto', await admin.post('/api/admin/insumos', { nombre: 'Cera en pasta', unidad: 'unidad', stockInicial: 1, stockMinimo: 3 }));
    cap('error400Insumo', await admin.post('/api/admin/insumos', { nombre: '', unidad: 'galon', stockInicial: 1.234 }));
    cap('error409InsumoRepetido', await admin.post('/api/admin/insumos', { nombre: 'SHAMPOO PH NEUTRO', unidad: 'litro' }));
    cap('error403InsumoEmpleado', await empleado.post('/api/admin/insumos', { nombre: 'Paño', unidad: 'unidad' }));
    const shampoo = (capturas.insumoCrea?.body as { insumo: { id: string } }).insumo.id;
    const cera = (capturas.insumoCreaSinCosto?.body as { insumo: { id: string } }).insumo.id;
    cap('insumoPatch', await admin.patch(`/api/admin/insumos/${shampoo}`, { categoria: 'Lavado exterior', stockMinimo: 1.5 }));
    cap('movimientoUsoAdmin', await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 0.5, nota: 'Auto de Juan', turnoId: a }));
    cap('movimientoUsoEmpleado', await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 1.25 }));
    cap('movimientoCompra', await admin.post(`/api/admin/insumos/${cera}/movimientos`, { tipo: 'compra', cantidad: 5, costoTotal: 12500, proveedor: 'Distribuidora Norte', nota: 'Factura 0001' }));
    cap('movimientoAjuste', await admin.post(`/api/admin/insumos/${cera}/movimientos`, { tipo: 'ajuste', stockReal: 4.5, nota: 'Conteo del sábado' }));
    cap('movimientoAjusteSinCambio', await admin.post(`/api/admin/insumos/${cera}/movimientos`, { tipo: 'ajuste', stockReal: 4.5 }));
    cap('error409Stock', await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 10 }));
    cap('error400Movimiento', await admin.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'uso', cantidad: 0 }));
    cap('error403CompraEmpleado', await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'compra', cantidad: 1, costoTotal: 100 }));
    cap('error403AjusteEmpleado', await empleado.post(`/api/admin/insumos/${shampoo}/movimientos`, { tipo: 'ajuste', stockReal: 1 }));
    cap('movimientosAdmin', await admin.get(`/api/admin/insumos/${cera}/movimientos`));
    cap('movimientosEmpleado', await empleado.get(`/api/admin/insumos/${cera}/movimientos`));
    cap('insumosAdmin', await admin.get('/api/admin/insumos'));
    cap('insumosEmpleado', await empleado.get('/api/admin/insumos'));
    cap('insumosBajoStock', await admin.get('/api/admin/insumos?bajoStock=true'));
    cap('presupuestoCrea', await admin.post('/api/admin/presupuestos', {
      clienteNombre: 'María Núñez', clienteTelefono: '380 412-3456', vehiculo: 'Ford Ka 2019',
      items: [{ descripcion: 'Pulido completo', cantidad: 1, precioUnitario: 25000 }, { descripcion: 'Encerado', cantidad: 1.5, precioUnitario: 10001 }],
      descuento: 3000, validezDias: 10, notas: 'Incluye lavado previo.',
    }));
    cap('presupuestoCreaMinimo', await admin.post('/api/admin/presupuestos', { clienteNombre: 'Pedro', items: [{ descripcion: 'Lavado', cantidad: 1, precioUnitario: 8000 }] }));
    const presu = (capturas.presupuestoCrea?.body as { presupuesto: { id: string } }).presupuesto.id;
    cap('error400Presupuesto', await admin.post('/api/admin/presupuestos', { clienteNombre: '', items: [{ descripcion: 'ok', cantidad: 1, precioUnitario: 1 }, { descripcion: '', cantidad: 0, precioUnitario: 1.5 }] }));
    cap('presupuestoPatch', await admin.patch(`/api/admin/presupuestos/${presu}`, { estado: 'aceptado', clienteTelefono: null }));
    cap('error409PresupuestoAceptado', await admin.delete(`/api/admin/presupuestos/${presu}`));
    cap('presupuestosLista', await admin.get('/api/admin/presupuestos'));
    cap('error403PresupuestosEmpleado', await empleado.get('/api/admin/presupuestos'));
    cap('error404Comprobante', await admin.get(`/api/admin/bookings/${a}/comprobante`));
    cap('error400ComprobanteSinCobro', await admin.post(`/api/admin/bookings/${c}/comprobante`, { formaPago: 'efectivo' }));
    cap('comprobanteCrea', await admin.post(`/api/admin/bookings/${a}/comprobante`, { formaPago: 'transferencia', notas: 'Alias mg.detailing' }));
    cap('comprobanteExistente', await admin.post(`/api/admin/bookings/${a}/comprobante`, { formaPago: 'efectivo' }));
    cap('comprobanteGet', await admin.get(`/api/admin/bookings/${a}/comprobante`));
    cap('error403ComprobanteEmpleado', await empleado.post(`/api/admin/bookings/${a}/comprobante`, { formaPago: 'efectivo' }));
    // Revisión de los objetivos 9 y 10: más errores reales que el panel tiene que manejar.
    cap('error400ComprobanteFormaPago', await admin.post(`/api/admin/bookings/${a}/comprobante`, { formaPago: 'bitcoin' }));
    cap('error409TurnoConComprobante', await admin.delete(`/api/admin/bookings/${a}`));
    cap('error404Gasto', await admin.delete('/api/admin/gastos/22222222-2222-4222-8222-222222222222'));
    cap('error404Presupuesto', await admin.get('/api/admin/presupuestos/22222222-2222-4222-8222-222222222222'));
    cap('error404Insumo', await admin.post('/api/admin/insumos/22222222-2222-4222-8222-222222222222/movimientos', { tipo: 'uso', cantidad: 1 }));
    cap('error400MetaMes', await admin.put('/api/admin/metas/2030-01', { ingresosObjetivo: 1000 }));
    cap('error400CompraCostoAlto', await admin.post(`/api/admin/insumos/${cera}/movimientos`, { tipo: 'compra', cantidad: 0.01, costoTotal: 5000000 }));
    cap('error400PresupuestoTotal', await admin.post('/api/admin/presupuestos', { clienteNombre: 'Pedro', items: [{ descripcion: 'x', cantidad: 999, precioUnitario: 99999999 }] }));

    // Precios por tipo de vehículo (contrato 2026-11-01_19): catálogo público y del panel. Al final: no mueve nada de arriba.
    cap('serviciosPublico', await createClient(context.app).get('/api/servicios'));
    cap('serviciosAdmin', await admin.get('/api/admin/servicios'));
    cap('servicioCrea', await admin.post('/api/admin/servicios', { id: 'tratamiento-ceramico', nombre: 'Tratamiento cerámico', resumen: 'Protección de larga duración.', descripcion: 'Una capa cerámica sobre la pintura.', precioDesde: 150000, precioDesdeSuv: 180000, precioDesdePickup: 190000, precioDesdeMoto: null, categoria: 'Protección' }));
    cap('servicioPatchPrecios', await admin.patch('/api/admin/servicios/pulido', { precioDesde: 45000, precioDesdeSuv: 60000, precioDesdePickup: 65000, precioDesdeMoto: 30000 }));
    cap('servicioPatchBorraPrecio', await admin.patch('/api/admin/servicios/pulido', { precioDesdeMoto: null }));
    cap('error400PrecioSuv', await admin.patch('/api/admin/servicios/pulido', { precioDesdeSuv: 100000000 }));
    cap('error400Categoria', await admin.patch('/api/admin/servicios/pulido', { categoria: 'x'.repeat(41) }));
    cap('error400PrecioMoto', await admin.patch('/api/admin/servicios/pulido', { precioDesdeMoto: 1.5 }));
    cap('servicioPatchVehiculos', await admin.patch('/api/admin/servicios/pulido', { vehiculos: ['moto', 'auto'] }));
    cap('serviciosPublicoConVehiculos', await createClient(context.app).get('/api/servicios'));
    cap('error400Vehiculos', await admin.patch('/api/admin/servicios/pulido', { vehiculos: [] }));
    cap('error400ReservaServicioNoOfrecido', await createClient(context.app).post('/api/bookings', { nombre: 'Juan Pérez', telefono: '+54 9 380 412-3456', email: 'juan@example.com', vehiculoTipo: 'pickup', vehiculoModelo: 'Hilux 2020', servicioId: 'pulido', fechaPreferida: '2026-10-20', franja: 'manana' }));
    cap('error403ServicioEmpleado', await empleado.patch('/api/admin/servicios/pulido', { precioDesdeMoto: 1 }));

    // Lavados: forma de pago, cierre de caja y deshacer (contrato 2026-11-13). Al final: no mueve nada de arriba.
    const lavado = { servicioId: 'lavado-basico', vehiculoTipo: 'auto' } as const;
    const otroEmpleado = await loginClient(context, 'sin@t.test');
    const lavadoAdmin = await admin.post('/api/admin/lavados', { ...lavado, monto: 15000, formaPago: 'transferencia', nombre: 'Juan', vehiculoModelo: 'Gol AB123CD' });
    cap('lavadoCrea', lavadoAdmin);
    const reintento = { ...lavado, monto: 9000, formaPago: 'efectivo', idLocal: '33333333-3333-4333-8333-333333333333' };
    const lavadoEmpleado = await empleado.post('/api/admin/lavados', reintento);
    cap('lavadoCreaEmpleado', lavadoEmpleado);
    cap('lavadoReintentoIdLocal', await empleado.post('/api/admin/lavados', reintento));
    cap('error409IdLocalAjeno', await otroEmpleado.post('/api/admin/lavados', reintento));
    await admin.post('/api/admin/lavados', { ...lavado, monto: 4000 });
    cap('error400LavadoFormaPago', await admin.post('/api/admin/lavados', { ...lavado, formaPago: 'bitcoin' }));
    cap('lavadosDiaAdmin', await admin.get('/api/admin/lavados'));
    cap('lavadosDiaEmpleado', await empleado.get('/api/admin/lavados'));
    const idAdmin = String(lavadoAdmin.body.lavado.id);
    const idEmpleado = String(lavadoEmpleado.body.lavado.id);
    cap('patchFormaPago', await admin.patch(`/api/admin/bookings/${idEmpleado}`, { formaPago: 'debito' }));
    cap('error403FormaPagoEmpleado', await empleado.patch(`/api/admin/bookings/${idEmpleado}`, { formaPago: 'efectivo' }));
    cap('comprobanteDeLavado', await admin.post(`/api/admin/bookings/${idAdmin}/comprobante`, {}));
    cap('error409DeshacerConComprobante', await admin.delete(`/api/admin/lavados/${idAdmin}`));
    cap('error403DeshacerAjeno', await otroEmpleado.delete(`/api/admin/lavados/${idEmpleado}`));
    cap('error404Deshacer', await admin.delete('/api/admin/lavados/22222222-2222-4222-8222-222222222222'));
    const reloj = context.clock.current;
    context.clock.current = new Date(reloj.getTime() + 6 * 60_000);
    cap('error403PlazoDeshacer', await empleado.delete(`/api/admin/lavados/${idEmpleado}`));
    context.clock.current = reloj;
    cap('deshacerLavado', await empleado.delete(`/api/admin/lavados/${idEmpleado}`));

    // Varios servicios por lavado (contrato 2026-11-13, objetivo multi-servicio). Al final: no mueve nada de arriba.
    await admin.patch('/api/admin/servicios/lavado-basico', { precioDesde: 20000, precioDesdeSuv: 25000, vehiculos: ['auto', 'suv', 'pickup'] });
    const varios = { servicioIds: ['lavado-basico', 'encerado'], vehiculoTipo: 'suv', monto: 30000, formaPago: 'efectivo' } as const;
    const lavadoVarios = await admin.post('/api/admin/lavados', varios);
    cap('lavadoCreaVarios', lavadoVarios);
    cap('lavadoCreaVariosEmpleado', await empleado.post('/api/admin/lavados', varios));
    cap('error400LavadoServiciosRepetidos', await admin.post('/api/admin/lavados', { ...varios, servicioIds: ['encerado', 'encerado'] }));
    cap('error400LavadoServicioIdYServicioIds', await admin.post('/api/admin/lavados', { ...varios, servicioId: 'encerado' }));
    cap('error400LavadoServicioNoOfrecido', await admin.post('/api/admin/lavados', { ...varios, vehiculoTipo: 'moto' }));
    const idVarios = String(lavadoVarios.body.lavado.id);
    cap('patchServicios', await admin.patch(`/api/admin/bookings/${idVarios}`, { servicioIds: ['encerado', 'restauracion-opticas', 'lavado-basico'] }));
    cap('error403ServiciosEmpleado', await empleado.patch(`/api/admin/bookings/${idVarios}`, { servicioIds: ['pulido'] }));
    cap('lavadosDiaVariosEmpleado', await empleado.get('/api/admin/lavados'));
    cap('comprobanteVarios', await admin.post(`/api/admin/bookings/${idVarios}/comprobante`, {}));

    // Mejoras del contrato 2026-11-15 (reportes/2026-11-15_03_contrato-mejoras.md). Al final: no mueve nada de arriba.
    await addUser(context, { email: 'duena@t.test', rol: 'superadmin', nombre: 'Dueña' });
    const dueno = await loginClient(context, 'duena@t.test');
    const cliente = { nombre: 'Juan Pérez', telefono: '0380 15-4123456', vehiculoModelo: 'Gol AB123CD' };
    // 9. Etapas
    const enEspera = await empleado.post('/api/admin/lavados', { ...lavado, ...cliente, monto: 9000, etapa: 'espera' });
    cap('lavadoCreaEnEspera', enEspera);
    const idEspera = String(enEspera.body.lavado.id);
    cap('lavadoEtapaListo', await empleado.patch(`/api/admin/lavados/${idEspera}/etapa`, { etapa: 'listo' }));
    cap('lavadosEnCurso', await empleado.get('/api/admin/lavados/en-curso'));
    cap('error403EtapaAjena', await otroEmpleado.patch(`/api/admin/lavados/${idEspera}/etapa`, { etapa: 'lavando' }));
    cap('error400Etapa', await admin.patch(`/api/admin/lavados/${idEspera}/etapa`, { etapa: 'volando' }));
    // 12. Descuentos
    const conDescuento = await admin.post('/api/admin/lavados', { ...lavado, ...cliente, monto: 8000, descuento: 2000, descuentoMotivo: 'Cliente frecuente', formaPago: 'efectivo' });
    cap('lavadoConDescuento', conDescuento);
    cap('error400DescuentoSinMotivo', await admin.post('/api/admin/lavados', { ...lavado, monto: 8000, descuento: 2000 }));
    cap('error403DescuentoEmpleado', await empleado.post('/api/admin/lavados', { ...lavado, monto: 8000, descuento: 2000, descuentoMotivo: 'x' }));
    cap('patchDescuento', await admin.patch(`/api/admin/bookings/${String(conDescuento.body.lavado.id)}`, { descuento: 1000, descuentoMotivo: 'Promo' }));
    // 8. Turnos con seña
    const turnoPanel = { ...cliente, telefono: '+54 9 380 412-3456', vehiculoTipo: 'auto', servicioIds: ['pulido', 'encerado'], fecha: '2026-10-20', franja: 'manana', sena: { monto: 20000, formaPago: 'transferencia' } };
    const conSena = await admin.post('/api/admin/turnos', turnoPanel);
    cap('turnoConSenaCrea', conSena);
    const idSena = String(conSena.body.turno.id);
    cap('error403TurnoEmpleado', await empleado.post('/api/admin/turnos', turnoPanel));
    cap('turnoConSenaEmpleadoLista', await empleado.get('/api/admin/agenda?desde=2026-10-20&hasta=2026-10-20'));
    cap('senaPut', await admin.put(`/api/admin/turnos/${idSena}/sena`, { monto: 25000, formaPago: 'efectivo' }));
    cap('error400Sena', await admin.put(`/api/admin/turnos/${idSena}/sena`, { monto: 0, formaPago: 'bitcoin' }));
    cap('error400MontoMenorSena', await admin.patch(`/api/admin/bookings/${idSena}`, { estado: 'completado', monto: 10000 }));
    cap('turnoCompletaConSena', await admin.patch(`/api/admin/bookings/${idSena}`, { estado: 'completado', monto: 60000 }));
    // 6 y 14. Clientes
    cap('clienteHistorialTelefonoAdmin', await admin.get('/api/admin/clientes/historial?telefono=3804123456'));
    cap('clienteHistorialPatenteEmpleado', await empleado.get('/api/admin/clientes/historial?patente=ab-123-cd'));
    cap('error404Cliente', await admin.get('/api/admin/clientes/historial?patente=ZZZ999'));
    cap('error400ClienteDosClaves', await admin.get('/api/admin/clientes/historial?patente=AB123CD&telefono=3804123456'));
    cap('busquedaPatente', await empleado.get('/api/admin/bookings?q=ab%20123%20cd&limit=2'));
    cap('fidelizacionGet', await empleado.get('/api/admin/fidelizacion'));
    cap('fidelizacionPut', await dueno.put('/api/admin/fidelizacion', { sellosCada: 8, premio: 'descuento', premioPorcentaje: 50, inactivosDias: 30 }));
    cap('error403FidelizacionAdmin', await admin.put('/api/admin/fidelizacion', { sellosCada: 8, premio: 'gratis', inactivosDias: 30 }));
    await admin.post('/api/admin/lavados', { ...lavado, nombre: 'Ana Gómez', telefono: '3804111111', vehiculoModelo: 'Corsa', fecha: '2026-09-15' });
    cap('clientesInactivos', await admin.get('/api/admin/clientes/inactivos'));
    cap('error403InactivosEmpleado', await empleado.get('/api/admin/clientes/inactivos'));
    // 10. Gastos fijos
    const fijo = await dueno.post('/api/admin/gastos-fijos', { concepto: 'Sueldo de Beto', monto: 300000, categoria: 'sueldos', perfilId: String(lavadoEmpleado.body.lavado.trabajador.id), desde: '2026-10' });
    cap('gastoFijoCrea', fijo);
    await dueno.post('/api/admin/gastos-fijos', { concepto: 'Alquiler del local', monto: 150000, categoria: 'alquiler' });
    cap('gastosFijosLista', await admin.get('/api/admin/gastos-fijos'));
    cap('gastoFijoDesactiva', await dueno.patch(`/api/admin/gastos-fijos/${String(fijo.body.gastoFijo.id)}`, { activo: false }));
    cap('error403GastoFijoAdmin', await admin.post('/api/admin/gastos-fijos', { concepto: 'x', monto: 1, categoria: 'otros' }));
    cap('error403GastosFijosEmpleado', await empleado.get('/api/admin/gastos-fijos'));
    cap('estadisticasConFijos', await admin.get('/api/admin/estadisticas?desde=2026-10-01&hasta=2026-10-16'));
    // 11. Caja
    cap('cajaAbierta', await admin.get('/api/admin/caja'));
    cap('cajaCierra', await admin.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 30000, transferencia: 15000 }, nota: 'Faltan 500 de cambio' }));
    cap('cajaCerrada', await admin.get('/api/admin/caja?fecha=2026-10-16'));
    cap('cajaCierres', await admin.get('/api/admin/caja/cierres'));
    cap('error403CajaEmpleado', await empleado.get('/api/admin/caja'));
    cap('error403CajaReabrirAdmin', await admin.put('/api/admin/caja/2026-10-16', { contado: { efectivo: 1 } }));
    cap('error400Caja', await admin.put('/api/admin/caja/2026-10-15', { contado: { transferencia: 5 } }));
    // 15. Insumos por servicio
    const insumo = await admin.post('/api/admin/insumos', { nombre: 'Shampoo neutro', unidad: 'litro', stockInicial: 5, stockMinimo: 1 });
    const idInsumo = String(insumo.body.insumo.id);
    cap('recetaPut', await admin.put('/api/admin/servicios/lavado-basico/insumos', { insumos: [{ insumoId: idInsumo, cantidad: 0.25, cantidadSuv: 0.4 }] }));
    cap('recetaGet', await empleado.get('/api/admin/servicios/lavado-basico/insumos'));
    cap('error403RecetaEmpleado', await empleado.put('/api/admin/servicios/lavado-basico/insumos', { insumos: [] }));
    await admin.post('/api/admin/lavados', { ...lavado, monto: 1000 });
    cap('movimientosAutomaticos', await admin.get(`/api/admin/insumos/${idInsumo}/movimientos`));
    // 13. Fotos (Storage falso)
    const fotos = `/api/admin/lavados/${idEspera}/fotos`;
    const subida = await empleado.post(fotos, { tipo: 'antes', contentType: 'image/webp', tamano: 523000 });
    cap('fotoSubida', subida);
    cap('fotoConfirmada', await empleado.post(`${fotos}/${String(subida.body.foto.id)}/confirmar`));
    // Un segundo entre subidas: el orden de la lista (created_at) no depende de ids al azar.
    for (let i = 0; i < 5; i++) {
      context.clock.current = new Date(context.clock.current.getTime() + 1000);
      await admin.post(fotos, { tipo: 'despues', contentType: 'image/jpeg', tamano: 400000 });
    }
    cap('fotosLista', await empleado.get(fotos));
    cap('error409FotosMaximo', await admin.post(fotos, { tipo: 'antes', contentType: 'image/webp', tamano: 1000 }));
    cap('error403FotoBorrarAjena', await otroEmpleado.delete(`${fotos}/${String(subida.body.foto.id)}`));
    cap('error400FotoTipo', await admin.post(`/api/admin/lavados/${idEspera}/fotos`, { tipo: 'antes', contentType: 'image/png', tamano: 1000 }));
    // 16 y 26.
    cap('error403ExportarEmpleado', await empleado.get('/api/admin/exportar/planilla.csv?desde=2026-10-01&hasta=2026-10-31'));
    cap('errorClienteRegistrado', await empleado.post('/api/admin/errores-cliente', { mensaje: 'TypeError: x is undefined', url: '/admin/planilla', userAgent: 'Mozilla/5.0', version: '1.0.0' }));
    cap('error400ErrorCliente', await createClient(context.app).post('/api/errores-cliente', { mensaje: '' }));
    cap('permisosAdminMejoras', await admin.get('/api/admin/permisos'));

    // Perfil propio y foto de perfil (contrato 2026-11-16_04).
    cap('perfilGet', await empleado.get('/api/admin/perfil'));
    cap('perfilPatch', await empleado.patch('/api/admin/perfil', { nombre: 'Beto Gómez' }));
    cap('error400PerfilNombre', await empleado.patch('/api/admin/perfil', { nombre: 'B' }));
    cap('avatarSubida', await empleado.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 300000 }));
    cap('error400AvatarTamano', await empleado.post('/api/admin/perfil/avatar', { contentType: 'image/webp', tamano: 600000 }));
    cap('avatarConfirmado', await empleado.post('/api/admin/perfil/avatar/confirmar'));
    cap('error409AvatarSinPendiente', await empleado.post('/api/admin/perfil/avatar/confirmar'));
    cap('meConAvatar', await empleado.get('/api/auth/me'));
    cap('trabajadoresConAvatar', await admin.get('/api/admin/trabajadores'));
    cap('error400ClaveActual', await empleado.post('/api/admin/perfil/clave', { actual: 'no-es-esta', nueva: 'una-clave-nueva-123' }));
    cap('usuariosConAvatar', await dueno.get('/api/admin/usuarios'));
    cap('error400ClaveIgual', await empleado.post('/api/admin/perfil/clave', { actual: 'x-12345678', nueva: 'x-12345678' }));

    const generadas = normalizar(capturas);
    if (process.env.ACTUALIZAR_FIXTURES === '1') {
      mkdirSync(path.dirname(FIXTURES), { recursive: true });
      writeFileSync(FIXTURES, `${JSON.stringify(generadas, null, 2)}\n`);
    }
    expect(existsSync(FIXTURES), 'Faltan las respuestas guardadas: correr con ACTUALIZAR_FIXTURES=1').toBe(true);
    expect(generadas).toEqual(JSON.parse(readFileSync(FIXTURES, 'utf8')));
  });
});
