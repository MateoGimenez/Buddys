# Buddys Wash Detail - backend

API REST del **sistema interno** de Buddys Wash Detail (lavadero y detailing). El panel web está en `../frontend/`
(Vite + React) y consume los endpoints de este documento llamando a `/api` relativo. El contrato real de cada
respuesta está guardado en `test/fixtures/respuestas-api.json` (un test verifica que no cambie sin querer).

Hace esto:

0. **Registra lavados** (`POST /api/admin/lavados`): el auto que llega sin turno, con servicio, vehículo, cuánto se
   cobró y cómo pagó (forma de pago, para el cierre de caja); queda **registrado a nombre** de quien lo carga. Quien lo
   registró lo puede **deshacer** en los 5 minutos siguientes (`DELETE /api/admin/lavados/:id`). Cuenta en ingresos,
   metas y "mis trabajos". No hay ranking: el sistema no compara a las personas (contrato
   `reportes/2026-11-17_05_seguimiento-sin-ranking.md`). Ver
   [Registrar lavado](#registrar-lavado-post-y-get-apiadminlavados).
1. Las rutas **públicas** de turnos (catálogo, disponibilidad, pedir turno, seguimiento) vienen de MgDetailing y
   están **apagadas por defecto** (`TURNOS_ONLINE=false`, responden 404). Con `TURNOS_ONLINE=true` vuelven.
2. **Autentica** a los usuarios del panel con **Supabase Auth**, en modo BFF: el backend habla con Supabase y guarda los tokens en cookies httpOnly; el navegador nunca ve un token ni una clave.
3. Les permite **gestionar** esas solicitudes desde el panel `/admin` según su **rol** (`superadmin`, `admin`, `empleado`), al `superadmin` gestionar a todos los usuarios y al `admin`, a los empleados (alta, edición y baja sin perder el historial).
4. Sirve el **catálogo de servicios** (textos, precios, duraciones, destacado, orden) desde la base: la landing lo lee de `GET /api/servicios` y `admin`/`superadmin` lo editan desde el panel sin volver a publicar la web.
5. Arma la **agenda** del panel: qué turnos hay cada día y franja (`GET /api/admin/agenda`), con la **fecha y franja confirmadas** por el taller cuando difieren de las que pidió el cliente.
6. Guarda **notas internas** por turno (el cliente nunca las ve), **busca** turnos por nombre, email, vehículo o teléfono y arma el **historial del cliente** (sus turnos, por teléfono normalizado).
7. Maneja la **disponibilidad real** (horario semanal, días especiales y cupos por franja: el formulario solo acepta días y franjas con lugar), el **seguimiento** público del turno (`/turno/<id>`) y los **recordatorios** del día anterior por email (Resend) y/o WhatsApp Cloud, que dispara un cron. Contrato: `reportes/2026-10-23_11_disponibilidad-seguimiento-recordatorios.md`.
8. Manda **avisos push** al celular de quienes los activaron en el panel cuando entra un turno nuevo (sin datos personales en el aviso). Contrato: `reportes/2026-10-26_13_panel-pulido-y-app.md`, bloque A. A los encargados, además, cuando se registra un lavado sin monto y cuando se cumple la meta del mes.
9. **Mejoras del panel** (contrato `reportes/2026-11-15_03_contrato-mejoras.md`): etapas del auto en el lavadero con link de WhatsApp "ya está listo", descuentos, turnos con seña, historial por teléfono o patente, tarjeta de sellos y clientes inactivos, gastos fijos (sueldos), cierre de caja con arqueo, fotos antes/después en Supabase Storage, insumos que se descuentan solos, exportar a CSV y registro de errores del panel. Ver [Mejoras del panel](#mejoras-del-panel-contrato-2026-11-15).

Stack: Node 24 + TypeScript (strict, ESM) + Express 5, **Postgres en Supabase** (driver `pg`) como único motor, **Supabase Auth** (API REST de GoTrue, sin `supabase-js`), zod, helmet, cors, express-rate-limit, jose (verificación de los JWT contra el JWKS del proyecto). Los tests usan PGlite (Postgres en memoria).

## Contenido

- [Instalación y uso](#instalación-y-uso)
- [Variables de entorno](#variables-de-entorno)
- [Supabase Auth: usuarios y roles](#supabase-auth-usuarios-y-roles)
- [Base de datos](#base-de-datos)
- [Conectar Supabase](#conectar-supabase)
- [Endpoints con ejemplos curl](#endpoints-con-ejemplos-curl)
- [Contrato de la API](#contrato-de-la-api)
- [Mejoras del panel (contrato 2026-11-15)](#mejoras-del-panel-contrato-2026-11-15)
- [Avisos por WhatsApp](#avisos-por-whatsapp)
- [Recordatorios](#recordatorios)
- [Avisos push](#avisos-push)
- [Operación](#operación)
- [Seguridad](#seguridad)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Scripts y tests](#scripts-y-tests)

## Instalación y uso

Requisitos: Node 24 o superior y npm.

```bash
cd backend
npm install
npm run dev          # desarrollo, con recarga automática, en http://localhost:4000
```

Hace falta un `backend/.env` con la conexión a Postgres y las dos variables de Supabase Auth (ver [Variables de entorno](#variables-de-entorno) y [Conectar Supabase](#conectar-supabase)): **sin Supabase el panel no funciona**, así que ya no hay modo SQLite sin internet. Lo demás tiene valores por defecto seguros.

Producción (un solo proceso Node):

```bash
npm ci
npm run build        # compila a dist/
npm start            # node dist/index.js
```

El frontend, en desarrollo, llama a la API a través del proxy de Vite (`5173 -> 4000`): el navegador manda `Origin: http://localhost:5173`, que es el `FRONTEND_ORIGIN` por defecto. Abrí el frontend siempre como `http://localhost:5173` (no como `127.0.0.1`: es otro origen y la API lo rechaza con 403).

## Variables de entorno

Copiá `.env.example` a `.env` (está ignorado por git; nunca subas uno con secretos). Las variables del entorno del sistema pisan a las del archivo. Una variable vacía cuenta como no definida. Si algo es inválido o falta en producción, el servidor **no arranca** y explica qué corregir.

| Variable | Por defecto | Descripción |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` o `production`. En producción las cookies son `Secure` y se exige `FRONTEND_ORIGIN`. |
| `PORT` | `4000` | Puerto de la API. |
| `HOST` | `127.0.0.1` | Interfaz donde escucha. Usá `0.0.0.0` en Docker o en un PaaS. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Origen(es) permitidos por CORS y por el chequeo de Origin (CSRF). Esquema + host + puerto, sin barra final. **Admite una lista separada por comas**, por ejemplo para probar desde el celular: `http://localhost:5173,http://192.168.0.10:5173`. Sin comodines. Obligatoria en producción. |
| `SUPABASE_URL` | (obligatoria) | URL del proyecto, sin barra final: `https://TU-PROYECTO.supabase.co`. De ahí se derivan `/auth/v1` (endpoints de Auth y `iss` exacto de los tokens) y el JWKS (`/auth/v1/.well-known/jwks.json`). |
| `SUPABASE_PUBLISHABLE_KEY` | (obligatoria) | Clave **publishable** (`sb_publishable_...`), del panel: *Project Settings > API Keys*. La usa solo el backend (cabecera `apikey`). **Una secret key (`sb_secret_...`) en esta variable se rechaza.** |
| `SUPABASE_SECRET_KEY` | (opcional) | Clave **secret** (`sb_secret_...`), de *Project Settings > API Keys > Secret keys*. **Secreto: salta RLS en todo el proyecto.** La usa solo el backend, solo para la API admin de Auth: que el superadmin y el admin (este, solo con empleados) creen, eliminen o den de baja usuarios y les cambien email o contraseña desde el panel. Va únicamente en la cabecera `apikey`, nunca se loguea ni llega al navegador. Sin ella el panel funciona, pero esas acciones responden `503` (y se avisa al arrancar). Las claves viejas `service_role` no se aceptan. |
| `SUPABASE_SECRET_KEY` | (opcional) | Clave **secret** (`sb_secret_...`), de *Project Settings > API Keys > Secret keys*. **Secreto: salta RLS en todo el proyecto.** La usa solo el backend, para la API admin de Auth (que el superadmin cree y elimine usuarios y les cambie email o contraseña desde el panel) y para firmar las URLs cortas de las **fotos** en los buckets privados `lavados-fotos` y `perfiles-avatares` de Storage. Sin ella, las fotos quedan apagadas sin errores (el listado dice `disponible: false`, `avatarUrl` sale `null`, subir/borrar responde `503`; cambiar la contraseña propia también responde `503`). Va únicamente en la cabecera `apikey`, nunca se loguea ni llega al navegador. Sin ella el panel funciona, pero esas acciones responden `503` (y se avisa al arrancar). Las claves viejas `service_role` no se aceptan. |
| `DATABASE_URL` | (obligatoria) | Cadena de conexión de Supabase (Session pooler) con el rol `buddys_app`: `postgresql://usuario:contraseña@host:5432/postgres`. **Secreto.** Se valida al arrancar y nunca se muestra en logs ni errores. Ver [Conectar Supabase](#conectar-supabase). |
| `DATABASE_SSL_CA_FILE` | (obligatoria con Postgres remoto) | Certificado raíz de Supabase para verificar al servidor (TLS verify-full). Ruta relativa a `backend/` o absoluta. Solo un Postgres local (`localhost`/`127.x`) se tolera sin ella fuera de producción, con un aviso. |
| `DB_DRIVER`, `DB_PATH`, `JWT_SECRET` | | **Ya no se usan.** `DB_DRIVER=postgres` se sigue aceptando (cualquier otro valor se rechaza); `DB_PATH` y `JWT_SECRET` solo generan un aviso al arrancar: borralos del `.env`. |
| `TRUST_PROXY` | `false` | Cuántos proxies hay delante (`1`) o una lista de IP/CIDR de confianza, para que el rate limit vea la IP real. `true` se rechaza a propósito (permite falsear la IP). |
| `PUBLIC_URL` | (vacía) | Origen público del sitio (ej. `https://buddys.com.ar`). Opcional: si está, el aviso de WhatsApp incluye el link al panel, `robots.txt` suma la línea `Sitemap:` (ver [Gastos, metas y datos del taller](#gastos-metas-mensuales-y-datos-del-taller-objetivo-10-m1)). |
| `WHATSAPP_PROVIDER` | `none` | `none`, `callmebot`, `cloud` o `telegram`. Ver [Avisos por WhatsApp](#avisos-por-whatsapp). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | | Solo con `telegram`. Vacías = avisos desactivados (advertencia en desarrollo; en producción no arranca). |
| `WHATSAPP_OWNER_PHONE` | | Número del dueño, con código de país y solo dígitos (`5493804781737`). |
| `CALLMEBOT_APIKEY` | | Solo con `callmebot`. Con la apikey vacía los avisos quedan desactivados (advertencia en desarrollo; en producción no arranca). |
| `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_TEMPLATE`, `WHATSAPP_CLOUD_LANGUAGE` | idioma `es_AR` | Solo con `cloud` (el idioma puede ser `es_AR` o `es`). |
| `TURNOS_ONLINE` | `false` | `true`: monta las rutas públicas de la landing (`/api/servicios`, `/api/disponibilidad`, `/api/bookings`, `/api/turnos/:id`). Por defecto apagadas: Buddys es un sistema interno y solo existe la API del panel. |
| `CRON_SECRET` | (vacía) | **Secreto** del cron de recordatorios: `Authorization: Bearer <CRON_SECRET>` en `POST /api/internal/recordatorios`. Mínimo 32 caracteres imprimibles sin espacios. Sin ella el endpoint responde `404`. Ver [Recordatorios](#recordatorios). |
| `RESEND_API_KEY`, `RECORDATORIO_EMAIL_DESDE` | (vacías) | Recordatorio por **email con Resend**. Van juntas: la API key (`re_...`, **secreto**) y el remitente del dominio verificado (`turnos@dominio` o `Nombre <turnos@dominio>`). |
| `WHATSAPP_CLOUD_TEMPLATE_RECORDATORIO` | (vacía) | Recordatorio por **WhatsApp Cloud**: nombre de la plantilla aprobada (tres variables). Usa `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID` y `WHATSAPP_CLOUD_LANGUAGE` aunque `WHATSAPP_PROVIDER` no sea `cloud`. |

| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | (vacías) | **Avisos push** al celular. Las **tres juntas o ninguna** (con una o dos el servidor no arranca, también en desarrollo). Las genera `npm run vapid`. La privada es un **secreto** (nunca se loguea ni sale del servidor); `VAPID_SUBJECT` es `mailto:tu@email` o una URL `https://`. Sin ellas los avisos quedan apagados sin errores. Ver [Avisos push](#avisos-push). |

Un canal de recordatorios a medio configurar (falta una de sus variables) es un aviso en desarrollo y un error en producción, como los proveedores de avisos. También se avisa si hay `CRON_SECRET` sin ningún canal, o un canal sin `CRON_SECRET`.

## Supabase Auth: usuarios y roles

### Arquitectura (BFF)

```
navegador --/api (cookies httpOnly)--> backend --POST /auth/v1/token, /auth/v1/logout (apikey publishable)--> Supabase Auth
                                          |--verifica el access token con el JWKS del proyecto (ES256, caché 10 min)
                                          +--lee el perfil (rol, activo) y la sesión (auth.sessions) en cada request
```

- El frontend sigue llamando **solo a `/api`**: nada de `supabase-js` ni claves de Supabase en el navegador (no cambia la CSP ni el bundle).
- **Login**: el backend llama a `POST <SUPABASE_URL>/auth/v1/token?grant_type=password`, verifica el `access_token` con `jose` contra el JWKS (algoritmo **ES256** fijado, `iss` = `<SUPABASE_URL>/auth/v1`, `aud` = `authenticated`, `exp`, `sub` y `session_id` UUID, `role = authenticated`, no anónimo) y busca el **perfil** del usuario en `buddys.perfiles`. Sin perfil o inactivo: `403` genérico (y se cierra en Supabase la sesión recién abierta).
- **Cookies**: `bd_at` (access token, `Path=/api`) y `bd_rt` (refresh token, `Path=/api/auth`), las dos `HttpOnly; SameSite=Strict`, `Secure` en producción, `Max-Age` 8 h desde el último login o refresco.
- **Tope absoluto**: una sesión dura como máximo **12 h desde el login** aunque se siga refrescando (`SESION_MAX_SEGUNDOS` en `src/domain/perfil.ts`; lo aplica `buddys_private.sesion_vigente` contra `auth.sessions.created_at`, y la sesión se cierra también en Supabase). En el plan Free el refresh token de Supabase no vence: sin este tope, una sesión abierta (o un refresh token robado) se renovaría para siempre.
- **En cada request a `/api/admin/*`**: se verifica el access token, se carga el perfil (rol y `activo`) y se comprueba que la sesión siga existiendo en `auth.sessions` (función `buddys_private.sesion_vigente`). Así **desactivar a alguien, cambiarle el rol, cerrar su sesión o borrarlo en Supabase tiene efecto en el request siguiente**, aunque su access token todavía no haya vencido.
- **Refresco**: el access token dura lo que diga Supabase (1 h por defecto). Cuando vence, `/api/admin/*` responde `401 SESSION_EXPIRED` (el refresh token no viaja ahí a propósito: su cookie es solo de `/api/auth`) y el frontend llama a `POST /api/auth/refresh`, que canjea el refresh token (`grant_type=refresh_token`, con rotación), reescribe las dos cookies y devuelve el usuario; después reintenta el pedido. `GET /api/auth/me` refresca solo. Si el refresh token fue revocado o reutilizado (Supabase detecta el reuso y cierra la sesión entera): `401` y se borran las cookies.
- **Logout**: `POST /auth/v1/logout?scope=local` con el access token (si venció, se refresca antes) y se borran las cookies.
- **Algoritmo**: el proyecto firma con una clave asimétrica **ES256** (JWT Signing Keys; el JWKS público tiene una clave EC P-256). Si algún día se rota a una clave RSA, hay que cambiar `SUPABASE_JWT_ALGORITHM` en `src/lib/access-token.ts`.
- La **secret key** (`SUPABASE_SECRET_KEY`, opcional) se usa solo en `src/lib/supabase-admin.ts`, para la API admin de Auth (`/auth/v1/admin/users`) que llaman las acciones de superadmin: crear y eliminar usuarios y cambiarles email o contraseña. El login, el refresco y el logout siguen usando la publishable.
- Logs: solo el id del usuario (`Inicio de sesión usuario=<uuid> rol=admin`); nunca tokens ni emails.

### Roles y permisos (la regla vive en el backend; la UI solo esconde botones)

| Rol | Ver turnos y agenda | Cambiar estado | Reprogramar | Borrar turnos | Gestionar usuarios | Ver catálogo | Editar catálogo | Ver disponibilidad | Editar disponibilidad |
|---|---|---|---|---|---|---|---|---|---|
| `superadmin` | sí | a cualquier estado | sí | sí | sí (crear, listar, cambiar rol, activar/desactivar, nombre, email y contraseña, eliminar) | sí | sí | sí | sí |
| `admin` | sí | a cualquier estado | sí | sí | **solo empleados** (crearlos, editarlos, desactivarlos y darlos de baja) | sí | sí | sí | sí |
| `empleado` | sí | **solo a `completado`** | **no** | no | no | sí | **no** (solo lectura) | sí | **no** (solo lectura) |

"Editar disponibilidad" = cambiar el horario semanal y crear, cambiar o quitar días especiales (`puedeEditarDisponibilidad` en `src/domain/permisos.ts`). Reprogramar un turno a una franja llena o a un día cerrado **sí** se permite (el panel manda; la UI avisa).

"Reprogramar" = cambiar la fecha/franja confirmadas de un turno, también al confirmarlo "para otra fecha" o al volver a la que pidió el cliente (`puedeReprogramar` en `src/domain/permisos.ts`).

"Editar catálogo" = crear servicios, editarlos (textos, precio, duración, destacado, activo) y reordenarlos (`puedeEditarCatalogo` en `src/domain/permisos.ts`).

**Notas internas, búsqueda e historial del cliente**: todos los roles, también `empleado` (es quien está con el auto). La nota se puede escribir y editar aunque el turno esté `cancelado` o `completado`.

#### Matriz de permisos completa (fuente única: `CAPACIDADES`)

La lista `CAPACIDADES` de `src/domain/permisos.ts` es la única fuente: de ahí salen las funciones `puede*` con las que la API decide y la tabla que ve el usuario (`GET /api/admin/permisos`). Un test (`test/permisos.test.ts`) verifica que coinciden para los tres roles. Valores: **sí**, **no** o **parcial** (con su matiz).

| Grupo | Capacidad | superadmin | admin | empleado |
|---|---|---|---|---|
| Lavados | Registrar un lavado de mostrador (servicios, vehículo, cobro y forma de pago) | sí | sí | parcial: queda registrado a su nombre; carga el monto al registrarlo, pero después no lo ve ni lo corrige (tampoco ve los precios de lista) |
| Lavados | Deshacer (borrar) un lavado de mostrador | sí | sí | parcial: solo uno que registró él, hasta 5 minutos después de registrarlo y si no tiene comprobante |
| Lavados | Mover un lavado de etapa y avisarle al cliente que está listo | sí | sí | parcial: solo sus lavados (los lavó o registró él) |
| Lavados | Subir y ver las fotos antes/después | sí | sí | sí |
| Lavados | Borrar una foto | sí | sí | parcial: una que subió él, hasta 5 minutos |
| Turnos | Ver los turnos y la agenda | sí | sí | sí |
| Turnos | Crear turnos desde el panel para trabajos largos y cargarles la seña | sí | sí | no |
| Turnos | Cambiar el estado de un turno | sí | sí | parcial: solo a Completado |
| Turnos | Cambiar la fecha y la franja de un turno | sí | sí | no |
| Turnos | Borrar turnos | sí | sí | no |
| Turnos | Escribir notas internas | sí | sí | sí |
| Turnos | Buscar turnos y ver el historial de un cliente | sí | sí | sí (sin importes) |
| Turnos | Ver los clientes inactivos con su link de WhatsApp | sí | sí | no |
| Turnos | Configurar la tarjeta de sellos y los días de inactividad | sí | no | no |
| Cobro | Registrar cuánto se cobró por un trabajo y quién lo hizo | sí | sí | parcial: al completar queda como quien lo hizo, sin cargar el monto |
| Cobro | Corregir el monto, la forma de pago y los servicios de un turno | sí | sí | no |
| Cobro | Corregir el monto, el descuento, el trabajador, la forma de pago y los servicios de un turno | sí | sí | no |
| Cobro | Ver la caja del día y cerrarla con el arqueo | sí | sí | no |
| Cobro | Corregir o reabrir un cierre de caja ya hecho | sí | no | no |
| Catálogo | Ver los servicios | sí | sí | sí |
| Catálogo | Crear, editar y ordenar servicios | sí | sí | no |
| Disponibilidad | Ver horario, días especiales y cupos | sí | sí | sí |
| Disponibilidad | Cambiar horario semanal y días especiales | sí | sí | no |
| Estadísticas | Ver las estadísticas del taller, con importes | sí | sí | no |
| Estadísticas | Ver los trabajos que uno mismo registró, sin importes | sí | sí | sí |
| Finanzas | Ver y cargar los gastos del taller | sí | sí | no |
| Finanzas | Cargar los gastos fijos de cada mes (sueldos, alquiler, servicios) | sí | parcial: solo los ve | no |
| Finanzas | Fijar y seguir las metas mensuales | sí | sí | no |
| Finanzas | Exportar a Excel (CSV) la planilla, los gastos y las estadísticas | sí | sí | no |
| Documentos | Armar presupuestos y descargarlos en PDF | sí | sí | no |
| Documentos | Emitir comprobantes de pago en PDF | sí | sí | no |
| Documentos | Editar los datos del taller que salen en los PDF | sí | sí | no |
| Inventario | Ver el inventario | sí | sí | sí |
| Inventario | Registrar el uso de insumos | sí | sí | sí |
| Inventario | Crear insumos, cargar compras y ajustar el stock | sí | sí | no |
| Inventario | Definir qué insumos usa cada servicio (recetas; verlas entra en "Ver el inventario") | sí | sí | no |
| Inventario | Ver el consumo de insumos, la lista para comprar y los avisos de stock bajo | sí | sí | no |
| Usuarios | Crear, editar, desactivar y eliminar usuarios del panel | sí | parcial: solo empleados (crearlos, editarlos, desactivarlos y darlos de baja) | no |
| Perfil | Cambiar su propio nombre, foto y contraseña | sí | sí | sí |
| Avisos | Activar los avisos en su propio dispositivo (turnos nuevos y, para admin y superadmin, stock bajo) | sí | sí | sí |
| Usuarios | Crear, editar y desactivar usuarios | sí | no | no |
| Usuarios | Ver y editar su propio perfil: nombre, foto de perfil y contraseña | sí | sí | sí |
| Avisos | Activar los avisos de turnos nuevos en su dispositivo | sí | sí | sí |
| Avisos | Recibir los avisos del encargado (lavado sin monto, meta cumplida) | sí | sí | no |

Funciones: `puedeRegistrarLavados`, `puedeAnotarLavadoDeOtro`, `puedeDeshacerCualquierLavado` y `puedeDeshacerLavado(rol, actorId, lavado, now)` (`'si' | 'no' | 'vencido'`; plazo `PLAZO_DESHACER_LAVADO_MINUTOS` = 5), `puedeCambiarEstado(rol, estado)`, `puedeReprogramar`, `puedeBorrarTurnos`, `puedeGestionarUsuarios` (entrar a `/api/admin/usuarios`: nivel distinto de `no`), `puedeGestionarA(rolActor, rolObjetivo)` (superadmin, a cualquiera; admin, solo a empleados), `puedeAsignarRol(rolActor, rolNuevo)` (superadmin, cualquier rol; admin, solo `empleado`), `puedeEditarCatalogo`, `puedeEditarDisponibilidad`, `puedeVerEstadisticas` (también decide quién ve importes: `puedeVerImportes`), `puedeRegistrarCobro` (monto y elegir trabajador) y `puedeCorregirCobro`. Objetivo 10: `puedeGestionarGastos`, `puedeGestionarMetas`, `puedeArmarPresupuestos`, `puedeEmitirComprobantes`, `puedeEditarTaller`, `puedeVerInventario`, `puedeRegistrarUsoInsumos`, `puedeGestionarInventario` y `puedeVerCostosInventario` (el empleado nunca recibe costos ni valores en pesos del inventario). Contrato 04: `puedeEditarPerfil` (Mi perfil, todos los roles; ver la foto de otro usuario usa `puedeGestionarUsuarios`). Contrato 06: `puedeDefinirRecetas` (`inventario.recetas`) y `puedeVerConsumoInventario` (`inventario.consumo`: consumo, para comprar, alertas y quién recibe el push de stock bajo). Los textos de `buddys.roles.descripcion` los mantienen al día las migraciones (`estadisticas_cobro_trabajador`, `finanzas_gastos_metas_taller` y `roles_admin_gestiona_empleados`) para que digan lo mismo.

Funciones del contrato 2026-11-15: `puedeCambiarEtapa`, `puedeCrearTurnos`, `puedeVerInactivos`, `puedeConfigurarFidelizacion`, `puedeVerGastosFijos`, `puedeEditarGastosFijos`, `puedeCerrarCaja`, `puedeReabrirCaja`, `puedeSubirFotos`, `puedeBorrarFoto` (plazo `PLAZO_BORRAR_FOTO_MINUTOS` = 5), `puedeExportar` y `recibeAvisosDeEquipo`. Contrato 2026-11-16_04 (perfil): `puedeEditarPerfilPropio` (capacidad `perfil.propio`).

**El empleado nunca recibe importes**: `monto`, `descuento`, `descuentoMotivo`, `sena.monto` y `saldo` son siempre `null` para él; `monto` es siempre `null` en cualquier respuesta con turnos (listado, agenda, PATCH; función `vistaDeTurno`), no puede pedir las estadísticas completas (`403`) y "mis trabajos" no lleva ningún importe (la consulta ni siquiera lee la columna). El seguimiento público tampoco devuelve `monto` ni `trabajador`.

Lo que no está permitido responde `403 FORBIDDEN` con un mensaje en español. Reglas de usuarios (`UsuarioService`, en este orden; contrato `reportes/2026-11-17_03_gestion-usuarios.md`):

1. Sobre uno mismo: nadie se cambia su propio rol, ni se desactiva ni se elimina (`409 CONFLICT`).
2. Un admin no edita ni elimina a un admin o superadmin (tampoco a sí mismo: lo suyo se edita desde *Mi perfil*): `403` *"Con tu rol solo podés gestionar empleados."*
3. Un admin no crea ni pasa a nadie a un rol que no sea `empleado`: `403` *"Con tu rol solo podés crear y editar empleados."*
4. **Nunca puede quedar el sistema sin un superadmin activo** (lo garantiza un trigger en la base, también ante dos cambios simultáneos; la baja pone `activo = false`, así que también la cubre): `409 CONFLICT`.
5. Un usuario dado de baja no se edita ni se vuelve a dar de baja: `409` *"Ese usuario está dado de baja."* (reactivarlo no existe: se le crea una cuenta nueva con su email).

### Alta de usuarios (pasos del dueño)

1. **Cerrar el registro público.** En https://supabase.com/dashboard/project/TU-PROYECTO: *Authentication > Sign In / Providers > Email* y **desactivá "Allow new users to sign up"** (guardar). Aunque quedara abierto, un usuario registrado por su cuenta nace `empleado` e **inactivo** y no entra hasta que un superadmin lo active.
2. **Crear el usuario.** *Authentication > Users > Add user > Create new user*: email y contraseña (larga y única), con **"Auto Confirm User"** marcado. Un trigger crea su perfil en `buddys.perfiles` como `empleado` inactivo.
3. **Promover al primer superadmin** (solo la primera vez). En el **SQL Editor** (o en el *Table Editor*, esquema `buddys`, tabla `perfiles`):

   ```sql
   update buddys.perfiles set rol_id = 'superadmin', activo = true where email = 'tu-email@ejemplo.com';
   ```

   El email va en minúsculas. Tiene que decir `UPDATE 1`.
4. **Configurá `SUPABASE_SECRET_KEY`** en el `.env` del backend (y en el entorno del servidor en producción) y reiniciá.
5. **Los demás usuarios se crean desde el panel web** (*Equipo > Nuevo usuario*: email, contraseña, nombre, rol y si entra desde ya). El superadmin crea cualquier rol; un admin, solo empleados. El backend los crea en Supabase Auth con el email ya confirmado (no se manda ningún email) y el trigger crea su perfil. Pasale la contraseña a la persona por un canal privado. Desde el mismo panel se les cambia el rol, el nombre, el email o la contraseña y se los desactiva (efecto inmediato).
   **Eliminar** a alguien: si no tiene historial (ningún lavado, turno, gasto, movimiento de stock, presupuesto ni comprobante a su nombre) se borra de Supabase Auth y su perfil y sus sesiones se van en cascada. Si tiene historial **se da de baja**: queda inactivo y marcado como dado de baja (`eliminado_at`), se lo banea en Supabase Auth y su email pasa a `baja+<id>@buddys.invalid` (el email real queda libre para una cuenta nueva). Su perfil sigue existiendo, así que **sus lavados viejos siguen mostrando su nombre** (si no tenía nombre, queda con la parte de su email antes de la @, nunca el email entero). La baja también le cierra las sesiones abiertas. No se puede deshacer desde el panel. Ojo: desde *Authentication > Users* de Supabase, borrar a alguien con historial **falla** (las FK son `ON DELETE RESTRICT`): hay que darlo de baja desde el panel.
6. **Contraseña olvidada:** no hay recuperación por email (no hay SMTP configurado). El superadmin le asigna una nueva desde *Usuarios > Cambiar contraseña*. Si el que la olvidó es el único superadmin, se cambia en Supabase (*Authentication > Users > (usuario)*).

## Base de datos

**Postgres en Supabase es el único motor** (proyecto `TU-PROYECTO`, esquema propio `buddys`, no expuesto por la Data API). SQLite se retiró: con Supabase Auth el panel no funciona sin Supabase, y tener un solo motor evita dos implementaciones de cada repositorio. Las migraciones están en `supabase/migrations/*.sql` (formato Supabase CLI) y **no** las aplica el backend: se aplican con la CLI o el MCP de Supabase. Al arrancar, el backend **verifica** que estén (tablas, columnas del catálogo editable, roles y la función de sesión) y si no, no arranca y dice qué falta. Si no hay ningún servicio activo, arranca igual pero lo avisa en el log (la web no podría recibir turnos).

### Conexión a Postgres

- Driver **`pg` (node-postgres)** con un `Pool` chico: `max` 5 conexiones, se cierran ociosas a los 30 s, timeout de conexión de 5 s, tope de 10 s por consulta, renovación cada 30 min. Un error en una conexión ociosa se loguea y el pool la reemplaza (no tumba el proceso).
- **Modo recomendado: Session pooler (Supavisor, puerto 5432)**, del botón *Connect* del panel. Es lo que Supabase recomienda para un servidor de larga vida en una red **IPv4** (la mayoría de los VPS, PaaS y conexiones domésticas). Si el servidor tiene **IPv6**, la conexión **directa** (`db.<ref>.supabase.co:5432`) también sirve y es un poco más rápida. **No uses el Transaction pooler (6543)**: es para funciones serverless que abren y cierran conexiones todo el tiempo.
- **TLS siempre.** Con `DATABASE_SSL_CA_FILE` (el certificado raíz de Supabase, *Supabase Root 2021 CA*) se verifica el certificado y el nombre del servidor (como `sslmode=verify-full`). Sin él, la conexión iría cifrada pero sin verificar quién responde (un intermediario en la red podría hacerse pasar por Supabase y quedarse con la sesión de la base): por eso se exige siempre que el host no sea local, incluso fuera de producción. Solo con un Postgres en la misma máquina (`localhost`/`127.x`/`::1`) se tolera sin el CA, con un aviso. Los parámetros `sslmode`/`sslrootcert` de la URL se ignoran: la URL se desarma en host, puerto, usuario, contraseña y base, y el TLS lo decide el backend.
- La contraseña nunca se loguea: en los logs aparece `host:puerto/base (usuario ...)`.
- Todas las consultas son SQL **parametrizado** (`$1, $2...`) y nombran el esquema (`buddys.bookings`), sin depender del `search_path`. La regla de ESLint prohíbe interpolar o concatenar SQL en `.query()` y prohíbe importar `node:sqlite`.

### Modelo de datos (Postgres)

```mermaid
erDiagram
    servicios ||--o{ bookings : "servicio_id (FK, RESTRICT)"
    perfiles ||--o{ bookings : "trabajador_id (FK, ON DELETE RESTRICT)"
    perfiles ||--o{ bookings : "registrado_por (FK, ON DELETE RESTRICT)"
    auth_users ||--|| perfiles : "id (FK, ON DELETE CASCADE)"
    roles ||--o{ perfiles : "rol_id (FK, RESTRICT)"
    perfiles ||--o{ push_suscripciones : "perfil_id (FK, ON DELETE CASCADE)"
    auth_users ||--o{ auth_sessions : "user_id (Supabase Auth)"

    servicios {
        text id PK "slug inmutable: lavado-basico, pulido..."
        text nombre
        text resumen
        text descripcion
        jsonb incluye "array de textos"
        jsonb glosario "array de termino + significado"
        text duracion_estimada "duración de auto; null = sin confirmar"
        text duracion_suv "null = usa la de auto"
        text duracion_pickup "null = usa la de auto"
        text duracion_estimada_moto "null = usa la de auto"
        integer precio_desde "ARS, precio de auto; null = Consultá"
        integer precio_desde_suv "ARS; null = Consultá"
        integer precio_desde_pickup "ARS; null = Consultá"
        integer precio_desde_moto "ARS; null = Consultá"
        text_array vehiculos "auto, suv, pickup, moto: 1 a 4, sin repetidos"
        text categoria "nullable, 1 a 40: Lavado, Pulido, Motos..."
        boolean destacado "puede haber varios"
        boolean activo
        smallint orden
        timestamptz created_at
        timestamptz updated_at
    }
    bookings {
        bigint seq PK "identity, orden interno"
        uuid id UK "gen_random_uuid(), id público"
        text nombre
        text telefono
        text email "nullable"
        text vehiculo_tipo "CHECK auto, suv, pickup, moto"
        text vehiculo_modelo "nullable"
        text servicio_id FK "el principal (= orden 0 de lavado_servicios)"
        date fecha_preferida
        text franja "CHECK manana, tarde"
        date fecha_confirmada "nullable; va con franja_confirmada"
        text franja_confirmada "nullable; CHECK manana, tarde"
        text comentario "nullable"
        text estado "CHECK pendiente, confirmado, completado, cancelado"
        timestamptz recordatorio_enviado_at "nullable; recordatorio del día anterior"
        integer monto "nullable; pesos cobrados, 0 a 99999999; solo si completado"
        uuid trabajador_id FK "nullable; perfiles(id) ON DELETE RESTRICT; solo si completado"
        text origen "CHECK web, mostrador"
        text forma_pago "nullable; CHECK efectivo, transferencia, debito, credito, otro"
        uuid registrado_por FK "nullable; perfiles(id) ON DELETE RESTRICT; quién registró el lavado"
        uuid id_local UK "nullable; único si no es null; id de la cola sin conexión del panel"
        timestamptz created_at
        timestamptz updated_at
    }
    lavado_servicios {
        uuid booking_id PK "FK bookings(id) ON DELETE CASCADE"
        text servicio_id PK "FK servicios(id)"
        smallint orden "0 a 9; 0 = el principal; UNIQUE con booking_id"
        integer precio_lista "nullable; foto del precio de lista al registrar"
    }
    horario_semanal {
        smallint dia PK "0 = domingo ... 6 = sábado"
        boolean abierto
        smallint cupo_manana "0 a 20"
        smallint cupo_tarde "0 a 20"
        timestamptz updated_at
    }
    dias_especiales {
        date fecha PK
        boolean abierto
        smallint cupo_manana "0 a 20; null si cerrado"
        smallint cupo_tarde "0 a 20; null si cerrado"
        text motivo "nullable, hasta 80"
        timestamptz created_at
        timestamptz updated_at
    }
    roles {
        text id PK "superadmin, admin, empleado"
        text nombre
        text descripcion
        timestamptz created_at
    }
    perfiles {
        uuid id PK "= auth.users.id"
        text email "copia en minúsculas (la mantiene el trigger)"
        text nombre "nullable"
        text rol_id FK "default empleado"
        boolean activo "default false"
        timestamptz eliminado_at "nullable; dado de baja (CHECK: entonces no activo)"
        timestamptz created_at
        timestamptz updated_at
    }
    push_suscripciones {
        uuid id PK "gen_random_uuid()"
        uuid perfil_id FK "dueño del dispositivo"
        text endpoint UK "https, servicio de push conocido, hasta 2048"
        text p256dh "clave del navegador (base64url)"
        text auth "secreto de la suscripción (base64url)"
        text agente "nullable, hasta 120"
        timestamptz created_at
        timestamptz ultimo_aviso_at "nullable"
    }
    auth_users {
        uuid id PK "esquema auth (Supabase)"
        text email
    }
    auth_sessions {
        uuid id PK "claim session_id del JWT"
        uuid user_id
        timestamptz not_after
    }
```

| Tabla | Para qué | Restricciones e índices |
|---|---|---|
| `bookings` (columnas del 2026-11-15) | `etapa`/`etapa_at` (lavados de mostrador: espera, lavando, listo, entregado), `descuento`/`descuento_motivo`, `sena_monto`/`sena_forma_pago`/`sena_fecha`; `origen` suma `panel` | CHECK etapa solo en mostrador (los viejos quedan `entregado`; trigger `bookings_etapa_por_defecto`), descuento 0 a 99.999.999 con motivo si > 0 y solo en completados, seña completa o nada y nunca en mostrador. Índices parciales `bookings_mostrador_en_curso_idx` y `bookings_sena_fecha_idx`. Descuento y seña no mueven `updated_at`. |
| `gastos_fijos` | Sueldos, alquiler, servicios: concepto, monto mensual, categoría, `perfil_id` (el empleado del sueldo), vigencia `desde_mes`/`hasta_mes` | Monto 1 a 99.999.999, meses = día 1, `hasta_mes >= desde_mes`. Función `gastos_fijos_imputados(desde, hasta)`: cada ítem cuenta su monto el día 1 de cada mes de vigencia. |
| `cierres_caja` | Un cierre por día (`fecha` PK): contado por forma de pago, foto de lo esperado, diferencia, nota, `cerrado_por` | Importes 0 a 999.999.999 (diferencia con signo), nota hasta 300. |
| `lavado_fotos` | Fotos antes/después: `booking_id` (CASCADE), tipo, `path` del objeto en el bucket, tipo de contenido, tamaño, `estado` (pendiente/lista), `subida_vence_at`, `creado_por` | jpeg/webp, hasta 1.572.864 bytes, path único con formato fijo, máximo 6 por turno con las pendientes (bloqueo en el backend + trigger `lavado_fotos_maximo`); trigger `lavado_fotos_a_borrar` (AFTER DELETE). |
| `fotos_a_borrar` | Objetos del bucket de fotos ya borradas, para volver a borrarlos cuando vence su token de subida (`borrar_desde`) | La conciliación los borra de Storage y los saca. |
| `perfiles` (columnas del 2026-11-16) | `avatar_path` (foto de perfil vigente), `avatar_pendiente_path` (subida pedida sin confirmar) y `avatar_subida_vence_at` (hasta cuándo vale el token de la última subida) | CHECK de formato `<perfil_id>/<uuid>.(jpg\|webp)` con la carpeta igual al propio perfil; una pendiente exige su vencimiento. Índice parcial `perfiles_avatar_pendiente_idx`. Trigger `perfiles_avatar_a_borrar` (SECURITY DEFINER en `buddys_private`: también corre en la cascada desde Supabase Auth). `buddys_app`: UPDATE de esas tres columnas. |
| `avatares_a_borrar` | Fotos de perfil reemplazadas, borradas, descartadas o de usuarios eliminados, para borrarlas del bucket `perfiles-avatares` desde `borrar_desde` | Análoga a `fotos_a_borrar` pero de OTRO bucket (por eso es otra tabla). Solo inserta el trigger; `buddys_app`: SELECT y DELETE. |
| `fidelizacion` | Una fila: `sellos_cada`, `premio` (gratis/descuento), `premio_porcentaje`, `inactivos_dias` | 2 a 50 sellos, 1 a 99 %, 7 a 365 días. |
| `servicio_insumos` | Receta de cada servicio: insumo y cantidad (por auto; `cantidad_suv`/`_pickup`/`_moto` null = usa la de auto) | PK (servicio, insumo); `movimientos_stock.automatico`; función `sincronizar_insumos_turno`. |
| `metas_mensuales.cumplida_avisada_at` | Cuándo se avisó por push que la meta del mes se cumplió (una vez por mes; se limpia al cambiar la meta) | |
| `servicios` | **Catálogo del taller, fuente de verdad** (editable desde el panel; ver [Catálogo editable](#catálogo-editable)). Sembrado con los 5 servicios y los textos que tenía `frontend/src/data/servicios.ts` (propuesta inicial, sin confirmar). Un servicio que se deja de ofrecer se **desactiva** (`activo = false`), no se borra: lo referencian turnos. | PK `id` (slug validado por CHECK, inmutable: `buddys_app` no tiene `UPDATE` sobre él). CHECK de largos de `nombre`/`resumen`/`descripcion`/`duracion_estimada` (no vacía), `precio_desde`, `precio_desde_suv`, `precio_desde_pickup` y `precio_desde_moto` enteros de 0 a 99.999.999, `vehiculos` (`text[]`, función `buddys.servicio_vehiculos_valido`), `incluye` y `glosario` validados ítem por ítem (funciones `buddys.servicio_incluye_valido` / `servicio_glosario_valido`). `duracion_suv`, `duracion_pickup` y `duracion_estimada_moto` (1 a 60 caracteres cuando no son null); `categoria` (1 a 40). Desde `catalogo_buddys`, los 14 servicios de Buddys (los heredados de MgDetailing quedan inactivos; `restauracion-opticas` se reutilizó). Puede haber varios destacados (el índice `servicios_un_destacado` se eliminó); el CHECK `servicios_destacado_activo` impide destacar un inactivo. Trigger `updated_at`. |
| `bookings` | Solicitudes de turno. | PK `seq` (bigint identity: inserciones ordenadas, índice compacto y orden estable aunque dos turnos tengan el mismo `created_at`); `id` UUID **único**, el único que sale por la API (un id secuencial revelaría cuántos turnos hay). FK `servicio_id -> servicios` (`RESTRICT`). CHECK de `vehiculo_tipo`, `franja`, `franja_confirmada`, `estado` y de los largos de zod; CHECK `bookings_confirmada_juntas`: `fecha_confirmada` y `franja_confirmada` las dos null o las dos con valor. Índices: `(estado, seq DESC)` para el listado filtrado y su `COUNT`; la PK sirve al listado sin filtro; `(servicio_id)` para la FK; `bookings_agenda_idx`, de expresión y parcial, `(coalesce(fecha_confirmada, fecha_preferida), coalesce(franja_confirmada, franja), seq) WHERE estado <> 'cancelado'`, para la agenda; `bookings_telefono_whatsapp_idx`, parcial, `(telefono_whatsapp, seq) WHERE telefono_whatsapp IS NOT NULL`, para `turnosDelCliente` y el historial. CHECK `bookings_notas_internas_largo` (≤ 1000) y `bookings_telefono_whatsapp_formato` (`^[0-9]{8,15}$`). |
| `lavado_servicios` | Los servicios de cada turno o lavado (1 a 10), en el orden elegido (migración `lavado_varios_servicios`). `orden 0` = el principal, el mismo que `bookings.servicio_id`. `precio_lista` = foto del precio de lista del servicio para el vehículo del turno al registrarlo (`null` = "Consultá" o turno anterior a la tabla). Las estadísticas por servicio cuentan desde acá. | PK `(booking_id, servicio_id)`; UNIQUE `(booking_id, orden)`; CHECK `orden` 0 a 9 y `precio_lista` 0 a 99.999.999; FK `booking_id` ON DELETE CASCADE y `servicio_id` RESTRICT; índice `lavado_servicios_servicio_idx`. Trigger `bookings_servicio_principal` (AFTER INSERT en `bookings`): todo turno nuevo nace con su fila principal y la foto de su precio (`buddys.precio_de_lista(servicio, vehiculo)`, STABLE). `buddys_app`: SELECT, INSERT y DELETE (la lista se reemplaza entera, nunca UPDATE). |
| `horario_semanal` | La regla de siempre: una fila por día de la semana (`dia` con la convención de Postgres y JavaScript: **0 = domingo**, 1 = lunes ... 6 = sábado), si se atiende y cuántos turnos entran a la mañana y a la tarde. Sembrada: lunes a sábado abierto con 2 por franja, domingo cerrado. Las 7 filas son fijas. | PK `dia` (CHECK 0 a 6); CHECK de cupos 0 a 20; trigger `updated_at`. |
| `dias_especiales` | La excepción, gana sobre el horario semanal: una fecha cerrada (feriado, vacaciones) o abierta con sus cupos. Sembrada con los feriados inamovibles de lo que queda de 2026 y de 2027 más el 23/11/2026 (Soberanía, trasladable, "a confirmar"), todos cerrados y con motivo que empieza con `Feriado: `. | PK `fecha`; CHECK `dias_especiales_cupos` (abierto con los dos cupos, cerrado con los dos en null), cupos 0 a 20, `motivo` 1 a 80; trigger `updated_at`. |
| `roles` | Los 3 roles del panel (sembrados por migración). Los permisos de cada rol los aplica el backend (`domain/permisos.ts`). | PK `id` (slug). |
| `perfiles` | Un perfil por usuario de Supabase Auth: rol y si puede entrar. Lo crea el trigger de `auth.users`; se borra en cascada con el usuario. | PK/FK `id -> auth.users ON DELETE CASCADE`; FK `rol_id -> roles` con índice; CHECK de email en minúsculas y largo de nombre; trigger `updated_at`; trigger `perfiles_al_menos_un_superadmin`. |
| `push_suscripciones` | Dispositivos de las personas del panel que activaron los avisos push (ver [Avisos push](#avisos-push)). `endpoint`, `p256dh` y `auth` son secretos de capacidad: quien los tiene puede mandarle avisos a ese aparato. | PK `id`; FK `perfil_id -> perfiles ON DELETE CASCADE`; `endpoint` único (CHECK: `https`, de 12 a 2048); CHECK de formato base64url en `p256dh` y `auth` y de largo en `agente` (≤ 120); índice `(perfil_id, created_at)` para la FK y el tope de 10 por persona. RLS con policies solo para `buddys_app`; GRANT `SELECT`, `DELETE`, `INSERT` por columna y `UPDATE (ultimo_aviso_at)`. |
| `gastos` | Gastos del taller (objetivo 10, migración `finanzas_gastos_metas_taller`). Ganancia neta = ingresos de los turnos completados - gastos, por fecha. | PK `id` uuid; `fecha` date; `categoria` CHECK (9 valores); `descripcion` 1 a 120; `monto` entero 1 a 99.999.999; `proveedor` <= 80 o null; `origen` CHECK `manual`/`inventario` (el de inventario no se edita desde Gastos); `creado_por` FK `perfiles ON DELETE RESTRICT` (migración `usuarios_baja`); índices `gastos_fecha_idx` y parcial de la FK; trigger `updated_at`. RLS; `buddys_app`: SELECT, DELETE, INSERT y UPDATE por columna (nunca `id` ni `origen`). |
| `metas_mensuales` | Meta de cada mes: ingresos y/o trabajos completados. | PK `mes` date (CHECK: siempre el día 1); `ingresos_objetivo` 1 a 999.999.999; `trabajos_objetivo` 1 a 9.999; CHECK: al menos uno no nulo. RLS; SELECT, INSERT, DELETE y UPDATE de los objetivos. |
| `taller` | Datos del taller que salen en los PDF. **Una sola fila** (`id = 1`, CHECK), sembrada con nombre, teléfono y dirección. | CHECK de `telefono` (8 a 15 dígitos), `cuit` (11 dígitos o `NN-NNNNNNNN-N`), `instagram` (sin `@`, <= 30) y largos. RLS; la app solo tiene SELECT y UPDATE por columna (no inserta ni borra). |

Funciones y triggers (migración `perfiles_roles_supabase_auth`):

- `buddys_private.sincronizar_perfil()`: trigger `AFTER INSERT OR UPDATE OF email ON auth.users`. Crea el perfil (`empleado`, **inactivo**) o copia el email nuevo; nunca toca rol ni activo. `SECURITY DEFINER` (el rol de Auth no tiene permisos fuera de `auth`, patrón recomendado por Supabase), `search_path` vacío, en el esquema **no expuesto** `buddys_private`, sin `EXECUTE` para `public`, `anon`, `authenticated`, `service_role` ni `buddys_app`. No lee `raw_user_meta_data` (lo edita el propio usuario).
- `buddys_private.sesion_vigente(session_id, user_id, max_age_seconds)`: `SECURITY DEFINER`, `STABLE`, devuelve solo un booleano: si la sesión sigue en `auth.sessions`, no pasó su `not_after` y se abrió hace menos de `max_age_seconds` (tope absoluto, 12 h). Solo `buddys_app` tiene `EXECUTE`. Es lo que hace que un logout invalide el access token al instante.
- `buddys_private.impedir_sin_superadmin()` (SECURITY DEFINER desde la migración `superadmin_trigger_definer`: cuando el borrado viene de Supabase Auth, el trigger corre como `supabase_auth_admin`, que no tiene acceso a `buddys`; como INVOKER, borrar cualquier superadmin activo fallaba con `42501`): triggers `AFTER UPDATE OF rol_id, activo` y `AFTER DELETE` que solo se disparan cuando una fila **deja** de ser superadmin activo (también al borrar el usuario de Auth, desde el panel o desde Supabase: si es el último superadmin activo el borrado falla y hay que dar el rol a otro antes); toma un advisory lock y, si no queda ninguno, falla con SQLSTATE `MG001` (la API responde `409`).

Decisiones:

- **`text` + `CHECK` en vez de enums** para `vehiculo_tipo`, `franja` y `estado`: la integridad queda en la base igual que con un enum, se leen como string sin conversiones y cambiar los valores es un `ALTER` de la constraint (quitar un valor de un enum de Postgres obliga a recrear el tipo).
- **`updated_at` con trigger** (`buddys.set_updated_at`): el backend manda su propio `updated_at` (su reloj, el mismo que usan las respuestas y los tests); si una actualización no lo cambia (por ejemplo, una edición a mano desde el panel de Supabase), el trigger pone `now()`. Es `SECURITY INVOKER` y con `search_path` vacío.
- **`telefono_whatsapp` se guarda** (migración `notas_telefono_cliente`): el backend lo calcula con `domain/telefono.ts` (libphonenumber) al crear el turno, y es lo que identifica al **mismo cliente** (historial y `turnosDelCliente`). Los turnos anteriores a la migración se completan con `npm run normalizar-telefonos` (la regla vive en JavaScript, no en SQL). Mientras un turno viejo tenga la columna en null, la API calcula `telefonoWhatsapp` al leer (como antes), pero ese turno no cuenta en el historial hasta normalizarlo.
- **`notas_internas`**: texto libre del taller (hasta 1000 caracteres, CHECK). Nunca sale por la API pública ni en los avisos.
- **Búsqueda sin extensiones**: `buddys.texto_busqueda(text)` (minúsculas y sin acentos con `translate`, `IMMUTABLE`, `search_path` vacío) se aplica a la columna y al texto buscado, con `LIKE ... ESCAPE '\'`. La tabla es chica: no hace falta `pg_trgm` ni `unaccent`.
- **El pedido del cliente nunca se pisa**: `fecha_preferida`/`franja` son lo que pidió; lo que confirma el taller va en `fecha_confirmada`/`franja_confirmada` (null = la pedida). "Fecha de agenda" = `coalesce(fecha_confirmada, fecha_preferida)`, lo mismo para la franja. El rango de una fecha confirmada (hoy a hoy + 120 días) lo valida la API: un CHECK no puede depender de "hoy", y un turno viejo conserva la suya.
- `fecha_preferida` y `fecha_confirmada` son `date`; los repositorios las devuelven como `YYYY-MM-DD` (`to_char`) y los `timestamptz` como ISO 8601 UTC, igual que el contrato.
- **`perfiles.email` es una copia**: `buddys_app` no puede leer `auth.users` (ni debe); el trigger la mantiene al día.

### Seguridad en la base (Supabase)

- Todo vive en los esquemas **`buddys`** y **`buddys_private`**, que **no** están entre los expuestos por la Data API (PostgREST/GraphQL publican `public` y `graphql_public`; un pedido con `Accept-Profile: buddys` responde `PGRST106`). La web **nunca** habla con Supabase: ni `supabase-js`, ni claves en el frontend. El único cliente de la base y de Supabase Auth es este backend.
- **Rol dedicado `buddys_app`** (migración `rol_app_minimo_privilegio`): el backend se conecta con él, **no** con `postgres`. Puede solo lo que el backend hace: `SELECT` en `roles`; `SELECT` en `servicios`, `INSERT` por columna (todas salvo `created_at`) y `UPDATE` por columna (los campos editables, `orden` y `updated_at`; nunca `id` ni `created_at`), sin `DELETE`, y `EXECUTE` de las dos funciones de validación del catálogo; `SELECT/INSERT/DELETE` en `bookings` y `UPDATE` solo de `estado`, `updated_at`, `fecha_confirmada`, `franja_confirmada`, `notas_internas` y `telefono_whatsapp` (nunca los datos del cliente ni el pedido original), y `EXECUTE` de `buddys.texto_busqueda`; `SELECT` en `perfiles` y `UPDATE` solo de `rol_id`, `activo`, `nombre`, `eliminado_at` (desde `usuarios_baja`) y `updated_at` (sin `INSERT` ni `DELETE`: los hace el trigger / la cascada); `EXECUTE` solo de `buddys_private.sesion_vigente`, `buddys_private.cerrar_sesiones` (desde `cerrar_sesiones_usuario`: borra las sesiones de un usuario sin darle acceso a `auth`) y `buddys_private.cerrar_otras_sesiones` (desde `cerrar_otras_sesiones_bucket`: las de un usuario menos la actual). Sin DDL, sin `TRUNCATE`, sin `BYPASSRLS`, sin acceso a `auth`, `storage` ni `public`. Topes de sesión: `statement_timeout` 10 s, `lock_timeout` 5 s, `idle_in_transaction_session_timeout` 30 s. Se crea **NOLOGIN y sin contraseña** (no hay secretos en el repo): el dueño le pone la contraseña (ver [Conectar Supabase](#conectar-supabase)). Si el backend arranca conectado con un rol privilegiado (`postgres`), lo avisa en el log.
- Desde la migración `disponibilidad_seguimiento`, además: `SELECT` en `horario_semanal` y `dias_especiales`, `UPDATE (abierto, cupo_manana, cupo_tarde)` del horario (sin `INSERT` ni `DELETE`: las 7 filas son fijas), `INSERT`/`UPDATE (abierto, cupos, motivo)`/`DELETE` de días especiales y `UPDATE (recordatorio_enviado_at)` en `bookings`.
- Desde la migración `push_suscripciones`, además: `SELECT`/`DELETE` en `push_suscripciones`, `INSERT (perfil_id, endpoint, p256dh, auth, agente)` y `UPDATE (ultimo_aviso_at)`. Reasignar un dispositivo a otra persona es borrar y crear la fila (no hay `UPDATE` de `perfil_id`).
- **RLS habilitado en las 6 tablas** (`horario_semanal` y `dias_especiales` incluidas), con policies **solo para `buddys_app`** (`USING (true)`: el backend es un único cliente de confianza que ve todas las filas; la autorización por usuario y por rol la hace la API con la sesión del panel). `anon`, `authenticated` y `service_role` no tienen ni privilegios ni policies: aunque alguien expusiera el esquema por error, no verían una fila. `postgres` (dueño de las tablas, con `BYPASSRLS`) queda para migraciones y backups.
- **`REVOKE` de todo** (tablas, secuencias, funciones y el `USAGE` del esquema) a `public`, `anon`, `authenticated` y `service_role`, y privilegios por defecto revocados para lo que se cree después en el esquema. Un test lo comprueba en PGlite (incluso haciendo `SET ROLE anon`).
- Advisors de Supabase (security y performance) después de aplicar: security sin avisos; performance solo con el INFO esperado *unused index* (la base está vacía; se usan en cuanto haya turnos). La migración `endurecer_rls_auto_enable` revocó el `EXECUTE` de `public.rls_auto_enable()` (una función de Supabase que ya venía en el proyecto, del event trigger que activa RLS en tablas nuevas de `public`) a `anon`/`authenticated`, que el linter marcaba como WARN.
- Al borrar un turno en Postgres, la fila deja de verse al instante pero sus bytes quedan en disco hasta que `autovacuum` reutiliza el espacio, y los backups la conservan durante su retención. Para la Ley 25.326 alcanza con que el dato no sea accesible y que la retención de backups esté acotada y documentada.
- **Región `us-east-1` (EE.UU.)**: los datos de los clientes se guardan fuera de Argentina. Es una transferencia internacional (Ley 25.326, art. 12): EE.UU. no figura entre los países con protección adecuada para la AAIP (y ninguna región de Supabase está en Argentina), así que hay que apoyarse en el consentimiento del cliente (mencionarlo en el aviso de privacidad del formulario) y en el acuerdo de tratamiento de datos (DPA) de Supabase. Ver el informe de seguridad.

### Migraciones (Postgres)

- Archivos `supabase/migrations/YYYYMMDDHHMMSS_descripcion.sql`: la fuente de verdad del esquema Postgres. Nunca se edita una migración aplicada; los cambios van en un archivo nuevo.
- Aplicadas en el proyecto remoto: `20261018211151_esquema_inicial`, `20261018211156_catalogo_servicios`, `20261018211232_endurecer_rls_auto_enable`, `20261018213342_rol_app_minimo_privilegio`. Los nombres de los archivos coinciden con las versiones registradas en Supabase, así `supabase migration list` / `supabase db push` los ven como aplicados.
- **Aplicadas el 2026-10-19 desde el SQL Editor** (Supabase Auth): `20261018234300_perfiles_roles_supabase_auth` (roles, perfiles, triggers, `buddys_private`) y `20261018234301_eliminar_admins_sessions` (borró `admins` y `sessions`, que estaban vacías). Como se aplicaron a mano, no figuran en el historial de migraciones de Supabase: si algún día se usa `supabase db push`, marcarlas antes como aplicadas con `supabase migration repair --status applied 20261018234300 20261018234301`. Las migraciones nuevas: SQL Editor (en orden) o `supabase db push`, y después correr los advisors.
- `20261022185000_superadmin_trigger_definer` (2026-10-22): pasa el trigger "nunca sin superadmin activo" a `SECURITY DEFINER` en `buddys_private`. Sin ella, eliminar un superadmin activo (desde el panel o desde Supabase) falla con `permission denied for schema buddys`. Si se aplica desde el SQL Editor, no queda en el historial: marcala con `supabase migration repair --status applied 20261022185000` antes de un `db push`.
- Para aplicar una nueva: con la CLI (`supabase link --project-ref TU-PROYECTO` y después `supabase db push`) o con el MCP de Supabase (`apply_migration`; después renombrá el archivo local a la versión que quedó registrada). Corré los advisors después de cada cambio.
- Los tests aplican **las mismas migraciones** a un Postgres en memoria (PGlite). Como PGlite no tiene lo de Supabase, el test crea antes de migrar los roles `anon`, `authenticated` y `service_role` (sin login) y un esquema `auth` mínimo (`auth.users` y `auth.sessions` con las columnas que se usan): así las migraciones se prueban tal cual, sin saltear sentencias.
- **`20261022200000_catalogo_editable` (2026-10-22): PENDIENTE de aplicar en Supabase, con aprobación del dueño.** Agrega `resumen`, `descripcion`, `incluye`, `glosario` y `destacado` a `servicios`, copia los textos del frontend, pasa `precio_desde` a `integer`, crea el índice de destacado único y da a `buddys_app` `INSERT`/`UPDATE` por columna con sus policies. Hasta aplicarla, **el backend nuevo no arranca** ("Faltan columnas en buddys.servicios"): aplicala antes de desplegar este backend y corré los advisors después.
- **`20261023120000_agenda_fecha_confirmada` (2026-10-23): PENDIENTE de aplicar en Supabase** (contrato `reportes/2026-10-22_08_agenda.md`). Agrega `fecha_confirmada` y `franja_confirmada` (nullable) a `bookings` con sus CHECK (franja válida; las dos juntas), el índice parcial `bookings_agenda_idx` y `GRANT UPDATE (fecha_confirmada, franja_confirmada)` a `buddys_app`. Columnas nullable sin default: no reescribe la tabla. Hasta aplicarla, **el backend nuevo no arranca** ("Faltan columnas en buddys.bookings"); aplicala (después de `catalogo_editable`) antes de desplegar y corré los advisors.
- **`20261023180000_notas_telefono_cliente` (2026-10-23): PENDIENTE de aplicar en Supabase** (contrato `reportes/2026-10-23_10_notas-busqueda-historial.md`). Agrega `notas_internas` y `telefono_whatsapp` (nullable, con CHECK) a `bookings`, el índice parcial `bookings_telefono_whatsapp_idx`, la función `buddys.texto_busqueda` (con `EXECUTE` solo para `buddys_app`) y `GRANT UPDATE (notas_internas, telefono_whatsapp)` a `buddys_app`. Columnas nullable sin default: no reescribe la tabla. Hasta aplicarla, **el backend nuevo no arranca** ("Faltan objetos de la migración de notas"). Orden: aplicar la migración (después de `agenda_fecha_confirmada`), desplegar el backend, correr **`npm run normalizar-telefonos`** una vez (completa `telefono_whatsapp` en los turnos existentes; se puede repetir sin riesgo) y los advisors.
- **`20261023200000_disponibilidad_seguimiento` (2026-10-23): PENDIENTE de aplicar en Supabase** (contrato `reportes/2026-10-23_11_disponibilidad-seguimiento-recordatorios.md`). Crea `horario_semanal` (7 filas) y `dias_especiales` (15 feriados) con RLS y policies solo para `buddys_app`, agrega `bookings.recordatorio_enviado_at` (nullable, sin reescribir la tabla), hace que el trigger de `updated_at` de `bookings` no corra cuando cambia la marca del recordatorio (marcarlo no es un cambio del turno: el cliente ve "actualizado el") y da a `buddys_app` `SELECT` en las dos tablas, `UPDATE (abierto, cupo_manana, cupo_tarde)` en el horario, `INSERT`/`UPDATE (abierto, cupos, motivo)`/`DELETE` en los días especiales y `UPDATE (recordatorio_enviado_at)` en `bookings`. Hasta aplicarla, **el backend nuevo no arranca** ("Faltan objetos de la migración de disponibilidad"). Orden: después de `notas_telefono_cliente`, antes de desplegar; después, los advisors. **Al aplicarla, el formulario empieza a rechazar domingos, feriados y franjas con 2 turnos**: revisá antes el horario y los cupos con el dueño.
- **`20261026120000_push_suscripciones` (2026-10-26): PENDIENTE de aplicar en Supabase, con aprobación del dueño** (contrato `reportes/2026-10-26_13_panel-pulido-y-app.md`, bloque A). Crea `push_suscripciones` (tabla nueva y vacía: no reescribe nada) con RLS, policies solo para `buddys_app`, CHECK de formato y los GRANT de arriba. Hasta aplicarla, **el backend nuevo no arranca** ("Faltan objetos de la migración de avisos push"). Orden: después de `disponibilidad_seguimiento`, antes de desplegar; después, los advisors (se espera el INFO *unused index* en `push_suscripciones_perfil_idx` hasta que haya dispositivos).
- **`20261027100000_estadisticas_cobro_trabajador` (2026-10-27): PENDIENTE de aplicar en Supabase** (contrato `reportes/2026-10-26_15_estadisticas-y-permisos.md`). Agrega `bookings.monto` y `bookings.trabajador_id` (nullable, sin default: no reescribe la tabla) con sus CHECK y la FK `ON DELETE SET NULL`, los índices `bookings_trabajador_id_idx` (parcial) y `bookings_fecha_agenda_estado_idx` (fecha de agenda + estado, para las estadísticas, que cuentan también los cancelados), amplía la condición del trigger de `updated_at` (tampoco corre al cambiar `monto` o `trabajador_id`), da `GRANT UPDATE (monto, trabajador_id)` a `buddys_app` y actualiza `roles.descripcion`. Hasta aplicarla, **el backend nuevo no arranca** ("Faltan columnas en buddys.bookings (monto, trabajador_id)"). Orden: después de `push_suscripciones`, antes de desplegar; después, los advisors. No aplicar sin pasar las pruebas.
- **`20261028110000_inventario` y `20261028120000_presupuestos_comprobantes` (2026-10-28): PENDIENTES de aplicar en Supabase** (contrato `reportes/2026-10-27_17_finanzas-inventario-documentos.md`, M2 y M3). Cuatro tablas nuevas y vacías (`insumos`, `movimientos_stock`, `presupuestos`, `comprobantes`) y la función `presupuesto_items_validos`; no reescriben nada. Hasta aplicarlas, **el backend nuevo no arranca** ("Faltan tablas de la migración inventario/presupuestos_comprobantes"). Orden: después de `finanzas_gastos_metas_taller` (la FK `movimientos_stock.gasto_id` apunta a `gastos`), antes de desplegar (el despliegue también tiene que llevar `backend/assets/`); después, los advisors. No aplicar sin pasar las pruebas.
- **`20261101100000_precios_por_vehiculo` (2026-11-01): PENDIENTE de aplicar en Supabase** (contrato `reportes/2026-11-01_19_precios-por-vehiculo.md`). **Estrictamente aditiva y compatible hacia atrás** (el sistema ya está en producción): agrega `servicios.precio_desde_camioneta` y `servicios.precio_desde_moto` (`integer` nullable, sin default, con CHECK de 0 a 99.999.999: no reescribe la tabla ni toca filas) y amplía el `GRANT INSERT`/`UPDATE` por columna de `buddys_app` con las dos columnas. `precio_desde` sigue siendo el precio de auto. El backend viejo sigue andando con las columnas nuevas; el backend nuevo **no arranca** sin ellas ("Faltan columnas en buddys.servicios (precio_desde_camioneta, precio_desde_moto)"). Orden: aplicar la migración **antes** del push (Render despliega solo al subir a `main`); después, los advisors.
- **`20261101110000_servicios_por_vehiculo` (2026-11-01): PENDIENTE de aplicar en Supabase, DESPUÉS de `precios_por_vehiculo`** (contrato `reportes/2026-11-01_19_precios-por-vehiculo.md`, parte 2). **Estrictamente aditiva y compatible hacia atrás**: agrega `servicios.vehiculos text[] not null default array['auto','camioneta','moto']` con CHECK (`servicios_vehiculos_valido`: de 1 a 3, sin repetidos, solo esos tres tipos; función `servicio_vehiculos_valido` con `EXECUTE` solo para `buddys_app`) y `GRANT INSERT`/`UPDATE (vehiculos)` a `buddys_app`. Los servicios existentes quedan en los tres vehículos (nada desaparece de la web) y un INSERT del backend viejo, que no conoce la columna, también. El backend nuevo **no arranca** sin ella ("Faltan columnas en buddys.servicios (vehiculos)"). **Precios iniciales**: no van en una migración sino en `backend/supabase/seeds/2026-11-01_precios-iniciales.sql`, que se corre a mano **una vez** en el SQL Editor después de las dos migraciones (idempotente; solo toca `lavado-basico` —20.000 / 30.000 / 10.000— y `lavado-premium` —40.000 / 50.000 / 15.000— por auto / camioneta / moto; si el dueño ya cambió esos precios desde el panel, volver a correrlo los pisa). Orden: migración 1, migración 2, push (Render despliega solo), seed, advisors.
- **`20261102100000_varios_destacados` y `20261102110000_duracion_por_vehiculo` (2026-11-02): PENDIENTES de aplicar en Supabase** (en ese orden, después de las anteriores). Ambas aditivas y compatibles hacia atrás. La primera elimina el índice único parcial `servicios_un_destacado` (se mantiene el CHECK `servicios_destacado_activo`); el backend viejo sigue andando porque igual desmarca al anterior. La segunda agrega `servicios.duracion_estimada_camioneta` y `servicios.duracion_estimada_moto` (`text` nullable, sin default, CHECK de 1 a 60 caracteres sin contar espacios de los bordes) y `GRANT INSERT`/`UPDATE` por columna a `buddys_app`; `duracion_estimada` pasa a ser la de auto. El backend nuevo **no arranca** sin ellas ("Faltan columnas en buddys.servicios (duracion_estimada_camioneta, duracion_estimada_moto)"). Aplicar antes del push; después, los advisors.
- **`20261113100000_forma_pago_deshacer_lavado` (2026-11-13): aplicada en Supabase.** Aditiva e idempotente: agrega `bookings.forma_pago` (`text` nullable, CHECK `bookings_forma_pago_valida` con los mismos valores que `comprobantes.forma_pago`) `bookings.registrado_por` (`uuid` nullable, FK a `perfiles` `ON DELETE SET NULL`, índice parcial `bookings_registrado_por_idx`) y `bookings.id_local` (`uuid` nullable, índice único parcial `bookings_id_local_key` donde no es null: un reintento de la cola sin conexión del panel no registra dos veces); recrea el trigger de `updated_at` para que tampoco corra al cambiar esas dos columnas; repite el `REVOKE` a los roles de la API y da `GRANT UPDATE (forma_pago)` a `buddys_app` (el INSERT ya es de toda la tabla; `registrado_por` e `id_local` no se actualizan nunca desde la app). Columnas nullable sin default: no reescribe la tabla; los lavados viejos quedan "sin indicar" y sin quién los registró (solo los borra quien puede borrar turnos). Aplicar antes del push; después, los advisors.
- **`20261113110000_vehiculos_suv_pickup` (2026-11-13): PENDIENTE de aplicar en Supabase.** Decisión del dueño: `camioneta` se reemplaza por `suv` y `pickup` (orden canónico auto, suv, pickup, moto). Agrega `servicios.precio_desde_suv` (copia de `precio_desde_camioneta`), `precio_desde_pickup`, `duracion_suv` (copia de `duracion_estimada_camioneta`), `duracion_pickup` y `categoria` (CHECK de rango/largo como las demás); pasa los datos `camioneta` → `suv` en `bookings.vehiculo_tipo` y `servicios.vehiculos` **sin mover `updated_at`** (apaga los triggers de `updated_at` solo mientras corren esos UPDATE, dentro de la transacción); cambia los CHECK (`bookings_vehiculo_tipo_valido` y la función `servicio_vehiculos_valido`: 1 a 4 de los tipos nuevos) y el default de `vehiculos`; y **borra** las dos columnas de camioneta. `presupuestos.vehiculo` y `comprobantes.vehiculo` son texto libre / foto del momento: no se tocan. GRANT por columna de INSERT/UPDATE a `buddys_app` y REVOKE a los roles de la API. **No es compatible con el backend anterior** (lee las columnas de camioneta): aplicarla y desplegar el backend nuevo juntos. Idempotente.
- **`20261113120000_lavado_varios_servicios` (2026-11-13): PENDIENTE de aplicar en Supabase, DESPUÉS de `vehiculos_suv_pickup`.** Tabla `buddys.lavado_servicios` (ver el modelo de datos), función `buddys.precio_de_lista(text, text)` (EXECUTE solo para `buddys_app`), trigger `bookings_servicio_principal` (AFTER INSERT en `bookings`: todo turno nuevo, también uno a mano, nace con su fila principal), backfill (cada turno existente con su `servicio_id`, `orden 0`, `precio_lista null`), RLS + REVOKE + GRANT SELECT/INSERT/DELETE con sus policies para `buddys_app`, y `GRANT UPDATE (servicio_id)` sobre `bookings` (corregir los servicios cambia el principal). El backend nuevo **no arranca** sin ella. Idempotente.
- **`20261113130000_catalogo_buddys` (2026-11-13): PENDIENTE de aplicar en Supabase, DESPUÉS de las dos anteriores.** Solo datos: upsert por `id` de los 14 servicios de Buddys (precios auto / suv / pickup en ARS enteros, motos solo para `moto` con `precio_desde_moto`, categoría, `incluye` en ítems, `descripcion` = el texto completo, destacados Limpieza Nivel I, II y III, `orden` 10 a 140, duraciones en `null`, glosario vacío) y desactiva (y desmarca) todo servicio que no esté en la lista. Idempotente (una segunda corrida deja lo mismo; solo vuelve a mover `updated_at` de los 14). La base de los tests **no** la aplica (`MIGRACIONES_SOLO_DATOS` en `test/pglite.ts`: casi todos los tests usan los servicios heredados); la prueba `test/migracion-catalogo-buddys.test.ts`. Orden en Supabase: las tres seguidas, el push del backend y después los advisors.
- **`20261117100000_usuarios_baja` (2026-11-17): PENDIENTE de aplicar en Supabase** (contrato `reportes/2026-11-17_03_gestion-usuarios.md`). Agrega `perfiles.eliminado_at` (`timestamptz` nullable, sin default: no reescribe la tabla) con el CHECK `perfiles_baja_inactivo` (dado de baja => inactivo) y `GRANT UPDATE (eliminado_at)` a `buddys_app`; pasa las FK hacia `perfiles` de `bookings.trabajador_id`, `bookings.registrado_por`, `gastos.creado_por`, `movimientos_stock.perfil_id`, `presupuestos.creado_por` y `comprobantes.creado_por` de `ON DELETE SET NULL` a **`ON DELETE RESTRICT`** (`NOT VALID` + `VALIDATE`). Efecto: borrar desde el dashboard de Supabase a alguien con historial falla (hay que darlo de baja desde el panel). El backend nuevo **no arranca** sin ella (lee `eliminado_at`). Idempotente.
- **`20261117100500_roles_admin_gestiona_empleados` (2026-11-17): PENDIENTE de aplicar en Supabase, DESPUÉS de `usuarios_baja`.** Solo datos: actualiza `roles.descripcion` de `admin` (*"Gestiona solo a los empleados."*, antes decía *"No gestiona usuarios."*) y de `superadmin`, que salen en `GET /api/admin/permisos`. Idempotente. Orden: las dos, el push del backend y después los advisors.
- **`20261117110000_perfil_foto` (2026-11-17): PENDIENTE de aplicar en Supabase (la aplica el dueño)** (contrato `reportes/2026-11-17_04_perfil-y-foto.md`). `buddys.perfiles.foto_actualizada_at timestamptz null` (versión de la foto; `null` = sin foto), `GRANT UPDATE (foto_actualizada_at)` a `buddys_app` y el bucket privado `avatares` (256 KiB, solo `image/webp`, sin policies: solo entra la secret key), dentro de un bloque que solo corre si existe `storage.buckets`. El backend nuevo **no arranca** sin ella (`verifyPostgresSchema`). Idempotente.
- **`20261117130000_cerrar_sesiones_usuario` (2026-11-17): PENDIENTE de aplicar en Supabase, ANTES del push del backend** (auditoría del objetivo A, B3). Crea `buddys_private.cerrar_sesiones(uuid)`: `SECURITY DEFINER` con `search_path` vacío, borra las filas de `auth.sessions` de ese usuario (los refresh tokens se van en cascada) y devuelve cuántas borró; `REVOKE` a `public`, `anon`, `authenticated` y `service_role`, `EXECUTE` solo para `buddys_app`. La llama el backend al cambiarle contraseña o email a otra persona y en la baja: sin ella, esos pedidos fallan. Idempotente (`create or replace`).
- **`20261117140000_cerrar_otras_sesiones_bucket` (2026-11-18): PENDIENTE de aplicar en Supabase, DESPUÉS de `perfil_foto` y `cerrar_sesiones_usuario` y ANTES del push del backend** (auditoría de seguridad del objetivo B, M1 y B2). (1) Crea `buddys_private.cerrar_otras_sesiones(uuid, uuid)`: `SECURITY DEFINER` con `search_path` vacío, borra las filas de `auth.sessions` del usuario **menos** la sesión indicada y devuelve cuántas borró; `REVOKE` a `public`, `anon`, `authenticated` y `service_role`, `EXECUTE` solo para `buddys_app`. La llama el backend cuando alguien cambia su propia contraseña; sin ella el cambio igual responde `200`, pero las otras sesiones siguen vivas (queda un error en el log). (2) Si existe `storage.buckets`, fuerza el bucket `avatares` a `public = false`, 256 KiB y solo `image/webp` aunque ya existiera (la migración `perfil_foto` no lo tocaba con `ON CONFLICT DO NOTHING`); si no existe, no lo crea. **Antes de aplicarla, revisá que `storage.objects` no tenga policies genéricas para `authenticated` (o `anon`/`public`) sin filtro por `bucket_id`** (`select policyname, roles, cmd, qual from pg_policies where schemaname = 'storage' and tablename = 'objects';`): con una así, el bucket privado se podría leer o listar con la publishable key y una sesión. La migración no crea ni borra policies. Idempotente.
- **`20261117120000_recetas_stock` (2026-11-17): PENDIENTE de aplicar en Supabase, DESPUÉS de `perfil_foto`** (contrato `reportes/2026-11-17_06_recetas-stock-avisos.md`). Tabla nueva y vacía `buddys.recetas` (RLS, una policy por operación y `GRANT` mínimo a `buddys_app`), `insumos.aviso_bajo_at` (`timestamptz` nullable, sin default: no reescribe; `GRANT UPDATE (aviso_bajo_at)`), el tipo `devolucion` en los CHECK `movimientos_stock_tipo_valido` y `movimientos_stock_signo` (`NOT VALID` + `VALIDATE`: las filas actuales ya cumplen) y el índice parcial `movimientos_stock_consumo_idx`. El backend nuevo **no arranca** sin ella (`verifyPostgresSchema` exige la tabla, la columna y el tipo). Suma `movimientos_stock.origen` (`text not null default 'manual'`, CHECK `manual`/`receta`; con default constante no reescribe la tabla; los existentes quedan en `manual`; `GRANT INSERT (origen)`, sin UPDATE). Los insumos que hoy ya están bajos avisan en su próxima salida. Idempotente.
- **Orden de las pendientes del 2026-11-17 y 2026-11-18**: `20261117100000_usuarios_baja`, `20261117100500_roles_admin_gestiona_empleados`, `20261117110000_perfil_foto`, `20261117120000_recetas_stock`, `20261117130000_cerrar_sesiones_usuario`, `20261117140000_cerrar_otras_sesiones_bucket`; después, el push del backend y los advisors.
- **`20261119100000_unir_ramas` (2026-11-19): va DESPUÉS de las del 17/11.** Une la rama de las mejoras 2026-11-15 (caja, gastos fijos, fotos de lavados, sellos) con la tanda 03-06. (1) Quita el modelo viejo de insumos por servicio (`servicio_insumos`, `sincronizar_insumos_turno` y `movimientos_stock.automatico`): quedan las recetas de `recetas_stock`; la API sigue mandando `automatico`, calculado desde `origen = 'receta'`. (2) Pasa a `RESTRICT` las FK a `perfiles` de `gastos_fijos`, `cierres_caja` y `lavado_fotos`: quien tiene ese historial se da de baja, no se borra (el backend las cuenta en `tieneHistorial`). Las migraciones `20261116100000_perfil_avatar` y `20261116110000_storage_bucket_avatares` de la rama de mejoras se descartaron (nunca se aplicaron): la foto de perfil es la de `perfil_foto`.
- **Migraciones del contrato 2026-11-15 (PENDIENTES de aplicar en Supabase, en este orden, con aprobación del dueño; nunca en el proyecto de MgDetail).** Todas idempotentes, con RLS, `REVOKE` a los roles de la API y `GRANT` mínimo a `buddys_app`; ninguna reescribe tablas. El backend nuevo **no arranca** sin las de esquema ("Faltan objetos de las migraciones 20261115*"):
  1. `20261115100000_lavados_etapa_descuento`: `bookings.etapa`, `etapa_at`, `descuento`, `descuento_motivo` (los lavados ya registrados quedan `entregado`), trigger `bookings_etapa_por_defecto`, índice de "en curso" y el trigger de `updated_at` con el descuento.
  2. `20261115110000_turnos_panel_sena`: `origen = 'panel'`, `sena_monto`, `sena_forma_pago`, `sena_fecha` e índice por fecha de seña. Recrea el trigger de `updated_at` de la 1.
  3. `20261115120000_gastos_fijos`: tabla `gastos_fijos` y función `gastos_fijos_imputados`.
  4. `20261115130000_cierres_caja`: tabla `cierres_caja`.
  5. `20261115140000_lavado_fotos`: tablas `lavado_fotos` (con `estado` pendiente/lista y `subida_vence_at`) y `fotos_a_borrar`, y sus triggers (solo el esquema `buddys`).
  6. **`20261115150000_storage_bucket_fotos` (la de Storage, separada)**: crea el bucket **privado** `lavados-fotos` (1,5 MB, image/jpeg y image/webp) y una policy **restrictiva** en `storage.objects` que deja a `anon` y `authenticated` sin acceso a ese bucket. Fuera de Supabase (PGlite) no hace nada. Revisar después en *Storage > Buckets* y *Storage > Policies*.
  7. `20261115160000_fidelizacion`: tabla `fidelizacion` (una fila: cada 10 lavados, el siguiente gratis; inactivos a los 30 días).
  8. `20261115170000_insumos_por_servicio`: tabla `servicio_insumos`, `movimientos_stock.automatico` y función `sincronizar_insumos_turno`.
  9. `20261115180000_avisos_meta`: `metas_mensuales.cumplida_avisada_at`.
  Después: el push del backend y los advisors.
- **Migraciones del contrato 2026-11-16_04 (foto de perfil): PENDIENTES de aplicar en Supabase, en este orden, después de las 20261115*.** Idempotentes. El backend nuevo **no arranca** sin la primera ("Faltan objetos de la migración de la foto de perfil") y lee `perfiles.avatar_path` en cada request: aplicarla antes de reiniciar el backend.
  1. `20261116100000_perfil_avatar`: columnas `avatar_path`, `avatar_pendiente_path` y `avatar_subida_vence_at` en `perfiles` (null, sin reescribir), tabla `avatares_a_borrar` y el trigger `perfiles_avatar_a_borrar`.
  2. **`20261116110000_storage_bucket_avatares` (la de Storage, separada)**: bucket **privado** `perfiles-avatares` (512 KB, image/jpeg y image/webp) y la policy **restrictiva** `perfiles_avatares_sin_acceso_api` para `anon` y `authenticated`. Fuera de Supabase no hace nada.
- Los servicios ya **no** se agregan por migración ni en el código: se crean desde el panel.

### Backups (Supabase)

- **Plan Free: Supabase no hace backups que puedas descargar o restaurar.** Hacé uno vos con `pg_dump` (o `supabase db dump`), por ejemplo una vez por semana, y guardalo cifrado y fuera de la PC (tiene datos personales). Los usuarios y contraseñas viven en `auth` (Supabase Auth), no en este dump: `perfiles` referencia `auth.users`, así que restaurarlo en otro proyecto exige crear antes los mismos usuarios:

  ```bash
  # Necesita pg_dump 17 (cliente de Postgres) y la cadena del Session pooler (o la directa).
  pg_dump "postgresql://postgres.TU-PROYECTO:<CONTRASEÑA>@<host-del-pooler>:5432/postgres" \
    --schema=buddys --data-only --format=custom --file=buddys-2026-10-18.dump
  ```

  Para restaurar: aplicá las migraciones en la base vacía (así quedan RLS, `REVOKE` y el catálogo) y después `pg_restore --dbname "<cadena>" --data-only --disable-triggers buddys-2026-10-18.dump` (vaciá antes `buddys.servicios` y `buddys.roles`, que la migración ya sembró). Corré los advisors al terminar.
- **Plan Pro**: backups diarios automáticos (7 días) en *Database > Backups*, y PITR como add-on. Igual conviene un `pg_dump` propio de vez en cuando.
- Un proyecto Free **se pausa tras una semana sin actividad**. Con el sitio en uso no pasa, pero si el panel muestra el proyecto pausado, se reactiva desde ahí (mientras tanto `/api/health` da `503`).

### Cobro y estadísticas

Contrato: `reportes/2026-10-26_15_estadisticas-y-permisos.md`. Cada turno **completado** guarda `monto` (pesos enteros, 0 a 99.999.999, nullable) y `trabajador_id` (quién hizo el trabajo; `ON DELETE SET NULL`: si se borra a la persona, el turno queda "Sin asignar"). El CHECK `bookings_cobro_solo_completado` impide que tengan valor si el turno no está completado; el backend los borra al sacar un turno de `completado`. Los turnos viejos quedan "sin cobro cargado" hasta que un admin los complete. Cargar o corregir solo el cobro **no cambia `updated_at`** (el trigger tampoco corre: es el "actualizado el" del cliente). Las estadísticas cuentan solo lo registrado, nunca el precio "desde" del catálogo.

### Agenda

Contrato acordado con el frontend: `reportes/2026-10-22_08_agenda.md`.

- **Fecha de agenda** de un turno = `fechaConfirmada` si existe, si no `fechaPreferida`; lo mismo con la franja. El pedido original del cliente nunca se pisa.
- **Qué aparece**: `pendiente`, `confirmado` y `completado`; los `cancelado`, no. Orden: fecha de agenda, franja (`manana` antes que `tarde`) y orden de llegada (`seq`).
- **Rango de consulta**: `desde`..`hasta` inclusive, hasta 42 días (seis semanas).
- **Reprogramar** (`PATCH /api/admin/bookings/:id` con `fechaConfirmada` + `franjaConfirmada`): solo `admin`/`superadmin`; el turno no puede estar ni quedar `cancelado`/`completado`; la fecha va de hoy a hoy + 120 días, en hora de La Rioja (`fechaConfirmadaRange` en `domain/booking-dates.ts`). `null` en las dos = volver a la pedida. La condición "no cerrado" va en el mismo `UPDATE` (sin carreras con un cancelado simultáneo).
- **Cupos**: la agenda trae `cupos` de cada día del rango (ver [Disponibilidad](#disponibilidad)). Reprogramar **no** se bloquea por cupo ni por día cerrado (el panel manda); si cambia la fecha o la franja de agenda, se limpia la marca del recordatorio en el mismo `UPDATE`.
- Log: `Turno reprogramado id=... por=<uuid> fecha=<YYYY-MM-DD franja | la pedida> [estado=...]`; nunca datos del cliente.

### Disponibilidad

Contrato acordado con el frontend: `reportes/2026-10-23_11_disponibilidad-seguimiento-recordatorios.md`. Regla en `src/domain/disponibilidad.ts` (`calcularCupos`, `verificarLugar`).

- **Cupo de un día** = el día especial si hay, si no el horario semanal de ese día de la semana. Un día cerrado tiene los dos cupos en 0; un cupo en 0 cierra esa franja.
- **Ocupan cupo** los turnos no cancelados (`pendiente`, `confirmado`, `completado`) por **fecha y franja de agenda** (la confirmada si existe, si no la pedida). Se cuentan con un `GROUP BY` sobre el índice `bookings_agenda_idx`.
- **Alta pública sin carreras** (`BookingRepository.reservar`): en una transacción, `pg_advisory_xact_lock(7340003, <días desde 2000-01-01 de la fecha pedida>)`, después el cálculo de cupos de ese día y recién ahí el `INSERT`. Dos altas del mismo día se hacen de a una y la segunda ve a la primera (READ COMMITTED). Día cerrado => `400` en `fechaPreferida`; franja llena o con cupo 0 => `409 FRANJA_LLENA` en `franja`; en los dos casos no se guarda nada. El honeypot responde lo mismo (consulta sin bloquear y sin guardar).
- **El panel manda**: reprogramar o confirmar a una franja llena o a un día cerrado no se bloquea.
- **Feriados**: los trasladables y los puentes los decide el gobierno cada año; el dueño los revisa en el panel (los sembrados tienen motivo `Feriado: ...`).
- Logs: `Horario semanal actualizado por=<uuid>`, `Día especial guardado fecha=... abierto|cerrado por=...`, `Día especial quitado fecha=... por=...`; nunca el motivo.

### Seguimiento del turno

- `GET /api/turnos/:id` (público): el `id` es el UUID aleatorio del alta (no se puede adivinar). Devuelve **solo** `id`, `servicioNombre`, `fecha` y `franja` de agenda, `estado` y `actualizadoEl`. Nunca nombre, teléfono, email, vehículo, comentario ni notas. Inexistente o con formato inválido => el mismo `404`.
- Rate limit propio: **60 consultas por IP cada 15 minutos** (cuentan también los `404`), además del general. Responde con `X-Robots-Tag: noindex, nofollow`; con `SERVE_FRONTEND`, la página `/turno/*` también.
- `POST /api/bookings` devuelve `booking.seguimientoUrl` = `/turno/<id>` (ruta relativa).

### Notas internas, búsqueda e historial del cliente

Contrato acordado con el frontend: `reportes/2026-10-23_10_notas-busqueda-historial.md`.

- **Mismo cliente** = mismo `telefono_whatsapp` guardado. No se agrupa por nombre. Sin teléfono interpretable (o sin normalizar todavía) no hay historial: `turnosDelCliente: null`.
- **`turnosDelCliente`**: una subconsulta `count(*)` por fila dentro de la misma consulta (sobre `bookings_telefono_whatsapp_idx`), en el listado, el `PATCH` y la agenda: sin N+1. Cuenta todos los estados, incluido el propio turno.
- **Búsqueda** (`q`): texto (nombre, email, modelo) sin mayúsculas ni acentos, con los comodines `%`, `_` y `\` escapados (`escapeLike`) y `ESCAPE '\'` explícito; y, si `q` tiene al menos 4 dígitos, esos dígitos dentro de los dígitos del teléfono escrito o del normalizado. Todo va como parámetro. El logger de requests no registra la query string (la búsqueda puede traer nombres o teléfonos).
- **Historial** (`cliente`): `GET /api/admin/bookings?cliente=<telefonoWhatsapp>`, combinable con `estado` y la paginación.
- **Notas**: una por turno; la nota viaja en la misma escritura que el estado o la fecha (si una parte se rechaza, no se guarda nada). Nunca se escribe en el log, nunca sale en `POST /api/bookings` (que además la rechaza por ser un campo desconocido) ni en los avisos (`notifications/message.ts` arma el texto campo por campo).
- **`npm run normalizar-telefonos`** (`src/scripts/normalizar-telefonos.ts`, lógica en `normalizar-telefonos-cli.ts`): con la `DATABASE_URL` del `.env` (el rol `buddys_app` alcanza), completa `telefono_whatsapp` donde es null y el teléfono se puede interpretar, en una transacción y un solo `UPDATE`. Idempotente. Imprime solo cantidades: `N turnos actualizados, M sin teléfono interpretable`. El trigger de `updated_at` marca como actualizados los turnos que completa.

### Catálogo editable

Contrato acordado con el frontend: `reportes/2026-10-22_07_catalogo-editable.md`. La tabla `buddys.servicios` es la única fuente de verdad (la lista fija `SERVICIO_IDS` se retiró):

- **Landing**: `GET /api/servicios` (público) devuelve solo los activos, por `orden` y después por `id`, sin `activo`, `orden` ni `updatedAt`. Si la API falla, el frontend usa `frontend/src/data/servicios.ts` como respaldo.
- **Panel**: `GET /api/admin/servicios` (todos los roles) y, para `admin`/`superadmin`, `POST` (crear, queda al final), `PATCH /:id` (editar, activar/desactivar, destacar) y `PUT /orden` (reordenar). `empleado` recibe `403`.
- **Turnos**: `POST /api/bookings` acepta solo un `servicioId` que exista y esté **activo** en la base (si no, `400` en `fields.servicioId`; también con el honeypot, para no dar señales). El log del alta y el aviso al dueño usan el nombre del servicio de la base.
- **No se borran servicios** (no hay `DELETE`): se desactivan. El `id` (slug `^[a-z0-9]+(-[a-z0-9]+)*$`, hasta 64) no cambia después de crearlo; `orden` está reservado (es un segmento de ruta).
- **Varios destacados a la vez**: marcar uno no toca a los demás (desde la migración `varios_destacados` no hay índice único).
- **Un inactivo no puede ser el destacado**: desactivar el destacado lo desmarca en la misma operación (queda sin destacado hasta que se marque otro); destacar un inactivo, o desactivar y destacar en el mismo cambio, da `400` en `fields.destacado`. El CHECK `servicios_destacado_activo` lo garantiza también en la base.
- **Atomicidad**: crear, editar y reordenar corren en una transacción (`SqlClient.transaction`, una sola conexión del pool) que empieza con `pg_advisory_xact_lock(7340002)`: dos cambios simultáneos del catálogo se hacen de a uno. El reordenamiento guarda `orden = posición × 10` y solo cambia `updated_at` de los que se movieron.
- Logs: `Servicio creado id=... por=<uuid>`, `Servicio actualizado id=... por=... campos=...`, `Catálogo reordenado por=...`; nunca los textos.

## Conectar Supabase

El código ya está listo. El backend se conecta con el **rol dedicado `buddys_app`** (mínimo privilegio, ver [Seguridad en la base](#seguridad-en-la-base-supabase)), **no** con `postgres`. El rol ya existe en el proyecto pero sin contraseña ni permiso de login: el paso 1 lo habilita. La contraseña **no** está en el repo; solo la tiene el dueño.

1. **Habilitá el rol del backend con una contraseña nueva.** Desde `backend/`:

   ```powershell
   npm run clave-db:dev
   ```

   Genera una contraseña aleatoria (segura dentro de una URL) y la sentencia `alter role buddys_app with login password 'SCRAM-SHA-256$...';`. Guardá la contraseña en tu gestor de contraseñas y pegá **la sentencia** en el **SQL Editor** de Supabase. La sentencia lleva el **hash** SCRAM, no la contraseña: así la contraseña no queda en el historial del SQL Editor ni en los logs de Postgres (Supabase registra todo el DDL). **No** escribas `password 'la-contraseña'` en texto plano en el SQL Editor.

   Para revocar el acceso: `alter role buddys_app nologin;` (o corré `clave-db` otra vez para rotarla). La contraseña de `postgres` **no** va en el `.env`: queda solo para migraciones y backups.

2. **Copiá el host del pooler.** Entrá a https://supabase.com/dashboard/project/TU-PROYECTO, botón **Connect** (arriba), pestaña **Connection String**, tipo **URI**, **Session pooler**. De esa cadena solo necesitás el **host** (por ejemplo `aws-0-us-east-1.pooler.supabase.com`; el número y la región los da el panel, copialos de ahí). El usuario cambia: en vez de `postgres.TU-PROYECTO` es `buddys_app.TU-PROYECTO` (rol + punto + id del proyecto, así lo pide el pooler para roles propios).

3. **Descargá el certificado de Supabase.** En **Database > Settings > SSL Configuration > Download certificate** se baja `prod-ca-2021.crt`. Guardalo como `backend/certs/supabase-ca.crt` (creá la carpeta `certs`). Es un certificado público, no un secreto. **Es obligatorio** para conectarse a Supabase, también desde tu PC: sin él el backend no arranca (protege la conexión de un intermediario). Opcional, para comprobarlo (Git Bash): `openssl x509 -in backend/certs/supabase-ca.crt -noout -subject -fingerprint -sha256` tiene que mostrar `CN = Supabase Root 2021 CA` y la huella `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

4. **Pegá la conexión y Supabase Auth en `backend/.env`** (está en `.gitignore`; nunca lo subas). Con tu host, la contraseña que te dio `clave-db` en el paso 1 y la **publishable key** (*Project Settings > API Keys*, empieza con `sb_publishable_`):

   ```
   DATABASE_URL=postgresql://buddys_app.TU-PROYECTO:LA-CONTRASEÑA-GENERADA@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   DATABASE_SSL_CA_FILE=./certs/supabase-ca.crt
   SUPABASE_URL=https://TU-PROYECTO.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   Si el backend no arranca y dice que la URL todavía tiene `[YOUR-PASSWORD]` o que no es válida, revisá este paso (el mensaje nunca muestra la URL). `Tenant or user not found` = el usuario no tiene el `.TU-PROYECTO` o el host no es el del panel. Si al arrancar aparece el aviso *"conectado como postgres, un rol con privilegios de administrador"*, estás usando el usuario equivocado. `JWT_SECRET`, `DB_DRIVER` y `DB_PATH` ya no se usan: borralos.

5. **Creá tu usuario del panel** con Supabase Auth: ver [Alta de usuarios](#alta-de-usuarios-pasos-del-dueño) (cerrar el registro público, *Add user* con *Auto Confirm User* y la sentencia que te promueve a superadmin).

6. **Verificá.** Arrancá el backend (`npm run dev` en `backend/`, o `npm run dev` desde la raíz con el frontend). En la consola tiene que aparecer `Login del panel: Supabase Auth (https://TU-PROYECTO.supabase.co)` y `Base de datos lista: Postgres ..., TLS verificado`. Después:

   ```powershell
   curl.exe http://localhost:4000/api/health
   # -> {"status":"ok"}
   ```

   Iniciá sesión con curl (ver [Endpoints con ejemplos curl](#endpoints-con-ejemplos-curl)), registrá un lavado de prueba con `POST /api/admin/lavados` y fijate que aparezca en `GET /api/admin/lavados` (y en Supabase: **Table Editor**, esquema `buddys`, tabla `bookings`). Si `/api/health` responde `503`, Postgres no responde: revisá la contraseña, la conexión a internet y que el proyecto no esté pausado. Si el login responde `503`, el backend no llega a Supabase Auth (revisá `SUPABASE_URL`); si responde `403`, tu perfil no está activo (paso 3 de *Alta de usuarios*).

## Endpoints con ejemplos curl

Todo es JSON. En PowerShell usá `curl.exe` (en Windows PowerShell `curl` es un alias de otra cosa) y pasá el body desde un archivo: `-d "@turno.json"`. Los ejemplos están en sintaxis bash.

```bash
# Salud
curl http://localhost:4000/api/health
# -> {"status":"ok"}

# Solicitar un turno (público)
curl -X POST http://localhost:4000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Juan Pérez","telefono":"+54 9 380 412-3456","email":"juan@ejemplo.com",
       "vehiculoTipo":"auto","vehiculoModelo":"Toyota Corolla","servicioId":"pulido",
       "fechaPreferida":"2026-10-20","franja":"manana","comentario":"Rayones en el capot"}'
# -> 201 {"booking":{"id":"<uuid>","servicioId":"pulido","fechaPreferida":"2026-10-20","franja":"manana","estado":"pendiente"}}

# Iniciar sesión (guarda las cookies bd_at y bd_rt en cookies.txt)
curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dueno@ejemplo.com","password":"una clave larga y unica"}'
# -> 200 {"usuario":{"id":"<uuid>","email":"dueno@ejemplo.com","nombre":null,"rol":"superadmin","avatarUrl":null,"avatarVenceEl":null}}

# Quién soy (si el access token venció, se refresca solo y reescribe las cookies)
curl -b cookies.txt -c cookies.txt http://localhost:4000/api/auth/me

# Renovar la sesión cuando /api/admin responde 401 SESSION_EXPIRED
curl -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/auth/refresh -H "Content-Type: application/json"

# Mi perfil: ver, cambiar el nombre o la contraseña
curl -b cookies.txt http://localhost:4000/api/admin/perfil
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/perfil \
  -H 'Content-Type: application/json' -d '{"passwordActual":"la-de-ahora","passwordNueva":"una-nueva-larga"}'

# Foto de perfil: el body es la imagen (JPG, PNG o WebP; hasta 2 MB)
curl -b cookies.txt -X PUT http://localhost:4000/api/admin/perfil/foto \
  -H 'Content-Type: image/jpeg' --data-binary @foto.jpg
curl -b cookies.txt -o foto.webp 'http://localhost:4000/api/admin/usuarios/<id>/foto?v=<fotoVersion>'

# Usuarios (superadmin: todos; admin: solo empleados)
curl -b cookies.txt http://localhost:4000/api/admin/usuarios
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/usuarios/<id> \
  -H "Content-Type: application/json" -d '{"rol":"empleado","activo":true,"nombre":"Lucía"}'

# Listar turnos (más nuevos primero), con filtro y paginación
curl -b cookies.txt "http://localhost:4000/api/admin/bookings?estado=pendiente&limit=20&offset=0"

# Buscar por nombre, email, modelo o dígitos del teléfono (2 a 80 caracteres)
curl -b cookies.txt "http://localhost:4000/api/admin/bookings?q=gomez&estado=pendiente"

# Historial de un cliente (su telefonoWhatsapp)
curl -b cookies.txt "http://localhost:4000/api/admin/bookings?cliente=5493804123456"

# Nota interna (todos los roles, también en turnos cerrados; "" o null la borra)
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/bookings/<id> \
  -H "Content-Type: application/json" -d '{"notasInternas":"Rayón en la puerta trasera.\nCobrado."}'

# Cambiar el estado de un turno
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/bookings/<id> \
  -H "Content-Type: application/json" -d '{"estado":"confirmado"}'

# Confirmar para otra fecha (admin y superadmin); null en las dos = volver a la pedida
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/bookings/<id> \
  -H "Content-Type: application/json" -d '{"estado":"confirmado","fechaConfirmada":"2026-10-24","franjaConfirmada":"tarde"}'

# Agenda de una semana (lunes a domingo; hasta 42 días)
curl -b cookies.txt "http://localhost:4000/api/admin/agenda?desde=2026-10-19&hasta=2026-10-25"
# -> 200 {"turnos":[{...mismo objeto Turno que /api/admin/bookings...}]}

# Borrar un turno (aunque no lleve body, exige el Content-Type)
curl -b cookies.txt -X DELETE http://localhost:4000/api/admin/bookings/<id> \
  -H "Content-Type: application/json"

# Catálogo público (lo que muestra la landing: solo los activos)
curl http://localhost:4000/api/servicios

# Catálogo en el panel (todos los roles; incluye inactivos, orden y updatedAt)
curl -b cookies.txt http://localhost:4000/api/admin/servicios

# Crear un servicio (admin y superadmin; queda al final del orden)
curl -b cookies.txt -X POST http://localhost:4000/api/admin/servicios \
  -H "Content-Type: application/json" \
  -d '{"id":"tratamiento-ceramico","nombre":"Tratamiento cerámico","resumen":"Protección de larga duración.",
       "descripcion":"Aplicamos una capa cerámica sobre la pintura.","incluye":["Lavado","Descontaminación"],
       "glosario":[{"termino":"Cerámico","significado":"un recubrimiento duro y brillante."}],
       "duracion":"1 día","precioDesde":150000}'
# -> 201 {"servicio":{"id":"tratamiento-ceramico",...,"destacado":false,"activo":true,"orden":60,"updatedAt":"..."}}

# Editar: precio y destacarlo (no desmarca a los demás), o desactivarlo
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/servicios/pulido \
  -H "Content-Type: application/json" -d '{"precioDesde":85000,"destacado":true}'
curl -b cookies.txt -X PATCH http://localhost:4000/api/admin/servicios/encerado \
  -H "Content-Type: application/json" -d '{"activo":false}'

# Reordenar (todos los ids, sin repetir, en el orden nuevo)
curl -b cookies.txt -X PUT http://localhost:4000/api/admin/servicios/orden \
  -H "Content-Type: application/json" \
  -d '{"ids":["pulido","lavado-premium","lavado-basico","encerado","restauracion-opticas"]}'

# Cerrar sesión
curl -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/auth/logout \
  -H "Content-Type: application/json"
```

## Contrato de la API

Esta sección es la referencia para el frontend. Todo viaja como JSON; las fechas de auditoría son ISO 8601 en UTC.

### Reglas generales

- **`POST`, `PATCH` y `DELETE` (y `PUT`) exigen `Content-Type: application/json` aunque no lleven body** (por ejemplo `logout` y `delete`); si no, responden `415`. Un body vacío se acepta en esos casos. El body se interpreta como UTF-8.
- **Si el pedido trae cabecera `Origin`, tiene que coincidir exactamente con uno de los `FRONTEND_ORIGIN`**; si no, `403 FORBIDDEN_ORIGIN`. Los navegadores la mandan solos. Los clientes sin `Origin` (curl, scripts) se aceptan.
- Las cookies viajan solas porque el panel llama a `/api` en su mismo origen (`credentials: 'same-origin'`; ver [Despliegue](#despliegue)). El JS nunca ve los tokens: son cookies httpOnly.
- **Única excepción al JSON:** `PUT /api/admin/perfil/foto` (solo esa ruta y ese método) manda la imagen tal cual, con `Content-Type: image/jpeg`, `image/png` o `image/webp` (`middleware/request-guard.ts`). El control de `Origin` es el mismo: un formulario de otro sitio no puede mandar esos tipos sin un preflight CORS, y la cookie es `SameSite=Strict`.
- Body máximo: **10 kb** (la foto de perfil: 2 MB, solo en su ruta). **Plazo para recibirlo: 10 s** desde las cabeceras (la foto: 30 s; `middleware/plazo-cuerpo.ts`). Es un plazo total, no de inactividad: si el cuerpo no termina de llegar (un `Content-Length` mayor que lo que se manda, o un goteo de bytes), se corta la conexión sin respuesta. `server.requestTimeout` (30 s) queda de respaldo. Los objetos de entrada son estrictos: **un campo desconocido se rechaza** con `400`.
- Las respuestas de `/api` llevan `Cache-Control: no-store` (salvo la foto de perfil, `GET /api/admin/usuarios/:id/foto`, que se cachea con `?v=` y `ETag`).
- Una ruta `/api/...` que no existe responde `404 NOT_FOUND` en JSON. Todo lo que cuelga de `/api/admin` pide sesión primero (`401`), exista o no la ruta.
- **Sesión del panel**: ante un `401 SESSION_EXPIRED` en `/api/admin/*`, llamá **una vez** a `POST /api/auth/refresh` y, si responde `200`, reintentá el pedido original; si responde `401` o `403 NO_ACCESS`, mandá al login. Un `403 FORBIDDEN` es solo "tu rol no puede hacer esto": la sesión sigue. Ante `401 UNAUTHORIZED` o `403 FORBIDDEN` con `message` de "no tiene acceso al panel", la sesión terminó: al login. Un `403 FORBIDDEN` de permisos (rol insuficiente) **no** cierra la sesión: mostrá el mensaje.

### Enums exactos

| Campo | Valores |
|---|---|
| `vehiculoTipo` | `"auto"`, `"suv"`, `"pickup"`, `"moto"` (orden canónico; nombres visibles Auto, SUV, Pick-up, Moto). `"camioneta"` ya no existe: los datos pasaron a `"suv"` (migración `vehiculos_suv_pickup`). |
| `servicioId` | **Ya no es un enum fijo**: el `id` de un servicio del catálogo (`GET /api/servicios`). Los de Buddys (migración `catalogo_buddys`): `limpieza-nivel-1`, `limpieza-nivel-2`, `limpieza-nivel-3`, `limpieza-motor`, `higienizacion-profunda`, `pulido-basico`, `pulido-abrillantado`, `pulido-opticas`, `restauracion-opticas`, `tratamiento-acrilico`, `tratamiento-ceramico`, `preparacion-venta`, `motos-basico`, `motos-ceramico`. |
| `franja` | `"manana"`, `"tarde"` |
| `estado` | `"pendiente"` (inicial), `"confirmado"`, `"completado"`, `"cancelado"`. Se puede pasar de cualquiera a cualquiera. |

### Formato de error (todos los errores)

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Revisá los datos ingresados.", "fields": { "telefono": "Revisá el teléfono: ..." } } }
```

`message` está en español rioplatense y es apto para mostrar. `fields` solo aparece en errores de validación: la clave es el nombre del campo y el valor, el mensaje. Nunca se devuelven stack traces ni detalles internos.

| `code` | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Datos inválidos (con `fields`), query inválida, o un pedido mal formado sin campo asociado. |
| `INVALID_JSON` | 400 | El body no es JSON válido (o es un JSON que no es objeto ni array). |
| `UNAUTHORIZED` | 401 | No hay sesión, el token es inválido, la sesión se cerró (logout, revocada en Supabase) o el refresh token ya no sirve. |
| `SESSION_EXPIRED` | 401 | El access token venció en un pedido a `/api/admin/*`: llamar a `POST /api/auth/refresh` y reintentar una vez. |
| `INVALID_CREDENTIALS` | 401 | Email o contraseña incorrectos (mensaje genérico: no dice cuál). |
| `FORBIDDEN_ORIGIN` | 403 | `Origin` no permitido. |
| `FORBIDDEN` | 403 | El rol no permite la acción (la sesión sigue). Mensaje en español apto para mostrar. |
| `PLAZO_DESHACER_VENCIDO` | 403 | `DELETE /api/admin/lavados/:id` de quien lo registró, pasados los 5 minutos: lo tiene que borrar un encargado desde la planilla. |
| `NO_ACCESS` | 403 | La sesión es válida pero el usuario ya no tiene acceso al panel (desactivado o sin perfil): se borran las cookies y hay que volver al ingreso. |
| `NOT_FOUND` | 404 | Ruta inexistente, o turno / usuario / servicio inexistente (un id con formato inválido también da 404). |
| `CONFLICT` | 409 | Gestión de usuarios: cambiarte tu propio rol, desactivarte o eliminarte, dejar el sistema sin ningún superadmin activo, o editar a alguien dado de baja. `PATCH /api/admin/bookings/:id` que saca de `completado` a un lavado de mostrador. |
| `SERVICIO_EXISTE` | 409 | `POST /api/admin/servicios` con un `id` que ya existe (activo o no). Trae `fields.id`. |
| `FRANJA_LLENA` | 409 | `POST /api/bookings` a una franja sin lugar (llena o con cupo 0). Trae `fields.franja`: *"Esa franja se llenó. Elegí otra."* |
| `PAYLOAD_TOO_LARGE` | 413 | Body de más de 10 kb. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Falta `Content-Type: application/json` o el body viene comprimido. |
| `RATE_LIMITED` | 429 | Demasiados pedidos (los del backend traen `Retry-After` en segundos). También si Supabase Auth limita los logins. |
| `INTERNAL_ERROR` | 500 | Error inesperado (el detalle queda solo en el log del servidor). |
| `SERVICE_UNAVAILABLE` | 503 | `/api/health` si la base de datos no responde; login / sesión si Supabase Auth no responde. |

### `GET /api/health`

`200 { "status": "ok" }`, o `503 SERVICE_UNAVAILABLE` si la base no responde.

### `POST /api/bookings` (público)

Límite: **5 turnos creados por IP cada 15 minutos** (`429`). Los pedidos rechazados por validación no gastan cupo.

| Campo | Obligatorio | Regla |
|---|---|---|
| `nombre` | sí | Texto, sin espacios en los extremos, 2 a 80 caracteres. |
| `telefono` | sí | 8 a 20 caracteres: solo dígitos, espacios, `+`, `-`, `(`, `)`, con **al menos 8 dígitos**. Se guarda y devuelve tal como lo escribió el cliente (sin espacios en los extremos). |
| `email` | no | Email válido, hasta 120 caracteres. `""`, `null` u omitido => `null`. Se guarda en minúsculas. |
| `vehiculoTipo` | sí | Ver enums. El `servicioId` tiene que ofrecerse para este tipo (`servicio.vehiculos`); si no, `400` con `fields.servicioId` = *"Ese servicio no se ofrece para <tipo>. Elegí otro."* |
| `vehiculoModelo` | no | Hasta 80 caracteres. `""`, `null` u omitido => `null`. |
| `servicioId` | sí | `id` de un servicio que exista y esté **activo** en el catálogo (`GET /api/servicios`). Si no: `400` con `fields.servicioId` = *"Elegí un servicio de la lista."* |
| `fechaPreferida` | sí | `YYYY-MM-DD`, existente en el calendario, desde **hoy** hasta **hoy + 60 días** (ambos inclusive). "Hoy" se calcula en la zona `America/Argentina/La_Rioja`. |
| `franja` | sí | Ver enums. |
| `comentario` | no | Hasta 500 caracteres (admite saltos de línea). `""`, `null` u omitido => `null`. |
| `website` | no | **Honeypot anti-spam**: campo oculto en el formulario que una persona nunca completa. Si viene con contenido, la API responde `201` con una respuesta creíble pero **no guarda nada**. |

Higiene de texto: los controles bidireccionales invisibles (los que agrega WhatsApp al copiar un contacto) se quitan solos; los caracteres de control (como el nulo o la campana) se rechazan.

Disponibilidad (después de validar el formato y el servicio): si el día está cerrado (horario semanal o día especial) => `400 VALIDATION_ERROR` con `fields.fechaPreferida` = *"Ese día no tomamos turnos. Elegí otro."*; si la franja está llena o tiene cupo 0 => `409 FRANJA_LLENA` con `fields.franja` = *"Esa franja se llenó. Elegí otra."*. Ninguno guarda nada ni gasta cupo del rate limit. El frontend debería recargar `GET /api/disponibilidad` y pedir otra elección.

Respuesta `201`:

```json
{ "booking": { "id": "5f0c2a3e-9b1d-4c7e-8a55-2d3f1e6b7a90", "servicioId": "pulido", "fechaPreferida": "2026-10-20", "franja": "manana", "estado": "pendiente", "seguimientoUrl": "/turno/5f0c2a3e-9b1d-4c7e-8a55-2d3f1e6b7a90" } }
```

`id` es un **UUID (string)**, no un número. `seguimientoUrl` es la ruta **relativa** de la página de seguimiento (va dentro de `booking`). La respuesta pública no incluye datos personales.

### `GET /api/disponibilidad?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (público)

Los dos opcionales: sin `desde`, hoy; sin `hasta`, hoy + 60 (hora de La Rioja). Las dos dentro de hoy..hoy+60, `hasta >= desde` y a lo sumo 62 días; si no, `400` con `fields.desde` o `fields.hasta` (repetidos o mal formados también). Los parámetros desconocidos se ignoran. `200`:

```json
{ "dias": [ { "fecha": "2026-10-18", "abierto": false, "manana": false, "tarde": false },
            { "fecha": "2026-10-20", "abierto": true, "manana": true, "tarde": false } ] }
```

Un elemento por día del rango, en orden. `manana` / `tarde` = **hay lugar** en esa franja (nunca se exponen cantidades). `abierto: true` con las dos en `false` = abierto pero sin lugar (lleno o cupos en 0).

### `GET /api/turnos/:id` (público, seguimiento)

`200 { "turno": { "id", "servicioNombre", "fecha", "franja", "estado", "actualizadoEl" } }` (`fecha` y `franja` de agenda; `actualizadoEl` ISO 8601 UTC) o `404 NOT_FOUND` (*"No encontramos ese turno."*), igual para un id inexistente o con formato inválido. Límite propio: 60 por IP cada 15 min (`429`). Lleva `X-Robots-Tag: noindex, nofollow`.

Error de validación `400` (ejemplo):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Revisá los datos ingresados.",
  "fields": { "telefono": "Revisá el teléfono: usá solo números, espacios, +, - y paréntesis (mínimo 8 dígitos).",
              "fechaPreferida": "La fecha no puede ser anterior a hoy." } } }
```

### Usuario de la sesión (objeto `usuario`)

**Cambio de contrato:** antes `/api/auth/login` y `/api/auth/me` devolvían `{ "admin": { "email": "..." } }`. Ahora devuelven:

```json
{ "usuario": { "id": "5f0c2a3e-9b1d-4c7e-8a55-2d3f1e6b7a90", "email": "dueno@ejemplo.com", "nombre": "Mateo", "rol": "superadmin", "fotoVersion": null } }
{ "usuario": { "id": "5f0c2a3e-9b1d-4c7e-8a55-2d3f1e6b7a90", "email": "dueno@ejemplo.com", "nombre": "Mateo", "rol": "superadmin",
               "avatarUrl": "https://<proyecto>.supabase.co/storage/v1/object/sign/perfiles-avatares/<uuid>/<uuid>.webp?token=...",
               "avatarVenceEl": "2026-10-16T16:00:00.000Z" } }
```

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` (UUID) | Id del usuario en Supabase Auth. |
| `email` | `string \| null` | En minúsculas. |
| `nombre` | `string \| null` | Lo pone un superadmin; `null` si no tiene. |
| `rol` | `"superadmin" \| "admin" \| "empleado"` | Para mostrar u ocultar botones; la API igual valida cada acción. |
| `fotoVersion` | `string \| null` | ISO 8601 de cuándo se subió la foto de perfil (`perfiles.foto_actualizada_at`), o `null` si no tiene. La URL de la foto es `/api/admin/usuarios/<id>/foto?v=<fotoVersion>`. |

### `POST /api/auth/login`

Body `{ "email": string, "password": string }` (estricto; `password` hasta 128 caracteres). `200 { "usuario": { id, email, nombre, rol } }` y las cookies de sesión. Errores: `401 INVALID_CREDENTIALS` con un único mensaje genérico (*"El email o la contraseña no son correctos, o tu usuario todavía no está habilitado para el panel."*) para contraseña incorrecta, email inexistente o sin confirmar **y también para un usuario sin perfil o inactivo**: así el login no confirma que la contraseña de un usuario inactivo es correcta (la sesión que Supabase abrió se cierra en segundo plano), `400 VALIDATION_ERROR`, `429 RATE_LIMITED`, `503 SERVICE_UNAVAILABLE` (Supabase Auth no responde). Límites de intentos **fallidos** (los logins correctos no cuentan; los dos dan el mismo `429` con *"Hiciste demasiados intentos fallidos. Esperá unos minutos antes de volver a probar."*): **5 cada 15 minutos por IP + email** (el email normalizado: minúsculas y sin espacios; en la clave va un hash, nunca el email) y **30 cada 15 minutos por IP sola**, contra el barrido de muchas cuentas. Así, con todo el lavadero en el mismo WiFi, el que se equivoca no deja afuera a los demás. Se mira primero el de la persona: los intentos que ya tiene frenados no gastan el cupo de la IP. Si el email viene mal formado, cuenta solo la IP (`rateLimits.loginFailures` y `rateLimits.loginFailuresIp`). `usuario` lleva también `fotoVersion`.
| `avatarUrl` | `string \| null` | URL **firmada** de lectura de su foto de perfil (vence en 1 hora; el backend la reusa mientras le queden más de 10 minutos). `null` sin foto, con las fotos apagadas o si Storage no respondió. |
| `avatarVenceEl` | `string \| null` | Cuándo vence `avatarUrl` (ISO 8601 UTC). |

### `POST /api/auth/login`

Body `{ "email": string, "password": string }` (estricto; `password` hasta 128 caracteres). `200 { "usuario": { id, email, nombre, rol, avatarUrl, avatarVenceEl } }` y las cookies de sesión. Errores: `401 INVALID_CREDENTIALS` con un único mensaje genérico (*"El email o la contraseña no son correctos, o tu usuario todavía no está habilitado para el panel."*) para contraseña incorrecta, email inexistente o sin confirmar **y también para un usuario sin perfil o inactivo**: así el login no confirma que la contraseña de un usuario inactivo es correcta (la sesión que Supabase abrió se cierra en segundo plano), `400 VALIDATION_ERROR`, `429 RATE_LIMITED`, `503 SERVICE_UNAVAILABLE` (Supabase Auth no responde). Límite: **5 intentos fallidos por IP cada 15 minutos** (`429`; los logins correctos no cuentan).

Cookies (el JS de la página no puede leerlas: para saber si hay sesión, llamar a `GET /api/auth/me`):

| Cookie | Contenido | Atributos |
|---|---|---|
| `bd_at` | access token de Supabase (JWT) | `HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800` y `Secure` en producción |
| `bd_rt` | refresh token de Supabase (rota en cada uso) | `HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=28800` y `Secure` en producción |

### `POST /api/auth/refresh`

Sin body (pero con `Content-Type: application/json`). Canjea el refresh token: `200 { "usuario": {...} }` y cookies nuevas; `401 UNAUTHORIZED` (sin refresh token, revocado o reutilizado; borra las cookies); `403 NO_ACCESS` (el usuario fue desactivado; borra las cookies).

### `POST /api/auth/logout`

`204` sin body. Cierra la sesión en Supabase y borra las dos cookies. Siempre responde `204`, haya o no sesión.

### `GET /api/auth/me`

`200 { "usuario": { id, email, nombre, rol, fotoVersion } }`, `401 UNAUTHORIZED` o `403 NO_ACCESS`. Si el access token venció, refresca solo (acá sí viaja el refresh token) y reescribe las cookies.
`200 { "usuario": { id, email, nombre, rol, avatarUrl, avatarVenceEl } }`, `401 UNAUTHORIZED` o `403 NO_ACCESS`. Si el access token venció, refresca solo (acá sí viaja el refresh token) y reescribe las cookies.

### Perfil propio y foto de perfil (`/api/admin/perfil`, todos los roles)

Contrato completo: [`reportes/2026-11-16_04_contrato-perfil.md`](../reportes/2026-11-16_04_contrato-perfil.md). Siempre es el usuario de la sesión (no hay id en la URL).

| Ruta | Respuesta |
|---|---|
| `GET /api/admin/perfil` | `{ perfil: { id, email, nombre, rol, avatarUrl, avatarVenceEl, creadoEl } }` |
| `PATCH /api/admin/perfil { nombre }` | `{ perfil }`. Nombre de una línea, 2 a 60 caracteres. |
| `POST /api/admin/perfil/avatar { contentType, tamano }` | `201 { subida: { url, metodo: 'PUT', headers: { 'Content-Type' }, venceEl } }`. `image/jpeg` o `image/webp`, 1 a 524.288 bytes. Rate limit: 10 cada 10 min por usuario. |
| (el panel hace `PUT subida.url`) | |
| `POST /api/admin/perfil/avatar/confirmar` | `{ perfil }`. HEAD en Storage (existe, tipo y tamaño). `409` sin subir, vencida o sin pendiente; `400` archivo inválido (se borra). La anterior se borra. |
| `DELETE /api/admin/perfil/avatar` | `204` (también sin foto). |
| `POST /api/admin/perfil/clave { actual, nueva }` | `204`. Verifica `actual` con un login a Supabase Auth (la sesión se cierra enseguida) y cambia la clave con la API admin. `400` si `actual` no coincide (`fields.actual`), si `nueva` tiene menos de 8 o es igual. Rate limit estricto: 5 cada 15 min por usuario (cuentan todos). Nunca se loguean contraseñas. |

Sin `SUPABASE_SECRET_KEY`: `avatarUrl` siempre `null` y las rutas de la foto y de la clave responden `503`. La foto vive en el bucket privado `perfiles-avatares` (`<perfil_id>/<uuid>.<ext>`); la ruta nunca sale por la API. Lo que deja de usarse queda en `avatares_a_borrar` y la conciliación horaria (la misma de las fotos) lo borra, descarta las subidas pendientes vencidas y borra los objetos huérfanos de más de 2 horas. `GET /api/admin/trabajadores` y `GET /api/admin/usuarios` suman `avatarUrl` por persona (firmadas en lote, 1 hora); el ranking de estadísticas no la trae: el panel la cruza por `id` con `/trabajadores`.

### Registrar lavado (`POST` y `GET /api/admin/lavados`)

El auto que llega sin turno. Se guarda como un turno **ya completado** con su cobro y `origen: "mostrador"`, así entra
solo en estadísticas, metas, "mis trabajos" (de quien lo registró), comprobantes e historial del cliente. **No ocupa cupo**
de la agenda. Se corrige o se borra como cualquier turno: `PATCH` / `DELETE /api/admin/bookings/:id`. Quien lo
registró lo puede **deshacer** enseguida con `DELETE /api/admin/lavados/:id` (ver abajo).

`POST /api/admin/lavados` (requiere sesión; todos los roles) — body estricto (un campo desconocido = 400):

| Campo | Obligatorio | Qué es |
|---|---|---|
| `servicioIds` | sí | De **1 a 10** ids de servicios **distintos**, cada uno activo y ofrecido para ese vehículo, en el orden elegido (el primero es el principal: sale como `servicioId`). Cualquier error (vacío, más de 10, repetidos, mal formado, inexistente, inactivo, no se ofrece para el vehículo) => `400` en `fields.servicioIds` y no se guarda nada. Un auto con varios servicios es **un** lavado: en la planilla y en "mis trabajos" cuenta 1; en "servicios más pedidos", cada servicio. |
| `servicioId` | no | **Compatibilidad** con la cola sin conexión del panel: si llega `servicioId` (string) y no `servicioIds`, vale como `[servicioId]`. Los dos juntos = `400` en `fields.servicioIds` (ninguno, también). |
| `vehiculoTipo` | sí | `auto`, `suv`, `pickup` o `moto`. |
| `monto` | no | Pesos cobrados (entero 0 a 99.999.999). `null`/omitido = sin cargar (se completa después con PATCH). |
| `formaPago` | no | `efectivo`, `transferencia`, `debito`, `credito` u `otro`. `null`/omitido = sin indicar. Todos los roles (no es un importe). Otro valor = 400 en `fields.formaPago`. |
| `trabajadorId` | no | **Compatibilidad** (el panel ya no lo manda): quién lo hizo (perfil activo). Omitido = quien registra. El `empleado` solo puede ser él mismo (otro = 403). No cambia `registradoPor`, que siempre es la sesión. |
| `fecha` | no | `YYYY-MM-DD`, de hoy hasta 31 días atrás (hora de La Rioja). Omitida = hoy. Futura = 400. |
| `franja` | no | `manana` o `tarde`. Omitida = según la hora (desde las 14 h, `tarde`). |
| `nombre` | no | Cliente (hasta 80). Omitido = "Cliente de mostrador". |
| `telefono` | no | Como en el pedido de turno (mín. 8 dígitos). Sirve para el historial del cliente. |
| `vehiculoModelo` | no | Modelo y/o patente, texto libre (hasta 80). |
| `notasInternas` | no | Nota (hasta 1000). |
| `idLocal` | no | UUID que genera el panel para cada lavado de su cola sin conexión. Si ya existe un lavado con ese `idLocal` registrado por **la misma persona**, no se crea otro: `200` (no `201`) con el mismo `{ lavado, deshacerHasta }` del original (aunque el servicio se haya desactivado en el medio). Si lo registró **otra persona**: `409 CONFLICT` (*"Ese lavado ya lo registró otra persona."*). No es UUID = 400 en `fields.idLocal`. |

Límite: **60 pedidos por minuto por usuario** entre `POST /api/admin/lavados` y `DELETE /api/admin/lavados/:id`
(`429 RATE_LIMITED`, *"Registraste demasiados lavados seguidos. Esperá un minuto y probá de nuevo."*; `rateLimits.lavados`,
contado por id de usuario, detrás de la sesión). Los **reintentos** del mismo `idLocal` (los que responden `200`) no
cuentan: se descuentan después de procesarlos, así la cola sin conexión que se vacía de golpe al volver la señal no se
frena.

`201 { "lavado": Turno, "deshacerHasta": "2026-11-13T15:05:00.000Z" }` (el mismo objeto Turno de
`/api/admin/bookings`, con `estado: "completado"`, `origen: "mostrador"` y su `formaPago`). `deshacerHasta` (ISO 8601
UTC) = la creación + 5 minutos: hasta ese momento quien lo registró lo puede deshacer. El empleado puede cargar el monto al registrar (es el momento de cobrar), pero nunca lo recibe
en las respuestas (`monto: null`) ni lo puede corregir después.

```bash
curl -b cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" \
  -d '{"servicioIds":["limpieza-nivel-2","limpieza-motor"],"vehiculoTipo":"auto","monto":55000,"formaPago":"efectivo","vehiculoModelo":"Gol AB123CD"}' \
  http://localhost:4000/api/admin/lavados
```

`GET /api/admin/lavados?fecha=YYYY-MM-DD` (sin fecha: hoy) — la planilla del día (sin los cancelados):

```json
{
  "fecha": "2026-11-11",
  "lavados": [ /* Turno, en el orden en que se registraron */ ],
  "resumen": {
    "cantidad": 4,
    "total": 32000,
    "sinMonto": 1,
    "porFormaPago": [
      { "formaPago": "transferencia", "cantidad": 1, "total": 20000 },
      { "formaPago": "efectivo", "cantidad": 2, "total": 12000 },
      { "formaPago": null, "cantidad": 1, "total": 0 }
    ]
  }
}
```

Ya no hay `resumen.porTrabajador` (contrato 2026-11-17_05: sin ranking; cada lavado trae `registradoPor`). `porFormaPago` es el **cierre de
caja**: una entrada por forma de pago usada ese día (`null` = sin indicar), agrupada en SQL, de la que más se cobró a la
que menos (empates: más lavados, después el orden efectivo, transferencia, debito, credito, otro y "sin indicar" al
final). Para el `empleado`, `total` es `null` (en el resumen y en cada fila de `porFormaPago`) y los `monto` de los
lavados también; para que el orden no revele lo cobrado, a él `porFormaPago` le llega ordenado por cantidad (mismos
desempates). `formaPago` de cada lavado la ven todos los roles.

`DELETE /api/admin/lavados/:id` (requiere sesión; exige `Content-Type: application/json` aunque no lleve body) —
**deshacer** un lavado de mostrador. `204` sin body.

- Quien **lo registró** (columna `registrado_por`) lo puede deshacer hasta **5 minutos** después de registrarlo
  (`deshacerHasta`; justo a los 5 minutos todavía puede). Pasado el plazo:
  `403 { "error": { "code": "PLAZO_DESHACER_VENCIDO", "message": "Pasaron más de 5 minutos: pedile a un encargado que lo borre desde la planilla." } }`.
- `admin` y `superadmin` (los que pueden borrar turnos) lo borran **siempre**, sea de quien sea.
- Un `empleado` con un lavado que no registró él (aunque lo haya lavado él): `403 FORBIDDEN` (*"Solo podés deshacer un
  lavado que registraste vos."*).
- Con comprobante emitido: `409 TURNO_CON_COMPROBANTE` (*"Este lavado ya tiene un comprobante de pago emitido: no se
  puede deshacer."*), para todos los roles.
- No existe, id inválido o es un turno web: `404 NOT_FOUND` (*"No encontramos ese lavado."*).

```bash
curl -X DELETE -b cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" \
  http://localhost:4000/api/admin/lavados/<id>
```

### `GET /api/admin/bookings?estado=&q=&cliente=&limit=&offset=` (requiere sesión; todos los roles)

| Parámetro | Regla |
|---|---|
| `estado` | Opcional. Uno de los cuatro estados. Vacío (`estado=`) = sin filtro. |
| `q` | Opcional. Texto de búsqueda: se recorta y tiene que quedar de **2 a 80 caracteres** (si no, `400` con `fields.q`; vacío o solo espacios = sin filtro). Encuentra el turno si el texto aparece, sin importar mayúsculas ni acentos, en `nombre`, `email` o `vehiculoModelo`; o si los dígitos de `q` (cuando son al menos 4) aparecen en los dígitos del teléfono o en `telefonoWhatsapp`. `%`, `_` y `\` se buscan como texto. |
| `cliente` | Opcional. Un `telefonoWhatsapp` exacto (`^\d{8,15}$`; si no, `400` con `fields.cliente`): todos los turnos de ese cliente. |
| `limit` | Opcional. Entero de 1 a 100. Por defecto 50. |
| `offset` | Opcional. Entero de 0 en adelante. Por defecto 0. |

Los parámetros desconocidos se ignoran; uno inválido da `400` con `fields`. Respuesta `200`, **más nuevos primero**; `total` cuenta los que cumplen el filtro, sin paginar:

```json
{
  "bookings": [
    {
      "id": "5f0c2a3e-9b1d-4c7e-8a55-2d3f1e6b7a90",
      "nombre": "Juan Pérez",
      "telefono": "+54 9 380 412-3456",
      "telefonoWhatsapp": "5493804123456",
      "email": "juan@ejemplo.com",
      "vehiculoTipo": "auto",
      "vehiculoModelo": "Toyota Corolla",
      "servicioId": "pulido",
      "fechaPreferida": "2026-10-20",
      "franja": "manana",
      "fechaConfirmada": null,
      "franjaConfirmada": null,
      "comentario": "Rayones en el capot",
      "estado": "pendiente",
      "notasInternas": null,
      "turnosDelCliente": 1,
      "monto": null,
      "trabajador": null,
      "registradoPor": null,
      "formaPago": null,
      "servicios": [ { "id": "pulido", "nombre": "Pulido", "precioLista": null } ],
      "createdAt": "2026-10-16T15:00:00.000Z",
      "updatedAt": "2026-10-16T15:00:00.000Z"
    }
  ],
  "total": 1
}
```

**`servicios`** (`Array<{ id: string; nombre: string; precioLista: number | null }>`): los servicios del turno o lavado, en el orden elegido (1 a 10); el primero es el principal, el mismo que **`servicioId`** (que se mantiene). Un turno web o viejo trae uno solo. `precioLista` = el precio de lista de ese servicio para el vehículo **al momento de registrarlo** (una foto: no cambia si después se edita el catálogo); `null` si era "Consultá" o si el turno es anterior a la tabla, y **siempre `null` para `empleado`** (no recibe importes).

**`monto`** (`integer | null`): pesos cobrados por el trabajo; solo en turnos `completado`. **Solo `admin` y `superadmin` lo reciben con valor: para `empleado` siempre es `null`.** **`trabajador`** (`{ "id", "nombre" } | null`): quién hizo el trabajo; `null` = sin asignar. Sigue en el JSON, pero el panel ya no lo muestra. **`registradoPor`** (`{ "id", "nombre" } | null`): quién lo registró en el panel (columna `registrado_por`): en un lavado de mostrador, la sesión que lo cargó. `null` en los turnos de la web (o de alguien borrado antes de la migración `usuarios_baja`). Lo reciben **todos los roles**, también el `empleado` (es un nombre, no un importe). En los dos, `nombre` = el de la persona o, si no tiene, **la parte de su email antes de la @** (nunca el email entero, que también vería el empleado); a alguien dado de baja se lo sigue mostrando por su nombre. Aparecen en el listado, la agenda, la planilla, `POST /api/admin/lavados` y la respuesta del PATCH; nunca en el seguimiento público.

`email`, `vehiculoModelo` y `comentario` pueden ser `null`. Los filtros se combinan entre sí; el orden sigue siendo más nuevos primero y `total` cuenta lo filtrado.

**`formaPago`** (`"efectivo" | "transferencia" | "debito" | "credito" | "otro" | null`): cómo pagó el cliente; `null` = sin indicar. **No es un importe: la reciben todos los roles.** Se carga al registrar un lavado y se corrige con el PATCH (`admin` y `superadmin`).

**`notasInternas`** (`string | null`): la nota interna del taller (hasta 1000 caracteres, con saltos de línea). El cliente nunca la ve.

**`turnosDelCliente`** (`integer | null`): cuántos turnos hay con el mismo `telefonoWhatsapp`, contando este y todos los estados (1 = primer turno). `null` si el turno no tiene teléfono normalizado guardado (no interpretable, o turno viejo todavía sin `npm run normalizar-telefonos`).

**`fechaConfirmada`** (`"YYYY-MM-DD" | null`) y **`franjaConfirmada`** (`"manana" | "tarde" | null`): la fecha y franja que confirmó el taller, si difieren de las pedidas. Van siempre juntas: las dos `null` (se confirmó, o se confirmará, para `fechaPreferida`/`franja`) o las dos con valor. **Fecha de agenda** = la confirmada si existe, si no la pedida (también para el mensaje de WhatsApp).

**`telefonoWhatsapp`** (`string | null`): el teléfono listo para `https://wa.me/<telefonoWhatsapp>`, solo dígitos y en formato internacional. Se calcula al crear el turno y se guarda (columna `telefono_whatsapp`; en un turno viejo sin normalizar, se calcula al leer) con `libphonenumber-js`, país por defecto Argentina: los celulares argentinos salen como `549` + 10 dígitos aunque el cliente no haya escrito el `0`, el `15` ni el `9` (`0380 15-4123456`, `380 4123456` y `+54 9 380 412-3456` dan `5493804123456`); un número válido de otro país va en E.164 sin `+` (`+1 415 555 2671` => `14155552671`). Si no se puede interpretar, es `null`: **nunca se rechaza un turno por eso**, así que el frontend tiene que manejar el `null` (mostrar el teléfono sin botón de WhatsApp).

### `PATCH /api/admin/bookings/:id` (requiere sesión)

Body estricto con **al menos uno** de: `estado`, la pareja `fechaConfirmada` + `franjaConfirmada` (**juntas**; `null` las dos = volver a la fecha pedida), `notasInternas`, `monto`, `trabajadorId`, `formaPago` o `servicioIds`.

```json
{ "estado": "confirmado", "fechaConfirmada": "2026-10-24", "franjaConfirmada": "tarde", "notasInternas": "Lo trae el hijo." }
```

- **`notasInternas`** (`string | null`): **todos los roles**, aunque el turno esté `cancelado` o `completado`. Se recortan los espacios de los extremos; vacío o solo espacios => `null` (borra la nota). Hasta 1000 caracteres (contados como `char_length`). Se permiten salto de línea y tabulación (un `\r\n` cuenta como salto de línea); cualquier otro carácter de control => `400` con `fields.notasInternas`. Se puede mandar sola o junto con `estado` y/o la fecha confirmada: va en la misma escritura, y si el resto del pedido se rechaza (`403`, turno cerrado al reprogramar), la nota tampoco se guarda.

`200 { "booking": { ...mismo objeto que el listado... } }`. `404 NOT_FOUND` si no existe.

- **Solo `estado`** (las reglas de siempre): `400` con `fields.estado` si es inválido. **`empleado` solo puede pasar a `completado`**: cualquier otro estado da `403 FORBIDDEN` (*"Con tu rol solo podés marcar los turnos como completados."*); `admin` y `superadmin`, a cualquiera. No toca la fecha confirmada.
- **Un lavado de mostrador no sale de `completado`** (decisión del dueño, 2026-11-19): pasar un turno con `origen: "mostrador"` a `cancelado`, `pendiente` o `confirmado` (solo, con otros campos o reprogramando) da `409 CONFLICT` (*"Un lavado de mostrador no se cancela: borralo desde la planilla (así vuelven los productos al stock)."*) y no escribe nada. El `403` del empleado va antes. Se deshace con `DELETE /api/admin/lavados/:id` (o `DELETE /api/admin/bookings/:id`), que devuelve el stock. Los turnos web no cambian.
- **Con fecha y franja** (reprogramar; si viene `estado`, se cambia en la misma escritura): solo `admin` y `superadmin`; `empleado` => `403 FORBIDDEN` (*"Con tu rol no podés cambiar la fecha de un turno."*). El turno no puede estar `cancelado` ni `completado`, ni pasar a uno de esos en el mismo pedido => `400 VALIDATION_ERROR` sin `fields` (*"No se puede cambiar la fecha de un turno cancelado o completado."*). Fecha inexistente, con otro formato, anterior a hoy o posterior a hoy + 120 días (hora de La Rioja) => `400` con `fields.fechaConfirmada`. Franja inválida => `fields.franjaConfirmada`.
- **Cobro** (`monto`: entero 0 a 99.999.999 o `null`; `trabajadorId`: uuid o `null`):
  - Solo valen si el turno **queda** `completado` (en el mismo pedido o porque ya lo está); si no, `400` con `fields.monto` / `fields.trabajadorId`. Mandar `null` en un turno que no está completado no es error (no hay nada que borrar). Un pedido de reprogramar con cobro también da `400`.
  - **`admin` y `superadmin`**: cargan el monto y eligen a cualquier persona **activa** (si no existe o está inactiva, `400` con `fields.trabajadorId`); pueden corregirlos en un turno ya completado. Completar sin monto es válido ("lo cargo después").
  - **`empleado`**: al pasar un turno a `completado` queda **él mismo** como trabajador, sin que lo mande. `403` si manda cualquier `monto`, un `trabajadorId` de otra persona, o toca el cobro de un turno que ya estaba completado.
  - Si el `estado` pasa a algo distinto de `completado`, `monto` y `trabajador` se borran.
  - Todo se valida antes de guardar: o se guarda todo o nada. Cargar o corregir solo el cobro no cambia `updatedAt`.
- **`formaPago`** (una de `efectivo`, `transferencia`, `debito`, `credito`, `otro`, o `null` = sin indicar): solo quien corrige el cobro (`admin` y `superadmin`; `empleado` => `403 FORBIDDEN`, *"Con tu rol no podés cambiar la forma de pago: la corrige un administrador."*). Vale en cualquier estado, sola o junto con el resto (también al reprogramar), y no cambia `updatedAt`. Otro valor => `400` con `fields.formaPago`.
- **`servicioIds`** (mismas reglas que en `POST /api/admin/lavados`: 1 a 10 distintos, activos y ofrecidos para el `vehiculoTipo` del turno; error en `fields.servicioIds`; `404` si el turno no existe): solo quien corrige el cobro (`cobro.corregir`: `admin` y `superadmin`; `empleado` => `403 FORBIDDEN`, *"Con tu rol no podés cambiar los servicios de un turno: los corrige un administrador."*). Vale en cualquier estado, sola o junto con el resto (también al reprogramar), en la misma transacción. Reemplaza la lista entera y el principal (`servicioId` = el primero); los servicios que ya estaban conservan su foto de `precioLista` y los nuevos toman el precio de lista vigente. Mueve `updatedAt` (el servicio se ve en el seguimiento); la misma lista en el mismo orden no escribe nada.
- Falta una de las dos, o una es `null` y la otra no => `400` en el campo que falta (o en el que es `null`). Body vacío => `400` con `fields.estado`.

### `GET /api/admin/agenda?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (requiere sesión; todos los roles)

| Parámetro | Regla |
|---|---|
| `desde` | Obligatorio. Fecha `YYYY-MM-DD` existente. |
| `hasta` | Obligatorio. Fecha `YYYY-MM-DD` existente, `>= desde`, y el rango inclusivo abarca **a lo sumo 42 días** (`desde` + 41). |

`200 { "turnos": Turno[], "cupos": CupoDia[] }`. `cupos` tiene un elemento por día del rango, en orden: `{ "fecha", "abierto", "cupoManana", "cupoTarde", "ocupadosManana", "ocupadosTarde" }` (un día cerrado trae los cupos en 0; los ocupados se informan igual, porque el panel puede haber puesto turnos ahí). `turnos` (el mismo objeto que `/api/admin/bookings`): los **no cancelados** cuya fecha de agenda (`fechaConfirmada ?? fechaPreferida`) cae en el rango, ordenados por fecha de agenda, franja de agenda (`manana` antes que `tarde`) y orden de llegada. Sin paginación. `400 VALIDATION_ERROR` con `fields.desde` / `fields.hasta` si faltan, tienen mal formato (también repetidos) o el rango es inválido (el error de rango va en `hasta`). Los parámetros desconocidos se ignoran, como en el listado.

### `GET /api/admin/trabajadores` (solo `admin` y `superadmin`)

`200 { "trabajadores": [{ "id", "nombre", "rol" }] }`: las personas **activas** de cualquier rol, ordenadas por nombre (sin distinguir mayúsculas; `nombre` = el nombre o, si no tiene, la parte del email antes de la @, nunca el email entero; sin nombre ni email, *"Sin nombre"*). Para el selector "¿Quién lo hizo?". `empleado` => `403`.
`200 { "trabajadores": [{ "id", "nombre", "rol", "avatarUrl" }] }` (`avatarUrl`: URL firmada de su foto de perfil, vence en 1 hora, o `null`): las personas **activas** de cualquier rol, ordenadas por nombre (sin distinguir mayúsculas; `nombre` = el nombre o, si no tiene, el email). Para el selector "¿Quién lo hizo?". `empleado` => `403`.

### `GET /api/admin/estadisticas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (solo `admin` y `superadmin`)

Todo se agrupa por la **fecha de agenda** del turno (la confirmada si existe, si no la pedida) en hora de La Rioja: un servidor en UTC no corre el día. **Pedidos** = turnos no cancelados; **completados** = vendidos; **ingresos** = suma de `monto` de los completados (solo lo registrado); **ticketPromedio** = ingresos / completados **con monto** (redondeado al entero); **tasaCancelacion** = cancelados / todos los turnos (4 decimales). Rango inclusivo, `hasta >= desde`, máximo **366 días** (`400` con `fields.desde` / `fields.hasta`). Sin `hasta`, hoy; sin `desde`, el primer día del mes de `hasta` (sin ninguno: el mes actual hasta hoy). Las agregaciones se hacen en SQL (no se traen las filas de los turnos).

```json
{
  "rango": { "desde": "2026-10-01", "hasta": "2026-10-26" },
  "granularidad": "dia",
  "resumen": {
    "hoy":  { "actual": { "completados": 3, "ingresos": 95000, "gastos": 12500, "ganancia": 82500 }, "anterior": { "completados": 2, "ingresos": 60000, "gastos": 0, "ganancia": 60000 } },
    "mes":  { "actual": {}, "anterior": {} },
    "anio": { "actual": {}, "anterior": {} }
  },
  "periodo": { "turnos": 40, "pedidos": 36, "pendientes": 4, "confirmados": 6, "completados": 24, "cancelados": 4,
               "ingresos": 1240000, "gastos": 310000, "gananciaNeta": 930000, "margen": 0.75, "ticketPromedio": 59048, "completadosSinMonto": 3, "tasaCancelacion": 0.1 },
  "serie": [ { "clave": "2026-10-01", "completados": 2, "ingresos": 80000, "gastos": 12500 } ],
  "porServicio": [ { "servicioId": "lavado-premium", "nombre": "Lavado Premium", "pedidos": 14, "completados": 10, "ingresos": 600000 } ],
  "porDiaSemana": [ { "dia": 1, "manana": 5, "tarde": 3 } ],
  "gastosPorCategoria": [ { "categoria": "alquiler", "monto": 90000 } ]
}
```

- `resumen`: tarjetas fijas, **siempre con la fecha de hoy** (no dependen del rango): hoy contra ayer; este mes hasta hoy contra el mes pasado hasta el mismo día (con tope en el último día del mes más corto: el 31/03 se compara con el 28/02); este año hasta hoy contra el año pasado hasta el mismo día (el 29/02 se compara con el 28/02; si el año pasado fue bisiesto, incluye su 29/02). Siempre son números (0 si no hubo nada): el cambio porcentual lo calcula el frontend y no existe si `anterior` es 0.
- `serie`: **todos** los días (o meses, `YYYY-MM`) del rango, con ceros donde no hubo nada. `granularidad` = `dia` hasta 62 días, `mes` con más.
- `porServicio`: por `pedidos` descendente; incluye servicios activos sin pedidos (con 0); uno desactivado solo si tuvo pedidos. Cuenta desde `lavado_servicios`: un lavado con varios servicios suma un pedido (y un completado) en **cada** uno. Sus `ingresos` se reparten entre sus servicios en proporción a la foto de `precioLista` (si todos la tienen y suman más de 0) o, si no, en partes iguales: la suma por servicio da lo cobrado (salvo el redondeo de cada fila), sin contar dos veces un monto. `periodo` y `serie` siguen contando turnos (un lavado = 1).
- **Sin ranking** (contrato 2026-11-17_05): ya no salen `porTrabajador` ni `completadosSinTrabajador`; la consulta se borró. Nada de esta respuesta compara personas.
- `porDiaSemana`: siempre los 7 días (0 = domingo ... 6 = sábado), con los pedidos de mañana y tarde del rango.
- `ticketPromedio` y `tasaCancelacion` son `null` si el denominador es 0.
- **Gastos (objetivo 10):** `resumen.*.{actual,anterior}` suman `gastos` y `ganancia` (ingresos - gastos; puede ser negativa); `periodo` suma `gastos`, `gananciaNeta` y `margen` (gananciaNeta / ingresos, 4 decimales, `null` si los ingresos son 0); cada punto de `serie` suma `gastos`; `gastosPorCategoria` va por monto descendente y solo con categorías con gasto. Los gastos se agrupan por la **fecha del gasto** (criterio de caja) con agregaciones en SQL. `/estadisticas/mias` no cambia.

### `GET /api/admin/estadisticas/mias?desde&hasta` (todos los roles)

Mismo rango y errores. `200 { "rango", "completados": N, "porServicio": [{ "servicioId", "nombre", "completados" }], "serie": [{ "clave", "completados" }] }` con los turnos completados que **esa persona registró** (`registrado_por = yo`) y, de los que no tienen quién los registró (los turnos de la web), los que completó (`registrado_por IS NULL AND trabajador_id = yo`). `completados` cuenta turnos; `porServicio`, cada servicio de cada turno; la serie va por día hasta 62 días y por mes con más, con ceros. La consulta combina los índices parciales `bookings_registrado_por_idx` y `bookings_trabajador_id_idx` (BitmapOr; lo comprueba un EXPLAIN en `test/estadisticas.test.ts`), sin índice nuevo. **Nunca lleva importes.**

### `GET /api/admin/permisos` (requiere sesión; todos los roles)

`200 { "roles": [{ "id", "nombre", "descripcion" }], "capacidades": [{ "id", "grupo", "texto", "roles": { "superadmin": "si", "admin": "si", "empleado": "parcial" }, "matiz": { "empleado": "..." } }], "tuRol": "empleado" }`. `roles` viene de `buddys.roles` (superadmin, admin, empleado); `capacidades` es `CAPACIDADES` (tabla de arriba); `matiz` solo está en las capacidades con algún rol `parcial`.

### `GET /api/admin/disponibilidad` (requiere sesión; todos los roles)

```json
{ "horarioSemanal": [ { "dia": 1, "abierto": true, "cupoManana": 2, "cupoTarde": 2 }, "... lunes a sábado ...",
                      { "dia": 0, "abierto": false, "cupoManana": 2, "cupoTarde": 2 } ],
  "diasEspeciales": [ { "fecha": "2026-11-23", "abierto": false, "cupoManana": null, "cupoTarde": null,
                        "motivo": "Feriado: Día de la Soberanía Nacional (trasladable, a confirmar)" } ] }
```

`horarioSemanal`: las 7 filas **de lunes a domingo** (`dia`: 0 = domingo ... 6 = sábado). Con el día cerrado, los cupos guardados se conservan (para cuando se vuelva a abrir) pero no cuentan. `diasEspeciales`: de hoy en adelante (hora de La Rioja), por fecha; `cupoManana`/`cupoTarde` `null` si está cerrado. Los feriados precargados tienen `motivo` que empieza con `Feriado: `.

### `PUT /api/admin/disponibilidad/horario-semanal` (solo `admin` y `superadmin`)

Body estricto `{ "dias": [ { "dia", "abierto", "cupoManana", "cupoTarde" } × 7 ] }`: los 7 días, cada uno una vez (`dia` entero 0 a 6), cupos enteros de 0 a 20. `200 { "horarioSemanal": [...] }` (el horario completo, lunes a domingo). `400` con `fields` (`dias`, o `dias.<posición>.<campo>`); `403 FORBIDDEN` para `empleado` (*"Con tu rol solo podés ver la disponibilidad."*).

### `PUT /api/admin/disponibilidad/dias-especiales/:fecha` (solo `admin` y `superadmin`)

Crea o reemplaza el día. Body estricto `{ "abierto": boolean, "cupoManana"?, "cupoTarde"?, "motivo"? }`. Abierto: los dos cupos obligatorios (0 a 20). Cerrado: los cupos se ignoran y se guardan en `null`. `motivo`: una línea, hasta 80 caracteres; vacío o `null` => `null`. La fecha de la ruta: `YYYY-MM-DD` existente, de hoy a hoy + 730 días (si no, `400` en `fields.fecha`). `200 { "dia": { "fecha", "abierto", "cupoManana", "cupoTarde", "motivo" } }`.

### `DELETE /api/admin/disponibilidad/dias-especiales/:fecha` (solo `admin` y `superadmin`)

Quita el día especial (vuelve al horario semanal). `204`; `404 NOT_FOUND` si no había (o la fecha no tiene formato válido).

### `POST /api/internal/recordatorios` (interno, para el cron)

`Authorization: Bearer <CRON_SECRET>` y `Content-Type: application/json` (sin body). `200 { "enviados", "fallidos", "sinCanal" }`. Sin `CRON_SECRET` configurada => `404` (como una ruta inexistente); con la variable y sin cabecera, otro esquema u otro secreto => `401 UNAUTHORIZED` (*"No autorizado."*, con `WWW-Authenticate: Bearer`). Ver [Recordatorios](#recordatorios).

### `GET /api/admin/push/estado` (requiere sesión; todos los roles)

`200 { "disponible": boolean, "clavePublica": string | null }`. `disponible` es `false` (y `clavePublica` `null`) si faltan las claves VAPID: el panel no ofrece el interruptor de avisos. `clavePublica` es la que usa `PushManager.subscribe` (`applicationServerKey`). Ver [Avisos push](#avisos-push).

### `POST /api/admin/push/suscripciones` (requiere sesión; todos los roles)

Body: la forma de `PushSubscription.toJSON()`: `{ "endpoint", "keys": { "p256dh", "auth" }, "agente"? }` (`expirationTime`, que manda el navegador, se acepta y se ignora; cualquier otro campo => `400`). `201 { "ok": true }`.

- `endpoint`: `https`, hasta 2048 caracteres y de un servicio de push conocido (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`; sin credenciales ni puerto distinto de 443). Otro host => `400 VALIDATION_ERROR` con `fields.endpoint` (así el servidor nunca le hace un pedido a una dirección arbitraria).
- `keys.p256dh` (80 a 100) y `keys.auth` (16 a 32): base64url. `agente` (opcional): 1 a 120 caracteres, sin caracteres de control, solo para que la persona reconozca el aparato.
- Si el endpoint ya existía (también de otra persona: mismo aparato, otra persona), la fila se reemplaza y queda atada a quien está logueado. Máximo **10 dispositivos por persona**: al pasar, se descartan los más viejos.
- Sin claves VAPID => `404 NOT_FOUND`. Sin sesión => `401`.

### `DELETE /api/admin/push/suscripciones` (requiere sesión; todos los roles)

Body `{ "endpoint" }` => `204`, también si no existía (y también con los avisos apagados: cerrar sesión no puede fallar por esto). Borra el dispositivo con ese endpoint, sea de quien sea: el endpoint es una URL imposible de adivinar y, si otra persona usó el mismo aparato, el que cierra sesión tiene que poder dejarlo sin avisos.

### `DELETE /api/admin/bookings/:id` (requiere sesión; solo `admin` y `superadmin`)

`204` sin body. `404 NOT_FOUND` si no existe. `403 FORBIDDEN` para `empleado` (*"Con tu rol no podés borrar turnos."*). Exige `Content-Type: application/json` aunque no lleve body.

### Gestión de usuarios (`/api/admin/usuarios`, `admin` y `superadmin`)

Contrato `reportes/2026-11-17_03_gestion-usuarios.md`. El superadmin gestiona a todos; el admin, solo a empleados (reglas 1 a 5 de [Roles y permisos](#roles-y-permisos-la-regla-vive-en-el-backend-la-ui-solo-esconde-botones)). El empleado recibe `403 FORBIDDEN` (*"Con tu rol no podés gestionar usuarios."*) en todas.

#### Objeto `Usuario` (listado, alta, edición y baja)
`200`, los más viejos primero. Cada usuario suma `avatarUrl` (URL firmada de su foto de perfil, vence en 1 hora, o `null`; también en el `PATCH`). `403 FORBIDDEN` (*"Solo un superadmin puede gestionar usuarios."*) para los otros roles.

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
  "fotoVersion": "2026-11-17T15:30:00.000Z",
  "createdAt": "2026-10-18T15:00:00.000Z",
  "updatedAt": "2026-10-18T15:00:00.000Z"
}
```

- `eliminadoAt`: ISO 8601 si está dado de baja; si no, `null`.
- `tieneHistorial`: aparece en algún turno o lavado (`trabajador_id` o `registrado_por`), gasto, movimiento de stock, presupuesto o comprobante. Se calcula en **una sola** consulta para todo el listado. Con historial, eliminar lo da de baja.
- `gestionable`: si **quien pide** lo puede editar y eliminar (`puedeGestionarA`, y que no sea uno mismo ni esté dado de baja). Uno mismo aparece siempre con `false`.
- `fotoVersion`: como en el usuario de la sesión (contrato 04). Los admins ven la foto de cada usuario del equipo en `GET /api/admin/usuarios/:id/foto?v=<fotoVersion>`.
- `email`: el superadmin ve todos; el admin, el de los empleados y **el suyo propio** (cada uno ve siempre su email); de otros admins y superadmins le llega `null`. De un dado de baja, siempre `null` (el de Auth es `baja+<id>@buddys.invalid`). `nombre` puede ser `null`.

#### `GET /api/admin/usuarios`

`200 { "usuarios": Usuario[], "gestionCuentas": boolean }`, con **todos** los usuarios, incluidos los dados de baja, los más viejos primero (el buscador y los filtros son de la UI). `gestionCuentas: false` significa que falta `SUPABASE_SECRET_KEY` y no están disponibles el alta, la baja ni el cambio de email o contraseña. Los usuarios creados directamente en Supabase aparecen como `empleado` con `activo: false` hasta que alguien los active.

#### `POST /api/admin/usuarios`

Body estricto: `email` (hasta 120 caracteres; se guarda en minúsculas), `password` (8 a 72 caracteres, máx. 72 bytes), `nombre` (opcional, como en el PATCH), `rol` y `activo`. Crea el usuario en Supabase Auth con el email confirmado y devuelve `201 { "usuario": Usuario }`. Errores: `400 VALIDATION_ERROR` (con `fields`; también si Supabase rechaza la contraseña por débil), `403 FORBIDDEN` (un admin con un `rol` que no es `empleado`: *"Con tu rol solo podés crear y editar empleados."*), `409 CONFLICT` (*"Ya existe un usuario con ese email."*), `503 SERVICE_UNAVAILABLE` (falta `SUPABASE_SECRET_KEY` o Supabase no responde), `429 RATE_LIMITED` (Supabase limitó los pedidos). Riesgo aceptado: por el `409` un admin puede saber si un email ya tiene cuenta. Es inherente al alta (el email tiene que ser único y hay que avisarlo) y el pedido queda logueado con el id de quien lo hizo (sin el email).

#### `PATCH /api/admin/usuarios/:id`

Body estricto con al menos uno de: `rol` (`"superadmin" | "admin" | "empleado"`), `activo` (`boolean`), `nombre` (`string` de hasta 80 caracteres, una línea; `null` o `""` lo borran), `email` y `password` (mismas reglas que en el alta; se cambian en Supabase Auth y necesitan `SUPABASE_SECRET_KEY`). `200 { "usuario": Usuario }`. Errores: `400 VALIDATION_ERROR` (campo desconocido, tipo inválido o body vacío), `404 NOT_FOUND` (usuario inexistente o id que no es UUID), `403 FORBIDDEN` (reglas 2 y 3), `409 CONFLICT` (cambiar tu propio rol, desactivarte, dejar el sistema sin ningún superadmin activo, un email que ya usa otro, o un usuario dado de baja: *"Ese usuario está dado de baja."*), `503` como en el alta. El cambio tiene efecto inmediato: el usuario afectado lo nota en su próximo pedido. **Cambiarle la contraseña o el email a otra persona le cierra todas sus sesiones** (`buddys_private.cerrar_sesiones`, migración `cerrar_sesiones_usuario`): en su pedido siguiente recibe `401` y tiene que entrar con los datos nuevos. Si cambiás tu propia contraseña por acá, tu sesión actual sigue abierta. Si cerrar las sesiones falla en la base, el cambio igual responde `200` y queda un error en el log (sigue valiendo el tope de 12 h por sesión). La regla 2 se vuelve a comprobar al escribir: el `UPDATE` solo toca el perfil si su rol sigue siendo uno que podés gestionar; si en el medio lo ascendieron, `403` (si lo dieron de baja, `409`; si lo borraron, `404`), y email y contraseña solo se cambian en Auth si el perfil escrito sigue siendo gestionable.

#### `DELETE /api/admin/usuarios/:id`

`200` con body:

- Sin historial: se borra de Supabase Auth (perfil y sesiones en cascada; si tenía una sesión abierta, su siguiente pedido recibe `401`): `{ "resultado": "eliminado" }`. Justo antes de borrarlo en Auth se relee el perfil: si en el medio lo ascendieron a un rol que no gestionás, `403` y no se borra (la fila no se puede bloquear mientras GoTrue la borra desde otra conexión: queda una ventana mínima entre la relectura y el borrado).
- Con historial (o si la base frena el borrado porque en el medio le registraron algo: FK `ON DELETE RESTRICT`; GoTrue responde 500 sin el SQLSTATE y el backend vuelve a mirar el historial): **baja**, `{ "resultado": "baja", "usuario": Usuario }`.

Pasos de la baja, en un orden pensado para que un fallo deje las cosas seguras: (1) en una transacción, solo si su rol sigue siendo uno que podés gestionar (`FOR UPDATE`; si no, `403`): `activo = false`, `eliminado_at = now()`, si `nombre` es `null` **la parte de su email antes de la @** (recortada a 80; si queda vacía, *"Usuario dado de baja"*; nunca el email entero) y se le borran las sesiones (`buddys_private.cerrar_sesiones`); desde acá ya no entra (su sesión abierta recibe `401`). (2) En Supabase Auth (`PUT /admin/users/:id`): email `baja+<id>@buddys.invalid` confirmado y `ban_duration: "876000h"`. (3) Si el paso 2 falla, se deshacen `eliminado_at` y el nombre (queda **inactivo**, sin acceso) y se responde `503` *"No pudimos terminar la baja en el servicio de usuarios. Quedó desactivado; probá eliminarlo de nuevo en unos minutos."*

**La foto de perfil se borra** (contrato 04): eliminado, se borra el objeto de Storage (el perfil se va en cascada); dado de baja, **primero** su `fotoVersion` queda en `null` (aunque Storage esté caído: la foto deja de servirse) y después se borra el objeto. Si Storage falla, la baja sigue y el objeto huérfano queda solo en el log, con el id (*"... el objeto avatares/<id>.webp queda huérfano"*); el bucket es privado y la API no sirve fotos sin `fotoVersion`.

Errores: `404 NOT_FOUND`, `403 FORBIDDEN` (regla 2), `409 CONFLICT` (eliminarte a vos mismo, dejar el sistema sin superadmin activo, o ya dado de baja), `503` (falta `SUPABASE_SECRET_KEY` o falla Supabase). Logs: solo ids y `resultado` (nada de emails). Un dado de baja no aparece en `GET /api/admin/trabajadores` (solo activos), pero sus lavados, turnos, gastos, movimientos y documentos siguen mostrando su nombre.

### Mi perfil y foto de perfil (`/api/admin/perfil`, todos los roles)

Contrato `reportes/2026-11-17_04_perfil-y-foto.md`. Capacidad `perfil.editar` (`puedeEditarPerfil`). El perfil tiene la misma forma que el usuario de la sesión: `{ id, email, nombre, rol, fotoVersion }`. Servicio: `services/perfil.ts`; rutas: `routes/admin-perfil.ts`.

#### `GET /api/admin/perfil`

`200 { "perfil": {...}, "fotosDisponibles": boolean }`. `fotosDisponibles: false` = falta `SUPABASE_SECRET_KEY`: la UI esconde subir y quitar la foto.

#### `PATCH /api/admin/perfil`

Body estricto con al menos uno de: `nombre` (como en usuarios: 1 a 80, una línea; `null` o `""` lo borran) y `passwordActual` + `passwordNueva` (van juntas; `passwordNueva` con las reglas del alta: 8 a 72 caracteres, máx. 72 bytes). `200 { "perfil": {...} }`. El nombre nuevo sale en el siguiente `/api/auth/me`.

Contraseña: se verifica la actual con un `grant_type=password` contra Supabase Auth con el email de la sesión; si sale bien, **la sesión que abrió esa verificación se cierra enseguida** (`logout?scope=local` con su token) y después se cambia con la API admin (`PUT /admin/users/:id`). La sesión actual sigue abierta y **las otras sesiones de esa persona se cierran** (`buddys_private.cerrar_otras_sesiones` con el `session_id` del JWT, migración `cerrar_otras_sesiones_bucket`): en su pedido siguiente reciben `401`. Si cerrarlas falla en la base, el cambio igual responde `200` y queda un error en el log solo con ids (sigue valiendo el tope de 12 h por sesión). Errores:

- `400 VALIDATION_ERROR`: falta una de las dos (`fields.passwordActual` o `fields.passwordNueva`); la actual no es correcta (`fields.passwordActual`: *"La contraseña actual no es correcta."*); Supabase rechaza la nueva por débil (`fields.passwordNueva`); campo desconocido o body vacío.
- `429 RATE_LIMITED`: más de **5 intentos de contraseña cada 15 minutos por usuario** (correctos o no; `rateLimits.perfilPassword`, contado por id de usuario, no por IP). Cambiar solo el nombre no cuenta.
- `503 SERVICE_UNAVAILABLE`: Supabase no responde o falta `SUPABASE_SECRET_KEY` (solo para la contraseña).

#### `PUT /api/admin/perfil/foto`

El body es **la imagen tal cual** (nada de multipart ni base64), con `Content-Type: image/jpeg`, `image/png` o `image/webp` (otro tipo: `415`). `express.raw` de **2 MB** solo en esta ruta: más grande, `413 PAYLOAD_TOO_LARGE` *"La foto pesa más de 2 MB. Elegí una más liviana."*. Validación (`procesarFoto`):

1. Los primeros bytes tienen que coincidir con el `Content-Type` (`FF D8 FF` JPG; `89 50 4E 47 0D 0A 1A 0A` PNG; `RIFF....WEBP` WebP).
2. `sharp` la tiene que decodificar con `limitInputPixels` de 40 MP y `failOn: 'error'`, en el formato declarado y **sin animación** (más de un cuadro se rechaza).
3. `.rotate()` (orientación del EXIF), `resize(256, 256, { fit: 'cover' })` y `webp({ quality: 80 })`, **sin** `withMetadata()`: no queda EXIF, GPS ni perfil ICC.

Si algo falla: `400 VALIDATION_ERROR` con `fields.foto` *"Subí una foto JPG, PNG o WebP."*. Límites (auditoría del objetivo B, B1): **10 subidas cada 15 minutos por usuario** (`rateLimits.perfilFoto`, por id de usuario, salgan bien o no): la 11 responde `429 RATE_LIMITED` *"Subiste demasiadas fotos seguidas. Esperá unos minutos antes de volver a probar."*; el límite va **antes** de `express.raw`, así un pedido limitado no se lee. Además, `procesarFoto` re-codifica **como mucho 2 fotos a la vez** en todo el proceso (`semaforoFotos`, `src/lib/semaforo.ts`): las demás esperan su turno en orden, no se rechazan (la firma se mira antes de esperar). Se sube a Storage (`avatares/<id>.webp`, `x-upsert: true`) y recién después se pone `foto_actualizada_at = now()`: `200 { "perfil": {...} }` con la `fotoVersion` nueva. `503` si falta la clave o Storage falla (el perfil no cambia).

#### `DELETE /api/admin/perfil/foto`

Borra el objeto en Storage y pone `foto_actualizada_at = null`: `200 { "perfil": {...} }`, también si no tenía foto. `503` si falta la clave o Storage falla.

#### `GET /api/admin/usuarios/:id/foto`

La propia, cualquier rol; la de otro, solo admin y superadmin (`puedeGestionarUsuarios`); el empleado pidiendo la de otro: `403` (exista o no). Se monta antes del router de usuarios. `200 image/webp` con:

- `Cache-Control: private, max-age=86400, immutable` si `?v=` es la versión actual; si no, `private, no-cache`.
- `ETag: "<fotoVersion>"` y `304` si coincide `If-None-Match`.
- `X-Content-Type-Options: nosniff` y `Content-Security-Policy: default-src 'none'` (es una imagen, nunca un documento).

`404` si no existe, no tiene foto o el objeto no está en Storage (eso último queda en el log).

#### Storage desde el backend

`src/lib/supabase-storage.ts` (`SupabaseStorageClient`): `POST /storage/v1/object/avatares/<id>.webp` con `x-upsert: true`, `GET` y `DELETE`, con `fetch` inyectable (`storageFetch` en `createApp`), 10 s de timeout y errores tipados (`StorageUnavailableError`, sin URL, claves ni cuerpos). Va con la **secret key solo en la cabecera `apikey`**: según la documentación de Supabase (*API keys*, "Known limitations"), las claves `sb_secret_...` no son JWT y no se mandan en `Authorization: Bearer`; el gateway arma el `Authorization` a partir del `apikey`. Un objeto inexistente se reconoce por `404` o por el `400 { statusCode: "404" }` de la API de Storage. El bucket `avatares` es privado y sin policies: solo entra la secret key. En los tests, `test/storage-fake.ts` (en memoria). Al arrancar, `verifyPostgresSchema` exige `perfiles.foto_actualizada_at`.

### Objeto `Servicio` (catálogo)

| Campo | Tipo | Regla | Público | Panel |
|---|---|---|---|---|
| `id` | `string` | slug `^[a-z0-9]+(-[a-z0-9]+)*$`, 1 a 64. Inmutable. `orden` está reservado. | sí | sí |
| `nombre` | `string` | trim, 1 a 80, una línea | sí | sí |
| `resumen` | `string` | trim, 1 a 200, una línea | sí | sí |
| `descripcion` | `string` | trim, 1 a 1500 (admite saltos de línea y tabs) | sí | sí |
| `incluye` | `string[]` | 0 a 15 ítems, cada uno trim 1 a 120 | sí | sí |
| `glosario` | `{ termino, significado }[]` | 0 a 10; `termino` 1 a 60, `significado` 1 a 300 (objetos estrictos) | sí | sí |
| `duracion` | `string \| null` | duración de **auto**: trim, hasta 60; `""` => `null` | sí | sí |
| `duracionPickup` | `string \| null` | duración de **pick-up**: misma regla que `duracionSuv` | sí | sí |
| `duracionSuv` | `string \| null` | duración de **SUV**: misma regla. `null` = "usa la de auto" (a diferencia de los precios, no es "Consultá"; el cliente cae a `duracion`) | sí | sí |
| `duracionMoto` | `string \| null` | duración de **moto**: misma regla. `null` = "usa la de auto" | sí | sí |
| `precioDesde` | `number \| null` | precio de **auto**: entero en ARS, 0 a 99.999.999; `null` = "Consultá" | sí | sí |
| `precioDesdePickup` | `number \| null` | precio de **pick-up**: misma regla que `precioDesdeSuv` | sí | sí |
| `precioDesdeSuv` | `number \| null` | precio de **SUV**: misma regla que `precioDesde`. `null` = "Consultá" (nunca se cae al de auto) | sí | sí |
| `precioDesdeMoto` | `number \| null` | precio de **moto**: misma regla que `precioDesde`. `null` = "Consultá" (nunca se cae al de auto) | sí | sí |
| `categoria` | `string \| null` | grupo para el panel ("Lavado", "Interior", "Pulido", "Protección", "Pre venta", "Motos"): una línea, hasta 40 caracteres, con trim; `""` o `null` = sin categoría. Error en `fields.categoria` | sí | sí |
| `vehiculos` | `("auto" \| "suv" \| "pickup" \| "moto")[]` | para qué vehículos se ofrece: de 1 a 4, sin repetidos, siempre en orden auto, suv, pickup, moto. En crear, por defecto los cuatro; en editar, lo que no viene no cambia. Error en `fields.vehiculos` | sí | sí |
| `destacado` | `boolean` | puede haber varios en `true` (solo activos) | sí | sí |
| `activo` | `boolean` | | no | sí |
| `orden` | `integer` | menor primero (lo asigna el servidor) | no | sí |
| `updatedAt` | `string` (ISO 8601) | | no | sí |

Las respuestas traen **exactamente** estos campos (el público, solo los marcados "Público"; nunca `createdAt`). Higiene de texto igual que en los turnos: los controles bidireccionales se quitan y los de control (C0/C1) se rechazan.

### `GET /api/servicios` (público)

`200 { "servicios": ServicioPublico[] }`: solo los activos, por `orden` y después por `id`.

### `GET /api/admin/servicios` (requiere sesión; todos los roles)

`200 { "servicios": Servicio[] }`: todos (activos e inactivos), mismo orden.

### `POST /api/admin/servicios` (solo `admin` y `superadmin`)

Body estricto: `id`, `nombre`, `resumen`, `descripcion` obligatorios; `incluye` (default `[]`), `glosario` (default `[]`), `duracion`, `duracionSuv`, `duracionPickup` y `duracionMoto` (default `null` las cuatro), `precioDesde`, `precioDesdeSuv`, `precioDesdePickup` y `precioDesdeMoto` (default `null` los cuatro), `vehiculos` (default los cuatro), `categoria` (default `null`), `destacado` (default `false`), `activo` (default `true`). `orden` no se manda (`400`): queda al final. Si viene `destacado: true`, no desmarca a los demás (con `activo: false` a la vez, `400` en `fields.destacado`). `201 { "servicio": Servicio }`. Errores: `400 VALIDATION_ERROR` con `fields` (en las listas la clave lleva la posición: `incluye.1`, `glosario.0.termino`), `409 SERVICIO_EXISTE`, `403 FORBIDDEN` para `empleado` (*"Con tu rol solo podés ver el catálogo de servicios."*).

### `PATCH /api/admin/servicios/:id` (solo `admin` y `superadmin`)

Body estricto con al menos uno de: `nombre`, `resumen`, `descripcion`, `incluye`, `glosario`, `duracion`, `duracionSuv`, `duracionPickup`, `duracionMoto`, `precioDesde`, `precioDesdeSuv`, `precioDesdePickup`, `precioDesdeMoto`, `vehiculos`, `categoria`, `destacado`, `activo` (mismas reglas; `null` en cualquiera de las cuatro duraciones, de los cuatro precios o en la categoría lo borra; lo que no viene no cambia). `activo: false` también desmarca el destacado; `destacado: true` sobre un servicio que queda inactivo (ya lo estaba o se desactiva en el mismo body) da `400` en `fields.destacado` (*"No se puede destacar un servicio inactivo. Activalo primero."*). El `id` no se puede cambiar: si viene en el body, `400`. `200 { "servicio": Servicio }`. Errores: `404 NOT_FOUND` (no existe, o el id no tiene formato de slug), `400` (campo desconocido, tipo inválido o body vacío), `403 FORBIDDEN` para `empleado`.

### `PUT /api/admin/servicios/orden` (solo `admin` y `superadmin`)

Body estricto `{ "ids": string[] }` con **todos** los ids del catálogo (activos e inactivos), sin repetir, en el orden nuevo. Se guarda `orden = posición × 10` (10, 20, 30...) en una transacción. `200 { "servicios": Servicio[] }` (el catálogo completo, ya ordenado). `400 VALIDATION_ERROR` con `fields.ids` si faltan, sobran o se repiten ids; `403 FORBIDDEN` para `empleado`. Pasa por el mismo control CSRF que `POST`/`PATCH`/`DELETE` (`Origin` + `Content-Type`).

### Gastos, metas mensuales y datos del taller (objetivo 10, M1)

Contrato: `reportes/2026-10-27_17_finanzas-inventario-documentos.md`. **Todo es solo para `admin` y `superadmin`: el empleado recibe `403` en cada endpoint (antes de validar el body) y nunca ve gastos, ganancia ni metas.** Errores, CSRF y `fields` como el resto de la API.

#### `GET /api/admin/gastos?desde=&hasta=&categoria=&q=&limit=&offset=`

`200 { "gastos": Gasto[], "total": N, "suma": N }`. `Gasto` = `{ id, fecha: "YYYY-MM-DD", categoria, descripcion, monto, proveedor: string|null, origen: "manual"|"inventario", creadoPor: { id, nombre }|null, createdAt, updatedAt }`. Categorías: `insumos`, `herramientas`, `alquiler`, `servicios`, `sueldos`, `publicidad`, `mantenimiento`, `impuestos`, `otros`. Sin `desde` ni `hasta`: el **mes actual** (hora de La Rioja); con uno solo, el otro extremo queda abierto; `hasta` anterior a `desde` es `400 fields.hasta`. `total` y `suma` (pesos) son de **todo el filtro**, no de la página. Orden: fecha descendente. `limit` 1 a 100 (50), `offset` >= 0. `q` (2 a 80 caracteres) busca en descripción y proveedor sin distinguir mayúsculas ni acentos (`buddys.texto_busqueda`; la ñ se conserva) y los comodines `%`, `_` y `\` se buscan como texto.

#### `POST /api/admin/gastos` `{ fecha, categoria, descripcion, monto, proveedor? }` -> `201 { "gasto" }`

`descripcion` 1 a 120 caracteres, `proveedor` hasta 80 o `null` (una línea, sin caracteres de control; los bidireccionales se quitan), `monto` entero de 1 a 99.999.999. **La fecha no puede ser futura** (`400 fields.fecha`, según el "hoy" de La Rioja). Campos de más: `400`.

#### `PATCH /api/admin/gastos/:id` y `DELETE /api/admin/gastos/:id`

PATCH acepta cualquiera de esos campos (al menos uno; `proveedor: null` lo borra) -> `200 { "gasto" }`; DELETE -> `204`. `404` si no existe (o el id no es un UUID). Un gasto con `origen: "inventario"` (lo crea una compra de inventario) **no se edita ni se borra desde acá**: `409` con código `GASTO_DE_INVENTARIO` y el mensaje "Este gasto viene de una compra de inventario: corregilo desde Inventario."

**Para el inventario (M2):** `registrarGastoDeInventario(tx, { fecha, descripcion, monto, proveedor?, creadoPor? })` en `src/services/gastos.ts` crea el gasto (`categoria: "insumos"`, `origen: "inventario"`) **dentro de la transacción de quien la llama** (`tx` es el cliente de `sql.transaction(async (tx) => ...)`) y devuelve el `Gasto` (su `id` va al movimiento de stock). Si algo después falla, el gasto se revierte con el resto. Los valores tienen que respetar los topes de la tabla (si no, la base rechaza y se revierte todo).

#### `GET /api/admin/metas/hoy`

La meta de lavados de **hoy** del equipo, para el aviso que sale al abrir el panel (contrato
`reportes/2026-11-19_09_meta-de-hoy.md`). La ven los **tres roles** (permiso `metas.hoy`): solo cantidades, nunca pesos.
Va antes del permiso de metas del router (el resto de `/metas` sigue solo para admin y superadmin).

- `objetivo = ceil((trabajosObjetivo del mes − lavados completados hasta ayer) / días de atención que quedan contando hoy)`.
  Se calcula al empezar el día: lo de hoy suma a `hechos`, no corre el objetivo.
- Mes ya cumplido al empezar el día: `objetivo: 0, mesCumplido: true`.
- Sin meta de lavados en el mes, o hoy cerrado: `lavados: null`.

```json
{ "fecha": "2026-11-19", "lavados": { "hechos": 12, "objetivo": 20, "mesCumplido": false } }
```

#### `GET /api/admin/metas/actual`

`200 { "mes": "2026-10", "meta": { ingresosObjetivo, trabajosObjetivo } | null, "progreso": { ingresos, trabajos, porcentajeIngresos, porcentajeTrabajos, diasDeAtencionTranscurridos, diasDeAtencionRestantes, diasDeAtencionTotales, proyeccionIngresos, necesarioPorDia, estado } }`. El mes y "hoy" son los de La Rioja. Ingresos y trabajos del mes: los de las estadísticas (turnos completados por fecha de agenda). **Días de atención** = días del mes en que el taller atiende según el horario semanal y los días especiales (`DisponibilidadService.cupos`): domingos y feriados cerrados no cuentan, un día especial abierto sí; **hoy cuenta como transcurrido**. `proyeccionIngresos` = ingresos / transcurridos x totales (redondeado; `null` sin transcurridos o sin meta). `necesarioPorDia` = (objetivo de ingresos - ingresos) / restantes, redondeado (`0` si ya se cumplió; `null` sin restantes, sin objetivo de ingresos o sin meta). `estado`: `sin-meta`; `cumplida` (todos los objetivos fijados alcanzados); si no, con `esperado = objetivo x transcurridos / totales`: `adelantado` (>= 110 %), `en-ritmo` (90 a 110 %), `atrasado` (< 90 %); con dos objetivos se mira el más atrasado; sin días transcurridos (o mes sin días de atención) es `en-ritmo`. Los porcentajes son `null` si ese objetivo no está fijado (y pueden pasar de 1).

#### `GET /api/admin/metas?anio=YYYY`, `PUT /api/admin/metas/:mes`, `DELETE /api/admin/metas/:mes`

- `GET` -> `200 { "metas": [{ mes, ingresosObjetivo, trabajosObjetivo, ingresos, trabajos, cumplida }] }` solo de los meses del año con meta, por mes (sin `anio`, el actual).
- `PUT` (`:mes` = `YYYY-MM`, de 12 meses atrás a 12 adelante; si no, `400 fields.mes`) `{ ingresosObjetivo?: int|null, trabajosObjetivo?: int|null }` (ingresos 1 a 999.999.999, trabajos 1 a 9.999) se **mezcla con lo guardado** (lo que no viene se conserva, `null` lo vacía); si después de mezclar no queda ningún objetivo: `400` (`fields.ingresosObjetivo` y `fields.trabajosObjetivo`). -> `200 { "meta": { mes, ingresosObjetivo, trabajosObjetivo } }`.
- `DELETE` -> `204`; `404` si ese mes no tenía meta. Un `:mes` mal escrito es `400 fields.mes`.

#### `GET /api/admin/taller` y `PUT /api/admin/taller`

`200 { "taller": { nombre, telefono, direccion, instagram, cuit, leyendaPdf } }` (los cinco últimos pueden ser `null`). `PUT` **reemplaza** los seis campos (`nombre` obligatorio, 1 a 80; los otros aceptan `null`, texto en blanco o no mandarse para vaciarlos): `telefono` solo dígitos con código de país (8 a 15, ej. `5493804781737`), `instagram` sin `@` (letras, números, `.`, `_`; hasta 30), `cuit` 11 dígitos o `NN-NNNNNNNN-N` (no se verifica el dígito verificador), `direccion` hasta 160, `leyendaPdf` hasta 300 (una línea). Sembrado con el nombre, teléfono y dirección de la web. **Para el PDF:** `TallerService.obtener()` (`src/services/taller.ts`) devuelve esos datos.

## Mejoras del panel (contrato 2026-11-15)

Contrato completo (formas JSON, errores y permisos): `reportes/2026-11-15_03_contrato-mejoras.md`. Respuestas reales: claves nuevas de `test/fixtures/respuestas-api.json` (`lavadoCreaEnEspera`, `cajaCierra`, `fotoSubida`, ...). El objeto **Turno** suma `etapa`, `etapaDesde`, `descuento`, `descuentoMotivo`, `sena`, `saldo` y `whatsappListo` (para el empleado, los importes en `null`).

```bash
# 9. Etapas: registrar un auto que espera, moverlo a "listo" y ver los que siguen en el taller
curl -b cookies.txt -H "Origin: $O" -H 'Content-Type: application/json' -X POST $API/api/admin/lavados \
  -d '{"servicioId":"lavado-basico","vehiculoTipo":"auto","etapa":"espera","telefono":"3804123456","vehiculoModelo":"Gol AB123CD"}'
curl -b cookies.txt -H "Origin: $O" -H 'Content-Type: application/json' -X PATCH $API/api/admin/lavados/<id>/etapa -d '{"etapa":"listo"}'
# -> 200 { "lavado": { ..., "etapa": "listo", "whatsappListo": "https://wa.me/5493804123456?text=Hola!%20Tu%20Gol..." } }
curl -b cookies.txt -H "Origin: $O" $API/api/admin/lavados/en-curso      # -> { fecha, lavados, resumen: { espera, lavando, listo } }

# 12. Descuento (monto = lo cobrado; descuento = lo rebajado, con motivo). Admin y superadmin.
curl ... -X POST $API/api/admin/lavados -d '{"servicioId":"lavado-basico","vehiculoTipo":"auto","monto":8000,"descuento":2000,"descuentoMotivo":"Cliente frecuente"}'

# 8. Turno con seña (admin y superadmin). Al completarlo, monto = total y la respuesta trae el saldo.
curl ... -X POST $API/api/admin/turnos -d '{"nombre":"Juan","telefono":"3804123456","vehiculoTipo":"auto","servicioIds":["pulido"],"fecha":"2026-11-20","franja":"manana","sena":{"monto":20000,"formaPago":"transferencia"}}'
curl ... -X PUT $API/api/admin/turnos/<id>/sena -d '{"monto":25000,"formaPago":"efectivo"}'    # DELETE .../sena la quita

# 6 y 14. Historial por teléfono o patente (con tarjeta de sellos), inactivos y configuración
curl -b cookies.txt -H "Origin: $O" "$API/api/admin/clientes/historial?patente=AB123CD"
curl -b cookies.txt -H "Origin: $O" "$API/api/admin/clientes/inactivos?dias=30"
curl ... -X PUT $API/api/admin/fidelizacion -d '{"sellosCada":10,"premio":"gratis","inactivosDias":30}'   # solo superadmin

# 10. Gastos fijos (ver: admin y superadmin; cargar: superadmin)
curl ... -X POST $API/api/admin/gastos-fijos -d '{"concepto":"Sueldo de Beto","monto":300000,"categoria":"sueldos","perfilId":"<uuid>"}'
curl ... -X PATCH $API/api/admin/gastos-fijos/<id> -d '{"activo":false}'   # deja de contar después de este mes

# 11. Caja: lo esperado del día, cerrar con el arqueo, listado (corregir o reabrir: superadmin)
curl -b cookies.txt -H "Origin: $O" "$API/api/admin/caja?fecha=2026-11-15"
curl ... -X PUT $API/api/admin/caja/2026-11-15 -d '{"contado":{"efectivo":24500,"transferencia":5000},"nota":"Faltan 500"}'
curl -b cookies.txt -H "Origin: $O" "$API/api/admin/caja/cierres?desde=2026-11-01&hasta=2026-11-30"

# 13. Fotos: 1) pedir la URL de subida (la foto nace "pendiente"), 2) subir el archivo directo a Storage, 3) confirmar
curl ... -X POST $API/api/admin/lavados/<id>/fotos -d '{"tipo":"antes","contentType":"image/webp","tamano":523000}'
curl -X PUT -H 'Content-Type: image/webp' --data-binary @foto.webp '<subida.url>'
curl ... -X POST $API/api/admin/lavados/<id>/fotos/<fotoId>/confirmar     # -> { foto: { ..., estado: "lista" } }
curl -b cookies.txt -H "Origin: $O" $API/api/admin/lavados/<id>/fotos

# 15. Receta de insumos de un servicio (se descuentan solos al completar)
curl ... -X PUT $API/api/admin/servicios/lavado-basico/insumos -d '{"insumos":[{"insumoId":"<uuid>","cantidad":0.25,"cantidadSuv":0.4}]}'

# 16. CSV para Excel (admin y superadmin)
curl -b cookies.txt -H "Origin: $O" -o planilla.csv "$API/api/admin/exportar/planilla.csv?desde=2026-11-01&hasta=2026-11-30"

# 26. Error del panel (con sesión; sin sesión: POST /api/errores-cliente) -> 204
curl ... -X POST $API/api/admin/errores-cliente -d '{"mensaje":"TypeError: x","url":"/admin/planilla","userAgent":"Mozilla/5.0","version":"1.0.0"}'
```

Notas de diseño:

- **Etapas** (solo lavados de mostrador; los ya registrados y los que se registran sin `etapa` quedan `entregado`). El link `whatsappListo` lo arma `domain/mensajes.ts` con el `telefonoWhatsapp` ya normalizado; `null` sin teléfono. La misma etapa no escribe nada.
- **Descuentos**: informativos (`monto` ya es lo cobrado), suman en `estadisticas.periodo.descuentos`. **Combos**: no hay entidad nueva; se arman como servicios de categoría `"Combos"` en el catálogo (con su precio).
- **Seña**: entra en la caja el día que se cobró; el saldo (`monto - seña`), el día del turno. En estadísticas cuenta el total del trabajo en la fecha del turno. Si el turno se cancela, la seña queda registrada hasta que se la quita.
- **Gastos fijos**: cada ítem cuenta su monto entero el día 1 de cada mes de vigencia, en `gastos`, `ganancia`, la serie y `gastosPorCategoria` (y aparte en `periodo.gastosFijos`). No se crean filas en `gastos`: el listado de gastos sueltos no cambia y nada se duplica (los sueldos van solo acá). Editar el `monto` cambia todos los meses: para un aumento, cerrar el ítem y crear otro.
- **Caja**: lo esperado = lavados de mostrador del día + saldos de turnos completados ese día + señas cobradas ese día, por forma de pago (lo cobrado sin forma va en `sinIndicar`). Al cerrar se guarda la foto; `cambiosDespues` avisa si después se tocó algo. El alta es `INSERT ... ON CONFLICT DO NOTHING`: de dos cierres simultáneos del mismo día entra uno y el otro es `409` (solo el superadmin, al corregir, reemplaza el cierre).
- **Links de WhatsApp**: el nombre entra en el saludo solo si es una palabra de letras (sin `:`, `/`, `.` ni dígitos) y el modelo se recorta a 30 caracteres de letras, números, espacios y guiones (`domain/mensajes.ts`); en inactivos, nombre y vehículo salen solo de trabajos completados.
- **Fotos**: el backend firma con `SUPABASE_SECRET_KEY` (solo en la cabecera `apikey`, nunca sale del servidor ni se loguea). Flujo: pedir la URL (la foto nace `pendiente`) → `PUT` del archivo a Storage → `POST .../fotos/:fotoId/confirmar` (el backend verifica con un HEAD a Storage que el objeto exista, sea del tipo pedido y pese hasta 1,5 MB, y la pasa a `lista`). Solo se listan las `lista`; las pendientes cuentan para el tope de 6. Pedir URLs tiene rate limit propio (20 cada 10 minutos por usuario). La URL de subida vale 2 horas (lo fija Supabase) aunque se borre la foto: por eso todo borrado (también en cascada) anota el objeto en `fotos_a_borrar` y la **conciliación** (`FotoService.conciliar`, al arrancar y cada hora con un timer `unref`) borra los objetos anotados cuando vence su token, las pendientes vencidas y los objetos del bucket sin fila de más de 2 horas. La de lectura vence a los 5 minutos. El bucket es privado: no hay URLs públicas.
- **Insumos**: la función `buddys.sincronizar_insumos_turno` deja los movimientos automáticos del turno en lo que pide su receta (salida al completar, devolución si sale de completado, cambia de servicios o se borra). Nunca deja el stock negativo ni frena el lavado. Poco stock: lo existente (`stockMinimo`, `bajoStock`, `GET /api/admin/insumos?bajoStock=true`).
- **CSV**: UTF-8 con BOM, `;`, coma decimal, `\r\n`; los textos que empiezan con `= + - @` llevan un `'` (anti inyección de fórmulas).
- **Errores del panel**: no se guardan en la base; una línea `WARN Error del panel ...` sin emails, tokens, ids ni números largos, con solo el path de la URL y el stack recortado a 3 renglones. Rate limit: 30 cada 10 minutos por usuario; 5 cada 15 minutos por IP sin sesión.

## Avisos por WhatsApp

Cuando entra una solicitud de turno, el dueño recibe un WhatsApp con el servicio, la fecha, la franja, el cliente, su teléfono, un link `wa.me` para escribirle (si el teléfono es interpretable), el comentario (máx. 200 caracteres) y, si existe `PUBLIC_URL`, el link al panel. El aviso se manda **después** de guardar el turno y **sin esperar**: si el proveedor falla o tarda (timeout de 5 s), el cliente igual recibe su `201`. Los turnos descartados por honeypot no avisan. En el log solo queda `Aviso de WhatsApp enviado id=<id>` o `Aviso de WhatsApp falló id=<id> (status X)`; nunca el texto, la apikey, el token ni la URL.

**Privacidad:** con un proveedor activo, los datos del cliente (nombre, teléfono, vehículo, comentario) salen del sistema hacia ese proveedor (CallMeBot o Meta). Con `WHATSAPP_PROVIDER=none` no sale nada; al arrancar se loguea que los avisos están desactivados.

### Opción 1: CallMeBot (gratis, no oficial)

1. Desde el WhatsApp del número que va a recibir los avisos (3804781737), agregá a tus contactos el número del bot que indica https://www.callmebot.com/blog/free-api-whatsapp-messages/ (cambia con el tiempo; si dice que está lleno, reintentá más tarde).
2. Mandale por WhatsApp a ese contacto exactamente: `I allow callmebot to send me messages`.
3. El bot responde con tu **apikey** (si no llega en 2 minutos, reintentá pasadas 24 horas).
4. En `backend/.env` completá `CALLMEBOT_APIKEY=<la apikey>` (ya están `WHATSAPP_PROVIDER=callmebot` y `WHATSAPP_OWNER_PHONE=5493804781737`). En producción, definí esas tres variables en el entorno.
5. Reiniciá el servidor: debe loguear `Avisos por WhatsApp activados (callmebot)`.

Es un servicio de terceros, gratuito y pensado para uso personal: sin garantías de disponibilidad ni cupos publicados, y puede cambiar o cortarse.

### Opción 2: WhatsApp Cloud API (oficial, de Meta)

Para cuando el negocio crezca. Requiere una cuenta de Meta Business, un número registrado en WhatsApp Business Platform y una **plantilla aprobada** (categoría utilidad, idioma `es_AR` o `es`) con **una sola variable** en el cuerpo, por ejemplo: `Nuevo turno: {{1}}`. El backend manda el resumen en esa variable, en una línea y con las partes separadas por ` | ` (Meta no admite saltos de línea en variables). Variables:

```
WHATSAPP_PROVIDER=cloud
WHATSAPP_OWNER_PHONE=5493804781737
WHATSAPP_CLOUD_TOKEN=<token permanente del usuario del sistema>
WHATSAPP_CLOUD_PHONE_NUMBER_ID=<Phone number ID>
WHATSAPP_CLOUD_TEMPLATE=nuevo_turno
WHATSAPP_CLOUD_LANGUAGE=es_AR
```

Se envía `POST https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/messages` con el token como `Bearer`. Mensajes iniciados por el negocio fuera de la ventana de 24 h solo pueden ser plantillas, y Meta los cobra según su tarifa vigente.

### Opción 3: Telegram (gratis, oficial, sin riesgo de baneo)

Respaldo si CallMeBot no tiene plazas y no se quiere pagar la Cloud API: el mismo aviso llega a un chat de Telegram del dueño, al instante y sin costo. Se activa con `WHATSAPP_PROVIDER=telegram`.

1. En Telegram, buscá `@BotFather` (el oficial, con tilde azul), mandale `/newbot`, elegí un nombre y un usuario que termine en `bot`. Te responde con el **token** (`123456789:AAH...`). Es una clave: no la compartas.
2. Abrí el bot nuevo (el link `t.me/<usuario>` que te dio BotFather) y mandale `/start` y cualquier mensaje (ej. `hola`). Sin esto el bot no puede escribirte.
3. En el navegador abrí `https://api.telegram.org/bot<TOKEN>/getUpdates` (reemplazando `<TOKEN>`). Buscá `"chat":{"id":123456789` : ese número es el **chat id**.
4. En `backend/.env` poné `WHATSAPP_PROVIDER=telegram`, `TELEGRAM_BOT_TOKEN=<token>` y `TELEGRAM_CHAT_ID=<chat id>`.
5. Reiniciá el servidor: debe loguear `Avisos de turnos activados (telegram)`.

El token va en la URL de la API de Telegram, por eso nunca se loguea. Los datos del cliente salen hacia Telegram.

### Comparación (octubre 2026, para 10-50 avisos por mes)

| Opción | Costo | Alta | Riesgo |
|---|---|---|---|
| CallMeBot | Gratis | Fácil, pero hoy sin plazas | Servicio no oficial de terceros, sin garantías ni límites publicados |
| WhatsApp Cloud API (Meta) | Plantilla utility en Argentina: unos US$0,026 por aviso (cifra de guías, verificar en la tarifa de Meta), o sea alrededor de US$1 por mes. El número de prueba es gratis pero solo permite hasta 5 destinatarios y plantillas fijas | Media/alta: cuenta Meta Business, número propio, plantilla aprobada y token de System User | Oficial, sin baneo |
| Twilio WhatsApp | Tarifa de Meta + US$0,005 por mensaje; el sandbox cobra igual y los destinatarios deben unirse otra vez cada pocos días | Media | Oficial |
| Green-API / Whapi.cloud / UltraMsg (vinculan tu WhatsApp por QR) | Plan gratis muy limitado (pocos chats); pago desde US$8-12 (Green-API) o US$29 (Whapi) por mes | Fácil (QR) | No oficial: riesgo de baneo del número |
| Baileys / whatsapp-web.js (propio) | Gratis más un servidor siempre encendido | Técnica, con sesión persistente | No oficial: riesgo de baneo; conviene un segundo número |
| Telegram (bot) | Gratis | Fácil (5 pasos) | Oficial, sin baneo; el aviso llega a Telegram y no a WhatsApp |
| Email | Gratis con SMTP | Pide dependencia o cuenta SMTP | Puede caer en spam |

## Recordatorios

El día anterior a un turno **confirmado**, el cliente recibe un recordatorio automático (`src/services/recordatorios.ts`, canales en `src/notifications/recordatorio.ts`).

- **Qué turnos**: `estado = 'confirmado'`, fecha de agenda = **mañana** (hora de La Rioja) y `recordatorio_enviado_at` en null. Una sola vez por turno.
- **Canales** (independientes de `WHATSAPP_PROVIDER`, que es el aviso al dueño):
  - **Email con Resend**, si el turno tiene email y están `RESEND_API_KEY` + `RECORDATORIO_EMAIL_DESDE`. `POST https://api.resend.com/emails` con `fetch` (sin SDK), texto y HTML (escapado), y `Idempotency-Key: recordatorio-<id>-<fecha>` (Resend no repite el envío con la misma clave durante 24 h). Si hay `PUBLIC_URL`, incluye el enlace de seguimiento.
  - **WhatsApp Cloud API**, si el turno tiene `telefono_whatsapp` y están `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID` y `WHATSAPP_CLOUD_TEMPLATE_RECORDATORIO`. Plantilla **aprobada por Meta** (categoría utilidad, `es_AR` o `es`) con **tres** variables en el cuerpo: `{{1}}` servicio, `{{2}}` día (`sábado 24/10`), `{{3}}` franja (`mañana` / `tarde`). Ejemplo: *"Hola, te recordamos tu turno de {{1}} en Buddys Wash Detail mañana {{2}} por la {{3}}. Si no podés venir, avisanos."*
  - Sin ningún canal configurado no se manda nada y no es un error: el log dice `Recordatorios desactivados` y la respuesta cuenta los turnos en `sinCanal`.
- **Marca**: un turno se marca solo si al menos un canal lo entregó (si el email llegó y el WhatsApp falló, se marca igual: reintentar duplicaría el email). Si todos sus envíos fallan, queda sin marcar y se reintenta en la próxima corrida. Reprogramar a otra fecha o franja limpia la marca. Marcar no cambia `updated_at`.
- **Idempotente**: correr el cron dos veces no manda dos veces. Dos llamadas simultáneas en el mismo proceso comparten la corrida.
- **Privacidad**: el log y la respuesta solo tienen cantidades (`Recordatorios: enviados=N fallidos=M sinCanal=K`; un fallo: `Recordatorio falló (email, status 422)`), nunca ids, emails ni teléfonos. El email o el teléfono del cliente y los datos del turno viajan a Resend o a Meta.

### Programar el cron (después de publicar la web)

El backend no tiene un reloj propio: algo tiene que llamar una vez por día (por ejemplo a las **18:00 de La Rioja = 21:00 UTC**) a:

```bash
curl -X POST https://buddys.com.ar/api/internal/recordatorios \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json"
# -> {"enviados":3,"fallidos":0,"sinCanal":1}
```

Generá el secreto con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` y ponelo como `CRON_SECRET` en el entorno del servidor.

**Opción A: Supabase (pg_cron + pg_net).** En el panel: *Database > Extensions*, activá `pg_cron` y `pg_net`. Guardá el secreto en Vault y programá el job desde el **SQL Editor** (pg_cron usa **UTC**):

```sql
select vault.create_secret('<el CRON_SECRET>', 'buddys_cron_secret');

select cron.schedule(
  'buddys-recordatorios',
  '0 21 * * *', -- todos los días a las 21:00 UTC = 18:00 en La Rioja
  $$
  select net.http_post(
    url := 'https://buddys.com.ar/api/internal/recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'buddys_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

Para ver las corridas: `select * from cron.job_run_details order by start_time desc limit 10;` y las respuestas en `net._http_response`. Para quitarlo: `select cron.unschedule('buddys-recordatorios');`. Ojo: `pg_net` guarda el pedido (con la cabecera) en `net.http_request_queue` mientras espera, así que cualquier rol con login que pueda leer esa tabla ve el secreto unos segundos: `buddys_app` no tiene acceso a `net`. No pongas el secreto literal en el `cron.schedule` (quedaría en `cron.job`).

**Opción B: el cron del hosting.** Un cron del sistema (`crontab`: `0 21 * * * curl -fsS -X POST ...` con el secreto en un archivo legible solo por ese usuario), o el "cron job" / "scheduled task" del PaaS (Render, Railway, Fly...) con el mismo `curl` y el secreto como variable de entorno de la plataforma. Mirá en qué zona horaria corre (casi siempre UTC).

Si el backend tiene varias instancias, el cron se programa **una sola vez** (no por instancia).

### Lo que necesita el dueño para activarlos

- **Email**: cuenta de Resend con el dominio verificado (registros DNS SPF/DKIM), `RESEND_API_KEY` y `RECORDATORIO_EMAIL_DESDE`.
- **WhatsApp**: cuenta de WhatsApp Business en Meta (la misma de la Opción 2 de avisos), número registrado, token permanente de System User y la plantilla de recordatorio aprobada (`WHATSAPP_CLOUD_TEMPLATE_RECORDATORIO`). Meta cobra cada plantilla enviada.
- **Cron**: `CRON_SECRET` en el servidor y el job (opción A o B), cuando la web esté publicada.

## Avisos push

Cuando entra un turno nuevo por el formulario público, las personas del panel que activaron los avisos en su celular reciben una notificación (contrato: `reportes/2026-10-26_13_panel-pulido-y-app.md`, bloque A). Van **además** de Telegram/CallMeBot/Cloud, no en lugar de.

- **Qué dice**: `tipo: "turno"`, título "Turno nuevo", cuerpo `<servicio> · <día corto> · <franja>` (ej.: "Lavado Premium · jue 29/10 · Mañana"), `pendientes` (cantidad de turnos pendientes, para el globito del ícono) y `url: "/planilla"` (la Planilla del panel). El de stock bajo lleva `tipo: "stock"`. El service worker usa `tipo` (si viene) para el ícono y para agrupar. **Nunca** nombre, teléfono, email, vehículo ni comentario.
- **Quién los recibe**: cada dispositivo suscripto (`POST /api/admin/push/suscripciones`) de una persona **activa**. Si se desactiva al usuario, deja de recibirlos en el acto (el envío filtra por `perfiles.activo`); si se lo elimina, sus dispositivos se borran en cascada. Cualquier rol puede suscribirse.
- **Envío** (`src/services/push.ts`, cliente en `src/notifications/push.ts` con la librería `web-push`): después de guardar el turno, sin esperar (nunca demora ni rompe la respuesta al cliente). Todos los dispositivos en paralelo, con tope de 5 s cada uno. Un `404`/`410` del servicio de push borra esa suscripción; cualquier otro error solo se cuenta. El honeypot y los pedidos rechazados no disparan avisos. El cliente de envío se inyecta (`createApp({ pushSender })`): los tests nunca tocan la red.
- **Seguridad**: el endpoint se valida contra una lista de servicios de push **al guardar y otra vez antes de enviar** (anti SSRF); `web-push` no sigue redirecciones. Los logs llevan solo cantidades (`Aviso push: enviados=2 caducados=1 fallidos=0`), nunca endpoints, claves de la suscripción ni VAPID. `GET /api/admin/push/estado` publica solo la clave pública. La clave privada VAPID no sale del servidor.
- **Apagado sin errores**: sin las tres variables VAPID no se manda nada, `estado` dice `disponible: false` y `POST /suscripciones` responde `404`.

### Avisos al encargado (contrato 2026-11-15, función 7)

Van solo a los dispositivos de **admin y superadmin** activos (capacidad `push.equipo`), nunca al empleado, sin datos del cliente ni importes (`src/services/avisos.ts`). Sin claves VAPID no hacen nada (ni consultan la base). Nunca demoran ni rompen la respuesta.

- **Lavado sin monto** — decisión: **al registrarlo** (no a fin del día: no hace falta un cron y el encargado se entera con el cliente todavía en el taller). `POST /api/admin/lavados` sin `monto` (no en un reintento del mismo `idLocal`) manda "Lavado sin monto · Se registró un lavado sin monto: completalo desde la planilla." (`url: /admin/lavados`) a todos menos a quien lo registró.
- **Meta del mes cumplida**: después de registrar un lavado o completar/cobrar un turno, si la meta del mes en curso queda cumplida, "¡Meta cumplida! · Llegaron a la meta de <mes>." (`url: /admin/metas`). **Una sola vez por mes** (`metas_mensuales.cumplida_avisada_at`, marcada con un UPDATE condicional: si dos lavados llegan juntos avisa uno); si se cambia la meta, se puede volver a avisar.

### Activarlos (lo que necesita el dueño)

1. En `backend/`: `npm run vapid:dev` (o `npm run vapid` después de `npm run build`). Imprime tres líneas; no escribe archivos ni las registra:

   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:tu-email@ejemplo.com
   ```

2. Pegalas en `backend/.env` (y en el entorno del servidor en producción), cambiá `VAPID_SUBJECT` por tu email (`mailto:`) o la URL del sitio (`https://`) y reiniciá. Al arrancar el log dice `Avisos push activados`.
3. Aplicar la migración `20261026120000_push_suscripciones` en Supabase (ver [Migraciones](#migraciones-postgres)).
4. En el celular: abrir el panel en `https` (o `localhost`), instalar la app y activar "Avisarme de turnos nuevos". En iPhone los avisos solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o más).

Si se vuelve a correr `npm run vapid` y se cambia el par, los dispositivos ya suscriptos dejan de recibir hasta que se suscriban otra vez (la suscripción queda atada a la clave pública).

## Operación

### Despliegue

`render.yaml` (raíz) crea un solo Web Service, `buddys` (`npm start` → `node dist/index.js`), detrás del HTTPS de
Render, con `TURNOS_ONLINE=false`. El build compila la API y el panel; con `PANEL_DIR=../frontend/dist` el mismo
proceso sirve **la API en `/api` y el panel en el resto de las rutas** (`src/middleware/panel.ts`).

```
navegador --HTTPS--> https://<nombre>.onrender.com
                       |-- /api/*  -> esta API
                       |-- resto   -> el panel (frontend/dist; rutas del panel -> index.html)
                       +--TLS--> Postgres en Supabase (Session pooler, esquema buddys)
                       +--HTTPS--> Supabase Auth (/auth/v1: token, logout, JWKS)
```

Por qué un solo origen: el frontend (`frontend/src/api/client.ts`) llama a **`/api` relativo** con
`credentials: 'same-origin'` y las cookies de sesión son `SameSite=Strict`. En desarrollo lo resuelve el proxy de Vite
(`5173 -> 4000`); en producción, este mismo proceso. `FRONTEND_ORIGIN` y `PUBLIC_URL` llevan la dirección pública
exacta del servicio. Un dominio propio se suma en Render (Settings > Custom Domains) y se agrega a `FRONTEND_ORIGIN`.

Cabeceras del panel: su propia CSP (`script-src`, `style-src`, `worker-src` y `manifest-src` en `'self'`, imágenes y
subidas también a Supabase Storage, sin `'unsafe-inline'`), `assets/` con caché de un año (`immutable`, nombres con
hash) y `index.html`, `sw.js` y el manifest sin caché, para que la PWA se actualice. Lo que no es del panel sigue con
la CSP que bloquea todo y el `404` JSON.

#### Publicar en Render (primera vez)

1. En Render: **New > Blueprint**, elegir el repo `Buddys` y la rama `main`.
2. Cargar las variables `sync: false`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` y las tres `VAPID_*` (las mismas de `backend/.env`).
3. `FRONTEND_ORIGIN` y `PUBLIC_URL` llevan la dirección que muestra Render arriba del servicio
   (`https://<nombre>.onrender.com`, sin barra final). **Son obligatorias en producción**: sin `FRONTEND_ORIGIN` el
   proceso no arranca ("Configuración inválida"), y con una dirección distinta el login y todo lo que guarda da `403`.
   Si el primer deploy falló por eso, cargarlas y "Save, rebuild and deploy".
4. Probar `https://<nombre>.onrender.com/api/health` y entrar al panel.

En el plan gratis el servicio se duerme a los 15 minutos sin uso: antes de mostrarlo, abrirlo un minuto antes.

#### Datos de ejemplo (demo)

`supabase/demo/cargar.sql` carga ~75 días de lavados, turnos de los próximos días, gastos, insumos y la meta del mes,
a nombre de los perfiles existentes. Todo tiene un id que empieza con `de30000`. **`supabase/demo/borrar.sql` lo saca
entero** sin tocar los datos reales: correrlo antes de que el lavadero empiece a usar el sistema en serio. Se corren en
el SQL Editor de Supabase (proyecto Buddys), no con el rol `buddys_app` (no puede borrar movimientos de stock).

### Variables en producción

| Variable | Qué poner |
|---|---|
| `NODE_ENV` | `production`. |
| `FRONTEND_ORIGIN` | **Igual al origen público exacto** que ve el navegador, con esquema y sin barra final: `https://buddys.com.ar`. Si no coincide, los `POST/PATCH/DELETE` dan `403`. Si el sitio responde en `www` y sin `www`, listá los dos separados por coma. |
| `SUPABASE_URL` | `https://TU-PROYECTO.supabase.co`. |
| `SUPABASE_PUBLISHABLE_KEY` | La publishable key (`sb_publishable_...`). Nunca la secret key. |
| `SUPABASE_SECRET_KEY` | La secret key (`sb_secret_...`), para que el superadmin gestione usuarios desde el panel. **Secreto**: solo en el entorno del servidor, nunca en el repo ni en el frontend. |
| `HOST` | Con Caddy/nginx en la misma máquina dejá el default `127.0.0.1`. **En un PaaS o en Docker poné `0.0.0.0`**, si no la plataforma no llega al proceso. |
| `PORT` | El que indique la plataforma (muchos PaaS lo inyectan). |
| `TRUST_PROXY` | Con Caddy/nginx **en la misma máquina**: `loopback` (y `HOST=127.0.0.1`), así solo se cree el `X-Forwarded-For` que llega del proxy local. En un PaaS: `1` (el balanceador de la plataforma), siempre que el proceso no sea alcanzable sin pasar por él. Sin esto, el rate limit ve la IP del proxy y **todos los visitantes comparten el mismo cupo**; con un número y el puerto de Node expuesto a Internet, cualquiera puede conectarse directo, inventar su `X-Forwarded-For` y saltear el rate limit. |
| `DATABASE_URL` | La cadena del Session pooler con la contraseña, en el gestor de secretos de la plataforma (nunca en el repo). |
| `DATABASE_SSL_CA_FILE` | Ruta al certificado raíz de Supabase (obligatoria). |
| `TURNOS_ONLINE` | `false` (sistema interno). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Opcionales: avisos push al celular (`npm run vapid` genera el par). La privada es un secreto: solo en el entorno del servidor. |

### Límites conocidos

- **El rate limit vive en la memoria del proceso**: se reinicia con cada arranque y no se comparte entre instancias. Con Postgres la base ya admite varias réplicas del backend, pero cada una tendría su propio cupo de rate limit: para escalar horizontalmente hace falta un store compartido (Redis o la misma Postgres). Hoy una sola instancia sobra.
- Cada instancia abre hasta 5 conexiones (pool). El Session pooler de Supabase tiene un cupo de conexiones compartido por todo el proyecto (según el plan): no subas `max` sin mirarlo.
- La latencia a Supabase depende de la región (el proyecto está en AWS us-east-1): del orden de 150-250 ms por consulta desde Argentina, y un pedido hace una o dos. Para un formulario y un panel es aceptable; si se notara, conviene desplegar el backend cerca de la base.
- Las sesiones son de Supabase Auth: reiniciar el servidor **no** las cierra. Cada request a `/api/admin` hace una consulta más (perfil + sesión, en una sola query) y la verificación del token es local (el JWKS se cachea 10 min).
- **Todos los logins salen de la IP del servidor** hacia Supabase Auth, que tiene sus propios límites por IP. Para un taller sobra; si se notaran `429` en el login, revisá *Authentication > Rate Limits* en el panel de Supabase.

### Backup

Ver [Backups (Supabase)](#backups-supabase).

### Alta de usuarios en producción

Igual que en desarrollo: los usuarios se crean en el panel de Supabase y se activan desde el panel web (el primer superadmin, con la sentencia SQL). Ver [Alta de usuarios](#alta-de-usuarios-pasos-del-dueño). No hace falta ningún script ni acceso a la consola del servidor.

### Glosario

- **Booking** = turno / solicitud de turno. El dominio y la API están en español como el contrato (`turno`, `servicioId`, `franja`, `estado`...); el código técnico (clases, rutas internas, nombres de archivos de infraestructura) está en inglés.
- **Nombres en la base** (snake_case): las tablas técnicas en inglés como el código (`bookings`); las del panel en español (`roles`, `perfiles`); las columnas de negocio en español como el contrato (`nombre`, `telefono`, `vehiculo_tipo`, `fecha_preferida`, `franja`, `estado`) y las técnicas en inglés (`id`, `seq`, `created_at`, `updated_at`). `servicios` va en español porque es el catálogo del negocio y coincide con `domain/servicios.ts` y `servicioId`. `duracion_estimada`, `duracion_suv`, `duracion_pickup`, `duracion_estimada_moto`, `precio_desde`, `precio_desde_suv`, `precio_desde_pickup` y `precio_desde_moto` salen por la API como `duracion`, `duracionSuv`, `duracionPickup`, `duracionMoto`, `precioDesde`, `precioDesdeSuv`, `precioDesdePickup` y `precioDesdeMoto`. Los repositorios traducen a camelCase (`servicio_id` -> `servicioId`).
- **`buddys`** = esquema propio de la app en Postgres (no expuesto por la Data API de Supabase).
- **Honeypot** = campo trampa `website` que solo completan los bots.
- **Repositorio** = capa de acceso a datos detrás de una interfaz (`src/domain/`); la implementación es Postgres (`src/repositories/postgres/`).
- **Perfil** = fila de `buddys.perfiles`: rol y si el usuario de Supabase Auth puede entrar al panel.
- **BFF** (*backend for frontend*) = el backend media todo lo de Supabase; el navegador solo habla con `/api`.

## Seguridad

- **Contraseñas y sesiones**: las maneja **Supabase Auth** (el backend no guarda contraseñas). El backend verifica cada access token con `jose` contra el JWKS del proyecto con el algoritmo (**ES256**), emisor, audiencia y vencimiento **fijados**; exige `sub`/`session_id` UUID, `role = authenticated` y no anónimo. Los tokens viajan solo en cookies `HttpOnly; SameSite=Strict` (`Secure` en producción); el refresh token solo a `/api/auth`. Cada request comprueba en la base que la sesión siga en `auth.sessions` y que el perfil esté activo: **logout, desactivación y cambio de rol son inmediatos**.
- **Autorización**: por rol en el backend (`domain/permisos.ts`), no en la UI. Usuarios nuevos nacen inactivos.
- **CSRF**: `SameSite=Strict` + chequeo de `Origin` + `Content-Type: application/json` obligatorio en métodos que modifican.
- **Rate limits**: general por IP, 5 turnos / 15 min, logins fallidos (5 / 15 min por IP + email y 30 / 15 min por IP), 60 consultas de seguimiento / 15 min, 30 PDF / min, y por usuario 5 intentos de cambiar la propia contraseña / 15 min , 10 subidas de foto / 15 min y 60 lavados registrados o deshechos / min (sin contar los reintentos del mismo `idLocal`) (más los límites propios de Supabase Auth). La re-codificación de fotos corre de a 2 a la vez como mucho.
- **Endpoint interno de recordatorios**: `Bearer <CRON_SECRET>` comparado en tiempo constante (`timingSafeEqual` sobre los sha256, así tampoco depende del largo), secreto de al menos 32 caracteres; sin la variable, `404`. Pasa por el mismo control de `Origin` y `Content-Type` que el resto.
- **Seguimiento público**: solo campos sin datos personales, `404` igual para inexistente e inválido, UUID aleatorio (122 bits), rate limit propio y `noindex`.
- **Último lugar**: el alta pública bloquea la fecha con `pg_advisory_xact_lock` dentro de la transacción del `INSERT` (sin carreras). Con mucha contención, el `lock_timeout` de 5 s de `buddys_app` puede cortar una espera (`500`); para un taller no pasa.
- **Entrada**: zod estricto (rechaza campos desconocidos), body máximo de 10 kb, sin cuerpos comprimidos. SQL siempre parametrizado (`$1, $2...`), y una regla de ESLint prohíbe construir SQL con interpolación o concatenación en `query()` y `exec()`.
- **Cabeceras**: helmet (HSTS en producción, `nosniff`, `X-Frame-Options: DENY`...), `Permissions-Policy`, `Cache-Control: no-store` en la API. La API lleva `default-src 'none'; frame-ancestors 'none'`. Con `PANEL_DIR`, lo que entrega el panel lleva su propia CSP (`middleware/panel.ts`: todo en `'self'`, más Supabase en `img-src` y `connect-src`, sin `'unsafe-inline'`); lo demás fuera de `/api` es `404` JSON con la CSP de la API.
- **Textos de una línea** (nombres, categorías, notas, descripciones de gastos, motivos): además de los controles `Cc`, se rechazan los separadores de línea y de párrafo de Unicode (U+2028 y U+2029).
- **Datos personales**: nunca se escriben en los logs (una línea por request: método, ruta sin query, status y milisegundos; al crear un turno solo `id + servicio + fecha`; el aviso de WhatsApp solo `id` y status; login y gestión de usuarios solo ids de usuario, nunca emails ni tokens). Al borrar un turno, la fila queda en disco hasta que `autovacuum` reutiliza el espacio.
- **Base de datos (Postgres)**: esquemas `buddys` y `buddys_private` no expuestos por la Data API, RLS en todas las tablas con policies solo para `buddys_app`, `REVOKE` a `anon`/`authenticated`/`service_role`, TLS con verificación del certificado de Supabase, contraseña solo en `DATABASE_URL` (nunca en logs ni errores). Ver [Seguridad en la base](#seguridad-en-la-base-supabase).
- **Errores**: formato único, sin stack traces ni detalles internos.
- **Quien muestre estos datos debe escaparlos** (React lo hace por defecto): nunca `innerHTML` / `dangerouslySetInnerHTML` con nombre, modelo o comentario.

## Estructura del proyecto

```
backend/
  src/
    index.ts            arranque, listen y apagado prolijo (SIGINT/SIGTERM)
    app.ts              createApp(): arma Express sin escuchar (recibe repositorios + checkDatabase; lo usan los tests)
    config.ts           lee .env y valida la configuración con zod
    domain/             tipos del negocio, reglas (permisos por rol) e interfaces async de los repositorios
    repositories/       fábrica de repositorios
      postgres/         implementación Postgres (turnos, perfiles, servicios; SQL con $1...)
    services/           casos de uso con lógica (sesiones con Supabase Auth, usuarios, alta de turno, agenda y reprogramación y cobro, estadísticas, catálogo, disponibilidad, recordatorios, avisos push)
    routes/             rutas HTTP (health, bookings, servicios, auth, admin/bookings, admin/agenda, admin/estadisticas, admin/trabajadores, admin/permisos, admin/usuarios, admin/servicios, disponibilidad, turnos (seguimiento), admin/disponibilidad, internal (recordatorios))
    notifications/      avisos de WhatsApp al dueño (CallMeBot, Cloud API) y formato del mensaje; recordatorios a clientes (Resend, Cloud API)
    middleware/         seguridad, CSRF, rate limit, errores, logger, estáticos
    schemas/            validación de entrada con zod
    db/                 database.ts (abre la base), postgres.ts (pool, TLS, verificación del esquema), rows.ts
    lib/                utilidades: errores, logger, fechas, cookies, cliente de Supabase Auth, verificación de JWT
    scripts/            clave-db (contraseña del rol buddys_app), normalizar-telefonos (telefono_whatsapp de turnos viejos), vapid (claves de los avisos push)
  supabase/migrations/  migraciones de Postgres (fuente de verdad del esquema en Supabase)
  test/                 vitest + supertest (Postgres en memoria con PGlite y un Supabase Auth falso)
```

## Scripts y tests

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo con recarga (`tsx watch`). |
| `npm run build` | Compila a `dist/` con `tsc`. |
| `npm start` | `node dist/index.js`. |
| `npm run clave-db:dev` / `npm run clave-db` | Genera la contraseña del rol `buddys_app` y el `ALTER ROLE` con hash SCRAM para pegar en Supabase. |
| `npm run vapid:dev` / `npm run vapid` | Imprime un par de claves VAPID nuevo (con `VAPID_SUBJECT` de ejemplo) listo para pegar en `.env`, para los [avisos push](#avisos-push). No escribe archivos. |
| `npm run normalizar-telefonos:dev` / `npm run normalizar-telefonos` (después de `npm run build`) | Completa `telefono_whatsapp` en los turnos que no lo tienen (una vez, después de aplicar la migración `notas_telefono_cliente`; idempotente). Imprime solo cantidades. |
| `npm test` | Tests (vitest + supertest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint (typescript-eslint estricto). |

Los tests usan un reloj fijo, **PGlite** (Postgres compilado a WebAssembly, en memoria, sin servidor) con **las mismas migraciones** de `supabase/migrations/`, y un **Supabase Auth falso** (`test/supabase-fake.ts`): un par de claves ES256 generado en el test sirve como JWKS local y un `fetch` inyectado responde `/token` (password y refresh con rotación y detección de reuso) y `/logout`, guardando las sesiones en `auth.sessions` de PGlite. La app habla con la base como `buddys_app`, igual que en producción.

- `auth.test.ts`: login, cookies, credenciales inválidas, usuario inactivo o sin perfil, Supabase caído o limitando, refresh, refresh reutilizado, logout (el token viejo deja de servir), tokens manipulados (otra clave, HS256, `none`, `iss`/`aud` ajenos, anónimo, sesión inexistente), vencido sin refresh, desactivación y cambio de rol con la sesión abierta.
- `usuarios.test.ts`: matriz de roles sobre los turnos y gestión de usuarios (listar, activar, no degradarse, nunca sin superadmin, validación).
- `perfil.test.ts` (contrato 04): `GET`/`PATCH /api/admin/perfil` (los tres roles, nombre reflejado en `/api/auth/me`, validación estricta), contraseña (actual incorrecta `400`, correcta con la sesión de verificación cerrada y la sesión actual abierta, débil, `429` por usuario, Supabase caído y sin `SUPABASE_SECRET_KEY` `503`), foto (JPG, PNG y WebP reales generadas con sharp → WebP 256×256; JPG con EXIF y GPS → salida sin metadatos; PNG como JPG, HTML y SVG renombrados, GIF y WebP animados, JPG cortada `400`; 48 MP `400`; 3 MB `413`; `text/plain`, `image/gif` y `image/svg+xml` `415`; excepción del CSRF solo en esa ruta y método; Origin; Storage caído `503`), quitarla, acceso a la foto (uno mismo, admin y superadmin `200`, empleado con la de otro `403`, sin foto `404`, `304` con ETag, `nosniff`, CSP y `Cache-Control` según `?v=`), baja y eliminación que borran la foto (con Storage caído la versión igual queda en `null`), cambiar la contraseña cierra las otras sesiones (la otra da `401`, la actual sigue; si la base falla, `200` y log), y `verifyPostgresSchema`. Storage falso en memoria: `test/storage-fake.ts`. `perfil-limites.test.ts` suma el `429` de la foto (antes de leer el cuerpo) y el semáforo de `procesarFoto`; `migracion-cerrar-otras-sesiones-bucket.test.ts`, la función y el bucket con un `storage.buckets` simulado.
- `postgres.test.ts`: RLS y privilegios de `anon`/`authenticated`/`service_role` y de `buddys_app`, trigger de `auth.users`, CHECK y `updated_at`, CHECK de la agenda (fecha y franja confirmadas juntas) e índice `bookings_agenda_idx`, verificación del esquema y `/api/health` con Postgres caído.
- `repositories.contract.test.ts`: turnos (incluida la agenda y la reprogramación, con `TurnoCerradoError`), perfiles y servicios (backfill, alta al final, id repetido, varios destacados, duración por vehículo, edición parcial, reordenamiento y CHECK de la base) sobre Postgres como `buddys_app`.
- `agenda.test.ts`: `GET /api/admin/agenda` (roles, campos exactos, orden fecha/franja/llegada, sin cancelados, rango inclusivo, tope de 42 días, validaciones, fin de mes y de año, bisiesto) y `PATCH` con fecha/franja confirmadas (permisos, "juntas", rango hoy a hoy + 120 en hora de La Rioja, turnos cerrados, volver a la pedida, turno viejo que conserva su fecha).
- `notas-busqueda.test.ts`: búsqueda (nombre, mayúsculas, acentos, ñ, email, modelo, dígitos del teléfono en distintos formatos, comodines `%` `_` `\` como texto, largo de `q`, combinada con estado y paginación, todos los roles), historial (`cliente` inválido, teléfonos escritos distinto que normalizan igual, `turnosDelCliente` 1/N/null, turnos viejos sin normalizar), notas (vacía => null, saltos de línea, `\r\n`, 1000 caracteres, caracteres de control, empleado, turnos cerrados, junto con estado o fecha, fuera del log), campos exactos del Turno y que la nota no salga por `POST /api/bookings`.
- `normalizar-telefonos.test.ts`: el script (completa, no pisa, idempotente, resumen sin datos personales, error sin el detalle de Postgres).
- `servicios.test.ts`: API del catálogo (público y panel con los campos exactos, permisos por rol con `empleado` 403, validaciones 400, id reservado, caracteres de control, `409 SERVICIO_EXISTE`, 404, varios destacados, duración por vehículo, orden, CSRF en `PUT`) y turnos contra la base (servicio inactivo, nuevo o renombrado).
- `disponibilidad.test.ts`: cálculo de cupos; `GET /api/disponibilidad` (campos exactos, domingo cerrado por defecto, feriado sembrado cerrado, rango y formato); alta con día cerrado (400), franja llena y cupo 0 (409 `FRANJA_LLENA`), día especial abierto que pisa al domingo, feriado quitado, último lugar con dos altas simultáneas (entra una), lock de la fecha antes de contar, cancelado que no ocupa, reprogramado que libera y ocupa (y el panel que sí puede llenar o usar un día cerrado), honeypot; panel (lista exacta de feriados, lunes a domingo, roles, validaciones); seguimiento (campos exactos, sin datos personales, 404 uniforme, rate limit propio); GRANT y CHECK de la migración.
- `recordatorios.test.ts`: 404 sin `CRON_SECRET`, 401 con secreto incorrecto, CSRF, envío por Resend y Cloud (cabeceras, body, plantilla), idempotencia, solo confirmados de mañana por fecha de agenda, fallo que no marca y se reintenta, un canal que falla y otro que anda, sin canal, reprogramar limpia la marca, marcar no cambia `updated_at`, dos corridas a la vez, log sin datos personales.

- `push.test.ts`: lista permitida de endpoints (anti SSRF), estado con y sin claves, alta válida e inválida (host no permitido, http, base64 malo, campos de más), todos los roles, 401 sin sesión, CSRF, reasignación entre usuarios, tope de 10, baja idempotente, cascade al borrar el perfil, permisos de la tabla, envío (payload exacto sin datos personales, solo usuarios activos, `pendientes`, 404/410 borra, fallos y colgados que no rompen el alta ni los otros envíos, tope de tiempo, sin claves no envía, honeypot) y el cliente real `web-push` con la red simulada.
- `plazo-cuerpo.test.ts`: un `Content-Length` mayor que el cuerpo se corta antes de 10 s + margen con los plazos reales (tarda ~10 s); con plazos acortados, que un goteo de bytes no estira el plazo, que la foto mantiene el suyo y que un cuerpo que llega entero en partes se procesa.
- `limites-login-lavados.test.ts`: dos personas en la misma IP (una se frena a los 5 fallos, la otra entra; el email se normaliza y no queda en los logs), el tope por IP, email mal formado (solo IP), los intentos frenados no gastan el cupo de la IP; lavados: `429` en el pedido 61 (el `DELETE` también cuenta, otra persona sigue) y 70 reintentos del mismo `idLocal` que no lo disparan.
- `vapid.test.ts`: el par generado y el formato de `npm run vapid`. `config.test.ts` cubre las tres variables VAPID juntas o ninguna; `security.test.ts`, que `/sw.js`, `/manifest.webmanifest` y `/admin/sw.js` son `404` JSON con la CSP que bloquea todo (sin `PANEL_DIR`). `panel.test.ts`: con `PANEL_DIR`, las rutas del panel devuelven `index.html` con la CSP del panel, caché de `assets/` y del service worker, y `/api` y los archivos inexistentes siguen en `404` JSON.

`createTestContext` abre por defecto los 7 días con 20 cupos y quita los días especiales (`disponibilidad: 'libre'`), para que los tests anteriores al objetivo 4 sigan probando lo suyo; los de disponibilidad usan `disponibilidad: 'fabrica'` (la base tal como la deja la migración).

No hace falta internet ni ninguna clave de Supabase para correr los tests: ninguno hace requests reales. Un test adicional falla si algún fuente contiene caracteres invisibles escritos literalmente (ataque "Trojan Source").

### Inventario, presupuestos, comprobantes y PDF (objetivo 10, M2/M3)

Contrato: `reportes/2026-10-27_17_finanzas-inventario-documentos.md`. Errores, CSRF y `fields` como el resto de la API. **Presupuestos y comprobantes NO son facturas.**

**Quién puede qué.** Inventario: ver y registrar **uso** = todos los roles; crear/editar insumos, **compras** y **ajustes** = `admin` y `superadmin` (el empleado recibe `403` antes de validar el body, también al mandar `compra` o `ajuste`). **El empleado nunca recibe costos ni valores en pesos** (`costoUnitario`, `valorEnStock`, `costoTotal`, `valorTotal` van `null` en cada respuesta: lo aplican las vistas `vistaDeInsumo`, `vistaDeMovimiento` y `vistaDeListaDeInsumos` de `domain/inventario.ts`). Presupuestos, comprobantes y PDF: solo `admin` y `superadmin` (`403` al empleado en todo).

#### Inventario

`Insumo` = `{ id, nombre, categoria: string|null, unidad, stock, stockMinimo, costoUnitario: int|null, activo, bajoStock, valorEnStock: int|null, updatedAt }`. Unidades: `unidad`, `litro`, `ml`, `kg`, `g`, `par`, `caja`. `bajoStock` = `stockMinimo > 0 && stock <= stockMinimo`; `valorEnStock` = `round(stock x costoUnitario)`.

- `GET /api/admin/insumos?q=&bajoStock=true&activo=true|false|todos&limit=&offset=` -> `200 { insumos, total, bajoStock, valorTotal }`. Por omisión solo activos; orden: stock bajo primero y después por nombre; `limit` 1 a 100 (50). `bajoStock` y `valorTotal` son de **todo el inventario activo**, no del filtro ni de la página. `q` (2 a 80) busca en nombre y categoría sin distinguir mayúsculas ni acentos; los comodines se buscan como texto.
- `POST /api/admin/insumos { nombre (1-80), categoria? (1-40), unidad, stockInicial?, stockMinimo?, costoUnitario? }` -> `201 { insumo }`. Un `stockInicial > 0` deja un ajuste "Stock inicial". Nombre repetido entre activos (sin distinguir mayúsculas) -> `409 CONFLICT` con `fields.nombre`.
- `PATCH /api/admin/insumos/:id { nombre?, categoria? (null vacía), unidad?, stockMinimo?, costoUnitario? (null vacía), activo? }` -> `200 { insumo }` (al menos un campo; reactivar o renombrar con el nombre de otro activo -> `409`). No se borran: se desactivan.
- `GET /api/admin/insumos/:id/movimientos?limit=&offset=` -> `200 { movimientos, total }`, más nuevos primero. `Movimiento` = `{ id, tipo, cantidad (con signo), costoTotal: int|null, proveedor, nota, persona: { id, nombre }|null, turnoId, createdAt }`.
- `POST /api/admin/insumos/:id/movimientos` -> `201 { insumo, movimiento }`:
  - `{ tipo: "uso", cantidad, nota?, turnoId? }` (todos): resta. Si no alcanza -> `409 STOCK_INSUFICIENTE` con `fields.cantidad` ("Solo quedan 0,3 litros."). `turnoId` inexistente -> `400 fields.turnoId`.
  - `{ tipo: "compra", cantidad, costoTotal?, proveedor?, nota? }` (admin): suma. Con `costoTotal > 0` crea el **gasto** (`categoria insumos`, `origen inventario`, fecha de hoy en La Rioja, descripcion `Compra: <nombre> (<cantidad> <unidad>)`) vinculado al movimiento (`gasto_id`) y fija `costoUnitario = round(costoTotal / cantidad)`. Todo en una transacción.
  - `{ tipo: "ajuste", stockReal, nota? }` (admin): conteo físico; guarda la diferencia con signo. **Si la diferencia es 0 devuelve `200 { insumo }` sin `movimiento`** y no crea nada.
  - Cantidades: hasta 2 decimales, `> 0` (`uso` y `compra`), `<= 999999`; `stockReal` entre 0 y 999999.
  - `{ tipo: "devolucion" }`: **no se carga a mano** -> `400 fields.tipo` (el empleado recibe `403` antes, como con compra y ajuste). Las devoluciones las crea el sistema al deshacer o corregir un lavado y aparecen en el historial con `tipo: "devolucion"` (cantidad positiva).
- **Stock concurrente:** cada movimiento corre en una transacción con `pg_advisory_xact_lock(7340010, hashtext(insumo_id))` + `SELECT ... FOR UPDATE`; el uso descuenta con `UPDATE ... WHERE stock >= cantidad` y el `CHECK (stock >= 0)` de la tabla es la red. Dos usos que no caben juntos: uno entra (`201`) y el otro es `409`.

#### Recetas, descuento automático y avisos de stock bajo (contrato 06)

Contrato: `reportes/2026-11-17_06_recetas-stock-avisos.md`. Código: `domain/recetas.ts`, `repositories/postgres/recetas.ts`, `repositories/postgres/stock.ts` (los movimientos que van dentro de la transacción de otro: descuento, devolución y marca del aviso), `services/recetas.ts` y `routes/admin-recetas.ts`.

`Receta` = `{ servicioId, general: Renglon[], porVehiculo: { auto?, suv?, pickup?, moto?: Renglon[] } }`, `Renglon` = `{ insumoId, nombre, unidad, cantidad }`. Sin costos. `porVehiculo` solo trae las claves con renglones. Los renglones de insumos **inactivos** no se muestran (tampoco se descuentan; al volver a guardar la variante, se van).

- `GET /api/admin/recetas` (todos los roles, `inventario.ver`) -> `200 { recetas }`: una por servicio con renglones, en el orden del catálogo; renglones por nombre de insumo.
- `PUT /api/admin/servicios/:id/receta { vehiculo: null|"auto"|"suv"|"pickup"|"moto", items: [{ insumoId, cantidad }] }` (`admin` y `superadmin`, `inventario.recetas`; el empleado recibe `403` antes de validar) -> `200 { receta }` (la del servicio entero). **Reemplaza** esa variante en una transacción (bloqueo por servicio); `items: []` la borra. De 0 a 30 renglones, cantidad `> 0` y `<= 99999` con hasta 2 decimales. Errores: `404` servicio inexistente; `400` con `fields["items.N.insumoId"]` *"Ese insumo no existe o está inactivo."* (también un id con otro formato), *"Ese insumo ya está en la receta: no lo repitas."* en el renglón repetido, `fields.vehiculo` si el servicio no se ofrece para ese vehículo, `fields["items.N.cantidad"]` fuera de rango y `fields.items` con más de 30.

**Descuento al registrar un lavado** (`POST /api/admin/lavados`, la respuesta no cambia), en la **misma transacción** que el INSERT del lavado:

1. Por cada servicio, los renglones de su vehículo si los hay; si no, la receta general. Se suman por insumo; los inactivos se saltean.
2. Bloqueos `pg_advisory_xact_lock(7340010, hashtext(insumo_id))` (los mismos de los movimientos manuales) **en orden de id**, así dos lavados no se traban.
3. Si el stock no alcanza, se descuenta lo que hay (queda en 0): el `uso` registra lo que de verdad se descontó, con la nota *"Receta: Encerado + Lavado Básico. Faltaron 20 ml según la receta"* (la parte de los servicios se recorta para que la nota no pase de 200 caracteres). Sin stock no hay movimiento. **El stock nunca frena el lavado.** Los usos llevan `turno_id` = el lavado y `perfil_id` = quien registra.

**Deshacer o borrar un lavado de mostrador** (`DELETE /api/admin/lavados/:id` y `DELETE /api/admin/bookings/:id`): antes del `DELETE` y en la misma transacción, por cada insumo y origen se crea una `devolucion` con lo descontado y todavía no devuelto (usos del lavado, también los manuales vinculados, menos las devoluciones previas), nota *"Lavado deshecho"*, a nombre de quien lo borra. Los usos de la receta y sus devoluciones se graban con `origen = 'receta'`; todo lo que entra por la API manual, con `'manual'` (el body no acepta `origen`: `400`). Un uso manual con `turnoId` bloquea primero el turno (`FOR KEY SHARE`) y después el insumo, el mismo orden que deshacer y corregir. **Corregir los servicios** (`PATCH /api/admin/bookings/:id` con `servicioIds` sobre un lavado de mostrador): devuelve lo que descontó la receta (los movimientos con `origen = 'receta'`, nunca por el texto de la nota: un uso manual con la nota *"Receta: …"* sigue siendo manual y se queda) con nota *"Lavado corregido"* y descuenta la receta nueva, todo en la transacción del PATCH, con los bloqueos de todos los insumos involucrados tomados juntos y en orden.

**Aviso de stock bajo**: cuando **cualquier salida** (receta, uso manual o ajuste negativo) baja el stock y el insumo queda bajo (`stock <= stockMinimo`, con mínimo > 0) y `insumos.aviso_bajo_at` es null (decisión del dueño, 2026-11-19: también si ya estaba bajo, por ejemplo porque se subió el mínimo o porque ya lo estaba al aplicar la migración), se marca `aviso_bajo_at` en la misma transacción y, **después del COMMIT**, sale un push (sin esperar y sin poder hacer fallar el pedido) a los dispositivos de las personas **activas** con `inventario.consumo` (admin y superadmin; `PushRepository.destinosConRol`). Uno: *"Queda poco: Shampoo"* / *"Hay 0,5 litro (mínimo 1 litro). Mirá la lista para comprar."*; varios en el mismo pedido: un solo aviso *"Quedan poco 3 insumos"* con los nombres; URL `/insumos?ver=comprar`. `aviso_bajo_at` vuelve a null cuando el stock sube por encima del mínimo (compra, devolución o ajuste) o cuando cambia el mínimo (PATCH del insumo). En la corrección se compara el stock de antes y el de después de devolver y volver a descontar: corregir sin cambiar nada no avisa.

- `GET /api/admin/insumos/alertas` (`admin` y `superadmin`, `inventario.consumo`) -> `200 { bajoStock, insumos: [{ id, nombre, unidad, stock, stockMinimo }] }`: los activos con stock bajo, por `stock / stockMinimo` ascendente.
- `GET /api/admin/insumos/para-comprar` (`admin` y `superadmin`) -> `200 { items: [{ insumoId, nombre, categoria, unidad, stock, stockMinimo, sugerido, costoEstimado }], costoTotalEstimado }`. `sugerido = max(2 x stockMinimo - stock, 0)`, hacia arriba a entero para `unidad`, `par` y `caja` y a 2 decimales para el resto; `costoEstimado = round(sugerido x costoUnitario)` o `null`; `costoTotalEstimado` suma los no nulos (0 si no hay). Orden: categoría (sin categoría al final) y nombre.
- `GET /api/admin/consumo?desde=&hasta=` (`admin` y `superadmin`; el empleado recibe `403` antes de validar los parámetros) -> `200 { rango: { desde, hasta, agrupado }, lavados: { total, serie: [{ clave, cantidad }] }, porInsumo: [{ insumoId, nombre, unidad, consumido, costo }], costoInsumos, costoPorLavado }`. Rango y errores como `/estadisticas` (por omisión **del día 1 del mes hasta hoy**, en fechas de La Rioja; hasta 366 días). Serie con ceros: por **día** hasta 62 días, por **semana** (lunes a domingo, clave del lunes, aunque caiga antes de `desde`) hasta 200 y por **mes** (`YYYY-MM`) con más. `lavados` = de mostrador **completados** por fecha del lavado. `consumido` = usos (en positivo) menos devoluciones por la **fecha del movimiento en La Rioja**, incluidos los usos manuales; los renglones con `consumido <= 0` no se muestran. `costo = round(consumido x costoUnitario de hoy)` o `null`; `costoInsumos` suma los no nulos; `costoPorLavado = round(costoInsumos / total)` o `null` sin lavados. Todo se agrega en SQL (índice parcial `movimientos_stock_consumo_idx`).

#### Presupuestos

`Presupuesto` = `{ id, numero, codigo: "P-0007", clienteNombre, clienteTelefono: string|null, vehiculo: string|null, items: [{ descripcion, cantidad, precioUnitario }], descuento, subtotal, total, validezDias, venceEl, estado, vencido, notas, turnoId, creadoPor, createdAt, updatedAt }`. Cuentas (en `domain/presupuestos.ts`, nunca en el cliente): importe de un ítem = `round(cantidad x precioUnitario)` (.5 hacia arriba, con enteros: sin errores de coma flotante); `subtotal` = suma de importes; `total = max(0, subtotal - descuento)` (un descuento mayor al subtotal deja 0); `venceEl` = fecha de creación **en La Rioja** + `validezDias`; `vencido` = `borrador` o `enviado` con `venceEl` anterior a hoy (el día de vencimiento todavía vale). `numero` es una identidad de la base: nunca se reutiliza.

- `GET /api/admin/presupuestos?estado=&q=&limit=&offset=` -> `200 { presupuestos, total }` (más nuevos primero; `q` busca en cliente, vehículo y código).
- `POST /api/admin/presupuestos { clienteNombre (1-80), clienteTelefono?, vehiculo? (<=80), items (1 a 30), descuento? (0 a 999.999.999), validezDias? (1-90, por omisión 7), notas? (<=500), turnoId? }` -> `201 { presupuesto }`. Ítem: `descripcion` 1-120, `cantidad` > 0, <= 999, 2 decimales, `precioUnitario` entero 0 a 99.999.999. Los errores de los ítems llevan su posición: `fields["items.2.cantidad"]`, `items.0.descripcion`, `items.1.precioUnitario`. Un subtotal mayor a 999.999.999 -> `400 fields.items`. El teléfono se guarda **normalizado** (solo dígitos, con `549` si es celular argentino); uno ilegible -> `400 fields.clienteTelefono`. Los vacíos/`null` se omiten.
- `GET /api/admin/presupuestos/:id`, `PATCH` (cualquier campo; `items` se reemplaza entero; `clienteTelefono`, `vehiculo`, `notas` y `turnoId` aceptan `null` para vaciar; `estado` cambia libremente entre `borrador`, `enviado`, `aceptado`, `rechazado`; el total se recalcula con lo guardado) y `DELETE` -> `204`; **aceptado -> `409 PRESUPUESTO_ACEPTADO`**.
- `GET /api/admin/presupuestos/:id/pdf` (ver "PDF").

#### Comprobantes

`Comprobante` = `{ id, numero, codigo: "R-0001", fechaEmision, formaPago, monto, clienteNombre, servicioNombre, vehiculo, notas }`. Es una **foto** del momento: copia nombre, servicio, vehículo (el modelo; si no hay, el tipo: "SUV", "Pick-up") y servicio (con varios, los nombres unidos con " + ": "Limpieza Nivel II + Limpieza de motor") y monto del turno, y no cambia si después se edita el turno. Formas de pago: `efectivo`, `transferencia`, `debito`, `credito`, `otro`.

- `POST /api/admin/bookings/:id/comprobante { formaPago?, notas? (<=200) }` -> `201 { comprobante }` la primera vez y **`200` con el existente** si el turno ya tenía (idempotente, con bloqueo por turno: no se emite otro). Turno no completado o sin `monto` -> `400` "Primero cargá el cobro del trabajo."; turno inexistente -> `404`. **`formaPago` es opcional**: si no viene, se usa la del turno (la que se cargó con el lavado o con el PATCH); si viene, manda la que viene. Sin `formaPago` y el turno sin una cargada -> el mismo `400` de siempre en `fields.formaPago`.
- `GET /api/admin/bookings/:id/comprobante` -> `200 { comprobante }` o `404` si todavía no hay.
- `GET /api/admin/comprobantes/:id/pdf` (ver "PDF").
- Un turno con comprobante **no se puede borrar**: `DELETE /api/admin/bookings/:id` -> `409 TURNO_CON_COMPROBANTE` (la FK es `ON DELETE RESTRICT`).

#### PDF

Se arma en el backend con `pdfkit` (única dependencia nueva, más sus tipos) a partir de lo guardado y los datos de `TallerService`; **nunca se guarda**. Fuentes estándar (Helvetica, WinAnsi): acentos y ñ salen bien. Código: `src/pdf/documentos.ts`.

- Respuesta: `200`, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="Presupuesto-P-0007.pdf"` (o `Comprobante-R-0001.pdf`; el nombre solo tiene `[A-Za-z0-9._-]`), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. `404` si no existe, `403` al empleado, `401` sin sesión.
- Contenido: logo (`backend/assets/logo.png`, el de Buddys Wash Detail con fondo transparente; se resuelve desde la raíz del backend, igual desde `src/` que desde `dist/`: **el despliegue tiene que llevar la carpeta `assets/`** junto a `dist/`, como `supabase/migrations`), datos del taller, código y fecha, cliente y vehículo, tabla de ítems (descripción, cantidad, precio unitario, importe) con paginado y encabezado repetido, subtotal, descuento, **total**, notas y las leyendas "Presupuesto no vinculante hasta su aceptación. No es una factura." / "Comprobante de pago interno. No es una factura ni tiene validez fiscal." más `leyendaPdf` del taller. Montos `$ 12.500`, fechas `dd/mm/aaaa`, hora de La Rioja.
- Seguridad: el texto de personas pasa por `limpiar()` (sin controles ni caracteres de formato/bidireccionales; lo que Helvetica no dibuja sale como `?`); es solo texto, sin enlaces ni acciones ni scripts. Las descripciones y nombres largos envuelven en su celda.
- Para los tests, `generarPdfPresupuesto(p, taller, { comprimir: false })` deja los textos legibles dentro del archivo.

#### Modelo de datos (M2/M3)

| Tabla | Para qué | Restricciones |
|---|---|---|
| `insumos` | Insumos con stock decimal | `stock numeric(12,2)` CHECK 0 a 9.999.999,99; `stock_minimo` 0 a 999.999; `costo_unitario` entero 0 a 99.999.999 o null; `unidad` CHECK (7 valores); índice único parcial `lower(btrim(nombre)) WHERE activo`; `aviso_bajo_at` (desde `recetas_stock`): cuándo se avisó que quedó bajo su mínimo, null = sin aviso pendiente. `buddys_app`: SELECT, INSERT y UPDATE por columna (sin DELETE). |
| `movimientos_stock` | Historial inmutable | `insumo_id` FK `RESTRICT`; `tipo` CHECK; `cantidad` con signo (CHECK por tipo: compra > 0, uso < 0, ajuste <> 0, devolucion > 0; `devolucion` desde `recetas_stock` y solo la crea el sistema); `costo_total`/`proveedor`/`gasto_id` solo en compras; `nota` <= 200; `origen` (desde `recetas_stock`) CHECK `manual`/`receta`, default `manual`; `turno_id` `ON DELETE SET NULL`, `perfil_id` `ON DELETE RESTRICT` (desde `usuarios_baja`); `gasto_id` único `SET NULL`. `buddys_app`: SELECT e INSERT por columna (también `origen`; nunca UPDATE ni DELETE). |
| `recetas` | Qué insumos usa cada servicio (migración `recetas_stock`) | `servicio_id` e `insumo_id` FK `RESTRICT`; `vehiculo` null (general) o `auto`/`suv`/`pickup`/`moto` (variante que reemplaza a la general); `cantidad numeric(12,2)` > 0 y <= 99999; índice único `(servicio_id, coalesce(vehiculo, '*'), insumo_id)`. `buddys_app`: SELECT, INSERT, UPDATE (cantidad) y DELETE, una policy por operación. |
| `presupuestos` | Presupuestos | `numero` identidad única; `items jsonb` validado por `buddys.presupuesto_items_validos` (IMMUTABLE: 1 a 30 ítems con claves exactas); `total` 0 a 999.999.999; `validez_dias` 1 a 90; `estado` CHECK; `cliente_telefono` 8 a 15 dígitos. `buddys_app`: SELECT, DELETE, INSERT/UPDATE por columna (nunca `id` ni `numero`). |
| `comprobantes` | Comprobantes de pago | `numero` identidad única; `booking_id` único, FK `RESTRICT`; `forma_pago` CHECK; foto de nombre/servicio/vehículo/monto. `buddys_app`: SELECT e INSERT (sin UPDATE ni DELETE). |

Todas con RLS, `REVOKE` a `public`, `anon`, `authenticated` y `service_role`, y policies solo para `buddys_app`. `verifyPostgresSchema` exige las cuatro tablas.
