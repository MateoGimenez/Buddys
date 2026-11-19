import type { Turno } from '../../api/types';
import { patenteEn } from '../../lib/patente';

export interface ClienteEncontrado {
  nombre: string;
  telefonoWhatsapp: string | null;
  vehiculoModelo: string | null;
  /** Fecha de la visita más nueva. */
  ultima: string;
}

/**
 * Los turnos de una búsqueda, de a un renglón por cliente: por teléfono o, sin teléfono, por patente. Los que no
 * tienen ninguno de los dos no tienen historial y no se listan. Llegan más nuevos primero: queda el dato más nuevo.
 */
export function agrupar(turnos: Turno[]): ClienteEncontrado[] {
  const vistos = new Map<string, ClienteEncontrado>();
  for (const t of turnos) {
    const patente = t.vehiculoModelo ? patenteEn(t.vehiculoModelo)?.patente : undefined;
    const clave = t.telefonoWhatsapp ? `t:${t.telefonoWhatsapp}` : patente ? `p:${patente}` : null;
    if (!clave || vistos.has(clave)) continue;
    vistos.set(clave, {
      nombre: t.nombre === 'Cliente de mostrador' ? (t.vehiculoModelo ?? t.nombre) : t.nombre,
      telefonoWhatsapp: t.telefonoWhatsapp,
      vehiculoModelo: t.vehiculoModelo,
      ultima: t.fechaConfirmada ?? t.fechaPreferida,
    });
  }
  return [...vistos.values()];
}
