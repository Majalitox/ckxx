// Biblioteca de construcción por comandos (/fill y /setblock) para pueblos y reinos.
//
// Todo se planifica primero (operaciones en una lista, sin tocar el mundo) y luego se ejecuta
// en lotes con system.runJob (ver execOps). Cada edificio se dibuja en un "lienzo" local
// (Canvas) con la fachada (puerta) mirando al norte local (-v); el lienzo lo gira y lo traslada
// al mundo y gira también los estados de bloque direccionales (escaleras, puertas, cofres...).
//
// Estados de bloque verificados con mojang-blocks.json y la wiki:
//  escaleras  weirdo_direction 0=E 1=W 2=S 3=N (lado completo), upside_down_bit
//  puertas    minecraft:cardinal_direction (hacia donde mira quien entra), upper_block_bit
//  cofres/hornos/atriles/yunques/hogueras  minecraft:cardinal_direction
//  escalera de mano / estandarte de pared   facing_direction 2=N 3=S 4=W 5=E
//  cama       direction 0=S 1=W 2=N 3=E (hacia la cabecera), head_piece_bit
//  losas      minecraft:vertical_half "bottom"/"top"; troncos pillar_axis x/y/z
import { ItemStack } from '@minecraft/server';
import { pal, CULTURES } from '../data/cultures.js';

/* ================================================================== */
/* Direcciones y estados                                               */
/* ================================================================== */

export const DIRS = ['N', 'E', 'S', 'W'];
export const DVEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const rotDir = (d, r) => DIRS[(DIRS.indexOf(d) + r) & 3];
export const opposite = (d) => DIRS[(DIRS.indexOf(d) + 2) & 3];

const ENC = {
  w: { E: 0, W: 1, S: 2, N: 3 },
  f: { N: 2, S: 3, W: 4, E: 5 },
  c: { N: 'north', S: 'south', W: 'west', E: 'east' },
  b: { S: 0, W: 1, N: 2, E: 3 },
};

/** Bloque con estados. Los valores ['w'|'f'|'c'|'b', dir] o ['a', eje] se giran con el lienzo. */
export const B = (id, s) => (s ? { id, s } : id);
export const stair = (id, dir, up = false) => ({ id, s: { weirdo_direction: ['w', dir], upside_down_bit: up } });
export const card = (id, dir, extra) => ({ id, s: { 'minecraft:cardinal_direction': ['c', dir], ...(extra ?? {}) } });
export const facing = (id, dir, extra) => ({ id, s: { facing_direction: ['f', dir], ...(extra ?? {}) } });
export const axis = (id, a) => ({ id, s: { pillar_axis: ['a', a] } });
export const slabTop = (id) => ({ id, s: { 'minecraft:vertical_half': 'top' } });
export const hangLantern = (id = 'lantern') => `${id} ["hanging"=true]`;
export const standLantern = (id = 'lantern') => `${id} ["hanging"=false]`;

// Bloques que no deben degradarse a su versión sin estados (medias puertas o camas sueltas).
const NO_FALLBACK = (id) => id === 'bed' || id.endsWith('_door') || id === 'wooden_door';
// Alternativas por si el id cambia entre versiones del juego.
const ALT = { iron_chain: 'chain', grass_path: 'dirt_path', stonecutter_block: 'stonecutter', short_grass: 'tallgrass' };

function splitId(str) {
  const i = str.indexOf('[');
  if (i < 0) return [str.trim(), ''];
  return [str.slice(0, i).trim(), str.slice(i + 1, str.lastIndexOf(']')).trim()];
}

function encodeStates(s, r) {
  const parts = [];
  for (const [k, v] of Object.entries(s)) {
    let val = v;
    if (Array.isArray(v)) {
      const [t, x] = v;
      if (t === 'a') val = r & 1 && x !== 'y' ? (x === 'x' ? 'z' : 'x') : x;
      else val = ENC[t][rotDir(x, r)];
    }
    parts.push(`"${k}"=${typeof val === 'string' ? `"${val}"` : val}`);
  }
  return parts.join(',');
}

/** Candidatos de texto de bloque (del más específico al más genérico). */
export function blockCandidates(spec, r = 0) {
  let id;
  let inner;
  let add = '';
  if (typeof spec === 'string') [id, inner] = splitId(spec);
  else {
    [id, inner] = splitId(spec.id);
    add = encodeStates(spec.s, r);
  }
  const states = [inner, add].filter(Boolean).join(',');
  const out = [];
  if (states) out.push(`${id} [${states}]`);
  if (add && inner) out.push(`${id} [${inner}]`);
  if (!states || !NO_FALLBACK(id)) out.push(id);
  if (ALT[id] && (!states || !NO_FALLBACK(id))) out.push(ALT[id]);
  return out;
}

/* ================================================================== */
/* Plan de operaciones y ejecución                                     */
/* ================================================================== */

const MAX_FILL = 32000;

export class Plan {
  constructor(rng) {
    this.ops = [];
    this.rng = rng;
    this.chests = [];
  }

  fillW(x1, y1, z1, x2, y2, z2, spec, mode = '', r = 0) {
    if (spec === undefined || spec === null) return;
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (z1 > z2) [z1, z2] = [z2, z1];
    y1 = Math.max(-63, y1);
    y2 = Math.min(318, y2);
    if (y1 > y2) return;
    const layer = (x2 - x1 + 1) * (z2 - z1 + 1);
    if (layer * (y2 - y1 + 1) > MAX_FILL) {
      if (mode === 'hollow' || mode === 'outline') mode = '';
      if (layer > MAX_FILL) {
        const mx = Math.floor((x1 + x2) / 2);
        this.fillW(x1, y1, z1, mx, y2, z2, spec, mode, r);
        this.fillW(mx + 1, y1, z1, x2, y2, z2, spec, mode, r);
        return;
      }
      const rows = Math.max(1, Math.floor(MAX_FILL / layer));
      for (let y = y1; y <= y2; y += rows) this.fillW(x1, y, z1, x2, Math.min(y2, y + rows - 1), z2, spec, mode, r);
      return;
    }
    const b = blockCandidates(spec, r);
    if (x1 === x2 && y1 === y2 && z1 === z2 && !mode) this.ops.push({ k: 's', a: `${x1} ${y1} ${z1}`, b });
    else this.ops.push({ k: 'f', a: `${x1} ${y1} ${z1} ${x2} ${y2} ${z2}`, b, m: mode });
  }

  setW(x, y, z, spec, r = 0) {
    if (spec === undefined || spec === null || y < -63 || y > 318) return;
    this.ops.push({ k: 's', a: `${x} ${y} ${z}`, b: blockCandidates(spec, r) });
  }
}

const badCands = new Set();
export const execStats = { ok: 0, fail: 0, fallback: 0 };

/** Ejecuta una operación probando los candidatos de bloque. */
export function runOp(dim, op) {
  const cands = op.b;
  for (let i = 0; i < cands.length; i++) {
    const blk = cands[i];
    if (i < cands.length - 1 && badCands.has(blk)) continue;
    const c = op.k === 'f' ? `fill ${op.a} ${blk}${op.m ? ' ' + op.m : ''}` : `setblock ${op.a} ${blk}`;
    try {
      dim.runCommand(c);
      execStats.ok++;
      if (i) execStats.fallback++;
      return true;
    } catch (e) {
      const m = String(e?.message ?? e);
      if (/syntax|unknown|state|invalid|unexpected|not.*valid|parse|block name/i.test(m)) {
        badCands.add(blk);
        continue;
      }
      execStats.fail++;
      return false;
    }
  }
  execStats.fail++;
  return false;
}

/** Generador para system.runJob: ejecuta las operaciones cediendo entre cada una. */
export function* execOps(dim, ops, progress) {
  for (let i = 0; i < ops.length; i++) {
    runOp(dim, ops[i]);
    if (progress) progress.done = i + 1;
    yield;
  }
}

/* ================================================================== */
/* Lienzo local                                                        */
/* ================================================================== */
// Coordenadas locales (u, y, v): u = ancho (0..w-1), v = fondo (0..d-1, fachada en v=0),
// y relativo al suelo interior (y=0 primera capa de aire, y=-1 el suelo).
// r = giro: hacia dónde mira la fachada en el mundo (0 N, 1 E, 2 S, 3 W).

export class Canvas {
  constructor(plan, x0, y0, z0, w, d, r) {
    Object.assign(this, { plan, x0, y0, z0, w, d, r });
  }

  /** Tamaño en el mundo (ancho X, fondo Z). */
  get WX() { return this.r & 1 ? this.d : this.w; }
  get WZ() { return this.r & 1 ? this.w : this.d; }

  X(u, v) {
    const { w, d } = this;
    switch (this.r) {
      case 0: return [this.x0 + u, this.z0 + v];
      case 1: return [this.x0 + (d - 1 - v), this.z0 + u];
      case 2: return [this.x0 + (w - 1 - u), this.z0 + (d - 1 - v)];
      default: return [this.x0 + v, this.z0 + (w - 1 - u)];
    }
  }

  P(u, y, v) {
    const [x, z] = this.X(u, v);
    return { x, y: this.y0 + y, z };
  }

  /** Centro del bloque (para entidades). */
  C(u, y, v) {
    const p = this.P(u, y, v);
    return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
  }

  F(u1, y1, v1, u2, y2, v2, spec, mode = '') {
    const [xa, za] = this.X(u1, v1);
    const [xb, zb] = this.X(u2, v2);
    this.plan.fillW(xa, this.y0 + y1, za, xb, this.y0 + y2, zb, spec, mode, this.r);
  }

  S(u, y, v, spec) {
    const [x, z] = this.X(u, v);
    this.plan.setW(x, this.y0 + y, z, spec, this.r);
  }

  /** Lienzo desplazado verticalmente (mismo giro y huella). */
  up(dy) {
    return new Canvas(this.plan, this.x0, this.y0 + dy, this.z0, this.w, this.d, this.r);
  }

  /** Dirección del mundo de una dirección local. */
  dir(d) { return rotDir(d, this.r); }

  /** Caja del mundo (min/max) de la huella entre dos alturas locales. */
  box(y1, y2) {
    const a = this.P(0, y1, 0);
    const b = this.P(this.w - 1, y2, this.d - 1);
    return {
      min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
      max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
    };
  }
}

/* ================================================================== */
/* Contexto de construcción y materiales                               */
/* ================================================================== */

const H_PAL = CULTURES.humano.pal;

/** Elige un material de la paleta (con sufijo de clase Low/High si existe). */
export function palPick(cul, key, rng, cls) {
  const P = cul.pal;
  const sfx = cls === 'baja' ? 'Low' : cls === 'alta' ? 'High' : '';
  let v;
  if (sfx) v = P[key + sfx];
  if (v === undefined) v = P[key];
  if (v === undefined && sfx) v = H_PAL[key + sfx];
  if (v === undefined) v = H_PAL[key];
  return pal(v, rng);
}

export function materials(ctx, cls) {
  const { cul, rng } = ctx;
  const p = (k, c = cls) => palPick(cul, k, rng, c);
  return {
    found: p('found', ''), floor: p('floor'), wall: p('wall'), frame: p('frame', cls === 'alta' ? 'alta' : ''),
    roof: p('roof'), pane: p('pane', cls === 'alta' ? 'alta' : ''), door: p('door', cls === 'alta' ? 'alta' : ''),
    fence: p('fence', ''), gate: p('gate', ''), light: cul.pal.light ?? 'lantern', lightBlock: p('lightBlock', ''),
    accent: p('accent', ''), carpet: p('carpet', ''), leaves: p('leaves', ''), apron: p('apron', ''),
    path: p('path', ''), deco: cul.pal.deco ?? H_PAL.deco, flowers: cul.pal.flowers ?? H_PAL.flowers,
    cap: cul.pal.cap ? pal(cul.pal.cap, rng) : 'red_mushroom_block ["huge_mushroom_bits"=14]',
    wool: ctx.wool ?? ['red', 'yellow'],
  };
}

const FLOWER_SOIL = new Set(['grass_block', 'moss_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt']);
export const canGrow = (block) => FLOWER_SOIL.has(String(block).split(' ')[0]);

