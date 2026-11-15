-- =====================================================================================================
-- Buddys: un lavado (un auto) con varios servicios.
--
-- Decisión del dueño: un mismo registro puede llevar de 1 a 10 servicios distintos (por ejemplo, "Limpieza Nivel II" +
-- "Limpieza de motor"). En el ranking del equipo y en la planilla cuenta como UN lavado; en "servicios más pedidos"
-- cuenta cada servicio.
--
--  - buddys.lavado_servicios (booking_id, servicio_id, orden, precio_lista): los servicios de cada turno o lavado, en
--    el orden en que se eligieron. orden 0 es el principal: el mismo que bookings.servicio_id (que se queda como está,
--    así todo lo que ya lo usaba sigue andando). precio_lista es una FOTO del precio de lista de ese servicio para el
--    vehículo del turno al momento de registrarlo (null si era "Consultá" o si no se conoce, como en los viejos).
--    booking_id ON DELETE CASCADE (borrar o deshacer un lavado se lleva sus servicios); servicio_id RESTRICT (un
--    servicio no se borra, se desactiva).
--  - buddys.precio_de_lista(servicio, vehiculo): el precio de lista vigente de un servicio para un tipo de vehículo
--    (auto = precio_desde; suv, pickup y moto, su columna; null = "Consultá", nunca cae al de auto). La usan el trigger
--    de abajo y el backend al guardar la lista.
--  - Trigger AFTER INSERT en bookings: todo turno nuevo (web, mostrador, un INSERT a mano o del backend anterior) nace
--    con su fila principal en lavado_servicios. El backend, cuando el lavado tiene más servicios, reemplaza la lista en
--    la misma transacción.
--  - Backfill: cada turno existente recibe su fila principal (precio_lista null: no se sabe cuánto valía entonces).
--  - buddys_app gana UPDATE de bookings.servicio_id: corregir los servicios de un turno (PATCH con servicioIds, quien
--    corrige el cobro) cambia también el principal.
--
-- Seguridad, mismo modelo que rol_app_minimo_privilegio y las migraciones siguientes: RLS habilitado, REVOKE a los
-- roles de la API de Supabase, GRANT mínimo a buddys_app con su policy USING/WITH CHECK (true):
--   lavado_servicios: SELECT, INSERT y DELETE (la lista se reemplaza entera: nunca UPDATE).
--
-- Idempotente (se puede correr dos veces). Tabla nueva: no reescribe nada. No se aplica a Supabase remoto sin pasar las
-- pruebas. Va después de 20261113110000_vehiculos_suv_pickup (usa las columnas de suv y pickup).
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- Precio de lista vigente de un servicio para un vehículo. STABLE (lee la tabla), SECURITY INVOKER y search_path vacío,
-- como las demás funciones del esquema: buddys_app la ejecuta con sus propios permisos (SELECT sobre servicios).
-- -----------------------------------------------------------------------------------------------------
create or replace function buddys.precio_de_lista(servicio text, vehiculo text)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case vehiculo
           when 'auto' then s.precio_desde
           when 'suv' then s.precio_desde_suv
           when 'pickup' then s.precio_desde_pickup
           when 'moto' then s.precio_desde_moto
         end
  from buddys.servicios s
  where s.id = servicio
$$;

comment on function buddys.precio_de_lista(text, text) is
  'Precio de lista vigente (ARS) de un servicio para auto, suv, pickup o moto. Null = "Consultá" o servicio inexistente.';

revoke all on function buddys.precio_de_lista(text, text) from public, anon, authenticated, service_role;
grant execute on function buddys.precio_de_lista(text, text) to buddys_app;

