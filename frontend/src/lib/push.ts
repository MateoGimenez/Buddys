// Avisos push en este dispositivo: el service worker de la PWA (vite-plugin-pwa, con public/sw-push.js adentro) los
// recibe; acá se pide el permiso, se suscribe con la clave pública VAPID que da la API y se le avisa al backend.
import { borrarSuscripcion, guardarSuscripcion, type SuscripcionPush } from '../api/push';

export type SoportePush =
  | { tipo: 'si' }
  /** iPhone/iPad con el panel abierto en Safari: solo anda instalado en la pantalla de inicio (iOS 16.4+). */
  | { tipo: 'ios-sin-instalar' }
  | { tipo: 'no' };

function esIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se presenta como Mac con pantalla táctil.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function instalada(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export function soportePush(): SoportePush {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { tipo: 'no' };
  const tiene = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (esIos() && !instalada()) return { tipo: 'ios-sin-instalar' };
  return tiene ? { tipo: 'si' } : { tipo: 'no' };
}

export function permisoActual(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

/** El registro del service worker, o null si no hay (en desarrollo, o todavía no se instaló). */
async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const r = await navigator.serviceWorker.getRegistration();
  return r ?? null;
}

export async function suscripcionActual(): Promise<PushSubscription | null> {
  const r = await registro();
  if (!r) return null;
  return r.pushManager.getSubscription();
}

/** La clave VAPID (base64url) como la pide PushManager. */
function claveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const texto = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(texto.length));
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

/** "Android · Chrome", para reconocer el aparato. */
function agente(): string {
  const ua = navigator.userAgent;
  const sistema = ua.includes('Android') ? 'Android' : esIos() ? 'iPhone' : ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'Mac' : 'Otro';
  const nav = ua.includes('Edg/') ? 'Edge' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Chrome/') ? 'Chrome' : ua.includes('Safari/') ? 'Safari' : 'Navegador';
  return `${sistema} · ${nav}`;
}

export class SinServiceWorker extends Error {
  constructor() {
    super('Esta versión del panel no tiene los avisos listos. Abrí el panel instalado (o recargalo) y probá de nuevo.');
    this.name = 'SinServiceWorker';
  }
}

export class PermisoDenegado extends Error {
  constructor() {
    super('Los avisos están bloqueados para el panel en este celular.');
    this.name = 'PermisoDenegado';
  }
}

/** Pide permiso, suscribe este dispositivo y se lo cuenta al backend. */
export async function activarAvisos(clavePublica: string): Promise<void> {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new PermisoDenegado();
  const r = await registro();
  if (!r) throw new SinServiceWorker();
  const sub =
    (await r.pushManager.getSubscription()) ??
    (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clavePublica) }));
  const json = sub.toJSON() as SuscripcionPush;
  try {
    await guardarSuscripcion({ endpoint: json.endpoint, keys: json.keys, agente: agente() });
  } catch (err) {
    // Si el backend no la guardó, que tampoco quede suscripto (si no, figuraría activo sin recibir nada).
    await sub.unsubscribe().catch(() => false);
    throw err;
  }
}

/** Saca este dispositivo (en el navegador y en el backend). */
export async function desactivarAvisos(): Promise<void> {
  const sub = await suscripcionActual();
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => false);
  await borrarSuscripcion(endpoint);
}
