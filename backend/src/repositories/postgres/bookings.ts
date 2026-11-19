import type { SqlClient } from '../../db/postgres.js';
import { type Row, int, intOrNull, isoTimestamp, num, oneOf, oneOfOrNull, str, strOrNull } from '../../db/rows.js';
import {
  type ActualizacionTurno,
  type Booking,
  type BookingRepository,
  type CandidatoRecordatorio,
  type Estado,
  type ListBookingsOptions,
  type NewBooking,
  type Reprogramacion,
  type SeguimientoTurno,
  type ServicioDelTurno,
  ESTADOS,
  ETAPAS,
  type Etapa,
  FRANJAS,
  MIN_DIGITOS_BUSQUEDA,
  type NuevaSena,
  type NuevoLavado,
  type NuevoTurnoPanel,
  type Sena,
  ORIGENES,
  type RegistroDeLavado,
  type TotalFormaDePago,
  type Trabajador,
  TurnoCerradoError,
  VEHICULO_TIPOS,
} from '../../domain/booking.js';
import { FORMAS_DE_PAGO, TurnoConComprobanteError } from '../../domain/comprobantes.js';
import { verificarLugar } from '../../domain/disponibilidad.js';
import { whatsappListo } from '../../domain/mensajes.js';
import { normalizarPatente, MIN_PATENTE_BUSQUEDA } from '../../domain/clientes.js';
import { telefonoWhatsapp } from '../../domain/telefono.js';
import { cuposEntre } from './disponibilidad.js';
import { isUuid } from './uuid.js';

/** Quién hizo el trabajo: el nombre de la persona o, si no tiene, su email (calculado en la consulta). */
function toTrabajador(row: Row): Trabajador | null {
  const id = strOrNull(row, 'trabajador_id');
  return id === null ? null : { id, nombre: str(row, 'trabajador_nombre') };
}

/**
 * Los servicios del turno: un json (ya parseado por el driver) con { id, nombre, precioLista } en el orden elegido. Se
 * verifica igual: si la base y el código se desalinean, falla claro.
 */
function toServicios(row: Row): ServicioDelTurno[] {
  const value = row.servicios;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('La columna "servicios" debería ser una lista con al menos un servicio');
  }
  return value.map((item: unknown) => {
    const { id, nombre, precioLista } = (item ?? {}) as { id?: unknown; nombre?: unknown; precioLista?: unknown };
    if (
      typeof id !== 'string' ||
      typeof nombre !== 'string' ||
      (precioLista !== null && (typeof precioLista !== 'number' || !Number.isSafeInteger(precioLista)))
    ) {
      throw new TypeError('La columna "servicios" tiene un servicio mal formado');
    }
    return { id, nombre, precioLista };
  });
}

/** La seña del turno (las tres columnas van juntas: CHECK bookings_sena_completa). */
function toSena(row: Row): Sena | null {
  const monto = intOrNull(row, 'sena_monto');
  if (monto === null) return null;
  return { monto, formaPago: oneOf(FORMAS_DE_PAGO, row, 'sena_forma_pago'), fecha: str(row, 'sena_fecha') };
}

export function toBooking(row: Row): Booking {
  const telefono = strOrNull(row, 'telefono');
  const nombre = str(row, 'nombre');
  const vehiculoTipo = oneOf(VEHICULO_TIPOS, row, 'vehiculo_tipo');
  const vehiculoModelo = strOrNull(row, 'vehiculo_modelo');
  // La columna se llena al crear el turno. Un turno viejo que todavía no pasó por `npm run normalizar-telefonos`
  // la tiene en null: se calcula al leer, como antes, para que no cambie de comportamiento.
  const whatsapp = strOrNull(row, 'telefono_whatsapp') ?? (telefono === null ? null : telefonoWhatsapp(telefono));
  const monto = intOrNull(row, 'monto');
  const sena = toSena(row);
  const etapaAt = row.etapa_at === null || row.etapa_at === undefined ? null : isoTimestamp(row, 'etapa_at');
  return {
    id: str(row, 'id'),
    nombre,
    telefono,
    telefonoWhatsapp: whatsapp,
    email: strOrNull(row, 'email'),
    vehiculoTipo,
    vehiculoModelo,
    origen: oneOf(ORIGENES, row, 'origen'),
    servicioId: str(row, 'servicio_id'),
    fechaPreferida: str(row, 'fecha_preferida'),
    franja: oneOf(FRANJAS, row, 'franja'),
    fechaConfirmada: strOrNull(row, 'fecha_confirmada'),
    franjaConfirmada: oneOfOrNull(FRANJAS, row, 'franja_confirmada'),
    comentario: strOrNull(row, 'comentario'),
    estado: oneOf(ESTADOS, row, 'estado'),
    notasInternas: strOrNull(row, 'notas_internas'),
    turnosDelCliente: intOrNull(row, 'turnos_del_cliente'),
    monto,
    trabajador: toTrabajador(row),
    formaPago: oneOfOrNull(FORMAS_DE_PAGO, row, 'forma_pago'),
    servicios: toServicios(row),
    etapa: oneOfOrNull(ETAPAS, row, 'etapa'),
    etapaDesde: etapaAt,
    descuento: int(row, 'descuento'),
    descuentoMotivo: strOrNull(row, 'descuento_motivo'),
    sena,
    saldo: monto === null ? null : monto - (sena?.monto ?? 0),
    whatsappListo: whatsappListo({ telefonoWhatsapp: whatsapp, nombre, vehiculoModelo, vehiculoTipo }),
    createdAt: isoTimestamp(row, 'created_at'),
    updatedAt: isoTimestamp(row, 'updated_at'),
  };
}

