-- =====================================================================================================
-- Buddys: recetas por servicio, descuento automático de stock, devoluciones y aviso de stock bajo
-- (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md, secciones "Reglas de negocio" y "Base de datos").
--
--  - buddys.recetas: qué insumos usa cada servicio y cuánto. vehiculo null = receta general del servicio; con
--    vehiculo (auto, suv, pickup, moto) = la variante de ese vehículo, que reemplaza a la general (regla 1: la elige
--    el backend). servicio_id e insumo_id ON DELETE RESTRICT: ni los servicios ni los insumos se borran, se
--    desactivan (un insumo inactivo se saltea al descontar). cantidad numeric(12,2) en la unidad del insumo, > 0.
--    Índice único (servicio_id, coalesce(vehiculo, '*'), insumo_id): un insumo va una sola vez por variante (con
--    un UNIQUE común, dos renglones con vehiculo null no chocarían). Ese índice también sirve para leer la receta de
--    un servicio (columna inicial servicio_id). Índice en insumo_id para la FK (el RESTRICT lo recorre) y para
--    "en qué recetas está este insumo".
--  - buddys.movimientos_stock: nuevo tipo `devolucion` (cantidad > 0), el que crea el backend al deshacer o corregir
--    un lavado para devolver exactamente lo que la receta descontó (regla 4). Se reemplazan los CHECK
--    movimientos_stock_tipo_valido y movimientos_stock_signo con el MISMO nombre. La app puede insertarlo (ya tiene
--    INSERT por columna); que no se pueda crear a mano lo controla la API (400). Una devolución no lleva costo,
--    proveedor ni gasto: lo sigue obligando movimientos_stock_solo_compra_con_costo, que no cambia.
--  - buddys.movimientos_stock.origen text not null default 'manual', CHECK in ('manual','receta'): quién generó el
--    movimiento. 'receta' = los usos que descuenta la receta de un lavado y las devoluciones de esos usos (al
--    deshacer o corregir); 'manual' = todo lo demás (lo que se carga a mano por la API, el stock inicial, las
--    devoluciones de los usos manuales vinculados a un lavado). La corrección recalcula solo lo de origen 'receta':
--    así un uso manual con una nota que empiece igual ("Receta: ...") nunca se devuelve. La app lo puede insertar
--    (GRANT INSERT de la columna; nunca UPDATE). Que la API manual no lo ponga lo controla el backend (el esquema de
--    POST /api/admin/insumos/:id/movimientos no lo acepta y el INSERT manual no lo nombra: queda el default).
--  - buddys.insumos.aviso_bajo_at timestamptz null: cuándo se avisó que el insumo quedó bajo su mínimo. Se avisa en
--    cualquier salida que deje el stock bajo (stock_minimo > 0 y stock <= stock_minimo) si el stock bajó en ese
--    pedido y no había un aviso pendiente (aviso_bajo_at null). Mientras no sea null no se repite el aviso; vuelve a
--    null cuando el stock sube por encima del mínimo o cambia el mínimo (regla 6). Lo mantiene el backend (no hay
--    trigger: el push sale después del COMMIT y lo decide el servicio).
--  - Índices de movimientos_stock:
--      movimientos_stock_turno_idx (turno_id) WHERE turno_id IS NOT NULL: ya existe desde 20261028110000_inventario
--        (IF NOT EXISTS, no se recrea). Lo usan el deshacer y la corrección (los usos de un lavado).
--      movimientos_stock_consumo_idx (created_at) INCLUDE (insumo_id, cantidad) WHERE tipo IN ('uso','devolucion'):
--        el resumen GET /api/admin/consumo filtra por rango de created_at y esos dos tipos y suma cantidad por
--        insumo. EXPLAIN (ANALYZE, BUFFERS) sobre 30.000 movimientos en PGlite: con este índice, Index Only Scan
--        que lee 10 páginas para un mes y 70 para un año; sin él, recorre entero movimientos_stock_insumo_idx o
--        hace Seq Scan (unas 340 páginas en los dos casos, y crece con la tabla); con el mismo índice parcial sin
--        INCLUDE, Index Scan de 22 y 205 páginas (va al heap por insumo_id y cantidad). El WHERE lo deja chico (sin
--        compras ni ajustes). La serie de lavados no necesita índice nuevo: usa bookings_fecha_agenda_estado_idx.
--
-- Riesgo al aplicar sobre los datos actuales:
--  - CHECK: se borran y se vuelven a crear NOT VALID (no recorren la tabla; ACCESS EXCLUSIVE un instante) y después
--    VALIDATE CONSTRAINT (recorre movimientos_stock con SHARE UPDATE EXCLUSIVE: no frena lecturas ni escrituras).
--    Las filas existentes son compra, uso o ajuste y ya cumplen el signo viejo, que es un subconjunto del nuevo:
--    VALIDATE no puede fallar.
--  - ADD COLUMN aviso_bajo_at nullable y sin default: no reescribe insumos. Todas las filas quedan en null: los
--    insumos que HOY ya están bajos avisan en su próxima salida (un uso, una receta o un ajuste que baje el stock).
--  - ADD COLUMN origen not null default 'manual': con un default constante, Postgres 11+ no reescribe la tabla
--    (guarda el default en el catálogo; ACCESS EXCLUSIVE un instante). Todos los movimientos existentes quedan en
--    'manual': antes de esta migración no había recetas, así que ninguno vino de una.
--  - CREATE INDEX (no CONCURRENTLY, porque la migración corre en una transacción): toma SHARE en movimientos_stock
--    mientras se arma; con el volumen actual (pocos miles de filas) es cuestión de milisegundos. Frena escrituras
--    de stock en ese lapso, no lecturas.
--  - recetas es nueva: no hay filas; ningún lavado descuenta hasta que el dueño cargue recetas.
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS habilitado, REVOKE a public, anon, authenticated y
-- service_role, GRANT mínimo a buddys_app con una policy por operación USING/WITH CHECK (true):
--   recetas:  SELECT, INSERT (servicio_id, vehiculo, insumo_id, cantidad), UPDATE (cantidad, updated_at), DELETE
--             (PUT de una variante la reemplaza: borra e inserta en una transacción).
--   insumos:  se suma UPDATE (aviso_bajo_at). Los demás GRANT no cambian. Sigue sin DELETE.
--   movimientos_stock: se suma INSERT (origen). Sigue con SELECT e INSERT por columna; nunca UPDATE ni DELETE.
-- Trigger nuevo: recetas_set_updated_at (BEFORE UPDATE, la función buddys.set_updated_at existente, SECURITY
-- INVOKER y search_path vacío). No cambia ningún trigger existente.
--
-- Idempotente (se puede correr dos veces). No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- recetas
-- -----------------------------------------------------------------------------------------------------
create table if not exists buddys.recetas (
  id          uuid          primary key default gen_random_uuid(),
  servicio_id text          not null
                            constraint recetas_servicio_fkey
                              references buddys.servicios (id) on update restrict on delete restrict,
  vehiculo    text
                            constraint recetas_vehiculo_valido check (vehiculo in ('auto', 'suv', 'pickup', 'moto')),
  insumo_id   uuid          not null
                            constraint recetas_insumo_fkey
                              references buddys.insumos (id) on update restrict on delete restrict,
  cantidad    numeric(12,2) not null
                            constraint recetas_cantidad_rango check (cantidad > 0 and cantidad <= 99999),
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

comment on table buddys.recetas is
  'Insumos que usa cada servicio. vehiculo null = receta general; con vehiculo, la variante que la reemplaza.';
comment on column buddys.recetas.vehiculo is
  'auto, suv, pickup o moto: variante para ese vehículo. Null = receta general del servicio.';
comment on column buddys.recetas.cantidad is 'Cantidad por lavado, en la unidad del insumo (> 0, hasta 99999).';

-- Un insumo una sola vez por variante (null cuenta como la variante '*'). También sirve para WHERE servicio_id = ...
create unique index if not exists recetas_servicio_vehiculo_insumo_uidx
  on buddys.recetas (servicio_id, (coalesce(vehiculo, '*')), insumo_id);
-- FK insumo_id (el RESTRICT al borrar un insumo) y "en qué recetas está este insumo".
create index if not exists recetas_insumo_idx on buddys.recetas (insumo_id);

drop trigger if exists recetas_set_updated_at on buddys.recetas;
create trigger recetas_set_updated_at
  before update on buddys.recetas
  for each row execute function buddys.set_updated_at();

alter table buddys.recetas enable row level security;
revoke all on buddys.recetas from public, anon, authenticated, service_role;

grant select on buddys.recetas to buddys_app;
grant insert (servicio_id, vehiculo, insumo_id, cantidad) on buddys.recetas to buddys_app;
grant update (cantidad, updated_at) on buddys.recetas to buddys_app;
grant delete on buddys.recetas to buddys_app;

drop policy if exists recetas_app_select on buddys.recetas;
create policy recetas_app_select on buddys.recetas
  for select to buddys_app using (true);
drop policy if exists recetas_app_insert on buddys.recetas;
create policy recetas_app_insert on buddys.recetas
  for insert to buddys_app with check (true);
drop policy if exists recetas_app_update on buddys.recetas;
create policy recetas_app_update on buddys.recetas
  for update to buddys_app using (true) with check (true);
drop policy if exists recetas_app_delete on buddys.recetas;
create policy recetas_app_delete on buddys.recetas
  for delete to buddys_app using (true);

-- -----------------------------------------------------------------------------------------------------
-- movimientos_stock: tipo `devolucion` (cantidad > 0). Mismos nombres de constraint.
-- -----------------------------------------------------------------------------------------------------
alter table buddys.movimientos_stock drop constraint if exists movimientos_stock_tipo_valido;
alter table buddys.movimientos_stock
  add constraint movimientos_stock_tipo_valido
    check (tipo in ('compra', 'uso', 'ajuste', 'devolucion')) not valid;
alter table buddys.movimientos_stock validate constraint movimientos_stock_tipo_valido;

alter table buddys.movimientos_stock drop constraint if exists movimientos_stock_signo;
alter table buddys.movimientos_stock
  add constraint movimientos_stock_signo check (
    (tipo = 'compra' and cantidad > 0)
    or (tipo = 'uso' and cantidad < 0)
    or (tipo = 'ajuste' and cantidad <> 0)
    or (tipo = 'devolucion' and cantidad > 0)) not valid;
alter table buddys.movimientos_stock validate constraint movimientos_stock_signo;

-- Origen del movimiento: lo descontado por una receta (y su devolución) o todo lo demás. Nunca sale de la nota.
alter table buddys.movimientos_stock add column if not exists origen text not null default 'manual';
alter table buddys.movimientos_stock drop constraint if exists movimientos_stock_origen_valido;
alter table buddys.movimientos_stock
  add constraint movimientos_stock_origen_valido check (origen in ('manual', 'receta')) not valid;
alter table buddys.movimientos_stock validate constraint movimientos_stock_origen_valido;

comment on column buddys.movimientos_stock.origen is
  'receta = uso descontado por la receta de un lavado o su devolución; manual = todo lo demás. Lo pone el backend.';

revoke all on buddys.movimientos_stock from public, anon, authenticated, service_role;
grant insert (origen) on buddys.movimientos_stock to buddys_app;

comment on table buddys.movimientos_stock is
  'Historial del stock de cada insumo. cantidad con signo (compra +, uso -, ajuste +/-, devolucion +). Inmutable para la app.';

-- Los usos de un lavado (deshacer y corregir). Ya existe desde la migración de inventario: no se recrea.
create index if not exists movimientos_stock_turno_idx
  on buddys.movimientos_stock (turno_id) where turno_id is not null;

-- Resumen de consumo: rango de created_at, solo uso y devolucion, suma de cantidad por insumo (Index Only Scan).
create index if not exists movimientos_stock_consumo_idx
  on buddys.movimientos_stock (created_at) include (insumo_id, cantidad)
  where tipo in ('uso', 'devolucion');

-- -----------------------------------------------------------------------------------------------------
-- insumos.aviso_bajo_at
-- -----------------------------------------------------------------------------------------------------
alter table buddys.insumos add column if not exists aviso_bajo_at timestamptz;

comment on column buddys.insumos.aviso_bajo_at is
  'Cuándo se avisó que cruzó su stock mínimo. Null = no hay aviso pendiente (vuelve a null al subir por encima del mínimo).';

alter table buddys.insumos enable row level security;
revoke all on buddys.insumos from public, anon, authenticated, service_role;
grant update (aviso_bajo_at) on buddys.insumos to buddys_app;
