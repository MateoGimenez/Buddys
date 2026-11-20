import type { SqlClient } from '../../db/postgres.js';
import { int, str } from '../../db/rows.js';
import type {
  ConteoPeriodo,
  EstadisticasRepository,
  FilaDiaSemana,
  FilaGastoCategoria,
  FilaServicio,
  GastosDeUnPunto,
  Granularidad,
  MisTrabajos,
  PuntoSerieTurnos,
  Rango,
  RangoNombrado,
  Totales,
} from '../../domain/estadisticas.js';

/*
 * Estadísticas sobre Postgres. Todo se agrega en la base (GROUP BY / FILTER): no se traen las filas de los turnos.
 * "Fecha de agenda" = coalesce(fecha_confirmada, fecha_preferida), la misma expresión de los índices
 * bookings_agenda_idx y bookings_fecha_agenda_estado_idx (migraciones agenda_fecha_confirmada y
 * estadisticas_cobro_trabajador); es una columna `date`, sin zona horaria: el "día" lo decide el calendario del taller,
 * no el reloj del servidor. Las sumas de monto se castean a float8 (node-postgres devuelve bigint como texto); un
 * entero de hasta 366 turnos de 99.999.999 cabe sobrado en los 53 bits de un double.
 *
 * Las consultas de "mis trabajos" (mis*) no leen la columna monto. Cuentan lo que registró la persona
 * (registrado_por = yo) y, de lo que no tiene quién lo registró (los turnos de la web), lo que completó
 * (trabajador_id = yo). Cada rama del OR implica su columna no nula, así que el planner puede combinar los índices
 * parciales bookings_registrado_por_idx y bookings_trabajador_id_idx (BitmapOr); ver test/estadisticas.test.ts.
 */
export class PostgresEstadisticasRepository implements EstadisticasRepository {
  constructor(private readonly sql: SqlClient) {}

  async totales(rangos: readonly RangoNombrado[]): Promise<Record<string, Totales>> {
    // Una sola consulta para todos los rangos: unnest de tres arreglos en paralelo y LEFT JOIN, así un rango sin
    // turnos igual devuelve su fila con ceros.
    const { rows } = await this.sql.query(
      `SELECT r.clave, count(b.id)::int AS completados, coalesce(sum(b.monto), 0)::float8 AS ingresos
       FROM unnest($1::text[], $2::date[], $3::date[]) AS r(clave, desde, hasta)
       LEFT JOIN buddys.bookings b
         ON b.estado = 'completado'
        AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN r.desde AND r.hasta
       GROUP BY r.clave`,
      [rangos.map((r) => r.clave), rangos.map((r) => r.desde), rangos.map((r) => r.hasta)],
    );
    const resultado: Record<string, Totales> = {};
    for (const row of rows) {
      resultado[str(row, 'clave')] = { completados: int(row, 'completados'), ingresos: int(row, 'ingresos') };
    }
    return resultado;
  }

  async conteo({ desde, hasta }: Rango): Promise<ConteoPeriodo> {
    const { rows } = await this.sql.query(
      `SELECT count(*)::int AS turnos,
              (count(*) FILTER (WHERE b.estado = 'pendiente'))::int AS pendientes,
              (count(*) FILTER (WHERE b.estado = 'confirmado'))::int AS confirmados,
              (count(*) FILTER (WHERE b.estado = 'completado'))::int AS completados,
              (count(*) FILTER (WHERE b.estado = 'cancelado'))::int AS cancelados,
              coalesce(sum(b.monto) FILTER (WHERE b.estado = 'completado'), 0)::float8 AS ingresos,
              (count(b.monto) FILTER (WHERE b.estado = 'completado'))::int AS completados_con_monto,
              coalesce(sum(b.descuento) FILTER (WHERE b.estado = 'completado'), 0)::float8 AS descuentos
       FROM buddys.bookings b
       WHERE coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date`,
      [desde, hasta],
    );
    const row = rows[0];
    if (!row) throw new Error('El conteo del período no devolvió fila');
    return {
      turnos: int(row, 'turnos'),
      pendientes: int(row, 'pendientes'),
      confirmados: int(row, 'confirmados'),
      completados: int(row, 'completados'),
      cancelados: int(row, 'cancelados'),
      ingresos: int(row, 'ingresos'),
      completadosConMonto: int(row, 'completados_con_monto'),
      descuentos: int(row, 'descuentos'),
    };
  }

