// Cómo se arma src/test/respuestas-reales.json a partir del contrato del backend
// (backend/test/fixtures/respuestas-api.json, que el backend regenera con ACTUALIZAR_FIXTURES=1). Sin dependencias ni
// acceso a disco: lo usan el script (actualizar-respuestas.ts) y su test (respuestas.test.ts).
//
// Cada clave que usa el frontend es de uno de tres tipos:
//  - copiar: la respuesta del backend tal cual (los errores: mismo código y mismo mensaje).
//  - conformar: la FORMA sale del backend (claves nuevas se suman con el valor del backend, claves que el backend ya
//    no manda se sacan, el status es el del backend) y los VALORES quedan los de acá, porque los tests del panel
//    cuentan con esos datos (Ana y Beto, $ 72.000, etc.).
//  - propia: el contrato del backend todavía no la trae (login, /me, refresh, 401, 415...): queda como está.
// Los ids de Ana y Beto del backend se cambian por los fijos del frontend.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export interface Respuesta {
  status: number;
  body?: Json;
}
export type Respuestas = Record<string, Respuesta>;

export const ANA_ID = '00000000-0000-4000-8000-00000000a0a0';
export const BETO_ID = '00000000-0000-4000-8000-00000000b0b0';
/** Ids que usa la app de test del backend → los del frontend. */
export const IDS: Record<string, string> = {
  '00000000-0000-4000-8000-000000000002': ANA_ID,
  '00000000-0000-4000-8000-000000000004': BETO_ID,
};

export const COPIAR: Record<string, string> = {
  lavadoEmpleadoOtro: 'error403EmpleadoCorrige',
  lavadoServiciosRepetidos: 'error400LavadoServiciosRepetidos',
  lavadoServicioIdYServicioIds: 'error400LavadoServicioIdYServicioIds',
  patchServiciosEmpleado: 'error403ServiciosEmpleado',
  metaEmpleado: 'error403MetasEmpleado',
  gastosEmpleado: 'error403GastosEmpleado',
};

export const CONFORMAR: Record<string, string> = {
  lavadoAdmin: 'lavadoCrea',
  lavadoAdminMinimo: 'lavadoCrea',
  lavadoLegadoServicioId: 'lavadoCrea',
  lavadoEmpleado: 'lavadoCreaEmpleado',
  lavadoVariosAdmin: 'lavadoCreaVarios',
  lavadoVariosEmpleado: 'lavadoCreaVariosEmpleado',
  planillaAdmin: 'lavadosDiaAdmin',
  planillaEmpleado: 'lavadosDiaEmpleado',
  planillaVacia: 'lavadosDiaAdmin',
  patchAdminTodo: 'patchAdminCompleta',
  patchEmpleado: 'patchEmpleadoCompleta',
  patchAdminServicios: 'patchServicios',
  patchAdminMontoNull: 'patchAdminCompletaSinCobro',
  trabajadoresAdmin: 'trabajadores',
};

export const PROPIAS = [
  // Tanda 03-06 (rama main): las arman sus propios tests del panel; el contrato del backend las verifica en contrato.test.ts.
  'perfilAdmin',
  'perfilEmpleado',
  'perfilPatchNombre',
  'perfilPatchNombreNull',
  'perfilPatchPassword',
  'perfilPasswordActualMal',
  'perfilPasswordLimite',
  'perfilFotoSube',
  'perfilFotoInvalida',
  'perfilFotoPesada',
  'meAdminConFoto',
  'usuariosAdminConFoto',
  'fotoAjenaEmpleado',
  'perfilFotoQuita',
  'perfilSinFotos',
  'recetaPut',
  'recetaPutVehiculo',
  'recetaPutInsumoInvalido',
  'recetaPutVehiculoNoOfrecido',
  'recetaPutEmpleado',
  'recetasAdmin',
  'recetasEmpleado',
  'alertasAdmin',
  'alertasEmpleado',
  'paraComprarAdmin',
  'paraComprarEmpleado',
  'consumoAdmin',
  'consumoVacio',
  'consumoEmpleado',
  'loginAdmin',
  'meAdmin',
  'meEmpleado',
  'meSinSesion',
  'loginMal',
  'loginVacio',
  'loginOrigenMalo',
  'postSinContentType',
  'lavadosSinSesion',
  'lavadoValidacion',
  'lavadoFuturo',
  'lavadoFueraLimite',
  'lavadoCampoExtra',
  'lavadoServiciosDemasiados',
  'lavadoServiciosVacio',
  'planillaFechaMala',
  'patchVacio',
  'patchIdMalo',
  'deleteEmpleado',
  'deleteAdmin',
  'deleteOtraVez',
  'trabajadoresEmpleado',
  'usuariosAdmin',
  'usuariosEmpleado',
  'lavadosVencida',
  'refreshOk',
  'refreshSinSesion',
  'logout',
];

