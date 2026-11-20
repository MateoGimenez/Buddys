import { Plus, Trash2 } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import type { Rol, UsuarioEquipo } from '../../api/types';
import { Avatar } from '../../components/Avatar';
import { nombreDe } from '../../components/Layout';
import { Aviso, Boton, Campo, Cargando, Confirmar, Encabezado, Selector, Vacio } from '../../components/ui';
import { filtrarEquipo, OPCIONES_ESTADO, OPCIONES_ROL, type FiltroEstado, type FiltroRol } from '../../lib/equipo';
import { diaMesDeIso, NOMBRE_ROL } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { useSesion, useUsuario } from '../../session/SessionContext';

const ROLES: Rol[] = ['empleado', 'admin', 'superadmin'];

export function Equipo() {
  const yo = useUsuario();
  const { nivel } = useSesion();
  // 'parcial' (admin): solo empleados. No elige roles: lo que crea es empleado y no puede ascender a nadie.
  const asignaRoles = nivel('usuarios.gestionar') === 'si';
  const [carga, recargar, actualizar] = useCarga(() => ep.usuarios(), []);
  const [creando, setCreando] = useState(false);
  const [texto, setTexto] = useState('');
  const [filtroRol, setFiltroRol] = useState<FiltroRol>('todos');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('vigentes');
  // Qué pasó con la última baja o eliminación: con el filtro por defecto la fila desaparece, así que se dice en texto.
  const [hecho, setHecho] = useState<string | null>(null);
  const gestionCuentas = carga.datos?.gestionCuentas !== false;

  const todos = carga.datos?.usuarios ?? [];
  const visibles = filtrarEquipo(todos, texto, filtroRol, filtroEstado);
  const filtrando = texto.trim() !== '' || filtroRol !== 'todos' || filtroEstado !== 'vigentes';
  const limpiar = () => {
    setTexto('');
    setFiltroRol('todos');
    setFiltroEstado('vigentes');
  };

  return (
    <>
      <Encabezado titulo="Equipo">
        {!creando && gestionCuentas ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); setHecho(null); }}>
            {asignaRoles ? 'Nuevo usuario' : 'Nuevo empleado'}
          </Boton>
        ) : null}
      </Encabezado>
      {carga.datos && !gestionCuentas ? (
        <Aviso tipo="info" titulo="Alta de usuarios desactivada">
          Falta configurar la clave secreta de Supabase en el servidor. {asignaRoles ? 'Podés cambiar roles y activar o desactivar' : 'Podés activar o desactivar'}, pero no crear ni eliminar usuarios.
        </Aviso>
      ) : null}
      {hecho ? <Aviso tipo="ok">{hecho}</Aviso> : null}
      {creando ? (
        <NuevoUsuario
          asignaRoles={asignaRoles}
          onListo={() => { setCreando(false); recargar(); }}
          onCancelar={() => { setCreando(false); }}
        />
      ) : null}

      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar el equipo" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>
      ) : null}
      {!carga.datos ? (
        carga.estado === 'cargando' ? <Cargando /> : null
      ) : todos.length === 0 ? (
        <Vacio titulo="No hay usuarios" />
      ) : (
        <>
          <div className="equipo-filtros" role="search" aria-label="Buscar en el equipo">
            <Campo
              etiqueta="Buscar"
              type="search"
              placeholder="Nombre o email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              value={texto}
              onChange={(e) => { setTexto(e.target.value); }}
            />
            <div className="fila-campos equipo-filtros-selects">
              <Selector etiqueta="Rol" value={filtroRol} onChange={(e) => { setFiltroRol(e.target.value as FiltroRol); }}>
                {OPCIONES_ROL.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.texto}</option>
                ))}
              </Selector>
              <Selector etiqueta="Estado" value={filtroEstado} onChange={(e) => { setFiltroEstado(e.target.value as FiltroEstado); }}>
                {OPCIONES_ESTADO.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.texto}</option>
                ))}
              </Selector>
            </div>
          </div>
          <p className="equipo-conteo" role="status">
            {visibles.length === todos.length ? personas(todos.length) : `${String(visibles.length)} de ${personas(todos.length)}`}
          </p>
          {visibles.length === 0 ? (
            <Vacio
              titulo="Nadie coincide"
              accion={filtrando ? <Boton onClick={limpiar}>Limpiar búsqueda y filtros</Boton> : null}
            >
              Probá con otra parte del nombre o del email, o cambiá el rol o el estado.
            </Vacio>
          ) : (
            <ul className="lista-hojas">
              {visibles.map((u) => (
                <FilaUsuario
                  key={u.id}
                  u={u}
                  soyYo={u.id === yo.id}
                  asignaRoles={asignaRoles}
                  eliminable={gestionCuentas}
                  onCambio={(nuevo) => {
                    actualizar((d) => ({ ...d, usuarios: d.usuarios.map((x) => (x.id === nuevo.id ? nuevo : x)) }));
                  }}
                  onBaja={(nuevo) => {
                    actualizar((d) => ({ ...d, usuarios: d.usuarios.map((x) => (x.id === nuevo.id ? nuevo : x)) }));
                    setHecho(`${nombreDe(u)} quedó dado de baja. Lo ves en el estado “Dados de baja”.`);
                  }}
                  onEliminado={() => {
                    actualizar((d) => ({ ...d, usuarios: d.usuarios.filter((x) => x.id !== u.id) }));
                    setHecho(`Se eliminó a ${nombreDe(u)}.`);
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function personas(n: number): string {
  return n === 1 ? '1 persona' : `${String(n)} personas`;
}

function FilaUsuario({
  u,
  soyYo,
  asignaRoles,
  eliminable,
  onCambio,
  onBaja,
  onEliminado,
}: {
  u: UsuarioEquipo;
  soyYo: boolean;
  asignaRoles: boolean;
  /** Sin la clave de Supabase la API no puede borrar ni dar de baja: el botón no aparece. */
  eliminable: boolean;
  onCambio: (u: UsuarioEquipo) => void;
  onBaja: (u: UsuarioEquipo) => void;
  onEliminado: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<'acceso' | 'eliminar' | null>(null);
  const nombre = nombreDe(u);
  const deBaja = u.eliminadoAt !== null;
  // Lo que el rol no puede hacer no aparece: sin selector, sin botones y sin el hueco donde irían.
  const conRol = u.gestionable && asignaRoles;

  const cambiar = async (cambio: { rol?: Rol; activo?: boolean }) => {
    setOcupado(true);
    setError(null);
    try {
      const { usuario } = await ep.editarUsuario(u.id, cambio);
      onCambio(usuario);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setConfirmar(null);
      setOcupado(false);
    }
  };

  const eliminar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await ep.eliminarUsuario(u.id);
      setConfirmar(null);
      setOcupado(false);
      if (r.resultado === 'baja') onBaja(r.usuario);
      else onEliminado();
    } catch (err) {
      setError(mensajeDeError(err));
      setConfirmar(null);
      setOcupado(false);
    }
  };

  const acciones = (
    <div className="fila-botones fila-botones-inicio">
      {u.activo ? (
        <Boton variante="secundario" chico disabled={ocupado} onClick={() => { setConfirmar('acceso'); }}>
          Quitar acceso
        </Boton>
      ) : (
        <Boton variante="primario" chico cargando={ocupado && confirmar === null} disabled={ocupado} onClick={() => void cambiar({ activo: true })}>
          Dar acceso
        </Boton>
      )}
      {eliminable ? (
        <Boton
          chico
          variante="fantasma"
          className="btn-texto-peligro"
          icono={<Trash2 aria-hidden size={18} />}
          disabled={ocupado}
          onClick={() => { setConfirmar('eliminar'); }}
        >
          Eliminar
        </Boton>
      ) : null}
    </div>
  );

  return (
    <li className="hoja fila-hoja" data-inactivo={u.activo ? undefined : ''} data-baja={deBaja ? '' : undefined}>
      <div className="fila-hoja-cabeza fila-hoja-cabeza-avatar">
        <Avatar persona={u} tamano={40} />
        <h2 className="fila-hoja-titulo">
          {nombre}
          {soyYo ? <span className="etiqueta">Vos</span> : null}
        </h2>
        {conRol ? null : <span className="etiqueta etiqueta-rol">{NOMBRE_ROL[u.rol]}</span>}
        {u.eliminadoAt ? (
          <span className="etiqueta etiqueta-apagada">Dado de baja el {diaMesDeIso(u.eliminadoAt)}</span>
        ) : !u.activo ? (
          <span className="etiqueta etiqueta-apagada">Sin acceso</span>
        ) : null}
      </div>
      {u.nombre && u.email ? <p className="fila-hoja-texto">{u.email}</p> : null}
      {error ? <Aviso>{error}</Aviso> : null}
      {u.gestionable ? (
        conRol ? (
          <div className="fila-campos fila-campos-centro">
            <Selector etiqueta={<>Rol{' '}<span className="solo-lectores">de {nombre}</span></>} value={u.rol} disabled={ocupado} onChange={(e) => void cambiar({ rol: e.target.value as Rol })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_ROL[r]}
                </option>
              ))}
            </Selector>
            {acciones}
          </div>
        ) : (
          acciones
        )
      ) : null}
      {u.gestionable ? (
        <>
          <Confirmar
            abierto={confirmar === 'acceso'}
            titulo={`¿Quitarle el acceso a ${nombre}?`}
            confirmar="Quitar acceso"
            ocupado={ocupado}
            onConfirmar={() => void cambiar({ activo: false })}
            onCancelar={() => { setConfirmar(null); }}
          >
            No va a poder entrar al panel desde su próximo pedido. Sus lavados quedan. Lo podés volver a activar cuando quieras.
          </Confirmar>
          <Confirmar
            abierto={confirmar === 'eliminar'}
            titulo={u.tieneHistorial ? `¿Dar de baja a ${nombre}?` : `¿Eliminar a ${nombre}?`}
            confirmar={u.tieneHistorial ? `Dar de baja a ${nombre}` : `Eliminar a ${nombre}`}
            ocupado={ocupado}
            onConfirmar={() => void eliminar()}
            onCancelar={() => { setConfirmar(null); }}
          >
            {u.tieneHistorial
              ? `${nombre} tiene lavados registrados, así que no se borra: se da de baja. No va a poder entrar y su nombre sigue en los lavados viejos.`
              : `Se va a borrar a ${nombre}. No se puede deshacer.`}
          </Confirmar>
        </>
      ) : null}
    </li>
  );
}

function NuevoUsuario({ asignaRoles, onListo, onCancelar }: { asignaRoles: boolean; onListo: () => void; onCancelar: () => void }) {
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
      await ep.crearUsuario({
        email: email.trim(),
        password,
        rol: asignaRoles ? rol : 'empleado',
        activo: true,
        ...(nombre.trim() ? { nombre: nombre.trim() } : {}),
      });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" onSubmit={(e) => void guardar(e)} noValidate>
      <h2 className="bloque-titulo">{asignaRoles ? 'Nuevo usuario' : 'Nuevo empleado'}</h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Nombre" value={nombre} maxLength={80} autoComplete="off" onChange={(e) => { setNombre(e.target.value); }} error={errores.nombre} ayuda="Es el que aparece en la planilla, en cada lavado que registra." />
      <Campo etiqueta="Email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); }} error={errores.email} />
      <Campo etiqueta="Contraseña" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); }} error={errores.password} ayuda="Mínimo 8 caracteres. Pasásela por un canal privado." />
      {asignaRoles ? (
        <Selector etiqueta="Rol" value={rol} onChange={(e) => { setRol(e.target.value as Rol); }} error={errores.rol}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{NOMBRE_ROL[r]}</option>
          ))}
        </Selector>
      ) : null}
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>{asignaRoles ? 'Crear usuario' : 'Crear empleado'}</Boton>
      </div>
    </form>
  );
}
