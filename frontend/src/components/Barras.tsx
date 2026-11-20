import { useState } from 'react';
import { diaMes, nombreMes } from '../lib/format';
import { type Agrupado, agruparSerie, esDiaria } from '../lib/series';
import { Segmentado } from './ui';

export interface PuntoBarras {
  /** "YYYY-MM-DD" (un día, o el lunes de una semana) o "YYYY-MM" (un mes). */
  clave: string;
  valor: number;
}

const OPCIONES: { valor: Agrupado; etiqueta: string }[] = [
  { valor: 'dia', etiqueta: 'Día' },
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
];

function etiqueta(clave: string, agrupado: Agrupado): string {
  if (clave.length === 7) return nombreMes(clave).split(' ')[0] ?? clave;
  return agrupado === 'semana' ? `sem. ${diaMes(clave)}` : diaMes(clave);
}

function etiquetaLarga(clave: string, agrupado: Agrupado): string {
  if (clave.length === 7) return nombreMes(clave);
  return agrupado === 'semana' ? `Semana del ${diaMes(clave)}` : diaMes(clave);
}

/**
 * Gráfico de barras de una serie en el tiempo (Números, Mis lavados y Consumo). Las barras son para mirar; los
 * valores, para el lector de pantalla, van en una tabla que no se ve. Con `agrupable` y una serie por día, se elige
 * verla por día, semana (desde el lunes) o mes (contrato reportes/2026-11-19_10_graficos.md).
 */
export function Barras({
  titulo,
  puntos,
  formato,
  corto = (v) => String(v),
  agrupable = false,
}: {
  titulo: string;
  puntos: PuntoBarras[];
  formato: (v: number) => string;
  /** El valor escrito arriba de cada barra cuando son pocas (semanas, meses): corto para que entre. */
  corto?: (v: number) => string;
  agrupable?: boolean;
}) {
  const [agrupado, setAgrupado] = useState<Agrupado>('dia');
  const diaria = esDiaria(puntos);
  const efectivo: Agrupado = diaria ? agrupado : 'mes';
  const serie = agrupable && diaria ? agruparSerie(puntos, agrupado) : puntos;
  const max = Math.max(1, ...serie.map((p) => p.valor));
  const mejor = serie.reduce<PuntoBarras | null>((acc, p) => (!acc || p.valor > acc.valor ? p : acc), null);
  const primero = serie[0];
  // serie[serie.length - 1] y no .at(-1): .at no existe en Chrome < 92 (el panel apunta a Chrome 80).
  const ultimo = serie[serie.length - 1];
  // Hasta 8 barras se escribe el valor arriba de cada una: no hay que adivinarlo por la altura.
  const conValores = serie.length <= 8;
  return (
    <figure className="barras">
      <figcaption>
        {titulo}
        {mejor && mejor.valor > 0 ? (
          <span className="barras-mejor">
            {' '}
            · mejor: {etiqueta(mejor.clave, efectivo)}, {formato(mejor.valor)}
          </span>
        ) : null}
      </figcaption>
      {agrupable && diaria && puntos.length > 1 ? (
        <Segmentado<Agrupado>
          leyenda={`Ver ${titulo.toLowerCase()} por`}
          leyendaOculta
          nombre={`agrupado-${titulo}`}
          valor={agrupado}
          onCambio={setAgrupado}
          opciones={OPCIONES}
        />
      ) : null}
      <div
        className="barras-area"
        aria-hidden
        data-pocas={serie.length <= 12 ? '' : undefined}
        data-valores={conValores ? '' : undefined}
      >
        {serie.map((p) => (
          <span key={p.clave} className="grafico-col" title={`${etiquetaLarga(p.clave, efectivo)}: ${formato(p.valor)}`}>
            <span className="grafico-relleno" style={{ blockSize: `${(p.valor / max) * 100}%` }}>
              {conValores ? <span className="grafico-valor">{corto(p.valor)}</span> : null}
            </span>
          </span>
        ))}
      </div>
      <div className="barras-eje" aria-hidden>
        <span>{primero ? etiqueta(primero.clave, efectivo) : ''}</span>
        <span>{ultimo && ultimo !== primero ? etiqueta(ultimo.clave, efectivo) : ''}</span>
      </div>
      <table className="solo-lectores">
        <caption>
          {titulo}
          {agrupable && diaria ? `, por ${OPCIONES.find((o) => o.valor === agrupado)?.etiqueta.toLowerCase() ?? 'día'}` : ''}
        </caption>
        <tbody>
          {serie.map((p) => (
            <tr key={p.clave}>
              <th scope="row">{etiquetaLarga(p.clave, efectivo)}</th>
              <td>{formato(p.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
