# 02 — Registrar lavado y sistema solo-API

Fecha: 2026-11-11

## Pedido

1. Agregar **Registrar lavado**: los autos que llegan sin turno tienen que contar en ingresos y en quién lava más.
2. **Sacar el frontend**: Buddys no tiene web como MgDetailing; es un sistema interno para registrar lavados. Si más
   adelante hay pantalla, se hará con otro diseño.

## Qué se hizo

### Sin frontend
- Se borró `frontend/` (landing y panel React), el middleware que lo servía (`SERVE_FRONTEND`), el `sitemap.xml` y
  los tests que leían archivos del frontend. El sitio estático salió de `render.yaml`: queda solo la API.
- Las rutas públicas de la landing (`/api/servicios`, `/api/disponibilidad`, `/api/bookings`, `/api/turnos/:id`)
  quedan **apagadas** con la variable nueva `TURNOS_ONLINE` (por defecto `false` → 404). `true` las vuelve a montar.
- Las respuestas reales de la API se guardan en `backend/test/fixtures/respuestas-api.json`: es el contrato que va a
  usar el frontend futuro (un test avisa si cambia sin querer).

### Registrar lavado
- Migración `20261111100000_lavados_mostrador.sql`: columna `origen` (`web` | `mostrador`) en `buddys.bookings`,
  teléfono opcional solo para los de mostrador (CHECK) e índice parcial para la planilla del día.
- Un lavado se guarda como turno **completado** con su cobro y `origen = 'mostrador'`: entra solo en estadísticas,
  metas, comprobantes e historial. **No ocupa cupo** de la agenda.
- `POST /api/admin/lavados` y `GET /api/admin/lavados?fecha=` (planilla del día con total y ranking por trabajador).
  Contrato completo en `backend/README.md`.
- Permiso nuevo `lavados.registrar` (aparece en `GET /api/admin/permisos`): admin y superadmin anotan a cualquiera;
  el empleado solo a su nombre.

### Decisión confirmada por el dueño (2026-11-11)
El **empleado carga el servicio y el monto** al registrar su lavado (es el momento de cobrar; si no, el ingreso se pierde
hasta que un admin lo cargue). Después no lo ve ni lo puede corregir. En los turnos de la web sigue la regla de
MgDetailing (el empleado no carga montos).

## Verificación
- `npm run verificar` en verde (tipos, lint y todos los tests del backend), con 17 tests nuevos en
  `backend/test/lavados.test.ts`: alta completa y mínima, fechas, franja según la hora, permisos del empleado,
  validaciones, que cuente en estadísticas y en el ranking, que no ocupe cupo, planilla del día (el empleado no puede deducir montos por el orden del ranking) y la API sin rutas
  públicas.
