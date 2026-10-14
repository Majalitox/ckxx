// Utilidades matemáticas y aleatorias.

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Elige un valor de una lista [[valor, peso], ...] */
export function weighted(entries, rng = Math.random) {
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/** Hash FNV-1a de 32 bits. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Generador pseudoaleatorio con semilla (xorshift32). */
export function seeded(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const v3 = (x, y, z) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const floorV = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
export const center = (a) => ({ x: Math.floor(a.x) + 0.5, y: Math.floor(a.y), z: Math.floor(a.z) + 0.5 });
export function norm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
export function flatDir(a) {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, y: 0, z: a.z / l };
}

/** Distancia de un punto p al segmento a-b. */
export function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = clamp((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / ((ab.x ** 2 + ab.y ** 2 + ab.z ** 2) || 1), 0, 1);
  return dist(p, add(a, mul(ab, t)));
}

/** Nombre de la dirección cardinal (Minecraft: -Z = Norte, +X = Este). */
export function cardinal(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const ang = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 = norte, 90 = este
  const names = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
  return names[Math.round(((ang + 360) % 360) / 45) % 8];
}
