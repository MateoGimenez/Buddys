import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { cambiarMinimo } from '../../api/insumos-extra';
import type { Insumo } from '../../api/types';
import { Aviso, Boton, Campo } from '../../components/ui';
import { decimalDesdeTexto, numero } from '../../lib/format';
import { NOMBRE_UNIDAD } from './unidades';

/** Cuándo avisar "queda poco": el stock mínimo del insumo (0 = nunca avisa). */
export function Minimo({ insumo, onListo, onCancelar }: { insumo: Insumo; onListo: (i: Insumo) => void; onCancelar: () => void }) {
  const [texto, setTexto] = useState(insumo.stockMinimo ? numero(insumo.stockMinimo) : '');
  const [errorCampo, setErrorCampo] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const n = texto.trim() ? decimalDesdeTexto(texto) : 0;
    if (Number.isNaN(n)) {
      setErrorCampo('Escribí un número, por ejemplo 1 o 0,5.');
      return;
    }
    setGuardando(true);
    setError(null);
    setErrorCampo(undefined);
    try {
      const { insumo: nuevo } = await cambiarMinimo(insumo.id, n);
      onListo(nuevo);
    } catch (err) {
      if (err instanceof ApiError && err.fields?.stockMinimo) setErrorCampo(err.fields.stockMinimo);
      else setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo
        etiqueta={`Avisar cuando queden (${NOMBRE_UNIDAD[insumo.unidad][1]})`}
        inputMode="decimal"
        autoFocus
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
        }}
        error={errorCampo}
        ayuda="Con 0 no avisa nunca."
      />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar mínimo
        </Boton>
      </div>
    </form>
  );
}
