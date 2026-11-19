# 06 — Lavados, consumo de productos y stock con avisos

Fecha: 2026-11-17 · Objetivo D · Rama `feature/usuarios-perfil-stock`

## Pedido

Seguir **cuántos lavados se hacen, qué productos se gastan, qué hay en stock y qué falta comprar**, aprovechando
`buddys.insumos`, `buddys.movimientos_stock` y los avisos push que ya existen.

- **Receta por servicio** (y por tipo de vehículo): qué insumos usa y cuánto de cada uno.
- **Descuento automático** al registrar un lavado, en la misma transacción. Si se deshace el lavado, el stock vuelve.
- **Avisos**: cuando un insumo llega a su `stock_minimo` o queda por debajo, llega un push a admins y superadmins, y el
  header muestra una campanita con el número.
- **Para comprar**: los insumos bajos con la cantidad sugerida, para compartir por WhatsApp o copiar como texto.
- **Resumen**: lavados por día, semana y mes; consumo por insumo; costo de insumos por lavado. Solo lo ven admin y
  superadmin: el empleado nunca ve montos.
- Cargar una compra suma stock y queda registrada. **Esto ya existe** (`POST /api/admin/insumos/:id/movimientos`
  con `tipo: "compra"`, que también deja su gasto): se reutiliza.

## Reglas de negocio

1. **Qué receta se usa.** Para cada servicio del lavado, si hay renglones para su vehículo (`auto`, `suv`, `pickup` o
   `moto`), se usan esos. Si no, se usa la receta **general** del servicio (`vehiculo` = null). Si el lavado tiene varios
   servicios, se suman las cantidades por insumo. Los insumos inactivos se saltean.
2. **El stock nunca frena un lavado.** Registrar tiene que llevar menos de 10 segundos y no puede fallar porque falte
   shampoo. Si el stock no alcanza, se descuenta lo que hay (queda en 0) y el movimiento registra lo que **de verdad** se
   descontó, con la nota *"Faltaron 20 ml según la receta"*. Ese insumo queda bajo, así que se avisa.
3. **Todo en la misma transacción que el lavado**: los bloqueos `pg_advisory_xact_lock` por insumo (los mismos de
   `registrarMovimiento`, tomados **en orden de id** para que dos lavados no se traben entre sí), la resta y los movimientos
   `uso` con `turno_id` = el lavado y `perfil_id` = quien registra, con la nota *"Receta: Lavado completo"*. Si algo
   falla, no queda ni el lavado ni el descuento.
4. **Deshacer devuelve exactamente lo descontado.** Antes de borrar el lavado, y en la misma transacción, por cada
   movimiento `uso` de ese lavado se crea uno de tipo nuevo, **`devolucion`** (positivo), con la nota *"Lavado deshecho"*.
   Se hace antes del `DELETE` porque `movimientos_stock.turno_id` es `ON DELETE SET NULL`: después del borrado ya no se
   sabría qué movimientos eran de ese lavado.
5. **Corregir los servicios o el vehículo de un lavado de mostrador** (`PATCH /api/admin/bookings/:id`) recalcula el
   descuento en la misma transacción: se devuelve todo lo descontado antes y se descuenta según la receta nueva.
6. **Aviso de stock bajo, una sola vez por cruce.** Se avisa cuando un insumo pasa de `stock > stock_minimo` a
   `stock <= stock_minimo` (con `stock_minimo > 0`, la misma definición de `bajoStock` que ya existe), por cualquier
   salida: una receta, un uso manual o un ajuste. Hay una columna nueva `insumos.aviso_bajo_at`: se completa al avisar y
   vuelve a null cuando el stock sube por encima del mínimo (por una compra, una devolución, un ajuste o un cambio del
   mínimo). Mientras no sea null, no se repite el aviso. **El push se manda después del COMMIT y nunca hace fallar el
   pedido**, igual que el de turnos nuevos.
7. **Avisos solo a admin y superadmin activos**: a los dispositivos de esas personas (filtrando `push_suscripciones` por
   el rol del perfil). Texto: título *"Queda poco: Shampoo"*, cuerpo *"Hay 0,5 litro (mínimo 1 litro). Mirá la lista
   para comprar."*, URL `/insumos?ver=comprar`. Si en el mismo pedido bajan varios insumos, va un solo aviso:
   *"Quedan poco 3 insumos"*.
8. **Cantidad sugerida**: `max(2 × stock_minimo − stock, 0)`, redondeada hacia arriba a entero para las unidades
   contables (`unidad`, `par` y `caja`) y a 2 decimales para el resto.

## Base de datos (migración nueva `20261117120000_recetas_stock.sql`)

