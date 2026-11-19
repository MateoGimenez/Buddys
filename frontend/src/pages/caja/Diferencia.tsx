import { CheckCircle2, MinusCircle, PlusCircle } from 'lucide-react';
import { textoDiferencia, tonoDe } from './datos';

const ICONO = { falta: MinusCircle, sobra: PlusCircle, justo: CheckCircle2 } as const;

/**
 * La diferencia del arqueo, grande: roja si falta, ámbar si sobra, verde si cierra justo. El color nunca va solo:
 * siempre lleva el ícono y la palabra.
 */
export function Diferencia({ valor, enVivo }: { valor: number | null; enVivo?: boolean }) {
  if (valor === null) {
    return (
      <p className="diferencia" data-tono="nada" aria-live={enVivo ? 'polite' : undefined}>
        <span className="diferencia-texto">Todavía no contaste nada</span>
      </p>
    );
  }
  const tono = tonoDe(valor);
  const Icono = ICONO[tono];
  return (
    <p className="diferencia" data-tono={tono} aria-live={enVivo ? 'polite' : undefined}>
      <Icono aria-hidden size={28} className="diferencia-icono" />
      <span className="diferencia-texto">{textoDiferencia(valor)}</span>
    </p>
  );
}
