/**
 * Genera las versiones livianas de los archivos de marca (public/fotos/Buddys-*)
 * en public/marca/, al tamaño en que se usan. Los originales no se tocan.
 * Uso: npm run marca
 *
 * Original: public/fotos/Buddys-logo.png (logo "BUDDYS Wash Detail" con fondo transparente, ya recortado).
 * Si llega un logo en mejor calidad, reemplazá ese archivo (mismo nombre) y volvé a correr el script.
 */
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const raiz = path.resolve(import.meta.dirname, '..');
const origen = (archivo) => path.join(raiz, 'public', 'fotos', archivo);
const destino = (archivo) => path.join(raiz, 'public', 'marca', archivo);

await mkdir(path.join(raiz, 'public', 'marca'), { recursive: true });

const salidas = [];
const guardar = async (imagen, archivo) => {
  const info = await imagen.toFile(destino(archivo));
  salidas.push(`${archivo}: ${String(info.width)}×${String(info.height)}, ${((await stat(destino(archivo))).size / 1024).toFixed(1)} KB`);
};

const LOGO = origen('Buddys-logo.png');
const GRAFITO = '#14171a';

// Logo para la cabecera, el pie y el panel: recortado y a 120 px de alto (≈2,5x del uso). El mismo archivo sirve para
// fondo oscuro y claro: el logo trae su propio contorno negro.
const logo = sharp(LOGO).trim().resize({ height: 120 });
await guardar(logo.clone().png({ compressionLevel: 9 }), 'logo-fondo-oscuro.png');
await guardar(logo.clone().png({ compressionLevel: 9 }), 'logo-fondo-claro.png');

// Fondo grafito con una viñeta suave.
const fondo = (ancho, alto = ancho) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(ancho)}" height="${String(alto)}"><defs><radialGradient id="g" cx="50%" cy="46%" r="75%"><stop offset="0" stop-color="#1c2025"/><stop offset="1" stop-color="#090b0d"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    ),
  ).png();

/** El logo centrado sobre el fondo grafito, ocupando `proporcion` del ancho. */
const logoSobreFondo = async (ancho, alto, proporcion) => {
  const pieza = await sharp(LOGO).resize({ width: Math.round(ancho * proporcion) }).png().toBuffer();
  const { width = 0, height = 0 } = await sharp(pieza).metadata();
  return sharp(await fondo(ancho, alto).toBuffer()).composite([
    { input: pieza, left: Math.round((ancho - width) / 2), top: Math.round((alto - height) / 2) },
  ]);
};

// Cuadro del monograma de la landing (frente) y su dorso (detalle de la pistola de lavado y la "B").
await guardar((await logoSobreFondo(720, 720, 0.86)).webp({ quality: 85 }), 'monograma-poster.webp');
const detalle = await sharp(LOGO).extract({ left: 0, top: 0, width: 230, height: 176 }).resize({ width: 600 }).png().toBuffer();
await guardar(
  sharp(await fondo(720).toBuffer())
    .composite([{ input: detalle, left: 60, top: Math.round((720 - (176 * 600) / 230) / 2) }])
    .webp({ quality: 85 }),
  'monograma-dorso.webp',
);

// Vista previa para compartir (og:image), 1200 × 630.
await guardar((await logoSobreFondo(1200, 630, 0.8)).jpeg({ quality: 85, mozjpeg: true }), 'og.jpg');

// Íconos de la app (celular, panel instalable) y favicon: el logo entero sobre grafito.
// `proporcion` = qué parte del ancho ocupa el logo (el maskable queda dentro de la zona segura).
const icono = async (lado, proporcion) => (await logoSobreFondo(lado, lado, proporcion)).png({ compressionLevel: 9 });
await guardar(await icono(180, 0.9), 'apple-touch-icon.png');
await guardar(await icono(48, 0.96), 'favicon-48.png');
await guardar(await icono(192, 0.9), 'app-192.png');
await guardar(await icono(512, 0.9), 'app-512.png');
await guardar(await icono(512, 0.7), 'app-maskable-512.png');

console.log(salidas.join('\n'));
