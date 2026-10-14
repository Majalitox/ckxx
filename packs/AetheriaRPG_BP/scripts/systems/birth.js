// Nacimiento: cada jugador nuevo nace como niño/a en una familia de NPCs (con o sin hermanos),
// con raza, elemento mágico, talento y una habilidad inicial aleatorios.
import { world, system } from '@minecraft/server';
import { getP, setP, wipePlayer, W, wDirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { maxMana, g } from '../core/profile.js';
import { RACES, RACE_IDS, raceOf } from '../data/races.js';
import { ELEMENTS, ELEMENT_IDS, TALENTS, getSkill } from '../data/elements.js';
import { FIRST_NAMES, SURNAMES, ROLE_NAMES } from '../data/names.js';
import { ensureTown, nextHouseSpot } from './town.js';
import { buildHouse, placeChest } from './build.js';
import { makeIdentity, spawnNpc, NPC_TYPE } from './npc.js';
import { buttons, info } from '../util/ui.js';
import { weighted, pick, randInt } from '../util/math.js';
import { giveItem, makeItem, particle, psound, sleep } from '../util/compat.js';
import { title, msg } from '../core/progression.js';

const pending = new Set();

export function isBorn(player) {
  return !!getP(player);
}

function rollElement(race) {
  return weighted(ELEMENT_IDS.map((e) => [e, ELEMENTS[e].weight * Math.pow(race.affinity[e] ?? 1, 2)]));
}

/** Comienza el nacimiento (una sola vez por jugador). */
export async function beginBirth(player, keepHouse) {
  if (pending.has(player.id) || getP(player)) return;
  pending.add(player.id);
  try {
    await birth(player, keepHouse);
  } catch (e) {
    console.warn('[Aetheria] Error en el nacimiento: ' + e + (e?.stack ? '\n' + e.stack : ''));
  } finally {
    pending.delete(player.id);
  }
}

async function birth(player, keepHouse) {
  // Esperar a que el mundo alrededor esté cargado
  for (let i = 0; i < 20 && !ensureTown(player); i++) await sleep(20);
  const raceId = weighted(RACE_IDS.map((r) => [r, RACES[r].weight]));
  const race = RACES[raceId];
  const element = rollElement(race);
  const talentIdx = weighted(TALENTS.map((t, i) => [i, t.weight]));
  const siblings = weighted([[0, 30], [1, 35], [2, 25], [3, 10]]);
  const surname = pick(SURNAMES[raceId] ?? SURNAMES.humano);
  const firstSkill = randInt(0, 9);

  // Elegir género
  title(player, '§f§l...', '§7Una nueva vida comienza');
  await sleep(30);
  const sel = await buttons(player, '§l§6✦ Un nuevo nacimiento ✦', '§fLa luz de Aetheria te envuelve. Estás a punto de nacer.\n\n§7¿Cómo quieres nacer?', [
    { text: '§b§lNiño', icon: 'textures/items/egg' },
    { text: '§d§lNiña', icon: 'textures/items/egg' },
  ]);
  const gender = sel === 1 ? 'f' : sel === 0 ? 'm' : Math.random() < 0.5 ? 'm' : 'f';
  if (!player.isValid) return;

  // Casa familiar
  let spot = keepHouse;
  let house;
  const dim = world.getDimension('overworld');
  for (let i = 0; i < 10 && !house; i++) {
    if (!spot && W().town) spot = nextHouseSpot();
    if (spot) house = buildHouse(dim, spot.x, spot.z);
    if (!house) {
      await sleep(20);
      if (i === 6) spot = { x: Math.floor(player.location.x) + 8, z: Math.floor(player.location.z) + 8 };
    }
  }
  const houseInfo = house ? { x: house.spawn.x, y: house.spawn.y, z: house.spawn.z, dim: 'overworld', cx: spot.x, cz: spot.z } : { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z), dim: player.dimension.id, cx: Math.floor(player.location.x), cz: Math.floor(player.location.z) };
  W().houses.push({ owner: player.id, name: player.name, ...houseInfo });
  wDirty();

  // Familia
  const members = [];
  const mk = (role, gen, age) => {
    const ident = makeIdentity({ role, race: raceId, gender: gen, surname, age, owner: player.id, ownerName: player.name });
    members.push({ id: ident.id, role, name: ident.name, dead: false, ident });
    return ident;
  };
  const father = mk('padre', 'm', 'adult');
  const mother = mk('madre', 'f', 'adult');
  for (let i = 0; i < siblings; i++) {
    const sg = Math.random() < 0.5 ? 'm' : 'f';
    mk(sg === 'm' ? 'hermano' : 'hermana', sg, Math.random() < 0.5 ? 'child' : 'adult');
  }
  const npcPos = house?.npc ?? [player.location];
  members.forEach((m, i) => spawnNpc(dim, npcPos[i % npcPos.length], m.ident));

  // Datos del personaje
  const d = {
    v: 1,
    id: player.id,
    name: player.name,
    gender,
    race: raceId,
    element,
    element2: null,
    talent: talentIdx,
    learned: [firstSkill],
    learned2: [],
    slots: ['r', 'p:' + firstSkill],
    slotSel: 1,
    level: 1,
    xp: 0,
    sp: 1,
    statPts: 0,
    stats: { str: 0, vit: 0, agi: 0, int: 0 },
    mana: 0,
    magicXp: 0,
    gold: 30,
    karma: 0,
    guild: { member: false, rank: 0, points: 0 },
    shadow: { member: false, rank: 0, points: 0 },
    hobbies: {},
    quests: {},
    family: { house: houseInfo, members, surname },
    rel: {},
    inbox: [],
    explore: { dist: 0, acc: 0, regions: [] },
    stats2: {},
    ageTicks: 0,
    born: world.getDay(),
  };
  d.mana = maxMana(d);
  setP(player, d);

  // Llegada a casa
  if (house) {
    try {
      player.teleport({ x: house.spawn.x + 0.5, y: house.spawn.y, z: house.spawn.z + 0.5 }, { dimension: dim });
      player.setSpawnPoint({ dimension: dim, x: house.spawn.x, y: house.spawn.y, z: house.spawn.z });
    } catch {}
    placeChest(dim, house.chest, [
      ['minecraft:bed', 1], ['minecraft:torch', 16], ['minecraft:bread', 8], ['minecraft:apple', 4], ['minecraft:wooden_sword', 1], ['minecraft:wooden_pickaxe', 1], ['minecraft:fishing_rod', 1],
    ], makeItem);
  }
  giveItem(player, makeItem('rpg:journal', 1));
  giveItem(player, makeItem('rpg:grimoire', 1));
  giveItem(player, 'minecraft:bread', 4);

  const el = ELEMENTS[element];
  const sk = getSkill(element, firstSkill);
  const tal = TALENTS[talentIdx];
  const fam = members.filter((m) => m.role.startsWith('herman')).map((m) => `${m.name} (${ROLE_NAMES[m.role].toLowerCase()} ${m.ident.age === 'child' ? 'menor' : 'mayor'})`);
  particle(player.dimension, 'minecraft:totem_particle', player.location);
  psound(player, 'random.levelup', 1, 0.6);
  title(player, `§6§l¡Has nacido!`, `${race.c}${race.name} §f· ${el.c}${el.name}`);
  try { world.sendMessage(`§d✦ Ha nacido §f${player.name}§d, ${g(d, 'hijo', 'hija')} de la familia ${surname} (${race.name}). ¡Bienvenido/a a Aetheria!`.replace('Bienvenido/a', g(d, 'Bienvenido', 'Bienvenida'))); } catch {}

  const story =
    `§fNaciste en el seno de la familia §e${surname}§f, de raza ${race.c}${race.name}§f.\n\n` +
    `§fTu padre es §e${father.name}§f y tu madre §e${mother.name}§f.\n` +
    (fam.length ? `§fTus hermanos: §e${fam.join(', ')}§f.\n\n` : '§fEres hijo/a único/a.\n\n'.replace('hijo/a único/a', g(d, 'hijo único', 'hija única'))) +
    `§fAl nacer, una luz te envolvió: tu afinidad mágica es ${el.c}§l${el.name}§r§f (${el.desc})\n` +
    `§fTalento mágico: ${tal.name}§f.\n` +
    `§fLos dioses te otorgaron la habilidad: ${el.c}§l${sk.name}§r§f.\n` +
    `§7${sk.desc}\n\n` +
    `§6Tu raza: §f${race.unique}\n\n` +
    `§7Eres ${g(d, 'un niño', 'una niña')}. Crecerás hasta la edad adulta en ${cfg('daysToAdult')} días de juego.\n` +
    `§7• Usa el §fDiario del Aventurero§7 para ver tu perfil, misiones, magia y familia.\n` +
    `§7• Usa el §fGrimorio§7 para lanzar hechizos (agáchate y úsalo para cambiar de hechizo).\n` +
    `§7• Habla con tu familia y con la gente: ¡puedes escribirles y te responderán!\n` +
    `§7• Cuando seas adolescente, inscríbete en el §1Gremio de Aventureros§7.`;
  await sleep(40);
  await info(player, '§l§6Tu historia comienza', story);
  msg(player, `§6✦ Bienvenido/a a Aetheria. §7Abre tu Diario (objeto) para empezar.`.replace('Bienvenido/a', g(d, 'Bienvenido', 'Bienvenida')));
}

