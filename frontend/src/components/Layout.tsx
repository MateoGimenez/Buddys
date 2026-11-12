import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileText,
  LogOut,
  Menu,
  PlusCircle,
  Receipt,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { NOMBRE_ROL } from '../lib/format';
import { useSesion, useUsuario } from '../session/SessionContext';

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
  { ruta: '/registrar', nombre: 'Registrar', icono: PlusCircle, capacidad: 'lavados.registrar', principal: true, descripcion: 'Anotar un lavado' },
  { ruta: '/planilla', nombre: 'Planilla', icono: ClipboardList, capacidad: 'turnos.ver', principal: true, descripcion: 'Los lavados del día' },
  { ruta: '/numeros', nombre: 'Números', icono: BarChart3, capacidad: 'estadisticas.propias', principal: true, descripcion: 'Ingresos, metas y ranking' },
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
        <p className="barra-usuario">
          <span className="barra-nombre">{nombreVisible(usuario)}</span>
          <span className="barra-rol">{NOMBRE_ROL[usuario.rol]}</span>
        </p>
      </header>

      <nav className="riel" aria-label="Secciones">
        <ul>
          {secciones.map((s) => (
            <li key={s.ruta}>
              <NavLink to={s.ruta} className="riel-link">
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
        <Outlet />
      </main>

      <nav className="tabs" aria-label="Secciones principales">
        <ul>
          {principales.map((s) => (
            <li key={s.ruta}>
              <NavLink to={s.ruta} className="tab">
                <s.icono aria-hidden size={22} />
                <span>{s.nombre}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/mas" className="tab">
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
