import path from 'node:path';
import express, { type RequestHandler, type Router } from 'express';

/**
 * Sirve el panel compilado (frontend/dist) desde el mismo proceso que la API, para que los dos compartan origen: el
 * cliente del frontend llama a /api relativo, con cookies de sesión SameSite=Strict. Se monta DESPUÉS de /api, así
 * que nunca pisa una ruta de la API (y /api/* desconocido sigue siendo el 404 JSON).
 *
 * CSP propia del panel (pisa la de la API, que bloquea todo): scripts, estilos, fuentes, el service worker y el
 * manifest solo del propio origen; imágenes y subidas también a Supabase Storage (las fotos van por URL firmada) y
 * blob: (vista previa al achicar una foto). Sin 'unsafe-inline' ni 'unsafe-eval': el tema inicial es un archivo aparte.
 */
export function panelCsp(supabaseUrl: string): string {
  const supabase = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' blob: data: ${supabase}`,
    `connect-src 'self' ${supabase}`,
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Lo que nunca puede quedar viejo en el celular: el HTML, el service worker y el manifest (la PWA se actualiza por acá). */
const SIN_CACHE = new Set(['index.html', 'sw.js', 'push-sw.js', 'manifest.webmanifest', 'tema-inicial.js']);

export function servirPanel(dir: string, supabaseUrl: string): Router {
  const csp = panelCsp(supabaseUrl);
  const index = path.join(dir, 'index.html');
  const router = express.Router();

  // La CSP del panel va solo en lo que el panel entrega: lo que cae al 404 JSON conserva la de la API.
  router.use(
    express.static(dir, {
      index: 'index.html',
      dotfiles: 'ignore',
      fallthrough: true,
      setHeaders: (res, archivo) => {
        res.setHeader('Content-Security-Policy', csp);
        const relativo = path.relative(dir, archivo).split(path.sep).join('/');
        if (relativo.startsWith('assets/')) {
          // Nombres con hash de contenido: si cambia el archivo, cambia el nombre.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (SIN_CACHE.has(relativo)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );

  // Rutas del panel (React Router: /hoy, /caja...): GET o HEAD sin extensión y que piden HTML => index.html.
  // Un archivo que no existe (/algo.js) o un pedido que no es de navegación sigue al 404 JSON de siempre.
  const fallback: RequestHandler = (req, res, next) => {
    const esNavegacion =
      (req.method === 'GET' || req.method === 'HEAD') && path.extname(req.path) === '' && req.accepts('html') !== false;
    if (!esNavegacion) {
      next();
      return;
    }
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index, (error) => {
      if (error !== undefined) next(error);
    });
  };
  router.use(fallback);

  return router;
}
