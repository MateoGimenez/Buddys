# 05 — Sacar la competencia y pasar a seguimiento

Fecha: 2026-11-17 · Objetivo C · Rama `feature/usuarios-perfil-stock`

## Pedido

Un usuario del cliente contó que **todos hacen todo** y que varias personas lavan el mismo auto, así que el ranking
"Quién lavó más" ya no sirve.

- Quitar el ranking de la Planilla y de Números, y cualquier estadística que compare personas. **No se borran datos de la base.**
- Cada lavado muestra **"Registrado por: [nombre]"**.
- Actualizar `PRODUCT.md` (la parte de Positioning que habla de competir) y los tests que dependen del ranking.

## Decisiones del dueño (2026-11-17)

1. **Cada empleado tiene su cuenta** y se ve quién registró cada auto. No se marca "quiénes trabajaron".
2. **Solo "Registrado por"**: de la UI se va el selector "Quién lo lavó" (en Registrar y en la corrección de la
   Planilla) y la línea "Lavó: X". El dato `trabajador_id` queda en la base como está.
3. **El ranking también sale de la API**: deja de calcularse y de mandarse. Así nadie lo vuelve a mostrar sin querer.

Las **metas mensuales** se quedan: son de ingresos del taller y no comparan personas. **"Mis trabajos"** (las estadísticas
propias de cada uno) también se queda: es personal y no compara.

## API

### Lavados y turnos: `registradoPor`

Todo objeto `Booking` que devuelve el panel (lavados, turnos, agenda, PATCH) suma:

```json
"registradoPor": { "id": "5f0c2a3e-...", "nombre": "Lucía" }
```

- Es `null` cuando el lavado o turno no tiene quién lo registró (los turnos de la web, o un perfil que se borró antes de
  la migración del objetivo A).
- `nombre` sale igual que el de `trabajador`: el nombre de la persona o, si no tiene, su email. A alguien dado de baja
  (objetivo A) se lo sigue mostrando por su nombre.
- El empleado también lo recibe: es un nombre, no un importe.
- `trabajador` sigue en el JSON, sin cambios. La UI deja de mostrarlo.

### `GET /api/admin/lavados?fecha=`

**Sale `resumen.porTrabajador`.** El resto del resumen queda igual: `cantidad`, `total`, `sinMonto` y `porFormaPago`.

### `GET /api/admin/estadisticas`

**Salen `porTrabajador` y `completadosSinTrabajador`.** Se borra la consulta del repositorio (`porTrabajador`) junto con su tipo.

### `GET /api/admin/estadisticas/mias`

"Mis trabajos" pasa a contar **lo que registré**: los turnos completados con `registrado_por = yo`, y además los que
tienen `registrado_por` en null y `trabajador_id = yo` (los turnos de la web que completé). Mismo JSON, sin importes.
Hace falta comprobar que la consulta usa los índices parciales de `registrado_por` y `trabajador_id` (`EXPLAIN`).

### `POST /api/admin/lavados` y `PATCH /api/admin/bookings/:id`

**La API no cambia**: `trabajadorId` se sigue aceptando, para no romper clientes viejos, y por defecto es quien
registra. La UI deja de mandarlo.

### Permisos (`CAPACIDADES`)

- `lavados.registrar`: el texto pasa a *"Registrar un lavado de mostrador (servicios, vehículo, cobro y forma de pago)"*
  y el matiz del empleado queda en *"Queda registrado a su nombre; carga el monto al registrarlo, pero después no lo ve
  ni lo corrige (tampoco ve los precios de lista)"*.
- `estadisticas.completas`: *"Ver las estadísticas del taller, con importes"* (sin "de todo el equipo").
- `estadisticas.propias`: *"Ver los trabajos que uno mismo registró, sin importes"*.
- `cobro.corregir`: sale "el trabajador" del texto.

## Frontend

- **Planilla**: sale el bloque "Quién lavó más", con su animación FLIP y la variable `lider`. Cada lavado muestra
  *Registrado por: **Lucía*** donde antes decía "Lavó:". Si viene `registradoPor: null`, se usa `trabajador`; si los dos
  son null, *Registrado por: sin dato*. Sale el selector "Quién lo lavó" de la corrección.
- **Registrar**: sale el selector "Quién lo lavó" (también para el admin). Tampoco se pide `GET /api/admin/trabajadores`
  solo para eso.
- **Números**: sale "Ranking del equipo" y cualquier mención a un líder. La descripción de la sección pasa a
  *"Ingresos, metas y seguimiento"*.
- `lib/movimiento.ts`: si `useFlip` queda sin uso, se borra junto con su test. Las clases `.ranking-*` de
  `styles.css` que queden sin uso también se borran.
- Pasada de **impeccable** (`critique` y `polish`) sobre Planilla y Números: que no quede un hueco donde estaba el ranking.

## Documentos

