import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
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
    // Sin ranking (contrato 2026-11-17_05): las estadísticas no comparan personas.
    expect(s).not.toHaveProperty('porTrabajador');
    expect(s).not.toHaveProperty('completadosSinTrabajador');
    expect(s.resumen.hoy.actual).toEqual({ completados: 1, ingresos: 60000, gastos: 0, ganancia: 60000 });

    // 2. el empleado completa otro: queda él, sin monto
    const r2 = await empleado.patch(`/api/admin/bookings/${t2}`, { estado: 'completado' });
    expect(r2.status).toBe(200);
    expect(r2.body.booking).toMatchObject({ monto: null, trabajador: { id: beto, nombre: 'Beto' } });
    s = await stats();
    expect(s.periodo).toMatchObject({ completados: 2, ingresos: 60000, completadosSinMonto: 1, ticketPromedio: 60000 });
    const mias = (await empleado.get('/api/admin/estadisticas/mias')).body;
    expect(mias.completados).toBe(1);
    expect(mias.porServicio).toEqual([{ servicioId: 'encerado', nombre: 'Encerado', completados: 1 }]);
    expect(JSON.stringify(mias)).not.toMatch(/60000|ingresos|monto/);

    // 3. el admin le carga el cobro
    const r3 = await admin.patch(`/api/admin/bookings/${t2}`, { monto: 40000 });
    expect(r3.status).toBe(200);
    s = await stats();
    expect(s.periodo).toMatchObject({ ingresos: 100000, completadosSinMonto: 0, ticketPromedio: 50000 });

    // 4. Carla no se puede borrar (tiene trabajos: FK RESTRICT); se la da de baja y su trabajo sigue con su nombre
    await expect(context.db.sql.query('DELETE FROM auth.users WHERE id = $1::uuid', [carla])).rejects.toMatchObject({ code: '23001' });
    await context.db.sql.query('UPDATE buddys.perfiles SET activo = false, eliminado_at = now() WHERE id = $1::uuid', [carla]);
    s = await stats();
    expect(s.periodo).toMatchObject({ completados: 2, ingresos: 100000 });
    const lista = (await admin.get('/api/admin/bookings')).body.bookings as { id: string; monto: number | null; trabajador: unknown }[];
    expect(lista.find((b) => b.id === t1)).toMatchObject({ monto: 60000, trabajador: { id: carla, nombre: 'Carla' } });

    // 5. vuelve a pendiente: se limpia el cobro y bajan los ingresos
    const r5 = await admin.patch(`/api/admin/bookings/${t1}`, { estado: 'pendiente' });
    expect(r5.status).toBe(200);
    expect(r5.body.booking).toMatchObject({ estado: 'pendiente', monto: null, trabajador: null });
    s = await stats();
    expect(s.periodo).toMatchObject({ completados: 1, ingresos: 40000, ticketPromedio: 40000 });
    expect(s.resumen.hoy.actual).toEqual({ completados: 1, ingresos: 40000, gastos: 0, ganancia: 40000 });
  });
});

