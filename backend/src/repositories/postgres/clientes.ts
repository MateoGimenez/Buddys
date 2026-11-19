import type { SqlClient } from '../../db/postgres.js';
import { type Row, int, intOrNull, isoTimestamp, oneOf, str, strOrNull } from '../../db/rows.js';
import { VEHICULO_TIPOS } from '../../domain/booking.js';
import {
  type CambiosFidelizacion,
  type ClaveCliente,
  type ClienteInactivo,
  type ClienteRepository,
  type Fidelizacion,
  type HistorialCliente,
  PREMIOS,
  type ServicioMasHecho,
} from '../../domain/clientes.js';
import { escapeLike, toBooking } from './bookings.js';

/**
 * Los dos parámetros que identifican al cliente en todas las consultas: $1 = telefono_whatsapp exacto, $2 = patrón de
 * patente (la patente normalizada entre %, contra vehiculo_modelo normalizado igual). Uno de los dos es null.
 */
function parametrosCliente(clave: ClaveCliente): [string | null, string | null] {
  return clave.tipo === 'telefono' ? [clave.telefonoWhatsapp, null] : [null, `%${escapeLike(clave.patente)}%`];
}

function toServiciosMasHechos(value: unknown): ServicioMasHecho[] {
  if (!Array.isArray(value)) throw new TypeError('La columna "servicios" debería ser una lista');
  return value.map((item: unknown) => {
    const { servicioId, nombre, cantidad } = (item ?? {}) as Record<string, unknown>;
    if (typeof servicioId !== 'string' || typeof nombre !== 'string' || typeof cantidad !== 'number') {
      throw new TypeError('La columna "servicios" tiene un servicio mal formado');
    }
    return { servicioId, nombre, cantidad };
  });
}

function toVehiculos(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new TypeError('La columna "vehiculos" debería ser una lista de textos');
  }
  return value;
}

function toFidelizacion(row: Row): Fidelizacion {
  return {
    sellosCada: int(row, 'sellos_cada'),
    premio: oneOf(PREMIOS, row, 'premio'),
    premioPorcentaje: intOrNull(row, 'premio_porcentaje'),
    inactivosDias: int(row, 'inactivos_dias'),
    updatedAt: isoTimestamp(row, 'updated_at'),
  };
}

/*
 * Clientes sobre Postgres (funciones 6 y 14 del contrato 2026-11-15). Todo se agrega en la base (count, max, sum,
 * json_agg): nunca se traen todos los turnos para contar. El cliente es un filtro sobre bookings: por teléfono
 * (índice parcial bookings_telefono_whatsapp_idx) o por patente (vehiculo_modelo sin espacios ni signos y en
 * mayúsculas). "Visita" = turno o lavado completado; su fecha, la de agenda.
 */
export class PostgresClienteRepository implements ClienteRepository {
  constructor(private readonly sql: SqlClient) {}

