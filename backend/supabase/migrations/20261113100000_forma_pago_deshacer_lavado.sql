-- =====================================================================================================
-- Buddys: forma de pago del lavado (cierre de caja) y "deshacer" un lavado recién registrado.
--
--  - bookings.forma_pago text null: cómo pagó el cliente (efectivo, transferencia, debito, credito, otro; los mismos
--    valores que comprobantes.forma_pago y FORMAS_DE_PAGO en domain/comprobantes.ts). Null = sin indicar. La planilla
--    del día (GET /api/admin/lavados) agrupa por esta columna para el cierre de caja. No es un importe: la ven y la
--    cargan todos los roles al registrar; corregirla después es de quien corrige el cobro.
--  - bookings.registrado_por uuid null -> perfiles(id) ON DELETE SET NULL: quién registró el lavado de mostrador.
--    Con eso, quien lo registró lo puede deshacer (DELETE /api/admin/lavados/:id) en los 5 minutos siguientes. Los
--    turnos web y los lavados registrados antes de esta migración quedan en null (nadie los "deshace": se borran
--    desde la planilla con el permiso de borrar turnos).
--  - bookings.id_local uuid null, único cuando tiene valor: el id que genera el panel para cada lavado de su cola sin
--    conexión. Si un reintento llega después de que se perdió la respuesta, el backend encuentra el lavado por este id
--    y no lo registra dos veces (POST /api/admin/lavados responde 200 con el original).
--
-- Corregir la forma de pago es parte del cobro: igual que monto y trabajador_id, no mueve updated_at (el "actualizado
-- el" que ve el cliente). Tampoco lo mueve el ON DELETE SET NULL de registrado_por al borrar una persona. Se
-- recrea el trigger con esas dos columnas en la condición.
--
-- Seguridad, mismo modelo que rol_app_minimo_privilegio: el INSERT de buddys_app es sobre toda la tabla (cubre las
-- columnas nuevas); UPDATE es por columna: solo forma_pago (registrado_por e id_local no cambian nunca desde la app; el
-- ON DELETE SET NULL corre como dueño de la tabla). RLS y las policies de bookings ya existen; se repite el
-- REVOKE a los roles de la API de Supabase (defensa en profundidad).
--
-- Idempotente (se puede correr dos veces). Las columnas nuevas son nullable y sin default: no reescriben la tabla.
-- No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

alter table buddys.bookings
  add column if not exists forma_pago text,
  add column if not exists registrado_por uuid,
  add column if not exists id_local uuid;

alter table buddys.bookings drop constraint if exists bookings_forma_pago_valida;
alter table buddys.bookings
  add constraint bookings_forma_pago_valida
    check (forma_pago in ('efectivo', 'transferencia', 'debito', 'credito', 'otro'));

alter table buddys.bookings drop constraint if exists bookings_registrado_por_fkey;
alter table buddys.bookings
  add constraint bookings_registrado_por_fkey
    foreign key (registrado_por) references buddys.perfiles (id) on update restrict on delete set null;

comment on column buddys.bookings.forma_pago is
  'Cómo pagó el cliente: efectivo, transferencia, debito, credito u otro. Null = sin indicar. La usa el cierre de caja de la planilla de lavados.';
comment on column buddys.bookings.registrado_por is
  'Quién registró el lavado de mostrador (perfiles.id). Null en los turnos web, en los lavados viejos o si la persona se borró.';

comment on column buddys.bookings.id_local is
  'Id que generó el panel para el lavado (cola sin conexión): un reintento con el mismo id no registra otro. Null en los turnos web y en los lavados viejos.';

-- Un id_local se registra una sola vez (y el INSERT ... ON CONFLICT del backend lo usa como árbitro).
create unique index if not exists bookings_id_local_key on buddys.bookings (id_local) where id_local is not null;

-- La FK registrado_por (el ON DELETE SET NULL la recorre al borrar una persona).
create index if not exists bookings_registrado_por_idx on buddys.bookings (registrado_por)
  where registrado_por is not null;

-- El trigger de updated_at tampoco corre si la sentencia cambia forma_pago o registrado_por.
drop trigger if exists bookings_set_updated_at on buddys.bookings;
create trigger bookings_set_updated_at
  before update on buddys.bookings
  for each row
  when (
    old.recordatorio_enviado_at is not distinct from new.recordatorio_enviado_at
    and old.monto is not distinct from new.monto
    and old.trabajador_id is not distinct from new.trabajador_id
    and old.forma_pago is not distinct from new.forma_pago
    and old.registrado_por is not distinct from new.registrado_por
  )
  execute function buddys.set_updated_at();

alter table buddys.bookings enable row level security;
revoke all on buddys.bookings from public, anon, authenticated, service_role;
grant update (forma_pago) on buddys.bookings to buddys_app;
