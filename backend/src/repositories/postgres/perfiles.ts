import type { SqlClient } from '../../db/postgres.js';
import { type Row, bool, int, isoTimestamp, isoTimestampOrNull, oneOf, str, strOrNull } from '../../db/rows.js';
import {
  type CambiosPerfil,
  NOMBRE_MAX,
  type Perfil,
  type PerfilConHistorial,
  type PerfilRepository,
  type RolInfo,
  type PersonaActiva,
  ROLES,
  type Rol,
  SESION_MAX_SEGUNDOS,
  SinSuperadminError,
} from '../../domain/perfil.js';
import { isUuid } from './uuid.js';

/** SQLSTATE propio del trigger buddys_private.impedir_sin_superadmin (migración superadmin_trigger_definer). */
const SIN_SUPERADMIN_SQLSTATE = 'MG001';

function toPerfil(row: Row): Perfil {
  return {
    id: str(row, 'id'),
    email: strOrNull(row, 'email'),
    nombre: strOrNull(row, 'nombre'),
    rol: oneOf(ROLES, row, 'rol_id'),
    activo: bool(row, 'activo'),
    eliminadoAt: isoTimestampOrNull(row, 'eliminado_at'),
    fotoVersion: isoTimestampOrNull(row, 'foto_actualizada_at'),
    createdAt: isoTimestamp(row, 'created_at'),
    updatedAt: isoTimestamp(row, 'updated_at'),
  };
}

const hasSqlState = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;

/**
 * Perfiles del panel sobre Postgres (esquema buddys). buddys_app solo puede leerlos y actualizar rol_id, activo,
 * nombre, eliminado_at, foto_actualizada_at y updated_at: los crea el trigger de auth.users y se borran en cascada con
 * el usuario (si no tienen historial: las FK que apuntan acá son ON DELETE RESTRICT).
 */
export class PostgresPerfilRepository implements PerfilRepository {
  constructor(private readonly sql: SqlClient) {}

  async findForSession(
    userId: string,
    sessionId: string,
  ): Promise<{ perfil: Perfil; sesionVigente: boolean } | undefined> {
    if (!isUuid(userId) || !isUuid(sessionId)) return undefined;
    const { rows } = await this.sql.query(
      `SELECT p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
              p.created_at, p.updated_at,
              buddys_private.sesion_vigente($2::uuid, p.id, $3::integer) AS sesion_vigente
       FROM buddys.perfiles AS p
       WHERE p.id = $1::uuid`,
      [userId, sessionId, SESION_MAX_SEGUNDOS],
    );
    const row = rows[0];
    return row ? { perfil: toPerfil(row), sesionVigente: bool(row, 'sesion_vigente') } : undefined;
  }

  /**
   * Historial = aparece en algún turno o lavado (quién lo hizo o quién lo registró), gasto, movimiento de stock,
   * presupuesto o comprobante: las FK ON DELETE RESTRICT de la migración usuarios_baja. Una sola consulta para todo el
   * listado; cada EXISTS usa el índice parcial de su columna y corta en la primera fila. La misma condición está en
   * tieneHistorial (el SQL va siempre literal).
   */
  async list(): Promise<PerfilConHistorial[]> {
    const { rows } = await this.sql.query(
      `SELECT p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
              p.created_at, p.updated_at,
              (EXISTS (SELECT 1 FROM buddys.bookings AS b WHERE b.trabajador_id = p.id)
               OR EXISTS (SELECT 1 FROM buddys.bookings AS b WHERE b.registrado_por = p.id)
               OR EXISTS (SELECT 1 FROM buddys.gastos AS g WHERE g.creado_por = p.id)
               OR EXISTS (SELECT 1 FROM buddys.movimientos_stock AS m WHERE m.perfil_id = p.id)
               OR EXISTS (SELECT 1 FROM buddys.presupuestos AS pr WHERE pr.creado_por = p.id)
               OR EXISTS (SELECT 1 FROM buddys.comprobantes AS c WHERE c.creado_por = p.id)) AS tiene_historial
       FROM buddys.perfiles AS p
       ORDER BY p.created_at, p.id`,
    );
    return rows.map((row) => ({ ...toPerfil(row), tieneHistorial: bool(row, 'tiene_historial') }));
  }

