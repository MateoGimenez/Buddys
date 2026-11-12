import { LogIn } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import { Aviso, Boton, Campo } from '../components/ui';
import { useSesion } from '../session/SessionContext';

export function Login({ aviso }: { aviso?: string }) {
  const { ingresar } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});

  const enviar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const faltan: Record<string, string> = {};
    if (!email.trim()) faltan.email = 'Escribí tu email.';
    if (!password) faltan.password = 'Escribí tu contraseña.';
    setCampos(faltan);
    if (Object.keys(faltan).length) {
      setError(null);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await ingresar(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setCampos(err.fields);
      setError(mensajeDeError(err));
      setPassword('');
      setEnviando(false);
    }
  };

  return (
    <main className="login">
      <div className="login-hoja">
        <img className="login-logo" src="/logo.png" alt="Buddys Wash Detail" width={300} height={72} />
        <h1 className="login-titulo">Panel del lavadero</h1>
        <p className="login-texto">Ingresá con el email y la contraseña que te dio el dueño.</p>

        {aviso && !error ? <Aviso tipo="info">{aviso}</Aviso> : null}
        {error ? <Aviso titulo="No pudimos ingresar">{error}</Aviso> : null}

        <form className="formulario" onSubmit={(e) => void enviar(e)} noValidate>
          <Campo
            etiqueta="Email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            error={campos.email}
          />
          <Campo
            etiqueta="Contraseña"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            error={campos.password}
          />
          <Boton type="submit" variante="primario" cargando={enviando} icono={<LogIn aria-hidden size={20} />} className="btn-ancho">
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </Boton>
        </form>
        <p className="login-pie">¿Te olvidaste la contraseña? Pedile una nueva al dueño.</p>
      </div>
    </main>
  );
}
