// Vida de los asentamientos: horarios diarios de los NPCs (trabajo, comida, taberna, iglesia, casa, sueño,
// rondas de la guardia), bocadillos sobre la cabeza con frases según el contexto (hora, clima, oficio,
// economía, tu clase, tu fama, tus crímenes, chismes, el reino), conversaciones entre NPCs, reacciones a tu
// paso (reverencias, desprecios, vítores), rumores, jornales ("Trabajo por un día") y carteristas.
// Contrato §6.4: life.tick() cada segundo. NUNCA toca entidades con la etiqueta 'rpg_busy' (las controla la justicia).
import { world, system } from '@minecraft/server';
import { getP, dirty, W } from '../core/store.js';
import { msg, title, addGold, addXp, actionbar } from '../core/progression.js';
import { stageOf, karmaTitle } from '../core/profile.js';
import * as social from './social.js';
import * as economy from './economy.js';
import { currentWeather, moodOf, genderize, weatherHooks } from './chat.js';
import {
  JOBS, SCHEDULES, ACT_WAYPOINT, ACT_FALLBACK, OUTDOOR, BARK_TIME, BARK_WEATHER, BARK_ACT, BARK_JOB, BARK_CLASS, BARK_FAME,
  BARK_CRIME, BARK_CHILD, BARK_RACE, BARK_GOSSIP, BARK_REALM, BARK_OTHER_REALM, CONVOS, RUMOR_TEMPLATES, DAY_JOBS, TOOL,
} from '../data/social.js';
import { CRIMES } from '../data/laws.js';
import { cultureOf, kindLabel } from '../data/cultures.js';
import { raceOf } from '../data/races.js';
import { BOSSES } from '../data/mobs.js';
import { RANKS } from '../data/ranks.js';
import { jobLabel } from '../data/names.js';
import { fill } from '../util/text.js';
import { pick, hash, seeded, weighted, randInt, clamp, dist, dist2D, cardinal } from '../util/math.js';
import { particle, valid, countItem, removeWhere, removeItem, psound } from '../util/compat.js';
import { buttons, info, confirm } from '../util/ui.js';

export const NPC = 'rpg:npc';
const SCAN_RADIUS = 64;
const MAX_PER_TICK = 90;

