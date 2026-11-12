import { Plus } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import type { Rol, UsuarioEquipo } from '../api/types';
import { nombreDe } from '../components/Layout';
import { Aviso, Boton, Campo, Cargando, Confirmar, Encabezado, Selector, Vacio } from '../components/ui';
import { NOMBRE_ROL } from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useUsuario } from '../session/SessionContext';

const ROLES: Rol[] = ['empleado', 'admin', 'superadmin'];

export function Equipo() {
  const yo = useUsuario();
  const [carga, recargar, actualizar] = useCarga(() => ep.usuarios(), []);
  const [creando, setCreando] = useState(false);
  const gestionCuentas = carga.datos?.gestionCuentas !== false;

  return (
    <>
      <Encabezado titulo="Equipo">
        {!creando && gestionCuentas ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Nuevo usuario
          </Boton>
        ) : null}
      </Encabezado>
      {carga.datos && !gestionCuentas ? (
        <Aviso tipo="info" titulo="Alta de usuarios desactivada">
          Falta configurar la clave secreta de Supabase en el servidor. Podés cambiar roles y activar o desactivar, pero no crear usuarios.
        </Aviso>
      ) : null}
      {creando ? <NuevoUsuario onListo={() => { setCreando(false); recargar(); }} onCancelar={() => { setCreando(false); }} /> : null}

      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar el equipo" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>
      ) : null}
      {!carga.datos ? (carga.estado === 'cargando' ? <Cargando /> : null) : carga.datos.usuarios.length === 0 ? (
        <Vacio titulo="No hay usuarios" />
      ) : (
        <ul className="lista-hojas">
          {carga.datos.usuarios.map((u) => (
            <FilaUsuario
              key={u.id}
              u={u}
              soyYo={u.id === yo.id}
              onCambio={(nuevo) => {
                actualizar((d) => ({ ...d, usuarios: d.usuarios.map((x) => (x.id === nuevo.id ? nuevo : x)) }));
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function FilaUsuario({ u, soyYo, onCambio }: { u: UsuarioEquipo; soyYo: boolean; onCambio: (u: UsuarioEquipo) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarBaja, setConfirmarBaja] = useState(false);

  const cambiar = async (cambio: { rol?: Rol; activo?: boolean }) => {
    setOcupado(true);
    setError(null);
    try {
      const { usuario } = await ep.editarUsuario(u.id, cambio);
      onCambio(usuario);
      setConfirmarBaja(false);
    } catch (err) {
      setError(mensajeDeError(err));
      setConfirmarBaja(false);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className="hoja fila-hoja" data-inactivo={u.activo ? undefined : ''}>
      <div className="fila-hoja-cabeza">
        <h2 className="fila-hoja-titulo">
          {nombreDe(u)}
          {soyYo ? <span className="etiqueta">Vos</span> : null}
        </h2>
        {!u.activo ? <span className="etiqueta etiqueta-apagada">Sin acceso</span> : null}
      </div>
      {u.nombre && u.email ? <p className="fila-hoja-texto">{u.email}</p> : null}
      {error ? <Aviso>{error}</Aviso> : null}
      <div className="fila-campos fila-campos-centro">
        <Selector
          etiqueta="Rol"
          value={u.rol}
          disabled={soyYo || ocupado}
          onChange={(e) => void cambiar({ rol: e.target.value as Rol })}
          ayuda={soyYo ? 'No podés cambiar tu propio rol.' : undefined}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {NOMBRE_ROL[r]}
            </option>
          ))}
        </Selector>
        {soyYo ? null : u.activo ? (
          <Boton variante="secundario" disabled={ocupado} onClick={() => { setConfirmarBaja(true); }}>
            Quitar acceso
          </Boton>
        ) : (
          <Boton variante="primario" cargando={ocupado} onClick={() => void cambiar({ activo: true })}>
            Dar acceso
          </Boton>
        )}
      </div>
      <Confirmar
        abierto={confirmarBaja}
        titulo={`¿Quitarle el acceso a ${nombreDe(u)}?`}
        confirmar="Quitar acceso"
        ocupado={ocupado}
        onConfirmar={() => void cambiar({ activo: false })}
        onCancelar={() => { setConfirmarBaja(false); }}
      >
        No va a poder entrar al panel desde su próximo pedido. Sus lavados quedan. Lo podés volver a activar cuando quieras.
      </Confirmar>
    </li>
  );
}

function NuevoUsuario({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<Rol>('empleado');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!email.trim()) locales.email = 'Escribí el email.';
    if (password.length < 8) locales.password = 'La contraseña tiene que tener al menos 8 caracteres.';
    setErrores(locales);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    setError(null);
    try {
      await ep.crearUsuario({ email: email.trim(), password, rol, activo: true, ...(nombre.trim() ? { nombre: nombre.trim() } : {}) });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" onSubmit={(e) => void guardar(e)} noValidate>
      <h2 className="bloque-titulo">Nuevo usuario</h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Nombre" value={nombre} maxLength={80} autoComplete="off" onChange={(e) => { setNombre(e.target.value); }} error={errores.nombre} ayuda="Es el que aparece en la planilla y el ranking." />
      <Campo etiqueta="Email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); }} error={errores.email} />
      <Campo etiqueta="Contraseña" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); }} error={errores.password} ayuda="Mínimo 8 caracteres. Pasásela por un canal privado." />
      <Selector etiqueta="Rol" value={rol} onChange={(e) => { setRol(e.target.value as Rol); }} error={errores.rol}>
        {ROLES.map((r) => (
          <option key={r} value={r}>{NOMBRE_ROL[r]}</option>
        ))}
      </Selector>
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Crear usuario</Boton>
      </div>
    </form>
  );
}
