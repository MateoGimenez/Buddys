// Achica una foto de la cámara antes de subirla: lado mayor de hasta 1600 px y hasta 1,5 MB (lo que acepta el
// backend). WebP si el navegador lo sabe codificar (Safari 15 no: devuelve PNG), si no JPEG.
// Para la foto de perfil (cuadrado): recorta el centro, la deja de 400 x 400 y hasta 512 KB.
import { FOTO_BYTES_MAX, type FormatoFoto } from '../api/fotos';

export const LADO_MAX = 1600;
const CALIDADES = [0.82, 0.7, 0.58, 0.45];

export class FotoIlegible extends Error {
  constructor() {
    super('No pudimos leer esa foto. Probá sacarla de nuevo.');
    this.name = 'FotoIlegible';
  }
}

type Recorte = [sx: number, sy: number, sw: number, sh: number];

interface Dibujable {
  ancho: number;
  alto: number;
  /** Dibuja el recorte (sx, sy, sw, sh) de la imagen en un lienzo de w x h. */
  dibujar: (ctx: CanvasRenderingContext2D, w: number, h: number, recorte: Recorte) => void;
  soltar: () => void;
}

async function cargar(archivo: Blob): Promise<Dibujable> {
  // createImageBitmap respeta la orientación EXIF (la foto parada sale parada). Si no está, una <img>.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      return {
        ancho: bmp.width,
        alto: bmp.height,
        dibujar: (ctx, w, h, recorte) => {
          ctx.drawImage(bmp, ...recorte, 0, 0, w, h);
        },
        soltar: () => {
          bmp.close();
        },
      };
    } catch {
      // sigue con <img>
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => {
        ok(i);
      };
      i.onerror = () => {
        mal(new FotoIlegible());
      };
      i.src = url;
    });
    return {
      ancho: img.naturalWidth,
      alto: img.naturalHeight,
      dibujar: (ctx, w, h, recorte) => {
        ctx.drawImage(img, ...recorte, 0, 0, w, h);
      },
      soltar: () => {
        URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function aBlob(canvas: HTMLCanvasElement, tipo: FormatoFoto, calidad: number): Promise<Blob | null> {
  return new Promise((ok) => {
    canvas.toBlob(ok, tipo, calidad);
  });
}

export interface OpcionesAchicar {
  /** Lado mayor del resultado, en px. */
  ladoMax?: number;
  /** Tamaño máximo del archivo, en bytes. */
  bytesMax?: number;
  /** Recorta un cuadrado centrado (foto de perfil). */
  cuadrado?: boolean;
}

/** La foto lista para subir. Tira FotoIlegible si no se puede leer o no entra en el tamaño ni achicándola. */
export async function achicarFoto(archivo: Blob, opciones: OpcionesAchicar = {}): Promise<{ blob: Blob; tipo: FormatoFoto }> {
  const { ladoMax = LADO_MAX, bytesMax = FOTO_BYTES_MAX, cuadrado = false } = opciones;
  const imagen = await cargar(archivo);
  try {
    if (!imagen.ancho || !imagen.alto) throw new FotoIlegible();
    // Lo que se toma de la original: todo, o el cuadrado del medio.
    const lado = Math.min(imagen.ancho, imagen.alto);
    const recorte: Recorte = cuadrado
      ? [Math.floor((imagen.ancho - lado) / 2), Math.floor((imagen.alto - lado) / 2), lado, lado]
      : [0, 0, imagen.ancho, imagen.alto];
    const [, , anchoFuente, altoFuente] = recorte;
    let escala = Math.min(1, ladoMax / Math.max(anchoFuente, altoFuente));
    let formato: FormatoFoto = 'image/webp';
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(anchoFuente * escala));
      canvas.height = Math.max(1, Math.round(altoFuente * escala));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new FotoIlegible();
      imagen.dibujar(ctx, canvas.width, canvas.height, recorte);
      for (const calidad of CALIDADES) {
        let blob = await aBlob(canvas, formato, calidad);
        // Sin WebP el navegador devuelve otro formato: desde acá, JPEG.
        if (blob?.type !== formato && formato === 'image/webp') {
          formato = 'image/jpeg';
          blob = await aBlob(canvas, formato, calidad);
        }
        if (blob?.type === formato && blob.size <= bytesMax) return { blob, tipo: formato };
      }
      escala *= 0.75;
    }
    throw new FotoIlegible();
  } finally {
    imagen.soltar();
  }
}
