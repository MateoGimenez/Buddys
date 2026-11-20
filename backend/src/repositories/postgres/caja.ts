import type { SqlClient } from '../../db/postgres.js';
import { type Row, int, intOrNull, isoTimestamp, oneOfOrNull, str, strOrNull } from '../../db/rows.js';
import type { CajaEsperada, CajaRepository, CierreGuardado, NuevoCierre } from '../../domain/caja.js';
import { FORMAS_DE_PAGO } from '../../domain/comprobantes.js';

function toCierre(row: Row): CierreGuardado {
  const cerradoPor = strOrNull(row, 'cerrado_por');
  return {
    fecha: str(row, 'fecha'),
    contado: {
      efectivo: int(row, 'contado_efectivo'),
      transferencia: intOrNull(row, 'contado_transferencia'),
      debito: intOrNull(row, 'contado_debito'),
      credito: intOrNull(row, 'contado_credito'),
      otro: intOrNull(row, 'contado_otro'),
    },
    esperado: {
      efectivo: int(row, 'esperado_efectivo'),
      transferencia: int(row, 'esperado_transferencia'),
      debito: int(row, 'esperado_debito'),
      credito: int(row, 'esperado_credito'),
      otro: int(row, 'esperado_otro'),
    },
    sinIndicar: int(row, 'sin_indicar'),
    diferencia: int(row, 'diferencia'),
    nota: strOrNull(row, 'nota'),
    cerradoPor: cerradoPor === null ? null : { id: cerradoPor, nombre: str(row, 'cerrado_por_nombre') },
    createdAt: isoTimestamp(row, 'created_at'),
    updatedAt: isoTimestamp(row, 'updated_at'),
  };
}

/** Cierres de caja sobre Postgres (migración cierres_caja). Lo esperado se agrega en la base. */
export class PostgresCajaRepository implements CajaRepository {
  constructor(private readonly sql: SqlClient) {}

  async esperado(fecha: string): Promise<CajaEsperada> {
    // Tres fuentes de plata del día: lavados de mostrador (índice bookings_mostrador_fecha_idx), saldos de turnos
    // completados ese día y señas cobradas ese día (índice bookings_sena_fecha_idx). Un saldo nunca es negativo.
    const { rows } = await this.sql.query(
      `WITH mov AS (
         SELECT b.forma_pago AS forma, coalesce(b.monto, 0) AS monto
         FROM buddys.bookings b
         WHERE b.origen = 'mostrador' AND b.estado <> 'cancelado'
           AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $1::date
         UNION ALL
         SELECT b.forma_pago, greatest(coalesce(b.monto, 0) - coalesce(b.sena_monto, 0), 0)
         FROM buddys.bookings b
         WHERE b.origen <> 'mostrador' AND b.estado = 'completado'
           AND coalesce(b.fecha_confirmada, b.fecha_preferida) = $1::date
         UNION ALL
         SELECT b.sena_forma_pago, b.sena_monto
         FROM buddys.bookings b
         WHERE b.sena_monto IS NOT NULL AND b.sena_fecha = $1::date
       )
       SELECT mov.forma, sum(mov.monto)::float8 AS total FROM mov GROUP BY mov.forma`,
      [fecha],
    );
    const esperado: CajaEsperada = {
      porForma: { efectivo: 0, transferencia: 0, debito: 0, credito: 0, otro: 0 },
      sinIndicar: 0,
    };
    for (const row of rows) {
      const forma = oneOfOrNull(FORMAS_DE_PAGO, row, 'forma');
      if (forma === null) esperado.sinIndicar = int(row, 'total');
      else esperado.porForma[forma] = int(row, 'total');
    }
    return esperado;
  }

  async obtener(fecha: string): Promise<CierreGuardado | undefined> {
    const { rows } = await this.sql.query(
      `SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.contado_efectivo, c.contado_transferencia, c.contado_debito,
              c.contado_credito, c.contado_otro, c.esperado_efectivo, c.esperado_transferencia, c.esperado_debito,
              c.esperado_credito, c.esperado_otro, c.sin_indicar, c.diferencia, c.nota, c.cerrado_por::text AS cerrado_por,
              coalesce(nullif(btrim(p.nombre), ''), p.email, 'Sin nombre') AS cerrado_por_nombre, c.created_at, c.updated_at
       FROM buddys.cierres_caja c
       LEFT JOIN buddys.perfiles p ON p.id = c.cerrado_por
       WHERE c.fecha = $1::date`,
      [fecha],
    );
    const row = rows[0];
    return row ? toCierre(row) : undefined;
  }

