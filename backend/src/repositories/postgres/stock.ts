import type { SqlClient } from '../../db/postgres.js';
import { bool, num, oneOf, str } from '../../db/rows.js';
import {
  type InsumoBajo,
  MOVIMIENTO_NOTA_MAX,
  UNIDADES,
  estaBajoStock,
  formatearCantidad,
  nombreDeUnidad,
  redondear2,
} from '../../domain/inventario.js';

/*
 * Movimientos de stock que van DENTRO de otra transacción: el descuento por receta de un lavado, la devolución al
 * deshacerlo o corregirlo y la marca del aviso de stock bajo (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md,
 * reglas 1 a 6). Reciben el cliente de la transacción de quien llama: si algo falla, no queda nada.
 */

/** Clave 1 de los pg_advisory_xact_lock por insumo (7340001 a 7340004 ya están en uso). La usa también inventario.ts. */
export const LOCK_STOCK = 7340010;

/**
 * Prefijo de la nota de los usos que descuenta una receta. Es solo texto para la persona: qué movimientos son de la
 * receta lo dice la columna `origen` (una nota manual puede empezar igual).
 */
export const NOTA_RECETA = 'Receta: ';

/** movimientos_stock.origen: 'receta' para lo que descuenta una receta y sus devoluciones; el resto, 'manual'. */
const ORIGENES_MOVIMIENTO = ['manual', 'receta'] as const;
type OrigenMovimiento = (typeof ORIGENES_MOVIMIENTO)[number];
export const NOTA_LAVADO_DESHECHO = 'Lavado deshecho';
export const NOTA_LAVADO_CORREGIDO = 'Lavado corregido';

/**
 * Bloqueo por insumo hasta el COMMIT, los mismos que registrarMovimiento. Siempre en orden de id (y sin repetidos):
 * dos lavados que comparten insumos los toman en el mismo orden y no se traban entre sí. Volver a pedir uno que la
 * transacción ya tiene no espera (los advisory locks se acumulan en la misma sesión).
 */
export async function bloquearInsumos(sql: SqlClient, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await sql.query('SELECT pg_catalog.pg_advisory_xact_lock($1::int, pg_catalog.hashtext($2::text))', [LOCK_STOCK, id]);
  }
}

/**
 * Después de cambiar el stock de un insumo (con su bloqueo tomado): si el stock BAJÓ en este pedido (`stockAntes` es
 * el de antes), quedó bajo (stock_minimo > 0 y stock <= stock_minimo) y no tenía un aviso pendiente, marca
 * aviso_bajo_at y devuelve el insumo para avisar después del COMMIT. Cubre el cruce del mínimo y también el insumo que
 * ya estaba bajo sin aviso (se subió el mínimo, o ya estaba bajo cuando se aplicó la migración): avisa en su próxima
 * salida. Si quedó por encima del mínimo (o sin mínimo), limpia la marca. Si no, no toca nada (regla 6).
 */
export async function revisarAvisoBajo(
  sql: SqlClient,
  id: string,
  stockAntes: number,
  ahora: Date,
): Promise<InsumoBajo | null> {
  const { rows } = await sql.query(
    `SELECT nombre, unidad, stock::float8 AS stock, stock_minimo::float8 AS stock_minimo,
            (aviso_bajo_at IS NOT NULL) AS avisado
     FROM buddys.insumos WHERE id = $1::uuid`,
    [id],
  );
  const fila = rows[0];
  if (!fila) return null;
  const stock = num(fila, 'stock');
  const stockMinimo = num(fila, 'stock_minimo');
  const avisado = bool(fila, 'avisado');
  const bajo = estaBajoStock(stock, stockMinimo);
  if (bajo && !avisado && stock < stockAntes) {
    await sql.query('UPDATE buddys.insumos SET aviso_bajo_at = $2::timestamptz WHERE id = $1::uuid', [id, ahora.toISOString()]);
    return { id, nombre: str(fila, 'nombre'), unidad: oneOf(UNIDADES, fila, 'unidad'), stock, stockMinimo };
  }
  if (!bajo && avisado) await sql.query('UPDATE buddys.insumos SET aviso_bajo_at = NULL WHERE id = $1::uuid', [id]);
  return null;
}

interface RenglonADescontar {
  insumoId: string;
  unidad: (typeof UNIDADES)[number];
  cantidad: number;
  servicios: string;
}

/** Los servicios (en su orden) y el vehículo de un turno. undefined si no existe. */
async function serviciosDelTurno(sql: SqlClient, turnoId: string): Promise<{ servicioIds: string[]; vehiculo: string } | undefined> {
  const { rows } = await sql.query(
    `SELECT b.vehiculo_tipo,
            coalesce((SELECT array_agg(ls.servicio_id ORDER BY ls.orden) FROM buddys.lavado_servicios ls WHERE ls.booking_id = b.id),
                     ARRAY[b.servicio_id]) AS servicio_ids
     FROM buddys.bookings b WHERE b.id = $1::uuid`,
    [turnoId],
  );
  const fila = rows[0];
  if (!fila) return undefined;
  const ids = fila.servicio_ids;
  return {
    vehiculo: str(fila, 'vehiculo_tipo'),
    servicioIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
  };
}

