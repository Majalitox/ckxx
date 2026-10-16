// NPCs: identidad (oficio, clase, asentamiento, reino, bolsa), aparición, aspecto (piel, sombrero, herramienta),
// menú de interacción con opciones por oficio (comerciar con regateo, taberna, jornales, limosnas, nobles,
// audiencia real, la ley), conversación escrita, relaciones, regalos y cartas.
import { world, system, ItemStack } from '@minecraft/server';
import { getP, dirty, W, wDirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addXp, addGold, addKarma, msg, title, spendGold } from '../core/progression.js';
import { stageOf, isVillain, karmaTitle, g, powerRank } from '../core/profile.js';
import { RACES, RACE_IDS, raceOf } from '../data/races.js';
import { FIRST_NAMES, SURNAMES, ROLE_NAMES, PERSONALITIES, jobLabel, NOBLE_PREFIX } from '../data/names.js';
import { GIFT_PREFS, RACE_GIFT_LOVE, LETTERS, ROLE_RESPONSES } from '../data/dialogue.js';
import {
  JOBS, HAT, TOOL, CLS_INDEX, CLS_NAMES, GUILD_STAFF, WALLET, MERCHANT_WALLET, TAVERN_MENU, ROUND_PRICE,
  NOBLE_TALK, BEGGAR, ROYAL, GUARD_LAW_INTRO, BARD_SONG,
} from '../data/social.js';
import { CRIMES, STRICTNESS_NAMES } from '../data/laws.js';
import { GOVERNMENTS, STRICTNESS } from '../data/cultures.js';
import { genGuildBoard } from '../data/quests.js';
import { ensureQuests } from './quests.js';
import { reply, opening, moodOf, isFamilyRole, vars, genderize, lawValue } from './chat.js';
import * as social from './social.js';
import * as economy from './economy.js';
import * as life from './life.js';
import { shopMenu } from './shop.js';
import { buttons, ask, confirm, info, guarded } from '../util/ui.js';
import { pick, weighted, randInt, dist, hash, seeded, clamp } from '../util/math.js';
import { fill, hearts, truncate } from '../util/text.js';
import { heldItem, setHeldItem, giveItem, particle, psound, valid, effect, heal } from '../util/compat.js';

export const NPC_TYPE = 'rpg:npc';
const STAFF_ROLES = new Set(['recepcionista', 'maestro', 'mercader', 'herrero', 'sacerdotisa', 'sombra']);

// Funciones de otros sistemas que se inyectan para evitar dependencias circulares.
export const hooks = {
  guildDesk: undefined, // (player, entity) => Promise
  guildMaster: undefined,
  shop: undefined, // (player, ctx?) => Promise — por defecto shop.shopMenu (con regateo)
  forge: undefined,
  shadow: undefined,
  familyQuest: undefined, // (player, ident) => Promise
  deliver: undefined, // (player, role) => boolean
  questProgress: undefined, // (player, type, key, n)
  pardon: undefined, // (player) => void — justicia: indulto real (justice.pardon)
  isRestricted: undefined, // (player) => boolean — justicia: manos atadas (no se abren menús)
};

// Orden de razas del índice de piel (contrato §2.2).
const RACE_ORDER = ['humano', 'elfo', 'enano', 'orco', 'bestia', 'demonio', 'celestial', 'vampiro', 'hada', 'draconido'];

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

function defaultCls(job, opts) {
  if (['baja', 'media', 'alta'].includes(opts.cls)) return opts.cls;
  const spec = JOBS[job] ?? JOBS.aldeano;
  if (spec.cls === 'mix') return Math.random() < 0.6 ? 'baja' : 'media';
  if (spec.cls === 'guardia') return 'media';
  return spec.cls ?? 'media';
}

function defaultWallet(job, cls) {
  if (job === 'mercader' || job === 'tabernero') return randInt(MERCHANT_WALLET[0], MERCHANT_WALLET[1]);
  if (job === 'rey') return randInt(300, 900);
  if (job === 'mendigo') return randInt(0, 4);
  const r = WALLET[cls] ?? WALLET.media;
  return randInt(r[0], r[1]);
}

/**
 * Crea la identidad de un NPC (contrato §6.2).
 * opts: { race, gender, name, surname, role, job, pers, age, owner, ownerName, settlement, realm, cls, wallet, homeId }
 * `job` por defecto = role (o 'aldeano'); para los habitantes role === job. La clase y la bolsa dependen del oficio.
 */
export function makeIdentity(opts = {}) {
  const race = opts.race ?? randomRace();
  const gender = opts.gender ?? (Math.random() < 0.5 ? 'm' : 'f');
  const names = FIRST_NAMES[race] ?? FIRST_NAMES.humano;
  const w = W();
  w.npcCount = (w.npcCount ?? 0) + 1;
  wDirty();
  const job = opts.job ?? opts.role ?? 'aldeano';
  const role = opts.role ?? job;
  const cls = defaultCls(job, opts);
  const ident = {
    id: 'n' + w.npcCount.toString(36) + Math.floor(Math.random() * 1296).toString(36),
    name: opts.name ?? pick(names[gender]),
    surname: opts.surname ?? pick(SURNAMES[race] ?? SURNAMES.humano),
    gender,
    race,
    role,
    pers: opts.pers ?? pick(PERSONALITIES),
    age: opts.age ?? 'adult',
    owner: opts.owner,
    ownerName: opts.ownerName,
    settlement: opts.settlement,
    realm: opts.realm,
    cls,
    job,
    wallet: typeof opts.wallet === 'number' ? opts.wallet : defaultWallet(job, cls),
    homeId: opts.homeId,
    lv: LOOK_VERSION,
  };
  try { ident.wday = world.getDay(); } catch {}
  for (const k of Object.keys(ident)) if (ident[k] === undefined) delete ident[k];
  return ident;
}

const jobOf = (ident) => ident?.job ?? ident?.role ?? 'aldeano';
const isGuardJob = (job) => job === 'guardia' || job === 'carcelero';

/** Índice de piel: raza×16 + clase×4 + género×2 + variante (contrato §2.2; guardias clase 3). */
export function skinFor(ident) {
  const r = Math.max(0, RACE_ORDER.indexOf(ident.race));
  const job = jobOf(ident);
  const c = isGuardJob(job) ? 3 : CLS_INDEX[ident.cls] ?? 1;
  const v = hash(ident.id ?? '') % 2;
  return clamp(r * 16 + c * 4 + (ident.gender === 'f' ? 2 : 0) + v, 0, 159);
}

