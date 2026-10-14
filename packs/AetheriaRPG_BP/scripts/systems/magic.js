// Motor de magia: lanza las 600 habilidades (12 elementos × 50) y las habilidades raciales.
import { world, system } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addMagicXp, msg, actionbar } from '../core/progression.js';
import { stat, magicRank, maxMana, manaRegen, affinity, stageMult, isHero, isVillain, g } from '../core/profile.js';
import { ELEMENTS, getSkill } from '../data/elements.js';
import { raceOf } from '../data/races.js';
import { MOBS, BOSSES } from '../data/mobs.js';
import { knockback, particle, sound, effect, damage, heal, hpOf, valid, heldItem, health, getBlock, isSolid } from '../util/compat.js';
import { add, mul, sub, norm, flatDir, dist, distToSegment, rand, randInt } from '../util/math.js';

const cooldowns = new Map(); // playerId -> Map(key -> tick)
export const hooks = { questProgress: undefined, spawnSummon: undefined };

const NON_TARGET = new Set([
  'minecraft:item', 'minecraft:xp_orb', 'minecraft:arrow', 'minecraft:snowball', 'minecraft:egg', 'minecraft:painting', 'minecraft:armor_stand',
  'minecraft:leash_knot', 'minecraft:minecart', 'minecraft:boat', 'minecraft:chest_boat', 'minecraft:falling_block', 'minecraft:tnt',
  'minecraft:fireworks_rocket', 'minecraft:lightning_bolt', 'minecraft:area_effect_cloud', 'minecraft:ender_crystal', 'minecraft:fishing_hook',
  'minecraft:thrown_trident', 'minecraft:small_fireball', 'minecraft:fireball', 'minecraft:wind_charge_projectile', 'minecraft:xp_bottle',
  'minecraft:splash_potion', 'minecraft:lingering_potion', 'minecraft:ender_pearl', 'minecraft:eye_of_ender_signal', 'minecraft:shulker_bullet',
  'rpg:spirit', 'rpg:npc',
]);
const VILLAGER_LIKE = new Set(['minecraft:villager_v2', 'minecraft:villager', 'minecraft:wandering_trader', 'minecraft:iron_golem', 'minecraft:snow_golem']);

export function isEnemy(caster, e, d) {
  try {
    if (!e || !e.isValid || e.id === caster.id) return false;
    const t = e.typeId;
    if (NON_TARGET.has(t)) return false;
    if (e.hasTag('rpg_ally')) return false;
    if (t === 'minecraft:player') return cfg('magicPvP') && (d ? true : false);
    if (VILLAGER_LIKE.has(t)) return d ? (d.karma ?? 0) <= -100 : false;
    if (e.getComponent('minecraft:is_tamed')) return false;
    return !!e.getComponent('minecraft:health');
  } catch {
    return false;
  }
}

function isUndead(e) {
  const t = e.typeId;
  return !!(MOBS[t]?.undead || BOSSES[t]?.undead) || /skeleton|zombie|wither|phantom|drowned|husk|stray|zoglin|wraith|lich/.test(t);
}

export function enemiesNear(caster, loc, radius, d) {
  let list = [];
  try { list = caster.dimension.getEntities({ location: loc, maxDistance: radius }); } catch {}
  return list.filter((e) => isEnemy(caster, e, d));
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
    const bh = player.getBlockFromViewDirection({ maxDistance: range, includeLiquidBlocks: false });
    if (bh) point = add(bh.block.location, bh.faceLocation);
  } catch {}
  if (entity) point = { x: entity.location.x, y: entity.location.y + 0.8, z: entity.location.z };
  if (!point) point = add(head, mul(dir, range));
  return { entity, point, head, dir };
}

function trail(dim, from, to, rgb, step = 0.6) {
  const v = sub(to, from);
  const len = Math.hypot(v.x, v.y, v.z);
  const n = Math.min(60, Math.floor(len / step));
  for (let i = 0; i <= n; i++) particle(dim, 'rpg:spark', add(from, mul(v, i / Math.max(1, n))), rgb);
}

