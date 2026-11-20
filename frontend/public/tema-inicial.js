// Tema del panel antes del primer dibujo (sin destello de color al abrir). Lo carga index.html en el <head>, como script
// clásico (bloquea un instante, a propósito) y en un archivo aparte: así la CSP no necesita 'unsafe-inline'.
// Misma clave y mismos valores que src/lib/tema.ts, que después sigue a cargo. Sin nada guardado = Automático.
(function () {
  var tema = null;
  try {
    var guardado = window.localStorage.getItem('buddys.tema.v1');
    if (guardado === 'claro' || guardado === 'oscuro' || guardado === 'contraste') tema = guardado;
  } catch (e) {
    // Sin localStorage (modo privado, bloqueado): queda Automático.
  }
  if (tema) document.documentElement.setAttribute('data-tema', tema);

  // La barra del sistema (Android) del color de la barra de abajo del tema (--nav-fondo en styles/tokens.css).
  var oscuro = tema === 'oscuro';
  if (!tema && typeof window.matchMedia === 'function') oscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tema === 'contraste' ? '#000000' : oscuro ? '#080b18' : '#17204d');
})();
