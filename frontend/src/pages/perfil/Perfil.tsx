import { ChevronRight, LogOut, Palette, Save } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, mensajeDeError } from '../../api/client';
import { NOMBRE_MAX, NOMBRE_MIN, cambiarNombre, miPerfil, type Perfil as DatosPerfil } from '../../api/perfil';
import { nombreDe } from '../../components/Layout';
import { Aviso, Boton, Campo, Encabezado } from '../../components/ui';
import { NOMBRE_ROL } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { useSesion, useUsuario } from '../../session/SessionContext';
import { CambiarClave } from './CambiarClave';
import { FotoPerfil } from './FotoPerfil';

/**
 * Tu perfil (todos los roles): la foto, el nombre que sale en la planilla y el ranking, el email y el rol (solo
 * lectura), la contraseña, cómo se ve la pantalla (en Más) y cerrar sesión. Arranca con los datos de la sesión y se
 * pone al día con GET /api/admin/perfil.
 */
export function Perfil() {
  const usuario = useUsuario();
  const { salir, actualizarUsuario } = useSesion();
  const [carga, recargar, actualizar] = useCarga(() => miPerfil().then((r) => r.perfil), []);
  const [saliendo, setSaliendo] = useState(false);

  const perfil: Pick<DatosPerfil, 'nombre' | 'email' | 'rol' | 'avatarUrl'> = carga.datos ?? {
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    avatarUrl: usuario.avatarUrl ?? null,
  };
  const nombre = nombreDe(perfil);

  const cambio = (c: Partial<DatosPerfil>) => {
    actualizar((prev) => ({ ...prev, ...c }));
    actualizarUsuario(c);
  };

  return (
    <>
      <Encabezado titulo="Tu perfil" />
      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos traer tu perfil" accion={<Boton chico onClick={recargar}>Reintentar</Boton>}>
          {carga.mensaje} Mientras tanto ves lo que ya sabíamos.
        </Aviso>
      ) : null}

      <div className="perfil">
        {carga.datos ? (
          <FotoPerfil nombre={nombre} perfil={carga.datos} onCambio={cambio} />
        ) : (
          <section className="hoja perfil-foto" aria-busy="true">
            <h2 className="solo-lectores">Tu foto</h2>
            <div className="perfil-foto-marco" data-ocupado="">
              <span className="avatar avatar-esperando" data-tamano="grande" aria-hidden />
            </div>
            <p className="perfil-foto-estado" role="status">
              {carga.estado === 'cargando' ? 'Cargando tu foto…' : ''}
            </p>
          </section>
        )}

        <div className="perfil-datos">
          <Nombre actual={perfil.nombre ?? ''} onGuardado={(p) => { cambio({ nombre: p.nombre }); }} />

          <section className="hoja bloque" aria-labelledby="perfil-cuenta-t">
            <h2 id="perfil-cuenta-t" className="bloque-titulo">
              Tu cuenta
            </h2>
            <dl className="perfil-cuenta">
              <div>
                <dt>Email</dt>
                <dd>{perfil.email ?? 'Sin email'}</dd>
              </div>
              <div>
                <dt>Rol</dt>
                <dd>{NOMBRE_ROL[perfil.rol]}</dd>
              </div>
            </dl>
            <p className="campo-ayuda">El email y el rol los cambia el dueño desde Equipo.</p>
          </section>

          <CambiarClave />

          <nav aria-label="Más opciones">
            <ul className="menu">
              <li>
                <Link to="/mas" className="menu-item" viewTransition>
                  <Palette aria-hidden size={22} />
                  <span className="menu-texto">
                    <span className="menu-nombre">Cómo se ve la pantalla</span>
                    <span className="menu-desc">Claro, oscuro o alto contraste, en Más</span>
                  </span>
                  <ChevronRight aria-hidden size={20} />
                </Link>
              </li>
            </ul>
          </nav>

          <Boton
            variante="secundario"
            className="btn-ancho"
            cargando={saliendo}
            icono={<LogOut aria-hidden size={20} />}
            onClick={() => {
              setSaliendo(true);
              void salir().finally(() => {
                setSaliendo(false);
              });
            }}
          >
            Cerrar sesión
          </Boton>
        </div>
      </div>
    </>
  );
}

function Nombre({ actual, onGuardado }: { actual: string; onGuardado: (p: DatosPerfil) => void }) {
  const [nombre, setNombre] = useState(actual);
  const [base, setBase] = useState(actual);
  const [errorCampo, setErrorCampo] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Si llega el perfil del servidor con otro nombre y no se tocó el campo, se muestra ese.
  if (actual !== base) {
    setBase(actual);
    if (nombre === base) setNombre(actual);
  }

  const limpio = nombre.trim().replace(/\s+/g, ' ');
  const cambiado = limpio !== actual.trim();

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    setListo(false);
    setError(null);
    if (limpio.length < NOMBRE_MIN || limpio.length > NOMBRE_MAX) {
      setErrorCampo(`Escribí entre ${String(NOMBRE_MIN)} y ${String(NOMBRE_MAX)} letras.`);
      return;
    }
    setErrorCampo(undefined);
    setGuardando(true);
    try {
      const { perfil } = await cambiarNombre(limpio);
      setNombre(perfil.nombre ?? limpio);
      setListo(true);
      onGuardado(perfil);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields?.nombre) setErrorCampo(err.fields.nombre);
      else setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="hoja bloque" aria-labelledby="perfil-nombre-t">
      <h2 id="perfil-nombre-t" className="bloque-titulo">
        Tu nombre
      </h2>
      <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
        <Campo
          etiqueta="Nombre"
          name="nombre"
          autoComplete="name"
          maxLength={NOMBRE_MAX}
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setListo(false);
          }}
          error={errorCampo}
          ayuda="Es el que sale en la planilla y en el ranking."
        />
        {error ? <Aviso titulo="No pudimos guardar tu nombre">{error}</Aviso> : null}
        {listo ? <Aviso tipo="ok" titulo="Listo, guardamos tu nombre" /> : null}
        <Boton type="submit" variante="primario" cargando={guardando} disabled={!cambiado || guardando} icono={<Save aria-hidden size={20} />}>
          Guardar nombre
        </Boton>
      </form>
    </section>
  );
}
