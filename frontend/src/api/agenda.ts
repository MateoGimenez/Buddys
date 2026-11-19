// Turnos con seña creados desde el panel (función 8) y la agenda (GET /api/admin/agenda).
// Contrato: reportes/2026-11-15_03_contrato-mejoras.md; fixtures turnoConSenaCrea, turnoConSenaEmpleadoLista,
// turnoCompletaConSena, senaPut, error400MontoMenorSena, error403TurnoEmpleado, agendaAdmin.
// El Turno con seña, saldo y origen 'panel' está en types.ts.
import { api, query } from './client';
import type { CambioTurno, FormaPago, Franja, Turno, VehiculoTipo } from './types';

/** La seña de un turno. `monto` null para el empleado (la clave está, el valor no). */
export type Sena = NonNullable<Turno['sena']>;

/** Los turnos de la agenda (el mismo objeto que el resto de la API). */
export type TurnoAgenda = Turno;

export interface CupoDia {
  fecha: string;
  abierto: boolean;
  cupoManana: number;
  cupoTarde: number;
  ocupadosManana: number;
  ocupadosTarde: number;
}

export interface NuevoTurno {
  nombre: string;
  telefono: string;
  email?: string | null;
  vehiculoTipo: VehiculoTipo;
  vehiculoModelo?: string | null;
  servicioIds: string[];
  fecha: string;
  franja: Franja;
  comentario?: string | null;
  notasInternas?: string | null;
  sena?: { monto: number; formaPago: FormaPago; fecha?: string };
}

/** Hasta 42 días por pedido (lo limita el backend). */
export const agenda = (desde: string, hasta: string) =>
  api<{ turnos: TurnoAgenda[]; cupos: CupoDia[] }>(`/api/admin/agenda${query({ desde, hasta })}`);
export const crearTurno = (datos: NuevoTurno) =>
  api<{ turno: TurnoAgenda }>('/api/admin/turnos', { method: 'POST', body: datos });
export const cambiarTurno = (id: string, cambio: CambioTurno) =>
  api<{ booking: TurnoAgenda }>(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambio });
export const ponerSena = (id: string, sena: { monto: number; formaPago: FormaPago; fecha?: string }) =>
  api<{ turno: TurnoAgenda }>(`/api/admin/turnos/${encodeURIComponent(id)}/sena`, { method: 'PUT', body: sena });
export const quitarSena = (id: string) =>
  api<undefined>(`/api/admin/turnos/${encodeURIComponent(id)}/sena`, { method: 'DELETE' });
