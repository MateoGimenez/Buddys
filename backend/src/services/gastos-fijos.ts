import type { CategoriaGasto } from '../domain/gastos.js';
import {
  type CambiosGastoFijo,
  type GastoFijo,
  type GastoFijoRepository,
  estaActivo,
  vigenteEn,
} from '../domain/gastos-fijos.js';
import type { PerfilRepository } from '../domain/perfil.js';
import { todayInLaRioja } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { UsuarioSesion } from './auth.js';

export const GASTO_FIJO_NOT_FOUND = 'No encontramos ese gasto fijo.';
const PERFIL_INVALIDO = 'Elegí una persona del panel.';
const HASTA_ANTES_MSG = '"hasta" no puede ser anterior a "desde".';
const FUTURO_MSG = 'Este gasto todavía no empezó: borralo en vez de desactivarlo.';

export interface GastoFijoServiceDeps {
  gastosFijos: GastoFijoRepository;
  perfiles: PerfilRepository;
  logger: Logger;
  now: () => Date;
}

/** Un gasto fijo tal como sale por la API: con `activo` calculado para el mes actual. */
export interface GastoFijoJson extends Omit<GastoFijo, 'createdAt' | 'updatedAt'> {
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que pide el PATCH ya validado en su formato. */
export interface PedidoCambiosGastoFijo {
  concepto?: string | undefined;
  monto?: number | undefined;
  categoria?: CategoriaGasto | undefined;
  perfilId?: string | null | undefined;
  activo?: boolean | undefined;
  desde?: string | undefined;
  hasta?: string | null | undefined;
}

/**
 * Gastos fijos (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 10). Verlos: admin y superadmin;
 * cargarlos, cambiarlos y borrarlos: el superadmin (lo exige la ruta, domain/permisos.ts). En el log: id y quién;
 * nunca el concepto ni el monto.
 */
export class GastoFijoService {
  constructor(private readonly deps: GastoFijoServiceDeps) {}

  private mesActual(): string {
    return todayInLaRioja(this.deps.now()).slice(0, 7);
  }

  private json(gasto: GastoFijo): GastoFijoJson {
    return {
      id: gasto.id,
      concepto: gasto.concepto,
      monto: gasto.monto,
      categoria: gasto.categoria,
      perfil: gasto.perfil,
      activo: estaActivo(gasto, this.mesActual()),
      desde: gasto.desde,
      hasta: gasto.hasta,
      createdAt: gasto.createdAt,
      updatedAt: gasto.updatedAt,
    };
  }

  private async verificarPerfil(perfilId: string | null | undefined): Promise<void> {
    if (perfilId === null || perfilId === undefined) return;
    if ((await this.deps.perfiles.findById(perfilId)) === undefined) throw AppError.validation({ perfilId: PERFIL_INVALIDO });
  }

  /** Todos, con el total de los que cuentan este mes. */
  async listar(): Promise<{ gastosFijos: GastoFijoJson[]; totalMensual: number }> {
    const mes = this.mesActual();
    const lista = await this.deps.gastosFijos.listar();
    return {
      gastosFijos: lista.map((g) => this.json(g)),
      totalMensual: lista.filter((g) => vigenteEn(g, mes)).reduce((suma, g) => suma + g.monto, 0),
    };
  }

  async crear(
    actor: UsuarioSesion,
    datos: { concepto: string; monto: number; categoria: CategoriaGasto; perfilId: string | null; desde?: string | undefined },
  ): Promise<GastoFijoJson> {
    await this.verificarPerfil(datos.perfilId);
    const gasto = await this.deps.gastosFijos.crear({
      concepto: datos.concepto,
      monto: datos.monto,
      categoria: datos.categoria,
      perfilId: datos.perfilId,
      desde: datos.desde ?? this.mesActual(),
      creadoPor: actor.id,
    });
    this.deps.logger.info(`Gasto fijo creado id=${gasto.id} por=${actor.id}`);
    return this.json(gasto);
  }

  async actualizar(actor: UsuarioSesion, id: string, pedido: PedidoCambiosGastoFijo): Promise<GastoFijoJson> {
    const actual = await this.deps.gastosFijos.obtener(id);
    if (actual === undefined) throw AppError.notFound(GASTO_FIJO_NOT_FOUND);
    await this.verificarPerfil(pedido.perfilId);
    const mes = this.mesActual();
    const desde = pedido.desde ?? actual.desde;
    let hasta = pedido.hasta === undefined ? actual.hasta : pedido.hasta;
    // activo: false => deja de contar después de este mes; activo: true => sin fin.
    if (pedido.activo === false) {
      if (desde > mes) throw AppError.validation({ activo: FUTURO_MSG });
      hasta = actual.hasta !== null && actual.hasta < mes ? actual.hasta : mes;
    } else if (pedido.activo === true) {
      hasta = null;
    }
    if (hasta !== null && hasta < desde) throw AppError.validation({ hasta: HASTA_ANTES_MSG });

    const cambios: CambiosGastoFijo = {
      ...(pedido.concepto !== undefined && { concepto: pedido.concepto }),
      ...(pedido.monto !== undefined && { monto: pedido.monto }),
      ...(pedido.categoria !== undefined && { categoria: pedido.categoria }),
      ...(pedido.perfilId !== undefined && { perfilId: pedido.perfilId }),
      ...(pedido.desde !== undefined && { desde: pedido.desde }),
      ...(hasta !== actual.hasta && { hasta }),
    };
    const gasto = await this.deps.gastosFijos.actualizar(id, cambios, this.deps.now());
    if (gasto === undefined) throw AppError.notFound(GASTO_FIJO_NOT_FOUND);
    this.deps.logger.info(`Gasto fijo actualizado id=${id} por=${actor.id}`);
    return this.json(gasto);
  }

  async borrar(actor: UsuarioSesion, id: string): Promise<void> {
    if (!(await this.deps.gastosFijos.borrar(id))) throw AppError.notFound(GASTO_FIJO_NOT_FOUND);
    this.deps.logger.info(`Gasto fijo borrado id=${id} por=${actor.id}`);
  }
}
