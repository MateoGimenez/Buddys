// Reglas del descuento (las mismas del backend: contrato 2026-11-15, función 12). `monto` es lo cobrado, ya con el
// descuento; el descuento es cuánto se rebajó y lleva su motivo.

export const MONTO_MAX = 99_999_999;
export const MOTIVO_MAX = 80;

/** Errores por campo (vacío = está bien). */
export function revisarDescuento(monto: number | null, descuento: number, motivo: string): Record<string, string> {
  const errores: Record<string, string> = {};
  const m = motivo.trim();
  if (descuento > MONTO_MAX) errores.descuento = 'El descuento es demasiado grande.';
  else if (monto !== null && monto + descuento > MONTO_MAX) errores.descuento = 'El monto más el descuento es demasiado grande.';
  if (descuento > 0 && !m) errores.descuentoMotivo = 'Escribí el motivo del descuento.';
  if (m.length > MOTIVO_MAX) errores.descuentoMotivo = `El motivo puede tener hasta ${String(MOTIVO_MAX)} letras.`;
  return errores;
}