function ring(dim, c, r, rgb, points = 20) {
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    particle(dim, 'rpg:spark', { x: c.x + Math.cos(a) * r, y: c.y + 0.2, z: c.z + Math.sin(a) * r }, rgb);
  }
}

function burst(dim, loc, el) {
  particle(dim, 'rpg:burst', loc, el.rgb);
  const fx = { fuego: 'minecraft:basic_flame_particle', rayo: 'minecraft:electric_spark_particle', hielo: 'minecraft:snowflake_particle', luz: 'minecraft:totem_particle', necromancia: 'minecraft:soul_particle', oscuridad: 'minecraft:portal_reverse_particle', naturaleza: 'minecraft:villager_happy', arcano: 'minecraft:enchanting_table_particle', sangre: 'minecraft:critical_hit_emitter', viento: 'minecraft:wind_explosion_emitter', tierra: 'minecraft:knockback_roar_particle', agua: 'minecraft:water_evaporation_bucket_emitter' }[el.id];
  if (fx) particle(dim, fx, loc);
}

/** Poder final de un hechizo. */
export function spellPower(player, d, elId, base) {
  const race = raceOf(d.race);
  let p = base * (1 + (stat(d, 'int') - 5) * 0.025) * (1 + magicRank(d) * 0.1) * affinity(d, elId) * (race.magic ?? 1) * stageMult(d);
  if (isHero(d) && ['luz', 'naturaleza', 'agua'].includes(elId)) p *= 1.1;
  if (isVillain(d) && ['oscuridad', 'necromancia', 'sangre'].includes(elId)) p *= 1.15;
  const held = heldItem(player)?.typeId;
  if (held === 'rpg:staff_apprentice') p *= 1.15;
  if (held === 'rpg:staff_archmage') p *= 1.35;
  return p;
}

function applyStatus(el, target, caster, tier, strong) {
  const s = strong ? 2 : 1;
  switch (el.status) {
    case 'burn': try { target.setOnFire(2 + tier + (strong ? 3 : 0), true); } catch {} break;
    case 'soak': effect(target, 'slowness', 40 * s + tier * 20, strong ? 2 : 0); try { target.extinguishFire(true); } catch {} break;
    case 'stun': effect(target, 'slowness', 20 * s + tier * 10, strong ? 5 : 3); knockback(target, 0, 0, 0, 0.35); break;
    case 'gust': {
      const dx = target.location.x - caster.location.x;
      const dz = target.location.z - caster.location.z;
      const l = Math.hypot(dx, dz) || 1;
      knockback(target, dx / l, dz / l, 1.0 + tier * 0.3 + (strong ? 0.8 : 0), 0.45 + (strong ? 0.3 : 0));
      break;
    }
    case 'freeze': effect(target, 'slowness', 40 * s + tier * 15, strong ? 4 : 2); effect(target, 'mining_fatigue', 60, 1); break;
    case 'holy': if (isUndead(target)) effect(target, 'weakness', 100, 1); break;
    case 'blind': effect(target, 'blindness', 40 * s + tier * 10, 0); effect(target, 'weakness', 60 * s, strong ? 1 : 0); break;
    case 'wither': effect(target, 'wither', 40 * s + tier * 20, strong ? 1 : 0); break;
    case 'poison': effect(target, 'poison', 60 * s + tier * 20, strong ? 1 : 0); effect(target, 'slowness', 30, 0); break;
    case 'arcane': effect(target, 'levitation', strong ? 40 : 15, 0); break;
    case 'bleed': {
      let n = 3 + tier;
      const id = system.runInterval(() => {
        if (!valid(target) || n-- <= 0) return system.clearRun(id);
        damage(target, 1 + tier * 0.5, valid(caster) ? caster : undefined, 'magic');
        particle(target.dimension, 'rpg:spark', { ...target.location, y: target.location.y + 1 }, [0.7, 0, 0]);
      }, 20);
      break;
    }
    case 'chain': break;
  }
}

