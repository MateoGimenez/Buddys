import type { Servicio, Trabajador, Turno } from '../../api/types';
import { NOMBRE_FRANJA, pesos } from '../../lib/format';
import { Copia } from './Copia';

export interface ListaProps {
  lavados: Turno[];
  nombresServicio: Map<string, string>;
  veImportes: boolean;
  corrige: boolean;
  borra: boolean;
  comprobantes: boolean;
  /** Las fotos están prendidas en el servidor. */
  fotos?: boolean;
  equipo: Trabajador[];
  catalogo: Servicio[];
  onCambio: (t: Turno) => void;
  onBorrado: (id: string) => void;
}

export function Lista(props: ListaProps) {
  const { lavados } = props;
  const numerados = lavados.map((l, i) => ({ lavado: l, numero: i + 1 }));
  // Al abrir un día, las copias entran escalonadas (tope: las primeras 8, así nunca se espera de más).
  let orden = 0;
  const manana = numerados.filter((n) => n.lavado.franja === 'manana');
  const tarde = numerados.filter((n) => n.lavado.franja === 'tarde');
  return (
    <>
      {[
        { clave: 'manana' as const, filas: manana },
        { clave: 'tarde' as const, filas: tarde },
      ]
        .filter((g) => g.filas.length)
        .map((g) => {
          const sub = g.filas.reduce((acc, f) => acc + (f.lavado.monto ?? 0), 0);
          return (
            <section key={g.clave} className="franja" aria-labelledby={`franja-${g.clave}`}>
              <h2 id={`franja-${g.clave}`} className="franja-titulo">
                <span>{NOMBRE_FRANJA[g.clave]}</span>
                <span className="franja-total">
                  {g.filas.length} {g.filas.length === 1 ? 'lavado' : 'lavados'}
                  {props.veImportes ? ` · ${pesos(sub)}` : ''}
                </span>
              </h2>
              <ol className="copias">
                {g.filas.map((f) => (
                  <Copia key={f.lavado.id} numero={f.numero} orden={Math.min(orden++, 8)} {...props} lavado={f.lavado} />
                ))}
              </ol>
            </section>
          );
        })}
    </>
  );
}
