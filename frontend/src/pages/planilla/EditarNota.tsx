import { useState, type SyntheticEvent } from 'react';
import { mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import type { Turno } from '../../api/types';
import { AreaTexto, Aviso, Boton } from '../../components/ui';

export function EditarNota({ lavado, onListo, onCancelar }: { lavado: Turno; onListo: (t: Turno) => void; onCancelar: () => void }) {
  const [nota, setNota] = useState(lavado.notasInternas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const { booking } = await ep.corregirTurno(lavado.id, { notasInternas: nota.trim() || null });
      onListo(booking);
    } catch (err) {
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="copia-form formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <AreaTexto etiqueta="Nota" value={nota} maxLength={1000} onChange={(e) => { setNota(e.target.value); }} ayuda="El cliente no la ve." />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar nota
        </Boton>
      </div>
    </form>
  );
}
