# Buddys Wash Detail — sistema interno

Sistema interno de **Buddys Wash Detail** ([@buddyswashdetail](https://www.instagram.com/buddyswashdetail/)) para
registrar los lavados y tener el control de los ingresos y de quién lava más. Es el backend del sistema de
MgDetailing adaptado a Buddys. **No tiene frontend**: por ahora es solo la API; la pantalla se va a hacer más
adelante con otro diseño.

## Qué hace

- **Registrar lavado** (`POST /api/admin/lavados`): servicio, vehículo, cuánto se cobró y quién lo lavó. Si no se
  indica, la fecha es hoy, quien lavó es quien registra y el cliente queda como "Cliente de mostrador".
- **Planilla del día** (`GET /api/admin/lavados`): los lavados del día, el total cobrado y quién lavó más.
- **Estadísticas** (`GET /api/admin/estadisticas`): ingresos, gastos, ganancia, servicios más pedidos y el ranking
  del equipo (`porTrabajador`) por día, mes o año.
- **Finanzas**: gastos y metas del mes. **Inventario** de insumos. **Presupuestos y comprobantes** en PDF.
- **Usuarios y roles** (`superadmin`, `admin`, `empleado`) con Supabase Auth. El empleado registra lavados a su
  nombre y no ve importes.
- Turnos y agenda (de MgDetailing). Las rutas **públicas** para pedir turno quedan apagadas (`TURNOS_ONLINE=false`).

Todos los endpoints, con ejemplos `curl`, están en [backend/README.md](backend/README.md).

## Estructura

| Carpeta | Qué es |
|---|---|
| `backend/` | La API: Node 24 + TypeScript + Express 5, Postgres en Supabase (esquema `buddys`) y Supabase Auth. |
| `backend/supabase/migrations/` | Las migraciones de la base, en orden. |
| `backend/test/fixtures/respuestas-api.json` | Respuestas reales de la API: el contrato para el frontend futuro. |
| `reportes/` | Informes del proyecto. |

## Uso

```bash
npm run instalar
```

```bash
npm run dev
```

La API queda en `http://localhost:4000` (salud: `http://localhost:4000/api/health`). Necesita `backend/.env` con la
conexión a Supabase: ver [backend/README.md](backend/README.md#conectar-supabase).

| Script | Qué hace |
|---|---|
| `npm run instalar` | Instala las dependencias del backend. |
| `npm run dev` | La API en desarrollo, con recarga automática. |
| `npm run build` / `npm start` | Compila y arranca la API compilada. |
| `npm test` | Tests (Postgres en memoria con PGlite: no tocan Supabase). |
| `npm run verificar` | Tipos, lint y tests. |

## Pendientes para salir

Ver [reportes/2026-11-11_01_puesta-en-marcha.md](reportes/2026-11-11_01_puesta-en-marcha.md).
