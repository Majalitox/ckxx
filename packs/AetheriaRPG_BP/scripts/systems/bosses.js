// Jefes: habilidades por guion, invocación con sellos y recompensas para todos los que participaron.
import { world, system, ItemStack } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { addXp, addGold, addGuildPoints, addKarma, msg, title } from '../core/progression.js';
import { BOSSES } from '../data/mobs.js';
import { rkB } from '../data/ranks.js';
import { particle, sound, damage, effect, knockback, valid, hpOf, heal, getBlock, cmd } from '../util/compat.js';
import { dist, rand, randInt, pick } from '../util/math.js';

/** Ganchos que asigna main.js (p. ej. registrar la hazaña). */
export const hooks = { onDefeated: undefined }; // (player, bossTypeId)

const damagers = new Map(); // bossId -> Map(playerId -> dmg)
const nextAbility = new Map();

export function bossDamage(target, player, amount) {
  if (!BOSSES[target.typeId]) return;
  let m = damagers.get(target.id);
  if (!m) damagers.set(target.id, (m = new Map()));
  m.set(player.id, (m.get(player.id) ?? 0) + amount);
}

export function summonBoss(player, bossId) {
  const b = BOSSES[bossId];
  if (!b) return false;
  if (player.dimension.id !== 'minecraft:overworld' && bossId !== 'rpg:demon_lord') {
    msg(player, '§cEste sello solo funciona en el mundo superior.');
    return false;
  }
  const dir = player.getViewDirection();
  const l = Math.hypot(dir.x, dir.z) || 1;
  const loc = { x: player.location.x + (dir.x / l) * 6, y: player.location.y + 0.5, z: player.location.z + (dir.z / l) * 6 };
  let e;
  try { e = player.dimension.spawnEntity(bossId, loc); } catch (err) {
    msg(player, '§cNo se pudo invocar al jefe aquí.');
    return false;
  }
  try { e.nameTag = b.title; } catch {}
  sound(player.dimension, 'mob.wither.spawn', loc, 2, 0.8);
  particle(player.dimension, 'minecraft:huge_explosion_emitter', loc);
  for (const p of world.getAllPlayers()) if (p.dimension.id === player.dimension.id && dist(p.location, loc) < 80) {
    title(p, `${b.title}`, `§7Jefe de rango ${rkB(b.rank)} §7ha despertado`);
  }
  return true;
}

function playable(p) {
  let mode = '';
  try { mode = String(p.getGameMode()).toLowerCase(); } catch {}
  return mode !== 'creative' && mode !== 'spectator';
}

function playersNear(boss, r) {
  return world.getAllPlayers().filter((p) => p.dimension.id === boss.dimension.id && dist(p.location, boss.location) <= r && playable(p));
}

function spawnAround(boss, type, n, r = 3) {
  for (let i = 0; i < n; i++) {
    try {
      const e = boss.dimension.spawnEntity(type, { x: boss.location.x + rand(-r, r), y: boss.location.y + 0.5, z: boss.location.z + rand(-r, r) });
      e.addTag('rpg_minion');
    } catch {}
  }
}

function bolt(boss, target, dmg, rgb, extra) {
  const from = { x: boss.location.x, y: boss.location.y + 2, z: boss.location.z };
  const to = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
  const n = 16;
  for (let i = 0; i <= n; i++) particle(boss.dimension, 'rpg:spark', { x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n, z: from.z + (to.z - from.z) * i / n }, rgb);
  damage(target, dmg, boss, 'magic');
  extra?.(target);
}

function slam(boss, r, dmg, rgb) {
  particle(boss.dimension, 'minecraft:huge_explosion_emitter', boss.location);
  sound(boss.dimension, 'random.explode', boss.location, 1.5, 0.7);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    particle(boss.dimension, 'rpg:spark', { x: boss.location.x + Math.cos(a) * r, y: boss.location.y + 0.3, z: boss.location.z + Math.sin(a) * r }, rgb);
  }
  for (const p of playersNear(boss, r)) {
    damage(p, dmg, boss, 'entityAttack');
    const dx = p.location.x - boss.location.x;
    const dz = p.location.z - boss.location.z;
    const l = Math.hypot(dx, dz) || 1;
    knockback(p, dx / l, dz / l, 1.2, 0.6);
  }
}

