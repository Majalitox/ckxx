// Asentamientos y reinos: aldeas, pueblos, ciudades y capitales que aparecen mientras exploras,
// agrupados en reinos con cultura, gobierno, leyes y colores propios. Se construyen con comandos
// en segundo plano (system.runJob) dentro de una zona de carga temporal, se pueblan con
// habitantes, guardias y gobernantes, se mantienen vivos (reaparición, sustitución de muertos),
// se anuncian al descubrirlos y sufren ataques nocturnos.
//
// Contrato: docs/v2-contract.md §6.1 (W().settlements, W().realms).
import { world, system } from '@minecraft/server';
import { W, wDirty, getP, dirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { msg, title, actionbar, addGold, addKarma } from '../core/progression.js';
import { raceOf } from '../data/races.js';
import { FIRST_NAMES, SURNAMES } from '../data/names.js';
import * as C from '../data/cultures.js';
import * as S from './structures.js';
import * as npc from './npc.js';
import { setupGuildTown } from './town.js';
import { hash, seeded, dist2D, cardinal } from '../util/math.js';
import { sleep, isSolid } from '../util/compat.js';

/** Ganchos que asigna el integrador. */
export const hooks = {
  onEnter: undefined, // (player, settlement, firstTime)
  onLeave: undefined, // (player, settlement)
  onRealmEnter: undefined, // (player, realm, firstTime)
  onBuilt: undefined, // (settlement)
  onRaidStart: undefined, // (settlement)
  onRaidDefended: undefined, // (player, settlement)
};

const OW = 'minecraft:overworld';
const WP_TYPE = 'rpg:waypoint';

function cfgv(key, def) {
  try {
    const v = cfg(key);
    return v === undefined || v === null ? def : v;
  } catch { return def; }
}
function warn(m, e) {
  try { console.warn('[Aetheria] ' + m + (e ? ': ' + (e?.message ?? e) : '')); } catch {}
}
const irand = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pickR = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/* ================================================================== */
/* Tipos de asentamiento                                               */
/* ================================================================== */

export const KINDS = {
  aldea: { r: [32, 36], plaza: 6, roads: 2, guards: 2, pop: 10, walls: false, name: 'Aldea' },
  pueblo: { r: [42, 46], plaza: 6, roads: 3, guards: 4, pop: 16, walls: false, name: 'Pueblo' },
  ciudad: { r: [60, 64], plaza: 7, roads: 4, guards: 8, pop: 24, walls: true, wallH: 6, name: 'Ciudad' },
  capital: { r: [70, 74], plaza: 8, roads: 4, guards: 12, pop: 30, walls: true, wallH: 8, name: 'Capital' },
  inicio: { r: [56, 56], plaza: 6, roads: 3, guards: 4, pop: 12, walls: false, name: 'Villa del Gremio' },
};

// [tipo, cantidad (n | [min,max] | probabilidad < 1), extra]
const PROGRAM = {
  aldea: [['market', 1, { small: true }], ['farm', 1], ['tavern', 0.7], ['smithy', 0.5], ['temple', 0.6, { small: true }], ['tower', 1], ['house', [3, 4]], ['farm', [1, 2]], ['shack', [2, 3]]],
  pueblo: [['market', 1], ['farm', 1], ['tavern', 1], ['smithy', 1], ['temple', 1], ['jail', 1, { cells: 2 }], ['tower', 2], ['barracks', 0.4], ['manor', 1], ['house', [5, 6]], ['farm', [1, 2]], ['shack', [3, 4]]],
  ciudad: [['market', 1], ['jail', 1, { cells: 3 }], ['temple', 1], ['tavern', [1, 2]], ['smithy', 1], ['barracks', 1], ['manor', [2, 3]], ['house', [7, 8]], ['farm', [2, 3]], ['shack', [4, 6]]],
  capital: [['keep', 1], ['market', 1, { big: true }], ['jail', 1, { cells: 3 }], ['temple', 1], ['tavern', 2, { big: true }], ['smithy', [1, 2]], ['barracks', [1, 2]], ['manor', [4, 5]], ['house', [8, 10]], ['farm', [2, 4]], ['shack', [6, 7]]],
  inicio: [['market', 1], ['temple', 1, { small: true }], ['tavern', 1], ['smithy', 1], ['jail', 1, { cells: 2 }], ['tower', 1], ['manor', 1], ['farm', 1], ['house', 4], ['farm', 1], ['shack', 2]],
};

// Distancia al centro (fracción del radio) donde se prefiere cada edificio.
const ZONE = {
  keep: [0.4, 0.62], tavern: [0.15, 0.5], smithy: [0.3, 0.75], temple: [0.2, 0.55], jail: [0.2, 0.55], tower: [0.65, 0.9],
  barracks: [0.4, 0.8], manor: [0.25, 0.7], house: [0.25, 0.85], shack: [0.5, 0.95], farm: [0.5, 0.95],
};

const CLASS_OF = { shack: 'baja', house: 'media', manor: 'alta', keep: 'alta', farm: 'baja' };

// Parcelas familiares de la villa inicial (relativas al centro). El Gremio queda al sur.
const STARTER_PLOTS = [[-14, -14], [14, -14], [-28, -12], [28, -12], [-14, -30], [14, -30], [-30, 12], [30, 12]];
// Parcelas de la v1 (mundos antiguos).
const V1_SLOTS = [[-24, -4], [22, -4], [-6, -26], [-30, -26], [18, -26], [-32, 20], [26, 20], [-50, 0], [46, 0], [-6, -48]];

/* ================================================================== */
/* Registro                                                             */
/* ================================================================== */

function reg() {
  const w = W();
  if (!Array.isArray(w.settlements)) w.settlements = [];
  if (!Array.isArray(w.realms)) w.realms = [];
  return w;
}

export function allSettlements() { return reg().settlements; }
export function allRealms() { return reg().realms; }
export function getSettlement(id) { return reg().settlements.find((s) => s.id === id); }
export function getRealm(id) { return reg().realms.find((r) => r.id === id); }

/** Reino de un asentamiento (objeto o id); también acepta un id de reino. */
export function realmOf(sOrId) {
  if (!sOrId) return undefined;
  if (typeof sOrId === 'string') {
    const s = getSettlement(sOrId);
    if (s) return getRealm(s.realmId);
    return getRealm(sOrId);
  }
  return getRealm(sOrId.realmId);
}

/** Asentamiento construido que contiene la posición (dentro de su radio). */
export function settlementAt(dimId, loc, includeUnbuilt = false) {
  if (!loc) return undefined;
  for (const s of reg().settlements) {
    if (s.dim !== dimId || (!s.built && !includeUnbuilt)) continue;
    const dx = loc.x - s.center.x;
    const dz = loc.z - s.center.z;
    if (dx * dx + dz * dz <= s.radius * s.radius) return s;
  }
  return undefined;
}

/** Asentamiento más cercano (opcionalmente dentro de maxDist). */
export function nearestSettlement(dimId, loc, maxDist = Infinity, includeUnbuilt = false) {
  let best;
  let bd = maxDist;
  for (const s of reg().settlements) {
    if (s.dim !== dimId || (!s.built && !includeUnbuilt)) continue;
    const d = dist2D(s.center, loc);
    if (d <= bd) { bd = d; best = s; }
  }
  return best;
}

/** Casa (registro) que contiene la posición, o undefined. */
export function houseAt(dimId, loc) {
  const s = settlementAt(dimId, loc);
  if (!s) return undefined;
  for (const h of s.houses ?? []) {
    if (loc.x >= h.min.x && loc.x < h.max.x + 1 && loc.z >= h.min.z && loc.z < h.max.z + 1 && loc.y >= h.min.y - 1 && loc.y <= h.max.y + 1) return { settlement: s, house: h };
  }
  return undefined;
}

/** Contenedor con dueño en esa posición de bloque, o undefined. */
export function chestAt(dimId, loc) {
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  for (const s of reg().settlements) {
    if (s.dim !== dimId) continue;
    const dx = x - s.center.x;
    const dz = z - s.center.z;
    if (dx * dx + dz * dz > (s.radius + 4) ** 2) continue;
    const c = (s.chests ?? []).find((k) => k.x === x && k.y === y && k.z === z);
    if (c) return { settlement: s, chest: c };
  }
  return undefined;
}

export function starterSettlement() {
  const id = reg().starterId;
  return id ? getSettlement(id) : undefined;
}

export function kindLabel(s) {
  return C.kindLabel(s.culture, s.kind);
}

export function rulerName(realm, withArticle = false) {
  if (!realm?.ruler) return 'nadie';
  const art = withArticle ? (realm.ruler.gender === 'f' ? 'la ' : 'el ') : '';
  return `${art}${realm.ruler.title} ${realm.ruler.name}${realm.ruler.surname ? ' ' + realm.ruler.surname : ''}`;
}

/** Adjetivo de la cultura concordado con la etiqueta del asentamiento. */
function cultureAdj(cul, label) {
  return cul.adj[/^(aldea|ciudad|capital|villa|ermita|corte|fortaleza|ciudadela|avanzada|santa|feria)/.test(String(label).toLowerCase()) ? 1 : 0];
}

/* ================================================================== */
/* Lista de NPCs (identidades completas, fuera de W())                 */
/* ================================================================== */

const rosterCache = new Map();
const ROSTER_CHUNK = 30000;

function rosterKey(sid) { return 'rpg:sr_' + sid; }

/** Identidades completas de los NPCs de un asentamiento: [{ i: ident, p: [x,y,z], k, h, dd? }]. */
export function rosterOf(sid) {
  if (rosterCache.has(sid)) return rosterCache.get(sid);
  let list = [];
  try {
    const n = world.getDynamicProperty(rosterKey(sid) + '_n');
    let raw;
    if (typeof n === 'number') {
      raw = '';
      for (let i = 0; i < n; i++) raw += world.getDynamicProperty(`${rosterKey(sid)}_${i}`) ?? '';
    } else raw = world.getDynamicProperty(rosterKey(sid));
    if (typeof raw === 'string' && raw) list = JSON.parse(raw);
  } catch {}
  if (!Array.isArray(list)) list = [];
  rosterCache.set(sid, list);
  return list;
}

function saveRoster(sid, list) {
  rosterCache.set(sid, list);
  const key = rosterKey(sid);
  try {
    const str = JSON.stringify(list);
    const n = Math.max(1, Math.ceil(str.length / ROSTER_CHUNK));
    const old = world.getDynamicProperty(key + '_n');
    for (let i = 0; i < n; i++) world.setDynamicProperty(`${key}_${i}`, str.slice(i * ROSTER_CHUNK, (i + 1) * ROSTER_CHUNK));
    world.setDynamicProperty(key + '_n', n);
    if (typeof old === 'number') for (let i = n; i < old; i++) world.setDynamicProperty(`${key}_${i}`, undefined);
  } catch (e) { warn('No se pudo guardar la lista de ' + sid, e); }
}

function clearRoster(sid) {
  const key = rosterKey(sid);
  try {
    const old = world.getDynamicProperty(key + '_n');
    if (typeof old === 'number') for (let i = 0; i < old; i++) world.setDynamicProperty(`${key}_${i}`, undefined);
    world.setDynamicProperty(key + '_n', undefined);
  } catch {}
  rosterCache.delete(sid);
}

/* ================================================================== */
/* Reinos                                                               */
/* ================================================================== */

function createRealm(cultureId, seat, rng, extra = {}) {
  const w = reg();
  const gov = C.pickGovernment(cultureId, rng);
  let name = C.realmName(cultureId, gov, rng);
  for (let i = 0; i < 8 && w.realms.some((r) => r.name === name); i++) name = C.realmName(cultureId, gov, rng);
  const gender = rng() < 0.5 ? 'm' : 'f';
  const names = FIRST_NAMES[cultureId] ?? FIRST_NAMES.humano;
  const colors = C.pickColors(cultureId, rng);
  w.realmCount = (w.realmCount ?? 0) + 1;
  const realm = {
    id: 'r' + w.realmCount,
    name,
    culture: cultureId,
    ruler: {
      name: pickR(rng, names[gender]), surname: pickR(rng, SURNAMES[cultureId] ?? SURNAMES.humano), gender,
      title: C.rulerTitle(cultureId, gov, gender), identId: null,
    },
    capitalId: null,
    government: gov,
    strictness: C.pickStrictness(cultureId, rng),
    attitudes: C.rollAttitudes(cultureId, rng),
    economy: { focus: C.pickEconomy(cultureId, rng), prosperity: Math.round((0.5 + rng()) * 100) / 100 },
    colors: { primary: colors.primary, secondary: colors.secondary, wool: colors.wool },
    seat: { x: Math.round(seat.x), z: Math.round(seat.z) },
    createdDay: safeDay(),
    ...extra,
  };
  w.realms.push(realm);
  wDirty();
  return realm;
}

function safeDay() {
  try { return world.getDay(); } catch { return 0; }
}

function realmSeat(realm) {
  const cap = realm.capitalId ? getSettlement(realm.capitalId) : undefined;
  return cap ? cap.center : realm.seat;
}

function realmNear(loc, maxDist) {
  let best;
  let bd = maxDist;
  for (const r of reg().realms) {
    const seat = realmSeat(r);
    if (!seat) continue;
    const d = dist2D(seat, loc);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

function capitalWithin(loc, d) {
  return reg().settlements.some((s) => s.kind === 'capital' && dist2D(s.center, loc) < d);
}

/* ================================================================== */
/* Creación de registros                                                */
/* ================================================================== */

function newSettlement(o) {
  const w = reg();
  w.setCount = (w.setCount ?? 0) + 1;
  const id = 's' + w.setCount;
  let name = o.name;
  for (let i = 0; i < 10 && w.settlements.some((s) => s.name === name); i++) name = C.townName(o.culture, seeded(hash(id + i)));
  const s = {
    id, kind: o.kind, culture: o.culture, name, realmId: o.realm.id, dim: o.dim ?? OW,
    center: { x: Math.round(o.center.x), y: Math.round(o.center.y ?? 64), z: Math.round(o.center.z) }, radius: o.radius,
    plaza: null, stocks: null, jail: null, houses: [], chests: [], shops: [], residents: [], guards: [], rulerId: null,
    built: false, createdDay: safeDay(), seed: o.seed >>> 0,
  };
  if (o.reserved) s.reserved = o.reserved;
  w.settlements.push(s);
  if (o.kind === 'capital' && !o.realm.capitalId) o.realm.capitalId = id;
  wDirty();
  return s;
}

/* ================================================================== */
/* Rejilla de ocupación y mapa de alturas                               */
/* ================================================================== */
// Códigos: 0 libre, 1 camino principal, 2 plaza, 3 edificio/obstáculo, 4 delantal, 5 muralla,
// 6 reservado, 7 sendero, 8 fuera del asentamiento

class Grid {
  constructor(cx, cz, R) {
    this.R = R;
    this.x0 = cx - R;
    this.z0 = cz - R;
    this.n = 2 * R + 1;
    this.c = new Uint8Array(this.n * this.n);
  }
  in(x, z) { return x >= this.x0 && z >= this.z0 && x < this.x0 + this.n && z < this.z0 + this.n; }
  i(x, z) { return (z - this.z0) * this.n + (x - this.x0); }
  get(x, z) { return this.in(x, z) ? this.c[this.i(x, z)] : 255; }
  set(x, z, v) { if (this.in(x, z)) this.c[this.i(x, z)] = v; }
  rect(x1, z1, x2, z2, v, onlyIf) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (!this.in(x, z)) continue;
      const k = this.i(x, z);
      if (onlyIf && !onlyIf.has(this.c[k])) continue;
      this.c[k] = v;
    }
  }
  free(x1, z1, x2, z2, forbid) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const k = this.get(x, z);
      if (k === 255 || forbid.has(k)) return false;
    }
    return true;
  }
}

