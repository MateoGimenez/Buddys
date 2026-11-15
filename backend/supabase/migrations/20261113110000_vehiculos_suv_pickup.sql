-- =====================================================================================================
-- Buddys: tipos de vehículo auto, suv, pickup y moto (reemplazan a "camioneta") y categoría de cada servicio.
--
-- Decisión del dueño: "camioneta" se parte en dos tipos, SUV y Pick-up, con precio y duración propios. Orden canónico:
-- auto, suv, pickup, moto (nombres visibles: Auto, SUV, Pick-up, Moto).
--
--  - servicios.precio_desde_suv (copia de precio_desde_camioneta) y servicios.precio_desde_pickup (null = "Consultá",
--    nunca cae al de auto), mismo CHECK de rango que los demás precios.
--  - servicios.duracion_suv (copia de duracion_estimada_camioneta) y servicios.duracion_pickup (null = usa la de auto),
--    mismo CHECK que las demás duraciones.
--  - Se borran precio_desde_camioneta y duracion_estimada_camioneta (con sus CHECK y sus GRANT por columna).
--  - servicios.categoria text null (1 a 40 caracteres): para agrupar el catálogo en el panel ("Lavado", "Pulido"...).
--  - Datos: 'camioneta' pasa a 'suv' en bookings.vehiculo_tipo y en servicios.vehiculos. Los CHECK
--    (bookings_vehiculo_tipo_valido y la función servicio_vehiculos_valido) pasan a los cuatro tipos nuevos, y el
--    default de servicios.vehiculos, a los cuatro.
--  - presupuestos.vehiculo y comprobantes.vehiculo son texto libre (lo que escribió el taller o una foto del momento):
--    no se tocan. Un comprobante viejo que dice "Camioneta" sigue diciendo lo que decía cuando se emitió.
--
-- Corregir datos no es un cambio para el cliente: los UPDATE de esta migración no mueven updated_at (el "actualizado
-- el" del seguimiento y del catálogo). Por eso los triggers de updated_at se apagan solo mientras corren y se vuelven a
-- prender al final, dentro de la misma transacción de la migración.
--
-- Rompe la compatibilidad con el backend anterior (que lee las columnas de camioneta): se despliega junto con el
-- backend nuevo. Idempotente (se puede correr dos veces). No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- servicios: columnas nuevas y sus CHECK (drop + add para que una segunda corrida no falle)
-- -----------------------------------------------------------------------------------------------------
alter table buddys.servicios
  add column if not exists precio_desde_suv integer,
  add column if not exists precio_desde_pickup integer,
  add column if not exists duracion_suv text,
  add column if not exists duracion_pickup text,
  add column if not exists categoria text;

alter table buddys.servicios
  drop constraint if exists servicios_precio_suv_rango,
  drop constraint if exists servicios_precio_pickup_rango,
  drop constraint if exists servicios_duracion_suv_valida,
  drop constraint if exists servicios_duracion_pickup_valida,
  drop constraint if exists servicios_categoria_valida;

alter table buddys.servicios
  add constraint servicios_precio_suv_rango check (precio_desde_suv between 0 and 99999999),
  add constraint servicios_precio_pickup_rango check (precio_desde_pickup between 0 and 99999999),
  add constraint servicios_duracion_suv_valida check (char_length(btrim(duracion_suv)) between 1 and 60),
  add constraint servicios_duracion_pickup_valida check (char_length(btrim(duracion_pickup)) between 1 and 60),
  add constraint servicios_categoria_valida check (char_length(btrim(categoria)) between 1 and 40);

comment on column buddys.servicios.precio_desde_suv is
  'Precio orientativo en ARS para SUV, entero (0 a 99.999.999). Null = "Consultá" (nunca cae al de auto).';
comment on column buddys.servicios.precio_desde_pickup is
  'Precio orientativo en ARS para PICK-UP, entero (0 a 99.999.999). Null = "Consultá" (nunca cae al de auto).';
comment on column buddys.servicios.duracion_suv is
  'Duración estimada para SUV, texto libre (1 a 60 caracteres). Null = usa la de auto.';
comment on column buddys.servicios.duracion_pickup is
  'Duración estimada para PICK-UP, texto libre (1 a 60 caracteres). Null = usa la de auto.';
comment on column buddys.servicios.categoria is
  'Grupo del servicio en el panel ("Lavado", "Pulido", "Motos"...), 1 a 40 caracteres. Null = sin categoría.';

-- -----------------------------------------------------------------------------------------------------
-- Datos: sin mover updated_at (los triggers se prenden de nuevo más abajo)
-- -----------------------------------------------------------------------------------------------------
alter table buddys.servicios disable trigger servicios_set_updated_at;
alter table buddys.bookings disable trigger bookings_set_updated_at;

-- Precio y duración de camioneta pasan a SUV. Solo si las columnas viejas siguen ahí (en una segunda corrida ya no
-- existen: el bloque no hace nada). plpgsql planifica cada sentencia recién al ejecutarla, así que no falla si faltan.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'buddys' and table_name = 'servicios' and column_name = 'precio_desde_camioneta'
  ) then
    update buddys.servicios set precio_desde_suv = precio_desde_camioneta
    where precio_desde_suv is distinct from precio_desde_camioneta;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'buddys' and table_name = 'servicios' and column_name = 'duracion_estimada_camioneta'
  ) then
    update buddys.servicios set duracion_suv = duracion_estimada_camioneta
    where duracion_suv is distinct from duracion_estimada_camioneta;
  end if;
