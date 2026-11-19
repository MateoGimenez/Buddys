-- =====================================================================================================
-- Buddys: fotos antes/después de cada lavado o turno (contrato: reportes/2026-11-15_03_contrato-mejoras.md,
-- función 13). Esta migración es SOLO lo del esquema buddys; el bucket de Storage y sus policies van aparte, en
-- 20261115150000_storage_bucket_fotos.sql.
--
-- Flujo: pedir la URL firmada de subida (la fila nace 'pendiente', con subida_vence_at = created_at + 2 horas, lo que
-- vale el token de Supabase) -> el panel sube con PUT -> confirmar (el backend verifica en Storage que el objeto
-- existe, su tamaño y su tipo, y la pasa a 'lista'). Solo las 'lista' se muestran; las pendientes cuentan para el
-- tope de 6.
--
--  - buddys.lavado_fotos: una fila por foto. booking_id -> bookings ON DELETE CASCADE. tipo 'antes' | 'despues'. path
--    = la ruta del objeto en el bucket privado lavados-fotos (<booking>/<foto>.<ext>, única). content_type image/jpeg o
--    image/webp y tamano hasta 1,5 MB (1.572.864 bytes), los mismos límites que el bucket. estado 'pendiente' | 'lista'.
--    creado_por -> perfiles ON DELETE SET NULL. created_at lo pone el backend (su reloj cuenta los plazos).
--  - Hasta 6 fotos por turno (pendientes incluidas): el backend lo controla con un bloqueo por turno
--    (pg_advisory_xact_lock) y la cuenta en la misma transacción; el trigger lavado_fotos_maximo es la red de seguridad.
--  - buddys.fotos_a_borrar: objetos del bucket que hay que (volver a) borrar. Cada vez que se borra una fila de
--    lavado_fotos (una foto, o en cascada al borrar el turno), el trigger lavado_fotos_a_borrar anota su path con
--    borrar_desde = subida_vence_at: hasta entonces el token de subida todavía sirve y alguien podría volver a subir
--    el objeto. La conciliación del backend (al arrancar y cada hora) borra esos objetos cuando vence el plazo, las
--    pendientes vencidas y los objetos del bucket sin fila.
--  - Las URLs de subida y de lectura las firma el backend con la secret key (cortas). Nunca hay URLs públicas.
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS habilitado, REVOKE a los roles de la API de Supabase,
-- GRANT mínimo a buddys_app con su policy USING/WITH CHECK (true):
--   lavado_fotos:   SELECT, INSERT, DELETE y UPDATE solo de estado (una foto no se edita: se confirma).
--   fotos_a_borrar: SELECT, INSERT y DELETE.
--
-- Idempotente. Tablas nuevas: no reescriben nada. No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

create table if not exists buddys.lavado_fotos (
  id              uuid        primary key default gen_random_uuid(),
  booking_id      uuid        not null
                              constraint lavado_fotos_booking_fkey references buddys.bookings (id) on update restrict on delete cascade,
  tipo            text        not null constraint lavado_fotos_tipo_valido check (tipo in ('antes', 'despues')),
  path            text        not null
                              constraint lavado_fotos_path_unico unique
                              constraint lavado_fotos_path_formato check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  content_type    text        not null constraint lavado_fotos_tipo_contenido check (content_type in ('image/jpeg', 'image/webp')),
  tamano          integer     not null constraint lavado_fotos_tamano_rango check (tamano between 1 and 1572864),
  estado          text        not null default 'pendiente' constraint lavado_fotos_estado_valido check (estado in ('pendiente', 'lista')),
  creado_por      uuid        constraint lavado_fotos_creado_por_fkey references buddys.perfiles (id) on update restrict on delete set null,
  created_at      timestamptz not null default now(),
  subida_vence_at timestamptz not null default (now() + interval '2 hours'),
  constraint lavado_fotos_vence_despues check (subida_vence_at >= created_at)
);

comment on table buddys.lavado_fotos is
  'Fotos antes/después de un turno o lavado. El archivo vive en el bucket privado lavados-fotos (Supabase Storage).';
comment on column buddys.lavado_fotos.path is 'Ruta del objeto en el bucket lavados-fotos: <booking_id>/<id>.<jpg|webp>.';
comment on column buddys.lavado_fotos.estado is
  'pendiente = se pidió la URL de subida y falta confirmar; lista = el backend verificó el objeto en Storage.';
comment on column buddys.lavado_fotos.subida_vence_at is 'Hasta cuándo vale el token de subida (2 horas, lo fija Supabase).';

-- Las fotos de un turno, en orden (y la FK booking_id).
create index if not exists lavado_fotos_booking_idx on buddys.lavado_fotos (booking_id, created_at, id);
create index if not exists lavado_fotos_creado_por_idx on buddys.lavado_fotos (creado_por) where creado_por is not null;
-- La conciliación: pendientes vencidas.
create index if not exists lavado_fotos_pendientes_idx on buddys.lavado_fotos (subida_vence_at) where estado = 'pendiente';

