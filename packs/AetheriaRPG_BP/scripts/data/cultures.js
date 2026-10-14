// Culturas de los asentamientos: una por raza. Paletas de bloques, estilo arquitectónico,
// generadores de nombres, gobiernos, leyes, economía, población, empleos, biomas preferidos
// e invasores nocturnos. Todo es dato puro (sin acceso al mundo).
//
// Los identificadores de bloque están verificados contra la lista vanilla de Bedrock
// (Mojang/bedrock-samples, metadata/vanilladata_modules/mojang-blocks.json).

import { RACE_IDS } from './races.js';

/* ------------------------------------------------------------------ */
/* Utilidades deterministas                                            */
/* ------------------------------------------------------------------ */

const pickR = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];
function weightedR(obj, rng) {
  const entries = Array.isArray(obj) ? obj : Object.entries(obj);
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/** Elige un valor de la paleta (string o lista). */
export function pal(value, rng = Math.random) {
  return Array.isArray(value) ? pickR(value, rng) : value;
}

/* ------------------------------------------------------------------ */
/* Colores de reino: [hex, lana]                                       */
/* ------------------------------------------------------------------ */

export const COLORS = {
  rojo: ['#B02E26', 'red'], azul: ['#3C44AA', 'blue'], amarillo: ['#FED83D', 'yellow'], verde: ['#5E7C16', 'green'],
  negro: ['#1D1D21', 'black'], blanco: ['#F9FFFE', 'white'], morado: ['#8932B8', 'purple'], naranja: ['#F9801D', 'orange'],
  cian: ['#169C9C', 'cyan'], celeste: ['#3AB3DA', 'light_blue'], lima: ['#80C71F', 'lime'], magenta: ['#C74EBD', 'magenta'],
  rosa: ['#F38BAA', 'pink'], gris: ['#474F52', 'gray'], plata: ['#9D9D97', 'light_gray'], marron: ['#835432', 'brown'],
};

/* ------------------------------------------------------------------ */
/* Materiales de tejado reutilizables                                  */
/* ------------------------------------------------------------------ */

const R = (wood) => ({ stair: `${wood}_stairs`, slab: `${wood}_slab`, block: `${wood}_planks` });
const ROOF = {
  dark_oak: R('dark_oak'), spruce: R('spruce'), oak: R('oak'), birch: R('birch'), acacia: R('acacia'), jungle: R('jungle'),
  cherry: R('cherry'), crimson: R('crimson'),
  bamboo: { stair: 'bamboo_mosaic_stairs', slab: 'bamboo_mosaic_slab', block: 'bamboo_mosaic' },
  brick: { stair: 'brick_stairs', slab: 'brick_slab', block: 'brick_block' },
  stone_brick: { stair: 'stone_brick_stairs', slab: 'stone_brick_slab', block: 'stone_bricks' },
  cobble: { stair: 'stone_stairs', slab: 'cobblestone_slab', block: 'cobblestone' },
  deepslate_tile: { stair: 'deepslate_tile_stairs', slab: 'deepslate_tile_slab', block: 'deepslate_tiles' },
  deepslate_brick: { stair: 'deepslate_brick_stairs', slab: 'deepslate_brick_slab', block: 'deepslate_bricks' },
  cobbled_deepslate: { stair: 'cobbled_deepslate_stairs', slab: 'cobbled_deepslate_slab', block: 'cobbled_deepslate' },
  blackstone: { stair: 'polished_blackstone_brick_stairs', slab: 'polished_blackstone_brick_slab', block: 'polished_blackstone_bricks' },
  nether: { stair: 'nether_brick_stairs', slab: 'nether_brick_slab', block: 'nether_brick' },
  red_nether: { stair: 'red_nether_brick_stairs', slab: 'red_nether_brick_slab', block: 'red_nether_brick' },
  quartz: { stair: 'quartz_stairs', slab: 'quartz_slab', block: 'quartz_block' },
  smooth_quartz: { stair: 'smooth_quartz_stairs', slab: 'smooth_quartz_slab', block: 'smooth_quartz' },
  red_sandstone: { stair: 'red_sandstone_stairs', slab: 'red_sandstone_slab', block: 'red_sandstone' },
  smooth_red_sandstone: { stair: 'smooth_red_sandstone_stairs', slab: 'smooth_red_sandstone_slab', block: 'smooth_red_sandstone' },
  mud: { stair: 'mud_brick_stairs', slab: 'mud_brick_slab', block: 'mud_bricks' },
  sandstone: { stair: 'sandstone_stairs', slab: 'sandstone_slab', block: 'sandstone' },
};

/* ------------------------------------------------------------------ */
/* Culturas                                                            */
/* ------------------------------------------------------------------ */
// Claves de paleta usadas por systems/structures.js:
//  found, floorLow/floor/floorHigh, wallLow/wall/wallHigh, frame/frameHigh (troncos), roofLow/roof/roofHigh
//  ({stair,slab,block}), pane/paneHigh, door/doorHigh, fence, gate, light ('lantern'|'soul_lantern'),
//  lightBlock, path, road, plaza, apron, defense, defenseTop, accent, leaves, carpet, crops, deco, altar, flowers.

export const CULTURES = {
  humano: {
    id: 'humano', name: 'Humano', adj: ['humano', 'humana'], people: 'humanos', c: '§f',
    arch: 'timber',
    desc: 'Casas de entramado de madera sobre zócalos de piedra, tejados a dos aguas y plazas empedradas.',
    pal: {
      found: ['cobblestone', 'stone_bricks', 'mossy_cobblestone'],
      floorLow: ['coarse_dirt', 'oak_planks', 'spruce_planks'], floor: ['spruce_planks', 'oak_planks'], floorHigh: ['polished_andesite', 'dark_oak_planks', 'stone_bricks'],
      wallLow: ['oak_planks', 'spruce_planks', 'cobblestone'], wall: ['calcite', 'white_terracotta', 'birch_planks'], wallHigh: ['stone_bricks', 'calcite', 'polished_andesite'],
      frame: ['dark_oak_log', 'spruce_log', 'oak_log'], frameHigh: ['stripped_dark_oak_log', 'dark_oak_log'],
      roofLow: [ROOF.oak, ROOF.spruce], roof: [ROOF.dark_oak, ROOF.spruce, ROOF.brick], roofHigh: [ROOF.dark_oak, ROOF.deepslate_tile, ROOF.brick],
      pane: ['glass_pane'], paneHigh: ['glass_pane', 'light_blue_stained_glass_pane'],
      door: ['spruce_door', 'wooden_door', 'dark_oak_door'], doorHigh: ['dark_oak_door'],
      fence: ['oak_fence', 'spruce_fence'], gate: ['fence_gate', 'spruce_fence_gate'],
      light: 'lantern', lightBlock: ['glowstone'],
      path: ['grass_path', 'gravel'], road: ['cobblestone', 'gravel', 'stone_bricks'], plaza: ['stone_bricks', 'cobblestone', 'polished_andesite', 'mossy_stone_bricks'],
      apron: ['grass_block', 'coarse_dirt'],
      defense: ['stone_bricks', 'cobblestone'], defenseTop: ['cobblestone_wall', 'stone_brick_wall'],
      accent: ['chiseled_stone_bricks', 'polished_andesite'], leaves: ['oak_leaves'],
      carpet: ['red_carpet', 'blue_carpet', 'green_carpet'], crops: ['wheat', 'carrots', 'potatoes', 'beetroot'],
      deco: ['barrel', 'hay_block', 'pumpkin', 'composter', 'flower_pot', 'oak_log'], altar: ['gold_block', 'lectern'],
      flowers: ['poppy', 'dandelion', 'oxeye_daisy', 'cornflower', 'red_tulip'],
    },
    roofTypes: { baja: ['gable', 'gable', 'hip'], media: ['gable', 'gable', 'hip'], alta: ['gable', 'hip'] },
    temple: 'church', walls: 'stone', tower: 'hip',
    names: {
      realm: ['Valdoria', 'Castelmar', 'Albión', 'Leonmonte', 'Aurelia', 'Valderrama', 'Montalbán', 'Solaria', 'Ribera Real', 'Castilmar', 'Puertoalba', 'Torreverde'],
      pre: ['Villa', 'Castro', 'Monte', 'Vall', 'Río', 'Torre', 'Fuente', 'Prado', 'Roble', 'Peña', 'Alba', 'Santa'],
      suf: ['rroble', 'dalia', 'verde', 'mayor', 'nueva', 'claro', 'alba', 'franca', 'real', 'llano', 'seca', 'hermosa'],
      epi: ['del Río', 'de la Colina', 'del Valle', 'de los Pinos', 'del Camino', 'de la Frontera', 'Alta', 'Baja'],
    },
    gov: { monarquía: 6, consejo: 2.5, teocracia: 1.5 }, strict: [2, 5, 3],
    economy: { comercio: 4, agricultura: 4, guerra: 1, minería: 1, magia: 1 },
    attitudes: { elfo: 0.2, enano: 0.3, orco: -0.4, bestia: 0, demonio: -0.6, celestial: 0.4, vampiro: -0.5, hada: 0.2, draconido: -0.1 },
    minorities: { elfo: 2, enano: 3, bestia: 2, celestial: 1, hada: 1, orco: 1, draconido: 1 },
    jobs: { aldeano: 5, granjero: 3, bardo: 0.6, aventurero: 0.8 }, guardBonus: 0,
    raiders: [['rpg:goblin', 4, 0], ['minecraft:zombie', 4, 0], ['minecraft:skeleton', 2, 1], ['rpg:orc', 2, 3], ['minecraft:pillager', 2, 4], ['rpg:dark_mage', 1, 8]],
    tavern: ['La Jarra Espumosa', 'El Caballo Cojo', 'La Posada del Roble', 'El Último Trago', 'La Oca Dorada'],
    templeName: 'Iglesia de los Doce', marketName: 'Mercado', kindLabel: { aldea: 'Aldea', pueblo: 'Pueblo', ciudad: 'Ciudad', capital: 'Capital', inicio: 'Villa del Gremio' },
  },

  elfo: {
    id: 'elfo', name: 'Élfica', adj: ['élfico', 'élfica'], people: 'elfos', c: '§a',
    arch: 'elven',
    desc: 'Moradas de madera clara abrazadas a grandes troncos, con cúpulas de hojas, musgo y farolillos colgantes.',
    pal: {
      found: ['mossy_stone_bricks', 'mossy_cobblestone', 'stone_bricks'],
      floorLow: ['moss_block', 'birch_planks'], floor: ['birch_planks', 'oak_planks'], floorHigh: ['birch_planks', 'polished_diorite', 'cherry_planks'],
      wallLow: ['birch_planks', 'oak_planks'], wall: ['birch_planks', 'stripped_birch_log', 'oak_planks'], wallHigh: ['stripped_birch_log', 'polished_diorite', 'cherry_planks'],
      frame: ['birch_log', 'oak_log'], frameHigh: ['birch_log', 'cherry_log'],
      roofLow: [ROOF.birch, ROOF.oak], roof: [ROOF.birch, ROOF.oak, ROOF.cherry], roofHigh: [ROOF.cherry, ROOF.birch],
      pane: ['glass_pane', 'lime_stained_glass_pane'], paneHigh: ['green_stained_glass_pane', 'glass_pane'],
      door: ['birch_door'], doorHigh: ['birch_door', 'cherry_door'],
      fence: ['birch_fence'], gate: ['birch_fence_gate'],
      light: 'lantern', lightBlock: ['shroomlight', 'verdant_froglight'],
      path: ['grass_path', 'moss_block', 'mossy_cobblestone'], road: ['mossy_stone_bricks', 'grass_path', 'moss_block'], plaza: ['moss_block', 'mossy_stone_bricks', 'polished_diorite', 'grass_block'],
      apron: ['grass_block', 'moss_block'],
      defense: ['oak_leaves ["persistent_bit"=true]', 'azalea_leaves ["persistent_bit"=true]'], defenseTop: ['azalea_leaves_flowered ["persistent_bit"=true]'],
      accent: ['polished_diorite', 'mossy_stone_bricks'], leaves: ['oak_leaves ["persistent_bit"=true]', 'azalea_leaves ["persistent_bit"=true]', 'birch_leaves ["persistent_bit"=true]'],
      carpet: ['green_carpet', 'lime_carpet', 'moss_carpet'], crops: ['wheat', 'carrots', 'beetroot', 'sweet_berry_bush'],
      deco: ['flower_pot', 'moss_block', 'barrel', 'bee_nest', 'azalea', 'flowering_azalea'], altar: ['moss_block', 'enchanting_table'],
      flowers: ['allium', 'azure_bluet', 'lily_of_the_valley', 'cornflower', 'oxeye_daisy', 'blue_orchid'],
    },
    roofTypes: { baja: ['leafy', 'gable'], media: ['leafy', 'leafy', 'gable'], alta: ['leafy', 'hip'] },
    temple: 'grove', walls: 'hedge', tower: 'leafy',
    names: {
      realm: ['Lothrien', 'Aelindor', 'Sylvanesti', 'Elarethil', 'Thalasshar', 'Calenhad', 'Ithilmar', 'Nimrodel', 'Faelivrin', 'Aerendil'],
      pre: ['Ael', 'Thal', 'Ely', 'Sil', 'Lor', 'Ith', 'Cael', 'Fae', 'Nim', 'Ara', 'Gal', 'Mir'],
      suf: ['thalas', 'ndor', 'iel', 'wen', 'lorien', 'dhel', 'ethil', 'anor', 'vanya', 'rond', 'aleth', 'quessir'],
      epi: ['de las Hojas', 'del Arroyo', 'bajo la Luna', 'de Plata', 'del Bosque Antiguo'],
    },
    gov: { consejo: 5, monarquía: 4, teocracia: 1 }, strict: [2, 6, 2],
    economy: { magia: 4, agricultura: 3, comercio: 2, guerra: 1 },
    attitudes: { humano: 0.1, enano: -0.3, orco: -0.7, bestia: 0.3, demonio: -0.8, celestial: 0.5, vampiro: -0.6, hada: 0.7, draconido: -0.2 },
    minorities: { hada: 3, humano: 2, bestia: 1, celestial: 1 },
    jobs: { aldeano: 4, granjero: 2, bardo: 1.5, aventurero: 0.6 }, guardBonus: 0,
    raiders: [['minecraft:spider', 4, 0], ['rpg:goblin', 3, 0], ['rpg:giant_spider', 2, 3], ['rpg:orc', 2, 3], ['rpg:dark_mage', 1, 6], ['rpg:wraith', 1, 8]],
    tavern: ['El Rocío de Plata', 'La Hoja Danzante', 'El Cáliz Lunar', 'La Fuente Susurrante'],
    templeName: 'Arboleda Sagrada', marketName: 'Mercado de la Floresta', kindLabel: { aldea: 'Aldea arbórea', pueblo: 'Pueblo élfico', ciudad: 'Ciudad del bosque', capital: 'Corte élfica', inicio: 'Villa del Gremio' },
  },

  enano: {
    id: 'enano', name: 'Enana', adj: ['enano', 'enana'], people: 'enanos', c: '§6',
    arch: 'dwarven',
    desc: 'Salones de piedra y pizarra profunda medio enterrados en las colinas, forjas humeantes y runas.',
    pal: {
      found: ['cobbled_deepslate', 'stone_bricks', 'polished_deepslate'],
      floorLow: ['cobblestone', 'cobbled_deepslate'], floor: ['polished_deepslate', 'stone_bricks', 'polished_andesite'], floorHigh: ['deepslate_tiles', 'polished_deepslate', 'polished_granite'],
      wallLow: ['cobblestone', 'cobbled_deepslate', 'stone'], wall: ['stone_bricks', 'deepslate_bricks', 'polished_andesite'], wallHigh: ['deepslate_bricks', 'polished_deepslate', 'deepslate_tiles'],
      frame: ['spruce_log', 'stripped_spruce_log'], frameHigh: ['chiseled_deepslate', 'polished_basalt'],
      roofLow: [ROOF.cobble, ROOF.cobbled_deepslate], roof: [ROOF.deepslate_brick, ROOF.stone_brick, ROOF.cobbled_deepslate], roofHigh: [ROOF.deepslate_tile, ROOF.deepslate_brick],
      pane: ['iron_bars', 'glass_pane'], paneHigh: ['glass_pane', 'iron_bars'],
      door: ['spruce_door', 'iron_door'], doorHigh: ['iron_door', 'spruce_door'],
      fence: ['spruce_fence'], gate: ['spruce_fence_gate'],
      light: 'lantern', lightBlock: ['glowstone', 'ochre_froglight', 'redstone_lamp'],
      path: ['gravel', 'cobblestone', 'cobbled_deepslate'], road: ['stone_bricks', 'polished_deepslate', 'cobbled_deepslate'], plaza: ['polished_deepslate', 'deepslate_tiles', 'stone_bricks', 'chiseled_deepslate'],
      apron: ['gravel', 'coarse_dirt', 'stone'],
      defense: ['deepslate_bricks', 'stone_bricks'], defenseTop: ['deepslate_brick_wall', 'cobbled_deepslate_wall'],
      accent: ['chiseled_deepslate', 'gold_block', 'chiseled_stone_bricks'], leaves: ['spruce_leaves ["persistent_bit"=true]'],
      carpet: ['red_carpet', 'orange_carpet', 'brown_carpet'], crops: ['potatoes', 'wheat', 'beetroot'],
      deco: ['barrel', 'anvil', 'iron_block', 'coal_block', 'stonecutter_block', 'barrel'], altar: ['anvil', 'gold_block'],
      flowers: ['fern', 'short_grass'],
    },
    roofTypes: { baja: ['flat', 'gable'], media: ['gable', 'flat'], alta: ['flat', 'hip'] },
    temple: 'hall', walls: 'stone', tower: 'flat', berm: true,
    names: {
      realm: ['Khazad-Dûm', 'Karak Varn', 'Durimbar', 'Ered Luin', 'Barazinbar', 'Kragmor', 'Thorgrimm', 'Mithrelheim'],
      pre: ['Karak', 'Khaz', 'Dur', 'Brom', 'Grim', 'Thor', 'Bal', 'Kil', 'Dwal', 'Mor', 'Gund', 'Ruk'],
      suf: ['dûm', 'heim', 'grund', 'barak', 'zan', 'drak', 'hold', 'rim', 'gar', 'mund', 'baz', 'thal'],
      epi: ['de Hierro', 'Profundo', 'de la Montaña', 'del Yunque', 'de Piedra'],
    },
    gov: { clan: 5, monarquía: 4, consejo: 1 }, strict: [1, 5, 4],
    economy: { minería: 6, comercio: 2, guerra: 2 },
    attitudes: { humano: 0.3, elfo: -0.4, orco: -0.6, bestia: 0, demonio: -0.4, celestial: 0.1, vampiro: -0.3, hada: -0.1, draconido: 0.2 },
    minorities: { humano: 3, draconido: 1, orco: 0.5 },
    jobs: { aldeano: 4, granjero: 1, herrero: 1, aventurero: 0.5 }, guardBonus: 1,
    raiders: [['rpg:goblin', 5, 0], ['minecraft:cave_spider', 2, 1], ['minecraft:skeleton', 2, 0], ['rpg:troll', 1, 6], ['rpg:orc', 2, 3]],
    tavern: ['La Barba Espumosa', 'El Yunque Sediento', 'La Jarra de Hierro', 'El Martillo Borracho'],
    templeName: 'Salón de los Ancestros', marketName: 'Lonja de los Gremios', kindLabel: { aldea: 'Asentamiento minero', pueblo: 'Hold enano', ciudad: 'Ciudadela', capital: 'Fortaleza Real', inicio: 'Villa del Gremio' },
  },

  orco: {
    id: 'orco', name: 'Orca', adj: ['orco', 'orca'], people: 'orcos', c: '§2',
    arch: 'orcish',
    desc: 'Campamentos tras empalizadas de troncos, tiendas de lana curtida, cráneos y hogueras siempre encendidas.',
    pal: {
      found: ['cobblestone', 'mossy_cobblestone', 'coarse_dirt'],
      floorLow: ['coarse_dirt', 'podzol'], floor: ['spruce_planks', 'coarse_dirt'], floorHigh: ['spruce_planks', 'dark_oak_planks'],
      wallLow: ['brown_wool', 'gray_wool', 'black_wool'], wall: ['spruce_log', 'stripped_spruce_log'], wallHigh: ['dark_oak_log', 'spruce_log'],
      frame: ['spruce_log', 'dark_oak_log'], frameHigh: ['dark_oak_log'],
      roofLow: [ROOF.spruce], roof: [ROOF.spruce, ROOF.dark_oak], roofHigh: [ROOF.dark_oak, ROOF.spruce],
      pane: ['spruce_fence'], paneHigh: ['iron_bars'],
      door: ['spruce_door'], doorHigh: ['dark_oak_door'],
      fence: ['spruce_fence', 'dark_oak_fence'], gate: ['spruce_fence_gate'],
      light: 'lantern', lightBlock: ['shroomlight'],
      path: ['coarse_dirt', 'gravel', 'podzol'], road: ['coarse_dirt', 'gravel', 'cobblestone'], plaza: ['coarse_dirt', 'gravel', 'cobblestone', 'podzol'],
      apron: ['coarse_dirt', 'podzol', 'grass_block'],
      defense: ['spruce_log', 'dark_oak_log'], defenseTop: ['spruce_fence', 'dark_oak_fence'],
      accent: ['bone_block', 'skeleton_skull'], leaves: ['spruce_leaves ["persistent_bit"=true]'],
      carpet: ['red_carpet', 'black_carpet', 'brown_carpet'], crops: ['potatoes', 'beetroot', 'wheat'],
      deco: ['hay_block', 'barrel', 'bone_block', 'spruce_log', 'skeleton_skull', 'target'], altar: ['bone_block', 'skeleton_skull'],
      flowers: ['fern', 'short_grass'],
    },
    roofTypes: { baja: ['tent'], media: ['gable', 'tent'], alta: ['gable', 'hip'] },
    temple: 'totem', walls: 'palisade', tower: 'flat',
    names: {
      realm: ['Gorgash', 'Urzagoth', 'Mog Thrak', 'Kragnar', 'Gul\'dahar', 'Drakkagor', 'Zug-Zug', 'Bograz'],
      pre: ['Gor', 'Urz', 'Mog', 'Krag', 'Grok', 'Thrak', 'Zug', 'Bol', 'Dru', 'Ghaz', 'Nar', 'Rok'],
      suf: ['gash', 'thar', 'ruk', 'goth', 'mar', 'dush', 'grom', 'zag', 'nak', 'tuk', 'bash', 'krul'],
      epi: ['Sangriento', 'del Colmillo', 'de las Calaveras', 'de Hierro Negro', 'del Trueno'],
    },
    gov: { tribal: 7, clan: 3 }, strict: [4, 4, 2],
    economy: { guerra: 6, minería: 1, agricultura: 1, comercio: 1 },
    attitudes: { humano: -0.3, elfo: -0.7, enano: -0.5, bestia: 0.3, demonio: 0.1, celestial: -0.5, vampiro: -0.2, hada: -0.4, draconido: 0.4 },
    minorities: { bestia: 3, draconido: 1, humano: 1 },
    jobs: { aldeano: 3, granjero: 1, herrero: 1, aventurero: 1 }, guardBonus: 2,
    raiders: [['minecraft:pillager', 3, 0], ['rpg:dire_wolf', 3, 0], ['minecraft:vindicator', 2, 3], ['rpg:troll', 1, 6], ['minecraft:skeleton', 2, 0]],
    tavern: ['El Cráneo Partido', 'La Olla de Grog', 'El Colmillo Roto', 'La Cueva del Hidromiel'],
    templeName: 'Círculo de los Tótems', marketName: 'Botín Común', kindLabel: { aldea: 'Campamento', pueblo: 'Asentamiento', ciudad: 'Bastión', capital: 'Fortaleza de la Horda', inicio: 'Villa del Gremio' },
  },

  bestia: {
    id: 'bestia', name: 'Bestial', adj: ['bestial', 'bestial'], people: 'hombres bestia', c: '§e',
    arch: 'beast',
    desc: 'Chozas de bambú y acacia sobre pilotes, tejados de paja, tótems tallados y huertos al aire libre.',
    pal: {
      found: ['mud_bricks', 'packed_mud', 'cobblestone'],
      floorLow: ['bamboo_planks', 'coarse_dirt'], floor: ['bamboo_planks', 'acacia_planks'], floorHigh: ['acacia_planks', 'bamboo_mosaic'],
      wallLow: ['bamboo_block', 'bamboo_planks'], wall: ['bamboo_planks', 'acacia_planks', 'stripped_bamboo_block'], wallHigh: ['acacia_planks', 'stripped_acacia_log', 'jungle_planks'],
      frame: ['acacia_log', 'bamboo_block', 'jungle_log'], frameHigh: ['stripped_acacia_log', 'jungle_log'],
      roofLow: [ROOF.bamboo], roof: [ROOF.bamboo, ROOF.acacia], roofHigh: [ROOF.acacia, ROOF.jungle],
      pane: ['bamboo_fence', 'glass_pane'], paneHigh: ['glass_pane'],
      door: ['bamboo_door', 'acacia_door'], doorHigh: ['acacia_door', 'jungle_door'],
      fence: ['bamboo_fence', 'acacia_fence'], gate: ['bamboo_fence_gate', 'acacia_fence_gate'],
      light: 'lantern', lightBlock: ['ochre_froglight', 'shroomlight'],
      path: ['grass_path', 'coarse_dirt', 'packed_mud'], road: ['packed_mud', 'grass_path', 'mud_bricks'], plaza: ['packed_mud', 'mud_bricks', 'coarse_dirt', 'bamboo_mosaic'],
      apron: ['grass_block', 'coarse_dirt'],
      defense: ['bamboo_block', 'acacia_log'], defenseTop: ['bamboo_fence', 'acacia_fence'],
      accent: ['hay_block', 'orange_terracotta'], leaves: ['jungle_leaves ["persistent_bit"=true]', 'acacia_leaves ["persistent_bit"=true]'],
      carpet: ['orange_carpet', 'yellow_carpet', 'brown_carpet'], crops: ['carrots', 'potatoes', 'wheat', 'melon_block', 'pumpkin'],
      deco: ['hay_block', 'composter', 'melon_block', 'pumpkin', 'barrel', 'bee_nest'], altar: ['hay_block', 'carved_pumpkin'],
      flowers: ['dandelion', 'orange_tulip', 'fern', 'short_grass'],
    },
    roofTypes: { baja: ['hip'], media: ['hip', 'gable'], alta: ['hip', 'gable'] },
    temple: 'totem', walls: 'palisade', tower: 'hip', stilts: 3,
    names: {
      realm: ['Tala-Ru', 'Kawanaka', 'Sabanaroja', 'Garrafiera', 'Aullavento', 'Melenadorada', 'Zarpaluna', 'Rugemonte'],
      pre: ['Tala', 'Kaw', 'Ruga', 'Zarpa', 'Melen', 'Aull', 'Garr', 'Colm', 'Hux', 'Nahu', 'Yaru', 'Kito'],
      suf: ['ru', 'wana', 'luna', 'viento', 'sol', 'roca', 'hondo', 'mara', 'ki', 'tay', 'pampa', 'lobo'],
      epi: ['de la Sabana', 'de las Garras', 'del Gran Árbol', 'del Río Rojo'],
    },
    gov: { tribal: 5, clan: 3, consejo: 2 }, strict: [5, 4, 1],
    economy: { agricultura: 4, guerra: 3, comercio: 2 },
    attitudes: { humano: 0.1, elfo: 0.3, enano: 0, orco: 0.2, demonio: -0.4, celestial: 0.1, vampiro: -0.5, hada: 0.4, draconido: 0 },
    minorities: { humano: 2, elfo: 1, orco: 2, hada: 1 },
    jobs: { aldeano: 3, granjero: 3, aventurero: 1, bardo: 0.5 }, guardBonus: 0,
    raiders: [['rpg:dire_wolf', 4, 0], ['minecraft:husk', 3, 0], ['rpg:scorpion', 2, 2], ['minecraft:spider', 2, 0], ['rpg:orc', 2, 4]],
    tavern: ['La Charca de Miel', 'El Colmillo Alegre', 'La Madriguera', 'El Aullido Feliz'],
    templeName: 'Santuario de los Espíritus', marketName: 'Mercado del Trueque', kindLabel: { aldea: 'Aldea de pilotes', pueblo: 'Poblado', ciudad: 'Gran Poblado', capital: 'Trono de la Manada', inicio: 'Villa del Gremio' },
  },

  demonio: {
    id: 'demonio', name: 'Demoníaca', adj: ['demoníaco', 'demoníaca'], people: 'demonios', c: '§4',
    arch: 'infernal',
    desc: 'Fortalezas de piedra negra y ladrillo infernal, braseros de almas y calderos de lava.',
    pal: {
      found: ['blackstone', 'polished_blackstone', 'basalt'],
      floorLow: ['blackstone', 'netherrack'], floor: ['polished_blackstone', 'nether_brick'], floorHigh: ['polished_blackstone_bricks', 'red_nether_brick', 'gilded_blackstone'],
      wallLow: ['blackstone', 'nether_brick'], wall: ['polished_blackstone_bricks', 'nether_brick'], wallHigh: ['polished_blackstone_bricks', 'red_nether_brick', 'chiseled_polished_blackstone'],
      frame: ['polished_basalt', 'crimson_stem'], frameHigh: ['polished_basalt', 'chiseled_polished_blackstone'],
      roofLow: [ROOF.nether], roof: [ROOF.blackstone, ROOF.nether], roofHigh: [ROOF.red_nether, ROOF.blackstone],
      pane: ['iron_bars', 'red_stained_glass_pane'], paneHigh: ['red_stained_glass_pane', 'black_stained_glass_pane'],
      door: ['crimson_door', 'iron_door'], doorHigh: ['iron_door', 'crimson_door'],
      fence: ['nether_brick_fence'], gate: ['crimson_fence_gate'],
      light: 'soul_lantern', lightBlock: ['shroomlight', 'crying_obsidian', 'pearlescent_froglight'],
      path: ['blackstone', 'soul_soil', 'polished_blackstone'], road: ['polished_blackstone_bricks', 'blackstone', 'basalt'], plaza: ['polished_blackstone', 'polished_blackstone_bricks', 'red_nether_brick', 'chiseled_polished_blackstone'],
      apron: ['soul_soil', 'blackstone', 'netherrack'],
      defense: ['polished_blackstone_bricks', 'nether_brick'], defenseTop: ['polished_blackstone_brick_wall', 'nether_brick_fence'],
      accent: ['gilded_blackstone', 'crying_obsidian', 'chiseled_nether_bricks'], leaves: ['nether_wart_block'],
      carpet: ['red_carpet', 'black_carpet', 'purple_carpet'], crops: ['beetroot', 'potatoes', 'wheat'],
      deco: ['soul_lantern', 'skeleton_skull', 'barrel', 'chiseled_nether_bricks', 'crying_obsidian', 'bone_block'], altar: ['crying_obsidian', 'chiseled_polished_blackstone'],
      flowers: ['wither_rose', 'red_tulip'],
    },
    roofTypes: { baja: ['flat', 'gable'], media: ['flat', 'steep'], alta: ['flat', 'steep'] },
    temple: 'altar', walls: 'stone', tower: 'flat', lava: true,
    names: {
      realm: ['Gehenna', 'Abaddon', 'Malebolge', 'Pandemonium', 'Dis', 'Infernalia', 'Sheol', 'Tártaro'],
      pre: ['Mal', 'Abad', 'Bel', 'Zar', 'Mor', 'Asmo', 'Dag', 'Nyx', 'Bael', 'Ash', 'Kor', 'Vex'],
      suf: ['gehenna', 'zul', 'doth', 'veth', 'moloch', 'garde', 'nar', 'oth', 'ruin', 'brasa', 'fauce', 'grieta'],
      epi: ['de las Cenizas', 'del Azufre', 'de las Llamas Negras', 'del Pacto', 'Abismal'],
    },
    gov: { monarquía: 5, teocracia: 3, clan: 2 }, strict: [1, 3, 6],
    economy: { guerra: 4, magia: 4, comercio: 1, minería: 1 },
    attitudes: { humano: -0.2, elfo: -0.5, enano: -0.3, orco: 0.2, bestia: -0.2, celestial: -1, vampiro: 0.4, hada: -0.4, draconido: 0.2 },
    minorities: { vampiro: 3, orco: 1, draconido: 1, humano: 1 },
    jobs: { aldeano: 3, sacerdote: 0.5, aventurero: 0.5, ladron: 0.5 }, guardBonus: 2,
    raiders: [['minecraft:skeleton', 3, 0], ['rpg:wraith', 2, 2], ['rpg:skeleton_knight', 2, 3], ['minecraft:wither_skeleton', 1, 6], ['minecraft:blaze', 1, 5]],
    tavern: ['El Caldero Hirviente', 'La Copa de Azufre', 'El Pacto Roto', 'La Llama Negra'],
    templeName: 'Altar del Abismo', marketName: 'Mercado de Almas', kindLabel: { aldea: 'Avanzada', pueblo: 'Enclave', ciudad: 'Ciudadela infernal', capital: 'Trono Abismal', inicio: 'Villa del Gremio' },
  },

  celestial: {
    id: 'celestial', name: 'Celestial', adj: ['celestial', 'celestial'], people: 'celestiales', c: '§b',
    arch: 'celestial',
    desc: 'Templos de cuarzo y mármol blanco con columnas, cúpulas y detalles de oro que brillan al sol.',
    pal: {
      found: ['smooth_quartz', 'quartz_block', 'calcite'],
      floorLow: ['calcite', 'smooth_stone'], floor: ['smooth_quartz', 'calcite', 'polished_diorite'], floorHigh: ['quartz_bricks', 'chiseled_quartz_block', 'smooth_quartz'],
      wallLow: ['calcite', 'polished_diorite'], wall: ['white_concrete', 'smooth_quartz', 'calcite'], wallHigh: ['quartz_bricks', 'quartz_block', 'white_concrete'],
      frame: ['quartz_pillar', 'birch_log'], frameHigh: ['quartz_pillar'],
      roofLow: [ROOF.smooth_quartz, ROOF.birch], roof: [ROOF.quartz, ROOF.smooth_quartz], roofHigh: [ROOF.quartz, ROOF.smooth_quartz],
      pane: ['light_blue_stained_glass_pane', 'glass_pane'], paneHigh: ['yellow_stained_glass_pane', 'light_blue_stained_glass_pane'],
      door: ['birch_door'], doorHigh: ['birch_door', 'iron_door'],
      fence: ['birch_fence'], gate: ['birch_fence_gate'],
      light: 'lantern', lightBlock: ['sea_lantern', 'glowstone', 'pearlescent_froglight'],
      path: ['polished_diorite', 'smooth_stone', 'calcite'], road: ['smooth_quartz', 'polished_diorite', 'calcite'], plaza: ['smooth_quartz', 'quartz_bricks', 'chiseled_quartz_block', 'gold_block'],
      apron: ['grass_block', 'calcite'],
      defense: ['quartz_bricks', 'calcite'], defenseTop: ['diorite_wall', 'andesite_wall'],
      accent: ['gold_block', 'chiseled_quartz_block', 'sea_lantern'], leaves: ['birch_leaves ["persistent_bit"=true]', 'cherry_leaves ["persistent_bit"=true]'],
      carpet: ['white_carpet', 'light_blue_carpet', 'yellow_carpet'], crops: ['wheat', 'carrots', 'beetroot'],
      deco: ['flower_pot', 'lectern', 'bookshelf', 'end_rod', 'amethyst_block', 'gold_block'], altar: ['gold_block', 'enchanting_table', 'beacon'],
      flowers: ['lily_of_the_valley', 'white_tulip', 'oxeye_daisy', 'azure_bluet'],
    },
    roofTypes: { baja: ['flat', 'hip'], media: ['flat', 'dome', 'hip'], alta: ['dome', 'flat'] },
    temple: 'grand', walls: 'stone', tower: 'dome',
    names: {
      realm: ['Empíreo', 'Elysia', 'Lumenor', 'Aurealis', 'Seraphel', 'Celestia', 'Zafiria', 'Halo Eterno'],
      pre: ['Ela', 'Lum', 'Aure', 'Sera', 'Cel', 'Zafi', 'Glor', 'Alba', 'Luz', 'Sol', 'Ofa', 'Iri'],
      suf: ['iel', 'ia', 'lux', 'ora', 'el', 'is', 'ana', 'ión', 'aria', 'mar', 'ithel', 'una'],
      epi: ['de la Aurora', 'del Alba Eterna', 'de los Siete Cielos', 'de Luz', 'Sagrada'],
    },
    gov: { teocracia: 7, consejo: 3 }, strict: [0, 3, 7],
    economy: { magia: 5, comercio: 3, agricultura: 2 },
    attitudes: { humano: 0.3, elfo: 0.4, enano: 0.1, orco: -0.4, bestia: 0, demonio: -1, vampiro: -0.9, hada: 0.4, draconido: -0.1 },
    minorities: { humano: 3, elfo: 2, hada: 1 },
    jobs: { aldeano: 3, sacerdote: 1, bardo: 1, granjero: 1 }, guardBonus: 0,
    raiders: [['minecraft:zombie', 3, 0], ['rpg:wraith', 3, 1], ['rpg:dark_mage', 2, 3], ['rpg:fire_imp', 2, 5], ['minecraft:phantom', 1, 4]],
    tavern: ['El Néctar Dorado', 'La Pluma Blanca', 'El Arpa Celeste', 'La Copa de Ambrosía'],
    templeName: 'Gran Templo de la Luz', marketName: 'Ágora', kindLabel: { aldea: 'Ermita', pueblo: 'Villa santa', ciudad: 'Ciudad blanca', capital: 'Santa Sede', inicio: 'Villa del Gremio' },
  },

  vampiro: {
    id: 'vampiro', name: 'Vampírica', adj: ['vampírico', 'vampírica'], people: 'vampiros', c: '§5',
    arch: 'gothic',
    desc: 'Mansiones góticas de pizarra oscura con tejados afilados, vidrieras rojas y faroles de almas.',
    pal: {
      found: ['deepslate_bricks', 'polished_deepslate', 'cobbled_deepslate'],
      floorLow: ['dark_oak_planks', 'cobbled_deepslate'], floor: ['dark_oak_planks', 'polished_deepslate'], floorHigh: ['dark_oak_planks', 'deepslate_tiles', 'red_nether_brick'],
      wallLow: ['cobbled_deepslate', 'dark_oak_planks'], wall: ['deepslate_bricks', 'polished_deepslate', 'dark_oak_planks'], wallHigh: ['deepslate_tiles', 'deepslate_bricks', 'polished_blackstone_bricks'],
      frame: ['dark_oak_log', 'stripped_dark_oak_log'], frameHigh: ['polished_basalt', 'dark_oak_log'],
      roofLow: [ROOF.dark_oak], roof: [ROOF.deepslate_tile, ROOF.dark_oak], roofHigh: [ROOF.deepslate_tile, ROOF.blackstone],
      pane: ['red_stained_glass_pane', 'iron_bars'], paneHigh: ['red_stained_glass_pane', 'purple_stained_glass_pane'],
      door: ['dark_oak_door'], doorHigh: ['dark_oak_door', 'iron_door'],
      fence: ['dark_oak_fence'], gate: ['dark_oak_fence_gate'],
      light: 'soul_lantern', lightBlock: ['redstone_lamp', 'crying_obsidian'],
      path: ['cobbled_deepslate', 'gravel', 'polished_deepslate'], road: ['deepslate_tiles', 'cobbled_deepslate', 'deepslate_bricks'], plaza: ['deepslate_tiles', 'polished_deepslate', 'red_nether_brick', 'deepslate_bricks'],
      apron: ['podzol', 'coarse_dirt', 'grass_block'],
      defense: ['deepslate_bricks', 'polished_deepslate'], defenseTop: ['deepslate_brick_wall', 'iron_bars'],
      accent: ['red_nether_brick', 'chiseled_deepslate', 'redstone_block'], leaves: ['dark_oak_leaves ["persistent_bit"=true]'],
      carpet: ['red_carpet', 'black_carpet', 'purple_carpet'], crops: ['beetroot', 'potatoes', 'carrots'],
      deco: ['red_candle', 'skeleton_skull', 'barrel', 'flower_pot', 'cauldron', 'bookshelf'], altar: ['red_nether_brick', 'lectern'],
      flowers: ['wither_rose', 'red_tulip', 'poppy', 'rose_bush'],
    },
    roofTypes: { baja: ['gable', 'steep'], media: ['steep', 'steep', 'gable'], alta: ['steep'] },
    temple: 'chapel', walls: 'stone', tower: 'steep',
    names: {
      realm: ['Nocturnia', 'Valaquia', 'Sangrelunar', 'Draculesti', 'Umbravel', 'Carmesía', 'Ravenmoor', 'Velmorth'],
      pre: ['Noct', 'Vel', 'Rav', 'Umbra', 'Carm', 'Mor', 'Sang', 'Nyx', 'Vlad', 'Drac', 'Grim', 'Lun'],
      suf: ['mor', 'grave', 'moor', 'ia', 'thorn', 'veil', 'cripta', 'noche', 'via', 'reth', 'lenor', 'ruina'],
      epi: ['de la Niebla', 'de la Luna Roja', 'de los Cuervos', 'Eterna', 'del Crepúsculo'],
    },
    gov: { monarquía: 6, consejo: 4 }, strict: [1, 4, 5],
    economy: { comercio: 4, magia: 3, guerra: 2 },
    attitudes: { humano: -0.1, elfo: -0.4, enano: -0.2, orco: -0.3, bestia: -0.4, demonio: 0.4, celestial: -0.9, hada: -0.3, draconido: 0 },
    minorities: { humano: 4, demonio: 1, elfo: 0.5 },
    jobs: { aldeano: 3, bardo: 1, ladron: 0.4, aventurero: 0.4 }, guardBonus: 1,
    raiders: [['minecraft:pillager', 3, 0], ['minecraft:vindicator', 2, 2], ['rpg:dire_wolf', 2, 0], ['minecraft:witch', 1, 3], ['minecraft:evocation_illager', 1, 7]],
    tavern: ['La Copa Escarlata', 'El Cuervo Insomne', 'La Última Gota', 'El Ataúd Alegre'],
    templeName: 'Capilla de la Noche', marketName: 'Mercado Nocturno', kindLabel: { aldea: 'Villorrio', pueblo: 'Burgo', ciudad: 'Ciudad sombría', capital: 'Castillo del Conde', inicio: 'Villa del Gremio' },
  },

  hada: {
    id: 'hada', name: 'Feérica', adj: ['feérico', 'feérica'], people: 'hadas', c: '§d',
    arch: 'fairy',
    desc: 'Casas en setas gigantes, anillos de flores, musgo, hongos luminosos y caminos de pétalos.',
    pal: {
      found: ['moss_block', 'mossy_cobblestone', 'grass_block'],
      floorLow: ['moss_block', 'oak_planks'], floor: ['moss_block', 'birch_planks', 'cherry_planks'], floorHigh: ['cherry_planks', 'polished_diorite', 'moss_block'],
      wallLow: ['mushroom_stem ["huge_mushroom_bits"=15]'], wall: ['mushroom_stem ["huge_mushroom_bits"=15]', 'birch_planks'], wallHigh: ['mushroom_stem ["huge_mushroom_bits"=15]', 'cherry_planks'],
      frame: ['mushroom_stem ["huge_mushroom_bits"=15]', 'birch_log'], frameHigh: ['cherry_log', 'birch_log'],
      roofLow: [ROOF.oak], roof: [ROOF.cherry, ROOF.birch], roofHigh: [ROOF.cherry],
      pane: ['pink_stained_glass_pane', 'glass_pane', 'magenta_stained_glass_pane'], paneHigh: ['pink_stained_glass_pane', 'light_blue_stained_glass_pane'],
      door: ['cherry_door', 'birch_door'], doorHigh: ['cherry_door'],
      fence: ['cherry_fence', 'birch_fence'], gate: ['cherry_fence_gate', 'birch_fence_gate'],
      light: 'lantern', lightBlock: ['shroomlight', 'glowstone', 'pearlescent_froglight'],
      path: ['moss_block', 'grass_path', 'mossy_cobblestone'], road: ['moss_block', 'grass_path', 'polished_diorite'], plaza: ['moss_block', 'polished_diorite', 'calcite', 'pink_terracotta'],
      apron: ['grass_block', 'moss_block'],
      defense: ['azalea_leaves ["persistent_bit"=true]', 'oak_leaves ["persistent_bit"=true]'], defenseTop: ['azalea_leaves_flowered ["persistent_bit"=true]'],
      accent: ['shroomlight', 'amethyst_block', 'pink_terracotta'], leaves: ['azalea_leaves_flowered ["persistent_bit"=true]', 'cherry_leaves ["persistent_bit"=true]'],
      cap: ['red_mushroom_block ["huge_mushroom_bits"=14]', 'brown_mushroom_block ["huge_mushroom_bits"=14]'],
      carpet: ['pink_carpet', 'magenta_carpet', 'moss_carpet'], crops: ['wheat', 'carrots', 'pumpkin', 'melon_block', 'sweet_berry_bush'],
      deco: ['flower_pot', 'bee_nest', 'flowering_azalea', 'azalea', 'amethyst_cluster', 'moss_block'], altar: ['amethyst_block', 'enchanting_table'],
      flowers: ['allium', 'pink_tulip', 'blue_orchid', 'azure_bluet', 'lily_of_the_valley', 'cornflower', 'pink_petals'],
    },
    roofTypes: { baja: ['cap'], media: ['cap', 'cap', 'leafy'], alta: ['cap', 'leafy'] },
    temple: 'ring', walls: 'hedge', tower: 'cap', round: true,
    names: {
      realm: ['Corte Seelie', 'Avalonia', 'Brumaflor', 'Rociolanda', 'Titania', 'Lirial', 'Feéria', 'Pétalo Eterno'],
      pre: ['Pétalo', 'Bruma', 'Rocío', 'Lirio', 'Musgo', 'Campa', 'Flor', 'Brisa', 'Seta', 'Perla', 'Ámbar', 'Hada'],
      suf: ['landa', 'flor', 'via', 'luz', 'nía', 'rocío', 'brillo', 'sueño', 'miel', 'cristal', 'aroma', 'polen'],
      epi: ['de los Hongos', 'del Arcoíris', 'de las Luciérnagas', 'del Rocío', 'Encantada'],
    },
    gov: { monarquía: 6, consejo: 4 }, strict: [5, 4, 1],
    economy: { magia: 5, agricultura: 4, comercio: 1 },
    attitudes: { humano: 0.2, elfo: 0.7, enano: -0.1, orco: -0.5, bestia: 0.3, demonio: -0.6, celestial: 0.4, vampiro: -0.5, draconido: -0.2 },
    minorities: { elfo: 4, bestia: 1, celestial: 1, humano: 1 },
    jobs: { aldeano: 3, granjero: 3, bardo: 1.5 }, guardBonus: -1,
    raiders: [['rpg:goblin', 4, 0], ['minecraft:spider', 3, 0], ['minecraft:witch', 2, 2], ['rpg:giant_spider', 1, 4], ['rpg:dark_mage', 1, 6]],
    tavern: ['El Néctar de Luciérnaga', 'La Seta Risueña', 'El Dedal de Miel', 'La Gota de Rocío'],
    templeName: 'Anillo de las Hadas', marketName: 'Feria de las Flores', kindLabel: { aldea: 'Corro de setas', pueblo: 'Villa feérica', ciudad: 'Ciudad de las flores', capital: 'Palacio de la Reina Hada', inicio: 'Villa del Gremio' },
  },

  draconido: {
    id: 'draconido', name: 'Dracónida', adj: ['dracónido', 'dracónida'], people: 'dracónidos', c: '§c',
    arch: 'draconic',
    desc: 'Zigurats escalonados de arenisca roja y terracota, braseros ardientes y ornamentos de oro.',
    pal: {
      found: ['red_sandstone', 'cut_red_sandstone', 'smooth_red_sandstone'],
      floorLow: ['red_sand', 'cut_red_sandstone'], floor: ['smooth_red_sandstone', 'cut_red_sandstone', 'orange_terracotta'], floorHigh: ['chiseled_red_sandstone', 'smooth_red_sandstone', 'red_glazed_terracotta'],
      wallLow: ['red_sandstone', 'orange_terracotta'], wall: ['cut_red_sandstone', 'red_sandstone', 'orange_terracotta'], wallHigh: ['smooth_red_sandstone', 'red_terracotta', 'chiseled_red_sandstone'],
      frame: ['chiseled_red_sandstone', 'jungle_log'], frameHigh: ['chiseled_red_sandstone', 'gold_block'],
      roofLow: [ROOF.red_sandstone], roof: [ROOF.red_sandstone, ROOF.smooth_red_sandstone], roofHigh: [ROOF.smooth_red_sandstone, ROOF.red_nether],
      pane: ['orange_stained_glass_pane', 'iron_bars'], paneHigh: ['yellow_stained_glass_pane', 'orange_stained_glass_pane'],
      door: ['jungle_door', 'acacia_door'], doorHigh: ['iron_door', 'jungle_door'],
      fence: ['jungle_fence', 'acacia_fence'], gate: ['jungle_fence_gate', 'acacia_fence_gate'],
      light: 'lantern', lightBlock: ['ochre_froglight', 'shroomlight', 'glowstone'],
      path: ['red_sand', 'cut_red_sandstone', 'gravel'], road: ['cut_red_sandstone', 'smooth_red_sandstone', 'red_sandstone'], plaza: ['smooth_red_sandstone', 'cut_red_sandstone', 'orange_glazed_terracotta', 'chiseled_red_sandstone'],
      apron: ['red_sand', 'coarse_dirt', 'grass_block'],
      defense: ['red_sandstone', 'cut_red_sandstone'], defenseTop: ['red_sandstone_wall'],
      accent: ['gold_block', 'red_glazed_terracotta', 'yellow_terracotta'], leaves: ['jungle_leaves ["persistent_bit"=true]'],
      carpet: ['red_carpet', 'orange_carpet', 'yellow_carpet'], crops: ['wheat', 'carrots', 'potatoes'],
      deco: ['lantern', 'gold_block', 'barrel', 'decorated_pot', 'orange_glazed_terracotta', 'red_glazed_terracotta'], altar: ['gold_block', 'red_glazed_terracotta'],
      flowers: ['deadbush', 'orange_tulip', 'torchflower'],
    },
    roofTypes: { baja: ['flat', 'stepped'], media: ['stepped', 'stepped', 'flat'], alta: ['stepped'] },
    temple: 'ziggurat', walls: 'stone', tower: 'stepped',
    names: {
      realm: ['Draconia', 'Ignivar', 'Pyrrhos', 'Escamarroja', 'Kar-Ignis', 'Vermithor', 'Sol Ardiente', 'Ashkaran'],
      pre: ['Dra', 'Ign', 'Pyr', 'Kar', 'Ver', 'Ash', 'Sar', 'Tiam', 'Rhog', 'Vul', 'Zor', 'Kri'],
      suf: ['kar', 'nis', 'thos', 'mar', 'goth', 'vir', 'akan', 'thar', 'escama', 'brasa', 'dún', 'ix'],
      epi: ['de las Escamas', 'del Sol Rojo', 'de la Llama Eterna', 'del Desierto', 'de los Wyrms'],
    },
    gov: { monarquía: 5, clan: 3, teocracia: 2 }, strict: [1, 5, 4],
    economy: { guerra: 4, minería: 3, comercio: 2, magia: 1 },
    attitudes: { humano: -0.1, elfo: -0.3, enano: 0.2, orco: 0.3, bestia: 0, demonio: 0.1, celestial: -0.2, vampiro: 0, hada: -0.3 },
    minorities: { orco: 2, humano: 2, enano: 1, demonio: 1 },
    jobs: { aldeano: 3, herrero: 1, granjero: 1, aventurero: 1 }, guardBonus: 1,
    raiders: [['minecraft:husk', 4, 0], ['rpg:scorpion', 3, 1], ['rpg:fire_imp', 2, 4], ['minecraft:skeleton', 2, 0], ['rpg:orc', 1, 3]],
    tavern: ['La Escama Dorada', 'El Aliento de Fuego', 'La Brasa Viva', 'El Colmillo Ardiente'],
    templeName: 'Zigurat de la Llama', marketName: 'Bazar de las Escamas', kindLabel: { aldea: 'Oasis', pueblo: 'Villa de arenisca', ciudad: 'Ciudad escalonada', capital: 'Trono del Dragón', inicio: 'Villa del Gremio' },
  },
};

export const CULTURE_IDS = Object.keys(CULTURES);

export function cultureOf(id) {
  return CULTURES[id] ?? CULTURES.humano;
}

/* ------------------------------------------------------------------ */
/* Biomas → culturas                                                   */
/* ------------------------------------------------------------------ */
// Se comprueban en orden: la primera palabra clave contenida en el id del bioma decide los pesos.
export const BIOME_CULTURES = [
  ['rpg:bosque_encantado', { hada: 5, elfo: 4 }],
  ['rpg:tierras_malditas', { demonio: 6, vampiro: 2 }],
  ['rpg:picos_enanos', { enano: 8, orco: 1 }],
  ['rpg:desierto_ceniza', { draconido: 6, demonio: 2 }],
  ['rpg:pantano_necrotico', { vampiro: 6, demonio: 2 }],
  ['rpg:tundra_cristalina', { celestial: 5, enano: 2 }],
  ['mushroom', { hada: 10 }],
  ['cherry', { hada: 4, celestial: 4, elfo: 2 }],
  ['flower_forest', { hada: 5, elfo: 4 }],
  ['pale_garden', { vampiro: 7, hada: 1 }],
  ['roofed_forest', { vampiro: 5, elfo: 2, orco: 1 }],
  ['dark_forest', { vampiro: 5, elfo: 2 }],
  ['swamp', { vampiro: 4, demonio: 2, bestia: 2 }],
  ['mangrove', { bestia: 5, vampiro: 2 }],
  ['mesa', { draconido: 7, orco: 1 }],
  ['badlands', { draconido: 7, orco: 1 }],
  ['desert', { draconido: 6, humano: 1, bestia: 1 }],
  ['savanna', { bestia: 6, orco: 2, draconido: 1 }],
  ['bamboo', { bestia: 7, elfo: 1 }],
  ['jungle', { bestia: 6, elfo: 2 }],
  ['ice', { celestial: 4, enano: 3 }],
  ['frozen', { enano: 4, celestial: 3 }],
  ['snowy', { enano: 4, celestial: 2, orco: 1 }],
  ['cold_taiga', { orco: 3, enano: 3, celestial: 1 }],
  ['mega_taiga', { orco: 5, enano: 2 }],
  ['redwood', { orco: 5, enano: 2 }],
  ['taiga', { orco: 4, enano: 3, humano: 2 }],
  ['peaks', { enano: 8, celestial: 1 }],
  ['extreme_hills', { enano: 7, orco: 2 }],
  ['windswept', { enano: 7, orco: 2 }],
  ['grove', { enano: 5, elfo: 2 }],
  ['slopes', { enano: 6, celestial: 1 }],
  ['stone', { enano: 5, humano: 2 }],
  ['meadow', { celestial: 3, humano: 3, hada: 2 }],
  ['birch', { elfo: 6, hada: 1, humano: 1 }],
  ['forest', { elfo: 4, humano: 3, hada: 1 }],
  ['sunflower', { humano: 5, celestial: 2 }],
  ['plains', { humano: 6, celestial: 1, bestia: 1 }],
  ['beach', { humano: 4, bestia: 1 }],
  ['ocean', { humano: 4 }],
  ['river', { humano: 4, elfo: 1 }],
];

/** Elige una cultura para el bioma dado (id de BiomeType). */
export function cultureForBiome(biomeId, rng = Math.random) {
  const id = String(biomeId ?? '');
  for (const [key, weights] of BIOME_CULTURES) {
    if (id.includes(key)) return weightedR(weights, rng);
  }
  return weightedR({ humano: 4, elfo: 1, enano: 1, orco: 1, bestia: 1 }, rng);
}

/** Pesos de cultura de un bioma (para votar entre varias muestras). */
export function biomeWeights(biomeId) {
  const id = String(biomeId ?? '');
  for (const [key, weights] of BIOME_CULTURES) if (id.includes(key)) return weights;
  return { humano: 4, elfo: 1, enano: 1, orco: 1, bestia: 1 };
}

/* ------------------------------------------------------------------ */
/* Gobiernos y títulos                                                 */
/* ------------------------------------------------------------------ */

export const GOVERNMENTS = {
  monarquía: { name: 'Monarquía', realm: ['Reino de', 'Reino de', 'Imperio de', 'Principado de'] },
  consejo: { name: 'Consejo', realm: ['República de', 'Liga de', 'Concilio de', 'Mancomunidad de'] },
  tribal: { name: 'Tribal', realm: ['Horda de', 'Tribus de', 'Dominio de'] },
  teocracia: { name: 'Teocracia', realm: ['Teocracia de', 'Sagrado Dominio de', 'Santa Orden de'] },
  clan: { name: 'Clan', realm: ['Clan', 'Clanes de', 'Fortaleza de'] },
};

// Títulos [masculino, femenino] por cultura y gobierno (con valores por defecto).
const TITLES = {
  _: {
    monarquía: ['Rey', 'Reina'], consejo: ['Gran Canciller', 'Gran Canciller'], tribal: ['Gran Jefe', 'Gran Jefa'],
    teocracia: ['Sumo Sacerdote', 'Suma Sacerdotisa'], clan: ['Señor del Clan', 'Señora del Clan'],
  },
  elfo: { monarquía: ['Alto Rey', 'Alta Reina'], consejo: ['Primer Orador', 'Primera Oradora'] },
  enano: { monarquía: ['Rey Bajo la Montaña', 'Reina Bajo la Montaña'], clan: ['Thane', 'Thane'] },
  orco: { tribal: ['Gran Jefe', 'Gran Jefa'], clan: ['Caudillo', 'Caudilla'] },
  bestia: { tribal: ['Alfa de la Manada', 'Alfa de la Manada'], consejo: ['Anciano Mayor', 'Anciana Mayor'] },
  demonio: { monarquía: ['Archiduque', 'Archiduquesa'], teocracia: ['Hierofante del Abismo', 'Hierofante del Abismo'], clan: ['Señor de la Guerra', 'Señora de la Guerra'] },
  celestial: { teocracia: ['Sumo Pontífice', 'Suma Pontífice'], consejo: ['Arconte', 'Arconte'] },
  vampiro: { monarquía: ['Conde', 'Condesa'], consejo: ['Príncipe de la Noche', 'Princesa de la Noche'] },
  hada: { monarquía: ['Rey de las Hadas', 'Reina de las Hadas'], consejo: ['Gran Druida', 'Gran Druida'] },
  draconido: { monarquía: ['Señor Dragón', 'Señora Dragón'], clan: ['Gran Wyrm', 'Gran Wyrm'], teocracia: ['Profeta de la Llama', 'Profetisa de la Llama'] },
};

export function rulerTitle(cultureId, gov, gender) {
  const t = TITLES[cultureId]?.[gov] ?? TITLES._[gov] ?? TITLES._.monarquía;
  return t[gender === 'f' ? 1 : 0];
}

export const STRICTNESS = [
  { id: 0, name: 'Laxas', desc: 'Los guardias hacen la vista gorda con los pequeños hurtos.' },
  { id: 1, name: 'Firmes', desc: 'La guardia patrulla y castiga lo que ve.' },
  { id: 2, name: 'Implacables', desc: 'Cualquier falta se paga cara y la guardia nunca descansa.' },
];

export const ECONOMY = {
  minería: 'Minería', agricultura: 'Agricultura', comercio: 'Comercio', guerra: 'Guerra', magia: 'Magia',
};

/* ------------------------------------------------------------------ */
/* Nombres                                                              */
/* ------------------------------------------------------------------ */

function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Nombre de un asentamiento según su cultura. */
export function townName(cultureId, rng = Math.random) {
  const n = cultureOf(cultureId).names;
  const pre = pickR(n.pre, rng);
  let suf = pickR(n.suf, rng);
  // Evitar letras duplicadas incómodas en la unión ("Villa" + "alba").
  if (pre.slice(-1).toLowerCase() === suf.charAt(0).toLowerCase()) suf = suf.slice(1);
  let name = capFirst(pre + suf);
  if (n.epi?.length && rng() < 0.22) name += ' ' + pickR(n.epi, rng);
  return name;
}

/** Nombre base de un reino (sin el prefijo de gobierno). */
export function realmBaseName(cultureId, rng = Math.random) {
  const n = cultureOf(cultureId).names;
  if (rng() < 0.55) return pickR(n.realm, rng);
  return capFirst(pickR(n.pre, rng) + pickR(n.suf, rng));
}

export function realmName(cultureId, gov, rng = Math.random) {
  const base = realmBaseName(cultureId, rng);
  const pre = pickR(GOVERNMENTS[gov]?.realm ?? GOVERNMENTS.monarquía.realm, rng);
  return `${pre} ${base}`;
}

/** Etiqueta del tipo de asentamiento para la cultura dada. */
export function kindLabel(cultureId, kind) {
  return cultureOf(cultureId).kindLabel?.[kind] ?? { aldea: 'Aldea', pueblo: 'Pueblo', ciudad: 'Ciudad', capital: 'Capital', inicio: 'Villa del Gremio' }[kind] ?? kind;
}

/* ------------------------------------------------------------------ */
/* Reinos y población                                                   */
/* ------------------------------------------------------------------ */

export function pickGovernment(cultureId, rng = Math.random) {
  return weightedR(cultureOf(cultureId).gov, rng);
}

export function pickStrictness(cultureId, rng = Math.random) {
  const s = cultureOf(cultureId).strict ?? [3, 4, 3];
  return weightedR([[0, s[0]], [1, s[1]], [2, s[2]]], rng);
}

export function pickEconomy(cultureId, rng = Math.random) {
  return weightedR(cultureOf(cultureId).economy, rng);
}

/** Actitudes del reino hacia cada raza (-1..1), con variación propia de cada reino. */
export function rollAttitudes(cultureId, rng = Math.random) {
  const base = cultureOf(cultureId).attitudes ?? {};
  const out = {};
  for (const r of RACE_IDS) {
    let v = r === cultureId ? 0.9 : base[r] ?? 0;
    v += (rng() - 0.5) * 0.5;
    out[r] = Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
  }
  out[cultureId] = Math.max(out[cultureId], 0.7);
  return out;
}

/** Dos colores distintos para el reino: { primary, secondary, wool: [lanaPrimaria, lanaSecundaria] }. */
export function pickColors(cultureId, rng = Math.random) {
  const prefs = {
    humano: ['rojo', 'azul', 'amarillo', 'blanco', 'verde'], elfo: ['verde', 'lima', 'blanco', 'celeste', 'amarillo'],
    enano: ['rojo', 'naranja', 'marron', 'amarillo', 'negro'], orco: ['rojo', 'negro', 'marron', 'verde'],
    bestia: ['naranja', 'amarillo', 'marron', 'verde', 'rojo'], demonio: ['rojo', 'negro', 'morado', 'naranja'],
    celestial: ['blanco', 'amarillo', 'celeste', 'cian'], vampiro: ['rojo', 'negro', 'morado', 'gris'],
    hada: ['rosa', 'magenta', 'lima', 'celeste', 'morado'], draconido: ['rojo', 'naranja', 'amarillo', 'negro'],
  }[cultureId] ?? Object.keys(COLORS);
  const a = pickR(prefs, rng);
  let b = pickR(prefs, rng);
  for (let i = 0; i < 6 && b === a; i++) b = pickR(Object.keys(COLORS), rng);
  return { primary: COLORS[a][0], secondary: COLORS[b][0], wool: [COLORS[a][1], COLORS[b][1]], names: [a, b] };
}

/** Raza de un habitante: mayoría de la cultura, minorías según la cultura y la actitud del reino. */
export function pickResidentRace(cultureId, attitudes, rng = Math.random) {
  if (rng() < 0.74) return cultureId;
  const mins = cultureOf(cultureId).minorities ?? {};
  const entries = [];
  for (const r of RACE_IDS) {
    if (r === cultureId) continue;
    const att = attitudes?.[r] ?? 0;
    const w = (mins[r] ?? 0.2) * Math.max(0.05, 1 + att * 1.2);
    entries.push([r, w]);
  }
  return entries.length ? weightedR(entries, rng) : cultureId;
}

/** Empleo para un habitante sin puesto fijo. */
export function pickGeneralJob(cultureId, rng = Math.random) {
  return weightedR(cultureOf(cultureId).jobs ?? { aldeano: 1 }, rng);
}

/** Lista de invasores posibles según el día del mundo. */
export function raiderPool(cultureId, day = 0) {
  const list = (cultureOf(cultureId).raiders ?? []).filter(([, , minDay]) => day >= (minDay ?? 0));
  return list.length ? list.map(([id, w]) => [id, w]) : [['minecraft:zombie', 1]];
}

export { weightedR, pickR };
