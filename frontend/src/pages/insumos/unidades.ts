import type { Unidad } from '../../api/types';
import { numero } from '../../lib/format';

export const NOMBRE_UNIDAD: Record<Unidad, [string, string]> = {
  unidad: ['unidad', 'unidades'],
  litro: ['litro', 'litros'],
  ml: ['ml', 'ml'],
  kg: ['kg', 'kg'],
  g: ['g', 'g'],
  par: ['par', 'pares'],
  caja: ['caja', 'cajas'],
};

/** "1,5 litros", "1 unidad". */
export function cantidad(n: number, u: Unidad): string {
  return `${numero(n)} ${NOMBRE_UNIDAD[u][n === 1 ? 0 : 1]}`;
}
