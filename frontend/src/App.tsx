import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, SECCIONES } from './components/Layout';
import { Cargando } from './components/ui';
import { Equipo } from './pages/Equipo';
import { Gastos } from './pages/Gastos';
import { Insumos } from './pages/Insumos';
import { Login } from './pages/Login';
import { Mas } from './pages/Mas';
import { Numeros } from './pages/Numeros';
import { Planilla } from './pages/Planilla';
import { Presupuestos } from './pages/Presupuestos';
import { Registrar } from './pages/Registrar';
import { Servicios } from './pages/Servicios';
import { useSesion } from './session/SessionContext';
import type { ReactElement } from 'react';

const PAGINAS: Record<string, ReactElement> = {
  '/registrar': <Registrar />,
  '/planilla': <Planilla />,
  '/numeros': <Numeros />,
  '/servicios': <Servicios />,
  '/insumos': <Insumos />,
  '/gastos': <Gastos />,
  '/presupuestos': <Presupuestos />,
  '/equipo': <Equipo />,
};

export function App() {
  const { estado, puede } = useSesion();

  if (estado.tipo === 'cargando') {
    return (
      <main className="pantalla-inicio">
        <img src="/logo.png" alt="Buddys Wash Detail" width={250} height={60} />
        <Cargando texto="Abriendo el panel…" />
      </main>
    );
  }

  if (estado.tipo === 'afuera') return <Login {...(estado.aviso ? { aviso: estado.aviso } : {})} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/registrar" replace />} />
        {SECCIONES.filter((s) => puede(s.capacidad)).map((s) => (
          <Route key={s.ruta} path={s.ruta} element={PAGINAS[s.ruta]} />
        ))}
        <Route path="/mas" element={<Mas />} />
        <Route path="*" element={<Navigate to="/registrar" replace />} />
      </Route>
    </Routes>
  );
}
