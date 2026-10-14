// Nacimiento: cada jugador nuevo nace como niño/a en una familia de NPCs (con o sin hermanos),
// con raza, elemento mágico, talento, clase social de la familia y una habilidad inicial aleatorios.
// Incluye una cinemática de ~14 s: fundido desde negro, latidos, narración, cámara libre que recorre a la
// familia reunida junto a la cuna, el despertar de la magia con partículas del color del elemento y,
// por último, "¡Has nacido!". Los controles se bloquean durante la escena y SIEMPRE se restauran.
import { world, system, InputPermissionCategory, EasingType, MolangVariableMap } from '@minecraft/server';
import { getP, setP, wipePlayer, W, wDirty, dirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { maxMana, g, scalePct } from '../core/profile.js';
import { RACES, RACE_IDS, raceOf } from '../data/races.js';
import { ELEMENTS, ELEMENT_IDS, TALENTS, getSkill } from '../data/elements.js';
import { FIRST_NAMES, SURNAMES, ROLE_NAMES } from '../data/names.js';
import * as T from './town.js';
import * as B from './build.js';
import { makeIdentity, spawnNpc, NPC_TYPE } from './npc.js';
import { resetCaches, applyScale, hooks as passiveHooks } from './passives.js';
import { buttons, info } from '../util/ui.js';
import { weighted, pick, randInt, clamp } from '../util/math.js';
import { giveItem, makeItem, particle, psound, sleep, valid, getBlock, isSolid } from '../util/compat.js';
import { title, msg } from '../core/progression.js';

const pending = new Set();

export function isBorn(player) {
  return !!getP(player);
}

function rollElement(race) {
  return weighted(ELEMENT_IDS.map((e) => [e, ELEMENTS[e].weight * Math.pow(race.affinity[e] ?? 1, 2)]));
}

/** Clase social de la familia en la que naces. */
const BIRTH_CLASS = [['baja', 45], ['media', 42], ['alta', 13]];
const BIRTH_GOLD = { baja: 20, media: 30, alta: 60 };
const BIRTH_DESC = {
  baja: 'una familia humilde: tus padres trabajan de sol a sol y en casa nunca sobra nada',
  media: 'una familia de artesanos: honrada, trabajadora y respetada por los vecinos',
  alta: 'una familia acomodada: no os falta de nada y los vecinos os saludan con respeto',
};

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

function ensureTown(player) {
  try { if (typeof T.ensureTown === 'function') return T.ensureTown(player); } catch (e) { console.warn('[Aetheria] ensureTown: ' + e); }
  return false;
}

function houseSpot() {
  try { return T.nextHouseSpot?.(); } catch { return undefined; }
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
  const birthCls = weighted(BIRTH_CLASS);

  // Elegir género
  title(player, '§f§l...', '§7Una nueva vida comienza');
  await sleep(30);
  const sel = await buttons(player, '§l§6✦ Un nuevo nacimiento ✦', '§fLa luz de Aetheria te envuelve. Estás a punto de nacer.\n\n§7¿Cómo quieres nacer?', [
    { text: '§b§lNiño', icon: 'textures/items/egg' },
    { text: '§d§lNiña', icon: 'textures/items/egg' },
  ]);
  const gender = sel === 1 ? 'f' : sel === 0 ? 'm' : Math.random() < 0.5 ? 'm' : 'f';
  if (!player.isValid) return;

  // Casa familiar (con el estilo de la cultura de tu raza)
  let spot = keepHouse;
  let house;
  const dim = world.getDimension('overworld');
  for (let i = 0; i < 10 && !house; i++) {
    if (!spot && W().town) spot = houseSpot();
    if (spot) {
      try { house = B.buildHouse(dim, spot.x, spot.z, { culture: raceId }); } catch (e) { console.warn('[Aetheria] casa: ' + e); }
    }
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
    const ident = makeIdentity({ role, race: raceId, gender: gen, surname, age, owner: player.id, ownerName: player.name, cls: birthCls });
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
  const familyEntities = [];
  members.forEach((m, i) => {
    const e = spawnNpc(dim, npcPos[i % npcPos.length], m.ident);
    if (e) familyEntities.push({ e, m });
  });

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
    gold: BIRTH_GOLD[birthCls] ?? 30,
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
    social: { birth: birthCls, fame: {}, infamy: {}, deeds: [], trade: { lvl: 1, xp: 0, bought: 0, sold: 0, saved: 0 } },
  };
  d.mana = maxMana(d);
  setP(player, d);

  // Llegada a casa
  if (house) {
    try {
      player.teleport({ x: house.spawn.x + 0.5, y: house.spawn.y, z: house.spawn.z + 0.5 }, { dimension: dim });
      player.setSpawnPoint({ dimension: dim, x: house.spawn.x, y: house.spawn.y, z: house.spawn.z });
    } catch {}
    try {
      B.placeChest(dim, house.chest, [
        ['minecraft:bed', 1], ['minecraft:torch', 16], ['minecraft:bread', 8], ['minecraft:apple', 4], ['minecraft:wooden_sword', 1], ['minecraft:wooden_pickaxe', 1], ['minecraft:fishing_rod', 1],
      ], makeItem);
    } catch {}
  }

  const el = ELEMENTS[element];
  // Cinemática del nacimiento (12–15 s). Siempre restaura los controles al terminar.
  await sleep(10);
  if (player.isValid) {
    await birthCinematic(player, {
      dim, spawn: house?.spawn ?? { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) },
      family: familyEntities, race, el, elId: element, mother, father, gender,
    });
  }
  if (!player.isValid) return;

  giveItem(player, makeItem('rpg:journal', 1));
  giveItem(player, makeItem('rpg:grimoire', 1));
  giveItem(player, 'minecraft:bread', 4);

  const sk = getSkill(element, firstSkill);
  const tal = TALENTS[talentIdx];
  const fam = members.filter((m) => m.role.startsWith('herman')).map((m) => `${m.name} (${ROLE_NAMES[m.role].toLowerCase()} ${m.ident.age === 'child' ? 'menor' : 'mayor'})`);
  try { world.sendMessage(`§d✦ Ha nacido §f${player.name}§d, ${g(d, 'hijo', 'hija')} de la familia ${surname} (${race.name}). ¡Bienvenido/a a Aetheria!`.replace('Bienvenido/a', g(d, 'Bienvenido', 'Bienvenida'))); } catch {}

  const story =
    `§fNaciste en el seno de la familia §e${surname}§f, de raza ${race.c}${race.name}§f: ${BIRTH_DESC[birthCls]}.\n\n` +
    `§fTu padre es §e${father.name}§f y tu madre §e${mother.name}§f.\n` +
    (fam.length ? `§fTus hermanos: §e${fam.join(', ')}§f.\n\n` : '§fEres hijo/a único/a.\n\n'.replace('hijo/a único/a', g(d, 'hijo único', 'hija única'))) +
    `§fAl nacer, una luz te envolvió: tu afinidad mágica es ${el.c}§l${el.name}§r§f (${el.desc})\n` +
    `§fTalento mágico: ${tal.name}§f.\n` +
    `§fLos dioses te otorgaron la habilidad: ${el.c}§l${sk.name}§r§f.\n` +
    `§7${sk.desc}\n\n` +
    `§6Tu raza: §f${race.unique}\n\n` +
    `§7Eres ${g(d, 'un niño', 'una niña')}: ahora mides apenas un bloque. De adolescente rondarás el bloque y medio y de ${g(d, 'adulto', 'adulta')}, los dos bloques. Crecerás hasta la edad adulta en ${cfg('daysToAdult')} días de juego.\n` +
    `§7• Usa el §fDiario del Aventurero§7 para ver tu perfil, misiones, magia y familia.\n` +
    `§7• Usa el §fGrimorio§7 para lanzar hechizos (agáchate y úsalo para cambiar de hechizo).\n` +
    `§7• Habla con tu familia y con la gente: ¡puedes escribirles y te responderán!\n` +
    `§7• Tu clase social, tu fama y tus hazañas cambian cómo te trata la gente de cada reino.\n` +
    `§7• Cuando seas adolescente, inscríbete en el §1Gremio de Aventureros§7.`;
  await sleep(30);
  await info(player, '§l§6Tu historia comienza', story);
  msg(player, `§6✦ Bienvenido/a a Aetheria. §7Abre tu Diario (objeto) para empezar.`.replace('Bienvenido/a', g(d, 'Bienvenido', 'Bienvenida')));
}

