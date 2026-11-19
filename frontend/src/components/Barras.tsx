import { diaMes, nombreMes } from '../lib/format';

export interface PuntoBarras {
  /** "YYYY-MM-DD" (un día, o el lunes de una semana) o "YYYY-MM" (un mes). */
  clave: string;
  valor: number;
}

function etiqueta(clave: string): string {
  return clave.length === 7 ? (nombreMes(clave).split(' ')[0] ?? clave) : diaMes(clave);
}

/**
 * Gráfico de barras de una serie (Números y Consumo). Las barras son para mirar; los valores, para el lector de
 * pantalla, van en una tabla que no se ve.
 */
export function Barras({ titulo, puntos, formato }: { titulo: string; puntos: PuntoBarras[]; formato: (v: number) => string }) {
  const max = Math.max(1, ...puntos.map((p) => p.valor));
  const mejor = puntos.reduce<PuntoBarras | null>((acc, p) => (!acc || p.valor > acc.valor ? p : acc), null);
  return (
    <figure className="barras">
      <figcaption>
        {titulo}
        {mejor && mejor.valor > 0 ? <span className="barras-mejor"> · mejor: {etiqueta(mejor.clave)}, {formato(mejor.valor)}</span> : null}
      </figcaption>
      <div className="barras-area" aria-hidden>
        {puntos.map((p) => (
          <span key={p.clave} className="grafico-col" title={`${etiqueta(p.clave)}: ${formato(p.valor)}`}>
            <span className="grafico-relleno" style={{ blockSize: `${(p.valor / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="barras-eje" aria-hidden>
        <span>{puntos[0] ? etiqueta(puntos[0].clave) : ''}</span>
        <span>{puntos.at(-1) ? etiqueta(puntos.at(-1)?.clave ?? '') : ''}</span>
      </div>
      <table className="solo-lectores">
        <caption>{titulo}</caption>
        <tbody>
          {puntos.map((p) => (
            <tr key={p.clave}>
              <th scope="row">{etiqueta(p.clave)}</th>
              <td>{formato(p.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
