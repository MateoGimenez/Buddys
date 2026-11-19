import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { cambiarTurno, type TurnoAgenda } from '../../api/agenda';
import { FORMAS_PAGO, type FormaPago } from '../../api/types';
import { Aviso, Boton, Campo, Segmentado } from '../../components/ui';
import { enteroDesdeTexto, miles, NOMBRE_PAGO, pesos } from '../../lib/format';
import { totalDeLista } from './datos';

/**
 * Completar un turno con seña: el total del trabajo (incluye la seña) y el saldo que falta cobrar = total - seña.
 * Solo para quien ve importes. El empleado lo marca terminado sin monto (ver TarjetaTurno).
 */
export function Completar({ turno, onListo, onCancelar }: { turno: TurnoAgenda; onListo: (t: TurnoAgenda) => void; onCancelar: () => void }) {
  const lista = totalDeLista(turno);
  const [total, setTotal] = useState(lista === null ? '' : miles(String(lista)));
  const [forma, setForma] = useState<FormaPago | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const sena = turno.sena?.monto ?? 0;
  const n = enteroDesdeTexto(total);
  const saldo = n === null ? null : n - sena;

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (n === null) {
      setErrores({ monto: 'Poné el total del trabajo (con la seña incluida).' });
      return;
    }
    if (n < sena) {
      setErrores({ monto: 'El total no puede ser menor que la seña que ya se cobró.' });
      return;
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      const { booking } = await cambiarTurno(turno.id, { estado: 'completado', monto: n, ...(forma ? { formaPago: forma } : {}) });
      onListo(booking);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario completar" onSubmit={(e) => void guardar(e)} noValidate>
      {error && !errores.monto ? <Aviso>{error}</Aviso> : null}
      <Campo
        etiqueta="Total del trabajo"
        prefijo="$"
        inputMode="numeric"
        autoFocus
        value={total}
        onChange={(e) => {
          setTotal(miles(e.target.value));
        }}
        error={errores.monto}
        ayuda={sena ? `Con la seña de ${pesos(sena)} incluida.` : 'Lo que se cobró por todo el trabajo.'}
      />
      {sena ? (
        <dl className="saldo">
          <div>
            <dt>Seña ya cobrada</dt>
            <dd>{pesos(sena)}</dd>
          </div>
          <div className="saldo-final">
            <dt>Saldo a cobrar</dt>
            <dd>{saldo === null ? '—' : pesos(Math.max(0, saldo))}</dd>
          </div>
        </dl>
      ) : null}
      <Segmentado<FormaPago>
        leyenda={sena ? 'Cómo paga el saldo' : 'Forma de pago'}
        nombre={`pago-${turno.id}`}
        variante="fichas"
        valor={forma}
        onCambio={setForma}
        onQuitar={() => {
          setForma(null);
        }}
        opciones={FORMAS_PAGO.map((f) => ({ valor: f, etiqueta: NOMBRE_PAGO[f] }))}
        error={errores.formaPago}
      />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Completar turno
        </Boton>
      </div>
    </form>
  );
}
