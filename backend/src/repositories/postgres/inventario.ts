import type { SqlClient } from '../../db/postgres.js';
import { type Row, bool, int, intOrNull, isoTimestamp, num, oneOf, str, strOrNull } from '../../db/rows.js';
import {
  type AgrupadoConsumo,
  type AlertasDeStock,
  type DatosDeConsumo,
  type ParaComprar,
  type CambiosInsumo,
  type ContextoMovimiento,
  type FiltroInsumos,
  type Insumo,
  type InventarioRepository,
  type ListaInsumos,
  type ListaMovimientos,
  type Movimiento,
  type NuevoInsumo,
  NombreDeInsumoRepetidoError,
  type PedidoMovimiento,
  type ResultadoMovimiento,
  STOCK_MAX,
  StockExcedidoError,
  StockInsuficienteError,
  TIPOS_MOVIMIENTO,
  TurnoInexistenteError,
  UNIDADES,
  formatearCantidad,
  redondear2,
} from '../../domain/inventario.js';
import { registrarGastoDeInventario } from '../../services/gastos.js';
import { escapeLike } from './bookings.js';
import { LOCK_STOCK, revisarAvisoBajo } from './stock.js';
import { isUuid } from './uuid.js';

/** Clave del pg_advisory_xact_lock de los nombres (la del stock, LOCK_STOCK, la comparte stock.ts). */
const LOCK_NOMBRES = 7340011;

/** El período de date_trunc / generate_series de cada agrupación del consumo (constantes: nunca vienen del cliente). */
const PERIODO_DE_SERIE: Readonly<Record<AgrupadoConsumo, 'day' | 'week' | 'month'>> = {
  dia: 'day',
  semana: 'week',
  mes: 'month',
};

function toInsumo(row: Row): Insumo {
  return {
    id: str(row, 'id'),
    nombre: str(row, 'nombre'),
    categoria: strOrNull(row, 'categoria'),
    unidad: oneOf(UNIDADES, row, 'unidad'),
    stock: num(row, 'stock'),
    stockMinimo: num(row, 'stock_minimo'),
    costoUnitario: intOrNull(row, 'costo_unitario'),
    activo: bool(row, 'activo'),
    bajoStock: bool(row, 'bajo_stock'),
    valorEnStock: intOrNull(row, 'valor_en_stock'),
    updatedAt: isoTimestamp(row, 'updated_at'),
  };
}

function toMovimiento(row: Row): Movimiento {
  const perfilId = strOrNull(row, 'perfil_id');
  return {
    id: str(row, 'id'),
    tipo: oneOf(TIPOS_MOVIMIENTO, row, 'tipo'),
    cantidad: num(row, 'cantidad'),
    costoTotal: intOrNull(row, 'costo_total'),
    proveedor: strOrNull(row, 'proveedor'),
    nota: strOrNull(row, 'nota'),
    persona: perfilId === null ? null : { id: perfilId, nombre: str(row, 'persona_nombre') },
    turnoId: strOrNull(row, 'turno_id'),
    createdAt: isoTimestamp(row, 'created_at'),
  };
}

async function leerInsumo(sql: SqlClient, id: string): Promise<Insumo | null> {
  const { rows } = await sql.query(
    `SELECT i.id::text AS id, i.nombre, i.categoria, i.unidad, i.stock::float8 AS stock,
            i.stock_minimo::float8 AS stock_minimo, i.costo_unitario, i.activo,
            (i.stock_minimo > 0 AND i.stock <= i.stock_minimo) AS bajo_stock,
            CASE WHEN i.costo_unitario IS NULL THEN NULL ELSE round(i.stock * i.costo_unitario)::float8 END AS valor_en_stock,
            i.updated_at
     FROM buddys.insumos i
     WHERE i.id = $1::uuid`,
    [id],
  );
  const row = rows[0];
  return row ? toInsumo(row) : null;
}

