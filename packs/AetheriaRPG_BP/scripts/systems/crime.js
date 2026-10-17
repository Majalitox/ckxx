// Crimen y sigilo: quién te ve (el ojo), minijuego de robo (bolsillos, cerraduras, llaves), robos en casas,
// testigos que corren a avisar a la guardia, estrellas de búsqueda y guardias que salen a cazarte.
// El arresto, el cepo y la prisión viven en systems/justice.js (que importa este módulo, nunca al revés).
import { world, system, ItemStack } from '@minecraft/server';
import { getP, dirty, W, wDirty } from '../core/store.js';
import { msg, title, actionbar, addGold, addKarma } from '../core/progression.js';
import * as profile from '../core/profile.js';
import * as S from './settlements.js';
// Solo en tiempo de ejecución (bocadillos de life.js: se borran antes de tocar el nombre de un testigo).
import * as life from './life.js';
import {
  LAWS, CRIMES, MINIGAME, WALLET_DEFAULT, COFFER_GOLD, POCKET_ITEMS, POCKET_ITEMS_DEFAULT, COFFER_ITEMS,
  SHOUTS, VICTIM_NOTICE, REPORT_LINES, GUARD_ACK, HUNT_SHOUTS, DECAY_LINES, LOST_TRAIL, SEVERITY_NAMES,
  severityOf, ofRuler, say, crimeWithArticle,
} from '../data/laws.js';
import { particle, psound, valid, giveItem, countItem, removeItem, hasEffect, isSolid } from '../util/compat.js';
import { pick, rand, randInt, chance, clamp, dist, dist2D } from '../util/math.js';

export const NPC = 'rpg:npc';
export const EYE = { CLOSED: '\uE300', HALF: '\uE301', OPEN: '\uE302' };
export const STAR_ON = '\uE303';
export const STAR_OFF = '\uE304';
export const GLYPH = { coin: '\uE305', shackles: '\uE308', crown: '\uE309', shield: '\uE30A', skull: '\uE30B', house: '\uE30E', tomato: '\uE30F' };

/** Funciones que el integrador puede asignar (main.js). */
export const hooks = {
  onPunished: undefined, // (player, kind: 'humiliation'|'jail'|'fine'|'bribe', crimes: string[]) — hazaña de infamia, etc.
  onCrime: undefined, // (player, type, { witnessed, stars, settlement, realm, victimName, value })
  onTheft: undefined, // (player, kind: 'pocket'|'house'|'key', gold, victimIdent?)
  classRank: undefined, // (player) => 0..5  (social.playerClass(d).rank) — la nobleza paga multas en vez del cepo
  fame: undefined, // (player, realmId) => número — la fama también puede valer un perdón
  questProgress: undefined, // (player, type, key, n)
};

/** Ajuste de las leyes (los administradores pueden sobrescribirlo en W().settings). */
export function law(key) {
  try {
    const v = W().settings?.[key];
    if (v !== undefined && v !== null && typeof v === typeof LAWS[key] && (typeof v !== 'number' || Number.isFinite(v))) return v;
  } catch {}
  return LAWS[key];
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

export function playerById(id) {
  try { return world.getAllPlayers().find((p) => p.id === id); } catch { return undefined; }
}

export function identOf(e) {
  try {
    const raw = e.getDynamicProperty('rpg:npc');
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
}

export function saveIdent(e, ident) {
  try { e.setDynamicProperty('rpg:npc', JSON.stringify(ident)); } catch {}
}

export function npcName(e, ident) {
  ident = ident ?? identOf(e);
  return ident?.name ?? 'Alguien';
}

export function isNpc(e) {
  try { return e?.typeId === NPC; } catch { return false; }
}

export function isGuard(e, ident) {
  try { if (e.getComponent('minecraft:type_family')?.hasTypeFamily('rpg_guard')) return true; } catch {}
  ident = ident ?? identOf(e);
  return ident?.job === 'guardia' || ident?.job === 'carcelero' || ident?.role === 'guardia' || ident?.role === 'carcelero';
}

export function isAsleep(e) {
  try { if (e.getProperty('rpg:mood') === 3) return true; } catch {}
  try { return e.hasTag('rpg_sleeping') || e.hasTag('rpg_act_sleep'); } catch { return false; }
}

/** El NPC es familia del jugador (no le denuncia). */
export function isFamilyOf(e, player, ident) {
  ident = ident ?? identOf(e);
  return !!ident && !!ident.owner && ident.owner === player.id;
}

export function gw(d, m, f) {
  return d?.gender === 'f' ? f : m;
}

export function centerOf(p) {
  if (!p) return p;
  return {
    x: Number.isInteger(p.x) ? p.x + 0.5 : p.x,
    y: p.y,
    z: Number.isInteger(p.z) ? p.z + 0.5 : p.z,
  };
}

export function starText(n) {
  n = clamp(Math.round(n ?? 0), 0, 5);
  return '§c' + STAR_ON.repeat(n) + '§8' + STAR_OFF.repeat(5 - n) + '§r';
}

/** Un NPC dice algo a los jugadores cercanos. */
export function npcSay(e, text, ctx = {}, radius = 32, color) {
  let name, loc, dimId, ident;
  try {
    ident = identOf(e);
    name = ident?.name ?? 'Alguien';
    loc = e.location;
    dimId = e.dimension.id;
  } catch { return; }
  const guard = isGuard(e, ident);
  const tag = guard ? `§9[${GLYPH.shield} ${ident?.job === 'carcelero' ? gw(ident, 'Carcelero', 'Carcelera') : 'Guardia'} ${name}]` : `${color ?? '§e'}[${name}]`;
  const line = `${tag} §f${say(text, ctx)}`;
  for (const p of world.getAllPlayers()) {
    try { if (p.dimension.id === dimId && dist(p.location, loc) <= radius) p.sendMessage(line); } catch {}
  }
}

/** Mensaje a los jugadores cerca de un punto. */
export function localMsg(dimId, loc, text, radius = 40) {
  for (const p of world.getAllPlayers()) {
    try { if (p.dimension.id === dimId && dist(p.location, loc) <= radius) p.sendMessage(text); } catch {}
  }
}

export function standable(dim, loc) {
  try {
    const feet = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
    const head = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y) + 1, z: Math.floor(loc.z) });
    if (!feet || !head) return true;
    return !isSolid(feet) && !isSolid(head);
  } catch { return true; }
}

/* ------------------------------------------------------------------ */
/* Asentamientos (contrato §6.1, módulo settlements)                   */
/* ------------------------------------------------------------------ */

export function settlementAtLoc(dimId, loc) {
  try { return S.settlementAt?.(dimId, loc) ?? undefined; } catch { return undefined; }
}
export function getSettlementSafe(id) {
  if (!id) return undefined;
  if (typeof id === 'object') return id;
  try { return S.getSettlement?.(id) ?? undefined; } catch { return undefined; }
}
export function realmOfSafe(s) {
  if (!s) return undefined;
  try { return S.realmOf?.(s) ?? undefined; } catch { return undefined; }
}
export function nearestSettlementSafe(dimId, loc, maxDist) {
  try { return S.nearestSettlement?.(dimId, loc, maxDist) ?? undefined; } catch { return undefined; }
}
export function allSettlementsSafe() {
  try {
    const a = S.allSettlements?.();
    if (Array.isArray(a)) return a;
    if (a && typeof a === 'object') return Object.values(a);
  } catch {}
  return [];
}

export function strictnessOf(realm) {
  const s = Number(realm?.strictness);
  return Number.isFinite(s) ? clamp(Math.round(s), 0, 2) : 1;
}

const placeCache = new Map(); // pid -> { tick, s }

/** Asentamiento en el que está el jugador (con caché de 1 s). */
export function placeOf(player, maxAge = 20) {
  const now = system.currentTick;
  const c = placeCache.get(player.id);
  if (c && now - c.tick < maxAge) return c.s;
  let s;
  try { s = settlementAtLoc(player.dimension.id, player.location); } catch {}
  placeCache.set(player.id, { tick: now, s });
  return s;
}

/** Asentamiento responsable de un lugar: el que lo contiene o uno muy cercano. */
export function jurisdictionOf(dimId, loc) {
  const s = settlementAtLoc(dimId, loc);
  if (s) return s;
  const n = nearestSettlementSafe(dimId, loc, 200);
  if (n?.center && dist2D(n.center, loc) <= (n.radius ?? 40) + 32) return n;
  return undefined;
}

const guardRealm = new Map(); // guardId -> realmId|null

function realmIdOfNpc(e) {
  if (guardRealm.has(e.id)) return guardRealm.get(e.id);
  const ident = identOf(e);
  let rid = ident?.realm;
  if (!rid && ident?.settlement) rid = getSettlementSafe(ident.settlement)?.realmId;
  guardRealm.set(e.id, rid ?? null);
  if (guardRealm.size > 600) guardRealm.clear();
  return rid ?? null;
}

