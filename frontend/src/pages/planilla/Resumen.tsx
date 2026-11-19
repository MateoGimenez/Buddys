import { useRef } from 'react';
import type { PlanillaDelDia } from '../../api/types';
import { pesos } from '../../lib/format';
import { Avatar } from '../../components/Avatar';
import { useAvatares } from '../../lib/avatares';
import { useContador, useFlip } from '../../lib/movimiento';

/** Una cifra que, si cambia mientras se mira (llegó un lavado, se corrigió un monto), cuenta hasta el valor nuevo. */
export function Cifra({ valor, formato = String }: { valor: number; formato?: (n: number) => string }) {
  return <>{formato(useContador(valor))}</>;
}

export function Resumen({ datos, veImportes }: { datos: PlanillaDelDia; veImportes: boolean }) {
  const { resumen } = datos;
  const lider = resumen.porTrabajador[0];
  const listaRef = useRef<HTMLOListElement>(null);
  const avatar = useAvatares();
  // El ranking se reordena deslizándose cuando alguien pasa adelante.
  useFlip(listaRef, resumen.porTrabajador.map((r) => r.trabajador?.id ?? '-').join(','));
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

      {resumen.porTrabajador.length ? (
        <div className="ranking">
          <h3 className="ranking-titulo">Quién lavó más</h3>
          <ol className="ranking-lista" ref={listaRef}>
            {resumen.porTrabajador.map((r, i) => {
              const ancho = lider ? Math.max(0.08, r.cantidad / lider.cantidad) : 0;
              const clave = r.trabajador?.id ?? 'sin-asignar';
              return (
                <li key={clave} data-flip={clave} className="ranking-fila" data-primero={i === 0 ? '' : undefined}>
                  <span className="ranking-puesto">{i + 1}</span>
                  <Avatar nombre={r.trabajador?.nombre ?? '?'} url={avatar(r.trabajador?.id, r.trabajador?.avatarUrl)} />
                  <span className="ranking-nombre">{r.trabajador?.nombre ?? 'Sin asignar'}</span>
                  <span className="ranking-barra" aria-hidden>
                    <span style={{ transform: `scaleX(${String(ancho)})` }} />
                  </span>
                  <span className="ranking-cantidad">
                    {r.cantidad} {r.cantidad === 1 ? 'lavado' : 'lavados'}
                  </span>
                  {veImportes && r.total !== null ? <span className="ranking-total">{pesos(r.total)}</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
