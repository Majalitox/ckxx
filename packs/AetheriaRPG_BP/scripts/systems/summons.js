// Invocaciones elementales aliadas (v2).
//
// * Los espíritus siguen a su dueño con suavidad (pasos de teletransporte seguro) y reaparecen a su
//   lado si se quedan muy lejos o en otra dimensión.
// * Atacan lo que su dueño golpea: markTarget(player, entity) etiqueta la víctima con `rpg_marked`
//   durante 10 s (el JSON de rpg:spirit apunta a esa etiqueta, contrato §2.5).
// * Los espíritus de Luz, Agua y Naturaleza curan a su dueño cada pocos segundos.
// * Efectos de aparición y desaparición con partículas del elemento.
import { world, system } from '@minecraft/server';
import { valid, heal, hpOf } from '../util/compat.js';
import { ELEMENTS } from '../data/elements.js';
import * as fx from './spellfx.js';

export const SPIRIT = 'rpg:spirit';
export const MARK_TAG = 'rpg_marked';
export const MARK_TICKS = 200; // 10 s
export const MAX_PER_OWNER = 4;
const HEALERS = new Set(['luz', 'agua', 'naturaleza']);
const HEAL_EVERY = 80; // ticks
const FOLLOW_NEAR = 5; // a partir de aquí se acerca al dueño
const FOLLOW_TP = 18; // más lejos: reaparece junto al dueño
const FOLLOW_LEASH = 11; // aunque esté peleando, vuelve con su dueño si este se aleja más
const NEVER_MARK = new Set(['minecraft:player', 'rpg:npc', 'rpg:spirit', 'rpg:waypoint', 'rpg:tomato', 'minecraft:item', 'minecraft:xp_orb',
  'minecraft:villager_v2', 'minecraft:villager', 'minecraft:wandering_trader', 'minecraft:armor_stand', 'minecraft:painting']);

/** spiritId -> { e, ownerId, el, born, power, nextHeal, fightUntil, fightCheck } */
const tracked = new Map();
/** entityId -> { e, until, owners:Set } */
const marks = new Map();

function elIdFromVariant(v) {
  return Object.keys(ELEMENTS).find((k) => ELEMENTS[k].variant === v) ?? 'arcano';
}

function ownerSpirits(ownerId) {
  const out = [];
  for (const s of tracked.values()) if (s.ownerId === ownerId && valid(s.e)) out.push(s);
  return out.sort((a, b) => a.born - b.born);
}

/** Número de espíritus activos de un jugador. */
export function spiritCount(player) {
  try { return ownerSpirits(player.id).length; } catch { return 0; }
}

function track(e, ownerId, elId, power) {
  tracked.set(e.id, { e, ownerId, el: elId, born: system.currentTick, power: Number(power) || 5, nextHeal: system.currentTick + HEAL_EVERY, fightUntil: 0, fightCheck: 0 });
  fx.ticker('summons', 2, fastTick);
}

/** Desvanece un espíritu con efectos. */
export function despawn(e, quiet = false) {
  const s = tracked.get(e?.id);
  tracked.delete(e?.id);
  if (!valid(e)) return;
  const elId = s?.el ?? elIdFromVariant(safeProp(e, 'rpg:variant'));
  const el = ELEMENTS[elId];
  try {
    const l = e.location;
    const c = { x: l.x, y: l.y + 0.7, z: l.z };
    if (!quiet) {
      fx.impact(e.dimension, c, elId, el?.rgb);
      fx.sphere(e.dimension, c, 0.8, el?.rgb, 14);
      fx.playAt(e.dimension, 'mob.endermen.portal', c, 0.6, 1.4);
    }
  } catch {}
  try { e.remove(); } catch {}
}

function safeProp(e, k) {
  try { return e.getProperty(k); } catch { return undefined; }
}

export function spawnSummon(player, el, skill, loc, tier, power) {
  if (!valid(player)) return undefined;
  // Límite por dueño: el más antiguo se desvanece.
  const mine = ownerSpirits(player.id);
  while (mine.length >= MAX_PER_OWNER) despawn(mine.shift().e);
  let e;
  try {
    e = player.dimension.spawnEntity(SPIRIT, loc);
  } catch {
    return undefined;
  }
  const elId = el?.id ?? 'arcano';
  try {
    e.setProperty('rpg:variant', el.variant ?? 0);
    e.triggerEvent('rpg:power_' + Math.max(0, Math.min(4, tier)));
    e.setDynamicProperty('rpg:owner', player.id);
    e.setDynamicProperty('rpg:expire', world.getAbsoluteTime() + (skill?.duration ?? 600));
    e.setDynamicProperty('rpg:power', power);
    e.setDynamicProperty('rpg:el', elId);
    e.addTag('rpg_ally');
    e.nameTag = `${el.c ?? '§f'}${skill?.name ?? 'Espíritu'}\n§7de ${player.name}`;
  } catch {}
  track(e, player.id, elId, power);
  // Aparición: círculo, columna de luz y destello del elemento
  const dim = player.dimension;
  fx.circle(dim, loc, el.rgb, 1.1);
  fx.pillar(dim, loc, 2.2, el.rgb, 0.35);
  fx.impact(dim, { x: loc.x, y: loc.y + 0.8, z: loc.z }, elId, el.rgb);
  fx.playAt(dim, 'mob.evocation_illager.prepare_summon', loc, 0.7, 1.3);
  return e;
}

