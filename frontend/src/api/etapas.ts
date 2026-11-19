// Etapas del auto en el lavadero (contrato 2026-11-15, función 9).
import { api } from './client';
import type { Etapa, Turno } from './types';

export interface EnCurso {
  fecha: string;
  /** Los de mostrador de hoy que todavía no se entregaron, en orden de llegada. */
  lavados: Turno[];
  resumen: Record<Exclude<Etapa, 'entregado'>, number>;
}

export const cambiarEtapa = (id: string, etapa: Etapa) =>
  api<{ lavado: Turno }>(`/api/admin/lavados/${encodeURIComponent(id)}/etapa`, { method: 'PATCH', body: { etapa } });

export const lavadosEnCurso = () => api<EnCurso>('/api/admin/lavados/en-curso');
