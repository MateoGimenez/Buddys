-- =====================================================================================================
-- Buddys: catálogo de servicios del taller (datos, no esquema).
--
-- Reemplaza el catálogo heredado de MgDetailing (lavado-basico, lavado-premium, pulido, encerado y
-- restauracion-opticas, que no tienen turnos ni lavados en Buddys) por los 14 servicios de Buddys:
--  - upsert por id: crea los que faltan y deja los existentes con los datos de esta lista (restauracion-opticas se
--    reutiliza con los datos nuevos). orden según la lista (10, 20, 30...). Destacados: Limpieza Nivel I, II y III.
--  - precios enteros en ARS: auto (precio_desde) / suv / pickup. Un "precio desde" único va igual en los tres. Los
--    servicios de motos se ofrecen solo para 'moto', con precio_desde_moto; el resto, para auto, suv y pickup.
--  - incluye: el texto de "Qué incluye" partido en ítems; descripcion: ese mismo texto completo; resumen: una frase.
--  - duraciones en null (sin confirmar: el dueño las carga desde el panel) y glosario vacío.
--  - Todo servicio que no esté en la lista se desactiva (y se le saca el destacado: un inactivo no puede serlo). No se
--    borra ninguno: los turnos viejos los siguen referenciando.
--
-- Cumple las validaciones del catálogo (servicio_incluye_valido, servicio_vehiculos_valido, SERVICIO_ID_REGEX y los
-- largos máximos de schemas/servicios.ts). updated_at = now() en las filas que se tocan: el catálogo cambia de verdad.
-- Idempotente (se puede correr dos veces: el resultado es el mismo). No se aplica a Supabase remoto sin pasar las
-- pruebas. Va después de 20261113110000_vehiculos_suv_pickup (usa suv, pickup y categoria).
-- =====================================================================================================