/**
 * Marca a la entidad que el jugador acaba de golpear: sus espíritus la atacarán durante 10 s.
 * Llamar desde world.afterEvents.entityHurt cuando el atacante es un jugador (y opcionalmente cuando
 * un monstruo hiere a un jugador, para que sus espíritus lo defiendan). Devuelve true si marcó.
 */
export function markTarget(player, entity) {
  try {
    if (!valid(player) || !valid(entity) || entity.id === player.id) return false;
    if (!ownerSpirits(player.id).length) return false;
    const t = entity.typeId;
    if (NEVER_MARK.has(t)) return false;
    if (entity.hasTag('rpg_ally') || entity.hasTag('rpg_wp')) return false;
    if (entity.getComponent('minecraft:is_tamed')) return false;
    if (!entity.getComponent('minecraft:health')) return false;
  } catch { return false; }
  const until = system.currentTick + MARK_TICKS;
  const m = marks.get(entity.id);
  if (m) { m.until = until; m.owners.add(player.id); } else marks.set(entity.id, { e: entity, until, owners: new Set([player.id]) });
  try {
    if (!entity.hasTag(MARK_TAG)) entity.addTag(MARK_TAG);
  } catch {
    // contexto de solo lectura (before-event): se aplica en el siguiente tick
    system.run(() => { try { if (valid(entity)) entity.addTag(MARK_TAG); } catch {} });
  }
  if (!m) {
    try {
      const l = entity.location;
      fx.px(entity.dimension, 'rpg:spark', { x: l.x, y: l.y + 2.3, z: l.z }, [1, 0.2, 0.2], true);
    } catch {}
  }
  fx.ticker('summons', 2, fastTick);
  return true;
}

/** ¿Está marcada la entidad? */
export function isMarked(entity) {
  try { return marks.has(entity.id) && entity.hasTag(MARK_TAG); } catch { return false; }
}

function unmark(id, m) {
  marks.delete(id);
  try { if (valid(m.e)) m.e.removeTag(MARK_TAG); } catch {}
}

function playersById() {
  const map = new Map();
  try { for (const p of world.getAllPlayers()) map.set(p.id, p); } catch {}
  return map;
}

function expired(e) {
  try {
    const exp = e.getDynamicProperty('rpg:expire');
    return typeof exp !== 'number' || world.getAbsoluteTime() > exp;
  } catch { return true; }
}

let fastN = 0;
function fastTick(now) {
  fastN++;
  const players = playersById();
  // Marcas
  for (const [id, m] of marks) {
    if (now > m.until || !valid(m.e)) { unmark(id, m); continue; }
    if (fastN % 4 === 0) {
      try {
        const l = m.e.location;
        fx.px(m.e.dimension, 'rpg:spark', { x: l.x, y: l.y + 2.2, z: l.z }, [1, 0.25, 0.2]);
      } catch {}
    }
  }
  // Espíritus
  for (const [id, s] of tracked) {
    const e = s.e;
    if (!valid(e)) { tracked.delete(id); continue; }
    const owner = players.get(s.ownerId);
    if (!owner || (fastN % 10 === 0 && expired(e))) { despawn(e); continue; }
    try { follow(s, owner, now); } catch {}
    if (HEALERS.has(s.el) && now >= s.nextHeal) {
      s.nextHeal = now + HEAL_EVERY;
      try { healOwner(s, owner); } catch {}
    }
  }
  return tracked.size > 0 || marks.size > 0;
}

function fighting(s, now) {
  if (now < s.fightCheck) return s.fightUntil > now;
  s.fightCheck = now + 8;
  let near = [];
  try {
    const l = s.e.location;
    near = s.e.dimension.getEntities({ location: l, maxDistance: 10, families: ['monster'], closest: 1 });
    if (!near.length) near = s.e.dimension.getEntities({ location: l, maxDistance: 16, tags: [MARK_TAG], closest: 1 });
  } catch {}
  const busy = near.some((x) => valid(x) && !x.hasTag('rpg_ally'));
  s.fightUntil = busy ? now + 20 : 0;
  return busy;
}