/* ------------------------------------------------------------------ */
/* Cinemática                                                           */
/* ------------------------------------------------------------------ */

const active = new Map(); // pid -> estado
const EL_OF = {
  fuego: 'del fuego', agua: 'del agua', tierra: 'de la tierra', viento: 'del viento', rayo: 'del rayo', hielo: 'del hielo',
  luz: 'de la luz', oscuridad: 'de la oscuridad', necromancia: 'de la necromancia', naturaleza: 'de la naturaleza',
  arcano: 'de lo arcano', sangre: 'de la sangre',
};
const CAT_MOVE = InputPermissionCategory?.Movement ?? 2;
const CAT_CAM = InputPermissionCategory?.Camera ?? 1;
const EASE = EasingType?.InOutSine ?? 'InOutSine';

/** ¿Hay una cinemática de nacimiento en curso para este jugador? */
export function cinematicActive(player) {
  try { return active.has(player.id); } catch { return false; }
}

function setInput(player, on) {
  for (const c of [CAT_MOVE, CAT_CAM]) {
    try { player.inputPermissions.setPermissionCategory(c, on); } catch {}
  }
}

function narrate(player, t, sub = '', stay = 60) {
  try { player.onScreenDisplay.setTitle(t || '§r', { subtitle: sub, fadeInDuration: 8, stayDuration: stay, fadeOutDuration: 12 }); } catch {}
}

