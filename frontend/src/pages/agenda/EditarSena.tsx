import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { ponerSena, quitarSena, type TurnoAgenda } from '../../api/agenda';
import type { FormaPago } from '../../api/types';
import { Aviso, Boton, Campo, Confirmar } from '../../components/ui';
import { enteroDesdeTexto, hoy, miles, NOMBRE_PAGO, sumarDias } from '../../lib/format';
import { CamposSena } from './CamposSena';
import { DIAS_SENA_ATRAS } from './datos';

/** Cargar, corregir o quitar la seña de un turno (solo quien ve importes). */
export function EditarSena({ turno, onListo, onCancelar }: { turno: TurnoAgenda; onListo: (t: TurnoAgenda | null) => void; onCancelar: () => void }) {
  const hoyAR = hoy();
  const actual = turno.sena ?? null;
  const [monto, setMonto] = useState(actual?.monto ? miles(String(actual.monto)) : '');
  const [forma, setForma] = useState<FormaPago | null>(actual?.formaPago ?? null);
  const [fecha, setFecha] = useState(actual?.fecha ?? hoyAR);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const n = enteroDesdeTexto(monto);
    const locales: Record<string, string> = {};
    if (!n) locales.monto = 'Poné cuánto dejó de seña.';
    if (!forma) locales.formaPago = 'Elegí cómo pagó la seña.';
    setErrores(locales);
    if (!n || !forma) return;
    setGuardando(true);
    setError(null);
    try {
      const { turno: nuevo } = await ponerSena(turno.id, { monto: n, formaPago: forma, fecha });
      onListo(nuevo);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  const quitar = async () => {
    setQuitando(true);
    setError(null);
    try {
      await quitarSena(turno.id);
      setConfirmando(false);
      onListo(null);
    } catch (err) {
      setConfirmando(false);
      setError(mensajeDeError(err));
      setQuitando(false);
    }
  };

  return (
    <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <CamposSena
        nombre={`sena-${turno.id}`}
        monto={monto}
        setMonto={setMonto}
        forma={forma}
        setForma={setForma}
        errores={errores}
      />
      <Campo
        etiqueta="Fecha en que la dejó"
        type="date"
        min={sumarDias(hoyAR, -DIAS_SENA_ATRAS)}
        max={hoyAR}
        value={fecha}
        onChange={(e) => {
          if (e.target.value) setFecha(e.target.value);
        }}
        error={errores.fecha}
        ayuda="Entra en la caja de ese día."
      />
      <div className="fila-botones">
        {actual ? (
          <Boton variante="fantasma" className="btn-texto-peligro" onClick={() => { setConfirmando(true); }} disabled={guardando}>
            Quitar seña
          </Boton>
        ) : null}
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar seña
        </Boton>
      </div>
      <Confirmar
        abierto={confirmando}
        titulo="¿Quitar la seña?"
        confirmar="Sí, quitarla"
        ocupado={quitando}
        onConfirmar={() => void quitar()}
        onCancelar={() => { setConfirmando(false); }}
      >
        Hacelo si se la devolviste al cliente: deja de contar en la caja del día en que la dejó
        {actual?.formaPago ? ` (${NOMBRE_PAGO[actual.formaPago]})` : ''}.
      </Confirmar>
    </form>
  );
}