function follow(s, owner, now) {
  const e = s.e;
  const ol = owner.location;
  const el = e.location;
  const sameDim = owner.dimension.id === e.dimension.id;
  const d = sameDim ? Math.hypot(ol.x - el.x, ol.y - el.y, ol.z - el.z) : Infinity;
  const rgb = ELEMENTS[s.el]?.rgb;
  if (d > FOLLOW_TP) {
    // Reaparece detrás del dueño
    let dir = { x: 0, z: 1 };
    try { const v = owner.getViewDirection(); const l = Math.hypot(v.x, v.z) || 1; dir = { x: v.x / l, z: v.z / l }; } catch {}
    const dest = { x: ol.x - dir.x * 2 + (Math.random() - 0.5) * 1.5, y: ol.y + 0.3, z: ol.z - dir.z * 2 + (Math.random() - 0.5) * 1.5 };
    if (sameDim) fx.impact(e.dimension, { x: el.x, y: el.y + 0.7, z: el.z }, s.el, rgb);
    let ok = false;
    try { ok = e.tryTeleport(dest, { dimension: owner.dimension, facingLocation: ol }); } catch {}
    if (!ok) try { e.teleport({ x: ol.x, y: ol.y + 0.3, z: ol.z }, { dimension: owner.dimension }); } catch {}
    fx.impact(owner.dimension, { x: dest.x, y: dest.y + 0.7, z: dest.z }, s.el, rgb);
    return;
  }
  // mientras pelea no se aleja de su presa, salvo que el dueño se vaya demasiado lejos (correa)
  if (d <= FOLLOW_NEAR || (d < FOLLOW_LEASH && fighting(s, now))) return;
  // Paso suave hacia el dueño (teletransporte seguro: no atraviesa bloques)
  const step = Math.max(0.35, Math.min(1.1, (d - FOLLOW_NEAR + 1) * 0.12));
  const k = step / d;
  const dest = { x: el.x + (ol.x - el.x) * k, y: el.y + Math.max(-0.5, Math.min(0.6, (ol.y - el.y) * k)), z: el.z + (ol.z - el.z) * k };
  let moved = false;
  try { moved = e.tryTeleport(dest, { facingLocation: { x: ol.x, y: ol.y + 1, z: ol.z }, checkForBlocks: true }); } catch {}
  if (!moved) {
    // bloqueado: pequeño salto hacia el dueño
    try { e.applyImpulse({ x: (ol.x - el.x) / d * 0.25, y: 0.42, z: (ol.z - el.z) / d * 0.25 }); } catch {}
  }
  if (fastN % 3 === 0) fx.px(e.dimension, 'rpg:spark', { x: el.x, y: el.y + 0.5, z: el.z }, rgb);
}

function healOwner(s, owner) {
  const e = s.e;
  if (owner.dimension.id !== e.dimension.id) return;
  const ol = owner.location;
  const el = e.location;
  if (Math.hypot(ol.x - el.x, ol.y - el.y, ol.z - el.z) > 12) return;
  const hp = hpOf(owner);
  if (!hp.max || hp.cur >= hp.max) return;
  const amount = Math.min(6, 1 + s.power * 0.06);
  heal(owner, amount);
  const rgb = ELEMENTS[s.el]?.rgb;
  fx.line(e.dimension, { x: el.x, y: el.y + 0.8, z: el.z }, { x: ol.x, y: ol.y + 1, z: ol.z }, rgb, 0.4);
  fx.px(owner.dimension, 'minecraft:heart_particle', { x: ol.x, y: ol.y + 2, z: ol.z });
  fx.px(owner.dimension, 'rpg:aura', ol, rgb);
}

/** Barrido lento (cada 2 s desde main.js): caducidad, registro tras recargar el mundo y limpieza de marcas huérfanas. */
export function summonTick() {
  const players = playersById();
  for (const dimId of ['overworld', 'nether', 'the_end']) {
    let dim;
    try { dim = world.getDimension(dimId); } catch { continue; }
    let list = [];
    try { list = dim.getEntities({ type: SPIRIT }); } catch { continue; }
    for (const e of list) {
      if (!valid(e)) continue;
      let ownerId;
      try { ownerId = e.getDynamicProperty('rpg:owner'); } catch {}
      const owner = players.get(ownerId);
      if (!owner || expired(e)) { despawn(e); continue; }
      if (!tracked.has(e.id)) {
        let elId;
        let power;
        try { elId = e.getDynamicProperty('rpg:el'); power = e.getDynamicProperty('rpg:power'); } catch {}
        track(e, ownerId, typeof elId === 'string' && ELEMENTS[elId] ? elId : elIdFromVariant(safeProp(e, 'rpg:variant')), power);
      }
    }
    // marcas huérfanas (p. ej. tras recargar el mundo)
    let marked = [];
    try { marked = dim.getEntities({ tags: [MARK_TAG] }); } catch {}
    for (const m of marked) if (!marks.has(m.id)) try { m.removeTag(MARK_TAG); } catch {}
  }
}

/** Retira todos los espíritus de un jugador (p. ej. al ser arrestado). */
export function dismissAll(player) {
  try { for (const s of ownerSpirits(player.id)) despawn(s.e); } catch {}
}
