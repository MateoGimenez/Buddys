import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { SessionProvider } from '../session/SessionContext';

export function renderApp(ruta = '/', opciones?: Parameters<typeof userEvent.setup>[0]) {
  const user = userEvent.setup(opciones);
  const utils = render(
    <MemoryRouter initialEntries={[ruta]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
  return { user, ...utils };
}
