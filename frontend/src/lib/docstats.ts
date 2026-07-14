/** Métrica ÚNICA del documento en toda la app (Resumen, editor, vista previa).
 *
 *  Una sola fórmula para páginas y tiempo de lectura: si dos pantallas
 *  muestran el dato, muestran el MISMO número. El conteo de palabras viene
 *  del backend (texto legible, sin sintaxis markdown) o del editor en vivo
 *  (texto renderizado) — ambos miden lo mismo.
 */

/** Maqueta del export A4 (~450 palabras por página). */
export const WORDS_PER_PAGE = 450;
/** Lectura profesional promedio. */
export const WORDS_PER_MINUTE = 200;

export const estimatePages = (words: number): number =>
  words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_PAGE)) : 0;

export const readingMinutes = (words: number): number =>
  words > 0 ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0;
