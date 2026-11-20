// La lista "Para comprar" como texto para mandarle al proveedor: sin precios (contrato 06).
import type { ItemParaComprar } from '../api/types';
import { cantidadConUnidad, fechaCorta } from './format';

/**
 * Para comprar — Buddys Wash Detail (17/11/2026)
 * • Shampoo: 2 litros
 * • Paños de microfibra: 10 unidades
 */
export function textoParaComprar(items: Pick<ItemParaComprar, 'nombre' | 'unidad' | 'sugerido'>[], fecha: string): string {
  const renglones = items.filter((i) => i.sugerido > 0).map((i) => `• ${i.nombre}: ${cantidadConUnidad(i.sugerido, i.unidad)}`);
  return [`Para comprar — Buddys Wash Detail (${fechaCorta(fecha)})`, ...renglones].join('\n');
}

/** Enlace de WhatsApp con el texto ya escrito (sin destinatario: se elige en WhatsApp). */
export function urlWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

/** Un número para precargar un campo: "1,5" (coma decimal y sin separador de miles, como se tipea). */
export function numeroParaCampo(n: number): string {
  return String(n).replace('.', ',');
}
