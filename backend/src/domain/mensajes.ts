import { VEHICULO_NOMBRES, type VehiculoTipo } from './booking.js';

/**
 * Links de WhatsApp para escribirle al cliente desde el celular del taller (decisión del dueño: link wa.me, sin la API
 * de WhatsApp). El número es el `telefonoWhatsapp` ya normalizado (domain/telefono.ts: solo dígitos, formato
 * internacional, sin "+"); el texto va URL-encoded. Sin número, no hay link (null).
 */

/** Nombre que no se usa en el saludo (el que queda cuando el lavado se registra sin nombre). */
const NOMBRES_GENERICOS = new Set(['cliente de mostrador']);

/** Nombre del taller en los mensajes. */
export const NOMBRE_TALLER = 'Buddys Wash Detail';

/** Solo el primer nombre, si es uno de verdad ("Juan Pérez" -> "Juan"); null si no hay o es genérico. */
function primerNombre(nombre: string | null): string | null {
  const limpio = nombre?.trim() ?? '';
  if (limpio === '' || NOMBRES_GENERICOS.has(limpio.toLowerCase())) return null;
  const primero = limpio.split(/\s+/)[0] ?? '';
  // Seguridad: el nombre lo escribió alguien de afuera (o se copió de un turno web). Solo letras (con tildes) y hasta
  // 30: nada de ":", "/", ".", dígitos ni símbolos que conviertan el saludo en un link o un texto engañoso.
  return /^\p{L}{1,30}$/u.test(primero) ? primero : null;
}

/** Largo máximo del modelo o la patente dentro del mensaje. */
const MODELO_MAX = 30;

/** "Hola Juan!" o "Hola!" */
function saludo(nombre: string | null): string {
  const primero = primerNombre(nombre);
  return primero === null ? 'Hola!' : `Hola ${primero}!`;
}

/** El modelo o la patente que escribió el taller; si no hay, el tipo de vehículo en minúsculas ("auto", "moto"). */
function vehiculo(modelo: string | null, tipo: VehiculoTipo): string {
  // Solo letras, números, espacios y guiones (sin ":", "/", "." ni nada que arme un link), recortado a 30.
  const limpio = (modelo ?? '')
    .replace(/[^\p{L}\p{N} -]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MODELO_MAX)
    .trim();
  return limpio === '' ? VEHICULO_NOMBRES[tipo].toLowerCase() : limpio;
}

/** https://wa.me/<numero>?text=<texto URL-encoded>; null sin número. */
export function linkWhatsapp(telefonoWhatsapp: string | null, texto: string): string | null {
  if (telefonoWhatsapp === null || !/^\d{8,15}$/.test(telefonoWhatsapp)) return null;
  return `https://wa.me/${telefonoWhatsapp}?text=${encodeURIComponent(texto)}`;
}

/** "Hola Juan! Tu Gol AB123CD ya está listo en Buddys Wash Detail: ya podés pasar a retirarlo." */
export function mensajeListo(nombre: string | null, modelo: string | null, tipo: VehiculoTipo): string {
  return `${saludo(nombre)} Tu ${vehiculo(modelo, tipo)} ya está listo en ${NOMBRE_TALLER}: ya podés pasar a retirarlo.`;
}

/** "Hola Juan! Hace un tiempo que no te vemos por Buddys Wash Detail. ¿Le damos una mano a tu Gol? Te esperamos." */
export function mensajeTeExtranamos(nombre: string | null, modelo: string | null, tipo: VehiculoTipo): string {
  return (
    `${saludo(nombre)} Hace un tiempo que no te vemos por ${NOMBRE_TALLER}. ` +
    `¿Le damos una mano a tu ${vehiculo(modelo, tipo)}? Te esperamos.`
  );
}

/** El link "ya está listo" de un turno o lavado. */
export function whatsappListo(datos: {
  telefonoWhatsapp: string | null;
  nombre: string | null;
  vehiculoModelo: string | null;
  vehiculoTipo: VehiculoTipo;
}): string | null {
  return linkWhatsapp(datos.telefonoWhatsapp, mensajeListo(datos.nombre, datos.vehiculoModelo, datos.vehiculoTipo));
}
