# 04 — Contrato del perfil del usuario y la foto de perfil

Fecha: 2026-11-16

**Estado: hecho en el backend (2026-11-17), sin aplicar en Supabase.** Typecheck y lint OK; 55 archivos / 830 tests en verde (antes 53 / 811); fixtures regenerados. Ver "Estado" al final.

Contrato del backend para el panel. Todas las rutas cuelgan de `/api/admin/*` (sesión obligatoria; sin sesión
`401 UNAUTHORIZED`). Formato de error de siempre: `{ "error": { "code", "message", "fields"? } }`. Un body con un campo
desconocido es `400 VALIDATION_ERROR`. Las respuestas reales están en `backend/test/fixtures/respuestas-api.json`
(claves `perfilGet`, `perfilPatch`, `error400PerfilNombre`, `avatarSubida`, `error400AvatarTamano`,
`avatarConfirmado`, `error409AvatarSinPendiente`, `meConAvatar`, `trabajadoresConAvatar`, `usuariosConAvatar`,
`error400ClaveActual`, `error400ClaveIgual`).

Todo es **sobre el usuario de la sesión**: no hay ningún id en la URL y nadie puede tocar el perfil de otro (el
superadmin sigue gestionando a los demás por `/api/admin/usuarios`). Permiso: `perfil.propio` en `CAPACIDADES`
(todos los roles).

## La foto de perfil: cómo sale por la API

Nunca sale la ruta del bucket: solo una **URL firmada de lectura que vence en 1 hora** (`avatarUrl`) y cuándo vence
(`avatarVenceEl`, ISO 8601 UTC). El backend guarda cada URL firmada en memoria y la reusa mientras le queden más de 10
minutos, así que dos pedidos seguidos devuelven la misma URL. El panel tiene que volver a pedir el dato (por ejemplo
`/api/auth/me`) antes de `avatarVenceEl` si la pantalla queda abierta mucho tiempo.

`avatarUrl` es `null` si la persona no tiene foto, si Storage no respondió al firmar (nunca es un error) o si las
fotos están apagadas.

**Fotos apagadas** (el servidor no tiene `SUPABASE_SECRET_KEY`): `avatarUrl` y `avatarVenceEl` siempre `null`, y las
rutas de la foto (`POST /avatar`, `POST /avatar/confirmar`, `DELETE /avatar`) y la de la contraseña responden
**`503 SERVICE_UNAVAILABLE`** con un mensaje claro (`"Las fotos de perfil no están configuradas en el servidor."`).
Se eligió 503 y no 404 porque es lo mismo que hacen las fotos de los lavados: la ruta existe, falta configuración.
`GET` y `PATCH /api/admin/perfil` funcionan igual.

## 1. Usuario de la sesión: `avatarUrl` y `avatarVenceEl`

`POST /api/auth/login`, `POST /api/auth/refresh` y `GET /api/auth/me` responden:

```json
{ "usuario": { "id": "uuid", "email": "beto@t.test", "nombre": "Beto", "rol": "empleado",
               "avatarUrl": "https://<proyecto>.supabase.co/storage/v1/object/sign/perfiles-avatares/<uuid>/<uuid>.webp?token=...",
               "avatarVenceEl": "2026-10-16T16:00:00.000Z" } }
```

## 2. `GET /api/admin/perfil`

Todos los roles. `200`:

```json
{ "perfil": { "id": "uuid", "email": "beto@t.test", "nombre": "Beto", "rol": "empleado",
              "avatarUrl": null, "avatarVenceEl": null, "creadoEl": "2026-10-16T15:00:00.000Z" } }
```

## 3. `PATCH /api/admin/perfil { nombre }`

- `nombre`: texto de **una línea**, **2 a 60 caracteres** después de sacar los espacios de los costados (y los
  caracteres de control de dirección). Obligatorio; no se puede borrar desde acá.
- `200 { perfil }` (misma forma que el GET). `400 VALIDATION_ERROR` con `fields.nombre` si no cumple; un campo
  desconocido (por ejemplo `rol`) es 400.

## 4. Foto de perfil: 3 pasos

### 4.1 `POST /api/admin/perfil/avatar { contentType, tamano }`

- `contentType`: `'image/jpeg' | 'image/webp'`; `tamano`: entero de 1 a 524288 (512 KB). El panel achica la foto
  antes (cuadrada, ~512 px alcanza).
- `201`:
  ```json
  { "subida": { "url": "https://<proyecto>.supabase.co/storage/v1/object/upload/sign/perfiles-avatares/<perfil>/<uuid>.webp?token=...",
                "metodo": "PUT", "headers": { "Content-Type": "image/webp" }, "venceEl": "2026-10-16T17:00:00.000Z" } }
  ```
  `venceEl` = ahora + 2 horas (lo fija Supabase). Pedir otra subida pisa la anterior que no se confirmó.
- Rate limit propio por usuario: **10 cada 10 minutos** (`429 RATE_LIMITED`).
- `400` si el tipo o el tamaño no son válidos; `503` si las fotos están apagadas o Storage no firmó.

### 4.2 El panel hace el `PUT`

`PUT <subida.url>` con el archivo como cuerpo y la cabecera `Content-Type` de `subida.headers`. Sin cookies ni
credenciales (es directo a Supabase). El bucket vuelve a exigir tipo y tamaño.

### 4.3 `POST /api/admin/perfil/avatar/confirmar` (sin body)

El backend mira el objeto en Storage (HEAD): que exista, que sea del tipo pedido y que pese hasta 512 KB.