  async tieneHistorial(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rows } = await this.sql.query(
      `SELECT (EXISTS (SELECT 1 FROM buddys.bookings AS b WHERE b.trabajador_id = p.id)
               OR EXISTS (SELECT 1 FROM buddys.bookings AS b WHERE b.registrado_por = p.id)
               OR EXISTS (SELECT 1 FROM buddys.gastos AS g WHERE g.creado_por = p.id)
               OR EXISTS (SELECT 1 FROM buddys.movimientos_stock AS m WHERE m.perfil_id = p.id)
               OR EXISTS (SELECT 1 FROM buddys.presupuestos AS pr WHERE pr.creado_por = p.id)
               OR EXISTS (SELECT 1 FROM buddys.comprobantes AS c WHERE c.creado_por = p.id)) AS tiene_historial
       FROM buddys.perfiles AS p
       WHERE p.id = $1::uuid`,
      [id],
    );
    const row = rows[0];
    return row ? bool(row, 'tiene_historial') : false;
  }

  async trabajadores(): Promise<PersonaActiva[]> {
    const { rows } = await this.sql.query(
      // Sin nombre: la parte del email antes de la @, nunca el email entero (el empleado ve esta lista).
      `SELECT id::text AS id, nombre_visible AS nombre, rol_id
       FROM (
         SELECT id, rol_id,
                coalesce(nullif(btrim(nombre), ''), nullif(btrim(left(split_part(email, '@', 1), $1::integer)), ''),
                         'Sin nombre') AS nombre_visible
         FROM buddys.perfiles
         WHERE activo
       ) AS p
       ORDER BY lower(nombre_visible), id`,
      [NOMBRE_MAX],
    );
    return rows.map((row) => ({ id: str(row, 'id'), nombre: str(row, 'nombre'), rol: oneOf(ROLES, row, 'rol_id') }));
  }

  async roles(): Promise<RolInfo[]> {
    const { rows } = await this.sql.query('SELECT id, nombre, descripcion FROM buddys.roles');
    const roles = rows.map((row) => ({
      id: oneOf(ROLES, row, 'id'),
      nombre: str(row, 'nombre'),
      descripcion: str(row, 'descripcion'),
    }));
    return roles.sort((a, b) => ROLES.indexOf(a.id) - ROLES.indexOf(b.id));
  }

  async findById(id: string): Promise<Perfil | undefined> {
    if (!isUuid(id)) return undefined;
    const { rows } = await this.sql.query(
      `SELECT p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
              p.created_at, p.updated_at
       FROM buddys.perfiles AS p
       WHERE p.id = $1::uuid`,
      [id],
    );
    const row = rows[0];
    return row ? toPerfil(row) : undefined;
  }

  async update(
    id: string,
    cambios: CambiosPerfil,
    now: Date,
    rolesGestionables: readonly Rol[],
  ): Promise<Perfil | undefined> {
    if (!isUuid(id)) return undefined;
    try {
      const { rows } = await this.sql.query(
        `UPDATE buddys.perfiles AS p
         SET rol_id = coalesce($2::text, rol_id),
             activo = coalesce($3::boolean, activo),
             nombre = CASE WHEN $4::boolean THEN $5::text ELSE nombre END,
             updated_at = $6::timestamptz
         WHERE p.id = $1::uuid AND p.eliminado_at IS NULL AND p.rol_id = ANY($7::text[])
         RETURNING p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
              p.created_at, p.updated_at`,
        [
          id,
          cambios.rol ?? null,
          cambios.activo ?? null,
          cambios.nombre !== undefined,
          cambios.nombre ?? null,
          now.toISOString(),
          [...rolesGestionables],
        ],
      );
      const row = rows[0];
      return row ? toPerfil(row) : undefined;
    } catch (error) {
      if (hasSqlState(error, SIN_SUPERADMIN_SQLSTATE)) throw new SinSuperadminError();
      throw error;
    }
  }

  async darDeBaja(
    id: string,
    now: Date,
    rolesGestionables: readonly Rol[],
  ): Promise<{ perfil: Perfil; nombreAnterior: string | null } | undefined> {
    if (!isUuid(id)) return undefined;
    try {
      return await this.sql.transaction(async (tx) => {
        // FOR UPDATE: el nombre anterior que se devuelve es el que se pisa y el rol no cambia hasta el COMMIT (nadie
        // lo asciende a admin entre que el servicio lo leyó y la baja).
        const { rows: actuales } = await tx.query(
          `SELECT p.nombre FROM buddys.perfiles AS p
           WHERE p.id = $1::uuid AND p.eliminado_at IS NULL AND p.rol_id = ANY($2::text[])
           FOR UPDATE`,
          [id, [...rolesGestionables]],
        );
        const actual = actuales[0];
        if (actual === undefined) return undefined;
        const { rows } = await tx.query(
          `UPDATE buddys.perfiles AS p
           SET activo = false,
               eliminado_at = $2::timestamptz,
               nombre = coalesce(p.nombre, nullif(btrim(left(split_part(p.email, '@', 1), $3::integer)), ''),
                                 'Usuario dado de baja'),
               updated_at = $2::timestamptz
           WHERE p.id = $1::uuid
           RETURNING p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
              p.created_at, p.updated_at`,
          [id, now.toISOString(), NOMBRE_MAX],
        );
        const row = rows[0];
        if (row === undefined) return undefined;
        // Refuerzo: aunque el middleware ya lo frena por `activo`, se borran sus sesiones de Supabase Auth.
        await tx.query('SELECT buddys_private.cerrar_sesiones($1::uuid)', [id]);
        return { perfil: toPerfil(row), nombreAnterior: strOrNull(actual, 'nombre') };
      });
    } catch (error) {
      if (hasSqlState(error, SIN_SUPERADMIN_SQLSTATE)) throw new SinSuperadminError();
      throw error;
    }
  }

  async cerrarSesiones(id: string): Promise<number> {
    if (!isUuid(id)) return 0;
    const { rows } = await this.sql.query('SELECT buddys_private.cerrar_sesiones($1::uuid) AS cerradas', [id]);
    const row = rows[0];
    return row ? int(row, 'cerradas') : 0;
  }

  async cerrarOtrasSesiones(id: string, sesionActual: string): Promise<number> {
    if (!isUuid(id) || !isUuid(sesionActual)) return 0;
    const { rows } = await this.sql.query(
      'SELECT buddys_private.cerrar_otras_sesiones($1::uuid, $2::uuid) AS cerradas',
      [id, sesionActual],
    );
    const row = rows[0];
    return row ? int(row, 'cerradas') : 0;
  }

  async revertirBaja(id: string, nombreAnterior: string | null, now: Date): Promise<Perfil | undefined> {
    if (!isUuid(id)) return undefined;
    const { rows } = await this.sql.query(
      `UPDATE buddys.perfiles AS p
       SET eliminado_at = null, nombre = $2::text, activo = false, updated_at = $3::timestamptz
       WHERE p.id = $1::uuid
       RETURNING p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
              p.created_at, p.updated_at`,
      [id, nombreAnterior, now.toISOString()],
    );
    const row = rows[0];
    return row ? toPerfil(row) : undefined;
  }

  async setFoto(id: string, version: Date | null): Promise<Perfil | undefined> {
    if (!isUuid(id)) return undefined;
    const { rows } = await this.sql.query(
      `UPDATE buddys.perfiles AS p
       SET foto_actualizada_at = $2::timestamptz
       WHERE p.id = $1::uuid
       RETURNING p.id::text AS id, p.email, p.nombre, p.rol_id, p.activo, p.eliminado_at, p.foto_actualizada_at,
                 p.created_at, p.updated_at`,
      [id, version?.toISOString() ?? null],
    );
    const row = rows[0];
    return row ? toPerfil(row) : undefined;
  }
}
