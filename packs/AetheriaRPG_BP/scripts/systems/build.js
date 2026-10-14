// Construcción procedural de estructuras con comandos: casas familiares, sede del Gremio y mazmorras.
import { system } from '@minecraft/server';
import { cmd, findGround, getBlock } from '../util/compat.js';
import { randInt, chance } from '../util/math.js';

function F(dim, x1, y1, z1, x2, y2, z2, block, mode = '') {
  return cmd(dim, `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}${mode ? ' ' + mode : ''}`);
}
function S(dim, x, y, z, block) {
  return cmd(dim, `setblock ${x} ${y} ${z} ${block}`);
}

/** Comprueba que una zona esté cargada (esquinas). */
export function areaLoaded(dim, x1, z1, x2, z2, y = 64) {
  for (const [x, z] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
    if (getBlock(dim, { x, y, z }) === undefined) return false;
  }
  return true;
}

/** Casa familiar de 7×7. Devuelve la posición de la cama/spawn y puntos para NPCs. */
export function buildHouse(dim, cx, cz) {
  const gy = findGround(dim, cx, cz);
  if (gy === undefined) return undefined;
  const x0 = cx - 3, z0 = cz - 3, y0 = gy + 1;
  F(dim, x0 - 1, y0 - 5, z0 - 1, x0 + 7, y0 - 1, z0 + 7, 'dirt', 'replace air');
  F(dim, x0 - 1, y0 - 1, z0 - 1, x0 + 7, y0 - 1, z0 + 7, 'cobblestone');
  F(dim, x0 - 1, y0, z0 - 1, x0 + 7, y0 + 7, z0 + 7, 'air');
  F(dim, x0, y0, z0, x0 + 6, y0 + 4, z0 + 6, 'oak_planks', 'hollow');
  F(dim, x0 + 1, y0, z0 + 1, x0 + 5, y0, z0 + 5, 'spruce_planks');
  for (const [x, z] of [[x0, z0], [x0 + 6, z0], [x0, z0 + 6], [x0 + 6, z0 + 6]]) F(dim, x, y0, z, x, y0 + 4, z, 'oak_log');
  F(dim, x0 + 3, y0 + 1, z0, x0 + 3, y0 + 2, z0, 'air');
  for (const [x, z] of [[x0, z0 + 3], [x0 + 6, z0 + 3], [x0 + 3, z0 + 6], [x0 + 1, z0], [x0 + 5, z0]]) S(dim, x, y0 + 2, z, 'glass');
  F(dim, x0 - 1, y0 + 5, z0 - 1, x0 + 7, y0 + 5, z0 + 7, 'dark_oak_planks');
  F(dim, x0, y0 + 6, z0, x0 + 6, y0 + 6, z0 + 6, 'dark_oak_slab');
  S(dim, x0 + 1, y0 + 1, z0 + 5, 'crafting_table');
  S(dim, x0 + 2, y0 + 1, z0 + 5, 'furnace');
  S(dim, x0 + 5, y0 + 1, z0 + 5, 'chest');
  S(dim, x0 + 5, y0 + 1, z0 + 4, 'barrel');
  S(dim, x0 + 3, y0 + 3, z0 + 3, 'lantern ["hanging"=true]');
  S(dim, x0 + 2, y0 - 1, z0 - 1, 'gravel');
  S(dim, x0 + 3, y0 - 1, z0 - 1, 'gravel');
  S(dim, x0 + 4, y0 - 1, z0 - 1, 'gravel');
  S(dim, x0 + 1, y0, z0 - 1, 'oak_fence');
  S(dim, x0 + 1, y0 + 1, z0 - 1, 'lantern');
  return {
    spawn: { x: x0 + 3, y: y0 + 1, z: z0 + 3 },
    chest: { x: x0 + 5, y: y0 + 1, z: z0 + 5 },
    npc: [{ x: x0 + 2.5, y: y0 + 1, z: z0 + 2.5 }, { x: x0 + 4.5, y: y0 + 1, z: z0 + 2.5 }, { x: x0 + 2.5, y: y0 + 1, z: z0 + 4.5 }, { x: x0 + 4.5, y: y0 + 1, z: z0 + 4.5 }, { x: x0 + 3.5, y: y0 + 1, z: z0 - 2.5 }],
  };
}

