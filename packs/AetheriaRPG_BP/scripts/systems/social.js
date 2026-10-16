// Sociedad: clase social del jugador, fama e infamia por reino, hazañas (diario de gestas), actitud de los NPCs
// según la clase, la raza, el karma y la fama, y el tratamiento con que se dirigen a ti ("mi señor", "pordiosero"...).
// Contrato §6.4: playerClass(d), fame(d, realmId), addDeed(player, deed), hooks.
import { world, system } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { msg, title } from '../core/progression.js';
import { stageOf, karmaTitle } from '../core/profile.js';
import * as S from './settlements.js';
import { raceOf } from '../data/races.js';
import {
  CLASSES, CLASS_BY_ID, CLASS_RULES, OVERLAYS, FAME_TIERS, INFAMY_TIERS, ADDRESS, DEEDS,
} from '../data/social.js';
import { genderize } from './chat.js';
import { BOSSES } from '../data/mobs.js';
import { RANKS } from '../data/ranks.js';
import { CRIMES } from '../data/laws.js';
import { fill } from '../util/text.js';
import { clamp, dist2D } from '../util/math.js';
import { psound } from '../util/compat.js';

/** Funciones que el integrador puede asignar. */
export const hooks = {
  onClassChange: undefined, // (player, before, after) — p. ej. anuncios o logros
  onDeed: undefined, // (player, deed) — tras registrar una hazaña
};

const DEED_CAP = 50;

/* ------------------------------------------------------------------ */
/* Datos del jugador                                                    */
/* ------------------------------------------------------------------ */

/** Bloque social de los datos del jugador (lo crea si falta). */
export function socialOf(d) {
  if (!d) return undefined;
  const so = (d.social = d.social ?? {});
  so.fame = so.fame ?? {};
  so.infamy = so.infamy ?? {};
  so.deeds = so.deeds ?? [];
  so.trade = so.trade ?? { lvl: 1, xp: 0, bought: 0, sold: 0, saved: 0 };
  return so;
}

const gw = (d, m, f) => (d?.gender === 'f' ? f : m);

/* ------------------------------------------------------------------ */
/* Asentamientos y reinos (módulo settlements, contrato §6.1)           */
/* ------------------------------------------------------------------ */

const asList = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);

export function settlementAtSafe(dimId, loc) {
  try { return S.settlementAt?.(dimId, loc) ?? undefined; } catch { return undefined; }
}
export function getSettlementSafe(id) {
  if (!id) return undefined;
  if (typeof id === 'object') return id;
  try { return S.getSettlement?.(id) ?? undefined; } catch { return undefined; }
}
export function realmOfSafe(s) {
  if (!s) return undefined;
  try { return S.realmOf?.(s) ?? undefined; } catch { return undefined; }
}
export function nearestSettlementSafe(dimId, loc, maxDist) {
  try { return S.nearestSettlement?.(dimId, loc, maxDist) ?? undefined; } catch { return undefined; }
}
export function allSettlementsSafe() {
  try { return asList(S.allSettlements?.()); } catch { return []; }
}
export function allRealmsSafe() {
  try { return asList(S.allRealms?.()); } catch { return []; }
}
export function realmById(id) {
  if (!id) return undefined;
  return allRealmsSafe().find((r) => r.id === id);
}
/** Saca a un habitante del censo de su asentamiento (se casa con el jugador o se marcha): no se repone. */
export function releaseResidentSafe(sid, fid) {
  if (!sid || !fid) return false;
  try { return !!S.releaseResident?.(sid, fid); } catch { return false; }
}

const placeCache = new Map(); // pid -> { tick, s, realm }

/** Asentamiento (dentro de su radio) y reino donde está el jugador. Caché de 1 s. */
export function placeOf(player, maxAge = 20) {
  const now = system.currentTick;
  const c = placeCache.get(player.id);
  if (c && now - c.tick < maxAge) return c;
  let s;
  try { s = settlementAtSafe(player.dimension.id, player.location); } catch {}
  const out = { tick: now, s, realm: realmOfSafe(s) };
  placeCache.set(player.id, out);
  if (placeCache.size > 200) placeCache.clear();
  return out;
}

