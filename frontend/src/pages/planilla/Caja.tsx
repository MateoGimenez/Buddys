import type { PlanillaDelDia } from '../../api/types';
import { Link } from 'react-router-dom';
import { NOMBRE_PAGO, fechaCorta, hoy, pesos } from '../../lib/format';
import { usePuede } from '../../lib/nivel';
import { Cifra } from './Resumen';

/**
 * "Cobrado hoy" (o "Cobrado el <día>"): cuánto entró por cada forma de pago. No es el cierre de caja (eso es contar la
 * plata, en /caja): de acá se va con "Cerrar la caja de este día" (contrato reportes/2026-11-19_11). El empleado ve solo
 * cuántos lavados por forma de pago ("Cómo pagaron"), nunca importes ni el enlace al cierre.
 */
export function Caja({ datos, veImportes }: { datos: PlanillaDelDia; veImportes: boolean }) {
  const { porFormaPago, total, sinMonto } = datos.resumen;
  const conImportes = veImportes && total !== null;
  const cierra = usePuede('caja.cerrar');
  const titulo = conImportes ? (datos.fecha === hoy() ? 'Cobrado hoy' : `Cobrado el ${fechaCorta(datos.fecha)}`) : 'Cómo pagaron';
  return (
    <section className="caja hoja" aria-labelledby="caja-titulo">
      <h2 id="caja-titulo" className="caja-titulo">
        {titulo}
      </h2>
      <table className="caja-tabla">
        <thead className="solo-lectores">
          <tr>
            <th scope="col">Forma de pago</th>
            <th scope="col">Lavados</th>
            {conImportes ? <th scope="col">Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {porFormaPago.map((f) => (
            <tr key={f.formaPago ?? 'sin-indicar'} data-sin-indicar={f.formaPago === null ? '' : undefined}>
              <th scope="row" className="caja-forma">
                {f.formaPago === null ? 'Sin indicar' : NOMBRE_PAGO[f.formaPago]}
              </th>
              <td className="caja-cantidad">
                {f.cantidad} {f.cantidad === 1 ? 'lavado' : 'lavados'}
              </td>
              {conImportes ? <td className="caja-importe">{f.total === null ? '' : pesos(f.total)}</td> : null}
            </tr>
          ))}
        </tbody>
        {conImportes ? (
          <tfoot>
            <tr>
              <th scope="row" className="caja-forma">
                Total cobrado
              </th>
              <td className="caja-cantidad">
                {datos.resumen.cantidad} {datos.resumen.cantidad === 1 ? 'lavado' : 'lavados'}
              </td>
              <td className="caja-importe">
                <Cifra valor={total} formato={pesos} />
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      {conImportes && sinMonto > 0 ? (
        <p className="caja-nota">
          {sinMonto === 1 ? '1 lavado no tiene monto cargado y no suma.' : `${String(sinMonto)} lavados no tienen monto cargado y no suman.`}
        </p>
      ) : null}
      {conImportes && cierra ? (
        <Link to={`/caja?fecha=${datos.fecha}`} className="caja-cerrar">
          Cerrar la caja de este día
        </Link>
      ) : null}
    </section>
  );
}