/** Sede del Gremio de Aventureros (15×11). */
export function buildGuildHall(dim, cx, cz) {
  const gy = findGround(dim, cx, cz + 5);
  if (gy === undefined) return undefined;
  const x0 = cx - 7, z0 = cz, y0 = gy + 1;
  F(dim, x0 - 2, y0 - 5, z0 - 3, x0 + 16, y0 - 1, z0 + 12, 'stone', 'replace air');
  F(dim, x0 - 2, y0 - 1, z0 - 3, x0 + 16, y0 - 1, z0 + 12, 'stone_bricks');
  F(dim, x0 - 2, y0, z0 - 3, x0 + 16, y0 + 11, z0 + 12, 'air');
  F(dim, x0, y0, z0, x0 + 14, y0 + 6, z0 + 10, 'stone_bricks', 'hollow');
  F(dim, x0 + 1, y0, z0 + 1, x0 + 13, y0, z0 + 9, 'oak_planks');
  for (const [x, z] of [[x0, z0], [x0 + 14, z0], [x0, z0 + 10], [x0 + 14, z0 + 10], [x0 + 7, z0], [x0 + 7, z0 + 10]]) F(dim, x, y0, z, x, y0 + 6, z, 'spruce_log');
  F(dim, x0 + 6, y0 + 1, z0, x0 + 8, y0 + 3, z0, 'air');
  F(dim, x0 + 2, y0 + 2, z0, x0 + 4, y0 + 3, z0, 'glass');
  F(dim, x0 + 10, y0 + 2, z0, x0 + 12, y0 + 3, z0, 'glass');
  F(dim, x0, y0 + 2, z0 + 3, x0, y0 + 3, z0 + 7, 'glass');
  F(dim, x0 + 14, y0 + 2, z0 + 3, x0 + 14, y0 + 3, z0 + 7, 'glass');
  F(dim, x0 - 1, y0 + 7, z0 - 1, x0 + 15, y0 + 7, z0 + 11, 'dark_oak_planks');
  F(dim, x0, y0 + 8, z0 + 1, x0 + 14, y0 + 8, z0 + 9, 'dark_oak_planks');
  F(dim, x0 + 1, y0 + 9, z0 + 3, x0 + 13, y0 + 9, z0 + 7, 'dark_oak_slab');
  // Mostrador de recepción
  F(dim, x0 + 4, y0 + 1, z0 + 6, x0 + 10, y0 + 1, z0 + 6, 'spruce_planks');
  S(dim, x0 + 3, y0 + 1, z0 + 6, 'lectern');
  S(dim, x0 + 11, y0 + 1, z0 + 6, 'bookshelf');
  // Rincón de forja
  S(dim, x0 + 12, y0 + 1, z0 + 9, 'anvil');
  S(dim, x0 + 13, y0 + 1, z0 + 9, 'smithing_table');
  S(dim, x0 + 13, y0 + 1, z0 + 8, 'blast_furnace');
  S(dim, x0 + 13, y0 + 1, z0 + 7, 'grindstone');
  // Rincón de alquimia / templo
  S(dim, x0 + 1, y0 + 1, z0 + 9, 'brewing_stand');
  S(dim, x0 + 1, y0 + 1, z0 + 8, 'cauldron');
  S(dim, x0 + 1, y0 + 1, z0 + 7, 'enchanting_table');
  for (const [x, z] of [[x0 + 3, z0 + 3], [x0 + 11, z0 + 3], [x0 + 3, z0 + 8], [x0 + 11, z0 + 8], [x0 + 7, z0 + 5]]) S(dim, x, y0 + 5, z, 'lantern ["hanging"=true]');
  // Entrada
  for (const x of [x0 + 5, x0 + 9]) {
    S(dim, x, y0, z0 - 1, 'oak_fence');
    S(dim, x, y0 + 1, z0 - 1, 'lantern');
  }
  F(dim, x0 + 6, y0 - 1, z0 - 3, x0 + 8, y0 - 1, z0 - 1, 'polished_andesite');
  const p = (dx, dz) => ({ x: x0 + dx + 0.5, y: y0 + 1, z: z0 + dz + 0.5 });
  return {
    origin: { x: x0, y: y0, z: z0 },
    center: p(7, 4),
    entrance: p(7, -2),
    staff: {
      recepcionista: p(7, 8),
      maestro: p(5, 8),
      herrero: p(11, 8),
      mercader: p(9, 8),
      sacerdotisa: p(2, 7),
    },
    sombra: p(-3, 12),
  };
}

