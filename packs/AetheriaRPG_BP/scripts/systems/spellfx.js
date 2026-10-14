// Efectos visuales de los hechizos y motor de proyectiles mágicos (v2).
//
// Este módulo es genérico: dibuja partículas (con presupuesto por tick), sacude la cámara, muestra
// títulos y mueve proyectiles que viajan varios bloques por tick comprobando bloques y entidades.
// La lógica de daño vive en systems/magic.js y llega aquí como callbacks (onHit / onEnd / filter).
//
// Un único bucle (system.runInterval cada tick) se arranca bajo demanda y se detiene solo cuando no
// quedan proyectiles, auras ni "tickers" registrados. Nada accede al mundo al cargar el módulo.
import { system, MolangVariableMap } from '@minecraft/server';
import { ELEMENTS } from '../data/elements.js';
import { isSolid } from '../util/compat.js';

/* ------------------------------------------------------------------ */
/* Vectores                                                             */
/* ------------------------------------------------------------------ */
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vmul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vlen = (a) => Math.hypot(a.x, a.y, a.z);
const vlerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function vnorm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
export const V = { add: vadd, sub: vsub, mul: vmul, len: vlen, lerp: vlerp, dot: vdot, norm: vnorm };

function isValid(e) {
  try { return !!e && e.isValid; } catch { return false; }
}

/** Diagnóstico (pruebas): errores capturados dentro del bucle y contadores. */
export const stats = { errors: 0, lastError: undefined, launched: 0, hits: 0, blockHits: 0 };
function fail(e) {
  stats.errors++;
  stats.lastError = e;
}

/* ------------------------------------------------------------------ */
/* Partículas con presupuesto                                           */
/* ------------------------------------------------------------------ */
/** Máximo de partículas decorativas por tick (las "forzadas" no cuentan contra el límite). */
export const PARTICLE_BUDGET = 200;
let budgetTick = -1;
let used = 0;

function spend(n = 1) {
  const t = system.currentTick;
  if (t !== budgetTick) { budgetTick = t; used = 0; }
  if (used + n > PARTICLE_BUDGET) return false;
  used += n;
  return true;
}

const maps = new Map();
function colorMap(rgb) {
  const key = rgb.map((c) => Math.round(c * 50)).join(',');
  let m = maps.get(key);
  if (!m) {
    if (maps.size > 96) maps.clear();
    try {
      m = new MolangVariableMap();
      m.setColorRGB('variable.color', { red: rgb[0], green: rgb[1], blue: rgb[2] });
    } catch { return undefined; }
    maps.set(key, m);
  }
  return m;
}

/** Partícula (decorativa salvo force=true). rgb opcional → variable.color. */
export function px(dim, id, loc, rgb, force = false) {
  if (!dim || !loc) return false;
  if (!force && !spend()) return false;
  try {
    const m = rgb ? colorMap(rgb) : undefined;
    if (m) dim.spawnParticle(id, loc, m);
    else dim.spawnParticle(id, loc);
    return true;
  } catch { return false; }
}

/** Línea de partículas entre dos puntos. */
export function line(dim, a, b, rgb, step = 0.5, id = 'rpg:spark', max = 48) {
  const d = vsub(b, a);
  const l = vlen(d);
  const n = Math.max(1, Math.min(max, Math.ceil(l / step)));
  for (let i = 0; i <= n; i++) if (!px(dim, id, vlerp(a, b, i / n), rgb)) break;
}

/** Anillo horizontal. */
export function ring(dim, c, r, rgb, points = 20, id = 'rpg:spark', yOff = 0.15) {
  const n = Math.max(6, Math.min(64, Math.round(points)));
  const a0 = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    if (!px(dim, id, { x: c.x + Math.cos(a) * r, y: c.y + yOff, z: c.z + Math.sin(a) * r }, rgb)) break;
  }
}

/** Círculo mágico bajo los pies (partícula rpg:circle + anillo de chispas). */
export function circle(dim, loc, rgb, r = 1.2) {
  px(dim, 'rpg:circle', { x: loc.x, y: loc.y + 0.06, z: loc.z }, rgb, true);
  ring(dim, loc, r, rgb, 8 + r * 6, 'rpg:spark', 0.1);
}

/** Esfera de puntos (escudos, nubes). */
export function sphere(dim, c, r, rgb, n = 24, id = 'rpg:spark') {
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    if (!px(dim, id, { x: c.x + Math.cos(a) * rad * r, y: c.y + y * r, z: c.z + Math.sin(a) * rad * r }, rgb)) break;
  }
}