-- -----------------------------------------------------------------------------------------------------
-- lavado_servicios
-- -----------------------------------------------------------------------------------------------------
create table if not exists buddys.lavado_servicios (
  booking_id   uuid     not null
                        constraint lavado_servicios_booking_fkey
                          references buddys.bookings (id) on update restrict on delete cascade,
  servicio_id  text     not null
                        constraint lavado_servicios_servicio_fkey
                          references buddys.servicios (id) on update restrict on delete restrict,
  orden        smallint not null
                        constraint lavado_servicios_orden_rango check (orden between 0 and 9),
  precio_lista integer
                        constraint lavado_servicios_precio_rango check (precio_lista between 0 and 99999999),
  constraint lavado_servicios_pkey primary key (booking_id, servicio_id),
  constraint lavado_servicios_orden_unico unique (booking_id, orden)
);

comment on table buddys.lavado_servicios is
  'Servicios de cada turno o lavado (1 a 10), en el orden elegido. orden 0 = el principal (= bookings.servicio_id).';
comment on column buddys.lavado_servicios.orden is 'Posición en la lista, desde 0 (el principal).';
comment on column buddys.lavado_servicios.precio_lista is
  'Foto del precio de lista del servicio para el vehículo del turno al registrarlo (ARS). Null = "Consultá" o desconocido.';

-- La FK servicio_id (y las estadísticas por servicio: GROUP BY servicio_id). booking_id ya está cubierto por la PK.
create index if not exists lavado_servicios_servicio_idx on buddys.lavado_servicios (servicio_id);

-- -----------------------------------------------------------------------------------------------------
-- Cada turno nuevo nace con su servicio principal (orden 0) y la foto de su precio de lista. ON CONFLICT DO NOTHING:
-- si la fila ya está (no debería), no falla el alta. Corre con los permisos de quien inserta (buddys_app tiene INSERT
-- en lavado_servicios y EXECUTE en precio_de_lista); un trigger no necesita EXECUTE sobre su función.
-- -----------------------------------------------------------------------------------------------------
create or replace function buddys.lavado_servicio_principal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into buddys.lavado_servicios (booking_id, servicio_id, orden, precio_lista)
  values (new.id, new.servicio_id, 0, buddys.precio_de_lista(new.servicio_id, new.vehiculo_tipo))
  on conflict do nothing;
  return null;
end;
$$;

comment on function buddys.lavado_servicio_principal() is
  'Trigger AFTER INSERT en bookings: agrega el servicio principal (orden 0) en lavado_servicios con su precio de lista.';

revoke all on function buddys.lavado_servicio_principal() from public, anon, authenticated, service_role;

drop trigger if exists bookings_servicio_principal on buddys.bookings;
create trigger bookings_servicio_principal
  after insert on buddys.bookings
  for each row execute function buddys.lavado_servicio_principal();

-- -----------------------------------------------------------------------------------------------------
-- Backfill: cada turno existente con su único servicio (precio_lista null: no se sabe cuánto valía al registrarlo).
-- -----------------------------------------------------------------------------------------------------
insert into buddys.lavado_servicios (booking_id, servicio_id, orden, precio_lista)
select b.id, b.servicio_id, 0, null
from buddys.bookings b
on conflict do nothing;

-- -----------------------------------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------------------------------
alter table buddys.lavado_servicios enable row level security;
revoke all on buddys.lavado_servicios from public, anon, authenticated, service_role;
grant select, insert, delete on buddys.lavado_servicios to buddys_app;

drop policy if exists lavado_servicios_app_select on buddys.lavado_servicios;
drop policy if exists lavado_servicios_app_insert on buddys.lavado_servicios;
drop policy if exists lavado_servicios_app_delete on buddys.lavado_servicios;
create policy lavado_servicios_app_select on buddys.lavado_servicios
  for select to buddys_app using (true);
create policy lavado_servicios_app_insert on buddys.lavado_servicios
  for insert to buddys_app with check (true);
create policy lavado_servicios_app_delete on buddys.lavado_servicios
  for delete to buddys_app using (true);

-- Corregir los servicios de un turno cambia también el principal.
grant update (servicio_id) on buddys.bookings to buddys_app;
