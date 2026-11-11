-- =====================================================================================================
-- Buddys: lavados de mostrador ("Registrar lavado").
--
-- En un lavadero la mayoría de los autos llegan sin turno. Para que cuenten en ingresos, metas y el ranking de quién
-- lava más, se registran como un turno YA COMPLETADO con su cobro (monto y trabajador) y `origen = 'mostrador'`.
-- Así reusan todo lo que ya existe sobre buddys.bookings: estadísticas, metas, comprobantes, historial del cliente.
--
--  - origen: 'web' (pedido de turno, el de siempre) o 'mostrador' (registrado desde el panel).
--  - telefono pasa a ser opcional SOLO para los de mostrador (el cliente que pasa a lavar no siempre deja teléfono).
--  - Los de mostrador no ocupan cupo de la agenda (lo filtra la consulta de ocupación, no hace falta índice nuevo).
--
-- Idempotente (se puede correr dos veces); no se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

alter table buddys.bookings
  add column if not exists origen text not null default 'web'
    constraint bookings_origen_valido check (origen in ('web', 'mostrador'));

comment on column buddys.bookings.origen is
  'web = pedido de turno; mostrador = lavado registrado en el panel (nace completado, con su cobro).';

alter table buddys.bookings alter column telefono drop not null;

alter table buddys.bookings drop constraint if exists bookings_telefono_obligatorio_web;
alter table buddys.bookings
  add constraint bookings_telefono_obligatorio_web
    check (telefono is not null or origen = 'mostrador');

-- Listado de lavados de un día: WHERE origen = 'mostrador' AND coalesce(fecha_confirmada, fecha_preferida) = $1.
create index if not exists bookings_mostrador_fecha_idx on buddys.bookings (
  (coalesce(fecha_confirmada, fecha_preferida)),
  seq
) where origen = 'mostrador';

-- El rol de la app inserta la columna nueva con el INSERT de siempre (grant insert sobre toda la tabla); no la
-- actualiza nunca: un lavado no cambia de origen.
