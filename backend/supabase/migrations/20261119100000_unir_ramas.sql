-- Unión de las dos ramas de trabajo (19/11/2026): la de las mejoras 2026-11-15 (caja, gastos fijos, fotos, sellos,
-- insumos por servicio) y la tanda 03-06 (usuarios, perfil, seguimiento, recetas). Va DESPUÉS de las del 17/11.
--
-- 1. Recetas: queda el modelo de recetas_stock (tabla buddys.recetas, movimientos con origen = 'receta', descuento solo
--    en los lavados de mostrador). Se quita el de insumos_por_servicio (servicio_insumos, la función que sincronizaba
--    y la columna movimientos_stock.automatico). La API sigue mandando `automatico`, calculado desde origen.
--    Al unir las ramas la base no tenía recetas ni movimientos automáticos: no hay datos que pasar.
--
-- 2. Historial de una persona: las tablas de las mejoras apuntaban a perfiles con ON DELETE SET NULL. Como en
--    usuarios_baja, pasan a RESTRICT: quien tiene gastos fijos, cierres de caja o fotos cargadas se da de baja (no se
--    borra) y no se pierde quién hizo qué. El backend las cuenta en tieneHistorial.

-- 1. Insumos por servicio (modelo viejo)
drop function if exists buddys.sincronizar_insumos_turno(uuid, uuid, boolean);
drop table if exists buddys.servicio_insumos;
drop index if exists buddys.movimientos_stock_turno_automatico_idx;
alter table buddys.movimientos_stock drop column if exists automatico;

-- 2. FK a perfiles en RESTRICT
alter table buddys.gastos_fijos drop constraint if exists gastos_fijos_perfil_fkey;
alter table buddys.gastos_fijos
  add constraint gastos_fijos_perfil_fkey
    foreign key (perfil_id) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.gastos_fijos validate constraint gastos_fijos_perfil_fkey;

alter table buddys.gastos_fijos drop constraint if exists gastos_fijos_creado_por_fkey;
alter table buddys.gastos_fijos
  add constraint gastos_fijos_creado_por_fkey
    foreign key (creado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.gastos_fijos validate constraint gastos_fijos_creado_por_fkey;

alter table buddys.cierres_caja drop constraint if exists cierres_caja_cerrado_por_fkey;
alter table buddys.cierres_caja
  add constraint cierres_caja_cerrado_por_fkey
    foreign key (cerrado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.cierres_caja validate constraint cierres_caja_cerrado_por_fkey;

alter table buddys.lavado_fotos drop constraint if exists lavado_fotos_creado_por_fkey;
alter table buddys.lavado_fotos
  add constraint lavado_fotos_creado_por_fkey
    foreign key (creado_por) references buddys.perfiles (id) on update restrict on delete restrict not valid;
alter table buddys.lavado_fotos validate constraint lavado_fotos_creado_por_fkey;