end;
$$;

-- servicios.vehiculos: primero se saca el CHECK (con la función vieja 'suv' no pasaría), después se cambian los datos y
-- la función, y al final vuelve el CHECK (que valida todas las filas).
alter table buddys.servicios drop constraint if exists servicios_vehiculos_valido;

-- array_replace conserva la posición: auto, camioneta, moto queda auto, suv, moto (sigue en orden canónico).
update buddys.servicios set vehiculos = pg_catalog.array_replace(vehiculos, 'camioneta', 'suv')
where 'camioneta' = any (vehiculos);

create or replace function buddys.servicio_vehiculos_valido(valor text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select valor is not null
    and pg_catalog.cardinality(valor) between 1 and 4
    and valor <@ array['auto', 'suv', 'pickup', 'moto']::text[]
    and (select pg_catalog.count(distinct v) from pg_catalog.unnest(valor) as u(v)) = pg_catalog.cardinality(valor)
$$;

comment on function buddys.servicio_vehiculos_valido(text[]) is
  'CHECK de servicios.vehiculos: de 1 a 4 tipos, sin repetidos, todos de auto, suv, pickup o moto.';

revoke all on function buddys.servicio_vehiculos_valido(text[]) from public, anon, authenticated, service_role;
grant execute on function buddys.servicio_vehiculos_valido(text[]) to buddys_app;

alter table buddys.servicios
  add constraint servicios_vehiculos_valido check (buddys.servicio_vehiculos_valido(vehiculos));

alter table buddys.servicios alter column vehiculos set default array['auto', 'suv', 'pickup', 'moto'];

comment on column buddys.servicios.vehiculos is
  'Tipos de vehículo para los que se ofrece el servicio (auto, suv, pickup, moto): de 1 a 4, sin repetidos.';

-- bookings.vehiculo_tipo: mismo orden (sin CHECK, datos, CHECK nuevo).
alter table buddys.bookings drop constraint if exists bookings_vehiculo_tipo_valido;

update buddys.bookings set vehiculo_tipo = 'suv' where vehiculo_tipo = 'camioneta';

alter table buddys.bookings
  add constraint bookings_vehiculo_tipo_valido check (vehiculo_tipo in ('auto', 'suv', 'pickup', 'moto'));

alter table buddys.bookings enable trigger bookings_set_updated_at;
alter table buddys.servicios enable trigger servicios_set_updated_at;

-- -----------------------------------------------------------------------------------------------------
-- Columnas de camioneta: DROP COLUMN se lleva sus CHECK y sus GRANT por columna.
-- -----------------------------------------------------------------------------------------------------
alter table buddys.servicios
  drop column if exists precio_desde_camioneta,
  drop column if exists duracion_estimada_camioneta;

-- -----------------------------------------------------------------------------------------------------
-- Privilegios: mismo modelo que los demás precios y duraciones (GRANT por columna; las policies servicios_app_insert
-- y servicios_app_update ya cubren toda la fila). Se repite el REVOKE a los roles de la API (defensa en profundidad).
-- -----------------------------------------------------------------------------------------------------
alter table buddys.servicios enable row level security;
alter table buddys.bookings enable row level security;
revoke all on buddys.servicios from public, anon, authenticated, service_role;
revoke all on buddys.bookings from public, anon, authenticated, service_role;

grant insert (precio_desde_suv, precio_desde_pickup, duracion_suv, duracion_pickup, categoria)
  on buddys.servicios to buddys_app;
grant update (precio_desde_suv, precio_desde_pickup, duracion_suv, duracion_pickup, categoria)
  on buddys.servicios to buddys_app;
