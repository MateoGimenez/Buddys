// Lo que necesita "Avisos en este celular" (Mi perfil) del navegador: soporte, el service worker del panel y la
// suscripción de push. Los avisos los muestra public/push-sw.js.

import type { SuscripcionPush } from '../api/types';

/**
 * - `si`: hay service worker, PushManager y Notification.
 * - `instalar`: iPhone o iPad con el panel abierto en Safari: solo recibe avisos instalado en la pantalla de inicio.
 * - `no`: el navegador no tiene avisos.
 */
export type SoportePush = 'si' | 'instalar' | 'no';

function esIos(): boolean {
  // iPadOS se presenta como Mac: se distingue por la pantalla táctil.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function instalado(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export function soportePush(): SoportePush {
  const completo = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (esIos() && !instalado()) return 'instalar';
  return completo ? 'si' : 'no';
}

/** El registro del service worker del panel, o null si todavía no se instaló (o en desarrollo, donde no hay). */
export async function registroDelPanel(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** La clave pública VAPID (base64url, como la manda /estado) en bytes, que es lo que acepta todo navegador. */
export function claveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const binario = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** true si la suscripción se hizo con esta clave. Si el servidor cambió el par VAPID, la vieja ya no recibe nada. */
export function esDeLaClave(suscripcion: PushSubscription, clave: string): boolean {
  const propia = suscripcion.options.applicationServerKey;
  if (!propia) return true; // el navegador no la informa: se da por buena
  const a = new Uint8Array(propia);
  const b = claveABytes(clave);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Lo que espera POST /api/admin/push/suscripciones, sin campos de más. null si el navegador no dio las claves. */
export function cuerpoSuscripcion(suscripcion: PushSubscription): SuscripcionPush | null {
  const json = suscripcion.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } };
}