/** Asentamiento cercano (dentro o a menos de `extra` bloques del borde). */
export function nearPlace(player, extra = 48) {
  const p = placeOf(player);
  if (p.s) return p;
  let s;
  try { s = nearestSettlementSafe(player.dimension.id, player.location, 400); } catch {}
  if (s?.center && dist2D(s.center, player.location) <= (s.radius ?? 40) + extra) return { s, realm: realmOfSafe(s), near: true };
  return { s: undefined, realm: undefined };
}

const REALM_ART = {
  reino: 'el', imperio: 'el', principado: 'el', república: 'la', liga: 'la', concilio: 'el', mancomunidad: 'la', horda: 'la',
  tribus: 'las', dominio: 'el', teocracia: 'la', sagrado: 'el', santa: 'la', clan: 'el', clanes: 'los', fortaleza: 'la', consejo: 'el',
};

/** Nombre del reino con artículo ("el Reino de Valdoria", "los Clanes de Khazad"). */
export function realmArt(name) {
  if (!name) return 'el reino';
  const a = REALM_ART[String(name).split(' ')[0].toLowerCase()];
  return a ? `${a} ${name}` : String(name);
}

const FEM_WORDS = new Set(['reina', 'araña', 'bruja', 'hidra', 'dama', 'matriarca', 'emperatriz', 'sombra']);

/** "al Liche Eterno", "a la Reina Araña", "a Azazel" (complemento directo con artículo). */
export function withA(name) {
  const n = String(name ?? 'aquel monstruo');
  if (/^El /.test(n)) return 'al ' + n.slice(3);
  if (/^La /.test(n)) return 'a la ' + n.slice(3);
  const first = n.split(/[\s,]/)[0].toLowerCase();
  if (n.includes(',')) return 'a ' + n;
  if (FEM_WORDS.has(first)) return 'a la ' + n;
  return 'al ' + n;
}