function chance(rng, p) { return rng() < p; }
function irand(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function pickOne(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

/* ================================================================== */
/* Piezas comunes                                                      */
/* ================================================================== */

function ring(cv, y1, y2, spec, u1 = 0, v1 = 0, u2 = cv.w - 1, v2 = cv.d - 1) {
  cv.F(u1, y1, v1, u2, y2, v1, spec);
  cv.F(u1, y1, v2, u2, y2, v2, spec);
  if (v2 - v1 >= 2) {
    cv.F(u1, y1, v1 + 1, u1, y2, v2 - 1, spec);
    cv.F(u2, y1, v1 + 1, u2, y2, v2 - 1, spec);
  }
}

function pillarsAt(len, every) {
  const out = [0];
  for (let p = every; p < len - 2; p += every) out.push(p);
  out.push(len - 1);
  return out;
}

function between(pils) {
  const out = [];
  for (let i = 0; i + 1 < pils.length; i++) {
    const a = pils[i];
    const b = pils[i + 1];
    if (b - a < 2) continue;
    if (b - a >= 6) out.push(a + 2, b - 2);
    else out.push(Math.floor((a + b) / 2));
  }
  return [...new Set(out)];
}

export function door(cv, u, v, id, inward = 'S', y = 0) {
  // Las puertas de hierro no se abren a mano ni las cruzan los NPCs: se usan de madera oscura.
  if (id === 'iron_door') id = 'dark_oak_door';
  cv.F(u, y, v, u, y + 1, v, 'air');
  cv.S(u, y, v, card(id, inward, { upper_block_bit: false }));
  cv.S(u, y + 1, v, card(id, inward, { upper_block_bit: true }));
}

export function bed(cv, u, v, headDir, y = 0) {
  const [du, dv] = DVEC[headDir];
  cv.S(u, y, v, { id: 'bed', s: { direction: ['b', headDir], head_piece_bit: false } });
  cv.S(u + du, y, v + dv, { id: 'bed', s: { direction: ['b', headDir], head_piece_bit: true } });
}

/** Contenedor con dueño (robarlo es delito). */
export function ownedChest(ctx, cv, u, y, v, latch, cls, kind = 'casa', block = 'chest') {
  if (block === 'barrel') cv.S(u, y, v, 'barrel ["facing_direction"=1]');
  else cv.S(u, y, v, card('chest', latch));
  const p = cv.P(u, y, v);
  ctx.plan.chests.push({ x: p.x, y: p.y, z: p.z, cls, house: ctx.houseId ?? null, kind });
}

function table(cv, u, y, v, M, withChairs = true) {
  cv.S(u, y, v, M.fence);
  cv.S(u, y + 1, v, 'wooden_pressure_plate');
  if (withChairs) {
    cv.S(u - 1, y, v, stair(M.roof.stair, 'W'));
    cv.S(u + 1, y, v, stair(M.roof.stair, 'E'));
  }
}

export function lampPost(plan, cul, x, y, z, rng) {
  const arch = cul.arch;
  const P = cul.pal;
  const fence = pal(P.fence, rng);
  switch (arch) {
    case 'dwarven':
      plan.fillW(x, y, z, x, y + 1, z, pal(P.defenseTop, rng));
      plan.setW(x, y + 2, z, standLantern('lantern'));
      break;
    case 'celestial':
      plan.fillW(x, y, z, x, y + 1, z, 'quartz_pillar');
      plan.setW(x, y + 2, z, 'end_rod ["facing_direction"=1]');
      break;
    case 'fairy':
      plan.fillW(x, y, z, x, y + 1, z, 'mushroom_stem ["huge_mushroom_bits"=15]');
      plan.setW(x, y + 2, z, 'shroomlight');
      break;
    case 'draconic':
      plan.fillW(x, y, z, x, y + 1, z, 'red_sandstone_wall');
      plan.setW(x, y + 2, z, 'campfire');
      break;
    case 'orcish':
      plan.setW(x, y, z, 'spruce_log');
      plan.setW(x, y + 1, z, fence);
      plan.setW(x, y + 2, z, standLantern('lantern'));
      break;
    default:
      plan.fillW(x, y, z, x, y + 1, z, fence);
      plan.setW(x, y + 2, z, standLantern(P.light ?? 'lantern'));
  }
}

/** Mástil con bandera de lana en los colores del reino. */
export function flag(plan, x, y, z, wool, fence = 'oak_fence', alongX = true, h = 4) {
  plan.fillW(x, y, z, x, y + h - 1, z, fence);
  const [dx, dz] = alongX ? [1, 0] : [0, 1];
  plan.setW(x + dx, y + h - 1, z + dz, `${wool[0]}_wool`);
  plan.setW(x + 2 * dx, y + h - 1, z + 2 * dz, `${wool[0]}_wool`);
  plan.setW(x + dx, y + h - 2, z + dz, `${wool[1]}_wool`);
  plan.setW(x + 2 * dx, y + h - 2, z + 2 * dz, `${wool[1]}_wool`);
}

/** Árbol decorativo hecho a mano (hojas persistentes, no se deshace). */
export function smallTree(plan, x, y, z, log, leaves, rng) {
  const h = irand(rng, 4, 6);
  plan.fillW(x, y, z, x, y + h - 1, z, log);
  plan.fillW(x - 2, y + h - 2, z - 1, x + 2, y + h - 1, z + 1, leaves, 'keep');
  plan.fillW(x - 1, y + h - 2, z - 2, x + 1, y + h - 1, z + 2, leaves, 'keep');
  plan.fillW(x - 1, y + h, z, x + 1, y + h, z, leaves, 'keep');
  plan.fillW(x, y + h, z - 1, x, y + h + 1, z + 1, leaves, 'keep');
}

/* ================================================================== */
/* Tejados                                                              */
/* ================================================================== */

function roofGable(cv, mat, y0, gable, alongU = true, o = 1) {
  const { w, d } = cv;
  if (alongU) {
    for (let k = 0; k < 40; k++) {
      const fv = -o + k;
      const bv = d - 1 + o - k;
      const y = y0 + k;
      if (fv > bv) break;
      if (fv === bv) { cv.F(-o, y, fv, w - 1 + o, y, fv, mat.slab); break; }
      cv.F(-o, y, fv, w - 1 + o, y, fv, stair(mat.stair, 'S'));
      cv.F(-o, y, bv, w - 1 + o, y, bv, stair(mat.stair, 'N'));
      const a = Math.max(0, fv + 1);
      const b = Math.min(d - 1, bv - 1);
      if (a <= b) { cv.F(0, y, a, 0, y, b, gable); cv.F(w - 1, y, a, w - 1, y, b, gable); }
    }
  } else {
    for (let k = 0; k < 40; k++) {
      const lu = -o + k;
      const ru = w - 1 + o - k;
      const y = y0 + k;
      if (lu > ru) break;
      if (lu === ru) { cv.F(lu, y, -o, lu, y, d - 1 + o, mat.slab); break; }
      cv.F(lu, y, -o, lu, y, d - 1 + o, stair(mat.stair, 'E'));
      cv.F(ru, y, -o, ru, y, d - 1 + o, stair(mat.stair, 'W'));
      const a = Math.max(0, lu + 1);
      const b = Math.min(w - 1, ru - 1);
      if (a <= b) { cv.F(a, y, 0, b, y, 0, gable); cv.F(a, y, d - 1, b, y, d - 1, gable); }
    }
  }
}

function roofHip(cv, mat, y0, o = 1, topBlock) {
  const { w, d } = cv;
  for (let k = 0; k < 40; k++) {
    const u1 = -o + k;
    const u2 = w - 1 + o - k;
    const v1 = -o + k;
    const v2 = d - 1 + o - k;
    const y = y0 + k;
    if (u1 > u2 || v1 > v2) break;
    if (u1 === u2 || v1 === v2) { cv.F(u1, y, v1, u2, y, v2, topBlock ?? mat.slab); break; }
    cv.F(u1, y, v1, u2, y, v1, stair(mat.stair, 'S'));
    cv.F(u1, y, v2, u2, y, v2, stair(mat.stair, 'N'));
    if (v2 - v1 >= 2) {
      cv.F(u1, y, v1 + 1, u1, y, v2 - 1, stair(mat.stair, 'E'));
      cv.F(u2, y, v1 + 1, u2, y, v2 - 1, stair(mat.stair, 'W'));
    }
    if (u2 - u1 >= 2 && v2 - v1 >= 2 && k > 0) cv.F(u1 + 1, y, v1 + 1, u2 - 1, y, v2 - 1, mat.block);
  }
}

function roofSteep(cv, mat, y0, gable, o = 1) {
  // Tejado gótico: cada fila sube dos bloques (bloque + escalera).
  const { w, d } = cv;
  for (let k = 0; k < 30; k++) {
    const fv = -o + k;
    const bv = d - 1 + o - k;
    const y = y0 + 2 * k;
    if (fv > bv) break;
    if (fv === bv) {
      cv.F(-o, y, fv, w - 1 + o, y, fv, mat.block);
      cv.F(-o, y + 1, fv, w - 1 + o, y + 1, fv, mat.slab);
      break;
    }
    cv.F(-o, y, fv, w - 1 + o, y, fv, mat.block);
    cv.F(-o, y + 1, fv, w - 1 + o, y + 1, fv, stair(mat.stair, 'S'));
    cv.F(-o, y, bv, w - 1 + o, y, bv, mat.block);
    cv.F(-o, y + 1, bv, w - 1 + o, y + 1, bv, stair(mat.stair, 'N'));
    const a = Math.max(0, fv + 1);
    const b = Math.min(d - 1, bv - 1);
    if (a <= b) { cv.F(0, y, a, 0, y + 1, b, gable); cv.F(w - 1, y, a, w - 1, y + 1, b, gable); }
  }
}

function roofFlat(cv, M, y0, parapet = true, spikes) {
  const { w, d } = cv;
  cv.F(0, y0, 0, w - 1, y0, d - 1, M.roof.block);
  if (!parapet) return;
  const top = spikes ?? M.roof.slab;
  for (let u = 0; u < w; u += 2) { cv.S(u, y0 + 1, 0, top); cv.S(u, y0 + 1, d - 1, top); }
  for (let v = 2; v < d - 1; v += 2) { cv.S(0, y0 + 1, v, top); cv.S(w - 1, y0 + 1, v, top); }
  cv.S(w - 1, y0 + 1, 0, top);
  cv.S(w - 1, y0 + 1, d - 1, top);
}

function roofStepped(cv, M, y0, band, crown) {
  const { w, d } = cv;
  let k = 0;
  for (; k < 12; k++) {
    const u1 = -1 + k;
    const u2 = w + k * -1;
    const v1 = -1 + k;
    const v2 = d - k;
    if (u2 - u1 < 2 || v2 - v1 < 2) break;
    cv.F(u1, y0 + k, v1, u2, y0 + k, v2, k % 2 ? band : M.roof.block);
  }
  const cu = Math.floor((w - 1) / 2);
  const cvv = Math.floor((d - 1) / 2);
  cv.S(cu, y0 + k, cvv, crown ?? M.accent);
  cv.S(cu, y0 + k + 1, cvv, standLantern(M.light));
}

/** Cúpula elipsoidal (hojas, sombrero de seta o mármol). */
function roofDome(cv, block, y0, extra = 1, flat = 0.75, top) {
  const { w, d } = cv;
  const cu = (w - 1) / 2;
  const cvv = (d - 1) / 2;
  const a = w / 2 + extra;
  const b = d / 2 + extra;
  const L = Math.max(2, Math.round(Math.min(a, b) * flat));
  for (let t = 0; t <= L; t++) {
    const s = Math.sqrt(Math.max(0, 1 - (t / (L + 1)) ** 2));
    const bs = b * s;
    for (let v = Math.ceil(cvv - bs); v <= Math.floor(cvv + bs); v++) {
      const q = 1 - ((v - cvv) / (bs || 1)) ** 2;
      if (q < 0) continue;
      const hw = a * s * Math.sqrt(q);
      const u1 = Math.round(cu - hw);
      const u2 = Math.round(cu + hw);
      if (u2 >= u1) cv.F(u1, y0 + t, v, u2, y0 + t, v, block);
    }
  }
  if (top) cv.S(Math.round(cu), y0 + L + 1, Math.round(cvv), top);
  return L;
}

function drawRoof(cv, ctx, M, type, y0) {
  const rng = ctx.rng;
  switch (type) {
    case 'hip': roofHip(cv, M.roof, y0); break;
    case 'flat': roofFlat(cv, M, y0, true, ctx.cul.arch === 'infernal' ? 'nether_brick_fence' : ctx.cul.arch === 'dwarven' ? M.roof.slab : undefined); break;
    case 'steep': roofSteep(cv, M.roof, y0, M.wall); break;
    case 'stepped': roofStepped(cv, M, y0, pal(ctx.cul.pal.accent, rng), 'gold_block'); break;
    case 'leafy': roofDome(cv, M.leaves, y0, 1, 0.6); break;
    case 'cap': roofDome(cv, M.cap, y0, 2, 0.55); break;
    case 'dome': roofDome(cv, M.roof.block, y0, 0, 0.8, 'gold_block'); break;
    default: roofGable(cv, M.roof, y0, M.wall, cv.w >= cv.d ? chance(rng, 0.8) : chance(rng, 0.25)); break;
  }
}

/* ================================================================== */
/* Carcasa genérica de edificio                                        */
/* ================================================================== */
// o = { H (altura por planta), floors, roof, doorU, windows, logWalls, baseCourse, every }
// Devuelve { doorU, top } (top = y del tejado)

function shell(cv, ctx, M, o) {
  const { w, d } = cv;
  const rng = ctx.rng;
  const arch = ctx.cul.arch;
  const H = o.H ?? 4;
  const FL = o.floors ?? 1;
  const top = H * FL;
  const doorU = o.doorU ?? Math.floor(w / 2);
  cv.F(0, -1, 0, w - 1, -1, d - 1, M.found);
  cv.F(1, -1, 1, w - 2, -1, d - 2, M.floor);
  if (o.logWalls) {
    cv.F(0, 0, 0, w - 1, top - 1, d - 1, 'air');
    cv.F(0, 0, 0, w - 1, top - 1, 0, axis(M.wall, 'x'));
    cv.F(0, 0, d - 1, w - 1, top - 1, d - 1, axis(M.wall, 'x'));
    cv.F(0, 0, 1, 0, top - 1, d - 2, axis(M.wall, 'z'));
    cv.F(w - 1, 0, 1, w - 1, top - 1, d - 2, axis(M.wall, 'z'));
  } else {
    cv.F(0, 0, 0, w - 1, top - 1, d - 1, M.wall, 'hollow');
    // 'hollow' también rellena la cara inferior (y=0): vaciar la planta baja (el suelo está en y=-1).
    cv.F(1, 0, 1, w - 2, top - 2, d - 2, 'air');
  }
  // Zócalo de piedra
  if (o.baseCourse ?? (arch === 'timber' || arch === 'gothic' || arch === 'dwarven')) ring(cv, 0, 0, M.found);
  // Entramado: pilares y vigas
  const every = o.every ?? (arch === 'timber' ? 3 : 4);
  const pu = pillarsAt(w, every);
  const pv = pillarsAt(d, every);
  const framed = o.frame ?? !['fairy'].includes(arch);
  if (framed) {
    for (const u of pu) { cv.F(u, 0, 0, u, top - 1, 0, M.frame); cv.F(u, 0, d - 1, u, top - 1, d - 1, M.frame); }
    for (const v of pv) { cv.F(0, 0, v, 0, top - 1, v, M.frame); cv.F(w - 1, 0, v, w - 1, top - 1, v, M.frame); }
    if (arch === 'timber' || arch === 'orcish' || arch === 'gothic') {
      for (let f = 1; f <= FL; f++) {
        const y = f * H - 1;
        cv.F(1, y, 0, w - 2, y, 0, axis(M.frame, 'x'));
        cv.F(1, y, d - 1, w - 2, y, d - 1, axis(M.frame, 'x'));
        cv.F(0, y, 1, 0, y, d - 2, axis(M.frame, 'z'));
        cv.F(w - 1, y, 1, w - 1, y, d - 2, axis(M.frame, 'z'));
      }
    }
    if (arch === 'celestial' || arch === 'draconic') ring(cv, top - 1, top - 1, M.accent);
  }
  // Techo / suelos intermedios
  cv.F(1, top - 1, 1, w - 2, top - 1, d - 2, M.roof.block);
  for (let f = 1; f < FL; f++) cv.F(1, f * H - 1, 1, w - 2, f * H - 1, d - 2, M.floor);
  // Ventanas
  if (o.windows !== false) {
    const wu = between(pu).filter((u) => Math.abs(u - doorU) > 1);
    const wub = between(pu);
    const wv = between(pv);
    const tall = H >= 5 || (H >= 4 && arch === 'gothic');
    for (let f = 0; f < FL; f++) {
      const y1 = f * H + 1;
      const y2 = tall ? y1 + 1 : y1;
      for (const u of wu) cv.F(u, y1, 0, u, y2, 0, M.pane);
      for (const u of wub) cv.F(u, y1, d - 1, u, y2, d - 1, M.pane);
      for (const v of wv) { cv.F(0, y1, v, 0, y2, v, M.pane); cv.F(w - 1, y1, v, w - 1, y2, v, M.pane); }
    }
  }
  // Escalera de mano entre plantas
  if (FL > 1) cv.F(w - 2, 0, 1, w - 2, (FL - 1) * H - 1, 1, facing('ladder', 'W'));
  // Puerta
  if (o.door !== false) door(cv, doorU, 0, M.door);
  drawRoof(cv, ctx, M, o.roof, top);
  // Chimenea humeante
  if (o.chimney ?? (['timber', 'dwarven', 'gothic', 'orcish'].includes(arch) && chance(rng, 0.55) && o.roof !== 'flat')) {
    const cu = chance(rng, 0.5) ? 1 : w - 2;
    const hgt = top + Math.ceil(Math.min(w, d) / 2) + 1;
    cv.F(cu, top, d - 2, cu, hgt, d - 2, M.found);
    cv.S(cu, hgt + 1, d - 2, 'campfire');
  }
  return { doorU, top, H, FL };
}

/* ================================================================== */
/* Mobiliario                                                           */
/* ================================================================== */

const WORK_BLOCKS = {
  timber: ['crafting_table', 'barrel', 'loom'], elven: ['brewing_stand', 'crafting_table', 'loom'], dwarven: ['anvil', 'smithing_table', 'barrel'],
  orcish: ['crafting_table', 'barrel', 'smoker'], beast: ['composter', 'crafting_table', 'barrel'], infernal: ['cauldron ["cauldron_liquid"="lava","fill_level"=6]', 'smoker', 'brewing_stand'],
  celestial: ['lectern', 'bookshelf', 'brewing_stand'], gothic: ['bookshelf', 'lectern', 'brewing_stand'], fairy: ['brewing_stand', 'composter', 'flower_pot'],
  draconic: ['decorated_pot', 'smoker', 'anvil'],
};

function workBlock(ctx, cls) {
  const list = WORK_BLOCKS[ctx.cul.arch] ?? WORK_BLOCKS.timber;
  const b = pickOne(ctx.rng, list);
  if (b === 'smoker' || b === 'lectern' || b === 'anvil') return card(b, 'W');
  return cls === 'alta' && ctx.rng() < 0.5 ? 'bookshelf' : b;
}

/** Amueblado de vivienda. y = planta (0), área interior u1..u2, v1..v2. */
function furnishHome(cv, ctx, M, cls, o = {}) {
  const rng = ctx.rng;
  const y = o.y ?? 0;
  const u1 = o.u1 ?? 1;
  const v1 = o.v1 ?? 1;
  const u2 = o.u2 ?? cv.w - 2;
  const v2 = o.v2 ?? cv.d - 2;
  const doorU = o.doorU ?? Math.floor(cv.w / 2);
  const H = o.H ?? 4;
  // Cama (cabecera hacia la pared del fondo)
  if (cls === 'baja' && chance(rng, 0.35)) { cv.S(u1, y, v2, 'hay_block'); cv.S(u1, y + 1, v2, 'white_carpet'); } else bed(cv, u1, v2 - 1, 'S', y);
  if (cls !== 'baja' && u2 - u1 >= 4 && chance(rng, 0.6)) bed(cv, u1 + 1, v2 - 1, 'S', y);
  // Almacén con dueño
  ownedChest(ctx, cv, u2, y, v2, 'N', cls, 'casa', cls === 'baja' && chance(rng, 0.5) ? 'barrel' : 'chest');
  if (cls === 'alta') ownedChest(ctx, cv, u2 - 2 >= u1 + 2 ? u2 - 2 : u2, y, v2 - (u2 - 2 >= u1 + 2 ? 0 : 2), 'N', cls, 'casa', 'barrel');
  if (v2 - v1 >= 2) cv.S(u2, y, v2 - 1, workBlock(ctx, cls));
  // Mesa y sillas
  const roomy = u2 - u1 >= 4 && v2 - v1 >= 3;
  if (roomy && !o.noTable) table(cv, doorU, y, Math.floor((v1 + v2) / 2), M, true);
  // Detalle cultural en la esquina delantera izquierda
  if (u2 - u1 >= 2) {
    const deco = {
      dwarven: card('anvil', 'N'), infernal: 'cauldron ["cauldron_liquid"="lava","fill_level"=6]', celestial: card('lectern', 'E'),
      gothic: 'red_candle ["candles"=2,"lit"=true]', fairy: 'flower_pot', orcish: 'skeleton_skull ["facing_direction"=1]', beast: 'hay_block',
      draconic: 'decorated_pot', elven: 'flower_pot', timber: chance(rng, 0.5) ? 'flower_pot' : 'barrel ["facing_direction"=1]',
    }[ctx.cul.arch];
    if (deco && doorU !== u1) cv.S(u1, y, v1, deco);
  }
  if (cls === 'alta') {
    if (v2 - v1 >= 4) cv.F(u1, y, v1 + 1, u1, y + 1, v1 + 1, 'bookshelf');
    cv.F(u1, y, v1, u2, y, v2, M.carpet, 'keep');
  } else if (cls === 'media' && chance(rng, 0.4)) {
    cv.F(doorU - 1, y, v1, doorU + 1, y, v1, M.carpet, 'keep');
  }
  // Luz colgante
  cv.S(doorU, y + H - 2, Math.floor((v1 + v2) / 2) + (roomy ? 0 : 0), hangLantern(M.light));
}

function exteriorDeco(cv, ctx, M, doorU, n = 2) {
  const rng = ctx.rng;
  // Farol junto a la puerta
  const side = doorU + 2 <= cv.w ? doorU + 2 : doorU - 2;
  cv.S(side, 0, -1, M.fence);
  cv.S(side, 1, -1, standLantern(M.light));
  // Objetos decorativos en el delantal
  const spots = [];
  for (let u = 0; u < cv.w; u++) if (Math.abs(u - doorU) > 2) spots.push([u, -1]);
  for (let v = 1; v < cv.d - 1; v++) { spots.push([-1, v]); spots.push([cv.w, v]); }
  for (let i = 0; i < n && spots.length; i++) {
    const k = Math.floor(rng() * spots.length);
    const [u, v] = spots.splice(k, 1)[0];
    const b = pickOne(rng, M.deco);
    if (b === 'flower_pot' || b === 'azalea' || b === 'flowering_azalea' || b === 'lantern' || b === 'soul_lantern') {
      if (b === 'lantern' || b === 'soul_lantern') cv.S(u, 0, v, standLantern(b));
      else if (canGrow(M.apron) || b === 'flower_pot') cv.S(u, 0, v, b);
    } else if (b.endsWith('_log')) cv.S(u, 0, v, axis(b, 'x'));
    else if (b === 'skeleton_skull') { cv.S(u, 0, v, M.fence); cv.S(u, 1, v, 'skeleton_skull ["facing_direction"=1]'); }
    else if (b === 'anvil') cv.S(u, 0, v, card('anvil', 'N'));
    else cv.S(u, 0, v, b);
  }
  // Flores en el delantal (si el suelo lo permite)
  if (canGrow(M.apron)) {
    for (let i = 0; i < 3; i++) {
      const [u, v] = chance(rng, 0.5) ? [irand(rng, 0, cv.w - 1), cv.d] : [chance(rng, 0.5) ? -1 : cv.w, irand(rng, 0, cv.d - 1)];
      cv.S(u, 0, v, pickOne(rng, M.flowers));
    }
  }
}

/** Datos estándar de un edificio con puerta. */
function info(cv, doorU, extra = {}, y = 0) {
  return {
    door: cv.P(doorU, y, 0),
    doorOut: cv.P(doorU, 0, -1),
    inside: cv.C(doorU, y, 1),
    center: cv.C(Math.floor(cv.w / 2), y, Math.floor(cv.d / 2)),
    ...extra,
  };
}

/* ================================================================== */
/* Viviendas                                                            */
/* ================================================================== */

/** Tienda de campaña orca (clase baja). */
function tent(cv, ctx, M) {
  const { w, d } = cv;
  const rng = ctx.rng;
  const wool = palPick(ctx.cul, 'wall', rng, 'baja');
  const c = Math.floor(w / 2);
  cv.F(0, -1, 0, w - 1, -1, d - 1, 'coarse_dirt');
  cv.F(0, 0, 0, w - 1, c + 1, d - 1, 'air');
  for (let k = 0; k < c; k++) {
    cv.F(k, k, 0, k, k, d - 1, wool);
    cv.F(w - 1 - k, k, 0, w - 1 - k, k, d - 1, wool);
    if (k + 1 <= w - 2 - k) {
      cv.F(k + 1, k, d - 1, w - 2 - k, k, d - 1, wool);
      cv.F(k + 1, k, 0, w - 2 - k, k, 0, wool);
    }
  }
  cv.F(c, c, 0, c, c, d - 1, axis(M.frame, 'z'));
  cv.F(c, 0, 0, c, 1, 0, 'air');
  // Postes en la entrada
  cv.S(c - 1, 0, -1, M.fence);
  cv.S(c - 1, 1, -1, 'skeleton_skull ["facing_direction"=1]');
  cv.S(c + 1, 0, -1, M.fence);
  cv.S(c + 1, 1, -1, standLantern('lantern'));
  // Interior
  cv.S(1, 0, d - 2, 'hay_block');
  cv.S(1, 0, d - 3, 'hay_block');
  ownedChest(ctx, cv, w - 2, 0, d - 2, 'W', 'baja', 'casa', 'barrel');
  return info(cv, c, { kind: 'tent', top: c + 1 });
}

/** Casa redonda bajo una seta gigante (hadas). */
function roundHouse(cv, ctx, M, cls) {
  const n = cv.w;
  const rng = ctx.rng;
  const c = (n - 1) / 2;
  const R = n / 2;
  const H = cls === 'alta' ? 6 : cls === 'media' ? 5 : 4;
  const inDisk = (u, v) => (u - c) ** 2 + (v - c) ** 2 <= (R - 0.25) ** 2;
  for (let v = 0; v < n; v++) {
    let a = -1;
    let b = -1;
    for (let u = 0; u < n; u++) if (inDisk(u, v)) { if (a < 0) a = u; b = u; }
    if (a < 0) continue;
    cv.F(a, -1, v, b, -1, v, M.floor);
    cv.F(a, 0, v, b, H - 1, v, 'air');
  }
  const wall = 'mushroom_stem ["huge_mushroom_bits"=15]';
  const ringCells = [];
  for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
    if (!inDisk(u, v)) continue;
    if (!inDisk(u + 1, v) || !inDisk(u - 1, v) || !inDisk(u, v + 1) || !inDisk(u, v - 1)) ringCells.push([u, v]);
  }
  for (const [u, v] of ringCells) cv.F(u, 0, v, u, H - 1, v, wall);
  const doorU = Math.round(c);
  let doorV = 0;
  while (doorV < n && !inDisk(doorU, doorV)) doorV++;
  // Ventanas redondas
  for (const [u, v] of ringCells) {
    if (u === doorU && v === doorV) continue;
    if ((u + v * 3) % 4 === 0 && v > doorV + 1) cv.S(u, 1, v, M.pane);
  }
  door(cv, doorU, doorV, M.door);
  cv.S(doorU, -1, doorV - 1, M.path);
  roofDome(cv, M.cap, H - 1, 2, 0.55);
  // Interior: solo celdas que no son muro
  const ringSet = new Set(ringCells.map(([u, v]) => u + ',' + v));
  const free = (u, v) => inDisk(u, v) && !ringSet.has(u + ',' + v) && !(u === doorU && v <= doorV + 1);
  const used = new Set();
  const take = (u, v) => { used.add(u + ',' + v); };
  const ok = (u, v) => free(u, v) && !used.has(u + ',' + v);
  let placedBed = false;
  for (let v = n - 1; v > 0 && !placedBed; v--) for (let u = 0; u < c && !placedBed; u++) {
    if (ok(u, v) && ok(u, v - 1)) { bed(cv, u, v - 1, 'S'); take(u, v); take(u, v - 1); placedBed = true; }
  }
  let placedChest = false;
  for (let v = n - 1; v > 0 && !placedChest; v--) for (let u = n - 1; u > c && !placedChest; u--) {
    if (ok(u, v)) {
      ownedChest(ctx, cv, u, 0, v, 'N', cls, 'casa', 'chest');
      take(u, v);
      if (ok(u, v - 1)) { cv.S(u, 0, v - 1, workBlock(ctx, cls)); take(u, v - 1); }
      placedChest = true;
    }
  }
  for (let v = 1; v < n; v++) {
    const u = n - 1 - v;
    if (ok(u, v) && u > c) { cv.S(u, 0, v, 'flower_pot'); take(u, v); break; }
  }
  if (n >= 9 && ok(Math.round(c), Math.round(c) + 1)) table(cv, Math.round(c), 0, Math.round(c) + 1, M, false);
  cv.S(doorU, H - 2, Math.round(c), hangLantern(M.light));
  if (cls === 'alta') for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) if (ok(u, v) && (u + v) % 2 === 0) cv.S(u, 0, v, M.carpet);
  // Jardín de flores
  for (let i = 0; i < 4; i++) {
    const ang = rng() * Math.PI * 2;
    const rr = R + 0.8;
    const u = Math.round(c + Math.cos(ang) * rr);
    const v = Math.round(c + Math.sin(ang) * rr);
    if (v < doorV && Math.abs(u - doorU) <= 1) continue;
    cv.S(u, 0, v, pickOne(rng, M.flowers));
  }
  return {
    door: cv.P(doorU, 0, doorV), doorOut: cv.P(doorU, 0, doorV - 1), inside: cv.C(doorU, 0, doorV + 1),
    center: cv.C(Math.round(c), 0, Math.round(c)), kind: 'round', top: H + 3,
  };
}

