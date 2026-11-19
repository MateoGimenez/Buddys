import { Lock } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { cerrarCaja, type CajaEsperada, type Cierre } from '../../api/finanzas';
import { FORMAS_PAGO } from '../../api/types';
import { AreaTexto, Aviso, Boton, Campo } from '../../components/ui';
import { miles, NOMBRE_PAGO, pesos } from '../../lib/format';
import { contadoDe, CONTEO_VACIO, diferenciaEnVivo, esperadoPorForma, textoDiferencia, tonoDe, type Conteo } from './datos';
import { Diferencia } from './Diferencia';

/**
 * El arqueo: lo que hay contado en la caja, forma por forma, contra lo esperado. La diferencia se ve mientras se
 * escribe. `inicial` llega cuando el superadmin corrige un cierre ya hecho.
 */
export function Arqueo({
  fecha,
  esperado,
  inicial,
  notaInicial,
  corrigiendo,
  onListo,
  onCancelar,
  onYaCerrada,
}: {
  fecha: string;
  esperado: CajaEsperada;
  inicial?: Conteo;
  notaInicial?: string | null;
  corrigiendo?: boolean;
  onListo: (c: Cierre) => void;
  onCancelar?: () => void;
  /** Otra persona cerró este día mientras se contaba (409): se avisa y se recarga el cierre que quedó. */
  onYaCerrada: (mensaje: string) => void;
}) {
  const [conteo, setConteo] = useState<Conteo>(inicial ?? CONTEO_VACIO);
  const [nota, setNota] = useState(notaInicial ?? '');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const porForma = esperadoPorForma(esperado.formas);
  const dif = diferenciaEnVivo(conteo, porForma);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const contado = contadoDe(conteo);
    if (!contado) {
      setErrores({ 'contado.efectivo': 'Contá el efectivo de la caja (si no hay, poné 0).' });
      return;
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      const { cierre } = await cerrarCaja(fecha, contado, nota.trim() || null);
      onListo(cierre);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || (err.status === 403 && err.message.includes('ya está cerrada')))) {
        onYaCerrada(`Mientras contabas, otra persona cerró la caja de este día. Te mostramos su cierre: revisalo antes de seguir. (${err.message})`);
        return;
      }
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja arqueo" onSubmit={(e) => void guardar(e)} noValidate aria-labelledby="arqueo-titulo">
      <h2 id="arqueo-titulo" className="bloque-titulo">
        {corrigiendo ? 'Corregir el cierre' : 'Contá la caja'}
      </h2>
      <p className="nota-chica">Escribí lo que hay de verdad. Lo que no cuentes queda afuera del arqueo; el efectivo es obligatorio.</p>
      {error ? <Aviso>{error}</Aviso> : null}
      <div className="arqueo-formas">
        {FORMAS_PAGO.map((f) => {
          const texto = conteo[f];
          const contado = texto ? Number(texto.replace(/\D/g, '')) : null;
          const d = contado === null ? null : contado - porForma[f];
          return (
            <div key={f} className="arqueo-forma">
              <Campo
                etiqueta={f === 'efectivo' ? 'Efectivo (en la caja)' : NOMBRE_PAGO[f]}
                prefijo="$"
                inputMode="numeric"
                autoComplete="off"
                placeholder={f === 'efectivo' ? '' : 'No lo conté'}
                value={texto}
                onChange={(e) => {
                  setConteo({ ...conteo, [f]: miles(e.target.value) });
                }}
                ayuda={`Esperado ${pesos(porForma[f])}`}
                error={errores[`contado.${f}`]}
              />
              {d === null ? null : (
                <p className="arqueo-forma-dif" data-tono={tonoDe(d)}>
                  {textoDiferencia(d)}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {esperado.sinIndicar > 0 ? (
        <p className="arqueo-sin-indicar">
          {pesos(esperado.sinIndicar)} se cobraron sin forma de pago y no entran en ninguna casilla.
        </p>
      ) : null}
      <AreaTexto
        etiqueta="Nota (opcional)"
        rows={2}
        maxLength={500}
        value={nota}
        onChange={(e) => {
          setNota(e.target.value);
        }}
        placeholder="Por ejemplo: faltan 500 de cambio"
        error={errores.nota}
      />
      <div className="arqueo-pie">
        <Diferencia valor={dif} enVivo />
        <div className="fila-botones">
          {onCancelar ? (
            <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
              Cancelar
            </Boton>
          ) : null}
          <Boton type="submit" variante="primario" cargando={guardando} icono={<Lock aria-hidden size={18} />}>
            {corrigiendo ? 'Guardar corrección' : 'Cerrar la caja'}
          </Boton>
        </div>
      </div>
    </form>
  );
}
