# 08 — Más, agrupado por secciones

Fecha: 2026-11-19 · Rama: `feature/lista-caja-graficos-tema` · Objetivo A de la tanda 07-11.

## Pedido

Agrupar la lista. Decisión del dueño (19/11): la lista de **Más** (hoy, hasta 8 secciones seguidas, sin orden de
uso). No hay una lista guardada de `buddys-mejoras`: la propuesta sale de la auditoría del 19/11.

## Cómo queda

- Cada sección de `SECCIONES` (`components/Layout.tsx`) lleva un `grupo`. Las principales (Hoy, Registrar, Planilla,
  Números) siguen en la barra de abajo y no entran en Más.
- Grupos, en este orden:
  - **Atención**: Agenda, Clientes.
  - **Plata**: Cierre de caja, Gastos, Presupuestos.
  - **Taller**: Servicios, Insumos, Equipo.
- Cada grupo es una `<section>` con su título (`h2`) y su lista; un grupo sin secciones visibles para el rol no aparece
  (lo que el rol no ve no deja hueco). El empleado ve, por ejemplo, "Atención" (Agenda, Clientes) y "Taller"
  (Servicios, Insumos).
- Sin títulos fijos al hacer scroll: son tres grupos cortos y cabe todo en una pantalla de celular.
- El riel lateral de escritorio usa los mismos grupos (títulos chicos entre los enlaces), así las dos navegaciones dicen
  lo mismo.
- Sin cambios de rutas, permisos ni API.

## Pruebas

- Más agrupado para superadmin, admin y empleado (qué grupos y en qué orden), sin grupos vacíos.
- El riel muestra los mismos grupos.

## Estado

- [x] Implementado
- [x] Typecheck, lint y tests (frontend: 311 tests)
- [x] Revisión de pruebas (19/11): sin errores; toda sección no principal tiene grupo (test), los grupos vacíos para el
  rol no salen ni en Más ni en el riel.
- [x] Revisión de seguridad (19/11): sin hallazgos; ningún rol ve secciones fuera de su capacidad ni grupos vacíos.
