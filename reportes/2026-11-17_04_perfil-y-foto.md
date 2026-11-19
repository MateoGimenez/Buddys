# 04 — Perfil en el header, Mi perfil y foto de perfil

Fecha: 2026-11-17 · Objetivo B · Rama `feature/usuarios-perfil-stock`

## Pedido

- En el header: **avatar, nombre y rol** de quien está logueado. Al tocarlo se abre un menú con *Mi perfil* y *Cerrar sesión*.
- *Mi perfil*: cambiar el nombre, **subir, cambiar o quitar la foto** y cambiar la contraseña.
- Sin foto: las iniciales sobre un color fijo para cada usuario.
- La foto va a **Supabase Storage** (bucket privado) y pasa **por la API**, porque la sesión es BFF y el navegador nunca ve
  tokens. Solo JPG, PNG o WebP, de 2 MB como máximo, validando el contenido real. Se re-codifica a 256×256 en WebP, sin EXIF.
  Se sirve desde la API.
- Los admins ven la foto de cada usuario en la lista del equipo.
- Diseño con **impeccable**, cómodo en el celular, con objetivos táctiles de 44 px.

## Decisión del dueño (2026-11-17)

Se agrega `sharp` al backend y una migración crea el bucket privado `avatares`. **La migración la aplica el dueño.**

## Base de datos (migración nueva `20261117110000_perfil_foto.sql`)

- `buddys.perfiles.foto_actualizada_at timestamptz null`: `null` = sin foto. Sirve de versión de la foto (ETag y `?v=`
  en la URL). La ruta en Storage es fija: `avatares/<perfil_id>.webp`, así que no hace falta guardarla.
- `GRANT UPDATE (foto_actualizada_at)` a `buddys_app`.
- Bucket: `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('avatares',
  'avatares', false, 262144, array['image/webp']) on conflict (id) do nothing;`. Va **dentro de un bloque que solo corre si
  existe el esquema `storage`** (pglite no lo tiene). El bucket es privado y **sin policies** en `storage.objects`: solo
  entra la secret key del backend. Ni `anon` ni `authenticated` pueden leer ni escribir.

## API

### Usuario de la sesión (`/api/auth/login`, `/api/auth/me`, `/api/auth/refresh`)

Suma `"fotoVersion": string | null`: el `foto_actualizada_at` en ISO 8601, o `null` si no tiene foto. El objeto `Usuario`
de `GET /api/admin/usuarios` (objetivo A) suma el mismo campo.

### `GET /api/admin/perfil` (todos los roles)

`200 { "perfil": { "id", "email", "nombre", "rol", "fotoVersion" }, "fotosDisponibles": boolean }`. Si
`fotosDisponibles` es `false` (falta `SUPABASE_SECRET_KEY`), la UI esconde subir y quitar la foto.

### `PATCH /api/admin/perfil` (todos los roles)

Body estricto con al menos un campo:

- `nombre`: mismas reglas que en usuarios (1 a 80, una línea; `null` o `""` lo borran).
- `passwordActual` + `passwordNueva`: van juntos. `passwordNueva` tiene las mismas reglas que el alta de usuarios.

`200 { "perfil": ... }`. Errores:

- `400 VALIDATION_ERROR`: si falta una de las dos contraseñas va en `fields.passwordActual` o en `fields.passwordNueva`. Si
  la actual no es correcta: `fields.passwordActual` *"La contraseña actual no es correcta."*. También si Supabase rechaza
  la nueva por débil.
- `429 RATE_LIMITED`: más de 5 intentos de contraseña en 15 minutos, contados por usuario (es el límite del login).
- `503 SERVICE_UNAVAILABLE`: Supabase no responde o falta `SUPABASE_SECRET_KEY` (solo para la contraseña).

Cómo se verifica la contraseña actual: un `grant_type=password` contra Supabase Auth con el email de la sesión. Si sale
bien, **se cierra enseguida la sesión de Supabase que abrió esa verificación** (`logout`, `scope=local`, con ese token).
Después se cambia con la API admin. La sesión actual sigue abierta.

### `PUT /api/admin/perfil/foto` (todos los roles)

