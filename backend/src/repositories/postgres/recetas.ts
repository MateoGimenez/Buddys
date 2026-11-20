import type { SqlClient } from '../../db/postgres.js';
import { type Row, num, oneOf, oneOfOrNull, str } from '../../db/rows.js';
import { VEHICULO_TIPOS } from '../../domain/booking.js';
import { UNIDADES } from '../../domain/inventario.js';
import {
  InsumoDeRecetaInvalidoError,
  type Receta,
  type RecetaRepository,
  type RenglonReceta,
  type VarianteReceta,
} from '../../domain/recetas.js';
import { isUuid } from './uuid.js';

/** Clave del pg_advisory_xact_lock de las recetas (por servicio): dos PUT de la misma variante se hacen de a uno. */
const LOCK_RECETAS = 7340012;

/** Arma las recetas a partir de los renglones (ya ordenados por servicio y nombre de insumo). */
function agrupar(rows: Row[]): Receta[] {
  const recetas = new Map<string, Receta>();
  for (const row of rows) {
    const servicioId = str(row, 'servicio_id');
    let receta = recetas.get(servicioId);
    if (receta === undefined) {
      receta = { servicioId, general: [], porVehiculo: {} };
      recetas.set(servicioId, receta);
    }
    const renglon: RenglonReceta = {
      insumoId: str(row, 'insumo_id'),
      nombre: str(row, 'nombre'),
      unidad: oneOf(UNIDADES, row, 'unidad'),
      cantidad: num(row, 'cantidad'),
    };
    const vehiculo = oneOfOrNull(VEHICULO_TIPOS, row, 'vehiculo');
    if (vehiculo === null) receta.general.push(renglon);
    else (receta.porVehiculo[vehiculo] ??= []).push(renglon);
  }
  return [...recetas.values()];
}

async function leerRecetas(sql: SqlClient, servicioId: string | null): Promise<Receta[]> {
  // Solo los renglones de insumos activos: los inactivos no se descuentan (regla 1) y, al guardar la variante, se van.
  const { rows } = await sql.query(
    `SELECT r.servicio_id, r.vehiculo, r.insumo_id::text AS insumo_id, i.nombre, i.unidad, r.cantidad::float8 AS cantidad
     FROM buddys.recetas r
     JOIN buddys.insumos i ON i.id = r.insumo_id AND i.activo
     JOIN buddys.servicios s ON s.id = r.servicio_id
     WHERE $1::text IS NULL OR r.servicio_id = $1::text
     ORDER BY s.orden, s.id, buddys.texto_busqueda(i.nombre), i.id`,
    [servicioId],
  );
  return agrupar(rows);
}

/** Recetas sobre Postgres (migración recetas_stock). Reemplazar una variante es borrar e insertar en una transacción. */
export class PostgresRecetaRepository implements RecetaRepository {
  constructor(private readonly sql: SqlClient) {}

  listar(): Promise<Receta[]> {
    return leerRecetas(this.sql, null);
  }

  async delServicio(servicioId: string): Promise<Receta> {
    const [receta] = await leerRecetas(this.sql, servicioId);
    return receta ?? { servicioId, general: [], porVehiculo: {} };
  }

  reemplazar(servicioId: string, variante: VarianteReceta): Promise<Receta> {
    return this.sql.transaction(async (tx) => {
      await tx.query('SELECT pg_catalog.pg_advisory_xact_lock($1::int, pg_catalog.hashtext($2::text))', [LOCK_RECETAS, servicioId]);
      // Cada insumo tiene que existir y estar activo (FOR SHARE: nadie lo desactiva entre la verificación y el INSERT).
      const ids = variante.items.map((item) => item.insumoId.toLowerCase());
      const validos = ids.filter(isUuid);
      const activos = await tx.query(
        'SELECT id::text AS id FROM buddys.insumos WHERE id = ANY($1::uuid[]) AND activo FOR SHARE',
        [validos],
      );
      const existentes = new Set(activos.rows.map((row) => str(row, 'id')));
      const indice = ids.findIndex((id) => !existentes.has(id));
      if (indice !== -1) throw new InsumoDeRecetaInvalidoError(indice);

      await tx.query(
        'DELETE FROM buddys.recetas WHERE servicio_id = $1::text AND vehiculo IS NOT DISTINCT FROM $2::text',
        [servicioId, variante.vehiculo],
      );
      if (ids.length > 0) {
        await tx.query(
          `INSERT INTO buddys.recetas (servicio_id, vehiculo, insumo_id, cantidad)
           SELECT $1::text, $2::text, n.insumo_id, n.cantidad
           FROM unnest($3::uuid[], $4::numeric[]) AS n(insumo_id, cantidad)`,
          [servicioId, variante.vehiculo, ids, variante.items.map((item) => item.cantidad)],
        );
      }
      const [receta] = await leerRecetas(tx, servicioId);
      return receta ?? { servicioId, general: [], porVehiculo: {} };
    });
  }
}
