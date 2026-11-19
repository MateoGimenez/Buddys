import type { SqlClient } from '../../db/postgres.js';
import { int, intOrNull, str, strOrNull } from '../../db/rows.js';
import { EXPORTAR_MAX_RENGLONES, type ExportRepository, type RenglonGasto, type RenglonPlanilla } from '../../domain/exportar.js';


/** Lecturas de la exportación a CSV (función 16 del contrato 2026-11-15). Todo con parámetros y ordenado en SQL. */
export class PostgresExportRepository implements ExportRepository {
  constructor(private readonly sql: SqlClient) {}

  async planilla(desde: string, hasta: string): Promise<RenglonPlanilla[]> {
    const { rows } = await this.sql.query(
      `SELECT to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM-DD') AS fecha,
              coalesce(b.franja_confirmada, b.franja) AS franja, b.origen, b.estado, b.etapa, b.nombre, b.telefono,
              b.vehiculo_tipo, b.vehiculo_modelo,
              coalesce((SELECT string_agg(sv.nombre, ' + ' ORDER BY ls.orden)
                        FROM buddys.lavado_servicios ls JOIN buddys.servicios sv ON sv.id = ls.servicio_id
                        WHERE ls.booking_id = b.id), s.nombre) AS servicios,
              coalesce(nullif(btrim(t.nombre), ''), t.email) AS trabajador,
              b.forma_pago, b.monto, b.descuento, b.descuento_motivo, b.sena_monto
       FROM buddys.bookings b
       JOIN buddys.servicios s ON s.id = b.servicio_id
       LEFT JOIN buddys.perfiles t ON t.id = b.trabajador_id
       WHERE b.estado <> 'cancelado'
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
       ORDER BY coalesce(b.fecha_confirmada, b.fecha_preferida), b.seq
       LIMIT $3`,
      [desde, hasta, EXPORTAR_MAX_RENGLONES],
    );
    return rows.map((row) => ({
      fecha: str(row, 'fecha'),
      franja: str(row, 'franja'),
      origen: str(row, 'origen'),
      estado: str(row, 'estado'),
      etapa: strOrNull(row, 'etapa'),
      nombre: str(row, 'nombre'),
      telefono: strOrNull(row, 'telefono'),
      vehiculoTipo: str(row, 'vehiculo_tipo'),
      vehiculoModelo: strOrNull(row, 'vehiculo_modelo'),
      servicios: str(row, 'servicios'),
      trabajador: strOrNull(row, 'trabajador'),
      formaPago: strOrNull(row, 'forma_pago'),
      monto: intOrNull(row, 'monto'),
      descuento: int(row, 'descuento'),
      descuentoMotivo: strOrNull(row, 'descuento_motivo'),
      sena: intOrNull(row, 'sena_monto'),
    }));
  }

  async gastos(desde: string, hasta: string): Promise<RenglonGasto[]> {
    const { rows } = await this.sql.query(
      `SELECT x.fecha, x.origen, x.categoria, x.descripcion, x.proveedor, x.monto
       FROM (
         SELECT to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.origen, g.categoria, g.descripcion, g.proveedor, g.monto
         FROM buddys.gastos g WHERE g.fecha BETWEEN $1::date AND $2::date
         UNION ALL
         SELECT to_char(f.fecha, 'YYYY-MM-DD'), 'fijo', f.categoria, f.concepto, NULL, f.monto
         FROM buddys.gastos_fijos_imputados($1::date, $2::date) f
       ) x
       ORDER BY x.fecha, x.origen, x.categoria, x.descripcion
       LIMIT $3`,
      [desde, hasta, EXPORTAR_MAX_RENGLONES],
    );
    return rows.map((row) => ({
      fecha: str(row, 'fecha'),
      origen: str(row, 'origen'),
      categoria: str(row, 'categoria'),
      descripcion: str(row, 'descripcion'),
      proveedor: strOrNull(row, 'proveedor'),
      monto: int(row, 'monto'),
    }));
  }
}
