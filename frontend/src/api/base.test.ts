import { describe, expect, it } from 'vitest';
import { origenDeLaApi } from './base';

describe('origenDeLaApi', () => {
  it('sin valor: mismo origen (rutas relativas)', () => {
    expect(origenDeLaApi(undefined)).toBe('');
    expect(origenDeLaApi('   ')).toBe('');
  });

  it('se queda solo con el origen, sin barra final', () => {
    expect(origenDeLaApi('https://api.buddyswashdetail.com.ar')).toBe('https://api.buddyswashdetail.com.ar');
    expect(origenDeLaApi(' https://api.buddyswashdetail.com.ar/ ')).toBe('https://api.buddyswashdetail.com.ar');
    expect(origenDeLaApi('http://localhost:4000')).toBe('http://localhost:4000');
  });
});
