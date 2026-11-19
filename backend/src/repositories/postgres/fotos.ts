import type { SqlClient } from '../../db/postgres.js';
import { type Row, int, isoTimestamp, oneOf, str, strOrNull } from '../../db/rows.js';
import {
  CONTENT_TYPES_FOTO,
  ESTADOS_FOTO,
  type Foto,
  type FotoRepository,
  MAX_FOTOS_POR_TURNO,
  MaximoFotosError,
  type NuevaFoto,
  TIPOS_FOTO,
} from '../../domain/fotos.js';
import { isUuid } from './uuid.js';

/** Clave 1 del advisory lock de las altas de fotos de un turno (7340001 a 7340012 ya están en uso). */
const LOCK_FOTOS = 7340013;

function toFoto(row: Row): Foto {
  const creadaPorId = strOrNull(row, 'creado_por');
  return {
    id: str(row, 'id'),
    bookingId: str(row, 'booking_id'),
    tipo: oneOf(TIPOS_FOTO, row, 'tipo'),
    path: str(row, 'path'),
    contentType: oneOf(CONTENT_TYPES_FOTO, row, 'content_type'),
    tamano: int(row, 'tamano'),
    estado: oneOf(ESTADOS_FOTO, row, 'estado'),
    creadaPor: creadaPorId === null ? null : { id: creadaPorId, nombre: str(row, 'creado_por_nombre') },
    createdAt: isoTimestamp(row, 'created_at'),
    subidaVence: isoTimestamp(row, 'subida_vence_at'),
  };
}

/**
 * Fotos sobre Postgres (tablas lavado_fotos y fotos_a_borrar; los archivos están en Supabase Storage). Las columnas
 * se repiten literalmente en cada consulta (la regla de ESLint exige SQL literal).
 */
export class PostgresFotoRepository implements FotoRepository {
  constructor(private readonly sql: SqlClient) {}

  async listar(bookingId: string, soloListas: boolean): Promise<Foto[]> {
    if (!isUuid(bookingId)) return [];
    const { rows } = await this.sql.query(
      `SELECT f.id::text AS id, f.booking_id::text AS booking_id, f.tipo, f.path, f.content_type, f.tamano, f.estado,
              f.creado_por::text AS creado_por, coalesce(nullif(btrim(p.nombre), ''), p.email, 'Sin nombre') AS creado_por_nombre,
              f.created_at, f.subida_vence_at
       FROM buddys.lavado_fotos f
       LEFT JOIN buddys.perfiles p ON p.id = f.creado_por
       WHERE f.booking_id = $1::uuid AND (NOT $2::boolean OR f.estado = 'lista')
       ORDER BY f.created_at, f.id`,
      [bookingId, soloListas],
    );
    return rows.map(toFoto);
  }

  crear(nueva: NuevaFoto): Promise<Foto> {
    return this.sql.transaction(async (tx) => {
      // Dos pedidos simultáneos al mismo turno se hacen de a uno: el máximo no se pasa.
      await tx.query('SELECT pg_catalog.pg_advisory_xact_lock($1::int, pg_catalog.hashtext($2::text))', [
        LOCK_FOTOS,
        nueva.bookingId,
      ]);
      const cuenta = await tx.query('SELECT count(*)::int AS n FROM buddys.lavado_fotos WHERE booking_id = $1::uuid', [
        nueva.bookingId,
      ]);
      const fila = cuenta.rows[0];
      if (fila !== undefined && int(fila, 'n') >= MAX_FOTOS_POR_TURNO) throw new MaximoFotosError();
      await tx.query(
        `INSERT INTO buddys.lavado_fotos (id, booking_id, tipo, path, content_type, tamano, creado_por, created_at, subida_vence_at)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::int, $7::uuid, $8::timestamptz, $9::timestamptz)`,
        [
          nueva.id,
          nueva.bookingId,
          nueva.tipo,
          nueva.path,
          nueva.contentType,
          nueva.tamano,
          nueva.creadaPor,
          nueva.createdAt.toISOString(),
          nueva.subidaVence.toISOString(),
        ],
      );
      const creada = await buscar(tx, nueva.id);
      if (creada === undefined) throw new Error('La foto no se encontró después de crearla');
      return creada;
    });
  }

  obtener(id: string): Promise<Foto | undefined> {
    if (!isUuid(id)) return Promise.resolve(undefined);
    return buscar(this.sql, id);
  }

  async confirmar(id: string): Promise<Foto | undefined> {
    if (!isUuid(id)) return undefined;
    const { rowCount } = await this.sql.query("UPDATE buddys.lavado_fotos SET estado = 'lista' WHERE id = $1::uuid", [id]);
    return rowCount === 0 ? undefined : buscar(this.sql, id);
  }

  async borrar(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rowCount } = await this.sql.query('DELETE FROM buddys.lavado_fotos WHERE id = $1::uuid', [id]);
    return rowCount > 0;
  }

  async borrarPendientesVencidas(now: Date): Promise<number> {
    // Mismo predicado que el índice parcial lavado_fotos_pendientes_idx. El trigger anota cada objeto para borrar.
    const { rowCount } = await this.sql.query(
      "DELETE FROM buddys.lavado_fotos WHERE estado = 'pendiente' AND subida_vence_at <= $1::timestamptz",
      [now.toISOString()],
    );
    return rowCount;
  }

  async aBorrarVencidos(now: Date, limite: number): Promise<string[]> {
    const { rows } = await this.sql.query(
      `SELECT path FROM buddys.fotos_a_borrar WHERE borrar_desde <= $1::timestamptz ORDER BY borrar_desde, path LIMIT $2::int`,
      [now.toISOString(), limite],
    );
    return rows.map((row) => str(row, 'path'));
  }

  async quitarDeABorrar(rutas: readonly string[]): Promise<void> {
    if (rutas.length === 0) return;
    await this.sql.query('DELETE FROM buddys.fotos_a_borrar WHERE path = ANY($1::text[])', [rutas]);
  }

  async rutasConocidas(rutas: readonly string[]): Promise<Set<string>> {
    if (rutas.length === 0) return new Set();
    const { rows } = await this.sql.query(
      `SELECT path FROM buddys.lavado_fotos WHERE path = ANY($1::text[])
       UNION
       SELECT path FROM buddys.fotos_a_borrar WHERE path = ANY($1::text[])`,
      [rutas],
    );
    return new Set(rows.map((row) => str(row, 'path')));
  }
}

/** Una foto por id (ya validado), con el cliente que se le pase: sirve dentro de una transacción. */
async function buscar(sql: SqlClient, id: string): Promise<Foto | undefined> {
  const { rows } = await sql.query(
    `SELECT f.id::text AS id, f.booking_id::text AS booking_id, f.tipo, f.path, f.content_type, f.tamano, f.estado,
            f.creado_por::text AS creado_por, coalesce(nullif(btrim(p.nombre), ''), p.email, 'Sin nombre') AS creado_por_nombre,
            f.created_at, f.subida_vence_at
     FROM buddys.lavado_fotos f
     LEFT JOIN buddys.perfiles p ON p.id = f.creado_por
     WHERE f.id = $1::uuid`,
    [id],
  );
  const row = rows[0];
  return row ? toFoto(row) : undefined;
}
