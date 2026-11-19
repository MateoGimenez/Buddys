import { movimientos } from '../../api/recetas';
import type { Insumo } from '../../api/types';
import { Aviso, Boton, Cargando } from '../../components/ui';
import { diaMes, hora, hoy, numero, pesos } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { NOMBRE_UNIDAD } from './unidades';

const NOMBRE_TIPO = { uso: 'Uso', compra: 'Compra', ajuste: 'Ajuste' } as const;

/**
 * Los últimos movimientos de un insumo. Los que hizo un lavado solo (receta del servicio) llevan la marca
 * "Automático". El costo de una compra solo lo ve quien ve importes (el backend lo manda null al empleado).
 */
export function Movimientos({ insumo, veImportes }: { insumo: Insumo; veImportes: boolean }) {
  const [carga, recargar] = useCarga(() => movimientos(insumo.id), [insumo.id, insumo.stock]);
  if (carga.estado === 'error' && !carga.datos) {
    return (
      <Aviso titulo="No pudimos cargar los movimientos" accion={<Boton chico onClick={recargar}>Reintentar</Boton>}>
        {carga.mensaje}
      </Aviso>
    );
  }
  if (!carga.datos) return <Cargando texto="Cargando los movimientos…" />;
  const { movimientos: lista, total } = carga.datos;
  if (lista.length === 0) return <p className="nota-chica">Todavía no hay movimientos.</p>;
  const unidad = NOMBRE_UNIDAD[insumo.unidad][1];
  return (
    <div className="movimientos">
      <ul className="lista-simple" aria-label={`Movimientos de ${insumo.nombre}`}>
        {lista.map((m) => (
          <li key={m.id} className="fila-simple movimiento" data-automatico={m.automatico ? '' : undefined}>
            <div className="fila-simple-principal">
              <span className="fila-simple-titulo">
                {NOMBRE_TIPO[m.tipo]}
                {m.automatico ? <span className="etiqueta etiqueta-auto">Automático</span> : null}
              </span>
              <span className="movimiento-cantidad" data-sale={m.cantidad < 0 ? '' : undefined}>
                {m.cantidad > 0 ? '+' : '−'}
                {numero(Math.abs(m.cantidad))} {unidad}
              </span>
            </div>
            <p className="fila-simple-detalle">
              {hoy(new Date(m.createdAt)) === hoy() ? `Hoy ${hora(m.createdAt)}` : diaMes(hoy(new Date(m.createdAt)))}
              {m.persona ? ` · ${m.persona.nombre}` : ''}
              {m.nota ? ` · ${m.nota}` : ''}
              {veImportes && m.costoTotal !== null ? ` · ${pesos(m.costoTotal)}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {total > lista.length ? <p className="nota-chica">Se muestran los {lista.length} más recientes de {total}.</p> : null}
    </div>
  );
}
