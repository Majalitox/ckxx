// Combate: daño por estadísticas/raza/runas, esquiva, robo de vida, muertes, recompensas y escalado de monstruos.
import { world, system, ItemStack } from '@minecraft/server';
import { getP, dirty, W } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addXp, addGold, addKarma, addHobbyXp, addGuildPoints, msg, actionbar, title } from '../core/progression.js';
import { stat, stageMult, xpNeed, isVillain, hobbyLevel } from '../core/profile.js';
import { raceOf } from '../data/races.js';
import { MOBS, BOSSES, ANIMALS, VILLAGERS, mobInfo } from '../data/mobs.js';
import { RANKS, rk } from '../data/ranks.js';
import { readRunes } from '../data/items.js';
import { effect, damage, heal, health, hpOf, valid, heldItem, giveItem, particle, knockback, sound } from '../util/compat.js';
import { randInt, chance, dist2D, clamp } from '../util/math.js';
import { bountyOf } from './guild.js';
import * as fx from './spellfx.js';

export const hooks = { questProgress: undefined, onNpcDeath: undefined, onBossDeath: undefined, bossDamage: undefined, onDungeonKill: undefined, statusLine: undefined };

const lastHit = new Map(); // entityId -> { pid, tick, fortune }
const TIER_MULT = [1, 1.5, 2.2, 3.2, 4.5];

function playerById(id) {
  return world.getAllPlayers().find((p) => p.id === id);
}

function equipmentRunes(player) {
  const out = [];
  try {
    const eq = player.getComponent('minecraft:equippable');
    for (const slot of ['Head', 'Chest', 'Legs', 'Feet']) {
      const it = eq?.getEquipment(slot);
      if (it) out.push(...readRunes(it));
    }
  } catch {}
  return out;
}

export function meleeMult(player, d, runes) {
  const race = raceOf(d.race);
  let m = (race.melee ?? 1) * (1 + (stat(d, 'str') - 5) * 0.025) * stageMult(d);
  if (runes.includes('montana')) m *= 1.35;
  if (runes.includes('berserker')) {
    const h = hpOf(player);
    if (h.max) m *= 1 + 0.6 * (1 - h.cur / h.max);
  }
  return m;
}

export function onHurt(ev) {
  const target = ev.hurtEntity;
  const src = ev.damageSource;
  const attacker = src?.damagingEntity;
  const cause = src?.cause;
  // --- El atacante es un jugador ---
  if (attacker && attacker.typeId === 'minecraft:player' && valid(target)) {
    const d = getP(attacker);
    if (d) {
      const weapon = heldItem(attacker);
      const runes = cause === 'entityAttack' ? readRunes(weapon) : [];
      lastHit.set(target.id, { pid: attacker.id, tick: system.currentTick, fortune: runes.includes('fortuna') });
      hooks.bossDamage?.(target, attacker, ev.damage);
      let bonus = 0;
      if (cause === 'entityAttack') bonus = ev.damage * (meleeMult(attacker, d, runes) - 1);
      if (cause === 'projectile' && raceOf(d.race).bow) bonus = ev.damage * (raceOf(d.race).bow - 1);
      const h = health(target);
      if (h && bonus !== 0) {
        try { h.setCurrentValue(Math.max(0, Math.min(h.effectiveMax, h.currentValue - bonus))); } catch {}
      }
      const total = ev.damage + Math.max(0, bonus);
      if (cause === 'entityAttack') {
        const ls = (raceOf(d.race).lifesteal ?? 0) + (runes.includes('vampirica') ? 0.15 : 0);
        if (ls > 0) heal(attacker, total * ls);
        if (runes.includes('fuego')) try { target.setOnFire(4, true); } catch {}
        if (runes.includes('escarcha')) effect(target, 'slowness', 60, 2);
        if (runes.includes('montana')) {
          const dx = target.location.x - attacker.location.x;
          const dz = target.location.z - attacker.location.z;
          const l = Math.hypot(dx, dz) || 1;
          knockback(target, dx / l, dz / l, 0.8, 0.3);
        }
        // Rayo con guion (sin minecraft:lightning_bolt: no quema al atacante, ni casas, ni convierte aldeanos/cerdos/creepers).
        // Diferido ~10 ticks para no chocar con la invulnerabilidad tras el golpe cuerpo a cuerpo.
        if (runes.includes('trueno') && chance(0.15)) {
          system.runTimeout(() => {
            try {
              if (!valid(target)) return;
              fx.lightning(target.dimension, target.location);
              sound(target.dimension, 'ambient.weather.thunder', target.location, 0.6, 1.4);
              damage(target, 5, valid(attacker) ? attacker : undefined, 'lightning');
            } catch {}
          }, 10);
        }
      }
    }
  }
  // --- El herido es un jugador ---
  if (target && target.typeId === 'minecraft:player') {
    const d = getP(target);
    if (!d) return;
    const dodge = Math.min(0.25, (stat(d, 'agi') - 5) * 0.005);
    if (dodge > 0 && cause === 'entityAttack' && chance(dodge)) {
      heal(target, ev.damage);
      actionbar(target, '§b¡Esquivado!');
      particle(target.dimension, 'rpg:spark', { ...target.location, y: target.location.y + 1 }, [0.6, 0.9, 1]);
      return;
    }
    if (attacker && cause === 'entityAttack' && valid(attacker)) {
      const thorns = equipmentRunes(target).filter((r) => r === 'espinas').length;
      if (thorns) damage(attacker, ev.damage * 0.25 * thorns, target, 'thorns');
    }
    if (d.race === 'orco') {
      const h = hpOf(target);
      if (h.max && h.cur / h.max < 0.3) effect(target, 'strength', 100, 1, true);
    }
  }
}

