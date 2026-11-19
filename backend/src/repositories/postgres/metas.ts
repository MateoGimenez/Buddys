import type { SqlClient } from '../../db/postgres.js';
import { type Row, intOrNull, str } from '../../db/rows.js';
import { type MetaMensual, type MetaRepository, type ObjetivosMeta, mezclarMeta } from '../../domain/metas.js';

function toMeta(row: Row): MetaMensual {
  return {
    mes: str(row, 'mes'),
    ingresosObjetivo: intOrNull(row, 'ingresos_objetivo'),
    trabajosObjetivo: intOrNull(row, 'trabajos_objetivo'),
  };
}

/** Metas mensuales sobre Postgres. `mes` sale como YYYY-MM y se guarda como el día 1 de ese mes. */
export class PostgresMetaRepository implements MetaRepository {
  constructor(private readonly sql: SqlClient) {}

  async obtener(mes: string): Promise<MetaMensual | null> {
    const { rows } = await this.sql.query(
      `SELECT to_char(mes, 'YYYY-MM') AS mes, ingresos_objetivo, trabajos_objetivo
       FROM buddys.metas_mensuales WHERE mes = $1::date`,
      [`${mes}-01`],
    );
    const row = rows[0];
    return row ? toMeta(row) : null;
  }

  async delAnio(anio: number): Promise<MetaMensual[]> {
    const { rows } = await this.sql.query(
      `SELECT to_char(mes, 'YYYY-MM') AS mes, ingresos_objetivo, trabajos_objetivo
       FROM buddys.metas_mensuales
       WHERE mes >= make_date($1::int, 1, 1) AND mes < make_date($1::int + 1, 1, 1)
       ORDER BY mes`,
      [anio],
    );
    return rows.map(toMeta);
  }

  async guardar(mes: string, cambios: Partial<ObjetivosMeta>): Promise<MetaMensual | null> {
    // Una transacción: se lee lo guardado con bloqueo (FOR UPDATE), se mezcla y se escribe. El alta de un mes sin
    // fila la resuelve ON CONFLICT (dos altas simultáneas no chocan).
    return this.sql.transaction(async (tx) => {
      const { rows: actuales } = await tx.query(
        `SELECT to_char(mes, 'YYYY-MM') AS mes, ingresos_objetivo, trabajos_objetivo
         FROM buddys.metas_mensuales WHERE mes = $1::date FOR UPDATE`,
        [`${mes}-01`],
      );
      const actual = actuales[0] ? toMeta(actuales[0]) : null;
      const mezcla = mezclarMeta(actual, cambios);
      if (mezcla.ingresosObjetivo === null && mezcla.trabajosObjetivo === null) return null;
      const { rows } = await tx.query(
        `INSERT INTO buddys.metas_mensuales (mes, ingresos_objetivo, trabajos_objetivo)
         VALUES ($1::date, $2::int, $3::int)
         ON CONFLICT (mes) DO UPDATE
           SET ingresos_objetivo = EXCLUDED.ingresos_objetivo, trabajos_objetivo = EXCLUDED.trabajos_objetivo,
               -- Una meta nueva se puede volver a avisar como cumplida (migración avisos_meta).
               cumplida_avisada_at = CASE
                 WHEN buddys.metas_mensuales.ingresos_objetivo IS DISTINCT FROM EXCLUDED.ingresos_objetivo
                   OR buddys.metas_mensuales.trabajos_objetivo IS DISTINCT FROM EXCLUDED.trabajos_objetivo
                 THEN NULL ELSE buddys.metas_mensuales.cumplida_avisada_at END,
               updated_at = now()
         RETURNING to_char(mes, 'YYYY-MM') AS mes, ingresos_objetivo, trabajos_objetivo`,
        [`${mes}-01`, mezcla.ingresosObjetivo, mezcla.trabajosObjetivo],
      );
      const row = rows[0];
      if (!row) throw new Error('El guardado de la meta no devolvió fila');
      return toMeta(row);
    });
  }

  async marcarCumplidaAvisada(mes: string, now: Date): Promise<boolean> {
    // El que la marca es el único que avisa (aunque dos lavados lleguen a la vez).
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.metas_mensuales SET cumplida_avisada_at = $2::timestamptz
       WHERE mes = $1::date AND cumplida_avisada_at IS NULL`,
      [`${mes}-01`, now.toISOString()],
    );
    return rowCount > 0;
  }

  async borrar(mes: string): Promise<boolean> {
    const { rowCount } = await this.sql.query('DELETE FROM buddys.metas_mensuales WHERE mes = $1::date', [
      `${mes}-01`,
    ]);
    return rowCount > 0;
  }
}
