-- =====================================================================================================
-- Buddys: baja de usuarios sin perder historial
-- (contrato: reportes/2026-11-17_03_gestion-usuarios.md, sección "Base de datos").
--
--  - perfiles.eliminado_at timestamptz null: cuándo se dio de baja a la persona. Null = no está dada de baja. Un
--    usuario con historial no se borra: queda inactivo, con eliminado_at, baneado en Supabase Auth y con el email
--    liberado (baja+<id>@buddys.invalid). Su perfil sigue existiendo, así que los lavados, turnos, gastos,
--    movimientos de stock, presupuestos y comprobantes viejos siguen apuntando a la persona y mostrando su nombre.
--  - CHECK perfiles_baja_inactivo (eliminado_at is null or not activo): un usuario dado de baja nunca está activo.
--    Es la segunda defensa: el servicio ya lo hace en la misma transacción. La baja pone activo = false, así que el
--    trigger buddys_private.impedir_sin_superadmin (AFTER UPDATE OF rol_id, activo) sigue frenando la baja del
--    último superadmin activo (SQLSTATE MG001). Ese trigger no cambia.
--
-- Claves foráneas hacia perfiles: de ON DELETE SET NULL a ON DELETE RESTRICT
--   bookings.trabajador_id    (bookings_trabajador_id_fkey)
--   bookings.registrado_por   (bookings_registrado_por_fkey)
--   gastos.creado_por         (gastos_creado_por_fkey)
--   movimientos_stock.perfil_id (movimientos_stock_perfil_fkey)
--   presupuestos.creado_por   (presupuestos_creado_por_fkey)
--   comprobantes.creado_por   (comprobantes_creado_por_fkey)
-- Por qué: con SET NULL, borrar a alguien borraba su nombre de todo su historial. Ahora es la red de seguridad del
-- "eliminar": si entre la consulta de "tiene historial" y el borrado alguien registra un lavado a su nombre, la base
-- rechaza el borrado (SQLSTATE 23001, restrict_violation; con NO ACTION sería 23503) en vez de dejar el lavado sin
-- nombre, y el servicio cae a la baja. RESTRICT (y no NO ACTION) para que el rechazo sea inmediato y no se pueda
-- postergar.
-- push_suscripciones.perfil_id sigue ON DELETE CASCADE (los dispositivos no son historial) y perfiles.id ->
-- auth.users sigue ON DELETE CASCADE: borrar el usuario de Auth intenta borrar el perfil, y es ESE borrado en
-- cascada el que frena el RESTRICT (las comprobaciones de FK corren como dueño de la tabla, no como
-- supabase_auth_admin, así que valen aunque Auth no tenga permisos en buddys).
--
-- Efecto sobre el dashboard de Supabase: borrar desde Authentication > Users (o con la API admin) a una persona con
-- historial ahora FALLA con "update or delete on table perfiles violates foreign key constraint ..."; el usuario de
-- Auth no se borra. Para sacar a alguien con historial hay que darlo de baja desde el panel (Equipo > Eliminar).
-- A alguien sin historial se lo sigue pudiendo borrar desde los dos lados.
--
-- Cambio de constraint sin bloquear de más: se borra y se vuelve a crear con el MISMO nombre, NOT VALID (no recorre
-- la tabla, toma SHARE ROW EXCLUSIVE en la tabla y en perfiles un instante) y después VALIDATE CONSTRAINT (recorre
-- la tabla con SHARE UPDATE EXCLUSIVE: no frena lecturas ni escrituras). Las filas existentes ya cumplen (eran FK
-- válidas), así que VALIDATE no puede fallar. Los índices parciales de esas columnas ya existen y son los que usa el
-- RESTRICT al borrar un perfil. El ADD COLUMN es nullable y sin default: no reescribe perfiles. Ninguna fila
-- existente cambia (eliminado_at queda en null; el CHECK se cumple para todas).
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS de perfiles habilitado y sus policies (select y update
-- para buddys_app) sin cambios. Se suma GRANT UPDATE (eliminado_at) a buddys_app; los GRANT por columna existentes
-- (rol_id, activo, nombre, updated_at) se mantienen. Sigue sin INSERT ni DELETE sobre perfiles para la app. Se repite
-- el REVOKE a los roles de la API de Supabase (defensa en profundidad).
--
-- Idempotente (se puede correr dos veces). No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- perfiles.eliminado_at + CHECK
-- -----------------------------------------------------------------------------------------------------
alter table buddys.perfiles add column if not exists eliminado_at timestamptz;

alter table buddys.perfiles drop constraint if exists perfiles_baja_inactivo;
alter table buddys.perfiles
  add constraint perfiles_baja_inactivo check (eliminado_at is null or not activo);

comment on column buddys.perfiles.eliminado_at is
  'Cuándo se dio de baja (usuario con historial: inactivo, baneado en Auth y con el email liberado). Null = no está dado de baja.';

-- -----------------------------------------------------------------------------------------------------
-- FK hacia perfiles: ON DELETE RESTRICT (mismo nombre de constraint)
-- -----------------------------------------------------------------------------------------------------
alter table buddys.bookings drop constraint if exists bookings_trabajador_id_fkey;
alter table buddys.bookings
  add constraint bookings_trabajador_id_fkey
    foreign key (trabajador_id) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.bookings validate constraint bookings_trabajador_id_fkey;

alter table buddys.bookings drop constraint if exists bookings_registrado_por_fkey;
alter table buddys.bookings
  add constraint bookings_registrado_por_fkey
    foreign key (registrado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.bookings validate constraint bookings_registrado_por_fkey;

alter table buddys.gastos drop constraint if exists gastos_creado_por_fkey;
alter table buddys.gastos
  add constraint gastos_creado_por_fkey
    foreign key (creado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.gastos validate constraint gastos_creado_por_fkey;

alter table buddys.movimientos_stock drop constraint if exists movimientos_stock_perfil_fkey;
alter table buddys.movimientos_stock
  add constraint movimientos_stock_perfil_fkey
    foreign key (perfil_id) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.movimientos_stock validate constraint movimientos_stock_perfil_fkey;

alter table buddys.presupuestos drop constraint if exists presupuestos_creado_por_fkey;
alter table buddys.presupuestos
  add constraint presupuestos_creado_por_fkey
    foreign key (creado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.presupuestos validate constraint presupuestos_creado_por_fkey;

alter table buddys.comprobantes drop constraint if exists comprobantes_creado_por_fkey;
alter table buddys.comprobantes
  add constraint comprobantes_creado_por_fkey
    foreign key (creado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.comprobantes validate constraint comprobantes_creado_por_fkey;

comment on column buddys.bookings.trabajador_id is
  'Quién hizo el trabajo (perfiles.id). Solo en turnos completados; null = sin asignar. Con historial la persona no se borra: se da de baja.';
comment on column buddys.bookings.registrado_por is
  'Quién registró el lavado de mostrador (perfiles.id). Null en los turnos web y en los lavados viejos.';
comment on column buddys.gastos.creado_por is
  'Quién lo cargó (perfiles.id). Null si lo creó el sistema.';

-- -----------------------------------------------------------------------------------------------------
-- Privilegios: se suma eliminado_at al UPDATE por columna de buddys_app
-- -----------------------------------------------------------------------------------------------------
alter table buddys.perfiles enable row level security;
revoke all on buddys.perfiles from public, anon, authenticated, service_role;
grant update (eliminado_at) on buddys.perfiles to buddys_app;
