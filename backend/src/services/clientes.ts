import type { Booking } from '../domain/booking.js';
import {
  type CambiosFidelizacion,
  type ClaveCliente,
  type ClienteRepository,
  type Fidelizacion,
  type ProgresoSellos,
  type ServicioMasHecho,
  calcularSellos,
} from '../domain/clientes.js';
import { linkWhatsapp, mensajeTeExtranamos } from '../domain/mensajes.js';
import { puedeConfigurarFidelizacion, puedeVerImportes, puedeVerInactivos, vistaDeTurno } from '../domain/permisos.js';
import { addDays, todayInLaRioja } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { UsuarioSesion } from './auth.js';

/** Cuántos turnos trae el historial de un cliente (los más nuevos). */
export const HISTORIAL_MAX = 100;

export const CLIENTE_NOT_FOUND = 'No encontramos turnos ni lavados de ese cliente.';
export const SIN_PERMISO_INACTIVOS_MESSAGE = 'Con tu rol no podés ver los clientes inactivos.';
export const SIN_PERMISO_FIDELIZACION_MESSAGE = 'Solo el superadmin puede cambiar la tarjeta de sellos.';

export interface ClienteServiceDeps {
  clientes: ClienteRepository;
  logger: Logger;
  now: () => Date;
}

/** GET /api/admin/clientes/historial: el cliente y sus turnos, tal como lo ve ese rol. */
export interface HistorialDeCliente {
  cliente: {
    tipo: ClaveCliente['tipo'];
    /** El teléfono normalizado o la patente normalizada. */
    clave: string;
    nombre: string;
    telefonoWhatsapp: string | null;
    vehiculos: string[];
    visitas: number;
    ultimaVisita: string | null;
    serviciosMasHechos: ServicioMasHecho[];
    /** null para quien no ve importes. */
    totalGastado: number | null;
    sellos: ProgresoSellos;
  };
  lavados: Booking[];
  total: number;
}

export interface ClienteInactivoConLink {
  telefonoWhatsapp: string;
  nombre: string;
  vehiculoModelo: string | null;
  visitas: number;
  ultimaVisita: string;
  diasSinVenir: number;
  /** Link wa.me con el mensaje "te extrañamos". */
  whatsapp: string | null;
}

/**
 * Clientes (contrato: reportes/2026-11-15_03_contrato-mejoras.md, funciones 6 y 14): historial y resumen por teléfono
 * o patente (todos los roles; el empleado sin importes), tarjeta de sellos (verla: todos; configurarla: el
 * superadmin) e inactivos con su link de WhatsApp (admin y superadmin). Las agregaciones las hace la base.
 */
export class ClienteService {
  constructor(private readonly deps: ClienteServiceDeps) {}

  async historial(actor: UsuarioSesion, clave: ClaveCliente): Promise<HistorialDeCliente> {
    const [historial, config] = await Promise.all([
      this.deps.clientes.historial(clave, HISTORIAL_MAX),
      this.deps.clientes.fidelizacion(),
    ]);
    if (historial === undefined) throw AppError.notFound(CLIENTE_NOT_FOUND);
    const { resumen } = historial;
    return {
      cliente: {
        tipo: clave.tipo,
        clave: clave.tipo === 'telefono' ? clave.telefonoWhatsapp : clave.patente,
        nombre: resumen.nombre,
        telefonoWhatsapp: resumen.telefonoWhatsapp,
        vehiculos: resumen.vehiculos,
        visitas: resumen.visitas,
        ultimaVisita: resumen.ultimaVisita,
        serviciosMasHechos: resumen.serviciosMasHechos,
        totalGastado: puedeVerImportes(actor.rol) ? resumen.totalGastado : null,
        sellos: calcularSellos(resumen.visitas, config),
      },
      lavados: historial.lavados.map((lavado) => vistaDeTurno(actor.rol, lavado)),
      total: historial.total,
    };
  }

  /** Inactivos: última visita hace `dias` o más (sin `dias`, los de la configuración). */
  async inactivos(
    actor: UsuarioSesion,
    pedido: { dias?: number | undefined; limit: number; offset: number },
  ): Promise<{ dias: number; clientes: ClienteInactivoConLink[]; total: number }> {
    if (!puedeVerInactivos(actor.rol)) throw AppError.forbidden(SIN_PERMISO_INACTIVOS_MESSAGE);
    const dias = pedido.dias ?? (await this.deps.clientes.fidelizacion()).inactivosDias;
    const hoy = todayInLaRioja(this.deps.now());
    const { clientes, total } = await this.deps.clientes.inactivos(addDays(hoy, -dias), hoy, pedido.limit, pedido.offset);
    return {
      dias,
      clientes: clientes.map((c) => ({
        telefonoWhatsapp: c.telefonoWhatsapp,
        nombre: c.nombre,
        vehiculoModelo: c.vehiculoModelo,
        visitas: c.visitas,
        ultimaVisita: c.ultimaVisita,
        diasSinVenir: c.diasSinVenir,
        whatsapp: linkWhatsapp(c.telefonoWhatsapp, mensajeTeExtranamos(c.nombre, c.vehiculoModelo, c.vehiculoTipo)),
      })),
      total,
    };
  }

  fidelizacion(): Promise<Fidelizacion> {
    return this.deps.clientes.fidelizacion();
  }

  async guardarFidelizacion(actor: UsuarioSesion, cambios: CambiosFidelizacion): Promise<Fidelizacion> {
    if (!puedeConfigurarFidelizacion(actor.rol)) throw AppError.forbidden(SIN_PERMISO_FIDELIZACION_MESSAGE);
    const config = await this.deps.clientes.guardarFidelizacion(cambios, this.deps.now());
    this.deps.logger.info(`Tarjeta de sellos actualizada por=${actor.id}`);
    return config;
  }
}
