import { ChevronRight } from 'lucide-react';
import type { Cierre } from '../../api/finanzas';
import { Aviso, Boton, Cargando, Vacio } from '../../components/ui';
import { fechaLarga } from '../../lib/format';
import type { Carga } from '../../lib/useCarga';
import { textoDiferencia, tonoDe } from './datos';

/** Los cierres de los últimos 31 días, más nuevos primero. Tocar uno lleva a ese día. */
export function Historial({
  carga,
  recargar,
  fechaActual,
  onElegir,
}: {
  carga: Carga<{ cierres: Cierre[]; total: number }>;
  recargar: () => void;
  fechaActual: string;
  onElegir: (fecha: string) => void;
}) {
  return (
    <section className="hoja bloque historial-caja" aria-labelledby="historial-titulo">
      <h2 id="historial-titulo" className="bloque-titulo">
        Cierres anteriores
      </h2>
      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar los cierres" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {carga.mensaje}
        </Aviso>
      ) : null}
      {!carga.datos ? (
        carga.estado === 'cargando' ? <Cargando texto="Cargando los cierres…" /> : null
      ) : carga.datos.cierres.length === 0 ? (
        <Vacio titulo="Todavía no hay cierres">Cuando cierres la caja de un día, queda acá con su diferencia.</Vacio>
      ) : (
        <ul className="historial-lista">
          {carga.datos.cierres.map((c) => (
            <li key={c.fecha}>
              <button
                type="button"
                className="historial-fila"
                aria-current={c.fecha === fechaActual ? 'date' : undefined}
                onClick={() => {
                  onElegir(c.fecha);
                }}
              >
                <span className="historial-fecha">{fechaLarga(c.fecha)}</span>
                <span className="historial-dif" data-tono={tonoDe(c.diferencia)}>
                  {textoDiferencia(c.diferencia)}
                </span>
                <span className="historial-quien">
                  {c.cerradoPor ? c.cerradoPor.nombre : ''}
                  {c.cambiosDespues ? ' · cambió después' : ''}
                </span>
                <ChevronRight aria-hidden size={20} className="historial-flecha" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {carga.datos && carga.datos.total > carga.datos.cierres.length ? (
        <p className="nota-chica">
          Se muestran los {carga.datos.cierres.length} más recientes de {carga.datos.total}.
        </p>
      ) : null}
    </section>
  );
}