/** Sombrero según el oficio y la clase. */
export function hatFor(ident) {
  if (typeof ident.hat === 'number') return clamp(ident.hat, 0, 7);
  const job = jobOf(ident);
  const spec = JOBS[job];
  if (!spec) return HAT.none;
  if (ident.age === 'child') return job === 'granjero' ? HAT.straw : HAT.none;
  const list = spec.hats ?? ['none'];
  let h = HAT[list[hash(ident.id + 'h') % list.length]] ?? HAT.none;
  if (job === 'aldeano' && ident.cls === 'alta') h = HAT.noble;
  return h;
}

/** Herramienta en la mano según el oficio. */
export function toolFor(ident) {
  const job = jobOf(ident);
  const spec = JOBS[job];
  if (!spec || ident.age === 'child') return TOOL.none;
  const list = spec.tools ?? ['none'];
  return TOOL[list[hash(ident.id + 't') % list.length]] ?? TOOL.none;
}

function npcScale(ident) {
  // Mismas proporciones que el jugador (contrato §1): niño ≈ 1 bloque, adulto ≈ 2 bloques.
  const s = (raceOf(ident.race).scale ?? 1) * (ident.age === 'child' ? 0.58 : 1.11);
  return Math.max(30, Math.min(135, Math.round((s * 100) / 5) * 5));
}

function rulerTitleOf(ident) {
  const realm = social.realmById(ident.realm) ?? social.realmOfSafe(social.getSettlementSafe(ident.settlement));
  return { title: ident.title ?? realm?.ruler?.title ?? jobLabel('rey', ident.gender), realm };
}

/** Texto del nombre sobre la cabeza: nombre (color por clase) y oficio. */
export function nameTagOf(ident) {
  const race = raceOf(ident.race);
  const job = jobOf(ident);
  let label = jobLabel(ident.role === job ? job : ident.role, ident.gender);
  if (isFamilyRole(ident.role) && ident.ownerName) label += ' de ' + ident.ownerName;
  if (ident.spouseOf) label = 'Pareja de ' + ident.spouseOf;
  let name = ident.name;
  let color = '§e';
  let prefix = '';
  const spec = JOBS[job];
  let today = -1;
  try { today = world.getDay(); } catch {}
  if (job === 'ladron') {
    if (ident.exposed === today) { label = '§c' + jobLabel('ladron', ident.gender); color = '§c'; }
    else label = spec?.disguise?.[ident.gender === 'f' ? 1 : 0] ?? 'Forastero';
  } else if (job === 'rey') {
    const { title, realm } = rulerTitleOf(ident);
    prefix = '§6\uE309 ';
    color = '§6';
    label = `§6${title}${realm?.name ? ' §7· ' + realm.name : ''}`;
    return `${prefix}${color}${name}\n${label}`;
  } else if (isGuardJob(job)) {
    prefix = '§9\uE30A ';
    color = '§f';
    label = '§9' + label;
  } else if (job === 'noble') {
    color = '§6';
    name = `${NOBLE_PREFIX[ident.gender === 'f' ? 'f' : 'm']} ${ident.name}`;
  } else if (job === 'mendigo') color = '§7';
  else if (ident.cls === 'alta') color = '§6';
  else if (ident.cls === 'baja' && !isFamilyRole(ident.role)) color = '§f';
  return `${prefix}${color}${name}\n§7${label} · ${race.c}${race.name}`;
}

/** Aplica el aspecto (piel, geometría, sombrero, herramienta, humor, tamaño y nombre) a la entidad. */
export function applyLook(entity, ident) {
  try { entity.setProperty('rpg:skin', skinFor(ident)); } catch {}
  try { entity.setProperty('rpg:geo', raceOf(ident.race).geo); } catch {}
  try { entity.setProperty('rpg:hat', hatFor(ident)); } catch {}
  try { entity.setProperty('rpg:tool', toolFor(ident)); } catch {}
  try { entity.setProperty('rpg:alert', false); } catch {}
  try { entity.setProperty('rpg:mood', 0); } catch {}
  try { entity.triggerEvent('rpg:scale_' + npcScale(ident)); } catch {}
  try { entity.nameTag = nameTagOf(ident); } catch {}
}

/** Tipo de aparición según el oficio: guard | citizen | staff | resident. */
export function spawnKind(ident) {
  const job = jobOf(ident);
  if (isGuardJob(job)) return 'guard';
  if (ident.owner || isFamilyRole(ident.role) || ident.spouseOf) return 'resident';
  if (job === 'rey' || GUILD_STAFF.has(job) || GUILD_STAFF.has(ident.role)) return 'staff';
  if (!ident.settlement && STAFF_ROLES.has(ident.role)) return 'staff';
  if (ident.settlement) return 'citizen';
  return 'resident';
}