/** Escapa los comodines de LIKE (`\`, `%`, `_`) para que se busquen como texto (las consultas usan ESCAPE '\'). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Los parámetros de búsqueda ($3: patrón de texto, $4: patrón de dígitos, $5: patrón de patente) que comparten listado
 * y conteo. La patente se compara normalizada (mayúsculas, solo letras y dígitos) contra vehiculo_modelo normalizado
 * igual: "ab 123 cd" encuentra "Gol AB-123-CD". Solo letras y dígitos: no puede llevar comodines (igual se escapa).
 */
function patronesBusqueda(q: string | undefined): { texto: string | null; digitos: string | null; patente: string | null } {
  if (q === undefined) return { texto: null, digitos: null, patente: null };
  const digits = q.replace(/\D/g, '');
  const patente = normalizarPatente(q);
  return {
    texto: `%${escapeLike(q)}%`,
    digitos: digits.length >= MIN_DIGITOS_BUSQUEDA ? `%${digits}%` : null,
    patente: patente.length >= MIN_PATENTE_BUSQUEDA ? `%${escapeLike(patente)}%` : null,
  };
}

/*
 * Las columnas que se devuelven se repiten literalmente en cada consulta (la regla de ESLint exige SQL literal,
 * sin interpolar). Las fechas (date) salen como texto YYYY-MM-DD (to_char) para no depender de cómo cada driver
 * convierte el tipo date; id, como texto.
 *
 * turnos_del_cliente: una subconsulta correlacionada por fila (count sobre el índice parcial
 * bookings_telefono_whatsapp_idx), dentro de la misma consulta: sin N+1.
 *
 * servicios: otra subconsulta correlacionada por fila (PK de lavado_servicios, que empieza por booking_id): la lista
 * { id, nombre, precioLista } en el orden elegido (migración lavado_varios_servicios). Todo turno tiene al menos su
 * fila principal (la agrega el trigger bookings_servicio_principal); si igual faltara, sale el servicio de
 * bookings.servicio_id sin precio, para no romper la respuesta.
 *
 * Las escrituras devuelven el turno con una lectura aparte (buscarTurno) DESPUÉS de escribir: un INSERT o UPDATE ...
 * RETURNING no ve las filas de lavado_servicios que se escriben en la misma sentencia (ni las del trigger).
 */

/** Un turno por id (ya validado como UUID), con el cliente que se le pase: sirve dentro de una transacción. */
async function buscarTurno(sql: SqlClient, id: string): Promise<Booking | undefined> {
  const { rows } = await sql.query(
    `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
            to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
            to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
            b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
            b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
            to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
            t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), t.email, 'Sin nombre') AS trabajador_nombre,
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
     WHERE b.id = $1::uuid`,
    [id],
  );
  const row = rows[0];
  return row ? toBooking(row) : undefined;
}

/** Igual que buscarTurno, pero el turno tiene que existir (se acaba de escribir en la misma transacción). */
async function turnoEscrito(sql: SqlClient, id: string): Promise<Booking> {
  const booking = await buscarTurno(sql, id);
  if (booking === undefined) throw new Error('El turno no se encontró después de escribirlo');
  return booking;
}

/**
 * Reemplaza la lista de servicios del turno (lavado_servicios) por `servicioIds`, en ese orden (orden 0 = el principal).
 * Los que ya estaban conservan su foto de precio_lista; los nuevos toman el precio de lista vigente para el vehículo
 * del turno (buddys.precio_de_lista). Borrar y volver a insertar (y no UPDATE) evita choques con el UNIQUE de
 * (booking_id, orden) al reordenar. Va dentro de la transacción de quien la llama.
 */
async function reemplazarServicios(sql: SqlClient, bookingId: string, servicioIds: readonly string[]): Promise<void> {
  const previos = await sql.query(
    'DELETE FROM buddys.lavado_servicios WHERE booking_id = $1::uuid RETURNING servicio_id, precio_lista',
    [bookingId],
  );
  await sql.query(
    `INSERT INTO buddys.lavado_servicios (booking_id, servicio_id, orden, precio_lista)
     SELECT b.id, n.id, (n.pos - 1)::smallint,
            CASE WHEN p.id IS NOT NULL THEN p.precio ELSE buddys.precio_de_lista(n.id, b.vehiculo_tipo) END
     FROM unnest($2::text[]) WITH ORDINALITY AS n(id, pos)
     JOIN buddys.bookings b ON b.id = $1::uuid
     LEFT JOIN unnest($3::text[], $4::integer[]) AS p(id, precio) ON p.id = n.id`,
    [
      bookingId,
      servicioIds,
      previos.rows.map((row) => str(row, 'servicio_id')),
      previos.rows.map((row) => intOrNull(row, 'precio_lista')),
    ],
  );
}

