import type { SqlClient } from '../../db/postgres.js';
import { type Row, num, oneOf, str } from '../../db/rows.js';
import { UNIDADES, estaBajoStock } from '../../domain/inventario.js';
import {
  InsumoDeRecetaInvalidoError,
  type ItemReceta,
  type ItemRecetaConInsumo,
  type RecetaRepository,
} from '../../domain/recetas.js';

const numOrNull = (row: Row, key: string): number | null =>
  row[key] === null || row[key] === undefined ? null : num(row, key);

function toItem(row: Row): ItemRecetaConInsumo {
  const stock = num(row, 'stock');
  return {
    insumoId: str(row, 'insumo_id'),
    nombre: str(row, 'nombre'),
    unidad: oneOf(UNIDADES, row, 'unidad'),
    cantidad: num(row, 'cantidad'),
    cantidadSuv: numOrNull(row, 'cantidad_suv'),
    cantidadPickup: numOrNull(row, 'cantidad_pickup'),
    cantidadMoto: numOrNull(row, 'cantidad_moto'),
    stock,
    bajoStock: estaBajoStock(stock, num(row, 'stock_minimo')),
  };
}

/** Recetas de servicios sobre Postgres (migración insumos_por_servicio). Los numeric salen como float8. */
export class PostgresRecetaRepository implements RecetaRepository {
  constructor(private readonly sql: SqlClient) {}

  async obtener(servicioId: string): Promise<ItemRecetaConInsumo[]> {
    const { rows } = await this.sql.query(
      `SELECT si.insumo_id::text AS insumo_id, i.nombre, i.unidad, si.cantidad::float8 AS cantidad,
              si.cantidad_suv::float8 AS cantidad_suv, si.cantidad_pickup::float8 AS cantidad_pickup,
              si.cantidad_moto::float8 AS cantidad_moto, i.stock::float8 AS stock, i.stock_minimo::float8 AS stock_minimo
       FROM buddys.servicio_insumos si
       JOIN buddys.insumos i ON i.id = si.insumo_id
       WHERE si.servicio_id = $1::text
       ORDER BY i.nombre, si.insumo_id`,
      [servicioId],
    );
    return rows.map(toItem);
  }

  async reemplazar(servicioId: string, items: readonly ItemReceta[]): Promise<ItemRecetaConInsumo[]> {
    await this.sql.transaction(async (tx) => {
      const ids = items.map((item) => item.insumoId);
      const { rows } = await tx.query(
        'SELECT count(*)::int AS n FROM buddys.insumos WHERE id = ANY($1::uuid[]) AND activo',
        [ids],
      );
      if (Number(rows[0]?.n ?? 0) !== ids.length) throw new InsumoDeRecetaInvalidoError();
      await tx.query('DELETE FROM buddys.servicio_insumos WHERE servicio_id = $1::text', [servicioId]);
      if (items.length === 0) return;
      await tx.query(
        `INSERT INTO buddys.servicio_insumos (servicio_id, insumo_id, cantidad, cantidad_suv, cantidad_pickup, cantidad_moto)
         SELECT $1::text, r.insumo_id, r.cantidad, r.cantidad_suv, r.cantidad_pickup, r.cantidad_moto
         FROM unnest($2::uuid[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[])
           AS r(insumo_id, cantidad, cantidad_suv, cantidad_pickup, cantidad_moto)`,
        [
          servicioId,
          ids,
          items.map((i) => i.cantidad),
          items.map((i) => i.cantidadSuv),
          items.map((i) => i.cantidadPickup),
          items.map((i) => i.cantidadMoto),
        ],
      );
    });
    return this.obtener(servicioId);
  }
}
