// Clientes: búsqueda, historial, tarjeta de sellos e inactivos (contrato 2026-11-15, funciones 6 y 14).
import { api, query } from './client';
import type { Turno } from './types';

export type Premio = 'gratis' | 'descuento';

/** Progreso de la tarjeta de sellos del cliente. sellos = visitas mod (cada + 1). */
export interface Sellos {
  visitas: number;
  sellos: number;
  cada: number;
  faltan: number;
  proximoEsPremio: boolean;
  premio: Premio;
  porcentaje: number | null;
}

export interface Cliente {
  tipo: 'telefono' | 'patente';
  clave: string;
  nombre: string;
  telefonoWhatsapp: string | null;
  vehiculos: string[];
  visitas: number;
  ultimaVisita: string | null;
  serviciosMasHechos: { servicioId: string; nombre: string; cantidad: number }[];
  /** null para el empleado. */
  totalGastado: number | null;
  sellos: Sellos;
}

export interface HistorialCliente {
  cliente: Cliente;
  lavados: Turno[];
  total: number;
}

export interface ConfigFidelizacion {
  sellosCada: number;
  premio: Premio;
  premioPorcentaje: number | null;
  inactivosDias: number;
  updatedAt: string;
}

export type CambioFidelizacion = Omit<ConfigFidelizacion, 'updatedAt'>;

export interface ClienteInactivo {
  telefonoWhatsapp: string;
  nombre: string;
  vehiculoModelo: string | null;
  visitas: number;
  ultimaVisita: string;
  diasSinVenir: number;
  /** Link wa.me con el mensaje armado por la API. */
  whatsapp: string;
}

export type ClaveCliente = { telefono: string } | { patente: string };

export const historialCliente = (clave: ClaveCliente) =>
  api<HistorialCliente>(`/api/admin/clientes/historial${query(clave)}`);

/** Busca turnos y lavados por nombre, teléfono o patente (más nuevos primero). */
export const buscarTurnos = (q: string, limit = 50) =>
  api<{ bookings: Turno[]; total: number }>(`/api/admin/bookings${query({ q, limit })}`);

export const fidelizacion = () => api<{ config: ConfigFidelizacion }>('/api/admin/fidelizacion');
export const guardarFidelizacion = (config: CambioFidelizacion) =>
  api<{ config: ConfigFidelizacion }>('/api/admin/fidelizacion', { method: 'PUT', body: config });

export const clientesInactivos = (offset = 0) =>
  api<{ dias: number; clientes: ClienteInactivo[]; total: number }>(
    `/api/admin/clientes/inactivos${query({ limit: 50, offset })}`,
  );
