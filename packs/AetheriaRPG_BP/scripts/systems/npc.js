// NPCs: identidad, aparición, menú de interacción, conversación escrita, relaciones, regalos y cartas.
import { world, system } from '@minecraft/server';
import { getP, dirty, W, wDirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addXp, addGold, addKarma, msg, title, spendGold } from '../core/progression.js';
import { stageOf, isVillain, karmaTitle, g } from '../core/profile.js';
import { RACES, RACE_IDS, raceOf } from '../data/races.js';
import { FIRST_NAMES, SURNAMES, ROLE_NAMES, PERSONALITIES } from '../data/names.js';
import { GIFT_PREFS, RACE_GIFT_LOVE, LETTERS, ROLE_RESPONSES } from '../data/dialogue.js';
import { reply, opening, moodOf, isFamilyRole, vars, genderize } from './chat.js';
import { buttons, ask, confirm, info, guarded } from '../util/ui.js';
import { pick, weighted, randInt, dist, hash, seeded } from '../util/math.js';
import { fill, hearts, truncate } from '../util/text.js';
import { heldItem, setHeldItem, giveItem, particle, psound, valid, effect, heal } from '../util/compat.js';

export const NPC_TYPE = 'rpg:npc';
const STAFF_ROLES = new Set(['recepcionista', 'maestro', 'mercader', 'herrero', 'sacerdotisa', 'sombra']);

// Funciones de otros sistemas que se inyectan para evitar dependencias circulares.
export const hooks = {
  guildDesk: undefined, // (player, entity) => Promise
  guildMaster: undefined,
  shop: undefined,
  forge: undefined,
  shadow: undefined,
  familyQuest: undefined, // (player, ident) => Promise
  deliver: undefined, // (player, role) => boolean
  questProgress: undefined, // (player, type, key, n)
};

/* ------------------------------------------------------------------ */
/* Identidad                                                           */
/* ------------------------------------------------------------------ */