/** Guardias cerca de un punto (opcionalmente de un reino). */
export function guardsNear(dim, loc, radius, realmId) {
  let list = [];
  try { list = dim.getEntities({ type: NPC, families: ['rpg_guard'], location: loc, maxDistance: radius }); } catch {}
  if (realmId) list = list.filter((g) => { const r = realmIdOfNpc(g); return !r || r === realmId; });
  return list;
}

/* ------------------------------------------------------------------ */
/* Visión: ¿quién te ve?                                               */
/* ------------------------------------------------------------------ */

const SEE_THROUGH = /glass|iron_bars|fence|leaves|chain|lantern|scaffolding|web|bars/;

/** Línea de visión entre dos puntos (atraviesa cristal, barrotes, vallas y hojas). */
export function lineOfSight(dim, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const total = Math.hypot(dx, dy, dz);
  if (total < 0.6) return true;
  const dir = { x: dx / total, y: dy / total, z: dz / total };
  let origin = from;
  let travelled = 0;
  for (let pass = 0; pass < 4; pass++) {
    const left = total - travelled;
    if (left <= 0.4) return true;
    let hit;
    try { hit = dim.getBlockFromRay(origin, dir, { maxDistance: left, includeLiquidBlocks: false, includePassableBlocks: false }); } catch { return true; }
    if (!hit || !hit.block) return true;
    let hp;
    try {
      const b = hit.block.location;
      const f = hit.faceLocation ?? { x: 0.5, y: 0.5, z: 0.5 };
      hp = { x: b.x + f.x, y: b.y + f.y, z: b.z + f.z };
    } catch { return true; }
    const hd = Math.hypot(hp.x - origin.x, hp.y - origin.y, hp.z - origin.z);
    if (travelled + hd >= total - 0.6) return true;
    let type = '';
    try { type = hit.block.typeId ?? ''; } catch {}
    if (!SEE_THROUGH.test(type)) return false;
    const step = hd + 0.9;
    travelled += step;
    origin = { x: origin.x + dir.x * step, y: origin.y + dir.y * step, z: origin.z + dir.z * step };
  }
  return true;
}

/** Posición relativa: ¿estás a la espalda del NPC o te está mirando? */
export function relativePos(npc, player) {
  try {
    const v = npc.getViewDirection();
    const dx = player.location.x - npc.location.x;
    const dz = player.location.z - npc.location.z;
    const l = Math.hypot(dx, dz) || 1;
    const vl = Math.hypot(v.x, v.z) || 1;
    const dot = (v.x * dx + v.z * dz) / (l * vl);
    return { behind: dot < -0.3, facing: dot > 0.5, dot };
  } catch { return { behind: false, facing: false, dot: 0 }; }
}

/**
 * Observadores del jugador.
 * seers: NPCs que te ven claramente (te miran con línea de visión dentro de su alcance, o te oyen muy cerca).
 * aware: NPCs con línea de visión pero de espaldas o lejos (podrían notarte).
 * opts: { exclude:Set<id>, guardsOnly, rangeMult, max }
 */
export function observe(player, opts = {}) {
  const res = { seers: [], aware: [], range: 0 };
  let dim, head;
  try { dim = player.dimension; head = player.getHeadLocation(); } catch { return res; }
  let range = law('sightRange');
  let light = 15;
  try { light = dim.getLightLevel({ x: Math.floor(head.x), y: Math.floor(head.y), z: Math.floor(head.z) }); } catch {}
  if (typeof light !== 'number' || !Number.isFinite(light)) light = 15;
  range *= 0.35 + (0.65 * clamp(light, 0, 15)) / 15;
  let sneaking = false;
  let sprinting = false;
  try { sneaking = !!player.isSneaking; sprinting = !!player.isSprinting; } catch {}
  if (sneaking) range *= 0.6;
  if (hasEffect(player, 'invisibility')) range *= 0.25;
  const d = getP(player);
  if (d) {
    try {
      const sc = profile.scaleOf?.(d);
      if (typeof sc === 'number' && sc > 0) range *= clamp(0.75 + 0.25 * sc, 0.75, 1.1); // los pequeños pasan más desapercibidos
    } catch {}
    range *= 1 - Math.min(0.2, (thiefLevel(d) - 1) * 0.007);
  }
  if (opts.rangeMult) range *= opts.rangeMult;
  const far = Math.max(4, range * 1.5);
  const hear = sneaking ? 1.2 : sprinting ? law('sprintHearRadius') : law('hearRadius');
  const cos = Math.cos((law('fovHalfAngle') * Math.PI) / 180);
  let ents = [];
  try {
    const q = { type: NPC, location: head, maxDistance: Math.max(far, hear) + 1 };
    if (opts.guardsOnly) q.families = ['rpg_guard'];
    ents = dim.getEntities(q);
  } catch {}
  const list = [];
  for (const e of ents) {
    try {
      if (opts.exclude?.has(e.id)) continue;
      const eh = e.getHeadLocation();
      list.push([e, eh, dist(eh, head)]);
    } catch {}
  }
  list.sort((a, b) => a[2] - b[2]);
  for (const [e, eh, dd] of list.slice(0, opts.max ?? 12)) {
    if (isAsleep(e)) continue;
    if (!lineOfSight(dim, eh, head)) continue;
    let facing = false;
    try {
      const v = e.getViewDirection();
      facing = (v.x * (head.x - eh.x) + v.y * (head.y - eh.y) + v.z * (head.z - eh.z)) / (dd || 1) >= cos;
    } catch {}
    const entry = { e, d: dd, facing };
    if ((facing && dd <= range) || dd <= hear) res.seers.push(entry);
    else if (dd <= far) res.aware.push(entry);
  }
  res.range = range;
  return res;
}

/* ------------------------------------------------------------------ */
/* El ojo del HUD                                                      */
/* ------------------------------------------------------------------ */

// 0 cerrado (nadie), 1 entreabierto (alguien cerca podría notarte), 2 entreabierto rojo (alguien te mira), 3 abierto (te han visto)
const eyeCache = new Map(); // pid -> { lvl, tick }
const seenUntil = new Map(); // pid -> tick

export function markSeen(player, ticks = 100) {
  seenUntil.set(player.id, Math.max(seenUntil.get(player.id) ?? 0, system.currentTick + ticks));
}

export function refreshEye(player) {
  const o = observe(player);
  const lvl = o.seers.length ? 2 : o.aware.length ? 1 : 0;
  eyeCache.set(player.id, { lvl, tick: system.currentTick });
  return lvl;
}

export function eyeLevel(player) {
  const now = system.currentTick;
  if ((seenUntil.get(player.id) ?? 0) > now) return 3;
  const g = games.get(player.id);
  if (g) return g.watch ?? 0;
  const c = eyeCache.get(player.id);
  if (!c || now - c.tick > 40) return refreshEye(player);
  return c.lvl;
}

/** Ojo del HUD; con etiqueta, concordada con el género del jugador (d). */
export function eyeText(lvl, label = true, d) {
  switch (lvl) {
    case 3: return '§c' + EYE.OPEN + (label ? ` §c¡${gw(d, 'visto', 'vista')}!` : '');
    case 2: return '§6' + EYE.HALF + (label ? ' §6¡te miran!' : '');
    case 1: return '§e' + EYE.HALF + (label ? ` §e${gw(d, 'vigilado', 'vigilada')}` : '');
    default: return '§a' + EYE.CLOSED + (label ? ` §2${gw(d, 'oculto', 'oculta')}` : '');
  }
}

function needsEye(player, d) {
  if (games.has(player.id)) return true;
  if ((d?.wanted?.stars ?? 0) > 0) return true;
  if ((seenUntil.get(player.id) ?? 0) > system.currentTick) return true;
  let sneaking = false;
  try { sneaking = player.isSneaking; } catch {}
  return sneaking && !!placeOf(player);
}

/** Ojo + estrellas para el HUD ('' si no hay nada que mostrar). */
export function stealthHud(player) {
  const d = getP(player);
  if (!d || !needsEye(player, d)) return '';
  const stars = d.wanted?.stars ?? 0;
  let s = eyeText(eyeLevel(player), !stars, d);
  if (stars) s += ' ' + starText(stars);
  return s;
}

/* ------------------------------------------------------------------ */
/* Habilidad de sigilo (ladrón)                                        */
/* ------------------------------------------------------------------ */

export const THIEF_MAX = 30;
const LEVEL_LINES = [
  'tus dedos son cada vez más ágiles.',
  'caminas como una sombra.',
  'las cerraduras ya no te asustan tanto.',
  'nadie oye tus pasos.',
  'los bolsillos ajenos te llaman.',
];

export function thiefOf(d) {
  d.thief = d.thief ?? { lvl: 1, xp: 0, steals: 0, caught: 0, gold: 0, houses: 0, keys: 0, escapes: 0, punished: 0 };
  return d.thief;
}

export function thiefLevel(d) {
  return d?.thief?.lvl ?? 1;
}

export function thiefNeed(lvl) {
  return 20 + lvl * 12;
}

