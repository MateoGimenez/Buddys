import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { SessionProvider } from '../session/SessionContext';

export function renderApp(ruta = '/') {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[ruta]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
  return { user, ...utils };
}
