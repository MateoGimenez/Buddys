import { useId } from 'react';
import { EJEMPLO_PATENTE, NOMBRE_PATENTE, normalizarPatente, patenteEn } from '../lib/patente';
import { Campo } from './ui';

/**
 * Campo "Patente" del lavado. Acepta también el modelo o los dos juntos (todo va en vehiculoModelo). Al salir del
 * campo ordena la patente (AB123CD) y, si no reconoce ninguna, solo lo dice: no bloquea.
 * `sugerencias`: patentes o modelos ya usados (para cuando exista el historial); se ofrecen al escribir.
 */
export function CampoPatente({
  valor,
  onCambio,
  error,
  sugerencias,
  name = 'vehiculoModelo',
}: {
  valor: string;
  onCambio: (texto: string) => void;
  error?: string | undefined;
  sugerencias?: readonly string[] | undefined;
  name?: string;
}) {
  const listaId = useId();
  const hay = sugerencias && sugerencias.length > 0;
  return (
    <>
      <Campo
        etiqueta="Patente"
        name={name}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        maxLength={80}
        value={valor}
        list={hay ? listaId : undefined}
        onChange={(e) => {
          onCambio(e.target.value);
        }}
        onBlur={() => {
          const ordenada = normalizarPatente(valor);
          if (ordenada !== valor) onCambio(ordenada);
        }}
        error={error}
        ayuda={ayudaDe(valor)}
      />
      {hay ? (
        <datalist id={listaId}>
          {sugerencias.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

function ayudaDe(valor: string): string {
  const texto = valor.trim();
  if (!texto) return `Como ${EJEMPLO_PATENTE.mercosur} o ${EJEMPLO_PATENTE.vieja}. Si no la sabés, poné el modelo.`;
  const hallada = patenteEn(texto);
  if (hallada) return `${NOMBRE_PATENTE[hallada.tipo]}: ${hallada.patente}.`;
  if (texto.length < 3) return `Como ${EJEMPLO_PATENTE.mercosur} o ${EJEMPLO_PATENTE.vieja}.`;
  return `No parece una patente (${EJEMPLO_PATENTE.mercosur}, ${EJEMPLO_PATENTE.vieja}; moto ${EJEMPLO_PATENTE.moto} o ${EJEMPLO_PATENTE['moto-vieja']}). Si es el modelo, dejalo así.`;
}
