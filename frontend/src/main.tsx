import '@fontsource-variable/archivo/wdth.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { iniciarReporteErrores } from './lib/reporteErrores';
import { iniciarTema } from './lib/tema';
import { SessionProvider } from './session/SessionContext';

// El tema elegido (claro, oscuro, alto contraste) va antes del primer dibujo: así no parpadea.
iniciarTema();
// Los errores sin atrapar se reportan (sin datos personales) a /api/admin/errores-cliente.
iniciarReporteErrores();

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Falta #root en index.html');

createRoot(raiz).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