const SKIP_WORDS = ['leaves', '_log', '_wood', 'mushroom_block', 'mushroom_stem', 'bamboo', 'cactus', 'vine', 'waterlily', 'azalea', 'sugar_cane',
  'kelp', 'seagrass', 'snow_layer', 'dripleaf', 'moss_carpet', 'cocoa', 'pale_hanging_moss', 'stem'];

function skipGround(b) {
  let id;
  try { id = b.typeId; } catch { return false; }
  if (id === 'minecraft:air') return true;
  if (id.includes('water') || id.includes('lava')) return true;
  for (const wd of SKIP_WORDS) if (id.includes(wd)) return true;
  return !isSolid(b);
}

/** Sondea una columna: g = suelo sólido, t = bloque más alto, w = agua/lava en superficie. */
export function probeColumn(dim, x, z) {
  let top;
  try { top = dim.getTopmostBlock({ x, z }); } catch { return null; }
  if (!top) return null;
  const ty = top.location.y;
  let y = ty;
  let b = top;
  let liquid = false;
  for (let i = 0; i < 64 && b; i++) {
    let id = '';
    try { id = b.typeId; } catch {}
    if (i < 3 && (id.includes('water') || id.includes('lava'))) liquid = true;
    if (!skipGround(b)) break;
    y--;
    try { b = dim.getBlock({ x, y, z }); } catch { b = undefined; }
  }
  let soil = false;
  try { soil = !!b && /grass_block|dirt|podzol|moss_block|mycelium|mud|farmland/.test(b.typeId); } catch {}
  return { g: y, t: ty, w: liquid, soil };
}

class HMap {
  constructor(dim, grid) {
    this.dim = dim;
    this.G = grid;
    const n = grid.n * grid.n;
    this.gA = new Int16Array(n);
    this.tA = new Int16Array(n);
    this.wA = new Uint8Array(n);
    this.sA = new Uint8Array(n);
    this.k = new Uint8Array(n); // 0 sin datos, 1 conocido, 2 no cargado
    this.fallback = 64;
  }
  probeIdx(i) {
    if (this.k[i]) return;
    const x = this.G.x0 + (i % this.G.n);
    const z = this.G.z0 + Math.floor(i / this.G.n);
    const r = probeColumn(this.dim, x, z);
    if (!r) { this.k[i] = 2; return; }
    this.gA[i] = r.g;
    this.tA[i] = r.t;
    this.wA[i] = r.w ? 1 : 0;
    this.sA[i] = r.soil ? 1 : 0;
    this.k[i] = 1;
  }
  at(x, z) {
    if (!this.G.in(x, z)) {
      const r = probeColumn(this.dim, x, z);
      return r ?? { g: this.fallback, t: this.fallback, w: false, unknown: true };
    }
    const i = this.G.i(x, z);
    this.probeIdx(i);
    if (this.k[i] !== 1) return { g: this.fallback, t: this.fallback, w: false, unknown: true };
    return { g: this.gA[i], t: this.tA[i], w: !!this.wA[i], soil: !!this.sA[i] };
  }
  g(x, z) { return this.at(x, z).g; }
  t(x, z) { return this.at(x, z).t; }
  water(x, z) { return this.at(x, z).w; }
  /** Fija el suelo de un rectángulo (tras nivelar). */
  level(x1, z1, x2, z2, y) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (!this.G.in(x, z)) continue;
      const i = this.G.i(x, z);
      this.gA[i] = y;
      this.tA[i] = y;
      this.wA[i] = 0;
      this.k[i] = 1;
    }
  }
}

function median(arr) {
  const a = arr.filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : 64;
}

/* ================================================================== */
/* Evaluación del terreno                                               */
/* ================================================================== */

function evaluateSite(dim, cx, cz, R) {
  let total = 0;
  let missing = 0;
  let water = 0;
  const hs = [];
  for (let dz = -R; dz <= R; dz += 6) for (let dx = -R; dx <= R; dx += 6) {
    if (dx * dx + dz * dz > R * R) continue;
    total++;
    const r = probeColumn(dim, cx + dx, cz + dz);
    if (!r) { missing++; continue; }
    if (r.w) water++;
    else hs.push(r.g);
  }
  if (!total || missing / total > 0.15) return { ready: false };
  hs.sort((a, b) => a - b);
  const p = (q) => hs[Math.min(hs.length - 1, Math.max(0, Math.floor(q * (hs.length - 1))))] ?? 64;
  return { ready: true, water: water / Math.max(1, total - missing), spread: p(0.9) - p(0.1), median: p(0.5) };
}

/* ================================================================== */
/* Zona de carga (ticking area)                                         */
/* ================================================================== */

async function loadArea(dim, center, R, id) {
  const from = { x: Math.floor(center.x - R), y: 0, z: Math.floor(center.z - R) };
  const to = { x: Math.floor(center.x + R), y: 0, z: Math.floor(center.z + R) };
  let tam;
  try { tam = world.tickingAreaManager; } catch {}
  if (tam && typeof tam.createTickingArea === 'function') {
    const opts = { dimension: dim, from, to };
    let cap = true;
    try { if (typeof tam.hasCapacity === 'function') cap = tam.hasCapacity(opts); } catch {}
    if (cap) {
      try { if (tam.hasTickingArea?.(id)) tam.removeTickingArea(id); } catch {}
      try {
        let done = false;
        let failed = false;
        const p = tam.createTickingArea(id, opts);
        if (p && typeof p.then === 'function') {
          p.then(() => { done = true; }, (e) => { done = true; failed = true; warn('Zona de carga (API)', e); });
          for (let i = 0; i < 40 && !done; i++) await sleep(10);
        }
        if (!failed) return { kind: 'tam', id };
        try { tam.removeTickingArea(id); } catch {}
      } catch (e) { warn('Zona de carga (API)', e); }
    }
  }
  // Alternativa: comandos (máx. 100 chunks por zona): cuatro cuadrantes.
  const names = [];
  const midX = Math.floor(center.x);
  const midZ = Math.floor(center.z);
  const quads = [[from.x, from.z, midX, midZ], [midX + 1, from.z, to.x, midZ], [from.x, midZ + 1, midX, to.z], [midX + 1, midZ + 1, to.x, to.z]];
  quads.forEach(([x1, z1, x2, z2], i) => {
    const name = `${id}_${i}`;
    try {
      dim.runCommand(`tickingarea add ${x1} 0 ${z1} ${x2} 0 ${z2} ${name} true`);
      names.push(name);
    } catch {}
  });
  if (names.length) {
    const w = reg();
    w.setAreas = [...new Set([...(w.setAreas ?? []), ...names])];
    wDirty();
  }
  return { kind: 'cmd', names };
}

function releaseArea(dim, area) {
  if (!area) return;
  if (area.kind === 'tam') {
    try { world.tickingAreaManager.removeTickingArea(area.id); } catch {}
    return;
  }
  for (const n of area.names ?? []) try { dim.runCommand(`tickingarea remove ${n}`); } catch {}
  const w = reg();
  if (w.setAreas) {
    w.setAreas = w.setAreas.filter((n) => !(area.names ?? []).includes(n));
    wDirty();
  }
}

function chunkLoaded(dim, loc) {
  try {
    if (typeof dim.isChunkLoaded === 'function') return dim.isChunkLoaded({ x: loc.x, y: loc.y ?? 64, z: loc.z });
  } catch { return false; }
  try { return !!dim.getBlock({ x: loc.x, y: loc.y ?? 64, z: loc.z }); } catch { return false; }
}

async function waitReadable(dim, center, R, maxTicks = 600) {
  const pts = [[0, 0]];
  for (let i = 0; i < 8; i++) pts.push([Math.round(Math.cos((i * Math.PI) / 4) * R), Math.round(Math.sin((i * Math.PI) / 4) * R)]);
  for (let t = 0; t < maxTicks; t += 10) {
    let ok = true;
    for (const [dx, dz] of pts) {
      const loc = { x: center.x + dx, y: 64, z: center.z + dz };
      if (!chunkLoaded(dim, loc) || !probeColumn(dim, loc.x, loc.z)) { ok = false; break; }
    }
    if (ok) return true;
    await sleep(10);
  }
  return false;
}

function runJobAsync(genFn) {
  return new Promise((resolve, reject) => {
    function* wrap() {
      try {
        yield* genFn();
        resolve(true);
      } catch (e) {
        reject(e);
      }
    }
    try { system.runJob(wrap()); } catch (e) { reject(e); }
  });
}

/* ================================================================== */
/* Planificación del trazado                                            */
/* ================================================================== */

const FORBID_BUILD = new Set([1, 2, 3, 4, 5, 6, 8]);
const PASSABLE = new Set([0, 1, 2, 4, 7]);

function faceToward(bx, bz, cx, cz) {
  const dx = cx - bx;
  const dz = cz - bz;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 2 : 0;
}

class MinHeap {
  constructor() { this.a = []; }
  push(k, p) {
    const a = this.a;
    a.push([p, k]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

/** Dijkstra desde caminos/plaza hasta cada destino; devuelve las celdas de sendero (generador: cede). */
function* routePaths(G, H, targets) {
  const n = G.n;
  const N = n * n;
  // Alturas y agua precalculadas (los datos ya están en el mapa de alturas)
  const gA = new Int16Array(N);
  const wA = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (H.k[i] === 1) { gA[i] = H.gA[i]; wA[i] = H.wA[i]; } else gA[i] = H.fallback;
  }
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  for (let i = 0; i < N; i++) {
    const c = G.c[i];
    if (c === 1 || c === 2) { dist[i] = 0; heap.push(i, 0); }
  }
  const targetSet = new Set(targets.filter((t) => G.in(t.x, t.z)).map((t) => G.i(t.x, t.z)));
  let remaining = targetSet.size;
  let work = 0;
  while (heap.size && remaining > 0) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    if (targetSet.has(i)) remaining--;
    if (++work % 1500 === 0) yield;
    const x = i % n;
    const gi = gA[i];
    for (let k = 0; k < 4; k++) {
      let j;
      if (k === 0) { if (x + 1 >= n) continue; j = i + 1; }
      else if (k === 1) { if (x === 0) continue; j = i - 1; }
      else if (k === 2) { j = i + n; if (j >= N) continue; }
      else { j = i - n; if (j < 0) continue; }
      const cj = G.c[j];
      if (!PASSABLE.has(cj) && !targetSet.has(j)) continue;
      const dh = Math.abs(gA[j] - gi);
      const cost = 1 + (dh > 1 ? 3 * dh : 0) + (wA[j] ? 6 : 0) + (cj === 4 ? 0.3 : 0);
      const nd = d + cost;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(j, nd); }
    }
  }
  const cells = [];
  for (const t of targetSet) {
    if (!Number.isFinite(dist[t])) continue;
    let i = t;
    let guard = 0;
    while (i >= 0 && G.c[i] !== 1 && G.c[i] !== 2 && guard++ < 600) {
      if (G.c[i] !== 7) { G.c[i] = 7; cells.push(i); }
      i = prev[i];
    }
  }
  return cells.map((i) => ({ x: G.x0 + (i % n), z: G.z0 + Math.floor(i / n) }));
}