/** Golpe mágico a un objetivo con todos los efectos del elemento. */
export function hit(caster, d, el, target, amount, tier, strong = false, chained = false) {
  if (!valid(target)) return;
  let dmg = amount;
  if (el.status === 'holy' && isUndead(target)) dmg *= 2;
  if (el.status === 'arcane') dmg *= 1.15;
  const ok = damage(target, dmg, caster, 'magic');
  if (ok) {
    if (el.status === 'wither') heal(caster, dmg * 0.15);
    if (el.status === 'bleed') heal(caster, dmg * 0.25);
    if (el.id === 'necromancia' || el.id === 'sangre') particle(caster.dimension, 'minecraft:heart_particle', { ...caster.location, y: caster.location.y + 2 });
  }
  applyStatus(el, target, caster, tier, strong);
  burst(target.dimension, { ...target.location, y: target.location.y + 1 }, el);
  if (el.status === 'chain' && !chained) {
    const others = enemiesNear(caster, target.location, 5 + tier, d).filter((e) => e.id !== target.id).slice(0, 2 + Math.floor(tier / 2));
    for (const o of others) {
      trail(target.dimension, { ...target.location, y: target.location.y + 1 }, { ...o.location, y: o.location.y + 1 }, el.rgb, 0.4);
      hit(caster, d, el, o, amount * 0.6, tier, false, true);
    }
  }
}

