-- =====================================================================================================
-- Rol dedicado del backend: buddys_app (mínimo privilegio).
--
-- Hasta ahora el backend se conectaba como "postgres": dueño de las tablas, con BYPASSRLS, CREATEROLE y DDL
-- sobre todo el proyecto (auth, storage, public...). Un bug o una inyección SQL tendría la base entera.
-- Este rol puede SOLO lo que el backend hace:
--   servicios: SELECT (verificación del catálogo al arrancar)
--   bookings:  SELECT, INSERT, UPDATE (solo estado y updated_at), DELETE
--   admins:    SELECT, INSERT, UPDATE (solo password_hash y updated_at)  (script crear-admin)
--   sessions:  SELECT, INSERT, DELETE
-- Sin DDL, sin TRUNCATE, sin BYPASSRLS, sin acceso a otros esquemas de la app.
--
-- Modelo RLS: las tablas ya tenían RLS sin policies (nadie salvo el dueño "postgres" ve filas). Se agrega una
-- policy por tabla y operación SOLO para buddys_app con USING/WITH CHECK (true): el backend es un único
-- cliente de confianza que ve todas las filas (no hay multiusuario que separar en la base); la autorización por
-- usuario la hace la API (sesión del panel). anon/authenticated siguen sin privilegios ni policies: para ellos
-- no cambia nada. Las policies son la "llave" que, junto con los GRANT, delimita qué puede hacer el rol.
--
-- El rol se crea NOLOGIN y SIN contraseña (no se versiona ningún secreto). Para habilitarlo, el dueño corre
-- `npm run clave-db` en backend/ (genera la contraseña y un ALTER ROLE ... LOGIN PASSWORD con el hash SCRAM, para
-- que la contraseña no quede en los logs de DDL de Supabase) y se conecta por el Session pooler con el usuario
-- buddys_app.<project-ref>. Ver backend/README.md, "Conectar Supabase".
-- =====================================================================================================

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'buddys_app') then
    create role buddys_app nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end;
$$;

comment on role buddys_app is
  'Backend Express de Buddys Wash Detail: DML mínimo sobre el esquema buddys. Sin DDL ni BYPASSRLS.';

-- Topes por sesión: una consulta trabada o una transacción abierta no retienen conexiones del pooler.
alter role buddys_app set statement_timeout = '10s';
alter role buddys_app set idle_in_transaction_session_timeout = '30s';
alter role buddys_app set lock_timeout = '5s';

grant usage on schema buddys to buddys_app;

grant select on buddys.servicios to buddys_app;
grant select, insert, delete on buddys.bookings to buddys_app;
grant update (estado, updated_at) on buddys.bookings to buddys_app;
grant select, insert on buddys.admins to buddys_app;
grant update (password_hash, updated_at) on buddys.admins to buddys_app;
grant select, insert, delete on buddys.sessions to buddys_app;

create policy servicios_app_select on buddys.servicios
  for select to buddys_app using (true);

create policy bookings_app_select on buddys.bookings
  for select to buddys_app using (true);
create policy bookings_app_insert on buddys.bookings
  for insert to buddys_app with check (true);
create policy bookings_app_update on buddys.bookings
  for update to buddys_app using (true) with check (true);
create policy bookings_app_delete on buddys.bookings
  for delete to buddys_app using (true);

create policy admins_app_select on buddys.admins
  for select to buddys_app using (true);
create policy admins_app_insert on buddys.admins
  for insert to buddys_app with check (true);
create policy admins_app_update on buddys.admins
  for update to buddys_app using (true) with check (true);

create policy sessions_app_select on buddys.sessions
  for select to buddys_app using (true);
create policy sessions_app_insert on buddys.sessions
  for insert to buddys_app with check (true);
create policy sessions_app_delete on buddys.sessions
  for delete to buddys_app using (true);
