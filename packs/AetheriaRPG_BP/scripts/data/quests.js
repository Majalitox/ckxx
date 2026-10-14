// Plantillas y generador procedural de misiones (diarias, familiares, del gremio y oscuras).
import { MOBS, BOSSES, BOSS_BY_RANK, mobName } from './mobs.js';
import { RANKS } from './ranks.js';

export const MINE_TARGETS = {
  piedra: { name: 'piedra', match: ['minecraft:stone', 'minecraft:deepslate', 'minecraft:cobblestone', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite', 'minecraft:tuff', 'minecraft:cobbled_deepslate'], base: 48, rank: 0 },
  carbon: { name: 'mena de carbón', match: ['coal_ore'], base: 10, rank: 0 },
  cobre: { name: 'mena de cobre', match: ['copper_ore'], base: 10, rank: 0 },
  hierro: { name: 'mena de hierro', match: ['iron_ore'], base: 8, rank: 1 },
  oro: { name: 'mena de oro', match: ['gold_ore'], base: 5, rank: 2 },
  redstone: { name: 'mena de redstone', match: ['redstone_ore'], base: 6, rank: 2 },
  lapis: { name: 'mena de lapislázuli', match: ['lapis_ore'], base: 4, rank: 2 },
  diamante: { name: 'mena de diamante', match: ['diamond_ore'], base: 3, rank: 4 },
  esmeralda: { name: 'mena de esmeralda', match: ['emerald_ore'], base: 2, rank: 4 },
  mitrilo: { name: 'mena de mitrilo', match: ['rpg:mithril_ore'], base: 3, rank: 3 },
  adamantita: { name: 'mena de adamantita', match: ['rpg:adamantite_ore'], base: 2, rank: 5 },
  cristal: { name: 'cristal de maná', match: ['rpg:mana_crystal_block'], base: 3, rank: 2 },
};

export const DELIVERIES = {
  madre: [
    ['minecraft:bread', 3, 'pan para la cena'], ['minecraft:apple', 4, 'manzanas para una tarta'], ['minecraft:wheat', 10, 'trigo para hornear'],
    ['minecraft:poppy', 3, 'amapolas para decorar la casa'], ['minecraft:egg', 4, 'huevos para el desayuno'], ['minecraft:cooked_cod', 2, 'pescado cocinado'],
    ['minecraft:sugar_cane', 6, 'caña de azúcar para dulces'], ['minecraft:carrot', 6, 'zanahorias para el estofado'],
  ],
  padre: [
    ['minecraft:oak_log', 16, 'troncos para reparar la casa'], ['minecraft:coal', 8, 'carbón para el invierno'], ['minecraft:iron_ingot', 3, 'hierro para herramientas'],
    ['minecraft:cobblestone', 32, 'piedra para un muro'], ['minecraft:leather', 3, 'cuero para unas botas'], ['minecraft:cooked_beef', 3, 'carne para la cena'],
  ],
  hermano: [['minecraft:cookie', 3, 'galletas (¡no se lo digas a mamá!)'], ['minecraft:slime_ball', 1, 'una bola de slime para jugar'], ['minecraft:arrow', 8, 'flechas para su arco de juguete']],
  hermana: [['minecraft:cornflower', 2, 'flores azules para una corona'], ['minecraft:cookie', 2, 'galletas'], ['minecraft:amethyst_shard', 1, 'un cristal brillante']],
  recepcionista: [['rpg:monster_core', 2, 'núcleos de monstruo para investigación'], ['minecraft:paper', 12, 'papel para los registros'], ['rpg:mana_crystal_shard', 3, 'fragmentos de maná para el tablón mágico']],
  herrero: [['minecraft:iron_ingot', 8, 'hierro para forjar'], ['rpg:mithril_ingot', 2, 'lingotes de mitrilo'], ['minecraft:coal', 16, 'carbón para la fragua']],
  sombra: [['minecraft:ender_pearl', 2, 'perlas de ender'], ['minecraft:wither_rose', 1, 'una rosa marchita'], ['minecraft:gunpowder', 8, 'pólvora']],
};

export const ROLE_LABEL = { madre: 'tu madre', padre: 'tu padre', hermano: 'tu hermano', hermana: 'tu hermana', recepcionista: 'la recepcionista del Gremio', herrero: 'el herrero', sombra: 'la Hermandad de la Sombra' };

function mobsOfRank(r) {
  return Object.keys(MOBS).filter((k) => k.startsWith('rpg:') && MOBS[k].rank === r && k !== 'rpg:mimic');
}

let counter = 0;
function qid(rng) {
  counter = (counter + 1) % 1000;
  return Math.floor(rng() * 1e8).toString(36) + counter.toString(36);
}

function reward(rank, mult, kind) {
  const r = rank + 1;
  return {
    xp: Math.round(30 * r * Math.pow(r, 0.35) * mult),
    gold: Math.round(8 * r * mult),
    gp: kind === 'guild' ? Math.round(14 * r * mult) : 0,
    sp: kind === 'dark' ? Math.round(14 * r * mult) : 0,
    karma: kind === 'dark' ? -12 : 3,
  };
}

function q(rng, kind, rank, type, fields, mult) {
  return { id: qid(rng), kind, rank, type, have: 0, done: false, ...fields, ...reward(rank, mult, kind) };
}

/** Genera una misión de combate. */
function killQuest(rng, kind, rank) {
  const pool = mobsOfRank(Math.min(rank, 6));
  if (pool.length && rng() < 0.75) {
    const t = pool[Math.floor(rng() * pool.length)];
    const need = 3 + Math.floor(rng() * 4);
    return q(rng, kind, rank, 'kill', { target: t, need, title: `Caza: ${mobName(t)}`, desc: `Derrota ${need} × ${mobName(t)}.` }, 1.2);
  }
  const need = 6 + rank * 2 + Math.floor(rng() * 6);
  return q(rng, kind, rank, 'kill', { target: '#hostile', need, title: 'Limpieza de monstruos', desc: `Derrota ${need} monstruos hostiles de cualquier tipo.` }, 1.0);
}

function mineQuest(rng, kind, rank) {
  const keys = Object.keys(MINE_TARGETS).filter((k) => MINE_TARGETS[k].rank <= rank);
  const k = keys[Math.floor(rng() * keys.length)];
  const t = MINE_TARGETS[k];
  const need = Math.max(1, Math.round(t.base * (0.8 + rng() * 0.6)));
  return q(rng, kind, rank, 'mine', { target: k, need, title: `Minería: ${t.name}`, desc: `Extrae ${need} × ${t.name}.` }, 0.9 + t.rank * 0.15);
}

const SIMPLE = [
  (rng, kind, rank) => { const need = 12 + Math.floor(rng() * 16); return q(rng, kind, rank, 'chop', { need, title: 'Leñador', desc: `Tala ${need} troncos.` }, 0.8); },
  (rng, kind, rank) => { const need = 10 + Math.floor(rng() * 14); return q(rng, kind, rank, 'harvest', { need, title: 'Cosecha', desc: `Cosecha ${need} cultivos maduros.` }, 0.8); },
  (rng, kind, rank) => { const need = 3 + Math.floor(rng() * 4); return q(rng, kind, rank, 'fish', { need, title: 'Día de pesca', desc: `Pesca ${need} veces con éxito.` }, 0.9); },
  (rng, kind, rank) => { const need = 10 + Math.floor(rng() * 15); return q(rng, kind, rank, 'cast', { need, title: 'Práctica mágica', desc: `Lanza ${need} hechizos.` }, 0.9); },
  (rng, kind, rank) => { const need = 2 + Math.floor(rng() * 3); return q(rng, kind, rank, 'talk', { need, title: 'Vida social', desc: `Conversa con ${need} personas distintas.` }, 0.6); },
  (rng, kind, rank) => { const need = 400 + Math.floor(rng() * 8) * 100; return q(rng, kind, rank, 'explore', { need, title: 'Explorador', desc: `Recorre ${need} bloques.` }, 0.9); },
  (rng, kind, rank) => { const need = 4 + Math.floor(rng() * 5); return q(rng, kind, rank, 'hunt', { need, title: 'Cacería', desc: `Caza ${need} animales.` }, 0.8); },
];

/** Misiones diarias personales. stage: child|teen|adult. */
export function genDaily(rng, rank, stage, count = 3) {
  const out = [];
  const used = new Set();
  for (let tries = 0; out.length < count && tries < 30; tries++) {
    const roll = rng();
    let quest;
    if (stage === 'child') {
      quest = SIMPLE[Math.floor(rng() * SIMPLE.length)](rng, 'daily', 0);
    } else if (roll < 0.35) quest = killQuest(rng, 'daily', Math.max(0, rank - 1));
    else if (roll < 0.55) quest = mineQuest(rng, 'daily', rank);
    else quest = SIMPLE[Math.floor(rng() * SIMPLE.length)](rng, 'daily', Math.max(0, rank - 1));
    if (used.has(quest.type + quest.target)) continue;
    used.add(quest.type + quest.target);
    out.push(quest);
  }
  return out;
}

/** Encargo de un familiar (entrega). */
export function genFamily(rng, role, rank = 0) {
  const list = DELIVERIES[role];
  if (!list) return undefined;
  const [item, need, what] = list[Math.floor(rng() * list.length)];
  return q(rng, 'family', rank, 'deliver', { item, need, role, title: `Encargo de ${ROLE_LABEL[role] ?? role}`, desc: `Lleva ${need} × ${what} a ${ROLE_LABEL[role] ?? role}.` }, 0.9);
}

/** Tablón del gremio (compartido por el mundo, se renueva cada día). */
export function genGuildBoard(rng, size = 9) {
  const out = [];
  for (let i = 0; i < size; i++) {
    const rank = Math.min(8, Math.floor(i * 9 / size + rng() * 1.2));
    const roll = rng();
    let quest;
    if (rank >= 2 && roll < 0.15) {
      const bossId = BOSS_BY_RANK[Math.min(8, rank)] ?? 'rpg:goblin_king';
      quest = q(rng, 'guild', BOSSES[bossId].rank, 'boss', { target: bossId, need: 1, title: `Subyugación: ${BOSSES[bossId].name}`, desc: `Derrota a ${BOSSES[bossId].name}. (Sello disponible en la tienda del Gremio o en mazmorras)` }, 3.0);
    } else if (rank >= 1 && roll < 0.3) {
      quest = q(rng, 'guild', rank, 'dungeon', { target: rank, need: 1, title: `Mazmorra de rango ${RANKS[rank]}`, desc: `Limpia una mazmorra de rango ${RANKS[rank]} o superior.` }, 2.2);
    } else if (roll < 0.75) {
      quest = killQuest(rng, 'guild', rank);
    } else if (roll < 0.9) {
      quest = mineQuest(rng, 'guild', rank);
    } else {
      quest = genFamily(rng, 'recepcionista', rank);
      quest.kind = 'guild';
      Object.assign(quest, reward(rank, 1.1, 'guild'));
    }
    out.push(quest);
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Encargos de la Hermandad de la Sombra (camino del villano). */
export function genDark(rng, rank, count = 3) {
  const opts = [
    () => { const need = 2 + Math.floor(rng() * 3); return q(rng, 'dark', rank, 'kill', { target: '#villager', need, title: 'Silenciar testigos', desc: `Elimina a ${need} aldeanos.` }, 1.4); },
    () => q(rng, 'dark', rank, 'kill', { target: 'minecraft:iron_golem', need: 1, title: 'Romper la guardia', desc: 'Destruye un gólem de hierro.' }, 1.6),
    () => { const need = 1 + Math.floor(rng() * 2); return q(rng, 'dark', rank, 'kill', { target: '#npc', need, title: 'Contrato de sangre', desc: `Elimina a ${need} aventurero(s) errante(s).` }, 2.0); },
    () => { const need = 6 + Math.floor(rng() * 6); return q(rng, 'dark', rank, 'hunt', { need, title: 'Sacrificio nocturno', desc: `Sacrifica ${need} animales.` }, 1.0); },
    () => { const g = genFamily(rng, 'sombra', rank); g.kind = 'dark'; Object.assign(g, reward(rank, 1.3, 'dark')); return g; },
    () => killQuest(rng, 'dark', rank),
  ];
  const out = [];
  const used = new Set();
  for (let tries = 0; out.length < count && tries < 20; tries++) {
    const i = Math.floor(rng() * opts.length);
    if (used.has(i)) continue;
    used.add(i);
    const quest = opts[i]();
    quest.kind = 'dark';
    out.push(quest);
  }
  return out;
}