  async serie({ desde, hasta }: Rango, granularidad: Granularidad): Promise<PuntoSerieTurnos[]> {
    const { rows } =
      granularidad === 'dia'
        ? await this.sql.query(
            `SELECT to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM-DD') AS clave,
                    count(*)::int AS completados, coalesce(sum(b.monto), 0)::float8 AS ingresos
             FROM buddys.bookings b
             WHERE b.estado = 'completado'
               AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
             GROUP BY 1 ORDER BY 1`,
            [desde, hasta],
          )
        : await this.sql.query(
            `SELECT to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM') AS clave,
                    count(*)::int AS completados, coalesce(sum(b.monto), 0)::float8 AS ingresos
             FROM buddys.bookings b
             WHERE b.estado = 'completado'
               AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
             GROUP BY 1 ORDER BY 1`,
            [desde, hasta],
          );
    return rows.map((row) => ({
      clave: str(row, 'clave'),
      completados: int(row, 'completados'),
      ingresos: int(row, 'ingresos'),
    }));
  }

  async gastosPorRango(rangos: readonly RangoNombrado[]): Promise<Record<string, number>> {
    // Igual que totales(): un rango sin gastos igual devuelve su fila, con cero. Los gastos se agrupan por su fecha;
    // los fijos (migración gastos_fijos), el día 1 de cada mes de vigencia que cae en el rango.
    const { rows } = await this.sql.query(
      `SELECT r.clave,
              (coalesce((SELECT sum(g.monto) FROM buddys.gastos g WHERE g.fecha BETWEEN r.desde AND r.hasta), 0)
               + coalesce((SELECT sum(f.monto) FROM buddys.gastos_fijos_imputados(r.desde, r.hasta) f), 0))::float8 AS gastos
       FROM unnest($1::text[], $2::date[], $3::date[]) AS r(clave, desde, hasta)`,
      [rangos.map((r) => r.clave), rangos.map((r) => r.desde), rangos.map((r) => r.hasta)],
    );
    const resultado: Record<string, number> = {};
    for (const row of rows) resultado[str(row, 'clave')] = int(row, 'gastos');
    return resultado;
  }

  async gastosSerie({ desde, hasta }: Rango, granularidad: Granularidad): Promise<GastosDeUnPunto[]> {
    const { rows } =
      granularidad === 'dia'
        ? await this.sql.query(
            `SELECT to_char(x.fecha, 'YYYY-MM-DD') AS clave, sum(x.monto)::float8 AS gastos
             FROM (SELECT g.fecha, g.monto FROM buddys.gastos g WHERE g.fecha BETWEEN $1::date AND $2::date
                   UNION ALL
                   SELECT f.fecha, f.monto FROM buddys.gastos_fijos_imputados($1::date, $2::date) f) x
             GROUP BY 1 ORDER BY 1`,
            [desde, hasta],
          )
        : await this.sql.query(
            `SELECT to_char(x.fecha, 'YYYY-MM') AS clave, sum(x.monto)::float8 AS gastos
             FROM (SELECT g.fecha, g.monto FROM buddys.gastos g WHERE g.fecha BETWEEN $1::date AND $2::date
                   UNION ALL
                   SELECT f.fecha, f.monto FROM buddys.gastos_fijos_imputados($1::date, $2::date) f) x
             GROUP BY 1 ORDER BY 1`,
            [desde, hasta],
          );
    return rows.map((row) => ({ clave: str(row, 'clave'), gastos: int(row, 'gastos') }));
  }

  async gastosPorCategoria({ desde, hasta }: Rango): Promise<FilaGastoCategoria[]> {
    const { rows } = await this.sql.query(
      `SELECT x.categoria, sum(x.monto)::float8 AS monto
       FROM (SELECT g.categoria, g.monto FROM buddys.gastos g WHERE g.fecha BETWEEN $1::date AND $2::date
             UNION ALL
             SELECT f.categoria, f.monto FROM buddys.gastos_fijos_imputados($1::date, $2::date) f) x
       GROUP BY x.categoria
       HAVING sum(x.monto) > 0
       ORDER BY monto DESC, x.categoria`,
      [desde, hasta],
    );
    return rows.map((row) => ({ categoria: str(row, 'categoria'), monto: int(row, 'monto') }));
  }

  async gastosFijos({ desde, hasta }: Rango): Promise<number> {
    const { rows } = await this.sql.query(
      'SELECT coalesce(sum(f.monto), 0)::float8 AS monto FROM buddys.gastos_fijos_imputados($1::date, $2::date) f',
      [desde, hasta],
    );
    const row = rows[0];
    return row ? int(row, 'monto') : 0;
  }

