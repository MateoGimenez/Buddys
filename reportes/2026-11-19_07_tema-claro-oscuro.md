# 07 — Tema claro / oscuro en el menú de la cuenta

Fecha: 2026-11-19 · Rama: `feature/lista-caja-graficos-tema` · Objetivo E de la tanda 07-11.

## Pedido

- Selector de tema en el menú de la cuenta del header: **Automático / Claro / Oscuro** (Automático sigue al sistema).
  Decisión del dueño (19/11): se queda también **Alto contraste** (para leer al sol), como cuarta opción.
- La elección se guarda y se aplica **antes del primer render**: sin destello de color al abrir.
- Colores con variables CSS, `color-scheme` y `light-dark()`.
- Todas las pantallas, gráficos, avisos y estados (error, vacío, cargando) bien en los dos temas, con contraste AA.

## Cómo queda

### Colores (`frontend/src/styles/tokens.css`)

- Un solo bloque `:root` con `color-scheme: light dark` y cada color como `light-dark(<claro>, <oscuro>)`. Se acaban los
  dos bloques del oscuro repetidos (automático y elegido) que había que mantener iguales a mano.
- `:root[data-tema='claro'] { color-scheme: light }` y `:root[data-tema='oscuro'] { color-scheme: dark }`: elegir un
  tema solo fuerza el esquema; sin atributo ("Automático") manda el sistema.
- `:root[data-tema='contraste']`: sigue siendo un bloque propio (negro sobre blanco, bordes de 3 px, AAA), con
  `color-scheme: light`.
- Lo que no es un color (`--flecha-select`, un SVG en data URL) no entra en `light-dark()`: queda un bloque chico para
  el oscuro, documentado. Las sombras sí: el color de la sombra va con `light-dark()`.
- Compatibilidad: el objetivo sigue siendo Chrome 80 / Safari 15 (Android 8, iOS 15). `light-dark()` existe recién en
  Chrome 123 / Safari 17.5, pero el build pasa el CSS por lightningcss (`cssTarget`), que lo traduce a variables
  (`--lightningcss-light` / `--lightningcss-dark`) que esos navegadores entienden. Se verifica en el CSS del build.

### Sin destello al abrir

- `frontend/public/tema-inicial.js`: script clásico (no módulo, sin `defer`) en el `<head>` del `index.html`, antes
  del CSS. Lee `localStorage['buddys.tema.v1']` (con try/catch) y pone `data-tema` en `<html>` antes de pintar. Archivo
  aparte y no inline: así la CSP del panel no necesita `'unsafe-inline'` ni un hash.
- `<meta name="color-scheme" content="light dark">` en el `index.html`: el navegador pinta el fondo del esquema
  correcto antes de que llegue el CSS.
- `lib/tema.ts` sigue siendo la fuente de verdad en la app (misma clave y mismos valores); el script del `<head>`
  solo adelanta la primera aplicación.

### Selector

- En `MenuCuenta` (menú del avatar en el header), un grupo "Tema" con las 4 opciones como `menuitemradio`
  (`aria-checked`), dentro del patrón de menú que ya existe (flechas, Inicio/Fin, Escape).
- Elegir uno lo aplica al instante, lo guarda y **no cierra el menú** (se ve el cambio enseguida).
- **Cambio después de la crítica de impeccable:** el selector de Más **se queda** también (en el celular el botón de
  la cuenta es solo el avatar y el empleado no descubre el tema ahí). Los dos usan el mismo guardado.
- "Automático" dice en qué quedó ahora ("Como el celular · ahora oscuro").
- Si el celular no deja guardar (modo privado): queda puesto para esta visita, sin error.

## Ajustes por la crítica de impeccable (19/11)

- `--sobre-serie`: el número de la campanita era blanco sobre rosa claro en oscuro (2,2:1). Ahora pasa AA.
- `--fondo` oscuro más hondo (#0a0d1b): la hoja y el fondo se distinguen.
- El menú de la cuenta con borde `--linea-fuerte` (en oscuro, `--linea` no se veía).
- Bordes de la tanda 03-06 con `--grosor` / `--grosor-fino` y sus piezas en `contraste.css`: en alto contraste
  engordan como el resto.
- Sin transiciones mientras cambia el tema (clase `cambiando-tema`): nada se ve con colores de dos temas a la vez.
- `theme-color` (barra del sistema en Android): ahora sale de una tabla fija por tema (`COLOR_BARRA` en
  `lib/tema.ts`, controlada contra `tokens.css`), porque `--nav-fondo` es un `light-dark()` y no se puede leer
  resuelto desde JS.

## Permisos

Ninguno: es del dispositivo, lo usan los tres roles. No toca la API ni la base.

## Pruebas

- `src/test/contraste.test.ts`: lee los pares `light-dark()` de `:root` (claro = primer valor, oscuro = segundo) y el
  bloque de contraste; mismos pares y mínimos (AA en claro y oscuro, AAA en alto contraste). Nuevo: ningún color de
  `:root` queda sin su par oscuro, salvo la lista de los que son iguales en los dos temas (avatares).
- `src/test/tema.test.tsx`: el selector del menú de la cuenta (rol `menuitemradio`, `aria-checked`, guarda, no cierra).
- `public/tema-inicial.js`: test de que aplica el guardado y tolera localStorage roto o un valor desconocido.

## Estado

- [x] Implementado
- [x] Typecheck, lint y tests (frontend: 306 tests)
- [x] Revisión de pruebas (19/11): build traduce light-dark (52 pares `--lightningcss-light/dark`, ningún `light-dark(`
  crudo); el test de contraste mide de verdad los oscuros (probado con una mutación); arreglados en `lib/tema.ts` el
  aviso entre pestañas (ahora siempre activo y con `localStorage.clear()`) y la clase `cambiando-tema` con dos cambios
  seguidos. Tests: 316.
- [ ] Revisión de seguridad