- `buddys.recetas`:
  - `id uuid` pk.
  - `servicio_id text` FK a servicios, `ON DELETE RESTRICT` (los servicios no se borran, se desactivan).
  - `vehiculo text null`, con CHECK `in ('auto','suv','pickup','moto')`.
  - `insumo_id uuid` FK a insumos, `RESTRICT`.
  - `cantidad numeric(12,2)` con CHECK `> 0 and <= 99999`.
  - `created_at` y `updated_at` (con el trigger `set_updated_at`).
  - Índice único `(servicio_id, coalesce(vehiculo, '*'), insumo_id)` e índice en `insumo_id`.
  - `buddys_app`: SELECT, INSERT, UPDATE (cantidad) y DELETE, con RLS y una policy por operación.
- `buddys.movimientos_stock`: el CHECK de `tipo` suma **`devolucion`** (con cantidad `> 0`). Hay que reemplazar el CHECK
  de tipo y el del signo, si existe.
- `buddys.insumos.aviso_bajo_at timestamptz null` + `GRANT UPDATE (aviso_bajo_at)`.
- Índice `movimientos_stock (turno_id) where turno_id is not null`, si todavía no existe. Lo usan el deshacer y la corrección.
- Índice para el resumen: `movimientos_stock (created_at) where tipo in ('uso','devolucion')`, o el que muestre `EXPLAIN`
  sobre miles de filas.

## API

Todas las rutas van detrás de la sesión, con los errores, el control CSRF y los `fields` de siempre.

### Recetas

- `GET /api/admin/recetas` (**todos los roles**: el empleado ve qué lleva cada servicio, **sin costos**). Responde
  `200 { "recetas": Receta[] }`, con una `Receta` por servicio que tenga renglones:

  ```json
  {
    "servicioId": "lavado-completo",
    "general": [{ "insumoId": "<uuid>", "nombre": "Shampoo", "unidad": "ml", "cantidad": 50 }],
    "porVehiculo": { "pickup": [{ "insumoId": "<uuid>", "nombre": "Shampoo", "unidad": "ml", "cantidad": 80 }] }
  }
  ```

  `porVehiculo` solo trae las claves que tienen renglones.
- `PUT /api/admin/servicios/:id/receta` (solo `admin` y `superadmin`, `inventario.gestionar`). Body
  `{ "vehiculo": null | "auto" | "suv" | "pickup" | "moto", "items": [{ "insumoId", "cantidad" }] }`: **reemplaza** esa
  variante, en una transacción. `items: []` la borra. Sin insumos repetidos y de 0 a 30 renglones. Responde
  `200 { "receta": Receta }` (la del servicio entero). Errores:
  - `404`: el servicio no existe.
  - `400`: en `fields["items.0.insumoId"]` *"Ese insumo no existe o está inactivo."*, un vehículo que el servicio no ofrece
    (`fields.vehiculo`) o una cantidad fuera de rango.
  - `403`: empleado.

### Lavados (el JSON no cambia)

- `POST /api/admin/lavados`: descuenta según las reglas 1, 2 y 3. La respuesta no cambia.
- `DELETE` de un lavado (deshacer): devuelve el stock (regla 4).
- `PATCH /api/admin/bookings/:id` sobre un lavado de mostrador, con `servicioIds` o con un cambio de vehículo: regla 5.

### Insumos

- `GET /api/admin/insumos/alertas` (solo `admin` y `superadmin`): `200 { "bajoStock": N, "insumos": [{ id, nombre,
  unidad, stock, stockMinimo }] }`, ordenados por qué tan lejos están del mínimo (`stock / stock_minimo` ascendente). Es
  liviano: la campanita lo pide al cargar, cada 60 s con la pestaña visible y al volver a ella.
- `GET /api/admin/insumos/para-comprar` (solo `admin` y `superadmin`):
  `200 { "items": [{ insumoId, nombre, categoria, unidad, stock, stockMinimo, sugerido, costoEstimado }], "costoTotalEstimado" }`.
  `costoEstimado` es `round(sugerido × costo_unitario)`, o `null` si no hay costo cargado. Van ordenados por categoría y nombre.
- Movimientos: el tipo `devolucion` aparece en `GET /api/admin/insumos/:id/movimientos`. **No se puede crear a mano**:
  `POST` con `tipo: "devolucion"` da `400`.
- Compras: sin cambios. Solo hay que sumar que una compra que deja el stock por encima del mínimo limpia `aviso_bajo_at`.

### `GET /api/admin/consumo?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (solo `admin` y `superadmin`)

Rango y errores como en `/estadisticas`: por defecto el mes actual de La Rioja y hasta 366 días. La serie es **por día**
hasta 62 días y por **semana** (de lunes a domingo, con la clave del lunes) hasta 200 días. Con más, por **mes**.

```json
{
  "rango": { "desde": "2026-11-01", "hasta": "2026-11-30", "agrupado": "dia" },
  "lavados": { "total": 182, "serie": [{ "clave": "2026-11-01", "cantidad": 6 }] },
  "porInsumo": [{ "insumoId": "<uuid>", "nombre": "Shampoo", "unidad": "ml", "consumido": 9100, "costo": 45500 }],
  "costoInsumos": 98000,
  "costoPorLavado": 538
}
```

