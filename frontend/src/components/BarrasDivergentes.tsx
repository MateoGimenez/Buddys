export interface FilaDivergente {
  id: string;
  nombre: string;
  /** Con signo: negativo hacia la izquierda, positivo hacia la derecha, cero en el eje. */
  valor: number;
  /** El valor escrito, con su signo y lo que significa ("Faltan $ 500", "Justo"). */
  texto: string;
}

/**
 * Barras con signo alrededor de un eje (diferencias de caja: lo que faltó a la izquierda, lo que sobró a la derecha).
 * El color acompaña pero nunca está solo: cada fila tiene su texto con el signo. Tabla para el lector de pantalla
 * (contrato reportes/2026-11-19_10_graficos.md).
 */
export function BarrasDivergentes({ titulo, filas, nota }: { titulo: string; filas: FilaDivergente[]; nota?: string }) {
  const max = Math.max(1, ...filas.map((f) => Math.abs(f.valor)));
  return (
    <figure className="barras-d">
      <figcaption>{titulo}</figcaption>
      <div className="barras-d-leyenda" aria-hidden>
        <span>← Faltó</span>
        <span>Sobró →</span>
      </div>
      <ul className="barras-d-lista" aria-hidden>
        {filas.map((f) => {
          const tono = f.valor < 0 ? 'falta' : f.valor > 0 ? 'sobra' : 'justo';
          const ancho = `${String((Math.abs(f.valor) / max) * 50)}%`;
          return (
            <li key={f.id} className="barras-d-fila" data-tono={tono}>
              <span className="barras-d-nombre">{f.nombre}</span>
              <span className="barras-d-pista">
                <span className="barras-d-relleno" style={{ inlineSize: tono === 'justo' ? undefined : ancho }} />
              </span>
              <span className="barras-d-valor">{f.texto}</span>
            </li>
          );
        })}
      </ul>
      {nota ? <p className="nota-chica">{nota}</p> : null}
      {/* La tabla va dentro de un div oculto: una <table> no respeta el ancho de 1 px y desbordaba la pantalla. */}
      <div className="solo-lectores">
        <table>
          <caption>{titulo}</caption>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.nombre}</th>
                <td>{f.texto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
