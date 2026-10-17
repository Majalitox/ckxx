// Jefes: habilidades por guion, invocación con sellos y recompensas para todos los que participaron.
import { world, system, ItemStack } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { addXp, addGold, addGuildPoints, addKarma, msg, title } from '../core/progression.js';
import { BOSSES } from '../data/mobs.js';
import { rkB } from '../data/ranks.js';
import { particle, sound, damage, effect, knockback, valid, hpOf, heal, getBlock, cmd, isSolid } from '../util/compat.js';
import { dist, rand, randInt, pick } from '../util/math.js';
import { lineOfSight, bodyCenter } from './spellfx.js';

/** Ganchos que asigna main.js (p. ej. registrar la hazaña). */
export const hooks = {
  onDefeated: undefined, // (player, bossTypeId)
  enemyCast: undefined, // (caster, elementId, kind, target, power, opts) => boolean — motor de hechizos (magic.enemyCast)
};

/** Lanza un hechizo enemigo con el motor de magia; si no está disponible, usa el efecto clásico. */
function cast(boss, el, kind, target, power, opts, fallback) {
  let ok = false;
  try { ok = !!hooks.enemyCast?.(boss, el, kind, target, power, opts ?? {}); } catch {}
  if (!ok) try { fallback?.(); } catch {}
  return ok;
}

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

/** Tope de esbirros vivos alrededor de un jefe (evita la acumulación sin fin en combates largos). */
export const MINION_CAP = 6;
const MINION_RADIUS = 32;

function minionsNear(boss) {
  try {
    return boss.dimension.getEntities({ location: boss.location, maxDistance: MINION_RADIUS, tags: ['rpg_minion'] }).filter(valid).length;
  } catch { return MINION_CAP; } // si no se puede contar, no invoca
}

/** Invoca hasta n esbirros sin pasar del tope. Devuelve cuántos aparecieron (0 → la IA usa otra habilidad). */
function spawnAround(boss, type, n, r = 3) {
  const room = Math.min(n, MINION_CAP - minionsNear(boss));
  let made = 0;
  for (let i = 0; i < room; i++) {
    try {
      const e = boss.dimension.spawnEntity(type, { x: boss.location.x + rand(-r, r), y: boss.location.y + 0.5, z: boss.location.z + rand(-r, r) });
      try { e.addTag('rpg_minion'); } catch {}
      made++;
    } catch {}
  }
  return made;
}

/** Línea de visión de la cabeza de `from` al centro del cuerpo de `to` (sin bloques sólidos en medio). */
function canSee(from, to) {
  try {
    let head;
    try { head = from.getHeadLocation(); } catch { head = { x: from.location.x, y: from.location.y + 1.5, z: from.location.z }; }
    const c = bodyCenter(to) ?? { x: to.location.x, y: to.location.y + 1, z: to.location.z };
    return lineOfSight(from.dimension, head, c);
  } catch { return false; }
}

/** Altura (bloques) que ocupa el Liche al teletransportarse. */
const LICH_H = 2.6;
const LICH_R = 0.4;

