export interface FilaHorizontal {
  id: string;
  nombre: string;
  /** Lo que mide la barra. */
  valor: number;
  /** Cómo se escribe el valor al final de la fila (con su unidad o en pesos). */
  texto: string;
  /** Una marca sobre la barra en ese valor (por ejemplo el stock mínimo), con su texto para el lector de pantalla. */
  marca?: { valor: number; texto: string };
  /** Resalta la fila (por ejemplo, un insumo por debajo del mínimo): nunca solo el color, el texto también lo dice. */
  alerta?: boolean;
}

/**
 * Barras horizontales con nombre (consumo por insumo, lo que falta comprar). Cada fila: nombre, barra proporcional al
 * máximo y el valor escrito. Una marca opcional (el mínimo) sobre la barra. Para el lector de pantalla, la tabla con
 * los mismos valores (contrato reportes/2026-11-19_10_graficos.md).
 */
export function BarrasHorizontales({
  titulo,
  filas,
  maximo,
  columnas = ['Insumo', 'Valor'],
}: {
  titulo: string;
  filas: FilaHorizontal[];
  /** Por defecto, el mayor valor (o marca) de las filas. */
  maximo?: number;
  columnas?: [string, string];
}) {
  const max = Math.max(1, maximo ?? 0, ...filas.map((f) => Math.max(f.valor, f.marca?.valor ?? 0)));
  const pct = (v: number) => `${String(Math.max(0, Math.min(100, (v / max) * 100)))}%`;
  return (
    <figure className="barras-h">
      <figcaption>{titulo}</figcaption>
      <ul className="barras-h-lista" aria-hidden>
        {filas.map((f) => (
          <li key={f.id} className="barras-h-fila" data-alerta={f.alerta ? '' : undefined}>
            <span className="barras-h-nombre">{f.nombre}</span>
            <span className="barras-h-pista">
              <span className="barras-h-relleno" style={{ inlineSize: pct(f.valor) }} />
              {f.marca ? <span className="barras-h-marca" style={{ insetInlineStart: pct(f.marca.valor) }} /> : null}
            </span>
            <span className="barras-h-valor">{f.texto}</span>
          </li>
        ))}
      </ul>
      <table className="solo-lectores">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">{columnas[0]}</th>
            <th scope="col">{columnas[1]}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.nombre}</th>
              <td>
                {f.texto}
                {f.marca ? ` (${f.marca.texto})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
