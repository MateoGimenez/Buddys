---
version: 1
slug: "frontend-src"
primary_target: "frontend/src"
related_targets: []
---

# Panel interno Buddys (frontend/src)

Scope: todo el panel interno (login, registrar lavado, planilla del día, estadísticas, servicios, equipo, gastos, insumos, presupuestos). Mode: Operate. Build path: code-led (no image generation; Operate).
Audience/job: empleados registran un lavado en segundos desde el celular al sol; dueño revisa planilla, corrige y mira números.
Decision round: no hubo canal para preguntarle al usuario (agente sin herramienta de preguntas); se construye la dirección asignada sin presentar alternativas. Candidatos propios (por resonancia): 1 frascos de química de detailing codificados por color, 2 tabla de posiciones del fútbol, 3 talonario de remitos con copia (papel autocopiativo), 4 pizarra de precios del lavadero, 5 tótem de precios de estación de servicio, 6 menú del túnel de lavado, 7 fileteado. Asignado: 3.
Challengers: exposure record (declined; raise: neutrales en una rampa corta de papel), labanotation (declined), transit diagram (declined), j-card (declined; raise: mitades duras mañana/tarde con totales alineados a la derecha), doujin catalog (declined), acetate manual (declined).

## Direction contract

THESIS: Cada lavado es una hoja del talonario: se escribe, se numera y queda la copia. Rechaza el dashboard gris de tarjetas con métricas grandes.
OWN-WORLD: Papel blanco de original sobre fondo de copia amarilla canario muy clara; tinta azul carbónico (azul profundo) para texto principal y acciones; numeración roja de imprenta para los números de orden; copia rosa como estado de corrección/peligro suave. Archivo (ancho variable) para todo; números tabulares; serie N° en ancho condensado.
STORY: El empleado abre, toca el servicio, el vehículo, el monto y "Registrar"; ve su hoja nueva arriba de la planilla. El dueño ve el día como un talonario: total, cierre de caja y cada hoja corregible, con quién la registró.
FIRST VIEWPORT: Registrar lavado en el celular: barra superior con marca y fecha de hoy; vehículo en control segmentado; servicios como opciones grandes en grilla de 2; monto con teclado numérico; trabajador (admin); "Más datos" plegado; botón Registrar fijo abajo al alcance del pulgar. Navegación inferior: Registrar, Planilla, Números, Más.
FORM: Talonario de remitos autocopiativo, posición 3 de 7. seed:b5ebe774f125563a
Signature move: al registrar, la hoja se "arranca" por la línea de troquel (perforado punteado) y cae como copia numerada (N° 0007 en rojo) en la planilla; las filas de la planilla son copias con troquel y serie.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Estructura del código (para agentes que suman pantallas)

- `src/pages/<pantalla>/`: una carpeta por pantalla. El componente de la ruta es `<Pantalla>.tsx`; las partes, archivos al
  lado (ej. `planilla/Resumen.tsx`, `Caja.tsx`, `Lista.tsx`, `Copia.tsx`, `Corregir.tsx`; `registrar/Talon.tsx`,
  `MasDatos.tsx`, `RepetirUltimo.tsx`). Constantes y tipos de la pantalla en `.ts` aparte (`registrar/datos.ts`,
  `registrado.ts`, `memoria.ts`) para que Fast Refresh no se queje. Estilos propios en `<pantalla>.css` en la misma carpeta.
- Ruta nueva: entrada en `SECCIONES` (`src/components/Layout.tsx`, con su capacidad de `/api/admin/permisos`) y en
  `PAGINAS` (`src/App.tsx`).
- `src/api/`: `client.ts` (fetch, errores, refresco de sesión), `endpoints.ts` (una función por endpoint),
  `types.ts` (tipos actuales). Tipos de un dominio nuevo van en un archivo propio (`src/api/<dominio>.ts`) y sus funciones en
  `endpoints.ts` o al lado.
- `src/components/`: piezas compartidas (`ui.tsx`, `ElegirServicios`, `CampoPatente` con prop opcional `sugerencias` para
  el historial de patentes cuando exista el endpoint). `src/lib/`: lógica sin UI (cola sin conexión, formato, movimiento,
  tema, patente).
- Estilos: `src/styles/index.css` importa todo en orden fijo (tokens → base → estructura → componentes → pantallas →
  contraste → movimiento). Una pantalla nueva suma su `@import` en el bloque "Pantallas". Colores SOLO con variables de
  `styles/tokens.css`; un par texto/fondo nuevo se suma a `src/test/contraste.test.ts`.
- Tests: unidad en `src/test/*.test.ts(x)` (vitest + jsdom, `apiFalsa`), punta a punta en `e2e/` (Playwright,
  `npm run e2e`, API mockeada con `page.route` en `e2e/api-falsa.ts`). Respuestas: `src/test/respuestas-reales.json`, que
  se pone al día con `npm run respuestas` desde el contrato del backend (`scripts/actualizar-respuestas.ts`; el test
  `scripts/respuestas.test.ts` avisa si quedó desincronizado).

## Temas

Automático (sigue al celular) / Claro / Oscuro / Alto contraste (para el sol), elegibles en el menú de la cuenta del
header y en Más; `data-tema` en `<html>`, guardado en localStorage (`buddys.tema.v1`, con try/catch) y aplicado antes
de pintar por `public/tema-inicial.js`. Colores con `light-dark(claro, oscuro)` en un solo `:root` (lightningcss los
traduce para Chrome 80 / Safari 15); claro/oscuro solo fuerzan `color-scheme`. Alto contraste: negro sobre blanco, bordes de 3 px, sin
grises, lo elegido en amarillo. Contraste verificado por test: AA en claro y oscuro, AAA en alto contraste.

## Compatibilidad (celulares viejos)

Objetivo: Android 8+ con Chrome 80+ e iPhone con iOS 15+. `build.target` es2020/chrome80/safari15 y `cssTarget` igual
(lightningcss baja inset/propiedades lógicas a left/right/width). Revisado:
- View Transitions: React Router las usa solo si existen; si no, cambio directo.
- `position: sticky`: soportado en todo el objetivo.
- `:has()`: solo para el anillo de foco de opciones/servicios; fallback `:focus-within` con `@supports selector(:has(*))`.
- Container queries: no se usan. `dvh`: con `vh` antes como fallback.
- `<dialog>` (Safari < 15.4): fallback con clase `dialogo-sin-modal`, fijo al centro con velo.
- localStorage: siempre con try/catch (cola, tema, memoria de Registrar). IndexedDB: no se usa.
- `crypto.randomUUID`: fallback con `getRandomValues` (http en la red local). `Array.at` reemplazado.
- Bundle revisado: sin `??=`, `Object.hasOwn`, `structuredClone`, `.at(`, `findLast`, `toSorted`; `reportError`,
  `queueMicrotask` y `startViewTransition` aparecen con guardas.
- Degradado aceptado: Chrome 80-83 no tiene `gap` en flex (queda más apretado, funciona); Safari < 15.4 y Chrome < 86 sin
  `:focus-visible` usan el anillo de foco del navegador.
- `@vitejs/plugin-legacy` 8.2.4 medido y descartado: 57 kB gzip de polyfills + bundle legacy de 134 kB gzip, para
  navegadores sin módulos ES que no están en el objetivo.