export function spawnNpc(dim, loc, ident, persistent = true) {
  let e;
  const kind = spawnKind(ident);
  let withEvent = persistent;
  try {
    // El evento de aparición fija el comportamiento (guardia, ciudadano libre, personal con hogar, familia).
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
  try {
    e.addTag('rpg_npc');
    e.addTag('rpg_fid_' + ident.id);
    e.addTag('rpg_role_' + ident.role);
    if (ident.job && ident.job !== ident.role) e.addTag('rpg_job_' + ident.job);
  } catch {}
  system.runTimeout(() => {
    if (!valid(e)) return;
    if (persistent && !withEvent) try { e.triggerEvent(`rpg:make_${kind}`); } catch {}
    applyLook(e, ident);
  }, 2);
  return e;
}

/** Versión del aspecto/identidad: las identidades de la v1 (sin oficio, clase ni bolsa) se migran al verlas. */
export const LOOK_VERSION = 2;

/**
 * Migra un NPC de un mundo de la v1: completa oficio, clase y bolsa, y le aplica el aspecto de la v2
 * (piel según el esquema raza×16+clase×4+género×2+variante, sombrero, herramienta, altura de 2 bloques
 * y nombre con oficio). Devuelve la identidad actualizada, o undefined si ya estaba al día.
 */
export function upgradeLook(entity, ident) {
  if (!ident || ident.lv === LOOK_VERSION) return undefined;
  const job = ident.job ?? ident.role ?? 'aldeano';
  ident.job = job;
  ident.role = ident.role ?? job;
  if (!['baja', 'media', 'alta'].includes(ident.cls)) ident.cls = defaultCls(job, {});
  if (typeof ident.wallet !== 'number') ident.wallet = defaultWallet(job, ident.cls);
  ident.lv = LOOK_VERSION;
  saveIdent(entity, ident);
  applyLook(entity, ident);
  return ident;
}

/** NPCs que aparecen de forma natural (aventureros errantes) reciben identidad al cargar. */
export function ensureIdentity(entity) {
  if (identOf(entity)) return;
  const role = weighted([['aventurero', 6], ['aldeano', 3], ['bardo', 1]]);
  const ident = makeIdentity({ role, cls: 'media' });
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
  try { if (hooks.isRestricted?.(player)) return; } catch {}
  guarded(player, () => npcMenu(player, entity));
}

const MOOD_FACE = { feliz: '§a☺ feliz', normal: '§fnormal', cansado: '§7cansado/A', triste: '§9triste', enojado: '§cenojado/A' };

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
  const job = jobOf(ident);
  const roleLabel = nameRoleLabel(ident);
  let asleep = false;
  try { asleep = entity.getDynamicProperty('rpg:act') === 'sleep'; } catch {}
  const place = placeOfIdent(ident, player);
  let body = `§f${job === 'noble' ? NOBLE_PREFIX[ident.gender === 'f' ? 'f' : 'm'] + ' ' : ''}${ident.name} ${ident.surname ?? ''}\n§7${roleLabel} · ${race.c}${race.name}§7 · ${ident.age === 'child' ? 'Niño/A' : 'Adulto/A'}`;
  if (!isFamilyRole(role) && ident.cls && job !== 'ladron') body += ` · ${CLS_NAMES[ident.cls] ?? ''}`;
  if (place.s?.name) body += `\n§7Vive en §f${place.s.name}${place.realm?.name ? `§7 (${place.realm.name})` : ''}`;
  body += `\n§7Personalidad: §f${ident.pers} §7· Humor hoy: ${MOOD_FACE[mood] ?? mood}\n§7Relación: ${relLine(rel)}`;
  if (!isFamilyRole(role) && role !== 'sombra') {
    const att = social.attitude(d, ident, place.realm);
    const pc = social.playerClass(d);
    const how = att >= 0.45 ? '§aTe admira' : att >= 0.15 ? '§2Te ve con buenos ojos' : att > -0.15 ? '§7Te trata con normalidad' : att > -0.45 ? '§6Te mira con recelo' : '§cTe desprecia';
    body += `\n§7Te ve como: ${pc.label} §8· ${how}`;
  }
  if (asleep) body += '\n§8(Estaba durmiendo... le has despertado.)';
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
  if (job === 'mercader') list.push({ text: '§2Comerciar §7(regateo)', icon: 'textures/items/emerald', fn: () => openShop(player, entity, ident) });
  if (job === 'herrero') {
    list.push({ text: '§6⚒ Forja', icon: 'textures/items/iron_ingot', fn: () => hooks.forge?.(player, true) });
    list.push({ text: 'Entregar encargo', icon: 'textures/items/paper', fn: () => deliverTo(player, 'herrero') });
  }
  if (job === 'tabernero') {
    list.push({ text: '§6Comida y bebida', icon: 'textures/items/bread', fn: () => tavernMenu(player, ident, entity) });
    list.push({ text: '§eRumores', icon: 'textures/items/map_filled', fn: () => rumourMenu(player, ident, entity) });
    list.push({ text: '§dDados del tabernero', icon: 'textures/items/gold_nugget', fn: () => diceGame(player, ident, entity) });
  }
  if (!mine && life.offersDayJob(ident)) list.push({ text: '§aTrabajo por un día', icon: 'textures/items/iron_hoe', fn: () => life.dayJobMenu(player, ident, entity) });
  if (life.canServe(player, ident)) list.push({ text: '§6Servir una jarra', icon: 'textures/items/potion_bottle_empty', fn: () => life.serveDrink(player, ident, entity) });
  if (job === 'mendigo') list.push({ text: '§eDar limosna', icon: 'textures/items/gold_nugget', fn: () => almsMenu(player, ident, entity) });
  if (job === 'noble') list.push({ text: '§6Conversar sobre la corte', icon: 'textures/items/book_normal', fn: () => nobleTalk(player, ident, entity) });
  if (job === 'bardo') list.push({ text: '§dPedir una canción', icon: 'textures/items/record_cat', fn: () => bardSong(player, ident, entity) });
  if (job === 'rey') list.push({ text: '§6§lAudiencia real', icon: 'textures/items/gold_ingot', fn: () => royalAudience(player, ident, entity) });
  if (isGuardJob(job)) list.push({ text: '§9Preguntar por la ley', icon: 'textures/items/paper', fn: () => lawInfo(player, ident, entity) });
  if (role === 'sacerdotisa' || job === 'sacerdote') list.push({ text: '§e✟ Servicios del templo', icon: 'textures/items/totem', fn: () => temple(player) });
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

function nameRoleLabel(ident) {
  const job = jobOf(ident);
  if (job === 'ladron' && ident.exposed !== world.getDay()) return JOBS.ladron.disguise[ident.gender === 'f' ? 1 : 0];
  if (job === 'rey') return rulerTitleOf(ident).title;
  return jobLabel(ident.role === job ? job : ident.role, ident.gender);
}

function placeOfIdent(ident, player) {
  const s = social.getSettlementSafe(ident.settlement);
  let realm = s ? social.realmOfSafe(s) : social.realmById(ident.realm);
  if (!s && !realm && player) {
    try { const p = social.nearPlace(player); return { s: undefined, realm: p.realm, near: p.s }; } catch {}
  }
  return { s, realm };
}

async function openShop(player, entity, ident) {
  return shopMenu(player, { entity, ident });
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
  // Los nobles no pierden el tiempo con la plebe.
  const disdain = entity ? social.nobleDisdain(d, ident) : false;
  const maxTurns = disdain ? 2 : 40;
  for (let turn = 0; turn < 40; turn++) {
    if (turn >= maxTurns) {
      const line = genderize(fill(pick(NOBLE_TALK.refuse_chat), vars(ctx)), d.gender, ident.gender);
      msg(player, `§e[${ident.name}] §f${line}`);
      if (entity && valid(entity)) life.say(entity, line, 4);
      break;
    }
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
  let dim;
  try { if (house) dim = world.getDimension(house.dim ?? 'overworld'); } catch {}
  if (entity && valid(entity) && dim) {
    // Deja su asentamiento: fuera del censo (si no, el mantenimiento del pueblo repondría un clon) y sin
    // aldea ni reino en la identidad (horarios y marcadores de la casa del jugador, no los del pueblo).
    if (ident.settlement) {
      try { social.releaseResidentSafe(ident.settlement, ident.id); } catch {}
    }
    delete ident.settlement;
    delete ident.realm;
    delete ident.homeId;
    ident.spouseOf = player.name;
    ident.spouseId = player.id;
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
/* Oficios: taberna, rumores, dados, limosnas, nobles, rey, guardias     */
/* ------------------------------------------------------------------ */

const sayTo = (player, d, ident, text, v = {}) => social.fixEs(genderize(fill(text, { p: player.name, trato: social.address(d, ident, player), ...v }), d.gender, ident.gender));

function npcSpeak(player, entity, ident, line, secs = 4) {
  msg(player, `§e[${ident.name}] §f${line}`);
  if (entity && valid(entity)) life.say(entity, line, secs);
}

/** Taberna: comida y bebida con precios del mercado local, e invitar a una ronda. */
async function tavernMenu(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const place = placeOfIdent(ident, player);
  const s = place.s ?? place.near;
  const items = TAVERN_MENU.map(([id, n, base, name]) => ({ id, n, name, price: economy.finalPrice(base, economy.priceFactor(player, s, id, 'buy')) }));
  const roundCost = economy.finalPrice(ROUND_PRICE, economy.priceFactor(player, s, 'minecraft:honey_bottle', 'buy'));
  const so = social.socialOf(d);
  const today = world.getDay();
  const ev = economy.marketEvent(s);
  const list = items.map((it) => ({ text: `${it.name}\n§6${it.price} oro` }));
  list.push({ text: so.round === today ? '§8Ronda para todos (ya invitaste hoy)' : `§dInvitar a una ronda a todos\n§6${roundCost} oro` });
  list.push({ text: '§7Volver' });
  const sel = await buttons(player, `§l§6${ident.name} · Taberna`,
    `§f"${sayTo(player, d, ident, pick(['¿Qué te pongo, {trato}?', 'Hoy el estofado está de muerte. Literalmente no, tranquilo/a.', '¡Siéntate, siéntate! ¿Qué va a ser?']))}"\n§7Tu oro: §6${d.gold}${ev ? `\n§e${ev.name}§7: los precios de la comida pueden variar.` : ''}`, list);
  if (sel === undefined || sel >= items.length + 1) return;
  if (sel === items.length) return buyRound(player, d, ident, entity, roundCost);
  const it = items[sel];
  if (!spendGold(player, it.price)) return info(player, `§l${ident.name}`, `§c¡Sin oro no hay comida! Necesitas ${it.price}.`);
  giveItem(player, it.id, it.n);
  economy.walletAdd(entity, ident, it.price);
  psound(player, 'random.orb', 0.7, 1.2);
  npcSpeak(player, entity, ident, sayTo(player, d, ident, pick(['¡Marchando!', 'Aquí tienes. ¡Que aproveche!', 'Buena elección, {trato}.'])));
  return tavernMenu(player, ident, entity);
}

async function buyRound(player, d, ident, entity, cost) {
  const so = social.socialOf(d);
  const today = world.getDay();
  if (so.round === today) return info(player, `§l${ident.name}`, '§fYa invitaste a una ronda hoy. ¡No arruines tu bolsa!');
  if (!spendGold(player, cost)) return info(player, `§l${ident.name}`, `§cUna ronda para todos cuesta ${cost} oro.`);
  so.round = today;
  economy.walletAdd(entity, ident, cost);
  let cheered = 0;
  try {
    const near = player.dimension.getEntities({ type: NPC_TYPE, location: player.location, maxDistance: 14, excludeTags: ['rpg_busy'] });
    for (const e of near) {
      const id = identOf(e);
      if (!id) continue;
      const r = d.rel?.[id.id];
      if (r) r.p = Math.min(1000, (r.p ?? 0) + 3);
      if (cheered < 6) { life.say(e, pick(['¡Salud!', `¡Por ${player.name}!`, '¡Viva la gente generosa!', '¡Esta ronda sabe a gloria!']), 4); cheered++; }
    }
  } catch {}
  addKarma(player, 2);
  social.recordDeed(player, 'round', { key: 'ronda' });
  psound(player, 'random.levelup', 0.6, 1.5);
  dirty(player);
  npcSpeak(player, entity, ident, sayTo(player, d, ident, '¡Escuchad todos! ¡{p} invita a esta ronda!'));
}

/** Rumores de la taberna (una jarra a cambio, salvo para los amigos). */
async function rumourMenu(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const rel = relOf(d, ident);
  const free = (rel.p ?? 0) >= 80;
  const cost = 3;
  if (!free) {
    const ok = await confirm(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, 'Las noticias se cuentan mejor con la garganta mojada... Una jarra son {c} de oro.', { c: cost })}"`, `§6Pagar una jarra (${cost} oro)`, '§cNo');
    if (!ok) return;
    if (!spendGold(player, cost)) return info(player, `§l${ident.name}`, '§cNi para una jarra te llega...');
    economy.walletAdd(entity, ident, cost);
  }
  const rng = seeded(hash(player.id + ident.id + world.getDay() + ':' + (rel.rumN = (rel.rumN ?? 0) + 1)));
  const a = life.rumour(player, ident, rng);
  let b = life.rumour(player, ident, rng);
  for (let i = 0; i < 3 && b === a; i++) b = life.rumour(player, ident, rng);
  dirty(player);
  await info(player, `§l§e${ident.name} · Rumores`, `§f"${genderize(a, d.gender, ident.gender)}"\n\n§f"${genderize(b, d.gender, ident.gender)}"\n\n§8(Los rumores cambian cada día.)`);
}

/** Dados contra el tabernero: 2d6 contra 2d6; los tramposos con oficio pueden usar dados cargados. */
async function diceGame(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const so = social.socialOf(d);
  const today = world.getDay();
  if (so.diceBan === today) return info(player, `§l${ident.name}`, `§c"${sayTo(player, d, ident, 'Contigo no vuelvo a jugar hoy, tramposo/a.')}"`);
  if (stageOf(d) === 'child') return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, '¿Dados? ¡Eres un/a crío/a! Vete a jugar a la plaza.')}"`);
  const bets = [5, 10, 25, 50].filter((b) => b <= (d.gold ?? 0));
  if (!bets.length) return info(player, `§l${ident.name}`, '§fSin al menos 5 de oro no te siento a mi mesa.');
  const cheat = (d.thief?.lvl ?? 1) >= 3;
  const list = bets.map((b) => ({ text: `Apostar §6${b} oro` }));
  if (cheat) list.push({ text: `§5Dados cargados §7(apuesta ${bets[bets.length - 1]} oro)` });
  list.push({ text: '§7Volver' });
  const sel = await buttons(player, `§l§dDados · ${ident.name}`, '§7Cada uno tira dos dados. Gana el que saque más; empate, se devuelve la apuesta.\n§7Tu oro: §6' + d.gold, list);
  if (sel === undefined || sel >= list.length - 1) return;
  const loaded = cheat && sel === bets.length;
  const bet = loaded ? bets[bets.length - 1] : bets[sel];
  const r = () => randInt(1, 6);
  const mine = loaded ? [r(), r(), r()].sort((x, y) => y - x).slice(0, 2) : [r(), r()];
  const his = [r(), r()];
  const a = mine[0] + mine[1];
  const b = his[0] + his[1];
  psound(player, 'random.click', 1, 1.4);
  if (loaded && Math.random() < 0.25) {
    so.diceBan = today;
    spendGold(player, bet);
    economy.walletAdd(entity, ident, bet);
    changeRel(player, d, relOf(d, ident), -15);
    const line = sayTo(player, d, ident, '¡Estos dados están cargados! ¡Tramposo/a! Me quedo tu apuesta, y da gracias de que no llame a la guardia.');
    npcSpeak(player, entity, ident, line);
    return info(player, '§c§l¡Pillado/a!'.replace('/a', d.gender === 'f' ? 'a' : 'o'), `§c${line}\n\n§7-${bet} oro`);
  }
  let res;
  if (a > b) {
    const paid = Math.min(bet, Math.max(0, ident.wallet ?? bet));
    addGold(player, paid, true);
    economy.walletAdd(entity, ident, -paid);
    res = `§a¡Ganas! §f(${mine.join('+')} = ${a} contra ${his.join('+')} = ${b}) §6+${paid} oro`;
    if (paid < bet) res += '\n§7(El tabernero no tenía más en la caja.)';
    npcSpeak(player, entity, ident, sayTo(player, d, ident, pick(['¡Maldita sea! Tienes la suerte de un dragón.', 'Bah, la próxima es mía.'])));
  } else if (a < b) {
    spendGold(player, bet);
    economy.walletAdd(entity, ident, bet);
    res = `§c¡Pierdes! §f(${mine.join('+')} = ${a} contra ${his.join('+')} = ${b}) §c-${bet} oro`;
    npcSpeak(player, entity, ident, sayTo(player, d, ident, pick(['¡Ja! La casa siempre gana.', 'Gracias por tu donación, {trato}.'])));
  } else res = `§eEmpate §f(${a} contra ${b}). Se devuelve la apuesta.`;
  dirty(player);
  await info(player, `§l§dDados · ${ident.name}`, res + `\n\n§7Tu oro: §6${d.gold}`);
}

/** Dar limosna a un mendigo: karma, relación y reacciones de quien lo ve. */
async function almsMenu(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const so = social.socialOf(d);
  so.alms = so.alms ?? {};
  const today = world.getDay();
  if (so.alms[ident.id] === today) return npcSpeak(player, entity, ident, sayTo(player, d, ident, pick(BEGGAR.again)));
  const amounts = [[1, 1, 2], [5, 3, 5], [20, 6, 10], [50, 10, 15]].filter(([a]) => a <= (d.gold ?? 0));
  if (!amounts.length) return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, 'Tú estás tan pelado/a como yo, {trato}. Guárdate lo poco que tengas.')}"`);
  const sel = await buttons(player, `§l§eLimosna para ${ident.name}`, `§f"${sayTo(player, d, ident, pick(BEGGAR.ask))}"\n§7Tu oro: §6${d.gold}`,
    [...amounts.map(([a]) => ({ text: `Dar §6${a} oro` })), { text: '§7No dar nada' }]);
  if (sel === undefined || sel >= amounts.length) {
    if (sel !== undefined) npcSpeak(player, entity, ident, sayTo(player, d, ident, pick(['*suspira*', 'Que los dioses le perdonen...', 'Otra vez será...'])));
    return;
  }
  const [amount, karma, relp] = amounts[sel];
  if (!spendGold(player, amount)) return;
  so.alms[ident.id] = today;
  for (const k of Object.keys(so.alms)) if (so.alms[k] !== today) delete so.alms[k];
  economy.walletAdd(entity, ident, amount);
  changeRel(player, d, relOf(d, ident), relp);
  addKarma(player, karma, 'limosna');
  const pc = social.playerClass(d);
  let line = sayTo(player, d, ident, pick(amount >= 20 ? BEGGAR.thanks_big : amount >= 5 ? BEGGAR.thanks_mid : BEGGAR.thanks_small));
  if (pc.rank >= 5 && amount >= 5) line = sayTo(player, d, ident, pick(BEGGAR.noble));
  npcSpeak(player, entity, ident, line, 4.5);
  if (entity && valid(entity)) particle(entity.dimension, 'minecraft:heart_particle', { x: entity.location.x, y: entity.location.y + 2, z: entity.location.z });
  // Quien lo ve, lo comenta.
  try {
    const near = player.dimension.getEntities({ type: NPC_TYPE, location: player.location, maxDistance: 10, excludeTags: ['rpg_busy'] }).filter((e) => e.id !== entity?.id);
    const w = near[0];
    const wi = w && identOf(w);
    if (wi) {
      const cls = social.npcCls(wi);
      const react = cls === 'alta'
        ? (pc.rank >= 4 ? '¡Qué generosidad tan noble!' : 'Dar dinero a los vagos solo los anima a seguir vagueando.')
        : pick(['¡Qué buen corazón!', 'Ojalá hubiera más gente así.', 'Los dioses ven esas cosas, ¿sabes?']);
      life.say(w, react, 4);
    }
  } catch {}
  if (amount >= 20 && so.almsDeed !== today) {
    so.almsDeed = today;
    social.recordDeed(player, 'alms', { key: ident.id });
  }
  if (amount >= 5) {
    const rum = life.rumour(player, ident);
    await info(player, `§l${ident.name}`, `§f"${line}"\n\n§f"${sayTo(player, d, ident, pick(BEGGAR.rumor), { rumor: rum })}"`);
  }
  dirty(player);
}

