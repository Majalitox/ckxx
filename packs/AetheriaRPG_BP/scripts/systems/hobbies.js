// Pasatiempos: minería, tala, agricultura y pesca dan experiencia (y misiones) con ventajas por nivel.
import { system, ItemStack } from '@minecraft/server';
import { getP } from '../core/store.js';
import { addHobbyXp } from '../core/progression.js';
import { hobbyLevel } from '../core/profile.js';
import { readRunes } from '../data/items.js';
import { countWhere, heldItem, giveItem, psound } from '../util/compat.js';
import { chance, pick } from '../util/math.js';

export const hooks = { questProgress: undefined };

const ORES = [
  ['rpg:adamantite_ore', 18, 'rpg:raw_adamantite'],
  ['rpg:mithril_ore', 10, 'rpg:raw_mithril'],
  ['rpg:mana_crystal_block', 6, 'rpg:mana_crystal_shard'],
  ['ancient_debris', 25, 'minecraft:ancient_debris'],
  ['emerald_ore', 15, 'minecraft:emerald'],
  ['diamond_ore', 12, 'minecraft:diamond'],
  ['gold_ore', 6, 'minecraft:raw_gold'],
  ['lapis_ore', 5, 'minecraft:lapis_lazuli'],
  ['redstone_ore', 4, 'minecraft:redstone'],
  ['iron_ore', 4, 'minecraft:raw_iron'],
  ['copper_ore', 3, 'minecraft:raw_copper'],
  ['quartz_ore', 3, 'minecraft:quartz'],
  ['coal_ore', 2, 'minecraft:coal'],
];
const STONE = new Set(['minecraft:stone', 'minecraft:deepslate', 'minecraft:cobblestone', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite', 'minecraft:tuff', 'minecraft:netherrack', 'minecraft:blackstone', 'minecraft:end_stone', 'minecraft:cobbled_deepslate']);
const CROPS = {
  'minecraft:wheat': ['growth', 7, 'minecraft:wheat'],
  'minecraft:carrots': ['growth', 7, 'minecraft:carrot'],
  'minecraft:potatoes': ['growth', 7, 'minecraft:potato'],
  'minecraft:beetroot': ['growth', 7, 'minecraft:beetroot'],
  'minecraft:nether_wart': ['age', 3, 'minecraft:nether_wart'],
  'minecraft:cocoa': ['age', 2, 'minecraft:cocoa_beans'],
  'minecraft:melon_block': [null, 0, 'minecraft:melon_slice'],
  'minecraft:pumpkin': [null, 0, 'minecraft:pumpkin'],
};

function dropExtra(dim, loc, id, n = 1) {
  try { dim.spawnItem(new ItemStack(id, n), { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }); } catch {}
}

export function onBreak(ev) {
  const player = ev.player;
  const d = getP(player);
  if (!d) return;
  const type = ev.brokenBlockPermutation.type.id;
  const loc = ev.block.location;
  const dim = ev.dimension ?? player.dimension;

  // Minería
  const ore = ORES.find(([k]) => (k.includes(':') ? type === k : type.includes(k)));
  if (ore) {
    addHobbyXp(player, 'mineria', ore[1]);
    hooks.questProgress?.(player, 'mine', type, 1);
    const tool = heldItem(player);
    let ch = hobbyLevel(d, 'mineria') * 0.01;
    if (readRunes(tool).includes('hallazgo')) ch *= 2;
    let silk = false;
    try { silk = !!tool?.getComponent('minecraft:enchantable')?.getEnchantment('silk_touch'); } catch {}
    if (!silk && chance(ch)) {
      dropExtra(dim, loc, ore[2]);
      psound(player, 'random.orb', 0.5, 1.8);
    }
    return;
  }
  if (STONE.has(type)) {
    addHobbyXp(player, 'mineria', 0.25);
    hooks.questProgress?.(player, 'mine', type, 1);
    return;
  }
  // Tala
  if (/_log$|_stem$|^minecraft:log2?$/.test(type) && !type.includes('stripped')) {
    addHobbyXp(player, 'tala', 1.5);
    hooks.questProgress?.(player, 'chop', type, 1);
    if (chance(hobbyLevel(d, 'tala') * 0.012)) dropExtra(dim, loc, type);
    return;
  }
  // Agricultura
  const crop = CROPS[type];
  if (crop) {
    let mature = crop[0] === null;
    if (!mature) {
      try { mature = ev.brokenBlockPermutation.getState(crop[0]) >= crop[1]; } catch {}
    }
    if (!mature) return;
    addHobbyXp(player, 'agricultura', 2);
    hooks.questProgress?.(player, 'harvest', type, 1);
    if (chance(hobbyLevel(d, 'agricultura') * 0.015)) dropExtra(dim, loc, crop[2], 1 + (chance(0.3) ? 1 : 0));
  }
}

/* Pesca: se detecta comparando el inventario tras recoger el sedal. */
const FISH = new Set(['minecraft:cod', 'minecraft:salmon', 'minecraft:tropical_fish', 'minecraft:pufferfish', 'minecraft:name_tag', 'minecraft:saddle', 'minecraft:nautilus_shell', 'minecraft:enchanted_book', 'minecraft:lily_pad', 'minecraft:bow', 'minecraft:ink_sac']);
const TREASURE = ['minecraft:gold_ingot', 'minecraft:emerald', 'minecraft:nautilus_shell', 'minecraft:name_tag', 'rpg:mana_crystal_shard', 'minecraft:diamond'];
const fishWatch = new Map();

export function onRodUse(player) {
  const before = countWhere(player, (t) => FISH.has(t));
  const id = player.id;
  if (fishWatch.get(id)) return;
  fishWatch.set(id, true);
  let checks = 0;
  const run = system.runInterval(() => {
    checks++;
    if (!player.isValid) { fishWatch.delete(id); return system.clearRun(run); }
    const now = countWhere(player, (t) => FISH.has(t));
    if (now > before) {
      fishWatch.delete(id);
      system.clearRun(run);
      const d = getP(player);
      addHobbyXp(player, 'pesca', 6);
      hooks.questProgress?.(player, 'fish', '', 1);
      if (d && chance(hobbyLevel(d, 'pesca') * 0.012)) {
        const t = pick(TREASURE);
        giveItem(player, t, 1);
        psound(player, 'random.levelup', 0.6, 1.8);
        try { player.sendMessage('§b✦ ¡Has pescado un tesoro!'); } catch {}
      }
      return;
    }
    if (checks >= 4) { fishWatch.delete(id); system.clearRun(run); }
  }, 15);
}