/** Casa rectangular con estilo de la cultura. */
function rectHome(cv, ctx, M, cls, opts = {}) {
  const rng = ctx.rng;
  const arch = ctx.cul.arch;
  const floors = opts.floors ?? 1;
  const H = opts.H ?? (cls === 'alta' ? 5 : 4);
  const roof = opts.roof ?? pickOne(rng, ctx.cul.roofTypes?.[cls] ?? ['gable']);
  const stilts = arch === 'beast' ? (cls === 'alta' ? 3 : 2) : 0;
  const base = stilts ? cv.up(stilts) : cv;
  if (stilts) {
    // Pilotes
    for (const [u, v] of [[0, 0], [cv.w - 1, 0], [0, cv.d - 1], [cv.w - 1, cv.d - 1], [Math.floor(cv.w / 2), cv.d - 1]]) cv.F(u, 0, v, u, stilts - 1, v, M.frame);
    cv.F(1, 0, 1, cv.w - 2, stilts - 2, cv.d - 2, 'air');
  }
  const sh = shell(base, ctx, M, {
    H, floors, roof, logWalls: arch === 'orcish' && cls !== 'baja', baseCourse: opts.baseCourse,
  });
  furnishHome(base, ctx, M, cls, { H, doorU: sh.doorU, noTable: arch === 'elven' && cls !== 'baja' });
  if (floors > 1) {
    // Dormitorio en la planta alta
    const y = H;
    bed(base, 1, cv.d - 3, 'S', y);
    if (cv.w >= 9) bed(base, 2, cv.d - 3, 'S', y);
    ownedChest(ctx, base, 3, y, cv.d - 2, 'N', cls, 'casa', 'chest');
    base.F(cv.w - 3, y, cv.d - 2, cv.w - 2, y + 1, cv.d - 2, 'bookshelf');
    base.F(1, y, 1, cv.w - 3, y, cv.d - 2, M.carpet, 'keep');
    base.S(Math.floor(cv.w / 2), y + H - 2, Math.floor(cv.d / 2), hangLantern(M.light));
  }
  // Tronco élfico que atraviesa la casa
  if (arch === 'elven' && cls !== 'baja') {
    const cu = Math.floor(cv.w / 2);
    const cvv = Math.floor(cv.d / 2) + 1;
    const top = sh.top + 6;
    base.F(cu, -1, cvv, cu, top, cvv, M.frame);
    base.F(cu - 3, top - 1, cvv - 2, cu + 3, top + 1, cvv + 2, M.leaves, 'keep');
    base.F(cu - 2, top - 1, cvv - 3, cu + 2, top + 1, cvv + 3, M.leaves, 'keep');
    base.F(cu - 1, top + 2, cvv - 1, cu + 1, top + 2, cvv + 1, M.leaves, 'keep');
  }
  // Talud enano (casa medio enterrada)
  if (ctx.cul.berm) {
    base.F(-1, 0, cv.d, cv.w, Math.max(0, H - 2), cv.d, 'dirt');
    base.F(-1, Math.max(1, H - 1), cv.d, cv.w, Math.max(1, H - 1), cv.d, 'grass_block');
  }
  // Escalera de acceso a los pilotes
  let doorOut = base.P(sh.doorU, -stilts, -1);
  if (stilts) {
    const du = sh.doorU;
    cv.S(du, stilts - 1, -1, M.floor);
    cv.F(du, 0, -1, du, stilts - 2, -1, M.frame);
    for (let i = 0; i < stilts; i++) {
      const u = du + stilts - i;
      if (i > 0) cv.F(u, 0, -1, u, i - 1, -1, M.frame);
      cv.S(u, i, -1, stair(M.roof.stair, 'W'));
    }
    cv.S(du - 1, stilts, -1, M.fence);
    cv.S(du - 1, stilts + 1, -1, standLantern(M.light));
    doorOut = cv.P(Math.min(cv.w, du + stilts + 1), 0, -1);
  } else exteriorDeco(base, ctx, M, sh.doorU, cls === 'alta' ? 3 : 2);
  // Bandera en casas nobles
  if (cls === 'alta') {
    const p = cv.P(-1, 0, -1);
    flag(ctx.plan, p.x, p.y, p.z, M.wool, M.fence, !(cv.r & 1), 5);
  }
  return {
    door: base.P(sh.doorU, 0, 0), doorOut, inside: base.C(sh.doorU, 0, 1),
    center: base.C(Math.floor(cv.w / 2), 0, Math.floor(cv.d / 2)), top: sh.top + 8 + stilts, kind: 'rect',
  };
}

