/*
 * Avisos push del panel. Lo carga el service worker que genera vite-plugin-pwa con
 * `workbox.importScripts: ['push-sw.js']` (vite.config.ts): es un script clásico, sin módulos ni dependencias.
 *
 * El backend manda JSON { titulo, cuerpo, url, pendientes } (backend/src/domain/push.ts). Todo se trata como dato que
 * no es de confianza: el texto va como texto plano (las notificaciones no interpretan HTML) y la URL solo puede ser una
 * ruta de este mismo panel.
 *
 * La lógica pura queda en `self.BuddysPush` para que src/test/push-sw.test.ts la pruebe ejecutando este mismo archivo.
 */
(function () {
  'use strict';

  const TITULO_GENERICO = 'Buddys Wash Detail';
  const CUERPO_GENERICO = 'Tenés un aviso nuevo';
  const ICONO = '/pwa-192.png';
  // Android usa solo la transparencia del badge: un ícono de un color, chico.
  const BADGE = '/badge-96.png';
  const TIPOS = ['stock', 'turno', 'equipo'];

  function texto(valor, maximo) {
    if (typeof valor !== 'string') return null;
    const limpio = valor.trim();
    return limpio === '' ? null : limpio.slice(0, maximo);
  }

  /**
   * Una ruta relativa de este mismo origen ("/insumos?ver=comprar"), o "/" si no lo es. Rechaza "//otro.com",
   * "https://otro.com", "javascript:..." y cualquier cosa que el parser de URL termine sacando del origen
   * (por ejemplo "/\otro.com").
   */
  function destinoSeguro(url, origen) {
    if (typeof url !== 'string' || url.charAt(0) !== '/' || url.charAt(1) === '/') return '/';
    let destino;
    try {
      destino = new URL(url, origen);
    } catch {
      return '/';
    }
    if (destino.origin !== origen) return '/';
    const ruta = destino.pathname + destino.search + destino.hash;
    // La normalización puede dejar "//otro.com" ("/.//otro.com", "/%2e//otro.com", "/a/..//otro.com"): se valida el
    // resultado también, porque "//otro.com" resuelto contra el origen sale del sitio.
    if (ruta.charAt(1) === '/' || ruta.charAt(1) === '\\') return '/';
    return ruta;
  }

  /** Tipo de aviso: el que mande el backend si es conocido; si no, sale de la ruta. */
  function tipoDeAviso(tipo, ruta) {
    if (typeof tipo === 'string' && TIPOS.indexOf(tipo) !== -1) return tipo;
    const camino = ruta.split(/[?#]/)[0];
    return camino === '/insumos' || camino.indexOf('/insumos/') === 0 ? 'stock' : 'turno';
  }

  /** Una etiqueta por tipo: el aviso nuevo reemplaza al anterior del mismo tipo en vez de apilarse. */
  function elegirTag(tipo) {
    return 'buddys-' + tipo;
  }

  /** Lee el payload con tolerancia: vacío, roto o con campos raros da el aviso genérico. */
  function leerAviso(textoCrudo, origen) {
    let datos = null;
    try {
      datos = typeof textoCrudo === 'string' && textoCrudo !== '' ? JSON.parse(textoCrudo) : null;
    } catch {
      datos = null;
    }
    if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
      return {
        titulo: TITULO_GENERICO,
        cuerpo: CUERPO_GENERICO,
        url: '/',
        tag: elegirTag('turno'),
        pendientes: null,
      };
    }
    const url = destinoSeguro(datos.url, origen);
    const titulo = texto(datos.titulo, 80);
    const cuerpo = texto(datos.cuerpo, 200);
    const p = datos.pendientes;
    return {
      titulo: titulo || TITULO_GENERICO,
      cuerpo: cuerpo || (titulo ? '' : CUERPO_GENERICO),
      url: url,
      tag: elegirTag(tipoDeAviso(datos.tipo, url)),
      pendientes: typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 9999 ? p : null,
    };
  }

  self.BuddysPush = { leerAviso: leerAviso, destinoSeguro: destinoSeguro, elegirTag: elegirTag, tipoDeAviso: tipoDeAviso };

  function ponerGlobito(cantidad) {
    try {
      const nav = self.navigator;
      if (cantidad === null || !nav) return Promise.resolve();
      if (cantidad > 0 && typeof nav.setAppBadge === 'function') return nav.setAppBadge(cantidad).catch(() => undefined);
      if (cantidad === 0 && typeof nav.clearAppBadge === 'function') return nav.clearAppBadge().catch(() => undefined);
    } catch {
      // El globito del ícono es un extra: si el sistema no lo deja, no pasa nada.
    }
    return Promise.resolve();
  }

  self.addEventListener('push', function (evento) {
    let crudo = null;
    try {
      crudo = evento.data ? evento.data.text() : null;
    } catch {
      crudo = null;
    }
    const aviso = leerAviso(crudo, self.location.origin);
    evento.waitUntil(
      Promise.all([
        self.registration.showNotification(aviso.titulo, {
          body: aviso.cuerpo,
          icon: ICONO,
          badge: BADGE,
          tag: aviso.tag,
          // Con la misma etiqueta, el reemplazo igual suena y vibra.
          renotify: true,
          lang: 'es-AR',
          data: { url: aviso.url },
        }),
        ponerGlobito(aviso.pendientes),
      ]),
    );
  });

  self.addEventListener('notificationclick', function (evento) {
    evento.notification.close();
    const datos = evento.notification.data;
    const ruta = destinoSeguro(datos && datos.url, self.location.origin);
    const absoluta = new URL(ruta, self.location.origin).href;
    evento.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ventanas) {
        const delPanel = ventanas.filter(function (v) {
          return new URL(v.url).origin === self.location.origin;
        });
        const ventana =
          delPanel.find(function (v) {
            return v.focused;
          }) || delPanel[0];
        if (!ventana) return self.clients.openWindow(absoluta);
        // focus() primero: el permiso para traer la ventana al frente dura poco después del toque.
        return ventana.focus().then(function (enfocada) {
          if (enfocada.url === absoluta) return enfocada;
          // navigate() falla si la ventana no está controlada por este service worker: entonces se abre otra.
          return enfocada.navigate(absoluta).catch(function () {
            return self.clients.openWindow(absoluta);
          });
        });
      }),
    );
  });
})();