insert into buddys.servicios as s (
  id, nombre, categoria, resumen, descripcion, incluye, glosario,
  duracion_estimada, duracion_suv, duracion_pickup, duracion_estimada_moto,
  precio_desde, precio_desde_suv, precio_desde_pickup, precio_desde_moto,
  vehiculos, destacado, activo, orden, updated_at
)
values
  ('limpieza-nivel-1', 'Limpieza Nivel I', 'Lavado',
   'Lavado exterior e interior completo, con cera líquida y brillo de neumáticos.',
   'Snow foam, plásticos externos, ruedas, vidrios y pasaruedas + aspirado, panel, puertas, vidrios y plásticos internos. Cera líquida (2 semanas) y brillo de neumáticos.',
   '["Snow foam","Plásticos externos","Ruedas","Vidrios","Pasaruedas","Aspirado","Panel","Puertas","Vidrios y plásticos internos","Cera líquida (2 semanas)","Brillo de neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   25000, 30000, 35000, null,
   array['auto', 'suv', 'pickup'], true, true, 10, now()),

  ('limpieza-nivel-2', 'Limpieza Nivel II', 'Lavado',
   'El Nivel I más emblemas, parrillas y revitalizador de plásticos, con cera líquida de 1 mes.',
   'Todo el Nivel I + emblemas y parrillas. Revitalizador de plásticos externos e internos, cera líquida (1 mes) y brillo de neumáticos.',
   '["Todo el Nivel I","Emblemas","Parrillas","Revitalizador de plásticos externos e internos","Cera líquida (1 mes)","Brillo de neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   30000, 35000, 40000, null,
   array['auto', 'suv', 'pickup'], true, true, 20, now()),

  ('limpieza-nivel-3', 'Limpieza Nivel III', 'Lavado',
   'La limpieza más completa: motor, chasis y cada detalle, con cera en crema de 3 meses.',
   'Todo el Nivel II + canaletas, ruedas int./ext., motor, chasis, escape, volante, palanca y pedales. Revitalizador de plásticos, vano motor y chasis, cera en crema (3 meses) y sellador de neumáticos.',
   '["Todo el Nivel II","Canaletas","Ruedas int./ext.","Motor","Chasis","Escape","Volante, palanca y pedales","Revitalizador de plásticos, vano motor y chasis","Cera en crema (3 meses)","Sellador de neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   60000, 70000, 80000, null,
   array['auto', 'suv', 'pickup'], true, true, 30, now()),

  ('limpieza-motor', 'Limpieza de motor', 'Lavado',
   'Motor desengrasado y limpio, cuidando la parte eléctrica.',
   'Desengrase y lavado controlado, vapor en zona electrónica, plásticos y mangueras, protección de conexiones eléctricas. Revitalizado de plásticos.',
   '["Desengrase y lavado controlado","Vapor en zona electrónica","Plásticos y mangueras","Protección de conexiones eléctricas","Revitalizado de plásticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   25000, 25000, 25000, null,
   array['auto', 'suv', 'pickup'], false, true, 40, now()),

  ('higienizacion-profunda', 'Higienización profunda', 'Interior',
   'El interior a fondo: asientos y alfombras afuera, bactericida, manchas y olores.',
   'Limpieza Nivel III + desmontaje y extracción de asientos y alfombras con bactericida, manchas, olores, techo, cintos, burletes y baúl. Cera en pasta (3 meses), impermeabilizante de parabrisas y vidrios.',
   '["Limpieza Nivel III","Desmontaje y extracción de asientos y alfombras con bactericida","Manchas","Olores","Techo","Cintos","Burletes","Baúl","Cera en pasta (3 meses)","Impermeabilizante de parabrisas y vidrios"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   120000, 120000, 120000, null,
   array['auto', 'suv', 'pickup'], false, true, 50, now()),

  ('pulido-basico', 'Pulido básico', 'Pulido',
   'Saca hasta el 70% de los rayones superficiales y le devuelve el brillo a la pintura.',
   'Limpieza Nivel II + descontaminado y hasta 70% de rayones superficiales. Revitalizador de plásticos, cera en pasta (6 meses) y brillo de neumáticos.',
   '["Limpieza Nivel II","Descontaminado","Hasta 70% de rayones superficiales","Revitalizador de plásticos","Cera en pasta (6 meses)","Brillo de neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   250000, 270000, 320000, null,
   array['auto', 'suv', 'pickup'], false, true, 60, now()),

  ('pulido-abrillantado', 'Pulido y abrillantado', 'Pulido',
   'Corrección de pintura a fondo: rayones profundos y superficiales, con cera de 1 año.',
   'Limpieza Nivel III + descontaminado, hasta 70% de rayones profundos y 90% superficiales. Revitalizador de plásticos, cera en pasta (1 año) y sellador de neumáticos.',
   '["Limpieza Nivel III","Descontaminado","Hasta 70% de rayones profundos","Hasta 90% de rayones superficiales","Revitalizador de plásticos","Cera en pasta (1 año)","Sellador de neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   300000, 320000, 370000, null,
   array['auto', 'suv', 'pickup'], false, true, 70, now()),

  ('pulido-opticas', 'Pulido de ópticas', 'Pulido',
   'Ópticas claras otra vez: lijado, nivelación y polímero protector con 1 año de garantía.',
   'Limpieza Nivel I + lijado con escala de lijas, nivelación y retiro del 99% de rayones. Polímero protector, 1 año de garantía.',
   '["Limpieza Nivel I","Lijado con escala de lijas","Nivelación","Retiro del 99% de rayones","Polímero protector","1 año de garantía"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   80000, 80000, 80000, null,
   array['auto', 'suv', 'pickup'], false, true, 80, now()),

  ('restauracion-opticas', 'Restauración de ópticas', 'Pulido',
   'Desarme y reparación completa de las ópticas, con customización y 1 año de garantía.',
   'Limpieza Nivel I + desarme completo, reparación de piezas internas, customización, lijado y pulido. Polímero protector, 1 año de garantía.',
   '["Limpieza Nivel I","Desarme completo","Reparación de piezas internas","Customización","Lijado y pulido","Polímero protector","1 año de garantía"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   180000, 180000, 180000, null,
   array['auto', 'suv', 'pickup'], false, true, 90, now()),

  ('tratamiento-acrilico', 'Tratamiento acrílico', 'Protección',
   'Pulido y abrillantado con sellador acrílico para proteger la pintura.',
   'Limpieza Nivel III + descontaminado, pulido y abrillantado, refinado final. Sellador acrílico y revitalizador de plásticos.',
   '["Limpieza Nivel III","Descontaminado","Pulido y abrillantado","Refinado final","Sellador acrílico","Revitalizador de plásticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   400000, 450000, 480000, null,
   array['auto', 'suv', 'pickup'], false, true, 100, now()),

  ('tratamiento-ceramico', 'Tratamiento cerámico', 'Protección',
   'Pulido técnico y cerámico de 4 años: la máxima protección para la pintura.',
   'Limpieza Nivel III + pulido técnico (99% de rayones) y nivelación de poro. Cerámico de 4 años, hidrofóbico en parabrisas y vidrios, sellador de plásticos y neumáticos.',
   '["Limpieza Nivel III","Pulido técnico (99% de rayones)","Nivelación de poro","Cerámico de 4 años","Hidrofóbico en parabrisas y vidrios","Sellador de plásticos y neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   600000, 600000, 600000, null,
   array['auto', 'suv', 'pickup'], false, true, 110, now()),

  ('preparacion-venta', 'Preparación para la venta', 'Pre venta',
   'Todo para vender tu vehículo: pulido, ópticas, motor e interior a fondo.',
   'Limpieza Nivel III + descontaminado, pulido básico, pulido de ópticas, motor e higienización profunda. Cera en pasta (6 meses) y brillo de neumáticos.',
   '["Limpieza Nivel III","Descontaminado","Pulido básico","Pulido de ópticas","Motor","Higienización profunda","Cera en pasta (6 meses)","Brillo de neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   400000, 400000, 400000, null,
   array['auto', 'suv', 'pickup'], false, true, 120, now()),

  ('motos-basico', 'Motos básico', 'Motos',
   'Lavado, pulido básico y pulido de ópticas para tu moto, con cera de 6 meses.',
   'Snow foam, plásticos, gomas, ruedas y escape + descontaminado, pulido básico y pulido de ópticas. Cera en pasta (6 meses) y revitalizador de plásticos.',
   '["Snow foam","Plásticos","Gomas","Ruedas","Escape","Descontaminado","Pulido básico","Pulido de ópticas","Cera en pasta (6 meses)","Revitalizador de plásticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   null, null, null, 60000,
   array['moto'], false, true, 130, now()),

  ('motos-ceramico', 'Motos tratamiento cerámico', 'Motos',
   'Lavado detallado, pulido técnico y cerámico de 4 años para tu moto.',
   'Lavado detallado (ruedas, transmisión, suspensión, carenado, burbuja, escape) + pulido técnico y de ópticas. Cerámico de 4 años, hidrofóbico en burbuja, sellador de plásticos y neumáticos.',
   '["Lavado detallado (ruedas, transmisión, suspensión, carenado, burbuja, escape)","Pulido técnico","Pulido de ópticas","Cerámico de 4 años","Hidrofóbico en burbuja","Sellador de plásticos y neumáticos"]'::jsonb,
   '[]'::jsonb, null, null, null, null,
   null, null, null, 150000,
   array['moto'], false, true, 140, now())
