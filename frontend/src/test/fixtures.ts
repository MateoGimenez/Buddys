// Respuestas de la API para los tests. Todo sale de respuestas REALES del backend:
//  - backend/test/fixtures/respuestas-api.json: el contrato del backend (permisos, servicios, trabajadores, errores).
//  - ./respuestas-reales.json: lo que ese contrato no trae (login, /me, refresh, logout, lavados, planilla, 401, 415,
//    403 de origen). Se generó con la app de test del backend (createTestContext sobre PGlite, "ahora" fijo el
//    2026-10-16 12:00 en La Rioja) y los ids de Ana (superadmin) y Beto (empleado) se fijaron a ANA_ID y BETO_ID.
//    Si cambia el contrato del backend: `npm run respuestas` lo pone al día (scripts/actualizar-respuestas.ts; lo que
//    el contrato no trae se sigue generando con la app de test del backend). No escribir respuestas a mano.
//    Excepción: los servicios múltiples (`servicios` en cada lavado) se sumaron a mano siguiendo el contrato nuevo,
//    mientras el backend los implementa en paralelo; al regenerar, tienen que salir igual.
//  - El catálogo del contrato del backend puede venir todavía con camioneta (precioDesdeCamioneta, duracionCamioneta):
//    `normalizarServicio` lo pasa a la forma nueva (SUV y pick-up, categoría) para que los tests no dependan de cuándo
//    se regenere ese archivo.
import contrato from '../../../backend/test/fixtures/respuestas-api.json' with { type: 'json' };
import reales from './respuestas-reales.json' with { type: 'json' };
import type {
  AlertasStock,
  Consumo,
  Insumo,
  ListaInsumos,
  ParaComprar,
  Permisos,
  PlanillaDelDia,
  Receta,
  Servicio,
  Trabajador,
  Turno,
  Usuario,
  UsuarioEquipo,
  VehiculoTipo,
} from '../api/types';

export interface RespuestaFalsa {
  status: number;
  body?: unknown;
}

export const fx = contrato as unknown as Record<string, { status: number; body: unknown }>;
export const real = reales as unknown as Record<string, RespuestaFalsa>;

function cuerpo<T>(clave: string): T {
  const r = fx[clave];
  if (!r) throw new Error(`Falta el fixture ${clave}`);
  return structuredClone(r.body) as T;
}

function respuesta(clave: string): RespuestaFalsa {
  const r = real[clave];
  if (!r) throw new Error(`Falta la respuesta real ${clave}`);
  return structuredClone(r);
}

function cuerpoReal<T>(clave: string): T {
  return respuesta(clave).body as T;
}

export const ANA_ID = '00000000-0000-4000-8000-00000000a0a0';
export const BETO_ID = '00000000-0000-4000-8000-00000000b0b0';

// `fotoVersion` (contrato 04, foto de perfil) llega del backend en el usuario de la sesión: null = sin foto.
export const usuarioAdmin: Usuario = cuerpoReal<{ usuario: Usuario }>('loginAdmin').usuario;
export const usuarioEmpleado: Usuario = cuerpoReal<{ usuario: Usuario }>('meEmpleado').usuario;

// Mi perfil (contrato 04): respuestas reales de GET/PATCH /api/admin/perfil y PUT/DELETE de la foto.
export const perfilReal = (clave: 'perfilAdmin' | 'perfilEmpleado' | 'perfilSinFotos'): { perfil: Usuario; fotosDisponibles: boolean } =>
  cuerpoReal(clave);
/** La versión de la foto que devolvió el backend al subirla (PUT /api/admin/perfil/foto). */
export const VERSION_FOTO_REAL: string = cuerpoReal<{ perfil: Usuario }>('perfilFotoSube').perfil.fotoVersion ?? '';

export const permisosAdmin = (): Permisos => ({ ...cuerpo<Permisos>('permisosAdmin'), tuRol: 'superadmin' });
export const permisosEmpleado = (): Permisos => cuerpo<Permisos>('permisosEmpleado');

