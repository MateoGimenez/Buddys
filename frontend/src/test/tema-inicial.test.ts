import codigo from '../../public/tema-inicial.js?raw';

// Ejecuta el mismo public/tema-inicial.js que carga index.html en el <head>, antes del primer dibujo.
function correr() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- es el archivo real del panel, sin compilar
  (new Function(codigo) as () => void)();
}

describe('public/tema-inicial.js (tema antes del primer dibujo)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-tema');
    localStorage.clear();
  });

  it.each(['claro', 'oscuro', 'contraste'])('aplica el tema guardado: %s', (tema) => {
    localStorage.setItem('buddys.tema.v1', tema);
    correr();
    expect(document.documentElement).toHaveAttribute('data-tema', tema);
  });

  it('sin nada guardado, o con un valor desconocido, queda Automático (sin atributo)', () => {
    correr();
    expect(document.documentElement).not.toHaveAttribute('data-tema');
    localStorage.setItem('buddys.tema.v1', '"><script>');
    correr();
    expect(document.documentElement).not.toHaveAttribute('data-tema');
  });

  it('si el navegador no deja leer localStorage, no rompe la carga', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(correr).not.toThrow();
    expect(document.documentElement).not.toHaveAttribute('data-tema');
  });
});