/** Charla con un noble: desdén o respeto según tu clase. */
async function nobleTalk(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const pc = social.playerClass(d);
  const place = placeOfIdent(ident, player);
  const realm = place.realm;
  const others = social.allRealmsSafe().filter((r) => r.id !== realm?.id);
  const v = {
    clase: pc.name.toLowerCase(), titulo: realm?.ruler?.title ?? 'el Rey', gobernante: realm?.ruler?.name ?? '',
    otro_reino: others.length ? social.realmArt(pick(others).name) : 'el reino vecino', ...social.sovereign(realm),
  };
  const hero = pc.overlay === 'heroe' || pc.overlay === 'leyenda';
  const rel = relOf(d, ident);
  let lines;
  if (hero) { lines = [pick(NOBLE_TALK.hero), pick(NOBLE_TALK.court)]; changeRel(player, d, rel, 3); }
  else if (pc.rank <= 1) { lines = [pick(NOBLE_TALK.low)]; changeRel(player, d, rel, -1); }
  else if (pc.rank <= 3) { lines = [pick(NOBLE_TALK.mid), pick(NOBLE_TALK.court)]; changeRel(player, d, rel, 1); }
  else { lines = [pick(NOBLE_TALK.high), pick(NOBLE_TALK.court), pick(NOBLE_TALK.court)]; changeRel(player, d, rel, 3); }
  lines = [...new Set(lines)].map((l) => sayTo(player, d, ident, l, v).replace(/\s+/g, ' ').trim());
  if (entity && valid(entity)) life.say(entity, lines[0], 4);
  await info(player, `§l§6${NOBLE_PREFIX[ident.gender === 'f' ? 'f' : 'm']} ${ident.name}`, lines.map((l) => `§f"${l}"`).join('\n\n'));
}

