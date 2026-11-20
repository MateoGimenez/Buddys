import type { SqlClient } from '../../db/postgres.js';
import { type Row, int, isoTimestamp, oneOf, str, strOrNull } from '../../db/rows.js';
import { CATEGORIAS_GASTO } from '../../domain/gastos.js';
import type { CambiosGastoFijo, GastoFijo, GastoFijoRepository, NuevoGastoFijo } from '../../domain/gastos-fijos.js';
import { isUuid } from './uuid.js';

function toGastoFijo(row: Row): GastoFijo {
  const perfilId = strOrNull(row, 'perfil_id');
  return {
    id: str(row, 'id'),
    concepto: str(row, 'concepto'),
    monto: int(row, 'monto'),
    categoria: oneOf(CATEGORIAS_GASTO, row, 'categoria'),
    perfil: perfilId === null ? null : { id: perfilId, nombre: str(row, 'perfil_nombre') },
    desde: str(row, 'desde'),
    hasta: strOrNull(row, 'hasta'),
    createdAt: isoTimestamp(row, 'created_at'),
    updatedAt: isoTimestamp(row, 'updated_at'),
  };
}

/**
 * Gastos fijos sobre Postgres (migración gastos_fijos). Los meses se guardan como el día 1 (date) y salen como YYYY-MM.
 * Todo con parámetros; la lectura final de cada escritura trae el nombre de la persona del sueldo.
 */
export class PostgresGastoFijoRepository implements GastoFijoRepository {
  constructor(private readonly sql: SqlClient) {}

  async listar(): Promise<GastoFijo[]> {
    const { rows } = await this.sql.query(
      `SELECT f.id::text AS id, f.concepto, f.monto, f.categoria, f.perfil_id::text AS perfil_id,
              coalesce(nullif(btrim(p.nombre), ''), p.email, 'Sin nombre') AS perfil_nombre,
              to_char(f.desde_mes, 'YYYY-MM') AS desde, to_char(f.hasta_mes, 'YYYY-MM') AS hasta, f.created_at, f.updated_at
       FROM buddys.gastos_fijos f
       LEFT JOIN buddys.perfiles p ON p.id = f.perfil_id
       ORDER BY f.categoria, f.concepto, f.id`,
    );
    return rows.map(toGastoFijo);
  }

  async obtener(id: string): Promise<GastoFijo | undefined> {
    if (!isUuid(id)) return undefined;
    const { rows } = await this.sql.query(
      `SELECT f.id::text AS id, f.concepto, f.monto, f.categoria, f.perfil_id::text AS perfil_id,
              coalesce(nullif(btrim(p.nombre), ''), p.email, 'Sin nombre') AS perfil_nombre,
              to_char(f.desde_mes, 'YYYY-MM') AS desde, to_char(f.hasta_mes, 'YYYY-MM') AS hasta, f.created_at, f.updated_at
       FROM buddys.gastos_fijos f
       LEFT JOIN buddys.perfiles p ON p.id = f.perfil_id
       WHERE f.id = $1::uuid`,
      [id],
    );
    const row = rows[0];
    return row ? toGastoFijo(row) : undefined;
  }

  async crear(nuevo: NuevoGastoFijo): Promise<GastoFijo> {
    const { rows } = await this.sql.query(
      `INSERT INTO buddys.gastos_fijos (concepto, monto, categoria, perfil_id, desde_mes, creado_por)
       VALUES ($1::text, $2::int, $3::text, $4::uuid, ($5::text || '-01')::date, $6::uuid)
       RETURNING id::text AS id`,
      [nuevo.concepto, nuevo.monto, nuevo.categoria, nuevo.perfilId, nuevo.desde, nuevo.creadoPor],
    );
    const row = rows[0];
    if (!row) throw new Error('El alta del gasto fijo no devolvió fila');
    const creado = await this.obtener(str(row, 'id'));
    if (creado === undefined) throw new Error('El gasto fijo no se encontró después de crearlo');
    return creado;
  }

  async actualizar(id: string, cambios: CambiosGastoFijo, now: Date): Promise<GastoFijo | undefined> {
    if (!isUuid(id)) return undefined;
    // Cada campo: un booleano dice si se toca y el valor va aparte (null es un valor válido de perfil y hasta).
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.gastos_fijos AS f
       SET concepto = coalesce($2::text, f.concepto),
           monto = coalesce($3::int, f.monto),
           categoria = coalesce($4::text, f.categoria),
           perfil_id = CASE WHEN $5::boolean THEN $6::uuid ELSE f.perfil_id END,
           desde_mes = coalesce(($7::text || '-01')::date, f.desde_mes),
           hasta_mes = CASE WHEN $8::boolean THEN ($9::text || '-01')::date ELSE f.hasta_mes END,
           updated_at = $10::timestamptz
       WHERE f.id = $1::uuid`,
      [
        id,
        cambios.concepto ?? null,
        cambios.monto ?? null,
        cambios.categoria ?? null,
        cambios.perfilId !== undefined,
        cambios.perfilId ?? null,
        cambios.desde ?? null,
        cambios.hasta !== undefined,
        cambios.hasta ?? null,
        now.toISOString(),
      ],
    );
    return rowCount === 0 ? undefined : this.obtener(id);
  }

  async borrar(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rowCount } = await this.sql.query('DELETE FROM buddys.gastos_fijos WHERE id = $1::uuid', [id]);
    return rowCount > 0;
  }
}
