// Forja (reparar, mejorar encantamientos, fundir) y Forja Rúnica exclusiva de los enanos.
// También la alquimia (elixires; los elfos producen el doble y tienen recetas exclusivas).
import { EnchantmentTypes } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { addHobbyXp, spendGold, msg } from '../core/progression.js';
import { hobbyLevel } from '../core/profile.js';
import { RUNES, RUNE_PREFIX, itemSlot, readRunes, ELIXIRS, FLOWERS } from '../data/items.js';
import { heldItem, setHeldItem, countItem, removeItem, countWhere, removeWhere, giveItem, makeItem, particle, psound, getBlock } from '../util/compat.js';
import { buttons, info, confirm } from '../util/ui.js';

const FORGE_BLOCKS = new Set(['minecraft:anvil', 'minecraft:chipped_anvil', 'minecraft:damaged_anvil', 'minecraft:smithing_table', 'minecraft:blast_furnace']);
const ALCHEMY_BLOCKS = new Set(['minecraft:brewing_stand', 'minecraft:cauldron', 'minecraft:enchanting_table']);

export function nearBlock(player, set, r = 4) {
  const l = player.location;
  for (let dx = -r; dx <= r; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) {
    const b = getBlock(player.dimension, { x: Math.floor(l.x) + dx, y: Math.floor(l.y) + dy, z: Math.floor(l.z) + dz });
    if (b && set.has(b.typeId)) return true;
  }
  return false;
}

export const nearForge = (p) => nearBlock(p, FORGE_BLOCKS);
export const nearAlchemy = (p) => nearBlock(p, ALCHEMY_BLOCKS);

const ENCHANTS = {
  weapon: [['sharpness', 'Filo'], ['smite', 'Castigo'], ['fire_aspect', 'Aspecto ígneo'], ['looting', 'Saqueo'], ['knockback', 'Empuje'], ['unbreaking', 'Irrompibilidad']],
  armor: [['protection', 'Protección'], ['fire_protection', 'Protección contra fuego'], ['projectile_protection', 'Protección contra proyectiles'], ['thorns', 'Espinas'], ['unbreaking', 'Irrompibilidad']],
  tool: [['efficiency', 'Eficiencia'], ['fortune', 'Fortuna'], ['unbreaking', 'Irrompibilidad'], ['silk_touch', 'Toque de seda']],
};

const SMELT = {
  'minecraft:raw_iron': 'minecraft:iron_ingot', 'minecraft:raw_gold': 'minecraft:gold_ingot', 'minecraft:raw_copper': 'minecraft:copper_ingot',
  'rpg:raw_mithril': 'rpg:mithril_ingot', 'rpg:raw_adamantite': 'rpg:adamantite_ingot',
};

function costMult(d) {
  return (d.race === 'enano' ? 0.5 : 1) * (1 - Math.min(0.4, (hobbyLevel(d, 'herreria') - 1) * 0.01));
}

export async function forgeMenu(player, fromNpc = false) {
  const d = getP(player);
  if (!d) return;
  if (!fromNpc && !nearForge(player)) return info(player, '§l§6Forja', '§7Necesitas estar junto a un §fyunque§7, §fmesa de herrería§7 o §falto horno§7 para usar la forja. (También puedes hablar con el herrero del Gremio).');
  const dwarf = d.race === 'enano';
  const item = heldItem(player);
  const body = `§7Objeto en mano: §f${item ? (item.nameTag ?? item.typeId.replace(/^.*:/, '').replace(/_/g, ' ')) : 'ninguno'}\n§7Herrería: Nv.${hobbyLevel(d, 'herreria')} · Coste x${costMult(d).toFixed(2)}\n${dwarf ? '§6Como enano/a, dominas la Forja Rúnica.' : '§7Solo los enanos pueden grabar runas.'}`;
  const list = [
    { text: 'Reparar objeto en mano', icon: 'textures/items/iron_ingot', fn: () => repair(player) },
    { text: 'Mejorar encantamiento', icon: 'textures/items/book_enchanted', fn: () => enchantMenu(player) },
    { text: dwarf ? 'Fundición enana (x2)' : 'Fundir minerales', icon: 'textures/items/raw_iron', fn: () => smelt(player) },
  ];
  if (dwarf) {
    list.push({ text: '§6§lGrabar runa', icon: 'textures/items/rpg_rune_stone', fn: () => runeMenu(player) });
    list.push({ text: '§6Forjar arma enana', icon: 'textures/items/rpg_dwarven_greataxe', fn: () => dwarfCraft(player) });
  } else if (fromNpc) {
    list.push({ text: '§6Comprar arma rúnica', icon: 'textures/items/rpg_runic_hammer', fn: () => buyRunic(player) });
  }
  list.push({ text: '§7Volver' });
  await buttons(player, '§l§6⚒ Forja', body.replace('enano/a', d.gender === 'f' ? 'enana' : 'enano'), list);
}

