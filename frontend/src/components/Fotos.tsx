import { Camera, ImageOff, Trash2 } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import {
  FOTOS_MAX,
  borrarFoto,
  confirmarFoto,
  fotosDelLavado,
  pedirSubida,
  subirArchivo,
  type FotoConUrl,
  type SubidaFirmada,
  type TipoFoto,
} from '../api/fotos';
import { achicarFoto } from '../lib/achicarFoto';
import { hora } from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useSesion, useUsuario } from '../session/SessionContext';
import { Aviso, Boton, Cargando, Confirmar } from './ui';

const NOMBRE_TIPO: Record<TipoFoto, string> = { antes: 'Antes', despues: 'Después' };
/** El empleado puede borrar una foto suya hasta 5 minutos después de subirla. */
const PLAZO_BORRAR_MS = 5 * 60_000;

function useBorraFoto(): (f: FotoConUrl) => boolean {
  const usuario = useUsuario();
  const { puede } = useSesion();
  const tiene = puede('fotos.borrar');
  return (f) => {
    if (!tiene) return false;
    if (usuario.rol !== 'empleado') return true;
    return f.creadaPor?.id === usuario.id && Date.now() - Date.parse(f.createdAt) < PLAZO_BORRAR_MS;
  };
}

/** Una foto ya pedida a la API que falta subir o confirmar. */
interface Pendiente {
  tipo: TipoFoto;
  blob: Blob;
  fotoId: string;
  subida: SubidaFirmada['subida'];
  paso: 'subir' | 'confirmar';
}

function mensajeDeFoto(err: unknown): string {
  if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
    return 'Se subieron muchas fotos seguidas. Esperá unos minutos y probá de nuevo.';
  }
  return mensajeDeError(err);
}

/** Un botón que abre la cámara del celular (en la compu, el selector de archivos). */
function SacarFoto({ tipo, deshabilitado, onFoto }: { tipo: TipoFoto; deshabilitado: boolean; onFoto: (tipo: TipoFoto, f: File) => void }) {
  const id = useId();
  return (
    <label className="btn btn-secundario fotos-sacar" htmlFor={id} data-deshabilitado={deshabilitado ? '' : undefined}>
      <Camera aria-hidden size={20} />
      Foto de {NOMBRE_TIPO[tipo].toLowerCase()}
      <input
        id={id}
        className="solo-lectores"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={deshabilitado}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFoto(tipo, f);
        }}
      />
    </label>
  );
}

/**
 * Fotos de antes y después de un lavado: sacarlas con la cámara (se achican acá antes de subir), verlas y borrarlas
 * según el rol. Si las fotos están apagadas en el servidor, no se muestra nada.
 */