function fade(player, rgb, fadeIn, hold, fadeOut) {
  try {
    player.camera.fade({
      fadeColor: { red: rgb[0], green: rgb[1], blue: rgb[2] },
      fadeTime: { fadeInTime: clamp(fadeIn, 0, 10), holdTime: clamp(hold, 0, 10), fadeOutTime: clamp(fadeOut, 0, 10) },
    });
  } catch {}
}

function cam(player, location, facingLocation, easeTime) {
  const opts = { location, facingLocation };
  if (easeTime) opts.easeOptions = { easeTime, easeType: EASE };
  try { player.camera.setCamera('minecraft:free', opts); return true; } catch { return false; }
}

function setBlock(dim, loc, id) {
  try { dim.setBlockType(loc, id); return true; } catch {}
  try { dim.runCommand(`setblock ${loc.x} ${loc.y} ${loc.z} ${id.replace('minecraft:', '')}`); return true; } catch { return false; }
}

function isAirAt(dim, loc) {
  const b = getBlock(dim, loc);
  if (!b) return false;
  try { return b.isAir || !isSolid(b); } catch { return false; }
}

/** Busca un hueco junto al punto de aparición y coloca una cuna sencilla (colchón y barandillas). */
export function placeCrib(dim, spawn) {
  const y = Math.floor(spawn.y);
  const offs = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [-1, 0], [1, 0], [0, 1], [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];
  let best;
  for (const [dx, dz] of offs) {
    const x = Math.floor(spawn.x) + dx;
    const z = Math.floor(spawn.z) + dz;
    const floor = getBlock(dim, { x, y: y - 1, z });
    if (!floor || !isSolid(floor)) continue;
    if (!isAirAt(dim, { x, y, z }) || !isAirAt(dim, { x, y: y + 1, z })) continue;
    let walls = 0;
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isSolid(getBlock(dim, { x: x + ax, y, z: z + az }))) walls++;
    const score = walls >= 3 ? 0 : walls;
    if (!best || score > best.score) best = { x, y, z, score };
  }
  const cell = best ?? { x: Math.floor(spawn.x), y, z: Math.floor(spawn.z) };
  const placed = [];
  setBlock(dim, cell, 'minecraft:white_carpet');
  placed.push({ ...cell, id: 'minecraft:white_carpet' });
  // Barandillas en los lados libres que no miran al centro de la casa (máximo 2).
  const toSpawn = [Math.sign(Math.floor(spawn.x) - cell.x), Math.sign(Math.floor(spawn.z) - cell.z)];
  let rails = 0;
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (rails >= 2) break;
    if ((ax !== 0 && ax === toSpawn[0]) || (az !== 0 && az === toSpawn[1])) continue;
    const r = { x: cell.x + ax, y, z: cell.z + az };
    if (!isAirAt(dim, r) || !isAirAt(dim, { x: r.x, y: y + 1, z: r.z })) continue;
    const fl = getBlock(dim, { x: r.x, y: y - 1, z: r.z });
    if (!fl || !isSolid(fl)) continue;
    if (setBlock(dim, r, 'minecraft:oak_fence')) { placed.push({ ...r, id: 'minecraft:oak_fence' }); rails++; }
  }
  return { cell, placed, center: { x: cell.x + 0.5, y: cell.y + 0.15, z: cell.z + 0.5 }, toSpawn };
}

