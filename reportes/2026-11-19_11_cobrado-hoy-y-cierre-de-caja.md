# 11 — "Cobrado hoy" y "Cierre de caja": un nombre para cada cosa

Fecha: 2026-11-19 · Rama: `feature/lista-caja-graficos-tema` · Objetivo B de la tanda 07-11.

## Pedido

La mejora de caja. Decisión del dueño (19/11): ordenar los nombres. Hoy "Caja" son dos cosas distintas: el resumen
por forma de pago dentro de la Planilla y la pantalla del cierre del día (arqueo).

## Cómo queda

1. El resumen por forma de pago de la Planilla pasa a llamarse **"Cobrado hoy"** (o "Cobrado el <día>" si la planilla
   es de otro día). La pantalla de cierre pasa a llamarse **"Cierre de caja"** en el menú, en su título, en Hoy y en
   los avisos.
2. Desde "Cobrado hoy" hay un enlace "Cerrar la caja de este día" a `/caja?fecha=<día>`; desde el cierre, un enlace
   "Ver la planilla de este día" a la planilla de ese día.
3. Quién ve qué:
   - **empleado**: en la planilla sigue viendo "Cómo pagaron" (cuántos lavados por forma de pago, **sin montos**) y no
     ve el enlace al cierre ni la pantalla "Cierre de caja". No cambia lo que ya tenía.
   - **admin**: ve "Cobrado hoy" y "Cierre de caja"; cierra días abiertos.
   - **superadmin**: lo mismo, y además corrige o reabre un cierre.
   El enlace a "Cierre de caja" solo aparece si el rol tiene `caja.cerrar`.
4. Sin cambios en la API ni en la base: es solo el panel (rutas, permisos y respuestas iguales).

## Pruebas

- Títulos y nombres nuevos en Planilla, Más, Hoy y Cierre de caja.
- Los enlaces de ida y vuelta llevan la fecha del día que se mira.
- El empleado no ve ni "Cobrado hoy" ni el enlace al cierre.

## Estado

- [x] Implementado (Planilla acepta `?fecha=`; "Cierre de caja" en el menú y "Ver la planilla de este día" en el cierre)
- [x] Typecheck, lint y tests (frontend: 338 tests)
- [ ] Revisión de pruebas y de seguridad