function resolveKiller(entity, src) {
  let k = src?.damagingEntity;
  if (k && k.typeId === 'rpg:spirit') {
    const owner = k.getDynamicProperty('rpg:owner');
    k = owner ? playerById(owner) : undefined;
  }
  if (k && k.typeId === 'minecraft:player') return { player: k, fortune: lastHit.get(entity.id)?.fortune };
  const lh = lastHit.get(entity.id);
  if (lh && system.currentTick - lh.tick < 200) {
    const p = playerById(lh.pid);
    if (p) return { player: p, fortune: lh.fortune };
  }
  return {};
}

function isMonsterFamily(e) {
  try { return !!e.getComponent('minecraft:type_family')?.hasTypeFamily('monster'); } catch { return false; }
}

const HUNT_DROPS = {
  'minecraft:cow': 'minecraft:leather', 'minecraft:pig': 'minecraft:porkchop', 'minecraft:sheep': 'minecraft:mutton', 'minecraft:chicken': 'minecraft:feather',
  'minecraft:rabbit': 'minecraft:rabbit_hide', 'minecraft:goat': 'minecraft:mutton', 'minecraft:mooshroom': 'minecraft:leather',
};

export function onDie(ev) {
  const dead = ev.deadEntity;
  const type = dead.typeId;
  const { player, fortune } = resolveKiller(dead, ev.damageSource);
  lastHit.delete(dead.id);

  if (type === 'minecraft:player') return onPlayerDeath(dead, player);
  if (type === 'rpg:npc') return hooks.onNpcDeath?.(dead, player);
  hooks.onDungeonKill?.(dead);
  if (!player) return;
  const d = getP(player);
  if (!d) return;
  d.stats2 = d.stats2 ?? {};

  if (BOSSES[type]) {
    hooks.onBossDeath?.(dead, player);
    hooks.questProgress?.(player, 'boss', type, 1);
    hooks.questProgress?.(player, 'kill', type, 1);
    return;
  }
  if (VILLAGERS.has(type)) {
    addKarma(player, -25, 'asesinar a un aldeano');
    hooks.questProgress?.(player, 'kill', type, 1);
    return;
  }
  if (type === 'minecraft:iron_golem') {
    addKarma(player, -15, 'destruir un guardián');
    hooks.questProgress?.(player, 'kill', type, 1);
    return;
  }
  if (ANIMALS.has(type)) {
    addHobbyXp(player, 'caza', 3);
    hooks.questProgress?.(player, 'hunt', type, 1);
    const lvl = hobbyLevel(d, 'caza');
    const extra = HUNT_DROPS[type];
    if (extra) {
      let n = chance(lvl * 0.015) ? 1 : 0;
      if (d.race === 'bestia') n += 1;
      if (n) try { dead.dimension.spawnItem(new ItemStack(extra, n), dead.location); } catch {}
    }
    return;
  }
  const info = mobInfo(type);
  const hostile = !!info || isMonsterFamily(dead);
  if (!hostile) return;
  let tier = 0;
  try { tier = Number(dead.getDynamicProperty('rpg:tier') ?? 0); } catch {}
  let maxHp = 20;
  try { maxHp = health(dead)?.effectiveMax ?? 20; } catch {}
  const xp = Math.round((info?.xp ?? 4 + maxHp * 0.5) * (TIER_MULT[tier] ?? 1));
  addXp(player, xp, 'combat');
  let gold = info ? randInt(info.gold[0], info.gold[1]) : randInt(0, 2);
  gold = Math.round(gold * (1 + tier * 0.5));
  if (fortune) gold = gold * 2 + 3;
  if (gold > 0) addGold(player, gold, true);
  if (d.guild?.member && info && info.rank >= 2) addGuildPoints(player, Math.max(1, info.rank - 1));
  addKarma(player, 1);
  d.stats2.kills = (d.stats2.kills ?? 0) + 1;
  hooks.questProgress?.(player, 'kill', type, 1);
  dirty(player);
}

