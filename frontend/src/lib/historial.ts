import { patenteEn } from './patente';

/** La ruta del historial del cliente de un lavado (por teléfono o, si no hay, por patente), o null. */
export function rutaHistorial(l: { telefonoWhatsapp: string | null; vehiculoModelo: string | null }): string | null {
  if (l.telefonoWhatsapp) return `/clientes?telefono=${encodeURIComponent(l.telefonoWhatsapp)}`;
  const p = l.vehiculoModelo ? patenteEn(l.vehiculoModelo) : null;
  return p ? `/clientes?patente=${encodeURIComponent(p.patente)}` : null;
}
