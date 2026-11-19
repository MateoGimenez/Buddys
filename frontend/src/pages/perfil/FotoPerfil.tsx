import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import {
  AVATAR_BYTES_MAX,
  AVATAR_LADO,
  confirmarAvatar,
  pedirSubidaAvatar,
  sacarAvatar,
  subirAvatar,
  type FormatoAvatar,
  type Perfil,
} from '../../api/perfil';
import { Avatar } from '../../components/Avatar';
import { Aviso, Boton, Confirmar } from '../../components/ui';
import { achicarFoto } from '../../lib/achicarFoto';

/** Una foto ya achicada que falta subir o confirmar (para "Reintentar" sin volver a elegirla). */
interface Pendiente {
  blob: Blob;
  tipo: FormatoAvatar;
  paso: 'pedir' | 'confirmar';
}

type Etapa = 'achicando' | 'subiendo' | 'confirmando' | 'sacando' | null;

const TEXTO_ETAPA: Record<Exclude<Etapa, null>, string> = {
  achicando: 'Preparando la foto…',
  subiendo: 'Subiendo la foto…',
  confirmando: 'Guardando la foto…',
  sacando: 'Quitando la foto…',
};

/**
 * ¿El servidor tiene las fotos apagadas? (contrato 04: 503 "Las fotos de perfil no están configuradas en el
 * servidor."). Un 503 de Storage caído por un rato no cuenta: ese se puede reintentar.
 */
function esSinStorage(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503 && /configurad/i.test(err.message);
}

function mensajeDeAvatar(err: unknown): string {
  if (err instanceof Error && err.name === 'FotoIlegible') return err.message;
  if (err instanceof ApiError && err.status === 429) {
    return err.message || 'Cambiaste la foto muchas veces seguidas. Esperá unos minutos y probá de nuevo.';
  }
  return mensajeDeError(err);
}

interface Props {
  nombre: string;
  perfil: Pick<Perfil, 'avatarUrl'>;
  /** La foto quedó guardada (o se quitó): el perfil nuevo para la pantalla y la sesión. */
  onCambio: (cambio: Pick<Perfil, 'avatarUrl' | 'avatarVenceEl'>) => void;
}

/**
 * La foto de perfil: grande, con "Cambiar foto" (cámara o galería) y "Quitar foto". Se recorta al cuadrado del medio y
 * se achica acá (400 px, hasta 512 KB) antes de subirla en tres pasos: pedir la URL, subir el archivo y confirmar.
 */
