import codigo from '../../public/push-sw.js?raw';

// Ejecuta el mismo public/push-sw.js que carga el service worker, con un `self` falso: así se prueba el archivo real
// (no una copia) y también los manejadores de `push` y `notificationclick`.

const ORIGEN = 'https://panel.buddys.test';

interface Aviso {
  titulo: string;
  cuerpo: string;
  url: string;
  tag: string;
  pendientes: number | null;
}
interface BuddysPush {
  leerAviso: (texto: string | null, origen: string) => Aviso;
  destinoSeguro: (url: unknown, origen: string) => string;
  elegirTag: (tipo: string) => string;
}
interface VentanaFalsa {
  url: string;
  focused: boolean;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}
type Manejador = (evento: unknown) => void;

function cargar(ventanas: VentanaFalsa[] = []) {
  const manejadores = new Map<string, Manejador>();
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve(null));
  const setAppBadge = vi.fn(() => Promise.resolve());
  const self = {
    location: { origin: ORIGEN },
    navigator: { setAppBadge },
    registration: { showNotification },
    clients: { matchAll: vi.fn(() => Promise.resolve(ventanas)), openWindow },
    addEventListener: (tipo: string, fn: Manejador) => manejadores.set(tipo, fn),
    BuddysPush: undefined as BuddysPush | undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- es nuestro propio archivo de public/, no datos.
  const ejecutar = new Function('self', codigo) as (s: typeof self) => void;
  ejecutar(self);
  const api = self.BuddysPush;
  if (!api) throw new Error('push-sw.js no expuso BuddysPush');

  async function disparar(tipo: string, evento: Record<string, unknown>) {
    let espera: Promise<unknown> = Promise.resolve();
    const fn = manejadores.get(tipo);
    if (!fn) throw new Error(`Sin manejador de ${tipo}`);
    fn({ ...evento, waitUntil: (p: Promise<unknown>) => (espera = p) });
    await espera;
  }
  return { api, disparar, showNotification, openWindow, setAppBadge };
}

function ventana(url: string, focused = false): VentanaFalsa {
  const v: VentanaFalsa = { url, focused, focus: vi.fn(), navigate: vi.fn() };
  v.focus.mockResolvedValue(v);
  v.navigate.mockResolvedValue(v);
  return v;
}

