// Envoltorios seguros sobre la API de scripts (evitan que un error detenga el mod).
import { MolangVariableMap, ItemStack, system } from '@minecraft/server';

export function knockback(entity, dx, dz, horizontal, vertical) {
  try {
    entity.applyKnockback({ x: dx * horizontal, z: dz * horizontal }, vertical);
    return;
  } catch {}
  try {
    entity.applyKnockback(dx, dz, horizontal, vertical); // firma antigua (1.x)
  } catch {}
}

export function particle(dim, id, loc, rgb) {
  try {
    if (rgb) {
      const m = new MolangVariableMap();
      m.setColorRGB('variable.color', { red: rgb[0], green: rgb[1], blue: rgb[2] });
      dim.spawnParticle(id, loc, m);
    } else {
      dim.spawnParticle(id, loc);
    }
  } catch {}
}

export function sound(dim, id, loc, volume = 1, pitch = 1) {
  try { dim.playSound(id, loc, { volume, pitch }); } catch {}
}

export function psound(player, id, volume = 1, pitch = 1) {
  try { player.playSound(id, { volume, pitch }); } catch {}
}

export function cmd(target, command) {
  try { return target.runCommand(command); } catch { return undefined; }
}

export function effect(entity, id, ticks, amplifier = 0, particles = false) {
  try {
    entity.addEffect(id, Math.max(1, Math.min(20000000, Math.floor(ticks))), { amplifier: Math.max(0, Math.min(255, Math.floor(amplifier))), showParticles: particles });
    return true;
  } catch { return false; }
}

export function hasEffect(entity, id) {
  try { return !!entity.getEffect(id); } catch { return false; }
}

export function damage(target, amount, source, cause = 'magic') {
  if (amount <= 0) return false;
  try {
    return target.applyDamage(amount, source ? { cause, damagingEntity: source } : { cause });
  } catch {
    try { return target.applyDamage(amount); } catch { return false; }
  }
}

export function health(entity) {
  try { return entity.getComponent('minecraft:health'); } catch { return undefined; }
}

export function heal(entity, amount) {
  const h = health(entity);
  if (!h) return;
  try { h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + amount)); } catch {}
}

export function hpOf(entity) {
  const h = health(entity);
  return h ? { cur: h.currentValue, max: h.effectiveMax } : { cur: 0, max: 0 };
}

export function valid(e) {
  try { return !!e && e.isValid; } catch { return false; }
}

export function container(player) {
  try { return player.getComponent('minecraft:inventory')?.container; } catch { return undefined; }
}

export function heldItem(player) {
  const c = container(player);
  if (!c) return undefined;
  try { return c.getItem(player.selectedSlotIndex); } catch { return undefined; }
}

export function setHeldItem(player, item) {
  const c = container(player);
  if (!c) return;
  try { c.setItem(player.selectedSlotIndex, item); } catch {}
}

export function countItem(player, typeId) {
  const c = container(player);
  if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && it.typeId === typeId) n += it.amount;
  }
  return n;
}

/** Cuenta objetos que cumplan un predicado. */
export function countWhere(player, pred) {
  const c = container(player);
  if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && pred(it.typeId)) n += it.amount;
  }
  return n;
}

export function removeItem(player, typeId, amount) {
  return removeWhere(player, (t) => t === typeId, amount);
}

export function removeWhere(player, pred, amount) {
  const c = container(player);
  if (!c) return false;
  let left = amount;
  for (let i = 0; i < c.size && left > 0; i++) {
    const it = c.getItem(i);
    if (!it || !pred(it.typeId)) continue;
    if (it.amount > left) {
      it.amount -= left;
      c.setItem(i, it);
      left = 0;
    } else {
      left -= it.amount;
      c.setItem(i, undefined);
    }
  }
  return left === 0;
}

export function giveItem(player, typeIdOrStack, amount = 1) {
  let stack;
  try {
    stack = typeof typeIdOrStack === 'string' ? new ItemStack(typeIdOrStack, 1) : typeIdOrStack;
  } catch { return false; }
  const max = stack.maxAmount || 64;
  let left = typeof typeIdOrStack === 'string' ? amount : stack.amount;
  const c = container(player);
  while (left > 0) {
    const n = Math.min(max, left);
    const s = stack.clone();
    s.amount = n;
    left -= n;
    let rest = s;
    try { rest = c ? c.addItem(s) : s; } catch {}
    if (rest) {
      try { player.dimension.spawnItem(rest, player.location); } catch {}
    }
  }
  return true;
}

export function makeItem(typeId, amount = 1, name, lore) {
  try {
    const it = new ItemStack(typeId, amount);
    if (name) it.nameTag = name;
    if (lore) it.setLore(lore);
    return it;
  } catch { return undefined; }
}

export function sleep(ticks) {
  return new Promise((res) => system.runTimeout(res, ticks));
}

export function getBlock(dim, loc) {
  try { return dim.getBlock(loc); } catch { return undefined; }
}

const NON_SOLID = new Set([
  'minecraft:air', 'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern', 'minecraft:snow_layer',
  'minecraft:torch', 'minecraft:soul_torch', 'minecraft:dandelion', 'minecraft:poppy', 'minecraft:red_flower', 'minecraft:yellow_flower',
  'minecraft:deadbush', 'minecraft:vine', 'minecraft:water', 'minecraft:lava', 'minecraft:flowing_water', 'minecraft:flowing_lava',
  'minecraft:ladder', 'minecraft:scaffolding', 'minecraft:rail', 'minecraft:redstone_wire', 'minecraft:carpet', 'minecraft:sweet_berry_bush',
  'minecraft:tallgrass', 'minecraft:double_plant', 'minecraft:seagrass', 'minecraft:kelp', 'minecraft:web', 'minecraft:light_block',
]);

export function isSolid(block) {
  if (!block) return false;
  try {
    if (block.isAir || block.isLiquid) return false;
  } catch {}
  const t = block.typeId;
  if (NON_SOLID.has(t)) return false;
  if (t.includes('flower') || t.includes('sapling') || t.includes('button') || t.includes('pressure_plate') || t.includes('sign') || t.includes('banner') || t.includes('torch') || t.includes('carpet')) return false;
  return true;
}

/** Busca el suelo sólido en (x,z) recorriendo hacia abajo desde arriba. Ignora hojas y troncos. */
export function findGround(dim, x, z, startY) {
  let top = startY;
  if (top === undefined) {
    try {
      const b = dim.getTopmostBlock({ x, z });
      if (b) top = b.location.y + 1;
    } catch {}
  }
  if (top === undefined) top = 200;
  for (let y = Math.min(top, 318); y > -60; y--) {
    const b = getBlock(dim, { x, y, z });
    if (b === undefined) return undefined; // chunk no cargado
    if (!isSolid(b)) continue;
    const t = b.typeId;
    if (t.includes('leaves') || t.includes('log') || t.includes('wood') || t.includes('mushroom_block')) continue;
    return y;
  }
  return undefined;
}