-- Red de seguridad del máximo de 6 fotos por turno (el backend ya lo controla con un bloqueo).
create or replace function buddys.lavado_fotos_maximo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from buddys.lavado_fotos f where f.booking_id = new.booking_id) >= 6 then
    raise exception 'Máximo de 6 fotos por turno' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function buddys.lavado_fotos_maximo() is 'Trigger BEFORE INSERT: no más de 6 fotos por turno.';
revoke all on function buddys.lavado_fotos_maximo() from public, anon, authenticated, service_role;

drop trigger if exists lavado_fotos_maximo on buddys.lavado_fotos;
create trigger lavado_fotos_maximo
  before insert on buddys.lavado_fotos
  for each row execute function buddys.lavado_fotos_maximo();

-- -----------------------------------------------------------------------------------------------------
-- fotos_a_borrar: objetos del bucket que hay que (volver a) borrar cuando venza su token de subida.
-- -----------------------------------------------------------------------------------------------------
create table if not exists buddys.fotos_a_borrar (
  path         text        primary key
                           constraint fotos_a_borrar_path_formato check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  borrar_desde timestamptz not null,
  created_at   timestamptz not null default now()
);

comment on table buddys.fotos_a_borrar is
  'Objetos del bucket lavados-fotos de fotos ya borradas. La conciliación los borra de Storage desde borrar_desde.';

create index if not exists fotos_a_borrar_desde_idx on buddys.fotos_a_borrar (borrar_desde);

-- Toda fila de lavado_fotos que se borra (una foto o el turno entero, en cascada) deja su objeto anotado.
create or replace function buddys.lavado_fotos_a_borrar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into buddys.fotos_a_borrar (path, borrar_desde)
  values (old.path, old.subida_vence_at)
  on conflict (path) do update set borrar_desde = greatest(buddys.fotos_a_borrar.borrar_desde, excluded.borrar_desde);
  return null;
end;
$$;

comment on function buddys.lavado_fotos_a_borrar() is
  'Trigger AFTER DELETE en lavado_fotos: anota el objeto en fotos_a_borrar para que la conciliación lo borre.';
revoke all on function buddys.lavado_fotos_a_borrar() from public, anon, authenticated, service_role;

drop trigger if exists lavado_fotos_a_borrar on buddys.lavado_fotos;
create trigger lavado_fotos_a_borrar
  after delete on buddys.lavado_fotos
  for each row execute function buddys.lavado_fotos_a_borrar();

-- -----------------------------------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------------------------------
alter table buddys.lavado_fotos enable row level security;
revoke all on buddys.lavado_fotos from public, anon, authenticated, service_role;

grant select, delete on buddys.lavado_fotos to buddys_app;
grant insert (id, booking_id, tipo, path, content_type, tamano, creado_por, created_at, subida_vence_at)
  on buddys.lavado_fotos to buddys_app;
grant update (estado) on buddys.lavado_fotos to buddys_app;

drop policy if exists lavado_fotos_app_select on buddys.lavado_fotos;
drop policy if exists lavado_fotos_app_insert on buddys.lavado_fotos;
drop policy if exists lavado_fotos_app_update on buddys.lavado_fotos;
drop policy if exists lavado_fotos_app_delete on buddys.lavado_fotos;
create policy lavado_fotos_app_select on buddys.lavado_fotos for select to buddys_app using (true);
create policy lavado_fotos_app_insert on buddys.lavado_fotos for insert to buddys_app with check (true);
create policy lavado_fotos_app_update on buddys.lavado_fotos for update to buddys_app using (true) with check (true);
create policy lavado_fotos_app_delete on buddys.lavado_fotos for delete to buddys_app using (true);

alter table buddys.fotos_a_borrar enable row level security;
revoke all on buddys.fotos_a_borrar from public, anon, authenticated, service_role;
grant select, delete on buddys.fotos_a_borrar to buddys_app;
grant insert (path, borrar_desde) on buddys.fotos_a_borrar to buddys_app;
-- El ON CONFLICT DO UPDATE del trigger (corre como buddys_app) necesita poder actualizar borrar_desde.
grant update (borrar_desde) on buddys.fotos_a_borrar to buddys_app;

drop policy if exists fotos_a_borrar_app_select on buddys.fotos_a_borrar;
drop policy if exists fotos_a_borrar_app_insert on buddys.fotos_a_borrar;
drop policy if exists fotos_a_borrar_app_update on buddys.fotos_a_borrar;
drop policy if exists fotos_a_borrar_app_delete on buddys.fotos_a_borrar;
create policy fotos_a_borrar_app_select on buddys.fotos_a_borrar for select to buddys_app using (true);
create policy fotos_a_borrar_app_insert on buddys.fotos_a_borrar for insert to buddys_app with check (true);
create policy fotos_a_borrar_app_update on buddys.fotos_a_borrar for update to buddys_app using (true) with check (true);
create policy fotos_a_borrar_app_delete on buddys.fotos_a_borrar for delete to buddys_app using (true);