/** Funciones que el integrador puede asignar. */
export const hooks = {
  questProgress: undefined, // (player, type, key, n) — para que los jornales cuenten como "trabajo"
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

function readIdent(e) {
  return economy.readIdent(e);
}

const identCache = new Map(); // entityId -> { ident, t }

/** Identidad del NPC con caché de 30 s (las bolsas se releen siempre del disco antes de escribir). */
export function cachedIdent(e, now = system.currentTick) {
  let id;
  try { id = e.id; } catch { return undefined; }
  const c = identCache.get(id);
  if (c && now - c.t < 600) return c.ident;
  const ident = readIdent(e);
  identCache.set(id, { ident, t: now });
  if (identCache.size > 1500) identCache.clear();
  return ident;
}

function isBusy(e) {
  try { return e.hasTag('rpg_busy'); } catch { return true; }
}

function getAct(e) {
  try { return e.getDynamicProperty('rpg:act'); } catch { return undefined; }
}

function setAct(e, act) {
  try { e.triggerEvent('rpg:act_' + act); } catch { return false; }
  try { e.setDynamicProperty('rpg:act', act); } catch {}
  return true;
}

function moodValue(ident) {
  let m = 'normal';
  try { m = moodOf(ident.id); } catch {}
  return m === 'feliz' ? 1 : m === 'enojado' ? 2 : 0;
}

function playerById(id) {
  try { return world.getAllPlayers().find((p) => p.id === id); } catch { return undefined; }
}

const R = (n) => Math.max(50, Math.round(n / 50) * 50);

/* ------------------------------------------------------------------ */
/* Marcadores (waypoints) de cada asentamiento                          */
/* ------------------------------------------------------------------ */

const WP_KINDS = ['field', 'forge', 'market', 'tavern', 'plaza', 'home', 'church', 'stocks', 'jail', 'jail_patrol', 'patrol_0', 'patrol_1', 'patrol_2', 'patrol_3', 'gate'];
const wpCache = new Map(); // sid -> { t, kinds: Set }
const wpKindMemo = new Map(); // wpId -> kind|null

function wpKindOf(wp) {
  let id;
  try { id = wp.id; } catch { return undefined; }
  if (wpKindMemo.has(id)) return wpKindMemo.get(id) ?? undefined;
  let kind;
  try {
    const tf = wp.getComponent('minecraft:type_family');
    const fams = tf?.getTypeFamilies?.() ?? [];
    kind = fams.find((f) => f.startsWith('rpg_wp_'))?.slice(7);
    if (!kind) for (const k of WP_KINDS) if (tf?.hasTypeFamily?.('rpg_wp_' + k)) { kind = k; break; }
  } catch {}
  wpKindMemo.set(id, kind ?? null);
  if (wpKindMemo.size > 5000) wpKindMemo.clear();
  return kind;
}

/** Tipos de marcador cargados de un asentamiento (caché 60 s). Conjunto vacío = sin información. */
export function wpKinds(s) {
  if (!s?.id) return undefined;
  const now = system.currentTick;
  const c = wpCache.get(s.id);
  if (c && now - c.t < 1200) return c.kinds;
  const kinds = new Set();
  let dim;
  try { dim = world.getDimension(s.dim ?? 'minecraft:overworld'); } catch {}
  let list = [];
  try { list = dim?.getEntities({ type: 'rpg:waypoint', tags: ['rpg_set_' + s.id] }) ?? []; } catch {}
  if (!list.length && s.center) {
    try { list = dim?.getEntities({ type: 'rpg:waypoint', location: s.center, maxDistance: (s.radius ?? 40) + 24 }) ?? []; } catch {}
  }
  for (const wp of list) {
    const k = wpKindOf(wp);
    if (k) kinds.add(k);
  }
  wpCache.set(s.id, { t: now, kinds });
  return kinds;
}

/* ------------------------------------------------------------------ */
/* Horarios                                                             */
/* ------------------------------------------------------------------ */

function entryAt(list, t) {
  let act = list[0][1];
  for (const [start, a] of list) if (t >= start) act = a;
  return act;
}

/** Perfil de horario de un NPC (o undefined si no tiene). */
export function profileOf(ident) {
  if (!ident) return undefined;
  const job = ident.job ?? ident.role;
  const spec = JOBS[job] ?? JOBS.aldeano;
  if (ident.owner) return ident.age === 'child' ? 'family_child' : 'family';
  if (ident.age === 'child') return ident.settlement ? 'child' : 'family_child';
  let prof = spec.sched;
  if (prof === 'guard') prof = hash(ident.id + 'turno') % 2 ? 'guard_night' : 'guard_day';
  if (!ident.settlement) {
    // Sin asentamiento: el personal del Gremio y los viajeros siguen su propio ritmo.
    if (prof === 'staff' || prof === 'ruler') return 'staff';
    if (job === 'aventurero' || job === 'bardo') return 'adventurer';
    if (prof === 'family') return 'family';
    return undefined;
  }
  return prof;
}

/**
 * Actividad que toca ahora. ctx = { time, day, now, weather, kinds (Set|undefined) }.
 * Devuelve el nombre de la actividad (idle, work_field, ..., sleep, patrol_0..3, patrol_jail) o undefined.
 */
export function activityFor(ident, ctx) {
  const prof = profileOf(ident);
  if (!prof) return undefined;
  const list = SCHEDULES[prof];
  if (!list) return undefined;
  const job = ident.job ?? ident.role;
  const spec = JOBS[job] ?? JOBS.aldeano;
  const h = hash(ident.id);
  const offset = h % 900; // cada NPC con su propio reloj (±45 s)
  const t = (((ctx.time ?? 0) - offset) % 24000 + 24000) % 24000;
  let act = entryAt(list, t);
  const dayRng = seeded(hash(ident.id + ':' + (ctx.day ?? 0) + ':' + Math.floor(t / 3000)));
  if (act === '@work') {
    act = spec.work;
    if (act === 'mix') act = ['work_field', 'work_market', 'plaza', 'work_field', 'work_forge'][h % 5];
    if (act === 'patrol') act = '@patrol';
  }
  if (act === '@lunch') act = dayRng() < 0.55 ? 'tavern' : 'plaza';
  if (act === '@afternoon') {
    if (job === 'noble') act = dayRng() < 0.5 ? 'work_market' : 'plaza';
    else if (job === 'aldeano') act = ['plaza', 'work_market', 'work_field'][Math.floor(dayRng() * 3)];
    else act = spec.work ?? 'plaza';
  }
  if (act === '@evening') {
    const pers = ident.pers;
    const r = dayRng();
    if (pers === 'alegre' || pers === 'bromista' || pers === 'coqueto' || pers === 'gruñón') act = r < 0.7 ? 'tavern' : 'plaza';
    else if (pers === 'sabio' || pers === 'tímido') act = r < 0.6 ? 'church' : 'home';
    else act = r < 0.4 ? 'tavern' : r < 0.7 ? 'church' : 'home';
  }
  if (act === '@thief') act = (Math.floor((ctx.time ?? 0) / 2000) + h) % 2 ? 'work_market' : 'tavern';
  if (act === '@patrol') act = 'patrol_' + ((Math.floor((ctx.now ?? 0) / 800) + h) % 4);
  // Lluvia: a cubierto (la guardia sigue con su ronda).
  if ((ctx.weather === 'Rain' || ctx.weather === 'Thunder') && OUTDOOR.has(act) && job !== 'guardia' && job !== 'carcelero' && prof !== 'staff') {
    act = job === 'sacerdote' || job === 'sacerdotisa' ? 'church' : h % 2 ? 'tavern' : 'home';
  }
  // Sin marcador para esa actividad en este asentamiento: alternativa.
  const kinds = ctx.kinds;
  if (kinds && kinds.size) {
    for (let i = 0; i < 4; i++) {
      const need = ACT_WAYPOINT[act];
      if (!need || kinds.has(need)) break;
      act = ACT_FALLBACK[act] ?? 'idle';
    }
  }
  return act;
}

/** Herramienta que debe llevar un guardia ahora (antorcha en el turno de noche). */
function guardTool(ident, time, act) {
  const job = ident.job ?? ident.role;
  if (job !== 'guardia' && job !== 'carcelero') return undefined;
  const night = time >= 12500 && time < 23500;
  if (night && act !== 'sleep' && act !== 'home') return TOOL.torch;
  if (job === 'carcelero') return TOOL.sword;
  return hash(ident.id) % 3 === 0 ? TOOL.sword : TOOL.spear;
}

const toolState = new Map(); // id -> tool

function onActChange(e, ident, before, act) {
  if (act === 'sleep') {
    try { e.setProperty('rpg:mood', 3); } catch {}
  } else if (before === 'sleep' || before === undefined || before === '') {
    try { e.setProperty('rpg:mood', moodValue(ident)); } catch {}
  }
}

let rot = 0;
const nearByPlayer = new Map(); // pid -> [{ e, ident, d }]

function scheduleTick(players, ctxBase) {
  const seen = new Set();
  const list = [];
  nearByPlayer.clear();
  for (const p of players) {
    let near = [];
    try { near = p.dimension.getEntities({ type: NPC, location: p.location, maxDistance: SCAN_RADIUS }); } catch { continue; }
    const mine = [];
    for (const e of near) {
      let id;
      try { id = e.id; } catch { continue; }
      let dd = 99;
      try { dd = dist(e.location, p.location); } catch {}
      mine.push({ e, d: dd });
      if (seen.has(id)) continue;
      seen.add(id);
      list.push(e);
    }
    nearByPlayer.set(p.id, mine);
  }
  const n = list.length;
  const count = Math.min(n, MAX_PER_TICK);
  rot = n ? rot % n : 0;
  for (let i = 0; i < count; i++) {
    const e = list[(rot + i) % n];
    try { tickNpc(e, ctxBase); } catch (err) { console.warn('[Aetheria] horario NPC: ' + err); }
  }
  rot += count;
}

const settlementMemo = new Map(); // sid -> { t, s }
function settlementOf(sid, now) {
  if (!sid) return undefined;
  const c = settlementMemo.get(sid);
  if (c && now - c.t < 200) return c.s;
  const s = social.getSettlementSafe(sid);
  settlementMemo.set(sid, { t: now, s });
  return s;
}

function tickNpc(e, base) {
  if (!valid(e)) return;
  if (!healNpc(e, isBusy(e))) {
    // La justicia (u otro sistema) lo controla: no se toca. Solo se olvida nuestra propia marca de
    // actividad para volver a lanzar su horario cuando lo suelten (ellos lo dejan en rpg:act_idle).
    if (getAct(e)) try { e.setDynamicProperty('rpg:act', ''); } catch {}
    return;
  }
  let ident = cachedIdent(e, base.now);
  if (!ident) return;
  // Bolsa diaria (se relee la identidad para no pisar cambios de otros sistemas).
  if (ident.wday !== base.day) {
    const fresh = readIdent(e);
    if (fresh) {
      economy.refreshWallet(e, fresh, base.day);
      identCache.set(e.id, { ident: fresh, t: base.now });
      ident = fresh;
    }
  }
  const s = settlementOf(ident.settlement, base.now);
  const ctx = { ...base, kinds: s ? wpKinds(s) : undefined };
  const act = activityFor(ident, ctx);
  if (!act) return;
  const cur = getAct(e);
  if (cur !== act) {
    if (setAct(e, act)) onActChange(e, ident, cur, act);
  }
  // Antorchas de la guardia nocturna.
  const tool = guardTool(ident, base.time, act);
  if (tool !== undefined && toolState.get(e.id) !== tool) {
    try { e.setProperty('rpg:tool', tool); toolState.set(e.id, tool); } catch {}
    if (toolState.size > 2000) toolState.clear();
  }
  // Durmiendo: "Zzz".
  if (act === 'sleep' && (base.n + (hash(e.id) % 3)) % 3 === 0) {
    try { particle(e.dimension, 'rpg:zzz', { x: e.location.x, y: e.location.y + 1.9, z: e.location.z }); } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Bocadillos                                                           */
/* ------------------------------------------------------------------ */

const bubbles = new Map(); // id -> { e, base, shown, until }
const lastBubble = new Map(); // npcId -> tick

function wrap(text, n = 42) {
  if (text.length <= n) return text;
  const words = text.split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 2).join('\n§f');
}

/**
 * Muestra un bocadillo (segunda línea del nombre) durante `secs` segundos y luego restaura el nombre.
 * Devuelve false si el NPC está ocupado por la justicia o no es válido.
 */
// Propiedad dinámica con el nombre original mientras se muestra un bocadillo: si el mundo se cierra a mitad,
// al volver se restaura (ver healNpc). La comparte economy.js para el nombre del carterista que huye.
const NT_KEY = 'rpg:nt';
const BUBBLE_MARK = '\n§f«';

export function say(e, text, secs = 4) {
  if (!valid(e) || !text) return false;
  try { if (isBusy(e) && !e.hasTag('rpg_fleeing')) return false; } catch { return false; }
  let cur;
  try { cur = e.nameTag ?? ''; } catch { return false; }
  const prev = bubbles.get(e.id);
  const base = prev && cur === prev.shown ? prev.base : cur;
  const first = String(base).split('\n')[0] || '§e?';
  const shown = `${first}\n§f«${wrap(social.fixEs(String(text)))}»`;
  try { e.nameTag = shown; } catch { return false; }
  if (!prev || prev.base !== base) {
    try {
      // El carterista que huye ya guardó su nombre real (economy.stealPurse): no pisarlo con "¡Al ladrón!".
      if (base && !String(base).includes(BUBBLE_MARK) && !e.hasTag('rpg_fleeing')) e.setDynamicProperty(NT_KEY, String(base));
    } catch {}
  }
  bubbles.set(e.id, { e, base, shown, until: system.currentTick + Math.round(secs * 20) });
  lastBubble.set(e.id, system.currentTick);
  if (lastBubble.size > 2000) lastBubble.clear();
  return true;
}

function endBubble(e, b) {
  try {
    if (!valid(e)) return;
    if (e.nameTag === b.shown) e.nameTag = b.base;
    // El carterista guarda ahí su nombre real mientras huye: no lo borres.
    if (!e.hasTag('rpg_fleeing')) e.setDynamicProperty(NT_KEY, undefined);
  } catch {}
}

/** Restaura ya el nombre del NPC si sigue mostrando nuestro bocadillo. */
export function clearBubble(e) {
  const b = bubbles.get(e?.id);
  if (!b) return;
  bubbles.delete(e.id);
  endBubble(e, b);
}

function bubbleTick(now) {
  for (const [id, b] of [...bubbles]) {
    if (now < b.until) {
      // Si la justicia se lo lleva, no estorbar.
      try { if (valid(b.e) && isBusy(b.e) && !b.e.hasTag('rpg_fleeing')) clearBubble(b.e); } catch {}
      continue;
    }
    bubbles.delete(id);
    endBubble(b.e, b);
  }
}

/**
 * Repara estados que solo viven en memoria y que un cierre del mundo a mitad dejaría colgados:
 * bocadillos que no se borraron y carteristas que huían cuando se recargaron los scripts.
 * Devuelve true si el NPC ha quedado libre para seguir su horario.
 */
function healNpc(e, busy) {
  if (busy) {
    let fleeing = false;
    try { fleeing = e.hasTag('rpg_fleeing'); } catch {}
    if (!fleeing) return false;
    try { if (economy.isFleeTracked(e.id)) return false; } catch { return false; }
    try { economy.releaseStaleThief(e); } catch {}
    return true;
  }
  if (bubbles.has(e.id)) return true;
  let tag;
  try { tag = e.nameTag; } catch { return true; }
  if (typeof tag === 'string' && tag.includes(BUBBLE_MARK)) {
    try {
      const base = e.getDynamicProperty(NT_KEY);
      e.nameTag = typeof base === 'string' && base ? base : tag.split('\n')[0];
      e.setDynamicProperty(NT_KEY, undefined);
    } catch {}
  }
  return true;
}

export function isBubbling(e) {
  try { return bubbles.has(e.id); } catch { return false; }
}

/* ------------------------------------------------------------------ */
/* Frases según el contexto                                             */
/* ------------------------------------------------------------------ */

function phaseOf(time) {
  if (time >= 23000 || time < 1000) return 'dawn';
  if (time < 5000) return 'morning';
  if (time < 7000) return 'noon';
  if (time < 11000) return 'afternoon';
  if (time < 13000) return 'evening';
  return 'night';
}

function realmOfIdent(ident, fallback) {
  const s = social.getSettlementSafe(ident?.settlement);
  return { s: s ?? fallback?.s, realm: (s ? social.realmOfSafe(s) : social.realmById(ident?.realm)) ?? fallback?.realm };
}

function varsFor(player, d, ident, place, extra = {}) {
  const realm = place.realm;
  const others = social.allRealmsSafe().filter((r) => r.id !== realm?.id);
  const glory = social.lastGlory(d, realm?.id);
  const race = raceOf(d?.race);
  return {
    p: player?.name ?? 'forastero',
    trato: d ? social.address(d, ident, player) : 'forastero',
    quien: glory?.who ?? player?.name ?? 'alguien',
    reino: social.realmArt(realm?.name),
    asentamiento: place.s?.name ?? 'este lugar',
    titulo: realm?.ruler?.title ?? 'el señor',
    gobernante: realm?.ruler?.name ?? 'de estas tierras',
    ...social.sovereign(realm),
    otro_reino: others.length ? social.realmArt(pick(others).name) : 'las tierras del norte',
    raza: race.name.toLowerCase(),
    raza_plural: race.plural.toLowerCase(),
    oficio: jobLabel(ident?.job ?? ident?.role, ident?.gender).toLowerCase(),
    ...extra,
  };
}

const G = (text, d, ident) => social.fixEs(genderize(text, d?.gender, ident?.gender));

/** Reacción de un NPC al jugador que pasa cerca: { line, important } o undefined. */
export function reactionLine(player, d, ident, place) {
  if (!d || !ident) return undefined;
  const job = ident.job ?? ident.role;
  const outlaw = job === 'ladron' || job === 'sombra';
  const v = varsFor(player, d, ident, place);
  const cls = social.npcCls(ident);
  const pc = social.playerClass(d);
  const opts = [];
  // Crímenes
  const wanted = (d.wanted?.stars ?? 0) > 0;
  const rec = d.record ?? {};
  if (wanted && !outlaw) return { line: G(fill(pick(BARK_CRIME.wanted), v), d, ident), important: true };
  if ((rec.asesinato ?? 0) + (rec.asesinato_guardia ?? 0) > 0 && !outlaw) opts.push([BARK_CRIME.murder, 4, true]);
  if ((rec.hurto ?? 0) + (rec.robo_casa ?? 0) + (rec.robo_noble ?? 0) > 0 && !outlaw) opts.push([BARK_CRIME.thief, 2.5, true]);
  if ((d.thief?.punished ?? 0) > 0) opts.push([BARK_CRIME.humiliated, 1.2, false]);
  if ((d.karma ?? 0) <= -400 && !outlaw) opts.push([BARK_CRIME.villain, 2, false]);
  // Fama
  const realmFame = social.fame(d, place.realm?.id);
  if (pc.overlay === 'leyenda') opts.push([BARK_FAME.leyenda, 4, true]);
  else if (pc.overlay === 'heroe') opts.push([BARK_FAME.heroe, 3.5, true]);
  else if (realmFame >= 120 && social.lastGlory(d, place.realm?.id)) opts.push([BARK_FAME.known, 2, true]);
  // Niño
  if (stageOf(d) === 'child' && ident.age !== 'child') opts.push([BARK_CHILD, 2, false]);
  // Raza
  const att = Number(place.realm?.attitudes?.[d.race]);
  if (Number.isFinite(att) && ident.race !== d.race) {
    if (att <= -0.45) opts.push([BARK_RACE.hate, 2, false]);
    else if (att >= 0.6) opts.push([BARK_RACE.love, 1, false]);
  }
  // Clase
  const byRank = BARK_CLASS[pc.rank] ?? {};
  const classLines = byRank[cls] ?? byRank.any;
  if (classLines) opts.push([classLines, pc.rank >= 4 || pc.rank === 0 ? 3 : 1.5, pc.rank >= 4]);
  if (!opts.length) return undefined;
  const [lines, , important] = weighted(opts.map((o) => [o, o[1]]));
  return { line: G(fill(pick(lines), v), d, ident), important };
}

/** Frase ambiental de un NPC (sin dirigirse al jugador). */
export function ambientLine(e, ident, player, d, place, ctx) {
  const job = ident.job ?? ident.role;
  const act = getAct(e) || 'idle';
  const v = varsFor(player, d, ident, place);
  const opts = [];
  const weather = ctx.weather;
  if (act === 'sleep') return pick(BARK_ACT.sleep);
  if (weather === 'Rain') opts.push([BARK_WEATHER.rain, ctx.weatherFresh ? 6 : 2]);
  else if (weather === 'Thunder') opts.push([BARK_WEATHER.thunder, ctx.weatherFresh ? 6 : 2.5]);
  else if (ctx.weatherFresh) opts.push([BARK_WEATHER.clear, 3]);
  opts.push([BARK_TIME[phaseOf(ctx.time)], 2]);
  const actKey = act.startsWith('patrol') ? 'patrol' : act;
  if (BARK_ACT[actKey]) opts.push([BARK_ACT[actKey], 3]);
  if (BARK_JOB[job]) opts.push([BARK_JOB[job], 3]);
  // Economía: pregones del evento de mercado.
  const ev = economy.marketEvent(place.s);
  if (ev) opts.push([ev.lines, job === 'mercader' || act === 'work_market' ? 5 : 2]);
  // Chismes de otros vecinos.
  const other = ctx.otherName && ctx.otherName !== ident.name ? ctx.otherName : undefined;
  if (other) opts.push([BARK_GOSSIP.map((l) => l.replace(/\{otro\}/g, other)), 1.5]);
  // El reino.
  const realm = place.realm;
  if (realm) {
    const pros = Number(realm.economy?.prosperity ?? 1);
    const cls = social.npcCls(ident);
    if (pros >= 1.1 && cls !== 'baja') opts.push([BARK_REALM.rich, 1]);
    if ((pros <= 0.9 || cls === 'baja') && job !== 'guardia' && job !== 'rey') opts.push([BARK_REALM.poor, 1]);
    if (realm.economy?.focus === 'guerra') opts.push([BARK_REALM.war, 0.8]);
    if (realm.economy?.focus === 'magia') opts.push([BARK_REALM.magic, 0.6]);
    if (Number(realm.strictness) === 2) opts.push([BARK_REALM.strict, 0.8]);
    if (Number(realm.strictness) === 0) opts.push([BARK_REALM.lax, 0.8]);
    if (social.allRealmsSafe().length > 1) opts.push([BARK_OTHER_REALM, 0.7]);
  }
  const lines = weighted(opts.map((o) => [o[0], o[1]]));
  return G(fill(pick(lines), v), d, ident);
}

/* ------------------------------------------------------------------ */
/* Vida ambiental: bocadillos, reacciones y conversaciones              */
/* ------------------------------------------------------------------ */

const reacted = new Map(); // pid|npcId -> tick
const playerBark = new Map(); // pid -> tick
const playerConvo = new Map(); // pid -> tick
const convos = new Map(); // npcId -> until
let weatherFreshUntil = 0;

let weatherHooked = false;
/** Se engancha al cambio de clima la primera vez que corre el bucle (evita dependencias al cargar). */
function hookWeather() {
  if (weatherHooked) return;
  weatherHooked = true;
  try {
    const prev = weatherHooks.onChange;
    weatherHooks.onChange = (...a) => {
      weatherFreshUntil = system.currentTick + 20 * 25;
      try { prev?.(...a); } catch {}
    };
  } catch {}
}

function free(e, now) {
  if (!valid(e) || isBusy(e) || bubbles.has(e.id)) return false;
  if ((convos.get(e.id) ?? 0) > now) return false;
  return true;
}

function ambientTick(players, base) {
  const now = base.now;
  for (const player of players) {
    try {
      const d = getP(player);
      if (!d) continue;
      try { if (player.hasTag('rpg_cinematic')) continue; } catch {}
      const near = (nearByPlayer.get(player.id) ?? []).filter((x) => x.d <= 16);
      if (!near.length) continue;
      const place = social.placeOf(player);
      const ctx = { ...base, weatherFresh: now < weatherFreshUntil };
      // 1) Reacción de alguien cercano al verte pasar.
      if (now - (playerBark.get(player.id) ?? -1e9) >= 60) {
        const close = near.filter((x) => x.d <= 7 && free(x.e, now)).sort((a, b) => a.d - b.d);
        let done = false;
        for (const x of close) {
          const ident = cachedIdent(x.e, now);
          if (!ident || ident.owner === player.id) continue;
          if (getAct(x.e) === 'sleep') continue;
          const key = player.id + '|' + x.e.id;
          if (now - (reacted.get(key) ?? -1e9) < 20 * 150) continue;
          reacted.set(key, now);
          if (reacted.size > 3000) reacted.clear();
          const pl = realmOfIdent(ident, place);
          const r = reactionLine(player, d, ident, pl);
          if (!r) continue;
          say(x.e, r.line, 4.5);
          try { x.e.lookAt(player.getHeadLocation()); } catch {}
          if (r.important) msg(player, `§e[${ident.name}] §f${r.line}`);
          playerBark.set(player.id, now);
          done = true;
          break;
        }
        // 2) Si nadie reacciona: una frase ambiental de alguien de alrededor.
        if (!done && Math.random() < 0.75) {
          const cand = near.filter((x) => free(x.e, now) && now - (lastBubble.get(x.e.id) ?? -1e9) > 20 * 15);
          if (cand.length) {
            const x = pick(cand);
            const ident = cachedIdent(x.e, now);
            if (ident) {
              const others = near.filter((o) => o.e !== x.e).map((o) => cachedIdent(o.e, now)?.name).filter(Boolean);
              const line = ambientLine(x.e, ident, player, d, realmOfIdent(ident, place), { ...ctx, otherName: others.length ? pick(others) : undefined });
              if (line) say(x.e, line, 4);
              playerBark.set(player.id, now);
            }
          }
        }
      }
      // 3) Conversaciones entre NPCs.
      if (now - (playerConvo.get(player.id) ?? -1e9) >= 20 * 14 && Math.random() < 0.6) {
        if (startConversation(player, d, near, place, ctx)) playerConvo.set(player.id, now);
      }
    } catch (e) { console.warn('[Aetheria] vida ambiental: ' + e); }
  }
}

function topicFor(a, b, ia, ib, ctx, player, near) {
  const ja = ia.job ?? ia.role;
  const jb = ib.job ?? ib.role;
  const ca = social.npcCls(ia);
  const cb = social.npcCls(ib);
  const acts = [getAct(a), getAct(b)];
  const opts = [['any', 2]];
  if ((ja === 'guardia' || ja === 'carcelero') && (jb === 'guardia' || jb === 'carcelero')) opts.push(['guard', 6]);
  if (ca === 'alta' && cb === 'alta') opts.push(['noble', 6]);
  if ((ca === 'alta') !== (cb === 'alta') && (ca === 'baja' || cb === 'baja')) opts.push(['noble_low', 4]);
  if (acts.includes('tavern')) opts.push(['tavern', 4]);
  if (acts.some((x) => x && x.startsWith('work'))) opts.push(['work', 3]);
  if (ctx.event) opts.push(['prices', 3]);
  if (ctx.time >= 13000 && ctx.time < 23000) opts.push(['night', 2]);
  if (ctx.weather === 'Rain' || ctx.weather === 'Thunder') opts.push(['rain', 3]);
  if (player && near && dist(a.location, player.location) <= 12) opts.push(['player', 1.5]);
  return weighted(opts);
}

function playerRumor(d, place) {
  const glory = social.lastGlory(d, place.realm?.id);
  const shame = social.lastShame(d);
  if (shame && Math.random() < 0.5) return 'Dicen que ' + shame.text.charAt(0).toLowerCase() + shame.text.slice(1).replace(/^(\w+)/, (w) => w) + '.';
  if (glory) return `Dicen que es ${glory.who}.`;
  return 'Dicen que es de buena familia... o eso cuentan.';
}

/** Inicia una charla de 2–3 frases entre dos NPCs cercanos. Devuelve true si empezó. */
export function startConversation(player, d, near, place, ctx) {
  const now = ctx.now ?? system.currentTick;
  const pool = near.filter((x) => free(x.e, now) && getAct(x.e) !== 'sleep');
  let pair;
  for (let i = 0; i < pool.length && !pair; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      try {
        if (dist(pool[i].e.location, pool[j].e.location) <= 4.5) { pair = [pool[i].e, pool[j].e]; break; }
      } catch {}
    }
  }
  if (!pair) return false;
  const [a, b] = pair;
  const ia = cachedIdent(a, now);
  const ib = cachedIdent(b, now);
  if (!ia || !ib) return false;
  const pl = realmOfIdent(ia, place);
  const ev = economy.marketEvent(pl.s);
  const topic = topicFor(a, b, ia, ib, { ...ctx, event: ev }, player, near);
  let script = pick(CONVOS[topic] ?? CONVOS.any);
  // Noble y plebeyo: que el noble sea quien responde con desdén.
  let first = a;
  let second = b;
  if (topic === 'noble_low' && social.npcCls(ia) === 'alta') { first = b; second = a; }
  const fi = first === a ? ia : ib;
  const si = first === a ? ib : ia;
  const others = near.map((x) => cachedIdent(x.e, now)?.name).filter((n) => n && n !== ia.name && n !== ib.name);
  const pc = d ? social.playerClass(d) : undefined;
  const v = {
    a: fi.name, b: si.name, otro: others.length ? pick(others) : 'el herrero',
    evento: ev?.name?.toLowerCase() ?? 'los precios',
    p: player?.name ?? 'ese forastero',
    clase_jugador: pc ? pc.name.toLowerCase() : 'forastero',
    fama_jugador: d ? social.fameTier(social.fame(d, pl.realm?.id)).name.toLowerCase() : 'un desconocido',
    rumor_jugador: d ? playerRumor(d, pl) : 'Nada bueno, seguro.',
  };
  const until = now + 20 * (script.length * 3.6 + 1);
  convos.set(a.id, until);
  convos.set(b.id, until);
  if (convos.size > 500) for (const [k, t] of convos) if (t < now) convos.delete(k);
  script.forEach((line, i) => {
    const speaker = i % 2 === 0 ? first : second;
    const listener = i % 2 === 0 ? second : first;
    const sIdent = i % 2 === 0 ? fi : si;
    const text = genderize(fill(line, v), d?.gender, sIdent.gender);
    system.runTimeout(() => {
      try {
        if (!valid(speaker) || isBusy(speaker)) return;
        try { speaker.lookAt(listener.getHeadLocation()); } catch {}
        say(speaker, text, 3.4);
      } catch {}
    }, Math.max(1, Math.round(i * 72)));
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Rumores                                                              */
/* ------------------------------------------------------------------ */

/** Un rumor sobre el mundo real del juego: asentamientos, mazmorras, jefes, crímenes, el reino... */
export function rumour(player, ident, rng = Math.random) {
  const T = RUMOR_TEMPLATES;
  const opts = [];
  let here = { s: undefined, realm: undefined };
  try { here = social.nearPlace(player); } catch {}
  const s = social.getSettlementSafe(ident?.settlement) ?? here.s;
  const realm = (s ? social.realmOfSafe(s) : undefined) ?? here.realm;
  const loc = player.location;
  const dimId = player.dimension.id;
  // Otros asentamientos cercanos.
  const others = social.allSettlementsSafe()
    .filter((x) => x.id !== s?.id && x.center && (x.dim ?? 'minecraft:overworld') === dimId)
    .map((x) => [x, dist2D(x.center, loc)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
  if (others.length) {
    opts.push([() => {
      const [x, dd] = pick(others, rng);
      return fill(pick(T.settlement, rng), {
        dir: cardinal(loc, x.center).toLowerCase(), dist: R(dd), nombre: x.name,
        tipo: kindLabel(x.culture, x.kind).toLowerCase(), cultura: cultureOf(x.culture).people, chisme: pick(T.settlement_gossip, rng),
      });
    }, 3]);
  }
  // Mazmorras activas.
  const dgs = (W().dungeons ?? []).filter((g) => g && g.state !== 'cleared' && typeof g.x === 'number' && Math.hypot(g.x - loc.x, g.z - loc.z) < 1500);
  if (dgs.length) {
    opts.push([() => {
      const g = pick(dgs, rng);
      return fill(pick(T.dungeon, rng), { rango: RANKS[g.rank] ?? '?', dir: cardinal(loc, g).toLowerCase(), dist: R(Math.hypot(g.x - loc.x, g.z - loc.z)) });
    }, 3]);
  }
  // Jefes.
  opts.push([() => fill(pick(T.boss, rng), { jefe: pick(Object.values(BOSSES), rng).name }), 1.5]);
  // Crímenes y castigos de otros jugadores.
  const wanted = [];
  const robbed = [];
  for (const p of world.getAllPlayers()) {
    if (p.id === player.id) continue;
    const pd = getP(p);
    if (!pd) continue;
    if ((pd.wanted?.stars ?? 0) > 0) wanted.push([p.name, (pd.wanted.crimes ?? []).slice(-1)[0]]);
    if (pd.social?.robbed?.day === world.getDay()) robbed.push(p.name);
  }
  if (wanted.length) opts.push([() => { const [who, c] = pick(wanted, rng); return fill(pick(T.crime, rng), { nombre: who, crimen: (CRIMES[c]?.name ?? 'robo').toLowerCase() }); }, 3]);
  if (robbed.length) opts.push([() => fill(pick(T.robbed, rng), { nombre: pick(robbed, rng) }), 2]);
  // El reino.
  if (realm) {
    const pros = Number(realm.economy?.prosperity ?? 1);
    opts.push([() => fill(pick(T.realm, rng), {
      reino: social.realmArt(realm.name), ...social.sovereign(realm),
      mano: ['blanda', 'firme', 'de hierro'][clamp(Number(realm.strictness ?? 1) || 0, 0, 2)],
      opinion: pros >= 1.1 ? T.realm_opinion.rich : pros <= 0.85 ? T.realm_opinion.poor : T.realm_opinion.mid,
    }).replace(/\s+/g, ' ').trim(), 2]);
  }
  const otherRealms = social.allRealmsSafe().filter((r) => r.id !== realm?.id);
  if (otherRealms.length) {
    opts.push([() => {
      const r = pick(otherRealms, rng);
      return social.fixEs(fill(pick(T.other_realm, rng), { otro_reino: social.realmArt(r.name), otro_soberano: social.sovereign(r).soberano, otro_pueblo: cultureOf(r.culture).people }));
    }, 1.5]);
  }
  // Carteristas y mercado.
  opts.push([() => pick(T.thieves, rng), 0.8]);
  const ev = economy.marketEvent(s);
  if (ev) opts.push([() => fill(T.market[0], { evento: ev.name.toLowerCase(), linea: pick(ev.lines, rng) }), 2]);
  const fn = weighted(opts, rng);
  try { return social.fixEs(fn()); } catch { return pick(T.thieves, rng); }
}

/* ------------------------------------------------------------------ */
/* Llegada a un asentamiento                                            */
/* ------------------------------------------------------------------ */

const enterMemo = new Map(); // pid|sid -> day

/** Llamar al entrar en un asentamiento (settlements.hooks.onEnter): pregón del mercado y reputación local. */
export function onEnterSettlement(player, s) {
  if (!player || !s?.id) return;
  const d = getP(player);
  if (!d) return;
  const day = world.getDay();
  const key = player.id + '|' + s.id;
  if (enterMemo.get(key) === day) return;
  enterMemo.set(key, day);
  const realm = social.realmOfSafe(s);
  const ev = economy.marketEvent(s);
  if (ev) msg(player, `§e[Pregonero de ${s.name}] §f¡Oíd, oíd! ${pick(ev.lines)} §7(${ev.name})`);
  const f = social.fame(d, realm?.id);
  const inf = social.infamy(d, realm?.id);
  const pc = social.playerClass(d);
  if (inf >= 100 && inf > f) msg(player, `§c${s.name}: §7la gente cierra las ventanas al verte llegar...`);
  else if (f >= 250) msg(player, `§6${s.name}: §7los vecinos murmuran tu nombre y te señalan con admiración.`);
  else if (pc.rank >= 5) msg(player, `§6${s.name}: §7los guardias se cuadran a tu paso, ${social.address(d, undefined, player)}.`);
  else if (pc.rank === 0) msg(player, `§8${s.name}: §7un guardia te mira con desconfianza.`);
  const tax = Math.round(economy.salesTax(realm, d) * 100);
  if (realm && tax > 0 && !d.social?.taxSeen?.[realm.id]) {
    const so = social.socialOf(d);
    so.taxSeen = so.taxSeen ?? {};
    so.taxSeen[realm.id] = true;
    dirty(player);
    msg(player, `§7En ${social.realmArt(realm.name)} se cobra un impuesto real del §f${tax} %§7 sobre las compras.`);
  }
}

/* ------------------------------------------------------------------ */
/* Jornales: "Trabajo por un día"                                       */
/* ------------------------------------------------------------------ */

const CROPS = new Set(['minecraft:wheat', 'minecraft:carrot', 'minecraft:potato', 'minecraft:beetroot']);

function jobOf(d) {
  const j = d?.social?.job;
  if (!j) return undefined;
  if (j.day !== world.getDay()) return undefined;
  return j;
}

/** ¿Este NPC ofrece jornal? */
export function offersDayJob(ident) {
  return !!DAY_JOBS[ident?.job ?? ident?.role] && !ident?.owner;
}

/**
 * Llamar desde el mismo sitio que quests.progress (hooks.questProgress): cuenta la cosecha de los jornales
 * y registra hazañas automáticas al derrotar jefes ('boss') y limpiar mazmorras ('dungeon', extra = rango).
 */
export function onProgress(player, type, key, n = 1, extra) {
  try {
    if (type === 'boss') social.deedForBoss(player, key);
    else if (type === 'dungeon') social.deedForDungeon(player, extra);
  } catch (e) { console.warn('[Aetheria] hazaña: ' + e); }
  const d = getP(player);
  if (!d) return;
  // quests.progress ya ha marcado las misiones completadas: el encargo real cuenta como hazaña al momento.
  try { royalCheck(player, d); } catch (e) { console.warn('[Aetheria] encargo real: ' + e); }
  if (type !== 'harvest') return;
  const j = jobOf(d);
  if (!j || j.type !== 'harvest' || j.paid) return;
  if (j.sid) {
    // Solo cuenta lo cosechado en los campos de ese asentamiento (o justo a sus afueras).
    const p = social.nearPlace(player, 24);
    if (p.s?.id !== j.sid) return;
  }
  const before = j.have;
  j.have = Math.min(j.need, (j.have ?? 0) + n);
  dirty(player);
  if (j.have >= j.need && before < j.need) {
    msg(player, `§a✔ Jornal: ya has cosechado lo suficiente. §7Vuelve con §f${j.npcName}§7 a por tu paga.`);
    psound(player, 'random.orb', 0.6, 1.5);
  } else if (j.have < j.need && j.have % 4 === 0) actionbar(player, `§eJornal: §f${j.have}/${j.need} cultivos`);
}

/** Menú del jornal con un granjero, herrero o tabernero. */
export async function dayJobMenu(player, ident, entity) {
  const d = getP(player);
  if (!d) return;
  const spec = DAY_JOBS[ident.job ?? ident.role];
  if (!spec) return;
  const so = social.socialOf(d);
  const today = world.getDay();
  const j = jobOf(d);
  const v = { p: player.name, trato: social.address(d, ident, player) };
  if (j && j.npcId === ident.id) {
    if (j.paid) return info(player, `§l${ident.name}`, '§fYa has cobrado tu jornal de hoy. ¡Vuelve mañana si quieres más trabajo!');
    return turnIn(player, d, ident, entity, j, spec);
  }
  if (j && !j.paid) return info(player, `§l${ident.name}`, `§fYa tienes trabajo hoy con §e${j.npcName}§f: ${j.desc}\n\n§7Termínalo antes de buscar otro.`);
  if (so.jobDay === today) return info(player, `§l${ident.name}`, '§fYa has trabajado hoy. Descansa, que mañana habrá más.');
  // Oferta
  let s;
  try { s = social.getSettlementSafe(ident.settlement) ?? social.placeOf(player).s; } catch {}
  const realm = social.realmOfSafe(s);
  const pros = clamp(Number(realm?.economy?.prosperity ?? 1) || 1, 0.5, 1.5);
  const need = randInt(spec.need[0], spec.need[1]);
  let wage = Math.round(randInt(spec.wage[0], spec.wage[1]) * (0.7 + 0.3 * pros));
  if (stageOf(d) === 'child') wage = Math.max(3, Math.round(wage * 0.6));
  const item = spec.items ? pick(spec.items) : undefined;
  const desc = fill(spec.desc, { n: need, s: s?.name ?? 'el pueblo', item: item?.[1] ?? '' });
  const ok = await confirm(player, `§l§6${spec.title}`,
    `§e${ident.name}: §f${genderize(fill(pick(spec.offer), v), d.gender, ident.gender)}\n\n§7Tarea: §f${desc}\n§7Paga: §6${wage} oro §7+ experiencia\n§8(Un jornal por día.)`,
    '§aAcepto el trabajo', '§cAhora no');
  if (!ok) return;
  so.job = { npcId: ident.id, npcName: ident.name, job: ident.job ?? ident.role, type: spec.type, need, have: 0, wage, xp: spec.xp, sid: s?.id, sname: s?.name, day: today, item: item?.[0], itemName: item?.[1], desc, served: [] };
  so.jobDay = today;
  dirty(player);
  msg(player, `§6✦ Jornal aceptado: §f${desc} §7(Paga: ${wage} oro)`);
}

async function turnIn(player, d, ident, entity, j, spec) {
  let complete = (j.have ?? 0) >= j.need;
  let note = '';
  if (!complete && j.type === 'ore' && j.item) {
    const have = countItem(player, j.item);
    if (have >= j.need) {
      removeItem(player, j.item, j.need);
      j.have = j.need;
      complete = true;
    } else note = `§7Tienes §f${have}/${j.need}§7 de ${j.itemName}.`;
  }
  if (!complete && j.type === 'harvest') {
    // Si no se registró la cosecha, también vale traer los cultivos en la bolsa.
    let total = 0;
    for (const c of CROPS) total += countItem(player, c);
    if (total >= j.need) {
      removeWhere(player, (t) => CROPS.has(t), j.need);
      j.have = j.need;
      complete = true;
    } else note = `§7Llevas §f${j.have ?? 0}/${j.need}§7 cultivos cosechados. §8(También me vale que me traigas ${j.need} de trigo, zanahorias, patatas o remolachas.)`;
  }
  if (!complete && j.type === 'serve') note = `§7Has servido a §f${j.have ?? 0}/${j.need}§7 clientes. Habla con ellos y elige «Servir una jarra».`;
  if (!complete) return info(player, `§l${ident.name}`, `§f${j.desc}\n\n${note}`);
  j.paid = true;
  addGold(player, j.wage);
  addXp(player, j.xp ?? 25, 'quest');
  economy.walletAdd(entity, ident, -Math.min(ident.wallet ?? 0, j.wage));
  const rel = d.rel?.[ident.id];
  if (rel) rel.p = Math.min(1000, (rel.p ?? 0) + 8);
  const so = social.socialOf(d);
  so.jobsDone = (so.jobsDone ?? 0) + 1;
  dirty(player);
  try { hooks.questProgress?.(player, 'work', j.job, 1); } catch {}
  if (so.jobsDone % 5 === 1) { try { social.recordDeed(player, 'work', { key: 'jornal' + so.jobsDone }); } catch {} }
  const line = genderize(pick(spec.done), d.gender, ident.gender);
  if (entity && valid(entity)) say(entity, line, 4);
  psound(player, 'random.levelup', 0.6, 1.4);
  await info(player, `§l${ident.name}`, `§f${line}\n\n§6+${j.wage} oro §a+${j.xp ?? 25} XP §d+relación`);
}

/** ¿Puede el jugador servir una jarra a este NPC (jornal de taberna)? */
export function canServe(player, ident) {
  const d = getP(player);
  const j = jobOf(d);
  if (!j || j.type !== 'serve' || j.paid || (j.have ?? 0) >= j.need) return false;
  if (!ident || ident.id === j.npcId || ident.owner) return false;
  if ((j.served ?? []).includes(ident.id)) return false;
  if (j.sid && ident.settlement && ident.settlement !== j.sid) return false;
  return true;
}

/** Servir una jarra a un cliente (jornal de taberna). */
export async function serveDrink(player, ident, entity) {
  const d = getP(player);
  const j = jobOf(d);
  if (!d || !canServe(player, ident)) return;
  j.served = [...(j.served ?? []), ident.id];
  j.have = (j.have ?? 0) + 1;
  const rel = d.rel?.[ident.id];
  if (rel) rel.p = Math.min(1000, (rel.p ?? 0) + 3);
  let tip = 0;
  if (Math.random() < 0.5) {
    tip = Math.min(ident.wallet ?? 3, randInt(1, 4));
    if (tip > 0) { economy.walletAdd(entity, ident, -tip); addGold(player, tip, true); }
  }
  dirty(player);
  const thanks = pick(['¡Gracias, {trato}! Justo lo que necesitaba.', '¡Ah, cerveza fresca! ¡Salud!', '¡Por fin! Me moría de sed.', '¿Esto es hidromiel? ¡Que los dioses te bendigan!']);
  const line = genderize(fill(thanks, { trato: social.address(d, ident, player) }), d.gender, ident.gender);
  if (entity && valid(entity)) say(entity, line, 3.5);
  psound(player, 'random.drink', 0.7, 1.1);
  msg(player, `§e[${ident.name}] §f${line}${tip ? ` §6(+${tip} de propina)` : ''} §7— Jornal: ${j.have}/${j.need}`);
  if (j.have >= j.need) msg(player, `§a✔ Has servido a todos. §7Vuelve con §f${j.npcName}§7 a por tu paga.`);
}

/* ------------------------------------------------------------------ */
/* Bucle principal                                                      */
/* ------------------------------------------------------------------ */

let n = 0;

/** Cada segundo (contrato §6.4). */
export function tick() {
  n++;
  bindEconomy();
  hookWeather();
  let players;
  try { players = world.getAllPlayers().filter((p) => { try { return !!getP(p); } catch { return false; } }); } catch { return; }
  const now = system.currentTick;
  try { bubbleTick(now); } catch (e) { console.warn('[Aetheria] bocadillos: ' + e); }
  if (!players.length) return;
  let time = 0;
  let day = 0;
  try { time = world.getTimeOfDay(); day = world.getDay(); } catch {}
  const base = { time, day, now, n, weather: currentWeather('minecraft:overworld') };
  try { scheduleTick(players, base); } catch (e) { console.warn('[Aetheria] horarios: ' + e); }
  if (n % 2 === 0) {
    try { ambientTick(players, base); } catch (e) { console.warn('[Aetheria] ambiente: ' + e); }
  }
  try { economy.thiefTick(players); } catch (e) { console.warn('[Aetheria] carteristas: ' + e); }
  if (n % 5 === 0) {
    for (const p of players) {
      try {
        const d = getP(p);
        social.classTick(p, d);
        royalCheck(p, d);
      } catch (e) { console.warn('[Aetheria] clase social: ' + e); }
    }
  }
}

/** Hazaña al completar un encargo real (misiones con `royal`) y al ascender en el Gremio. */
function royalCheck(player, d) {
  const so = social.socialOf(d);
  const gr = d?.guild?.member ? d.guild.rank ?? 0 : -1;
  if (so && gr > (so.gRank ?? (gr >= 0 ? gr : -1))) {
    for (let r = Math.max(2, (so.gRank ?? 0) + 1); r <= gr; r++) { try { social.deedForGuildRank(player, r); } catch {} }
  }
  if (so && so.gRank !== gr) { so.gRank = gr; dirty(player); }
  for (const q of d?.quests?.guild ?? []) {
    if (!q.royal || !q.done || q.deedDone) continue;
    q.deedDone = true;
    dirty(player);
    try { social.addDeed(player, social.deed('royal', { ruler: q.royalBy ?? 'la corona', realmId: q.realmId, key: q.id })); } catch {}
  }
}

/** after entityHurt (contrato: conectar desde main.js). */
export function onEntityHurt(ev) {
  try { economy.onEntityHurt(ev); } catch (e) { console.warn('[Aetheria] ladrón: ' + e); }
}

/** Al salir un jugador. */
export function forgetPlayer(player) {
  try { economy.forgetPlayer(player); } catch {}
  playerBark.delete(player.id);
  playerConvo.delete(player.id);
  nearByPlayer.delete(player.id);
}

/*
 * Enlace con economy.js. Se hace de forma perezosa: entre economy, social, chat y life hay importaciones
 * circulares y, según el orden en que main.js importe los módulos, `economy.hooks` podría no estar
 * inicializado todavía al evaluar este archivo (TDZ). Se reintenta en cada tick hasta lograrlo.
 */
let economyBound = false;
function bindEconomy() {
  if (economyBound) return;
  try {
    economy.hooks.bubble = (e, text, secs) => say(e, text, secs);
    economyBound = true;
  } catch {}
}
bindEconomy();

/** Acceso para pruebas. */
export const _t = { bubbles, convos, identCache, wpCache, reacted, playerBark, playerConvo, nearByPlayer, enterMemo, setWeatherFresh: (t) => { weatherFreshUntil = t; } };