export function FotoPerfil({ nombre, perfil, onCambio }: Props) {
  const inputId = useId();
  const estadoId = useId();
  const [etapa, setEtapa] = useState<Etapa>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [aQuitar, setAQuitar] = useState(false);
  // El servidor no avisa de antemano que las fotos están apagadas (avatarUrl viene null): se sabe al intentar.
  const [sinStorage, setSinStorage] = useState<string | null>(null);
  const ocupado = etapa !== null;

  // La vista previa (la foto elegida mientras sube) es una URL local: se libera al cambiarla o al salir.
  useEffect(
    () => () => {
      if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    },
    [vistaPrevia],
  );

  if (sinStorage) {
    return (
      <section className="hoja perfil-foto" aria-labelledby={`${inputId}-t`}>
        <h2 id={`${inputId}-t`} className="solo-lectores">
          Tu foto
        </h2>
        <Avatar nombre={nombre} url={null} tamano="grande" alt={`Sin foto: ${nombre}`} />
        <p className="perfil-foto-nota" role="status">
          {sinStorage} Por ahora vas a aparecer con tus iniciales.
        </p>
      </section>
    );
  }

  /** Pasos 1 a 3 con una foto ya achicada. Si algo falla, queda para "Reintentar". */
  const terminar = async (p: Pendiente) => {
    setError(null);
    let paso = p.paso;
    try {
      if (paso === 'pedir') {
        setEtapa('subiendo');
        const { subida } = await pedirSubidaAvatar({ contentType: p.tipo, tamano: p.blob.size });
        await subirAvatar(subida, p.blob);
        paso = 'confirmar';
      }
      setEtapa('confirmando');
      const { perfil: nuevo } = await confirmarAvatar();
      setPendiente(null);
      setVistaPrevia(null);
      setListo('Listo, ya tenés foto nueva.');
      onCambio({ avatarUrl: nuevo.avatarUrl, avatarVenceEl: nuevo.avatarVenceEl });
    } catch (err) {
      if (esSinStorage(err)) {
        setSinStorage(mensajeDeError(err));
        return;
      }
      // 400: la foto no sirve (hay que elegir otra). 409: no llegó o la URL venció: se pide una nueva con la misma foto.
      const noSirve = err instanceof ApiError && err.status === 400;
      const reSubir = err instanceof ApiError && err.status === 409;
      if (noSirve) {
        setPendiente(null);
        setVistaPrevia(null);
      } else {
        setPendiente({ ...p, paso: reSubir ? 'pedir' : paso });
      }
      setError(mensajeDeAvatar(err));
    } finally {
      setEtapa(null);
    }
  };

  const elegida = async (archivo: File) => {
    setError(null);
    setListo(null);
    setPendiente(null);
    setEtapa('achicando');
    let p: Pendiente;
    try {
      const { blob, tipo } = await achicarFoto(archivo, { ladoMax: AVATAR_LADO, bytesMax: AVATAR_BYTES_MAX, cuadrado: true });
      p = { blob, tipo, paso: 'pedir' };
    } catch (err) {
      setError(mensajeDeAvatar(err));
      setEtapa(null);
      return;
    }
    try {
      setVistaPrevia(URL.createObjectURL(p.blob));
    } catch {
      // sin vista previa: se ve la foto anterior hasta que termine
    }
    await terminar(p);
  };

  const quitar = async () => {
    setEtapa('sacando');
    setError(null);
    setListo(null);
    try {
      await sacarAvatar();
      setAQuitar(false);
      setPendiente(null);
      setVistaPrevia(null);
      setListo('Listo, quitamos tu foto.');
      onCambio({ avatarUrl: null, avatarVenceEl: null });
    } catch (err) {
      setAQuitar(false);
      if (esSinStorage(err)) setSinStorage(mensajeDeError(err));
      else setError(mensajeDeAvatar(err));
    } finally {
      setEtapa(null);
    }
  };

  const url = vistaPrevia ?? perfil.avatarUrl;
  const tieneFoto = Boolean(perfil.avatarUrl);

  return (
    <section className="hoja perfil-foto" aria-labelledby={`${inputId}-t`} aria-busy={ocupado} aria-describedby={estadoId}>
      <h2 id={`${inputId}-t`} className="solo-lectores">
        Tu foto
      </h2>
      <div className="perfil-foto-marco" data-ocupado={ocupado ? '' : undefined}>
        <Avatar nombre={nombre} url={url} tamano="grande" alt={tieneFoto || vistaPrevia ? 'Tu foto de perfil' : `Sin foto: ${nombre}`} />
      </div>
      <p className="perfil-foto-estado" id={estadoId} role="status" aria-live="polite">
        {etapa ? TEXTO_ETAPA[etapa] : (listo ?? '')}
      </p>
      {error ? (
        <Aviso
          titulo="No pudimos cambiar la foto"
          accion={
            pendiente ? (
              <Boton chico onClick={() => void terminar(pendiente)} disabled={ocupado}>
                Reintentar
              </Boton>
            ) : null
          }
        >
          {error}
        </Aviso>
      ) : null}
      <div className="perfil-foto-acciones">
        {/* Sin `capture`: el celular ofrece sacarla con la cámara o elegirla de la galería. */}
        <label className="btn btn-secundario perfil-elegir" htmlFor={inputId} data-deshabilitado={ocupado ? '' : undefined}>
          <ImagePlus aria-hidden size={20} />
          {tieneFoto ? 'Cambiar foto' : 'Poner foto'}
          <input
            id={inputId}
            className="solo-lectores"
            type="file"
            accept="image/*"
            disabled={ocupado}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void elegida(f);
            }}
          />
        </label>
        {tieneFoto ? (
          <Boton
            variante="fantasma"
            icono={<Trash2 aria-hidden size={20} />}
            disabled={ocupado}
            onClick={() => {
              setAQuitar(true);
            }}
          >
            Quitar foto
          </Boton>
        ) : null}
      </div>
      <Confirmar
        abierto={aQuitar}
        titulo="¿Quitar tu foto?"
        confirmar="Quitar foto"
        ocupado={etapa === 'sacando'}
        onConfirmar={() => void quitar()}
        onCancelar={() => {
          setAQuitar(false);
        }}
      >
        En el ranking y en el equipo vas a aparecer con tus iniciales. Podés poner otra cuando quieras.
      </Confirmar>
    </section>
  );
}
