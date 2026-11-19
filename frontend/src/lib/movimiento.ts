// Movimiento del panel: solo para explicar un cambio (un número que cambió mientras se miraba).
// Nada se anima al cargar la pantalla: lo primero que se ve ya es el valor final. Con "reducir movimiento" (o donde
// no hay matchMedia / requestAnimationFrame, como en los tests) todo queda quieto.
import { useEffect, useState } from 'react';

export function prefiereMenosMovimiento(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function puedeAnimarNumeros(): boolean {
  return typeof requestAnimationFrame === 'function' && !prefiereMenosMovimiento();
}

/**
 * Un número que, cuando cambia, cuenta desde el valor anterior hasta el nuevo (~420 ms). En el primer dibujo muestra
 * el valor tal cual: contar desde cero al abrir la pantalla solo haría esperar para leer la caja.
 */
export function useContador(valor: number, duracion = 420): number {
  // Desde dónde y hacia dónde cuenta, y el número del cuadro actual. null = quieto en el valor.
  const [anim, setAnim] = useState<{ desde: number; hacia: number; v: number } | null>(null);
  const [previo, setPrevio] = useState(valor);
  if (previo !== valor) {
    // Se ajusta en el mismo dibujo (no en un efecto): así no se ve un cuadro con el valor final antes de contar.
    setPrevio(valor);
    const actual = anim?.v ?? previo;
    setAnim(actual !== valor && puedeAnimarNumeros() ? { desde: actual, hacia: valor, v: actual } : null);
  }

  const desde = anim?.desde;
  const hacia = anim?.hacia;
  useEffect(() => {
    if (desde === undefined || hacia === undefined) return;
    let pedido = 0;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      // easeOutExpo: casi todo el recorrido al principio, el final se asienta.
      const k = t === 1 ? 1 : 1 - 2 ** (-10 * t);
      const v = Math.round(desde + (hacia - desde) * k);
      if (t < 1) {
        setAnim((a) => (a?.hacia === hacia ? { ...a, v } : a));
        pedido = requestAnimationFrame(paso);
      } else {
        setAnim((a) => (a?.hacia === hacia ? null : a));
      }
    };
    pedido = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(pedido);
    };
  }, [desde, hacia, duracion]);

  return anim?.hacia === valor ? anim.v : valor;
}