/** Gesta en tercera persona para una copla: "derrotó a la Reina Araña", "es la aventurera de rango B". */
function songDeed(glory) {
  const who = String(glory?.who ?? '');
  if (!who) return undefined;
  return who.startsWith('quien ') ? who.slice(6) : 'es ' + who;
}

/** Fechoría en tercera persona: "Cometiste hurto en X" → "cometió hurto en X". */
function songShame(shame) {
  return social.thirdPerson(shame?.text) ?? 'tiene un pasado turbio';
}

/** El bardo compone una copla sobre ti: tus gestas, tu clase y, si las hay, tus fechorías. */
async function bardSong(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const rel = relOf(d, ident);
  const today = world.getDay();
  const place = placeOfIdent(ident, player);
  const v = { c: BARD_SONG.tip, asentamiento: place.s?.name ?? 'estas tierras', heroe: g(d, 'héroe', 'heroína') };
  if (rel.song === today) return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, pick(BARD_SONG.again), v)}"`);
  const ok = await confirm(player, `§l§d${ident.name} · Canción`, `§f"${sayTo(player, d, ident, pick(BARD_SONG.ask), v)}"\n§7Tu oro: §6${d.gold}`, `§6Dar ${BARD_SONG.tip} oro`, '§cAhora no');
  if (!ok) return;
  if (!spendGold(player, BARD_SONG.tip)) return info(player, `§l${ident.name}`, '§f¿Sin blanca? Pues te canto gratis... otro día.');
  economy.walletAdd(entity, ident, BARD_SONG.tip);
  rel.song = today;
  changeRel(player, d, rel, 4);
  const realm = place.realm;
  const glory = social.lastGlory(d, realm?.id);
  const shame = social.lastShame(d);
  const pc = social.playerClass(d);
  const verses = [pick(BARD_SONG.open)];
  verses.push(glory ? pick(BARD_SONG.glory).replace('{hazana}', songDeed(glory)) : pick(BARD_SONG.unknown));
  verses.push(BARD_SONG.cls[pc.rank] ?? BARD_SONG.cls[1]);
  if (shame && social.infamy(d, realm?.id) >= 30) verses.push(pick(BARD_SONG.shame).replace('{verguenza}', songShame(shame)));
  verses.push(pick(BARD_SONG.close));
  const song = verses.map((x) => sayTo(player, d, ident, x, v));
  psound(player, 'note.harp', 0.8, 1.2);
  songNotes(entity);
  if (entity && valid(entity)) life.say(entity, song[0], 5);
  // El público aplaude.
  try {
    const near = player.dimension.getEntities({ type: NPC_TYPE, location: player.location, maxDistance: 12, excludeTags: ['rpg_busy'] })
      .filter((e) => e.id !== entity?.id).slice(0, 3);
    near.forEach((e, i) => system.runTimeout(() => { try { if (valid(e)) life.say(e, sayTo(player, d, identOf(e) ?? ident, pick(BARD_SONG.cheer), v), 3); } catch {} }, 40 + i * 15));
  } catch {}
  await info(player, `§l§d♪ La copla de ${player.name} ♪`, song.map((x) => '§f' + x).join('\n\n') + `\n\n§7${ident.name} hace una reverencia. §d+relación`);
}

