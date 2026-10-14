// Mazmorras procedurales con rango (F → SSS): aparecen cerca de los jugadores, tienen oleadas y un jefe final.
import { world, system, ItemStack } from '@minecraft/server';
import { getP, dirty, W, wDirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addXp, addGold, addGuildPoints, msg, title } from '../core/progression.js';
import { powerRank } from '../core/profile.js';
import { DUNGEON_POOLS, BOSS_BY_RANK, BOSSES } from '../data/mobs.js';
import { RANKS, rk, rkB } from '../data/ranks.js';
import { buildDungeon, placeChest } from './build.js';
import { makeItem, getBlock, particle, sound, valid } from '../util/compat.js';
import { rand, randInt, pick, dist, dist2D, cardinal, clamp } from '../util/math.js';

export const hooks = { questProgress: undefined };
const lastGen = new Map();

function nearestDungeon(loc) {
  let best;
  let bd = Infinity;
  for (const dg of W().dungeons) {
    const dd = dist2D(dg, loc);
    if (dd < bd) { bd = dd; best = dg; }
  }
  return { dungeon: best, distance: bd };
}

export function tryGenerate(player, force = false, forcedRank) {
  const d = getP(player);
  if (!d || player.dimension.id !== 'minecraft:overworld') return false;
  const w = W();
  const active = w.dungeons.filter((x) => x.state !== 'cleared');
  if (!force && active.length >= cfg('maxDungeons')) return false;
  if (!force && nearestDungeon(player.location).distance < cfg('dungeonSpacing')) return false;
  const ang = Math.random() * Math.PI * 2;
  const r = force ? 14 : randInt(24, 40);
  const x = Math.floor(player.location.x + Math.cos(ang) * r);
  const z = Math.floor(player.location.z + Math.sin(ang) * r);
  const probe = getBlock(player.dimension, { x, y: Math.floor(player.location.y), z });
  if (!probe) return false;
  let rank = forcedRank ?? clamp(powerRank(d) + randInt(-1, 1), 0, 8);
  if (d.guild?.member && forcedRank === undefined) rank = clamp(Math.round((rank + d.guild.rank) / 2), 0, 8);
  const built = buildDungeon(player.dimension, x, z, rank);
  if (!built) return false;
  const dg = {
    id: (w.dgCount = (w.dgCount ?? 0) + 1),
    x: built.entrance.x, y: built.entrance.y, z: built.entrance.z,
    room: built.room, R: built.R, H: built.H, rank, state: 'new', wave: 0, day: world.getDay(),
  };
  w.dungeons.push(dg);
  wDirty();
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== 'minecraft:overworld' || dist2D(p.location, dg) > 120) continue;
    msg(p, `§5✦ Sientes una presencia oscura... Ha aparecido una §lmazmorra de rango ${rkB(rank)}§r§5 a ${Math.round(dist2D(p.location, dg))} bloques al §f${cardinal(p.location, dg)}§5.`);
    try { p.playSound('ambient.cave', { volume: 1, pitch: 0.6 }); } catch {}
  }
  return true;
}

function inRoom(dg, loc) {
  return Math.abs(loc.x - dg.room.x) <= dg.R + 0.5 && Math.abs(loc.z - dg.room.z) <= dg.R + 0.5 && loc.y >= dg.room.y - 1 && loc.y <= dg.room.y + dg.H;
}

function waveCount(rank) {
  return 1 + Math.floor(rank / 3) + (rank >= 0 ? 1 : 0);
}

function spawnWave(dg, dim) {
  const total = waveCount(dg.rank);
  const isBoss = dg.wave === total - 1;
  const tag = 'rpg_dng_' + dg.id;
  const spot = () => ({ x: dg.room.x + rand(-dg.R + 1, dg.R - 1), y: dg.room.y + 0.1, z: dg.room.z + rand(-dg.R + 1, dg.R - 1) });
  if (isBoss) {
    const bossId = BOSS_BY_RANK[dg.rank] ?? 'rpg:mimic';
    try {
      const e = dim.spawnEntity(bossId, { x: dg.room.x, y: dg.room.y + 0.1, z: dg.room.z - 3 });
      e.addTag(tag);
      if (BOSSES[bossId]) e.nameTag = BOSSES[bossId].title;
      else try { e.triggerEvent('rpg:tier_' + Math.min(4, dg.rank + 2)); } catch {}
    } catch {}
    for (let i = 0; i < Math.min(4, dg.rank); i++) spawnMob(dim, pick(DUNGEON_POOLS[dg.rank]), spot(), tag, dg.rank);
    sound(dim, 'mob.wither.spawn', dg.room, 1, 1.2);
    return 'boss';
  }
  const n = 3 + dg.rank + dg.wave;
  for (let i = 0; i < n; i++) spawnMob(dim, pick(DUNGEON_POOLS[dg.rank]), spot(), tag, dg.rank);
  return 'wave';
}

function spawnMob(dim, type, loc, tag, rank) {
  try {
    const e = dim.spawnEntity(type, loc);
    e.addTag(tag);
    const tier = rank >= 6 ? 2 : rank >= 3 ? 1 : 0;
    if (tier && type.startsWith('rpg:')) {
      e.triggerEvent('rpg:tier_' + tier);
      e.setDynamicProperty('rpg:tier', tier);
    }
    particle(dim, 'minecraft:large_explosion', loc);
  } catch {}
}

