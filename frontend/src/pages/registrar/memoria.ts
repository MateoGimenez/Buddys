// Lo que Registrar recuerda en este dispositivo, por usuario: el último vehículo elegido y el último lavado
// registrado desde acá (vehículo y servicios; el monto solo si lo cargó alguien que ve montos). Vive en localStorage:
// si el navegador no deja (modo privado, lleno), el panel funciona igual, solo que sin recordar.
import { VEHICULOS, type VehiculoTipo } from '../../api/types';

export interface UltimoLavado {
  vehiculo: VehiculoTipo;
  servicioIds: string[];
  /** "Nivel II + Motor", para mostrarlo en el botón. */
  servicio: string;
  /** Solo para quien ve montos (admin): el empleado nunca lo tiene guardado. */
  monto: number | null;
}

interface Memoria {
  vehiculo?: VehiculoTipo;
  ultimo?: UltimoLavado;
}

const clave = (usuarioId: string) => `buddys.registrar.v1.${usuarioId}`;

function esVehiculo(v: unknown): v is VehiculoTipo {
  return typeof v === 'string' && (VEHICULOS as readonly string[]).includes(v);
}

function leer(usuarioId: string): Memoria {
  try {
    const crudo = localStorage.getItem(clave(usuarioId));
    if (!crudo) return {};
    const m = JSON.parse(crudo) as Record<string, unknown>;
    const memoria: Memoria = {};
    if (esVehiculo(m.vehiculo)) memoria.vehiculo = m.vehiculo;
    const u = m.ultimo as Partial<UltimoLavado> | undefined;
    if (
      u &&
      esVehiculo(u.vehiculo) &&
      Array.isArray(u.servicioIds) &&
      u.servicioIds.every((s) => typeof s === 'string') &&
      typeof u.servicio === 'string'
    ) {
      memoria.ultimo = {
        vehiculo: u.vehiculo,
        servicioIds: u.servicioIds,
        servicio: u.servicio,
        monto: typeof u.monto === 'number' ? u.monto : null,
      };
    }
    return memoria;
  } catch {
    return {};
  }
}

function guardar(usuarioId: string, cambio: Memoria) {
  try {
    localStorage.setItem(clave(usuarioId), JSON.stringify({ ...leer(usuarioId), ...cambio }));
  } catch {
    // Sin lugar o sin permiso: no se recuerda, nada más.
  }
}

export function vehiculoRecordado(usuarioId: string): VehiculoTipo | null {
  return leer(usuarioId).vehiculo ?? null;
}

export function recordarVehiculo(usuarioId: string, vehiculo: VehiculoTipo) {
  guardar(usuarioId, { vehiculo });
}

export function ultimoLavado(usuarioId: string): UltimoLavado | null {
  return leer(usuarioId).ultimo ?? null;
}

export function recordarUltimo(usuarioId: string, ultimo: UltimoLavado) {
  guardar(usuarioId, { ultimo, vehiculo: ultimo.vehiculo });
}