export function buildShack(cv, ctx) {
  const M = materials(ctx, 'baja');
  if (ctx.cul.arch === 'orcish') return tent(cv, ctx, M);
  if (ctx.cul.round) return roundHouse(cv, ctx, M, 'baja');
  return rectHome(cv, ctx, M, 'baja', { H: 4 });
}

export function buildHouse(cv, ctx) {
  const M = materials(ctx, 'media');
  if (ctx.cul.round) return roundHouse(cv, ctx, M, 'media');
  return rectHome(cv, ctx, M, 'media', { H: 4 });
}

export function buildManor(cv, ctx) {
  const M = materials(ctx, 'alta');
  if (ctx.cul.round && cv.w === cv.d) return roundHouse(cv, ctx, M, 'alta');
  const res = rectHome(cv, ctx, M, 'alta', { H: 4, floors: 2 });
  // Jardín con valla delante
  const { w } = cv;
  if (ctx.cul.arch !== 'beast') {
    cv.F(-1, 0, -1, -1, 0, -1, M.fence);
    cv.F(w, 0, -1, w, 0, -1, M.fence);
  }
  // Columnas de pórtico celestiales
  if (ctx.cul.arch === 'celestial') {
    const du = Math.floor(w / 2);
    cv.F(du - 2, 0, -1, du - 2, 3, -1, 'quartz_pillar');
    cv.F(du + 2, 0, -1, du + 2, 3, -1, 'quartz_pillar');
    cv.F(du - 2, 4, -1, du + 2, 4, -1, 'smooth_quartz_slab');
  }
  return res;
}

