-- =====================================================================================================
-- Buddys: turnos creados desde el panel, con seña (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 8).
--
--  - bookings.origen suma 'panel': un turno para un trabajo largo que carga un admin desde el panel (con cliente,
--    vehículo, servicios y fecha). Entra en la agenda como cualquier turno. Tiene teléfono obligatorio (el CHECK
--    bookings_telefono_obligatorio_web ya lo exige para todo lo que no es de mostrador).
--  - bookings.sena_monto integer, sena_forma_pago text, sena_fecha date: la seña cobrada por adelantado. Las tres
--    juntas o ninguna (CHECK bookings_sena_completa). Monto de 1 a 99.999.999; forma de pago, las mismas de
--    forma_pago. Cualquier turno que no sea de mostrador puede tener seña. Al completar el turno, `monto` es el total
--    del trabajo (incluye la seña) y el backend exige que no sea menor que la seña.
--  - La seña es plata: cambiarla no mueve updated_at (se recrea el trigger con sus columnas, como monto y descuento).
--
-- Seguridad: INSERT de buddys_app sobre toda la tabla (cubre las columnas nuevas); UPDATE solo de las tres de la seña.
-- Idempotente. Columnas nullable sin default: no reescriben la tabla. No se aplica a Supabase remoto sin pasar las
-- pruebas. Va después de 20261115100000_lavados_etapa_descuento (recrea su trigger).
-- =====================================================================================================

alter table buddys.bookings drop constraint if exists bookings_origen_valido;
alter table buddys.bookings
  add constraint bookings_origen_valido check (origen in ('web', 'mostrador', 'panel'));

comment on column buddys.bookings.origen is
  'web = pedido de turno; mostrador = lavado registrado en el panel (nace completado); panel = turno creado por un admin (con seña opcional).';

alter table buddys.bookings
  add column if not exists sena_monto integer,
  add column if not exists sena_forma_pago text,
  add column if not exists sena_fecha date;

alter table buddys.bookings drop constraint if exists bookings_sena_completa;
alter table buddys.bookings
  add constraint bookings_sena_completa check (
    (sena_monto is null and sena_forma_pago is null and sena_fecha is null)
    or (sena_monto is not null and sena_forma_pago is not null and sena_fecha is not null));

alter table buddys.bookings drop constraint if exists bookings_sena_rango;
alter table buddys.bookings
  add constraint bookings_sena_rango check (sena_monto between 1 and 99999999);

alter table buddys.bookings drop constraint if exists bookings_sena_forma_valida;
alter table buddys.bookings
  add constraint bookings_sena_forma_valida
    check (sena_forma_pago in ('efectivo', 'transferencia', 'debito', 'credito', 'otro'));

alter table buddys.bookings drop constraint if exists bookings_sena_no_mostrador;
alter table buddys.bookings
  add constraint bookings_sena_no_mostrador check (sena_monto is null or origen <> 'mostrador');

comment on column buddys.bookings.sena_monto is 'Seña cobrada por adelantado (ARS). Va con sena_forma_pago y sena_fecha.';
comment on column buddys.bookings.sena_forma_pago is 'Cómo se pagó la seña: efectivo, transferencia, debito, credito u otro.';
comment on column buddys.bookings.sena_fecha is 'Día en que se cobró la seña (cuenta en la caja de ese día).';

-- La caja de un día suma las señas cobradas ese día.
create index if not exists bookings_sena_fecha_idx on buddys.bookings (sena_fecha) where sena_monto is not null;

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
    and old.descuento is not distinct from new.descuento
    and old.descuento_motivo is not distinct from new.descuento_motivo
    and old.sena_monto is not distinct from new.sena_monto
    and old.sena_forma_pago is not distinct from new.sena_forma_pago
    and old.sena_fecha is not distinct from new.sena_fecha
  )
  execute function buddys.set_updated_at();

alter table buddys.bookings enable row level security;
revoke all on buddys.bookings from public, anon, authenticated, service_role;
grant update (sena_monto, sena_forma_pago, sena_fecha) on buddys.bookings to buddys_app;
