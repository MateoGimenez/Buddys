import type { Premio } from '../api/clientes';

/** "un lavado gratis" o "50% de descuento". */
export function textoPremio(premio: Premio, porcentaje: number | null): string {
  return premio === 'gratis' ? 'un lavado gratis' : `${String(porcentaje ?? 0)}% de descuento`;
}
