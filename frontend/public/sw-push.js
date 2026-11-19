/* Avisos push del panel. Lo carga el service worker de la PWA (vite.config.ts → workbox.importScripts).
   El aviso trae { titulo, cuerpo, pendientes, url } sin datos del cliente ni importes. Las url del backend apuntan
   al panel viejo (/admin/...): acá se traducen a las pantallas de este panel. */
/* eslint-env serviceworker */

var RUTAS = {
  '/admin': '/',
  '/admin/lavados': '/planilla',
  '/admin/metas': '/numeros',
};

function rutaDel(url) {
  if (typeof url !== 'string' || url.charAt(0) !== '/') return '/';
  return RUTAS[url] || '/';
}

self.addEventListener('push', function (evento) {
  var datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch (e) {
    datos = { titulo: 'Buddys', cuerpo: evento.data ? evento.data.text() : '' };
  }
  var titulo = datos.titulo || 'Buddys';
  var pedidos = [
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || '',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      lang: 'es-AR',
      data: { url: rutaDel(datos.url) },
    }),
  ];
  if (typeof datos.pendientes === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    pedidos.push(self.navigator.setAppBadge(datos.pendientes).catch(function () {}));
  }
  evento.waitUntil(Promise.all(pedidos));
});

self.addEventListener('notificationclick', function (evento) {
  evento.notification.close();
  var destino = (evento.notification.data && evento.notification.data.url) || '/';
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ventanas) {
      for (var i = 0; i < ventanas.length; i++) {
        var v = ventanas[i];
        if ('focus' in v) {
          if ('navigate' in v) v.navigate(destino).catch(function () {});
          return v.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