describe('push-sw.js: lógica pura', () => {
  const { api } = cargar();

  it('payload roto, vacío o que no es objeto: aviso genérico', () => {
    for (const crudo of ['{roto', '', null, '"texto"', '[1,2]', 'null']) {
      expect(api.leerAviso(crudo, ORIGEN)).toEqual({
        titulo: 'Buddys Wash Detail',
        cuerpo: 'Tenés un aviso nuevo',
        url: '/',
        tag: 'buddys-turno',
        pendientes: null,
      });
    }
  });

  it('aviso de stock bajo: texto tal cual, ruta válida y etiqueta de stock', () => {
    const aviso = api.leerAviso(
      JSON.stringify({
        titulo: 'Queda poco: Shampoo',
        cuerpo: 'Hay 0,5 litro (mínimo 1 litro). Mirá la lista para comprar.',
        url: '/insumos?ver=comprar',
        pendientes: 3,
      }),
      ORIGEN,
    );
    expect(aviso).toEqual({
      titulo: 'Queda poco: Shampoo',
      cuerpo: 'Hay 0,5 litro (mínimo 1 litro). Mirá la lista para comprar.',
      url: '/insumos?ver=comprar',
      tag: 'buddys-stock',
      pendientes: 3,
    });
  });

  it('el texto con HTML queda como texto plano', () => {
    const aviso = api.leerAviso(JSON.stringify({ titulo: '<img src=x onerror=alert(1)>', cuerpo: '<b>hola</b>', url: '/' }), ORIGEN);
    expect(aviso.titulo).toBe('<img src=x onerror=alert(1)>');
    expect(aviso.cuerpo).toBe('<b>hola</b>');
  });

  it.each([
    ['https://evil.com/insumos', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['/\t/evil.com', '/'],
    ['/.//evil.com', '/'],
    ['/%2e//evil.com', '/'],
    ['/a/..//evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['insumos', '/'],
    [42, '/'],
    [undefined, '/'],
    ['/insumos?ver=comprar', '/insumos?ver=comprar'],
    ['/agenda#hoy', '/agenda#hoy'],
  ])('destinoSeguro(%j) = %s', (url, esperado) => {
    expect(api.destinoSeguro(url, ORIGEN)).toBe(esperado);
  });

  it('etiqueta por tipo: el que manda el backend, o el que sale de la ruta', () => {
    const tag = (datos: object) => api.leerAviso(JSON.stringify(datos), ORIGEN).tag;
    expect(tag({ titulo: 'x', url: '/insumos' })).toBe('buddys-stock');
    expect(tag({ titulo: 'x', url: '/planilla' })).toBe('buddys-turno');
    expect(tag({ titulo: 'x', url: '/insumos-viejos' })).toBe('buddys-turno');
    expect(tag({ titulo: 'x', url: '/', tipo: 'stock' })).toBe('buddys-stock');
    expect(tag({ titulo: 'x', url: '/insumos', tipo: 'otro' })).toBe('buddys-stock');
    // Una URL externa cae en "/" antes de elegir el tipo.
    expect(tag({ titulo: 'x', url: 'https://evil.com/insumos' })).toBe('buddys-turno');
  });

  it('pendientes raros no ponen globito', () => {
    for (const pendientes of [-1, 1.5, '3', 10000, null]) {
      expect(api.leerAviso(JSON.stringify({ titulo: 'x', pendientes }), ORIGEN).pendientes).toBeNull();
    }
  });
});

describe('push-sw.js: manejadores', () => {
  it('push muestra la notificación con ícono, badge, etiqueta y la ruta en data', async () => {
    const { disparar, showNotification, setAppBadge } = cargar();
    const payload = JSON.stringify({ titulo: 'Quedan poco 3 insumos', cuerpo: 'Mirá la lista.', url: '/insumos?ver=comprar', pendientes: 2 });
    await disparar('push', { data: { text: () => payload } });
    expect(showNotification).toHaveBeenCalledWith(
      'Quedan poco 3 insumos',
      expect.objectContaining({
        body: 'Mirá la lista.',
        icon: '/pwa-192.png',
        badge: '/badge-96.png',
        tag: 'buddys-stock',
        data: { url: '/insumos?ver=comprar' },
      }),
    );
    expect(setAppBadge).toHaveBeenCalledWith(2);
  });

  it('push sin datos o con datos ilegibles muestra el aviso genérico', async () => {
    const { disparar, showNotification } = cargar();
    await disparar('push', { data: null });
    await disparar('push', { data: { text: () => '{roto' } });
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification).toHaveBeenLastCalledWith('Buddys Wash Detail', expect.objectContaining({ body: 'Tenés un aviso nuevo', data: { url: '/' } }));
  });

  function clic(url: unknown) {
    const close = vi.fn();
    return { evento: { notification: { close, data: { url } } }, close };
  }

  it('sin ventana abierta: cierra y abre la ruta del panel', async () => {
    const { disparar, openWindow } = cargar();
    const { evento, close } = clic('/insumos?ver=comprar');
    await disparar('notificationclick', evento);
    expect(close).toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${ORIGEN}/insumos?ver=comprar`);
  });

  it.each(['https://evil.com', '//evil.com', 'javascript:alert(1)'])('una URL insegura (%s) abre la raíz del panel', async (url) => {
    const { disparar, openWindow } = cargar();
    await disparar('notificationclick', clic(url).evento);
    expect(openWindow).toHaveBeenCalledWith(`${ORIGEN}/`);
  });

  it('con el panel abierto: lo enfoca y navega ahí en vez de abrir otra ventana', async () => {
    const otra = ventana('https://otro.sitio/');
    const panel = ventana(`${ORIGEN}/registrar`);
    const { disparar, openWindow } = cargar([otra, panel]);
    await disparar('notificationclick', clic('/insumos?ver=comprar').evento);
    expect(panel.focus).toHaveBeenCalled();
    expect(panel.navigate).toHaveBeenCalledWith(`${ORIGEN}/insumos?ver=comprar`);
    expect(otra.focus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('prefiere la ventana enfocada y no navega si ya está en esa ruta', async () => {
    const atras = ventana(`${ORIGEN}/registrar`);
    const enfocada = ventana(`${ORIGEN}/insumos?ver=comprar`, true);
    const { disparar } = cargar([atras, enfocada]);
    await disparar('notificationclick', clic('/insumos?ver=comprar').evento);
    expect(enfocada.focus).toHaveBeenCalled();
    expect(enfocada.navigate).not.toHaveBeenCalled();
    expect(atras.focus).not.toHaveBeenCalled();
  });

  it('si la ventana no deja navegar (no controlada), abre una nueva', async () => {
    const panel = ventana(`${ORIGEN}/registrar`);
    panel.navigate.mockRejectedValue(new TypeError('no controlada'));
    const { disparar, openWindow } = cargar([panel]);
    await disparar('notificationclick', clic('/insumos').evento);
    expect(openWindow).toHaveBeenCalledWith(`${ORIGEN}/insumos`);
  });
});
