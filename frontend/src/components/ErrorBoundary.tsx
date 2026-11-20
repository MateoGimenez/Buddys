import { RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportarError } from '../lib/reporteErrores';

interface Props {
  children: ReactNode;
  /** Si cambia (por ejemplo, la ruta), se vuelve a intentar solo. */
  clave?: string;
}

interface Estado {
  error: boolean;
  clave: string | undefined;
}

/**
 * Si una pantalla se rompe, en vez de la página en blanco muestra un aviso amable con "Volver a intentar" y manda el
 * error (sin datos personales) para que se pueda arreglar.
 */
export class ErrorBoundary extends Component<Props, Estado> {
  override state: Estado = { error: false, clave: this.props.clave };

  static getDerivedStateFromError(): Partial<Estado> {
    return { error: true };
  }

  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    if (props.clave !== estado.clave) return { error: false, clave: props.clave };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const conComponentes = new Error(error.message);
    conComponentes.name = error.name;
    conComponentes.stack = `${error.stack ?? ''}\n${info.componentStack ?? ''}`;
    void reportarError(conComponentes);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="hoja fallo" role="alert">
        <h1 className="fallo-titulo">Algo se trabó en esta pantalla</h1>
        <p className="fallo-texto">
          No es nada que hayas hecho vos. Ya nos llegó el aviso para arreglarlo. Lo que ya estaba guardado sigue guardado.
        </p>
        <button
          type="button"
          className="btn btn-primario"
          onClick={() => {
            this.setState({ error: false });
          }}
        >
          <RotateCcw aria-hidden size={18} />
          Volver a intentar
        </button>
      </div>
    );
  }
}