function onPlayerDeath(victim, killer) {
  const d = getP(victim);
  if (d) {
    const loss = Math.floor(d.xp * cfg('deathXpLoss'));
    if (loss > 0) {
      d.xp -= loss;
      msg(victim, `§c✖ Has muerto y perdido ${loss} XP.`);
    }
    d.stats2 = d.stats2 ?? {};
    d.stats2.deaths = (d.stats2.deaths ?? 0) + 1;
    dirty(victim);
  }
  if (!killer || killer.id === victim.id) return;
  const kd = getP(killer);
  if (!kd || !d) return;
  if ((d.karma ?? 0) <= -400) {
    const bounty = bountyOf(d);
    addGold(killer, bounty);
    addKarma(killer, 30, `derrotar al villano ${victim.name}`);
    if (kd.guild?.member) addGuildPoints(killer, 40);
    const lost = Math.floor((d.gold ?? 0) * 0.25);
    d.gold -= lost;
    msg(victim, `§c✖ ${killer.name} ha cobrado la recompensa por tu cabeza. Pierdes ${lost} de oro.`);
    try { world.sendMessage(`§6[Justicia] §f${killer.name} §eha derrotado al villano §c${victim.name}§e y cobra §6${bounty} oro§e.`); } catch {}
  } else {
    addKarma(killer, isVillain(kd) ? -15 : -40, `asesinar a ${victim.name}`);
  }
}

/* ------------------------------------------------------------------ */
/* Escalado de monstruos                                                */
/* ------------------------------------------------------------------ */

/** Llena la vida hasta el máximo efectivo (incluye health_boost). Sin efectos instantáneos: instant_health daña a los no muertos. */
function fillHealth(entity) {
  try {
    if (!valid(entity)) return;
    const h = health(entity);
    if (!h) return;
    try { h.resetToMaxValue(); } catch {}
    if (h.currentValue < h.effectiveMax) h.setCurrentValue(h.effectiveMax);
  } catch {}
}

/**
 * Escala un monstruo según distancia al pueblo inicial y día. Idempotente: el nivel se fija una sola vez
 * (rpg:tier, también 0), así que recargar el chunk o volver a llamarla no vuelve a tirar dados ni a curar.
 */
export function setupMob(entity) {
  try {
    if (!cfg('mobScaling') || !valid(entity)) return;
    const type = entity.typeId;
    const info = MOBS[type];
    if (!info) return;
    if (entity.getDynamicProperty('rpg:tier') !== undefined) return;
    const town = W().town?.center;
    const distFromTown = town ? dist2D(entity.location, town) : 0;
    const day = world.getDay();
    const tier = clamp(Math.floor(distFromTown / 600) + Math.floor(day / 25) + (Math.random() < 0.08 ? 1 : 0), 0, 4);
    try { entity.setDynamicProperty('rpg:tier', tier); } catch {}
    if (tier <= 0) return;
    if (type.startsWith('rpg:')) {
      try { entity.triggerEvent('rpg:tier_' + tier); } catch {}
    } else {
      effect(entity, 'health_boost', 20000000, tier * 2 - 1, false);
      if (tier >= 2) effect(entity, 'strength', 20000000, tier - 2, false);
      if (tier >= 3) effect(entity, 'resistance', 20000000, 0, false);
      // health_boost sube el máximo, no la vida actual: se rellena directamente un tick después.
      fillHealth(entity);
      system.runTimeout(() => fillHealth(entity), 1);
    }
  } catch {}
}

/** Texto informativo del enemigo al que mira el jugador. */
export function targetInfo(player) {
  let e;
  try {
    e = player.getEntitiesFromViewDirection({ maxDistance: 16 })[0]?.entity;
  } catch {}
  if (!e || !valid(e)) return '';
  const info = mobInfo(e.typeId);
  if (!info) return '';
  const tier = Number(e.getDynamicProperty('rpg:tier') ?? 0);
  const rank = Math.min(8, info.rank + (tier >= 3 ? 1 : 0));
  const h = hpOf(e);
  const lvl = 1 + info.rank * 8 + tier * 6;
  let st = '';
  try { st = hooks.statusLine?.(e) ?? ''; } catch {}
  return `§c${info.name} §7[${rk(rank)}§7] Nv.${lvl} §c♥${Math.ceil(h.cur)}/${Math.ceil(h.max)}${st ? ' ' + st : ''}`;
}

export { TIER_MULT, xpNeed, title, RANKS };