/** Notas musicales sobre el bardo mientras canta. */
function songNotes(entity) {
  if (!entity || !valid(entity)) return;
  for (let i = 0; i < 4; i++) {
    system.runTimeout(() => {
      try { if (valid(entity)) particle(entity.dimension, 'minecraft:note_particle', { x: entity.location.x + (Math.random() - 0.5), y: entity.location.y + 2.2, z: entity.location.z + (Math.random() - 0.5) }); } catch {}
    }, i * 8);
  }
}

function realmFor(ident, player) {
  const place = placeOfIdent(ident, player);
  return place.realm;
}

/** Audiencia real: títulos nobiliarios, encargos reales y perdón de crímenes. */
async function royalAudience(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const realm = realmFor(ident, player);
  const rname = realm?.name ?? 'estas tierras';
  const rtitle = realm?.ruler?.title ?? rulerTitleOf(ident).title;
  const pc = social.playerClass(d);
  const sov = social.sovereign(realm ?? { ruler: { title: rtitle, name: ident.name, gender: ident.gender } });
  const v = { reino: realm?.name ? social.realmArt(realm.name) : 'el reino', titulo: rtitle, gobernante: ident.name, clase: pc.name.toLowerCase(), ...sov };
  const wanted = (d.wanted?.stars ?? 0) > 0;
  const hero = pc.overlay === 'heroe' || pc.overlay === 'leyenda';
  const greet = wanted ? ROYAL.greet.wanted : hero ? ROYAL.greet.hero : pc.rank >= 4 ? ROYAL.greet.high : pc.rank >= 2 ? ROYAL.greet.mid : ROYAL.greet.low;
  const so = social.socialOf(d);
  const f = social.fame(d, realm?.id);
  const list = [
    { text: so.noble ? '§8Título nobiliario (ya lo tienes)' : '§6Solicitar un título nobiliario', fn: () => titleFlow(player, d, ident, entity, realm, v) },
    { text: '§bPedir un encargo real', fn: () => royalQuest(player, d, ident, realm, v) },
  ];
  if (wanted) list.push({ text: '§cSuplicar el perdón real', fn: () => pardonFlow(player, d, ident, realm, v) });
  list.push({ text: `§fHablar con ${rtitle}`, fn: () => chatLoop(player, ident, entity) });
  list.push({ text: '§7Retirarse' });
  await buttons(player, `§l§6\uE309 ${rtitle} ${ident.name}`,
    `§f"${sayTo(player, d, ident, pick(greet), v)}"\n\n§7Reino: §f${rname}\n§7Tu fama aquí: §e${f} §7(${genderize(social.fameTier(f).name, d.gender, d.gender)})\n§7Tu clase: ${pc.label}`, list);
}

