-- Borra los datos de ejemplo que cargó cargar.sql (todo lo que tiene id "de30000…"). Los datos reales no se tocan.
-- Correr en el SQL Editor de Supabase (proyecto Buddys) antes de que el lavadero empiece a usar el sistema en serio.
begin;
delete from buddys.movimientos_stock where insumo_id::text like 'de30000%';
delete from buddys.recetas where insumo_id::text like 'de30000%';
delete from buddys.lavado_servicios where booking_id::text like 'de30000%';
delete from buddys.bookings where id::text like 'de30000%';
delete from buddys.gastos where id::text like 'de30000%';
delete from buddys.insumos where id::text like 'de30000%';
-- La meta de demo (7.000.000 y 160 lavados): solo si nadie la cambió.
delete from buddys.metas_mensuales where ingresos_objetivo = 7000000 and trabajos_objetivo = 160;
commit;