async function leerMovimiento(sql: SqlClient, id: string): Promise<Movimiento> {
  const { rows } = await sql.query(
    `SELECT m.id::text AS id, m.tipo, m.cantidad::float8 AS cantidad, m.costo_total, m.proveedor, m.nota,
            m.perfil_id::text AS perfil_id,
            coalesce(nullif(btrim(p.nombre), ''), 'Sin nombre') AS persona_nombre,
            m.turno_id::text AS turno_id, m.created_at
     FROM buddys.movimientos_stock m
     LEFT JOIN buddys.perfiles p ON p.id = m.perfil_id
     WHERE m.id = $1::uuid`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('El movimiento de stock no se encontró después de guardarlo');
  return toMovimiento(row);
}

/** Falla si ya hay OTRO insumo activo con ese nombre (sin distinguir mayúsculas). Siempre con el bloqueo de nombres. */
async function verificarNombreLibre(sql: SqlClient, nombre: string, excepto: string | null): Promise<void> {
  const { rows } = await sql.query(
    `SELECT 1 AS ok FROM buddys.insumos
     WHERE activo AND lower(btrim(nombre)) = lower(btrim($1::text)) AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [nombre, excepto],
  );
  if (rows.length > 0) throw new NombreDeInsumoRepetidoError();
}

/** Insumos y su historial sobre Postgres. El stock y el movimiento cambian juntos, en una transacción. */
export class PostgresInventarioRepository implements InventarioRepository {
  constructor(private readonly sql: SqlClient) {}

  async listar(filtro: FiltroInsumos): Promise<ListaInsumos> {
    // Texto: buddys.texto_busqueda (minúsculas y sin acentos) a los dos lados del LIKE; los comodines vienen
    // escapados (escapeLike) y el ESCAPE es explícito.
    const patron = filtro.q === undefined ? null : `%${escapeLike(filtro.q)}%`;
    const soloBajoStock = filtro.bajoStock === true;

    const [conteo, global, lista] = await Promise.all([
      this.sql.query(
        `SELECT count(*)::int AS total
         FROM buddys.insumos i
         WHERE ($1::text = 'todos' OR i.activo = ($1::text = 'true'))
           AND ($2::text IS NULL
                OR buddys.texto_busqueda(i.nombre) LIKE buddys.texto_busqueda($2::text) ESCAPE '\\'
                OR buddys.texto_busqueda(coalesce(i.categoria, '')) LIKE buddys.texto_busqueda($2::text) ESCAPE '\\')
           AND (NOT $3::boolean OR (i.stock_minimo > 0 AND i.stock <= i.stock_minimo))`,
        [filtro.activo, patron, soloBajoStock],
      ),
      // Todo el inventario activo, sin filtros: el aviso de stock bajo y el valor total.
      this.sql.query(
        `SELECT count(*) FILTER (WHERE i.stock_minimo > 0 AND i.stock <= i.stock_minimo)::int AS bajo_stock,
                coalesce(sum(round(i.stock * i.costo_unitario)) FILTER (WHERE i.costo_unitario IS NOT NULL), 0)::float8 AS valor_total
         FROM buddys.insumos i
         WHERE i.activo`,
      ),
      this.sql.query(
        `SELECT i.id::text AS id, i.nombre, i.categoria, i.unidad, i.stock::float8 AS stock,
                i.stock_minimo::float8 AS stock_minimo, i.costo_unitario, i.activo,
                (i.stock_minimo > 0 AND i.stock <= i.stock_minimo) AS bajo_stock,
                CASE WHEN i.costo_unitario IS NULL THEN NULL ELSE round(i.stock * i.costo_unitario)::float8 END AS valor_en_stock,
                i.updated_at
         FROM buddys.insumos i
         WHERE ($1::text = 'todos' OR i.activo = ($1::text = 'true'))
           AND ($2::text IS NULL
                OR buddys.texto_busqueda(i.nombre) LIKE buddys.texto_busqueda($2::text) ESCAPE '\\'
                OR buddys.texto_busqueda(coalesce(i.categoria, '')) LIKE buddys.texto_busqueda($2::text) ESCAPE '\\')
           AND (NOT $3::boolean OR (i.stock_minimo > 0 AND i.stock <= i.stock_minimo))
         ORDER BY (i.stock_minimo > 0 AND i.stock <= i.stock_minimo) DESC,
                  buddys.texto_busqueda(i.nombre), i.id
         LIMIT $4::int OFFSET $5::int`,
        [filtro.activo, patron, soloBajoStock, filtro.limit, filtro.offset],
      ),
    ]);
    const total = conteo.rows[0];
    const resumen = global.rows[0];
    if (!total || !resumen) throw new Error('El resumen del inventario no devolvió fila');
    return {
      insumos: lista.rows.map(toInsumo),
      total: int(total, 'total'),
      bajoStock: int(resumen, 'bajo_stock'),
      valorTotal: int(resumen, 'valor_total'),
    };
  }

  obtener(id: string): Promise<Insumo | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return leerInsumo(this.sql, id);
  }

  crear(nuevo: NuevoInsumo, contexto: ContextoMovimiento): Promise<Insumo> {
    return this.sql.transaction(async (tx) => {
      await tx.query('SELECT pg_catalog.pg_advisory_xact_lock($1::int)', [LOCK_NOMBRES]);
      await verificarNombreLibre(tx, nuevo.nombre, null);
      const { rows } = await tx.query(
        `INSERT INTO buddys.insumos (nombre, categoria, unidad, stock, stock_minimo, costo_unitario)
         VALUES ($1::text, $2::text, $3::text, $4::numeric, $5::numeric, $6::int)
         RETURNING id::text AS id`,
        [nuevo.nombre, nuevo.categoria, nuevo.unidad, nuevo.stockInicial, nuevo.stockMinimo, nuevo.costoUnitario],
      );
      const id = str(rows[0] ?? {}, 'id');
      if (nuevo.stockInicial > 0) {
        await tx.query(
          `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, perfil_id)
           VALUES ($1::uuid, 'ajuste', $2::numeric, 'Stock inicial', $3::uuid)`,
          [id, nuevo.stockInicial, contexto.perfilId],
        );
      }
      const insumo = await leerInsumo(tx, id);
      if (!insumo) throw new Error('El insumo no se encontró después de crearlo');
      return insumo;
    });
  }

  actualizar(id: string, cambios: CambiosInsumo, ahora: Date): Promise<Insumo | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return this.sql.transaction(async (tx) => {
      await tx.query('SELECT pg_catalog.pg_advisory_xact_lock($1::int)', [LOCK_NOMBRES]);
      const actual = await tx.query('SELECT nombre, activo FROM buddys.insumos WHERE id = $1::uuid FOR UPDATE', [id]);
      const fila = actual.rows[0];
      if (!fila) return null;
      const nombreFinal = cambios.nombre ?? str(fila, 'nombre');
      const activoFinal = cambios.activo ?? bool(fila, 'activo');
      // Solo cuando queda activo y cambia el nombre o se reactiva puede chocar con otro activo.
      if (activoFinal && (cambios.nombre !== undefined || cambios.activo === true)) {
        await verificarNombreLibre(tx, nombreFinal, id);
      }
      await tx.query(
        `UPDATE buddys.insumos
         SET nombre = coalesce($2::text, nombre),
             categoria = CASE WHEN $3::boolean THEN $4::text ELSE categoria END,
             unidad = coalesce($5::text, unidad),
             stock_minimo = coalesce($6::numeric, stock_minimo),
             -- Cambiar el mínimo reinicia el aviso de stock bajo (regla 6): el próximo cruce vuelve a avisar.
             aviso_bajo_at = CASE WHEN $6::numeric IS NOT NULL AND $6::numeric <> stock_minimo THEN NULL
                                  ELSE aviso_bajo_at END,
             costo_unitario = CASE WHEN $7::boolean THEN $8::int ELSE costo_unitario END,
             activo = coalesce($9::boolean, activo),
             updated_at = $10::timestamptz
         WHERE id = $1::uuid`,
        [
          id,
          cambios.nombre ?? null,
          cambios.categoria !== undefined,
          cambios.categoria ?? null,
          cambios.unidad ?? null,
          cambios.stockMinimo ?? null,
          cambios.costoUnitario !== undefined,
          cambios.costoUnitario ?? null,
          cambios.activo ?? null,
          ahora.toISOString(),
        ],
      );
      return leerInsumo(tx, id);
    });
  }

  async listarMovimientos(id: string, limit: number, offset: number): Promise<ListaMovimientos | null> {
    if (!isUuid(id)) return null;
    const existe = await this.sql.query('SELECT 1 AS ok FROM buddys.insumos WHERE id = $1::uuid', [id]);
    if (existe.rows.length === 0) return null;
    const [conteo, lista] = await Promise.all([
      this.sql.query('SELECT count(*)::int AS total FROM buddys.movimientos_stock WHERE insumo_id = $1::uuid', [id]),
      this.sql.query(
        `SELECT m.id::text AS id, m.tipo, m.cantidad::float8 AS cantidad, m.costo_total, m.proveedor, m.nota,
                m.perfil_id::text AS perfil_id,
                coalesce(nullif(btrim(p.nombre), ''), 'Sin nombre') AS persona_nombre,
                m.turno_id::text AS turno_id, m.created_at
         FROM buddys.movimientos_stock m
         LEFT JOIN buddys.perfiles p ON p.id = m.perfil_id
         WHERE m.insumo_id = $1::uuid
         ORDER BY m.created_at DESC, m.id
         LIMIT $2::int OFFSET $3::int`,
        [id, limit, offset],
      ),
    ]);
    const total = conteo.rows[0];
    if (!total) throw new Error('El conteo de movimientos no devolvió fila');
    return { movimientos: lista.rows.map(toMovimiento), total: int(total, 'total') };
  }

  registrarMovimiento(
    id: string,
    pedido: PedidoMovimiento,
    contexto: ContextoMovimiento,
  ): Promise<ResultadoMovimiento | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return this.sql.transaction(async (tx) => {
      // Un uso vinculado a un lavado bloquea PRIMERO el turno y después el insumo: el mismo orden que deshacer y
      // corregir un lavado (turno FOR UPDATE, después los insumos), así no se traban entre sí. FOR KEY SHARE: nadie lo
      // borra en el medio (el DELETE pondría turno_id en null), pero no frena otras lecturas ni los cambios de estado.
      // Si no existe, el error se da después de ver el insumo (un insumo inexistente sigue siendo 404).
      let turnoExiste = true;
      if (pedido.tipo === 'uso' && pedido.turnoId !== null) {
        const turno = await tx.query('SELECT 1 AS ok FROM buddys.bookings WHERE id = $1::uuid FOR KEY SHARE', [pedido.turnoId]);
        turnoExiste = turno.rows.length > 0;
      }
      // Un bloqueo por insumo, hasta el COMMIT: dos usos a la vez se ordenan y el segundo ve el stock ya descontado.
      await tx.query('SELECT pg_catalog.pg_advisory_xact_lock($1::int, pg_catalog.hashtext($2::text))', [LOCK_STOCK, id]);
      const actual = await tx.query(
        'SELECT nombre, unidad, stock::float8 AS stock FROM buddys.insumos WHERE id = $1::uuid FOR UPDATE',
        [id],
      );
      const fila = actual.rows[0];
      if (!fila) return null;
      const stock = num(fila, 'stock');
      const unidad = oneOf(UNIDADES, fila, 'unidad');

      let movimientoId: string | null = null;
      if (pedido.tipo === 'uso') {
        if (!turnoExiste) throw new TurnoInexistenteError();
        // UPDATE condicional: aunque algo se saltara el bloqueo, nunca resta de más (y el CHECK stock >= 0 es la red).
        const resta = await tx.query(
          'UPDATE buddys.insumos SET stock = stock - $2::numeric WHERE id = $1::uuid AND stock >= $2::numeric',
          [id, pedido.cantidad],
        );
        if (resta.rowCount === 0) throw new StockInsuficienteError(stock, unidad);
        const { rows } = await tx.query(
          `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, turno_id, perfil_id)
           VALUES ($1::uuid, 'uso', -$2::numeric, $3::text, $4::uuid, $5::uuid)
           RETURNING id::text AS id`,
          [id, pedido.cantidad, pedido.nota, pedido.turnoId, contexto.perfilId],
        );
        movimientoId = str(rows[0] ?? {}, 'id');
      } else if (pedido.tipo === 'compra') {
        if (redondear2(stock + pedido.cantidad) > STOCK_MAX) throw new StockExcedidoError();
        const costo = pedido.costoTotal !== null && pedido.costoTotal > 0 ? pedido.costoTotal : null;
        let gastoId: string | null = null;
        if (costo !== null) {
          const descripcion = `Compra: ${str(fila, 'nombre')} (${formatearCantidad(pedido.cantidad)} ${unidad})`;
          const gasto = await registrarGastoDeInventario(tx, {
            fecha: contexto.hoy,
            descripcion: Array.from(descripcion).slice(0, 120).join(''),
            monto: costo,
            proveedor: pedido.proveedor,
            creadoPor: contexto.perfilId,
          });
          gastoId = gasto.id;
        }
        await tx.query(
          `UPDATE buddys.insumos
           SET stock = stock + $2::numeric,
               costo_unitario = CASE WHEN $3::int IS NULL THEN costo_unitario ELSE round($3::int::numeric / $2::numeric)::int END
           WHERE id = $1::uuid`,
          [id, pedido.cantidad, costo],
        );
        const { rows } = await tx.query(
          `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, costo_total, proveedor, nota, gasto_id, perfil_id)
           VALUES ($1::uuid, 'compra', $2::numeric, $3::int, $4::text, $5::text, $6::uuid, $7::uuid)
           RETURNING id::text AS id`,
          [id, pedido.cantidad, costo, pedido.proveedor, pedido.nota, gastoId, contexto.perfilId],
        );
        movimientoId = str(rows[0] ?? {}, 'id');
      } else {
        const diferencia = await tx.query('SELECT ($2::numeric - stock)::float8 AS diferencia FROM buddys.insumos WHERE id = $1::uuid', [
          id,
          pedido.stockReal,
        ]);
        if (num(diferencia.rows[0] ?? {}, 'diferencia') !== 0) {
          const { rows } = await tx.query(
            `INSERT INTO buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, perfil_id)
             SELECT i.id, 'ajuste', $2::numeric - i.stock, $3::text, $4::uuid
             FROM buddys.insumos i WHERE i.id = $1::uuid
             RETURNING id::text AS id`,
            [id, pedido.stockReal, pedido.nota, contexto.perfilId],
          );
          movimientoId = str(rows[0] ?? {}, 'id');
          await tx.query('UPDATE buddys.insumos SET stock = $2::numeric WHERE id = $1::uuid', [id, pedido.stockReal]);
        }
      }

      // Cualquier salida (uso o ajuste) puede cruzar el mínimo; cualquier subida (compra o ajuste) limpia el aviso.
      const aviso = movimientoId === null ? null : await revisarAvisoBajo(tx, id, stock, contexto.ahora);
      const insumo = await leerInsumo(tx, id);
      if (!insumo) throw new Error('El insumo no se encontró después de moverlo');
      return { insumo, movimiento: movimientoId === null ? null : await leerMovimiento(tx, movimientoId), aviso };
    });
  }
  async alertas(): Promise<AlertasDeStock> {
    const { rows } = await this.sql.query(
      `SELECT i.id::text AS id, i.nombre, i.unidad, i.stock::float8 AS stock, i.stock_minimo::float8 AS stock_minimo
       FROM buddys.insumos i
       WHERE i.activo AND i.stock_minimo > 0 AND i.stock <= i.stock_minimo
       ORDER BY i.stock / i.stock_minimo, buddys.texto_busqueda(i.nombre), i.id`,
    );
    const insumos = rows.map((row) => ({
      id: str(row, 'id'),
      nombre: str(row, 'nombre'),
      unidad: oneOf(UNIDADES, row, 'unidad'),
      stock: num(row, 'stock'),
      stockMinimo: num(row, 'stock_minimo'),
    }));
    return { bajoStock: insumos.length, insumos };
  }

  async paraComprar(): Promise<ParaComprar> {
    // Regla 8: max(2 x mínimo - stock, 0), hacia arriba a entero para las unidades contables y a 2 decimales para el
    // resto. El total estimado lo suma la base (ventana sobre las mismas filas).
    const { rows } = await this.sql.query(
      `SELECT x.*, coalesce(sum(x.costo_estimado) OVER (), 0)::float8 AS costo_total
       FROM (
         SELECT i.id::text AS insumo_id, i.nombre, i.categoria, i.unidad,
                i.stock::float8 AS stock, i.stock_minimo::float8 AS stock_minimo, s.sugerido::float8 AS sugerido,
                CASE WHEN i.costo_unitario IS NULL THEN NULL ELSE round(s.sugerido * i.costo_unitario)::float8 END AS costo_estimado,
                i.categoria IS NULL AS sin_categoria, buddys.texto_busqueda(i.categoria) AS orden_categoria,
                buddys.texto_busqueda(i.nombre) AS orden_nombre, i.id AS orden_id
         FROM buddys.insumos i
         CROSS JOIN LATERAL (
           SELECT CASE WHEN i.unidad IN ('unidad', 'par', 'caja') THEN ceil(greatest(2 * i.stock_minimo - i.stock, 0))
                       ELSE round(greatest(2 * i.stock_minimo - i.stock, 0), 2) END AS sugerido
         ) s
         WHERE i.activo AND i.stock_minimo > 0 AND i.stock <= i.stock_minimo
       ) x
       ORDER BY x.sin_categoria, x.orden_categoria, x.orden_nombre, x.orden_id`,
    );
    return {
      items: rows.map((row) => ({
        insumoId: str(row, 'insumo_id'),
        nombre: str(row, 'nombre'),
        categoria: strOrNull(row, 'categoria'),
        unidad: oneOf(UNIDADES, row, 'unidad'),
        stock: num(row, 'stock'),
        stockMinimo: num(row, 'stock_minimo'),
        sugerido: num(row, 'sugerido'),
        costoEstimado: intOrNull(row, 'costo_estimado'),
      })),
      costoTotalEstimado: rows[0] === undefined ? 0 : int(rows[0], 'costo_total'),
    };
  }

  async consumo(desde: string, hasta: string, agrupado: AgrupadoConsumo): Promise<DatosDeConsumo> {
    const unidad = PERIODO_DE_SERIE[agrupado];
    const [serie, porInsumo] = await Promise.all([
      // Lavados de mostrador completados por fecha del lavado, con ceros (generate_series). La semana es de lunes a
      // domingo (date_trunc('week')) y su clave es el lunes, aunque caiga antes de "desde".
      this.sql.query(
        `WITH serie AS (
           SELECT g::date AS clave
           FROM generate_series(date_trunc($3::text, $1::date::timestamp), $2::date::timestamp, ('1 ' || $3::text)::interval) g
         ),
         lavados AS (
           SELECT date_trunc($3::text, coalesce(b.fecha_confirmada, b.fecha_preferida)::timestamp)::date AS clave,
                  count(*)::int AS cantidad
           FROM buddys.bookings b
           WHERE b.origen = 'mostrador' AND b.estado = 'completado'
             AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
           GROUP BY 1
         )
         SELECT to_char(s.clave, CASE WHEN $3::text = 'month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) AS clave,
                coalesce(l.cantidad, 0) AS cantidad,
                coalesce(sum(l.cantidad) OVER (), 0)::int AS total
         FROM serie s LEFT JOIN lavados l ON l.clave = s.clave
         ORDER BY s.clave`,
        [desde, hasta, unidad],
      ),
      // Consumo: usos (en positivo) menos devoluciones, por la fecha del movimiento en La Rioja (índice parcial
      // movimientos_stock_consumo_idx). Solo los renglones con consumo > 0. El costo, con el costo unitario de hoy.
      this.sql.query(
        `SELECT x.*, coalesce(sum(x.costo) OVER (), 0)::float8 AS costo_insumos
         FROM (
           SELECT i.id::text AS insumo_id, i.nombre, i.unidad, sum(-m.cantidad)::float8 AS consumido,
                  CASE WHEN i.costo_unitario IS NULL THEN NULL ELSE round(sum(-m.cantidad) * i.costo_unitario)::float8 END AS costo
           FROM buddys.movimientos_stock m
           JOIN buddys.insumos i ON i.id = m.insumo_id
           WHERE m.tipo IN ('uso', 'devolucion')
             AND m.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Argentina/La_Rioja')
             AND m.created_at <  (($2::date + 1)::timestamp AT TIME ZONE 'America/Argentina/La_Rioja')
           GROUP BY i.id
           HAVING sum(-m.cantidad) > 0
         ) x
         ORDER BY x.consumido DESC, x.nombre, x.insumo_id`,
        [desde, hasta],
      ),
    ]);
    const primera = serie.rows[0];
    const primerConsumo = porInsumo.rows[0];
    return {
      total: primera === undefined ? 0 : int(primera, 'total'),
      serie: serie.rows.map((row) => ({ clave: str(row, 'clave'), cantidad: int(row, 'cantidad') })),
      porInsumo: porInsumo.rows.map((row) => ({
        insumoId: str(row, 'insumo_id'),
        nombre: str(row, 'nombre'),
        unidad: oneOf(UNIDADES, row, 'unidad'),
        consumido: num(row, 'consumido'),
        costo: intOrNull(row, 'costo'),
      })),
      costoInsumos: primerConsumo === undefined ? 0 : int(primerConsumo, 'costo_insumos'),
    };
  }
}