/** ¿Cabe una entidad de radio r y altura h con los pies en `loc`? (comprobación propia además de tryTeleport). */
function fits(dim, loc, r, h) {
  for (const [ox, oz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
    for (let y = loc.y + 0.05; y < loc.y + h; y += 0.9) {
      const b = getBlock(dim, { x: Math.floor(loc.x + ox), y: Math.floor(y), z: Math.floor(loc.z + oz) });
      if (!b || isSolid(b)) return false;
    }
    const top = getBlock(dim, { x: Math.floor(loc.x + ox), y: Math.floor(loc.y + h - 0.05), z: Math.floor(loc.z + oz) });
    if (!top || isSolid(top)) return false;
  }
  return true;
}

/** Teletransporte seguro del Liche junto a `t`: varios intentos, nunca dentro de bloques. Devuelve el destino o undefined. */
function lichBlink(boss, t) {
  const dim = boss.dimension;
  for (let i = 0; i < 8; i++) {
    const dest = { x: t.location.x + rand(-3, 3), y: t.location.y + (i % 2), z: t.location.z + rand(-3, 3) };
    if (!fits(dim, dest, LICH_R, LICH_H)) continue;
    let ok = false;
    try { ok = boss.tryTeleport(dest, { checkForBlocks: true }); } catch { ok = false; }
    if (ok) return dest;
  }
  return undefined;
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
    if (Math.random() < 0.5 && spawnAround(boss, 'rpg:goblin', phase2 ? 4 : 2) > 0) {
      sound(boss.dimension, 'mob.evocation_illager.prepare_summon', boss.location, 1, 1.2);
      return 7;
    }
    if (ps.length && Math.random() < 0.4) {
      const t = pick(ps);
      cast(boss, 'tierra', 'bolt', t, 7, { tier: 1, name: 'Pedrusco' }, () => bolt(boss, t, 6, [0.5, 0.4, 0.3]));
      return 4;
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
    if (r < 0.65 && spawnAround(boss, 'rpg:giant_spider', phase2 ? 2 : 1) > 0) return 8;
    const poison = (p) => bolt(boss, p, 6, [0.4, 0.9, 0.2], (t) => effect(t, 'poison', 120, 1));
    if (phase2) {
      for (const p of ps) cast(boss, 'naturaleza', 'barrage', p, 6, { tier: 2, name: 'Veneno de la Reina' }, () => poison(p));
    } else {
      // Una sola maldición (en cono, alcanza a varios): una por jugador se acumulaba con el número de jugadores.
      const seen = ps.filter((p) => canSee(boss, p));
      if (seen.length) {
        const t = pick(seen);
        cast(boss, 'naturaleza', 'curse', t, 6, { tier: 2, name: 'Veneno de la Reina' }, () => poison(t));
      }
    }
    return 4;
  },
  'rpg:ancient_golem'(boss, ps, phase2) {
    if (Math.random() < 0.5) { slam(boss, 7, 12, [0.6, 0.6, 0.6]); return 6; }
    if (phase2 && ps.length && Math.random() < 0.5) {
      const t = pick(ps);
      cast(boss, 'tierra', 'rain', t, 11, { tier: 3, radius: 4, strikes: 6, name: 'Lluvia de Rocas' }, () => meteors(boss, ps, 5, 11));
    } else {
      for (const p of ps.slice(0, 2)) cast(boss, 'tierra', 'bolt', p, 12, { tier: 2, name: 'Roca Rúnica' }, () => bolt(boss, p, 12, [0.5, 0.4, 0.3], (t) => effect(t, 'slowness', 60, 2)));
    }
    if (phase2) effect(boss, 'resistance', 100, 1);
    return 5;
  },
  'rpg:lich'(boss, ps, phase2) {
    const r = Math.random();
    if (r < 0.3 && spawnAround(boss, Math.random() < 0.5 ? 'minecraft:skeleton' : 'rpg:skeleton_knight', phase2 ? 4 : 3) > 0) {
      sound(boss.dimension, 'mob.evocation_illager.prepare_summon', boss.location, 1, 0.8);
      return 8;
    }
    if (r < 0.5 && ps.length) {
      const t = pick(ps);
      const before = { ...boss.location };
      const dest = lichBlink(boss, t);
      if (dest) {
        particle(boss.dimension, 'minecraft:portal_reverse_particle', before);
        particle(boss.dimension, 'minecraft:portal_reverse_particle', dest);
        return 3;
      }
    }
    if (phase2 && ps.length && Math.random() < 0.4) {
      const t = pick(ps);
      cast(boss, 'necromancia', 'zone', t, 6, { tier: 3, radius: 4, duration: 100, name: 'Cementerio Viviente' }, () => bolt(boss, t, 10, [0.3, 1, 0.5], (x) => effect(x, 'wither', 100, 1)));
    } else {
      for (const p of ps) cast(boss, 'necromancia', 'barrage', p, 9, { tier: 3, name: 'Saetas del Liche' }, () => bolt(boss, p, 10, [0.3, 1, 0.5], (t) => effect(t, 'wither', 100, 1)));
    }
    heal(boss, 15);
    return 4;
  },
  'rpg:demon_lord'(boss, ps, phase2) {
    const r = Math.random();
    if (r < 0.35) {
      const t = pick(ps);
      cast(boss, 'fuego', 'rain', t, 14, { tier: 4, radius: 5, strikes: phase2 ? 8 : 5, name: 'Lluvia Infernal' }, () => meteors(boss, ps, phase2 ? 8 : 5, 14));
      return 7;
    }
    if (r < 0.5 && ps.length) {
      const t = pick(ps);
      cast(boss, 'fuego', 'lance', t, 16, { tier: 4, name: 'Lanza del Abismo' }, () => bolt(boss, t, 14, [1, 0.3, 0], (x) => { try { x.setOnFire(4, true); } catch {} }));
      return 4;
    }
    if (r < 0.65 && spawnAround(boss, 'rpg:fire_imp', phase2 ? 4 : 2) > 0) return 8;
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
    if (r < 0.65) {
      const t = pick(ps);
      cast(boss, 'fuego', 'rain', t, 18, { tier: 4, radius: 6, strikes: phase2 ? 10 : 6, name: 'Lluvia de Ceniza' }, () => meteors(boss, ps, phase2 ? 10 : 6, 18));
      return 7;
    }
    if (r < 0.8 && ps.length) {
      const t = pick(ps);
      cast(boss, 'fuego', 'lance', t, 18, { tier: 4, name: 'Aliento Perforante' }, () => bolt(boss, t, 18, [1, 0.4, 0.1]));
      return 4;
    }
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
    if (r < 0.45 && spawnAround(boss, 'rpg:demon_knight', phase2 ? 3 : 2) > 0) return 9;
    if (r < 0.7) {
      for (const p of ps) cast(boss, 'oscuridad', 'barrage', p, 20, { tier: 4, name: 'Saetas del Vacío' }, () => bolt(boss, p, 22, [0.3, 0, 0.5], (t) => effect(t, 'wither', 100, 2)));
      heal(boss, 20);
      return 4;
    }
    if (r < 0.85 && ps.length) {
      const t = pick(ps);
      cast(boss, 'oscuridad', 'zone', t, 8, { tier: 4, radius: 5, duration: 120, name: 'Grieta del Vacío' }, () => slam(boss, 8, 18, [0.2, 0, 0.3]));
      return 6;
    }
    const t = pick(ps);
    cast(boss, 'arcano', 'rain', t, 20, { tier: 4, radius: 6, strikes: 8, name: 'Estrellas Rotas' }, () => meteors(boss, ps, 8, 20));
    slam(boss, 8, 18, [0.2, 0, 0.3]);
    return 6;
  },
};

/* --------------------------- Monstruos lanzadores --------------------------- */

// Monstruos normales que lanzan hechizos: elemento(s), tipos, probabilidad por intento, alcance y poder base.
const CASTERS = {
  'rpg:dark_mage': { els: ['oscuridad', 'necromancia', 'fuego'], kinds: ['bolt', 'bolt', 'barrage', 'curse'], chance: 0.35, range: 16, power: 6 },
  'rpg:fire_imp': { els: ['fuego'], kinds: ['bolt'], chance: 0.3, range: 12, power: 5 },
  'rpg:wraith': { els: ['oscuridad'], kinds: ['curse', 'bolt'], chance: 0.2, range: 12, power: 5 },
  'rpg:ice_golem': { els: ['hielo'], kinds: ['bolt'], chance: 0.15, range: 14, power: 7 },
};
const casterNext = new Map();

/** Cada 2 s: los magos oscuros y otros lanzadores atacan con hechizos a los jugadores cercanos. */
export function casterTick() {
  if (!hooks.enemyCast) return;
  const now = system.currentTick;
  for (const dimId of ['overworld', 'nether']) {
    let dim;
    try { dim = world.getDimension(dimId); } catch { continue; }
    const players = world.getAllPlayers().filter((p) => { try { return p.dimension.id === dim.id && playable(p); } catch { return false; } });
    if (!players.length) continue;
    for (const [type, c] of Object.entries(CASTERS)) {
      let list = [];
      try { list = dim.getEntities({ type }); } catch { continue; }
      for (const e of list) {
        if (!valid(e) || now < (casterNext.get(e.id) ?? 0)) continue;
        // El más cercano dentro del alcance y a la vista (no lanzan a través de paredes ni suelos).
        const near = [];
        for (const p of players) {
          const dd = dist(p.location, e.location);
          if (dd <= c.range) near.push({ p, dd });
        }
        if (!near.length || Math.random() >= c.chance) continue;
        near.sort((a, b) => a.dd - b.dd);
        let best;
        for (let i = 0; i < near.length && i < 3; i++) if (canSee(e, near[i].p)) { best = near[i].p; break; }
        if (!best) continue;
        const tier = Math.max(0, Math.min(4, Number(e.getDynamicProperty?.('rpg:tier') ?? 0)));
        cast(e, pick(c.els), pick(c.kinds), best, c.power + tier * 2, { tier: Math.min(3, 1 + Math.floor(tier / 2)) });
        casterNext.set(e.id, now + 60);
      }
    }
  }
  if (casterNext.size > 500) casterNext.clear();
}

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