export function identOf(entity) {
  try {
    const raw = entity.getDynamicProperty('rpg:npc');
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function saveIdent(entity, ident) {
  try { entity.setDynamicProperty('rpg:npc', JSON.stringify(ident)); } catch {}
}

export function randomRace(rng = Math.random) {
  return weighted(RACE_IDS.map((r) => [r, RACES[r].weight]), rng);
}

export function makeIdentity(opts = {}) {
  const race = opts.race ?? randomRace();
  const gender = opts.gender ?? (Math.random() < 0.5 ? 'm' : 'f');
  const names = FIRST_NAMES[race] ?? FIRST_NAMES.humano;
  const w = W();
  w.npcCount = (w.npcCount ?? 0) + 1;
  wDirty();
  return {
    id: 'n' + w.npcCount.toString(36) + Math.floor(Math.random() * 1296).toString(36),
    name: opts.name ?? pick(names[gender]),
    surname: opts.surname ?? pick(SURNAMES[race] ?? SURNAMES.humano),
    gender,
    race,
    role: opts.role ?? 'aldeano',
    pers: opts.pers ?? pick(PERSONALITIES),
    age: opts.age ?? 'adult',
    owner: opts.owner,
    ownerName: opts.ownerName,
  };
}

function skinFor(ident) {
  const base = raceOf(ident.race).skinBase;
  const h = hash(ident.id) % 2;
  return base + (ident.gender === 'f' ? 2 : 0) + h;
}

function npcScale(ident) {
  const s = raceOf(ident.race).scale * (ident.age === 'child' ? 0.6 : 1);
  return Math.max(30, Math.min(130, Math.round((s * 100) / 5) * 5));
}

export function nameTagOf(ident) {
  const race = raceOf(ident.race);
  let roleLabel = ROLE_NAMES[ident.role] ?? ident.role;
  if (isFamilyRole(ident.role) && ident.ownerName) roleLabel += ' de ' + ident.ownerName;
  if (ident.spouseOf) roleLabel = 'Pareja de ' + ident.spouseOf;
  return `§e${ident.name}\n§7${roleLabel} · ${race.c}${race.name}`;
}

/** Aplica el aspecto (piel, geometría, tamaño) a la entidad. */
export function applyLook(entity, ident) {
  try { entity.setProperty('rpg:skin', skinFor(ident)); } catch {}
  try { entity.setProperty('rpg:geo', raceOf(ident.race).geo); } catch {}
  try { entity.triggerEvent('rpg:scale_' + npcScale(ident)); } catch {}
  try { entity.nameTag = nameTagOf(ident); } catch {}
}

export function spawnNpc(dim, loc, ident, persistent = true) {
  let e;
  const kind = STAFF_ROLES.has(ident.role) ? 'staff' : 'resident';
  let withEvent = persistent;
  try {
    // El evento de aparición fija su "hogar" (radio de paseo) en el punto exacto de aparición.
    e = dim.spawnEntity(persistent ? `${NPC_TYPE}<rpg:spawn_${kind}>` : NPC_TYPE, loc);
  } catch {
    withEvent = false;
    try {
      e = dim.spawnEntity(NPC_TYPE, loc);
    } catch (err) {
      console.warn('[Aetheria] No se pudo crear NPC: ' + err);
      return undefined;
    }
  }
  saveIdent(e, ident);
  try { e.addTag('rpg_npc'); e.addTag('rpg_fid_' + ident.id); e.addTag('rpg_role_' + ident.role); } catch {}
  system.runTimeout(() => {
    if (!valid(e)) return;
    if (persistent && !withEvent) try { e.triggerEvent(`rpg:make_${kind}`); } catch {}
    applyLook(e, ident);
  }, 2);
  return e;
}

/** NPCs que aparecen de forma natural (aventureros errantes) reciben identidad al cargar. */
export function ensureIdentity(entity) {
  if (identOf(entity)) return;
  const role = weighted([['aventurero', 6], ['aldeano', 3], ['bardo', 1]]);
  const ident = makeIdentity({ role });
  saveIdent(entity, ident);
  try { entity.addTag('rpg_npc'); entity.addTag('rpg_fid_' + ident.id); entity.addTag('rpg_role_' + ident.role); } catch {}
  applyLook(entity, ident);
}

/* ------------------------------------------------------------------ */
/* Relaciones                                                          */
/* ------------------------------------------------------------------ */

export function relOf(d, ident) {
  d.rel = d.rel ?? {};
  let r = d.rel[ident.id];
  if (!r) {
    const fam = ident.owner === d.id && isFamilyRole(ident.role);
    r = d.rel[ident.id] = { n: ident.name, r: ident.role, p: fam ? (ident.role === 'madre' || ident.role === 'padre' ? 350 : 220) : 0, t: 0, race: ident.race, pers: ident.pers, g: ident.gender, fam };
    pruneRel(d);
  }
  r.n = ident.name;
  r.r = ident.role;
  return r;
}

function pruneRel(d) {
  const keys = Object.keys(d.rel);
  if (keys.length <= 120) return;
  keys.sort((a, b) => Math.abs(d.rel[a].p) - Math.abs(d.rel[b].p));
  for (const k of keys.slice(0, keys.length - 120)) if (!d.rel[k].fam && !d.rel[k].partner) delete d.rel[k];
}

export function relTier(rel) {
  const p = rel.p ?? 0;
  if (rel.partner) return { name: 'Pareja', c: '§d' };
  if (p < -100) return { name: 'Enemigo', c: '§4' };
  if (p < -20) return { name: 'Hostil', c: '§c' };
  if (p < 20) return { name: 'Desconocido', c: '§7' };
  if (p < 80) return { name: 'Conocido', c: '§f' };
  if (p < 200) return { name: 'Amigo', c: '§a' };
  if (p < 400) return { name: 'Buen amigo', c: '§2' };
  if (p < 700) return { name: 'Mejor amigo', c: '§b' };
  return { name: 'Inseparables', c: '§d' };
}

/** Cambia la relación con límite diario de ganancia por conversación. */
export function changeRel(player, d, rel, delta, fromChat = false) {
  const today = world.getDay();
  if (fromChat && delta > 0) {
    if (rel.cgd !== today) { rel.cgd = today; rel.cg = 0; }
    const room = Math.max(0, 15 - (rel.cg ?? 0));
    delta = Math.min(delta, room);
    rel.cg = (rel.cg ?? 0) + delta;
  }
  if (delta > 0 && isVillain(d) && !rel.fam && rel.r !== 'sombra') delta = Math.max(1, Math.floor(delta * 0.5));
  const before = relTier(rel).name;
  rel.p = Math.max(-300, Math.min(1000, (rel.p ?? 0) + delta));
  const after = relTier(rel);
  if (after.name !== before) msg(player, `§d♥ Tu relación con ${rel.n} ahora es: ${after.c}${after.name}`);
  dirty(player);
  return delta;
}

/* ------------------------------------------------------------------ */
/* Interacción                                                         */
/* ------------------------------------------------------------------ */

function relLine(rel) {
  const t = relTier(rel);
  return `${t.c}${t.name} §7(${Math.round(rel.p)}) ${hearts(Math.max(0, rel.p))}`;
}

export function openNpc(player, entity) {
  guarded(player, () => npcMenu(player, entity));
}

async function npcMenu(player, entity) {
  const d = getP(player);
  if (!d) return;
  let ident = identOf(entity);
  if (!ident) {
    ensureIdentity(entity);
    ident = identOf(entity);
    if (!ident) return;
  }
  const rel = relOf(d, ident);
  const today = world.getDay();
  if (rel.last !== today) {
    rel.last = today;
    changeRel(player, d, rel, 3);
    hooks.questProgress?.(player, 'talk', ident.id, 1);
  }
  rel.t = (rel.t ?? 0) + 1;
  try { entity.lookAt(player.getHeadLocation()); } catch {}
  dirty(player);

  const race = raceOf(ident.race);
  const mood = moodOf(ident.id);
  const role = ident.role;
  const roleLabel = ROLE_NAMES[role] ?? role;
  let body = `§f${ident.name} ${ident.surname ?? ''}\n§7${roleLabel} · ${race.c}${race.name}§7 · ${ident.age === 'child' ? 'Niño/a' : 'Adulto/a'}\n§7Personalidad: §f${ident.pers} §7· Humor hoy: §f${mood}\n§7Relación: ${relLine(rel)}`;
  if (ident.owner === player.id && isFamilyRole(role)) body += '\n§d♥ Familia';
  body = genderize(body, d.gender, ident.gender);

  const list = [{ text: '§lHablar (escribir)', icon: 'textures/items/book_writable', fn: () => chatLoop(player, ident, entity) }];
  list.push({ text: 'Regalar objeto en mano', icon: 'textures/items/cake', fn: () => giveGift(player, ident, entity) });

  const mine = ident.owner === player.id;
  if (mine && (role === 'madre' || role === 'padre')) {
    list.push({ text: 'Pedir la paga', icon: 'textures/items/gold_nugget', fn: () => allowance(player, ident) });
    list.push({ text: 'Encargos familiares', icon: 'textures/items/paper', fn: () => hooks.familyQuest?.(player, ident) });
  }
  if (mine && (role === 'hermano' || role === 'hermana')) {
    list.push({ text: 'Jugar juntos', icon: 'textures/items/slimeball', fn: () => play(player, ident, entity) });
    list.push({ text: 'Encargos', icon: 'textures/items/paper', fn: () => hooks.familyQuest?.(player, ident) });
  }
  if (role === 'recepcionista') list.push({ text: '§1⚔ Gremio de Aventureros', icon: 'textures/items/book_enchanted', fn: () => hooks.guildDesk?.(player, entity) });
  if (role === 'maestro') list.push({ text: '§1Maestro del Gremio', icon: 'textures/items/diamond_sword', fn: () => hooks.guildMaster?.(player) });
  if (role === 'mercader') list.push({ text: '§2Comerciar', icon: 'textures/items/emerald', fn: () => hooks.shop?.(player) });
  if (role === 'herrero') {
    list.push({ text: '§6⚒ Forja', icon: 'textures/items/iron_ingot', fn: () => hooks.forge?.(player, true) });
    list.push({ text: 'Entregar encargo', icon: 'textures/items/paper', fn: () => deliverTo(player, 'herrero') });
  }
  if (role === 'sacerdotisa') list.push({ text: '§e✟ Servicios del templo', icon: 'textures/items/totem', fn: () => temple(player) });
  if (role === 'sombra') list.push({ text: '§8☠ Hermandad de la Sombra', icon: 'textures/blocks/flower_wither_rose', fn: () => hooks.shadow?.(player) });

  const adult = stageOf(d) === 'adult' && ident.age !== 'child';
  if (adult && !isFamilyRole(role) && !rel.fam) {
    if (rel.partner) list.push({ text: '§dPasar tiempo juntos', icon: 'textures/items/cake', fn: () => date(player, ident, entity, rel) });
    else if (rel.p >= 400) list.push({ text: '§dInvitar a una cita', icon: 'textures/items/cake', fn: () => date(player, ident, entity, rel) });
    if (!rel.partner && !d.spouse && rel.p >= 700) list.push({ text: '§dProponer matrimonio', icon: 'textures/items/gold_ingot', fn: () => propose(player, ident, entity, rel) });
  }
  list.push({ text: '§7Despedirse' });
  await buttons(player, `§l${ident.name}`, body, list);
}

/** Bucle de conversación: el jugador escribe y el NPC responde. */
export async function chatLoop(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const rel = relOf(d, ident);
  const ctx = { player, d, ident, rel, stage: stageOf(d), mood: moodOf(ident.id) };
  const first = opening(ctx);
  const history = [`§e${ident.name}: §f${first}`];
  msg(player, `§e[${ident.name}] §f${first}`);
  for (let turn = 0; turn < 40; turn++) {
    const label = history.slice(-8).join('\n\n') + '\n\n§7Escribe tu mensaje (vacío para terminar):';
    const text = await ask(player, `§l${ident.name}${entity ? '' : ' §7(carta)'}`, label, 'Escribe aquí...');
    if (text === undefined || !text.trim()) break;
    if (!player.isValid) return;
    const clean = text.trim().slice(0, 200);
    const res = reply(ctx, clean);
    const gained = changeRel(player, d, rel, res.delta, true);
    history.push(`§b${player.name}: §f${clean}`);
    history.push(`§e${ident.name}: §f${res.text}`);
    msg(player, `§b[Tú → ${ident.name}] §7${clean}`);
    msg(player, `§e[${ident.name}] §f${res.text}${gained > 0 ? ' §d♥' : gained < 0 ? ' §c-♥' : ''}`);
    if (res.delta <= -8) {
      addKarma(player, -2, 'insultar a ' + ident.name);
      if (entity && valid(entity)) particle(entity.dimension, 'minecraft:villager_angry', { x: entity.location.x, y: entity.location.y + 2, z: entity.location.z });
    } else if (gained > 0 && entity && valid(entity)) {
      particle(entity.dimension, 'minecraft:heart_particle', { x: entity.location.x, y: entity.location.y + 2, z: entity.location.z });
    }
    if (res.gift) {
      giveItem(player, res.gift, 1);
      msg(player, `§a${ident.name} te ha dado un regalo.`);
    }
    if (res.end) break;
  }
  dirty(player);
}

function giftPref(ident, typeId) {
  const role = GIFT_PREFS[ident.role] ?? {};
  const def = GIFT_PREFS.default;
  const love = new Set([...(role.love ?? []), ...(RACE_GIFT_LOVE[ident.race] ?? []), ...def.love]);
  if (love.has(typeId)) return 'love';
  if ((role.hate ?? def.hate).includes(typeId)) return 'hate';
  if ((role.like ?? def.like).includes(typeId)) return 'like';
  return 'neutral';
}

async function giveGift(player, ident, entity) {
  const d = getP(player);
  const rel = relOf(d, ident);
  const item = heldItem(player);
  if (!item) return info(player, '§lRegalo', '§7Sostén en la mano el objeto que quieras regalar.');
  const today = world.getDay();
  if (rel.gift === today) return info(player, '§lRegalo', `§7${ident.name} ya ha recibido un regalo tuyo hoy. Vuelve mañana.`);
  const pref = giftPref(ident, item.typeId);
  const deltas = { love: 30, like: 12, neutral: 5, hate: -12 };
  const lines = {
    love: ['¡¿Para mí?! ¡Me encanta, es justo lo que quería!', '¡Oh! ¡Es mi favorito! Gracias, gracias, gracias.', '¡No me lo puedo creer! Eres increíble.'],
    like: ['¡Qué detalle! Me gusta mucho.', 'Gracias, lo aprecio de verdad.', '¡Oh, qué bonito! Gracias.'],
    neutral: ['Gracias... supongo.', 'Ah, un regalo. Gracias.', 'Qué amable.'],
    hate: ['¿Esto es una broma? Puaj.', 'Eh... no, gracias. Qué asco.', '¿En serio me regalas esto?'],
  };
  if (item.amount > 1) {
    item.amount -= 1;
    setHeldItem(player, item);
  } else setHeldItem(player, undefined);
  rel.gift = today;
  changeRel(player, d, rel, deltas[pref]);
  if (pref !== 'hate') addKarma(player, 1);
  const line = genderize(fill(pick(lines[pref]), vars({ player, d, ident, rel, mood: moodOf(ident.id) })), d.gender, ident.gender);
  msg(player, `§e[${ident.name}] §f${line}`);
  if (entity && valid(entity)) particle(entity.dimension, pref === 'hate' ? 'minecraft:villager_angry' : 'minecraft:heart_particle', { x: entity.location.x, y: entity.location.y + 2.1, z: entity.location.z });
  psound(player, pref === 'hate' ? 'mob.villager.no' : 'random.orb', 1, 1);
  await info(player, `§l${ident.name}`, `§f${line}\n\n§7Relación: ${relLine(rel)}`);
}

async function allowance(player, ident) {
  const d = getP(player);
  const today = world.getDay();
  const st = stageOf(d);
  if (st === 'adult') {
    const line = ident.role === 'madre' ? `¿Paga? ¡Ya eres mayor, {p}! Ahora te toca a ti invitarme a cenar. Jaja.` : `Ya eres adulto/a, {p}. El oro se gana trabajando. ¡Ve al Gremio!`;
    return info(player, `§l${ident.name}`, genderize(fill(line, { p: player.name }), d.gender, ident.gender));
  }
  if (d.allowanceDay === today) return info(player, `§l${ident.name}`, '§fYa te di tu paga hoy. ¡No te lo gastes todo en dulces!');
  d.allowanceDay = today;
  const amount = st === 'child' ? 10 : 18;
  addGold(player, amount);
  dirty(player);
  await info(player, `§l${ident.name}`, `§fToma, ${amount} de oro. ¡Úsalo con cabeza!`);
}

async function play(player, ident, entity) {
  const d = getP(player);
  const rel = relOf(d, ident);
  const today = world.getDay();
  if (rel.play === today) return info(player, `§l${ident.name}`, '§f¡Ya jugamos hoy! Mañana más.');
  rel.play = today;
  changeRel(player, d, rel, 10);
  addXp(player, 15, 'social');
  const games = ['Jugasteis al escondite. ¡Ganó ' + ident.name + '!', 'Hicisteis una carrera hasta el árbol. ¡Empate!', 'Construisteis un fuerte de tierra.', 'Contasteis historias de monstruos hasta asustaros.'];
  if (entity && valid(entity)) particle(entity.dimension, 'minecraft:heart_particle', { x: entity.location.x, y: entity.location.y + 1.5, z: entity.location.z });
  await info(player, '§l¡A jugar!', `§f${pick(games)}\n\n§d+10 relación §7| §a+XP`);
}

async function date(player, ident, entity, rel) {
  const d = getP(player);
  const today = world.getDay();
  if (rel.date === today) return info(player, `§l${ident.name}`, '§fYa pasamos tiempo juntos hoy... pero me encantaría repetir mañana.');
  rel.date = today;
  changeRel(player, d, rel, rel.partner ? 10 : 15);
  addXp(player, 25, 'social');
  effect(player, 'regeneration', 200, 0);
  const scenes = ['Paseasteis bajo las estrellas.', 'Compartisteis un pastel junto al río.', 'Visteis el atardecer desde una colina.', 'Bailasteis al son de un bardo.'];
  if (entity && valid(entity)) for (let i = 0; i < 4; i++) particle(entity.dimension, 'minecraft:heart_particle', { x: entity.location.x + Math.random() - 0.5, y: entity.location.y + 1.8, z: entity.location.z + Math.random() - 0.5 });
  await info(player, '§d§lCita', `§f${pick(scenes)}\n\n§d${ident.name} sonríe. (+relación, Regeneración)`);
}

async function propose(player, ident, entity, rel) {
  const d = getP(player);
  const item = heldItem(player);
  if (!item || item.typeId !== 'rpg:wedding_ring') return info(player, '§d§lPropuesta', '§7Necesitas sostener un §dAnillo de Compromiso§7 en la mano (se vende en la tienda o se fabrica con oro y diamante).');
  const ok = await confirm(player, '§d§lPropuesta', `§f¿Quieres pedirle matrimonio a ${ident.name}?`);
  if (!ok) return;
  setHeldItem(player, item.amount > 1 ? Object.assign(item, { amount: item.amount - 1 }) : undefined);
  rel.partner = true;
  d.spouse = ident.id;
  dirty(player);
  try { world.sendMessage(`§d¡${player.name} y ${ident.name} se han comprometido! ¡Felicidades!`); } catch {}
  title(player, '§d§l¡Sí, quiero!', `§f${ident.name} es ahora tu pareja`);
  psound(player, 'random.levelup', 1, 0.8);
  // La pareja se muda a tu casa.
  const house = d.family?.house;
  if (entity && valid(entity) && house) {
    ident.spouseOf = player.name;
    ident.spouseId = player.id;
    const dim = world.getDimension(house.dim ?? 'overworld');
    try { entity.remove(); } catch {}
    const e = spawnNpc(dim, { x: house.x + 0.5, y: house.y, z: house.z + 1.5 }, ident);
    if (e) msg(player, `§d${ident.name} se ha mudado a tu casa.`);
  }
}

async function deliverTo(player, role) {
  const ok = hooks.deliver?.(player, role);
  if (!ok) await info(player, '§lEntrega', '§7No tienes encargos pendientes para este NPC o te faltan objetos.');
}

async function temple(player) {
  const d = getP(player);
  const dead = (d.family?.members ?? []).filter((m) => m.dead);
  const list = [
    { text: '§eBendición §7(20 oro)', fn: async () => {
      if (!spendGold(player, 20)) return info(player, '§lTemplo', '§cNo tienes suficiente oro.');
      effect(player, 'regeneration', 600, 1); effect(player, 'absorption', 2400, 1); effect(player, 'resistance', 1200, 0);
      particle(player.dimension, 'minecraft:totem_particle', player.location);
      await info(player, '§e§lBendición', '§fQue la luz de los doce dioses te proteja.');
    } },
    { text: '§aCurar heridas §7(10 oro)', fn: async () => {
      if (!spendGold(player, 10)) return info(player, '§lTemplo', '§cNo tienes suficiente oro.');
      heal(player, 100);
      for (const e of ['poison', 'wither', 'weakness', 'slowness', 'blindness', 'nausea', 'hunger']) try { player.removeEffect(e); } catch {}
      await info(player, '§a§lCuración', '§fTus heridas se cierran.');
    } },
    { text: `§bPurificar alma §7(100 oro, +25 karma)`, fn: async () => {
      const today = world.getDay();
      if (d.purifyDay === today) return info(player, '§lTemplo', '§7Solo puedes purificarte una vez al día.');
      if (!spendGold(player, 100)) return info(player, '§lTemplo', '§cNo tienes suficiente oro.');
      d.purifyDay = today;
      addKarma(player, 25, 'purificación');
      await info(player, '§b§lPurificación', `§fTu alma se siente más ligera. Ahora eres: ${karmaTitle(d.karma).c}${karmaTitle(d.karma).name}`);
    } },
  ];
  if (dead.length) list.push({ text: `§dResucitar familiar §7(300 oro)`, fn: () => resurrect(player, dead) });
  list.push({ text: '§7Volver' });
  await buttons(player, '§e§l✟ Templo de los Doce', '§7"Que la luz guíe tu camino, ' + player.name + '."\n§7Oro: §6' + d.gold, list);
}

async function resurrect(player, dead) {
  const d = getP(player);
  const sel = await buttons(player, '§d§lRitual de Resurrección', '§7Elige a quién traer de vuelta:', [...dead.map((m) => ({ text: `${m.name} §7(${ROLE_NAMES[m.role]})` })), { text: '§7Cancelar' }]);
  if (sel === undefined || sel >= dead.length) return;
  if (!spendGold(player, 300)) return info(player, '§lTemplo', '§cNo tienes suficiente oro.');
  const m = dead[sel];
  m.dead = false;
  const house = d.family.house;
  const dim = world.getDimension(house.dim ?? 'overworld');
  const ident = m.ident;
  if (ident) {
    try { spawnNpc(dim, { x: house.x + 0.5, y: house.y, z: house.z + 0.5 }, ident); } catch {}
  }
  dirty(player);
  title(player, '§d§lMilagro', `§f${m.name} ha vuelto a la vida`);
  msg(player, `§d✦ ${m.name} ha regresado. Te espera en casa.`);
}

/* ------------------------------------------------------------------ */
/* Muerte de NPCs                                                       */
/* ------------------------------------------------------------------ */

export function onNpcDeath(entity, killer) {
  const ident = identOf(entity);
  if (!ident) return;
  // ¿Era familia o pareja de algún jugador?
  const ownerId = ident.owner ?? ident.spouseId;
  if (ownerId) {
    const owner = world.getAllPlayers().find((p) => p.id === ownerId);
    const w = W();
    w.deadNpcs = w.deadNpcs ?? {};
    w.deadNpcs[ident.id] = world.getDay();
    wDirty();
    if (owner) {
      const d = getP(owner);
      const m = d?.family?.members?.find((x) => x.id === ident.id);
      if (m) { m.dead = true; dirty(owner); }
      if (d && d.spouse === ident.id) { d.spouse = undefined; dirty(owner); }
      title(owner, '§4§l✖ Tragedia', `§f${ident.name} ha muerto`);
      msg(owner, `§4✖ ${ident.name} (${ROLE_NAMES[ident.role] ?? ident.role}) ha muerto. §7Una sacerdotisa podría devolverle la vida...`);
    }
  }
  if (killer && killer.typeId === 'minecraft:player') {
    let k = -40;
    if (ownerId === killer.id) k = isFamilyRole(ident.role) ? -200 : -150;
    else if (isFamilyRole(ident.role)) k = -80;
    else if (STAFF_ROLES.has(ident.role)) k = ident.role === 'sombra' ? 20 : -60;
    addKarma(killer, k, `matar a ${ident.name}`);
    hooks.questProgress?.(killer, 'kill', '#npc', 1);
    const kd = getP(killer);
    if (kd?.rel?.[ident.id]) { delete kd.rel[ident.id]; dirty(killer); }
  }
}

/* ------------------------------------------------------------------ */
/* Comportamiento proactivo: saludos y cartas                           */
/* ------------------------------------------------------------------ */

const greeted = new Map();

export function greetTick() {
  const now = system.currentTick;
  for (const player of world.getAllPlayers()) {
    const d = getP(player);
    if (!d) continue;
    let near;
    try {
      near = player.dimension.getEntities({ type: NPC_TYPE, location: player.location, maxDistance: 6 });
    } catch { continue; }
    for (const e of near) {
      const ident = identOf(e);
      if (!ident) continue;
      const key = player.id + ident.id;
      if (now - (greeted.get(key) ?? -99999) < 20 * 180) continue;
      greeted.set(key, now);
      const rel = d.rel?.[ident.id];
      if (!rel && ident.owner !== player.id) continue;
      if (Math.random() > 0.6) continue;
      const r = rel ?? relOf(d, ident);
      if ((r.p ?? 0) < 0) continue;
      const ctx = { player, d, ident, rel: r, stage: stageOf(d), mood: moodOf(ident.id) };
      msg(player, `§e[${ident.name}] §f${opening(ctx)}`);
      try { e.lookAt(player.getHeadLocation()); } catch {}
    }
  }
  if (greeted.size > 2000) greeted.clear();
}

/** Cartas: los NPCs con buena relación te escriben por su cuenta. */
export function letterTick() {
  if (!cfg('npcLetters')) return;
  for (const player of world.getAllPlayers()) {
    const d = getP(player);
    if (!d || Math.random() > 0.5) continue;
    const candidates = [];
    for (const m of d.family?.members ?? []) if (!m.dead) candidates.push([m.id, LETTERS[m.role] ? m.role : 'amigo', 3]);
    for (const [id, r] of Object.entries(d.rel ?? {})) {
      if (r.fam) continue;
      if (r.partner) candidates.push([id, 'pareja', 4]);
      else if (r.r === 'sombra' && (d.karma ?? 0) <= -150) candidates.push([id, 'sombra', 2]);
      else if ((r.p ?? 0) >= 200) candidates.push([id, 'amigo', 1]);
    }
    if (!candidates.length) continue;
    const [id, kind] = weighted(candidates.map((c) => [c, c[2]]));
    const r = d.rel?.[id];
    const name = r?.n ?? d.family?.members?.find((m) => m.id === id)?.name ?? 'Alguien';
    const ident = { id, name, gender: r?.g ?? 'f', role: r?.r ?? kind, pers: r?.pers ?? 'amable', race: r?.race ?? d.race };
    let text = pick(LETTERS[kind] ?? LETTERS.amigo);
    text = genderize(fill(text, { p: player.name }), d.gender, ident.gender);
    let goldGift = 0;
    if ((kind === 'madre' || kind === 'padre') && Math.random() < 0.3) goldGift = randInt(5, 20);
    d.inbox = d.inbox ?? [];
    d.inbox.unshift({ id, from: name, role: ident.role, text, day: world.getDay(), read: false, gold: goldGift });
    d.inbox = d.inbox.slice(0, 15);
    dirty(player);
    msg(player, `§d✉ Carta de ${name}: §f"${truncate(text, 90)}" §7(Responde desde tu Diario → Mensajes)`);
    psound(player, 'random.pop', 1, 1.3);
    if (goldGift) addGold(player, goldGift);
  }
}

/** Responder una carta (conversación a distancia). */
export async function replyLetter(player, letter) {
  const d = getP(player);
  const r = d.rel?.[letter.id];
  const fm = d.family?.members?.find((m) => m.id === letter.id);
  if (fm?.dead) return info(player, '§lCarta', `§7${letter.from} ya no está con nosotros...`);
  const ident = fm?.ident ?? { id: letter.id, name: letter.from, gender: r?.g ?? 'f', role: r?.r ?? letter.role, pers: r?.pers ?? 'amable', race: r?.race ?? d.race, owner: fm ? player.id : undefined };
  await chatLoop(player, ident, undefined);
}

export function interactable(entity) {
  return entity && entity.typeId === NPC_TYPE;
}

export { STAFF_ROLES };