/** Impacto del elemento: rpg:fx_<elemento> + destello coloreado (+ extra si big). */
export function impact(dim, loc, elId, rgb, big = false) {
  const el = ELEMENTS[elId];
  px(dim, 'rpg:fx_' + elId, loc, undefined, true);
  px(dim, 'rpg:burst', loc, rgb ?? el?.rgb, true);
  if (el?.trail) px(dim, el.trail, loc);
  if (big) {
    for (let i = 0; i < 3; i++) px(dim, 'rpg:fx_' + elId, { x: loc.x + (Math.random() - 0.5) * 2, y: loc.y + Math.random(), z: loc.z + (Math.random() - 0.5) * 2 });
    ring(dim, { x: loc.x, y: loc.y - 0.6, z: loc.z }, 1.8, rgb ?? el?.rgb, 14);
  }
}

/** Arco eléctrico en zigzag entre dos puntos. */
export function arc(dim, a, b, rgb, jitter = 0.45) {
  const segs = Math.max(3, Math.min(10, Math.round(vlen(vsub(b, a)) / 1.2)));
  let prev = a;
  for (let i = 1; i <= segs; i++) {
    let p = vlerp(a, b, i / segs);
    if (i < segs) p = { x: p.x + (Math.random() - 0.5) * 2 * jitter, y: p.y + (Math.random() - 0.5) * 2 * jitter, z: p.z + (Math.random() - 0.5) * 2 * jitter };
    line(dim, prev, p, rgb, 0.3, 'rpg:spark', 12);
    prev = p;
  }
  px(dim, 'minecraft:electric_spark_particle', b);
}

