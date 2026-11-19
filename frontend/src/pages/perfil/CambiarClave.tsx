import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { CLAVE_MIN, cambiarClave } from '../../api/perfil';
import { Aviso, Boton, Campo } from '../../components/ui';

type Errores = Partial<Record<'actual' | 'nueva' | 'repetir', string>>;

/** Cambiar la contraseña: la actual, la nueva (8 o más) y otra vez la nueva. "Mostrar" las deja ver las tres. */
export function CambiarClave() {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [ver, setVer] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Errores = {};
    if (!actual) locales.actual = 'Escribí tu contraseña actual.';
    if (nueva.length < CLAVE_MIN) locales.nueva = `La nueva tiene que tener ${String(CLAVE_MIN)} caracteres o más.`;
    else if (nueva === actual) locales.nueva = 'La nueva tiene que ser distinta de la actual.';
    if (!locales.nueva && repetir !== nueva) locales.repetir = 'No coincide con la nueva. Escribila igual.';
    setErrores(locales);
    setError(null);
    setListo(false);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    try {
      await cambiarClave(actual, nueva);
      setActual('');
      setNueva('');
      setRepetir('');
      setVer(false);
      setListo(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const f = err.fields ?? {};
        if (f.nueva) setErrores({ nueva: f.nueva });
        else setErrores({ actual: f.actual ?? 'La contraseña actual no es esa. Revisala y probá de nuevo.' });
      } else if (err instanceof ApiError && err.status === 429) {
        setError(err.message || 'Probaste muchas veces seguidas. Esperá unos minutos y volvé a intentar.');
      } else {
        setError(mensajeDeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  const tipo = ver ? 'text' : 'password';

  return (
    <section className="hoja bloque" aria-labelledby="perfil-clave-t">
      <h2 id="perfil-clave-t" className="bloque-titulo">
        Contraseña
      </h2>
      <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
        <Campo
          etiqueta="Contraseña actual"
          type={tipo}
          name="actual"
          autoComplete="current-password"
          value={actual}
          onChange={(e) => {
            setActual(e.target.value);
          }}
          error={errores.actual}
        />
        <Campo
          etiqueta="Contraseña nueva"
          type={tipo}
          name="nueva"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => {
            setNueva(e.target.value);
          }}
          error={errores.nueva}
          ayuda={`${String(CLAVE_MIN)} caracteres o más.`}
        />
        <Campo
          etiqueta="Repetí la nueva"
          type={tipo}
          name="repetir"
          autoComplete="new-password"
          value={repetir}
          onChange={(e) => {
            setRepetir(e.target.value);
          }}
          error={errores.repetir}
        />
        <Boton
          variante="fantasma"
          className="perfil-ver"
          aria-pressed={ver}
          icono={ver ? <EyeOff aria-hidden size={20} /> : <Eye aria-hidden size={20} />}
          onClick={() => {
            setVer((v) => !v);
          }}
        >
          Mostrar contraseñas
        </Boton>
        {error ? <Aviso titulo="No pudimos cambiar la contraseña">{error}</Aviso> : null}
        {listo ? (
          <Aviso tipo="ok" titulo="Listo, cambiaste la contraseña">
            La próxima vez entrá con la nueva.
          </Aviso>
        ) : null}
        <Boton type="submit" variante="primario" cargando={guardando} icono={<KeyRound aria-hidden size={20} />}>
          Cambiar contraseña
        </Boton>
      </form>
    </section>
  );
}
