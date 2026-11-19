import { ImageUp, Trash2 } from 'lucide-react';
import { useId, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import type { Perfil as DatosPerfil } from '../api/types';
import { Avatar } from '../components/Avatar';
import { nombreDe } from '../components/Layout';
import { Aviso, Boton, Campo, Encabezado } from '../components/ui';
import { NOMBRE_ROL } from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useSesion, useUsuario } from '../session/SessionContext';

/** Lo mismo que controla la API (2 MB y JPG, PNG o WebP): se avisa antes de mandar nada. */
export const FOTO_MAX_BYTES = 2 * 1024 * 1024;
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const MENSAJE_PESO = 'La foto pesa más de 2 MB. Elegí una más liviana.';
const MENSAJE_TIPO = 'Subí una foto JPG, PNG o WebP.';

type Resultado = { tipo: 'ok' | 'error'; texto: string } | null;

export function Perfil() {
  const usuario = useUsuario();
  const { actualizarUsuario } = useSesion();
  // Lo que cambia en el perfil va también a la sesión: la barra se actualiza sin recargar.
  const aplicar = (p: DatosPerfil) => {
    actualizarUsuario({ nombre: p.nombre, fotoVersion: p.fotoVersion });
  };
  const [carga, recargar] = useCarga(async () => {
    const r = await ep.perfil();
    aplicar(r.perfil);
    return r;
  }, []);

  return (
    <>
      <Encabezado titulo="Mi perfil" />
      <BloqueFoto
        fotosDisponibles={carga.datos?.fotosDisponibles ?? null}
        error={carga.estado === 'error' ? carga.mensaje : null}
        onReintentar={recargar}
        onCambio={aplicar}
      />
      <BloqueNombre nombreActual={usuario.nombre} onCambio={aplicar} />
      <BloqueContrasena email={usuario.email} />
    </>
  );
}

/* ------------------------------------------------------------------ Foto */

