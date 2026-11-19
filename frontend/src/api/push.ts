// Avisos push (endpoints de backend/README.md: /api/admin/push/*).
import { api } from './client';

export interface EstadoPush {
  /** false si el servidor no tiene las claves VAPID: el panel no ofrece los avisos. */
  disponible: boolean;
  clavePublica: string | null;
}

export interface SuscripcionPush {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  /** Para que la persona reconozca el aparato (1 a 120). */
  agente?: string;
}

export const estadoPush = () => api<EstadoPush>('/api/admin/push/estado');
export const guardarSuscripcion = (s: SuscripcionPush) =>
  api<{ ok: true }>('/api/admin/push/suscripciones', { method: 'POST', body: s });
export const borrarSuscripcion = (endpoint: string) =>
  api<undefined>('/api/admin/push/suscripciones', { method: 'DELETE', body: { endpoint } });