- `200 { perfil }` con el `avatarUrl` nuevo. La foto anterior, si había, se borra del bucket.
- `409 CONFLICT`:
  - `"Todavía no subiste la foto: subila y volvé a confirmar."` (el PUT no llegó; la subida sigue pendiente y se
    puede reintentar);
  - `"La subida venció: pedí otra."` (pasaron las 2 horas; la pendiente se descarta);
  - `"No hay ninguna foto pendiente de confirmar: pedí una subida nueva."` (no se pidió ninguna o ya se confirmó).
- `400 VALIDATION_ERROR` `"La foto subida no es válida (tiene que ser JPG o WebP de hasta 512 KB): pedí otra subida."`
  (el archivo se borra).
- `503` si Storage no responde.

### 4.4 `DELETE /api/admin/perfil/avatar`

`204` siempre (también si no tenía foto). Saca la foto vigente y la subida pendiente, si había, y las borra del
bucket.

## 5. `POST /api/admin/perfil/clave { actual, nueva }`

- `actual`: la contraseña de hoy. `nueva`: 8 a 72 caracteres (no más de 72 bytes) y **distinta** de la actual.
- El backend verifica `actual` contra Supabase Auth (un login cuya sesión se cierra enseguida) y pone la nueva con la
  API admin. La sesión del panel sigue abierta; las demás sesiones de la persona no se cierran.
- `204` sin cuerpo.
- `400 VALIDATION_ERROR`:
  - `actual` no coincide: `message` y `fields.actual` = `"La contraseña actual no es correcta."` (no dice nada más);
  - `fields.nueva` si es corta, larga, igual a la actual o Supabase la rechaza por débil.
- Rate limit **estricto por usuario: 5 cada 15 minutos**, cuentan todos los intentos (`429 RATE_LIMITED`).
- `409` si el usuario no tiene email (no pasa con usuarios creados por email); `503` si falta `SUPABASE_SECRET_KEY` o
  Supabase no responde. Nunca se loguean contraseñas.

## 6. Listados con la foto de cada persona

- `GET /api/admin/trabajadores` (admin y superadmin) → `{ trabajadores: [{ id, nombre, rol, avatarUrl }] }`.
- `GET /api/admin/usuarios` (superadmin) → cada usuario suma `avatarUrl`.

Firmadas en lote (un pedido a Storage para toda la lista), vencen en 1 hora; `null` sin foto.

**Ranking de estadísticas y planilla** (`porTrabajador[]`, `trabajador` de cada turno): **no** llevan `avatarUrl`. El
panel la cruza por `id` con `GET /api/admin/trabajadores` (que ya pide para elegir quién hizo el trabajo). El empleado
no tiene acceso a `/trabajadores`: en sus pantallas solo ve su propia foto (`/api/auth/me`). Así las estadísticas no
dependen de Storage.

## 7. Conciliación

La conciliación horaria (la misma tarea que la de las fotos de los lavados, al arrancar y cada hora) también:
descarta las subidas de foto de perfil pendientes vencidas, borra del bucket `perfiles-avatares` lo anotado para borrar
(fotos reemplazadas, borradas o de usuarios eliminados) cuando vence su token de subida, y borra los objetos del bucket
que la base no conoce y tienen más de 2 horas.

## Permisos (`CAPACIDADES`)

| id | grupo | superadmin | admin | empleado |
|---|---|---|---|---|
| `perfil.propio` | Usuarios | si | si | si |

Sale en `GET /api/admin/permisos` como cualquier otra capacidad.

## Migraciones

- `20261116100000_perfil_avatar.sql`: `perfiles.avatar_path`, `avatar_pendiente_path` y `avatar_subida_vence_at`
  (null; CHECK de formato `'<perfil_id>/<uuid>.(jpg|webp)'` con la carpeta igual al propio perfil), `GRANT UPDATE` de
  esas columnas a `buddys_app`, tabla `buddys.avatares_a_borrar` (RLS, REVOKE, SELECT y DELETE a `buddys_app`) y el
  trigger `buddys_private.perfiles_avatar_a_borrar` (SECURITY DEFINER, porque el perfil también se borra en cascada
  desde Supabase Auth).
  - **Por qué una tabla nueva y no `fotos_a_borrar`:** `fotos_a_borrar` no dice de qué bucket es cada ruta (su clave
    es solo `path`, con el mismo formato `<uuid>/<uuid>.<ext>`) y ya está aplicada; ampliarla obligaba a cambiar su
    clave primaria y la conciliación de las fotos. Separadas, cada conciliación borra solo en su bucket.
- `20261116110000_storage_bucket_avatares.sql`: bucket **privado** `perfiles-avatares` (512 KB, `image/jpeg` e
  `image/webp`) y la policy RESTRICTIVA `perfiles_avatares_sin_acceso_api` para `anon` y `authenticated`. Fuera de
  Supabase no hace nada.

Las dos son idempotentes. **Hay que aplicarlas antes de reiniciar el backend**: el backend nuevo lee
`perfiles.avatar_path` en cada request y al arrancar verifica que existan las columnas y la tabla.

## Estado

- **Hecho en el backend** (2026-11-17): rutas, permisos, migraciones, conciliación, README y fixtures. Tests en
  `backend/test/perfil.test.ts` (PGlite y Storage falso: flujo completo, reemplazo, borrar, vencida, tamaño y tipo,
  Storage caído, fotos apagadas, rate limits, conciliación, baja del usuario, cambio de contraseña).
- **Sin aplicar en Supabase** (las dos migraciones 20261116*).
- Diferencias con el pedido original: ninguna en las formas. Decisiones: 503 (no 404) con las fotos apagadas; el
  ranking de estadísticas no lleva `avatarUrl` (el panel cruza con `/trabajadores`); el cambio de contraseña no cierra
  las otras sesiones de la persona.