- `PRODUCT.md`:
  - **Users**: sacar "y el ranking del equipo" y "quién lavó".
  - **Product Purpose**: sacar "el ranking 'quién lavó más'". Pasa a hablar de seguimiento: cuántos lavados, quién
    registró cada uno, qué productos se gastan y qué falta comprar.
  - **Positioning**: *"No es un sistema de turnos ni una web pública: es la libreta del lavadero, llevada al celular, para
    seguir cuántos autos se lavan, quién registró cada uno y qué hay que reponer. No compara a las personas: en el
    lavadero todos hacen todo."*
- `README.md` (raíz): sacar "quién lava más" y el ranking (`porTrabajador`).
- `backend/README.md`: los contratos de lavados y estadísticas.

## Pruebas

- Hay que actualizar los tests que dependen del ranking: backend `lavados`, `estadisticas`, `integracion-objetivo8` y
  `lavado-varios-servicios`; frontend `planilla`, `movimiento` y `contrato`.
- Tests nuevos:
  - `porTrabajador` ya no está en ninguna respuesta.
  - `registradoPor` está en lavados y turnos, también para el empleado, y con el nombre de alguien dado de baja.
  - "Mis trabajos" cuenta lo que registré, incluidos los turnos web que completé.
- Hay que regenerar `backend/test/fixtures/respuestas-api.json` (`ACTUALIZAR_FIXTURES=1`) y copiarlo en
  `frontend/src/test/respuestas-reales.json`.

## Estado

- [x] Backend (buddys-backend) — 2026-11-18. `registradoPor` en todo Booking del panel (lavados, turnos, agenda,
  POST y PATCH), con la misma expresión de nombre que `trabajador`. Sale `resumen.porTrabajador` de lavados y
  `porTrabajador`/`completadosSinTrabajador` de estadísticas (consulta y tipo borrados). "Mis trabajos" cuenta
  `registrado_por = yo` OR (`registrado_por IS NULL AND trabajador_id = yo`): EXPLAIN con 6000 filas da BitmapOr sobre
  `bookings_registrado_por_idx` y `bookings_trabajador_id_idx` (test en `estadisticas.test.ts`), sin índice nuevo ni
  migración. Textos de `CAPACIDADES` del contrato. Fixtures regenerados.
  **Cambio pedido después (auditoría de seguridad del objetivo A, M1):** el `nombre` de `trabajador` y `registradoPor`,
  cuando la persona no tiene nombre, es la parte del email **antes de la @** (nunca el email entero, que también le
  llega al empleado). Esto reemplaza el "si no tiene, su email" de la sección API.
- [x] Frontend (buddys-frontend) — 2026-11-18. Planilla sin "Quién lavó más", sin FLIP ni `lider`; cada lavado dice
  "Registrado por: X" (fallback `trabajador`, después "sin dato"); la corrección ya no tiene "Quién lo lavó".
  Registrar sin el selector (muestra "Registrado por: Vos, X") y sin pedir `/api/admin/trabajadores`. Números sin
  "Ranking del equipo"; la sección se describe "Ingresos, metas y seguimiento". `useFlip` y `.ranking-*` borrados
  (`lib/movimiento.ts` queda: `useContador` lo sigue usando). Pasada de impeccable (critique y polish) sobre Planilla y
  Números.
- [x] Documentos (`PRODUCT.md` y READMEs) — 2026-11-18.
- [x] Pruebas (buddys-pruebas) — 2026-11-18. Backend antes: 54 archivos / 844 tests en verde, typecheck y lint OK.
  Después: lo del C en verde (13 archivos, 262 tests); la corrida completa tiene 6 fallas que son todas del objetivo B en
  curso (`fotoVersion` y la capacidad `perfil.editar` en `auth`, `usuarios`, `repositories.contract` y el fixture de
  `integracion-objetivo8`), igual que los errores de `tsc` en `test/usuarios.test.ts`: se regeneran cuando cierre el B.
  Frontend: los dos typecheck (`tsconfig.app.json` y `tsconfig.node.json`), lint, 135 tests y build en verde.
  Contrato: ninguna diferencia del C; `registradoPor` está en los 40 Booking del fixture y en los 22 de
  `respuestas-reales.json`, sin `porTrabajador` ni emails, y el empleado sin montos. El grep de `porTrabajador`, `ranking`
  y "lavó más" solo encuentra tests y comentarios que dicen que ya no está. Tests nuevos en `test/seguimiento-bordes.test.ts`:
  `registradoPor` en el historial de cliente (`?cliente=`) y en la búsqueda (`?q=`) para el empleado, y nunca en
  `/api/turnos/:id` ni en `POST /api/bookings`; una baja real de alguien sin nombre (se ve lo de antes de la @, nunca el
  email ni `baja+`); "Mis trabajos" el 31/12 a las 23:30 con el servidor en UTC (cuenta diciembre, incluido un turno web
  que completé, y no cuenta dos veces lo que registré con otro trabajador), el cambio de año, un 29/02 y sin importes; y
  `trabajadorId` en `POST /api/admin/lavados` (compatibilidad). Sin migración. No hubo errores que arreglar.
- [x] Seguridad (buddys-seguridad): sin críticos, altos ni medios. Corregido el comentario de routes/admin-estadisticas.ts. Pendiente menor: 9 avisos moderados de minimatch en dependencias de desarrollo (no llegan a producción).
