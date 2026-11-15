import { AlertTriangle } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { MAX_SERVICIOS, type Servicio, type VehiculoTipo } from '../api/types';
import { pesos, porCategoria, precioPara } from '../lib/format';

/** Tilde dibujada a mano: el trazo se dibuja al elegir (stroke-dashoffset), en vez de aparecer de golpe. */
export function Tilde({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg className={`tilde ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M4.5 12.5l5 5L19.5 7" pathLength={1} />
    </svg>
  );
}

const FRECUENTES = 'Frecuentes';

/**
 * Elegir uno o varios servicios: fichas con casilla (checkbox reales), agrupadas por categoría con el encabezado
 * pegado arriba al bajar. Los destacados van primero, en "Frecuentes", así quedan a mano del pulgar. El precio de
 * lista solo aparece si `vePrecios` (el empleado nunca lo ve).
 */
export function ElegirServicios({
  servicios,
  vehiculo,
  elegidos,
  onCambio,
  vePrecios,
  error,
  ayuda,
  leyenda = 'Servicios',
  pegajoso = true,
}: {
  /** Los que se pueden elegir para este vehículo, en el orden del catálogo. */
  servicios: Servicio[];
  vehiculo: VehiculoTipo;
  /** En el orden en que se eligieron (el primero es el principal). */
  elegidos: string[];
  onCambio: (ids: string[]) => void;
  vePrecios: boolean;
  error?: string | undefined;
  ayuda?: ReactNode;
  leyenda?: string;
  pegajoso?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const ayudaId = `${id}-ayuda`;
  const describedBy = [error ? errorId : '', ayuda ? ayudaId : ''].filter(Boolean).join(' ') || undefined;
  const lleno = elegidos.length >= MAX_SERVICIOS;

  const destacados = servicios.filter((s) => s.destacado);
  const resto = porCategoria(servicios.filter((s) => !s.destacado));
  const grupos = destacados.length ? [{ categoria: FRECUENTES, items: destacados }, ...resto] : resto;
  const conTitulos = grupos.length > 1;

  const alternar = (s: Servicio, marcado: boolean) => {
    if (marcado) {
      if (!elegidos.includes(s.id) && !lleno) onCambio([...elegidos, s.id]);
    } else {
      onCambio(elegidos.filter((x) => x !== s.id));
    }
  };

  return (
    <fieldset
      className="servicios"
      data-pegajoso={pegajoso ? '' : undefined}
      aria-describedby={describedBy}
      data-error={error ? '' : undefined}
    >
      <legend>{leyenda}</legend>
      {grupos.map((g, i) => {
        const tituloId = `${id}-g${String(i)}`;
        return (
          <div key={g.categoria} className="servicios-grupo" role={conTitulos ? 'group' : undefined} aria-labelledby={conTitulos ? tituloId : undefined}>
            {conTitulos ? (
              <p className="servicios-categoria" id={tituloId} data-frecuentes={g.categoria === FRECUENTES ? '' : undefined}>
                {g.categoria}
              </p>
            ) : null}
            <div className="servicios-fichas">
              {g.items.map((s) => {
                const marcado = elegidos.includes(s.id);
                const precio = vePrecios ? precioPara(s, vehiculo) : null;
                return (
                  <label key={s.id} className="ficha" data-elegida={marcado ? '' : undefined} data-deshabilitada={!marcado && lleno ? '' : undefined}>
                    <input
                      type="checkbox"
                      name="servicios"
                      value={s.id}
                      checked={marcado}
                      disabled={!marcado && lleno}
                      onChange={(e) => {
                        alternar(s, e.target.checked);
                      }}
                    />
                    <span className="ficha-casilla" aria-hidden>
                      <Tilde size={16} />
                    </span>
                    <span className="ficha-texto">{s.nombre}</span>
                    {vePrecios ? (
                      <span className="ficha-precio" data-consultar={precio === null ? '' : undefined}>
                        {precio === null ? 'Consultá' : pesos(precio)}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {error ? (
        <p className="campo-error" id={errorId}>
          <AlertTriangle aria-hidden size={16} />
          {error}
        </p>
      ) : null}
      {ayuda ? (
        <p className="campo-ayuda" id={ayudaId}>
          {ayuda}
        </p>
      ) : null}
    </fieldset>
  );
}