/** Mazmorra subterránea con entrada en superficie. */
export function buildDungeon(dim, ex, ez, rank) {
  const gy = findGround(dim, ex, ez);
  if (gy === undefined) return undefined;
  const H = rank >= 6 ? 10 : 7;
  const by = Math.max(-50, gy - 20 - (rank >= 6 ? 4 : 0));
  const R = rank >= 6 ? 8 : 7;
  // Sala
  F(dim, ex - R, by - 1, ez - R, ex + R, by + H, ez + R, 'stone_bricks', 'hollow');
  F(dim, ex - R + 1, by - 1, ez - R + 1, ex + R - 1, by - 1, ez + R - 1, 'polished_deepslate');
  for (let i = 0; i < 18; i++) {
    const side = randInt(0, 3);
    const t = randInt(-R + 1, R - 1);
    const y = randInt(by, by + H - 1);
    const [x, z] = side === 0 ? [ex - R, ez + t] : side === 1 ? [ex + R, ez + t] : side === 2 ? [ex + t, ez - R] : [ex + t, ez + R];
    S(dim, x, y, z, chance(0.5) ? 'mossy_stone_bricks' : 'cracked_stone_bricks');
  }
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) F(dim, ex + dx, by, ez + dz, ex + dx, by + H - 1, ez + dz, 'chiseled_stone_bricks');
  for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) S(dim, ex + dx, by + H - 1, ez + dz, 'soul_lantern ["hanging"=true]');
  // Pozo de acceso con escalera de mano
  F(dim, ex - 1, by + H, ez - 1, ex + 1, gy, ez + 1, 'stone_bricks');
  F(dim, ex, by + H, ez, ex, gy + 3, ez, 'air');
  F(dim, ex, by, ez + 1, ex, by + H - 1, ez + 1, 'stone_bricks');
  F(dim, ex, by, ez, ex, gy, ez, 'ladder ["facing_direction"=2]');
  // Portal decorativo en superficie
  F(dim, ex - 2, gy, ez - 2, ex + 2, gy, ez + 2, 'mossy_cobblestone');
  S(dim, ex, gy, ez, 'ladder ["facing_direction"=2]');
  F(dim, ex - 2, gy + 1, ez - 2, ex + 2, gy + 4, ez + 2, 'air');
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    F(dim, ex + dx, gy + 1, ez + dz, ex + dx, gy + 3, ez + dz, 'mossy_stone_bricks');
    S(dim, ex + dx, gy + 4, ez + dz, 'soul_lantern');
  }
  return {
    entrance: { x: ex + 0.5, y: gy + 1, z: ez + 0.5 },
    room: { x: ex + 0.5, y: by, z: ez + 0.5 },
    R: R - 1,
    H,
  };
}

/** Coloca un cofre con objetos. items: [[id, cantidad], ...] */
export function placeChest(dim, loc, items, makeItem) {
  S(dim, Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z), 'chest');
  system.runTimeout(() => {
    try {
      const b = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
      const inv = b?.getComponent('minecraft:inventory')?.container;
      if (!inv) return;
      for (const [id, n, name, lore] of items) {
        const it = makeItem(id, n, name, lore);
        if (it) inv.addItem(it);
      }
    } catch {}
  }, 2);
}