/** La receta del lavado `turnoId` tal como está ahora (sus servicios y su vehículo), lista para descontar. */
async function recetaDelTurno(sql: SqlClient, turnoId: string): Promise<RenglonADescontar[]> {
  const turno = await serviciosDelTurno(sql, turnoId);
  if (turno === undefined || turno.servicioIds.length === 0) return [];
  // Regla 1: por cada servicio, los renglones de su vehículo si los hay; si no, los generales. Se suman por insumo y
  // se saltean los inactivos. Por id de insumo: el orden de los bloqueos. `servicios`: los que piden ese insumo.
  const { rows } = await sql.query(
    `WITH pedidos AS (SELECT DISTINCT unnest($1::text[]) AS servicio_id),
     candidatas AS (
       SELECT r.servicio_id, r.insumo_id, r.cantidad, r.vehiculo,
              bool_or(r.vehiculo IS NOT NULL) OVER (PARTITION BY r.servicio_id) AS hay_variante
       FROM buddys.recetas r
       JOIN pedidos p ON p.servicio_id = r.servicio_id
       WHERE r.vehiculo = $2 OR r.vehiculo IS NULL
     )
     SELECT i.id::text AS insumo_id, i.unidad, sum(c.cantidad)::float8 AS cantidad,
            string_agg(DISTINCT s.nombre, ' + ' ORDER BY s.nombre) AS servicios
     FROM candidatas c
     JOIN buddys.insumos i ON i.id = c.insumo_id AND i.activo
     JOIN buddys.servicios s ON s.id = c.servicio_id
     WHERE (c.vehiculo IS NOT NULL) = c.hay_variante
     GROUP BY i.id
     ORDER BY i.id`,
    [turno.servicioIds, turno.vehiculo],
  );
  return rows.map((fila) => ({
    insumoId: str(fila, 'insumo_id'),
    unidad: oneOf(UNIDADES, fila, 'unidad'),
    cantidad: num(fila, 'cantidad'),
    servicios: str(fila, 'servicios'),
  }));
}

/** Recorta a `max` caracteres (no unidades UTF-16), con "…" si sobraba. */
function recortar(texto: string, max: number): string {
  const letras = Array.from(texto);
  return letras.length <= max ? texto : `${letras.slice(0, Math.max(max - 1, 0)).join('')}…`;
}

/**
 * "Receta: Lavado completo" y, si no alcanzó el stock, ". Faltaron 20 ml según la receta". Hasta MOVIMIENTO_NOTA_MAX
 * caracteres: se recorta la parte de los servicios, nunca lo que faltó.
 */
export function notaDeReceta(servicios: string, faltante: number, unidad: (typeof UNIDADES)[number]): string {
  const sufijo =
    faltante > 0 ? `. Faltaron ${formatearCantidad(faltante)} ${nombreDeUnidad(unidad, faltante)} según la receta` : '';
  return `${recortar(`${NOTA_RECETA}${servicios}`, MOVIMIENTO_NOTA_MAX - Array.from(sufijo).length)}${sufijo}`;
}

/**
 * Descuenta la receta del lavado `turnoId` (reglas 1 a 3), con los bloqueos en orden de id. El stock nunca frena el
 * lavado: si no alcanza, se descuenta lo que hay (queda en 0) y el movimiento registra lo que de verdad se descontó,
 * con la nota de lo que faltó. Devuelve los insumos que cruzaron su mínimo (para avisar después del COMMIT).
 */
export async function descontarReceta(
  sql: SqlClient,
  turnoId: string,
  perfilId: string | null,
  ahora: Date,
  revisarAvisos = true,
): Promise<InsumoBajo[]> {
  const renglones = await recetaDelTurno(sql, turnoId);
  await bloquearInsumos(
    sql,
    renglones.map((renglon) => renglon.insumoId),
  );
  const bajaron: InsumoBajo[] = [];
  for (const renglon of renglones) {
    const actual = await sql.query('SELECT stock::float8 AS stock FROM buddys.insumos WHERE id = $1::uuid FOR UPDATE', [
      renglon.insumoId,
    ]);
    const stock = num(actual.rows[0] ?? {}, 'stock');
    const descontado = redondear2(Math.min(stock, renglon.cantidad));
    // Sin stock no hay movimiento (un uso de 0 no existe: CHECK movimientos_stock_signo).
    if (descontado <= 0) continue;
    await sql.query('UPDATE buddys.insumos SET stock = stock - $2::numeric WHERE id = $1::uuid', [renglon.insumoId, descontado]);
    await sql.query(
      `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, turno_id, perfil_id, origen)
       VALUES ($1::uuid, 'uso', -$2::numeric, $3::text, $4::uuid, $5::uuid, 'receta')`,
      [
        renglon.insumoId,
        descontado,
        notaDeReceta(renglon.servicios, redondear2(renglon.cantidad - descontado), renglon.unidad),
        turnoId,
        perfilId,
      ],
    );
    if (!revisarAvisos) continue;
    const aviso = await revisarAvisoBajo(sql, renglon.insumoId, stock, ahora);
    if (aviso !== null) bajaron.push(aviso);
  }
  return bajaron;
}