/** Renacer: borra el personaje y la familia y vuelve a nacer en la misma casa. */
export function rebirth(player) {
  const d = getP(player);
  const keep = d?.family?.house ? { x: d.family.house.cx ?? d.family.house.x, z: d.family.house.cz ?? d.family.house.z } : undefined;
  if (d) {
    for (const m of d.family?.members ?? []) {
      for (const dimId of ['overworld', 'nether', 'the_end']) {
        try { for (const e of world.getDimension(dimId).getEntities({ type: NPC_TYPE, tags: ['rpg_fid_' + m.id] })) e.remove(); } catch {}
      }
    }
    const w = W();
    w.houses = w.houses.filter((h) => h.owner !== player.id);
    wDirty();
  }
  wipePlayer(player);
  try { player.triggerEvent('rpg:scale_100'); } catch {}
  system.runTimeout(() => beginBirth(player, keep), 20);
}

/** Restaura NPCs familiares que falten (p. ej. tras un error). Se llama al acercarse a casa. */
export function familyUpkeep(player) {
  const d = getP(player);
  const h = d?.family?.house;
  if (!h || player.dimension.id !== 'minecraft:overworld') return;
  const dx = player.location.x - h.x;
  const dz = player.location.z - h.z;
  if (dx * dx + dz * dz > 30 * 30) return;
  const dim = player.dimension;
  for (const m of d.family.members) {
    if (m.dead || !m.ident) continue;
    let found = [];
    try { found = dim.getEntities({ type: NPC_TYPE, tags: ['rpg_fid_' + m.id] }); } catch { continue; }
    if (found.length) {
      m.miss = 0;
      continue;
    }
    m.miss = (m.miss ?? 0) + 1;
    if (m.miss >= 3) {
      m.miss = 0;
      spawnNpc(dim, { x: h.x + 0.5, y: h.y, z: h.z + 0.5 }, m.ident);
    }
  }
}
