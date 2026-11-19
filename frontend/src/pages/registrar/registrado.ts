import type { Etapa, FormaPago, Persona, VehiculoTipo } from '../../api/types';

/** Cuánto se ofrece "Deshacer" en pantalla. El backend deja hasta deshacerHasta: se usa lo que llegue primero. */
export const VENTANA_DESHACER_MS = 10_000;

/** Hasta cuándo se ofrece "Deshacer": la ventana de la UI o lo que diga el backend, lo que llegue primero. */
export function limiteParaDeshacer(deshacerHasta: string): number {
  const ventana = Date.now() + VENTANA_DESHACER_MS;
  const hasta = Date.parse(deshacerHasta);
  return Number.isFinite(hasta) ? Math.min(hasta, ventana) : ventana;
}

export interface Registrado {
  /** Distinta en cada registro: el talón arranca de cero. */
  clave: string;
  /** "Nivel II + Motor". */
  servicio: string;
  vehiculoTipo: VehiculoTipo;
  vehiculoModelo: string | null;
  formaPago: FormaPago | null;
  montoCargado: number | null;
  trabajador: Persona | null;
  /** Solo para quien ve importes; 0 = sin descuento. */
  descuento: number;
  descuentoMotivo: string | null;
  /** 'espera' si se anotó al llegar; 'entregado' si ya estaba terminado. */
  etapa: Etapa;
  envio: { tipo: 'enviado'; id: string; deshacerLimite: number } | { tipo: 'en-cola' };
}
