// Catálogos de tiendas, runas enanas y elixires.

/** Tienda del mercader: [id, cantidad, precio, nombre, rangoGremioMinimo?] */
export const SHOP = [
  ['minecraft:bread', 6, 10, 'Pan ×6'],
  ['minecraft:cooked_beef', 6, 18, 'Filete ×6'],
  ['minecraft:arrow', 32, 15, 'Flechas ×32'],
  ['minecraft:torch', 32, 8, 'Antorchas ×32'],
  ['rpg:mana_potion', 1, 20, 'Poción de Maná'],
  ['rpg:greater_mana_potion', 1, 60, 'Poción de Maná Mayor'],
  ['rpg:elixir_life', 1, 45, 'Elixir de Vida'],
  ['minecraft:iron_sword', 1, 40, 'Espada de hierro'],
  ['minecraft:shield', 1, 35, 'Escudo'],
  ['minecraft:iron_chestplate', 1, 80, 'Peto de hierro'],
  ['minecraft:bow', 1, 30, 'Arco'],
  ['rpg:grimoire', 1, 50, 'Grimorio de repuesto'],
  ['rpg:journal', 1, 5, 'Diario de repuesto'],
  ['rpg:rune_stone', 1, 70, 'Piedra rúnica'],
  ['minecraft:ender_pearl', 2, 60, 'Perlas de ender ×2'],
  ['minecraft:golden_apple', 1, 120, 'Manzana dorada'],
  ['rpg:staff_apprentice', 1, 150, 'Báculo de Aprendiz'],
  ['rpg:wedding_ring', 1, 500, 'Anillo de Compromiso'],
  ['rpg:seal_goblin_king', 1, 120, 'Sello del Rey Goblin', 2],
  ['rpg:seal_spider_queen', 1, 260, 'Sello de la Reina Araña', 3],
  ['rpg:seal_ancient_golem', 1, 500, 'Sello del Gólem Ancestral', 4],
  ['rpg:seal_lich', 1, 900, 'Sello del Liche Eterno', 5],
  ['rpg:seal_demon_lord', 1, 1600, 'Sello de Azazel', 6],
  ['rpg:seal_ash_dragon', 1, 3000, 'Sello del Wyrm de Ceniza', 7],
  ['rpg:seal_void_king', 1, 6000, 'Sello del Rey del Vacío', 8],
  ['rpg:staff_archmage', 1, 2500, 'Báculo del Archimago', 6],
];

/** Precio de venta al mercader por unidad. */
export const SELL = {
  'minecraft:rotten_flesh': 1, 'minecraft:bone': 1, 'minecraft:string': 1, 'minecraft:gunpowder': 2, 'minecraft:spider_eye': 1,
  'minecraft:leather': 2, 'minecraft:wheat': 1, 'minecraft:potato': 1, 'minecraft:carrot': 1, 'minecraft:coal': 1,
  'minecraft:raw_iron': 2, 'minecraft:iron_ingot': 4, 'minecraft:raw_gold': 4, 'minecraft:gold_ingot': 6, 'minecraft:copper_ingot': 1,
  'minecraft:redstone': 1, 'minecraft:lapis_lazuli': 2, 'minecraft:diamond': 40, 'minecraft:emerald': 25, 'minecraft:amethyst_shard': 3,
  'minecraft:ender_pearl': 8, 'minecraft:blaze_rod': 8, 'minecraft:slime_ball': 2, 'minecraft:feather': 1, 'minecraft:cod': 2, 'minecraft:salmon': 3,
  'minecraft:netherite_ingot': 300, 'rpg:monster_core': 15, 'rpg:boss_core': 250, 'rpg:raw_mithril': 12, 'rpg:mithril_ingot': 30,
  'rpg:raw_adamantite': 25, 'rpg:adamantite_ingot': 60, 'rpg:mana_crystal_shard': 8,
};