export function addThiefXp(player, n) {
  const d = getP(player);
  if (!d || n <= 0) return;
  const t = thiefOf(d);
  t.xp += n;
  while (t.lvl < THIEF_MAX && t.xp >= thiefNeed(t.lvl)) {
    t.xp -= thiefNeed(t.lvl);
    t.lvl++;
    msg(player, `§5✦ Sigilo nivel §l${t.lvl}§r§5: §7${pick(LEVEL_LINES)}`);
    psound(player, 'random.levelup', 0.5, 1.6);
  }
  if (t.lvl >= THIEF_MAX) t.xp = Math.min(t.xp, thiefNeed(THIEF_MAX));
  dirty(player);
}

/* ------------------------------------------------------------------ */
/* Minijuego de robo                                                   */
/* ------------------------------------------------------------------ */

const games = new Map(); // pid -> partida
let gameLoop;

export function inMinigame(player) {
  return games.has(player.id);
}

/**
 * Tamaño de la zona verde y velocidad de la aguja.
 * key: clase de la víctima ('baja'|'media'|'alta'), 'guard', 'key', 'lock_<clase>'.
 * opts: { behind, facing, asleep, lockpick: true|false|undefined }
 */
export function zoneFor(player, key, opts = {}) {
  let w = MINIGAME.zone[key] ?? 5;
  let sp = MINIGAME.speed[key] ?? 0.8;
  const d = getP(player);
  const lvl = thiefLevel(d);
  w *= 1 + 0.025 * (lvl - 1);
  sp *= 1 - Math.min(0.25, 0.008 * (lvl - 1));
  try {
    const agi = profile.stat?.(d, 'agi');
    if (typeof agi === 'number') w *= 1 + clamp(agi - 5, 0, 40) * 0.01;
  } catch {}
  try { if (profile.stageOf?.(d) === 'child') w *= 1.1; } catch {}
  if (opts.behind) w *= 1.5;
  else if (opts.facing) w *= 0.65;
  if (opts.asleep) { w *= 2; sp *= 0.8; }
  if (opts.lockpick === true) w *= 1.8;
  else if (opts.lockpick === false) w *= key === 'lock_alta' ? 0.55 : key === 'lock_media' ? 0.8 : 1;
  return { zone: clamp(w, 1.5, 14), speed: clamp(sp, 0.35, 1.4) };
}

/**
 * Inicia el minijuego: una aguja recorre la barra; el jugador debe SOLTAR agacharse con la aguja en la zona verde.
 * spec: { kind, label, victim?, anchor?, maxDist, zone, speed, exclude?:Set, onSuccess(g, seers), onFail(g, reason, seers), onAbort?(reason) }
 */
export function startMinigame(player, spec) {
  if (games.has(player.id)) return false;
  const cells = MINIGAME.cells;
  const w = clamp(spec.zone ?? 5, 1.5, 14);
  const c0 = rand(w / 2 + 4, cells - w / 2 - 3);
  const g = {
    player, pid: player.id, spec, t: 0, cells, armed: !spec.waitSneak,
    pos: rand(0, 2), dir: 1, speed: spec.speed ?? 0.8,
    zA: Math.round(c0 - w / 2), zB: Math.round(c0 + w / 2) - 1,
    watch: 0, seers: [],
  };
  if (g.zB < g.zA) g.zB = g.zA;
  games.set(player.id, g);
  // La víctima se queda distraída (casi quieta) mientras le metes la mano en el bolsillo.
  if (spec.victim) try { spec.victim.addEffect('slowness', MINIGAME.maxTicks + 20, { amplifier: 5, showParticles: false }); } catch {}
  if (gameLoop === undefined) {
    try { gameLoop = system.runInterval(gameTick, 1); } catch {}
  }
  psound(player, 'random.click', 0.4, 1.8);
  if (g.armed) render(g, true);
  return true;
}

export function cancelMinigame(player) {
  const g = games.get(player.id);
  if (g) endGame(g);
}

function endGame(g) {
  games.delete(g.pid);
  if (g.spec?.victim) try { if (valid(g.spec.victim)) g.spec.victim.removeEffect('slowness'); } catch {}
  if (!games.size && gameLoop !== undefined) {
    try { system.clearRun(gameLoop); } catch {}
    gameLoop = undefined;
  }
}

function gameTick() {
  for (const g of [...games.values()]) {
    try { stepGame(g); } catch (e) {
      console.warn('[Aetheria] minijuego: ' + e);
      endGame(g);
    }
  }
}

function abort(g, text, reason) {
  endGame(g);
  if (text) actionbar(g.player, text);
  try { g.spec.onAbort?.(reason); } catch (e) { console.warn('[Aetheria] minijuego abort: ' + e); }
}

function stepGame(g) {
  const p = g.player;
  if (!valid(p)) return endGame(g);
  const sp = g.spec;
  g.t++;
  if (sp.victim && !valid(sp.victim)) return abort(g, '§7Tu objetivo se ha esfumado.', 'gone');
  let anchor;
  try { anchor = sp.victim ? sp.victim.location : sp.anchor; } catch { return abort(g, '', 'gone'); }
  if (anchor && dist(p.location, anchor) > (sp.maxDist ?? 3.5)) return abort(g, `§7Demasiada distancia: tienes que estar ${gw(getP(p), 'pegado', 'pegada')} a tu objetivo. §8(Robo cancelado)`, 'far');
  if (isTied(p)) return abort(g, '', 'tied');
  let sneaking = false;
  try { sneaking = !!p.isSneaking; } catch {}
  if (sp.waitSneak && !g.armed) {
    // Empezó con la ganzúa en la mano: espera a que el jugador se agache.
    if (sneaking) { g.armed = true; g.t = 1; } else {
      if (g.t > 60) return abort(g, '§7Tienes que agacharte para trabajar la cerradura.', 'released');
      if (g.t % 4 === 1) actionbar(p, `${eyeText(g.watch, false)} §f${sp.label}\n§7Agáchate y mantén §fagacharse§7 para empezar...`);
      return;
    }
  }
  if (g.t <= MINIGAME.prepTicks) {
    if (!sneaking) return abort(g, '§7Te lo piensas mejor y apartas la mano.', 'released');
    if (g.t % 4 === 0) render(g, true);
    return;
  }
  if (!sneaking) {
    // Se evalúa antes de mover la aguja y se perdonan 2 ticks de latencia (la tecla se soltó antes de llegar aquí).
    const inZone = (x) => x !== undefined && Math.round(x) >= g.zA && Math.round(x) <= g.zB;
    const ok = inZone(g.pos) || inZone(g.p1) || inZone(g.p2);
    return finish(g, ok, ok ? 'ok' : 'miss');
  }
  if (g.t >= MINIGAME.maxTicks) return finish(g, false, 'timeout');
  g.p2 = g.p1;
  g.p1 = g.pos;
  g.pos += g.dir * g.speed;
  if (g.pos >= g.cells - 1) { g.pos = g.cells - 1; g.dir = -1; } else if (g.pos <= 0) { g.pos = 0; g.dir = 1; }
  if (g.t % 6 === 0) {
    const o = observe(p, { exclude: sp.exclude });
    g.seers = o.seers.filter((x) => !isFamilyOf(x.e, p));
    g.watch = g.seers.length ? 2 : o.aware.length ? 1 : 0;
  }
  render(g, false);
}

function finish(g, ok, reason) {
  endGame(g);
  const p = g.player;
  const o = observe(p, { exclude: g.spec.exclude });
  const seers = o.seers.filter((x) => !isFamilyOf(x.e, p));
  try {
    if (ok) g.spec.onSuccess?.(g, seers);
    else g.spec.onFail?.(g, reason, seers);
  } catch (e) { console.warn('[Aetheria] minijuego fin: ' + e + (e?.stack ? '\n' + e.stack : '')); }
}

const WATCH_TEXT = ['§2nadie mira', '§ealguien cerca', '§c¡te miran!'];

function render(g, prep) {
  const needle = Math.round(g.pos);
  let bar = '';
  let last = '';
  for (let i = 0; i < g.cells; i++) {
    if (!prep && i === needle) {
      bar += '§e§l|§r';
      last = '';
      continue;
    }
    const c = i >= g.zA && i <= g.zB ? '§a' : '§8';
    if (c !== last) { bar += c; last = c; }
    bar += '|';
  }
  const eye = eyeText(g.watch === 2 ? 2 : g.watch === 1 ? 1 : 0, false);
  const left = Math.max(0, Math.ceil((MINIGAME.maxTicks - g.t) / 20));
  const hint = prep ? '§7Metiendo la mano con cuidado...' : `§7Suelta §fagacharse§7 en la zona §averde §8(${left}s)`;
  actionbar(g.player, `${eye} §f${g.spec.label} §8· ${WATCH_TEXT[g.watch] ?? ''}\n§8[${bar}§8]\n${hint}`);
}

/* ------------------------------------------------------------------ */
/* Robo de bolsillos                                                   */
/* ------------------------------------------------------------------ */

const CLS_LABEL = { baja: '§7(clase baja)', media: '§f(clase media)', alta: `§6${GLYPH.crown} (nobleza)` };

