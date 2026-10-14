// Utilidades de texto.

const ACCENTS = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u' };

/** Normaliza un texto para análisis: minúsculas, sin acentos ni signos. */
export function normalize(text) {
  let s = String(text ?? '').toLowerCase();
  s = s.replace(/[áéíóúüñàèìòù]/g, (c) => ACCENTS[c] ?? c);
  s = s.replace(/[¿¡!.,;:()"'\-_*#@/\\[\]{}<>]/g, ' ');
  s = s.replace(/\?/g, ' ? ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Comprueba si el texto normalizado contiene la palabra/frase clave (respetando límites de palabra). */
export function hasKeyword(normText, kw) {
  return (' ' + normText + ' ').includes(' ' + kw + ' ');
}

export function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Barra de progreso con caracteres. */
export function bar(cur, max, length = 10, on = '§a', off = '§8', ch = '|') {
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const filled = Math.round(ratio * length);
  return on + ch.repeat(filled) + off + ch.repeat(length - filled) + '§r';
}

export function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

/** Reemplaza {clave} por valores del contexto. */
export function fill(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? String(ctx[k]) : m));
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function hearts(points) {
  const n = Math.max(0, Math.min(10, Math.floor(points / 100)));
  return '§c' + '♥'.repeat(n) + '§8' + '♥'.repeat(10 - n) + '§r';
}