- El body es **binario**: la imagen tal cual, con `Content-Type: image/jpeg`, `image/png` o `image/webp` (nada de
  multipart ni de base64).
- **Excepción acotada al control CSRF** (`request-guard`): esta ruta, y solo esta, acepta esos tres `Content-Type` en vez
  de `application/json`. El control de `Origin` sigue igual. Un formulario de otro sitio no puede mandar `image/png` sin
  preflight CORS, y la cookie es `SameSite=Strict`.
- Límite de 2 MB (`express.raw` solo en esta ruta). Si es más grande: `413 PAYLOAD_TOO_LARGE` *"La foto pesa más de 2 MB.
  Elegí una más liviana."*
- Se valida el **contenido real**: los primeros bytes (`FF D8 FF` = JPG, `89 50 4E 47 0D 0A 1A 0A` = PNG,
  `RIFF....WEBP` = WebP) tienen que coincidir con el `Content-Type`. Después, `sharp` tiene que poder decodificarla, con
  `limitInputPixels` de 40 MP y `failOn: 'error'`, y sin imágenes animadas. Si algo falla: `400 VALIDATION_ERROR` en
  `fields.foto` *"Subí una foto JPG, PNG o WebP."*
- Proceso: `.rotate()` (aplica la orientación del EXIF), `resize(256, 256, { fit: 'cover' })` y `webp({ quality: 80 })`,
  **sin** `withMetadata()` (así no queda EXIF, GPS ni perfil ICC). Se sube a Storage (`avatares/<id>.webp`, upsert) con la
  secret key y después se pone `foto_actualizada_at = now()`.
- `200 { "perfil": ... }` con la `fotoVersion` nueva. `503` si falta la clave o Storage falla (en ese caso el perfil no
  cambia).

### `DELETE /api/admin/perfil/foto` (todos los roles)

Borra el objeto en Storage y pone `foto_actualizada_at = null`. Responde `200 { "perfil": ... }`. Si no tenía foto, da `200` igual.

### `GET /api/admin/usuarios/:id/foto` (uno mismo, o admin y superadmin)

- Uno mismo: siempre. Admin y superadmin: cualquier usuario (usan `puedeGestionarUsuarios`). Empleado pidiendo la foto de
  otro: `403`.
- `200 image/webp`, con `Cache-Control: private, max-age=86400, immutable` cuando viene `?v=` y es igual a la versión
  actual, o `private, no-cache` si no. También `ETag` (la versión), `X-Content-Type-Options: nosniff` y
  `Content-Security-Policy: default-src 'none'` (la respuesta es una imagen, nunca un documento). `304` si coincide
  `If-None-Match`.
- `404` si no tiene foto o no existe. La UI arma la URL con `?v=<fotoVersion>`.
- No hace falta tocar la CSP del panel: la imagen es `'self'`.

### Storage desde el backend

Un cliente nuevo `src/lib/supabase-storage.ts`, con el mismo estilo que `supabase-admin.ts`: `fetch` inyectable,
timeout, errores tipados y nada de secretos en los logs. Usa `PUT`/`POST /storage/v1/object/avatares/<id>.webp`
(`x-upsert: true`), `GET` para leer y `DELETE` para borrar, siempre con la secret key. Hay que verificar en la
documentación de Supabase qué cabeceras van con las claves nuevas `sb_secret_...`. En los tests se usa un fake en
memoria, como `supabase-fake.ts`.

Cuando se elimina un usuario (objetivo A), se borra también su foto si tenía. Si eso falla, se anota en el log y no
frena la baja.

## Permisos

Capacidad nueva `perfil.editar`: *"Cambiar su propio nombre, foto y contraseña"*, con `si` para los tres roles. La
función es `puedeEditarPerfil`.

## Frontend

- **Header** (`components/Layout.tsx`): botón con el avatar (32 px dentro de un objetivo de 44 px), el nombre y el rol (en
  celular, solo el avatar). Abre un menú desplegable (`popover`, o un menú accesible con `aria-expanded`, flechas y
  Escape) con *Mi perfil* y *Cerrar sesión*. *Cerrar sesión* deja de estar suelto en el header.
