/**
 * CSV para Excel en español de Argentina: UTF-8 con BOM (si no, Excel muestra mal las tildes), separador ";" (la
 * coma es el separador decimal), coma decimal y fin de línea \r\n.
 *
 * Seguridad (inyección de fórmulas, CWE-1236): un TEXTO que empieza con = + - @ (o tabulación / retorno) Excel lo
 * interpreta como fórmula. Se le antepone un apóstrofo: se ve el texto tal cual y no se ejecuta nada. Los números
 * van sin esa marca (un -500 es un número, no una fórmula).
 */

export type Celda = string | number | null | undefined;

const BOM = '﻿';
const FORMULA = /^[=+\-@\t\r]/;

/** Un número en formato es-AR sin separador de miles: 1234,5 (enteros sin decimales). */
export function numeroCsv(valor: number): string {
  if (!Number.isFinite(valor)) return '';
  return String(Math.round(valor * 10_000) / 10_000).replace('.', ',');
}

function celda(valor: Celda): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return numeroCsv(valor);
  const texto = FORMULA.test(valor) ? `'${valor}` : valor;
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Arma el archivo: cada renglón es una lista de celdas; un renglón vacío ([]) separa bloques. */
export function armarCsv(renglones: readonly (readonly Celda[])[]): string {
  return BOM + renglones.map((renglon) => renglon.map(celda).join(';')).join('\r\n') + '\r\n';
}
