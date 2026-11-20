// Constantes y tipos del formulario de Registrar (aparte de los componentes, para que Fast Refresh funcione).
import type { Franja } from '../../api/types';

/** Hasta cuántos días atrás se puede anotar un lavado (el backend acepta lo mismo). */
export const DIAS_ATRAS = 31;

export type FranjaElegida = 'auto' | Franja;

/** Lo que va plegado en "Más datos". */
export interface DatosExtra {
  /** null = "hoy": así, si la pantalla queda abierta de un día para el otro, el lavado no se anota con la fecha de ayer. */
  fechaElegida: string | null;
  franja: FranjaElegida;
  nombre: string;
  telefono: string;
  /** Patente, modelo o los dos: viaja como vehiculoModelo. */
  modelo: string;
  nota: string;
}

export const EXTRA_VACIO: DatosExtra = { fechaElegida: null, franja: 'auto', nombre: '', telefono: '', modelo: '', nota: '' };

/** Los campos de acá: si la API marca error en alguno, "Más datos" se abre. */
export const CAMPOS_PLEGADOS = ['fecha', 'franja', 'nombre', 'telefono', 'vehiculoModelo', 'notasInternas'];