type ServicioCrudo = Omit<Partial<Servicio>, 'vehiculos'> & {
  id: string;
  vehiculos: string[];
  precioDesdeCamioneta?: number | null;
  duracionCamioneta?: string | null;
};

/** Un servicio del backend, en la forma del contrato nuevo (si todavía viene con "camioneta", se reparte en SUV y pick-up). */
export function normalizarServicio(crudo: ServicioCrudo): Servicio {
  const { precioDesdeCamioneta, duracionCamioneta, ...resto } = crudo;
  const vehiculos = crudo.vehiculos.flatMap((v): VehiculoTipo[] => (v === 'camioneta' ? ['suv', 'pickup'] : [v as VehiculoTipo]));
  return {
    resumen: '',
    descripcion: '',
    incluye: [],
    glosario: [],
    duracion: null,
    duracionMoto: null,
    precioDesde: null,
    precioDesdeMoto: null,
    destacado: false,
    activo: true,
    orden: 0,
    updatedAt: '2026-10-16T15:00:00.000Z',
    nombre: crudo.id,
    ...resto,
    categoria: crudo.categoria ?? null,
    precioDesdeSuv: crudo.precioDesdeSuv ?? precioDesdeCamioneta ?? null,
    precioDesdePickup: crudo.precioDesdePickup ?? precioDesdeCamioneta ?? null,
    duracionSuv: crudo.duracionSuv ?? duracionCamioneta ?? null,
    duracionPickup: crudo.duracionPickup ?? duracionCamioneta ?? null,
    vehiculos: [...new Set(vehiculos)],
  };
}

const CATEGORIA_CONTRATO: Record<string, string> = {
  'lavado-basico': 'Lavado',
  'lavado-premium': 'Lavado',
  pulido: 'Pulido',
  encerado: 'Protección',
  'restauracion-opticas': 'Pulido',
};

/**
 * Catálogo del contrato, con pulido solo para auto (para probar el filtro por vehículo), precios cargados en el
 * básico y una categoría para cada uno.
 */
export function serviciosAdmin(): { servicios: Servicio[] } {
  const crudo = cuerpo<{ servicios: ServicioCrudo[] }>('serviciosAdmin');
  const servicios = crudo.servicios.map(normalizarServicio);
  for (const s of servicios) {
    s.categoria = CATEGORIA_CONTRATO[s.id] ?? null;
    if (s.id === 'lavado-basico') {
      // El contrato ya viene con auto, suv y moto (la migración pasó camioneta a suv): se le suma pick-up.
      s.vehiculos = ['auto', 'suv', 'pickup', 'moto'];
      s.precioDesde = 12000;
      s.precioDesdeSuv = 15000;
      s.precioDesdePickup = 16000;
    }
    if (s.id === 'pulido') s.vehiculos = ['auto'];
    if (s.id === 'restauracion-opticas') s.activo = false;
  }
  return { servicios };
}

/** Un servicio del catálogo de 14 (los demás campos como los manda el backend). */
function servicio(
  id: string,
  nombre: string,
  categoria: string,
  precios: Partial<Record<VehiculoTipo, number | null>>,
  extra: Partial<Servicio> = {},
): Servicio {
  // Que la clave esté = se ofrece para ese vehículo (null = Consultá).
  const vehiculos = Object.keys(precios);
  return normalizarServicio({
    id,
    nombre,
    categoria,
    resumen: nombre,
    descripcion: nombre,
    vehiculos,
    precioDesde: precios.auto ?? null,
    precioDesdeSuv: precios.suv ?? null,
    precioDesdePickup: precios.pickup ?? null,
    precioDesdeMoto: precios.moto ?? null,
    ...extra,
  });
}

/**
 * El catálogo real tal como lo describe el contrato: 14 servicios en 6 categorías, de 25.000 a 600.000, con
 * destacados (los "Frecuentes") y servicios que no se ofrecen para todos los vehículos. Datos de prueba.
 */