  async porServicio({ desde, hasta }: Rango): Promise<FilaServicio[]> {
    // Cuenta desde lavado_servicios: un lavado con varios servicios suma un pedido en CADA uno (migración
    // lavado_varios_servicios). Los ingresos de un turno se reparten entre sus servicios en proporción a la foto del
    // precio de lista (si todos la tienen y suman más de 0); si no, en partes iguales. Así la suma de los ingresos por
    // servicio da (salvo el redondeo de cada fila) lo cobrado, sin contar dos veces un mismo monto.
    // Todos los servicios con LEFT JOIN: uno activo sin pedidos sale con ceros; uno desactivado solo si tuvo pedidos.
    const { rows } = await this.sql.query(
      `WITH partes AS (
         SELECT ls.servicio_id, b.estado,
                CASE WHEN b.estado = 'completado' AND b.monto IS NOT NULL THEN
                  b.monto::float8 * CASE
                    WHEN count(*) OVER w = count(ls.precio_lista) OVER w AND sum(ls.precio_lista) OVER w > 0
                      THEN ls.precio_lista::float8 / (sum(ls.precio_lista) OVER w)::float8
                    ELSE 1.0::float8 / (count(*) OVER w)::float8
                  END
                END AS ingreso
         FROM buddys.bookings b
         JOIN buddys.lavado_servicios ls ON ls.booking_id = b.id
         WHERE coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
         WINDOW w AS (PARTITION BY ls.booking_id)
       )
       SELECT s.id AS servicio_id, s.nombre,
              (count(p.servicio_id) FILTER (WHERE p.estado <> 'cancelado'))::int AS pedidos,
              (count(p.servicio_id) FILTER (WHERE p.estado = 'completado'))::int AS completados,
              round(coalesce(sum(p.ingreso), 0))::float8 AS ingresos
       FROM buddys.servicios s
       LEFT JOIN partes p ON p.servicio_id = s.id
       GROUP BY s.id, s.nombre, s.activo, s.orden
       HAVING s.activo OR count(p.servicio_id) FILTER (WHERE p.estado <> 'cancelado') > 0
       ORDER BY pedidos DESC, completados DESC, s.orden, s.id`,
      [desde, hasta],
    );
    return rows.map((row) => ({
      servicioId: str(row, 'servicio_id'),
      nombre: str(row, 'nombre'),
      pedidos: int(row, 'pedidos'),
      completados: int(row, 'completados'),
      ingresos: int(row, 'ingresos'),
    }));
  }

  async porDiaSemana({ desde, hasta }: Rango): Promise<FilaDiaSemana[]> {
    // extract(dow) de una columna date: 0 = domingo ... 6 = sábado, sin zona horaria de por medio.
    const { rows } = await this.sql.query(
      `SELECT extract(dow FROM coalesce(b.fecha_confirmada, b.fecha_preferida))::int AS dia,
              (count(*) FILTER (WHERE coalesce(b.franja_confirmada, b.franja) = 'manana'))::int AS manana,
              (count(*) FILTER (WHERE coalesce(b.franja_confirmada, b.franja) = 'tarde'))::int AS tarde
       FROM buddys.bookings b
       WHERE b.estado <> 'cancelado'
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
       GROUP BY 1 ORDER BY 1`,
      [desde, hasta],
    );
    return rows.map((row) => ({ dia: int(row, 'dia'), manana: int(row, 'manana'), tarde: int(row, 'tarde') }));
  }

  /** Por servicio, desde lavado_servicios: un lavado con varios servicios cuenta en cada uno. */
  async misServicios(perfilId: string, { desde, hasta }: Rango): Promise<MisTrabajos['porServicio']> {
    const { rows } = await this.sql.query(
      `SELECT s.id AS servicio_id, s.nombre, count(*)::int AS completados
       FROM buddys.bookings b
       JOIN buddys.lavado_servicios ls ON ls.booking_id = b.id
       JOIN buddys.servicios s ON s.id = ls.servicio_id
       WHERE b.estado = 'completado'
         AND (b.registrado_por = $3::uuid OR (b.registrado_por IS NULL AND b.trabajador_id = $3::uuid))
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
       GROUP BY s.id, s.nombre
       ORDER BY completados DESC, s.nombre, s.id`,
      [desde, hasta, perfilId],
    );
    return rows.map((row) => ({
      servicioId: str(row, 'servicio_id'),
      nombre: str(row, 'nombre'),
      completados: int(row, 'completados'),
    }));
  }

  async misSerie(perfilId: string, { desde, hasta }: Rango, granularidad: Granularidad): Promise<MisTrabajos['serie']> {
    const { rows } =
      granularidad === 'dia'
        ? await this.sql.query(
            `SELECT to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM-DD') AS clave, count(*)::int AS completados
             FROM buddys.bookings b
             WHERE b.estado = 'completado'
               AND (b.registrado_por = $3::uuid OR (b.registrado_por IS NULL AND b.trabajador_id = $3::uuid))
               AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
             GROUP BY 1 ORDER BY 1`,
            [desde, hasta, perfilId],
          )
        : await this.sql.query(
            `SELECT to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM') AS clave, count(*)::int AS completados
             FROM buddys.bookings b
             WHERE b.estado = 'completado'
               AND (b.registrado_por = $3::uuid OR (b.registrado_por IS NULL AND b.trabajador_id = $3::uuid))
               AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
             GROUP BY 1 ORDER BY 1`,
            [desde, hasta, perfilId],
          );
    return rows.map((row) => ({ clave: str(row, 'clave'), completados: int(row, 'completados') }));
  }
}