/* ================================================================== */
/* Edificios públicos                                                   */
/* ================================================================== */

export function buildTavern(cv, ctx) {
  const M = materials(ctx, 'media');
  const rng = ctx.rng;
  const { w, d } = cv;
  const roof = pickOne(rng, ctx.cul.roofTypes?.media ?? ['gable']);
  const sh = shell(cv, ctx, M, { H: 5, roof: roof === 'cap' || roof === 'leafy' ? 'hip' : roof, chimney: true });
  // Barra: mostrador en v = d-4, pasillo del tabernero en d-3 (entrada por la izquierda), barriles al fondo
  const bv = d - 4;
  cv.F(2, 0, bv, w - 4, 0, bv, M.roof.block);
  cv.F(2, 1, bv, w - 4, 1, bv, M.roof.slab);
  cv.S(w - 4, 0, d - 3, M.roof.block);
  cv.F(1, 0, d - 2, w - 5, 1, d - 2, 'barrel ["facing_direction"=1]');
  cv.S(w - 3, 0, d - 2, 'brewing_stand');
  cv.S(w - 2, 0, d - 2, 'cauldron ["cauldron_liquid"="water","fill_level"=6]');
  ownedChest(ctx, cv, w - 2, 0, d - 3, 'W', 'media', 'taberna');
  // Mesas con sillas
  table(cv, 2, 0, 2, M, true);
  if (w - 4 > sh.doorU + 1) table(cv, w - 4, 0, 2, M, true);
  // Hogar
  cv.S(w - 2, 0, 1, M.found);
  cv.S(w - 2, 0, 3, M.found);
  cv.S(w - 2, 0, 2, 'campfire');
  for (let u = 2; u < w - 2; u += 3) cv.S(u, 3, Math.floor(d / 2), hangLantern(M.light));
  // Bandera a modo de cartel
  const p = cv.P(sh.doorU + 2, 0, -1);
  flag(ctx.plan, p.x, p.y, p.z, M.wool, M.fence, !(cv.r & 1), 4);
  const bu = Math.floor((w - 2) / 2);
  return info(cv, sh.doorU, {
    work: cv.C(bu, 0, d - 3),
    shop: cv.C(bu, 0, bv - 1),
    wp: cv.C(sh.doorU, 0, 3),
    top: sh.top + 7,
  });
}

export function buildSmithy(cv, ctx) {
  const M = materials(ctx, 'media');
  const { w, d } = cv;
  const rng = ctx.rng;
  cv.F(0, -1, 0, w - 1, -1, d - 1, M.found);
  cv.F(0, 0, 0, w - 1, 4, d - 1, 'air');
  // Muros del fondo y laterales, fachada abierta con pilares
  cv.F(0, 0, d - 1, w - 1, 3, d - 1, M.wall);
  cv.F(0, 0, 2, 0, 3, d - 2, M.wall);
  cv.F(w - 1, 0, 2, w - 1, 3, d - 2, M.wall);
  for (const u of [0, Math.floor(w / 2), w - 1]) cv.F(u, 0, 0, u, 3, 0, M.frame);
  cv.F(0, 0, 1, 0, 3, 1, M.frame);
  cv.F(w - 1, 0, 1, w - 1, 3, 1, M.frame);
  roofHip(cv, M.roof, 4, 1);
  cv.F(1, 3, 1, w - 2, 3, d - 2, M.roof.block);
  // Forja: lava contenida, hornos y yunque
  cv.F(1, 0, d - 2, 2, 0, d - 2, card('blast_furnace', 'N'));
  cv.S(3, 0, d - 2, 'cauldron ["cauldron_liquid"="lava","fill_level"=6]');
  cv.S(4, 0, d - 2, card('furnace', 'N'));
  cv.F(1, 1, d - 2, 4, 2, d - 2, M.found);
  cv.S(2, 3, d - 2, M.found);
  cv.F(2, 4, d - 2, 2, 6, d - 2, M.found);
  cv.S(2, 7, d - 2, 'campfire');
  const au = Math.floor(w / 2);
  cv.S(au, 0, 3, card('anvil', 'E'));
  cv.S(w - 2, 0, d - 2, 'smithing_table');
  cv.S(w - 2, 0, d - 3, { id: 'grindstone', s: { attachment: 'standing', direction: ['b', 'W'] } });
  cv.S(w - 2, 0, 2, 'cauldron ["cauldron_liquid"="water","fill_level"=6]');
  ownedChest(ctx, cv, w - 2, 0, d - 4 > 2 ? d - 4 : 3, 'W', 'media', 'herreria');
  cv.S(au, 2, Math.floor(d / 2), hangLantern(M.light));
  if (chance(rng, 0.7)) {
    cv.S(-1, 0, 1, M.fence);
    cv.S(-1, 1, 1, standLantern(M.light));
  }
  // Entrada por el hueco junto al pilar central de la fachada abierta (en au está el pilar).
  const eu = au + 1;
  return {
    door: cv.P(eu, 0, 0), doorOut: cv.P(eu, 0, -1), inside: cv.C(eu, 0, 1), center: cv.C(au, 0, Math.floor(d / 2)),
    work: cv.C(au, 0, 2), shop: cv.C(au, 0, 2), wp: cv.C(au, 0, 2), top: 10,
  };
}

/** Mercado: puestos con toldos de lana en forma de U alrededor de un pasillo. */
export function buildMarket(cv, ctx) {
  const M = materials(ctx, 'media');
  const { w, d } = cv;
  const rng = ctx.rng;
  const floor = pal(ctx.cul.pal.plaza, rng);
  cv.F(0, -1, 0, w - 1, -1, d - 1, floor);
  cv.F(0, 0, 0, w - 1, 4, d - 1, 'air');
  const goods = ['hay_block', 'pumpkin', 'melon_block', 'barrel ["facing_direction"=1]', 'bookshelf', 'composter', 'decorated_pot', 'beehive', 'dried_kelp_block', 'bone_block'];
  const stall = (u0, v0, face) => {
    // Puesto 3x3 con toldo a rayas; 'face' = lado del mostrador (local)
    for (const [du, dv] of [[0, 0], [2, 0], [0, 2], [2, 2]]) cv.F(u0 + du, 0, v0 + dv, u0 + du, 1, v0 + dv, M.fence);
    for (let i = 0; i < 3; i++) cv.F(u0 + i, 2, v0, u0 + i, 2, v0 + 2, `${M.wool[i % 2]}_wool`);
    // mostrador y mercancía
    const [cu1, cv1, cu2, cv2] = face === 'N' ? [u0, v0, u0 + 2, v0] : face === 'S' ? [u0, v0 + 2, u0 + 2, v0 + 2] : face === 'E' ? [u0 + 2, v0, u0 + 2, v0 + 2] : [u0, v0, u0, v0 + 2];
    cv.F(cu1, 0, cv1, cu2, 0, cv2, M.roof.slab, 'keep');
    const gu = face === 'E' ? u0 : face === 'W' ? u0 + 2 : u0 + 1;
    const gv = face === 'N' ? v0 + 2 : face === 'S' ? v0 : v0 + 1;
    cv.S(gu, 0, gv, pickOne(rng, goods));
  };
  // Lado izquierdo y derecho mirando al pasillo central, y fondo mirando a la entrada
  const stalls = [];
  for (let v = 1; v + 2 <= d - 4; v += 4) { stall(0, v, 'E'); stall(w - 3, v, 'W'); stalls.push(v); }
  for (let u = 3; u + 2 <= w - 4; u += 4) stall(u, d - 3, 'N');
  ownedChest(ctx, cv, 1, 0, d - 1 > 3 ? d - 2 : 1, 'E', 'media', 'mercado');
  const mu = Math.floor(w / 2);
  const lp = cv.P(mu, 0, Math.floor(d / 2) - 1);
  lampPost(ctx.plan, ctx.cul, lp.x, lp.y, lp.z, rng);
  // Puesto del mercader en el pasillo, delante de los puestos del fondo (en el mercado pequeño
  // floor(d/2)+1 cae sobre un poste del puesto del fondo).
  const av = Math.min(Math.floor(d / 2) + 1, d - 4);
  return {
    door: cv.P(mu, 0, 0), doorOut: cv.P(mu, 0, -1), inside: cv.C(mu, 0, 1), center: cv.C(mu, 0, Math.floor(d / 2)),
    work: cv.C(mu, 0, av), shop: cv.C(mu, 0, av), wp: cv.C(mu, 0, av), top: 6,
  };
}