/**
 * Planifica todo el asentamiento y genera las operaciones de construcción.
 * Devuelve el trazado L con la información que necesitan los scripts.
 */
function* planAll(s, cul, realm, H, G, plan, rng) {
  const K = KINDS[s.kind] ?? KINDS.aldea;
  const R = s.radius;
  const cx = s.center.x;
  const cz = s.center.z;
  const fountain = s.kind === 'ciudad' || s.kind === 'capital' || ['orcish', 'beast', 'elven', 'draconic', 'infernal'].includes(cul.arch);
  const pr = fountain ? Math.max(K.plaza, 7) : K.plaza;
  const walled = !!K.walls;
  const Rw = walled ? R - 17 : 0;
  const wool = realm?.colors?.wool ?? ['red', 'yellow'];
  const ctxBase = { cul, rng, plan, wool, kind: s.kind };
  const L = { items: [], gates: [], patrol: [], fields: [], lamps: [], shops: [], houses: [], targets: [], guardSpots: [], walls: null };

  // Fuera del círculo
  for (let z = G.z0; z < G.z0 + G.n; z++) for (let x = G.x0; x < G.x0 + G.n; x++) {
    if ((x - cx) ** 2 + (z - cz) ** 2 > (R + 2) ** 2) G.set(x, z, 8);
  }
  // Reservas (Gremio, parcelas familiares, casas antiguas)
  for (const r of s.reserved ?? []) {
    G.rect(r.x1 - 1, r.z1 - 1, r.x2 + 1, r.z2 + 1, 4, new Set([0]));
    G.rect(r.x1, r.z1, r.x2, r.z2, 6);
    if (r.door) L.targets.push({ x: r.door.x, z: r.door.z });
  }

  /* ---------- Plaza ---------- */
  const plazaCells = [];
  for (let dz = -pr; dz <= pr; dz++) for (let dx = -pr; dx <= pr; dx++) {
    if (dx * dx + dz * dz <= (pr + 0.5) ** 2) plazaCells.push([cx + dx, cz + dz]);
  }
  const py = median(plazaCells.filter((_, i) => i % 3 === 0).map(([x, z]) => H.g(x, z))) + 1;
  const found = C.pal(cul.pal.found, rng);
  const plazaB = cul.pal.plaza ?? ['stone_bricks'];
  for (let dz = -pr; dz <= pr; dz++) {
    const hw = Math.floor(Math.sqrt(Math.max(0, (pr + 0.5) ** 2 - dz * dz)));
    const z = cz + dz;
    let maxT = py - 1;
    let minG = py - 1;
    for (let x = cx - hw; x <= cx + hw; x++) {
      maxT = Math.max(maxT, H.t(x, z));
      minG = Math.min(minG, H.g(x, z));
    }
    if (maxT >= py) plan.fillW(cx - hw, py, z, cx + hw, Math.min(maxT + 1, py + 40), z, 'air');
    if (minG < py - 2) {
      plan.fillW(cx - hw, Math.max(minG, py - 14), z, cx + hw, py - 2, z, found, 'replace air');
      plan.fillW(cx - hw, Math.max(minG, py - 14), z, cx + hw, py - 2, z, found, 'replace water');
    }
    plan.fillW(cx - hw, py - 1, z, cx + hw, py - 1, z, plazaB[0]);
  }
  for (const [x, z] of plazaCells) {
    G.set(x, z, 2);
    if (rng() < 0.22) plan.setW(x, py - 1, z, C.pal(plazaB, rng));
  }
  for (const [x, z] of plazaCells) H.level(x, z, x, z, py - 1);
  // re-marcar fuera del círculo de la plaza como libre pero con suelo real
  for (let dz = -pr; dz <= pr; dz++) for (let dx = -pr; dx <= pr; dx++) {
    if (dx * dx + dz * dz > (pr + 0.5) ** 2 && G.get(cx + dx, cz + dz) === 0) G.set(cx + dx, cz + dz, 4);
  }
  // Pieza central: pozo o fuente
  if (fountain) S.buildFountain(plan, cul, cx, py, cz, rng, wool);
  else S.buildWell(plan, cul, cx, py, cz, rng);
  // Picota (cepo) en una diagonal, mirando al centro
  const k = pr - 3;
  const quad = pickR(rng, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  const sx = cx + quad[0] * k;
  const sz = cz + quad[1] * k;
  const stocksFace = quad[0] > 0 ? 'W' : 'E';
  const stocks = S.buildStocks(plan, cul, sx, py, sz, rng, stocksFace);
  // Farolas y bancos en las otras diagonales
  const lo = Math.round((pr - 1) * 0.72);
  for (const q of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (q[0] === quad[0] && q[1] === quad[1]) continue;
    S.lampPost(plan, cul, cx + q[0] * lo, py, cz + q[1] * lo, rng);
    const bx = cx + q[0] * (pr - 2);
    const bz = cz + q[1] * (pr - 3);
    plan.setW(bx, py, bz, S.stair(C.pal(cul.pal.roof, rng).stair, q[1] > 0 ? 'S' : 'N'));
  }
  L.plaza = { x: cx + 0.5, y: py, z: cz + 0.5 };
  L.plazaY = py;
  L.stocks = stocks;
  L.guardSpots.push({ x: cx + 2.5, y: py, z: cz + 0.5 }, { x: cx - 1.5, y: py, z: cz + 2.5 });

  /* ---------- Caminos principales ---------- */
  let dirs = ['N', 'E', 'S', 'W'];
  if (s.kind === 'inicio') dirs = ['N', 'E', 'W'];
  else if (K.roads === 2) dirs = rng() < 0.5 ? ['N', 'S'] : ['E', 'W'];
  else if (K.roads === 3) {
    const drop = pickR(rng, dirs);
    dirs = dirs.filter((d) => d !== drop);
  }
  const roadB = cul.pal.road ?? ['gravel'];
  const roadEnd = walled ? Rw + 4 : R - 1;
  for (const dname of dirs) {
    const [ux, uz] = S.DVEC[dname];
    const [px, pz] = [Math.abs(uz), Math.abs(ux)];
    let last = null;
    for (let t = pr + 1; t <= roadEnd; t++) {
      const bx = cx + ux * t;
      const bz = cz + uz * t;
      const c0 = G.get(bx, bz);
      if (c0 === 6 || c0 === 3 || c0 === 255 || c0 === 8) break;
      for (let o = -1; o <= 1; o++) {
        const x = bx + px * o;
        const z = bz + pz * o;
        const c = G.get(x, z);
        if (c !== 0 && c !== 4) continue;
        G.set(x, z, 1);
        const col = H.at(x, z);
        const blk = rng() < 0.6 ? roadB[0] : C.pal(roadB, rng);
        if (col.w) plan.setW(x, col.t, z, found);
        else {
          if (col.t > col.g) plan.fillW(x, col.g + 1, z, x, Math.min(col.t, col.g + 30), z, 'air');
          plan.setW(x, col.g, z, blk);
        }
      }
      last = { x: bx, z: bz, t };
    }
    if (last && last.t >= roadEnd - 2) {
      const gy = H.g(last.x, last.z) + 1;
      L.gates.push({ x: last.x + 0.5, y: gy, z: last.z + 0.5, dir: dname });
    }
  }
  yield;

  /* ---------- Murallas (ciudades y capitales) ---------- */
  if (walled) {
    for (let t = -Rw; t <= Rw; t++) {
      for (const [x, z] of [[cx + t, cz - Rw], [cx + t, cz + Rw], [cx - Rw, cz + t], [cx + Rw, cz + t]]) {
        const c = G.get(x, z);
        if (c === 1) continue;
        G.set(x, z, 5);
      }
    }
    G.rect(cx - Rw - 1, cz - Rw - 1, cx + Rw + 1, cz + Rw + 1, 4, new Set([0]));
    G.rect(cx - Rw + 1, cz - Rw + 1, cx + Rw - 1, cz + Rw - 1, 0, new Set([4]));
  }

  /* ---------- Edificios ---------- */
  // Barrio noble: en la diagonal opuesta a la puerta principal (entre dos caminos)
  const thetaN = ({ N: Math.PI / 2, S: -Math.PI / 2, E: Math.PI, W: 0 }[dirs[0]] ?? rng() * Math.PI * 2) + (rng() < 0.5 ? 1 : -1) * (Math.PI / 4);
  const big = s.kind === 'ciudad' || s.kind === 'capital';
  const inBounds = (x1, z1, x2, z2, type) => {
    for (const [x, z] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
      if ((x - cx) ** 2 + (z - cz) ** 2 > (R - 1) ** 2) return false;
    }
    if (!walled) return true;
    if (type === 'farm') return x1 > cx + Rw + 3 || x2 < cx - Rw - 3 || z1 > cz + Rw + 3 || z2 < cz - Rw - 3;
    return x1 >= cx - Rw + 3 && x2 <= cx + Rw - 3 && z1 >= cz - Rw + 3 && z2 <= cz + Rw - 3;
  };
  const fixed = Array.isArray(s.layout) ? s.layout : null;
  const placed = [];
  const skipped = [];
  const IMPORTANT = new Set(['keep', 'market', 'tavern', 'smithy', 'temple', 'jail', 'barracks', 'manor']);
  const tryPlace = (type, extra = {}) => {
    const [w, d] = S.sizeOf(type, cul, rng, walled && type === 'farm' ? { ...extra, small: true } : extra);
    const lim = walled ? Rw - 4 : R;
    let best = null;
    const passes = IMPORTANT.has(type) ? 3 : 2;
    for (let pass = 0; pass < passes && !(best && best.spread <= 10); pass++) {
      let zone;
      if (type === 'market' && pass === 0) zone = [pr + 3 + Math.max(w, d) / 2, pr + 8 + Math.max(w, d) / 2];
      else if (walled && type === 'farm') zone = [Rw + 4 + Math.min(w, d) / 2, R - 2 - Math.min(w, d) / 2];
      else if (pass === 0) {
        const z = ZONE[type] ?? [0.3, 0.85];
        zone = [Math.max(pr + 4, z[0] * lim), Math.max(pr + 6, z[1] * lim)];
      } else zone = [pr + 4 + Math.min(w, d) / 2, lim * 0.95];
      const tol = type === 'keep' || type === 'temple' || type === 'manor' ? 5 : 3;
      for (let a = 0; a < 100; a++) {
        const dist = zone[0] + rng() * Math.max(1, zone[1] - zone[0]);
        let ang;
        if (pass === 2) ang = rng() * Math.PI * 2;
        else if (type === 'keep') ang = thetaN + (rng() - 0.5) * (pass ? 1.4 : 0.6);
        else if (type === 'manor' && big && pass === 0) ang = thetaN + (rng() - 0.5) * 2.4;
        else if (type === 'shack' && big && pass === 0) ang = thetaN + Math.PI + (rng() - 0.5) * 2.8;
        else ang = rng() * Math.PI * 2;
        const bx = Math.round(cx + Math.cos(ang) * dist);
        const bz = Math.round(cz + Math.sin(ang) * dist);
        const r = faceToward(bx, bz, cx, cz);
        const WX = r & 1 ? d : w;
        const WZ = r & 1 ? w : d;
        const x1 = bx - (WX >> 1);
        const z1 = bz - (WZ >> 1);
        const x2 = x1 + WX - 1;
        const z2 = z1 + WZ - 1;
        if (!inBounds(x1 - 1, z1 - 1, x2 + 1, z2 + 1, type)) continue;
        if (!G.free(x1 - 2, z1 - 2, x2 + 2, z2 + 2, FORBID_BUILD)) continue;
        const pts = [[x1, z1], [x2, z1], [x1, z2], [x2, z2], [bx, bz]];
        if (pts.some(([x, z]) => H.water(x, z))) continue;
        const hs = pts.map(([x, z]) => H.g(x, z));
        const spread = Math.max(...hs) - Math.min(...hs);
        const cand = { type, w, d, r, x0: x1, z0: z1, x2, z2, y0: median(hs) + 1, spread, extra };
        if (spread <= tol) { best = cand; break; }
        if (!best || spread < best.spread) best = cand;
      }
    }
    if (!best || best.spread > 10) {
      skipped.push(type);
      return null;
    }
    return commit(best);
  };
  const commit = (b) => {
    G.rect(b.x0 - 1, b.z0 - 1, b.x2 + 1, b.z2 + 1, 4);
    G.rect(b.x0, b.z0, b.x2, b.z2, 3);
    placed.push(b);
    return b;
  };
  if (fixed) {
    for (const f of fixed) {
      const [type, x0, z0, w, d, r, y0, extra] = f;
      const WX = r & 1 ? d : w;
      const WZ = r & 1 ? w : d;
      commit({ type, w, d, r, x0, z0, x2: x0 + WX - 1, z2: z0 + WZ - 1, y0, extra: extra ?? {} });
    }
  } else {
    for (const [type, cnt, extra] of PROGRAM[s.kind] ?? PROGRAM.aldea) {
      let n = 0;
      if (Array.isArray(cnt)) n = irand(rng, cnt[0], cnt[1]);
      else if (cnt < 1) n = rng() < cnt ? 1 : 0;
      else n = cnt;
      for (let i = 0; i < n; i++) {
        const b = tryPlace(type, extra ?? {});
        if (!b && (type === 'keep' || type === 'jail')) tryPlace(type, { ...(extra ?? {}), cells: 2, small: true });
      }
      yield;
    }
    s.layout = placed.map((b) => [b.type, b.x0, b.z0, b.w, b.d, b.r, b.y0, b.extra]);
    if (skipped.length) s.skipped = skipped;
    wDirty();
  }

  // Construir cada edificio: nivelación + estructura
  let hn = 0;
  for (const b of placed) {
    const WX = b.r & 1 ? b.d : b.w;
    const WZ = b.r & 1 ? b.w : b.d;
    prepSite(plan, H, b.x0, b.z0, b.x0 + WX - 1, b.z0 + WZ - 1, b.y0, cul, rng, b.type);
    const cv = new S.Canvas(plan, b.x0, b.y0, b.z0, b.w, b.d, b.r);
    const cls = CLASS_OF[b.type] ?? 'media';
    const ctx = { ...ctxBase, cls, cells: b.extra?.cells };
    if (b.type === 'shack' || b.type === 'house' || b.type === 'manor') ctx.houseId = 'h' + ++hn;
    let inf;
    try {
      inf = (S.BUILDERS[b.type] ?? S.BUILDERS.house)(cv, ctx) ?? {};
    } catch (e) {
      warn('Error al planificar ' + b.type, e);
      inf = {};
    }
    b.info = inf;
    b.cls = cls;
    b.houseId = ctx.houseId;
    if (inf.doorOut) L.targets.push({ x: inf.doorOut.x, z: inf.doorOut.z });
    if (ctx.houseId) {
      const box = cv.box(-1, Math.max(4, inf.top ?? 8));
      L.houses.push({ id: ctx.houseId, cls, door: inf.door, min: box.min, max: box.max, owner: null, home: inf.inside, type: b.type });
    }
    if (b.type === 'market' && inf.shop) L.shops.push({ kind: 'market', at: inf.shop, wp: inf.wp });
    if (b.type === 'smithy' && inf.shop) L.shops.push({ kind: 'forge', at: inf.shop, wp: inf.wp });
    if (b.type === 'tavern' && inf.shop) L.shops.push({ kind: 'tavern', at: inf.shop, wp: inf.wp, work: inf.work });
    if (b.type === 'temple' && inf.shop) L.shops.push({ kind: 'temple', at: inf.shop, wp: inf.wp });
    if (b.type === 'farm' && inf.wp) L.fields.push(inf.wp);
    if (b.type === 'jail' && inf.jail) L.jail = inf.jail;
    if (b.type === 'keep') { L.throne = inf.throne; L.keep = inf; for (const g of inf.guards ?? []) L.guardSpots.push(g); }
    if (b.type === 'barracks') { L.barracks = inf.wp; for (const g of inf.guards ?? []) L.guardSpots.push(g); }
    if (b.type === 'tower' && inf.wp) L.guardSpots.push(inf.wp);
    yield;
  }

  /* ---------- Murallas: construcción ---------- */
  if (walled) {
    L.walls = buildWalls(plan, H, G, cul, rng, cx, cz, Rw, K.wallH ?? 6, wool, L, ctxBase);
    yield;
  }

  /* ---------- Farolas a lo largo de los caminos ---------- */
  for (const dname of dirs) {
    const [ux, uz] = S.DVEC[dname];
    const [px, pz] = [Math.abs(uz), Math.abs(ux)];
    for (let t = pr + 4, side = 1; t < roadEnd - 1; t += 7, side = -side) {
      const x = cx + ux * t + px * 2 * side;
      const z = cz + uz * t + pz * 2 * side;
      if (G.get(x, z) !== 0 && G.get(x, z) !== 4) continue;
      G.set(x, z, 3);
      const col = H.at(x, z);
      if (col.w) continue;
      if (col.t > col.g) plan.fillW(x, col.g + 1, z, x, Math.min(col.t, col.g + 30), z, 'air');
      S.lampPost(plan, cul, x, col.g + 1, z, rng);
      L.lamps.push({ x, z });
    }
  }

  /* ---------- Árboles decorativos ---------- */
  const treeN = { elven: 12, fairy: 10, beast: 7, timber: 5, gothic: 4 }[cul.arch] ?? 3;
  const leaves = C.pal(cul.pal.leaves ?? ['oak_leaves ["persistent_bit"=true]'], rng);
  const logs = { elven: 'birch_log', fairy: 'birch_log', beast: 'jungle_log', gothic: 'dark_oak_log', infernal: 'crimson_stem', draconic: 'acacia_log', orcish: 'spruce_log', dwarven: 'spruce_log', celestial: 'cherry_log' }[cul.arch] ?? 'oak_log';
  const treeLeaves = cul.arch === 'infernal' ? 'nether_wart_block' : cul.arch === 'celestial' ? 'cherry_leaves ["persistent_bit"=true]' : leaves;
  for (let i = 0, tries = 0; i < treeN * (big ? 2 : 1) && tries < 200; tries++) {
    const ang = rng() * Math.PI * 2;
    const dd = pr + 5 + rng() * (R - pr - 7);
    const x = Math.round(cx + Math.cos(ang) * dd);
    const z = Math.round(cz + Math.sin(ang) * dd);
    if (!G.free(x - 1, z - 1, x + 1, z + 1, new Set([1, 2, 3, 4, 5, 6, 7, 8]))) continue;
    if (H.water(x, z)) continue;
    G.set(x, z, 3);
    const col = H.at(x, z);
    S.smallTree(plan, x, col.g + 1, z, logs, treeLeaves, rng);
    i++;
  }

  /* ---------- Puntos de patrulla ---------- */
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + (i * Math.PI) / 2;
    const dd = walled ? Rw - 4 : R * 0.78;
    let px = Math.round(cx + Math.cos(ang) * dd);
    let pz = Math.round(cz + Math.sin(ang) * dd);
    let found2 = false;
    for (let rr = 0; rr < 8 && !found2; rr++) {
      for (let dz = -rr; dz <= rr && !found2; dz++) for (let dx = -rr; dx <= rr && !found2; dx++) {
        const c = G.get(px + dx, pz + dz);
        if (c === 0 || c === 1 || c === 7 || c === 4) { px += dx; pz += dz; found2 = true; }
      }
    }
    L.patrol.push({ x: px + 0.5, y: H.g(px, pz) + 1, z: pz + 0.5 });
    L.targets.push({ x: px, z: pz });
  }
  yield;

  /* ---------- Senderos (Dijkstra) ---------- */
  const pathCells = yield* routePaths(G, H, L.targets);
  const pathB = cul.pal.path ?? ['grass_path'];
  for (const { x, z } of pathCells) {
    const col = H.at(x, z);
    const blk = rng() < 0.7 ? pathB[0] : C.pal(pathB, rng);
    if (col.w) { plan.setW(x, col.t, z, C.pal(cul.pal.floor ?? 'oak_planks', rng)); continue; }
    if (col.t > col.g) plan.fillW(x, col.g + 1, z, x, Math.min(col.t, col.g + 30), z, 'air');
    plan.setW(x, col.g, z, blk);
  }
  yield;

  /* ---------- Decoración junto a los senderos ---------- */
  const deco = cul.pal.deco ?? ['barrel'];
  const flowers = cul.pal.flowers ?? ['poppy'];
  let decoN = Math.round(R / 3);
  for (let tries = 0; decoN > 0 && tries < 300 && pathCells.length; tries++) {
    const p = pathCells[Math.floor(rng() * pathCells.length)];
    const [dx, dz] = pickR(rng, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
    const x = p.x + dx;
    const z = p.z + dz;
    if (G.get(x, z) !== 0) continue;
    const col = H.at(x, z);
    if (col.w || col.t > col.g + 1) continue;
    G.set(x, z, 3);
    decoN--;
    const r = rng();
    if (r < 0.45) {
      if (col.soil) plan.setW(x, col.g + 1, z, C.pal(flowers, rng));
    }
    else if (r < 0.8) {
      const b = C.pal(deco, rng);
      if (b === 'skeleton_skull') plan.setW(x, col.g + 1, z, 'skeleton_skull ["facing_direction"=1]');
      else if (b === 'lantern' || b === 'soul_lantern') plan.setW(x, col.g + 1, z, S.standLantern(b));
      else if (b.endsWith('_log')) plan.setW(x, col.g + 1, z, S.axis(b, 'x'));
      else if (b === 'anvil') plan.setW(x, col.g + 1, z, S.card('anvil', 'N'));
      else plan.setW(x, col.g + 1, z, b);
    } else plan.setW(x, col.g + 1, z, S.stair(C.pal(cul.pal.roof, rng).stair, pickR(rng, ['N', 'S', 'E', 'W'])));
  }

  // Edificios en L
  L.items = placed;
  return L;
}

/** Nivela el solar: tala, cimientos y delantal. */
function prepSite(plan, H, x1, z1, x2, z2, y0, cul, rng, type) {
  let maxT = y0;
  let minG = y0 - 1;
  for (let z = z1 - 1; z <= z2 + 1; z++) for (let x = x1 - 1; x <= x2 + 1; x++) {
    const c = H.at(x, z);
    if (c.unknown) continue;
    maxT = Math.max(maxT, c.t);
    minG = Math.min(minG, c.g);
  }
  const top = Math.min(maxT + 2, y0 + 45);
  if (top >= y0) plan.fillW(x1 - 1, y0, z1 - 1, x2 + 1, top, z2 + 1, 'air');
  const found = C.pal(cul.pal.found, rng);
  if (minG < y0 - 2) {
    const lo = Math.max(minG, y0 - 16);
    plan.fillW(x1 - 1, lo, z1 - 1, x2 + 1, y0 - 2, z2 + 1, found, 'replace air');
    plan.fillW(x1 - 1, lo, z1 - 1, x2 + 1, y0 - 2, z2 + 1, found, 'replace water');
    plan.fillW(x1 - 1, lo, z1 - 1, x2 + 1, y0 - 2, z2 + 1, found, 'replace flowing_water');
  }
  const apron = C.pal(cul.pal.apron ?? ['grass_block'], rng);
  plan.fillW(x1 - 1, y0 - 1, z1 - 1, x2 + 1, y0 - 1, z2 + 1, type === 'farm' ? 'dirt' : apron);
  H.level(x1 - 1, z1 - 1, x2 + 1, z2 + 1, y0 - 1);
}

/** Murallas cuadradas con torres en las esquinas y torres de puerta. */
function buildWalls(plan, H, G, cul, rng, cx, cz, Rw, Hw, wool, L, ctxBase) {
  const style = cul.walls ?? 'stone';
  const def = C.pal(cul.pal.defense, rng);
  const topB = C.pal(cul.pal.defenseTop, rng);
  const height = style === 'hedge' ? 4 : Hw;
  const gateSet = new Set();
  for (const g of L.gates) {
    const gx = Math.floor(g.x);
    const gz = Math.floor(g.z);
    // La puerta está donde el camino cruza la muralla
    const [ux, uz] = S.DVEC[g.dir];
    const wx = cx + ux * Rw;
    const wz = cz + uz * Rw;
    for (let o = -1; o <= 1; o++) gateSet.add(`${wx + Math.abs(uz) * o},${wz + Math.abs(ux) * o}`);
    g.wall = { x: wx, z: wz };
    void gx; void gz;
  }
  const cells = [];
  for (let t = -Rw; t <= Rw; t++) {
    cells.push([cx + t, cz - Rw], [cx + t, cz + Rw]);
    if (t > -Rw && t < Rw) cells.push([cx - Rw, cz + t], [cx + Rw, cz + t]);
  }
  for (const [x, z] of cells) {
    const col = H.at(x, z);
    const g = col.w ? col.t : col.g;
    const gate = gateSet.has(`${x},${z}`);
    const y1 = Math.max(g - 3, col.g - 12);
    if (gate) {
      // Arco de la puerta: solo dintel y rastrillo
      plan.fillW(x, g + 1, z, x, g + 4, z, 'air');
      plan.fillW(x, g + 5, z, x, g + height, z, style === 'hedge' ? def : style === 'palisade' ? S.axis(def, 'y') : def);
      plan.setW(x, g + 4, z, style === 'hedge' ? 'air' : 'iron_bars');
      continue;
    }
    if (style === 'palisade') {
      plan.fillW(x, y1, z, x, g + height - 1, z, S.axis(def, 'y'));
      if ((x + z) % 2 === 0) plan.setW(x, g + height, z, topB);
    } else if (style === 'hedge') {
      plan.fillW(x, y1, z, x, g, z, 'dirt');
      plan.fillW(x, g + 1, z, x, g + height - 1, z, def);
      if ((x + z) % 3 === 0) plan.setW(x, g + height, z, topB);
    } else {
      if (col.t > g + height) plan.fillW(x, g + height + 1, z, x, Math.min(col.t, g + 40), z, 'air');
      plan.fillW(x, y1, z, x, g + height - 1, z, def);
      if ((x + z) % 2 === 0) plan.setW(x, g + height, z, topB);
    }
  }
  // Torres: esquinas y a ambos lados de cada puerta
  const towers = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) towers.push({ x: cx + sx * Rw, z: cz + sz * Rw });
  for (const g of L.gates) {
    const [ux, uz] = S.DVEC[g.dir];
    for (const o of [-4, 4]) towers.push({ x: g.wall.x + Math.abs(uz) * o, z: g.wall.z + Math.abs(ux) * o, gate: true });
  }
  for (const t of towers) {
    const x1 = t.x - 2;
    const z1 = t.z - 2;
    const hs = [H.g(x1, z1), H.g(x1 + 4, z1), H.g(x1, z1 + 4), H.g(x1 + 4, z1 + 4), H.g(t.x, t.z)];
    const y0 = median(hs) + 1;
    G.rect(x1, z1, x1 + 4, z1 + 4, 3);
    prepSite(plan, H, x1, z1, x1 + 4, z1 + 4, y0, cul, rng, 'tower');
    const r = faceToward(t.x, t.z, cx, cz);
    const cv = new S.Canvas(plan, x1, y0, z1, 5, 5, r);
    const ctx = { ...ctxBase, cls: 'media' };
    try {
      const inf = S.buildTower(cv, ctx, { H: height + 4 });
      if (inf?.doorOut) L.targets.push({ x: inf.doorOut.x, z: inf.doorOut.z });
      if (t.gate && inf?.wp) L.guardSpots.push(inf.wp);
    } catch (e) { warn('torre', e); }
  }
  // Puntos de guardia en cada puerta (por dentro)
  for (const g of L.gates) {
    const [ux, uz] = S.DVEC[g.dir];
    const ix = g.wall.x - ux * 2;
    const iz = g.wall.z - uz * 2;
    L.guardSpots.push({ x: ix + 0.5, y: H.g(ix, iz) + 1, z: iz + 0.5 });
    // La "puerta" (waypoint) queda fuera de la muralla
    const ox = g.wall.x + ux * 2;
    const oz = g.wall.z + uz * 2;
    g.x = ox + 0.5;
    g.z = oz + 0.5;
    g.y = H.g(ox, oz) + 1;
    const fl = { x: g.wall.x + Math.abs(uz) * 2, z: g.wall.z + Math.abs(ux) * 2 };
    void fl;
  }
  return { Rw, height, style, towers: towers.length };
}

