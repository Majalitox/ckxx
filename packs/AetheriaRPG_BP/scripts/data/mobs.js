// Información de criaturas: rango, experiencia y oro al derrotarlas.

export const MOBS = {
  // Monstruos del mod
  'rpg:goblin': { name: 'Goblin', rank: 0, xp: 12, gold: [1, 4] },
  'rpg:dire_wolf': { name: 'Lobo Huargo', rank: 1, xp: 20, gold: [1, 5] },
  'rpg:orc': { name: 'Orco Salvaje', rank: 2, xp: 35, gold: [3, 9] },
  'rpg:scorpion': { name: 'Escorpión de las Dunas', rank: 2, xp: 32, gold: [2, 8] },
  'rpg:skeleton_knight': { name: 'Caballero Esqueleto', rank: 3, xp: 55, gold: [5, 14], undead: true },
  'rpg:giant_spider': { name: 'Araña Gigante', rank: 3, xp: 50, gold: [4, 12] },
  'rpg:wraith': { name: 'Espectro', rank: 3, xp: 60, gold: [5, 15], undead: true },
  'rpg:mimic': { name: 'Mímico', rank: 3, xp: 80, gold: [20, 45] },
  'rpg:dark_mage': { name: 'Mago Oscuro', rank: 4, xp: 90, gold: [10, 25] },
  'rpg:ice_golem': { name: 'Gólem de Escarcha', rank: 4, xp: 95, gold: [8, 22] },
  'rpg:fire_imp': { name: 'Diablillo de Fuego', rank: 4, xp: 80, gold: [8, 20] },
  'rpg:troll': { name: 'Trol de las Cavernas', rank: 5, xp: 150, gold: [15, 35] },
  'rpg:demon_knight': { name: 'Caballero Demoníaco', rank: 6, xp: 260, gold: [25, 60] },
  // Criaturas vanilla
  'minecraft:zombie': { name: 'Zombi', rank: 0, xp: 8, gold: [0, 2], undead: true },
  'minecraft:husk': { name: 'Zombi momificado', rank: 0, xp: 9, gold: [0, 2], undead: true },
  'minecraft:drowned': { name: 'Ahogado', rank: 1, xp: 10, gold: [0, 3], undead: true },
  'minecraft:zombie_villager_v2': { name: 'Aldeano zombi', rank: 0, xp: 8, gold: [0, 2], undead: true },
  'minecraft:skeleton': { name: 'Esqueleto', rank: 1, xp: 10, gold: [0, 3], undead: true },
  'minecraft:stray': { name: 'Esqueleto glacial', rank: 1, xp: 11, gold: [0, 3], undead: true },
  'minecraft:bogged': { name: 'Esqueleto pantanoso', rank: 1, xp: 11, gold: [0, 3], undead: true },
  'minecraft:spider': { name: 'Araña', rank: 0, xp: 8, gold: [0, 2] },
  'minecraft:cave_spider': { name: 'Araña de cueva', rank: 1, xp: 9, gold: [0, 2] },
  'minecraft:creeper': { name: 'Creeper', rank: 1, xp: 12, gold: [0, 3] },
  'minecraft:slime': { name: 'Slime', rank: 0, xp: 4, gold: [0, 1] },
  'minecraft:witch': { name: 'Bruja', rank: 2, xp: 25, gold: [3, 8] },
  'minecraft:phantom': { name: 'Phantom', rank: 2, xp: 18, gold: [1, 4], undead: true },
  'minecraft:pillager': { name: 'Saqueador', rank: 2, xp: 20, gold: [2, 6] },
  'minecraft:vindicator': { name: 'Vindicador', rank: 3, xp: 30, gold: [4, 10] },
  'minecraft:evocation_illager': { name: 'Invocador', rank: 4, xp: 60, gold: [10, 25] },
  'minecraft:ravager': { name: 'Devastador', rank: 4, xp: 80, gold: [10, 25] },
  'minecraft:enderman': { name: 'Enderman', rank: 3, xp: 30, gold: [2, 8] },
  'minecraft:blaze': { name: 'Blaze', rank: 3, xp: 30, gold: [3, 9] },
  'minecraft:ghast': { name: 'Ghast', rank: 3, xp: 35, gold: [4, 10] },
  'minecraft:magma_cube': { name: 'Cubo de magma', rank: 2, xp: 10, gold: [1, 3] },
  'minecraft:wither_skeleton': { name: 'Esqueleto wither', rank: 4, xp: 45, gold: [5, 12], undead: true },
  'minecraft:piglin_brute': { name: 'Piglin bruto', rank: 4, xp: 50, gold: [6, 14] },
  'minecraft:hoglin': { name: 'Hoglin', rank: 3, xp: 25, gold: [2, 6] },
  'minecraft:zoglin': { name: 'Zoglin', rank: 3, xp: 28, gold: [2, 6], undead: true },
  'minecraft:guardian': { name: 'Guardián', rank: 3, xp: 25, gold: [3, 8] },
  'minecraft:elder_guardian': { name: 'Guardián anciano', rank: 5, xp: 300, gold: [50, 100] },
  'minecraft:shulker': { name: 'Shulker', rank: 4, xp: 30, gold: [3, 8] },
  'minecraft:vex': { name: 'Vex', rank: 2, xp: 8, gold: [0, 2] },
  'minecraft:silverfish': { name: 'Lepisma', rank: 0, xp: 3, gold: [0, 1] },
  'minecraft:endermite': { name: 'Endermite', rank: 1, xp: 4, gold: [0, 1] },
  'minecraft:breeze': { name: 'Breeze', rank: 3, xp: 35, gold: [3, 9] },
  'minecraft:warden': { name: 'Guardián de las profundidades', rank: 7, xp: 800, gold: [150, 300] },
  'minecraft:wither': { name: 'Wither', rank: 7, xp: 1500, gold: [300, 500], undead: true },
  'minecraft:ender_dragon': { name: 'Dragón del End', rank: 8, xp: 3000, gold: [800, 1200] },
};