  async historial(clave: ClaveCliente, limit: number): Promise<HistorialCliente | undefined> {
    const [telefono, patente] = parametrosCliente(clave);
    const [resumen, lista] = await Promise.all([
      this.sql.query(
        `WITH c AS (
           SELECT b.id, b.seq, b.nombre, b.telefono_whatsapp, b.vehiculo_modelo, b.estado, b.monto,
                  coalesce(b.fecha_confirmada, b.fecha_preferida) AS fecha
           FROM buddys.bookings b
           WHERE ($1::text IS NOT NULL AND b.telefono_whatsapp = $1::text)
              OR ($2::text IS NOT NULL
                  AND regexp_replace(upper(coalesce(b.vehiculo_modelo, '')), '[^A-Z0-9]', '', 'g') LIKE $2::text ESCAPE '\\')
         )
         SELECT (SELECT count(*)::int FROM c) AS total,
                (SELECT count(*)::int FROM c WHERE c.estado = 'completado') AS visitas,
                (SELECT to_char(max(c.fecha), 'YYYY-MM-DD') FROM c WHERE c.estado = 'completado') AS ultima_visita,
                (SELECT coalesce(sum(c.monto), 0)::float8 FROM c WHERE c.estado = 'completado') AS total_gastado,
                (SELECT c.nombre FROM c ORDER BY c.seq DESC LIMIT 1) AS nombre,
                (SELECT c.telefono_whatsapp FROM c WHERE c.telefono_whatsapp IS NOT NULL ORDER BY c.seq DESC LIMIT 1)
                  AS telefono_whatsapp,
                (SELECT coalesce(json_agg(v.modelo ORDER BY v.ultimo DESC), '[]'::json)
                 FROM (SELECT c.vehiculo_modelo AS modelo, max(c.seq) AS ultimo FROM c
                       WHERE c.vehiculo_modelo IS NOT NULL GROUP BY c.vehiculo_modelo
                       ORDER BY ultimo DESC LIMIT 5) v) AS vehiculos,
                (SELECT coalesce(json_agg(json_build_object('servicioId', x.servicio_id, 'nombre', x.nombre, 'cantidad', x.cantidad)
                                          ORDER BY x.cantidad DESC, x.nombre), '[]'::json)
                 FROM (SELECT ls.servicio_id, s.nombre, count(*)::int AS cantidad
                       FROM c
                       JOIN buddys.lavado_servicios ls ON ls.booking_id = c.id
                       JOIN buddys.servicios s ON s.id = ls.servicio_id
                       WHERE c.estado = 'completado'
                       GROUP BY ls.servicio_id, s.nombre
                       ORDER BY cantidad DESC, s.nombre LIMIT 3) x) AS servicios`,
        [telefono, patente],
      ),
      this.sql.query(
        `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
                to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
                to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
                b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
                b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
                to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
                t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), nullif(split_part(t.email, '@', 1), ''), 'Sin nombre') AS trabajador_nombre,
                r.id::text AS registrado_por_id, coalesce(nullif(btrim(r.nombre), ''), nullif(split_part(r.email, '@', 1), ''), 'Sin nombre') AS registrado_por_nombre,
                CASE WHEN b.telefono_whatsapp IS NULL THEN NULL
                     ELSE (SELECT count(*)::int FROM buddys.bookings c WHERE c.telefono_whatsapp = b.telefono_whatsapp)
                END AS turnos_del_cliente,
                coalesce(
                  (SELECT json_agg(json_build_object('id', ls.servicio_id, 'nombre', sv.nombre, 'precioLista', ls.precio_lista) ORDER BY ls.orden)
                   FROM buddys.lavado_servicios ls JOIN buddys.servicios sv ON sv.id = ls.servicio_id
                   WHERE ls.booking_id = b.id),
                  (SELECT json_build_array(json_build_object('id', sp.id, 'nombre', sp.nombre, 'precioLista', NULL))
                   FROM buddys.servicios sp WHERE sp.id = b.servicio_id)
                ) AS servicios
         FROM buddys.bookings b
         LEFT JOIN buddys.perfiles t ON t.id = b.trabajador_id
         LEFT JOIN buddys.perfiles r ON r.id = b.registrado_por
         WHERE ($1::text IS NOT NULL AND b.telefono_whatsapp = $1::text)
            OR ($2::text IS NOT NULL
                AND regexp_replace(upper(coalesce(b.vehiculo_modelo, '')), '[^A-Z0-9]', '', 'g') LIKE $2::text ESCAPE '\\')
         ORDER BY b.seq DESC
         LIMIT $3`,
        [telefono, patente, limit],
      ),
    ]);
    const row = resumen.rows[0];
    if (!row || int(row, 'total') === 0) return undefined;
    return {
      resumen: {
        nombre: str(row, 'nombre'),
        telefonoWhatsapp: strOrNull(row, 'telefono_whatsapp'),
        vehiculos: toVehiculos(row.vehiculos),
        visitas: int(row, 'visitas'),
        ultimaVisita: strOrNull(row, 'ultima_visita'),
        serviciosMasHechos: toServiciosMasHechos(row.servicios),
        totalGastado: int(row, 'total_gastado'),
      },
      lavados: lista.rows.map(toBooking),
      total: int(row, 'total'),
    };
  }

  async visitas(clave: ClaveCliente): Promise<number> {
    const [telefono, patente] = parametrosCliente(clave);
    const { rows } = await this.sql.query(
      `SELECT count(*)::int AS visitas
       FROM buddys.bookings b
       WHERE b.estado = 'completado'
         AND (($1::text IS NOT NULL AND b.telefono_whatsapp = $1::text)
              OR ($2::text IS NOT NULL
                  AND regexp_replace(upper(coalesce(b.vehiculo_modelo, '')), '[^A-Z0-9]', '', 'g') LIKE $2::text ESCAPE '\\'))`,
      [telefono, patente],
    );
    const row = rows[0];
    return row ? int(row, 'visitas') : 0;
  }