/* ================================================================== */
/* Construcción completa                                                */
/* ================================================================== */

let active = null; // { id, phase, done, total, t0 }
const queue = [];
const rejected = [];

export function isBuilding() { return !!active; }

export function constructionStatus() {
  if (!active) return '§7No hay obras en curso.';
  const s = getSettlement(active.id);
  const pct = active.total ? Math.floor(((active.done ?? 0) * 100) / active.total) : 0;
  return `§eObras: §f${s?.name ?? active.id}§e (${s ? kindLabel(s) : '?'}) · fase ${active.phase} · ${pct}%`;
}

function* buildJob(s, dim) {
  const cul = C.cultureOf(s.culture);
  const realm = getRealm(s.realmId);
  const rng = seeded(s.seed || hash(s.id));
  const G = new Grid(s.center.x, s.center.z, s.radius + 6);
  const H = new HMap(dim, G);
  active.phase = 'medición';
  const N = G.n * G.n;
  const R2 = (s.radius + 6) ** 2;
  for (let i = 0; i < N; i++) {
    const dx = (i % G.n) - (s.radius + 6);
    const dz = Math.floor(i / G.n) - (s.radius + 6);
    if (dx * dx + dz * dz > R2) continue;
    H.probeIdx(i);
    if (i % 16 === 0) yield;
  }
  H.fallback = median([H.g(s.center.x, s.center.z)]);
  active.phase = 'trazado';
  const plan = new S.Plan(rng);
  const L = yield* planAll(s, cul, realm, H, G, plan, rng);
  active.phase = 'obras';
  active.total = plan.ops.length;
  active.done = 0;
  yield* S.execOps(dim, plan.ops, active);
  active.phase = 'población';
  yield* finishSettlement(s, L, plan, dim, rng);
}