function remaining(dg, dim) {
  try {
    return dim.getEntities({ tags: ['rpg_dng_' + dg.id], location: dg.room, maxDistance: 48 }).filter(valid).length;
  } catch {
    return 1;
  }
}

function lootFor(rank) {
  const items = [
    ['minecraft:iron_ingot', 3 + rank], ['rpg:mana_potion', 2], ['rpg:monster_core', 1 + rank], ['minecraft:bread', 6],
  ];
  if (rank >= 1) items.push(['minecraft:gold_ingot', 2 + rank], ['rpg:elixir_life', 1]);
  if (rank >= 2) items.push(['rpg:mithril_ingot', rank - 1], ['minecraft:diamond', Math.max(1, Math.floor(rank / 2))]);
  if (rank >= 3) items.push(['rpg:rune_stone', 1], ['rpg:greater_mana_potion', 1]);
  if (rank >= 4) items.push(['rpg:adamantite_ingot', rank - 3], ['minecraft:golden_apple', 1]);
  if (rank >= 6) items.push(['minecraft:enchanted_golden_apple', 1], ['rpg:boss_core', 1]);
  const nextBoss = BOSS_BY_RANK[Math.min(8, rank + 1)];
  if (nextBoss && Math.random() < 0.4) items.push([BOSSES[nextBoss].seal, 1]);
  return items;
}

function clearDungeon(dg, dim) {
  dg.state = 'cleared';
  dg.clearedDay = world.getDay();
  wDirty();
  placeChest(dim, { x: dg.room.x, y: dg.room.y, z: dg.room.z + 2 }, lootFor(dg.rank), makeItem);
  particle(dim, 'minecraft:totem_particle', dg.room);
  sound(dim, 'random.levelup', dg.room, 1, 1);
  const players = world.getAllPlayers().filter((p) => p.dimension.id === dim.id && dist(p.location, dg.room) < dg.R + 12);
  for (const p of players) {
    title(p, '§a§l¡Mazmorra completada!', `§fRango ${rkB(dg.rank)}`);
    addXp(p, 150 * (dg.rank + 1) * (1 + dg.rank * 0.3), 'dungeon');
    addGold(p, 40 * (dg.rank + 1));
    addGuildPoints(p, 30 * (dg.rank + 1));
    hooks.questProgress?.(p, 'dungeon', '', 1, dg.rank);
    const d = getP(p);
    if (d) {
      d.stats2 = d.stats2 ?? {};
      d.stats2.dungeons = (d.stats2.dungeons ?? 0) + 1;
      dirty(p);
    }
  }
}

export function dungeonTick() {
  const w = W();
  const nowT = world.getAbsoluteTime();
  const overworld = world.getDimension('overworld');
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== 'minecraft:overworld') continue;
    const d = getP(player);
    if (!d) continue;
    // Generación periódica
    const last = lastGen.get(player.id) ?? nowT;
    if (!lastGen.has(player.id)) lastGen.set(player.id, nowT);
    if (nowT - last >= cfg('dungeonEveryMin') * 60 * 20) {
      lastGen.set(player.id, nowT);
      if (Math.random() < cfg('dungeonChance')) tryGenerate(player);
    }
    // Activación
    for (const dg of w.dungeons) {
      if (dg.state === 'cleared' || dist2D(player.location, dg.room) > dg.R + 2) continue;
      if (!inRoom(dg, player.location)) continue;
      if (dg.state === 'new') {
        dg.state = 'active';
        dg.wave = 0;
        wDirty();
        title(player, `§5§lMazmorra ${rkB(dg.rank)}`, `§fOleada 1/${waveCount(dg.rank)}`);
        spawnWave(dg, overworld);
        dg.spawnedAt = nowT;
      }
    }
  }
  // Progreso de oleadas
  for (const dg of w.dungeons) {
    if (dg.state !== 'active') continue;
    if (nowT - (dg.spawnedAt ?? 0) < 60) continue;
    const near = world.getAllPlayers().some((p) => p.dimension.id === 'minecraft:overworld' && dist(p.location, dg.room) < dg.R + 20);
    if (!near) continue;
    if (remaining(dg, overworld) > 0) continue;
    dg.wave++;
    wDirty();
    if (dg.wave >= waveCount(dg.rank)) clearDungeon(dg, overworld);
    else {
      const kind = spawnWave(dg, overworld);
      dg.spawnedAt = nowT;
      for (const p of world.getAllPlayers()) if (dist(p.location, dg.room) < dg.R + 12) title(p, kind === 'boss' ? '§4§l¡JEFE!' : `§5Oleada ${dg.wave + 1}/${waveCount(dg.rank)}`, kind === 'boss' ? '§fEl guardián de la mazmorra ha despertado' : '');
    }
  }
  // Limpieza de mazmorras viejas
  const day = world.getDay();
  const before = w.dungeons.length;
  w.dungeons = w.dungeons.filter((x) => !(x.state === 'cleared' && day - (x.clearedDay ?? day) > 7));
  if (w.dungeons.length !== before) wDirty();
}

export function dungeonList(player) {
  return W().dungeons
    .filter((x) => x.state !== 'cleared')
    .map((x) => ({ ...x, distance: Math.round(dist2D(player.location, x)), dir: cardinal(player.location, x) }))
    .sort((a, b) => a.distance - b.distance);
}

export { RANKS, rk, ItemStack };