function esObjeto(v: Json | undefined): v is Record<string, Json> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Cambia los ids del backend por los del frontend, en cualquier string del valor. */
export function cambiarIds(v: Json): Json {
  if (typeof v === 'string') return IDS[v] ?? v;
  if (Array.isArray(v)) return v.map(cambiarIds);
  if (esObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cambiarIds(x)]));
  return v;
}

/** El valor de acá con la forma de la plantilla del backend (ver el comentario de arriba). */
export function conformar(valor: Json, plantilla: Json): Json {
  if (Array.isArray(valor) && Array.isArray(plantilla)) {
    const molde = plantilla[0];
    return molde === undefined ? valor : valor.map((v) => conformar(v, molde));
  }
  if (esObjeto(valor) && esObjeto(plantilla)) {
    return Object.fromEntries(
      Object.entries(plantilla).map(([k, p]) => [k, k in valor ? conformar(valor[k] ?? null, p) : cambiarIds(p)]),
    );
  }
  return valor;
}

export interface Resultado {
  respuestas: Respuestas;
  /** Lo que conviene revisar a mano (claves que faltan o que nadie mapeó). */
  avisos: string[];
}

/** Arma respuestas-reales.json a partir del contrato del backend y del archivo actual. */
export function generar(backend: Respuestas, actuales: Respuestas): Resultado {
  const avisos: string[] = [];
  const respuestas: Respuestas = {};
  const conocidas = new Set([...Object.keys(COPIAR), ...Object.keys(CONFORMAR), ...PROPIAS]);
  for (const clave of Object.keys(actuales)) {
    if (!conocidas.has(clave)) avisos.push(`${clave}: no está en ningún mapa de scripts/respuestas.ts (queda como está).`);
  }
  // En el orden del archivo actual (así el diff es chico); las que falten, al final.
  const orden = [...new Set([...Object.keys(actuales), ...conocidas])];
  for (const clave of orden) {
    const actual = actuales[clave];
    const desdeCopiar = COPIAR[clave];
    const desdeConformar = CONFORMAR[clave];
    const fuente = desdeCopiar ?? desdeConformar;
    if (fuente !== undefined) {
      const delBackend = backend[fuente];
      if (!delBackend) {
        avisos.push(`${clave}: el backend ya no trae ${fuente} (queda como está).`);
        if (actual) respuestas[clave] = actual;
        continue;
      }
      if (desdeCopiar !== undefined || !actual) {
        respuestas[clave] = cambiarIds(delBackend as unknown as Json) as unknown as Respuesta;
        continue;
      }
      const r: Respuesta = { status: delBackend.status };
      if (delBackend.body !== undefined) r.body = conformar(actual.body ?? null, delBackend.body);
      respuestas[clave] = r;
      continue;
    }
    if (actual) respuestas[clave] = actual;
    else avisos.push(`${clave}: es propia del frontend y no está en el archivo (hay que generarla con la app de test del backend).`);
  }
  return { respuestas, avisos };
}

/** Como se guarda el archivo (igual que lo deja Prettier: 2 espacios y salto de línea al final). */
export function serializar(r: Respuestas): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}
