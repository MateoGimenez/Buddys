// Aviso interno de "cambió el stock" (una compra, un uso, un ajuste): la campanita lo escucha para volver a contar
// sin esperar el próximo minuto. Es solo dentro de esta pestaña; lo de otros dispositivos llega con el sondeo.
const EVENTO = 'buddys:stock';

export function avisarCambioDeStock(): void {
  window.dispatchEvent(new Event(EVENTO));
}

export function alCambiarElStock(oyente: () => void): () => void {
  window.addEventListener(EVENTO, oyente);
  return () => {
    window.removeEventListener(EVENTO, oyente);
  };
}
