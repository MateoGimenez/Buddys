# 03 — Contrato de las mejoras del panel (funciones 6 a 16 y 26)

Fecha: 2026-11-15

**Estado: verificado por pruebas (2026-11-16).** Backend: typecheck, lint y build OK, 53 archivos / 811 tests (antes
52 / 806), respuestas reales = `respuestas-api.json`. Frontend: `verificar` 3 veces seguidas en verde (28 archivos / 177
tests), `respuestas:verificar` al día, e2e 11/11 con workers por defecto. Las 9 migraciones 20261115* se aplicaron en
orden sobre una base con datos, dos veces, y el backend arranca (`test/migracion-mejoras.test.ts`). Arreglado: la
migración 20261115100000 movía `updated_at` de todos los lavados viejos al rellenar `etapa`. Sin aplicar en Supabase.

Contrato del backend para los agentes de frontend que programan después. Todas las rutas cuelgan de `/api/admin/*`
(sesión obligatoria; sin sesión `401 UNAUTHORIZED`) salvo `POST /api/errores-cliente`. Las respuestas reales están
capturadas en `backend/test/fixtures/respuestas-api.json` (claves nuevas al final del archivo, listadas en cada
función). Formato de error de siempre: `{ "error": { "code", "message", "fields"? } }`. Un body con un campo
desconocido es `400 VALIDATION_ERROR` con `fields.<campo> = "Este campo no está permitido."`.

Regla de oro: **el empleado nunca recibe importes** (montos, descuentos, señas, saldos, totales, costos, gastos).
Donde un objeto lleva un importe, para el empleado sale `null` (la clave está, el valor no).

Fechas: siempre de calendario de La Rioja (`YYYY-MM-DD`); "hoy" es el de `America/Argentina/La_Rioja`.

## Cambios en el objeto `Turno` (todas las respuestas que devuelven turnos o lavados)

Se agregan siete claves al objeto de siempre (`GET /api/admin/bookings`, agenda, lavados, PATCH, historial):

| Clave | Tipo | Qué es |
|---|---|---|
| `etapa` | `'espera' \| 'lavando' \| 'listo' \| 'entregado' \| null` | Solo lavados de mostrador (función 9); `null` en turnos de la web o del panel. |
| `etapaDesde` | `string \| null` (ISO 8601 UTC) | Desde cuándo está en esa etapa. `null` si `etapa` es `null`. |
| `descuento` | `number \| null` | Pesos descontados (0 = sin descuento). `null` para el empleado. |
| `descuentoMotivo` | `string \| null` | Motivo del descuento. `null` sin descuento o para el empleado. |
| `sena` | `{ monto: number \| null, formaPago, fecha } \| null` | Seña del turno (función 8). `monto` es `null` para el empleado. |
| `saldo` | `number \| null` | `monto - sena.monto` (o `monto` sin seña). `null` sin monto o para el empleado. |
| `whatsappListo` | `string \| null` | Link `https://wa.me/<telefonoWhatsapp>?text=<mensaje>` de "ya está listo" (función 9). `null` sin teléfono normalizado. Lo ven todos los roles (no lleva importes). El nombre entra solo si es una palabra de letras (sin `:`, `/`, `.` ni dígitos); el modelo, recortado a 30 caracteres de letras, números, espacios y guiones. |

`origen` suma el valor `'panel'` (turno creado por un admin desde el panel, función 8).

---

## 6. Historial y búsqueda de clientes

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- `GET /api/admin/bookings?q=` ya buscaba por nombre, email, modelo y teléfono. Ahora también por **patente**: si `q`
  tiene 5 o más letras/dígitos, se compara sin espacios, guiones ni puntos y sin mayúsculas contra `vehiculoModelo`
  (`"ab 123 cd"` encuentra `"Gol AB-123-CD"`). Los lavados de mostrador salen con sus `servicios[]` (como siempre).