  async crear(cierre: NuevoCierre): Promise<CierreGuardado | undefined> {
    const { contado, esperado } = cierre;
    // La PK (fecha) es el árbitro: de dos cierres simultáneos del mismo día entra uno solo.
    const { rows } = await this.sql.query(
      `INSERT INTO buddys.cierres_caja (
         fecha, contado_efectivo, contado_transferencia, contado_debito, contado_credito, contado_otro,
         esperado_efectivo, esperado_transferencia, esperado_debito, esperado_credito, esperado_otro,
         sin_indicar, diferencia, nota, cerrado_por
       ) VALUES ($1::date, $2::int, $3::int, $4::int, $5::int, $6::int, $7::int, $8::int, $9::int, $10::int, $11::int,
                 $12::int, $13::int, $14::text, $15::uuid)
       ON CONFLICT (fecha) DO NOTHING
       RETURNING to_char(fecha, 'YYYY-MM-DD') AS fecha`,
      [
        cierre.fecha,
        contado.efectivo,
        contado.transferencia,
        contado.debito,
        contado.credito,
        contado.otro,
        esperado.efectivo,
        esperado.transferencia,
        esperado.debito,
        esperado.credito,
        esperado.otro,
        cierre.sinIndicar,
        cierre.diferencia,
        cierre.nota,
        cierre.cerradoPor,
      ],
    );
    return rows.length === 0 ? undefined : this.obtener(cierre.fecha);
  }

  async guardar(cierre: NuevoCierre, now: Date): Promise<CierreGuardado> {
    const { contado, esperado } = cierre;
    await this.sql.query(
      `INSERT INTO buddys.cierres_caja (
         fecha, contado_efectivo, contado_transferencia, contado_debito, contado_credito, contado_otro,
         esperado_efectivo, esperado_transferencia, esperado_debito, esperado_credito, esperado_otro,
         sin_indicar, diferencia, nota, cerrado_por
       ) VALUES ($1::date, $2::int, $3::int, $4::int, $5::int, $6::int, $7::int, $8::int, $9::int, $10::int, $11::int,
                 $12::int, $13::int, $14::text, $15::uuid)
       ON CONFLICT (fecha) DO UPDATE
         SET contado_efectivo = EXCLUDED.contado_efectivo, contado_transferencia = EXCLUDED.contado_transferencia,
             contado_debito = EXCLUDED.contado_debito, contado_credito = EXCLUDED.contado_credito,
             contado_otro = EXCLUDED.contado_otro, esperado_efectivo = EXCLUDED.esperado_efectivo,
             esperado_transferencia = EXCLUDED.esperado_transferencia, esperado_debito = EXCLUDED.esperado_debito,
             esperado_credito = EXCLUDED.esperado_credito, esperado_otro = EXCLUDED.esperado_otro,
             sin_indicar = EXCLUDED.sin_indicar, diferencia = EXCLUDED.diferencia, nota = EXCLUDED.nota,
             cerrado_por = EXCLUDED.cerrado_por, updated_at = $16::timestamptz`,
      [
        cierre.fecha,
        contado.efectivo,
        contado.transferencia,
        contado.debito,
        contado.credito,
        contado.otro,
        esperado.efectivo,
        esperado.transferencia,
        esperado.debito,
        esperado.credito,
        esperado.otro,
        cierre.sinIndicar,
        cierre.diferencia,
        cierre.nota,
        cierre.cerradoPor,
        now.toISOString(),
      ],
    );
    const guardado = await this.obtener(cierre.fecha);
    if (guardado === undefined) throw new Error('El cierre de caja no se encontró después de guardarlo');
    return guardado;
  }

  async borrar(fecha: string): Promise<boolean> {
    const { rowCount } = await this.sql.query('DELETE FROM buddys.cierres_caja WHERE fecha = $1::date', [fecha]);
    return rowCount > 0;
  }

  async listar(desde: string, hasta: string, limit: number, offset: number): Promise<{ cierres: CierreGuardado[]; total: number }> {
    const [pagina, cuenta] = await Promise.all([
      this.sql.query(
        `SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.contado_efectivo, c.contado_transferencia, c.contado_debito,
                c.contado_credito, c.contado_otro, c.esperado_efectivo, c.esperado_transferencia, c.esperado_debito,
                c.esperado_credito, c.esperado_otro, c.sin_indicar, c.diferencia, c.nota, c.cerrado_por::text AS cerrado_por,
                coalesce(nullif(btrim(p.nombre), ''), p.email, 'Sin nombre') AS cerrado_por_nombre, c.created_at, c.updated_at
         FROM buddys.cierres_caja c
         LEFT JOIN buddys.perfiles p ON p.id = c.cerrado_por
         WHERE c.fecha BETWEEN $1::date AND $2::date
         ORDER BY c.fecha DESC
         LIMIT $3 OFFSET $4`,
        [desde, hasta, limit, offset],
      ),
      this.sql.query('SELECT count(*)::int AS total FROM buddys.cierres_caja WHERE fecha BETWEEN $1::date AND $2::date', [
        desde,
        hasta,
      ]),
    ]);
    const fila = cuenta.rows[0];
    return { cierres: pagina.rows.map(toCierre), total: fila ? int(fila, 'total') : 0 };
  }
}
