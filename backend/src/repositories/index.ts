import type { SqlClient } from '../db/postgres.js';
import type { BookingRepository } from '../domain/booking.js';
import type { ComprobanteRepository } from '../domain/comprobantes.js';
import type { DisponibilidadRepository } from '../domain/disponibilidad.js';
import type { EstadisticasRepository } from '../domain/estadisticas.js';
import type { GastoRepository } from '../domain/gastos.js';
import type { InventarioRepository } from '../domain/inventario.js';
import type { MetaRepository } from '../domain/metas.js';
import type { PerfilRepository } from '../domain/perfil.js';
import type { PresupuestoRepository } from '../domain/presupuestos.js';
import type { PushRepository } from '../domain/push.js';
import type { ServicioRepository } from '../domain/servicios.js';
import type { TallerRepository } from '../domain/taller.js';
import type { CajaRepository } from '../domain/caja.js';
import type { ClienteRepository } from '../domain/clientes.js';
import type { ExportRepository } from '../domain/exportar.js';
import type { FotoRepository } from '../domain/fotos.js';
import type { AvatarRepository } from '../domain/avatar.js';
import { PostgresAvatarRepository } from './postgres/avatares.js';
import type { GastoFijoRepository } from '../domain/gastos-fijos.js';
import type { RecetaRepository } from '../domain/recetas.js';
import { PostgresCajaRepository } from './postgres/caja.js';
import { PostgresClienteRepository } from './postgres/clientes.js';
import { PostgresExportRepository } from './postgres/exportar.js';
import { PostgresFotoRepository } from './postgres/fotos.js';
import { PostgresGastoFijoRepository } from './postgres/gastos-fijos.js';
import { PostgresRecetaRepository } from './postgres/recetas.js';
import { PostgresBookingRepository } from './postgres/bookings.js';
import { PostgresComprobanteRepository } from './postgres/comprobantes.js';
import { PostgresDisponibilidadRepository } from './postgres/disponibilidad.js';
import { PostgresEstadisticasRepository } from './postgres/estadisticas.js';
import { PostgresGastoRepository } from './postgres/gastos.js';
import { PostgresInventarioRepository } from './postgres/inventario.js';
import { PostgresMetaRepository } from './postgres/metas.js';
import { PostgresPerfilRepository } from './postgres/perfiles.js';
import { PostgresPresupuestoRepository } from './postgres/presupuestos.js';
import { PostgresPushRepository } from './postgres/push.js';
import { PostgresServicioRepository } from './postgres/servicios.js';
import { PostgresTallerRepository } from './postgres/taller.js';

export interface Repositories {
  bookings: BookingRepository;
  perfiles: PerfilRepository;
  servicios: ServicioRepository;
  disponibilidad: DisponibilidadRepository;
  push: PushRepository;
  estadisticas: EstadisticasRepository;
  gastos: GastoRepository;
  metas: MetaRepository;
  taller: TallerRepository;
  inventario: InventarioRepository;
  presupuestos: PresupuestoRepository;
  comprobantes: ComprobanteRepository;
  clientes: ClienteRepository;
  fotos: FotoRepository;
  avatares: AvatarRepository;
  gastosFijos: GastoFijoRepository;
  caja: CajaRepository;
  recetas: RecetaRepository;
  exportar: ExportRepository;
}

/** Los repositorios sobre Postgres (esquema buddys ya migrado; ver supabase/migrations/). */
export function createPostgresRepositories(sql: SqlClient): Repositories {
  return {
    bookings: new PostgresBookingRepository(sql),
    perfiles: new PostgresPerfilRepository(sql),
    servicios: new PostgresServicioRepository(sql),
    disponibilidad: new PostgresDisponibilidadRepository(sql),
    push: new PostgresPushRepository(sql),
    estadisticas: new PostgresEstadisticasRepository(sql),
    gastos: new PostgresGastoRepository(sql),
    metas: new PostgresMetaRepository(sql),
    taller: new PostgresTallerRepository(sql),
    inventario: new PostgresInventarioRepository(sql),
    presupuestos: new PostgresPresupuestoRepository(sql),
    comprobantes: new PostgresComprobanteRepository(sql),
    clientes: new PostgresClienteRepository(sql),
    fotos: new PostgresFotoRepository(sql),
    avatares: new PostgresAvatarRepository(sql),
    gastosFijos: new PostgresGastoFijoRepository(sql),
    caja: new PostgresCajaRepository(sql),
    recetas: new PostgresRecetaRepository(sql),
    exportar: new PostgresExportRepository(sql),
  };
}