- `lavados`: los lavados de mostrador **completados** en el rango (por `fecha_preferida`, como la planilla). La serie va
  con ceros en los días, semanas o meses sin lavados.
- `porInsumo.consumido`: la suma de `uso` (en positivo) menos las `devolucion`, por la **fecha del movimiento** en La
  Rioja. Incluye los usos manuales.
- `costo`: `round(consumido × costo_unitario actual)`, o `null` si no hay costo cargado. Se usa el costo de hoy porque no
  hay costo histórico por movimiento, y la UI lo aclara.
- `costoInsumos`: la suma de los costos que no son null.
- `costoPorLavado`: `round(costoInsumos / lavados.total)`, o `null` si no hubo lavados.
- Todas las agregaciones se hacen en SQL.
- Empleado: `403` antes de validar los parámetros.

### Permisos (`CAPACIDADES`)

- Capacidad nueva `inventario.recetas`: *"Definir qué insumos usa cada servicio"*, con superadmin `si`, admin `si` y
  empleado `no`. Ver las recetas entra en `inventario.ver`.
- Capacidad nueva `inventario.consumo`: *"Ver el consumo de insumos, la lista para comprar y los avisos de stock bajo"*,
  con superadmin `si`, admin `si` y empleado `no`.
- `push.activar`: el texto pasa a *"Activar los avisos en su propio dispositivo (turnos nuevos y, para admin y
  superadmin, stock bajo)"*.

## Frontend

- **Servicios**: en la edición de un servicio, un bloque **"Receta"** con la general y una pestaña por vehículo que el
  servicio ofrece. Cada renglón es un insumo (selector con búsqueda), una cantidad y la unidad. Se guarda cada variante
  por separado. El empleado la ve solo de lectura y sin costos.
- **Insumos** (pantalla existente), con tres vistas que se eligen arriba y quedan en la URL (`?ver=`):
  - **Stock**: lo de hoy.
  - **Para comprar**: la lista de lo bajo, con el sugerido de cada uno. Cada renglón tiene el botón **Cargar compra**,
    que abre la carga existente con la cantidad sugerida. Abajo, **Copiar** (portapapeles) y **Compartir por WhatsApp**
    (`navigator.share` si está, si no `https://wa.me/?text=<texto codificado>`). El texto, en el formato de abajo, va
    **sin precios** (es para el proveedor).
  - **Consumo** (admin): selector de mes, la cantidad de lavados con la serie, la tabla de consumo por insumo y el costo
    por lavado. Aclara que el costo es con el precio actual.

  Formato del texto para compartir:

  ```
  Para comprar — Buddys Wash Detail (17/11/2026)
  • Shampoo: 2 litros
  • Paños de microfibra: 10 unidades
  ```
- **Header**: una campanita con un contador (`aria-label="3 insumos con stock bajo"`) que lleva a `/insumos?ver=comprar`.
  Solo aparece para quien tiene `inventario.consumo`. Si es 0, la campanita está sin número y sin color de alerta.
- Pasada de **impeccable** (`critique`, `audit` y `polish`) sobre la receta, Para comprar, Consumo y la campanita.

## Pruebas que tienen que existir

- **Receta**: elige la del vehículo y si no la general; suma con varios servicios; saltea un insumo inactivo.
- **Lavado**: descuenta en la misma transacción (si el insert del lavado falla, el stock no cambia); con stock
  insuficiente queda en 0, el lavado se registra igual y el movimiento lleva la nota.
- **Concurrencia**: dos lavados a la vez sobre el mismo insumo dan el stock final correcto y no se traban.
- **Deshacer**: devuelve exactamente lo descontado, también si el stock había quedado en 0.
- **PATCH de servicios**: recalcula el descuento.
- **Avisos**: se avisa una vez al cruzar el mínimo; no se repite en el siguiente lavado; vuelve a avisar después de una
  compra que lo subió y de otro cruce; los destinatarios son solo admins y superadmins activos; el push falla y el lavado
  igual queda.
- **Para comprar**: el sugerido con unidades contables y con decimales.
- **Consumo**: los rangos de día, semana y mes con ceros; las devoluciones restan; `costo` null sin `costo_unitario`; el
  empleado recibe `403`; la semana del cambio de mes y de año.
- **Migración** sobre datos existentes en pglite: el CHECK nuevo, que no se puede crear `devolucion` desde la app a mano,
  y los permisos.
- **Frontend**: editor de receta, Para comprar (copiar y el texto exacto de WhatsApp), la campanita con 0 y con N, y
  Consumo sin montos para el empleado (que ni siquiera llega a la pantalla).

## Variables nuevas

Ninguna.

## Estado

- [x] Migración (buddys-base-de-datos)
- [ ] Backend (buddys-backend)
- [ ] Frontend (buddys-frontend)
- [ ] Pruebas (buddys-pruebas)
- [ ] Seguridad (buddys-seguridad)
