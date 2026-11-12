import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/* ------------------------------------------------------------------ Botón */

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro';

interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  cargando?: boolean;
  icono?: ReactNode;
  chico?: boolean;
}

export function Boton({ variante = 'secundario', cargando = false, icono, chico, children, className, disabled, ...rest }: BotonProps) {
  const clases = ['btn', `btn-${variante}`, chico ? 'btn-chico' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={clases} disabled={disabled ?? cargando} aria-busy={cargando || undefined}>
      {cargando ? <Loader2 className="girando" aria-hidden size={18} /> : icono}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Campos */

interface CampoBase {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: string | undefined;
}

function useIds(error: string | undefined, ayuda: ReactNode) {
  const id = useId();
  const ayudaId = ayuda ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, ayudaId].filter(Boolean).join(' ') || undefined;
  return { id, ayudaId, errorId, describedBy };
}

function Pie({ ayudaId, ayuda, errorId, error }: { ayudaId?: string | undefined; ayuda?: ReactNode; errorId?: string | undefined; error?: string | undefined }) {
  return (
    <>
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
    </>
  );
}

export function Campo({ etiqueta, ayuda, error, prefijo, className, ...rest }: CampoBase & InputHTMLAttributes<HTMLInputElement> & { prefijo?: string }) {
  const { id, ayudaId, errorId, describedBy } = useIds(error, ayuda);
  return (
    <div className={`campo ${className ?? ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <div className={`entrada ${prefijo ? 'con-prefijo' : ''}`} data-invalido={error ? '' : undefined}>
        {prefijo ? <span className="prefijo" aria-hidden>{prefijo}</span> : null}
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      </div>
      <Pie ayudaId={ayudaId} ayuda={ayuda} errorId={errorId} error={error} />
    </div>
  );
}

export function AreaTexto({ etiqueta, ayuda, error, className, ...rest }: CampoBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { id, ayudaId, errorId, describedBy } = useIds(error, ayuda);
  return (
    <div className={`campo ${className ?? ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <div className="entrada" data-invalido={error ? '' : undefined}>
        <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} rows={3} {...rest} />
      </div>
      <Pie ayudaId={ayudaId} ayuda={ayuda} errorId={errorId} error={error} />
    </div>
  );
}

export function Selector({ etiqueta, ayuda, error, className, children, ...rest }: CampoBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const { id, ayudaId, errorId, describedBy } = useIds(error, ayuda);
  return (
    <div className={`campo ${className ?? ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <div className="entrada entrada-select" data-invalido={error ? '' : undefined}>
        <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>
          {children}
        </select>
      </div>
      <Pie ayudaId={ayudaId} ayuda={ayuda} errorId={errorId} error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Opciones segmentadas (radio) */

interface Opcion<T extends string> {
  valor: T;
  etiqueta: ReactNode;
  detalle?: ReactNode;
  deshabilitada?: boolean;
}

export function Segmentado<T extends string>({
  leyenda,
  nombre,
  opciones,
  valor,
  onCambio,
  error,
  variante = 'barra',
  leyendaOculta,
}: {
  leyenda: string;
  nombre: string;
  opciones: Opcion<T>[];
  valor: T | null;
  onCambio: (v: T) => void;
  error?: string | undefined;
  variante?: 'barra' | 'grilla';
  leyendaOculta?: boolean;
}) {
  const errorId = useId();
  return (
    <fieldset className={`segmentado segmentado-${variante}`} aria-describedby={error ? errorId : undefined}>
      <legend className={leyendaOculta ? 'solo-lectores' : undefined}>{leyenda}</legend>
      <div className="segmentado-opciones">
        {opciones.map((o) => (
          <label key={o.valor} className="opcion" data-elegida={valor === o.valor ? '' : undefined} data-deshabilitada={o.deshabilitada ? '' : undefined}>
            <input
              type="radio"
              name={nombre}
              value={o.valor}
              checked={valor === o.valor}
              disabled={o.deshabilitada}
              onChange={() => {
                onCambio(o.valor);
              }}
            />
            <span className="opcion-texto">{o.etiqueta}</span>
            {o.detalle ? <span className="opcion-detalle">{o.detalle}</span> : null}
          </label>
        ))}
      </div>
      {error ? (
        <p className="campo-error" id={errorId}>
          <AlertTriangle aria-hidden size={16} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ Avisos */

export function Aviso({ tipo = 'error', titulo, children, accion }: { tipo?: 'error' | 'ok' | 'info'; titulo?: string; children?: ReactNode; accion?: ReactNode }) {
  const Icono = tipo === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      {tipo === 'info' ? null : <Icono aria-hidden size={20} className="aviso-icono" />}
      <div className="aviso-cuerpo">
        {titulo ? <p className="aviso-titulo">{titulo}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {accion ? <div className="aviso-accion">{accion}</div> : null}
    </div>
  );
}

export function Vacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="vacio">
      <p className="vacio-titulo">{titulo}</p>
      {children ? <p className="vacio-texto">{children}</p> : null}
      {accion}
    </div>
  );
}

export function Esqueleto({ filas = 3 }: { filas?: number }) {
  return (
    <div className="esqueleto" aria-hidden>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto-fila" />
      ))}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="solo-lectores">{texto}</span>
      <Esqueleto />
    </div>
  );
}

/* ------------------------------------------------------------------ Diálogo de confirmación (<dialog> nativo) */

export function Confirmar({
  abierto,
  titulo,
  children,
  confirmar,
  variante = 'peligro',
  ocupado,
  onConfirmar,
  onCancelar,
}: {
  abierto: boolean;
  titulo: string;
  children?: ReactNode;
  confirmar: string;
  variante?: Variante;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!abierto && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      className="dialogo"
      aria-labelledby={tituloId}
      onCancel={(e) => {
        e.preventDefault();
        onCancelar();
      }}
    >
      <h2 id={tituloId} className="dialogo-titulo">
        {titulo}
      </h2>
      {children ? <div className="dialogo-cuerpo">{children}</div> : null}
      <div className="dialogo-acciones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Boton>
        <Boton variante={variante} onClick={onConfirmar} cargando={ocupado ?? false}>
          {confirmar}
        </Boton>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ Encabezado de página */

export function Encabezado({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <header className="pagina-encabezado">
      <h1>{titulo}</h1>
      {children ? <div className="pagina-encabezado-extra">{children}</div> : null}
    </header>
  );
}