  async inactivos(
    limite: string,
    hoy: string,
    limit: number,
    offset: number,
  ): Promise<{ clientes: ClienteInactivo[]; total: number }> {
    // Por teléfono normalizado (sin teléfono no hay a quién escribirle). Un cliente con un turno pendiente o confirmado
    // de hoy en adelante no está inactivo: ya vuelve.
    const [pagina, cuenta] = await Promise.all([
      this.sql.query(
        `WITH ult AS (
           SELECT b.telefono_whatsapp, count(*)::int AS visitas,
                  max(coalesce(b.fecha_confirmada, b.fecha_preferida)) AS ultima
           FROM buddys.bookings b
           WHERE b.estado = 'completado' AND b.telefono_whatsapp IS NOT NULL
           GROUP BY b.telefono_whatsapp
         )
         SELECT u.telefono_whatsapp, u.visitas, to_char(u.ultima, 'YYYY-MM-DD') AS ultima_visita,
                ($2::date - u.ultima)::int AS dias_sin_venir, d.nombre, d.vehiculo_modelo, d.vehiculo_tipo
         FROM ult u
         CROSS JOIN LATERAL (
           -- Nombre y vehículo del último trabajo COMPLETADO: un pedido web cualquiera (texto de afuera) no entra en el
           -- mensaje de WhatsApp.
           SELECT b.nombre, b.vehiculo_modelo, b.vehiculo_tipo
           FROM buddys.bookings b
           WHERE b.telefono_whatsapp = u.telefono_whatsapp AND b.estado = 'completado'
           ORDER BY b.seq DESC
           LIMIT 1
         ) d
         WHERE u.ultima <= $1::date
           AND NOT EXISTS (
             SELECT 1 FROM buddys.bookings f
             WHERE f.telefono_whatsapp = u.telefono_whatsapp AND f.estado IN ('pendiente', 'confirmado')
               AND coalesce(f.fecha_confirmada, f.fecha_preferida) >= $2::date)
         ORDER BY u.ultima, u.telefono_whatsapp
         LIMIT $3 OFFSET $4`,
        [limite, hoy, limit, offset],
      ),
      this.sql.query(
        `WITH ult AS (
           SELECT b.telefono_whatsapp, max(coalesce(b.fecha_confirmada, b.fecha_preferida)) AS ultima
           FROM buddys.bookings b
           WHERE b.estado = 'completado' AND b.telefono_whatsapp IS NOT NULL
           GROUP BY b.telefono_whatsapp
         )
         SELECT count(*)::int AS total
         FROM ult u
         WHERE u.ultima <= $1::date
           AND NOT EXISTS (
             SELECT 1 FROM buddys.bookings f
             WHERE f.telefono_whatsapp = u.telefono_whatsapp AND f.estado IN ('pendiente', 'confirmado')
               AND coalesce(f.fecha_confirmada, f.fecha_preferida) >= $2::date)`,
        [limite, hoy],
      ),
    ]);
    const totalRow = cuenta.rows[0];
    return {
      clientes: pagina.rows.map((row) => ({
        telefonoWhatsapp: str(row, 'telefono_whatsapp'),
        nombre: str(row, 'nombre'),
        vehiculoModelo: strOrNull(row, 'vehiculo_modelo'),
        vehiculoTipo: oneOf(VEHICULO_TIPOS, row, 'vehiculo_tipo'),
        visitas: int(row, 'visitas'),
        ultimaVisita: str(row, 'ultima_visita'),
        diasSinVenir: int(row, 'dias_sin_venir'),
      })),
      total: totalRow ? int(totalRow, 'total') : 0,
    };
  }

  async fidelizacion(): Promise<Fidelizacion> {
    const { rows } = await this.sql.query(
      `SELECT sellos_cada, premio, premio_porcentaje, inactivos_dias, updated_at FROM buddys.fidelizacion WHERE id = 1`,
    );
    const row = rows[0];
    if (!row) throw new Error('Falta la fila de buddys.fidelizacion (migración fidelizacion)');
    return toFidelizacion(row);
  }

  async guardarFidelizacion(cambios: CambiosFidelizacion, now: Date): Promise<Fidelizacion> {
    const { rows } = await this.sql.query(
      `UPDATE buddys.fidelizacion
       SET sellos_cada = $1::smallint, premio = $2::text, premio_porcentaje = $3::smallint, inactivos_dias = $4::smallint,
           updated_at = $5::timestamptz
       WHERE id = 1
       RETURNING sellos_cada, premio, premio_porcentaje, inactivos_dias, updated_at`,
      [cambios.sellosCada, cambios.premio, cambios.premioPorcentaje, cambios.inactivosDias, now.toISOString()],
    );
    const row = rows[0];
    if (!row) throw new Error('Falta la fila de buddys.fidelizacion (migración fidelizacion)');
    return toFidelizacion(row);
  }
}