/** Lanza la construcción de un asentamiento ya registrado (preArea: zona ya cargada a reutilizar). */
async function construct(s, preArea) {
  if (active) { if (preArea) try { releaseArea(world.getDimension(s.dim), preArea); } catch {} return false; }
  active = { id: s.id, phase: 'carga', t0: system.currentTick };
  let area = preArea;
  let dim;
  try {
    dim = world.getDimension(s.dim);
    if (!area) area = await loadArea(dim, s.center, s.radius + 8, 'rpg_' + s.id);
    const ok = await waitReadable(dim, s.center, s.radius + 4, 900);
    if (!ok) throw new Error('la zona no se cargó a tiempo');
    await runJobAsync(() => buildJob(s, dim));
    return true;
  } catch (e) {
    warn('Construcción de ' + s.name + ' interrumpida', e);
    s.failed = (s.failed ?? 0) + 1;
    if (s.failed >= 3 && s.kind !== 'inicio') forgetSettlement(s);
    wDirty();
    return false;
  } finally {
    try { releaseArea(dim, area); } catch {}
    active = null;
  }
}

function forgetSettlement(s) {
  const w = reg();
  w.settlements = w.settlements.filter((x) => x !== s);
  for (const r of w.realms) if (r.capitalId === s.id) r.capitalId = null;
  clearRoster(s.id);
  wDirty();
}

/** Busca un buen solar cerca de (sx, sz), lo registra y lo construye. */
async function generateAt(dim, sx, sz, force = {}) {
  if (active) return false;
  const w = reg();
  const spacingCap = cfgv('capitalSpacing', 900);
  const seed = hash(`set:${sx},${sz}:${w.setCount ?? 0}:${system.currentTick}`);
  const rng = seeded(seed);
  let realm = force.realmId ? getRealm(force.realmId) : realmNear({ x: sx, z: sz }, spacingCap);
  let kind = force.kind;
  if (!kind) {
    if (!realm) kind = 'capital';
    else if (!realm.capitalId && !capitalWithin({ x: sx, z: sz }, spacingCap) && dist2D(realmSeat(realm), { x: sx, z: sz }) > 220) kind = 'capital';
    else kind = C.weightedR({ aldea: 50, pueblo: 35, ciudad: 15 }, rng);
  }
  if (kind === 'capital' && capitalWithin({ x: sx, z: sz }, spacingCap) && !force.kind) kind = 'ciudad';
  const K = KINDS[kind] ?? KINDS.aldea;
  const radius = irand(rng, K.r[0], K.r[1]);
  active = { id: 'candidato', phase: 'exploración', t0: system.currentTick };
  let area;
  let handed;
  let s;
  try {
    area = await loadArea(dim, { x: sx, z: sz }, radius + 18, 'rpg_cand');
    const ready = await waitReadable(dim, { x: sx, z: sz }, radius + 10, 900);
    if (!ready) { rejected.push({ x: sx, z: sz, t: system.currentTick }); return false; }
    // Evaluar varios centros posibles y quedarse con el mejor
    let best = null;
    const tolSpread = kind === 'aldea' ? 10 : 12;
    for (const [ox, oz] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) {
      const ev = evaluateSite(dim, sx + ox, sz + oz, radius);
      if (!ev.ready) continue;
      const score = ev.spread + ev.water * 60;
      if (!best || score < best.score) best = { ...ev, x: sx + ox, z: sz + oz, score };
    }
    if (!force.noEval && (!best || best.water > 0.12 || best.spread > tolSpread || best.median < 40 || best.median > 200)) {
      rejected.push({ x: sx, z: sz, t: system.currentTick });
      return false;
    }
    const cx = best?.x ?? sx;
    const cz = best?.z ?? sz;
    // Cultura: la del reino (a veces una minoría según el bioma) o la del bioma para un reino nuevo
    let biomeCulture;
    const votes = {};
    for (const [dx, dz] of [[0, 0], [radius / 2, 0], [-radius / 2, 0], [0, radius / 2], [0, -radius / 2]]) {
      let id;
      try { id = dim.getBiome({ x: cx + dx, y: (best?.median ?? 64) + 1, z: cz + dz })?.id; } catch {}
      for (const [c, wgt] of Object.entries(C.biomeWeights(id))) votes[c] = (votes[c] ?? 0) + wgt;
    }
    biomeCulture = C.weightedR(votes, rng);
    let culture = force.culture;
    if (!realm) {
      culture = culture ?? biomeCulture;
      realm = createRealm(culture, { x: cx, z: cz }, rng);
    } else if (!culture) {
      culture = realm.culture;
      if (kind !== 'capital' && biomeCulture !== realm.culture && rng() < 0.18 && (realm.attitudes?.[biomeCulture] ?? 0) >= 0.15) culture = biomeCulture;
    }
    s = newSettlement({ kind, culture, name: C.townName(culture, rng), realm, center: { x: cx, y: (best?.median ?? 64) + 1, z: cz }, radius, seed, dim: dim.id });
    if (kind === 'capital') realm.capitalId = s.id;
    wDirty();
    // La zona del candidato (radio + 18, desplazamiento ≤ 10) cubre la obra: se reutiliza.
    handed = area;
    area = undefined;
  } catch (e) {
    warn('Generación de asentamiento', e);
    return false;
  } finally {
    try { releaseArea(dim, area); } catch {}
    active = null;
  }
  return construct(s, handed);
}

/** Pone en marcha la siguiente obra pendiente (cola o asentamientos sin terminar). */
function kick() {
  if (active) return;
  let s;
  while (queue.length && !s) {
    const c = getSettlement(queue.shift());
    if (c && !c.built) s = c;
  }
  if (!s) {
    // Reanudar obras interrumpidas (p. ej. al cerrar el mundo) cuando haya un jugador cerca
    for (const c of reg().settlements) {
      if (c.built || (c.failed ?? 0) >= 3) continue;
      const near = world.getAllPlayers().some((p) => { try { return p.dimension.id === c.dim && dist2D(p.location, c.center) < 400; } catch { return false; } });
      if (near) { s = c; break; }
    }
  }
  if (s) construct(s);
}

/* ================================================================== */
/* Población                                                            */
/* ================================================================== */

function wallet(rng, cls, prosperity = 1) {
  const [a, b] = cls === 'alta' ? [80, 300] : cls === 'baja' ? [2, 15] : [15, 60];
  return Math.round(irand(rng, a, b) * prosperity);
}

function makeIdent(o) {
  let ident;
  try {
    ident = npc.makeIdentity({ ...o, role: o.role ?? o.job });
  } catch (e) {
    warn('makeIdentity', e);
    return undefined;
  }
  if (!ident) return undefined;
  for (const k of ['settlement', 'realm', 'cls', 'job', 'wallet', 'homeId', 'title', 'hat']) {
    if (o[k] !== undefined && ident[k] === undefined) ident[k] = o[k];
  }
  if (!ident.role) ident.role = o.job;
  return ident;
}

function spawnResident(dim, pos, ident, s) {
  let e;
  try { e = npc.spawnNpc(dim, pos, ident); } catch (err) { warn('spawnNpc', err); }
  if (!e) return undefined;
  try {
    e.addTag('rpg_set_' + s.id);
    e.addTag('rpg_job_' + (ident.job ?? ident.role));
  } catch {}
  if (ident.job === 'rey') {
    system.runTimeout(() => {
      try { if (e.isValid) e.setProperty('rpg:hat', 5); } catch {}
    }, 6);
  }
  return e;
}

let wpFail = 0;
let wpPauseUntil = 0;

function spawnWaypoint(dim, s, idx, kind, pos) {
  if (!pos || system.currentTick < wpPauseUntil) return undefined;
  let e;
  const loc = { x: pos.x, y: pos.y, z: pos.z };
  try {
    e = dim.spawnEntity(`${WP_TYPE}<rpg:wp_${kind}>`, loc);
  } catch {
    try {
      e = dim.spawnEntity(WP_TYPE, loc);
      e.triggerEvent('rpg:wp_' + kind);
    } catch {
      // Si la entidad no existe (paquete sin actualizar), no insistir durante 5 minutos.
      if (++wpFail >= 12) { wpFail = 0; wpPauseUntil = system.currentTick + 20 * 300; warn('No se pueden crear marcadores rpg:waypoint; se reintentará más tarde'); }
      return undefined;
    }
  }
  wpFail = 0;
  try {
    e.addTag('rpg_wp');
    e.addTag('rpg_set_' + s.id);
    e.addTag('rpg_wpi_' + idx);
    e.addTag('rpg_wpk_' + kind);
  } catch {}
  return e;
}