export function catalogoBuddys(): { servicios: Servicio[] } {
  let orden = 0;
  const lista = [
    servicio('nivel-1', 'Nivel I', 'Lavado', { auto: 25000, suv: 30000, pickup: 32000 }, { destacado: true }),
    servicio('nivel-2', 'Nivel II', 'Lavado', { auto: 45000, suv: 52000, pickup: 55000 }, { destacado: true }),
    servicio('nivel-3', 'Nivel III', 'Lavado', { auto: 70000, suv: 80000, pickup: 85000 }),
    servicio('motor', 'Motor', 'Lavado', { auto: 50000, suv: 50000, pickup: null }),
    servicio('interior-completo', 'Interior completo', 'Interior', { auto: 90000, suv: 110000, pickup: 110000 }),
    servicio('tapizados', 'Tapizados', 'Interior', { auto: 120000, suv: 140000, pickup: null }),
    servicio('pulido-opticas', 'Pulido de ópticas', 'Pulido', { auto: 35000, suv: 35000, pickup: 35000, moto: 25000 }),
    servicio('pulido-comercial', 'Pulido comercial', 'Pulido', { auto: 250000, suv: 300000, pickup: 320000 }),
    servicio('ceramico', 'Cerámico 1 año', 'Protección', { auto: 450000, suv: 550000, pickup: 600000 }),
    servicio('sellador', 'Sellador acrílico', 'Protección', { auto: 80000, suv: null, pickup: null }),
    servicio('pre-venta', 'Pre venta', 'Pre venta', { auto: 180000, suv: 210000, pickup: 220000 }),
    servicio('moto-basico', 'Moto básico', 'Motos', { moto: 25000 }, { destacado: true }),
    servicio('moto-full', 'Moto full', 'Motos', { moto: 60000 }),
    servicio('moto-ceramico', 'Moto cerámico', 'Motos', { moto: null }),
  ];
  for (const s of lista) s.orden = (orden += 10);
  return { servicios: lista };
}

/** Ana y Beto, como los devuelve GET /api/admin/trabajadores. */
export const trabajadores = () => cuerpoReal<{ trabajadores: Trabajador[] }>('trabajadoresAdmin');

/** Respuesta de POST /api/admin/lavados: el lavado y hasta cuándo se puede deshacer (creación + 5 min). */
export function registrado(cambios: Partial<Turno>, deshacerHasta = new Date(Date.now() + 5 * 60_000).toISOString()) {
  return { lavado: lavado(cambios), deshacerHasta };
}

/** Un lavado real (POST /api/admin/lavados del admin) como base. */
function turnoBase(): Turno {
  return cuerpoReal<{ lavado: Turno }>('lavadoAdminMinimo').lavado;
}

const NOMBRE_SERVICIO: Record<string, string> = {
  'lavado-basico': 'Lavado Básico',
  'lavado-premium': 'Lavado Premium',
  pulido: 'Pulido',
  encerado: 'Encerado',
  'restauracion-opticas': 'Restauración de ópticas',
};

/** Un lavado; si se cambia el servicio principal y no se dan los servicios, queda ese solo (como lo arma el backend). */
export function lavado(cambios: Partial<Turno>): Turno {
  const servicios =
    cambios.servicios ??
    (cambios.servicioId
      ? [{ id: cambios.servicioId, nombre: NOMBRE_SERVICIO[cambios.servicioId] ?? cambios.servicioId, precioLista: null }]
      : undefined);
  return { ...turnoBase(), ...cambios, ...(servicios ? { servicios, servicioId: servicios[0]?.id ?? '' } : {}) };
}

export function planillaAdmin(fecha: string): PlanillaDelDia {
  return {
    fecha,
    lavados: [
      lavado({ id: 'l1', servicioId: 'lavado-basico', monto: 12000, formaPago: 'efectivo', franja: 'manana', trabajador: { id: BETO_ID, nombre: 'Beto' }, registradoPor: { id: BETO_ID, nombre: 'Beto' }, vehiculoModelo: 'Gol AB123CD' }),
      lavado({ id: 'l2', servicioId: 'pulido', monto: 60000, formaPago: 'transferencia', franja: 'manana', trabajador: { id: ANA_ID, nombre: 'Ana' }, registradoPor: { id: ANA_ID, nombre: 'Ana' } }),
      // Un turno de antes de "Registrado por" (o de la web): sin registradoPor, se muestra quién lo hizo.
      lavado({ id: 'l3', servicioId: 'lavado-premium', monto: null, formaPago: null, franja: 'tarde', trabajador: { id: BETO_ID, nombre: 'Beto' }, registradoPor: null, nombre: 'Juan Pérez' }),
    ],
    resumen: {
      cantidad: 3,
      total: 72000,
      sinMonto: 1,
      // Como lo ordena el backend para quien ve importes: más cobrado primero.
      porFormaPago: [
        { formaPago: 'transferencia', cantidad: 1, total: 60000 },
        { formaPago: 'efectivo', cantidad: 1, total: 12000 },
        { formaPago: null, cantidad: 1, total: 0 },
      ],
    },
  };
}