/** Punto de cámara seguro: avanza de `from` hacia `to` sin atravesar bloques sólidos. */
function safePoint(dim, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  let last = from;
  for (let t = 0.25; t <= len; t += 0.25) {
    const p = { x: from.x + (dx / len) * t, y: from.y + (dy / len) * t, z: from.z + (dz / len) * t };
    const b = getBlock(dim, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
    if (b && isSolid(b)) break;
    last = p;
  }
  const back = Math.min(0.3, Math.hypot(last.x - from.x, last.y - from.y, last.z - from.z));
  return { x: last.x - (dx / len) * back, y: last.y - (dy / len) * back, z: last.z - (dz / len) * back };
}

function orbit(c, ang, r, h) {
  return { x: c.x + Math.cos(ang) * r, y: c.y + h, z: c.z + Math.sin(ang) * r };
}

/** Coloca a la familia alrededor de la cuna mirando al bebé (quieta durante la escena). */
function gatherFamily(dim, crib, family) {
  const spots = [];
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, 1], [2, -1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
    const x = crib.cell.x + dx;
    const z = crib.cell.z + dz;
    const y = crib.cell.y;
    if (crib.placed.some((p) => p.x === x && p.z === z)) continue;
    if (!isAirAt(dim, { x, y, z }) || !isAirAt(dim, { x, y: y + 1, z })) continue;
    const fl = getBlock(dim, { x, y: y - 1, z });
    if (!fl || !isSolid(fl)) continue;
    spots.push({ x: x + 0.5, y, z: z + 0.5 });
  }
  family.forEach(({ e }, i) => {
    if (!valid(e)) return;
    try { e.addTag('rpg_busy'); e.addTag('rpg_cinematic_npc'); } catch {}
    const at = spots[i % Math.max(1, spots.length)] ?? { x: crib.center.x + (i % 2 ? 1.2 : -1.2), y: crib.cell.y, z: crib.center.z + 1 };
    try { e.teleport(at, { facingLocation: crib.center }); } catch { try { e.teleport(at); } catch {} }
    try { e.triggerEvent('rpg:act_sleep'); } catch {}
    try { e.setProperty('rpg:mood', 1); } catch {}
    try { e.lookAt(crib.center); } catch {}
  });
}

function releaseFamily(family) {
  for (const { e } of family ?? []) {
    if (!valid(e)) continue;
    try { e.removeTag('rpg_busy'); e.removeTag('rpg_cinematic_npc'); } catch {}
    try { e.triggerEvent('rpg:act_idle'); } catch {}
    try { e.setDynamicProperty('rpg:act', ''); } catch {}
    try { e.setProperty('rpg:mood', 0); } catch {}
  }
}