- **Componente `Avatar`**:
  - Con `fotoVersion`, muestra `<img src="/api/admin/usuarios/<id>/foto?v=...">` con `alt=""` (el nombre ya está al lado),
    `loading="lazy"`, `decoding="async"` y tamaño fijo para que no haya saltos de layout.
  - Sin foto, muestra las iniciales (hasta 2, del nombre o si no del email) sobre un color de una paleta fija de 8 tonos
    con contraste AA, elegido con un hash del `id`.
  - Si la imagen falla, vuelve a las iniciales.
- **Pantalla `/perfil`** (`pages/Perfil.tsx`):
  - **Foto**: vista previa grande, *Subir foto* / *Cambiar foto* (`<input type="file" accept="image/jpeg,image/png,image/webp">`)
    y *Quitar foto*. El tamaño se controla antes de mandarla (más de 2 MB → error sin subir) y se muestra el progreso o el
    estado ocupado.
  - **Nombre**.
  - **Contraseña**: actual, nueva y repetir la nueva, con `autocomplete` correcto (`current-password` y `new-password`).
  - Cada bloque se guarda por separado, con su mensaje de listo o de error.
- **Equipo**: avatar en cada fila.
- La sesión (`SessionContext`) actualiza `usuario.nombre` y `fotoVersion` después de guardar, sin recargar.
- Pasada de **impeccable** (`critique`, `audit` y `polish`) sobre el header, el menú y *Mi perfil*.

## Pruebas que tienen que existir

- Foto:
  - Aceptadas: JPG, PNG y WebP reales (generadas con sharp en el test).
  - Rechazadas: un PNG con `Content-Type: image/jpeg`; un HTML o un SVG renombrados; una de 3 MB (`413`); una
    "bomba" de píxeles (`400`); un GIF animado; `Content-Type: text/plain` (`415`).
  - La salida es WebP de 256×256 y sin EXIF: se sube una JPG con EXIF y GPS y se comprueba con `sharp().metadata()`.
- Acceso a la foto: uno mismo, un admin y un superadmin (`200`), el empleado pidiendo la de otro (`403`), sin foto
  (`404`), `304` con ETag, y las cabeceras `nosniff` y CSP.
- Contraseña: la actual incorrecta (`400`), la correcta (se cierra la sesión de verificación) y el límite de intentos (`429`).
- `PATCH` del nombre se refleja en `/api/auth/me`. Sin `SUPABASE_SECRET_KEY`: `fotosDisponibles: false` y `503`.
- Frontend: menú del header (teclado y Escape), iniciales y su color estable, vuelta a las iniciales si la imagen falla,
  subir con un archivo grande (error), y guardar el nombre (el header se actualiza).

## Variables nuevas

Ninguna: Storage usa `SUPABASE_URL` y `SUPABASE_SECRET_KEY`, que ya existen.

## Estado

- [x] Migración (buddys-base-de-datos)
- [x] Backend (buddys-backend) — 2026-11-18. `sharp` 0.35 en `package.json`. `fotoVersion` en el usuario de la sesión
  (login, `/me`, refresh), en `Usuario` de `GET /api/admin/usuarios` y en `Perfil` del dominio (todas las lecturas de
  `perfiles` leen `foto_actualizada_at`; `setFoto` nuevo en el repositorio). Rutas en `routes/admin-perfil.ts`, lógica en
  `services/perfil.ts` (`procesarFoto`), esquema en `schemas/perfil.ts`, Storage en `lib/supabase-storage.ts` (secret key
  solo en `apikey`, confirmado con `search_docs`: las `sb_secret_` no van en `Authorization: Bearer`). Excepción del CSRF
  acotada a `PUT /admin/perfil/foto` en `request-guard.ts`. Rate limit nuevo `rateLimits.perfilPassword` (5 cada 15 min,
  por id de usuario, correctos o no; cambiar solo el nombre no cuenta). Capacidad `perfil.editar` / `puedeEditarPerfil`.
  `verifyPostgresSchema` exige la columna. Baja y eliminación borran la foto (en la baja también la versión); si Storage
  falla, solo log. Tests: `test/perfil.test.ts` (23) y `test/storage-fake.ts`; ajustados `auth`, `usuarios` y
  `repositories.contract`. Fixtures: `respuestas-api.json` regenerado (capturas `perfil*`, `error4xxFoto*`,
  `usuariosConFoto`, `meConFoto` y `perfil.editar` en permisos); en `respuestas-reales.json`, regeneradas `loginAdmin`,
  `meAdmin`, `meEmpleado`, `refreshOk` y `usuariosAdmin`, y nuevas las de perfil. `contrato.test.ts` y
  `contrato-equipo.test.ts` vuelven a exigir `fotoVersion`; `perfil.test.tsx` usa las respuestas reales.
  Notas: (1) el trigger `perfiles_set_updated_at` hace que subir o quitar la foto también mueva `updated_at`. (2) El `415`
  de la foto con otro tipo usa el mensaje general (*"Tiene que enviarse como JSON."*), porque sale del mismo control
  CSRF: si molesta, se puede dar un mensaje propio para esa ruta. (Resuelto en Pruebas: ya tiene mensaje propio.)
