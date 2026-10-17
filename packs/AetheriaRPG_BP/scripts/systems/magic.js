// Motor de magia (v2): lanza las 600 habilidades (12 elementos × 50), las habilidades raciales y los
// hechizos de los enemigos.
//
// * Proyectiles reales (systems/spellfx.js): orbes que salen de la mano, viajan varios bloques por tick,
//   chocan con muros y entidades, se curvan suavemente hacia el enemigo apuntado y estallan con la
//   partícula rpg:fx_<elemento>. El Haz perforante atraviesa a todos los enemigos en línea.
// * Estados elementales y REACCIONES (data/elements.js → STATUSES / REACTIONS): cada elemento deja un
//   estado temporal (mojado, ardiendo, congelado…); si otro elemento golpea ese estado se produce una
//   reacción con nombre (Electrocución, Derretir, Vapor, Plaga…) con efectos extra.
// * Respuesta visual: círculo mágico bajo el lanzador, sacudida de cámara (comando camerashake) en los
//   hechizos de área de nivel ≥ IV y en los legendarios, título enorme para los de nivel V, auras de
//   potenciación persistentes, arcos eléctricos entre objetivos, dominios con anillo visible y lluvias
//   de proyectiles que caen del cielo.
// * enemyCast(): el mismo motor para jefes y magos oscuros; daña a jugadores y a sus espíritus, nunca a NPCs.
//
// API pública estable: castSelected, cycleSlot, castSkill, castRacial, manaTick, slotInfo, cooldownLeft,
// spellPower, isEnemy, hooks. Nuevas: markTarget, enemyCast, onEntityHurt, statusesOf, statusLine…
import { world, system } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addMagicXp, msg, actionbar } from '../core/progression.js';
import { stat, magicRank, maxMana, manaRegen, affinity, stageMult, isHero, isVillain, g } from '../core/profile.js';
import { ELEMENTS, STATUSES, ELEMENT_STATUS, REACTIONS, OFFENSIVE_AURA, findReaction, getSkill, reactionGuide } from '../data/elements.js';
import { raceOf } from '../data/races.js';
import { MOBS, BOSSES } from '../data/mobs.js';
import { knockback, effect, damage, heal, hpOf, valid, heldItem, health, getBlock, isSolid } from '../util/compat.js';
import { add, mul, sub, norm, flatDir, dist, rand, randInt, clamp } from '../util/math.js';
import * as fx from './spellfx.js';
import { markTarget as markForSpirits, spawnSummon as defaultSpawnSummon } from './summons.js';

/**
 * Ganchos que conecta main.js:
 *  questProgress(player, type, key, n)  · spawnSummon(player, el, skill, loc, tier, power)
 *  onReaction(player, reaction, target) · onCast(player, skill)
 */
export const hooks = { questProgress: undefined, spawnSummon: undefined, onReaction: undefined, onCast: undefined };

const cooldowns = new Map(); // playerId -> Map(key -> tick)

/* ------------------------------------------------------------------ */
/* Objetivos                                                            */
/* ------------------------------------------------------------------ */
const NON_TARGET = new Set([
  'minecraft:item', 'minecraft:xp_orb', 'minecraft:arrow', 'minecraft:snowball', 'minecraft:egg', 'minecraft:painting', 'minecraft:armor_stand',
  'minecraft:leash_knot', 'minecraft:minecart', 'minecraft:boat', 'minecraft:chest_boat', 'minecraft:falling_block', 'minecraft:tnt',
  'minecraft:fireworks_rocket', 'minecraft:lightning_bolt', 'minecraft:area_effect_cloud', 'minecraft:ender_crystal', 'minecraft:fishing_hook',
  'minecraft:thrown_trident', 'minecraft:small_fireball', 'minecraft:fireball', 'minecraft:wind_charge_projectile', 'minecraft:xp_bottle',
  'minecraft:splash_potion', 'minecraft:lingering_potion', 'minecraft:ender_pearl', 'minecraft:eye_of_ender_signal', 'minecraft:shulker_bullet',
  'rpg:spirit', 'rpg:npc', 'rpg:waypoint', 'rpg:tomato',
]);
const VILLAGER_LIKE = new Set(['minecraft:villager_v2', 'minecraft:villager', 'minecraft:wandering_trader', 'minecraft:iron_golem', 'minecraft:snow_golem']);

/** ¿Puede el hechizo de un jugador dañar a esta entidad? (nunca NPCs, aliados ni marcadores). */
export function isEnemy(caster, e, d) {
  try {
    if (!e || !e.isValid || e.id === caster?.id) return false;
    const t = e.typeId;
    if (NON_TARGET.has(t)) return false;
    if (e.hasTag('rpg_ally') || e.hasTag('rpg_wp')) return false;
    if (t === 'minecraft:player') return !!cfg('magicPvP') && !!d;
    if (VILLAGER_LIKE.has(t)) return d ? (d.karma ?? 0) <= -100 : false;
    if (e.getComponent('minecraft:is_tamed')) return false;
    return !!e.getComponent('minecraft:health');
  } catch {
    return false;
  }
}

/** ¿Puede el hechizo de un enemigo (jefe, mago oscuro) dañar a esta entidad? Jugadores y sus espíritus. */
export function isFoeOfMonster(caster, e) {
  try {
    if (!e || !e.isValid || e.id === caster?.id) return false;
    const t = e.typeId;
    if (t === 'minecraft:player') {
      let mode = '';
      try { mode = String(e.getGameMode()).toLowerCase(); } catch {}
      return mode !== 'creative' && mode !== 'spectator';
    }
    return t === 'rpg:spirit';
  } catch {
    return false;
  }
}

export function isUndead(e) {
  try {
    const t = e.typeId;
    return !!(MOBS[t]?.undead || BOSSES[t]?.undead) || /skeleton|zombie|wither|phantom|drowned|husk|stray|zoglin|wraith|lich|bogged/.test(t);
  } catch { return false; }
}

const bossCache = new Map();
export function isBoss(e) {
  try {
    const t = e.typeId;
    if (bossCache.has(t)) return bossCache.get(t);
    let b = !!BOSSES[t] || (MOBS[t]?.rank ?? 0) >= 7;
    if (!b) { try { b = !!e.getComponent('minecraft:type_family')?.hasTypeFamily('rpg_boss'); } catch {} }
    if (bossCache.size > 256) bossCache.clear();
    bossCache.set(t, b);
    return b;
  } catch { return false; }
}

function isPlayer(e) {
  try { return e?.typeId === 'minecraft:player'; } catch { return false; }
}

const SKIP_TYPES = ['minecraft:item', 'minecraft:xp_orb', 'rpg:npc', 'rpg:waypoint'];

export function enemiesNear(caster, loc, radius, d) {
  let dim;
  try { dim = caster.dimension; } catch { return []; }
  return fx.queryEntities(dim, { location: loc, maxDistance: radius, excludeTypes: SKIP_TYPES }).filter((e) => isEnemy(caster, e, d));
}

function foesOfMonsterNear(caster, dim, loc, radius) {
  return fx.queryEntities(dim, { location: loc, maxDistance: radius, excludeTypes: SKIP_TYPES }).filter((e) => isFoeOfMonster(caster, e));
}

/** Objetivo hacia donde mira el jugador: entidad o punto del bloque. */
export function lookTarget(player, range, d) {
  const head = player.getHeadLocation();
  const dir = player.getViewDirection();
  let entity;
  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance: range });
    entity = hits.map((h) => h.entity).find((e) => isEnemy(player, e, d));
  } catch {}
  let point;
  try {
    const bh = player.getBlockFromViewDirection({ maxDistance: range, includeLiquidBlocks: false, includePassableBlocks: false });
    if (bh) point = add(bh.block.location, bh.faceLocation);
  } catch {}
  if (entity) point = { x: entity.location.x, y: entity.location.y + 0.8, z: entity.location.z };
  if (!point) point = add(head, mul(dir, range));
  return { entity, point, head, dir };
}

/* ------------------------------------------------------------------ */
/* Poder                                                                */
/* ------------------------------------------------------------------ */
/**
 * Poder final de un hechizo. v2: la Inteligencia escala con rendimientos decrecientes (raíz cuadrada):
 * +25 % con 6 puntos, +45 % con 20, +100 % con 100, para que el nivel V sea espectacular sin ser invencible.
 */
export function spellPower(player, d, elId, base) {
  const race = raceOf(d.race);
  const intel = Math.max(0, stat(d, 'int') - 5);
  let p = base * (1 + Math.sqrt(intel) * 0.1) * (1 + magicRank(d) * 0.1) * affinity(d, elId) * (race.magic ?? 1) * stageMult(d);
  if (isHero(d) && ['luz', 'naturaleza', 'agua'].includes(elId)) p *= 1.1;
  if (isVillain(d) && ['oscuridad', 'necromancia', 'sangre'].includes(elId)) p *= 1.15;
  const held = heldItem(player)?.typeId;
  if (held === 'rpg:staff_apprentice') p *= 1.15;
  if (held === 'rpg:staff_archmage') p *= 1.35;
  return p;
}

function critChance(d) {
  if (!d) return 0;
  return 0.05 + Math.min(0.1, Math.max(0, stat(d, 'int') - 5) * 0.001);
}

/**
 * Tope contra jefes: un impacto nunca supera el 10 % de su vida máxima (5 % si es de área) y un mismo
 * lanzamiento (todas sus oleadas, pulsos y meteoritos) nunca supera el 25 %. Así el nivel V es
 * espectacular pero no gana un combate de jefe de un solo hechizo.
 */