/* ---------- Respuestas reales de la API (contrato para un frontend futuro) ---------- */

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
    const context = await createTestContext();
    const ana = await addUser(context, { email: 'ana@t.test', rol: 'admin', nombre: 'Ana' });
    const beto = await addUser(context, { email: 'beto@t.test', rol: 'empleado', nombre: 'Beto' });
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

    // Gestión de usuarios (contrato 2026-11-17_03): Ana es admin (gestiona solo empleados). Al final: dar de baja a Beto
    // no mueve nada de arriba.
    cap('usuariosVistaAdmin', await admin.get('/api/admin/usuarios'));
    const nuevo = await admin.post('/api/admin/usuarios', { email: 'nuevo@t.test', password: 'clave-nueva-123', nombre: 'Nuevo', rol: 'empleado', activo: true });
    cap('usuarioCreaEmpleado', nuevo);
    cap('error403UsuarioCreaAdmin', await admin.post('/api/admin/usuarios', { email: 'otro@t.test', password: 'clave-nueva-123', rol: 'admin', activo: true }));
    const jefeId = await addUser(context, { email: 'jefe@t.test', rol: 'superadmin', nombre: 'Jefe' });
    cap('error403UsuarioGestionarAdmin', await admin.patch(`/api/admin/usuarios/${jefeId}`, { nombre: 'Otro' }));
    cap('usuarioPatchEmpleado', await admin.patch(`/api/admin/usuarios/${String(nuevo.body.usuario.id)}`, { activo: false }));
    cap('usuarioEliminado', await admin.delete(`/api/admin/usuarios/${String(nuevo.body.usuario.id)}`));
    cap('usuarioBaja', await admin.delete(`/api/admin/usuarios/${beto}`));
    cap('error409UsuarioDadoDeBaja', await admin.patch(`/api/admin/usuarios/${beto}`, { nombre: 'Beto' }));
    cap('error409UsuarioEliminarseASiMismo', await admin.delete(`/api/admin/usuarios/${ana}`));
    cap('error403UsuariosEmpleado', await otroEmpleado.get('/api/admin/usuarios'));
    cap('usuariosVistaSuperadmin', await (await loginClient(context, 'jefe@t.test')).get('/api/admin/usuarios'));

    // Seguimiento sin ranking (contrato 2026-11-17_05): Beto ya está dado de baja y sus lavados siguen "Registrado por: Beto".
    cap('lavadosDiaConBaja', await admin.get('/api/admin/lavados'));
    const conBaja = capturas.lavadosDiaConBaja?.body as { lavados: { registradoPor: unknown }[]; resumen: object };
    expect(conBaja.lavados.map((l) => l.registradoPor)).toContainEqual({ id: beto, nombre: 'Beto' });
    expect(conBaja.resumen).not.toHaveProperty('porTrabajador');

    // Mi perfil y foto (contrato 2026-11-17_04). Al final: Ana cambia su nombre y vuelve, no mueve nada de arriba.
    const foto = (tipo: string, bytes: Buffer | string) =>
      admin.agent.put('/api/admin/perfil/foto').set('Origin', 'http://localhost:5173').set('Content-Type', tipo).send(bytes);
    cap('perfilGet', await admin.get('/api/admin/perfil'));
    cap('perfilGetEmpleado', await otroEmpleado.get('/api/admin/perfil'));
    cap('perfilPatchNombre', await admin.patch('/api/admin/perfil', { nombre: 'Ana María' }));
    await admin.patch('/api/admin/perfil', { nombre: 'Ana' });
    cap('perfilPatchPassword', await admin.patch('/api/admin/perfil', { passwordActual: 'clave-de-prueba-123', passwordNueva: 'clave-nueva-456' }));
    cap('error400PerfilPasswordActual', await admin.patch('/api/admin/perfil', { passwordActual: 'otra-clave-999', passwordNueva: 'clave-nueva-789' }));
    cap('error400PerfilPasswordFaltante', await admin.patch('/api/admin/perfil', { passwordActual: 'clave-nueva-456' }));
    cap('error400PerfilVacio', await admin.patch('/api/admin/perfil', {}));
    const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#2a6' } }).png().toBuffer();
    const subida = await foto('image/png', png);
    cap('perfilFotoSube', subida);
    cap('error400FotoInvalida', await foto('image/jpeg', png));
    const pesada = Buffer.alloc(3 * 1024 * 1024, 0);
    pesada.set([0xff, 0xd8, 0xff], 0);
    cap('error413FotoPesada', await foto('image/jpeg', pesada));
    cap('error415FotoTipo', await foto('image/gif', png));
    cap('error403FotoAjena', await otroEmpleado.get(`/api/admin/usuarios/${ana}/foto`));
    cap('error404FotoSinFoto', await admin.get(`/api/admin/usuarios/${jefeId}/foto`));
    cap('usuariosConFoto', await admin.get('/api/admin/usuarios'));
    cap('meConFoto', await admin.get('/api/auth/me'));
    expect((await admin.get(`/api/admin/usuarios/${ana}/foto?v=${String(subida.body.perfil.fotoVersion)}`)).status).toBe(200);
    cap('perfilFotoQuita', await admin.delete('/api/admin/perfil/foto'));

    // Recetas, stock y avisos (contrato 2026-11-17_06). Al final: no mueve nada de arriba. Los movimientos del consumo
    // van con fecha fija (los de la receta llevan la hora real de la base y caen fuera del rango pedido).
    const nuevoInsumo = async (datos: Record<string, unknown>) =>
      String((await admin.post('/api/admin/insumos', { unidad: 'ml', ...datos })).body.insumo.id);
    const stShampoo = await nuevoInsumo({ nombre: 'Shampoo', categoria: 'Químicos', unidad: 'litro', stockInicial: 2, stockMinimo: 1, costoUnitario: 9000 });
    const stPanos = await nuevoInsumo({ nombre: 'Paños de microfibra', categoria: 'Accesorios', unidad: 'unidad', stockInicial: 2, stockMinimo: 6 });
    const stCera = await nuevoInsumo({ nombre: 'Cera líquida', categoria: 'Químicos', stockInicial: 4000, stockMinimo: 500, costoUnitario: 12 });
    cap('recetaPut', await admin.put('/api/admin/servicios/lavado-basico/receta', { vehiculo: null, items: [{ insumoId: stShampoo, cantidad: 0.5 }, { insumoId: stCera, cantidad: 30 }] }));
    cap('recetaPutVehiculo', await admin.put('/api/admin/servicios/lavado-basico/receta', { vehiculo: 'pickup', items: [{ insumoId: stShampoo, cantidad: 0.8 }] }));
    cap('error400RecetaInsumo', await admin.put('/api/admin/servicios/lavado-basico/receta', { vehiculo: null, items: [{ insumoId: '44444444-4444-4444-8444-444444444444', cantidad: 1 }] }));
    cap('error400RecetaVehiculo', await admin.put('/api/admin/servicios/lavado-basico/receta', { vehiculo: 'moto', items: [] }));
    cap('error404RecetaServicio', await admin.put('/api/admin/servicios/no-existe/receta', { vehiculo: null, items: [] }));
    cap('error403RecetaEmpleado', await otroEmpleado.put('/api/admin/servicios/lavado-basico/receta', { vehiculo: null, items: [] }));
    cap('recetasAdmin', await admin.get('/api/admin/recetas'));
    cap('recetasEmpleado', await otroEmpleado.get('/api/admin/recetas'));
    await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' }); // stShampoo 2 -> 1,5
    await admin.post('/api/admin/lavados', { servicioId: 'lavado-basico', vehiculoTipo: 'auto' }); // 1,5 -> 1: cruza
    await context.db.sql.query(
      `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, created_at)
       VALUES ($1::uuid, 'uso', -1.5, '2026-10-10T15:00:00Z'), ($1::uuid, 'devolucion', 0.5, '2026-10-11T15:00:00Z'),
              ($2::uuid, 'uso', -60, '2026-10-12T15:00:00Z'), ($3::uuid, 'uso', -1, '2026-10-12T15:00:00Z')`,
      [stShampoo, stCera, stPanos],
    );
    cap('alertasAdmin', await admin.get('/api/admin/insumos/alertas'));
    cap('error403AlertasEmpleado', await otroEmpleado.get('/api/admin/insumos/alertas'));
    cap('paraComprarAdmin', await admin.get('/api/admin/insumos/para-comprar'));
    cap('error403ParaComprarEmpleado', await otroEmpleado.get('/api/admin/insumos/para-comprar'));
    cap('consumoAdmin', await admin.get('/api/admin/consumo?desde=2026-10-01&hasta=2026-10-31'));
    cap('consumoSemanas', await admin.get('/api/admin/consumo?desde=2026-08-01&hasta=2026-10-31'));
    cap('error400Consumo', await admin.get('/api/admin/consumo?desde=2026-10-31&hasta=2026-10-01'));
    cap('error403ConsumoEmpleado', await otroEmpleado.get('/api/admin/consumo?desde=basura'));
    cap('error400MovimientoDevolucion', await admin.post(`/api/admin/insumos/${stShampoo}/movimientos`, { tipo: 'devolucion', cantidad: 1 }));

    const generadas = normalizar(capturas);
    if (process.env.ACTUALIZAR_FIXTURES === '1') {
      mkdirSync(path.dirname(FIXTURES), { recursive: true });
      writeFileSync(FIXTURES, `${JSON.stringify(generadas, null, 2)}\n`);
    }
    expect(existsSync(FIXTURES), 'Faltan las respuestas guardadas: correr con ACTUALIZAR_FIXTURES=1').toBe(true);
    expect(generadas).toEqual(JSON.parse(readFileSync(FIXTURES, 'utf8')));
  });
});
