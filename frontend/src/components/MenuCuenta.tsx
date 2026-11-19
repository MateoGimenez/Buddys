import { Check, ChevronDown, Contrast, Loader2, LogOut, Moon, Sun, SunMoon, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { NOMBRE_ROL } from '../lib/format';
import { elegirTema, useTema, type Tema } from '../lib/tema';
import { useSesion, useUsuario } from '../session/SessionContext';
import { Avatar } from './Avatar';

const OPCIONES_TEMA: { valor: Tema; etiqueta: string; icono: LucideIcon }[] = [
  { valor: 'auto', etiqueta: 'Automático', icono: SunMoon },
  { valor: 'claro', etiqueta: 'Claro', icono: Sun },
  { valor: 'oscuro', etiqueta: 'Oscuro', icono: Moon },
  { valor: 'contraste', etiqueta: 'Alto contraste', icono: Contrast },
];

/** true si el celular (o la compu) está en modo oscuro: para decir en qué quedó "Automático". */
function useSistemaOscuro(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const consulta = window.matchMedia('(prefers-color-scheme: dark)');
      consulta.addEventListener('change', avisar);
      return () => {
        consulta.removeEventListener('change', avisar);
      };
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
}

/**
 * Menú de la cuenta en la barra: el botón (avatar, nombre y rol; en el celular, solo el avatar) abre Mi perfil, el tema
 * de la pantalla (Automático / Claro / Oscuro / Alto contraste, como menuitemradio: elegir no cierra el menú) y
 * Cerrar sesión. Patrón de menú (APG): flechas, Inicio/Fin, Escape vuelve al botón, Tab sale y lo cierra, un toque
 * afuera lo cierra. Abre siempre hacia abajo desde la esquina de la barra, así que no necesita anchor positioning.
 */
export function MenuCuenta() {
  const usuario = useUsuario();
  const { salir, puede } = useSesion();
  const editaPerfil = puede('perfil.editar');
  const [abierto, setAbierto] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Qué ítem enfocar al abrir: con teclado se entra al menú; con el dedo o el mouse, el foco queda en el botón.
  const entrarEn = useRef<'primero' | 'ultimo' | null>(null);
  const id = useId();
  const botonId = `${id}-boton`;
  const menuId = `${id}-menu`;
  const nombre = usuario.nombre ?? usuario.email ?? 'Sin nombre';
  const tema = useTema();
  const sistemaOscuro = useSistemaOscuro();
  const [noGuarda, setNoGuarda] = useState(false);
  const rol = NOMBRE_ROL[usuario.rol];

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!abierto) return;
    const destino = entrarEn.current;
    entrarEn.current = null;
    if (destino) {
      const lista = items();
      (destino === 'primero' ? lista[0] : lista[lista.length - 1])?.focus();
    }
    // Un toque o un clic fuera del menú lo cierra (sin robarle el foco a lo que se tocó).
    const afuera = (e: PointerEvent) => {
      if (!raizRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', afuera);
    return () => {
      document.removeEventListener('pointerdown', afuera);
    };
  }, [abierto]);

  const abrir = (destino: 'primero' | 'ultimo' | null) => {
    entrarEn.current = destino;
    setAbierto(true);
  };

  const cerrarYVolver = () => {
    setAbierto(false);
    botonRef.current?.focus();
  };

  const alTeclearBoton = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const destino = e.key === 'ArrowDown' ? 'primero' : 'ultimo';
      if (abierto) {
        const lista = items();
        (destino === 'primero' ? lista[0] : lista[lista.length - 1])?.focus();
      } else {
        abrir(destino);
      }
    } else if (e.key === 'Escape' && abierto) {
      e.preventDefault();
      setAbierto(false);
    }
  };

  const alTeclearMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    const lista = items();
    const actual = lista.indexOf(document.activeElement as HTMLElement);
    let siguiente: number | null = null;
    if (e.key === 'ArrowDown') siguiente = (actual + 1) % lista.length;
    else if (e.key === 'ArrowUp') siguiente = (actual - 1 + lista.length) % lista.length;
    else if (e.key === 'Home') siguiente = 0;
    else if (e.key === 'End') siguiente = lista.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cerrarYVolver();
      return;
    } else if (e.key === 'Tab') {
      // Tab sigue de largo (no se atrapa el foco) y el menú no queda abierto detrás.
      setAbierto(false);
      return;
    }
    if (siguiente !== null) {
      e.preventDefault();
      lista[siguiente]?.focus();
    }
  };

  const cerrarSesion = () => {
    setSaliendo(true);
    void salir().finally(() => {
      setSaliendo(false);
    });
  };

  return (
    <div
      className="cuenta"
      ref={raizRef}
      onBlur={(e) => {
        // El foco se fue a otra parte de la página: se cierra.
        if (abierto && e.relatedTarget && !raizRef.current?.contains(e.relatedTarget)) setAbierto(false);
      }}
    >
      <button
        ref={botonRef}
        id={botonId}
        type="button"
        className="cuenta-boton"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? menuId : undefined}
        onClick={(e) => {
          if (abierto) setAbierto(false);
          // detail 0 = lo activó el teclado (Enter o Espacio): se entra al menú.
          else abrir(e.detail === 0 ? 'primero' : null);
        }}
        onKeyDown={alTeclearBoton}
      >
        <Avatar persona={usuario} tamano={32} />
        <span className="cuenta-texto">
          <span className="cuenta-nombre">{nombre}</span>
          <span className="cuenta-rol">{rol}</span>
        </span>
        <ChevronDown aria-hidden size={18} className="cuenta-flecha" />
      </button>
      {abierto ? (
        <div className="cuenta-panel">
          {/* En el celular el botón es solo la foto: arriba del menú queda escrito quién está adentro. */}
          <div className="cuenta-quien">
            <span className="cuenta-quien-nombre">{nombre}</span>
            <span className="cuenta-quien-detalle">
              {rol}
              {usuario.nombre && usuario.email ? ` · ${usuario.email}` : ''}
            </span>
          </div>
          <div ref={menuRef} id={menuId} role="menu" aria-labelledby={botonId} onKeyDown={alTeclearMenu}>
            {editaPerfil ? (
              <Link
                to="/perfil"
                role="menuitem"
                tabIndex={-1}
                className="cuenta-item"
                viewTransition
                onClick={() => {
                  cerrarYVolver();
                }}
              >
                <UserRound aria-hidden size={20} />
                Mi perfil
              </Link>
            ) : null}
            <div role="group" aria-labelledby={`${id}-tema`} className="cuenta-grupo">
              <span id={`${id}-tema`} className="cuenta-grupo-titulo">
                Cómo se ve
              </span>
              {OPCIONES_TEMA.map(({ valor, etiqueta, icono: Icono }) => (
                <button
                  key={valor}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tema === valor}
                  tabIndex={-1}
                  className="cuenta-item cuenta-tema"
                  onClick={() => {
                    setNoGuarda(!elegirTema(valor));
                  }}
                >
                  <Icono aria-hidden size={20} />
                  <span className="cuenta-tema-texto">
                    {etiqueta}
                    {valor === 'auto' ? (
                      <span className="cuenta-tema-detalle">Como el celular · ahora {sistemaOscuro ? 'oscuro' : 'claro'}</span>
                    ) : valor === 'contraste' ? (
                      <span className="cuenta-tema-detalle">Para leer al sol</span>
                    ) : null}
                  </span>
                  {tema === valor ? <Check aria-hidden size={18} className="cuenta-tema-marca" /> : null}
                </button>
              ))}
              {noGuarda ? (
                <p className="cuenta-tema-aviso" role="status">
                  Este celular no deja guardarlo: queda así hasta que cierres el panel.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="cuenta-item cuenta-salir"
              aria-disabled={saliendo || undefined}
              onClick={() => {
                if (!saliendo) cerrarSesion();
              }}
            >
              {saliendo ? <Loader2 aria-hidden size={20} className="girando" /> : <LogOut aria-hidden size={20} />}
              {saliendo ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
