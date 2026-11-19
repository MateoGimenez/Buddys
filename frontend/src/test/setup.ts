import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { reiniciarCola } from '../lib/cola';
import { reiniciarTema } from '../lib/tema';

// findBy*/waitFor esperan hasta 1 s por defecto: con la suite entera en paralelo una pantalla puede tardar más en
// aparecer. 5 s para todos (cada test tiene 20 s, ver vite.config.ts).
configure({ asyncUtilTimeout: 5000 });

// Con varios workers en paralelo la máquina se carga y algunos findBy pasaban el segundo por defecto.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  // La cola sin conexión vive en localStorage: cada test arranca sin lavados pendientes.
  localStorage.clear();
  reiniciarCola();
  reiniciarTema();
});

// jsdom no trae <dialog> completo ni scrollTo.
const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
if (!('showModal' in HTMLDialogElement.prototype) || typeof proto.showModal !== 'function') {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
}
window.scrollTo = () => undefined;
