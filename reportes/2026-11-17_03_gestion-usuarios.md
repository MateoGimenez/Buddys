# 03 — Gestión de usuarios para admin y superadmin (baja sin perder historial)

Fecha: 2026-11-17 · Objetivo A · Rama `feature/usuarios-perfil-stock`

## Pedido

- Crear, editar y eliminar usuarios desde el panel, para `admin` y `superadmin`.
- `superadmin` gestiona a todos; `admin` gestiona **solo empleados** (no crea admins ni superadmins, ni edita o elimina a
  otro admin o superadmin).
- Nadie se elimina a sí mismo ni se baja el rol. Nunca queda el sistema sin superadmin activo.
- **Eliminar sin perder historial**: si el usuario tiene historial, se da de baja y su nombre sigue apareciendo en los
  lavados viejos.
- Buscador y filtro por rol y estado. Confirmación clara antes de eliminar.
- Todo pasa por `CAPACIDADES` y se ve en `GET /api/admin/permisos`.

## Decisión del dueño (2026-11-17)

**Baja + liberar el email.** Un usuario con historial no se borra: queda inactivo y marcado como dado de baja, se lo
banea en Supabase Auth y su email pasa a `baja+<id>@buddys.invalid` (así el email real se puede usar en una cuenta
nueva). Un usuario sin historial se borra de verdad, como hoy.

### Por qué así (el problema de hoy)

`buddys.perfiles` se borra en cascada con `auth.users`, y `bookings.trabajador_id`, `bookings.registrado_por`,
`gastos.creado_por`, `movimientos_stock.perfil_id`, `presupuestos.creado_por` y `comprobantes.creado_por` son
`ON DELETE SET NULL`: **hoy, eliminar a alguien borra su nombre de todos sus lavados**. Con la baja el perfil sigue
existiendo, así que cada lavado viejo sigue apuntando a la persona y mostrando su nombre.

## Permisos (`domain/permisos.ts`)

| Capacidad | superadmin | admin | empleado |
|---|---|---|---|
| `usuarios.gestionar` — Crear, editar y dar de baja usuarios del panel | `si` | **`parcial`**: *"Solo empleados: crearlos, editarlos, desactivarlos y darlos de baja"* | `no` |

Texto nuevo de la capacidad: *"Crear, editar, desactivar y eliminar usuarios del panel"*.

Funciones (la API decide con estas, nada suelto en las rutas):

- `puedeGestionarUsuarios(rol)`: `nivel !== 'no'` (entrar a `/api/admin/usuarios`).
- `puedeGestionarA(rolActor, rolObjetivo)`: superadmin → siempre; admin → solo si `rolObjetivo === 'empleado'`.
- `puedeAsignarRol(rolActor, rolNuevo)`: superadmin → cualquiera; admin → solo `'empleado'`.

Reglas (en el servicio, en este orden):

1. Sobre uno mismo: no se puede cambiar el propio rol, desactivarse ni eliminarse (`409 CONFLICT`, como hoy).
2. Admin sobre un admin o superadmin (editar o eliminar): `403 FORBIDDEN` *"Con tu rol solo podés gestionar empleados."*
3. Admin que crea o cambia a un rol que no es `empleado`: `403 FORBIDDEN` *"Con tu rol solo podés crear y editar empleados."*
4. Nunca sin superadmin activo: lo sigue garantizando el trigger `buddys_private.impedir_sin_superadmin` (la baja pone
   `activo = false`, así que el trigger la cubre) → `409 CONFLICT`.
5. Un usuario dado de baja no se edita ni se vuelve a dar de baja: `409 CONFLICT` *"Ese usuario está dado de baja."*
   (Reactivarlo queda fuera de este objetivo.)

## Base de datos (migración nueva `AAAAMMDDHHMMSS_usuarios_baja.sql`)

- `buddys.perfiles.eliminado_at timestamptz null`: cuándo se dio de baja. `null` = no está dado de baja.
- `CHECK (eliminado_at is null or not activo)`: un usuario dado de baja nunca está activo (segunda defensa).
- `GRANT UPDATE (eliminado_at)` a `buddys_app` (sumado a las columnas que ya puede cambiar). Mismo modelo de RLS que antes.
- **Red de seguridad para el historial**: las FK desde `bookings.trabajador_id`, `bookings.registrado_por`,
  `gastos.creado_por`, `movimientos_stock.perfil_id`, `presupuestos.creado_por` y `comprobantes.creado_por` pasan de
  `ON DELETE SET NULL` a **`ON DELETE RESTRICT`** (`NOT VALID` + `VALIDATE CONSTRAINT`, para no bloquear la tabla
  mucho tiempo). Así, si entre el "no tiene historial" y el borrado alguien registra un lavado, **la base rechaza el
  borrado** en vez de dejar el lavado sin nombre, y el servicio cae a la baja. Los índices parciales de esas columnas
  ya existen.