export function Fotos({ lavadoId, titulo = 'Fotos' }: { lavadoId: string; titulo?: string }) {
  const { puede } = useSesion();
  const sube = puede('fotos.subir');
  const borra = useBorraFoto();
  const [carga, recargar, actualizar] = useCarga(() => fotosDelLavado(lavadoId), [lavadoId]);
  const [subiendo, setSubiendo] = useState<TipoFoto | null>(null);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<FotoConUrl | null>(null);
  const [borrando, setBorrando] = useState(false);
  const tituloId = useId();

  if (carga.estado === 'cargando' && !carga.datos) return <Cargando texto="Cargando las fotos…" />;
  if (!carga.datos) {
    return (
      <Aviso titulo="No pudimos cargar las fotos" accion={<Boton chico onClick={recargar}>Reintentar</Boton>}>
        {carga.estado === 'error' ? carga.mensaje : null}
      </Aviso>
    );
  }
  if (!carga.datos.disponible) return null;
  const { fotos } = carga.datos;
  const llenas = fotos.length >= FOTOS_MAX;

  /** Sube (si hace falta) y confirma una foto ya pedida. Si falla, queda para "Reintentar". */
  const terminar = async (p: Pendiente) => {
    setSubiendo(p.tipo);
    setError(null);
    let paso = p.paso;
    try {
      if (paso === 'subir') {
        await subirArchivo(p.subida, p.blob);
        paso = 'confirmar';
      }
      await confirmarFoto(lavadoId, p.fotoId);
      setPendiente(null);
      recargar();
    } catch (err) {
      // La subida venció o el archivo no sirvió: el backend ya borró la foto pendiente, hay que sacarla de nuevo.
      const sinArreglo = err instanceof ApiError && (err.status === 400 || (err.status === 409 && err.message.includes('venció')));
      // "Todavía no subiste la foto": se vuelve a subir el mismo archivo.
      const reSubir = err instanceof ApiError && err.status === 409 && !sinArreglo;
      setPendiente(sinArreglo ? null : { ...p, paso: reSubir ? 'subir' : paso });
      setError(mensajeDeFoto(err));
    } finally {
      setSubiendo(null);
    }
  };

  const subir = async (tipo: TipoFoto, archivo: File) => {
    setSubiendo(tipo);
    setError(null);
    setPendiente(null);
    let pedida: Pendiente;
    try {
      const { blob, tipo: contentType } = await achicarFoto(archivo);
      const { foto, subida } = await pedirSubida(lavadoId, { tipo, contentType, tamano: blob.size });
      pedida = { tipo, blob, fotoId: foto.id, subida, paso: 'subir' };
    } catch (err) {
      setError(err instanceof Error && err.name === 'FotoIlegible' ? err.message : mensajeDeFoto(err));
      setSubiendo(null);
      return;
    }
    await terminar(pedida);
  };

  const descartar = async () => {
    if (!pendiente) return;
    const p = pendiente;
    setPendiente(null);
    setError(null);
    // La foto quedó pedida (cuenta para el tope): se borra para liberar el lugar. Si falla, la ve el encargado.
    try {
      await borrarFoto(lavadoId, p.fotoId);
    } catch {
      // sin nada más que hacer
    }
  };

  const confirmarBorrar = async () => {
    if (!aBorrar) return;
    setBorrando(true);
    setError(null);
    try {
      await borrarFoto(lavadoId, aBorrar.id);
      actualizar((prev) => ({ ...prev, fotos: prev.fotos.filter((f) => f.id !== aBorrar.id) }));
      setABorrar(null);
    } catch (err) {
      setABorrar(null);
      setError(mensajeDeError(err));
    } finally {
      setBorrando(false);
    }
  };

  return (
    <section className="fotos" aria-labelledby={tituloId} aria-busy={subiendo !== null}>
      <h3 className="fotos-titulo" id={tituloId}>
        {titulo} <span className="fotos-cuenta">{fotos.length} de {FOTOS_MAX}</span>
      </h3>
      {fotos.length ? (
        <ul className="fotos-galeria">
          {fotos.map((f) => (
            <li key={f.id} className="fotos-item">
              {f.url ? (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="fotos-marco">
                  <img src={f.url} alt={`Foto de ${NOMBRE_TIPO[f.tipo].toLowerCase()}, ${hora(f.createdAt)}`} loading="lazy" />
                </a>
              ) : (
                <span className="fotos-marco fotos-sin-url">
                  <ImageOff aria-hidden size={22} />
                  <span>No se pudo abrir</span>
                </span>
              )}
              <span className="fotos-tipo" data-tipo={f.tipo}>
                {NOMBRE_TIPO[f.tipo]}
              </span>
              {borra(f) ? (
                <Boton
                  chico
                  variante="fantasma"
                  className="btn-texto-peligro fotos-borrar"
                  aria-label={`Borrar foto de ${NOMBRE_TIPO[f.tipo].toLowerCase()} de las ${hora(f.createdAt)}`}
                  icono={<Trash2 aria-hidden size={18} />}
                  onClick={() => {
                    setABorrar(f);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nota-chica">Todavía no hay fotos. Sirven para mostrarle al cliente cómo quedó.</p>
      )}
      {error ? (
        <Aviso
          titulo="La foto no se guardó"
          accion={
            pendiente && !subiendo ? (
              <div className="fila-botones">
                <Boton chico variante="fantasma" onClick={() => void descartar()}>
                  Descartar
                </Boton>
                <Boton chico variante="secundario" onClick={() => void terminar(pendiente)}>
                  Reintentar
                </Boton>
              </div>
            ) : undefined
          }
        >
          {error}
        </Aviso>
      ) : null}
      {sube && !pendiente ? (
        llenas ? (
          <p className="nota-chica">Ya hay {FOTOS_MAX} fotos: borrá una para sacar otra.</p>
        ) : (
          <div className="fotos-acciones">
            {subiendo ? (
              <p className="fotos-subiendo" role="status">
                Subiendo la foto de {NOMBRE_TIPO[subiendo].toLowerCase()}…
              </p>
            ) : (
              <>
                <SacarFoto tipo="antes" deshabilitado={false} onFoto={(t, f) => void subir(t, f)} />
                <SacarFoto tipo="despues" deshabilitado={false} onFoto={(t, f) => void subir(t, f)} />
              </>
            )}
          </div>
        )
      ) : null}
      <Confirmar
        abierto={aBorrar !== null}
        titulo="¿Borrar esta foto?"
        confirmar="Sí, borrarla"
        ocupado={borrando}
        onConfirmar={() => void confirmarBorrar()}
        onCancelar={() => {
          setABorrar(null);
        }}
      >
        No se puede recuperar.
      </Confirmar>
    </section>
  );
}