/** Coste del título: escala con la prosperidad del reino; gratis con fama ≥ 400 en ese reino. */
export function titleCost(d, realm) {
  if (social.fame(d, realm?.id) >= 400) return 0;
  const pros = clamp(Number(realm?.economy?.prosperity ?? 1) || 1, 0.5, 1.5);
  return Math.round((2000 * pros) / 50) * 50;
}

async function titleFlow(player, d, ident, entity, realm, v) {
  const so = social.socialOf(d);
  if (so.noble) return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, pick(ROYAL.title_have), v)}"`);
  if (stageOf(d) === 'child') return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, 'Eres demasiado joven para un título, pequeño/a. Vuelve cuando seas mayor.', v)}"`);
  if ((d.wanted?.stars ?? 0) > 0) return info(player, `§l${ident.name}`, `§c"${sayTo(player, d, ident, '¿Un título? ¿A quien busca mi propia guardia? Ni lo sueñes.', v)}"`);
  const cost = titleCost(d, realm);
  const deedFree = cost === 0;
  const ok = await confirm(player, '§l§6Título nobiliario',
    deedFree
      ? `§f"${sayTo(player, d, ident, 'Tus hazañas son conocidas en todo {reino}. Arrodíllate y recibe tu título.', v)}"\n\n§7Coste: §agratis §7(fama ≥ 400 en este reino)`
      : `§f"${sayTo(player, d, ident, pick(ROYAL.title_poor), { ...v, coste: cost })}"\n\n§7Coste: §6${cost} oro §7(tienes ${d.gold})\n§8Con fama ≥ 400 en este reino sería gratis.\n§8Los nobles no pagan el impuesto real en su reino y la plebe se inclina a su paso.`,
    deedFree ? '§aArrodillarme' : `§6Pagar ${cost} oro`, '§cAhora no');
  if (!ok) return;
  if (cost > 0 && !spendGold(player, cost)) return info(player, `§l${ident.name}`, `§c"${sayTo(player, d, ident, pick(ROYAL.title_poor), { ...v, coste: cost })}"`);
  so.noble = { realmId: realm?.id ?? '_', realmName: realm?.name ?? 'estas tierras', day: world.getDay(), by: ident.name };
  dirty(player);
  try {
    const it = new ItemStack('rpg:noble_title', 1);
    try { it.nameTag = `§6Título nobiliario de ${so.noble.realmName}`; } catch {}
    try { it.setLore([`§7Otorgado por ${v.titulo} ${ident.name}`, `§7a ${player.name}, día ${so.noble.day}.`, '§8Sello real de lacre rojo.']); } catch {}
    giveItem(player, it);
  } catch {}
  social.recordDeed(player, 'title', { realm: social.realmArt(so.noble.realmName), realmId: realm?.id, unique: true, id: 'title:' + (realm?.id ?? '_') });
  const line = sayTo(player, d, ident, pick(deedFree ? ROYAL.title_given : ROYAL.title_bought), v);
  title(player, '§6§l\uE309 ' + genderize('Noble', d.gender, d.gender), `§f${so.noble.realmName}`);
  psound(player, 'ui.toast.challenge_complete', 1, 1);
  try { world.sendMessage(social.fixEs(`§6✦ ${player.name} ha sido ${g(d, 'nombrado noble', 'nombrada noble')} de ${social.realmArt(so.noble.realmName)} por ${v.soberano ?? v.titulo + ' ' + ident.name}.`)); } catch {}
  if (entity && valid(entity)) {
    life.say(entity, line, 5);
    try { particle(entity.dimension, 'minecraft:totem_particle', player.location); } catch {}
  }
  await info(player, '§l§6¡Ahora eres noble!', `§f"${line}"\n\n§7Has recibido el §6Título nobiliario§7. Los campesinos te tratarán de ${social.address(d, { cls: 'baja' }, player)}.`);
}

async function royalQuest(player, d, ident, realm, v) {
  const so = social.socialOf(d);
  so.royal = so.royal ?? {};
  const rid = realm?.id ?? '_';
  const today = world.getDay();
  if (so.royal[rid] === today) return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, pick(ROYAL.quest_busy), v)}"`);
  if (stageOf(d) === 'child') return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, 'Los encargos de la corona no son para niños. Crece y vuelve.', v)}"`);
  const rank = powerRank(d);
  const rng = seeded(hash(player.id + rid + today));
  const board = genGuildBoard(rng, 12).filter((q) => q.type !== 'deliver' && q.rank >= Math.max(0, rank - 1) && q.rank <= rank + 1);
  const q = board.length ? board[Math.floor(rng() * board.length)] : genGuildBoard(rng, 6).find((x) => x.type !== 'deliver');
  if (!q) return info(player, `§l${ident.name}`, '§fNo hay encargos para ti ahora mismo.');
  q.kind = 'guild';
  q.royal = true;
  q.royalBy = v.soberano ?? `${v.titulo} ${ident.name}`;
  q.realmId = realm?.id;
  q.title = 'Encargo real: ' + q.title;
  q.xp = Math.round(q.xp * 2);
  q.gold = Math.round(q.gold * 2.5);
  q.karma = Math.max(q.karma ?? 0, 5);
  const qs = ensureQuests(d);
  qs.guild.push(q);
  so.royal[rid] = today;
  dirty(player);
  msg(player, `§b✦ Encargo real aceptado: §f${q.title} §7(${q.desc})`);
  await info(player, '§l§bEncargo real', `§f"${sayTo(player, d, ident, pick(ROYAL.quest), v)}"\n\n§f§l${q.title}§r\n§7${q.desc}\n§7Recompensa: §a${q.xp} XP §6${q.gold} oro §e+ fama en ${social.realmArt(realm?.name)}\n§8(Aparece en tu Diario → Misiones)`);
}