export const BOSSES = {
  'rpg:goblin_king': { name: 'Rey Goblin', rank: 2, xp: 450, gold: 150, gp: 80, seal: 'rpg:seal_goblin_king', title: '§2Rey Goblin' },
  'rpg:spider_queen': { name: 'Reina Araña', rank: 3, xp: 800, gold: 250, gp: 140, seal: 'rpg:seal_spider_queen', title: '§8Reina Araña' },
  'rpg:ancient_golem': { name: 'Gólem Ancestral', rank: 4, xp: 1400, gold: 400, gp: 250, seal: 'rpg:seal_ancient_golem', title: '§7Gólem Ancestral' },
  'rpg:lich': { name: 'Liche Eterno', rank: 5, xp: 2400, gold: 700, gp: 450, seal: 'rpg:seal_lich', title: '§5Liche Eterno', undead: true },
  'rpg:demon_lord': { name: 'Azazel, Señor Demonio', rank: 6, xp: 4000, gold: 1200, gp: 800, seal: 'rpg:seal_demon_lord', title: '§4Azazel, Señor Demonio' },
  'rpg:ash_dragon': { name: 'Wyrm de Ceniza', rank: 7, xp: 7000, gold: 2000, gp: 1400, seal: 'rpg:seal_ash_dragon', title: '§cWyrm de Ceniza' },
  'rpg:void_king': { name: 'El Rey del Vacío', rank: 8, xp: 12000, gold: 4000, gp: 2500, seal: 'rpg:seal_void_king', title: '§0§lEl Rey del Vacío' },
};

export const BOSS_BY_RANK = { 2: 'rpg:goblin_king', 3: 'rpg:spider_queen', 4: 'rpg:ancient_golem', 5: 'rpg:lich', 6: 'rpg:demon_lord', 7: 'rpg:ash_dragon', 8: 'rpg:void_king' };

/** Monstruos que aparecen en mazmorras según rango. */
export const DUNGEON_POOLS = [
  ['rpg:goblin', 'minecraft:zombie', 'minecraft:spider'],
  ['rpg:goblin', 'rpg:dire_wolf', 'minecraft:skeleton'],
  ['rpg:orc', 'rpg:scorpion', 'rpg:dire_wolf'],
  ['rpg:skeleton_knight', 'rpg:giant_spider', 'rpg:wraith', 'rpg:mimic'],
  ['rpg:dark_mage', 'rpg:ice_golem', 'rpg:wraith', 'rpg:fire_imp'],
  ['rpg:troll', 'rpg:dark_mage', 'rpg:skeleton_knight'],
  ['rpg:demon_knight', 'rpg:troll', 'rpg:fire_imp'],
  ['rpg:demon_knight', 'rpg:troll', 'rpg:dark_mage'],
  ['rpg:demon_knight', 'rpg:troll', 'rpg:dark_mage', 'rpg:wraith'],
];

export const ANIMALS = new Set([
  'minecraft:cow', 'minecraft:pig', 'minecraft:sheep', 'minecraft:chicken', 'minecraft:rabbit', 'minecraft:mooshroom', 'minecraft:goat',
  'minecraft:llama', 'minecraft:horse', 'minecraft:donkey', 'minecraft:fox', 'minecraft:panda', 'minecraft:polar_bear', 'minecraft:turtle',
  'minecraft:cod', 'minecraft:salmon', 'minecraft:frog', 'minecraft:camel', 'minecraft:armadillo', 'minecraft:sniffer', 'minecraft:wolf',
]);

export const VILLAGERS = new Set(['minecraft:villager_v2', 'minecraft:villager', 'minecraft:wandering_trader']);

/** Familias de monstruos hostiles (para contar "cualquier monstruo"). */
export function isHostile(typeId) {
  return !!MOBS[typeId] || !!BOSSES[typeId];
}

export function mobInfo(typeId) {
  return MOBS[typeId] ?? BOSSES[typeId];
}

export function mobName(typeId) {
  return MOBS[typeId]?.name ?? BOSSES[typeId]?.name ?? typeId.replace(/^.*:/, '').replace(/_/g, ' ');
}
