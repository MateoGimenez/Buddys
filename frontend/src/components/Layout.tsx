import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  FileText,
  LogOut,
  Menu,
  PlusCircle,
  Receipt,
  Tags,
  Users,
  Wallet,
  Contact,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { NOMBRE_ROL } from '../lib/format';
import { useSesion, useUsuario } from '../session/SessionContext';
import { Avatar } from './Avatar';
import { ErrorBoundary } from './ErrorBoundary';
import { Senal } from './Senal';

export interface Seccion {
  ruta: string;
  nombre: string;
  icono: LucideIcon;
  /** Capacidad de /api/admin/permisos que la habilita. */
  capacidad: string;
  /** Va en la barra de abajo del celular. */
  principal?: boolean;
  descripcion: string;
}

export const SECCIONES: Seccion[] = [
  { ruta: '/hoy', nombre: 'Hoy', icono: Sun, capacidad: 'estadisticas.completas', principal: true, descripcion: 'Caja, meta y autos en el lavadero' },
  { ruta: '/registrar', nombre: 'Registrar', icono: PlusCircle, capacidad: 'lavados.registrar', principal: true, descripcion: 'Anotar un lavado' },
  { ruta: '/planilla', nombre: 'Planilla', icono: ClipboardList, capacidad: 'turnos.ver', principal: true, descripcion: 'Los lavados del día' },
  { ruta: '/numeros', nombre: 'Números', icono: BarChart3, capacidad: 'estadisticas.propias', principal: true, descripcion: 'Ingresos, metas y ranking' },
  { ruta: '/agenda', nombre: 'Agenda', icono: CalendarDays, capacidad: 'turnos.ver', descripcion: 'Turnos largos y señas' },
  { ruta: '/caja', nombre: 'Caja', icono: Wallet, capacidad: 'caja.cerrar', descripcion: 'Contar y cerrar la caja del día' },
  { ruta: '/clientes', nombre: 'Clientes', icono: Contact, capacidad: 'turnos.clientes', descripcion: 'Historial, sellos e inactivos' },
  { ruta: '/servicios', nombre: 'Servicios', icono: Tags, capacidad: 'catalogo.ver', descripcion: 'Precios y vehículos' },
  { ruta: '/insumos', nombre: 'Insumos', icono: Boxes, capacidad: 'inventario.ver', descripcion: 'Stock y uso de productos' },
  { ruta: '/gastos', nombre: 'Gastos', icono: Receipt, capacidad: 'finanzas.gastos', descripcion: 'Lo que se gasta en el mes' },
  { ruta: '/presupuestos', nombre: 'Presupuestos', icono: FileText, capacidad: 'documentos.presupuestos', descripcion: 'Armar y bajar en PDF' },
  { ruta: '/equipo', nombre: 'Equipo', icono: Users, capacidad: 'usuarios.gestionar', descripcion: 'Usuarios, roles y acceso' },
];

export function useSecciones(): Seccion[] {
  const { puede } = useSesion();
  return SECCIONES.filter((s) => puede(s.capacidad));
}

function nombreVisible(u: { nombre: string | null; email: string | null }): string {
  return u.nombre ?? u.email ?? 'Sin nombre';
}

export function Layout() {
  const usuario = useUsuario();
  const { salir } = useSesion();
  const secciones = useSecciones();
  const principales = secciones.filter((s) => s.principal);
  const [saliendo, setSaliendo] = useState(false);
  const { pathname } = useLocation();
  const primeraVez = useRef(true);

  // Al cambiar de sección, el foco va al título de la pantalla nueva: el lector de pantalla la anuncia y el teclado
  // sigue desde ahí (si no, quedaría en la pestaña que se tocó). Al abrir la app no se mueve.
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    const titulo = document.querySelector<HTMLElement>('#contenido h1') ?? document.getElementById('contenido');
    if (!titulo) return;
    if (!titulo.hasAttribute('tabindex')) titulo.setAttribute('tabindex', '-1');
    titulo.focus({ preventScroll: true });
  }, [pathname]);

  const cerrar = () => {
    setSaliendo(true);
    void salir().finally(() => {
      setSaliendo(false);
    });
  };

  return (
    <div className="app">
      <a className="saltar" href="#contenido">
        Ir al contenido
      </a>
      <header className="barra">
        <img className="barra-logo" src="/logo.png" alt="Buddys Wash Detail" width={150} height={36} />
        {/* A la derecha, la foto: lleva a Perfil. El nombre y el rol solo se ven si hay lugar (compu, tablet). */}
        <NavLink to="/perfil" className="barra-perfil" aria-label="Tu perfil" viewTransition>
          <span className="barra-usuario" aria-hidden>
            <span className="barra-nombre">{nombreVisible(usuario)}</span>
            <span className="barra-rol">{NOMBRE_ROL[usuario.rol]}</span>
          </span>
          <Avatar nombre={nombreVisible(usuario)} url={usuario.avatarUrl} tamano="medio" sinFoto="icono" />
        </NavLink>
      </header>

      <nav className="riel" aria-label="Secciones">
        <ul>
          {secciones.map((s) => (
            <li key={s.ruta}>
              <NavLink to={s.ruta} className="riel-link" viewTransition>
                <s.icono aria-hidden size={20} />
                {s.nombre}
              </NavLink>
            </li>
          ))}
        </ul>
        <button type="button" className="riel-link riel-salir" onClick={cerrar} disabled={saliendo}>
          <LogOut aria-hidden size={20} />
          {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
        </button>
      </nav>

      <main id="contenido" className="contenido" tabIndex={-1}>
        <Senal usuarioId={usuario.id} />
        <ErrorBoundary clave={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav className="tabs" aria-label="Secciones principales">
        <ul>
          {principales.map((s) => (
            <li key={s.ruta}>
              <NavLink to={s.ruta} className="tab" viewTransition>
                <s.icono aria-hidden size={22} />
                <span>{s.nombre}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/mas" className="tab" viewTransition>
              <Menu aria-hidden size={22} />
              <span>Más</span>
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function nombreDe(u: { nombre: string | null; email: string | null }): string {
  return nombreVisible(u);
}