- Explicar en el comentario de la migración el cambio de FK y su efecto sobre el borrado desde el dashboard de Supabase:
  borrar ahí a alguien con historial va a fallar (hay que darlo de baja desde el panel).

## API

### Objeto `Usuario` (listado, alta y edición)

```json
{
  "id": "5f0c2a3e-9b1d-4c7e-8a55-2d3f1e6b7a90",
  "email": "lucia@ejemplo.com",
  "nombre": "Lucía",
  "rol": "empleado",
  "activo": true,
  "eliminadoAt": null,
  "tieneHistorial": true,
  "gestionable": true,
  "createdAt": "2026-10-18T15:00:00.000Z",
  "updatedAt": "2026-10-18T15:00:00.000Z"
}
```

- `eliminadoAt`: `string` (ISO 8601) si está dado de baja; si no, `null`.
- `tieneHistorial`: `true` si aparece en algún lavado o turno (`trabajador_id` o `registrado_por`), gasto, movimiento de
  stock, presupuesto o comprobante. La UI lo usa para explicar qué va a pasar al eliminar. Se calcula en **una sola**
  consulta para todo el listado (nada de N+1).
- `gestionable`: si **quien pide** puede editarlo y eliminarlo (`puedeGestionarA` y que no sea uno mismo ni esté dado de
  baja). Uno mismo aparece con `gestionable: false` (se edita desde *Mi perfil*, objetivo B).
- `email`: el admin solo ve el email de los empleados; para admins y superadmins le llega `null`. El superadmin ve todos.
  De un usuario dado de baja se devuelve `email: null` (el de Auth es `baja+<id>@buddys.invalid` y no le sirve a nadie).

### `GET /api/admin/usuarios` (admin y superadmin)

`200 { "usuarios": Usuario[], "gestionCuentas": boolean }`, con **todos** los usuarios, incluidos los dados de baja (los
más viejos primero). El buscador y los filtros se hacen en la UI (el equipo es chico). Empleado: `403 FORBIDDEN`
*"Con tu rol no podés gestionar usuarios."*

### `POST /api/admin/usuarios` (admin y superadmin)

Mismo body y errores que hoy. Además, `403` (regla 3) si un admin manda un `rol` distinto de `empleado`. `201 { "usuario": Usuario }`.