function BloqueFoto({
  fotosDisponibles,
  error,
  onReintentar,
  onCambio,
}: {
  /**
   * null mientras no se sabe (cargando o error): las acciones se muestran igual y la API decide; solo se esconden
   * cuando el servidor dice que no hay fotos (false). Así el bloque no salta en el caso de siempre.
   */
  fotosDisponibles: boolean | null;
  error: string | null;
  onReintentar: () => void;
  onCambio: (p: DatosPerfil) => void;
}) {
  const usuario = useUsuario();
  const [ocupado, setOcupado] = useState<'subiendo' | 'quitando' | null>(null);
  const [resultado, setResultado] = useState<Resultado>(null);
  const tituloId = useId();
  const conFoto = Boolean(usuario.fotoVersion);
  const hayFotos = fotosDisponibles !== false;

  const subir = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    // Se limpia para que elegir de nuevo el mismo archivo vuelva a disparar el cambio.
    e.target.value = '';
    if (!archivo) return;
    if (!TIPOS_FOTO.includes(archivo.type)) {
      setResultado({ tipo: 'error', texto: MENSAJE_TIPO });
      return;
    }
    if (archivo.size > FOTO_MAX_BYTES) {
      setResultado({ tipo: 'error', texto: MENSAJE_PESO });
      return;
    }
    setOcupado('subiendo');
    setResultado(null);
    try {
      const { perfil } = await ep.subirFoto(archivo);
      onCambio(perfil);
      setResultado({ tipo: 'ok', texto: 'Listo, guardamos tu foto.' });
    } catch (err) {
      const campo = err instanceof ApiError ? err.fields?.foto : undefined;
      setResultado({ tipo: 'error', texto: campo ?? mensajeDeError(err) });
    } finally {
      setOcupado(null);
    }
  };

  const quitar = async () => {
    setOcupado('quitando');
    setResultado(null);
    try {
      const { perfil } = await ep.quitarFoto();
      onCambio(perfil);
      setResultado({ tipo: 'ok', texto: 'Quitamos tu foto. Ahora se ven tus iniciales.' });
    } catch (err) {
      setResultado({ tipo: 'error', texto: mensajeDeError(err) });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="hoja perfil-foto" aria-labelledby={tituloId} aria-busy={ocupado ? true : undefined}>
      <div className="perfil-foto-vista" data-ocupado={ocupado ? '' : undefined}>
        <Avatar persona={usuario} tamano={96} />
      </div>
      <div className="perfil-foto-cuerpo">
        <h2 id={tituloId} className="perfil-nombre">
          {nombreDe(usuario)}
        </h2>
        <p className="perfil-detalle">
          {NOMBRE_ROL[usuario.rol]}
          {usuario.email && usuario.nombre ? ` · ${usuario.email}` : ''}
        </p>
        {hayFotos ? (
          <div className="fila-botones fila-botones-inicio perfil-foto-acciones">
            {/* Un input de archivo de verdad, con el botón como etiqueta: anda con teclado, lector y el selector del celular. */}
            <label className="btn btn-secundario btn-chico btn-archivo" data-ocupado={ocupado ? '' : undefined}>
              <input
                type="file"
                className="solo-lectores"
                accept={TIPOS_FOTO.join(',')}
                disabled={ocupado !== null}
                onChange={(e) => void subir(e)}
              />
              <ImageUp aria-hidden size={18} />
              {ocupado === 'subiendo' ? 'Subiendo foto…' : conFoto ? 'Cambiar foto' : 'Subir foto'}
            </label>
            {conFoto ? (
              <Boton
                chico
                variante="fantasma"
                className="btn-texto-peligro"
                icono={<Trash2 aria-hidden size={18} />}
                cargando={ocupado === 'quitando'}
                disabled={ocupado !== null}
                onClick={() => void quitar()}
              >
                {ocupado === 'quitando' ? 'Quitando…' : 'Quitar foto'}
              </Boton>
            ) : null}
          </div>
        ) : null}
        {hayFotos ? <p className="nota-chica">JPG, PNG o WebP, hasta 2 MB. Se recorta cuadrada.</p> : null}
        {error ? (
          <Aviso tipo="info" accion={<Boton chico onClick={onReintentar}>Reintentar</Boton>}>
            No pudimos cargar tu perfil. {error}
          </Aviso>
        ) : null}
        {/* El cambio del botón no se anuncia solo: el lector de pantalla escucha esto mientras se sube o se quita. */}
        <p className="solo-lectores" role="status">
          {ocupado === 'subiendo' ? 'Subiendo foto…' : ocupado === 'quitando' ? 'Quitando foto…' : ''}
        </p>
        {resultado ? <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Nombre */

function BloqueNombre({ nombreActual, onCambio }: { nombreActual: string | null; onCambio: (p: DatosPerfil) => void }) {
  const [nombre, setNombre] = useState(nombreActual ?? '');
  // Si el nombre de la sesión cambia (lo guardaste acá o llegó el perfil del servidor), el campo lo sigue.
  const [base, setBase] = useState(nombreActual);
  if (nombreActual !== base) {
    setBase(nombreActual);
    setNombre(nombreActual ?? '');
  }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const tituloId = useId();
  const limpio = nombre.trim();
  const sinCambios = limpio === (nombreActual ?? '');

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (sinCambios) return;
    setGuardando(true);
    setError(null);
    setListo(false);
    try {
      const { perfil } = await ep.editarPerfil({ nombre: limpio || null });
      onCambio(perfil);
      setListo(true);
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.nombre ? err.fields.nombre : mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" aria-labelledby={tituloId} onSubmit={(e) => void guardar(e)} noValidate>
      <h2 id={tituloId} className="bloque-titulo">
        Nombre
      </h2>
      <Campo
        etiqueta="Tu nombre"
        value={nombre}
        maxLength={80}
        autoComplete="name"
        enterKeyHint="done"
        error={error ?? undefined}
        ayuda="Es el que ve el equipo en la planilla. Si lo dejás vacío, se muestra tu email."
        onChange={(e) => {
          setNombre(e.target.value);
          setListo(false);
        }}
      />
      {listo ? <Aviso tipo="ok">Listo, guardamos tu nombre.</Aviso> : null}
      <div className="fila-botones">
        <Boton type="submit" variante="primario" cargando={guardando} disabled={guardando || sinCambios}>
          Guardar nombre
        </Boton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ Contraseña */

const bytes = (s: string) => new TextEncoder().encode(s).length;

function BloqueContrasena({ email }: { email: string | null }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const tituloId = useId();

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!actual) locales.passwordActual = 'Escribí tu contraseña actual.';
    if (nueva.length < 8) locales.passwordNueva = 'La nueva tiene que tener al menos 8 caracteres.';
    else if (bytes(nueva) > 72) locales.passwordNueva = 'La nueva es demasiado larga. Usá hasta 72 caracteres.';
    if (!locales.passwordNueva && repetida !== nueva) locales.repetida = 'No coincide con la nueva. Escribila igual en los dos campos.';
    setErrores(locales);
    setListo(false);
    setError(null);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    try {
      await ep.editarPerfil({ passwordActual: actual, passwordNueva: nueva });
      setActual('');
      setNueva('');
      setRepetida('');
      setListo(true);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrores(err.fields);
        // Con el error ya al lado del campo, arriba no se repite.
        if (!err.fields.passwordActual && !err.fields.passwordNueva) setError(mensajeDeError(err));
      } else {
        setError(mensajeDeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" aria-labelledby={tituloId} onSubmit={(e) => void guardar(e)} noValidate>
      <h2 id={tituloId} className="bloque-titulo">
        Contraseña
      </h2>
      {/* Para el gestor de contraseñas: sabe de qué cuenta es la contraseña nueva. */}
      {email ? <input type="email" name="username" autoComplete="username" value={email} readOnly hidden /> : null}
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo
        etiqueta="Contraseña actual"
        type="password"
        name="current-password"
        autoComplete="current-password"
        value={actual}
        error={errores.passwordActual}
        onChange={(e) => {
          setActual(e.target.value);
        }}
      />
      <Campo
        etiqueta="Contraseña nueva"
        type="password"
        name="new-password"
        autoComplete="new-password"
        value={nueva}
        error={errores.passwordNueva}
        ayuda="Mínimo 8 caracteres."
        onChange={(e) => {
          setNueva(e.target.value);
        }}
      />
      <Campo
        etiqueta="Repetí la nueva"
        type="password"
        name="new-password-repetida"
        autoComplete="new-password"
        enterKeyHint="done"
        value={repetida}
        error={errores.repetida}
        onChange={(e) => {
          setRepetida(e.target.value);
        }}
      />
      {listo ? <Aviso tipo="ok">Listo, cambiaste tu contraseña. Esta sesión sigue abierta.</Aviso> : null}
      <div className="fila-botones">
        <Boton type="submit" variante="primario" cargando={guardando}>
          Cambiar contraseña
        </Boton>
      </div>
    </form>
  );
}