on conflict (id) do update set
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  resumen = excluded.resumen,
  descripcion = excluded.descripcion,
  incluye = excluded.incluye,
  glosario = excluded.glosario,
  duracion_estimada = excluded.duracion_estimada,
  duracion_suv = excluded.duracion_suv,
  duracion_pickup = excluded.duracion_pickup,
  duracion_estimada_moto = excluded.duracion_estimada_moto,
  precio_desde = excluded.precio_desde,
  precio_desde_suv = excluded.precio_desde_suv,
  precio_desde_pickup = excluded.precio_desde_pickup,
  precio_desde_moto = excluded.precio_desde_moto,
  vehiculos = excluded.vehiculos,
  destacado = excluded.destacado,
  activo = excluded.activo,
  orden = excluded.orden,
  updated_at = excluded.updated_at
-- Solo las filas que cambian: una segunda corrida no mueve updated_at (el "actualizado el" del catálogo).
where (s.nombre, s.categoria, s.resumen, s.descripcion, s.incluye, s.glosario,
       s.duracion_estimada, s.duracion_suv, s.duracion_pickup, s.duracion_estimada_moto,
       s.precio_desde, s.precio_desde_suv, s.precio_desde_pickup, s.precio_desde_moto,
       s.vehiculos, s.destacado, s.activo, s.orden)
  is distinct from
      (excluded.nombre, excluded.categoria, excluded.resumen, excluded.descripcion, excluded.incluye, excluded.glosario,
       excluded.duracion_estimada, excluded.duracion_suv, excluded.duracion_pickup, excluded.duracion_estimada_moto,
       excluded.precio_desde, excluded.precio_desde_suv, excluded.precio_desde_pickup, excluded.precio_desde_moto,
       excluded.vehiculos, excluded.destacado, excluded.activo, excluded.orden);

-- Lo que no está en la lista se desactiva (y deja de ser destacado: CHECK servicios_destacado_activo). Solo las filas
-- que cambian: una segunda corrida no toca nada.
update buddys.servicios
set activo = false, destacado = false, updated_at = now()
where (activo or destacado)
  and id not in (
    'limpieza-nivel-1', 'limpieza-nivel-2', 'limpieza-nivel-3', 'limpieza-motor', 'higienizacion-profunda',
    'pulido-basico', 'pulido-abrillantado', 'pulido-opticas', 'restauracion-opticas', 'tratamiento-acrilico',
    'tratamiento-ceramico', 'preparacion-venta', 'motos-basico', 'motos-ceramico'
  );