function swirl(dim, c, rgb, ticks) {
  let t = 0;
  let id;
  const m = (() => {
    try {
      const mv = new MolangVariableMap();
      mv.setColorRGB('variable.color', { red: rgb[0], green: rgb[1], blue: rgb[2] });
      return mv;
    } catch { return undefined; }
  })();
  id = system.runInterval(() => {
    try {
      t += 2;
      const k = t / ticks;
      for (let i = 0; i < 3; i++) {
        const a = t * 0.35 + (i * Math.PI * 2) / 3;
        const r = 1.3 * (1 - k) + 0.25;
        const p = { x: c.x + Math.cos(a) * r, y: c.y + 0.2 + k * 1.6, z: c.z + Math.sin(a) * r };
        try { if (m) dim.spawnParticle('rpg:birth', p, m); else dim.spawnParticle('rpg:birth', p); } catch {}
      }
      if (t >= ticks) system.clearRun(id);
    } catch { try { system.clearRun(id); } catch {} }
  }, 2);
  return id;
}

/**
 * Cinemática del nacimiento. info = { dim, spawn, family:[{e,m}], race, el, mother, father, gender }.
 * Bloquea movimiento y cámara, y SIEMPRE los restaura (finally + temporizador de seguridad).
 */
export async function birthCinematic(player, info) {
  if (active.has(player.id)) return;
  const d = getP(player);
  const st = { family: info.family ?? [], timers: [], done: false };
  active.set(player.id, st);
  st.safety = system.runTimeout(() => restoreCinematic(player, st), 20 * 40);
  try {
    if (d) {
      d.cine = { hud: d.hud ?? null };
      d.hud = false;
      dirty(player);
    }
    try { player.addTag('rpg_cinematic'); } catch {}
    setInput(player, false);
    fade(player, [0, 0, 0], 0.3, 4.2, 2.0);
    const dim = info.dim ?? player.dimension;
    const crib = placeCrib(dim, info.spawn);
    st.crib = crib;
    const c = crib.center;
    const head = { x: c.x, y: c.y + 0.35, z: c.z };
    // Hacia dónde mira la escena: del rincón de la cuna al centro de la casa.
    let base = Math.atan2(crib.toSpawn[1] || 1, crib.toSpawn[0] || 0);
    // El bebé, diminuto, en la cuna.
    try { player.teleport({ x: c.x, y: crib.cell.y, z: c.z }, { dimension: dim, facingLocation: orbit(c, base, 2, 0.8) }); } catch {}
    try { player.triggerEvent('rpg:scale_' + scalePct(0.42 * (info.race?.scale ?? 1))); } catch {}
    gatherFamily(dim, crib, st.family);
    narrate(player, '§f…', '', 50);
    for (let i = 0; i < 3; i++) st.timers.push(system.runTimeout(() => psound(player, 'mob.warden.heartbeat', 0.7, 1.15), 6 + i * 16));
    await sleep(34);
    if (!valid(player)) return;
    narrate(player, '§7· · ·', '§8Oscuridad. Calor. Un latido... y otro más.', 50);
    psound(player, 'ambient.cave', 0.4, 1.6);
    // Plano inicial (aún en negro): abierto y alto.
    cam(player, safePoint(dim, head, orbit(c, base, 3.2, 2.3)), head);
    await sleep(36);
    if (!valid(player)) return;
    narrate(player, '§r', '§fUn llanto rompe el silencio…', 60);
    psound(player, 'mob.villager.idle', 0.8, 1.9);
    st.timers.push(system.runTimeout(() => psound(player, 'mob.allay.idle', 0.7, 1.6), 14));
    // Paneo lento alrededor de la familia.
    cam(player, safePoint(dim, head, orbit(c, base + 1.0, 2.6, 1.5)), head, 5);
    for (const { e } of st.family) {
      st.timers.push(system.runTimeout(() => {
        try { if (valid(e)) particle(e.dimension, 'minecraft:heart_particle', { x: e.location.x, y: e.location.y + 2.1, z: e.location.z }); } catch {}
      }, 20 + Math.floor(Math.random() * 40)));
    }
    await sleep(46);
    if (!valid(player)) return;
    const mom = info.mother?.name ?? 'Tu madre';
    const dad = info.father?.name ?? 'tu padre';
    narrate(player, `§e${mom} §7y §e${dad}`, '§7te contemplan con lágrimas en los ojos', 70);
    psound(player, 'note.chime', 0.5, 1.2);
    await sleep(54);
    if (!valid(player)) return;
    const sibs = st.family.filter(({ m }) => m?.role?.startsWith('herman'));
    cam(player, safePoint(dim, head, orbit(c, base - 1.0, 2.2, 1.3)), head, 3);
    narrate(player, '§r', sibs.length ? `§7${sibs.length > 1 ? 'Tus hermanos se asoman' : (sibs[0].m.role === 'hermana' ? 'Tu hermana se asoma' : 'Tu hermano se asoma')} a la cuna con curiosidad…` : '§7Toda la casa contiene el aliento…', 60);
    await sleep(48);
    if (!valid(player)) return;
    // El despertar de la magia.
    const el = info.el ?? ELEMENTS.fuego;
    cam(player, safePoint(dim, head, { x: c.x + Math.cos(base) * 0.4, y: c.y + 2.2, z: c.z + Math.sin(base) * 0.4 }), head, 2.5);
    narrate(player, '§r', '§7Algo despierta en tu interior…', 50);
    psound(player, 'beacon.activate', 0.8, 1.3);
    st.swirl = swirl(dim, c, el.rgb ?? [1, 1, 1], 70);
    await sleep(40);
    if (!valid(player)) return;
    narrate(player, '§r', `${el.c}La magia ${EL_OF[info.elId] ?? 'de ' + el.name.toLowerCase()} fluye por tus venas`, 50);
    psound(player, 'random.levelup', 0.7, 0.6);
    await sleep(34);
    if (!valid(player)) return;
    fade(player, [1, 1, 1], 0.4, 0.5, 1.3);
    await sleep(12);
    try { particle(dim, 'rpg:burst', head, el.rgb); } catch {}
    try { particle(dim, 'minecraft:totem_particle', head); } catch {}
    try { player.camera.clear(); } catch {}
    narrate(player, '§6§l¡Has nacido!', `${info.race?.c ?? '§f'}${info.race?.name ?? ''} §f· ${el.c}${el.name}`, 70);
    psound(player, 'random.totem', 0.5, 1.4);
  } catch (e) {
    console.warn('[Aetheria] Cinemática del nacimiento: ' + e + (e?.stack ? '\n' + e.stack : ''));
  } finally {
    restoreCinematic(player, st);
  }
}

