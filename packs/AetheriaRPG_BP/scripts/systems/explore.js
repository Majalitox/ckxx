// Exploración: distancia recorrida y descubrimiento de regiones con nombre propio.
import { world } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { addHobbyXp, addXp, addGold, title, msg } from '../core/progression.js';
import { hobbyLevel } from '../core/profile.js';
import { regionName } from '../data/names.js';
import { hash, seeded, dist2D } from '../util/math.js';
import { psound } from '../util/compat.js';

export const hooks = { questProgress: undefined };
const lastPos = new Map();
const REGION = 384;

export function regionOf(dimId, loc) {
  const rx = Math.floor(loc.x / REGION);
  const rz = Math.floor(loc.z / REGION);
  const key = `${dimId[10] ?? dimId[0]}${rx},${rz}`;
  const prefix = dimId.includes('nether') ? 'Abismo: ' : dimId.includes('end') ? 'Confín: ' : '';
  return { key, name: prefix + regionName(seeded(hash('region' + key))) };
}

export function exploreTick(player) {
  const d = getP(player);
  if (!d) return;
  const loc = player.location;
  const dimId = player.dimension.id;
  const prev = lastPos.get(player.id);
  lastPos.set(player.id, { x: loc.x, z: loc.z, dim: dimId });
  if (prev && prev.dim === dimId) {
    const moved = dist2D(prev, loc);
    if (moved > 0.5 && moved < 30) {
      d.explore = d.explore ?? { dist: 0, acc: 0, regions: [] };
      d.explore.dist += moved;
      d.explore.acc = (d.explore.acc ?? 0) + moved;
      hooks.questProgress?.(player, 'explore', '', Math.floor(moved));
      if (d.explore.acc >= 100) {
        d.explore.acc -= 100;
        addHobbyXp(player, 'exploracion', 5);
      }
    }
  }
  const reg = regionOf(dimId, loc);
  d.explore = d.explore ?? { dist: 0, acc: 0, regions: [] };
  if (!d.explore.regions.includes(reg.key)) {
    d.explore.regions.push(reg.key);
    if (d.explore.regions.length > 400) d.explore.regions.shift();
    if (d.explore.regions.length > 1) {
      title(player, `§f${reg.name}`, '§7Región descubierta');
      msg(player, `§e✦ Has descubierto: §f${reg.name}`);
      psound(player, 'random.toast', 1, 1);
      addHobbyXp(player, 'exploracion', 40);
      addXp(player, 20, 'explore', true);
      const lvl = hobbyLevel(d, 'exploracion');
      if (lvl >= 5) addGold(player, Math.floor(lvl / 2));
    }
    dirty(player);
  }
  d.region = reg.name;
}