/** Templo según la cultura (iglesia, arboleda, salón, tótems, altar, gran templo, capilla, anillo, zigurat). */
export function buildTemple(cv, ctx) {
  const M = materials(ctx, 'alta');
  const { w, d } = cv;
  const rng = ctx.rng;
  const style = ctx.cul.temple ?? 'church';
  const altarB = pal(ctx.cul.pal.altar ?? 'gold_block', rng);
  const cu = Math.floor(w / 2);
  if (style === 'grove' || style === 'totem' || style === 'ring') {
    // Santuario al aire libre: círculo de columnas/tótems y altar central
    const floor = pal(ctx.cul.pal.plaza, rng);
    cv.F(0, -1, 0, w - 1, -1, d - 1, style === 'ring' ? 'moss_block' : floor);
    cv.F(0, 0, 0, w - 1, 8, d - 1, 'air');
    const c = (w - 1) / 2;
    const cz = (d - 1) / 2;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const u = Math.round(c + Math.cos(a) * (w / 2 - 1));
      const v = Math.round(cz + Math.sin(a) * (d / 2 - 1));
      if (v <= 1 && Math.abs(u - cu) <= 1) continue;
      if (style === 'totem') {
        cv.F(u, 0, v, u, 2, v, axis(M.frame, 'y'));
        cv.S(u, 3, v, card('carved_pumpkin', 'S'));
        cv.S(u, 4, v, standLantern(M.light));
      } else if (style === 'ring') {
        cv.F(u, 0, v, u, 1, v, 'mushroom_stem ["huge_mushroom_bits"=15]');
        cv.S(u, 2, v, 'red_mushroom_block ["huge_mushroom_bits"=14]');
        cv.S(u, 3, v, 'shroomlight');
      } else {
        cv.F(u, 0, v, u, 4, v, M.frame);
        cv.F(u - 1, 4, v - 1, u + 1, 5, v + 1, M.leaves, 'keep');
        cv.S(u, 3, v, hangLantern(M.light));
      }
    }
    const av = Math.round(cz) + 1;
    cv.S(cu, 0, av, altarB);
    cv.S(cu, 1, av, style === 'totem' ? 'campfire' : style === 'ring' ? 'amethyst_cluster' : 'flowering_azalea');
    for (const [du, dv] of [[-1, 0], [1, 0], [0, 1]]) cv.S(cu + du, 0, av + dv, pickOne(rng, M.flowers));
    if (style !== 'ring') {
      cv.S(cu - 2, 0, av - 2, stair(M.roof.stair, 'N'));
      cv.S(cu + 2, 0, av - 2, stair(M.roof.stair, 'N'));
    }
    return {
      door: cv.P(cu, 0, 0), doorOut: cv.P(cu, 0, -1), inside: cv.C(cu, 0, 1), center: cv.C(cu, 0, Math.round(cz)),
      work: cv.C(cu, 0, av - 1), shop: cv.C(cu, 0, av - 1), wp: cv.C(cu, 0, av - 2), altar: cv.P(cu, 0, av), top: 9,
    };
  }
  if (style === 'ziggurat') {
    // Zigurat de la llama: plataforma escalonada con altar ardiente en la cima
    const floor = pal(ctx.cul.pal.floorHigh, rng);
    cv.F(0, -1, 0, w - 1, -1, d - 1, floor);
    cv.F(0, 0, 0, w - 1, 12, d - 1, 'air');
    let k = 0;
    for (; k < 4; k++) {
      if (w - 2 * k < 5 || d - 2 * k < 5) break;
      cv.F(k, k, k, w - 1 - k, k, d - 1 - k, k % 2 ? pal(ctx.cul.pal.accent, rng) : M.wall);
    }
    // Escalinata frontal
    for (let i = 0; i < k; i++) cv.F(cu - 1, i, i, cu + 1, i, i, stair(M.roof.stair, 'S'));
    const topY = k;
    const tv = Math.floor(d / 2);
    cv.S(cu, topY, tv, altarB);
    cv.S(cu - 2, topY, tv, 'campfire');
    cv.S(cu + 2, topY, tv, 'campfire');
    cv.S(cu, topY + 1, tv, 'campfire');
    // Sala interior bajo la pirámide
    cv.F(2, 0, 2, w - 3, Math.min(2, k - 1), d - 3, 'air');
    cv.F(cu, 0, 1, cu, 1, 1, 'air');
    ownedChest(ctx, cv, 2, 0, d - 3, 'E', 'alta', 'templo');
    cv.S(cu, 0, d - 3, card('lectern', 'N'));
    cv.S(cu, Math.min(2, k - 1), Math.floor(d / 2), hangLantern(M.light));
    return {
      door: cv.P(cu, 0, 1), doorOut: cv.P(cu, 0, -1), inside: cv.C(cu, 0, 3), center: cv.C(cu, 0, tv),
      work: cv.C(cu, 0, d - 4), shop: cv.C(cu, 0, d - 4), wp: cv.C(cu, 0, 3), altar: cv.P(cu, topY, tv), top: topY + 3,
    };
  }
  // Templos cerrados: iglesia, salón, altar, gran templo, capilla
  const H = style === 'grand' ? 7 : style === 'hall' ? 5 : 6;
  const roof = style === 'grand' ? 'dome' : style === 'hall' ? 'flat' : style === 'altar' ? 'flat' : style === 'chapel' ? 'steep' : 'gable';
  const sh = shell(cv, ctx, M, { H, roof, chimney: false, every: 3 });
  // Nave: bancos, alfombra central y altar
  const tower = style === 'church' || style === 'chapel';
  for (let v = tower ? 4 : 3; v < d - 4; v += 2) {
    cv.F(1, 0, v, cu - 2, 0, v, stair(M.roof.stair, 'N'));
    cv.F(cu + 2, 0, v, w - 2, 0, v, stair(M.roof.stair, 'N'));
  }
  cv.F(cu - 1, -1, 1, cu + 1, -1, d - 2, pal(ctx.cul.pal.floorHigh, rng));
  cv.F(cu, 0, 1, cu, 0, d - 3, M.carpet, 'keep');
  const av = d - 2;
  cv.F(cu - 2, 0, av, cu + 2, 0, av, M.found);
  cv.S(cu, 1, av, altarB === 'gold_block' ? 'gold_block' : altarB);
  cv.S(cu - 2, 1, av, style === 'altar' ? 'cauldron ["cauldron_liquid"="lava","fill_level"=6]' : 'red_candle ["candles"=3,"lit"=true]');
  cv.S(cu + 2, 1, av, style === 'altar' ? 'cauldron ["cauldron_liquid"="lava","fill_level"=6]' : 'white_candle ["candles"=3,"lit"=true]');
  cv.S(cu, 0, av - 1, card('lectern', 'N'));
  ownedChest(ctx, cv, 1, 0, av, 'E', 'alta', 'templo');
  for (let v = 3; v < d - 2; v += 4) cv.S(cu, H - 2, v, hangLantern(M.light));
  if (style === 'altar' && ctx.cul.lava) {
    // Braseros de almas a los lados de la nave
    for (let v = 4; v < d - 3; v += 4) { cv.S(1, 0, v, 'soul_campfire'); cv.S(w - 2, 0, v, 'soul_campfire'); }
  }
  // Campanario (iglesias y capillas) sobre la entrada, dentro de la huella
  if (tower) {
    const tu1 = cu - 1;
    const tH = H + 7;
    cv.F(tu1, 0, 0, tu1 + 2, tH, 2, M.wall, 'hollow');
    ring(cv, 0, tH, M.frame, tu1, 0, tu1 + 2, 2);
    cv.F(tu1 + 1, 0, 1, tu1 + 1, tH - 5, 1, 'air');
    cv.F(cu, 0, 0, cu, 1, 2, 'air');
    door(cv, cu, 0, M.door);
    cv.F(tu1, tH - 3, 1, tu1 + 2, tH - 2, 1, 'air');
    cv.F(cu, tH - 3, 0, cu, tH - 2, 0, 'air');
    cv.S(cu, tH - 4, 1, M.roof.block);
    cv.S(cu, tH - 3, 1, { id: 'bell', s: { attachment: 'standing', direction: ['b', 'S'] } });
    cv.F(tu1, tH + 1, 0, tu1 + 2, tH + 1, 2, M.roof.block);
    if (style === 'chapel') {
      cv.F(cu, tH + 2, 1, cu, tH + 5, 1, M.roof.block);
      cv.S(cu, tH + 6, 1, M.fence);
    } else {
      cv.S(cu, tH + 2, 1, M.roof.block);
      cv.S(cu, tH + 3, 1, M.fence);
      cv.S(cu, tH + 4, 1, standLantern(M.light));
    }
    return {
      door: cv.P(cu, 0, 0), doorOut: cv.P(cu, 0, -1), inside: cv.C(cu, 0, 3), center: cv.C(cu, 0, Math.floor(d / 2)),
      work: cv.C(cu, 0, av - 2), shop: cv.C(cu, 0, av - 2), wp: cv.C(cu, 0, Math.floor(d / 2)), altar: cv.P(cu, 1, av), top: tH + 6,
    };
  }
  if (style === 'grand') {
    for (const u of [0, 2, w - 3, w - 1]) cv.F(u, 0, -1, u, H - 1, -1, 'quartz_pillar');
    cv.F(0, H, -1, w - 1, H, -1, 'smooth_quartz_slab');
    cv.S(cu - 2, 0, -1, standLantern(M.light));
    cv.S(cu + 2, 0, -1, standLantern(M.light));
  }
  return info(cv, sh.doorU, {
    work: cv.C(cu, 0, av - 2), shop: cv.C(cu, 0, av - 2), wp: cv.C(cu, 0, Math.floor(d / 2)), altar: cv.P(cu, 1, av), top: sh.top + 10,
  });
}

/** Cárcel con 2-3 celdas: frentes de barrotes y una "puerta" de barrotes 1x2 por celda. */
export function buildJail(cv, ctx, cells = 2) {
  const M = materials(ctx, 'media');
  const { w, d } = cv; // w = 4*cells + 1, d = 8
  const wall = palPick(ctx.cul, 'wall', ctx.rng, 'alta');
  const hard = ctx.cul.arch === 'fairy' || ctx.cul.arch === 'orcish' || ctx.cul.arch === 'beast' || ctx.cul.arch === 'elven' ? pal(ctx.cul.pal.found, ctx.rng) : wall;
  cv.F(0, -2, 0, w - 1, -1, d - 1, 'stone_bricks');
  cv.F(0, 0, 0, w - 1, 4, d - 1, hard, 'hollow');
  cv.F(1, 0, 1, w - 2, 3, d - 2, 'air'); // la cara inferior del 'hollow' no es el suelo (y=-1)
  cv.F(0, 4, 0, w - 1, 4, d - 1, hard);
  ring(cv, 0, 0, M.found);
  roofFlat(cv, { ...M, roof: { ...M.roof, block: hard } }, 5, true, M.roof.slab);
  // Celdas al fondo
  const cellsInfo = [];
  for (let i = 0; i < cells; i++) {
    const u0 = 1 + 4 * i;
    cv.F(4 * i, 0, 3, 4 * i, 3, d - 1, hard);
    cv.F(u0, 0, 3, u0 + 2, 3, 3, 'iron_bars');
    const du = u0 + 1;
    cv.S(u0, 0, d - 2, 'hay_block');
    cv.S(u0 + 2, 0, d - 2, 'cauldron ["cauldron_liquid"="water","fill_level"=3]');
    cv.S(du, 3, 5, hangLantern('lantern'));
    const a = cv.P(u0, 0, 4);
    const b = cv.P(u0 + 2, 3, d - 2);
    cellsInfo.push({
      min: { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) },
      max: { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) },
      spawn: cv.C(du, 0, 5),
      door: [cv.P(du, 0, 3), cv.P(du, 1, 3)],
      doorBlock: 'minecraft:iron_bars',
    });
  }
  cv.F(w - 1, 0, 3, w - 1, 3, d - 1, hard);
  // Pasillo y mesa del carcelero
  const du = Math.floor(w / 2);
  door(cv, du, 0, M.door === 'iron_door' ? 'spruce_door' : M.door);
  cv.F(1, 1, 0, 1, 2, 0, 'iron_bars');
  cv.F(w - 2, 1, 0, w - 2, 2, 0, 'iron_bars');
  cv.S(1, 0, 1, M.fence);
  cv.S(1, 1, 1, 'wooden_pressure_plate');
  ownedChest(ctx, cv, w - 2, 0, 1, 'W', 'media', 'carcel');
  cv.S(du, 3, 2, hangLantern(M.light));
  cv.S(du - 2 >= 1 ? du - 2 : 1, 3, 2, hangLantern(M.light));
  const p = cv.P(-1, 0, -1);
  flag(ctx.plan, p.x, p.y, p.z, M.wool, M.fence, !(cv.r & 1), 5);
  return {
    door: cv.P(du, 0, 0), doorOut: cv.P(du, 0, -1), inside: cv.C(du, 0, 1), center: cv.C(du, 0, 2),
    jail: { cells: cellsInfo, exit: cv.C(du, 0, -2), patrol: cv.C(du, 0, 2) },
    work: cv.C(2, 0, 1), wp: cv.C(du, 0, 2), top: 7,
  };
}

/** Torre de vigilancia 5x5 con escalera de mano y almenas. */
export function buildTower(cv, ctx, opts = {}) {
  const M = materials(ctx, 'media');
  const rng = ctx.rng;
  const arch = ctx.cul.arch;
  const H = opts.H ?? irand(rng, 9, 12);
  const wall = arch === 'orcish' || arch === 'beast' ? M.frame : pal(ctx.cul.pal.defense, rng);
  const wallB = wall.includes('leaves') ? M.frame : wall;
  cv.F(0, -1, 0, 4, -1, 4, M.found);
  cv.F(0, 0, 0, 4, H, 4, wallB, 'hollow');
  cv.F(1, 0, 1, 3, H - 1, 3, 'air'); // la cara inferior del 'hollow' no es el suelo (y=-1)
  cv.F(1, H, 1, 3, H, 3, M.floor);
  cv.F(2, 0, 3, 2, H, 3, facing('ladder', 'N'));
  if (opts.door !== false) door(cv, 2, 0, M.door);
  for (let y = 3; y < H - 1; y += 3) {
    cv.S(2, y, 0, M.pane === 'glass_pane' ? 'iron_bars' : M.pane);
    cv.S(0, y, 2, 'iron_bars');
    cv.S(4, y, 2, 'iron_bars');
  }
  // Plataforma superior con almenas
  cv.F(-1, H, -1, 5, H, 5, wallB);
  cv.S(2, H, 3, facing('ladder', 'N'));
  for (let u = -1; u <= 5; u++) for (const v of [-1, 5]) if ((u + 1) % 2 === 0) cv.S(u, H + 1, v, wallB);
  for (let v = 1; v <= 3; v++) for (const u of [-1, 5]) if ((v + 1) % 2 === 0) cv.S(u, H + 1, v, wallB);
  cv.S(0, H + 1, 0, standLantern(M.light));
  cv.S(4, H + 1, 4, standLantern(M.light));
  const style = ctx.cul.tower ?? 'flat';
  if (style !== 'flat') {
    for (const [u, v] of [[-1, -1], [5, -1], [-1, 5], [5, 5]]) cv.F(u, H + 1, v, u, H + 3, v, M.fence);
    const sub = new Canvas(ctx.plan, 0, 0, 0, 7, 7, cv.r);
    const o = cv.P(-1, H + 4, -1);
    const a = cv.P(5, H + 4, 5);
    sub.x0 = Math.min(o.x, a.x);
    sub.z0 = Math.min(o.z, a.z);
    sub.y0 = o.y;
    drawRoof(sub, ctx, M, style === 'steep' ? 'hip' : style, 0);
  }
  if (style === 'flat') {
    const p = cv.P(4, H + 2, 0);
    ctx.plan.fillW(p.x, p.y, p.z, p.x, p.y + 2, p.z, M.fence);
    ctx.plan.setW(p.x, p.y + 3, p.z, `${M.wool[0]}_wool`);
    ctx.plan.setW(p.x, p.y + 2, p.z + 0, M.fence);
  }
  return {
    door: cv.P(2, 0, 0), doorOut: cv.P(2, 0, -1), inside: cv.C(2, 0, 1), center: cv.C(2, 0, 2),
    lookout: cv.C(2, H + 1, 2), wp: cv.C(2, 0, -2), top: H + 8,
  };
}