const BOSS_HIT = 0.1;
const BOSS_HIT_AREA = 0.05;
const BOSS_CAST = 0.25;
function capBoss(ctx, target, dmg, multi) {
  if (!isBoss(target)) return dmg;
  const h = hpOf(target);
  if (!h.max) return dmg;
  let c = Math.min(dmg, h.max * (multi ? BOSS_HIT_AREA : BOSS_HIT));
  if (ctx.bossTotals) {
    const used = ctx.bossTotals.get(target.id) ?? 0;
    c = Math.max(0, Math.min(c, h.max * BOSS_CAST - used));
    ctx.bossTotals.set(target.id, used + c);
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* Estados elementales                                                  */
/* ------------------------------------------------------------------ */
const ST = new Map(); // entityId -> { e, s: Map(statusId -> { until, el, src, srcE, dps, from, deep }) }
const MAX_TRACKED = 300;

/** Ids de los estados activos de una entidad. */
export function statusIds(e) {
  let r;
  try { r = ST.get(e?.id); } catch { return []; }
  if (!r) return [];
  const now = system.currentTick;
  const out = [];
  for (const [id, s] of r.s) if (s.until > now) out.push(id);
  return out;
}

export function hasStatus(e, id) {
  try {
    const s = ST.get(e?.id)?.s.get(id);
    return !!s && s.until > system.currentTick;
  } catch { return false; }
}

/** Aplica (o prolonga) un estado elemental. info: { el, src, srcE, dps, from, deep }. */
export function addStatus(e, id, ticks, info = {}) {
  if (!valid(e) || !STATUSES[id]) return false;
  let r = ST.get(e.id);
  if (!r) {
    if (ST.size >= MAX_TRACKED) {
      const first = ST.keys().next().value;
      ST.delete(first);
    }
    r = { e, s: new Map() };
    ST.set(e.id, r);
  }
  r.e = e;
  const now = system.currentTick;
  const cur = r.s.get(id);
  const until = now + Math.max(10, Math.round(ticks ?? STATUSES[id].ticks));
  r.s.set(id, { ...(cur && cur.until > now ? cur : {}), ...info, until: Math.max(until, cur?.until ?? 0) });
  fx.ticker('magic:status', 5, statusTick);
  return true;
}

export function removeStatus(e, id) {
  try {
    const r = ST.get(e?.id);
    if (!r) return false;
    const ok = r.s.delete(id);
    if (!r.s.size) ST.delete(e.id);
    return ok;
  } catch { return false; }
}

export function clearStatuses(e) {
  try { ST.delete(e?.id); } catch {}
}

/** Estados activos con nombre y segundos restantes (para el HUD / menús). */
export function statusesOf(e) {
  const now = system.currentTick;
  const r = ST.get(e?.id);
  if (!r) return [];
  const out = [];
  for (const [id, s] of r.s) {
    if (s.until <= now) continue;
    const def = STATUSES[id];
    out.push({ id, name: def.name, c: def.c, sym: def.sym, rgb: def.rgb, left: Math.ceil((s.until - now) / 20) });
  }
  return out;
}

/** Línea corta de estados (p. ej. "§9☂ Mojado §c♨ Ardiendo") o '' si no tiene ninguno. */
export function statusLine(e, withNames = true) {
  return statusesOf(e).map((s) => `${s.c}${s.sym}${withNames ? ' ' + s.name : ''}`).join(' ');
}

let statusPass = 0;
function statusTick(now) {
  statusPass++;
  const icons = statusPass % 2 === 0; // cada 10 ticks
  let shown = 0;
  for (const [id, r] of ST) {
    const e = r.e;
    if (!valid(e)) { ST.delete(id); continue; }
    let loc;
    try { loc = e.location; } catch { ST.delete(id); continue; }
    let k = 0;
    for (const [sid, s] of r.s) {
      if (s.until <= now) { r.s.delete(sid); continue; }
      try { tickStatus(e, sid, s, now, loc, icons); } catch {}
      // icono flotante del estado (máx. 3 por entidad, 32 entidades por pasada)
      if (icons && k < 3 && shown < 32) {
        const a = now * 0.25 + k * 2.1;
        fx.px(e.dimension, 'rpg:spark', { x: loc.x + Math.cos(a) * 0.45, y: loc.y + headY(e) + 0.35, z: loc.z + Math.sin(a) * 0.45 }, STATUSES[sid].rgb);
        k++;
      }
      if (!valid(e)) break;
    }
    if (k) shown++;
    if (!r.s.size) ST.delete(id);
  }
  return ST.size > 0;
}

function headY(e) {
  try {
    const b = fx.bodyOf(e);
    return b.y1 - e.location.y;
  } catch { return 1.8; }
}

function tickStatus(e, sid, s, now, loc, slow) {
  const player = isPlayer(e);
  switch (sid) {
    case 'sangrando':
      if (s.dps && now >= (s.nextDot ?? 0)) {
        s.nextDot = now + 20;
        damage(e, s.dps, valid(s.srcE) ? s.srcE : undefined, 'magic');
        fx.px(e.dimension, 'rpg:spark', { x: loc.x, y: loc.y + 1, z: loc.z }, [0.75, 0, 0.05]);
      }
      break;
    case 'enraizado':
      if (!player) { try { e.clearVelocity(); } catch {} }
      if (slow) fx.px(e.dimension, 'minecraft:villager_happy', { x: loc.x, y: loc.y + 0.2, z: loc.z });
      break;
    case 'congelado':
      if (s.deep) {
        if (!player) { try { e.clearVelocity(); } catch {} }
        if (slow) fx.px(e.dimension, 'minecraft:snowflake_particle', { x: loc.x, y: loc.y + 1, z: loc.z });
      }
      break;
    case 'aterrado': {
      if (!s.from) break;
      const dx = loc.x - s.from.x;
      const dz = loc.z - s.from.z;
      const l = Math.hypot(dx, dz) || 1;
      if (player) {
        if (slow) knockback(e, dx / l, dz / l, 0.35, 0.05);
      } else {
        try { e.applyImpulse({ x: (dx / l) * 0.22, y: 0, z: (dz / l) * 0.22 }); } catch {}
        try { e.lookAt({ x: loc.x + dx / l * 4, y: loc.y + 1, z: loc.z + dz / l * 4 }); } catch {}
      }
      if (slow) fx.px(e.dimension, 'rpg:spark', { x: loc.x, y: loc.y + headY(e) + 0.5, z: loc.z }, [0.25, 0.05, 0.35]);
      break;
    }
    case 'aturdido':
      if (s.deep && slow) fx.ring(e.dimension, { x: loc.x, y: loc.y + headY(e) + 0.1, z: loc.z }, 0.4, [1, 0.9, 0.3], 6);
      break;
    case 'electrizado':
      if (slow && statusPass % 4 === 0) fx.px(e.dimension, 'minecraft:electric_spark_particle', { x: loc.x, y: loc.y + 1, z: loc.z });
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Contexto de lanzamiento                                              */
/* ------------------------------------------------------------------ */
function elementOf(elId) {
  const base = ELEMENTS[elId];
  return base ? { ...base, id: elId } : undefined;
}

function headOf(e) {
  try { return e.getHeadLocation(); } catch {}
  try { return { x: e.location.x, y: e.location.y + 1.5, z: e.location.z }; } catch { return undefined; }
}

/** Contexto de un hechizo lanzado por un jugador. */
function playerCtx(player, d, s, elId) {
  const el = elementOf(elId);
  const head = player.getHeadLocation();
  const dir = player.getViewDirection();
  return {
    caster: player, player, d, el, elId, s, tier: s.tier ?? 0, enemy: false, depth: 0, bossTotals: new Map(),
    power: spellPower(player, d, elId, s.power ?? 5),
    dim: player.dimension, head, dir, hand: fx.handPos(player) ?? head, crit: critChance(d),
    filter: (e) => isEnemy(player, e, d),
    foes: (loc, r) => enemiesNear(player, loc, r, d),
  };
}

/** Contexto de un hechizo lanzado por un enemigo hacia `target` (entidad o punto). */
function enemyCtx(caster, elId, s, power, target) {
  const el = elementOf(elId);
  const dim = caster.dimension;
  const head = headOf(caster);
  if (!head) return undefined;
  let tEntity;
  let tPoint;
  if (target && typeof target === 'object' && 'typeId' in target) {
    if (!valid(target)) return undefined;
    tEntity = target;
    tPoint = fx.bodyCenter(target) ?? target.location;
  } else if (target && typeof target.x === 'number') {
    tPoint = { x: target.x, y: target.y, z: target.z };
  } else {
    let v;
    try { v = caster.getViewDirection(); } catch { v = { x: 0, y: 0, z: 1 }; }
    tPoint = add(head, mul(v, s.range));
  }
  let dir = norm(sub(tPoint, head));
  if (!(Math.hypot(dir.x, dir.y, dir.z) > 0)) dir = { x: 0, y: 0, z: 1 };
  const hand = { x: head.x + dir.x * 0.8, y: head.y - 0.25 + dir.y * 0.8, z: head.z + dir.z * 0.8 };
  return {
    caster, player: undefined, d: undefined, el, elId, s, tier: s.tier ?? 1, enemy: true, depth: 0,
    power: Math.max(0.5, Number(power) || 6), dim, head, dir, hand, crit: 0,
    target: tEntity, targetPoint: tPoint,
    filter: (e) => isFoeOfMonster(caster, e),
    foes: (loc, r) => foesOfMonsterNear(caster, dim, loc, r),
  };
}

function handOf(ctx) {
  if (!valid(ctx.caster)) return ctx.hand;
  if (ctx.enemy) {
    const h = headOf(ctx.caster);
    if (!h) return ctx.hand;
    if (ctx.target && valid(ctx.target)) {
      const c = fx.bodyCenter(ctx.target);
      if (c) ctx.dir = norm(sub(c, h));
    }
    return { x: h.x + ctx.dir.x * 0.8, y: h.y - 0.25 + ctx.dir.y * 0.8, z: h.z + ctx.dir.z * 0.8 };
  }
  return fx.handPos(ctx.caster) ?? ctx.hand;
}

function rotateYaw(v, deg) {
  if (!deg) return v;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return norm({ x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c });
}

const AIM_COS = 0.965; // ~15° de cono para el autoapuntado suave
/** Autoapuntado suave: enemigo más cercano a la mira dentro de un cono estrecho y con línea de visión. */
function autoAim(ctx, range, cone = AIM_COS) {
  if (ctx.enemy) return { dir: ctx.dir, target: ctx.target };
  const dir = ctx.dir;
  const head = ctx.head;
  let list = [];
  try { list = ctx.foes(add(head, mul(dir, range / 2)), range / 2 + 2); } catch {}
  let best;
  let bestC;
  let bestScore = Infinity;
  for (let i = 0; i < list.length && i < 32; i++) {
    const e = list[i];
    const c = fx.bodyCenter(e);
    if (!c) continue;
    const v = sub(c, head);
    const l = Math.hypot(v.x, v.y, v.z);
    if (l < 0.5 || l > range) continue;
    const cos = (v.x * dir.x + v.y * dir.y + v.z * dir.z) / l;
    if (cos < cone) continue;
    const score = (1 - cos) * 60 + l * 0.04;
    if (score < bestScore) { best = e; bestC = c; bestScore = score; }
  }
  if (!best) return { dir, target: undefined };
  const to = sub(bestC, head);
  const l = Math.hypot(to.x, to.y, to.z);
  const blocked = fx.rayBlock(ctx.dim, head, norm(to), Math.max(0.1, l - 0.6));
  if (blocked) return { dir, target: undefined };
  const want = norm(sub(bestC, ctx.hand));
  return { dir: norm(add(mul(dir, 0.3), mul(want, 0.7))), target: best };
}

function aimPoint(ctx, range) {
  if (ctx.enemy) return ctx.targetPoint ?? add(ctx.head, mul(ctx.dir, range));
  try { return lookTarget(ctx.player, range, ctx.d).point; } catch { return add(ctx.head, mul(ctx.dir, range)); }
}

function grounded(dim, p, depth = 30) {
  return { x: p.x, y: fx.groundAt(dim, p, depth), z: p.z };
}

/* ------------------------------------------------------------------ */
/* Impactos, estados y reacciones                                       */
/* ------------------------------------------------------------------ */
/** Efectos inmediatos del elemento y su estado. o: { strong, noStatus, statusMul, knock } */
function applyElement(ctx, target, o = {}) {
  const { el, tier } = ctx;
  const strong = !!o.strong;
  const s = strong ? 2 : 1;
  const boss = isBoss(target);
  const k = boss ? 0.5 : 1;
  switch (el.status) {
    case 'burn': try { target.setOnFire(Math.max(1, Math.round((2 + tier + (strong ? 3 : 0)) * k)), true); } catch {} break;
    case 'soak': effect(target, 'slowness', (40 * s + tier * 20) * k, strong ? 2 : 0); try { target.extinguishFire(true); } catch {} break;
    case 'stun': effect(target, 'slowness', (20 * s + tier * 10) * k, strong ? 4 : 2); if (!boss) knockback(target, 0, 0, 0, 0.3); break;
    case 'gust': {
      if (boss) break;
      const c = ctx.caster?.isValid ? ctx.caster.location : ctx.hand;
      const dx = target.location.x - c.x;
      const dz = target.location.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      const f = o.secondary ? 0.3 : 1; // pulsos de dominio, auras y cadenas solo zarandean
      knockback(target, dx / l, dz / l, (1.0 + tier * 0.25 + (strong ? 0.6 : 0)) * f, (0.45 + (strong ? 0.25 : 0)) * f);
      break;
    }
    case 'freeze': effect(target, 'slowness', (40 * s + tier * 15) * k, strong ? 3 : 1); effect(target, 'mining_fatigue', 60, 1); break;
    case 'holy': if (isUndead(target)) effect(target, 'weakness', 100, 1); break;
    case 'blind': effect(target, 'blindness', 40 * s + tier * 10, 0); effect(target, 'weakness', 60 * s, strong ? 1 : 0); break;
    case 'wither': effect(target, 'wither', 40 * s + tier * 20, strong ? 1 : 0); break;
    case 'poison': effect(target, 'poison', 60 * s + tier * 20, strong ? 1 : 0); effect(target, 'slowness', 30, 0); break;
    case 'arcane': if (!boss) effect(target, 'levitation', strong ? 30 : 12, 0); break;
  }
  if (o.knock && !boss && valid(target)) {
    const dx = target.location.x - ctx.hand.x;
    const dz = target.location.z - ctx.hand.z;
    const l = Math.hypot(dx, dz) || 1;
    knockback(target, dx / l, dz / l, o.knock, 0.2);
  }
  const sid = ELEMENT_STATUS[ctx.elId];
  if (sid && !o.noStatus) {
    const ticks = STATUSES[sid].ticks * (strong ? 1.6 : 1) * (1 + tier * 0.08) * (o.statusMul ?? 1);
    const info = { el: ctx.elId, src: ctx.caster?.id, srcE: ctx.caster };
    if (sid === 'sangrando') info.dps = Math.round(Math.max(0.5, 0.8 + tier * 0.4 + ctx.power * 0.04) * 10) / 10;
    addStatus(target, sid, ticks, info);
  }
}

/**
 * Golpe mágico de `amount` a `target` con todo el motor: reacción, crítico, estado, robo de vida,
 * efectos visuales, marca para los espíritus y salto de cadena.
 * o: { strong, mult, multi (área: tope de jefe 5 %), secondary (sin crítico ni cadena), noReact,
 *      noStatus, noChain, statusMul, knock, quiet (sin efectos de impacto) }
 */
function strike(ctx, target, amount, o = {}) {
  if (!valid(target) || !(amount > 0)) return undefined;
  const el = ctx.el;
  let mult = o.mult ?? 1;
  let reaction;
  if (!o.noReact && !ctx.depth) {
    reaction = findReaction(ctx.elId, statusIds(target));
    if (reaction) mult *= reaction.mult;
  }
  if (el.status === 'holy' && isUndead(target)) mult *= 2;
  if (el.status === 'arcane') mult *= 1.15;
  let crit = false;
  if (ctx.crit && !o.secondary && Math.random() < ctx.crit) { crit = true; mult *= 1.5; }
  const dmg = capBoss(ctx, target, amount * mult, o.multi);
  let center;
  let dim;
  try { center = fx.bodyCenter(target) ?? target.location; dim = target.dimension; } catch { return undefined; }
  const casterOk = valid(ctx.caster);
  const ok = damage(target, dmg, casterOk ? ctx.caster : undefined, 'magic');
  if (ok && casterOk) {
    if (el.status === 'wither') heal(ctx.caster, dmg * 0.15);
    if (el.status === 'bleed') heal(ctx.caster, dmg * 0.2);
  }
  if (valid(target)) {
    if (reaction?.consume) removeStatus(target, reaction.status);
    if (!reaction?.noApply) applyElement(ctx, target, o);
    if (ctx.player && !isPlayer(target)) { try { markForSpirits(ctx.player, target); } catch {} }
    if (ctx.enemy && isPlayer(target) && cfg('spellShake') !== false) fx.shake(target, 0.12, 0.25);
  }
  if (!o.quiet) {
    fx.impact(dim, center, ctx.elId, el.rgb, crit || !!reaction);
    if (!o.secondary) fx.playAt(dim, el.impact ?? el.sound, center, 0.8, 0.9 + Math.random() * 0.3);
    if (crit) {
      fx.px(dim, 'minecraft:critical_hit_emitter', center);
      if (ctx.player) actionbar(ctx.player, `§6✦ ¡Crítico! §7(${Math.round(dmg)} de daño)`);
    }
  }
  if (reaction) {
    try { runReaction(ctx, reaction, target, dmg, center, dim); } catch {}
    announce(ctx, reaction, target, dmg, center, dim);
  }
  // cadena propia del Rayo (si la reacción ya encadena, no se duplica)
  const reactionChains = !!reaction?.fx.some((f) => String(f).startsWith('chain'));
  if (el.status === 'chain' && !ctx.depth && !o.secondary && !o.noChain && !reactionChains) {
    chainFrom(ctx, target, 2 + Math.floor(ctx.tier / 2), amount * 0.6, center, dim);
  }
  return { dealt: dmg, reaction, crit };
}

/** Compatibilidad v1: golpe mágico directo. */
export function hit(caster, d, el, target, amount, tier, strong = false, chained = false) {
  const elId = el?.id ?? Object.keys(ELEMENTS).find((k) => ELEMENTS[k] === el) ?? 'arcano';
  const ctx = isPlayer(caster) && d
    ? playerCtx(caster, d, { tier, power: amount }, elId)
    : enemyCtx(caster, elId, { tier, range: 16 }, amount, target);
  if (!ctx) return undefined;
  if (chained) ctx.depth = 1;
  return strike(ctx, target, amount, { strong });
}

/** Salto de cadena: la descarga pasa de objetivo en objetivo dibujando arcos. */
function chainFrom(ctx, from, n, amount, fromCenter, dim) {
  const sub1 = { ...ctx, depth: 1 };
  const done = new Set([from.id]);
  let prevC = fromCenter;
  let prevLoc = fromCenter;
  for (let k = 0; k < n; k++) {
    let best;
    let bestD = Infinity;
    for (const e of ctx.foes(prevLoc, 6)) {
      if (done.has(e.id)) continue;
      const d2 = dist(e.location, prevLoc);
      if (d2 < bestD) { best = e; bestD = d2; }
    }
    if (!best) break;
    done.add(best.id);
    const c = fx.bodyCenter(best) ?? best.location;
    fx.arc(dim, prevC, c, ctx.el.rgb, 0.45);
    strike(sub1, best, amount * Math.pow(0.85, k), { secondary: true, noReact: true, multi: true });
    prevC = c;
    prevLoc = c;
  }
}

/** Golpe en área alrededor de `c`. o: opciones de strike + { exclude:Set|id, max } */
function areaHit(ctx, c, r, amount, o = {}) {
  let n = 0;
  const ex = o.exclude;
  for (const e of ctx.foes(c, r + 1.5)) {
    if (ex && (ex === e.id || ex.has?.(e.id))) continue;
    let b;
    try { b = fx.bodyOf(e); } catch { continue; }
    if (Math.hypot(b.cx - c.x, b.cz - c.z) > r + b.r) continue;
    if (c.y < b.y0 - r || c.y > b.y1 + r) continue;
    strike(ctx, e, amount, o);
    if (++n >= (o.max ?? 16)) break;
  }
  return n;
}

const STEAM = [0.85, 0.85, 0.9];
/** Efectos especiales de una reacción (ver data/elements.js → REACTIONS.fx). */
function runReaction(ctx, r, target, dealt, center, dim) {
  const sub1 = { ...ctx, depth: 1 };
  const alive = valid(target);
  const boss = alive && isBoss(target);
  for (const f of r.fx) {
    const [k, a] = String(f).split(':');
    const n = Number(a);
    switch (k) {
      case 'chain':
        chainFrom(ctx, target, n || 2, dealt * 0.6, center, dim);
        if (alive) addStatus(target, 'aturdido', 30, { deep: true });
        break;
      case 'stun':
        if (!alive) break;
        effect(target, 'slowness', boss ? 20 : 50, boss ? 2 : 6);
        effect(target, 'weakness', 50, 2);
        addStatus(target, 'aturdido', boss ? 25 : 55, { deep: true });
        break;
      case 'freeze':
        if (!alive) break;
        effect(target, 'slowness', boss ? 25 : 60, boss ? 2 : 7);
        effect(target, 'mining_fatigue', 80, 2);
        addStatus(target, 'congelado', boss ? 30 : 70, { deep: !boss, el: 'hielo' });
        fx.sphere(dim, center, 0.9, [0.7, 0.95, 1], 18);
        fx.playAt(dim, 'random.glass', center, 1, 0.7);
        break;
      case 'chill':
        if (!alive) break;
        effect(target, 'slowness', 60, 2);
        addStatus(target, 'congelado', 80, { el: 'hielo' });
        break;
      case 'explode':
        fx.impact(dim, center, ctx.elId, ctx.el.rgb, true);
        fx.px(dim, 'minecraft:huge_explosion_emitter', center);
        fx.playAt(dim, 'random.explode', center, 0.9, 1.1);
        areaHit(sub1, center, 3, dealt * 0.5, { exclude: target.id, secondary: true, noReact: true, multi: true, quiet: true });
        fx.wave(dim, { x: center.x, y: center.y - 0.8, z: center.z }, 3, ctx.el.rgb, 2, 2);
        break;
      case 'burst':
        fx.wave(dim, { x: center.x, y: center.y - 0.8, z: center.z }, 2.2, ctx.el.rgb, 2, 2);
        areaHit(sub1, center, 2.2, dealt * 0.4, { exclude: target.id, secondary: true, noReact: true, multi: true, quiet: true });
        break;
      case 'spreadFire': {
        fx.vortex(dim, { x: center.x, y: center.y - 0.9, z: center.z }, 1.6, [1, 0.45, 0.1], 3, 16);
        for (const e of ctx.foes(center, 4.5)) {
          if (e.id === target.id) continue;
          try { e.setOnFire(5, true); } catch {}
          addStatus(e, 'ardiendo', 100, { el: 'fuego', src: ctx.caster?.id });
          fx.line(dim, center, fx.bodyCenter(e) ?? e.location, [1, 0.45, 0.1], 0.5, 'rpg:spark', 16);
          strike(sub1, e, dealt * 0.3, { secondary: true, noReact: true, noStatus: true, multi: true, quiet: true });
        }
        if (alive) { try { target.setOnFire(6, true); } catch {} }
        break;
      }
      case 'spreadPoison':
        fx.sphere(dim, center, 1.6, [0.35, 0.8, 0.2], 20);
        for (const e of ctx.foes(center, 4.5)) {
          if (e.id === target.id) continue;
          effect(e, 'poison', 100, 1);
          addStatus(e, 'envenenado', 140, { el: 'naturaleza', src: ctx.caster?.id });
          fx.tendril(dim, center, fx.bodyCenter(e) ?? e.location, [0.35, 0.8, 0.2], 0.8);
          strike(sub1, e, dealt * 0.25, { secondary: true, noReact: true, noStatus: true, multi: true, quiet: true });
        }
        break;
      case 'heal': {
        if (!valid(ctx.caster)) break;
        const amt = dealt * (n || 0.3);
        heal(ctx.caster, amt);
        const cc = fx.bodyCenter(ctx.caster) ?? ctx.caster.location;
        fx.tendril(dim, center, cc, [1, 0.95, 0.6], 1);
        fx.px(dim, 'minecraft:heart_particle', { x: cc.x, y: cc.y + 1.2, z: cc.z });
        break;
      }
      case 'root':
        if (!alive) break;
        effect(target, 'slowness', boss ? 20 : 60, boss ? 2 : 6);
        addStatus(target, 'enraizado', boss ? 20 : 60, { el: 'naturaleza' });
        fx.ring(dim, { x: center.x, y: target.location.y, z: center.z }, 0.7, [0.3, 0.8, 0.2], 10);
        break;
      case 'crit':
        if (valid(ctx.caster)) heal(ctx.caster, dealt * 0.3);
        fx.px(dim, 'minecraft:critical_hit_emitter', center);
        fx.sphere(dim, center, 0.7, [0.8, 0.05, 0.1], 12);
        break;
      case 'fear':
        if (!alive) break;
        if (boss) { effect(target, 'weakness', 60, 1); break; }
        addStatus(target, 'aterrado', 70, { from: valid(ctx.caster) ? { ...ctx.caster.location } : { ...ctx.hand } });
        effect(target, 'weakness', 80, 1);
        effect(target, 'slowness', 10, 0);
        fx.playAt(dim, 'mob.ghast.scream', center, 0.6, 1.4);
        break;
      case 'blindAoE':
        if (alive) { try { target.extinguishFire(true); } catch {} }
        fx.sphere(dim, center, 2.2, STEAM, 26);
        for (let i = 0; i < 4; i++) fx.px(dim, 'minecraft:water_evaporation_bucket_emitter', { x: center.x + rand(-1.5, 1.5), y: center.y, z: center.z + rand(-1.5, 1.5) });
        fx.playAt(dim, 'random.fizz', center, 1, 0.8);
        for (const e of ctx.foes(center, 4)) {
          effect(e, 'blindness', 70, 0);
          effect(e, 'slowness', 50, 1);
          if (e.id !== target.id) strike(sub1, e, dealt * 0.2, { secondary: true, noReact: true, noStatus: true, multi: true, quiet: true });
        }
        break;
      case 'weaken':
        if (!alive) break;
        effect(target, 'weakness', 120, 1);
        effect(target, 'slowness', 60, 1);
        fx.sphere(dim, center, 0.8, [0.6, 0.85, 1], 12);
        break;
      case 'refund':
        if (ctx.player && ctx.d) {
          const back = Math.max(2, Math.round((ctx.s?.mana ?? 10) * 0.3));
          ctx.d.mana = Math.min(maxMana(ctx.d), (ctx.d.mana ?? 0) + back);
        }
        break;
      case 'blind':
        if (alive) effect(target, 'blindness', 80, 0);
        break;
      case 'wither':
        if (alive) effect(target, 'wither', 80, 1);
        break;
      case 'smite':
        fx.pillar(dim, { x: center.x, y: center.y - 1, z: center.z }, 6, [1, 1, 0.7], 0.4);
        if (alive && isUndead(target)) strike(sub1, target, dealt * 0.5, { secondary: true, noReact: true, noStatus: true, quiet: true });
        break;
    }
  }
}

const lastReactShow = new Map(); // playerId -> tick
const lastBigTitle = new Map(); // playerId -> tick

/** Muestra el nombre de la reacción (título corto + barra de acción) y registra el descubrimiento. */
function announce(ctx, r, target, dealt, center, dim) {
  const rgb = STATUSES[r.status]?.rgb ?? ctx.el.rgb;
  fx.px(dim, 'rpg:burst', center, rgb, true);
  fx.ring(dim, { x: center.x, y: center.y - 0.6, z: center.z }, 1.2, ctx.el.rgb, 14);
  fx.playAt(dim, 'random.orb', center, 0.7, 0.6 + Math.random() * 0.3);
  const now = system.currentTick;
  const p = ctx.player;
  if (p && valid(p)) {
    if (now - (lastReactShow.get(p.id) ?? -99) >= 12) {
      lastReactShow.set(p.id, now);
      actionbar(p, `${r.c}§l✦ ${r.name}!§r §7— ${r.short} §8(x${r.mult})`);
      if (now - (lastBigTitle.get(p.id) ?? -99) > 50 && cfg('spellTitles') !== false) fx.bigTitle(p, ' ', `${r.c}✦ ${r.name} ✦`, 14);
    }
    const d = ctx.d;
    if (d) {
      d.combos = Array.isArray(d.combos) ? d.combos : [];
      if (!d.combos.includes(r.id)) {
        d.combos.push(r.id);
        const st = STATUSES[r.status];
        msg(p, `§d✦ ¡Reacción descubierta! ${r.c}§l${r.name}§r §7(${ctx.el.c}${ctx.el.name}§7 sobre un objetivo ${st ? st.c + st.name.toLowerCase() : ''}§7): ${r.short}. §8(${d.combos.length} descubiertas)`);
        try { p.playSound('random.levelup', { volume: 0.5, pitch: 1.6 }); } catch {}
        dirty(p);
      }
    }
    try { hooks.onReaction?.(p, r, target); } catch {}
    try { hooks.questProgress?.(p, 'reaction', r.id, 1); } catch {}
  }
  if (ctx.enemy && isPlayer(target) && valid(target)) {
    if (now - (lastReactShow.get(target.id) ?? -99) >= 12) {
      lastReactShow.set(target.id, now);
      actionbar(target, `${r.c}§l✦ ${r.name}§r §7te alcanza — ${r.short}`);
    }
  }
}

/** Efecto de impacto en un punto (fin del alcance o muro). */
function endFx(ctx, pt, big, wall) {
  if (wall || big) fx.impact(ctx.dim, pt, ctx.elId, ctx.el.rgb, big);
  else fx.px(ctx.dim, 'rpg:burst', pt, ctx.el.rgb);
  if (wall) fx.playAt(ctx.dim, ctx.el.impact ?? ctx.el.sound, pt, 0.6, 1.1);
}

function shakeArea(ctx, c, r, intensity, seconds) {
  if (cfg('spellShake') === false) return;
  fx.shakeNear(ctx.dim, c, r, intensity, seconds);
}

/* ------------------------------------------------------------------ */
/* Cooldowns y ranuras                                                  */
/* ------------------------------------------------------------------ */
function onCooldown(player, key, ticks) {
  let m = cooldowns.get(player.id);
  if (!m) cooldowns.set(player.id, (m = new Map()));
  const now = system.currentTick;
  const until = m.get(key) ?? 0;
  if (now < until) return Math.ceil((until - now) / 20);
  m.set(key, now + ticks);
  return 0;
}

function resetCooldown(player, key) {
  try { cooldowns.get(player.id)?.delete(key); } catch {}
}

export function cooldownLeft(player, key) {
  const until = cooldowns.get(player.id)?.get(key) ?? 0;
  return Math.max(0, Math.ceil((until - system.currentTick) / 20));
}

/** Resuelve una referencia de ranura: 'p:12' (elemento principal), 's:3' (secundario), 'r' (racial). */
export function slotInfo(d, ref) {
  if (!ref) return undefined;
  if (ref === 'r') {
    const r = raceOf(d.race).racial;
    return { racial: true, name: r.name, mana: r.mana, cd: r.cd * 20, key: 'racial', el: undefined };
  }
  const [w, n] = ref.split(':');
  const elId = w === 's' ? d.element2 : d.element;
  if (!elId) return undefined;
  const s = getSkill(elId, Number(n));
  if (!s) return undefined;
  return { ...s, key: ref, el: elId };
}

export function cycleSlot(player) {
  const d = getP(player);
  if (!d || !d.slots?.length) return;
  d.slotSel = ((d.slotSel ?? 0) + 1) % d.slots.length;
  const info = slotInfo(d, d.slots[d.slotSel]);
  if (info) {
    const el = info.el ? ELEMENTS[info.el] : undefined;
    const cd = cooldownLeft(player, info.key);
    actionbar(player, `§b» Hechizo: ${el?.c ?? '§f'}§l${info.name}§r §9(${info.mana} maná)${cd ? ` §c${cd}s` : ''} §7[${d.slotSel + 1}/${d.slots.length}]`);
  }
  try { player.playSound('random.click', { pitch: 1.6 }); } catch {}
  dirty(player);
}

export function castSelected(player) {
  const d = getP(player);
  if (!d) return;
  if (!d.slots?.length) return msg(player, '§7No tienes hechizos equipados. Abre tu Diario → Magia para equiparlos.');
  const ref = d.slots[(d.slotSel ?? 0) % d.slots.length];
  const info = slotInfo(d, ref);
  if (!info) return;
  if (info.racial) return castRacial(player, d);
  castSkill(player, d, info);
}

/* ------------------------------------------------------------------ */
/* Lanzamiento                                                          */
/* ------------------------------------------------------------------ */
export function castSkill(player, d, s) {
  const elId = s.el ?? s.element;
  const el = ELEMENTS[elId];
  if (!el || !KINDS[s.kind]) return;
  const left = cooldownLeft(player, s.key);
  if (left > 0) return actionbar(player, `§c${s.name} se recarga: ${left}s`);
  if ((d.mana ?? 0) < s.mana) return actionbar(player, `§9Maná insuficiente (${Math.floor(d.mana ?? 0)}/${s.mana})`);
  onCooldown(player, s.key, s.cd);
  d.mana -= s.mana;
  let result;
  let ctx;
  try {
    ctx = playerCtx(player, d, s, elId);
    castFeedback(ctx, s);
    result = KINDS[s.kind](ctx, s);
  } catch (e) {
    console.warn('[Aetheria] Error al lanzar ' + s.name + ': ' + e + (e?.stack ? '\n' + e.stack : ''));
  }
  if (result === false) {
    // el hechizo no pudo lanzarse (p. ej. sin espacio para teletransportarse): devolvemos maná y recarga
    d.mana = Math.min(maxMana(d), (d.mana ?? 0) + s.mana);
    resetCooldown(player, s.key);
    return;
  }
  actionbar(player, `${el.c}✦ ${s.name}! §9(${Math.floor(d.mana)}/${maxMana(d)} maná)`);
  addMagicXp(player, s.mana * 0.6 + (s.tier ?? 0) * 2);
  d.stats2 = d.stats2 ?? {};
  d.stats2.spells = (d.stats2.spells ?? 0) + 1;
  try { hooks.questProgress?.(player, 'cast', elId, 1); } catch {}
  try { hooks.onCast?.(player, s); } catch {}
  dirty(player);
}

/** Círculo mágico bajo el lanzador, sonido y, para los hechizos legendarios, título y temblor. */
function castFeedback(ctx, s) {
  const loc = ctx.caster.location;
  const rgb = ctx.el.rgb;
  fx.circle(ctx.dim, loc, rgb, 0.7 + ctx.tier * 0.3);
  fx.playAt(ctx.dim, ctx.el.cast ?? ctx.el.sound, loc, 0.9, 0.9 + Math.random() * 0.3);
  if (ctx.tier >= 2) fx.risingRing(ctx.dim, loc, 0.9 + ctx.tier * 0.2, rgb, 2 + ctx.tier, 2);
  if (ctx.tier >= 4 && ctx.player) legendary(ctx, s);
}

function legendary(ctx, s) {
  const p = ctx.player;
  const text = `${ctx.el.c}§l¡${String(s.name).toUpperCase()}!`;
  const now = system.currentTick;
  if (cfg('spellTitles') !== false) {
    fx.bigTitle(p, text, `§7Hechizo legendario de ${ctx.el.c}${ctx.el.name}`, 40);
    lastBigTitle.set(p.id, now);
    let near = [];
    try { near = ctx.dim.getPlayers({ location: p.location, maxDistance: 48 }); } catch {}
    for (const o of near) {
      if (o.id === p.id) continue;
      fx.bigTitle(o, text, `§7${p.name} desata un hechizo legendario`, 30);
      lastBigTitle.set(o.id, now);
    }
  }
  if (cfg('spellShake') !== false) fx.shake(p, 0.4, 0.7);
  fx.pillar(ctx.dim, p.location, 6, ctx.el.rgb, 0.3);
  fx.sphere(ctx.dim, { x: p.location.x, y: p.location.y + 1, z: p.location.z }, 1.6, ctx.el.rgb, 30);
  fx.playAt(ctx.dim, 'ambient.weather.thunder', p.location, 0.7, 1.2);
  fx.playAt(ctx.dim, 'random.totem', p.location, 0.5, 0.6);
}

/* ------------------------------------------------------------------ */
/* Ramas                                                                */
/* ------------------------------------------------------------------ */
const ZONE_FX = {
  agua(ctx, c, r, foes) { pull(foes, c, 0.16); fx.vortex(ctx.dim, c, r * 0.8, ctx.el.rgb, 0.8, 10, system.currentTick * 0.3); },
  viento(ctx, c, r, foes) { pull(foes, c, 0.22, 0.12); fx.vortex(ctx.dim, c, r * 0.7, ctx.el.rgb, 3, 14, system.currentTick * 0.4); },
  rayo(ctx, c, r, foes) {
    const cc = { x: c.x, y: c.y + 1, z: c.z };
    for (let i = 0; i < foes.length && i < 3; i++) fx.arc(ctx.dim, cc, fx.bodyCenter(foes[i]) ?? foes[i].location, ctx.el.rgb, 0.4);
  },
  luz(ctx, c, r) {
    let ps = [];
    try { ps = ctx.dim.getPlayers({ location: c, maxDistance: r + 0.5 }); } catch {}
    if (ctx.enemy) return;
    for (const p of ps) {
      heal(p, 1 + ctx.power * 0.06);
      fx.px(ctx.dim, 'minecraft:heart_particle', { x: p.location.x, y: p.location.y + 2, z: p.location.z });
    }
  },
  oscuridad(ctx, c, r, foes) { for (const e of foes) effect(e, 'blindness', 30, 0); },
  hielo(ctx, c, r) { fx.px(ctx.dim, 'minecraft:snowflake_particle', { x: c.x + rand(-r, r) * 0.6, y: c.y + 1, z: c.z + rand(-r, r) * 0.6 }); },
  naturaleza(ctx, c, r, foes) {
    for (const e of foes) if (!isBoss(e) && Math.random() < 0.35) { addStatus(e, 'enraizado', 30, { el: 'naturaleza' }); effect(e, 'slowness', 30, 4); }
  },
  arcano(ctx, c, r, foes) { for (const e of foes) if (!isBoss(e) && Math.random() < 0.3) effect(e, 'levitation', 10, 0); },
  tierra(ctx, c, r, foes) { for (const e of foes) effect(e, 'slowness', 20, 2); fx.px(ctx.dim, 'minecraft:knockback_roar_particle', c); },
  fuego(ctx, c, r) { fx.px(ctx.dim, 'minecraft:basic_flame_particle', { x: c.x + rand(-r, r) * 0.6, y: c.y + 0.2, z: c.z + rand(-r, r) * 0.6 }); },
};

function pull(foes, c, strength, lift = 0) {
  for (const e of foes) {
    if (isBoss(e)) continue;
    const dx = c.x - e.location.x;
    const dz = c.z - e.location.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.8) continue;
    if (isPlayer(e)) knockback(e, dx / l, dz / l, strength * 1.5, lift);
    else { try { e.applyImpulse({ x: (dx / l) * strength, y: lift, z: (dz / l) * strength }); } catch {} }
  }
}

let zoneSeq = 0;
const zonesByCaster = new Map(); // casterId -> [key]
const MAX_ZONES_PER_CASTER = 3;

/** Dominio persistente: anillo visible + pulso de daño cada 10 ticks. */
function startZone(ctx, c, R, pulses, delay) {
  const key = 'zone:' + ++zoneSeq;
  const owner = ctx.caster.id;
  const list = zonesByCaster.get(owner) ?? [];
  list.push(key);
  while (list.length > MAX_ZONES_PER_CASTER) fx.stopTicker(list.shift());
  zonesByCaster.set(owner, list);
  let left = pulses;
  let i = 0;
  const start = () => fx.ticker(key, 10, () => {
    if (!valid(ctx.caster) || left-- <= 0) {
      const l2 = zonesByCaster.get(owner);
      if (l2) { const k = l2.indexOf(key); if (k >= 0) l2.splice(k, 1); if (!l2.length) zonesByCaster.delete(owner); }
      fx.ring(ctx.dim, c, R, ctx.el.rgb, 10 + R * 3);
      return false;
    }
    i++;
    fx.ring(ctx.dim, c, R, ctx.el.rgb, 14 + R * 4, 'rpg:spark', 0.15);
    if (i % 2) fx.px(ctx.dim, 'rpg:circle', { x: c.x, y: c.y + 0.06, z: c.z }, ctx.el.rgb, true);
    else fx.ring(ctx.dim, c, R * 0.55, ctx.el.rgb, 8 + R * 2, 'rpg:spark', 0.3);
    if (ctx.el.trail) fx.px(ctx.dim, ctx.el.trail, { x: c.x + rand(-R, R) * 0.5, y: c.y + 0.3, z: c.z + rand(-R, R) * 0.5 });
    const foes = ctx.foes(c, R + 1).filter((e) => {
      try { return Math.hypot(e.location.x - c.x, e.location.z - c.z) <= R + 0.3 && Math.abs(e.location.y - c.y) < 3; } catch { return false; }
    });
    for (const e of foes) strike(ctx, e, ctx.power, { multi: true, secondary: true, quiet: i % 2 === 0 });
    try { ZONE_FX[ctx.elId]?.(ctx, c, R, foes); } catch {}
    return true;
  });
  if (delay > 0) fx.later(delay, start);
  else start();
  return key;
}

/** Aura ofensiva de las potenciaciones: daña cada segundo a los enemigos muy cercanos. */
function startOffensiveAura(ctx, ticks) {
  const key = 'buffaura:' + ctx.caster.id;
  const r = 2.4 + ctx.tier * 0.3;
  let left = Math.max(1, Math.floor(ticks / 20));
  fx.ticker(key, 20, () => {
    if (!valid(ctx.caster) || left-- <= 0) return false;
    const c = ctx.caster.location;
    let n = 0;
    for (const e of ctx.foes(c, r + 0.5)) {
      if (n++ >= 6) break;
      fx.line(ctx.dim, { x: c.x, y: c.y + 1, z: c.z }, fx.bodyCenter(e) ?? e.location, ctx.el.rgb, 0.4, 'rpg:spark', 10);
      strike(ctx, e, ctx.power * 0.12, { secondary: true, noReact: true, multi: true, quiet: true });
    }
    return true;
  });
}

function knockAway(e, c, h, v) {
  try {
    const dx = e.location.x - c.x;
    const dz = e.location.z - c.z;
    const l = Math.hypot(dx, dz) || 1;
    knockback(e, dx / l, dz / l, h, v);
  } catch {}
}

/** Punto de impacto de una lluvia: a menudo sobre un enemigo dentro de la zona. */
function strikePoint(ctx, c, R) {
  if (Math.random() < 0.55) {
    const foes = ctx.foes(c, R + 1);
    if (foes.length) {
      const e = foes[randInt(0, foes.length - 1)];
      try { return { x: e.location.x + rand(-0.8, 0.8), y: e.location.y, z: e.location.z + rand(-0.8, 0.8) }; } catch {}
    }
  }
  const a = Math.random() * Math.PI * 2;
  const r = R * Math.sqrt(Math.random());
  return { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r };
}

/** Altura libre sobre el suelo (para lanzar desde el cielo sin atravesar techos). */
function skyRoom(dim, g, max = 14) {
  const hitUp = fx.rayBlock(dim, { x: g.x, y: g.y + 1.2, z: g.z }, { x: 0, y: 1, z: 0 }, max);
  if (!hitUp) return max;
  return Math.max(2.5, hitUp.point.y - g.y - 0.6);
}

/** Explosión de un impacto de lluvia. */
function rainBoom(ctx, p, r) {
  const big = ctx.tier >= 3;
  fx.impact(ctx.dim, p, ctx.elId, ctx.el.rgb, true);
  if (ctx.elId === 'fuego' || ctx.elId === 'tierra') fx.px(ctx.dim, 'minecraft:huge_explosion_emitter', p);
  fx.ring(ctx.dim, { x: p.x, y: p.y - 0.4, z: p.z }, r, ctx.el.rgb, 10 + r * 3);
  fx.playAt(ctx.dim, ctx.elId === 'fuego' || ctx.elId === 'tierra' ? 'random.explode' : (ctx.el.impact ?? ctx.el.sound), p, big ? 1 : 0.7, 1.1);
  areaHit(ctx, p, r, ctx.power, { multi: true, secondary: true });
  if (big) shakeArea(ctx, p, r + 5, ctx.tier >= 4 ? 0.3 : 0.18, 0.3);
}

function rainDrop(ctx, p) {
  const dim = ctx.dim;
  const gr = grounded(dim, p, 12);
  const H = skyRoom(dim, gr, 14);
  if (ctx.elId === 'rayo') {
    fx.lightning(dim, gr, ctx.el.rgb, H);
    fx.playAt(dim, 'ambient.weather.thunder', gr, 0.6, 1.3);
    rainBoom(ctx, { x: gr.x, y: gr.y + 0.3, z: gr.z }, 2.4);
    return;
  }
  const from = { x: gr.x + rand(-1.5, 1.5), y: gr.y + H, z: gr.z + rand(-1.5, 1.5) };
  const to = { x: gr.x, y: gr.y + 0.2, z: gr.z };
  const v = sub(to, from);
  const len = Math.hypot(v.x, v.y, v.z);
  fx.launch({
    dim, from, dir: v, speed: 1.5 + ctx.tier * 0.12, range: len + 0.5, rgb: ctx.el.rgb, el: ctx.elId,
    size: 0.5 + ctx.tier * 0.06, scale: 1.3, trail: 'dense', vtrail: ctx.el.trail, ownerId: ctx.caster.id, filter: ctx.filter,
    onHit: (e, pt) => rainBoom(ctx, pt, 2.5),
    onEnd: (pt) => rainBoom(ctx, pt, 2.5),
  });
}

const KINDS = {
  bolt(ctx, s) {
    const st = ctx.el.proj ?? {};
    const range = s.range || 20;
    const homingStyle = st.homing ?? 0;
    const aim = autoAim(ctx, range, homingStyle > 0.2 ? 0.85 : AIM_COS);
    const count = Math.max(1, st.count ?? 1);
    const share = count > 1 ? (st.share ?? 1 / count) : 1;
    const splashR = Math.max(st.splash ?? 0, ctx.tier >= 3 ? 2.2 : 0);
    const splashMul = ctx.tier >= 3 ? 0.5 : (st.splashMul ?? 0.35);
    const homingStrength = (homingStyle || (aim.target ? 0.1 : 0)) * (ctx.enemy ? 0.4 : 1);
    const dmg = ctx.power * share;
    const speed = (s.speed || 1.7) * (st.speedMul ?? 1);
    // Proyectiles con gravedad (roca, agua): se lanzan en parábola hacia el objetivo para que lleguen.
    const ballistic = (from, dir) => {
      if (!st.gravity) return dir;
      let to;
      if (aim.target && valid(aim.target)) to = fx.bodyCenter(aim.target);
      else if (ctx.enemy && ctx.targetPoint) to = ctx.targetPoint;
      if (!to) return dir;
      return fx.ballisticDir(from, to, speed, st.gravity, { homingStrength: aim.target ? homingStrength : 0, range }) ?? dir;
    };
    for (let i = 0; i < count; i++) {
      const yaw = count > 1 && st.spread ? (i - (count - 1) / 2) * st.spread : 0;
      const go = () => {
        if (!valid(ctx.caster)) return;
        const from = i && st.stagger ? handOf(ctx) : ctx.hand;
        const dir = rotateYaw(ballistic(from, i && st.stagger && aim.target && valid(aim.target) ? norm(sub(fx.bodyCenter(aim.target) ?? aim.target.location, from)) : aim.dir), yaw);
        fx.launch({
          dim: ctx.dim, from, dir, speed, range,
          rgb: ctx.el.rgb, el: ctx.elId, size: (st.size ?? 0.35) + ctx.tier * 0.04, pierce: st.pierce ?? 0,
          ownerId: ctx.caster.id, filter: ctx.filter,
          homing: aim.target, homingStrength, gravity: st.gravity ?? 0,
          trail: ctx.tier >= 2 ? 'dense' : 'spark', vtrail: ctx.el.trail, scale: (ctx.el.orbScale ?? 1) * (1 + ctx.tier * 0.1),
          onHit: (e, pt) => {
            strike(ctx, e, dmg, { knock: st.knock });
            if (splashR) areaHit(ctx, pt, splashR, dmg * splashMul, { exclude: e.id, secondary: true, multi: true, quiet: true });
            if (splashR) fx.ring(ctx.dim, pt, splashR * 0.8, ctx.el.rgb, 12);
          },
          onEnd: (pt, p) => {
            endFx(ctx, pt, ctx.tier >= 3, !!p.blockHit);
            if (splashR && p.blockHit) {
              areaHit(ctx, pt, splashR, dmg * splashMul, { secondary: true, multi: true, quiet: true });
              fx.ring(ctx.dim, pt, splashR * 0.8, ctx.el.rgb, 12);
            }
          },
        });
      };
      if (i && st.stagger) fx.later(i * st.stagger, go);
      else go();
    }
    if (ctx.elId === 'tierra' && !ctx.enemy) knockback(ctx.caster, -ctx.dir.x, -ctx.dir.z, 0.15, 0); // retroceso de la roca
  },

  lance(ctx, s) {
    const aim = autoAim(ctx, s.range || 16, 0.985);
    const rgb = ctx.el.rgb;
    fx.line(ctx.dim, ctx.hand, add(ctx.hand, mul(aim.dir, 2.5)), rgb, 0.25, 'rpg:spark', 12);
    fx.px(ctx.dim, 'rpg:burst', ctx.hand, rgb, true);
    fx.launch({
      dim: ctx.dim, from: ctx.hand, dir: aim.dir, speed: s.speed || 3.2, range: s.range || 16, rgb, el: ctx.elId,
      size: 0.45 + ctx.tier * 0.05, pierce: Infinity, trail: 'dense', vtrail: ctx.el.trail, scale: 1.2 + ctx.tier * 0.1,
      ownerId: ctx.caster.id, filter: ctx.filter,
      onHit: (e) => strike(ctx, e, ctx.power, { knock: ctx.el.proj?.knock }),
      onEnd: (pt, p) => endFx(ctx, pt, ctx.tier >= 3, !!p.blockHit),
    });
    if (ctx.tier >= 3 && ctx.player && cfg('spellShake') !== false) fx.shake(ctx.player, 0.15 + (ctx.tier - 3) * 0.15, 0.3);
  },

  nova(ctx, s) {
    const c = { ...ctx.caster.location };
    const R = s.radius || 4;
    const hitIds = new Set();
    const go = () => {
      fx.impact(ctx.dim, { x: c.x, y: c.y + 1, z: c.z }, ctx.elId, ctx.el.rgb, ctx.tier >= 2);
      fx.wave(ctx.dim, c, R, ctx.el.rgb, ctx.tier >= 3 ? 4 : 3, 2, (r) => {
        for (const e of ctx.foes(c, r + 1)) {
          if (hitIds.has(e.id)) continue;
          try { if (Math.hypot(e.location.x - c.x, e.location.z - c.z) > r + 0.6) continue; } catch { continue; }
          hitIds.add(e.id);
          strike(ctx, e, ctx.power, { multi: true });
          if (valid(e) && !isBoss(e)) knockAway(e, c, 0.6 + ctx.tier * 0.1, 0.3);
        }
      });
      if (ctx.tier >= 3) shakeArea(ctx, c, R + 6, ctx.tier >= 4 ? 0.45 : 0.25, 0.5);
    };
    if (ctx.enemy) { fx.telegraph(ctx.dim, c, R, ctx.el.rgb); fx.later(15, go); } else go();
  },

  buff(ctx, s) {
    if (ctx.enemy) return KINDS.ward(ctx, s);
    const player = ctx.caster;
    const d = ctx.d;
    const el = ctx.el;
    const tier = ctx.tier;
    const amp = Math.min(2, tier);
    for (const [eff, base] of el.buff) {
      let a = base + amp;
      if (eff === 'health_boost' || eff === 'absorption') a = base + tier;
      if (eff === 'night_vision' || eff === 'fire_resistance' || eff === 'water_breathing' || eff === 'invisibility' || eff === 'slow_falling') a = 0;
      effect(player, eff, s.duration, a, true);
    }
    if (ctx.elId === 'sangre') {
      const h = health(player);
      if (h && h.currentValue > 4 + tier) { try { h.setCurrentValue(h.currentValue - (2 + tier)); } catch {} }
    }
    if (ctx.elId === 'arcano') d._manaBoostUntil = system.currentTick + s.duration;
    fx.helix(player, el.rgb, 18, 0.9, 2.3);
    fx.aura(player, el.rgb, s.duration, ctx.elId);
    for (let i = 0; i < 2; i++) fx.px(ctx.dim, 'rpg:aura', player.location, el.rgb);
    if (OFFENSIVE_AURA.has(ctx.elId) && tier >= 1) startOffensiveAura(ctx, s.duration);
  },

  curse(ctx, s) {
    const range = s.range || 10;
    const dir = flatDir(ctx.dir);
    const c = ctx.caster.location;
    const from = ctx.hand;
    const rgb = ctx.el.rgb;
    let n = 0;
    const list = ctx.foes(c, range).map((e) => ({ e, l: dist(e.location, c) })).sort((a, b) => a.l - b.l);
    for (const { e } of list) {
      if (n >= 6) break;
      const v = flatDir(sub(e.location, c));
      if (v.x * dir.x + v.z * dir.z < 0.55) continue;
      const bc = fx.bodyCenter(e) ?? e.location;
      // Los enemigos no maldicen a través de paredes ni suelos (jugadores a cubierto en casas o cuevas).
      if (ctx.enemy && !fx.lineOfSight(ctx.dim, ctx.head, bc)) continue;
      fx.tendril(ctx.dim, from, bc, rgb, 0.8 + Math.random() * 0.8);
      fx.ring(ctx.dim, { x: e.location.x, y: e.location.y, z: e.location.z }, 0.8, rgb, 8);
      strike(ctx, e, ctx.power, { strong: true, statusMul: 1.6 });
      n++;
    }
    // cono visible
    for (let i = 1.5; i <= range; i += 1.5) {
      const w = i * 0.35;
      for (const side of [-1, 1]) fx.px(ctx.dim, 'rpg:spark', { x: from.x + dir.x * i - dir.z * w * side, y: from.y - 0.3, z: from.z + dir.z * i + dir.x * w * side }, rgb);
    }
  },

  zone(ctx, s) {
    const p = grounded(ctx.dim, aimPoint(ctx, s.range || 20));
    const R = s.radius || 3;
    const pulses = Math.max(2, Math.floor((s.duration || 80) / 10));
    const delay = ctx.enemy ? 20 : 0;
    if (ctx.enemy) fx.telegraph(ctx.dim, p, R, [1, 0.15, 0.1]);
    fx.circle(ctx.dim, p, ctx.el.rgb, R);
    fx.impact(ctx.dim, { x: p.x, y: p.y + 0.5, z: p.z }, ctx.elId, ctx.el.rgb, ctx.tier >= 2);
    if (!ctx.enemy) fx.line(ctx.dim, ctx.hand, { x: p.x, y: p.y + 0.5, z: p.z }, ctx.el.rgb, 0.6, 'rpg:spark', 30);
    startZone(ctx, p, R, pulses, delay);
    if (ctx.tier >= 3) shakeArea(ctx, p, R + 8, ctx.tier >= 4 ? 0.35 : 0.2, 0.45);
  },

  ward(ctx, s) {
    const caster = ctx.caster;
    const dim = ctx.dim;
    const el = ctx.el;
    const tier = ctx.tier;
    const race = ctx.d ? raceOf(ctx.d.race) : {};
    const amount = (ctx.power * 3 + 4) * (race.healMult ?? 1);
    heal(caster, amount);
    effect(caster, 'absorption', 600, Math.min(4, tier), true);
    const center = { x: caster.location.x, y: caster.location.y + 1, z: caster.location.z };
    fx.sphere(dim, center, 1.4, el.rgb, 34);
    fx.helix(caster, el.rgb, 12, 1.1, 2);
    if (!ctx.enemy) fx.aura(caster, el.rgb, 200, ctx.elId);
    if (!ctx.enemy && ['luz', 'agua', 'naturaleza'].includes(ctx.elId)) {
      for (const p of world.getAllPlayers()) {
        if (p.id === caster.id || p.dimension.id !== dim.id || dist(p.location, caster.location) >= 8) continue;
        heal(p, amount * 0.7);
        fx.tendril(dim, center, { x: p.location.x, y: p.location.y + 1, z: p.location.z }, el.rgb, 0.6);
        fx.px(dim, 'minecraft:heart_particle', { x: p.location.x, y: p.location.y + 2, z: p.location.z });
      }
    }
    if (ctx.elId === 'necromancia' || ctx.elId === 'sangre') {
      let drained = 0;
      for (const e of ctx.foes(caster.location, 6 + tier)) {
        const r = strike(ctx, e, ctx.power * 0.5, { secondary: true, noReact: true, multi: true, quiet: true });
        drained += r?.dealt ?? 0;
        fx.tendril(dim, fx.bodyCenter(e) ?? e.location, center, el.rgb, 0.7);
      }
      heal(caster, drained);
    }
    if (ctx.elId === 'tierra' || ctx.elId === 'hielo') effect(caster, 'resistance', 200, Math.min(2, tier), true);
    if (ctx.elId === 'oscuridad' && !ctx.enemy) effect(caster, 'invisibility', 200, 0, false);
    fx.px(dim, 'minecraft:heart_particle', { x: caster.location.x, y: caster.location.y + 2, z: caster.location.z });
  },

  step(ctx, s) {
    const player = ctx.caster;
    const dim = ctx.dim;
    const el = ctx.el;
    const tier = ctx.tier;
    const dir = ctx.dir;
    const f = flatDir(dir);
    const start = { ...player.location };
    if (el.step === 'blink') {
      const t = lookTarget(player, s.range || 8, ctx.d);
      const dest = sub(t.point, mul(dir, 1.2));
      dest.y = Math.floor(dest.y);
      let safe = false;
      for (let dy = 0; dy < 3 && !safe; dy++) {
        const a = getBlock(dim, { x: Math.floor(dest.x), y: dest.y + dy, z: Math.floor(dest.z) });
        const b = getBlock(dim, { x: Math.floor(dest.x), y: dest.y + dy + 1, z: Math.floor(dest.z) });
        if (a && b && !isSolid(a) && !isSolid(b)) { dest.y += dy; safe = true; }
      }
      if (!safe) { actionbar(player, '§7No hay espacio para teletransportarse.'); return false; }
      fx.circle(dim, start, el.rgb, 1);
      fx.impact(dim, { x: start.x, y: start.y + 1, z: start.z }, ctx.elId, el.rgb);
      fx.line(dim, { x: start.x, y: start.y + 1, z: start.z }, { x: dest.x, y: dest.y + 1, z: dest.z }, el.rgb, 0.45, 'rpg:spark', 40);
      try { player.teleport({ x: dest.x, y: dest.y, z: dest.z }, { keepVelocity: false }); } catch {}
      fx.circle(dim, dest, el.rgb, 1.2);
      fx.impact(dim, { x: dest.x, y: dest.y + 1, z: dest.z }, ctx.elId, el.rgb, tier >= 3);
      fx.playAt(dim, 'mob.endermen.portal', dest, 0.8, 1.2);
      if (ctx.elId === 'necromancia') effect(player, 'invisibility', 60, 0);
      if (ctx.elId === 'rayo' && tier >= 1) {
        // el relámpago deja una descarga en el punto de llegada
        for (const e of ctx.foes(dest, 2.5)) strike(ctx, e, ctx.power * 0.4, { secondary: true, multi: true });
      }
    } else if (el.step === 'leap') {
      knockback(player, f.x, f.z, 0.9 + tier * 0.15, 0.9 + tier * 0.12);
      effect(player, 'slow_falling', 60 + tier * 10, 0);
      fx.circle(dim, start, el.rgb, 1.4);
      fx.ring(dim, start, 1.5, el.rgb, 12);
      fx.vortex(dim, start, 1.2, el.rgb, 1.5, 10);
      fx.later(25, () => {
        if (!valid(player)) return;
        const l = player.location;
        if (ctx.elId === 'tierra') {
          fx.wave(dim, l, 3 + tier * 0.4, el.rgb, 3, 2, (r) => {
            if (r < 3) return;
            for (const e of ctx.foes(l, r + 0.5)) strike(ctx, e, ctx.power, { multi: true });
          });
          fx.px(dim, 'minecraft:knockback_roar_particle', l);
          if (tier >= 3) shakeArea(ctx, l, 10, 0.3, 0.4);
        } else if (ctx.elId === 'viento') {
          fx.wave(dim, l, 3.5, el.rgb, 2, 2);
          for (const e of ctx.foes(l, 3.5)) {
            strike(ctx, e, ctx.power * 0.4, { secondary: true, multi: true });
            if (valid(e) && !isBoss(e)) knockAway(e, l, 1.2, 0.5);
          }
        }
      });
    } else {
      knockback(player, f.x, f.z, 1.6 + tier * 0.25, 0.25);
      fx.circle(dim, start, el.rgb, 1);
      fx.later(6, () => {
        if (!valid(player)) return;
        const endL = player.location;
        fx.line(dim, { x: start.x, y: start.y + 0.8, z: start.z }, { x: endL.x, y: endL.y + 0.8, z: endL.z }, el.rgb, 0.35, 'rpg:spark', 30);
        if (el.trail) fx.px(dim, el.trail, { x: endL.x, y: endL.y + 0.5, z: endL.z });
        const mid = mul(add(start, endL), 0.5);
        const segLen = dist(start, endL);
        for (const e of ctx.foes(mid, segLen / 2 + 2.5)) {
          const b = fx.bodyOf(e);
          if (fx.segmentHitsBody({ x: start.x, y: start.y + 0.9, z: start.z }, { x: endL.x, y: endL.y + 0.9, z: endL.z }, b, 1.2) === undefined) continue;
          strike(ctx, e, Math.max(2, ctx.power * 0.6), { multi: true });
        }
      });
    }
  },

  summon(ctx, s) {
    if (ctx.enemy) return KINDS.nova(ctx, s);
    const player = ctx.caster;
    const tier = ctx.tier;
    const count = s.count || (tier >= 4 ? 3 : tier >= 2 ? 2 : 1);
    const spawn = hooks.spawnSummon ?? defaultSpawnSummon;
    fx.circle(ctx.dim, player.location, ctx.el.rgb, 2 + tier * 0.3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const loc = { x: player.location.x + Math.cos(a) * 1.6, y: player.location.y + 0.2, z: player.location.z + Math.sin(a) * 1.6 };
      try { spawn(player, ctx.el, s, loc, tier, ctx.power); } catch {}
    }
    if (tier >= 3) shakeArea(ctx, player.location, 10, tier >= 4 ? 0.3 : 0.15, 0.4);
  },

  rain(ctx, s) {
    const c = grounded(ctx.dim, aimPoint(ctx, s.range || 28));
    const R = s.radius || 5;
    const strikes = s.strikes || 3 + ctx.tier * 2;
    const rgb = ctx.el.rgb;
    if (ctx.enemy) fx.telegraph(ctx.dim, c, R, [1, 0.15, 0.1]);
    fx.circle(ctx.dim, c, rgb, R);
    fx.ring(ctx.dim, c, R, rgb, 16 + R * 4);
    if (!ctx.enemy) fx.pillar(ctx.dim, ctx.caster.location, 3 + ctx.tier, rgb, 0.4);
    if (ctx.tier >= 3) shakeArea(ctx, c, R + 10, ctx.tier >= 4 ? 0.5 : 0.25, 0.6);
    fx.later(ctx.enemy ? 20 : 4, () => {
      fx.repeat(strikes, 5, (i) => {
        if (!valid(ctx.caster)) return false;
        if (i % 3 === 2) fx.ring(ctx.dim, c, R, rgb, 12 + R * 3);
        rainDrop(ctx, strikePoint(ctx, c, R));
        return true;
      });
    });
  },
};

/* ------------------------------------------------------------------ */
/* Hechizos de enemigos                                                 */
/* ------------------------------------------------------------------ */
const ENEMY_KINDS = new Set(['bolt', 'lance', 'nova', 'curse', 'zone', 'rain', 'barrage', 'ward']);

/**
 * Un enemigo (jefe, mago oscuro…) lanza un hechizo con el mismo motor de proyectiles y reacciones.
 * Daña a jugadores (no en creativo/espectador) y a sus espíritus; nunca a NPCs ni a otros monstruos.
 * @param caster     entidad que lanza
 * @param elementId  'fuego' | 'agua' | … (12 elementos)
 * @param kind       'bolt' | 'lance' | 'nova' | 'curse' | 'zone' | 'rain' | 'barrage' (3 proyectiles) | 'ward'
 * @param target     entidad objetivo o punto {x,y,z} (opcional: si falta, hacia donde mira)
 * @param power      daño bruto por impacto (sin escalado de jugador)
 * @param opts       { tier 0..4, range, radius, duration (ticks), speed, strikes, name }
 * @returns true si se lanzó
 */
export function enemyCast(caster, elementId, kind = 'bolt', target, power = 6, opts = {}) {
  try {
    if (!valid(caster)) return false;
    const elId = ELEMENTS[elementId] ? elementId : 'oscuridad';
    const k = ENEMY_KINDS.has(kind) ? kind : 'bolt';
    const tier = clamp(Math.floor(opts.tier ?? 1), 0, 4);
    const s = {
      tier, kind: k, name: opts.name ?? 'Hechizo enemigo', mana: 0,
      range: opts.range ?? 24 + tier * 2,
      radius: opts.radius ?? 2.5 + tier * 0.5,
      duration: opts.duration ?? 60 + tier * 20,
      speed: opts.speed ?? (k === 'lance' ? 2.2 + tier * 0.2 : 1.0 + tier * 0.12),
      strikes: opts.strikes ?? 3 + tier,
    };
    const ctx = enemyCtx(caster, elId, s, power, target);
    if (!ctx) return false;
    fx.circle(ctx.dim, caster.location, ctx.el.rgb, 1 + tier * 0.3);
    fx.playAt(ctx.dim, ctx.el.cast ?? ctx.el.sound, caster.location, 1, 0.8);
    if (k === 'barrage') {
      for (let i = 0; i < 3; i++) {
        fx.later(1 + i * 5, () => {
          if (!valid(caster)) return;
          ctx.hand = handOf(ctx);
          KINDS.bolt(ctx, s);
        });
      }
      return true;
    }
    return KINDS[k](ctx, s) !== false;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Espíritus y golpes físicos                                           */
/* ------------------------------------------------------------------ */
/** Marca la entidad que el jugador acaba de golpear: sus espíritus la atacarán 10 s (etiqueta rpg_marked). */
export function markTarget(player, entity) {
  try { return markForSpirits(player, entity); } catch { return false; }
}

const spiritCd = new Map();
/** Un espíritu golpea: deja el estado de su elemento y puede provocar reacciones. */
function spiritStrike(spirit, target, amount) {
  const now = system.currentTick;
  if (now - (spiritCd.get(spirit.id) ?? -99) < 15) return;
  spiritCd.set(spirit.id, now);
  if (spiritCd.size > 200) spiritCd.clear();
  let elId;
  let ownerId;
  try { elId = spirit.getDynamicProperty('rpg:el'); ownerId = spirit.getDynamicProperty('rpg:owner'); } catch {}
  if (typeof elId !== 'string' || !ELEMENTS[elId]) return;
  let owner;
  try { owner = world.getAllPlayers().find((p) => p.id === ownerId); } catch {}
  const d = owner ? getP(owner) : undefined;
  const el = elementOf(elId);
  const ctx = {
    caster: spirit, player: owner, d, el, elId, s: { tier: 1 }, tier: 1, enemy: false, depth: 0, power: amount || 4,
    dim: spirit.dimension, head: headOf(spirit), dir: { x: 0, y: 0, z: 1 }, hand: headOf(spirit) ?? spirit.location, crit: 0,
    filter: (e) => (owner ? isEnemy(owner, e, d) : false),
    foes: (loc, r) => (owner ? enemiesNear(owner, loc, r, d) : []),
  };
  let center;
  try { center = fx.bodyCenter(target) ?? target.location; } catch { return; }
  const reaction = findReaction(elId, statusIds(target));
  if (reaction) {
    const base = amount || 4;
    if (reaction.consume) removeStatus(target, reaction.status);
    // el golpe del espíritu ya hizo su daño: la reacción añade la diferencia del multiplicador
    const bonus = base * Math.max(0, reaction.mult - 1);
    if (bonus > 0) strike({ ...ctx, depth: 1 }, target, bonus, { secondary: true, noReact: true, noStatus: true, quiet: true });
    try { runReaction(ctx, reaction, target, base * reaction.mult, center, target.dimension); } catch {}
    announce(ctx, reaction, target, base * reaction.mult, center, target.dimension);
  }
  if (!valid(target)) return;
  if (!reaction?.noApply) applyElement(ctx, target, { statusMul: 0.7 });
  fx.px(target.dimension, 'rpg:fx_' + elId, center, undefined);
}

/**
 * Llamar desde world.afterEvents.entityHurt (después de combat.onHurt):
 *  · un jugador golpea a algo → sus espíritus lo atacan (markTarget);
 *  · un espíritu golpea → deja su estado elemental y puede provocar reacciones;
 *  · algo golpea a un jugador → sus espíritus lo defienden.
 */
export function onEntityHurt(ev) {
  try {
    const target = ev.hurtEntity;
    const src = ev.damageSource;
    const attacker = src?.damagingEntity;
    if (!attacker || !valid(target) || !valid(attacker)) return;
    const at = attacker.typeId;
    if (at === 'minecraft:player') {
      if (!isPlayer(target) && src.cause !== 'magic') markForSpirits(attacker, target);
    } else if (at === 'rpg:spirit') {
      if (src.cause === 'entityAttack') spiritStrike(attacker, target, ev.damage);
    } else if (isPlayer(target)) {
      markForSpirits(target, attacker);
    }
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Habilidades raciales                                                 */
/* ------------------------------------------------------------------ */
export function castRacial(player, d) {
  const race = raceOf(d.race);
  const r = race.racial;
  const left = cooldownLeft(player, 'racial');
  if (left > 0) return actionbar(player, `§c${r.name} se recarga: ${left}s`);
  if ((d.mana ?? 0) < r.mana) return actionbar(player, `§9Maná insuficiente (${Math.floor(d.mana ?? 0)}/${r.mana})`);
  onCooldown(player, 'racial', r.cd * 20);
  d.mana -= r.mana;
  const dim = player.dimension;
  const loc = player.location;
  const lvl = d.level ?? 1;
  const rgb = [1, 0.85, 0.3];
  const near = (radius) => world.getAllPlayers().filter((p) => { try { return p.dimension.id === dim.id && dist(p.location, loc) < radius; } catch { return false; } });
  try {
    fx.circle(dim, loc, rgb, 1.6);
    switch (d.race) {
      case 'humano': {
        const h = hpOf(player);
        heal(player, h.max * 0.4);
        effect(player, 'resistance', 200, 1, true);
        fx.helix(player, [1, 0.85, 0.4], 18, 1, 2.4);
        fx.aura(player, [1, 0.85, 0.4], 200, 'luz');
        break;
      }
      case 'elfo':
        fx.wave(dim, loc, 10, [0.4, 1, 0.4], 3, 2);
        for (const p of near(10)) {
          effect(p, 'regeneration', 240, 1, true);
          effect(p, 'speed', 240, 0, true);
          fx.px(dim, 'minecraft:villager_happy', { x: p.location.x, y: p.location.y + 1, z: p.location.z });
        }
        break;
      case 'enano':
        effect(player, 'resistance', 160, 2, true);
        effect(player, 'strength', 160, 0, true);
        fx.px(dim, 'minecraft:knockback_roar_particle', loc);
        fx.sphere(dim, { x: loc.x, y: loc.y + 1, z: loc.z }, 1.2, [0.6, 0.45, 0.25], 26);
        fx.aura(player, [0.6, 0.45, 0.25], 160, 'tierra');
        if (cfg('spellShake') !== false) fx.shakeNear(dim, loc, 8, 0.2, 0.3);
        break;
      case 'orco':
        effect(player, 'strength', 200, 1, true);
        for (const e of enemiesNear(player, loc, 8, d)) effect(e, 'weakness', 200, 1);
        fx.playAt(dim, 'mob.ravager.roar', loc, 1.5, 1);
        fx.px(dim, 'minecraft:knockback_roar_particle', loc);
        fx.wave(dim, loc, 8, [0.9, 0.2, 0.1], 3, 2);
        if (cfg('spellShake') !== false) fx.shakeNear(dim, loc, 12, 0.35, 0.5);
        break;
      case 'bestia':
        effect(player, 'speed', 200, 2, true);
        effect(player, 'jump_boost', 200, 1, true);
        effect(player, 'strength', 200, 0, true);
        fx.playAt(dim, 'mob.wolf.growl', loc, 1, 1);
        fx.aura(player, [0.9, 0.6, 0.2], 200, 'naturaleza');
        break;
      case 'demonio': {
        const h = health(player);
        if (h) { try { h.setCurrentValue(Math.max(1, h.currentValue - h.effectiveMax * 0.3)); } catch {} }
        d.mana = maxMana(d);
        effect(player, 'strength', 240, 1, true);
        fx.px(dim, 'minecraft:huge_explosion_emitter', loc);
        fx.pillar(dim, loc, 5, [0.8, 0.1, 0.05], 0.3);
        fx.aura(player, [0.8, 0.1, 0.05], 240, 'fuego');
        break;
      }
      case 'celestial': {
        const ctx = playerCtx(player, d, { tier: 2, power: 6 + lvl * 0.4 }, 'luz');
        for (const e of enemiesNear(player, loc, 8, d)) {
          const c = fx.bodyCenter(e) ?? e.location;
          fx.pillar(dim, { x: c.x, y: e.location.y, z: c.z }, 7, [1, 1, 0.7], 0.35);
          strike(ctx, e, (6 + lvl * 0.4) * (isUndead(e) ? 1.5 : 1), { multi: true }); // x2 de la Luz → x3 contra no-muertos
        }
        for (const p of near(8)) heal(p, 8 * (race.healMult ?? 1));
        fx.px(dim, 'minecraft:totem_particle', loc);
        fx.wave(dim, loc, 8, [1, 1, 0.7], 3, 2);
        break;
      }
      case 'vampiro': {
        effect(player, 'invisibility', 160, 0, false);
        effect(player, 'speed', 160, 1, false);
        fx.aura(player, [0.7, 0, 0.1], 160, 'sangre');
        fx.repeat(8, 20, () => {
          if (!valid(player)) return false;
          for (const e of enemiesNear(player, player.location, 5, d)) {
            damage(e, 1.5 + lvl * 0.05, player, 'magic');
            heal(player, 1.5);
            fx.tendril(player.dimension, fx.bodyCenter(e) ?? e.location, { x: player.location.x, y: player.location.y + 1, z: player.location.z }, [0.7, 0, 0.1], 0.6);
          }
          return true;
        });
        break;
      }
      case 'hada': {
        const r2 = 6;
        for (let dx = -r2; dx <= r2; dx++) for (let dz = -r2; dz <= r2; dz++) for (let dy = -2; dy <= 2; dy++) {
          const b = getBlock(dim, { x: Math.floor(loc.x) + dx, y: Math.floor(loc.y) + dy, z: Math.floor(loc.z) + dz });
          if (!b) continue;
          try {
            const st = b.permutation.getState('growth');
            if (typeof st === 'number' && st < 7) b.setPermutation(b.permutation.withState('growth', 7));
          } catch {}
        }
        for (const p of near(8)) heal(p, 10);
        fx.px(dim, 'minecraft:crop_growth_emitter', loc);
        fx.vortex(dim, loc, 3, [1, 0.6, 1], 3, 24);
        for (let i = 0; i < 3; i++) fx.px(dim, 'rpg:aura', loc, [1, 0.6, 1]);
        break;
      }
      case 'draconido': {
        // Cono de llamas: 7 proyectiles de fuego en abanico (cada enemigo se quema una sola vez).
        const ctx = playerCtx(player, d, { tier: 2, power: 8 + lvl * 0.5 }, 'fuego');
        const breath = 8 + lvl * 0.5; // daño bruto, como en v1 (es una habilidad racial, no un hechizo)
        const hitOnce = new Set();
        const base = flatDir(player.getViewDirection());
        for (let i = 0; i < 7; i++) {
          const dir = rotateYaw({ x: base.x, y: -0.05, z: base.z }, (i - 3) * 7);
          fx.launch({
            dim, from: ctx.hand, dir, speed: 1.1, range: 9, rgb: [1, 0.45, 0.05], el: 'fuego', size: 0.55, pierce: Infinity,
            trail: 'dense', vtrail: 'minecraft:basic_flame_particle', scale: 1.3, ownerId: player.id, filter: ctx.filter,
            onHit: (e) => {
              if (hitOnce.has(e.id)) return;
              hitOnce.add(e.id);
              strike(ctx, e, breath, { multi: true });
              try { e.setOnFire(6, true); } catch {}
            },
          });
        }
        fx.playAt(dim, 'mob.enderdragon.growl', loc, 1, 1.2);
        if (cfg('spellShake') !== false) fx.shake(player, 0.2, 0.4);
        break;
      }
    }
  } catch (e) {
    console.warn('[Aetheria] Error en la habilidad racial ' + r.name + ': ' + e);
  }
  for (let i = 0; i < 2; i++) fx.px(dim, 'rpg:aura', loc, rgb);
  actionbar(player, `§6✦ ${r.name}!`);
  dirty(player);
}

/** Regeneración de maná (cada segundo). */
export function manaTick(player, d) {
  const max = maxMana(d);
  let regen = manaRegen(d);
  if ((d._manaBoostUntil ?? 0) > system.currentTick) regen *= 2;
  d.mana = Math.min(max, (d.mana ?? max) + regen);
}

/** Reacciones descubiertas por el jugador (para el Diario). */
export function discoveredReactions(d) {
  const ids = new Set(Array.isArray(d?.combos) ? d.combos : []);
  const seen = new Set();
  return REACTIONS.filter((r) => ids.has(r.id) && !seen.has(r.name) && seen.add(r.name));
}

export { g, randInt, reactionGuide };