/**
 * Insumos que se descuentan solos (función 15): deja los movimientos automáticos del turno en lo que pide la receta de
 * sus servicios si está completado, o los devuelve si no (o si `revertir`, antes de borrarlo). Toda la lógica está en
 * la función de la base (migración insumos_por_servicio), dentro de la transacción de quien llama. Nunca falla por
 * falta de stock.
 */
async function sincronizarInsumos(sql: SqlClient, id: string, perfilId: string | null, revertir: boolean): Promise<void> {
  await sql.query('SELECT buddys.sincronizar_insumos_turno($1::uuid, $2::uuid, $3::boolean)', [id, perfilId, revertir]);
}

/**
 * INSERT de un turno nuevo ("pendiente"). Recibe el cliente: sirve dentro de la transacción del alta pública. El
 * trigger bookings_servicio_principal le agrega su servicio en lavado_servicios (con la foto del precio de lista).
 */
async function insertBooking(sql: SqlClient, input: NewBooking, now: Date): Promise<Booking> {
  const timestamp = now.toISOString();
  const { rows } = await sql.query(
    `INSERT INTO buddys.bookings (
       nombre, telefono, telefono_whatsapp, email, vehiculo_tipo, vehiculo_modelo,
       servicio_id, fecha_preferida, franja, comentario, estado, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, 'pendiente', $11::timestamptz, $11::timestamptz)
     RETURNING id::text AS id`,
    [
      input.nombre,
      input.telefono,
      telefonoWhatsapp(input.telefono),
      input.email,
      input.vehiculoTipo,
      input.vehiculoModelo,
      input.servicioId,
      input.fechaPreferida,
      input.franja,
      input.comentario,
      timestamp,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('INSERT de turno no devolvió la fila creada');
  }
  return turnoEscrito(sql, str(row, 'id'));
}

/**
 * Turnos sobre Postgres (esquema buddys). El orden "más nuevos primero" es por `seq` (identity), estable
 * aunque dos turnos tengan el mismo created_at; en la agenda, `seq` es el orden de llegada.
 */
export class PostgresBookingRepository implements BookingRepository {
  constructor(private readonly sql: SqlClient) {}

  create(input: NewBooking, now: Date): Promise<Booking> {
    return this.sql.transaction((sql) => insertBooking(sql, input, now));
  }

  /**
   * Lavado de mostrador: nace completado, con su cobro y `origen = 'mostrador'`. No toma el bloqueo de la fecha ni
   * mira cupos (no ocupa lugar en la agenda). En una transacción: el turno (servicio_id = el primero de la lista), su
   * lista de servicios y la lectura final.
   * Con idLocal repetido no inserta (el índice único bookings_id_local_key es el árbitro, también ante dos reintentos
   * simultáneos) y devuelve undefined.
   */
  registrarLavado(input: NuevoLavado, now: Date): Promise<Booking | undefined> {
    const [principal] = input.servicioIds;
    if (principal === undefined) return Promise.reject(new Error('Un lavado necesita al menos un servicio'));
    return this.sql.transaction(async (sql) => {
      const { rows } = await sql.query(
        `INSERT INTO buddys.bookings (
           nombre, telefono, telefono_whatsapp, vehiculo_tipo, vehiculo_modelo, servicio_id, fecha_preferida, franja,
           estado, notas_internas, monto, trabajador_id, origen, forma_pago, registrado_por, id_local, created_at, updated_at,
           etapa, etapa_at, descuento, descuento_motivo
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, 'completado', $9, $10::integer, $11::uuid, 'mostrador',
                   $13::text, $14::uuid, $15::uuid, $12::timestamptz, $12::timestamptz,
                   $16::text, $12::timestamptz, $17::integer, $18::text)
         ON CONFLICT (id_local) WHERE id_local IS NOT NULL DO NOTHING
         RETURNING id::text AS id`,
        [
          input.nombre,
          input.telefono,
          input.telefono === null ? null : telefonoWhatsapp(input.telefono),
          input.vehiculoTipo,
          input.vehiculoModelo,
          principal,
          input.fecha,
          input.franja,
          input.notasInternas,
          input.monto,
          input.trabajadorId,
          now.toISOString(),
          input.formaPago,
          input.registradoPor,
          input.idLocal,
          input.etapa,
          input.descuento,
          input.descuentoMotivo,
        ],
      );
      const row = rows[0];
      if (!row) {
        if (input.idLocal !== null) return undefined; // ya existía uno con ese idLocal
        throw new Error('INSERT de lavado no devolvió la fila creada');
      }
      const id = str(row, 'id');
      // El trigger ya agregó el principal; con un solo servicio no hay nada más que escribir.
      if (input.servicioIds.length > 1) await reemplazarServicios(sql, id, input.servicioIds);
      await sincronizarInsumos(sql, id, input.registradoPor, false);
      return turnoEscrito(sql, id);
    });
  }

  async lavadoPorIdLocal(idLocal: string): Promise<{ lavado: Booking; registradoPor: string | null } | undefined> {
    if (!isUuid(idLocal)) return undefined;
    // Mismo predicado que el índice único parcial bookings_id_local_key.
    const { rows } = await this.sql.query(
      `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
              to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
              to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
              b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
            b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
            to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
              t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), t.email, 'Sin nombre') AS trabajador_nombre,
              CASE WHEN b.telefono_whatsapp IS NULL THEN NULL
                   ELSE (SELECT count(*)::int FROM buddys.bookings c WHERE c.telefono_whatsapp = b.telefono_whatsapp)
              END AS turnos_del_cliente,
              coalesce(
                (SELECT json_agg(json_build_object('id', ls.servicio_id, 'nombre', sv.nombre, 'precioLista', ls.precio_lista) ORDER BY ls.orden)
                 FROM buddys.lavado_servicios ls JOIN buddys.servicios sv ON sv.id = ls.servicio_id
                 WHERE ls.booking_id = b.id),
                (SELECT json_build_array(json_build_object('id', sp.id, 'nombre', sp.nombre, 'precioLista', NULL))
                 FROM buddys.servicios sp WHERE sp.id = b.servicio_id)
              ) AS servicios,
              b.registrado_por::text AS registrado_por
       FROM buddys.bookings b
       LEFT JOIN buddys.perfiles t ON t.id = b.trabajador_id
       WHERE b.id_local = $1::uuid AND b.id_local IS NOT NULL`,
      [idLocal],
    );
    const row = rows[0];
    return row ? { lavado: toBooking(row), registradoPor: strOrNull(row, 'registrado_por') } : undefined;
  }

  async formasDePagoDelDia(fecha: string): Promise<TotalFormaDePago[]> {
    // Mismo filtro que lavadosDelDia (índice parcial bookings_mostrador_fecha_idx), sin los cancelados.
    const { rows } = await this.sql.query(
      `SELECT b.forma_pago, count(*)::int AS cantidad, coalesce(sum(b.monto), 0)::float8 AS total
       FROM buddys.bookings b
       WHERE b.origen = 'mostrador'
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $1::date
         AND b.estado <> 'cancelado'
       GROUP BY b.forma_pago`,
      [fecha],
    );
    return rows.map((row) => ({
      formaPago: oneOfOrNull(FORMAS_DE_PAGO, row, 'forma_pago'),
      cantidad: int(row, 'cantidad'),
      total: num(row, 'total'),
    }));
  }

  async registroDeLavado(id: string): Promise<RegistroDeLavado | undefined> {
    if (!isUuid(id)) return undefined;
    const { rows } = await this.sql.query(
      `SELECT b.registrado_por::text AS registrado_por, b.created_at
       FROM buddys.bookings b
       WHERE b.id = $1::uuid AND b.origen = 'mostrador'`,
      [id],
    );
    const row = rows[0];
    return row ? { registradoPor: strOrNull(row, 'registrado_por'), createdAt: isoTimestamp(row, 'created_at') } : undefined;
  }

  async lavadosDelDia(fecha: string): Promise<Booking[]> {
    // Mismas expresiones que el índice parcial bookings_mostrador_fecha_idx.
    const { rows } = await this.sql.query(
      `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
              to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
              to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
              b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
            b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
            to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
              t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), t.email, 'Sin nombre') AS trabajador_nombre,
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
       WHERE b.origen = 'mostrador'
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $1::date
       ORDER BY b.seq`,
      [fecha],
    );
    return rows.map(toBooking);
  }

  reservar(input: NewBooking, now: Date): Promise<Booking> {
    return this.sql.transaction(async (sql) => {
      // Bloqueo por fecha hasta el COMMIT: dos altas del mismo día se hacen de a una, y la segunda ya ve el turno de
      // la primera al contar los ocupados (READ COMMITTED: cada sentencia ve lo confirmado antes de empezar).
      // Clave de dos enteros: 7340003 (alta pública) y los días desde 2000-01-01.
      await sql.query("SELECT pg_catalog.pg_advisory_xact_lock(7340003, $1::date - DATE '2000-01-01')", [
        input.fechaPreferida,
      ]);
      const [cupo] = await cuposEntre(sql, input.fechaPreferida, input.fechaPreferida);
      if (cupo === undefined) throw new Error('No se pudieron calcular los cupos del día');
      verificarLugar(cupo, input.franja); // lanzar acá revierte la transacción: no se guarda nada
      return insertBooking(sql, input, now);
    });
  }

  async seguimiento(id: string): Promise<SeguimientoTurno | undefined> {
    if (!isUuid(id)) return undefined;
    // SOLO los campos públicos: nada de datos del cliente ni notas. Con varios servicios, sus nombres unidos con " + ".
    const { rows } = await this.sql.query(
      `SELECT b.id::text AS id,
              coalesce(
                (SELECT string_agg(sv.nombre, ' + ' ORDER BY ls.orden)
                 FROM buddys.lavado_servicios ls JOIN buddys.servicios sv ON sv.id = ls.servicio_id
                 WHERE ls.booking_id = b.id),
                s.nombre
              ) AS servicio_nombre,
              to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM-DD') AS fecha,
              coalesce(b.franja_confirmada, b.franja) AS franja, b.estado, b.updated_at
       FROM buddys.bookings b
       JOIN buddys.servicios s ON s.id = b.servicio_id
       WHERE b.id = $1::uuid`,
      [id],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: str(row, 'id'),
      servicioNombre: str(row, 'servicio_nombre'),
      fecha: str(row, 'fecha'),
      franja: oneOf(FRANJAS, row, 'franja'),
      estado: oneOf(ESTADOS, row, 'estado'),
      actualizadoEl: isoTimestamp(row, 'updated_at'),
    };
  }

  async recordatoriosPendientes(fecha: string): Promise<CandidatoRecordatorio[]> {
    // `estado <> 'cancelado'` es redundante a propósito: es el predicado del índice parcial bookings_agenda_idx.
    const { rows } = await this.sql.query(
      `SELECT b.id::text AS id, b.email, b.telefono_whatsapp,
              coalesce(
                (SELECT string_agg(sv.nombre, ' + ' ORDER BY ls.orden)
                 FROM buddys.lavado_servicios ls JOIN buddys.servicios sv ON sv.id = ls.servicio_id
                 WHERE ls.booking_id = b.id),
                s.nombre
              ) AS servicio_nombre,
              to_char(coalesce(b.fecha_confirmada, b.fecha_preferida), 'YYYY-MM-DD') AS fecha,
              coalesce(b.franja_confirmada, b.franja) AS franja
       FROM buddys.bookings b
       JOIN buddys.servicios s ON s.id = b.servicio_id
       WHERE b.estado = 'confirmado'
         AND b.estado <> 'cancelado'
         AND b.recordatorio_enviado_at IS NULL
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $1::date
       ORDER BY b.seq`,
      [fecha],
    );
    return rows.map((row) => ({
      id: str(row, 'id'),
      email: strOrNull(row, 'email'),
      telefonoWhatsapp: strOrNull(row, 'telefono_whatsapp'),
      servicioNombre: str(row, 'servicio_nombre'),
      fecha: str(row, 'fecha'),
      franja: oneOf(FRANJAS, row, 'franja'),
    }));
  }

  async marcarRecordatorio(id: string, fecha: string, now: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    // Las condiciones van en el mismo UPDATE: si en el medio se canceló o se reprogramó, no se marca.
    // updated_at queda igual a propósito: no es un cambio del turno (el trigger de updated_at no corre cuando cambia
    // recordatorio_enviado_at; migración disponibilidad_seguimiento).
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.bookings AS b
       SET recordatorio_enviado_at = $3::timestamptz
       WHERE b.id = $1::uuid
         AND b.estado = 'confirmado'
         AND b.recordatorio_enviado_at IS NULL
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $2::date`,
      [id, fecha, now.toISOString()],
    );
    return rowCount > 0;
  }

  async list({ estado, q, cliente, limit, offset }: ListBookingsOptions): Promise<{ bookings: Booking[]; total: number }> {
    // Un solo par de consultas para todas las combinaciones: cada filtro ausente es un parámetro null (la tabla es
    // chica y node-postgres manda consultas sin nombre, así que el planner ve los null y los descarta).
    // Texto: buddys.texto_busqueda (minúsculas y sin acentos) de los dos lados del LIKE; los comodines vienen
    // escapados (escapeLike) y el ESCAPE es explícito. Dígitos: contra los dígitos del teléfono escrito y contra el
    // normalizado. Todo va como parámetro.
    const { texto, digitos, patente } = patronesBusqueda(q);
    const params = [estado ?? null, cliente ?? null, texto, digitos, patente];
    const [page, count] = await Promise.all([
      this.sql.query(
        `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
                to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
                to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
                b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
            b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
            to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
                t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), t.email, 'Sin nombre') AS trabajador_nombre,
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
         WHERE ($1::text IS NULL OR b.estado = $1::text)
           AND ($2::text IS NULL OR b.telefono_whatsapp = $2::text)
           AND ($3::text IS NULL
                OR buddys.texto_busqueda(b.nombre) LIKE buddys.texto_busqueda($3::text) ESCAPE '\\'
                OR buddys.texto_busqueda(b.email) LIKE buddys.texto_busqueda($3::text) ESCAPE '\\'
                OR buddys.texto_busqueda(b.vehiculo_modelo) LIKE buddys.texto_busqueda($3::text) ESCAPE '\\'
                OR ($4::text IS NOT NULL
                    AND (regexp_replace(b.telefono, '[^0-9]', '', 'g') LIKE $4::text
                         OR b.telefono_whatsapp LIKE $4::text))
                OR ($5::text IS NOT NULL
                    AND regexp_replace(upper(coalesce(b.vehiculo_modelo, '')), '[^A-Z0-9]', '', 'g') LIKE $5::text))
         ORDER BY b.seq DESC
         LIMIT $6 OFFSET $7`,
        [...params, limit, offset],
      ),
      this.sql.query(
        `SELECT count(*)::int AS total
         FROM buddys.bookings b
         WHERE ($1::text IS NULL OR b.estado = $1::text)
           AND ($2::text IS NULL OR b.telefono_whatsapp = $2::text)
           AND ($3::text IS NULL
                OR buddys.texto_busqueda(b.nombre) LIKE buddys.texto_busqueda($3::text) ESCAPE '\\'
                OR buddys.texto_busqueda(b.email) LIKE buddys.texto_busqueda($3::text) ESCAPE '\\'
                OR buddys.texto_busqueda(b.vehiculo_modelo) LIKE buddys.texto_busqueda($3::text) ESCAPE '\\'
                OR ($4::text IS NOT NULL
                    AND (regexp_replace(b.telefono, '[^0-9]', '', 'g') LIKE $4::text
                         OR b.telefono_whatsapp LIKE $4::text))
                OR ($5::text IS NOT NULL
                    AND regexp_replace(upper(coalesce(b.vehiculo_modelo, '')), '[^A-Z0-9]', '', 'g') LIKE $5::text))`,
        params,
      ),
    ]);
    const totalRow = count.rows[0];
    return { bookings: page.rows.map(toBooking), total: totalRow ? int(totalRow, 'total') : 0 };
  }

  find(id: string): Promise<Booking | undefined> {
    if (!isUuid(id)) return Promise.resolve(undefined);
    return buscarTurno(this.sql, id);
  }

  actualizar(
    id: string,
    { estado, notasInternas, monto, trabajadorId, formaPago, servicioIds, descuento }: ActualizacionTurno,
    now: Date,
  ): Promise<Booking | undefined> {
    // Un id que no es UUID no puede existir (y Postgres rechazaría el cast): igual que "no existe".
    if (!isUuid(id)) return Promise.resolve(undefined);
    const principal = servicioIds?.[0] ?? null;
    return this.sql.transaction(async (sql) => {
      // coalesce($1, estado): sin estado nuevo, queda el que tenía. La nota: $2 dice si se toca (null es un valor
      // válido: borrarla). Sin condición de estado: la nota se puede cambiar aunque el turno esté cerrado.
      // Cobro ($6 y $8 dicen si se toca; $7 y $9 son los valores): si el estado final no es "completado" quedan en
      // null (CHECK bookings_cobro_solo_completado). updated_at solo se mueve si cambia el estado, la nota o los
      // servicios: cargar o corregir el cobro no es un cambio para el cliente (y el trigger tampoco corre; migración
      // estadisticas_cobro). Forma de pago ($10 dice si se toca; $11 es el valor): no depende del estado y tampoco
      // mueve updated_at (migración forma_pago_deshacer_lavado). Servicios ($12: el principal nuevo, o null si no se
      // tocan): el servicio de los avisos y del seguimiento cambia, así que sí mueve updated_at. Descuento ($13 dice si
      // se toca; $14 y $15, monto y motivo): parte del cobro, en 0 si el turno no queda completado (CHECK
      // bookings_descuento_solo_completado) y no mueve updated_at (migración lavados_etapa_descuento).
      const { rowCount } = await sql.query(
        `UPDATE buddys.bookings AS u
         SET estado = coalesce($1::text, u.estado),
             notas_internas = CASE WHEN $2::boolean THEN $3::text ELSE u.notas_internas END,
             monto = CASE WHEN coalesce($1::text, u.estado) <> 'completado' THEN NULL
                          WHEN $6::boolean THEN $7::integer ELSE u.monto END,
             trabajador_id = CASE WHEN coalesce($1::text, u.estado) <> 'completado' THEN NULL
                                  WHEN $8::boolean THEN $9::uuid ELSE u.trabajador_id END,
             forma_pago = CASE WHEN $10::boolean THEN $11::text ELSE u.forma_pago END,
             servicio_id = coalesce($12::text, u.servicio_id),
             descuento = CASE WHEN coalesce($1::text, u.estado) <> 'completado' THEN 0
                              WHEN $13::boolean THEN $14::integer ELSE u.descuento END,
             descuento_motivo = CASE WHEN coalesce($1::text, u.estado) <> 'completado' THEN NULL
                                     WHEN $13::boolean THEN $15::text ELSE u.descuento_motivo END,
             updated_at = CASE WHEN ($1::text IS NOT NULL AND $1::text IS DISTINCT FROM u.estado) OR $2::boolean
                                    OR $12::text IS NOT NULL
                               THEN $4::timestamptz ELSE u.updated_at END
         WHERE u.id = $5::uuid`,
        [
          estado ?? null,
          notasInternas !== undefined,
          notasInternas ?? null,
          now.toISOString(),
          id,
          monto !== undefined,
          monto ?? null,
          trabajadorId !== undefined,
          trabajadorId ?? null,
          formaPago !== undefined,
          formaPago ?? null,
          principal,
          descuento !== undefined,
          descuento?.monto ?? 0,
          descuento?.motivo ?? null,
        ],
      );
      if (rowCount === 0) return undefined;
      if (servicioIds !== undefined) await reemplazarServicios(sql, id, servicioIds);
      // Completar, sacar de completado o cambiar los servicios mueve el stock de su receta (función 15).
      if (estado !== undefined || servicioIds !== undefined) await sincronizarInsumos(sql, id, null, false);
      return turnoEscrito(sql, id);
    });
  }

  updateEstado(id: string, estado: Estado, now: Date): Promise<Booking | undefined> {
    return this.actualizar(id, { estado }, now);
  }

  async reprogramar(
    id: string,
    { confirmada, estado, notasInternas, formaPago, servicioIds }: Reprogramacion,
    now: Date,
  ): Promise<Booking | undefined> {
    if (!isUuid(id)) return undefined;
    const principal = servicioIds?.[0] ?? null;
    const booking = await this.sql.transaction(async (sql) => {
      // La condición "no cerrado" va en el mismo UPDATE: si otro pedido lo cancela o completa en el medio, no se
      // reprograma igual. coalesce($3, estado): sin estado nuevo, queda el que tenía. La nota, la forma de pago y los
      // servicios, como en actualizar().
      const { rowCount } = await sql.query(
        `UPDATE buddys.bookings AS b
         SET fecha_confirmada = $1::date, franja_confirmada = $2::text,
             -- Si cambia la fecha o la franja de agenda, el recordatorio ya enviado no sirve: se limpia la marca.
             -- (En el SET, b.* son los valores de ANTES del UPDATE.)
             recordatorio_enviado_at = CASE
               WHEN coalesce($1::date, b.fecha_preferida) IS DISTINCT FROM coalesce(b.fecha_confirmada, b.fecha_preferida)
                 OR coalesce($2::text, b.franja) IS DISTINCT FROM coalesce(b.franja_confirmada, b.franja)
               THEN NULL ELSE b.recordatorio_enviado_at END,
             estado = coalesce($3::text, b.estado),
             notas_internas = CASE WHEN $4::boolean THEN $5::text ELSE b.notas_internas END,
             forma_pago = CASE WHEN $8::boolean THEN $9::text ELSE b.forma_pago END,
             servicio_id = coalesce($10::text, b.servicio_id),
             updated_at = $6::timestamptz
         WHERE b.id = $7::uuid AND b.estado NOT IN ('cancelado', 'completado')`,
        [
          confirmada?.fecha ?? null,
          confirmada?.franja ?? null,
          estado ?? null,
          notasInternas !== undefined,
          notasInternas ?? null,
          now.toISOString(),
          id,
          formaPago !== undefined,
          formaPago ?? null,
          principal,
        ],
      );
      if (rowCount === 0) return undefined;
      if (servicioIds !== undefined) await reemplazarServicios(sql, id, servicioIds);
      return turnoEscrito(sql, id);
    });
    if (booking !== undefined) return booking;

    // No se actualizó: o no existe, o está cerrado.
    const actual = await this.sql.query('SELECT estado FROM buddys.bookings WHERE id = $1::uuid', [id]);
    const existente = actual.rows[0];
    if (!existente) return undefined;
    throw new TurnoCerradoError(oneOf(ESTADOS, existente, 'estado'));
  }

  async agenda(desde: string, hasta: string): Promise<Booking[]> {
    // Mismas expresiones y mismo predicado que el índice parcial bookings_agenda_idx (migración
    // agenda_fecha_confirmada). 'manana' < 'tarde' como texto: mañana antes que tarde.
    const { rows } = await this.sql.query(
      `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
              to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
              to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
              b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
            b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
            to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
              t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), t.email, 'Sin nombre') AS trabajador_nombre,
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
       WHERE b.estado <> 'cancelado'
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) BETWEEN $1::date AND $2::date
       ORDER BY coalesce(b.fecha_confirmada, b.fecha_preferida), coalesce(b.franja_confirmada, b.franja), b.seq`,
      [desde, hasta],
    );
    return rows.map(toBooking);
  }

  /**
   * Turno del panel (función 8): nace confirmado, origen 'panel', con la fecha pedida igual a la de agenda y su seña si
   * viene. No toma el bloqueo de la fecha ni mira cupos (el panel manda, como al reprogramar). En una transacción: el
   * turno, su lista de servicios y la lectura final.
   */
  crearTurnoPanel(input: NuevoTurnoPanel, now: Date): Promise<Booking> {
    const [principal] = input.servicioIds;
    if (principal === undefined) return Promise.reject(new Error('Un turno necesita al menos un servicio'));
    return this.sql.transaction(async (sql) => {
      const { rows } = await sql.query(
        `INSERT INTO buddys.bookings (
           nombre, telefono, telefono_whatsapp, email, vehiculo_tipo, vehiculo_modelo, servicio_id, fecha_preferida, franja,
           comentario, estado, notas_internas, origen, sena_monto, sena_forma_pago, sena_fecha, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, 'confirmado', $11, 'panel', $12::integer, $13::text,
                   $14::date, $15::timestamptz, $15::timestamptz)
         RETURNING id::text AS id`,
        [
          input.nombre,
          input.telefono,
          telefonoWhatsapp(input.telefono),
          input.email,
          input.vehiculoTipo,
          input.vehiculoModelo,
          principal,
          input.fecha,
          input.franja,
          input.comentario,
          input.notasInternas,
          input.sena?.monto ?? null,
          input.sena?.formaPago ?? null,
          input.sena?.fecha ?? null,
          now.toISOString(),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('INSERT de turno del panel no devolvió la fila creada');
      const id = str(row, 'id');
      if (input.servicioIds.length > 1) await reemplazarServicios(sql, id, input.servicioIds);
      return turnoEscrito(sql, id);
    });
  }

  async cambiarSena(id: string, sena: NuevaSena | null): Promise<Booking | undefined> {
    if (!isUuid(id)) return undefined;
    // La seña es plata: no mueve updated_at (el trigger tampoco corre; migración turnos_panel_sena).
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.bookings
       SET sena_monto = $2::integer, sena_forma_pago = $3::text, sena_fecha = $4::date
       WHERE id = $1::uuid AND origen <> 'mostrador'`,
      [id, sena?.monto ?? null, sena?.formaPago ?? null, sena?.fecha ?? null],
    );
    return rowCount === 0 ? undefined : buscarTurno(this.sql, id);
  }

  async cambiarEtapa(id: string, etapa: Etapa, now: Date): Promise<Booking | undefined> {
    if (!isUuid(id)) return undefined;
    // Quien llama ya comprobó que la etapa cambia (la misma etapa no reinicia el reloj del tablero ni se escribe).
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.bookings
       SET etapa = $2::text, etapa_at = $3::timestamptz, updated_at = $3::timestamptz
       WHERE id = $1::uuid AND origen = 'mostrador'`,
      [id, etapa, now.toISOString()],
    );
    return rowCount === 0 ? undefined : buscarTurno(this.sql, id);
  }

  async lavadosEnCurso(fecha: string): Promise<Booking[]> {
    // Mismas expresiones y predicado que el índice parcial bookings_mostrador_en_curso_idx. Por etapa (espera,
    // lavando, listo) y orden de llegada.
    const { rows } = await this.sql.query(
      `SELECT b.id::text AS id, b.nombre, b.telefono, b.telefono_whatsapp, b.email, b.vehiculo_tipo, b.vehiculo_modelo, b.origen, b.servicio_id,
              to_char(b.fecha_preferida, 'YYYY-MM-DD') AS fecha_preferida, b.franja,
              to_char(b.fecha_confirmada, 'YYYY-MM-DD') AS fecha_confirmada, b.franja_confirmada,
              b.comentario, b.estado, b.notas_internas, b.monto, b.forma_pago, b.created_at, b.updated_at,
              b.etapa, b.etapa_at, b.descuento, b.descuento_motivo, b.sena_monto, b.sena_forma_pago,
              to_char(b.sena_fecha, 'YYYY-MM-DD') AS sena_fecha,
              t.id::text AS trabajador_id, coalesce(nullif(btrim(t.nombre), ''), t.email, 'Sin nombre') AS trabajador_nombre,
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
       WHERE b.origen = 'mostrador' AND b.etapa <> 'entregado'
         AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $1::date
       ORDER BY CASE b.etapa WHEN 'espera' THEN 0 WHEN 'lavando' THEN 1 ELSE 2 END, b.seq`,
      [fecha],
    );
    return rows.map(toBooking);
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    // Un turno con comprobante emitido no se borra (la FK es ON DELETE RESTRICT): se avisa con un error de negocio.
    // Sus servicios (lavado_servicios) se van con él: ON DELETE CASCADE.
    // Antes de borrarlo, en la misma transacción, se devuelven al stock los insumos que se descontaron solos.
    return this.sql.transaction(async (sql) => {
      const emitido = await sql.query('SELECT 1 AS ok FROM buddys.comprobantes WHERE booking_id = $1::uuid', [id]);
      if (emitido.rows.length > 0) throw new TurnoConComprobanteError();
      await sincronizarInsumos(sql, id, null, true);
      const { rowCount } = await sql.query('DELETE FROM buddys.bookings WHERE id = $1::uuid', [id]);
      return rowCount > 0;
    });
  }
}