function robbedToday(e) {
  try { return e.getDynamicProperty('rpg:robbed_day') === world.getDay(); } catch { return false; }
}

/** Sigilo + interactuar con un NPC. Devuelve true si empezó el minijuego. */
export function startPickpocket(player, target) {
  const d = getP(player);
  if (!d || games.has(player.id) || !valid(target)) return false;
  const ident = identOf(target);
  if (!ident) { actionbar(player, '§7No ves nada que robar.'); return false; }
  if (robbedToday(target)) { actionbar(player, `§7Ya le vaciaste los bolsillos a §f${ident.name}§7 hoy. Vuelve mañana.`); return false; }
  const guard = isGuard(target, ident);
  const cls = ['baja', 'media', 'alta'].includes(ident.cls) ? ident.cls : 'media';
  const rel = relativePos(target, player);
  const asleep = isAsleep(target);
  const z = zoneFor(player, guard ? 'guard' : cls, { behind: rel.behind, facing: rel.facing, asleep });
  let label = `Robando a ${ident.name} ${guard ? `§9${GLYPH.shield} (guardia)` : CLS_LABEL[cls]}`;
  label += asleep ? ` §b(${gw(ident, 'dormido', 'dormida')})` : rel.behind ? ' §a(de espaldas)' : rel.facing ? ' §c(te mira)' : '';
  return startMinigame(player, {
    kind: 'pocket', label, victim: target, maxDist: 3.5, zone: z.zone, speed: z.speed,
    exclude: new Set([target.id]),
    onSuccess: (g, seers) => pocketSuccess(player, target, seers),
    onFail: (g, reason) => pocketFail(player, target, reason),
  });
}

function giveLoot(player, list) {
  if (!list?.length) return '';
  const [id, a, b, name] = pick(list);
  let stack;
  try { stack = new ItemStack(id, randInt(a, b)); } catch { return ''; }
  return giveItem(player, stack) ? name : '';
}

function makeKey() {
  try {
    const k = new ItemStack('rpg:jail_key', 1);
    try { k.nameTag = '§6Llave de la celda'; } catch {}
    try { k.setLore(['§7Pesada, de hierro oxidado.', '§8Úsala junto a la puerta de una celda.']); } catch {}
    return k;
  } catch { return undefined; }
}

export function giveJailKey(player) {
  const k = makeKey();
  return k ? giveItem(player, k) : false;
}

function pocketSuccess(player, target, seers) {
  if (!valid(target) || !valid(player)) return;
  const d = getP(player);
  if (!d) return;
  const ident = identOf(target) ?? {};
  const cls = ['baja', 'media', 'alta'].includes(ident.cls) ? ident.cls : 'media';
  let wallet = typeof ident.wallet === 'number' ? ident.wallet : randInt(...(WALLET_DEFAULT[cls] ?? [5, 20]));
  const lvl = thiefLevel(d);
  const frac = clamp(rand(0.3, 0.6) + lvl * 0.01, 0.2, 0.9);
  const gold = wallet > 0 ? Math.max(1, Math.min(wallet, Math.round(wallet * frac))) : 0;
  ident.wallet = Math.max(0, wallet - gold);
  saveIdent(target, ident);
  try { target.setDynamicProperty('rpg:robbed_day', world.getDay()); } catch {}
  if (gold > 0) addGold(player, gold, true);
  let item = '';
  const job = ident.job ?? ident.role;
  if (job === 'carcelero') item = giveJailKey(player) ? 'la llave de las celdas' : '';
  else if (chance(0.35 + lvl * 0.005)) item = giveLoot(player, POCKET_ITEMS[job] ?? POCKET_ITEMS_DEFAULT);
  try {
    const l = target.location;
    particle(target.dimension, 'rpg:coins', { x: l.x, y: l.y + 0.9, z: l.z });
  } catch {}
  psound(player, 'random.orb', 0.5, 1.6);
  const t = thiefOf(d);
  t.steals++;
  t.gold += gold;
  addThiefXp(player, cls === 'alta' ? 12 : cls === 'media' ? 8 : 5);
  try { hooks.onTheft?.(player, 'pocket', gold, ident); } catch {}
  try { hooks.questProgress?.(player, 'steal', job ?? 'npc', 1); } catch {}
  const loot = `§6${gold} oro${item ? `§a y §f${item}` : ''}`;
  if (seers.length) {
    const w = seers.find((x) => isGuard(x.e)) ?? seers[0];
    msg(player, `§e✔ Le has birlado ${loot}§e a ${ident.name}... §c¡pero ${npcName(w.e)} lo ha visto todo!`);
    reportCrime(player, cls === 'alta' ? 'robo_noble' : 'hurto', { victim: target, witness: w.e, value: gold, victimName: ident.name });
    return;
  }
  actionbar(player, `${eyeText(0, false)} §a✔ Le has birlado ${loot}§a a ${ident.name}. Nadie se ha dado cuenta.`);
  msg(player, `§a✔ Robo limpio: ${loot}§a de ${ident.name}. §8(Sigilo ${thiefOf(d).lvl})`);
  addKarma(player, -2);
}

function pocketFail(player, target, reason) {
  if (!valid(player)) return;
  const d = getP(player);
  if (d) { thiefOf(d).caught++; addThiefXp(player, 2); }
  if (!valid(target)) return;
  const ident = identOf(target) ?? {};
  try { target.lookAt(player.getHeadLocation()); } catch {}
  let mood0;
  try { mood0 = target.getProperty('rpg:mood'); } catch {}
  try { target.setProperty('rpg:mood', 2); } catch {}
  // Si no sale corriendo a avisar (familia, fuera de la ley, guardia), el enfado se le pasa; si da la alarma,
  // la cara de enfado se la quita freeNpc al terminar.
  system.runTimeout(() => {
    try { if (valid(target) && !target.hasTag('rpg_busy') && target.getProperty('rpg:mood') === 2) target.setProperty('rpg:mood', typeof mood0 === 'number' && mood0 !== 2 ? mood0 : 0); } catch {}
  }, 100);
  try { target.setDynamicProperty('rpg:robbed_day', world.getDay()); } catch {} // ya está alerta: hoy no se deja
  if (isFamilyOf(target, player, ident)) {
    npcSay(target, gw(d, '¡Hijo! ¿¡Me estás robando a mí!? ¡Devuélvemelo ahora mismo!', '¡Hija! ¿¡Me estás robando a mí!? ¡Devuélvemelo ahora mismo!'));
    title(player, '§c' + EYE.OPEN, '§c¡Te han pillado!');
    return;
  }
  const lead = reason === 'timeout' ? `§7Te has ${gw(d, 'entretenido', 'entretenida')} demasiado... ` : '';
  npcSay(target, pick(VICTIM_NOTICE), { fem: d?.gender === 'f' });
  if (lead) msg(player, lead + `§c${ident.name} ha notado tu mano.`);
  reportCrime(player, ident.cls === 'alta' ? 'robo_noble' : 'hurto', { victim: target, witness: target, value: 0, victimName: ident.name });
}

/* ------------------------------------------------------------------ */
/* Robos en casas: cofres con dueño                                     */
/* ------------------------------------------------------------------ */

const unlocked = new Map(); // chestKey -> { pid, until }
const cofferDay = new Map(); // chestKey -> day
const CLS_CHEST = { baja: 'humilde', media: 'de artesano', alta: 'noble' };

function chestKey(dimId, c) {
  return `${dimId}|${c.x}|${c.y}|${c.z}`;
}

/** Cofre con dueño en esa posición (o el gemelo de un cofre doble). */
export function chestAt(dimId, loc) {
  const s = settlementAtLoc(dimId, loc);
  if (!s?.chests?.length) return undefined;
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  let chest = s.chests.find((c) => c.x === x && c.y === y && c.z === z);
  if (!chest) chest = s.chests.find((c) => c.y === y && Math.abs(c.x - x) + Math.abs(c.z - z) === 1);
  if (!chest) return undefined;
  const house = s.houses?.find((h) => h.id === chest.house);
  return { s, chest, house };
}

/** ¿Es la casa del jugador (o de su familia)? */
export function ownsHouse(player, d, house) {
  if (!house) return false;
  const o = house.owner;
  if (o && (o === player.id || o === d?.id)) return true;
  if (o && d?.family?.members?.some((m) => m.id === o)) return true;
  if (d?.homeId && d.homeId === house.id) return true;
  if (house.ownerPlayer && house.ownerPlayer === player.id) return true;
  return false;
}

