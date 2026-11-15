// Reemplazo de 'virtual:pwa-register/react' en los tests (vite.config.ts, test.alias): sin service worker.
import { useState } from 'react';
import { vi } from 'vitest';

export const pwa = { hayNueva: false, actualizar: vi.fn(() => Promise.resolve()) };

export function useRegisterSW() {
  const needRefresh = useState(pwa.hayNueva);
  const offlineReady = useState(false);
  return { needRefresh, offlineReady, updateServiceWorker: pwa.actualizar };
}