- `GET /api/admin/clientes/historial?telefono=<tel>` o `?patente=<patente>` (exactamente uno). Todos los roles.
  - `telefono`: cualquier forma escrita (se normaliza como `telefonoWhatsapp`); `patente`: 5 a 10 letras/dígitos
    (se ignoran espacios, guiones y puntos).
  - `200`:
    ```json
    {
      "cliente": {
        "tipo": "telefono",
        "clave": "5493804123456",
        "nombre": "Juan",
        "telefonoWhatsapp": "5493804123456",
        "vehiculos": ["Gol AB123CD"],
        "visitas": 3,
        "ultimaVisita": "2026-10-16",
        "serviciosMasHechos": [{ "servicioId": "lavado-basico", "nombre": "Lavado básico", "cantidad": 3 }],
        "totalGastado": 45000,
        "sellos": { "visitas": 3, "sellos": 3, "cada": 10, "faltan": 7, "proximoEsPremio": false, "premio": "gratis", "porcentaje": null }
      },
      "lavados": [Turno, ...],
      "total": 3
    }
    ```
    `visitas` = turnos/lavados **completados**; `ultimaVisita` = la fecha de agenda más reciente de un completado
    (`null` si ninguno); `serviciosMasHechos` = hasta 3, por cantidad (completados); `totalGastado` = suma de `monto`
    de los completados (`null` para el empleado); `lavados` = todos sus turnos (cualquier estado), más nuevos
    primero, hasta 100; `total` = cuántos hay. `nombre` = el del turno más reciente; `vehiculos` = modelos distintos
    (hasta 5, más recientes primero). Por patente, `telefonoWhatsapp` es el del turno más reciente que lo tenga.
  - Errores: `400 VALIDATION_ERROR` (`fields.telefono` "Escribí un teléfono válido." / `fields.patente` "La patente
    tiene que tener de 5 a 10 letras o números." / `fields.telefono` "Mandá telefono o patente, uno solo.");
    `404 NOT_FOUND` "No encontramos turnos ni lavados de ese cliente."
- Permisos: `turnos.clientes` (los tres roles; el empleado sin `totalGastado` ni importes de los turnos).

Fixtures: `clienteHistorialTelefonoAdmin`, `clienteHistorialPatenteEmpleado`, `error404Cliente`, `error400ClienteDosClaves`, `busquedaPatente`.

## 7. Avisos push nuevos

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

Sin claves VAPID (`VAPID_*`) todo queda apagado sin errores (ni consultas a la base). Los avisos van a los
dispositivos de los **admin y superadmin activos**, nunca al empleado, y no llevan datos del cliente ni importes.

- **Lavado sin monto** (decisión: **al registrarse**, no a fin del día: no hace falta un cron y el dueño se entera en
  el momento, mientras el cliente todavía está). Al `POST /api/admin/lavados` sin `monto` (y solo si se creó, no en
  un reintento): `{ "titulo": "Lavado sin monto", "cuerpo": "Se registró un lavado sin monto: completalo desde la planilla.", "pendientes": n, "url": "/admin/lavados" }`.
  No se le manda a quien lo registró.
- **Meta del mes cumplida**: después de registrar un lavado o de cambiar estado/cobro de un turno, si la meta del mes
  en curso (ingresos y/o trabajos) queda cumplida y todavía no se avisó: `{ "titulo": "¡Meta cumplida!", "cuerpo":
  "Llegaron a la meta de noviembre.", "pendientes": n, "url": "/admin/metas" }`. Se avisa **una vez por mes** (columna
  `metas_mensuales.cumplida_avisada_at`); si se cambia la meta, se vuelve a poder avisar.
- README: cómo generar las claves (`npm run vapid`).

## 8. Turnos con seña

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- `POST /api/admin/turnos` (permiso `turnos.crear`: admin y superadmin; empleado `403 FORBIDDEN` "Con tu rol no
  podés crear turnos desde el panel.")
  ```json
  {
    "nombre": "Juan Pérez", "telefono": "+54 9 380 412-3456", "email": null,
    "vehiculoTipo": "auto", "vehiculoModelo": "Corolla AB123CD",
    "servicioIds": ["pulido"], "fecha": "2026-10-20", "franja": "manana",
    "comentario": null, "notasInternas": null,
    "sena": { "monto": 20000, "formaPago": "transferencia", "fecha": "2026-10-16" }
  }
  ```
  Obligatorios: `nombre`, `telefono`, `vehiculoTipo`, `servicioIds` (1 a 10, activos y ofrecidos para el vehículo),
  `fecha` (de hoy a 120 días), `franja`. `sena` opcional: `monto` 1 a 99.999.999, `formaPago` obligatoria, `fecha`
  (por defecto hoy; no futura, hasta 31 días atrás). No mira cupos (el panel manda, como al reprogramar).
  `201 { "turno": Turno }` con `origen: "panel"`, `estado: "confirmado"`, `etapa: null`.
- `PUT /api/admin/turnos/:id/sena` `{ monto, formaPago, fecha? }` o `DELETE /api/admin/turnos/:id/sena`: carga,
  corrige o quita la seña de un turno que no es de mostrador. `200 { "turno": Turno }` / `204`. 404 si no existe o es
  de mostrador.
- Al completar (`PATCH /api/admin/bookings/:id { estado: "completado", monto }`), `monto` es el **total del trabajo**
  (incluye la seña) y la respuesta trae `saldo = monto - sena.monto` (lo que falta cobrar). `monto` menor que la seña
  es `400` (`fields.monto` "El total no puede ser menor que la seña que ya se cobró."). En estadísticas cuenta el
  total en la fecha del turno; en la caja, la seña entra el día que se cobró y el saldo el día del turno.
- Turno cancelado: la seña queda registrada (si se devolvió, se quita con DELETE).
- Errores: `400 VALIDATION_ERROR` con `fields.<campo>` (`sena.monto`, `sena.formaPago`, `sena.fecha`, `fecha`,
  `servicioIds`...), `403 FORBIDDEN`, `404 NOT_FOUND` "No encontramos ese turno.".

Fixtures: `turnoConSenaCrea`, `turnoConSenaEmpleadoLista`, `turnoCompletaConSena`, `error400MontoMenorSena`, `error403TurnoEmpleado`, `senaPut`, `error400Sena`.

## 9. Estado del auto en el lavadero (etapas)

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- Columna `bookings.etapa` (`espera` → `lavando` → `listo` → `entregado`), solo para lavados de mostrador. Los ya
  registrados quedan `entregado`. `POST /api/admin/lavados` acepta `etapa` opcional (por defecto `entregado`: "ya
  terminado").
- `PATCH /api/admin/lavados/:id/etapa { "etapa": "listo" }` → `200 { "lavado": Turno }` (con `whatsappListo`). Se
  puede avanzar o retroceder a cualquier etapa. Permiso `lavados.etapa`: admin y superadmin en todos; el empleado en
  los suyos (es el trabajador o lo registró). `403 FORBIDDEN` "Solo podés cambiar la etapa de tus lavados.";
  `404 NOT_FOUND` "No encontramos ese lavado."; `400` `fields.etapa`.
- `GET /api/admin/lavados/en-curso` → `200 { "fecha": "2026-10-16", "lavados": [Turno], "resumen": { "espera": 1, "lavando": 0, "listo": 1 } }`:
  los lavados de mostrador **de hoy** no entregados, por etapa (espera, lavando, listo) y orden de llegada. Todos los roles.
- `whatsappListo`: `https://wa.me/<telefonoWhatsapp>?text=` + mensaje URL-encoded:
  `Hola Juan! Tu Gol AB123CD ya está listo en Buddys Wash Detail: ya podés pasar a retirarlo.` (sin nombre si es
  "Cliente de mostrador": `Hola! Tu ...`; sin modelo usa el tipo: `tu auto`). `null` sin teléfono normalizado.

Fixtures: `lavadoCreaEnEspera`, `lavadoEtapaListo`, `lavadosEnCurso`, `error403EtapaAjena`, `error400Etapa`.

## 10. Gastos fijos mensuales (sueldos, alquiler, servicios)

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

No hay comisiones (decisión del dueño: sueldos fijos). Ítems recurrentes que cuentan en los gastos de cada mes.

- `GET /api/admin/gastos-fijos` (admin y superadmin) → `{ "gastosFijos": [GastoFijo], "totalMensual": 350000 }`
  (`totalMensual` = suma de los activos este mes).
- `POST /api/admin/gastos-fijos` (solo superadmin) `{ concepto, monto, categoria, perfilId?, desde? }` → `201 { "gastoFijo" }`.
- `PATCH /api/admin/gastos-fijos/:id` (solo superadmin) `{ concepto?, monto?, categoria?, perfilId?, activo?, desde?, hasta? }` → `{ "gastoFijo" }`.
- `DELETE /api/admin/gastos-fijos/:id` (solo superadmin) → `204` (se borra también de los meses pasados; para que
  deje de contar desde ahora, `activo: false`).
- `GastoFijo`: `{ id, concepto, monto, categoria, perfil: { id, nombre } | null, activo, desde: "YYYY-MM", hasta: "YYYY-MM" | null, createdAt, updatedAt }`.
  `categoria` = las de los gastos (`sueldos`, `alquiler`, `servicios`...). `perfilId` = el empleado del sueldo.
  `activo: false` pone `hasta` = el mes actual (cuenta este mes, no los siguientes); `activo: true` borra `hasta`.
- **Cómo cuentan**: el monto entero se imputa el **día 1 de cada mes** de vigencia (`desde` ≤ mes ≤ `hasta`). En
  `GET /api/admin/estadisticas` suman en `gastos`, `ganancia`, `serie[].gastos`, `gastosPorCategoria` y en
  `periodo.gastosFijos` (la parte fija de `periodo.gastos`). No se crean filas en `gastos`: el listado de gastos
  sueltos no cambia y nada se cuenta dos veces. Un sueldo cargado también como gasto suelto sí se duplicaría: los
  sueldos van solo acá. Un aumento: cerrar el ítem (`hasta`) y crear otro `desde` el mes nuevo (si se edita `monto`,
  cambia en todos los meses).
- Errores: `400` con `fields`, `403 FORBIDDEN` ("Con tu rol no podés ver los gastos fijos." / "Solo el superadmin
  puede cargar o cambiar gastos fijos."), `404` "No encontramos ese gasto fijo.".

Errores de validación extra: `fields.hasta` "\"hasta\" no puede ser anterior a \"desde\"."; `fields.activo` "Este gasto todavía no empezó: borralo en vez de desactivarlo."; `activo` y `hasta` juntos es 400.

Fixtures: `gastoFijoCrea`, `gastosFijosLista`, `gastoFijoDesactiva`, `error403GastoFijoAdmin`, `error403GastosFijosEmpleado`, `estadisticasConFijos`.

## 11. Cierre de caja con arqueo

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- `GET /api/admin/caja?fecha=YYYY-MM-DD` (sin fecha: hoy) → `{ "fecha", "esperado": CajaEsperada, "cierre": Cierre | null }`.
  `CajaEsperada` = `{ "formas": [{ "formaPago": "efectivo", "esperado": 15000 }, ... las 5 formas], "sinIndicar": 0, "total": 15000 }`:
  lo que debería haber por forma de pago = lavados de mostrador del día + señas cobradas ese día + saldos de turnos
  completados ese día (`sinIndicar` = lo cobrado sin forma de pago).
- `PUT /api/admin/caja/:fecha` `{ "contado": { "efectivo": 14500, "transferencia": 0 }, "nota": "Faltan 500" }`
  (`efectivo` obligatorio; las demás opcionales, `null`/omitida = no se contó) → `201 { "cierre" }` (nuevo) o
  `200 { "cierre" }` (corregido). Fecha de hoy hasta 366 días atrás.
- `DELETE /api/admin/caja/:fecha` → `204` (reabre: borra el cierre).
- `GET /api/admin/caja/cierres?desde=&hasta=&limit=&offset=` → `{ "cierres": [Cierre], "total" }` (más nuevos primero; sin rango: últimos 31 días).
- `Cierre`: `{ fecha, formas: [{ formaPago, esperado, contado | null, diferencia | null }], sinIndicar, esperadoTotal,
  contadoTotal, diferencia, nota, cerradoPor: { id, nombre } | null, cerradoEl, actualizadoEl, cambiosDespues }`.
  `esperado` es la **foto** al cerrar; `diferencia` = contado - esperado de las formas contadas; `cambiosDespues` =
  `true` si lo esperado de hoy ya no coincide con la foto (se tocó un lavado después de cerrar).
- Permisos: `caja.cerrar` (admin y superadmin: ver, cerrar el día); `caja.reabrir` (solo superadmin: corregir un
  cierre existente o borrarlo). Empleado: `403` en todo. Admin sobre un día ya cerrado: `403 FORBIDDEN` "Esta caja ya
  está cerrada: solo el superadmin la puede corregir o reabrir."

- **Cierres simultáneos** (auditoría): el alta es `INSERT ... ON CONFLICT DO NOTHING`; si otro cierre del mismo día
  entró en el medio, `409 CONFLICT` "Esta caja ya está cerrada: solo el superadmin la puede corregir o reabrir." y no se
  pisa lo contado. Solo el camino del superadmin (corregir) reemplaza el cierre.

Fixtures: `cajaAbierta`, `cajaCierra`, `cajaCerrada`, `cajaCierres`, `error403CajaEmpleado`, `error403CajaReabrirAdmin`, `error400Caja`.

## 12. Descuentos

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- `POST /api/admin/lavados` y `PATCH /api/admin/bookings/:id` aceptan `descuento` (entero 0 a 99.999.999) y
  `descuentoMotivo` (1 a 80 caracteres). `monto` sigue siendo **lo cobrado** (ya con el descuento): `descuento` es
  cuánto se rebajó y es informativo (estadísticas: `periodo.descuentos`).
- Reglas: `descuento > 0` exige motivo (`400 fields.descuentoMotivo` "Escribí el motivo del descuento."); motivo sin
  descuento es `400` ("Sin descuento no va motivo."); `monto + descuento` no puede pasar 99.999.999 (`fields.descuento`);
  el descuento es parte del cobro: solo en turnos completados y se borra si el turno sale de completado.
- Permisos: solo quien ve importes (admin, superadmin). El empleado: `403 FORBIDDEN` "Con tu rol no podés cargar
  descuentos: lo carga un administrador." y nunca lo recibe (`null`).
- **Combos**: no hay entidad nueva. Se arman en el catálogo como servicios de categoría `"Combos"` (por ejemplo
  "Combo lavado + encerado" con su precio). En el panel aparecen agrupados por categoría como los demás.

Fixtures: `lavadoConDescuento`, `error400DescuentoSinMotivo`, `error403DescuentoEmpleado`, `patchDescuento`.

## 13. Fotos antes/después

**Estado: hecho** (2026-11-16; revisado tras la auditoría de seguridad: flujo con confirmación, conciliación del
bucket y rate limit. Tests en `backend/test/mejoras-fotos-permisos.test.ts`)

Supabase Storage, bucket **privado** `lavados-fotos` del proyecto de Buddys. El backend usa `SUPABASE_SECRET_KEY`
(solo en la cabecera `apikey`, nunca sale del servidor). Sin ella, la función queda apagada: el listado responde
`disponible: false` y pedir, confirmar o borrar responden `503 SERVICE_UNAVAILABLE` "Las fotos no están configuradas en el servidor.".

### Flujo exacto (tres pasos)

1. **Pedir la URL de subida**: `POST /api/admin/lavados/:id/fotos` `{ "tipo": "antes", "contentType": "image/webp", "tamano": 523000 }` →
   `201 { "foto": Foto (estado "pendiente"), "subida": { "url": "https://<proyecto>.supabase.co/storage/v1/object/upload/sign/lavados-fotos/<turno>/<foto>.webp?token=...", "metodo": "PUT", "headers": { "Content-Type": "image/webp" }, "venceEl": "<ISO, ahora + 2 h>" } }`.
   Rate limit propio: **20 cada 10 minutos por usuario** (`429 RATE_LIMITED` "Pediste demasiadas subidas de fotos seguidas. Esperá unos minutos.").
2. **Subir**: el panel hace `PUT <subida.url>` con el archivo como cuerpo y la cabecera `Content-Type` de `subida.headers`
   (directo a Supabase, sin pasar por el backend). El token vale hasta `venceEl` (2 horas, lo fija Supabase).
3. **Confirmar**: `POST /api/admin/lavados/:id/fotos/:fotoId/confirmar` (sin body) → `200 { "foto": Foto (estado "lista") }`.
   El backend pregunta a Storage (HEAD) por el objeto: tiene que existir, ser del `contentType` pedido y pesar de 1 byte a 1,5 MB.
   - `409 CONFLICT` "Todavía no subiste la foto: subila y volvé a confirmar." (el objeto no está; se puede reintentar).
   - `409 CONFLICT` "La subida venció: pedí otra." (pasó `venceEl`; la foto pendiente se borra).
   - `400 VALIDATION_ERROR` "La foto subida no es válida (tiene que ser JPG o WebP de hasta 1,5 MB): pedí otra subida." (se borran la foto y el objeto).
   - `403 FORBIDDEN` "Solo puede confirmar la foto quien la subió." (admin y superadmin pueden confirmar cualquiera).
   - Una foto que ya está "lista" se devuelve igual (idempotente).

- `GET /api/admin/lavados/:id/fotos` → `{ "disponible": true, "fotos": [Foto + { "url": "<lectura firmada, 5 minutos>" }] }`:
  **solo las "lista"** (las pendientes no se muestran).
- `DELETE /api/admin/lavados/:id/fotos/:fotoId` → `204` (pendiente o lista).
- `Foto`: `{ id, tipo: "antes" | "despues", contentType, tamano, estado: "pendiente" | "lista", creadaPor: { id, nombre } | null, createdAt }`.
- Límites: `image/jpeg` o `image/webp`, hasta 1,5 MB (1.572.864 bytes; el panel las achica antes), hasta 6 por
  turno/lavado **contando las pendientes** (`409 CONFLICT` "Ya hay 6 fotos en este lavado: borrá una para subir otra.").
- Permisos `fotos.subir` (todos los roles, en cualquier turno o lavado) y `fotos.borrar` (admin y superadmin siempre;
  el empleado, la que subió él, hasta 5 minutos después: `403 FORBIDDEN`).

### Objetos huérfanos (auditoría de seguridad)

El token de subida sigue valiendo 2 horas aunque se borre la foto o el turno. Por eso:
- Todo borrado de una foto (también en cascada al borrar un turno o deshacer un lavado) deja su objeto anotado en
  `buddys.fotos_a_borrar` con `borrar_desde` = el vencimiento de su token (trigger de la base). El objeto además se
  borra enseguida, sin esperar.
- **Conciliación** (`FotoService.conciliar`, al arrancar el servidor y cada hora con un timer que no retiene el proceso):
  1) borra las fotos pendientes cuyo token venció; 2) borra del bucket los objetos anotados cuyo `borrar_desde` ya pasó
  (si alguien volvió a subir con un token viejo, desaparece); 3) borra los objetos del bucket que la base no conoce y
  tienen más de 2 horas. En el log, solo cantidades.

Si Storage no responde: `503 SERVICE_UNAVAILABLE` "No pudimos hablar con el almacenamiento de fotos. Probá de nuevo en
unos minutos." (al pedir la subida no queda la foto). En el listado, una foto cuya lectura no se pudo firmar sale con
`url: null`. `404 NOT_FOUND` "No encontramos esa foto." si no es de ese turno.

Fixtures: `fotoSubida` (pendiente), `fotoConfirmada`, `fotosLista`, `error409FotosMaximo`, `error400FotoTipo`, `error403FotoBorrarAjena` (con un Storage falso).

## 14. Clientes frecuentes (tarjeta de sellos) e inactivos

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- `GET /api/admin/fidelizacion` (todos los roles) → `{ "config": { "sellosCada": 10, "premio": "gratis", "premioPorcentaje": null, "inactivosDias": 30, "updatedAt" } }`.
- `PUT /api/admin/fidelizacion` (solo superadmin) `{ sellosCada (2 a 50), premio ("gratis" | "descuento"), premioPorcentaje (1 a 99, obligatorio con "descuento"), inactivosDias (7 a 365) }` → `{ "config" }`.
- Progreso: `cliente.sellos` en el historial (función 6). Cada `sellosCada` visitas completadas, la siguiente es el
  premio: `sellos = visitas mod (sellosCada + 1)`; `proximoEsPremio = sellos == sellosCada`; `faltan = sellosCada - sellos`.
  El cliente se identifica por teléfono o, si no tiene, por patente. El premio se aplica en el cobro (monto 0 o el
  descuento, con motivo "Tarjeta de sellos").
- `GET /api/admin/clientes/inactivos?dias=&limit=&offset=` (admin y superadmin) → `{ "dias": 30, "clientes": [{ "telefonoWhatsapp", "nombre", "vehiculoModelo", "visitas", "ultimaVisita", "diasSinVenir", "whatsapp" }], "total" }`:
  clientes **con teléfono** cuya última visita completada fue hace `dias` o más (por defecto la config), el que hace
  más que no viene primero. Nombre y vehículo salen del último trabajo **completado** (nunca de un pedido web sin
  completar). `whatsapp` = link wa.me con: `Hola Juan! Hace un tiempo que no te vemos por Buddys Wash
  Detail. ¿Le damos una mano a tu Gol? Te esperamos.`
- Errores: `400` (`fields.*`), `403 FORBIDDEN`.

Fixtures: `fidelizacionGet`, `fidelizacionPut`, `error403FidelizacionAdmin`, `clientesInactivos`, `error403InactivosEmpleado`.

## 15. Insumos que se descuentan solos

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

- Receta por servicio (tabla `servicio_insumos`): `GET /api/admin/servicios/:id/insumos` (todos los roles) y
  `PUT /api/admin/servicios/:id/insumos` (`inventario.gestionar`) `{ "insumos": [{ "insumoId", "cantidad", "cantidadSuv"?, "cantidadPickup"?, "cantidadMoto"? }] }`
  (hasta 20; `null` = usa `cantidad`) → `{ "servicioId", "insumos": [{ insumoId, nombre, unidad, cantidad, cantidadSuv, cantidadPickup, cantidadMoto, stock, bajoStock }] }`.
- Al registrar un lavado o completar un turno, se descuentan solos (movimientos `uso` con `automatico: true` y
  `turnoId`); si sale de completado, se borra/deshace o le cambian los servicios, se devuelven (movimiento `ajuste`
  positivo, también `automatico`). Si no alcanza el stock se descuenta lo que hay (nunca negativo) y nunca frena el
  lavado.
- Movimientos: suman la clave `automatico: boolean`.
- Poco stock: se reusa lo existente: `stockMinimo`, el flag `bajoStock` de cada insumo, `GET /api/admin/insumos?bajoStock=true`
  y el contador `bajoStock` del listado.

Errores: `403` "Con tu rol no podés cambiar qué insumos usa un servicio."; `404` "No encontramos ese servicio."; `400 fields.insumos` "Elegí insumos activos del inventario." (o repetidos, o más de 20).

Fixtures: `recetaPut`, `recetaGet`, `error403RecetaEmpleado`, `movimientosAutomaticos`.

## 16. Exportar a CSV (Excel es-AR)

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

UTF-8 con BOM, separador `;`, coma decimal, fin de línea `\r\n`, `Content-Type: text/csv; charset=utf-8` y
`Content-Disposition: attachment; filename="..."`. Los textos que empiezan con `= + - @` llevan un `'` adelante
(contra la inyección de fórmulas). Permiso `finanzas.exportar` (admin y superadmin; empleado `403` "Con tu rol no podés exportar: los archivos llevan importes."). Usa el mismo rate limit que los PDF. Rango `desde`/`hasta`
obligatorio, hasta 366 días.

- `GET /api/admin/exportar/planilla.csv?desde=&hasta=`: un renglón por turno o lavado no cancelado.
- `GET /api/admin/exportar/gastos.csv?desde=&hasta=`: gastos sueltos + fijos imputados (columna Origen).
- `GET /api/admin/exportar/estadisticas.csv?desde=&hasta=`: resumen del período, serie, por servicio, por trabajador
  y gastos por categoría (bloques separados por un renglón vacío).

## 26. Errores del frontend

**Estado: hecho** (2026-11-16; tests en `backend/test/mejoras-*.test.ts`)

Fixtures: `errorClienteRegistrado`, `error400ErrorCliente`.

- `POST /api/admin/errores-cliente` (con sesión) y `POST /api/errores-cliente` (sin sesión, para el login) con
  `{ "mensaje" (1 a 1000), "stack"? (hasta 8000), "url" (hasta 2000), "userAgent" (hasta 500), "version"? (hasta 40) }` → `204`.
- No se guarda en la base: se loguea una línea `WARN Error del panel ...` recortada (mensaje 200, stack 3 renglones,
  solo el path de la URL, sin query) y sin datos personales (emails, números de 6+ dígitos y tokens se reemplazan).
- Rate limit: con sesión 30 cada 10 minutos por usuario; sin sesión 5 cada 15 minutos por IP (`429 RATE_LIMITED`).
- Errores: `400 VALIDATION_ERROR`, `429`.

## Fixtures generales

`permisosAdminMejoras` (la matriz completa con las capacidades nuevas), `estadisticasConFijos` (con `periodo.gastosFijos` y `periodo.descuentos`), `error403ExportarEmpleado`.

## Dudas y decisiones abiertas

- **Lavado sin monto**: se avisa al registrarlo (no a fin del día). Si el dueño prefiere un resumen nocturno, hace falta un cron (como el de recordatorios).
- **Gastos fijos**: editar el `monto` cambia todos los meses de vigencia (no hay historial de montos); el aumento se hace cerrando el ítem y creando otro.
- **Tarjeta de sellos**: no hay registro de canjes; el progreso sale de la cantidad de visitas completadas (`visitas mod (sellosCada + 1)`). Cambiar `sellosCada` reacomoda las tarjetas de todos.
- **Inactivos**: solo clientes con teléfono (sin teléfono no hay a quién escribir); un cliente con un turno pendiente o confirmado de hoy en adelante no cuenta.
- **Fotos**: la URL de subida de Supabase vale 2 horas (lo fija Supabase, no se puede acortar). La foto se registra al pedir la URL: si la subida no se completa, queda una fila sin archivo hasta que se borra. El panel tiene que permitir `https://<proyecto>.supabase.co` en su CSP (`img-src` y `connect-src`).
- **Caja**: "esperado" suma también señas y saldos de turnos (no solo `porFormaPago` de la planilla de lavados), porque es la plata que entra ese día.

## Permisos nuevos (`CAPACIDADES`)

| Capacidad | superadmin | admin | empleado |
|---|---|---|---|
| `lavados.etapa` | sí | sí | parcial: sus lavados |
| `turnos.crear` | sí | sí | no |
| `clientes.inactivos` | sí | sí | no |
| `fidelizacion.configurar` | sí | no | no |
| `finanzas.gastos_fijos` | sí | parcial: solo verlos | no |
| `caja.cerrar` | sí | sí | no |
| `caja.reabrir` | sí | no | no |
| `fotos.subir` | sí | sí | sí |
| `fotos.borrar` | sí | sí | parcial: la suya, 5 minutos |
| `finanzas.exportar` | sí | sí | no |
| `push.equipo` (recibir los avisos del encargado) | sí | sí | no |

## Tablas y columnas nuevas (migraciones desde 20261115100000)

Ver la sección Migraciones del README del backend (nombres, orden y cuál es la de Storage).