/** Lista determinista de marcadores [tipo, posición] de un asentamiento. */
export function waypointList(s) {
  const out = [];
  if (s.plaza) out.push(['plaza', s.plaza]);
  for (const sh of s.shops ?? []) {
    const kind = { market: 'market', forge: 'forge', tavern: 'tavern', temple: 'church' }[sh.kind];
    if (kind) out.push([kind, sh.wp ?? sh.at]);
  }
  for (const f of s.fields ?? []) out.push(['field', f]);
  for (const h of s.houses ?? []) if (h.home) out.push(['home', h.home]);
  if (s.stocks) out.push(['stocks', s.stocks]);
  if (s.jail) {
    out.push(['jail', s.jail.exit]);
    out.push(['jail_patrol', s.jail.patrol]);
  }
  (s.patrol ?? []).slice(0, 4).forEach((p, i) => out.push(['patrol_' + i, p]));
  for (const g of s.gates ?? []) out.push(['gate', g]);
  return out;
}

function* finishSettlement(s, L, plan, dim, rng) {
  const realm = getRealm(s.realmId);
  const prosperity = realm?.economy?.prosperity ?? 1;
  const r3 = (p) => (p ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 } : null);
  // Registro para los demás sistemas
  s.plaza = r3(L.plaza);
  s.stocks = r3(L.stocks);
  s.jail = L.jail ? {
    cells: L.jail.cells.map((c) => ({ min: c.min, max: c.max, spawn: r3(c.spawn), door: c.door, doorBlock: c.doorBlock })),
    exit: r3(L.jail.exit), patrol: r3(L.jail.patrol),
  } : null;
  s.houses = L.houses.slice(0, 32).map((h) => ({ id: h.id, cls: h.cls, door: h.door, min: h.min, max: h.max, owner: null, home: r3(h.home) }));
  s.chests = plan.chests.slice(0, 48).map((c) => ({ x: c.x, y: c.y, z: c.z, cls: c.cls, house: c.house, kind: c.kind }));
  s.shops = L.shops.map((sh) => ({ kind: sh.kind, at: r3(sh.at), wp: r3(sh.wp) }));
  s.fields = L.fields.slice(0, 6).map(r3);
  s.gates = L.gates.map((g) => ({ x: g.x, y: g.y, z: g.z }));
  s.patrol = L.patrol.map(r3);
  s.throne = r3(L.throne);
  s.walls = !!L.walls;
  delete s.reserved;
  wDirty();
  yield;

  // Botín en los cofres
  for (const c of plan.chests) {
    try { S.fillContainer(dim, c, c.cls, s.culture, rng, Math.min(1.4, Math.max(0.6, prosperity))); } catch {}
    yield;
  }

  // Marcadores
  waypointList(s).forEach(([kind, pos], i) => spawnWaypoint(dim, s, i, kind, pos));
  yield;

  // Habitantes
  yield* populate(s, L, dim, rng, realm);
  s.built = true;
  s.builtDay = safeDay();
  delete s.layout;
  delete s.failed;
  wDirty();
  try { hooks.onBuilt?.(s); } catch (e) { warn('onBuilt', e); }
  if (s.kind === 'inicio') {
    for (const p of world.getAllPlayers()) {
      try {
        if (p.dimension.id === s.dim && dist2D(p.location, s.center) < s.radius + 60) {
          msg(p, `§6✦ ${s.name} despierta a tu alrededor: mercado, taberna, herrería, templo y guardias velan por la villa.`);
        }
      } catch {}
    }
  }
}

function* populate(s, L, dim, rng, realm) {
  const cul = C.cultureOf(s.culture);
  const K = KINDS[s.kind] ?? KINDS.aldea;
  const prosperity = realm?.economy?.prosperity ?? 1;
  const roster = [];
  const base = { settlement: s.id, realm: s.realmId };
  const pickRace = () => C.pickResidentRace(s.culture, realm?.attitudes, rng);
  const add = (o, pos, kind) => {
    if (!pos) return undefined;
    const ident = makeIdent({ ...base, ...o });
    if (!ident) return undefined;
    spawnResident(dim, pos, ident, s);
    roster.push({ i: ident, p: [pos.x, pos.y, pos.z], k: kind, h: o.homeId ?? null });
    return ident;
  };

  // Gobernante en el trono
  if (s.kind === 'capital' && L.throne && realm) {
    const ru = realm.ruler;
    const ident = add({
      race: s.culture, gender: ru.gender, name: ru.name, surname: ru.surname, job: 'rey', role: 'rey', cls: 'alta',
      wallet: irand(rng, 1000, 3000), title: ru.title, hat: 5, pers: 'serio',
    }, L.throne, 'k');
    if (ident) {
      s.rulerId = ident.id;
      ru.identId = ident.id;
    }
    yield;
  }

  // Guardias (+ carcelero)
  const spots = [...L.guardSpots];
  if (!spots.length && L.plaza) spots.push(L.plaza);
  const nGuards = K.guards + (s.kind === 'ciudad' || s.kind === 'capital' ? Math.max(0, cul.guardBonus ?? 0) : 0);
  for (let i = 0; i < nGuards; i++) {
    const pos = spots[i % spots.length];
    const race = rng() < 0.85 ? s.culture : pickRace();
    const ident = add({ race, job: 'guardia', cls: 'media', wallet: irand(rng, 10, 40) }, jitter(pos, rng), 'g');
    if (ident) s.guards.push(ident.id);
    yield;
  }
  if (L.jail) {
    const ident = add({ race: s.culture, job: 'carcelero', cls: 'media', wallet: irand(rng, 10, 40) }, L.jail.patrol, 'j');
    if (ident) s.guards.push(ident.id);
  }

  // Trabajos disponibles según los edificios
  const jobs = [];
  for (const sh of L.shops) {
    if (sh.kind === 'forge') jobs.push(['herrero', sh.at]);
    if (sh.kind === 'tavern') { jobs.push(['tabernero', sh.work ?? sh.at]); if (rng() < 0.5) jobs.push(['bardo', sh.wp ?? sh.at]); }
    if (sh.kind === 'temple') jobs.push(['sacerdote', sh.at]);
    if (sh.kind === 'market') {
      const n = s.kind === 'capital' ? 3 : s.kind === 'ciudad' ? 2 : s.kind === 'aldea' ? 1 : 2;
      for (let i = 0; i < n; i++) jobs.push(['mercader', sh.at]);
    }
  }
  for (const f of L.fields) jobs.push(['granjero', f]);

  // Casas: nobles en mansiones, trabajadores y aldeanos en casas, pobres en chozas
  let pop = 0;
  const cap = K.pop;
  const houses = [...s.houses].sort((a, b) => ({ alta: 0, media: 1, baja: 2 }[a.cls] - { alta: 0, media: 1, baja: 2 }[b.cls]));
  const slum = (h) => (s.kind === 'ciudad' || s.kind === 'capital' || s.kind === 'pueblo') && h.cls === 'baja';
  for (const h of houses) {
    if (pop >= cap) break;
    const home = h.home ?? h.door;
    const occupants = h.cls === 'alta' ? (rng() < 0.6 ? 2 : 1) : h.cls === 'media' ? irand(rng, 1, 3) : irand(rng, 1, 2);
    for (let k = 0; k < occupants && pop < cap; k++) {
      let job;
      let at = home;
      if (h.cls === 'alta') job = 'noble';
      else if (k === 0 && jobs.length && (h.cls === 'media' || rng() < 0.5)) {
        const j = jobs.shift();
        job = j[0];
      } else if (slum(h)) job = C.weightedR({ mendigo: 3, ladron: 2, aldeano: 2 }, rng);
      else job = C.pickGeneralJob(s.culture, rng);
      const child = k > 0 && h.cls !== 'alta' && rng() < 0.22;
      const ident = add({
        race: pickRace(), job: child ? 'aldeano' : job, cls: h.cls, wallet: wallet(rng, h.cls, prosperity), homeId: h.id,
        age: child ? 'child' : 'adult',
      }, jitter(at, rng, 0.6), 'r');
      if (ident) {
        s.residents.push(ident.id);
        if (!h.owner) h.owner = ident.id;
        pop++;
      }
      yield;
    }
  }
  // Trabajadores sin casa (viven en su lugar de trabajo)
  for (const [job, at] of jobs) {
    if (pop >= cap + 4) break;
    const ident = add({ race: pickRace(), job, cls: 'media', wallet: wallet(rng, 'media', prosperity) }, jitter(at, rng), 'r');
    if (ident) { s.residents.push(ident.id); pop++; }
    yield;
  }
  saveRoster(s.id, roster);
  wDirty();
}

function jitter(p, rng, amt = 1.2) {
  if (!p) return p;
  return { x: p.x + (rng() - 0.5) * amt, y: p.y, z: p.z + (rng() - 0.5) * amt };
}

/* ================================================================== */
/* Villa inicial                                                        */
/* ================================================================== */

/**
 * Asegura la villa inicial alrededor del Gremio. Devuelve true en cuanto el Gremio existe y
 * la villa está registrada (la construcción continúa en segundo plano).
 */
export function ensureStarterVillage(player) {
  const w = reg();
  if (w.starterId && w.town?.built && getSettlement(w.starterId)) return true;
  let dim;
  try { dim = player.dimension; } catch { return false; }
  if (!dim || dim.id !== OW) return false;
  if (!w.town?.built) {
    let ok = false;
    try { ok = setupGuildTown(player); } catch (e) { warn('Sede del Gremio', e); }
    if (!ok) return false;
  }
  if (!w.starterId || !getSettlement(w.starterId)) createStarter(w.town);
  try { kick(); } catch (e) { warn('kick', e); }
  return true;
}

function createStarter(town) {
  const w = reg();
  const c = town.center;
  const rng = seeded(hash(`inicio:${c.x},${c.z}`));
  const realm = createRealm('humano', c, rng, { starter: true });
  const reserved = [];
  // Sede del Gremio (v1): x0-2..x0+16, z0-3..z0+12
  const o = town.hall?.origin;
  if (o) reserved.push({ x1: o.x - 2, z1: o.z - 3, x2: o.x + 16, z2: o.z + 12, door: { x: o.x + 7, z: o.z - 4 }, what: 'gremio' });
  const migrating = !Array.isArray(town.plots) && ((town.slots ?? 0) > 0 || (w.houses ?? []).length > 0);
  if (migrating) {
    for (const [dx, dz] of V1_SLOTS) reserved.push(plotRect(c.x + dx, c.z + dz));
    for (const h of w.houses ?? []) if (h.cx !== undefined) reserved.push(plotRect(h.cx, h.cz));
  } else {
    town.plots = STARTER_PLOTS.map(([dx, dz]) => ({ x: c.x + dx, z: c.z + dz }));
    for (const p of town.plots) reserved.push(plotRect(p.x, p.z));
  }
  const s = newSettlement({
    kind: 'inicio', culture: 'humano', name: C.townName('humano', rng), realm, center: { x: c.x, y: c.y, z: c.z }, radius: KINDS.inicio.r[0],
    seed: hash(`inicio-seed:${c.x},${c.z}`), reserved,
  });
  realm.seat = { x: c.x, z: c.z };
  w.starterId = s.id;
  town.settlementId = s.id;
  queue.unshift(s.id);
  wDirty();
  return s;
}

function plotRect(x, z) {
  return { x1: x - 4, z1: z - 4, x2: x + 4, z2: z + 4, door: { x, z: z - 5 }, what: 'familia' };
}

/** Centro (x, z) para una nueva casa familiar dentro de la villa inicial. */
export function nextHouseSpot() {
  const w = reg();
  const t = w.town;
  if (!t) return undefined;
  const i = (t.slots = (t.slots ?? 0) + 1) - 1;
  wDirty();
  const plots = Array.isArray(t.plots) ? t.plots : null;
  if (plots && i < plots.length) return { x: plots[i].x, z: plots[i].z };
  if (!plots && i < V1_SLOTS.length) return { x: t.center.x + V1_SLOTS[i][0], z: t.center.z + V1_SLOTS[i][1] };
  const baseN = plots ? plots.length : V1_SLOTS.length;
  const j = i - baseN;
  const ring = Math.floor(j / 10);
  const a = (j % 10) * ((Math.PI * 2) / 10) + ring * 0.3;
  const r = KINDS.inicio.r[0] + 14 + ring * 18;
  return { x: Math.round(t.center.x + Math.cos(a) * r), z: Math.round(t.center.z + Math.sin(a) * r) };
}

/* ================================================================== */
/* Mantenimiento                                                        */
/* ================================================================== */

const npcMiss = new Map(); // sid → Map(identId → n)
const wpMiss = new Map(); // sid → Map(idx → n)
let upkeepCursor = 0;