/** Lo mismo que ve el empleado: la API manda monto y total en null (sinMonto sí viene). */
export function planillaEmpleado(fecha: string): PlanillaDelDia {
  const p = planillaAdmin(fecha);
  return {
    ...p,
    lavados: p.lavados.map((l) => ({ ...l, monto: null })),
    resumen: {
      ...p.resumen,
      total: null,
      // Sin importes el backend no ordena por lo cobrado (no se puede deducir): más lavados primero y, en empate, el
      // orden de las formas de pago con "sin indicar" al final.
      porFormaPago: [
        { formaPago: 'efectivo', cantidad: 1, total: null },
        { formaPago: 'transferencia', cantidad: 1, total: null },
        { formaPago: null, cantidad: 1, total: null },
      ],
    },
  };
}

export const errores = {
  sinSesion: respuesta('meSinSesion'),
  vencida: respuesta('lavadosVencida'),
  refrescoFallido: respuesta('refreshSinSesion'),
  credenciales: respuesta('loginMal'),
  validacionLavado: respuesta('lavadoValidacion'),
  lavadoFuturo: respuesta('lavadoFuturo'),
  servicioNoOfrecido: fx.error400ReservaServicioNoOfrecido as RespuestaFalsa,
  prohibidoEmpleado: respuesta('lavadoEmpleadoOtro'),
  trabajadorInvalido: fx.error400TrabajadorInexistente as RespuestaFalsa,
  // DELETE /api/admin/lavados/:id fuera de plazo, de otra persona o con comprobante, y POST /api/admin/lavados con un
  // idLocal que ya usó otra persona: las respuestas reales del contrato del backend (no escritas a mano).
  plazoVencido: fx.error403PlazoDeshacer as RespuestaFalsa,
  deshacerAjeno: fx.error403DeshacerAjeno as RespuestaFalsa,
  idLocalAjeno: fx.error409IdLocalAjeno as RespuestaFalsa,
  conComprobante: fx.error409DeshacerConComprobante as RespuestaFalsa,
  // Mi perfil (contrato 04): foto inválida o pesada, contraseña actual incorrecta y límite de intentos.
  fotoInvalida: respuesta('perfilFotoInvalida'),
  fotoPesada: respuesta('perfilFotoPesada'),
  passwordActualMal: respuesta('perfilPasswordActualMal'),
  passwordLimite: respuesta('perfilPasswordLimite'),
} satisfies Record<string, RespuestaFalsa>;

// ------------------------------------------------------------------ Equipo (contrato 03, gestión de usuarios)
// Forma de `Usuario` de GET /api/admin/usuarios según reportes/2026-11-17_03_gestion-usuarios.md, armada a mano mientras
// el backend la implementa en paralelo (eliminadoAt, tieneHistorial, gestionable). Al regenerar respuestas-reales.json,
// `usuariosAdmin` tiene que salir con estas mismas claves.

export const CARLA_ID = '00000000-0000-4000-8000-00000000c0c0';

/** Carla, encargada (rol admin): gestiona solo empleados. */
export const usuarioEncargado: Usuario = { id: CARLA_ID, email: 'carla@buddys.test', nombre: 'Carla', rol: 'admin', fotoVersion: null };

