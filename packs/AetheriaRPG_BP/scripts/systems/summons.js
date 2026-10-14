// Invocaciones elementales aliadas.
import { world } from '@minecraft/server';
import { particle, valid } from '../util/compat.js';
import { dist, rand } from '../util/math.js';

export const SPIRIT = 'rpg:spirit';

export function spawnSummon(player, el, skill, loc, tier, power) {
  let e;
  try {
    e = player.dimension.spawnEntity(SPIRIT, loc);
  } catch {
    return;
  }
  try {
    e.setProperty('rpg:variant', el.variant ?? 0);
    e.triggerEvent('rpg:power_' + Math.max(0, Math.min(4, tier)));
    e.setDynamicProperty('rpg:owner', player.id);
    e.setDynamicProperty('rpg:expire', world.getAbsoluteTime() + skill.duration);
    e.setDynamicProperty('rpg:power', power);
    e.addTag('rpg_ally');
    e.nameTag = `${el.c}${skill.name}\n§7de ${player.name}`;
  } catch {}
  particle(player.dimension, 'rpg:burst', loc, el.rgb);
}

export function summonTick() {
  const now = world.getAbsoluteTime();
  const players = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const dimId of ['overworld', 'nether', 'the_end']) {
    let list = [];
    try { list = world.getDimension(dimId).getEntities({ type: SPIRIT }); } catch { continue; }
    for (const e of list) {
      if (!valid(e)) continue;
      const ownerId = e.getDynamicProperty('rpg:owner');
      const exp = e.getDynamicProperty('rpg:expire');
      const owner = players.get(ownerId);
      if (!owner || typeof exp !== 'number' || now > exp) {
        particle(e.dimension, 'minecraft:large_explosion', e.location);
        try { e.remove(); } catch {}
        continue;
      }
      if (owner.dimension.id !== e.dimension.id || dist(owner.location, e.location) > 14) {
        try {
          e.teleport({ x: owner.location.x + rand(-2, 2), y: owner.location.y + 0.5, z: owner.location.z + rand(-2, 2) }, { dimension: owner.dimension });
        } catch {}
      }
    }
  }
}
