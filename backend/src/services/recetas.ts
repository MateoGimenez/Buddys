import { InsumoDeRecetaInvalidoError, type Receta, type RecetaRepository, type VarianteReceta } from '../domain/recetas.js';
import type { ServicioRepository } from '../domain/servicios.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { UsuarioSesion } from './auth.js';

export interface RecetaServiceDeps {
  recetas: RecetaRepository;
  servicios: ServicioRepository;
  logger: Logger;
}

export const SERVICIO_NOT_FOUND = 'No encontramos ese servicio.';
export const INSUMO_DE_RECETA_INVALIDO = 'Ese insumo no existe o está inactivo.';

/**
 * Recetas de los servicios (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md). Los permisos los exige la ruta
 * (domain/permisos.ts: verlas con inventario.ver, definirlas con inventario.recetas). En el log: quién, qué servicio y
 * qué variante; nunca cantidades.
 */
export class RecetaService {
  constructor(private readonly deps: RecetaServiceDeps) {}

  listar(): Promise<Receta[]> {
    return this.deps.recetas.listar();
  }

  /**
   * Reemplaza una variante (la general o la de un vehículo) y devuelve la receta entera del servicio. 404 si el
   * servicio no existe; 400 en fields.vehiculo si el servicio no se ofrece para ese vehículo y en
   * fields["items.N.insumoId"] si ese insumo no existe o está inactivo.
   */
  async reemplazar(actor: UsuarioSesion, servicioId: string, variante: VarianteReceta): Promise<Receta> {
    const servicio = await this.deps.servicios.findById(servicioId);
    if (servicio === undefined) throw AppError.notFound(SERVICIO_NOT_FOUND);
    if (variante.vehiculo !== null && !servicio.vehiculos.includes(variante.vehiculo)) {
      throw AppError.validation({ vehiculo: 'Ese servicio no se ofrece para ese vehículo.' });
    }
    try {
      const receta = await this.deps.recetas.reemplazar(servicio.id, variante);
      this.deps.logger.info(
        `Receta guardada servicio=${servicio.id} vehiculo=${variante.vehiculo ?? 'general'} renglones=${String(variante.items.length)} por=${actor.id}`,
      );
      return receta;
    } catch (error) {
      if (error instanceof InsumoDeRecetaInvalidoError) {
        throw AppError.validation({ [`items.${String(error.indice)}.insumoId`]: INSUMO_DE_RECETA_INVALIDO });
      }
      throw error;
    }
  }
}