/** Precio del perdón real (undefined si el reino no perdona). */
export function pardonCost(d, realm) {
  const stars = d.wanted?.stars ?? 0;
  if (!stars) return undefined;
  const st = clamp(Number(realm?.strictness ?? 1) || 0, 0, 2);
  if (st === 2) return undefined;
  if (st === 1 && stars >= 4) return undefined;
  return Math.round(stars * 120 * (st === 0 ? 1 : 2) * (1 + social.infamy(d, realm?.id) / 500));
}

async function pardonFlow(player, d, ident, realm, v) {
  const stars = d.wanted?.stars ?? 0;
  if (!stars) return info(player, `§l${ident.name}`, `§f"${sayTo(player, d, ident, pick(ROYAL.pardon_nothing), v)}"`);
  const cost = pardonCost(d, realm);
  if (cost === undefined) return info(player, `§l${ident.name}`, `§c"${sayTo(player, d, ident, pick(ROYAL.pardon_no), v)}"\n\n§8(En reinos implacables, o con crímenes de sangre en reinos firmes, no hay perdón.)`);
  const ok = await confirm(player, '§l§cPerdón real', `§f"${sayTo(player, d, ident, 'La corona puede ser misericordiosa... por un precio. {coste} de oro, a las arcas del reino.', { ...v, coste: cost })}"\n\n§7Tienes §6${d.gold} oro§7.`, `§6Pagar ${cost} oro`, '§cNo');
  if (!ok) return;
  if (!spendGold(player, cost)) return info(player, `§l${ident.name}`, '§c¿Me haces perder el tiempo? Vuelve cuando tengas el oro.');
  if (hooks.pardon) {
    try { hooks.pardon(player); } catch (e) { console.warn('[Aetheria] perdón: ' + e); }
  } else {
    d.wanted = undefined;
    try { player.removeTag('rpg_wanted'); } catch {}
  }
  addKarma(player, -3);
  dirty(player);
  await info(player, '§l§aPerdón real', `§f"${sayTo(player, d, ident, pick(ROYAL.pardon_ok), v)}"\n\n${social.fixEs(`§aLa guardia de ${social.realmArt(realm?.name)} ya no te busca.`)}`);
}

/** La ley del reino explicada por un guardia. */
async function lawInfo(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const realm = realmFor(ident, player);
  const st = clamp(Number(realm?.strictness ?? 1) || 0, 0, 2);
  const gov = GOVERNMENTS[realm?.government]?.name ?? 'Monarquía';
  const tax = Math.round(economy.salesTax(realm, d) * 100);
  const lines = [];
  lines.push(`§f"${sayTo(player, d, ident, pick(GUARD_LAW_INTRO), { reino: social.realmArt(realm?.name) })}"`);
  lines.push('');
  lines.push(`§7Reino: §f${realm?.name ?? 'Tierras libres'} §7· Gobierno: §f${gov}`);
  if (realm?.ruler?.name) lines.push(`§7Gobernante: §6${realm.ruler.title ?? ''} ${realm.ruler.name}`);
  lines.push(`§7Justicia: §f${STRICTNESS_NAMES[st]} §8— ${STRICTNESS[st]?.desc ?? ''}`);
  lines.push(`§7Impuesto real sobre las compras: §f${tax} %${d.social?.noble?.realmId === realm?.id ? ' §a(estás exento/a por tu título)' : ''}`);
  lines.push('');
  lines.push('§l§fDelitos y estrellas de búsqueda§r');
  for (const [k, c] of Object.entries(CRIMES)) lines.push(`§7• ${c.name}: §c${'★'.repeat(c.stars[st] ?? 1)}`);
  lines.push('');
  lines.push('§l§fCastigos§r');
  lines.push(`§7• 1★ (delito menor): §f${lawValue('humiliationSeconds')} s en la picota de la plaza, atado/a y a tomatazos.`);
  lines.push(`§7• 2-3★ (delito grave): §f${lawValue('jailMinutesSerious')} minutos de prisión.`);
  lines.push(`§7• 4-5★ (asesinato): §f${lawValue('jailMinutesMurder')} minutos de prisión.`);
  lines.push('§8Quien te vea robar correrá a avisar a la guardia. Si te buscan, entrégate o huye lejos.');
  const w = d.wanted;
  lines.push('');
  if ((w?.stars ?? 0) > 0) lines.push(`§c¡Te buscan! §f${'★'.repeat(w.stars)} §7por ${(w.crimes ?? []).map((c) => CRIMES[c]?.name?.toLowerCase()).filter(Boolean).slice(-3).join(', ')}.`);
  else lines.push('§aNo tienes cuentas pendientes con la guardia.');
  if (entity && valid(entity)) life.say(entity, pick(['La ley es la ley.', 'Cumple las normas y no habrá problemas.', 'Que no tenga que perseguirte.']), 3);
  await info(player, `§l§9\uE30A La ley de ${realm?.name ?? 'estas tierras'}`, genderize(lines.join('\n'), d.gender, ident.gender));
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
    const job = jobOf(ident);
    if (ownerId === killer.id) k = isFamilyRole(ident.role) ? -200 : -150;
    else if (isFamilyRole(ident.role)) k = -80;
    else if (STAFF_ROLES.has(ident.role) && !ident.settlement) k = ident.role === 'sombra' ? 20 : -60;
    else if (job === 'ladron') k = -5;
    else if (job === 'rey') k = -150;
    else if (job === 'mendigo' || ident.age === 'child') k = -70;
    else if (job === 'noble' || job === 'sacerdote') k = -60;
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
      try { if (e.hasTag('rpg_busy') || e.getDynamicProperty('rpg:act') === 'sleep') continue; } catch { continue; }
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
