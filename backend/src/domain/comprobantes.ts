/**
 * Comprobantes de pago (contrato: reportes/2026-10-27_17_finanzas-inventario-documentos.md, "Comprobantes"). NO son
 * facturas ni tienen validez fiscal. Son una FOTO del momento: copian nombre, servicio, vehículo y monto del turno,
 * para que no cambien si después se edita el turno. Un turno tiene a lo sumo uno.
 */

import { VEHICULO_NOMBRES } from './booking.js';

export const FORMAS_DE_PAGO = ['efectivo', 'transferencia', 'debito', 'credito', 'otro'] as const;
export type FormaDePago = (typeof FORMAS_DE_PAGO)[number];

export const COMPROBANTE_NOTAS_MAX = 200;

export const PRIMERO_CARGA_EL_COBRO = 'Primero cargá el cobro del trabajo.';

export interface Comprobante {
  id: string;
  numero: number;
  /** R-0001 */
  codigo: string;
  /** YYYY-MM-DD */
  fechaEmision: string;
  formaPago: FormaDePago;
  monto: number;
  clienteNombre: string;
  servicioNombre: string;
  vehiculo: string | null;
  notas: string | null;
}

export interface DatosComprobante {
  /** null = la que tiene cargada el turno (la del lavado); si el turno tampoco tiene, FormaDePagoFaltanteError. */
  formaPago: FormaDePago | null;
  notas: string | null;
}

export interface EmisionComprobante {
  comprobante: Comprobante;
  /** true si se emitió ahora; false si el turno ya tenía comprobante (no se emite otro). */
  creado: boolean;
}

/** El turno no existe. */
export class TurnoNoEncontradoError extends Error {
  constructor() {
    super('El turno no existe.');
    this.name = 'TurnoNoEncontradoError';
  }
}

/** El turno no está completado o no tiene el monto cargado. */
export class TurnoSinCobroError extends Error {
  constructor() {
    super(PRIMERO_CARGA_EL_COBRO);
    this.name = 'TurnoSinCobroError';
  }
}

/** No se mandó la forma de pago y el turno no tiene una cargada. */
export class FormaDePagoFaltanteError extends Error {
  constructor() {
    super('Falta la forma de pago.');
    this.name = 'FormaDePagoFaltanteError';
  }
}

/** El turno tiene un comprobante emitido: no se puede borrar. */
export class TurnoConComprobanteError extends Error {
  constructor() {
    super('El turno tiene un comprobante emitido.');
    this.name = 'TurnoConComprobanteError';
  }
}

export interface ComprobanteRepository {
  /**
   * Idempotente por turno. Lanza TurnoNoEncontradoError, TurnoSinCobroError y FormaDePagoFaltanteError (sin
   * formaPago y el turno no tiene una cargada).
   */
  emitir(
    bookingId: string,
    datos: DatosComprobante,
    contexto: { perfilId: string; hoy: string },
  ): Promise<EmisionComprobante>;
  /** El comprobante del turno, o null. */
  deTurno(bookingId: string): Promise<Comprobante | null>;
  obtener(id: string): Promise<Comprobante | null>;
}

/** R-0001 (el número no se corta si pasa de 4 dígitos). */
export function codigoDeComprobante(numero: number): string {
  return `R-${String(numero).padStart(4, '0')}`;
}

/**
 * Vehículo del comprobante: el modelo que escribió el cliente (ej.: "Toyota Corolla 2020") o, si no puso ninguno, el
 * nombre visible del tipo ("SUV", "Pick-up"; ver VEHICULO_NOMBRES).
 */
export function textoDeVehiculo(modelo: string | null, tipo: string): string {
  const limpio = modelo?.trim() ?? '';
  if (limpio !== '') return limpio;
  const nombres: Readonly<Partial<Record<string, string>>> = VEHICULO_NOMBRES;
  const nombre = nombres[tipo];
  if (nombre !== undefined) return nombre;
  return tipo === '' ? tipo : tipo.charAt(0).toUpperCase() + tipo.slice(1);
}
