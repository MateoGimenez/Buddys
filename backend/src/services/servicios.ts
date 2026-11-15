import { VEHICULO_NOMBRES, type VehiculoTipo } from '../domain/booking.js';
import {
  type CambiosServicio,
  DestacadoInactivoError,
  type NuevoServicio,
  OrdenInvalidoError,
  type Servicio,
  ServicioExisteError,
  type ServicioRepository,
} from '../domain/servicios.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { UsuarioSesion } from './auth.js';

export interface ServicioServiceDeps {
  servicios: ServicioRepository;
  logger: Logger;
  now: () => Date;
}

const NOT_FOUND_MESSAGE = 'No encontramos ese servicio.';

/** Un servicio de la lista que no existe o está inactivo (mismo texto que un id mal formado). */
export const SERVICIO_NO_DISPONIBLE_MSG = 'Elegí servicios de la lista: alguno ya no está disponible.';

/**
 * Los servicios de un lavado o turno (servicioIds ya validados en formato: 1 a 10, sin repetidos), verificados contra
 * el catálogo: cada uno tiene que existir, estar activo y ofrecerse para el vehículo. Una sola lectura del catálogo
 * (los activos). Si no, 400 VALIDATION_ERROR en fields.servicioIds. Devuelve los servicios en el mismo orden.
 */
export async function serviciosDelLavado(
  servicios: ServicioRepository,
  servicioIds: readonly string[],
  vehiculoTipo: VehiculoTipo,
): Promise<Servicio[]> {
  const activos = new Map((await servicios.list({ soloActivos: true })).map((servicio) => [servicio.id, servicio]));
  return servicioIds.map((id) => {
    const servicio = activos.get(id);
    if (servicio === undefined) throw AppError.validation({ servicioIds: SERVICIO_NO_DISPONIBLE_MSG });
    if (!servicio.vehiculos.includes(vehiculoTipo)) {
      throw AppError.validation({
        servicioIds: `"${servicio.nombre}" no se ofrece para ${VEHICULO_NOMBRES[vehiculoTipo]}. Sacalo de la lista.`,
      });
    }
    return servicio;
  });
}

/** 400 en el campo destacado: no se puede destacar un servicio inactivo. */
const destacadoInactivo = (error: DestacadoInactivoError): AppError =>
  AppError.validation({ destacado: error.message }, error.message);

/**
 * Casos de uso del catálogo editable (contrato: reportes/2026-10-22_07_catalogo-editable.md). Los permisos los
 * exige la ruta (domain/permisos.ts, puedeEditarCatalogo); acá se traducen los errores del dominio a la API y se
 * deja constancia en el log (solo ids, quién y qué campos: nunca los textos).
 */
export class ServicioService {
  constructor(private readonly deps: ServicioServiceDeps) {}

  /** Catálogo completo para el panel (activos e inactivos). */
  list(): Promise<Servicio[]> {
    return this.deps.servicios.list();
  }

  /** Lo que ve la landing: solo los activos. */
  listActivos(): Promise<Servicio[]> {
    return this.deps.servicios.list({ soloActivos: true });
  }

  async create(actor: UsuarioSesion, nuevo: NuevoServicio): Promise<Servicio> {
    let creado: Servicio;
    try {
      creado = await this.deps.servicios.create(nuevo, this.deps.now());
    } catch (error) {
      if (error instanceof ServicioExisteError) throw AppError.servicioExiste();
      if (error instanceof DestacadoInactivoError) throw destacadoInactivo(error);
      throw error;
    }
    this.deps.logger.info(`Servicio creado id=${creado.id} por=${actor.id}`);
    return creado;
  }

  async update(actor: UsuarioSesion, id: string, cambios: CambiosServicio): Promise<Servicio> {
    let actualizado: Servicio | undefined;
    try {
      actualizado = await this.deps.servicios.update(id, cambios, this.deps.now());
    } catch (error) {
      if (error instanceof DestacadoInactivoError) throw destacadoInactivo(error);
      throw error;
    }
    if (actualizado === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Servicio actualizado id=${id} por=${actor.id} campos=${Object.keys(cambios).join(',')}`);
    return actualizado;
  }

  async reorder(actor: UsuarioSesion, ids: readonly string[]): Promise<Servicio[]> {
    let servicios: Servicio[];
    try {
      servicios = await this.deps.servicios.reorder(ids, this.deps.now());
    } catch (error) {
      if (error instanceof OrdenInvalidoError) throw AppError.validation({ ids: error.message }, error.message);
      throw error;
    }
    this.deps.logger.info(`Catálogo reordenado por=${actor.id}`);
    return servicios;
  }
}