function tagValue(tags, prefix) {
  for (const t of tags) if (t.startsWith(prefix)) return t.slice(prefix.length);
  return undefined;
}

function upkeep(s, players) {
  let dim;
  try { dim = world.getDimension(s.dim); } catch { return; }
  const roster = rosterOf(s.id);
  const nearPlayers = players.filter((p) => { try { return p.dimension.id === s.dim; } catch { return false; } });
  let ents = [];
  try { ents = dim.getEntities({ type: npc.NPC_TYPE, tags: ['rpg_set_' + s.id] }); } catch { return; }
  const byId = new Map();
  for (const e of ents) {
    let tags = [];
    try { tags = e.getTags(); } catch { continue; }
    const fid = tagValue(tags, 'rpg_fid_');
    if (!fid) continue;
    if (!byId.has(fid)) byId.set(fid, []);
    byId.get(fid).push(e);
  }
  for (const list of byId.values()) if (list.length > 1) for (const e of list.slice(1)) try { e.remove(); } catch {}
  const miss = npcMiss.get(s.id) ?? new Map();
  npcMiss.set(s.id, miss);
  const day = safeDay();
  let changed = false;
  for (const r of roster) {
    const id = r.i?.id;
    if (!id) continue;
    const pos = { x: r.p[0], y: r.p[1], z: r.p[2] };
    if (byId.has(id)) {
      miss.delete(id);
      // Devolver a casa a los que se pierden lejos (sin jugadores mirando)
      const e = byId.get(id)[0];
      try {
        if (dist2D(e.location, s.center) > s.radius + 64 && !nearPlayers.some((p) => dist2D(p.location, e.location) < 32)) e.teleport(pos);
      } catch {}
      continue;
    }
    if (r.dd !== undefined) {
      if (day - r.dd >= 3) { replaceDead(s, r, dim); changed = true; }
      continue;
    }
    if (!chunkLoaded(dim, pos) || !nearPlayers.some((p) => dist2D(p.location, pos) < 80)) continue;
    const n = (miss.get(id) ?? 0) + 1;
    miss.set(id, n);
    if (n >= 2) {
      miss.delete(id);
      spawnResident(dim, pos, r.i, s);
    }
  }
  if (changed) { saveRoster(s.id, roster); wDirty(); }
  // Marcadores
  const list = waypointList(s);
  let wps = [];
  try { wps = dim.getEntities({ type: WP_TYPE, tags: ['rpg_set_' + s.id] }); } catch {}
  const have = new Map();
  for (const e of wps) {
    let tags = [];
    try { tags = e.getTags(); } catch { continue; }
    const idx = tagValue(tags, 'rpg_wpi_');
    if (idx === undefined) continue;
    if (have.has(idx)) { try { e.remove(); } catch {} continue; }
    have.set(idx, e);
  }
  const wm = wpMiss.get(s.id) ?? new Map();
  wpMiss.set(s.id, wm);
  list.forEach(([kind, pos], i) => {
    const key = String(i);
    if (have.has(key)) { wm.delete(key); return; }
    if (!pos || !chunkLoaded(dim, pos) || !nearPlayers.some((p) => dist2D(p.location, pos) < 80)) return;
    const n = (wm.get(key) ?? 0) + 1;
    wm.set(key, n);
    if (n >= 2) { wm.delete(key); spawnWaypoint(dim, s, i, kind, pos); }
  });
}

/** Sustituye a un habitante muerto (tras 3 días) por alguien nuevo con el mismo puesto. */
function replaceDead(s, r, dim) {
  const realm = getRealm(s.realmId);
  const old = r.i;
  const rng = seeded(hash(old.id + ':' + safeDay()));
  const isRuler = old.job === 'rey';
  let o = {
    settlement: s.id, realm: s.realmId, job: old.job, role: old.role, cls: old.cls, homeId: old.homeId,
    race: isRuler ? s.culture : C.pickResidentRace(s.culture, realm?.attitudes, rng), wallet: wallet(rng, old.cls ?? 'media', realm?.economy?.prosperity ?? 1),
  };
  if (isRuler && realm) {
    const gender = rng() < 0.5 ? 'm' : 'f';
    const names = FIRST_NAMES[s.culture] ?? FIRST_NAMES.humano;
    realm.ruler = { name: pickR(rng, names[gender]), surname: realm.ruler?.surname, gender, title: C.rulerTitle(realm.culture, realm.government, gender), identId: null };
    o = { ...o, gender, name: realm.ruler.name, surname: realm.ruler.surname, title: realm.ruler.title, hat: 5, wallet: irand(rng, 800, 2500) };
  }
  const ident = makeIdent(o);
  if (!ident) return;
  r.i = ident;
  delete r.dd;
  const swap = (arr) => { const k = arr.indexOf(old.id); if (k >= 0) arr[k] = ident.id; };
  swap(s.residents);
  swap(s.guards);
  for (const h of s.houses) if (h.owner === old.id) h.owner = ident.id;
  if (isRuler && realm) {
    s.rulerId = ident.id;
    realm.ruler.identId = ident.id;
    for (const p of world.getAllPlayers()) {
      try {
        if (p.dimension.id === s.dim && dist2D(p.location, s.center) < 400) msg(p, `§6♛ ${realm.name} tiene nuevo soberano: §f${rulerName(realm)}§6. ¡Larga vida!`);
      } catch {}
    }
  }
  const pos = { x: r.p[0], y: r.p[1], z: r.p[2] };
  if (chunkLoaded(dim, pos)) spawnResident(dim, pos, ident, s);
}

/** Llamar desde world.afterEvents.entityDie: registra muertes de habitantes e invasores. */
export function onEntityDie(ev) {
  const e = ev?.deadEntity;
  if (!e) return;
  let tags = [];
  try { tags = e.getTags(); } catch { return; }
  if (!tags.length) return;
  let killer = ev.damageSource?.damagingEntity;
  try { if (killer && killer.typeId !== 'minecraft:player') killer = killer.getComponent?.('minecraft:projectile')?.owner ?? killer; } catch {}
  const raidTag = tagValue(tags, 'rpg_raid_');
  if (raidTag && raid && raid.sid === raidTag) {
    try {
      if (killer?.typeId === 'minecraft:player') raid.helpers.set(killer.id, (raid.helpers.get(killer.id) ?? 0) + 1);
    } catch {}
    return;
  }
  const sid = tagValue(tags, 'rpg_set_');
  const fid = tagValue(tags, 'rpg_fid_');
  if (!sid || !fid) return;
  let type;
  try { type = e.typeId; } catch {}
  if (type !== npc.NPC_TYPE) return;
  const roster = rosterOf(sid);
  const r = roster.find((x) => x.i?.id === fid);
  if (r && r.dd === undefined) {
    r.dd = safeDay();
    saveRoster(sid, roster);
  }
}

/* ================================================================== */
/* Descubrimiento                                                       */
/* ================================================================== */

const current = new Map(); // player.id → settlement id

const STRICT = ['laxas', 'firmes', 'implacables'];

function prosperityLabel(p) {
  if (p >= 1.3) return '§aopulenta';
  if (p >= 1.05) return '§2próspera';
  if (p >= 0.8) return '§emodesta';
  return '§cpobre';
}

const FEM_WORDS = /^(aldea|ciudad|capital|villa|ermita|corte|fortaleza|ciudadela|avanzada|santa|feria)/;
function kindArticle(label) {
  return FEM_WORDS.test(label.toLowerCase()) ? 'una' : 'un';
}

/** "del", "de la", "de los" o "de las" según el nombre del reino. */
export function ofRealm(name) {
  const n = String(name ?? '');
  if (/^Tribus\b/.test(n)) return 'de las ' + n;
  if (/^Clanes\b/.test(n)) return 'de los ' + n;
  if (/^(República|Liga|Mancomunidad|Horda|Teocracia|Santa|Fortaleza)\b/.test(n)) return 'de la ' + n;
  return 'del ' + n;
}

function discover(player, s, first) {
  const realm = getRealm(s.realmId);
  const cul = C.cultureOf(s.culture);
  const label = kindLabel(s);
  if (first) {
    title(player, `§6${s.name}`, `§7${label} · ${realm?.name ?? 'Tierras libres'}`);
    if (realm) actionbar(player, `§e♛ §7Gobierna §f${rulerName(realm, true)}`);
    const fem = FEM_WORDS.test(label.toLowerCase());
    const adj = cul.adj[fem ? 1 : 0];
    const lbl = label.toLowerCase().includes(adj.slice(0, 4)) ? label.toLowerCase() : `${label.toLowerCase()} ${adj}`;
    msg(player, `§e✦ Has descubierto §f${s.name}§e: ${kindArticle(label)} ${lbl} ${realm ? ofRealm(realm.name).replace(realm.name, '§f' + realm.name + '§e') : 'en tierras libres'}.`);
    if (realm) {
      const gov = C.GOVERNMENTS[realm.government]?.name ?? realm.government;
      msg(player, `§7Gobierna ${rulerName(realm, true)} §8(${gov})§7 · Leyes ${STRICT[realm.strictness] ?? 'firmes'} · Economía: ${C.ECONOMY[realm.economy?.focus] ?? realm.economy?.focus}, ${prosperityLabel(realm.economy?.prosperity ?? 1)}§7.`);
      const d = getP(player);
      const att = d ? realm.attitudes?.[d.race] : undefined;
      if (att !== undefined && d.race !== realm.culture) {
        const race = raceOf(d.race);
        if (att <= -0.4) msg(player, `§c⚠ Aquí miran con recelo a los ${race.plural.toLowerCase()}. Cuida tus pasos.`);
        else if (att >= 0.45) msg(player, `§a♥ Los ${race.plural.toLowerCase()} son bien recibidos en estas tierras.`);
      }
    }
    try { player.playSound('random.toast', { volume: 1, pitch: 0.9 }); } catch {}
  } else {
    actionbar(player, `§7Entrando en §f${s.name}§7 · ${label}${realm ? ' · ' + realm.name : ''}`);
  }
}

function discoveryTick(player) {
  let dimId;
  let loc;
  try { dimId = player.dimension.id; loc = player.location; } catch { return; }
  const s = settlementAt(dimId, loc);
  const prev = current.get(player.id);
  if ((s?.id) === prev) return;
  if (s) current.set(player.id, s.id);
  else current.delete(player.id);
  if (prev && prev !== s?.id) {
    const ps = getSettlement(prev);
    if (ps) try { hooks.onLeave?.(player, ps); } catch (e) { warn('onLeave', e); }
  }
  if (!s) return;
  const d = getP(player);
  if (!d) return;
  d.visited = Array.isArray(d.visited) ? d.visited : [];
  const first = !d.visited.includes(s.id);
  if (first) {
    d.visited.push(s.id);
    if (d.visited.length > 300) d.visited.shift();
  }
  d.realms = Array.isArray(d.realms) ? d.realms : [];
  const realm = getRealm(s.realmId);
  const firstRealm = realm && !d.realms.includes(realm.id);
  if (firstRealm) {
    d.realms.push(realm.id);
    const cul = C.cultureOf(realm.culture);
    msg(player, `§6♛ Entras en el territorio ${ofRealm(realm.name).replace(realm.name, '§f' + realm.name + '§6')}, de cultura ${cul.adj[1]}. §7${cul.desc}`);
  }
  if (first || firstRealm) dirty(player);
  discover(player, s, first);
  try { if (realm) hooks.onRealmEnter?.(player, realm, !!firstRealm); } catch (e) { warn('onRealmEnter', e); }
  try { hooks.onEnter?.(player, s, first); } catch (e) { warn('onEnter', e); }
}

/* ================================================================== */
/* Generación al explorar                                               */
/* ================================================================== */

const track = new Map(); // player.id → { hist, lastTry }

function genTick(player) {
  if (!cfgv('settlementGen', true)) return;
  let dimId;
  let loc;
  try { dimId = player.dimension.id; loc = player.location; } catch { return; }
  if (dimId !== OW || !getP(player)) return;
  const w = reg();
  if (!w.starterId) return;
  const now = system.currentTick;
  let tr = track.get(player.id);
  if (!tr) { tr = { hist: [], lastTry: now - 400 }; track.set(player.id, tr); }
  tr.hist.push({ x: loc.x, z: loc.z, t: now });
  if (tr.hist.length > 6) tr.hist.shift();
  if (active || now - tr.lastTry < 600) return;
  if (w.settlements.length >= cfgv('maxSettlements', 40)) return;
  const spacing = cfgv('settlementSpacing', 350);
  if (nearestSettlement(OW, loc, spacing, true)) return;
  const a = tr.hist[0];
  const dx = loc.x - a.x;
  const dz = loc.z - a.z;
  const moved = Math.hypot(dx, dz);
  if (moved < 10) return;
  tr.lastTry = now;
  const ang = Math.atan2(dz, dx) + (Math.random() - 0.5) * 0.6;
  const dist = 110 + Math.random() * 60;
  const sx = Math.round(loc.x + Math.cos(ang) * dist);
  const sz = Math.round(loc.z + Math.sin(ang) * dist);
  const site = { x: sx, z: sz };
  if (nearestSettlement(OW, site, spacing * 0.75, true)) return;
  for (const dg of w.dungeons ?? []) if (dist2D(dg, site) < 100) return;
  for (let i = rejected.length - 1; i >= 0; i--) {
    if (now - rejected[i].t > 20 * 600) rejected.splice(i, 1);
    else if (dist2D(rejected[i], site) < 120) return;
  }
  generateAt(player.dimension, sx, sz).catch((e) => warn('generateAt', e));
}