Riesgo aceptado (auditoría, B2): un admin puede saber si un email ya tiene cuenta por el `409` del alta (*"email en
uso"*). Es inherente al alta (el email tiene que ser único y hay que avisarlo) y el pedido queda logueado con el id de
quien lo hizo (sin el email).

### `PATCH /api/admin/usuarios/:id` (admin y superadmin)

Mismo body y errores que hoy. Además, `403` (reglas 2 y 3) y `409` (regla 5). `200 { "usuario": Usuario }`.

- La regla 2 se vuelve a comprobar al escribir: el `UPDATE` solo toca la fila si su rol sigue siendo uno que quien pide
  puede gestionar. Si en el medio lo ascendieron → `403`; si lo dieron de baja → `409`; si lo borraron → `404`
  (auditoría, B1). Email y contraseña se cambian en Auth solo si el perfil escrito sigue siendo gestionable.
- Cambiarle la contraseña o el email a **otra** persona le cierra todas las sesiones (`buddys_private.cerrar_sesiones`):
  en su pedido siguiente recibe `401` y vuelve a entrar con los datos nuevos. Si uno cambia su propia contraseña por
  acá, su sesión actual sigue (auditoría, B3).

### `DELETE /api/admin/usuarios/:id` (admin y superadmin) — **cambia la respuesta**

`200` con body (antes era `204`):

- Sin historial → se borra de Supabase Auth (perfil y sesiones en cascada): `{ "resultado": "eliminado" }`. Justo antes
  de borrarlo en Auth se relee el perfil: si en el medio lo ascendieron a un rol que quien pide no gestiona → `403`.
- Con historial (o si la base rechaza el borrado por la FK `RESTRICT`) → baja: `{ "resultado": "baja", "usuario": Usuario }`.

Pasos de la baja (orden pensado para que un fallo deje las cosas seguras):

1. En una transacción: `activo = false`, `eliminado_at = now()` y, **si `nombre` es `null`, `nombre` = la parte del
   email antes de la @** (recortada a 80; si queda vacía, *"Usuario dado de baja"*), así los lavados viejos siguen
   mostrando algo reconocible y no `baja+...`, sin exponer el email (auditoría, M1). Solo si su rol sigue siendo
   gestionable por quien pide (la fila se bloquea con `FOR UPDATE`; si no → `403`). Se le borran las sesiones
   (`buddys_private.cerrar_sesiones`). Lo frena el trigger del superadmin si corresponde.
2. Supabase Auth (`PUT /admin/users/:id`): `email = baja+<id>@buddys.invalid` (confirmado) y `ban_duration = "876000h"`.
   Su sesión ya quedó cortada en el paso 1 (sesiones borradas y, además, el middleware revisa `activo` en cada pedido).
3. Si el paso 2 falla: se deshace `eliminado_at` y el nombre (queda **inactivo**, sin acceso) y se responde `503`
   *"No pudimos terminar la baja en el servicio de usuarios. Quedó desactivado; probá eliminarlo de nuevo en unos minutos."*

Errores: `404`, `403` (regla 2), `409` (reglas 1, 4 y 5), `503` (falta `SUPABASE_SECRET_KEY` o falla Supabase).
Logs: solo ids y `resultado` (nada de emails).

### `GET /api/admin/permisos`

Sin cambios de forma: refleja la capacidad nueva (admin `parcial` con su matiz).

### Lo que no cambia y hay que cuidar

- `GET /api/admin/trabajadores` (para elegir "quién lavó") sigue trayendo solo los activos: los dados de baja no aparecen.
- Los lavados, turnos, gastos, movimientos y documentos de alguien dado de baja siguen mostrando su `nombre`.

## Frontend (`pages/Equipo.tsx`)

- La sección *Equipo* aparece para admin y superadmin (`puede('usuarios.gestionar')`).
- Buscador por nombre o email (sin distinguir mayúsculas ni acentos) y filtros por **rol** (Todos, Empleados, Admins,
  Superadmins) y **estado** (Activos, Inactivos, Dados de baja, Todos; por defecto *Activos e inactivos*, sin los dados de baja).
- Los no gestionables se ven sin acciones (y sin hueco donde irían). El admin solo puede elegir el rol *Empleado* al
  crear: el selector de rol no aparece.
- **Eliminar**: un diálogo (`<dialog>` modal, foco atrapado y Escape para cerrar) con el nombre de la persona y lo que
  va a pasar, según `tieneHistorial`:
  - `true`: *"Lucía tiene lavados registrados, así que no se borra: se da de baja. No va a poder entrar y su nombre
    sigue en los lavados viejos."* Botón **"Dar de baja a Lucía"**.
  - `false`: *"Se va a borrar a Lucía. No se puede deshacer."* Botón **"Eliminar a Lucía"**.
  - El botón de confirmar es del color de peligro y no tiene el foco inicial (lo tiene *Cancelar*).
- Los dados de baja se ven atenuados con la etiqueta *"Dado de baja el 17/11"*.
- Pasada de **impeccable** (`critique`, `audit`, `polish`) sobre *Equipo*; objetivos de 44 px.

## Pruebas que tienen que existir

- Matriz de permisos actualizada (`permisos.test.ts`) y `GET /api/admin/permisos` con el matiz del admin.
- Admin: crea un empleado (`201`); crear un admin (`403`); editar o eliminar a un admin o superadmin (`403`); ascender a
  un empleado a admin (`403`); no ve emails de admins ni superadmins.
- Superadmin: gestiona a cualquiera; no puede eliminarse, desactivarse ni cambiarse el rol (`409`).
- Eliminar sin historial → `resultado: "eliminado"`; con un lavado → `resultado: "baja"`, el perfil queda con
  `eliminado_at`, inactivo, y el lavado sigue mostrando el nombre en `GET /api/admin/lavados`.
- Baja de alguien sin nombre: el lavado muestra la parte de su email anterior antes de la @.
- La baja del último superadmin activo → `409`. Editar a un dado de baja → `409`.
- Falla de Supabase en el paso 2 → `503` y el usuario queda inactivo sin `eliminado_at`.
- Migración sobre datos existentes en pglite: la FK `RESTRICT` frena el `DELETE` de un perfil con lavados.
- Frontend: buscador, filtros, diálogo con los dos textos, y que el admin no vea el selector de rol ni acciones sobre admins.

## Fuera de este objetivo

- Reactivar a alguien dado de baja (se puede crear una cuenta nueva con su email).
- Foto en la lista del equipo: la agrega el objetivo B.

## Estado

- [x] Migración (buddys-base-de-datos): `20261117100000_usuarios_baja.sql` + `test/migracion-usuarios-baja.test.ts`. El RESTRICT rechaza con SQLSTATE `23001` (restrict_violation), no `23503`.
- [x] Backend (buddys-backend): `CAPACIDADES` (admin `parcial`), `puedeGestionarA` y `puedeAsignarRol` en
  `domain/permisos.ts`; `eliminadoAt`, `list()` con `tiene_historial` en una consulta, `tieneHistorial`, `darDeBaja` y
  `revertirBaja` en `repositories/postgres/perfiles.ts`; reglas 1–5 y baja con compensación en `services/usuarios.ts`;
  `banUser` en `lib/supabase-admin.ts` (y en el fake); `DELETE` responde `200` con `resultado`. Decisión: cada uno ve
  siempre su propio email (el admin, el suyo aunque sea admin). Un admin tampoco se edita a sí mismo por acá (regla 2:
  es admin → `403`; rol y activo dan `409` por la regla 1, que va primero). El SQLSTATE `23001` no llega a través de
  GoTrue (responde `500` genérico): ante cualquier fallo del borrado se vuelve a consultar el historial y, si ahora
  tiene, cae a la baja. Migración extra de datos `20261117100500_roles_admin_gestiona_empleados.sql`: la descripción del
  rol admin decía *"No gestiona usuarios."* y sale en `GET /api/admin/permisos`. Regenerados
  `test/fixtures/respuestas-api.json` (capturas `usuarios*`) y `usuariosAdmin`/`usuariosEmpleado` de
  `frontend/src/test/respuestas-reales.json`. Tests en `test/usuarios.test.ts`, `test/permisos.test.ts` y
  `test/repositories.contract.test.ts`.
- [x] Frontend (buddys-frontend): `pages/Equipo.tsx` (buscador, filtros, diálogo de eliminar, dados de baja), `lib/equipo.ts`,
  `nivel()` en la sesión y respaldo por rol con admin en `parcial`, tests en `test/equipo.test.tsx`. Los usuarios de los
  tests están armados a mano según este contrato (`equipo()` en `test/fixtures.ts`) hasta que se regenere
  `respuestas-reales.json` con las claves nuevas.
- [x] Pruebas (buddys-pruebas): typecheck, lint, build y tests del A en verde (backend: 7 archivos y 109 tests del A
  más el contrato; frontend: 16 archivos y 133 tests). El contrato `respuestas-api.json` coincide con la API real, y
  `respuestas-reales.json` es coherente con los fixtures de Equipo (`frontend/src/test/contrato-equipo.test.ts`).
  Casos límite en `backend/test/usuarios-bordes.test.ts`: escalada del admin, ids mal formados o en mayúsculas, dos
  bajas a la vez, email de más de 80 caracteres sin nombre, nombre en lavados, gastos y movimientos, carrera de la FK y
  emails de admins. Arreglo: el dominio reservado `@buddys.invalid` ya no se puede poner a mano en el alta ni en la
  edición (`schemas/usuarios.ts`, `DOMINIO_DE_BAJA` en `domain/perfil.ts`); antes bloqueaba para siempre la baja de
  esa persona (503 en cada intento). Las migraciones están listas para aplicar. Quedan 6 fallas en la corrida completa
  (`registradoPor` en los turnos), del objetivo C, que está en curso.
- [x] Seguridad (buddys-seguridad): auditoría con hallazgos M1, B1, B2 y B3.
- [x] Arreglos de la auditoría (buddys-backend):
  - M1: sin nombre, `GET /api/admin/trabajadores` y la baja usan la parte del email antes de la @ (`left(split_part(email,
    '@', 1), 80)`; si queda vacía, *"Sin nombre"* en trabajadores y *"Usuario dado de baja"* en la baja), nunca el email
    entero (`repositories/postgres/perfiles.ts`). Falta el mismo cambio en `repositories/postgres/bookings.ts` (lo hace
    el objetivo C, que tiene ese archivo).
  - B1: `update` y `darDeBaja` del repositorio reciben los roles gestionables de quien pide (`ROLES` filtrados por
    `puedeGestionarA`) y solo escriben si el rol actual está entre ellos; si no escriben, el servicio relee y responde
    `404`, `409` o `403`. Antes de `deleteUser` en Auth se relee el perfil (no se puede bloquear con `FOR UPDATE`: GoTrue
    borra la fila desde otra conexión y se trabaría con nuestro lock; queda una ventana mínima entre la relectura y el
    borrado). Antes de cambiar email o contraseña en Auth se verifica que el perfil escrito siga siendo gestionable.
  - B2: riesgo aceptado, anotado arriba (alta).
  - B3: migración `20261117130000_cerrar_sesiones_usuario.sql` (`buddys_private.cerrar_sesiones(uuid)`, SECURITY
    DEFINER, `search_path` vacío, `EXECUTE` solo para `buddys_app`; test en `test/migracion-cerrar-sesiones.test.ts`).
    La llama el servicio después de cambiarle contraseña o email a otra persona (si falla, se loguea y el cambio igual
    responde `200`) y la transacción de la baja. Consecuencia: la sesión abierta de alguien dado de baja ahora recibe
    `401` (antes `403 NO_ACCESS`). **Pendiente de aplicar en Supabase**, después de las anteriores del objetivo A.
  - Tests en `test/usuarios-bordes.test.ts`, `test/usuarios.test.ts` y `test/repositories.contract.test.ts`.
