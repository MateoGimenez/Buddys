import { LockOpen, Pencil } from 'lucide-react';
import { useState } from 'react';
import { mensajeDeError } from '../../api/client';
import { reabrirCaja, type CajaEsperada, type Cierre } from '../../api/finanzas';
import { Aviso, Boton, Confirmar } from '../../components/ui';
import { fechaCorta, hora, hoy, NOMBRE_PAGO, pesos } from '../../lib/format';
import { textoDiferencia, tonoDe } from './datos';
import { Diferencia } from './Diferencia';

/** Una caja ya cerrada: la foto de lo esperado, lo contado y la diferencia. Corregir o reabrir solo el superadmin. */
export function CierreHecho({
  cierre,
  esperadoAhora,
  reabre,
  onCorregir,
  onReabierta,
}: {
  cierre: Cierre;
  esperadoAhora: CajaEsperada;
  reabre: boolean;
  onCorregir: () => void;
  onReabierta: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const corregido = cierre.actualizadoEl !== cierre.cerradoEl;

  const reabrir = async () => {
    setReabriendo(true);
    setError(null);
    try {
      await reabrirCaja(cierre.fecha);
      setConfirmando(false);
      onReabierta();
    } catch (err) {
      setConfirmando(false);
      setError(mensajeDeError(err));
    } finally {
      setReabriendo(false);
    }
  };

  return (
    <section className="hoja cierre" aria-labelledby="cierre-titulo">
      <div className="cierre-cabeza">
        <h2 id="cierre-titulo" className="bloque-titulo">
          Caja cerrada
        </h2>
        <span className="cierre-sello">Cerrada</span>
      </div>
      <p className="nota-chica">
        {cierre.cerradoPor ? `La cerró ${cierre.cerradoPor.nombre}` : 'Cerrada'} el {fechaCorta(hoy(new Date(cierre.cerradoEl)))} a las{' '}
        {hora(cierre.cerradoEl)}
        {corregido ? `. Corregida a las ${hora(cierre.actualizadoEl)}` : ''}.
      </p>

      {cierre.cambiosDespues ? (
        <Aviso tipo="error" titulo="Después de cerrar se cambió un lavado de este día">
          Lo esperado ahora es {pesos(esperadoAhora.total)} y al cerrar era {pesos(cierre.esperadoTotal)}.
          {reabre ? ' Corregí el cierre para que quede al día.' : ' Avisale al dueño para que corrija el cierre.'}
        </Aviso>
      ) : null}

      <div className="tabla-scroll">
        <table className="tabla cierre-tabla">
          <thead>
            <tr>
              <th scope="col">Forma</th>
              <th scope="col" className="num">Esperado</th>
              <th scope="col" className="num">Contado</th>
            </tr>
          </thead>
          <tbody>
            {cierre.formas.map((f) => (
              <tr key={f.formaPago} data-no-contada={f.contado === null ? '' : undefined}>
                <th scope="row">{NOMBRE_PAGO[f.formaPago]}</th>
                <td className="num">{pesos(f.esperado)}</td>
                <td className="num">
                  {f.contado === null ? <span className="cierre-sin-contar">Sin contar</span> : pesos(f.contado)}
                  {f.diferencia === null ? null : (
                    <span className="cierre-dif" data-tono={tonoDe(f.diferencia)}>
                      {f.diferencia === 0 ? 'Justo' : textoDiferencia(f.diferencia)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">{pesos(cierre.esperadoTotal)}</td>
              <td className="num">{pesos(cierre.contadoTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {cierre.sinIndicar > 0 ? (
        <p className="nota-chica">El esperado total incluye {pesos(cierre.sinIndicar)} cobrados sin forma de pago.</p>
      ) : null}

      <Diferencia valor={cierre.diferencia} />
      {cierre.nota ? (
        <p className="cierre-nota">
          <span className="solo-lectores">Nota: </span>
          {cierre.nota}
        </p>
      ) : null}

      {error ? <Aviso>{error}</Aviso> : null}
      {reabre ? (
        <div className="fila-botones">
          <Boton variante="fantasma" icono={<LockOpen aria-hidden size={18} />} onClick={() => { setConfirmando(true); }}>
            Reabrir
          </Boton>
          <Boton variante="secundario" icono={<Pencil aria-hidden size={18} />} onClick={onCorregir}>
            Corregir el cierre
          </Boton>
        </div>
      ) : (
        <p className="nota-chica">Ya está cerrada. Si hay que corregirla o reabrirla, lo hace el dueño (superadmin).</p>
      )}

      <Confirmar
        abierto={confirmando}
        titulo={`¿Reabrir la caja del ${fechaCorta(cierre.fecha)}?`}
        confirmar="Sí, reabrirla"
        ocupado={reabriendo}
        onConfirmar={() => void reabrir()}
        onCancelar={() => { setConfirmando(false); }}
      >
        Se borra el cierre (lo contado y la nota). Después la podés volver a contar y cerrar.
      </Confirmar>
    </section>
  );
}