function onCooldown(player, key, ticks) {
  let m = cooldowns.get(player.id);
  if (!m) cooldowns.set(player.id, (m = new Map()));
  const now = system.currentTick;
  const until = m.get(key) ?? 0;
  if (now < until) return Math.ceil((until - now) / 20);
  m.set(key, now + ticks);
  return 0;
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
  if (info) actionbar(player, `§b» Hechizo: §f§l${info.name} §r§9(${info.mana} maná)`);
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

export function castSkill(player, d, s) {
  const el = { ...ELEMENTS[s.el], id: s.el };
  const left = cooldownLeft(player, s.key);
  if (left > 0) return actionbar(player, `§c${s.name} se recarga: ${left}s`);
  if ((d.mana ?? 0) < s.mana) return actionbar(player, `§9Maná insuficiente (${Math.floor(d.mana)}/${s.mana})`);
  onCooldown(player, s.key, s.cd);
  d.mana -= s.mana;
  const power = spellPower(player, d, s.el, s.power);
  const dim = player.dimension;
  const tier = s.tier;
  sound(dim, el.sound, player.location, 1, 0.9 + Math.random() * 0.3);
  try {
    KINDS[s.kind](player, d, el, s, power, tier, dim);
  } catch (e) {
    console.warn('[Aetheria] Error al lanzar ' + s.name + ': ' + e);
  }
  actionbar(player, `${el.c}✦ ${s.name}! §9(${Math.floor(d.mana)}/${maxMana(d)} maná)`);
  addMagicXp(player, s.mana * 0.6 + tier * 2);
  d.stats2 = d.stats2 ?? {};
  d.stats2.spells = (d.stats2.spells ?? 0) + 1;
  hooks.questProgress?.(player, 'cast', s.el, 1);
  dirty(player);
}

const KINDS = {
  bolt(player, d, el, s, power, tier, dim) {
    const t = lookTarget(player, s.range, d);
    trail(dim, t.head, t.point, el.rgb);
    if (t.entity) hit(player, d, el, t.entity, power, tier);
    else burst(dim, t.point, el);
  },
  nova(player, d, el, s, power, tier, dim) {
    const c = player.location;
    ring(dim, c, s.radius * 0.5, el.rgb, 14);
    ring(dim, c, s.radius, el.rgb, 28);
    burst(dim, { ...c, y: c.y + 1 }, el);
    for (const e of enemiesNear(player, c, s.radius, d)) {
      hit(player, d, el, e, power, tier);
      const dx = e.location.x - c.x;
      const dz = e.location.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      knockback(e, dx / l, dz / l, 0.6, 0.3);
    }
  },
  buff(player, d, el, s, power, tier, dim) {
    const amp = Math.min(2, tier);
    for (const [eff, base] of el.buff) {
      let a = base + amp;
      if (eff === 'health_boost' || eff === 'absorption') a = base + tier;
      if (eff === 'night_vision' || eff === 'fire_resistance' || eff === 'water_breathing' || eff === 'invisibility' || eff === 'slow_falling') a = 0;
      effect(player, eff, s.duration, a, true);
    }
    if (el.id === 'sangre') {
      const h = health(player);
      if (h && h.currentValue > 4 + tier) h.setCurrentValue(h.currentValue - (2 + tier));
    }
    if (el.id === 'arcano') d._manaBoostUntil = system.currentTick + s.duration;
    for (let i = 0; i < 3; i++) particle(dim, 'rpg:aura', player.location, el.rgb);
  },
  curse(player, d, el, s, power, tier, dim) {
    const dir = flatDir(player.getViewDirection());
    const c = player.location;
    for (const e of enemiesNear(player, c, s.range, d)) {
      const v = flatDir(sub(e.location, c));
      if (v.x * dir.x + v.z * dir.z < 0.55) continue;
      trail(dim, player.getHeadLocation(), { ...e.location, y: e.location.y + 1 }, el.rgb, 0.8);
      hit(player, d, el, e, power, tier, true);
    }
    for (let i = 1; i <= s.range; i += 1.5) particle(dim, 'rpg:spark', add(player.getHeadLocation(), mul(player.getViewDirection(), i)), el.rgb);
  },
  lance(player, d, el, s, power, tier, dim) {
    const head = player.getHeadLocation();
    const end = lookTarget(player, s.range, d).point;
    trail(dim, head, end, el.rgb, 0.35);
    const mid = mul(add(head, end), 0.5);
    for (const e of enemiesNear(player, mid, s.range / 2 + 2, d)) {
      const p = { ...e.location, y: e.location.y + 1 };
      if (distToSegment(p, head, end) <= 1.5) hit(player, d, el, e, power, tier);
    }
  },
  zone(player, d, el, s, power, tier, dim) {
    const c = lookTarget(player, s.range, d).point;
    const pulses = Math.max(1, Math.floor(s.duration / 10));
    let n = 0;
    const id = system.runInterval(() => {
      if (!valid(player) || n++ >= pulses) return system.clearRun(id);
      ring(dim, c, s.radius, el.rgb, 16);
      particle(dim, 'rpg:burst', c, el.rgb);
      for (const e of enemiesNear(player, c, s.radius, d)) hit(player, d, el, e, power, tier, false, true);
    }, 10);
  },
  ward(player, d, el, s, power, tier, dim) {
    const race = raceOf(d.race);
    const amount = (power * 3 + 4) * (race.healMult ?? 1);
    heal(player, amount);
    effect(player, 'absorption', 600, Math.min(4, tier), true);
    if (['luz', 'agua', 'naturaleza'].includes(el.id)) {
      for (const p of world.getAllPlayers()) if (p.id !== player.id && p.dimension.id === dim.id && dist(p.location, player.location) < 8) {
        heal(p, amount * 0.7);
        particle(dim, 'minecraft:heart_particle', { ...p.location, y: p.location.y + 2 });
      }
    }
    if (el.id === 'necromancia' || el.id === 'sangre') {
      let drained = 0;
      for (const e of enemiesNear(player, player.location, 6 + tier, d)) {
        damage(e, power * 0.5, player, 'magic');
        drained += power * 0.5;
        trail(dim, { ...e.location, y: e.location.y + 1 }, player.getHeadLocation(), el.rgb, 0.5);
      }
      heal(player, drained);
    }
    if (el.id === 'tierra' || el.id === 'hielo') effect(player, 'resistance', 200, Math.min(2, tier), true);
    if (el.id === 'oscuridad') effect(player, 'invisibility', 200, 0, false);
    for (let i = 0; i < 3; i++) particle(dim, 'rpg:aura', player.location, el.rgb);
    particle(dim, 'minecraft:heart_particle', { ...player.location, y: player.location.y + 2 });
  },
  step(player, d, el, s, power, tier, dim) {
    const dir = player.getViewDirection();
    const f = flatDir(dir);
    if (el.step === 'blink') {
      const t = lookTarget(player, s.range, d);
      const dest = sub(t.point, mul(dir, 1.2));
      dest.y = Math.floor(dest.y);
      let safe = false;
      for (let dy = 0; dy < 3 && !safe; dy++) {
        const a = getBlock(dim, { x: Math.floor(dest.x), y: dest.y + dy, z: Math.floor(dest.z) });
        const b = getBlock(dim, { x: Math.floor(dest.x), y: dest.y + dy + 1, z: Math.floor(dest.z) });
        if (a && b && !isSolid(a) && !isSolid(b)) { dest.y += dy; safe = true; }
      }
      if (!safe) return actionbar(player, '§7No hay espacio para teletransportarse.');
      trail(dim, player.location, dest, el.rgb, 0.5);
      try { player.teleport({ x: dest.x, y: dest.y, z: dest.z }, { keepVelocity: false }); } catch {}
      particle(dim, 'rpg:burst', dest, el.rgb);
      if (el.id === 'necromancia') effect(player, 'invisibility', 60, 0);
    } else if (el.step === 'leap') {
      knockback(player, f.x, f.z, 0.9 + tier * 0.15, 0.9 + tier * 0.12);
      effect(player, 'slow_falling', 60 + tier * 10, 0);
      ring(dim, player.location, 1.5, el.rgb, 12);
      if (el.id === 'tierra') {
        system.runTimeout(() => {
          if (!valid(player)) return;
          ring(dim, player.location, 3, el.rgb, 20);
          for (const e of enemiesNear(player, player.location, 4, d)) hit(player, d, el, e, power, tier);
        }, 25);
      }
    } else {
      knockback(player, f.x, f.z, 1.6 + tier * 0.25, 0.25);
      const start = player.location;
      system.runTimeout(() => {
        if (!valid(player)) return;
        trail(dim, start, player.location, el.rgb, 0.4);
        for (const e of enemiesNear(player, mul(add(start, player.location), 0.5), 4, d)) {
          if (distToSegment(e.location, start, player.location) <= 1.8) hit(player, d, el, e, Math.max(2, power * 0.6), tier);
        }
      }, 6);
    }
  },
  summon(player, d, el, s, power, tier, dim) {
    const count = tier >= 4 ? 3 : tier >= 2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const loc = { x: player.location.x + rand(-1.5, 1.5), y: player.location.y + 0.2, z: player.location.z + rand(-1.5, 1.5) };
      hooks.spawnSummon?.(player, el, s, loc, tier, power);
    }
  },
  rain(player, d, el, s, power, tier, dim) {
    const c = lookTarget(player, s.range, d).point;
    const strikes = 3 + tier * 2;
    let n = 0;
    ring(dim, c, s.radius, el.rgb, 30);
    const id = system.runInterval(() => {
      if (!valid(player) || n++ >= strikes) return system.clearRun(id);
      const p = { x: c.x + rand(-s.radius, s.radius), y: c.y, z: c.z + rand(-s.radius, s.radius) };
      if (el.id === 'rayo') {
        try { dim.spawnEntity('minecraft:lightning_bolt', p); } catch {}
      } else {
        for (let k = 0; k < 6; k++) particle(dim, 'rpg:spark', { x: p.x, y: p.y + 8 - k * 1.4, z: p.z }, el.rgb);
        particle(dim, el.id === 'fuego' || el.id === 'tierra' ? 'minecraft:huge_explosion_emitter' : 'rpg:burst', p, el.rgb);
        sound(dim, el.id === 'fuego' ? 'random.explode' : el.sound, p, 0.8, 1.2);
      }
      for (const e of enemiesNear(player, p, 2.8, d)) hit(player, d, el, e, power, tier, false, true);
    }, 6);
  },
};