/** Runas grabables por los enanos. slot: weapon | armor | tool */
export const RUNES = {
  fuego: { name: 'de Fuego Eterno', slot: 'weapon', c: '§c', desc: 'Incendia al enemigo al golpear.', cost: { 'rpg:rune_stone': 1, 'minecraft:blaze_powder': 4 } },
  trueno: { name: 'del Trueno', slot: 'weapon', c: '§e', desc: '15% de probabilidad de invocar un rayo sobre el enemigo.', cost: { 'rpg:rune_stone': 1, 'rpg:mithril_ingot': 2 } },
  vampirica: { name: 'Vampírica', slot: 'weapon', c: '§4', desc: 'Roba el 15% del daño infligido como vida.', cost: { 'rpg:rune_stone': 1, 'minecraft:ghast_tear': 1 } },
  montana: { name: 'de la Montaña', slot: 'weapon', c: '§6', desc: '+35% de daño y empuje adicional.', cost: { 'rpg:rune_stone': 2, 'rpg:adamantite_ingot': 1 } },
  escarcha: { name: 'de Escarcha', slot: 'weapon', c: '§b', desc: 'Ralentiza fuertemente al enemigo.', cost: { 'rpg:rune_stone': 1, 'minecraft:blue_ice': 2 } },
  berserker: { name: 'del Berserker', slot: 'weapon', c: '§c', desc: 'Más daño cuanta menos vida tengas (hasta +60%).', cost: { 'rpg:rune_stone': 2, 'rpg:monster_core': 3 } },
  fortuna: { name: 'de la Fortuna', slot: 'weapon', c: '§a', desc: 'Los enemigos derrotados sueltan oro adicional.', cost: { 'rpg:rune_stone': 1, 'minecraft:emerald': 3 } },
  piedra: { name: 'de Piedra', slot: 'armor', c: '§7', desc: 'Resistencia I mientras la llevas.', cost: { 'rpg:rune_stone': 1, 'minecraft:obsidian': 4 } },
  vigor: { name: 'de Vigor', slot: 'armor', c: '§c', desc: '+4 de vida máxima por pieza.', cost: { 'rpg:rune_stone': 1, 'minecraft:golden_apple': 1 } },
  espinas: { name: 'de Espinas Enanas', slot: 'armor', c: '§2', desc: 'Devuelve el 25% del daño cuerpo a cuerpo recibido.', cost: { 'rpg:rune_stone': 1, 'minecraft:cactus': 8 } },
  viento: { name: 'del Viento', slot: 'armor', c: '§f', desc: 'Velocidad I mientras la llevas.', cost: { 'rpg:rune_stone': 1, 'minecraft:feather': 8 } },
  vision: { name: 'de Visión', slot: 'armor', c: '§e', desc: 'Visión nocturna mientras la llevas.', cost: { 'rpg:rune_stone': 1, 'minecraft:golden_carrot': 2 } },
  llama: { name: 'de Llama', slot: 'armor', c: '§6', desc: 'Resistencia al fuego mientras la llevas.', cost: { 'rpg:rune_stone': 1, 'minecraft:magma_cream': 3 } },
  minero: { name: 'del Minero', slot: 'tool', c: '§6', desc: 'Prisa II mientras la empuñas.', cost: { 'rpg:rune_stone': 1, 'minecraft:redstone': 16 } },
  hallazgo: { name: 'del Hallazgo', slot: 'tool', c: '§b', desc: 'Doble probabilidad de minerales extra.', cost: { 'rpg:rune_stone': 1, 'minecraft:lapis_lazuli': 16 } },
};

export const RUNE_PREFIX = '§r§8ᚱ ';

export function itemSlot(typeId) {
  if (/_(sword|axe)$/.test(typeId) || ['rpg:mithril_sword', 'rpg:adamantite_sword', 'rpg:dwarven_greataxe', 'rpg:runic_hammer', 'minecraft:trident', 'minecraft:mace'].includes(typeId)) return 'weapon';
  if (/_(helmet|chestplate|leggings|boots)$/.test(typeId) || typeId === 'minecraft:turtle_helmet') return 'armor';
  if (/_(pickaxe|shovel|hoe)$/.test(typeId)) return 'tool';
  return undefined;
}

/** Lee las runas de la "lore" de un objeto. */
export function readRunes(item) {
  if (!item) return [];
  let lore;
  try { lore = item.getLore(); } catch { return []; }
  const out = [];
  for (const line of lore) {
    if (!line.includes('ᚱ')) continue;
    for (const [id, r] of Object.entries(RUNES)) if (line.includes(r.name)) out.push(id);
  }
  return out;
}

/** Elixires: [id, nombre, ingredientes, salida, soloElfos] */
export const ELIXIRS = [
  ['rpg:elixir_life', 'Elixir de Vida', { 'minecraft:glass_bottle': 1, '#flower': 3 }, 1, false],
  ['rpg:mana_potion', 'Poción de Maná', { 'minecraft:glass_bottle': 1, 'rpg:mana_crystal_shard': 1 }, 1, false],
  ['rpg:greater_mana_potion', 'Poción de Maná Mayor', { 'minecraft:glass_bottle': 1, 'rpg:mana_crystal_shard': 3, 'minecraft:glowstone_dust': 2 }, 1, false],
  ['rpg:elixir_strength', 'Elixir de Fuerza', { 'minecraft:glass_bottle': 1, 'minecraft:blaze_powder': 1, 'minecraft:sweet_berries': 4 }, 1, false],
  ['rpg:elixir_swiftness', 'Elixir de Agilidad', { 'minecraft:glass_bottle': 1, 'minecraft:sugar': 3, 'minecraft:feather': 2 }, 1, false],
  ['rpg:elixir_elven', 'Elixir Élfico', { 'minecraft:glass_bottle': 1, '#flower': 4, 'minecraft:golden_carrot': 1, 'rpg:mana_crystal_shard': 1 }, 1, true],
];

export const FLOWERS = new Set([
  'minecraft:poppy', 'minecraft:dandelion', 'minecraft:blue_orchid', 'minecraft:allium', 'minecraft:azure_bluet', 'minecraft:red_tulip',
  'minecraft:orange_tulip', 'minecraft:white_tulip', 'minecraft:pink_tulip', 'minecraft:oxeye_daisy', 'minecraft:cornflower',
  'minecraft:lily_of_the_valley', 'minecraft:sunflower', 'minecraft:lilac', 'minecraft:rose_bush', 'minecraft:peony', 'minecraft:torchflower',
  'minecraft:pink_petals', 'minecraft:red_flower', 'minecraft:yellow_flower',
]);

/** Efectos al beber objetos del mod. */
export const DRINKS = {
  'rpg:mana_potion': { mana: 40 },
  'rpg:greater_mana_potion': { mana: 150 },
  'rpg:elixir_life': { heal: 10, effects: [['regeneration', 200, 0]] },
  'rpg:elixir_strength': { effects: [['strength', 1200, 1]] },
  'rpg:elixir_swiftness': { effects: [['speed', 1200, 1], ['jump_boost', 1200, 0]] },
  'rpg:elixir_elven': { heal: 20, mana: 60, effects: [['regeneration', 400, 1], ['absorption', 1200, 1], ['night_vision', 2400, 0]] },
};
