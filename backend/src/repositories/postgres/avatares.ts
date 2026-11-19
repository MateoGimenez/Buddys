import type { SqlClient } from '../../db/postgres.js';
import { isoTimestampOrNull, str, strOrNull } from '../../db/rows.js';
import type { AvatarDePerfil, AvatarRepository } from '../../domain/avatar.js';
import { isUuid } from './uuid.js';

/**
 * Fotos de perfil sobre Postgres (columnas avatar_* de buddys.perfiles y la tabla avatares_a_borrar; los archivos
 * están en Supabase Storage). Lo que deja de usarse lo anota el trigger perfiles_avatar_a_borrar: acá nunca se
 * inserta en avatares_a_borrar. Las columnas se repiten literalmente en cada consulta (la regla de ESLint exige SQL
 * literal).
 */
export class PostgresAvatarRepository implements AvatarRepository {
  constructor(private readonly sql: SqlClient) {}

  async obtener(perfilId: string): Promise<AvatarDePerfil | undefined> {
    if (!isUuid(perfilId)) return undefined;
    const { rows } = await this.sql.query(
      `SELECT avatar_path, avatar_pendiente_path, avatar_subida_vence_at
       FROM buddys.perfiles WHERE id = $1::uuid`,
      [perfilId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      avatarPath: strOrNull(row, 'avatar_path'),
      pendientePath: strOrNull(row, 'avatar_pendiente_path'),
      subidaVence: isoTimestampOrNull(row, 'avatar_subida_vence_at'),
    };
  }

  async vigentes(perfilIds: readonly string[]): Promise<Map<string, string>> {
    const ids = perfilIds.filter(isUuid);
    if (ids.length === 0) return new Map();
    const { rows } = await this.sql.query(
      `SELECT id::text AS id, avatar_path FROM buddys.perfiles
       WHERE id = ANY($1::uuid[]) AND avatar_path IS NOT NULL`,
      [ids],
    );
    return new Map(rows.map((row) => [str(row, 'id'), str(row, 'avatar_path')]));
  }

  async pedirSubida(perfilId: string, path: string, vence: Date): Promise<boolean> {
    if (!isUuid(perfilId)) return false;
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.perfiles SET avatar_pendiente_path = $2::text, avatar_subida_vence_at = $3::timestamptz
       WHERE id = $1::uuid`,
      [perfilId, path, vence.toISOString()],
    );
    return rowCount > 0;
  }

  confirmar(perfilId: string, path: string): Promise<{ anterior: string | null } | undefined> {
    if (!isUuid(perfilId)) return Promise.resolve(undefined);
    return this.sql.transaction(async (tx) => {
      // FOR UPDATE: dos confirmaciones simultáneas no se pisan (la segunda ve que ya no hay pendiente).
      const actual = await tx.query(
        `SELECT avatar_path FROM buddys.perfiles
         WHERE id = $1::uuid AND avatar_pendiente_path = $2::text FOR UPDATE`,
        [perfilId, path],
      );
      const row = actual.rows[0];
      if (row === undefined) return undefined;
      await tx.query(
        `UPDATE buddys.perfiles SET avatar_path = avatar_pendiente_path, avatar_pendiente_path = NULL
         WHERE id = $1::uuid`,
        [perfilId],
      );
      return { anterior: strOrNull(row, 'avatar_path') };
    });
  }

  async descartarPendiente(perfilId: string, path: string): Promise<void> {
    if (!isUuid(perfilId)) return;
    await this.sql.query(
      'UPDATE buddys.perfiles SET avatar_pendiente_path = NULL WHERE id = $1::uuid AND avatar_pendiente_path = $2::text',
      [perfilId, path],
    );
  }

  async quitar(perfilId: string): Promise<string[]> {
    if (!isUuid(perfilId)) return [];
    return this.sql.transaction(async (tx) => {
      const { rows } = await tx.query(
        'SELECT avatar_path, avatar_pendiente_path FROM buddys.perfiles WHERE id = $1::uuid FOR UPDATE',
        [perfilId],
      );
      const row = rows[0];
      if (row === undefined) return [];
      const rutas = [strOrNull(row, 'avatar_path'), strOrNull(row, 'avatar_pendiente_path')].filter(
        (ruta): ruta is string => ruta !== null,
      );
      if (rutas.length > 0) {
        await tx.query(
          'UPDATE buddys.perfiles SET avatar_path = NULL, avatar_pendiente_path = NULL WHERE id = $1::uuid',
          [perfilId],
        );
      }
      return rutas;
    });
  }

  async descartarPendientesVencidas(now: Date): Promise<number> {
    // Mismo predicado que el índice parcial perfiles_avatar_pendiente_idx.
    const { rowCount } = await this.sql.query(
      `UPDATE buddys.perfiles SET avatar_pendiente_path = NULL
       WHERE avatar_pendiente_path IS NOT NULL AND avatar_subida_vence_at <= $1::timestamptz`,
      [now.toISOString()],
    );
    return rowCount;
  }

  async aBorrarVencidos(now: Date, limite: number): Promise<string[]> {
    const { rows } = await this.sql.query(
      `SELECT path FROM buddys.avatares_a_borrar WHERE borrar_desde <= $1::timestamptz ORDER BY borrar_desde, path LIMIT $2::int`,
      [now.toISOString(), limite],
    );
    return rows.map((row) => str(row, 'path'));
  }

  async quitarDeABorrar(rutas: readonly string[]): Promise<void> {
    if (rutas.length === 0) return;
    await this.sql.query('DELETE FROM buddys.avatares_a_borrar WHERE path = ANY($1::text[])', [rutas]);
  }

  async rutasConocidas(rutas: readonly string[]): Promise<Set<string>> {
    if (rutas.length === 0) return new Set();
    const { rows } = await this.sql.query(
      `SELECT avatar_path AS path FROM buddys.perfiles WHERE avatar_path = ANY($1::text[])
       UNION
       SELECT avatar_pendiente_path FROM buddys.perfiles WHERE avatar_pendiente_path = ANY($1::text[])
       UNION
       SELECT path FROM buddys.avatares_a_borrar WHERE path = ANY($1::text[])`,
      [rutas],
    );
    return new Set(rows.map((row) => str(row, 'path')));
  }
}