/** Zarcillo curvo (maldiciones): arco de Bézier con joroba hacia arriba. */
export function tendril(dim, a, b, rgb, bulge = 1.2) {
  const mid = vlerp(a, b, 0.5);
  const ctrl = { x: mid.x + (Math.random() - 0.5) * bulge, y: mid.y + bulge, z: mid.z + (Math.random() - 0.5) * bulge };
  const n = Math.max(6, Math.min(24, Math.round(vlen(vsub(b, a)) / 0.4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = vadd(vadd(vmul(a, (1 - t) * (1 - t)), vmul(ctrl, 2 * (1 - t) * t)), vmul(b, t * t));
    if (!px(dim, 'rpg:spark', p, rgb)) break;
  }
}

/** Columna vertical (pilares de luz, rayos del cielo). */
export function pillar(dim, base, height, rgb, step = 0.5) {
  line(dim, base, { x: base.x, y: base.y + height, z: base.z }, rgb, step, 'rpg:spark', 40);
}

/** Relámpago visual (sin entidad vanilla: no quema ni convierte aldeanos) que cae del cielo sobre `ground`. */
export function lightning(dim, ground, rgb = [1, 0.95, 0.4], height = 14) {
  const top = { x: ground.x + (Math.random() - 0.5) * 2.5, y: ground.y + height, z: ground.z + (Math.random() - 0.5) * 2.5 };
  arc(dim, top, ground, rgb, 0.9);
  // rama secundaria
  const mid = vlerp(top, ground, 0.45 + Math.random() * 0.2);
  arc(dim, mid, { x: mid.x + (Math.random() - 0.5) * 4, y: ground.y + 0.5, z: mid.z + (Math.random() - 0.5) * 4 }, rgb, 0.6);
  px(dim, 'rpg:fx_rayo', ground, undefined, true);
  px(dim, 'rpg:burst', { x: ground.x, y: ground.y + 0.4, z: ground.z }, rgb, true);
}

/** Torbellino: espiral ascendente alrededor de un punto (dominios de viento/agua, tornados). */
export function vortex(dim, c, r, rgb, height = 2.5, n = 12, phase = 0) {
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = phase + t * Math.PI * 4;
    const rr = r * (0.35 + 0.65 * t);
    if (!px(dim, 'rpg:spark', { x: c.x + Math.cos(a) * rr, y: c.y + 0.1 + t * height, z: c.z + Math.sin(a) * rr }, rgb)) break;
  }
}

/** Anillo que sube desde los pies (lanzamientos de nivel alto). */
export function risingRing(dim, c, r, rgb, steps = 4, every = 2) {
  repeat(steps, every, (i) => {
    ring(dim, { x: c.x, y: c.y + i * 0.45, z: c.z }, r * (1 - i * 0.12), rgb, 10 + r * 4, 'rpg:spark', 0.1);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Cámara, títulos y sonido                                             */
/* ------------------------------------------------------------------ */
const lastShake = new Map();

/** Sacudida de cámara (comando camerashake; Camera.addShake no existe en 2.6.0). Limitada a 1 cada 8 ticks. */
export function shake(player, intensity = 0.3, seconds = 0.5) {
  if (!isValid(player) || player.typeId !== 'minecraft:player') return false;
  const now = system.currentTick;
  if (now - (lastShake.get(player.id) ?? -99) < 8) return false;
  lastShake.set(player.id, now);
  const i = Math.max(0.05, Math.min(2, intensity)).toFixed(2);
  const s = Math.max(0.1, Math.min(4, seconds)).toFixed(2);
  try { player.runCommand(`camerashake add @s ${i} ${s} positional`); return true; } catch { return false; }
}

/** Sacude a los jugadores cercanos a un punto (intensidad decreciente con la distancia). */
export function shakeNear(dim, loc, radius, intensity = 0.3, seconds = 0.5) {
  let list = [];
  try { list = dim.getPlayers({ location: loc, maxDistance: radius }); } catch { return; }
  for (const p of list) {
    let d = radius;
    try { d = vlen(vsub(p.location, loc)); } catch {}
    shake(p, intensity * (1 - 0.5 * Math.min(1, d / Math.max(1, radius))), seconds);
  }
}

/** Título grande en pantalla. */
export function bigTitle(player, text, sub = '', stay = 40) {
  try {
    player.onScreenDisplay.setTitle(text, { subtitle: sub, fadeInDuration: 4, stayDuration: stay, fadeOutDuration: 12 });
    return true;
  } catch { return false; }
}

export function playAt(dim, id, loc, volume = 1, pitch = 1) {
  if (!id) return;
  try { dim.playSound(id, loc, { volume, pitch }); } catch {}
}

/* ------------------------------------------------------------------ */
/* Posiciones                                                           */
/* ------------------------------------------------------------------ */
/** Posición aproximada de la mano derecha (origen de los proyectiles). */
export function handPos(entity) {
  let head;
  let dir;
  try { head = entity.getHeadLocation(); } catch {}
  try { dir = entity.getViewDirection(); } catch {}
  if (!head) {
    try { head = { x: entity.location.x, y: entity.location.y + 1.5, z: entity.location.z }; } catch { return undefined; }
  }
  if (!dir) dir = { x: 0, y: 0, z: 1 };
  const fl = Math.hypot(dir.x, dir.z) || 1;
  const right = { x: -dir.z / fl, y: 0, z: dir.x / fl };
  return { x: head.x + dir.x * 0.55 + right.x * 0.32, y: head.y - 0.28 + dir.y * 0.4, z: head.z + dir.z * 0.55 + right.z * 0.32 };
}

// Tamaños aproximados (radio, altura) si Entity.getAABB no está disponible.
const SIZE = {
  'rpg:goblin': [0.25, 1.3], 'rpg:dire_wolf': [0.45, 1.1], 'rpg:orc': [0.4, 2.2], 'rpg:scorpion': [0.65, 0.8], 'rpg:skeleton_knight': [0.3, 1.95],
  'rpg:giant_spider': [1.0, 1.2], 'rpg:wraith': [0.3, 1.9], 'rpg:mimic': [0.45, 0.95], 'rpg:dark_mage': [0.3, 1.9], 'rpg:ice_golem': [0.5, 3.0],
  'rpg:fire_imp': [0.25, 1.15], 'rpg:troll': [0.55, 3.3], 'rpg:demon_knight': [0.4, 2.5], 'rpg:goblin_king': [0.55, 3.2], 'rpg:spider_queen': [1.75, 2.2],
  'rpg:ancient_golem': [0.8, 4.6], 'rpg:lich': [0.4, 2.6], 'rpg:demon_lord': [0.65, 4.0], 'rpg:ash_dragon': [1.75, 3.2], 'rpg:void_king': [0.7, 4.4],
  'minecraft:iron_golem': [0.7, 2.9], 'minecraft:ravager': [1.0, 2.2], 'minecraft:spider': [0.7, 0.9], 'minecraft:cave_spider': [0.35, 0.5],
  'minecraft:ender_dragon': [4, 4], 'minecraft:wither': [0.5, 3.5], 'minecraft:warden': [0.45, 2.9], 'minecraft:ghast': [2, 4], 'minecraft:enderman': [0.3, 2.9],
  'minecraft:chicken': [0.2, 0.7], 'minecraft:silverfish': [0.2, 0.3], 'minecraft:endermite': [0.2, 0.3], 'minecraft:bat': [0.25, 0.9], 'minecraft:vex': [0.2, 0.8],
  'minecraft:phantom': [0.45, 0.5], 'minecraft:slime': [0.5, 1.0], 'minecraft:magma_cube': [0.5, 1.0], 'minecraft:rabbit': [0.2, 0.5], 'minecraft:wolf': [0.3, 0.85],
  'minecraft:creeper': [0.3, 1.7], 'minecraft:cow': [0.45, 1.3], 'minecraft:pig': [0.45, 0.9], 'minecraft:sheep': [0.45, 1.3], 'minecraft:hoglin': [0.7, 1.4],
};

/** Caja de colisión simplificada { cx, cz, y0, y1, r }. */
export function bodyOf(e) {
  try {
    if (typeof e.getAABB === 'function') {
      const b = e.getAABB();
      if (b && b.center && b.extent) return { cx: b.center.x, cz: b.center.z, y0: b.center.y - b.extent.y, y1: b.center.y + b.extent.y, r: Math.max(0.2, Math.max(b.extent.x, b.extent.z)) };
    }
  } catch {}
  const l = e.location;
  const s = SIZE[e.typeId] ?? [0.35, 1.8];
  return { cx: l.x, cz: l.z, y0: l.y, y1: l.y + s[1], r: s[0] };
}

/** Centro del cuerpo (para apuntar). */
export function bodyCenter(e) {
  try {
    const b = bodyOf(e);
    return { x: b.cx, y: (b.y0 + b.y1) / 2, z: b.cz };
  } catch { return undefined; }
}

/** Primer t∈[0,1] en que el segmento a→b toca el cuerpo (cilindro vertical), o undefined. */
export function segmentHitsBody(a, b, body, size = 0.3) {
  const l = vlen(vsub(b, a));
  const n = Math.max(1, Math.ceil(l / 0.3));
  const rr = body.r + size;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    if (y < body.y0 - size || y > body.y1 + size) continue;
    if (Math.hypot(x - body.cx, z - body.cz) <= rr) return t;
  }
  return undefined;
}

/** Bloque sólido en el rayo (undefined si no hay; null si no se puede consultar: chunk sin cargar / fuera del mundo). */
export function rayBlock(dim, from, dir, maxDistance) {
  if (!(maxDistance > 0)) return undefined;
  try {
    const hit = dim.getBlockFromRay(from, dir, { maxDistance, includeLiquidBlocks: false, includePassableBlocks: false });
    if (!hit) return undefined;
    // faceLocation es relativa a la esquina noroeste inferior del bloque
    const p = vadd(hit.block.location, hit.faceLocation ?? { x: 0.5, y: 0.5, z: 0.5 });
    // separa un poco el punto de la cara para no dibujar dentro del bloque
    return { block: hit.block, point: vsub(p, vmul(dir, 0.15)) };
  } catch {
    return sampleBlocks(dim, from, dir, maxDistance);
  }
}

/** Alternativa a getBlockFromRay: muestrea bloques cada 0,25 a lo largo del rayo. */
function sampleBlocks(dim, from, dir, maxDistance) {
  const n = Math.min(64, Math.ceil(maxDistance / 0.25));
  let lastKey = '';
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * maxDistance;
    const p = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
    const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
    if (key === lastKey) continue;
    lastKey = key;
    let b;
    try { b = dim.getBlock(p); } catch { return null; }
    if (!b) return null; // chunk sin cargar
    if (isSolid(b)) return { block: b, point: vsub(p, vmul(dir, 0.2)) };
  }
  return undefined;
}

/** Suelo bajo un punto (y del primer bloque sólido + 1) o el propio y si no se encuentra. */
export function groundAt(dim, p, depth = 10) {
  const x = Math.floor(p.x);
  const z = Math.floor(p.z);
  for (let y = Math.floor(p.y) + 1; y >= Math.floor(p.y) - depth; y--) {
    let b;
    try { b = dim.getBlock({ x, y, z }); } catch { return p.y; }
    if (!b) return p.y;
    if (isSolid(b)) return y + 1;
  }
  return p.y;
}

/* ------------------------------------------------------------------ */
/* Bucle central: proyectiles, auras y tickers                          */
/* ------------------------------------------------------------------ */
export const MAX_PROJECTILES = 48;
export const MAX_PER_OWNER = 12;
const QUERY_BUDGET = 80; // consultas de colisión por tick (bloque + entidades)
const EXCLUDE_TYPES = ['minecraft:item', 'minecraft:xp_orb', 'minecraft:arrow', 'minecraft:snowball', 'rpg:tomato', 'rpg:waypoint'];

const projectiles = [];
const auras = new Map();
const tickers = new Map();
let loopId;
let seq = 0;
let qTick = -1;
let queries = 0;

function canQuery(n = 2) {
  const t = system.currentTick;
  if (t !== qTick) { qTick = t; queries = 0; }
  if (queries + n > QUERY_BUDGET) return false;
  queries += n;
  return true;
}

function ensureLoop() {
  if (loopId !== undefined) return;
  try { loopId = system.runInterval(loop, 1); } catch { loopId = undefined; }
}

function loop() {
  const now = system.currentTick;
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    if (p.dead) continue;
    try { stepProjectile(p); } catch (e) { p.dead = true; fail(e); }
  }
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
  if (auras.size && now % 5 === 0) {
    try { auraTick(now); } catch (e) { fail(e); }
  }
  if (tickers.size) {
    for (const [k, t] of [...tickers]) {
      if (now < t.next || tickers.get(k) !== t) continue;
      t.next = now + t.every;
      let keep = true;
      try { keep = t.fn(now); } catch (e) { keep = false; fail(e); }
      if (keep === false && tickers.get(k) === t) tickers.delete(k);
    }
  }
  if (!projectiles.length && !auras.size && !tickers.size) {
    try { system.clearRun(loopId); } catch {}
    loopId = undefined;
  }
}

/** Detiene un ticker registrado. */
export function stopTicker(key) {
  tickers.delete(key);
}

/** Registra una función periódica (cada `every` ticks) mientras devuelva algo distinto de false. */
export function ticker(key, every, fn) {
  const t = tickers.get(key);
  if (t) { t.fn = fn; t.every = every; } else tickers.set(key, { every: Math.max(1, every), fn, next: system.currentTick + Math.max(1, every) });
  ensureLoop();
}

export function hasTicker(key) {
  return tickers.has(key);
}

/** Repite fn(i) `times` veces cada `every` ticks (se detiene si devuelve false). Devuelve el id. */
export function repeat(times, every, fn) {
  let n = 0;
  let id;
  try {
    id = system.runInterval(() => {
      let r;
      try { r = fn(n); } catch (e) { r = false; fail(e); }
      n++;
      if (n >= times || r === false) { try { system.clearRun(id); } catch {} }
    }, Math.max(1, every));
  } catch {}
  return id;
}

/** Ejecuta fn tras `ticks` ticks (protegido). */
export function later(ticks, fn) {
  try { return system.runTimeout(() => { try { fn(); } catch (e) { fail(e); } }, Math.max(1, Math.floor(ticks))); } catch { return undefined; }
}

export function cancel(id) {
  if (id === undefined) return;
  try { system.clearRun(id); } catch {}
}

/**
 * Lanza un proyectil mágico.
 * o = { dim, from, dir, speed (bloques/tick), range, rgb, el, size, pierce (0 | n | Infinity), ownerId,
 *       filter(entity)→bool, onHit(entity, point, proj), onEnd(point, proj) (bloque o fin del alcance; proj.blockHit),
 *       homing: entity, homingStrength, gravity, ignoreBlocks, trail: 'spark'|'dense'|'none', vtrail: id vanilla,
 *       scale, maxLife }
 */
export function launch(o) {
  if (!o || !o.dim || !o.from || !o.dir || !(vlen(o.dir) > 1e-6)) return undefined;
  if (o.ownerId) {
    const mine = projectiles.filter((p) => !p.dead && p.ownerId === o.ownerId);
    if (mine.length >= MAX_PER_OWNER) mine[0].dead = true;
  }
  const alive = projectiles.filter((p) => !p.dead);
  if (alive.length >= MAX_PROJECTILES) alive[0].dead = true;
  const p = {
    id: ++seq, speed: 1.6, range: 20, size: 0.35, pierce: 0, trail: 'spark', homingStrength: 0.15, gravity: 0, maxLife: 200, scale: 1,
    ...o,
    dir: vnorm(o.dir), pos: { ...o.from }, checkFrom: { ...o.from }, traveled: 0, age: 0, hitIds: new Set(), dead: false,
  };
  p.pierceLeft = p.pierce;
  projectiles.push(p);
  stats.launched++;
  px(p.dim, 'rpg:burst', p.from, p.rgb);
  ensureLoop();
  return p;
}

function endProjectile(p, callEnd) {
  if (p.dead) return;
  p.dead = true;
  if (callEnd && p.onEnd) {
    try { p.onEnd(p.pos, p); } catch (e) { fail(e); }
  }
}

function drawTrail(p, a, b) {
  const dim = p.dim;
  if (p.trail !== 'none') {
    const step = p.trail === 'dense' ? 0.3 : 0.5;
    const l = vlen(vsub(b, a));
    const n = Math.min(p.trail === 'dense' ? 14 : 8, Math.ceil(l / step));
    for (let i = 1; i <= n; i++) if (!px(dim, 'rpg:spark', vlerp(a, b, i / n), p.rgb)) break;
  }
  px(dim, 'rpg:orb', b, p.rgb, true);
  if (p.scale >= 1.1 || p.size >= 0.6) px(dim, 'rpg:orb', vlerp(a, b, 0.6), p.rgb);
  if (p.vtrail && p.age % 2 === 0) px(dim, p.vtrail, b);
}

function stepProjectile(p) {
  p.age++;
  if (p.age > p.maxLife) return endProjectile(p, true);
  // Autoapuntado suave
  if (p.homing) {
    if (!isValid(p.homing)) p.homing = undefined;
    else {
      const c = bodyCenter(p.homing);
      if (c) {
        const want = vnorm(vsub(c, p.pos));
        if (vdot(want, p.dir) > 0.35) p.dir = vnorm(vadd(vmul(p.dir, 1 - p.homingStrength), vmul(want, p.homingStrength)));
      }
    }
  }
  if (p.gravity) p.dir = vnorm({ x: p.dir.x, y: p.dir.y - p.gravity, z: p.dir.z });
  const len = Math.min(p.speed, p.range - p.traveled);
  if (len <= 0.01) return endProjectile(p, true);
  const next = vadd(p.pos, vmul(p.dir, len));
  if (!canQuery(p.ignoreBlocks ? 1 : 2)) {
    // sin presupuesto: avanza sin comprobar; el siguiente tick comprueba desde checkFrom
    drawTrail(p, p.pos, next);
    p.traveled += len;
    p.pos = next;
    if (p.traveled >= p.range - 0.01) endProjectile(p, true);
    return;
  }
  const from = p.checkFrom;
  const seg = vsub(next, from);
  const segLen = vlen(seg) || len;
  const sdir = vlen(seg) > 0 ? vnorm(seg) : p.dir;
  let stop = next;
  let blockHit;
  if (!p.ignoreBlocks) {
    blockHit = rayBlock(p.dim, from, sdir, segLen + 0.05);
    if (blockHit === null) return endProjectile(p, false); // fuera del mundo / chunk sin cargar
    if (blockHit) stop = blockHit.point;
  }
  const hits = entitiesOnSegment(p, from, stop);
  for (const h of hits) {
    if (p.dead) return;
    p.hitIds.add(h.e.id);
    stats.hits++;
    try { p.onHit?.(h.e, h.point, p); } catch (e) { fail(e); }
    if (p.pierceLeft <= 0) {
      drawTrail(p, p.pos, h.point);
      p.pos = h.point;
      p.dead = true;
      return;
    }
    p.pierceLeft--;
  }
  drawTrail(p, p.pos, stop);
  p.traveled += vlen(vsub(stop, p.pos));
  p.pos = stop;
  p.checkFrom = stop;
  if (blockHit) {
    p.blockHit = blockHit.block;
    stats.blockHits++;
    return endProjectile(p, true);
  }
  if (p.traveled >= p.range - 0.01) endProjectile(p, true);
}

let excludeBroken = false;
/**
 * dim.getEntities con excludeTypes; si el motor rechaza la consulta (p. ej. un identificador de entidad que
 * aún no existe en el paquete), repite sin excludeTypes y filtra en JavaScript (y lo recuerda).
 */
export function queryEntities(dim, opts) {
  if (!dim) return [];
  if (opts.excludeTypes && !excludeBroken) {
    try { return dim.getEntities(opts); } catch { excludeBroken = true; }
  }
  const { excludeTypes, ...rest } = opts;
  let list;
  try { list = dim.getEntities(rest); } catch { return []; }
  if (!excludeTypes) return list;
  return list.filter((e) => { try { return !excludeTypes.includes(e.typeId); } catch { return false; } });
}

function entitiesOnSegment(p, a, b) {
  const mid = vlerp(a, b, 0.5);
  const half = vlen(vsub(b, a)) / 2;
  const list = queryEntities(p.dim, { location: mid, maxDistance: half + 3.5 + p.size, excludeTypes: EXCLUDE_TYPES });
  const out = [];
  for (const e of list) {
    try {
      if (!e || !e.isValid || e.id === p.ownerId || p.hitIds.has(e.id)) continue;
      if (p.filter && !p.filter(e)) continue;
      const t = segmentHitsBody(a, b, bodyOf(e), p.size);
      if (t !== undefined) out.push({ e, t, point: vlerp(a, b, t) });
    } catch {}
  }
  return out.sort((x, y) => x.t - y.t);
}

/** Proyectiles activos (para pruebas/diagnóstico). */
export function activeProjectiles() {
  return projectiles.filter((p) => !p.dead).length;
}

/** Termina todos los proyectiles de un dueño (o todos). */
export function clearProjectiles(ownerId) {
  for (const p of projectiles) if (!ownerId || p.ownerId === ownerId) p.dead = true;
}

/* ------------------------------------------------------------------ */
/* Auras persistentes (potenciaciones)                                  */
/* ------------------------------------------------------------------ */
/** Aura de color alrededor de una entidad durante `ticks`. */
export function aura(entity, rgb, ticks, elId) {
  if (!isValid(entity)) return;
  auras.set(entity.id, { e: entity, rgb, el: elId, until: system.currentTick + Math.max(10, ticks) });
  ensureLoop();
}

export function clearAura(entity) {
  try { auras.delete(entity.id); } catch {}
}

function auraTick(now) {
  let shown = 0;
  for (const [id, a] of auras) {
    if (a.until < now || !isValid(a.e)) { auras.delete(id); continue; }
    if (shown++ > 24) continue;
    let l;
    try { l = a.e.location; } catch { auras.delete(id); continue; }
    const dim = a.e.dimension;
    px(dim, 'rpg:aura', l, a.rgb);
    const ang = now * 0.3;
    for (let k = 0; k < 2; k++) {
      const an = ang + k * Math.PI;
      px(dim, 'rpg:spark', { x: l.x + Math.cos(an) * 0.75, y: l.y + 0.3 + ((now / 5 + k * 4) % 8) * 0.2, z: l.z + Math.sin(an) * 0.75 }, a.rgb);
    }
  }
}

/** Espiral ascendente alrededor de una entidad (al lanzar potenciaciones). */
export function helix(entity, rgb, ticks = 16, radius = 0.9, height = 2.2) {
  repeat(ticks, 1, (i) => {
    if (!isValid(entity)) return false;
    const l = entity.location;
    const dim = entity.dimension;
    for (let k = 0; k < 2; k++) {
      const a = i * 0.7 + k * Math.PI;
      px(dim, 'rpg:spark', { x: l.x + Math.cos(a) * radius, y: l.y + (i / ticks) * height, z: l.z + Math.sin(a) * radius }, rgb);
    }
    return true;
  });
}

/** Onda expansiva: anillos crecientes; onStep(r, i) se llama en cada anillo. */
export function wave(dim, c, rMax, rgb, steps = 3, every = 2, onStep) {
  repeat(steps, every, (i) => {
    const r = (rMax * (i + 1)) / steps;
    ring(dim, c, r, rgb, 10 + r * 5, 'rpg:spark', 0.2);
    if (i === steps - 1) px(dim, 'rpg:circle', { x: c.x, y: c.y + 0.06, z: c.z }, rgb, true);
    try { onStep?.(r, i); } catch {}
    return true;
  });
}

/** Aviso en el suelo (hechizos enemigos): círculo rojo/elemental antes del impacto. */
export function telegraph(dim, loc, r, rgb) {
  px(dim, 'rpg:circle', { x: loc.x, y: loc.y + 0.06, z: loc.z }, rgb, true);
  ring(dim, loc, r, rgb, 10 + r * 4, 'rpg:spark', 0.1);
}