export function buildBarracks(cv, ctx) {
  const M = materials(ctx, 'media');
  const { w, d } = cv;
  const rng = ctx.rng;
  const sh = shell(cv, ctx, M, { H: 4, roof: ctx.cul.arch === 'fairy' ? 'hip' : pickOne(rng, ['gable', 'flat', 'hip']), chimney: false });
  for (let u = 1; u <= w - 2; u += 2) if (Math.abs(u - sh.doorU) > 0 && u !== w - 2) bed(cv, u, d - 3, 'S');
  ownedChest(ctx, cv, w - 2, 0, d - 2, 'N', 'media', 'cuartel');
  cv.S(1, 0, 1, 'smithing_table');
  cv.S(w - 2, 0, 1, 'target');
  cv.S(sh.doorU, 2, Math.floor(d / 2), hangLantern(M.light));
  // Muñeco de entrenamiento y bandera
  cv.S(w, 0, 2, M.fence);
  cv.S(w, 1, 2, 'hay_block');
  cv.S(w, 2, 2, card('carved_pumpkin', 'W'));
  const f = cv.P(-1, 0, -1);
  flag(ctx.plan, f.x, f.y, f.z, M.wool, M.fence, !(cv.r & 1), 5);
  return info(cv, sh.doorU, { wp: cv.C(sh.doorU, 0, 2), guards: [cv.C(2, 0, 2), cv.C(w - 3, 0, 2), cv.C(sh.doorU, 0, -2)], top: sh.top + 6 });
}

/** Torreón del rey con salón del trono (capitales). */
export function buildKeep(cv, ctx) {
  const M = materials(ctx, 'alta');
  const { w, d } = cv; // ~23x23
  const rng = ctx.rng;
  const wall = pal(ctx.cul.pal.defense, rng);
  const wallB = wall.includes('leaves') ? palPick(ctx.cul, 'wall', rng, 'alta') : wall;
  const H = 12;
  const cu = Math.floor(w / 2);
  cv.F(0, -1, 0, w - 1, -1, d - 1, M.found);
  cv.F(1, -1, 1, w - 2, -1, d - 2, M.floor);
  cv.F(0, 0, 0, w - 1, H, d - 1, wallB, 'hollow');
  cv.F(1, 0, 1, w - 2, H - 1, d - 2, 'air'); // la cara inferior del 'hollow' no es el suelo (y=-1)
  // Planta noble a media altura
  cv.F(1, 6, 1, w - 2, 6, d - 2, M.floor);
  cv.F(1, H, 1, w - 2, H, d - 2, wallB);
  // Torres de las esquinas
  for (const [u, v] of [[0, 0], [w - 5, 0], [0, d - 5], [w - 5, d - 5]]) {
    cv.F(u, 0, v, u + 4, H + 5, v + 4, wallB, 'hollow');
    cv.F(u + 1, H + 5, v + 1, u + 3, H + 5, v + 3, M.floor);
    for (let i = 0; i <= 4; i += 2) { cv.S(u + i, H + 6, v, wallB); cv.S(u + i, H + 6, v + 4, wallB); cv.S(u, H + 6, v + i, wallB); cv.S(u + 4, H + 6, v + i, wallB); }
    cv.S(u + 2, H + 6, v + 2, standLantern(M.light));
    cv.F(u + 2, 3, v, u + 2, 4, v, 'iron_bars');
  }
  // Almenas del cuerpo central
  for (let u = 0; u < w; u += 2) { cv.S(u, H + 1, 0, wallB); cv.S(u, H + 1, d - 1, wallB); }
  for (let v = 0; v < d; v += 2) { cv.S(0, H + 1, v, wallB); cv.S(w - 1, H + 1, v, wallB); }
  // Portón principal
  cv.F(cu - 1, 0, 0, cu + 1, 3, 0, 'air');
  cv.F(cu - 1, 4, 0, cu + 1, 4, 0, 'iron_bars');
  cv.F(cu - 2, 0, -1, cu - 2, 4, -1, M.frame);
  cv.F(cu + 2, 0, -1, cu + 2, 4, -1, M.frame);
  // Ventanales
  for (let u = 6; u < w - 6; u += 3) {
    if (Math.abs(u - cu) > 2) cv.F(u, 2, 0, u, 4, 0, M.pane);
    cv.F(u, 8, 0, u, 10, 0, M.pane);
  }
  for (let v = 8; v < d - 6; v += 3) { cv.F(0, 2, v, 0, 4, v, M.pane); cv.F(w - 1, 2, v, w - 1, 4, v, M.pane); cv.F(0, 8, v, 0, 10, v, M.pane); cv.F(w - 1, 8, v, w - 1, 10, v, M.pane); }
  // Salón del trono
  const tv = d - 4;
  cv.F(cu - 1, 0, 1, cu + 1, 0, tv - 3, M.carpet, 'keep');
  cv.F(cu - 3, 0, tv - 2, cu + 3, 0, d - 2, M.found);
  cv.F(cu - 2, 1, tv - 1, cu + 2, 1, d - 2, palPick(ctx.cul, 'floor', rng, 'alta'));
  cv.F(cu - 3, 0, tv - 2, cu + 3, 0, tv - 2, stair(M.roof.stair, 'S'));
  cv.S(cu, 2, tv, stair(M.roof.stair, 'S'));
  cv.F(cu - 1, 2, tv + 1, cu + 1, 4, tv + 1, 'gold_block');
  cv.S(cu, 5, tv + 1, M.accent);
  cv.S(cu - 1, 2, tv, `${M.wool[0]}_carpet`);
  cv.S(cu + 1, 2, tv, `${M.wool[0]}_carpet`);
  // Estandartes del reino en la pared del fondo
  for (const u of [cu - 4, cu + 4]) {
    cv.F(u, 1, d - 2, u, 5, d - 2, `${M.wool[0]}_wool`);
    cv.F(u, 2, d - 2, u, 3, d - 2, `${M.wool[1]}_wool`);
  }
  // Columnas y lámparas
  for (let v = 3; v < tv - 2; v += 4) for (const u of [cu - 4, cu + 4]) { cv.F(u, 0, v, u, 5, v, M.frame); cv.S(u, 5, v + 1, hangLantern(M.light)); }
  for (let v = 4; v < d - 2; v += 5) cv.S(cu, 5, v, hangLantern(M.light));
  // Tesoro real (cofres nobles)
  ownedChest(ctx, cv, cu - 3, 1, d - 2, 'N', 'alta', 'tesoro');
  ownedChest(ctx, cv, cu + 3, 1, d - 2, 'N', 'alta', 'tesoro');
  // Escalera de mano a la planta noble y aposentos reales
  cv.F(w - 2, 0, 6, w - 2, 6, 6, facing('ladder', 'W'));
  bed(cv, 3, 8, 'S', 7);
  bed(cv, 4, 8, 'S', 7);
  ownedChest(ctx, cv, 6, 7, 9, 'N', 'alta', 'tesoro');
  cv.F(7, 7, 9, 9, 8, 9, 'bookshelf');
  cv.S(3, 7, 12, 'enchanting_table');
  cv.F(1, 7, 1, w - 2, 7, d - 2, M.carpet, 'keep');
  for (let u = 4; u < w - 4; u += 5) cv.S(u, 11, Math.floor(d / 2), hangLantern(M.light));
  // Banderas en las torres
  for (const [u, v] of [[2, 2], [w - 3, 2]]) {
    const p = cv.P(u, H + 6, v);
    flag(ctx.plan, p.x, p.y, p.z, M.wool, M.fence, !(cv.r & 1), 4);
  }
  return {
    door: cv.P(cu, 0, 0), doorOut: cv.P(cu, 0, -2), inside: cv.C(cu, 0, 2), center: cv.C(cu, 0, Math.floor(d / 2)),
    throne: cv.C(cu, 2, tv - 1), throneSeat: cv.P(cu, 2, tv), court: cv.C(cu, 0, tv - 5), wp: cv.C(cu, 0, tv - 5),
    guards: [cv.C(cu - 2, 0, 2), cv.C(cu + 2, 0, 2), cv.C(cu - 3, 0, tv - 4), cv.C(cu + 3, 0, tv - 4)], top: H + 12,
  };
}

/** Huerto vallado con cultivos maduros y canal de riego. */
export function buildFarm(cv, ctx) {
  const M = materials(ctx, 'baja');
  const { w, d } = cv;
  const rng = ctx.rng;
  const crops = ctx.cul.pal.crops ?? ['wheat'];
  cv.F(-1, -1, -1, w, -1, d, M.apron);
  cv.F(0, 0, 0, w - 1, 3, d - 1, 'air');
  ring(cv, 0, 0, M.fence);
  const gu = Math.floor(w / 2);
  cv.S(gu, 0, 0, card(M.gate, 'N'));
  const mid = Math.floor(w / 2);
  cv.F(1, -1, 1, w - 2, -1, d - 2, 'farmland ["moisturized_amount"=7]');
  cv.F(mid, -1, 2, mid, -1, d - 2, 'water');
  cv.F(mid, -2, 1, mid, -2, d - 2, 'dirt');
  cv.S(mid, -1, 1, M.floor);
  for (const [a, b] of [[1, mid - 1], [mid + 1, w - 2]]) {
    const crop = pickOne(rng, crops);
    if (crop === 'pumpkin' || crop === 'melon_block') {
      cv.F(a, -1, 1, b, -1, d - 2, 'coarse_dirt');
      for (let v = 1; v <= d - 2; v += 2) cv.F(a, 0, v, b, 0, v, crop === 'pumpkin' ? card('pumpkin', 'S') : crop);
    } else if (crop === 'sweet_berry_bush') {
      cv.F(a, -1, 1, b, -1, d - 2, 'grass_block');
      cv.F(a, 0, 1, b, 0, d - 2, 'sweet_berry_bush ["growth"=3]');
    } else cv.F(a, 0, 1, b, 0, d - 2, `${crop} ["growth"=7]`);
  }
  // Espantapájaros, heno y compostador
  const su = chance(rng, 0.5) ? 2 : w - 3;
  cv.S(su, 0, Math.floor(d / 2), M.fence);
  cv.S(su, 1, Math.floor(d / 2), 'hay_block');
  cv.S(su, 2, Math.floor(d / 2), card('carved_pumpkin', 'N'));
  cv.S(-1, 0, d, 'hay_block');
  cv.S(w, 0, d, 'composter');
  cv.S(-1, 0, -1, M.fence);
  cv.S(-1, 1, -1, standLantern(M.light));
  return {
    door: cv.P(gu, 0, 0), doorOut: cv.P(gu, 0, -1), inside: cv.C(gu, 0, -1), center: cv.C(gu, 0, Math.floor(d / 2)),
    wp: cv.C(gu, 0, -2), work: cv.C(gu, 0, -2), top: 4,
  };
}

/** Pozo de piedra con tejadillo. Ocupa 3x3 (centro en 1,1). */
export function buildWell(plan, cul, x, y, z, rng) {
  const P = cul.pal;
  const found = pal(P.found, rng);
  const fence = pal(P.fence, rng);
  const roof = pal(P.roof, rng);
  plan.fillW(x - 1, y - 4, z - 1, x + 1, y - 1, z + 1, found);
  plan.fillW(x, y - 3, z, x, y - 1, z, 'water');
  plan.fillW(x - 1, y, z - 1, x + 1, y, z + 1, found);
  plan.setW(x, y, z, 'air');
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plan.fillW(x + dx, y + 1, z + dz, x + dx, y + 2, z + dz, fence);
  plan.fillW(x - 1, y + 3, z - 1, x + 1, y + 3, z + 1, roof.slab);
  plan.setW(x, y + 2, z, hangLantern(P.light ?? 'lantern'));
}