/** La tabla de permisos vista por un admin: `usuarios.gestionar` en parcial (solo empleados). */
export function permisosEncargado(): Permisos {
  const p = cuerpo<Permisos>('permisosAdmin');
  return {
    ...p,
    tuRol: 'admin',
    capacidades: p.capacidades.map((c) =>
      c.id === 'usuarios.gestionar'
        ? {
            ...c,
            texto: 'Crear, editar, desactivar y eliminar usuarios del panel',
            roles: { superadmin: 'si', admin: 'parcial', empleado: 'no' },
            matiz: { admin: 'Solo empleados: crearlos, editarlos, desactivarlos y darlos de baja' },
          }
        : c,
    ),
  };
}

/** La tabla del superadmin con la capacidad nueva. */
export function permisosDueno(): Permisos {
  return { ...permisosEncargado(), tuRol: 'superadmin' };
}

export function usuarioEquipo(cambios: Partial<UsuarioEquipo> & { id: string }): UsuarioEquipo {
  return {
    email: null,
    nombre: null,
    rol: 'empleado',
    activo: true,
    eliminadoAt: null,
    tieneHistorial: false,
    gestionable: true,
    fotoVersion: null,
    createdAt: '2026-10-18T15:00:00.000Z',
    updatedAt: '2026-10-18T15:00:00.000Z',
    ...cambios,
  };
}

/** El equipo como lo ve `yo`: Ana (superadmin) o Carla (admin; no ve emails de admins ni superadmins). */
export function equipo(yo: 'ana' | 'carla'): { usuarios: UsuarioEquipo[]; gestionCuentas: boolean } {
  const esAna = yo === 'ana';
  return {
    usuarios: [
      usuarioEquipo({ id: ANA_ID, nombre: 'Ana', rol: 'superadmin', email: esAna ? 'ana@buddys.test' : null, tieneHistorial: true, gestionable: false }),
      usuarioEquipo({ id: CARLA_ID, nombre: 'Carla', rol: 'admin', email: 'carla@buddys.test', tieneHistorial: true, gestionable: esAna }),
      usuarioEquipo({ id: BETO_ID, nombre: 'Beto', email: 'beto@buddys.test', tieneHistorial: true }),
      usuarioEquipo({ id: '00000000-0000-4000-8000-0000000011c1', nombre: 'Lucía Gómez', email: 'lucia@ejemplo.com', tieneHistorial: true }),
      usuarioEquipo({ id: '00000000-0000-4000-8000-0000000011d1', nombre: 'Dani', email: 'dani@ejemplo.com', activo: false }),
      usuarioEquipo({
        id: '00000000-0000-4000-8000-0000000011e1',
        nombre: 'Ezequiel',
        activo: false,
        eliminadoAt: '2026-11-17T13:30:00.000Z',
        tieneHistorial: true,
        gestionable: false,
      }),
    ].map((u) => (esAna || u.id !== CARLA_ID ? u : { ...u, email: null })),
    gestionCuentas: true,
  };
}

// ------------------------------------------------------------------ Recetas y stock (contrato 06)
// reportes/2026-11-17_06_recetas-stock-avisos.md. Recetas, alertas, para comprar y consumo salen de las respuestas
// REALES de respuestas-reales.json (recetasAdmin, alertasAdmin, paraComprarAdmin, consumoAdmin y consumoVacio). Lo
// único armado a mano: la lista de insumos de la pantalla de stock (con los mismos ids y valores) y un tercer insumo
// bajo (guantes) para probar la campanita con 3.

/** Las dos capacidades nuevas del contrato 06, tal como las manda GET /api/admin/permisos (contrato del backend). */
const CAPACIDADES_STOCK: Permisos['capacidades'] = cuerpo<Permisos>('permisosAdmin').capacidades.filter(
  (c) => c.id === 'inventario.recetas' || c.id === 'inventario.consumo',
);

/** Una tabla de permisos con las capacidades del contrato 06 (el contrato del backend ya las trae: queda igual). */
export function conStock(p: Permisos): Permisos {
  const ids = new Set(p.capacidades.map((c) => c.id));
  if (CAPACIDADES_STOCK.every((c) => ids.has(c.id))) return p;
  return { ...p, capacidades: [...p.capacidades, ...CAPACIDADES_STOCK.filter((c) => !ids.has(c.id))] };
}

