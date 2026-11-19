import type { CategoriaGasto } from '../../api/types';

export const NOMBRE_CATEGORIA: Record<CategoriaGasto, string> = {
  insumos: 'Insumos',
  herramientas: 'Herramientas',
  alquiler: 'Alquiler',
  servicios: 'Servicios (luz, agua, internet)',
  sueldos: 'Sueldos',
  publicidad: 'Publicidad',
  mantenimiento: 'Mantenimiento',
  impuestos: 'Impuestos',
  otros: 'Otros',
};