/** Fuente/estatua central según la cultura (ciudades y capitales). */
export function buildFountain(plan, cul, x, y, z, rng, wool) {
  const P = cul.pal;
  const found = pal(P.found, rng);
  const accent = pal(P.accent, rng);
  switch (cul.arch) {
    case 'orcish':
      plan.fillW(x - 1, y - 1, z - 1, x + 1, y - 1, z + 1, 'cobblestone');
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) plan.setW(x + dx, y, z + dz, 'cobblestone_wall');
      plan.setW(x, y, z, 'campfire');
      plan.fillW(x - 2, y, z - 2, x - 2, y + 3, z - 2, 'spruce_log');
      plan.setW(x - 2, y + 4, z - 2, 'skeleton_skull ["facing_direction"=1]');
      return;
    case 'infernal':
      plan.fillW(x - 2, y - 2, z - 2, x + 2, y - 1, z + 2, found);
      plan.fillW(x - 1, y - 1, z - 1, x + 1, y - 1, z + 1, 'lava');
      plan.fillW(x - 2, y, z - 2, x + 2, y, z + 2, 'nether_brick_fence');
      plan.fillW(x - 1, y, z - 1, x + 1, y, z + 1, 'air');
      plan.fillW(x - 1, y + 1, z - 1, x + 1, y + 1, z + 1, 'iron_bars');
      plan.fillW(x, y + 1, z, x, y + 4, z, 'polished_basalt');
      plan.setW(x, y + 5, z, 'soul_campfire');
      return;
    case 'draconic':
      plan.fillW(x - 2, y, z - 2, x + 2, y, z + 2, 'cut_red_sandstone');
      plan.fillW(x - 1, y + 1, z - 1, x + 1, y + 1, z + 1, 'red_sandstone');
      plan.setW(x, y + 2, z, 'gold_block');
      plan.setW(x, y + 3, z, 'campfire');
      return;
    case 'elven':
      smallTree(plan, x, y, z, 'birch_log', 'azalea_leaves_flowered ["persistent_bit"=true]', rng);
      for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) plan.setW(x + dx, y, z + dz, 'flowering_azalea');
      return;
    case 'beast':
      plan.fillW(x, y, z, x, y + 3, z, 'acacia_log');
      plan.setW(x, y + 4, z, card('carved_pumpkin', 'S'));
      plan.setW(x + 1, y + 3, z, `${wool[0]}_wool`);
      plan.setW(x - 1, y + 3, z, `${wool[1]}_wool`);
      plan.setW(x, y + 5, z, standLantern('lantern'));
      return;
    default: {
      // Fuente con pilar central
      plan.fillW(x - 2, y - 1, z - 2, x + 2, y - 1, z + 2, found);
      plan.fillW(x - 2, y, z - 2, x + 2, y, z + 2, found);
      plan.fillW(x - 1, y, z - 1, x + 1, y, z + 1, 'water');
      plan.fillW(x, y, z, x, y + 2, z, cul.arch === 'celestial' ? 'quartz_pillar' : cul.arch === 'fairy' ? 'mushroom_stem ["huge_mushroom_bits"=15]' : found);
      plan.setW(x, y + 3, z, cul.arch === 'fairy' ? 'shroomlight' : accent);
      plan.setW(x, y + 4, z, standLantern(P.light ?? 'lantern'));
    }
  }
}

/** Picota/cepo en una tarima: el jugador castigado se coloca en "stand". */
export function buildStocks(plan, cul, x, y, z, rng, faceDirWorld = 'N') {
  const P = cul.pal;
  const plat = pal(P.floorHigh ?? P.floor, rng);
  const frame = pal(P.frame, rng);
  const roof = pal(P.roof, rng);
  plan.fillW(x - 1, y, z - 1, x + 1, y, z + 1, String(plat).includes('[') ? 'oak_planks' : plat);
  const [dx, dz] = DVEC[faceDirWorld];
  // Escalón delante
  plan.setW(x + dx * 2, y, z + dz * 2, stair(roof.stair, opposite(faceDirWorld)));
  // Postes y travesaño a la altura del cuello
  const [px, pz] = faceDirWorld === 'N' || faceDirWorld === 'S' ? [1, 0] : [0, 1];
  const frameB = String(frame).includes('[') ? 'oak_log' : frame;
  plan.fillW(x - px, y + 1, z - pz, x - px, y + 2, z - pz, frameB);
  plan.fillW(x + px, y + 1, z + pz, x + px, y + 2, z + pz, frameB);
  plan.fillW(x - px, y + 3, z - pz, x + px, y + 3, z + pz, roof.slab);
  plan.setW(x - px * 2, y + 1, z - pz * 2, pal(P.fence, rng));
  plan.setW(x - px * 2, y + 2, z - pz * 2, standLantern(P.light ?? 'lantern'));
  return { x: x + 0.5, y: y + 1, z: z + 0.5 };
}

/* ================================================================== */
/* Tamaños por tipo                                                    */
/* ================================================================== */

/** [ancho, fondo] locales de un edificio. */
export function sizeOf(type, cul, rng, extra = {}) {
  const round = cul.round;
  const orc = cul.arch === 'orcish';
  switch (type) {
    case 'shack': return orc ? [5, irand(rng, 5, 6)] : round ? [5, 5] : [irand(rng, 5, 6), irand(rng, 5, 6)];
    case 'house': return round ? [7, 7] : [irand(rng, 7, 9), irand(rng, 7, 8)];
    case 'manor': return round ? [9, 9] : orc ? [13, 9] : [irand(rng, 11, 13), irand(rng, 9, 11)];
    case 'tavern': return [extra.big ? 13 : 11, 9];
    case 'smithy': return [9, 7];
    case 'market': return extra.big ? [15, 11] : extra.small ? [11, 7] : [13, 9];
    case 'temple': {
      const s = cul.temple;
      if (s === 'grove' || s === 'totem' || s === 'ring') return extra.small ? [9, 9] : [11, 11];
      if (s === 'ziggurat') return extra.small ? [9, 9] : [13, 13];
      return extra.small ? [9, 11] : [11, 15];
    }
    case 'jail': return [4 * (extra.cells ?? 2) + 1, 8];
    case 'tower': return [5, 5];
    case 'barracks': return [11, 7];
    case 'keep': return [23, 23];
    case 'farm': return extra.small ? [9, irand(rng, 6, 7)] : [irand(rng, 4, 5) * 2 + 1, irand(rng, 7, 10)];
    default: return [7, 7];
  }
}

export const BUILDERS = {
  shack: buildShack, house: buildHouse, manor: buildManor, tavern: buildTavern, smithy: buildSmithy, market: buildMarket,
  temple: buildTemple, jail: (cv, ctx) => buildJail(cv, ctx, ctx.cells ?? 2), tower: buildTower, barracks: buildBarracks,
  keep: buildKeep, farm: buildFarm,
};

/* ================================================================== */
/* Botín de cofres según la clase                                       */
/* ================================================================== */

const LOOT = {
  baja: [['minecraft:bread', 1, 3, 0.7], ['minecraft:potato', 1, 4, 0.5], ['minecraft:carrot', 1, 3, 0.4], ['minecraft:wheat', 2, 6, 0.4],
    ['minecraft:stick', 2, 6, 0.4], ['minecraft:coal', 1, 3, 0.35], ['minecraft:string', 1, 3, 0.3], ['minecraft:gold_nugget', 1, 4, 0.45],
    ['minecraft:leather', 1, 2, 0.25], ['minecraft:bone', 1, 2, 0.2], ['minecraft:wooden_hoe', 1, 1, 0.12], ['minecraft:rotten_flesh', 1, 2, 0.15],
    ['minecraft:wheat_seeds', 2, 8, 0.4], ['minecraft:flint', 1, 2, 0.15]],
  media: [['minecraft:bread', 2, 5, 0.75], ['minecraft:cooked_beef', 1, 3, 0.35], ['minecraft:baked_potato', 2, 4, 0.4], ['minecraft:iron_ingot', 1, 3, 0.4],
    ['minecraft:gold_nugget', 3, 9, 0.6], ['minecraft:gold_ingot', 1, 1, 0.25], ['minecraft:torch', 4, 12, 0.4], ['minecraft:book', 1, 2, 0.3],
    ['minecraft:arrow', 4, 12, 0.3], ['minecraft:stone_pickaxe', 1, 1, 0.15], ['minecraft:iron_sword', 1, 1, 0.08], ['minecraft:emerald', 1, 1, 0.12],
    ['minecraft:candle', 1, 3, 0.25], ['minecraft:paper', 1, 4, 0.3], ['minecraft:cookie', 2, 6, 0.25], ['minecraft:honey_bottle', 1, 2, 0.15]],
  alta: [['minecraft:gold_ingot', 2, 6, 0.8], ['minecraft:emerald', 1, 5, 0.7], ['minecraft:diamond', 1, 1, 0.12], ['minecraft:cake', 1, 1, 0.25],
    ['minecraft:golden_apple', 1, 1, 0.12], ['minecraft:book', 1, 3, 0.4], ['minecraft:clock', 1, 1, 0.2], ['minecraft:glistering_melon_slice', 1, 3, 0.25],
    ['minecraft:amethyst_shard', 1, 4, 0.3], ['minecraft:gold_nugget', 5, 15, 0.6], ['minecraft:cooked_chicken', 2, 4, 0.4], ['minecraft:pumpkin_pie', 1, 3, 0.35],
    ['minecraft:name_tag', 1, 1, 0.08], ['rpg:mana_potion', 1, 2, 0.2], ['rpg:elixir_life', 1, 1, 0.08], ['minecraft:lapis_lazuli', 2, 6, 0.3]],
};

const LOOT_CULTURE = {
  humano: [['minecraft:apple', 1, 3, 0.4]],
  elfo: [['minecraft:arrow', 4, 10, 0.4], ['minecraft:sweet_berries', 2, 6, 0.4], ['minecraft:honey_bottle', 1, 2, 0.2]],
  enano: [['minecraft:raw_iron', 1, 4, 0.4], ['minecraft:coal', 2, 6, 0.5], ['minecraft:iron_nugget', 3, 9, 0.4]],
  orco: [['minecraft:cooked_porkchop', 1, 3, 0.4], ['minecraft:bone', 1, 4, 0.4], ['minecraft:leather', 1, 3, 0.3]],
  bestia: [['minecraft:cooked_rabbit', 1, 2, 0.35], ['minecraft:rabbit_hide', 1, 3, 0.3], ['minecraft:feather', 2, 5, 0.3]],
  demonio: [['minecraft:blaze_powder', 1, 2, 0.3], ['minecraft:nether_wart', 2, 5, 0.35], ['minecraft:magma_cream', 1, 2, 0.2]],
  celestial: [['minecraft:glowstone_dust', 2, 5, 0.4], ['minecraft:quartz', 2, 6, 0.4], ['minecraft:feather', 1, 3, 0.3]],
  vampiro: [['minecraft:redstone', 2, 6, 0.35], ['minecraft:ink_sac', 1, 3, 0.3], ['minecraft:glass_bottle', 1, 3, 0.3]],
  hada: [['minecraft:glowstone_dust', 1, 3, 0.3], ['minecraft:honeycomb', 1, 3, 0.3], ['minecraft:sweet_berries', 2, 5, 0.4]],
  draconido: [['minecraft:gold_nugget', 3, 8, 0.4], ['minecraft:blaze_rod', 1, 1, 0.15], ['minecraft:fire_charge', 1, 2, 0.2]],
};

/** Rellena un contenedor colocado con botín según la clase (en huecos aleatorios). */
export function fillContainer(dim, pos, cls, cultureId, rng, mult = 1) {
  let block;
  try { block = dim.getBlock(pos); } catch { return 0; }
  let inv;
  try { inv = block?.getComponent('minecraft:inventory')?.container; } catch { return 0; }
  if (!inv) return 0;
  const table = [...(LOOT[cls] ?? LOOT.media), ...(LOOT_CULTURE[cultureId] ?? [])];
  let n = 0;
  const size = inv.size ?? 27;
  const used = new Set();
  for (const [id, a, b, p] of table) {
    if (rng() >= p * mult) continue;
    let st;
    try { st = new ItemStack(id, irand(rng, a, b)); } catch { continue; }
    let slot = Math.floor(rng() * size);
    for (let k = 0; k < size && used.has(slot); k++) slot = (slot + 1) % size;
    used.add(slot);
    try {
      if (!inv.getItem(slot)) inv.setItem(slot, st);
      else inv.addItem(st);
      n++;
    } catch {}
  }
  return n;
}