/** Arreglos del español al rellenar plantillas: "de el" → "del", "a el" → "al", mayúscula inicial. */
export function fixEs(text) {
  return String(text ?? '')
    .replace(/\bde el\b/g, 'del').replace(/\bDe el\b/g, 'Del')
    .replace(/\ba el\b/g, 'al').replace(/\bA el\b/g, 'Al')
    .replace(/^([¡¿"«*\s]*)([a-záéíóúñ])/, (m, pre, c) => pre + c.toUpperCase());
}

/**
 * Nombre del gobernante con artículo: { soberano: 'el Rey Alfonso', Soberano: 'El Rey Alfonso',
 * al_soberano: 'al Rey Alfonso', del_soberano: 'del Rey Alfonso' } (o 'la Reina...', 'a la Reina...').
 */
export function sovereign(realm) {
  const r = realm?.ruler;
  if (!r) return { soberano: 'el señor de estas tierras', Soberano: 'El señor de estas tierras', al_soberano: 'al señor de estas tierras', del_soberano: 'del señor de estas tierras' };
  const fem = r.gender === 'f';
  const name = `${r.title ?? (fem ? 'Reina' : 'Rey')}${r.name ? ' ' + r.name : ''}`;
  return {
    soberano: `${fem ? 'la' : 'el'} ${name}`,
    Soberano: `${fem ? 'La' : 'El'} ${name}`,
    al_soberano: `${fem ? 'a la' : 'al'} ${name}`,
    del_soberano: `${fem ? 'de la' : 'del'} ${name}`,
  };
}

/* ------------------------------------------------------------------ */
/* Clase social                                                         */
/* ------------------------------------------------------------------ */

export function hasHome(d) {
  return !!(d?.family?.house || d?.social?.home);
}

/** Valor total de fama (todas las regiones) o infamia. */
function total(map) {
  let t = 0;
  for (const v of Object.values(map ?? {})) t += Math.max(0, v ?? 0);
  return t;
}

/** Fama del jugador en un reino (incluye un 25 % de la fama ganada en otros lugares: las noticias viajan). */
export function fame(d, realmId) {
  const f = d?.social?.fame ?? {};
  const all = total(f);
  if (!realmId) return Math.round(all);
  const local = Math.max(0, f[realmId] ?? 0);
  return Math.round(local + (all - local) * 0.25);
}

/** Infamia del jugador en un reino (los crímenes se recuerdan sobre todo donde se cometieron). */
export function infamy(d, realmId) {
  const f = d?.social?.infamy ?? {};
  const all = total(f);
  if (!realmId) return Math.round(all);
  const local = Math.max(0, f[realmId] ?? 0);
  return Math.round(local + (all - local) * 0.2);
}

function tierOf(list, n) {
  let t = list[0];
  for (const x of list) if (n >= x[0]) t = x;
  return t;
}
export function fameTier(n) {
  const t = tierOf(FAME_TIERS, n);
  return { name: t[1], c: t[2] };
}
export function infamyTier(n) {
  const t = tierOf(INFAMY_TIERS, n);
  return { name: t[1], c: t[2] };
}

/** Nivel de comercio (habilidad de regateo) del jugador. */
export function tradeLevel(d) {
  return d?.social?.trade?.lvl ?? 1;
}

/**
 * Clase social del jugador: { id, name, rank 0..5, c, desc, overlay?, overlayName?, label }.
 * Mendigo (sin casa ni dinero) · Plebeyo · Ciudadano (casa o Gremio) · Burgués (rico o mercader de éxito)
 * · Caballero (Gremio rango B+ o nombrado caballero) · Noble (título nobiliario). Capas: Héroe/Leyenda por fama.
 */
export function playerClass(d) {
  if (!d) return { ...CLASSES[1], name: CLASSES[1].name[0], label: CLASSES[1].name[0], rank: 1 };
  const so = d.social ?? {};
  const gold = d.gold ?? 0;
  const guild = !!(d.guild?.member && !d.guild?.suspended);
  const birth = so.birth ?? 'media';
  const trade = so.trade ?? {};
  const home = hasHome(d);
  let rank;
  // Solo el título concedido por la corona (titleFlow): el documento es un objeto que se puede pasar a otro.
  if (so.noble) rank = 5;
  else if ((guild && (d.guild.rank ?? 0) >= CLASS_RULES.caballeroGuildRank) || so.knight) rank = 4;
  else if (gold >= (birth === 'alta' ? CLASS_RULES.burguesGoldRich : CLASS_RULES.burguesGold)
    || ((trade.sold ?? 0) + (trade.bought ?? 0)) >= CLASS_RULES.burguesTrade || (trade.lvl ?? 1) >= CLASS_RULES.burguesTradeLvl) rank = 3;
  else if (guild || (home && (birth !== 'baja' || gold >= CLASS_RULES.ciudadanoGold))) rank = 2;
  else if (home || gold >= CLASS_RULES.plebeyoGold) rank = 1;
  else rank = 0;
  const c = CLASSES[rank];
  const name = c.name[d.gender === 'f' ? 1 : 0];
  const fm = fame(d);
  const inf = infamy(d);
  let overlay;
  if (fm >= OVERLAYS.leyenda.minFame && (d.karma ?? 0) > -400) overlay = OVERLAYS.leyenda;
  else if (fm >= OVERLAYS.heroe.minFame && (d.karma ?? 0) > -150) overlay = OVERLAYS.heroe;
  if (inf >= OVERLAYS.temido.minInfamy && inf > fm) overlay = OVERLAYS.temido;
  const overlayName = overlay ? overlay.name[d.gender === 'f' ? 1 : 0] : undefined;
  return {
    id: c.id, rank, name, c: c.c, desc: genderize(c.desc, d.gender, d.gender),
    overlay: overlay?.id, overlayName,
    label: `${c.c}${name}${overlay ? ` §7· ${overlay.c}${overlayName}` : ''}§r`,
  };
}

/** Clase del NPC como rango comparable (baja 1, media 2, alta 4, gobernante 5). */
export function npcRank(ident) {
  if (!ident) return 2;
  const job = ident.job ?? ident.role;
  if (job === 'rey') return 5;
  if (ident.cls === 'alta' || job === 'noble') return 4;
  if (ident.cls === 'baja') return 1;
  return 2;
}

/** Clase social de un NPC ('baja'|'media'|'alta'). */
export function npcCls(ident) {
  if (!ident) return 'media';
  if (['baja', 'media', 'alta'].includes(ident.cls)) return ident.cls;
  const job = ident.job ?? ident.role;
  if (job === 'noble' || job === 'rey') return 'alta';
  if (job === 'mendigo' || job === 'ladron' || job === 'granjero') return 'baja';
  return 'media';
}

/* ------------------------------------------------------------------ */
/* Actitud y tratamiento                                                */
/* ------------------------------------------------------------------ */

/**
 * Actitud de un NPC hacia el jugador (-1 desprecio .. +1 admiración) según la diferencia de clase,
 * la actitud del reino hacia su raza, su karma, su fama/infamia y si le busca la guardia.
 * realm: reino del NPC (opcional; se deduce de ident.realm / ident.settlement).
 */
export function attitude(d, ident, realm) {
  if (!d || !ident) return 0;
  const job = ident.job ?? ident.role;
  const outlaw = job === 'ladron' || job === 'sombra';
  const pc = playerClass(d);
  const nr = npcRank(ident);
  const cls = npcCls(ident);
  let a = 0;
  // Diferencia de clase
  if (cls === 'alta') {
    if (pc.rank >= 4) a += 0.25;
    else if (pc.rank === 3) a += 0.02;
    else a -= 0.12 * (nr - pc.rank - 1);
  } else if (cls === 'baja') {
    if (pc.rank >= 4) a += 0.15; // deferencia
    else if (pc.rank === 3) a -= 0.05; // envidia
    else if (pc.rank === 0) a += 0.05; // solidaridad
  } else {
    if (pc.rank === 0) a -= 0.12;
    else if (pc.rank >= 3) a += 0.1;
  }
  // Raza (actitud del reino y afinidad entre iguales)
  realm = realm ?? realmById(ident.realm) ?? realmOfSafe(getSettlementSafe(ident.settlement));
  const att = realm?.attitudes?.[d.race];
  if (typeof att === 'number') a += clamp(att, -1, 1) * 0.35;
  if (ident.race && ident.race === d.race) a += 0.08;
  // Karma
  const k = (d.karma ?? 0) / 1000;
  a += outlaw ? -k * 0.3 : k * 0.35;
  // Fama e infamia en el reino
  const rid = realm?.id;
  a += Math.min(0.3, fame(d, rid) / 1500);
  const inf = infamy(d, rid);
  a -= outlaw ? -Math.min(0.2, inf / 1000) : Math.min(0.4, inf / 600);
  // Buscado por la guardia
  if ((d.wanted?.stars ?? 0) > 0 && !outlaw) a -= 0.1 + 0.05 * d.wanted.stars;
  return clamp(a, -1, 1);
}

/** Tratamiento con el que el NPC se dirige al jugador. */
export function address(d, ident, player) {
  if (!d) return 'viajero';
  const pc = playerClass(d);
  const f = d.gender === 'f' ? 1 : 0;
  const cls = npcCls(ident);
  if (stageOf(d) === 'child') return ADDRESS.child[f];
  if (pc.rank === 5) return (cls === 'alta' ? ADDRESS.noble_from_high : ADDRESS.noble_from_low)[f];
  if (pc.overlay === 'heroe' || pc.overlay === 'leyenda') {
    if (cls !== 'alta' || pc.rank >= 3) return ADDRESS.hero[f];
  }
  if (pc.rank === 4) return ADDRESS.caballero[f];
  if (pc.rank === 3) return cls === 'alta' ? (player?.name ?? ADDRESS.burgues[f]) : ADDRESS.burgues[f];
  if (pc.rank === 2) return ADDRESS.ciudadano[f];
  if (pc.rank === 1) return cls === 'alta' ? (f ? 'plebeya' : 'plebeyo') : ADDRESS.plebeyo[f];
  return cls === 'baja' ? (f ? 'amiga' : 'amigo') : ADDRESS.mendigo[f];
}

/** ¿El noble se niega a charlar largo con este jugador? */
export function nobleDisdain(d, ident) {
  const job = ident?.job ?? ident?.role;
  if (job !== 'noble' && job !== 'rey') return false;
  const pc = playerClass(d);
  if (pc.overlay === 'heroe' || pc.overlay === 'leyenda') return false;
  if (job === 'rey') return pc.rank <= 0;
  return pc.rank <= 1;
}

/* ------------------------------------------------------------------ */
/* Hazañas                                                              */
/* ------------------------------------------------------------------ */

/**
 * Crea una hazaña a partir de una plantilla de data/social.js DEEDS.
 * kind: boss|dungeon|guild_rank|raid|thief|alms|round|royal|title|work|crime|punished|escape
 * ctx: { name, rank, place, realm, ruler, crime, realmId, fame, id, key, unique }
 */
export function deed(kind, ctx = {}) {
  const t = DEEDS[kind] ?? { text: ctx.text ?? 'Una hazaña', who: ctx.who, fame: ctx.fame ?? 10 };
  const vars = { name: '???', rank: '?', place: 'estas tierras', realm: 'el reino', ruler: 'la corona', crime: 'un delito', ...ctx };
  vars.a_name = withA(vars.name);
  return {
    id: ctx.id ?? `${kind}:${ctx.key ?? ctx.name ?? ''}:${world.getDay()}`,
    kind,
    text: fixEs(fill(ctx.text ?? t.text, vars)),
    who: t.who ? fill(t.who, vars).replace(/\bde el\b/g, 'del').replace(/\ba el\b/g, 'al') : undefined,
    fame: Math.round(ctx.fame ?? t.fame ?? 0),
    realmId: ctx.realmId ?? ctx.realmObj?.id,
    unique: !!ctx.unique,
  };
}

/**
 * Registra una hazaña: deed = { id, text, fame, realmId?, who?, unique? }.
 * fame > 0 → fama (en el reino o global), fame < 0 → infamia. Devuelve true si se registró.
 */
export function addDeed(player, dd) {
  const d = getP(player);
  if (!d || !dd) return false;
  const so = socialOf(d);
  if (dd.unique && so.deeds.some((x) => x.id === dd.id)) return false;
  const before = playerClass(d);
  const amt = Math.round(dd.fame ?? 0);
  const key = dd.realmId ?? '_';
  if (amt > 0) so.fame[key] = (so.fame[key] ?? 0) + amt;
  else if (amt < 0) so.infamy[key] = (so.infamy[key] ?? 0) - amt;
  const realm = dd.realmId ? realmById(dd.realmId) : undefined;
  const text = genderize(String(dd.text ?? 'Una hazaña'), d.gender, d.gender);
  const who = dd.who ? genderize(String(dd.who), d.gender, d.gender) : undefined;
  const entry = { id: dd.id ?? 'deed:' + system.currentTick, text, who, fame: amt, realmId: dd.realmId, realm: realm?.name, day: world.getDay() };
  so.deeds.unshift(entry);
  if (amt > 0 && who && amt >= (so.best?.fame ?? 0)) so.best = entry; // la mayor gesta se recuerda siempre
  if (so.deeds.length > DEED_CAP) so.deeds.length = DEED_CAP;
  dirty(player);
  const where = realm?.name ? ` en ${realm.name}` : '';
  if (amt > 0) {
    msg(player, `§6✦ Hazaña: §f${text} §7(+${amt} de fama${where})`);
    psound(player, 'random.orb', 0.6, 0.8);
  } else if (amt < 0) {
    msg(player, `§c✖ Infamia: §f${text} §7(+${-amt} de infamia${where})`);
  } else msg(player, `§7✎ Diario: §f${text}`);
  checkClass(player, d, before);
  try { hooks.onDeed?.(player, dd); } catch (e) { console.warn('[Aetheria] onDeed: ' + e); }
  return true;
}

/** Atajo: hazaña de plantilla en el reino donde está el jugador (si ctx no indica otro). */
export function recordDeed(player, kind, ctx = {}) {
  const c = { ...ctx };
  if (c.realmId === undefined && c.here !== false) {
    const p = nearPlace(player);
    if (p.realm?.id) c.realmId = p.realm.id;
    if (!c.place && p.s?.name) c.place = p.s.name;
    if (!c.realm && p.realm?.name) c.realm = realmArt(p.realm.name);
  }
  return addDeed(player, deed(kind, c));
}

/** Última hazaña positiva (para que los NPCs te reconozcan). */
export function lastGlory(d, realmId) {
  const list = d?.social?.deeds ?? [];
  return list.find((x) => x.fame > 0 && x.who && (!realmId || !x.realmId || x.realmId === realmId) && x.fame >= 15)
    ?? d?.social?.best
    ?? list.find((x) => x.fame > 0 && x.who);
}

/** Última fechoría (infamia). */
export function lastShame(d) {
  return (d?.social?.deeds ?? []).find((x) => x.fame < 0);
}

// Pretéritos irregulares de 2.ª persona → 3.ª persona.
const PRET_IRREGULAR = {
  fuiste: 'fue', hiciste: 'hizo', diste: 'dio', viste: 'vio', estuviste: 'estuvo', tuviste: 'tuvo', pusiste: 'puso',
  dijiste: 'dijo', trajiste: 'trajo', quisiste: 'quiso', pudiste: 'pudo', supiste: 'supo', anduviste: 'anduvo',
};

/**
 * Hazaña o fechoría contada por otros: "Cometiste hurto en X" → "cometió hurto en X", "Te fugaste…" → "se fugó…".
 * Devuelve undefined si el texto no empieza por un pretérito en 2.ª persona.
 */
export function thirdPerson(text) {
  let t = String(text ?? '').trim();
  let refl = '';
  if (/^te /i.test(t)) { refl = 'se '; t = t.slice(3); }
  const m = /^([A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+)/.exec(t);
  if (!m) return undefined;
  const w = m[1].toLowerCase();
  let v = PRET_IRREGULAR[w];
  if (!v && /aste$/.test(w) && w.length > 5) v = w.slice(0, -4) + 'ó';
  else if (!v && /iste$/.test(w) && w.length > 5) v = w.slice(0, -4) + 'ió';
  if (!v) return undefined;
  return refl + v + t.slice(m[1].length);
}

/* ------------------------------------------------------------------ */
/* Adaptadores para los ganchos del integrador (hazañas automáticas)     */
/* ------------------------------------------------------------------ */

const recentDeeds = new Map(); // pid|clave -> tick (evita contar dos veces el mismo suceso si llega por dos ganchos)

function once(player, key, ticks = 200) {
  const k = player.id + '|' + key;
  const now = system.currentTick;
  if (now - (recentDeeds.get(k) ?? -1e9) < ticks) return false;
  recentDeeds.set(k, now);
  if (recentDeeds.size > 500) recentDeeds.clear();
  return true;
}

/** Jefe derrotado (bossId = typeId de data/mobs.js BOSSES). */
export function deedForBoss(player, bossId) {
  if (!once(player, 'boss:' + bossId)) return false;
  const b = BOSSES[bossId];
  return recordDeed(player, 'boss', { name: b?.name ?? 'un jefe temible', key: bossId, fame: 30 + (b?.rank ?? 2) * 15 });
}

/** Mazmorra limpiada (rango 0..8). */
export function deedForDungeon(player, rank) {
  const r = Math.max(0, Math.min(8, Number(rank) || 0));
  if (!once(player, 'dg:' + r)) return false;
  return recordDeed(player, 'dungeon', { rank: RANKS[r] ?? '?', key: 'dg' + r + ':' + system.currentTick, fame: 10 + r * 6 });
}

/** Ascenso en el Gremio (fama global: la licencia vale en todos los reinos). */
export function deedForGuildRank(player, rank) {
  const r = Math.max(0, Math.min(8, Number(rank) || 0));
  return addDeed(player, deed('guild_rank', { rank: RANKS[r] ?? '?', id: 'guild:' + r, unique: true, fame: 10 + r * 10 }));
}

/** Incursión defendida (settlements.hooks.onRaidDefended). */
export function deedForRaid(player, s) {
  if (!once(player, 'raid:' + (s?.id ?? ''), 600)) return false;
  return addDeed(player, deed('raid', { place: s?.name ?? 'la aldea', realmId: s?.realmId, key: (s?.id ?? '') + ':' + system.currentTick }));
}

/** Crimen presenciado (crime.hooks.onCrime): infamia en el reino. */
export function deedForCrime(player, type, info = {}) {
  if (!info.witnessed) return false;
  const c = CRIMES[type];
  if (!c) return false;
  const stars = Math.max(1, Number(info.stars) || (c.stars?.[1] ?? 1));
  const murder = String(type).startsWith('asesinato');
  return addDeed(player, deed('crime', {
    crime: c.name.toLowerCase(), place: info.settlement?.name ?? 'los caminos', realmId: info.realm?.id ?? info.settlement?.realmId,
    fame: -(stars * 8 + (murder ? 25 : 0)), key: type + ':' + system.currentTick,
  }));
}

/** Castigo cumplido (crime.hooks.onPunished): humillación pública o prisión. */
export function deedForPunishment(player, kind, crimes = []) {
  if (kind !== 'humiliation' && kind !== 'jail') return false;
  const p = nearPlace(player);
  const text = kind === 'jail' ? 'Cumpliste condena en la prisión de {place}' : undefined;
  return addDeed(player, deed('punished', { text, place: p.s?.name ?? 'la villa', realmId: p.realm?.id, key: kind + ':' + system.currentTick, fame: kind === 'jail' ? -10 : -5 }));
}

/* ------------------------------------------------------------------ */
/* Cambios de clase                                                     */
/* ------------------------------------------------------------------ */

function checkClass(player, d, before) {
  const so = socialOf(d);
  const now = playerClass(d);
  const key = now.id + '|' + (now.overlay ?? '');
  if (so.cls === undefined) { so.cls = key; return; }
  if (so.cls === key) return;
  const prevKey = so.cls;
  so.cls = key;
  dirty(player);
  const [pid, pov] = String(prevKey).split('|');
  const prevRank = CLASS_BY_ID[pid]?.rank ?? before?.rank ?? 1;
  if (now.rank !== prevRank) {
    const up = now.rank > prevRank;
    title(player, `${now.c}§l${now.name}`, up ? '§7Tu posición social ha mejorado' : '§7Tu posición social ha caído');
    msg(player, `${up ? '§a▲' : '§c▼'} Ahora la gente te considera ${now.c}§l${now.name}§r§7: ${now.desc}`);
    psound(player, up ? 'random.levelup' : 'mob.villager.no', 0.6, up ? 1.3 : 0.9);
  }
  if ((now.overlay ?? '') !== (pov ?? '') && now.overlay) {
    const o = OVERLAYS[now.overlay];
    title(player, `${o.c}§l${now.overlayName}`, now.overlay === 'temido' ? '§7Tu nombre infunde miedo' : '§7Tu nombre corre de boca en boca');
    msg(player, now.overlay === 'temido'
      ? `§c✦ La gente te teme. Ahora eres ${o.c}§l${now.overlayName}§r§c: muchos te evitarán... y otros te admirarán en secreto.`
      : `${o.c}✦ ¡Ahora eres ${now.overlayName}! §7Los bardos cantan tus gestas y la gente te reconoce por la calle.`);
  }
  try { hooks.onClassChange?.(player, before, now); } catch (e) { console.warn('[Aetheria] onClassChange: ' + e); }
}

/**
 * Revisión periódica (la llama life.tick cada pocos segundos): anuncia los cambios de clase (por ejemplo, al
 * hacerte rico). Llevar el documento del título nobiliario no te hace noble: solo cuenta el título que te
 * concede la corona (so.noble). Se borra la marca antigua de "documento en el inventario" de partidas previas.
 */
export function classTick(player, d) {
  if (!d) return;
  const so = socialOf(d);
  if (so.titleItem !== undefined) {
    delete so.titleItem;
    dirty(player);
  }
  checkClass(player, d, undefined);
}

/* ------------------------------------------------------------------ */
/* Diario                                                               */
/* ------------------------------------------------------------------ */

const BIRTH_NAMES = { baja: 'humilde', media: 'de artesanos', alta: 'acomodada' };

/** Página del Diario: clase, fama por reino y últimas hazañas (texto en español con códigos §). */
export function journalPage(player) {
  const d = getP(player);
  if (!d) return '';
  const so = socialOf(d);
  const pc = playerClass(d);
  const lines = [];
  lines.push(`§l§6Posición social§r`);
  lines.push(`§7Clase: ${pc.label} §8— ${pc.desc}`);
  if (so.birth) lines.push(`§7Origen: §ffamilia ${BIRTH_NAMES[so.birth] ?? so.birth}`);
  if (so.noble) lines.push(`§7Título: §6${gw(d, 'Noble', 'Noble')} de ${so.noble.realmName ?? 'un reino lejano'} §7(desde el día ${so.noble.day ?? '?'})`);
  const t = so.trade ?? {};
  lines.push(`§7Comercio: §fnivel ${t.lvl ?? 1} §8(${Math.floor(t.xp ?? 0)} XP) §7· Ahorrado regateando: §6${Math.floor(t.saved ?? 0)} oro`);
  const kt = karmaTitle(d.karma ?? 0);
  lines.push(`§7Reputación moral: ${kt.c}${kt.name}`);
  lines.push('');
  lines.push('§l§eFama por reino§r');
  const realms = new Set([...Object.keys(so.fame), ...Object.keys(so.infamy)].filter((k) => k !== '_'));
  if (!realms.size && !so.fame._ && !so.infamy._) lines.push('§8Nadie ha oído hablar de ti todavía.');
  for (const rid of realms) {
    const r = realmById(rid);
    const f = fame(d, rid);
    const i = infamy(d, rid);
    const ft = fameTier(f);
    const it = infamyTier(i);
    lines.push(`§f• ${r?.name ?? 'Reino desconocido'}: ${ft.c}${genderize(ft.name, d.gender, d.gender)} §7(${f})${i > 0 ? ` §7· infamia ${it.c}${genderize(it.name, d.gender, d.gender)} §7(${i})` : ''}`);
  }
  if (so.fame._ || so.infamy._) lines.push(`§f• Por los caminos: §7fama ${Math.round(so.fame._ ?? 0)}${so.infamy._ ? ` · infamia ${Math.round(so.infamy._)}` : ''}`);
  lines.push(`§7Fama total: §e${fame(d)} §7· Infamia total: §c${infamy(d)}`);
  lines.push('');
  lines.push('§l§6Últimas hazañas§r');
  const recent = so.deeds.slice(0, 12);
  if (!recent.length) lines.push('§8Aún no has escrito tu leyenda.');
  for (const x of recent) {
    const sign = x.fame > 0 ? `§a+${x.fame}` : x.fame < 0 ? `§c${x.fame}` : '§80';
    lines.push(`§7Día ${x.day ?? '?'}: §f${x.text} ${sign}${x.realm ? ` §8(${x.realm})` : ''}`);
  }
  if (so.deeds.length > recent.length) lines.push(`§8...y ${so.deeds.length - recent.length} más.`);
  return lines.join('\n');
}

/** Línea breve para el HUD o el perfil: clase + fama local. */
export function statusLine(player) {
  const d = getP(player);
  if (!d) return '';
  const pc = playerClass(d);
  const p = placeOf(player);
  const f = p.realm ? fame(d, p.realm.id) : fame(d);
  return `${pc.label} §7· Fama §e${f}`;
}

/** Nombre de la raza del jugador en plural (para frases). */
export function racePlural(d) {
  return raceOf(d?.race).plural.toLowerCase();
}

/** Acceso para pruebas. */
export const _t = { placeCache };