/** Lógica de cofres ajenos para el before-event de interacción con bloques. Devuelve true si lo gestionó. */
export function onChestInteract(ev) {
  const player = ev.player;
  const b = ev.block;
  if (!player || !b) return false;
  let typeId;
  try { typeId = b.typeId; } catch { return false; }
  if (!/chest|barrel/.test(typeId) || typeId.includes('ender')) return false;
  let dimId;
  try { dimId = player.dimension.id; } catch { return false; }
  const info = chestAt(dimId, b.location);
  if (!info) return false;
  const d = getP(player);
  if (ownsHouse(player, d, info.house)) return false;
  const key = chestKey(dimId, info.chest);
  const cls = ['baja', 'media', 'alta'].includes(info.chest.cls) ? info.chest.cls : (info.house?.cls ?? 'media');
  const unl = unlocked.get(key);
  const open = cls === 'baja' || (unl && unl.pid === player.id && unl.until > system.currentTick);
  if (open) {
    if (ev.isFirstEvent !== false) system.run(() => { try { chestOpened(player, info, key, cls); } catch (e) { console.warn('[Aetheria] cofre: ' + e); } });
    return false;
  }
  ev.cancel = true;
  if (ev.isFirstEvent === false || games.has(player.id)) return true; // mantener pulsado no abre ni repite
  let sneaking = false;
  try { sneaking = !!player.isSneaking; } catch {}
  const holdingPick = ev.itemStack?.typeId === 'rpg:lockpick';
  system.run(() => {
    try {
      if (!sneaking && !holdingPick) {
        const pick2 = countItem(player, 'rpg:lockpick') > 0;
        actionbar(player, `§6${GLYPH.house} §7Cofre ${CLS_CHEST[cls]} cerrado con llave. §fAgáchate§7 y tócalo${pick2 ? ' (o tócalo con la §fganzúa§7 en la mano)' : ''} para forzar la cerradura${pick2 ? '.' : ' §8(una ganzúa ayudaría mucho)'}`);
      } else startLockpick(player, info, key, cls, !sneaking);
    } catch (e) { console.warn('[Aetheria] cerradura: ' + e); }
  });
  return true;
}

function chestCrime(cls) {
  return cls === 'alta' ? 'robo_noble' : 'robo_casa';
}

function cofferLoot(player, key, cls) {
  const day = world.getDay();
  if (cofferDay.get(key) === day) return '';
  cofferDay.set(key, day);
  if (cofferDay.size > 400) cofferDay.clear();
  const gold = randInt(...(COFFER_GOLD[cls] ?? [3, 10]));
  addGold(player, gold, true);
  const item = chance(0.4) ? giveLoot(player, COFFER_ITEMS[cls]) : '';
  try { hooks.onTheft?.(player, 'house', gold); } catch {}
  return `§6${gold} oro${item ? `§a y §f${item}` : ''}`;
}

function chestOpened(player, info, key, cls) {
  if (!valid(player)) return;
  const d = getP(player);
  const o = observe(player);
  const seers = o.seers.filter((x) => !isFamilyOf(x.e, player));
  if (seers.length) {
    const w = seers.find((x) => isGuard(x.e)) ?? seers[0];
    reportCrime(player, chestCrime(cls), { witness: w.e, settlement: info.s, victimName: 'los vecinos' });
    return;
  }
  const loot = cofferLoot(player, key, cls);
  if (loot && d) {
    thiefOf(d).houses++;
    addThiefXp(player, cls === 'alta' ? 10 : cls === 'media' ? 6 : 3);
    actionbar(player, `${eyeText(0, false)} §aRebuscas en silencio: ${loot}§a. Nadie te ha visto.`);
    addKarma(player, -2);
  }
}

