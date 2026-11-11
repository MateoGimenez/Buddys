import type { DatosSitio } from '../types.ts';

/**
 * DATOS DEL TALLER — completalos acá y la web se actualiza sola.
 *
 * Todo lo que quede vacío se oculta: sin WhatsApp, los botones de contacto
 * llevan al formulario de turnos; sin horarios o dirección, esos bloques no
 * aparecen. No hace falta tocar ningún otro archivo.
 */
export const sitio: DatosSitio = {
  // COMPLETAR: WhatsApp en formato internacional, solo números y sin "+". Ej.: '5493804123456'
  whatsapp: '',
  // COMPLETAR: usuario de Instagram, sin "@". Ej.: 'buddyswashdetail'
  instagram: 'buddyswashdetail',
  // COMPLETAR: dirección del taller. Ej.: 'Av. Ejemplo 123, La Rioja'
  direccion: '',
  // COMPLETAR: horarios, un renglón por ítem. Ej.: ['Lunes a viernes, de 9 a 18 h', 'Sábados, de 9 a 13 h']
  horarios: [],
  // OPCIONAL: los mismos horarios para calcular el "Abierto ahora" (hora de La Rioja). Día 0 = domingo … 6 = sábado;
  // una lista vacía = cerrado ese día. Ej.: horariosSemana: { 0: [], 1: [{ desde: '08:00', hasta: '18:00' }], ... }
  // COMPLETAR: link de Google Maps del taller (en Maps: Compartir → Copiar vínculo).
  mapsUrl: '',
  // OPCIONAL: mapa embebido. En Google Maps: Compartir → Insertar un mapa → copiá solo el valor de src="…" (empieza con
  // https://www.google.com/maps/embed). Se carga recién cuando la persona toca "Ver el mapa acá". Vacío: solo "Cómo llegar".
  mapaEmbedUrl: '',
  // COMPLETAR: dirección pública de la web, sin barra final. Ej.: 'https://buddys.com.ar'
  // (se usa para canonical, og:url y, más adelante, og:image; vacía, esas etiquetas no se emiten)
  url: 'https://buddyswashdetail.com.ar',
  // Logo plano para fondo oscuro, versión liviana generada con `npm run marca` (vacío: wordmark tipográfico).
  logo: '/marca/logo-fondo-oscuro.png',
  logoAncho: 501,
  logoAlto: 120,
};

/** Datos fijos de la marca. No cambiar. */
export const negocio = {
  nombre: 'Buddys Wash Detail',
  ciudad: 'La Rioja',
  provincia: 'La Rioja',
  pais: 'Argentina',
} as const;

/**
 * Archivos de marca que usa la web (originales en public/fotos/, versiones
 * livianas en public/marca/ con `npm run marca`).
 */
export const marca = {
  /**
   * Logo plano para fondo claro (tema claro de la web). Mismo recorte y tamaño que
   * `sitio.logo`; se usa solo si `sitio.logo` está cargado.
   */
  logoClaro: '/marca/logo-fondo-claro.png',
  /** Video de marca (cuadrado, se reproduce solo cuando se ve). Vacío: se muestra el cuadro fijo `poster`. */
  video: '',
  /** Cuadro fijo: el logo sobre grafito (póster del video si lo hay). */
  poster: '/marca/monograma-poster.webp',
  /** Dorso del cuadro que gira: detalle de la pistola de lavado. */
  dorso: '/marca/monograma-dorso.webp',
  posterLado: 720,
} as const;