export const SHAMPOO_ID = '00000000-0000-4000-8000-0000000051a1';
export const CERA_ID = '00000000-0000-4000-8000-0000000051a2';
export const PANOS_ID = '00000000-0000-4000-8000-0000000051a3';
export const GUANTES_ID = '00000000-0000-4000-8000-0000000051a4';

/** Un insumo como lo devuelve GET /api/admin/insumos (para el encargado, con costos). */
export function insumoStock(cambios: Partial<Insumo> & { id: string; nombre: string }): Insumo {
  return {
    categoria: null,
    unidad: 'unidad',
    stock: 10,
    stockMinimo: 0,
    costoUnitario: null,
    activo: true,
    bajoStock: false,
    valorEnStock: null,
    updatedAt: '2026-11-17T15:00:00.000Z',
    ...cambios,
  };
}

export function listaInsumos(): ListaInsumos {
  const insumos = [
    insumoStock({ id: SHAMPOO_ID, nombre: 'Shampoo', categoria: 'Químicos', unidad: 'litro', stock: 0.5, stockMinimo: 1, bajoStock: true, costoUnitario: 9000, valorEnStock: 4500 }),
    insumoStock({ id: PANOS_ID, nombre: 'Paños de microfibra', categoria: 'Accesorios', unidad: 'unidad', stock: 2, stockMinimo: 6, bajoStock: true }),
    insumoStock({ id: CERA_ID, nombre: 'Cera líquida', categoria: 'Químicos', unidad: 'ml', stock: 4000, stockMinimo: 500, costoUnitario: 12, valorEnStock: 48000 }),
  ];
  return { insumos, total: insumos.length, bajoStock: 2, valorTotal: 52500 };
}

/** La misma lista como la recibe el empleado: sin costos ni valores en pesos. */
export function listaInsumosEmpleado(): ListaInsumos {
  const l = listaInsumos();
  return { ...l, valorTotal: null, insumos: l.insumos.map((i) => ({ ...i, costoUnitario: null, valorEnStock: null })) };
}

/**
 * La receta real de Lavado Básico (GET /api/admin/recetas): general con cera (30 ml) y shampoo (0,05 litros), en el
 * orden del backend (por nombre), y una propia para pick-up con cera (45 ml) y shampoo (0,08 litros).
 */
export function recetaBasico(): Receta {
  const receta = cuerpoReal<{ recetas: Receta[] }>('recetasAdmin').recetas.find((r) => r.servicioId === 'lavado-basico');
  if (!receta) throw new Error('Falta la receta de lavado-basico en respuestas-reales.json');
  return receta;
}

/** GET /api/admin/insumos/alertas con `n` insumos: los dos reales (paños y shampoo) y, para n = 3, unos guantes. */
export function alertas(n: number): AlertasStock {
  const todos: AlertasStock['insumos'] = [
    ...cuerpoReal<AlertasStock>('alertasAdmin').insumos,
    { id: GUANTES_ID, nombre: 'Guantes de nitrilo', unidad: 'par', stock: 3, stockMinimo: 5 },
  ];
  return { bajoStock: n, insumos: todos.slice(0, n) };
}

/**
 * GET /api/admin/insumos/para-comprar real: paños (Accesorios, 10 unidades, sin costo) y shampoo (Químicos,
 * 1,5 litros, $ 13.500).
 */
export function paraComprar(): ParaComprar {
  return cuerpoReal<ParaComprar>('paraComprarAdmin');
}

/**
 * GET /api/admin/consumo real de noviembre de 2026 (por día): 5 lavados; cera 900 ml ($ 10.800), paños 4 unidades
 * (sin costo) y shampoo 1,25 litros ($ 11.250); costo de insumos $ 22.050 y $ 4.410 por lavado.
 */
export function consumoNoviembre(): Consumo {
  return cuerpoReal<Consumo>('consumoAdmin');
}

/** GET /api/admin/consumo real de un mes sin lavados ni consumo (enero de 2026). */
export function consumoVacio(): Consumo {
  return cuerpoReal<Consumo>('consumoVacio');
}