function startLockpick(player, info, key, cls, waitSneak = false) {
  const has = countItem(player, 'rpg:lockpick') > 0;
  const z = zoneFor(player, 'lock_' + cls, { lockpick: has });
  const c = info.chest;
  startMinigame(player, {
    kind: 'lock', label: `Forzando un cofre ${CLS_CHEST[cls]}${has ? ' §8(con ganzúa)' : ' §8(a mano)'}`,
    anchor: { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, maxDist: 4.5, zone: z.zone, speed: z.speed,
    exclude: new Set(), waitSneak,
    onSuccess: (g, seers) => lockSuccess(player, info, key, cls, has, seers),
    onFail: (g, reason) => lockFail(player, info, cls, has, reason),
  });
}

function lockSuccess(player, info, key, cls, hadPick, seers) {
  if (!valid(player)) return;
  unlocked.set(key, { pid: player.id, until: system.currentTick + 1200 });
  if (unlocked.size > 200) for (const [k, v] of unlocked) if (v.until < system.currentTick) unlocked.delete(k);
  psound(player, 'random.door_open', 0.5, 1.8);
  let extra = '';
  if (hadPick && chance(0.25) && removeItem(player, 'rpg:lockpick', 1)) extra = ' §8(Tu ganzúa se ha doblado y la tiras.)';
  const d = getP(player);
  const loot = cofferLoot(player, key, cls);
  if (d) { thiefOf(d).houses++; addThiefXp(player, cls === 'alta' ? 16 : cls === 'media' ? 10 : 6); }
  if (seers.length) {
    const w = seers.find((x) => isGuard(x.e)) ?? seers[0];
    msg(player, `§e✔ ¡Clic! La cerradura cede${loot ? ': ' + loot : ''}§e... §c¡pero ${npcName(w.e)} te ha visto!${extra}`);
    reportCrime(player, chestCrime(cls), { witness: w.e, settlement: info.s, victimName: 'los vecinos' });
    return;
  }
  msg(player, `§a✔ ¡Clic! La cerradura cede.${loot ? ` Dentro de un calcetín escondido encuentras ${loot}§a.` : ''} §7Ahora puedes abrir el cofre.${extra}`);
  actionbar(player, `${eyeText(0, false)} §aCerradura abierta. §7Ábrelo antes de que alguien venga.`);
  addKarma(player, -2);
}

function lockFail(player, info, cls, hadPick, reason) {
  if (!valid(player)) return;
  const d = getP(player);
  if (d) { thiefOf(d).caught++; addThiefXp(player, 1); }
  let txt = reason === 'timeout' ? '§7Forcejeas demasiado tiempo con la cerradura. ' : '§7¡Clac! La ganzúa resbala con un chasquido. ';
  if (hadPick && chance(0.5) && removeItem(player, 'rpg:lockpick', 1)) txt += '§c¡Crac! Tu ganzúa se ha partido. ';
  psound(player, 'random.break', 0.5, 1.4);
  // El ruido alerta a quien esté cerca (aunque no mire).
  const o = observe(player, { rangeMult: 0.8 });
  const near = [...o.seers, ...o.aware.filter((x) => x.d <= 10)].filter((x) => !isFamilyOf(x.e, player)).sort((a, b) => a.d - b.d);
  if (near.length) {
    const w = near.find((x) => isGuard(x.e)) ?? near[0];
    msg(player, txt + `§c${npcName(w.e)} ha oído el ruido.`);
    try { w.e.lookAt(player.getHeadLocation()); } catch {}
    reportCrime(player, chestCrime(cls), { witness: w.e, settlement: info.s, victimName: 'los vecinos' });
    return;
  }
  msg(player, txt + '§8Nadie parece haberlo oído... esta vez.');
}

/* ------------------------------------------------------------------ */
/* Allanamiento: dentro de una casa ajena de noche                      */
/* ------------------------------------------------------------------ */

const trespassCd = new Map();

function inBox(l, min, max) {
  if (!min || !max) return false;
  const x0 = Math.min(min.x, max.x);
  const x1 = Math.max(min.x, max.x) + 1;
  const y0 = Math.min(min.y, max.y);
  const y1 = Math.max(min.y, max.y) + 1;
  const z0 = Math.min(min.z, max.z);
  const z1 = Math.max(min.z, max.z) + 1;
  return l.x >= x0 && l.x < x1 && l.y >= y0 - 0.5 && l.y < y1 && l.z >= z0 && l.z < z1;
}

function trespassTick(player, d, s) {
  if (!s?.houses?.length) return;
  const t = world.getTimeOfDay();
  if (t < 13000 || t > 23000) return;
  let l;
  try { l = player.location; } catch { return; }
  const h = s.houses.find((x) => inBox(l, x.min, x.max));
  if (!h || ownsHouse(player, d, h)) return;
  const key = player.id + '|' + h.id;
  const now = system.currentTick;
  if (now - (trespassCd.get(key) ?? -1e9) < law('trespassCooldown') * 20) return;
  const o = observe(player);
  const w = o.seers.filter((x) => !isFamilyOf(x.e, player))[0];
  if (!w) return;
  trespassCd.set(key, now);
  if (trespassCd.size > 300) trespassCd.clear();
  reportCrime(player, 'allanamiento', { witness: w.e, settlement: s });
}

/* ------------------------------------------------------------------ */
/* Testigos que corren a avisar a la guardia                           */
/* ------------------------------------------------------------------ */

// Las alarmas se copian en W().alarms: si el testigo se descarga (el jugador se aleja) o el mundo se cierra a mitad,
// la denuncia no se pierde (al agotarse el tiempo se presenta igual) y el testigo se libera al volver a cargarse.
const alarms = new Map(); // witnessId -> alarma
let alarmsLoaded = false;
let alarmsSaved = -1e9;
export const ALERT_PREFIX = '§c§l(!)§r\n';

/** Etiquetas de los NPCs que controla la justicia (además de rpg_busy). */
export const JUSTICE_TAGS = ['rpg_alarm', 'rpg_hunting', 'rpg_escort', 'rpg_jeer', 'rpg_jailer'];

const SEV_RANK = { trespass: 0, theft: 1, house: 1, violence: 2, escape: 2, murder: 3 };

/** Recupera las alarmas guardadas (tras recargar el mundo o los scripts). Nunca durante la ejecución temprana. */
function loadAlarms() {
  if (alarmsLoaded) return;
  alarmsLoaded = true;
  try {
    const list = W().alarms;
    if (!Array.isArray(list)) return;
    const now = system.currentTick;
    for (const r of list) {
      if (!r?.id || alarms.has(r.id) || !CRIMES[r.type]) continue;
      alarms.set(r.id, { ...r, e: undefined, el: Number(r.el) || 0, tk: now, last: now });
    }
  } catch {}
}

function saveAlarms() {
  alarmsSaved = system.currentTick;
  try {
    W().alarms = [...alarms.values()].map((a) => ({
      id: a.id, pid: a.pid, pname: a.pname, type: a.type, sid: a.sid, rid: a.rid, tag: a.tag, name: a.name,
      victimName: a.victimName, el: Math.round((a.el ?? 0) * 10) / 10,
    }));
    wDirty();
  } catch {}
}

function dropAlarm(id) {
  if (alarms.delete(id)) saveAlarms();
}

/** Entidad del testigo (vuelve a buscarla por id si su referencia quedó inválida al descargarse). */
function alarmEntity(a) {
  if (valid(a.e)) return a.e;
  let e;
  try { e = world.getEntity(a.id); } catch {}
  if (!valid(e)) return undefined;
  a.e = e;
  return e;
}

/** ¿Lo controla ahora mismo el crimen (testigo con alarma o guardia de caza)? */
export function isTracked(id) {
  loadAlarms();
  return alarms.has(id) || hunters.has(id);
}

/** Si el NPC es un testigo con una alarma guardada, vuelve a enlazarlo (sigue corriendo hacia la guardia). */
export function attachAlarm(e) {
  loadAlarms();
  let a;
  try { a = alarms.get(e.id); } catch { return false; }
  if (!a) return false;
  if (!valid(a.e) && valid(e)) a.e = e;
  return true;
}

/** Jugador al que persigue un guardia de caza (o undefined). */
export function hunterPid(id) {
  return hunters.get(id)?.pid;
}

/**
 * Devuelve un NPC a su vida normal: actividad libre, sin etiquetas de la justicia, sin "(!)" ni enfado, y sin
 * la marca de actividad de life.js para que vuelva a mandarle su horario. tags: etiquetas de la justicia a quitar.
 */
export function freeNpc(e, tags = JUSTICE_TAGS) {
  if (!valid(e)) return false;
  try { e.triggerEvent('rpg:act_idle'); } catch {}
  for (const t of tags) try { e.removeTag(t); } catch {}
  try { e.removeTag('rpg_busy'); } catch {}
  try { e.setProperty('rpg:alert', false); } catch {}
  try { e.setProperty('rpg:mood', 0); } catch {}
  try {
    // Quita la línea "(!)" sin pisar un nombre que otro sistema haya cambiado entretanto.
    const cur = e.nameTag ?? '';
    if (cur.startsWith(ALERT_PREFIX)) e.nameTag = cur.slice(ALERT_PREFIX.length);
  } catch {}
  try { e.setDynamicProperty('rpg:act', ''); } catch {}
  return true;
}

function startAlarm(player, witness, type, s, realm, ctx) {
  loadAlarms();
  const id = witness.id;
  const crime = CRIMES[type];
  const prev = alarms.get(id);
  if (prev && prev.pid === player.id) {
    if ((SEV_RANK[crime.kind] ?? 0) > (SEV_RANK[CRIMES[prev.type]?.kind] ?? 0)) { prev.type = type; saveAlarms(); }
    if (!valid(prev.e)) prev.e = witness;
    return prev;
  }
  if (prev) resetWitness(prev);
  // Un bocadillo de life.js en el nombre se borra antes de leerlo (si no, quedaría pegado bajo el "(!)").
  try { life.clearBubble?.(witness); } catch {}
  let tag = '';
  try { tag = witness.nameTag ?? ''; } catch {}
  if (tag.startsWith(ALERT_PREFIX)) tag = tag.slice(ALERT_PREFIX.length);
  const ident = identOf(witness);
  const now = system.currentTick;
  const a = {
    e: witness, id, pid: player.id, pname: player.name, type, el: 0, tk: now,
    sid: s?.id, rid: realm?.id ?? s?.realmId, tag, name: ident?.name ?? 'Alguien',
    victimName: ctx.victimName ?? (ctx.victim ? npcName(ctx.victim) : ''), last: now,
  };
  alarms.set(id, a);
  saveAlarms();
  try { witness.setProperty('rpg:alert', true); } catch {}
  try { witness.setProperty('rpg:mood', 2); } catch {}
  try { witness.nameTag = ALERT_PREFIX + tag; } catch {}
  try { witness.addTag('rpg_busy'); witness.addTag('rpg_alarm'); } catch {}
  try { witness.triggerEvent('rpg:act_alarm'); } catch {}
  npcSay(witness, pick(SHOUTS[crime.kind] ?? SHOUTS.theft), { victim: a.victimName || 'alguien', thief: player.name, fem: getP(player)?.gender === 'f' }, 40, '§c§l! §r§e');
  alarmFx(witness);
  markSeen(player, 140);
  title(player, '§c' + EYE.OPEN, `§e${a.name} §cte ha visto`);
  msg(player, `§c${EYE.OPEN} ¡Te han visto! §e${a.name}§c corre a avisar a la guardia. §7Si llega hasta un guardia, te buscarán.`);
  psound(player, 'note.bass', 1, 0.6);
  return a;
}

function alarmFx(e) {
  try {
    const h = e.getHeadLocation();
    particle(e.dimension, 'rpg:alarm', { x: h.x, y: h.y + 0.7, z: h.z });
  } catch {}
}

/** Fin de la alarma: el testigo vuelve a su vida (si no está cargado, lo libera la limpieza de justice.js al volver). */
function resetWitness(a) {
  dropAlarm(a.id);
  const e = alarmEntity(a);
  if (e) freeNpc(e, ['rpg_alarm']);
}

function fileReport(a, guard) {
  resetWitness(a);
  const crime = CRIMES[a.type];
  if (!crime) return;
  const player = playerById(a.pid);
  if (!player || !getP(player)) { queueReport(a); return; } // desconectado (o sin datos aún): se le aplicará al volver
  const s = getSettlementSafe(a.sid);
  const realm = realmOfSafe(s);
  const wIdent = valid(a.e) ? identOf(a.e) : undefined;
  if (valid(a.e)) npcSay(a.e, pick(REPORT_LINES), { thief: player.name, crime: crimeWithArticle(a.type), fem: getP(player)?.gender === 'f' }, 24);
  if (guard && valid(guard)) {
    npcSay(guard, pick(GUARD_ACK), { ciudadano: gw(wIdent, 'ciudadano', 'ciudadana') }, 24);
    startHunter(guard, player, false);
  }
  addStars(player, a.type, s, realm, a.name);
}

/** Denuncia contra un jugador desconectado: queda en W().pendingReports hasta que vuelva. */
function queueReport(a) {
  try {
    const w = W();
    if (!Array.isArray(w.pendingReports)) w.pendingReports = [];
    w.pendingReports.push({ pid: a.pid, type: a.type, sid: a.sid, rid: a.rid, name: a.name });
    if (w.pendingReports.length > 60) w.pendingReports.splice(0, w.pendingReports.length - 60);
    wDirty();
  } catch {}
}

function applyPendingReports(player) {
  let list;
  try { list = W().pendingReports; } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  const mine = list.filter((r) => r?.pid === player.id);
  if (!mine.length) return;
  W().pendingReports = list.filter((r) => r?.pid !== player.id);
  wDirty();
  for (const r of mine) {
    if (!CRIMES[r.type]) continue;
    const s = getSettlementSafe(r.sid);
    addStars(player, r.type, s, realmOfSafe(s) ?? (r.rid ? { id: r.rid } : undefined), r.name);
  }
}

function alarmTick() {
  loadAlarms();
  if (!alarms.size) return;
  const now = system.currentTick;
  for (const a of [...alarms.values()]) {
    try {
      a.el = (a.el ?? 0) + Math.max(0, now - (a.tk ?? now)) / 20;
      a.tk = now;
      const e = alarmEntity(a);
      if (!e) {
        // Testigo descargado: la alarma sigue; si se agota el tiempo, sus gritos acaban llegando a la guardia.
        if (a.el >= law('witnessTimeout')) fileReport(a, undefined);
        continue;
      }
      let guard;
      try {
        guard = e.dimension.getEntities({ type: NPC, families: ['rpg_guard'], location: e.location, maxDistance: 96, closest: 3 }).find((g) => g.id !== e.id);
      } catch {}
      if (guard && dist(guard.location, e.location) <= law('reportDistance') + 0.5) fileReport(a, guard);
      else if (a.el >= law('witnessTimeout')) fileReport(a, guard && dist(guard.location, e.location) <= 24 ? guard : undefined);
      else if (now - a.last >= 30) {
        a.last = now;
        alarmFx(e);
        if (chance(0.25)) npcSay(e, pick(['¡GUARDIAS!', '¡Al ladrón!', '¡Socorro!', '¡Que alguien me ayude!']), {}, 32, '§c§l! §r§e');
      }
    } catch (err) { console.warn('[Aetheria] alarma: ' + err); try { resetWitness(a); } catch {} }
  }
  if (alarms.size && now - alarmsSaved >= 40) saveAlarms(); // el tiempo transcurrido, cada 2 s
}

/* ------------------------------------------------------------------ */
/* Denuncias y estrellas                                               */
/* ------------------------------------------------------------------ */

export function inCustody(d) {
  const s = d?.justice?.state;
  return s === 'escort' || s === 'humiliation' || s === 'jail' || s === 'parley';
}

/**
 * Se ha cometido un delito.
 * ctx: { victim?, witness?, settlement?, value?, victimName?, known? (la guardia lo sabe de inmediato) }
 * Devuelve { witnessed, stars, immediate?, settlement, realm }.
 */
export function reportCrime(player, type, ctx = {}) {
  const crime = CRIMES[type];
  const info = { witnessed: false, stars: 0, settlement: undefined, realm: undefined };
  if (!crime || !valid(player)) return info;
  const d = getP(player);
  let s = getSettlementSafe(ctx.settlement);
  if (!s) { try { s = jurisdictionOf(player.dimension.id, player.location); } catch {} }
  const realm = realmOfSafe(s);
  info.settlement = s;
  info.realm = realm;
  info.victimName = ctx.victimName;
  info.value = ctx.value;
  if (crime.karma) addKarma(player, crime.karma, crime.name.toLowerCase());
  if (d) {
    d.record = d.record ?? {};
    d.record[type] = (d.record[type] ?? 0) + 1;
    dirty(player);
  }
  if (!s && !ctx.known) { emitCrime(player, type, info); return info; } // aquí no hay ley que valga
  let witness = ctx.witness && valid(ctx.witness) ? ctx.witness : undefined;
  if (witness && isFamilyOf(witness, player)) {
    npcSay(witness, gw(d, '¡Hijo mío! ¿Qué estás haciendo? ...No se lo diré a nadie, pero esto no está bien.', '¡Hija mía! ¿Qué estás haciendo? ...No se lo diré a nadie, pero esto no está bien.'));
    witness = undefined;
    if (!ctx.known) { emitCrime(player, type, info); return info; }
  }
  if (!witness && !ctx.known) {
    const ex = new Set();
    try { if (ctx.victim) ex.add(ctx.victim.id); } catch {}
    const o = observe(player, { exclude: ex });
    const cands = o.seers.filter((x) => !isFamilyOf(x.e, player));
    witness = (cands.find((x) => isGuard(x.e)) ?? cands[0])?.e;
  }
  if (!witness && !ctx.known) { emitCrime(player, type, info); return info; }
  info.witnessed = true;
  markSeen(player, 120);
  if (ctx.known || isGuard(witness)) {
    info.immediate = true;
    if (witness && isGuard(witness)) {
      startHunter(witness, player, true);
    }
    info.stars = addStars(player, type, s, realm, witness ? npcName(witness) : undefined);
  } else {
    startAlarm(player, witness, type, s, realm, ctx);
  }
  emitCrime(player, type, info);
  return info;
}

function emitCrime(player, type, info) {
  try { hooks.onCrime?.(player, type, { witnessed: info.witnessed, stars: info.stars, settlement: info.settlement, realm: info.realm, victimName: info.victimName, value: info.value }); } catch (e) { console.warn('[Aetheria] onCrime: ' + e); }
}

/** Suma estrellas de búsqueda (o alarga la condena si ya estás bajo custodia). */
export function addStars(player, type, s, realm, reporter) {
  const d = getP(player);
  const crime = CRIMES[type];
  if (!d || !crime) return 0;
  const add = crime.stars[strictnessOf(realm)] ?? 1;
  const j = d.justice;
  if (inCustody(d)) {
    j.crimes = [...(j.crimes ?? []), type].slice(-10);
    if (j.state === 'jail' || (j.state === 'escort' && j.kind === 'jail')) {
      // Prisión (o camino de ella): la condena se alarga ya.
      const secs = add * 120;
      if (typeof j.left === 'number') j.left += secs;
      if (typeof j.total === 'number') j.total += secs;
      msg(player, `§c✖ ${crime.name}: la guardia lo sabe y tu condena aumentará §f${add * 2} minutos§c.`);
    } else {
      // Cepo o negociación: al terminar, estas estrellas vuelven a ser búsqueda (justice.js, carryPending).
      j.pendingStars = (j.pendingStars ?? 0) + add;
      j.pendingCrimes = [...(j.pendingCrimes ?? []), type].slice(-10);
      msg(player, `§c✖ ${crime.name}: la guardia lo sabe. Cuando termine este castigo, también tendrás que responder por esto.`);
    }
    dirty(player);
    return add;
  }
  const w = d.wanted ?? (d.wanted = { stars: 0, crimes: [], decay: 0 });
  w.stars = clamp((w.stars ?? 0) + add, crime.min ?? 1, law('maxStars'));
  w.crimes = [...(w.crimes ?? []), type].slice(-10);
  if (s?.id) w.settlementId = s.id;
  const rid = realm?.id ?? s?.realmId;
  if (rid) w.realmId = rid;
  w.lastSeenTick = system.currentTick;
  w.decay = 0;
  w.severity = severityOf(w.stars);
  w.day = world.getDay();
  dirty(player);
  try { player.addTag('rpg_wanted'); } catch {}
  const place = s?.name ? ` en §f${s.name}§c` : '';
  title(player, '§c§lSE BUSCA', starText(w.stars));
  msg(player, `§c${EYE.OPEN} ${reporter ? `§e${reporter}§c te ha denunciado` : 'La guardia te busca'} por §f${crime.name.toLowerCase()}§c${place}. ${starText(w.stars)} §7(${SEVERITY_NAMES[w.severity]})`);
  psound(player, 'random.anvil_land', 0.35, 0.6);
  markSeen(player, 100);
  try { huntTick(player, d, true); } catch {}
  return add;
}

export function clearWanted(player, reason) {
  const d = getP(player);
  if (d?.wanted) { d.wanted = undefined; dirty(player); }
  try { player.removeTag('rpg_wanted'); } catch {}
  releaseHunters(player.id);
  if (reason === 'lost') {
    msg(player, `§a${EYE.CLOSED} ${LOST_TRAIL}`);
    title(player, '§a' + EYE.CLOSED, '§aYa no te buscan');
  }
}

/* ------------------------------------------------------------------ */
/* Guardias de caza                                                    */
/* ------------------------------------------------------------------ */

const hunters = new Map(); // guardId -> { e, pid, t0 }
const spotted = new Map(); // pid -> último tick en que un guardia te vio

export function startHunter(guard, player, shout) {
  if (!valid(guard) || !valid(player)) return;
  // Un guardia que escolta, pasea a un preso o hace la ronda de la cárcel no abandona su puesto;
  // y a quien ya está bajo custodia no se le persigue.
  try { if (guard.hasTag('rpg_escort') || guard.hasTag('rpg_jailer') || guard.hasTag('rpg_alarm')) return; } catch { return; }
  if (inCustody(getP(player))) return;
  const h = hunters.get(guard.id);
  if (h && h.pid === player.id) return;
  if (!h && huntersOf(player.id).length >= 6) return;
  hunters.set(guard.id, { e: guard, pid: player.id, t0: system.currentTick });
  try { guard.triggerEvent('rpg:act_hunt'); } catch {}
  try { guard.addTag('rpg_busy'); guard.addTag('rpg_hunting'); } catch {}
  try { guard.setProperty('rpg:mood', 2); } catch {}
  if (shout) {
    const d = getP(player);
    const realm = realmOfSafe(getSettlementSafe(d?.wanted?.settlementId));
    npcSay(guard, pick(HUNT_SHOUTS), { of: ofRuler(realm), thief: player.name, fem: d?.gender === 'f' }, 40);
  }
}

/** Libera a un guardia de la caza (vuelve a su rutina). */
export function releaseHunter(id, keepBusy = false) {
  const h = hunters.get(id);
  hunters.delete(id);
  // Sin cargar: la limpieza periódica de justice.js lo libera cuando vuelva (ya no está en el mapa).
  if (!h || !valid(h.e)) return;
  if (keepBusy) {
    try { h.e.removeTag('rpg_hunting'); } catch {}
    return;
  }
  freeNpc(h.e, ['rpg_hunting']);
}

export function releaseHunters(pid, exceptId) {
  for (const [id, h] of [...hunters]) if (h.pid === pid) releaseHunter(id, id === exceptId);
}

export function huntersOf(pid) {
  const out = [];
  for (const [id, h] of hunters) {
    if (h.pid !== pid) continue;
    if (valid(h.e)) out.push(h.e);
    else hunters.delete(id);
  }
  return out;
}

export function isHunting(guard, pid) {
  return hunters.get(guard.id)?.pid === pid;
}

/** Cada segundo para cada jugador buscado: los guardias del reino salen a por él; las estrellas se enfrían. */
export function huntTick(player, d, immediate = false) {
  const w = d.wanted;
  if (!w || (w.stars ?? 0) <= 0) { clearWanted(player); return; }
  try { if (!player.hasTag('rpg_wanted')) player.addTag('rpg_wanted'); } catch {}
  const guards = guardsNear(player.dimension, player.location, law('huntRadius'), w.realmId).filter((g) => {
    try { return !g.hasTag('rpg_escort') && !g.hasTag('rpg_jailer'); } catch { return true; }
  });
  let shouted = 0;
  for (const g of guards.slice(0, 6)) if (!hunters.has(g.id)) startHunter(g, player, shouted++ < 1 && (immediate || chance(0.6)));
  // Guardias demasiado lejos: vuelven a su puesto.
  for (const [id, h] of [...hunters]) {
    if (h.pid !== player.id) continue;
    try {
      if (!valid(h.e) || h.e.dimension.id !== player.dimension.id || dist(h.e.location, player.location) > law('huntRadius') * 1.5) releaseHunter(id);
    } catch { hunters.delete(id); }
  }
  if (immediate) return;
  const now = system.currentTick;
  const o = observe(player, { guardsOnly: true, max: 6 });
  if (o.seers.length) {
    w.lastSeenTick = now;
    w.decay = 0;
    spotted.set(player.id, now);
    for (const x of o.seers) if (!hunters.has(x.e.id) && realmOk(x.e, w.realmId)) startHunter(x.e, player, false);
    return;
  }
  const here = placeOf(player);
  if (here && (!w.realmId || here.realmId === w.realmId || !here.realmId)) return; // dentro de sus pueblos no se enfría
  w.decay = (w.decay ?? 0) + 1;
  if (w.decay >= law('decaySeconds')) {
    w.decay = 0;
    w.stars--;
    dirty(player);
    if (w.stars <= 0) return clearWanted(player, 'lost');
    w.severity = severityOf(w.stars);
    msg(player, `§e${EYE.HALF} ${pick(DECAY_LINES)} ${starText(w.stars)}`);
  }
}

function realmOk(guard, realmId) {
  if (!realmId) return true;
  const r = realmIdOfNpc(guard);
  return !r || r === realmId;
}

/* ------------------------------------------------------------------ */
/* Delitos de combate                                                   */
/* ------------------------------------------------------------------ */

const OUTLAW_JOBS = new Set(['ladron', 'sombra']);
const lastHit = new Map(); // npcId -> { pid, tick }
const aggroCd = new Map(); // npcId|pid -> tick

export function ownerPlayer(e) {
  if (!e) return undefined;
  let t;
  try { t = e.typeId; } catch { return undefined; }
  if (t === 'minecraft:player') return e;
  if (t === 'rpg:spirit') {
    try {
      const o = e.getDynamicProperty('rpg:owner');
      return o ? playerById(o) : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

export function onEntityHurt(ev) {
  const target = ev.hurtEntity;
  if (!isNpc(target)) return;
  const attacker = ownerPlayer(ev.damageSource?.damagingEntity);
  if (!attacker || (ev.damage ?? 0) <= 0) return;
  const now = system.currentTick;
  lastHit.set(target.id, { pid: attacker.id, tick: now });
  if (lastHit.size > 500) lastHit.clear();
  const ident = identOf(target);
  if (!ident || OUTLAW_JOBS.has(ident.job ?? ident.role)) return;
  if (!valid(target)) return; // murió del golpe: lo gestiona onEntityDie
  try { if ((target.getComponent('minecraft:health')?.currentValue ?? 1) <= 0) return; } catch {}
  const key = target.id + '|' + attacker.id;
  if (now - (aggroCd.get(key) ?? -1e9) < 400) return;
  aggroCd.set(key, now);
  if (aggroCd.size > 500) aggroCd.clear();
  if (isGuard(target, ident)) reportCrime(attacker, 'agresion_guardia', { victim: target, witness: target, known: true, victimName: ident.name });
  else reportCrime(attacker, 'agresion', { victim: target, witness: target, victimName: ident.name });
}

export function onEntityDie(ev) {
  const dead = ev.deadEntity;
  let type;
  try { type = dead.typeId; } catch { return; }
  if (type === 'minecraft:player') return onPlayerDied(dead);
  if (type !== NPC) return;
  let deadId;
  try { deadId = dead.id; } catch { return; }
  // (Si aún no se han cargado las alarmas guardadas no hay nada en memoria: al cargarlas, la de un testigo que ya no
  // existe se presenta al agotarse el tiempo, como la de uno descargado.)
  const a = alarmsLoaded ? alarms.get(deadId) : undefined;
  if (a) {
    dropAlarm(deadId);
    const p = playerById(a.pid);
    if (p) msg(p, `§8${a.name} ya no podrá contarle a nadie lo que vio...`);
  }
  if (hunters.has(deadId)) hunters.delete(deadId);
  guardRealm.delete(deadId);
  let killer = ownerPlayer(ev.damageSource?.damagingEntity);
  if (!killer) {
    const lh = lastHit.get(deadId);
    if (lh && system.currentTick - lh.tick < 200) killer = playerById(lh.pid);
  }
  lastHit.delete(deadId);
  if (!killer) return;
  const ident = identOf(dead);
  if (ident && OUTLAW_JOBS.has(ident.job ?? ident.role)) return;
  const name = ident?.name ?? 'alguien';
  if (isGuard(dead, ident)) reportCrime(killer, 'asesinato_guardia', { known: true, victimName: name });
  else reportCrime(killer, 'asesinato', { victim: dead, victimName: name });
}

function onPlayerDied(player) {
  const d = getP(player);
  if (!d || inCustody(d)) return;
  const w = d.wanted;
  if (!w || (w.stars ?? 0) <= 0) return;
  // Morir no borra los delitos (si no, una condena de 30 min se esquivaría muriendo unas cuantas veces):
  // solo los guardias que te perseguían vuelven a su puesto.
  releaseHunters(player.id);
  msg(player, `§7Los guardias que te perseguían vuelven a su puesto, pero sigues en busca y captura. ${starText(w.stars)}`);
}

/* ------------------------------------------------------------------ */
/* Bucles                                                              */
/* ------------------------------------------------------------------ */

/** Cada 2 ticks (desde justice.fastTick). */
export function crimeFastTick(n) {
  if (n % 5 === 0) alarmTick();
  if (n % 3 !== 0) return;
  let i = 0;
  for (const player of world.getAllPlayers()) {
    i++;
    if ((n / 3 + i) % 2 !== 0) continue; // cada jugador cada ~12 ticks
    try {
      const d = getP(player);
      if (!d || games.has(player.id)) continue;
      if (needsEye(player, d)) refreshEye(player);
    } catch {}
  }
}

/** Cada segundo (desde justice.secondTick). */
export function crimeSecondTick() {
  const now = system.currentTick;
  for (const player of world.getAllPlayers()) {
    try {
      const d = getP(player);
      if (!d) continue;
      applyPendingReports(player);
      const s = placeOf(player);
      if (!inCustody(d) && d.justice?.state !== 'escaped') {
        if ((d.wanted?.stars ?? 0) > 0) huntTick(player, d);
        else if (player.hasTag('rpg_wanted')) clearWanted(player);
        if (s) trespassTick(player, d, s);
      }
      if ((spotted.get(player.id) ?? -1e9) > now - 40) markSeen(player, 30);
    } catch (e) { console.warn('[Aetheria] crimen: ' + e); }
  }
  // Guardias de caza sin presa válida.
  for (const [id, h] of [...hunters]) {
    const p = playerById(h.pid);
    const d = p && getP(p);
    if (!p || !d?.wanted?.stars || inCustody(d)) releaseHunter(id);
  }
  if (seenUntil.size > 100) for (const [k, v] of seenUntil) if (v < now) seenUntil.delete(k);
  if (placeCache.size > 200) placeCache.clear();
}

/** Olvida datos de sesión de un jugador (al salir). */
export function forgetPlayer(player) {
  const g = games.get(player.id);
  if (g) endGame(g);
  placeCache.delete(player.id);
  eyeCache.delete(player.id);
  seenUntil.delete(player.id);
  spotted.delete(player.id);
}

function isTied(player) {
  try { return player.hasTag('rpg_tied'); } catch { return false; }
}

/** Acceso para pruebas. */
export const _t = {
  games, alarms, hunters, unlocked, eyeCache, seenUntil, placeCache, lastHit,
  /** Simula una recarga de los scripts: se pierde lo que solo vivía en memoria. */
  reload() { alarms.clear(); hunters.clear(); alarmsLoaded = false; },
};