/** Devuelve el control al jugador y suelta a la familia (idempotente). */
function restoreCinematic(player, st) {
  if (st.done) return;
  st.done = true;
  try { system.clearRun(st.safety); } catch {}
  for (const t of st.timers ?? []) try { system.clearRun(t); } catch {}
  if (st.swirl) try { system.clearRun(st.swirl); } catch {}
  releaseFamily(st.family);
  try { active.delete(player.id); } catch {}
  recoverCinematic(player);
}

/** Restaura cámara, controles, HUD y tamaño (también si el jugador salió a mitad de la escena). */
export function recoverCinematic(player) {
  try { player.camera.clear(); } catch {}
  setInput(player, true);
  try { player.removeTag('rpg_cinematic'); } catch {}
  let d;
  try { d = getP(player); } catch {}
  if (d?.cine) {
    if (d.cine.hud === null || d.cine.hud === undefined) delete d.hud;
    else d.hud = d.cine.hud;
    delete d.cine;
    try { dirty(player); } catch {}
  }
  try { resetCaches(player); } catch {}
  if (d) try { applyScale(player, d, true); } catch {}
}

passiveHooks.cinematicActive = cinematicActive;
passiveHooks.recoverCinematic = recoverCinematic;

/* ------------------------------------------------------------------ */
/* Renacer y mantenimiento de la familia                                */
/* ------------------------------------------------------------------ */

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