/** Para administradores/pruebas: crea un asentamiento delante del jugador. */
export function forceSettlement(player, kind, culture) {
  if (active) return false;
  if (kind && !KINDS[kind]) kind = undefined;
  if (kind === 'inicio') kind = 'pueblo';
  if (culture && !C.CULTURES[culture]) culture = undefined;
  let dir = { x: 0, z: 1 };
  try {
    const v = player.getViewDirection();
    const l = Math.hypot(v.x, v.z) || 1;
    dir = { x: v.x / l, z: v.z / l };
  } catch {}
  const R = (KINDS[kind ?? 'pueblo']?.r?.[1] ?? 44) + 16;
  const sx = Math.round(player.location.x + dir.x * R);
  const sz = Math.round(player.location.z + dir.z * R);
  generateAt(player.dimension, sx, sz, { kind: kind ?? 'pueblo', culture, noEval: true }).catch((e) => warn('forceSettlement', e));
  return true;
}

/* ================================================================== */
/* Ataques nocturnos                                                    */
/* ================================================================== */

let raid = null; // { sid, t0, total, helpers: Map, misses, lastNear }
let pendingRaid = null;
const raidRolled = new Map(); // sid → día

export function activeRaid() {
  return raid ? { settlement: getSettlement(raid.sid), total: raid.total, since: raid.t0 } : null;
}

function isNight() {
  try {
    const t = world.getTimeOfDay();
    return t >= 13000 && t < 23000;
  } catch { return false; }
}

function raidTick(players) {
  const now = system.currentTick;
  if (raid) { checkRaid(players, now); return; }
  if (!isNight()) { pendingRaid = null; return; }
  if (pendingRaid) {
    if (now >= pendingRaid.at) {
      const s = getSettlement(pendingRaid.sid);
      pendingRaid = null;
      if (s && s.built) startRaid(s, players);
    }
    return;
  }
  const day = safeDay();
  for (const s of reg().settlements) {
    if (!s.built) continue;
    const near = players.some((p) => { try { return p.dimension.id === s.dim && dist2D(p.location, s.center) < s.radius + 40; } catch { return false; } });
    if (!near || raidRolled.get(s.id) === day) continue;
    raidRolled.set(s.id, day);
    let ch = cfgv('raidChance', 0.1);
    if (s.kind === 'inicio') ch = day < 3 ? 0 : ch * 0.7;
    if (Math.random() < ch) {
      pendingRaid = { sid: s.id, at: now + 20 * (15 + Math.floor(Math.random() * 120)) };
      break;
    }
  }
}

/** Inicia un ataque (también para administradores). */
export function startRaid(s, players = world.getAllPlayers()) {
  if (raid || !s) return false;
  let dim;
  try { dim = world.getDimension(s.dim); } catch { return false; }
  const day = safeDay();
  const pool = C.raiderPool(s.culture, day);
  const base = { aldea: 3, pueblo: 5, ciudad: 7, capital: 9, inicio: 3 }[s.kind] ?? 4;
  const count = Math.min(base + 4, base + Math.floor(day / 10));
  // Punto de entrada: una puerta o un punto del borde
  const rng = seeded(hash(s.id + ':raid:' + day));
  const gates = (s.gates ?? []).filter((g) => chunkLoaded(dim, g));
  const near = players.filter((p) => { try { return p.dimension.id === s.dim; } catch { return false; } });
  let origin = null;
  let od = Infinity;
  for (const g of gates) {
    const dd = Math.min(...near.map((p) => dist2D(p.location, g)), Infinity);
    const score = dd + rng() * 30;
    if (score < od) { od = score; origin = g; }
  }
  if (!origin) {
    const ang = rng() * Math.PI * 2;
    origin = { x: s.center.x + Math.cos(ang) * (s.radius - 2), z: s.center.z + Math.sin(ang) * (s.radius - 2) };
  }
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(origin.x + (rng() - 0.5) * 6);
    const z = Math.floor(origin.z + (rng() - 0.5) * 6);
    if (!chunkLoaded(dim, { x, y: 64, z })) continue;
    const col = probeColumn(dim, x, z);
    if (!col) continue;
    const type = C.weightedR(pool, rng);
    try {
      const e = dim.spawnEntity(type, { x: x + 0.5, y: (col.w ? col.t : col.g) + 1, z: z + 0.5 });
      e.addTag('rpg_raid');
      e.addTag('rpg_raid_' + s.id);
      spawned++;
    } catch {}
  }
  if (!spawned) return false;
  raid = { sid: s.id, t0: system.currentTick, total: spawned, helpers: new Map(), misses: 0, lastNear: system.currentTick };
  const dir = cardinal(s.center, origin).toLowerCase();
  for (const p of players) {
    try {
      if (p.dimension.id !== s.dim || dist2D(p.location, s.center) > s.radius + 80) continue;
      title(p, `§c§l¡Ataque a ${s.name}!`, `§7${spawned} enemigos llegan por el ${dir}`);
      msg(p, `§c⚔ ¡Ataque a ${s.name}! §7Los guardias tocan a rebato: ${spawned} criaturas avanzan desde el ${dir}. Defiende a sus gentes.`);
      p.playSound('raid.horn', { volume: 1, pitch: 1 });
    } catch {}
  }
  try { hooks.onRaidStart?.(s); } catch (e) { warn('onRaidStart', e); }
  return true;
}

function endRaid(s, players, outcome) {
  const r = raid;
  raid = null;
  if (!s || !r) return;
  let dim;
  try { dim = world.getDimension(s.dim); } catch {}
  if (outcome !== 'victoria' && dim) {
    try { for (const e of dim.getEntities({ tags: ['rpg_raid_' + s.id] })) e.remove(); } catch {}
  }
  const near = players.filter((p) => { try { return p.dimension.id === s.dim && dist2D(p.location, s.center) < s.radius + 60; } catch { return false; } });
  if (outcome === 'huida') {
    for (const p of near) msg(p, `§7Con la primera luz del alba, los atacantes de ${s.name} huyen hacia la espesura.`);
    return;
  }
  if (outcome !== 'victoria') return;
  const kindBase = { aldea: 20, pueblo: 35, ciudad: 50, capital: 70, inicio: 15 }[s.kind] ?? 25;
  let helpers = near.filter((p) => r.helpers.has(p.id));
  let half = false;
  if (!helpers.length && !r.helpers.size) {
    helpers = near.filter((p) => dist2D(p.location, s.center) < s.radius + 20);
    half = true;
  }
  for (const p of helpers) {
    if (!getP(p)) continue;
    const kills = r.helpers.get(p.id) ?? 0;
    const gold = Math.round((kindBase + 5 * r.total + 4 * kills) * (half ? 0.5 : 1));
    try { addGold(p, gold); } catch {}
    try { addKarma(p, half ? 2 : 6, 'defender ' + s.name); } catch {}
    title(p, `§a§l¡${s.name} está a salvo!`, `§6+${gold} oro §7· ${kills} enemigos abatidos`);
    msg(p, `§a✔ Los habitantes de ${s.name} te vitorean. §6+${gold} de oro §7(recompensa de la guardia).`);
    try { hooks.onRaidDefended?.(p, s); } catch (e) { warn('onRaidDefended', e); }
  }
  for (const p of near) if (!helpers.includes(p)) msg(p, `§7Los guardias de ${s.name} han rechazado el ataque.`);
}

function checkRaid(players, now) {
  const s = getSettlement(raid.sid);
  if (!s) { raid = null; return; }
  let dim;
  try { dim = world.getDimension(s.dim); } catch { raid = null; return; }
  const near = players.some((p) => { try { return p.dimension.id === s.dim && dist2D(p.location, s.center) < s.radius + 120; } catch { return false; } });
  if (near) raid.lastNear = now;
  else if (now - raid.lastNear > 20 * 60) { endRaid(s, players, 'cancelado'); return; }
  if (now - raid.t0 > 20 * 60 * 8) { endRaid(s, players, 'huida'); return; }
  let left = 1;
  try { left = dim.getEntities({ tags: ['rpg_raid_' + s.id] }).length; } catch {}
  if (left === 0) {
    raid.misses++;
    if (raid.misses >= 2) endRaid(s, players, 'victoria');
    return;
  }
  raid.misses = 0;
  if (!isNight() && now - raid.t0 > 20 * 30) endRaid(s, players, 'huida');
}

/* ================================================================== */
/* Bucle principal (cada 2 s)                                           */
/* ================================================================== */

let tickN = 0;
let cleaned = false;

/** Llamar cada 2 segundos: descubrimiento, generación, mantenimiento, ataques y obras. */
export function settlementTick() {
  tickN++;
  if (!cleaned) {
    cleaned = true;
    // Zonas de carga que quedaron de una sesión anterior (solo las de este paquete)
    try { if (!active) world.tickingAreaManager?.removeAllTickingAreas?.(); } catch {}
    try {
      const w = reg();
      if (w.setAreas?.length) {
        const ow = world.getDimension('overworld');
        for (const n of w.setAreas) try { ow.runCommand(`tickingarea remove ${n}`); } catch {}
        w.setAreas = [];
        wDirty();
      }
    } catch {}
  }
  let players = [];
  try { players = world.getAllPlayers(); } catch { return; }
  for (const p of players) {
    try { discoveryTick(p); } catch (e) { warn('descubrimiento', e); }
    try { genTick(p); } catch (e) { warn('generación', e); }
  }
  // Villa inicial pendiente en mundos de la v1
  try {
    const w = reg();
    if (!w.starterId && w.town?.built && players.length) {
      const p = players.find((q) => { try { return q.dimension.id === OW && dist2D(q.location, w.town.center) < 80; } catch { return false; } });
      if (p) ensureStarterVillage(p);
    }
  } catch (e) { warn('villa inicial', e); }
  // Mantenimiento: un asentamiento cercano por llamada, cada asentamiento cada ~10 s
  try {
    const list = reg().settlements.filter((s) => s.built && players.some((p) => { try { return p.dimension.id === s.dim && dist2D(p.location, s.center) < 96; } catch { return false; } }));
    if (list.length && tickN % Math.max(1, Math.ceil(5 / list.length)) === 0) {
      upkeepCursor = (upkeepCursor + 1) % list.length;
      upkeep(list[upkeepCursor], players);
    }
  } catch (e) { warn('mantenimiento', e); }
  try { raidTick(players); } catch (e) { warn('ataques', e); }
  try { if (tickN % 3 === 0) kick(); } catch (e) { warn('obras', e); }
  // Obras eternas: abortar si llevan demasiado (10 min)
  if (active && system.currentTick - active.t0 > 20 * 600) {
    warn('Obras abortadas por tiempo: ' + active.id);
    active = null;
  }
}

/* ================================================================== */
/* Texto para menús                                                     */
/* ================================================================== */

/** Resumen de un asentamiento (para el Diario). */
export function describeSettlement(s, player) {
  const realm = getRealm(s.realmId);
  const cul = C.cultureOf(s.culture);
  const label = kindLabel(s);
  const lbl = label.toLowerCase().includes(cultureAdj(cul, label).slice(0, 4)) ? label : `${label} ${cul.c}${cultureAdj(cul, label)}`;
  let txt = `§l${s.name}§r\n§7${lbl}§7 · ${realm?.name ?? 'Tierras libres'}\n`;
  if (realm) {
    txt += `§7Gobierno: §f${C.GOVERNMENTS[realm.government]?.name ?? realm.government}§7 · Soberano: §f${rulerName(realm)}\n`;
    txt += `§7Leyes: §f${C.STRICTNESS[realm.strictness]?.name ?? '-'}§7 · Economía: §f${C.ECONOMY[realm.economy?.focus] ?? '-'} §7(${prosperityLabel(realm.economy?.prosperity ?? 1)}§7)\n`;
  }
  txt += `§7Habitantes: §f${(s.residents?.length ?? 0)}§7 · Guardias: §f${s.guards?.length ?? 0}`;
  if (player) {
    try {
      const d = Math.round(dist2D(player.location, s.center));
      txt += `\n§7A ${d} bloques al ${cardinal(player.location, s.center)}`;
    } catch {}
  }
  return txt;
}

/** Atlas de asentamientos visitados por el jugador. */
export function atlasText(player) {
  const d = getP(player);
  const visited = new Set(d?.visited ?? []);
  const list = reg().settlements.filter((s) => visited.has(s.id));
  if (!list.length) return '§7Aún no has descubierto ningún asentamiento. ¡Sal a explorar!';
  return list.map((s) => describeSettlement(s, player)).join('\n\n');
}

export { C as cultures };