function meteors(boss, targets, n, dmg) {
  const dim = boss.dimension;
  let k = 0;
  const id = system.runInterval(() => {
    if (!valid(boss) || k++ >= n) return system.clearRun(id);
    const t = pick(targets);
    if (!valid(t)) return;
    const p = { x: t.location.x + rand(-2, 2), y: t.location.y, z: t.location.z + rand(-2, 2) };
    for (let i = 0; i < 6; i++) particle(dim, 'minecraft:basic_flame_particle', { x: p.x, y: p.y + 9 - i * 1.5, z: p.z });
    system.runTimeout(() => {
      particle(dim, 'minecraft:huge_explosion_emitter', p);
      sound(dim, 'random.explode', p, 1, 1);
      for (const pl of playersNear({ dimension: dim, location: p }, 3)) {
        damage(pl, dmg, valid(boss) ? boss : undefined, 'fire');
        try { pl.setOnFire(4, true); } catch {}
      }
    }, 8);
  }, 10);
}

const AI = {
  'rpg:goblin_king'(boss, ps, phase2) {
    if (Math.random() < 0.5) {
      spawnAround(boss, 'rpg:goblin', phase2 ? 4 : 2);
      sound(boss.dimension, 'mob.evocation_illager.prepare_summon', boss.location, 1, 1.2);
      return 7;
    }
    slam(boss, 5, 6, [0.3, 0.8, 0.2]);
    return 5;
  },
  'rpg:spider_queen'(boss, ps, phase2) {
    const r = Math.random();
    if (r < 0.35) {
      for (const p of ps) {
        const l = p.location;
        const b = getBlock(p.dimension, { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
        if (b && b.isAir) cmd(p.dimension, `setblock ${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} web`);
      }
      return 6;
    }
    if (r < 0.65) {
      spawnAround(boss, 'rpg:giant_spider', phase2 ? 2 : 1);
      return 8;
    }
    for (const p of ps) bolt(boss, p, 6, [0.4, 0.9, 0.2], (t) => effect(t, 'poison', 120, 1));
    return 4;
  },
  'rpg:ancient_golem'(boss, ps, phase2) {
    if (Math.random() < 0.5) { slam(boss, 7, 12, [0.6, 0.6, 0.6]); return 6; }
    for (const p of ps.slice(0, 2)) bolt(boss, p, 12, [0.5, 0.4, 0.3], (t) => effect(t, 'slowness', 60, 2));
    if (phase2) effect(boss, 'resistance', 100, 1);
    return 5;
  },
  'rpg:lich'(boss, ps, phase2) {
    const r = Math.random();
    if (r < 0.3) {
      spawnAround(boss, Math.random() < 0.5 ? 'minecraft:skeleton' : 'rpg:skeleton_knight', phase2 ? 4 : 3);
      sound(boss.dimension, 'mob.evocation_illager.prepare_summon', boss.location, 1, 0.8);
      return 8;
    }
    if (r < 0.5 && ps.length) {
      const t = pick(ps);
      try { boss.teleport({ x: t.location.x + rand(-3, 3), y: t.location.y, z: t.location.z + rand(-3, 3) }); } catch {}
      particle(boss.dimension, 'minecraft:portal_reverse_particle', boss.location);
      return 3;
    }
    for (const p of ps) bolt(boss, p, 10, [0.3, 1, 0.5], (t) => effect(t, 'wither', 100, 1));
    heal(boss, 15);
    return 4;
  },
  'rpg:demon_lord'(boss, ps, phase2) {
    const r = Math.random();
    if (r < 0.35) { meteors(boss, ps, phase2 ? 8 : 5, 14); return 7; }
    if (r < 0.6) { spawnAround(boss, 'rpg:fire_imp', phase2 ? 4 : 2); return 8; }
    slam(boss, 6, 16, [1, 0.3, 0]);
    for (const p of playersNear(boss, 6)) try { p.setOnFire(6, true); } catch {}
    return 5;
  },
  'rpg:ash_dragon'(boss, ps, phase2) {
    const r = Math.random();
    if (r < 0.4 && ps.length) {
      const t = pick(ps);
      const dx = t.location.x - boss.location.x;
      const dz = t.location.z - boss.location.z;
      const l = Math.hypot(dx, dz) || 1;
      for (let i = 1; i <= 14; i++) for (let k = 0; k < 3; k++) particle(boss.dimension, 'minecraft:basic_flame_particle', { x: boss.location.x + (dx / l) * i + rand(-1, 1) * i * 0.2, y: boss.location.y + 3 - i * 0.12, z: boss.location.z + (dz / l) * i + rand(-1, 1) * i * 0.2 });
      sound(boss.dimension, 'mob.enderdragon.growl', boss.location, 2, 0.8);
      for (const p of playersNear(boss, 15)) {
        const vx = p.location.x - boss.location.x;
        const vz = p.location.z - boss.location.z;
        const vl = Math.hypot(vx, vz) || 1;
        if ((vx / vl) * (dx / l) + (vz / vl) * (dz / l) > 0.7) {
          damage(p, 20, boss, 'fire');
          try { p.setOnFire(8, true); } catch {}
        }
      }
      return 5;
    }
    if (r < 0.65) { meteors(boss, ps, phase2 ? 10 : 6, 18); return 7; }
    slam(boss, 9, 14, [0.6, 0.2, 0.1]);
    return 5;
  },
  'rpg:void_king'(boss, ps, phase2) {
    const r = Math.random();
    if (phase2) effect(boss, 'strength', 200, 2);
    if (r < 0.25) {
      for (const p of playersNear(boss, 20)) { effect(p, 'darkness', 120, 0); effect(p, 'blindness', 40, 0); damage(p, 10, boss, 'magic'); }
      particle(boss.dimension, 'minecraft:sonic_explosion', boss.location);
      return 5;
    }
    if (r < 0.45) { spawnAround(boss, 'rpg:demon_knight', phase2 ? 3 : 2); return 9; }
    if (r < 0.7) {
      for (const p of ps) bolt(boss, p, 22, [0.3, 0, 0.5], (t) => { effect(t, 'wither', 100, 2); heal(boss, 20); });
      return 4;
    }
    meteors(boss, ps, 8, 20);
    slam(boss, 8, 18, [0.2, 0, 0.3]);
    return 6;
  },
};

/** IA de jefes (cada segundo). */
export function bossTick() {
  const now = system.currentTick;
  for (const dimId of ['overworld', 'nether', 'the_end']) {
    let list = [];
    try { list = world.getDimension(dimId).getEntities({ families: ['rpg_boss'] }); } catch { continue; }
    for (const boss of list) {
      if (!valid(boss)) continue;
      const ai = AI[boss.typeId];
      if (!ai) continue;
      const ps = playersNear(boss, 24);
      if (!ps.length) continue;
      if (now < (nextAbility.get(boss.id) ?? 0)) continue;
      const h = hpOf(boss);
      const phase2 = h.max > 0 && h.cur / h.max < 0.5;
      let wait = 5;
      try { wait = ai(boss, ps, phase2); } catch (e) { console.warn('[Aetheria] IA de jefe: ' + e); }
      nextAbility.set(boss.id, now + (phase2 ? wait * 0.7 : wait) * 20);
    }
  }
}

export function onBossDeath(boss, killer) {
  const b = BOSSES[boss.typeId];
  if (!b) return;
  const m = damagers.get(boss.id) ?? new Map();
  damagers.delete(boss.id);
  nextAbility.delete(boss.id);
  if (killer) m.set(killer.id, (m.get(killer.id) ?? 0) + 1);
  const players = world.getAllPlayers().filter((p) => m.has(p.id));
  try { world.sendMessage(`§6[Gremio] §e¡${b.name} (rango ${rkB(b.rank)}§e) ha sido derrotado por: §f${players.map((p) => p.name).join(', ')}§e!`); } catch {}
  for (const p of players) {
    const d = getP(p);
    if (!d) continue;
    title(p, '§6§l¡JEFE DERROTADO!', `§f${b.name}`);
    addXp(p, b.xp, 'boss');
    addGold(p, b.gold);
    addGuildPoints(p, b.gp);
    addKarma(p, 10, 'derrotar a un jefe');
    d.stats2 = d.stats2 ?? {};
    d.stats2.bosses = (d.stats2.bosses ?? 0) + 1;
    d.titles = d.titles ?? [];
    const t = 'Matador: ' + b.name;
    if (!d.titles.includes(t)) d.titles.push(t);
    dirty(p);
    try { hooks.onDefeated?.(p, boss.typeId); } catch (e) { console.warn('[Aetheria] onDefeated: ' + e); }
  }
  // Cadena de jefes: a veces sueltan el sello del siguiente.
  const next = Object.entries(BOSSES).find(([, x]) => x.rank === b.rank + 1);
  if (next && Math.random() < 0.35) try { boss.dimension.spawnItem(new ItemStack(next[1].seal, 1), boss.location); } catch {}
}

export { randInt };