/* ------------------------------------------------------------------ */
/* Habilidades raciales                                                 */
/* ------------------------------------------------------------------ */

export function castRacial(player, d) {
  const race = raceOf(d.race);
  const r = race.racial;
  const left = cooldownLeft(player, 'racial');
  if (left > 0) return actionbar(player, `§c${r.name} se recarga: ${left}s`);
  if ((d.mana ?? 0) < r.mana) return actionbar(player, `§9Maná insuficiente (${Math.floor(d.mana)}/${r.mana})`);
  onCooldown(player, 'racial', r.cd * 20);
  d.mana -= r.mana;
  const dim = player.dimension;
  const loc = player.location;
  const lvl = d.level;
  const rgb = [1, 0.85, 0.3];
  switch (d.race) {
    case 'humano': {
      const h = hpOf(player);
      heal(player, h.max * 0.4);
      effect(player, 'resistance', 200, 1, true);
      break;
    }
    case 'elfo':
      for (const p of world.getAllPlayers()) if (p.dimension.id === dim.id && dist(p.location, loc) < 10) {
        effect(p, 'regeneration', 240, 1, true);
        effect(p, 'speed', 240, 0, true);
        particle(dim, 'minecraft:villager_happy', { ...p.location, y: p.location.y + 1 });
      }
      break;
    case 'enano':
      effect(player, 'resistance', 160, 2, true);
      effect(player, 'strength', 160, 0, true);
      particle(dim, 'minecraft:knockback_roar_particle', loc);
      break;
    case 'orco':
      effect(player, 'strength', 200, 1, true);
      for (const e of enemiesNear(player, loc, 8, d)) effect(e, 'weakness', 200, 1);
      sound(dim, 'mob.ravager.roar', loc, 1.5, 1);
      particle(dim, 'minecraft:knockback_roar_particle', loc);
      break;
    case 'bestia':
      effect(player, 'speed', 200, 2, true);
      effect(player, 'jump_boost', 200, 1, true);
      effect(player, 'strength', 200, 0, true);
      sound(dim, 'mob.wolf.growl', loc, 1, 1);
      break;
    case 'demonio': {
      const h = health(player);
      if (h) h.setCurrentValue(Math.max(1, h.currentValue - h.effectiveMax * 0.3));
      d.mana = maxMana(d);
      effect(player, 'strength', 240, 1, true);
      particle(dim, 'minecraft:huge_explosion_emitter', loc);
      break;
    }
    case 'celestial':
      for (const e of enemiesNear(player, loc, 8, d)) {
        damage(e, (6 + lvl * 0.4) * (isUndead(e) ? 3 : 1), player, 'magic');
        trail(dim, { ...e.location, y: e.location.y + 6 }, e.location, [1, 1, 0.7], 0.5);
      }
      for (const p of world.getAllPlayers()) if (p.dimension.id === dim.id && dist(p.location, loc) < 8) heal(p, 8 * 1.5);
      particle(dim, 'minecraft:totem_particle', loc);
      break;
    case 'vampiro': {
      effect(player, 'invisibility', 160, 0, false);
      effect(player, 'speed', 160, 1, false);
      let n = 0;
      const id = system.runInterval(() => {
        if (!valid(player) || n++ >= 8) return system.clearRun(id);
        for (const e of enemiesNear(player, player.location, 5, d)) {
          damage(e, 1.5 + lvl * 0.05, player, 'magic');
          heal(player, 1.5);
          particle(dim, 'rpg:spark', { ...e.location, y: e.location.y + 1 }, [0.7, 0, 0.1]);
        }
      }, 20);
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
      for (const p of world.getAllPlayers()) if (p.dimension.id === dim.id && dist(p.location, loc) < 8) heal(p, 10);
      particle(dim, 'minecraft:crop_growth_emitter', loc);
      for (let i = 0; i < 3; i++) particle(dim, 'rpg:aura', loc, [1, 0.6, 1]);
      break;
    }
    case 'draconido': {
      const dir = flatDir(player.getViewDirection());
      const head = player.getHeadLocation();
      for (let i = 1; i <= 8; i++) for (let k = 0; k < 2; k++) particle(dim, 'minecraft:basic_flame_particle', { x: head.x + dir.x * i + rand(-0.5, 0.5) * i * 0.3, y: head.y - 0.3, z: head.z + dir.z * i + rand(-0.5, 0.5) * i * 0.3 });
      for (const e of enemiesNear(player, loc, 9, d)) {
        const v = flatDir(sub(e.location, loc));
        if (v.x * dir.x + v.z * dir.z < 0.5) continue;
        damage(e, 8 + lvl * 0.5, player, 'fire');
        try { e.setOnFire(6, true); } catch {}
      }
      sound(dim, 'mob.enderdragon.growl', loc, 1, 1.2);
      break;
    }
  }
  for (let i = 0; i < 2; i++) particle(dim, 'rpg:aura', loc, rgb);
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

export { g, randInt };