async function repair(player) {
  const d = getP(player);
  const item = heldItem(player);
  const dur = item?.getComponent('minecraft:durability');
  if (!dur || dur.damage <= 0) return info(player, '§lReparar', '§7Sostén en la mano un objeto dañado.');
  const ingots = Math.max(1, Math.ceil((dur.damage / dur.maxDurability) * 4 * costMult(d)));
  const gold = Math.ceil(dur.damage / 20 * costMult(d));
  const ok = await confirm(player, '§lReparar', `§fCoste: §7${ingots} lingote(s) de hierro y §6${gold} oro§f.\n¿Reparar?`);
  if (!ok) return;
  if (countItem(player, 'minecraft:iron_ingot') < ingots) return info(player, '§lReparar', '§cTe faltan lingotes de hierro.');
  if (!spendGold(player, gold)) return info(player, '§lReparar', '§cTe falta oro.');
  removeItem(player, 'minecraft:iron_ingot', ingots);
  dur.damage = 0;
  setHeldItem(player, item);
  addHobbyXp(player, 'herreria', 8);
  psound(player, 'random.anvil_use', 1, 1);
  msg(player, '§a⚒ Objeto reparado como nuevo.');
}

async function enchantMenu(player) {
  const d = getP(player);
  const item = heldItem(player);
  const slot = item && itemSlot(item.typeId);
  const ench = item?.getComponent('minecraft:enchantable');
  if (!slot || !ench) return info(player, '§lEncantar', '§7Sostén un arma, armadura o herramienta encantable.');
  const opts = ENCHANTS[slot].map(([id, name]) => {
    let cur = 0;
    let max = 1;
    try { cur = ench.getEnchantment(id)?.level ?? 0; } catch {}
    try { max = EnchantmentTypes.get(id)?.maxLevel ?? 1; } catch {}
    return { id, name, cur, max };
  }).filter((o) => o.cur < o.max);
  if (!opts.length) return info(player, '§lEncantar', '§7Este objeto ya tiene todos los encantamientos al máximo.');
  const sel = await buttons(player, '§l§5Mejorar encantamiento', '§7Cada nivel cuesta lapislázuli y oro.', [
    ...opts.map((o) => ({ text: `${o.name} ${o.cur} → ${o.cur + 1}\n§7${Math.ceil((o.cur + 1) * 4 * costMult(d))} lapislázuli · ${Math.ceil((o.cur + 1) * 30 * costMult(d))} oro` })),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= opts.length) return;
  const o = opts[sel];
  const lapis = Math.ceil((o.cur + 1) * 4 * costMult(d));
  const gold = Math.ceil((o.cur + 1) * 30 * costMult(d));
  if (countItem(player, 'minecraft:lapis_lazuli') < lapis) return info(player, '§lEncantar', '§cTe falta lapislázuli.');
  try {
    const type = EnchantmentTypes.get(o.id);
    if (!ench.canAddEnchantment({ type, level: o.cur + 1 }) && o.cur === 0) return info(player, '§lEncantar', '§cEse encantamiento no es compatible con los que ya tiene.');
    if (!spendGold(player, gold)) return info(player, '§lEncantar', '§cTe falta oro.');
    if (o.cur > 0) ench.removeEnchantment(o.id);
    ench.addEnchantment({ type, level: o.cur + 1 });
  } catch (e) {
    return info(player, '§lEncantar', '§cNo se pudo aplicar el encantamiento: ' + e);
  }
  removeItem(player, 'minecraft:lapis_lazuli', lapis);
  setHeldItem(player, item);
  addHobbyXp(player, 'herreria', 15 + o.cur * 5);
  psound(player, 'random.anvil_use', 1, 1.3);
  particle(player.dimension, 'minecraft:enchanting_table_particle', { ...player.location, y: player.location.y + 1 });
  msg(player, `§d✦ ${o.name} ${o.cur + 1} aplicado.`);
}

async function smelt(player) {
  const d = getP(player);
  const mult = d.race === 'enano' ? 2 : 1;
  let total = 0;
  for (const [raw, ingot] of Object.entries(SMELT)) {
    const n = countItem(player, raw);
    if (!n) continue;
    const coal = Math.ceil(n / 8);
    if (countItem(player, 'minecraft:coal') + countItem(player, 'minecraft:charcoal') < coal) {
      msg(player, `§cNecesitas ${coal} carbón para fundir ${n} ${raw.replace(/^.*:/, '')}.`);
      continue;
    }
    let left = coal;
    const c1 = Math.min(left, countItem(player, 'minecraft:coal'));
    removeItem(player, 'minecraft:coal', c1);
    left -= c1;
    if (left) removeItem(player, 'minecraft:charcoal', left);
    removeItem(player, raw, n);
    giveItem(player, ingot, n * mult);
    total += n;
  }
  if (!total) return info(player, '§lFundición', '§7No tienes minerales en bruto (hierro, oro, cobre, mitrilo, adamantita) o te falta carbón (1 por cada 8).');
  addHobbyXp(player, 'herreria', total * 1.5);
  psound(player, 'block.blastfurnace.fire_crackle', 1, 1);
  await info(player, '§lFundición', `§aHas fundido ${total} minerales${mult > 1 ? ' §6(¡el doble gracias a tu maestría enana!)' : ''}.`);
}

async function runeMenu(player) {
  const item = heldItem(player);
  const slot = item && itemSlot(item.typeId);
  if (!slot) return info(player, '§lRunas', '§7Sostén un arma, armadura o herramienta para grabarle una runa.');
  const existing = readRunes(item);
  if (existing.length >= 2) return info(player, '§lRunas', '§7Este objeto ya tiene el máximo de 2 runas.');
  const runes = Object.entries(RUNES).filter(([id, r]) => r.slot === slot && !existing.includes(id));
  const sel = await buttons(player, '§l§6ᚱ Grabar runa', `§7Runas disponibles para este objeto (${slot === 'weapon' ? 'arma' : slot === 'armor' ? 'armadura' : 'herramienta'}):`, [
    ...runes.map(([, r]) => ({ text: `${r.c}Runa ${r.name}\n§7${Object.entries(r.cost).map(([k, v]) => `${v} ${k.replace(/^.*:/, '').replace(/_/g, ' ')}`).join(', ')}` })),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= runes.length) return;
  const r = runes[sel][1];
  const ok = await confirm(player, `§l${r.c}Runa ${r.name}`, `§f${r.desc}\n\n§7Coste: ${Object.entries(r.cost).map(([k, v]) => `${v} ${k.replace(/^.*:/, '')}`).join(', ')}`);
  if (!ok) return;
  for (const [k, v] of Object.entries(r.cost)) if (countItem(player, k) < v) return info(player, '§lRunas', `§cTe falta: ${k.replace(/^.*:/, '')} (${countItem(player, k)}/${v})`);
  for (const [k, v] of Object.entries(r.cost)) removeItem(player, k, v);
  const lore = item.getLore();
  lore.push(`${RUNE_PREFIX}${r.c}Runa ${r.name}`);
  item.setLore(lore);
  setHeldItem(player, item);
  addHobbyXp(player, 'herreria', 40);
  psound(player, 'random.anvil_use', 1, 0.7);
  particle(player.dimension, 'minecraft:lava_particle', { ...player.location, y: player.location.y + 1 });
  msg(player, `§6ᚱ Has grabado la Runa ${r.name}. ${r.desc}`);
}

const DWARF_CRAFTS = [
  ['rpg:dwarven_greataxe', 'Gran Hacha Enana', { 'rpg:mithril_ingot': 4, 'minecraft:iron_block': 1, 'minecraft:stick': 2 }],
  ['rpg:runic_hammer', 'Martillo Rúnico', { 'rpg:adamantite_ingot': 3, 'rpg:rune_stone': 1, 'minecraft:stick': 2 }],
  ['rpg:mithril_sword', 'Espada de Mitrilo (x2)', { 'rpg:mithril_ingot': 2, 'minecraft:stick': 1 }, 2],
  ['rpg:rune_stone', 'Piedra Rúnica (x3)', { 'minecraft:stone': 8, 'rpg:mana_crystal_shard': 2 }, 3],
];

async function dwarfCraft(player) {
  const sel = await buttons(player, '§l§6Forja enana', '§7Recetas que solo un enano conoce:', [
    ...DWARF_CRAFTS.map(([, name, cost]) => ({ text: `${name}\n§7${Object.entries(cost).map(([k, v]) => `${v} ${k.replace(/^.*:/, '').replace(/_/g, ' ')}`).join(', ')}` })),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= DWARF_CRAFTS.length) return;
  const [id, name, cost, amount = 1] = DWARF_CRAFTS[sel];
  for (const [k, v] of Object.entries(cost)) if (countItem(player, k) < v) return info(player, '§lForja', `§cTe falta: ${k.replace(/^.*:/, '')} (${countItem(player, k)}/${v})`);
  for (const [k, v] of Object.entries(cost)) removeItem(player, k, v);
  giveItem(player, id, amount);
  addHobbyXp(player, 'herreria', 50);
  psound(player, 'random.anvil_use', 1, 0.9);
  msg(player, `§6⚒ Has forjado: ${name}.`);
}

async function buyRunic(player) {
  const offers = [
    ['minecraft:iron_sword', 'fuego', 220], ['minecraft:iron_sword', 'escarcha', 220], ['minecraft:diamond_sword', 'trueno', 650],
    ['minecraft:iron_chestplate', 'piedra', 300], ['minecraft:iron_boots', 'viento', 260], ['minecraft:iron_pickaxe', 'minero', 240],
  ];
  const sel = await buttons(player, '§l§6Armas rúnicas', '§7"No eres enano, pero tu oro vale igual."', [
    ...offers.map(([it, r, p]) => ({ text: `${it.replace(/^.*:/, '').replace(/_/g, ' ')} + ${RUNES[r].c}Runa ${RUNES[r].name}\n§6${p} oro` })),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= offers.length) return;
  const [it, r, p] = offers[sel];
  if (!spendGold(player, p)) return info(player, '§lHerrero', '§cNo tienes suficiente oro.');
  const stack = makeItem(it, 1, undefined, [`${RUNE_PREFIX}${RUNES[r].c}Runa ${RUNES[r].name}`]);
  if (stack) giveItem(player, stack);
  msg(player, '§6⚒ Compra realizada.');
}

/* ------------------------------------------------------------------ */
/* Alquimia                                                            */
/* ------------------------------------------------------------------ */

function have(player, k) {
  return k === '#flower' ? countWhere(player, (t) => FLOWERS.has(t)) : countItem(player, k);
}
function take(player, k, n) {
  return k === '#flower' ? removeWhere(player, (t) => FLOWERS.has(t), n) : removeItem(player, k, n);
}

export async function alchemyMenu(player) {
  const d = getP(player);
  if (!d) return;
  if (!nearAlchemy(player) && d.race !== 'elfo') return info(player, '§l§5Alquimia', '§7Necesitas un §fsoporte para pociones§7, §fcaldero§7 o §fmesa de encantamientos§7 cerca. (Los elfos pueden destilar en cualquier lugar).');
  const elf = d.race === 'elfo';
  const recipes = ELIXIRS.filter((e) => !e[4] || elf);
  const sel = await buttons(player, '§l§5⚗ Alquimia', `§7Alquimia Nv.${hobbyLevel(d, 'alquimia')}${elf ? '\n§aHerboristería élfica: produces el DOBLE de elixires.' : ''}`, [
    ...recipes.map(([, name, ing]) => ({ text: `${name}\n§7${Object.entries(ing).map(([k, v]) => `${v} ${k === '#flower' ? 'flores' : k.replace(/^.*:/, '').replace(/_/g, ' ')}`).join(', ')}` })),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= recipes.length) return;
  const [id, name, ing, out] = recipes[sel];
  for (const [k, v] of Object.entries(ing)) if (have(player, k) < v) return info(player, '§lAlquimia', `§cTe falta: ${k === '#flower' ? 'flores' : k.replace(/^.*:/, '')} (${have(player, k)}/${v})`);
  for (const [k, v] of Object.entries(ing)) take(player, k, v);
  let n = out * (elf ? 2 : 1);
  if (Math.random() < hobbyLevel(d, 'alquimia') * 0.01) n++;
  giveItem(player, id, n);
  addHobbyXp(player, 'alquimia', 12);
  psound(player, 'random.potion.brewed', 1, 1);
  particle(player.dimension, 'minecraft:witchspell_emitter', { ...player.location, y: player.location.y + 1 });
  msg(player, `§5⚗ Has destilado ${n} × ${name}.`);
  dirty(player);
  return alchemyMenu(player);
}