- [x] Frontend (buddys-frontend)
- [x] Pruebas (buddys-pruebas) — 2026-11-18. Backend: vitest 888/888 (antes 873/873), `tsc`, `eslint` y `build` en
  verde. Frontend: los dos `tsc` y `eslint` en verde; vitest 141/141 con 2 workers (con 4 fallan al azar 1 a 3 `findBy`
  por tiempo en `caja`, `equipo` y `multiservicio`, ajenos al B). Arreglado: el `415` de `PUT /api/admin/perfil/foto` dice
  *"Subí una foto JPG, PNG o WebP."* (también con JSON o sin `Content-Type`; el resto de la API sigue con el mensaje de
  JSON), en `request-guard.ts` y `AppError.unsupportedMediaType(message?)`; `error415FotoTipo` regenerado en
  `respuestas-api.json` (fue la única diferencia de contrato). Corregido el comentario de la baja en
  `services/usuarios.ts`. Tests nuevos: `backend/test/perfil-limites.test.ts` (15: 0 bytes, 2 MB justos y +1, Content-Length
  mentido, chunked, tEXt, CMYK, 1×1, 10000×100, sin exif/icc/xmp, orientación 6, doble subida, acceso y caché, límite con
  dos usuarios, sesión de verificación cerrada si el cambio falla, nueva igual a la actual) y
  `frontend/src/test/perfil-limites.test.tsx` (5: reintento del Blob tras 401 y foco del menú). Migración revisada: lista.
- [x] Seguridad (buddys-seguridad): sin críticos ni altos. M1 (cerrar las otras sesiones al cambiar la propia contraseña), B1 (límite y semáforo de la foto) y B2 (bucket forzado a privado) arreglados con test en la migración 20261117140000 y el backend.
  - 2026-11-18, arreglos de la auditoría (buddys-backend). **M1**: cambiar la propia contraseña cierra las OTRAS
    sesiones de esa persona (`buddys_private.cerrar_otras_sesiones(p_usuario, p_sesion_actual)` con el `session_id` del
    JWT, después de `updateUser`; si falla, `200` y solo log con ids). **B2**: la misma migración nueva
    `20261117140000_cerrar_otras_sesiones_bucket.sql` fuerza `avatares` a privado, 256 KiB y solo WebP aunque ya
    existiera (solo si existe `storage.buckets`); antes de aplicarla, revisar que `storage.objects` no tenga policies
    genéricas para `authenticated` sin filtro por `bucket_id`. **B1**: `rateLimits.perfilFoto` (10 subidas cada 15 min,
    por id de usuario, montado antes de `fotoBody()`) y semáforo de 2 en `procesarFoto` (lo que espera, espera).
    **Baja con Storage caído**: `foto_actualizada_at = null` antes de borrar el objeto; si Storage falla, el huérfano
    queda en el log con el id. Ninguna forma JSON cambió (`respuestas-api.json` sin cambios); respuesta nueva: `429` de
    la foto con *"Subiste demasiadas fotos seguidas. Esperá unos minutos antes de volver a probar."*. Backend: vitest
    900/900, `tsc` y `eslint` en verde. Migración PENDIENTE de aplicar (la aplica el dueño, no se tocó Supabase).