interface Pendiente {
  insumoId: string;
  origen: OrigenMovimiento;
  cantidad: number;
}

/**
 * Lo que falta devolver de un lavado, por insumo y por origen: lo descontado (usos) menos lo ya devuelto. `soloReceta`
 * deja afuera los usos cargados a mano y vinculados al lavado (la corrección recalcula solo la receta). Se separa por
 * la columna `origen`, nunca por la nota: un uso manual con la nota "Receta: ..." sigue siendo manual.
 */
async function pendienteDeDevolver(sql: SqlClient, turnoId: string, soloReceta: boolean): Promise<Pendiente[]> {
  const { rows } = await sql.query(
    `SELECT m.insumo_id::text AS insumo_id, m.origen, (-sum(m.cantidad))::float8 AS cantidad
     FROM buddys.movimientos_stock m
     WHERE m.turno_id = $1::uuid AND m.tipo IN ('uso', 'devolucion')
       AND (NOT $2::boolean OR m.origen = 'receta')
     GROUP BY m.insumo_id, m.origen
     HAVING sum(m.cantidad) < 0
     ORDER BY m.insumo_id, m.origen`,
    [turnoId, soloReceta],
  );
  return rows.map((fila) => ({
    insumoId: str(fila, 'insumo_id'),
    origen: oneOf(ORIGENES_MOVIMIENTO, fila, 'origen'),
    cantidad: num(fila, 'cantidad'),
  }));
}

/**
 * Devuelve al stock exactamente lo que el lavado descontó y todavía no se devolvió (regla 4), con un movimiento
 * `devolucion` por insumo y origen (la devolución de lo que descontó la receta también es de origen 'receta'). Va ANTES del DELETE del lavado: movimientos_stock.turno_id es ON DELETE SET NULL y después
 * ya no se sabría qué movimientos eran suyos. La devolución NO limpia aviso_bajo_at: si lo hiciera, registrar y deshacer
 * un lavado en bucle (el empleado puede deshacer el suyo 5 minutos) mandaría un push en cada vuelta. La marca solo la
 * limpian una compra, un ajuste o un cambio de mínimo (admin) cuando el stock queda por encima del mínimo.
 */
export async function devolverDelLavado(
  sql: SqlClient,
  turnoId: string,
  perfilId: string | null,
  nota: string,
  soloReceta: boolean,
): Promise<void> {
  const pendientes = await pendienteDeDevolver(sql, turnoId, soloReceta);
  await bloquearInsumos(
    sql,
    pendientes.map((pendiente) => pendiente.insumoId),
  );
  for (const { insumoId, origen, cantidad } of pendientes) {
    await sql.query('SELECT 1 FROM buddys.insumos WHERE id = $1::uuid FOR UPDATE', [insumoId]);
    await sql.query('UPDATE buddys.insumos SET stock = stock + $2::numeric WHERE id = $1::uuid', [insumoId, cantidad]);
    await sql.query(
      `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, turno_id, perfil_id, origen)
       VALUES ($1::uuid, 'devolucion', $2::numeric, $3::text, $4::uuid, $5::uuid, $6::text)`,
      [insumoId, cantidad, nota, turnoId, perfilId, origen],
    );
  }
}

/**
 * Corrección de un lavado (regla 5): devuelve lo que descontó su receta y descuenta la receta nueva (los servicios y el
 * vehículo que tiene AHORA). Primero toma los bloqueos de todos los insumos involucrados, en orden de id. El aviso se
 * decide con el stock de antes y el de después de las dos cosas: devolver y volver a descontar lo mismo no avisa.
 */
export async function recalcularReceta(
  sql: SqlClient,
  turnoId: string,
  perfilId: string | null,
  ahora: Date,
): Promise<InsumoBajo[]> {
  const pendientes = await pendienteDeDevolver(sql, turnoId, true);
  const renglones = await recetaDelTurno(sql, turnoId);
  const ids = [...new Set([...pendientes.map((p) => p.insumoId), ...renglones.map((r) => r.insumoId)])].sort();
  await bloquearInsumos(sql, ids);
  const antes = await sql.query(
    'SELECT id::text AS id, stock::float8 AS stock FROM buddys.insumos WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [ids],
  );
  await devolverDelLavado(sql, turnoId, perfilId, NOTA_LAVADO_CORREGIDO, true);
  await descontarReceta(sql, turnoId, perfilId, ahora, false);
  const bajaron: InsumoBajo[] = [];
  for (const fila of antes.rows) {
    const aviso = await revisarAvisoBajo(sql, str(fila, 'id'), num(fila, 'stock'), ahora);
    if (aviso !== null) bajaron.push(aviso);
  }
  return bajaron;
}
