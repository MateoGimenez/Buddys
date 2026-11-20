import type { PlanillaDelDia } from '../../api/types';
import { pesos } from '../../lib/format';
import { useContador } from '../../lib/movimiento';

/** Una cifra que, si cambia mientras se mira (llegó un lavado, se corrigió un monto), cuenta hasta el valor nuevo. */
export function Cifra({ valor, formato = String }: { valor: number; formato?: (n: number) => string }) {
  return <>{formato(useContador(valor))}</>;
}

export function Resumen({ datos, veImportes }: { datos: PlanillaDelDia; veImportes: boolean }) {
  const { resumen } = datos;
  return (
    <section className="resumen hoja" aria-labelledby="resumen-titulo">
      <h2 id="resumen-titulo" className="solo-lectores">
        Resumen del día
      </h2>
      <dl className="resumen-cifras">
        <div>
          <dt>Lavados</dt>
          <dd className="cifra">
            <Cifra valor={resumen.cantidad} />
          </dd>
        </div>
        {veImportes && resumen.total !== null ? (
          <div>
            <dt>Cobrado</dt>
            <dd className="cifra">
              <Cifra valor={resumen.total} formato={pesos} />
            </dd>
          </div>
        ) : null}
        {veImportes && resumen.sinMonto > 0 ? (
          <div>
            <dt>Sin monto</dt>
            <dd className="cifra cifra-alerta">{resumen.sinMonto}</dd>
          </div>
        ) : null}
      </dl>

    </section>
  );
}
