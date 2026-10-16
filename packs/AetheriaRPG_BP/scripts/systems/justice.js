// Justicia: arresto, escolta con cuerda, castigo público con tomates en la plaza, cárcel con rondas del
// carcelero, robo de la llave y fuga, manos atadas. Punto de entrada del área de justicia para main.js:
// aquí están todas las funciones que el integrador conecta (contrato §6.3). La detección, los robos, los
// testigos y las estrellas están en systems/crime.js.
import { world, system, InputPermissionCategory } from '@minecraft/server';
import { getP, dirty, W, wDirty } from '../core/store.js';
import { msg, title, actionbar, addKarma, spendGold } from '../core/progression.js';
import * as crime from './crime.js';
import { hooks, reportCrime, law, EYE, GLYPH, gw, starText, centerOf, identOf, npcSay } from './crime.js';
import {
  severityOf, ofRuler, say, crimeList, CRIMES,
  ARREST_LINES, ESCORT_STOCKS_LINES, ESCORT_JAIL_LINES, PROCLAMATIONS, JEERS, JEERS_BY_KIND, STOCKS_RELEASE,
  JAIL_ENTER, JAIL_FLAVOR, PATROL_START, PATROL_FOOD, KEY_HINT, KEY_CAUGHT, KEY_SUCCESS, JAIL_RELEASE,
  BRIBE_OFFER, BRIBE_ACCEPT, NOBLE_FINE, HERO_PARDON, HERO_DEEDS, SHOUTS, TOMATO_REACT,
} from '../data/laws.js';
import { confirm, guarded, info } from '../util/ui.js';
import { particle, psound, sound, valid, giveItem, removeItem, countItem, effect } from '../util/compat.js';
import { pick, randInt, chance, clamp, dist, dist2D } from '../util/math.js';

export { reportCrime, hooks };

const NPC = 'rpg:npc';
const MOVEMENT = InputPermissionCategory?.Movement ?? 2;
const CUSTODY_TAGS = ['rpg_arrested', 'rpg_humiliated', 'rpg_jailed', 'rpg_tied'];

/* ------------------------------------------------------------------ */
/* Estado de sesión (lo persistente va en getP(player).justice)         */
/* ------------------------------------------------------------------ */

const escorts = new Map(); // pid -> { guard, ticks, dest, jumping }
const humil = new Map(); // pid -> { guard, anchor, plaza, face, dimId, path, pathPos, atStocks, jeerers:Map, fam:Set, nextJeer, recruitIn, lastTomato }
const patrols = new Map(); // settlementId -> { sid, jailer, left, dur, next, tried:Set }
const parleyGuards = new Map(); // pid -> guard
const touch = new Map(); // pid -> ticks junto a un guardia
const lastNote = new Map(); // pid -> tick (mensajes de restricción)
const npcReact = new Map(); // npcId -> tick
let fastN = 0;
let ready = false; // ya corre secondTick (mundo cargado): se puede leer W() y limpiar NPCs
let sweepIn = 3; // segundos hasta la próxima limpieza de NPCs huérfanos

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function dimOf(id) {
  try { return world.getDimension(id ?? 'minecraft:overworld'); } catch { return undefined; }
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec ?? 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function setMovement(player, on) {
  try { player.inputPermissions.setPermissionCategory(MOVEMENT, on); } catch {}
}

function addTags(player, ...tags) {
  for (const t of tags) try { player.addTag(t); } catch {}
}

function removeTags(player, ...tags) {
  for (const t of tags) try { player.removeTag(t); } catch {}
}

/** Mensaje de acción con límite de frecuencia (seguro desde before-events). */
function note(player, text) {
  const now = system.currentTick;
  if (now - (lastNote.get(player.id) ?? -999) < 30) return;
  lastNote.set(player.id, now);
  system.run(() => { try { actionbar(player, text); } catch {} });
}

function stocksPoint(s) {
  return s?.stocks ?? s?.plaza ?? s?.center;
}
function plazaPoint(s) {
  return s?.plaza ?? s?.stocks ?? s?.center;
}
function jailEntry(s) {
  return s?.jail?.exit ?? s?.jail?.patrol ?? s?.jail?.cells?.[0]?.spawn ?? stocksPoint(s);
}
function blockCenter(p) {
  return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
}

/** Devuelve el guardia a su ronda. Si no está cargado, lo libera orphanSweep/onEntityLoad cuando vuelva. */
function releaseGuard(g) {
  if (!valid(g)) return;
  crime.freeNpc(g, ['rpg_escort', 'rpg_jailer', 'rpg_hunting']);
}

function claimGuard(g, kind) {
  if (!valid(g)) return;
  crime.releaseHunter(g.id, true);
  try { g.triggerEvent(kind === 'stocks' ? 'rpg:act_escort_stocks' : 'rpg:act_escort_jail'); } catch {}
  try { g.addTag('rpg_busy'); g.addTag('rpg_escort'); } catch {}
  try { g.setProperty('rpg:mood', 2); } catch {}
}

function findFreeGuard(player, radius) {
  let list = [];
  try { list = player.dimension.getEntities({ type: NPC, families: ['rpg_guard'], location: player.location, maxDistance: radius, excludeTags: ['rpg_escort', 'rpg_jailer', 'rpg_alarm'] }); } catch {}
  // Ni el carcelero de ronda ni quien persigue a otro buscado.
  return list.find((g) => { try { const pid = crime.hunterPid(g.id); return !pid || pid === player.id; } catch { return false; } });
}

/** El guardia ya custodia a otro preso (escolta, cepo, negociación) o hace la ronda de la cárcel. */
function guardTaken(g) {
  try { return g.hasTag('rpg_escort') || g.hasTag('rpg_jailer'); } catch { return true; }
}

/** Las manos atadas: sin usar objetos, atacar ni interactuar. */
export function isRestricted(player) {
  try { return player.hasTag('rpg_tied') || player.hasTag('rpg_arrested') || player.hasTag('rpg_humiliated'); } catch { return false; }
}

function untie(player) {
  removeTags(player, ...CUSTODY_TAGS);
  setMovement(player, true);
}

/* ------------------------------------------------------------------ */
/* Cuerda                                                              */
/* ------------------------------------------------------------------ */

/** Mantiene al jugador a ~1.6 bloques detrás del guardia, mirándolo. */
function pullOnRope(player, guard, len = law('ropeLength')) {
  let gl, pl;
  try { gl = guard.location; pl = player.location; } catch { return; }
  const dx = pl.x - gl.x;
  const dz = pl.z - gl.z;
  const dh = Math.hypot(dx, dz);
  if (dh <= len + 0.45 && Math.abs(pl.y - gl.y) < 1.5) return; // cuerda floja
  let nx;
  let nz;
  if (dh < 0.05) {
    let v = { x: 0, z: 1 };
    try { v = guard.getViewDirection(); } catch {}
    const l = Math.hypot(v.x, v.z) || 1;
    nx = -v.x / l;
    nz = -v.z / l;
  } else { nx = dx / dh; nz = dz / dh; }
  let target = { x: gl.x + nx * len, y: gl.y, z: gl.z + nz * len };
  if (!crime.standable(guard.dimension, target)) target = { x: gl.x, y: gl.y, z: gl.z };
  let face;
  try { face = guard.getHeadLocation(); } catch { face = { x: gl.x, y: gl.y + 1.6, z: gl.z }; }
  try { player.teleport(target, { facingLocation: face, keepVelocity: false }); } catch {}
}

/** Partículas de cuerda desde la mano del guardia hasta el cuello del jugador. */
function drawRope(guard, player) {
  let a;
  let b;
  let dim;
  try {
    const gl = guard.location;
    let v = { x: 0, z: 1 };
    try { v = guard.getViewDirection(); } catch {}
    const l = Math.hypot(v.x, v.z) || 1;
    const right = { x: -v.z / l, z: v.x / l };
    a = { x: gl.x + right.x * 0.35 + (v.x / l) * 0.2, y: gl.y + 1.0, z: gl.z + right.z * 0.35 + (v.z / l) * 0.2 };
    const pl = player.location;
    const head = player.getHeadLocation();
    b = { x: pl.x, y: head.y - 0.28, z: pl.z };
    dim = guard.dimension;
  } catch { return; }
  const d = dist(a, b);
  if (d > 12) return;
  const n = clamp(Math.ceil(d / 0.25), 2, 20);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const sag = Math.sin(Math.PI * t) * Math.min(0.35, d * 0.08);
    particle(dim, 'rpg:rope', { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - sag, z: a.z + (b.z - a.z) * t });
  }
}

/* ------------------------------------------------------------------ */
/* Arresto                                                             */
/* ------------------------------------------------------------------ */

/** Arresta a un jugador buscado (guard opcional: sin guardia se le lleva directamente). */
export function arrest(player, guard) {
  if (!valid(player)) return false;
  const d = getP(player);
  const w = d?.wanted;
  if (!d || !w || (w.stars ?? 0) <= 0 || crime.inCustody(d) || d.justice?.state === 'escaped') return false;
  touch.delete(player.id);
  crime.cancelMinigame(player);
  let s = crime.getSettlementSafe(w.settlementId);
  if (!s) { try { s = crime.jurisdictionOf(player.dimension.id, player.location); } catch {} }
  const realm = crime.realmOfSafe(s);
  const sev = severityOf(w.stars);
  if (valid(guard) && guardTaken(guard)) guard = undefined; // ese guardia no puede dejar a su otro preso
  if (valid(guard)) try { guard.lookAt(player.getHeadLocation()); } catch {}
  if (sev === 'minor' && heroPardon(player, d, guard, realm)) return true;
  const offer = offerFor(player, d, w, realm, sev);
  if (offer) return parley(player, d, guard, s, realm, offer);
  beginEscort(player, d, guard, s, realm);
  return true;
}

function heroPardon(player, d, guard, realm) {
  const day = world.getDay();
  if (d.pardonDay === day) return false;
  let fame = 0;
  try { fame = Number(hooks.fame?.(player, realm?.id) ?? 0) || 0; } catch {}
  if ((d.karma ?? 0) < law('heroKarma') && fame < 100) return false;
  d.pardonDay = day;
  crime.clearWanted(player);
  if (valid(guard)) {
    npcSay(guard, pick(HERO_PARDON), { deed: pick(HERO_DEEDS) }, 24);
    releaseGuard(guard);
  }
  title(player, '§e§lADVERTENCIA', '§7Por tus hazañas, te perdonan esta vez');
  msg(player, '§e✦ Tu fama te precede: la guardia te deja marchar con una advertencia. §7(Solo una vez al día.)');
  dirty(player);
  return true;
}

function offerFor(player, d, w, realm, sev) {
  const str = crime.strictnessOf(realm);
  const gold = d.gold ?? 0;
  let rank = 0;
  try { rank = Number(hooks.classRank?.(player) ?? 0) || 0; } catch {}
  if (sev === 'minor' && rank >= 4) {
    const fine = 30 + 20 * str;
    if (gold >= fine) return { kind: 'fine', gold: fine };
  }
  if (str >= 2) return undefined;
  if (w.stars > (str === 0 ? 2 : 1)) return undefined;
  if (str === 1 && !chance(0.5)) return undefined;
  const cost = Math.round((20 + 15 * w.stars) * (1 + str * 0.5));
  if (gold < cost) return undefined;
  return { kind: 'bribe', gold: cost };
}

function parley(player, d, guard, s, realm, offer) {
  d.justice = { state: 'parley', sid: s?.id, rid: realm?.id ?? s?.realmId, el: 0, offer };
  addTags(player, 'rpg_arrested');
  setMovement(player, false);
  crime.releaseHunters(player.id, valid(guard) ? guard.id : undefined);
  if (valid(guard)) {
    parleyGuards.set(player.id, guard);
    // Marcado como custodio: nadie más lo reclama y, si se recargan los scripts, la limpieza lo libera.
    try { guard.addTag('rpg_busy'); guard.addTag('rpg_escort'); } catch {}
  }
  dirty(player);
  const text = offer.kind === 'fine' ? say(NOBLE_FINE, { gold: offer.gold }) : say(pick(BRIBE_OFFER), { gold: offer.gold });
  if (valid(guard)) npcSay(guard, text, {}, 12);
  let ran = false;
  guarded(player, async () => {
    ran = true;
    const ok = await confirm(player, offer.kind === 'fine' ? '§6§lMulta de la nobleza' : '§6§lUn guardia corrupto', `§f${text}\n\n§7Llevas encima §6${getP(player)?.gold ?? 0} oro§7.`, `§aPagar ${offer.gold} oro`, '§cAceptar el castigo');
    resolveParley(player, ok);
  }).then(() => { if (!ran) resolveParley(player, false); }).catch(() => resolveParley(player, false));
  return true;
}

function resolveParley(player, pay) {
  if (!valid(player)) return;
  const d = getP(player);
  const j = d?.justice;
  if (!j || j.state !== 'parley') return;
  const guard = parleyGuards.get(player.id);
  parleyGuards.delete(player.id);
  if (pay && spendGold(player, j.offer.gold)) {
    const crimes = [...(d.wanted?.crimes ?? [])];
    d.justice = undefined;
    untie(player);
    crime.clearWanted(player);
    carryPending(player, d, j);
    if (j.offer.kind === 'bribe') {
      addKarma(player, -3, 'sobornar a la guardia');
      if (valid(guard)) npcSay(guard, pick(BRIBE_ACCEPT), {}, 12);
    } else if (valid(guard)) npcSay(guard, '«Todo en orden. Que tenga un buen día, señoría.»', {}, 12);
    if (valid(guard)) releaseGuard(guard);
    title(player, '§6§lASUNTO ZANJADO', `§7-${j.offer.gold} oro`);
    try { hooks.onPunished?.(player, j.offer.kind, crimes); } catch (e) { console.warn('[Aetheria] onPunished: ' + e); }
    dirty(player);
    return;
  }
  d.justice = undefined;
  removeTags(player, 'rpg_arrested');
  carryPending(player, d, j, true);
  const s = crime.getSettlementSafe(j.sid);
  beginEscort(player, d, guard, s, crime.realmOfSafe(s));
}

/**
 * Delitos denunciados durante el cepo o la negociación (crime.addStars los deja en j.pendingStars): al acabar ese
 * castigo vuelven a ser búsqueda. quiet: sin aviso (se suman a una detención que empieza ahora mismo).
 */
function carryPending(player, d, j, quiet = false) {
  const n = j?.pendingStars ?? 0;
  if (!(n > 0)) return false;
  const crimes = [...(j.pendingCrimes ?? [])];
  j.pendingStars = 0;
  j.pendingCrimes = [];
  const floor = Math.max(1, ...crimes.map((t) => CRIMES[t]?.min ?? 1));
  const w = d.wanted ?? (d.wanted = { stars: 0, crimes: [], decay: 0 });
  w.stars = clamp(Math.max((w.stars ?? 0) + n, floor), 1, law('maxStars'));
  w.crimes = [...(w.crimes ?? []), ...crimes].slice(-10);
  w.settlementId = w.settlementId ?? j.sid;
  w.realmId = w.realmId ?? j.rid;
  w.decay = 0;
  w.severity = severityOf(w.stars);
  w.lastSeenTick = system.currentTick;
  try { w.day = world.getDay(); } catch {}
  addTags(player, 'rpg_wanted');
  dirty(player);
  if (!quiet) {
    title(player, '§c§lSE BUSCA', starText(w.stars));
    msg(player, `§c${EYE.OPEN} Aún tienes cuentas pendientes con la guardia: §f${crimeList(crimes)}§c. ${starText(w.stars)}`);
  }
  return true;
}

function findJailSettlement(s, realmId, dimId, near) {
  if (s?.jail?.cells?.length) return s;
  const list = crime.allSettlementsSafe().filter((x) => x?.jail?.cells?.length && (x.dim ?? 'minecraft:overworld') === dimId);
  const same = list.filter((x) => !realmId || x.realmId === realmId);
  const pool = same.length ? same : list;
  let best;
  let bd = Infinity;
  for (const x of pool) {
    const dd = x.center ? dist2D(x.center, near) : 1e9;
    if (dd < bd) { bd = dd; best = x; }
  }
  return best;
}

function beginEscort(player, d, guard, s, realm) {
  const w = d.wanted ?? { stars: 1, crimes: [] };
  const sev = severityOf(w.stars);
  const kind = sev === 'minor' ? 'stocks' : 'jail';
  const dimId = player.dimension.id;
  let target = s;
  if (kind === 'jail') target = findJailSettlement(s, realm?.id ?? s?.realmId, dimId, player.location) ?? s;
  let total;
  if (kind === 'stocks') total = law('humiliationSeconds');
  else total = Math.min(law('maxJailMinutes') * 60, (sev === 'murder' ? law('jailMinutesMurder') : law('jailMinutesSerious')) * 60 + (w.pending ?? 0));
  const j = {
    state: 'escort', kind, sid: target?.id, rid: realm?.id ?? target?.realmId, dim: target?.dim ?? dimId,
    stars: w.stars, crimes: [...(w.crimes ?? [])], sev, total, left: total, el: 0, tomatoes: 0,
  };
  if (!target) j.here = { ...player.location };
  d.justice = j;
  d.wanted = undefined;
  dirty(player);
  if (countItem(player, 'rpg:jail_key') > 0) {
    removeItem(player, 'rpg:jail_key', 64);
    msg(player, '§7Los guardias te registran y te quitan la llave de hierro que llevabas encima.');
  }
  removeTags(player, 'rpg_wanted');
  addTags(player, 'rpg_arrested', 'rpg_tied');
  setMovement(player, false);
  crime.releaseHunters(player.id, valid(guard) ? guard.id : undefined);
  const dest = centerOf(kind === 'stocks' ? stocksPoint(target) : jailEntry(target)) ?? j.here;
  const es = { guard: valid(guard) ? guard : undefined, ticks: 0, dest, jumping: false };
  escorts.set(player.id, es);
  const ctx = { of: ofRuler(realm), thief: player.name, detenido: gw(d, 'detenido', 'detenida') };
  title(player, '§c§l' + gw(d, 'DETENIDO', 'DETENIDA'), `§7${crimeList(j.crimes)} §8· §f${kind === 'stocks' ? 'castigo público' : `${Math.round(total / 60)} min de prisión`}`);
  msg(player, `§c${GLYPH.shackles} Te atan las manos a la espalda y te ponen una soga al cuello. §7Delitos: §f${crimeList(j.crimes)}§7.`);
  psound(player, 'armor.equip_chain', 1, 0.7);
  if (es.guard) {
    claimGuard(es.guard, kind);
    npcSay(es.guard, pick(ARREST_LINES), ctx, 24);
    system.runTimeout(() => { if (valid(es.guard)) npcSay(es.guard, pick(kind === 'stocks' ? ESCORT_STOCKS_LINES : ESCORT_JAIL_LINES), ctx, 16); }, 60);
  }
  if (!es.guard || !dest || j.dim !== dimId || dist2D(player.location, dest) > 80) fadeJump(player, es);
}

/** Viaje largo: fundido a negro y llegada directa. */
function fadeJump(player, es) {
  es.jumping = true;
  try { player.camera.fade({ fadeTime: { fadeInTime: 0.4, holdTime: 0.9, fadeOutTime: 0.6 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch {}
  system.runTimeout(() => {
    try {
      if (!valid(player)) return;
      const d = getP(player);
      const j = d?.justice;
      if (!j || j.state !== 'escort') return;
      msg(player, `§8Tras un largo camino ${gw(d, 'tirado', 'tirada')} de la soga...`);
      arrive(player, d, j, true);
    } catch (e) { console.warn('[Aetheria] escolta: ' + e); }
  }, 10);
}

function escortTick(player, d, j) {
  const es = escorts.get(player.id);
  if (!es) return arrive(player, d, j, true); // reanudado (reconexión): directo al destino
  if (es.jumping) return;
  es.ticks += 2;
  let g = es.guard;
  if (!valid(g)) {
    g = es.guard = findFreeGuard(player, 16);
    if (!g) return arrive(player, d, j, true);
    claimGuard(g, j.kind);
  }
  const dest = es.dest;
  let gl;
  try { gl = g.location; } catch { return arrive(player, d, j, true); }
  if (!dest || dist2D(gl, dest) <= 3.5) return arrive(player, d, j, false);
  if (es.ticks >= law('escortTimeout') * 20) {
    try { g.teleport({ x: dest.x + 1.5, y: dest.y, z: dest.z + 1.5 }); } catch {}
    return arrive(player, d, j, true);
  }
  try {
    if (dist(player.location, gl) > 8) player.teleport({ x: gl.x, y: gl.y, z: gl.z }, { facingLocation: g.getHeadLocation() });
  } catch {}
  pullOnRope(player, g);
  drawRope(g, player);
}

function arrive(player, d, j, jumped) {
  const es = escorts.get(player.id);
  escorts.delete(player.id);
  const guard = es?.guard && valid(es.guard) ? es.guard : undefined;
  if (jumped && guard && es?.dest) {
    try { guard.teleport({ x: es.dest.x + 1.2, y: es.dest.y, z: es.dest.z + 1.2 }, { dimension: dimOf(j.dim) }); } catch {}
  }
  if (j.kind === 'stocks') beginHumiliation(player, d, j, guard, false);
  else enterJail(player, d, j, guard, false);
}

/* ------------------------------------------------------------------ */
/* Castigo público                                                     */
/* ------------------------------------------------------------------ */

function groundNear(dim, x, y0, z) {
  for (const dy of [0, 1, -1, 2, -2]) {
    const y = Math.floor(y0) + dy;
    try {
      const below = dim.getBlock({ x: Math.floor(x), y: y - 1, z: Math.floor(z) });
      if (!below) return undefined;
      if (below.isAir || below.isLiquid) continue;
      if (crime.standable(dim, { x, y, z })) return y;
    } catch { return undefined; }
  }
  return undefined;
}

/** Vuelta a la plaza para el paseo de la vergüenza. */
function paradePath(dim, c, r) {
  if (!dim || !c) return [];
  const pts = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    const y = groundNear(dim, x, c.y, z);
    if (y !== undefined) pts.push({ x, y, z });
  }
  if (pts.length < 6) return [];
  pts.push({ ...pts[0] });
  return pts;
}

function pointOnPath(path, s) {
  let total = 0;
  const seg = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = dist(path[i], path[i + 1]);
    seg.push(l);
    total += l;
  }
  if (total <= 0) return path[0];
  s = ((s % total) + total) % total;
  for (let i = 0; i < seg.length; i++) {
    if (s <= seg[i]) {
      const t = seg[i] ? s / seg[i] : 0;
      const a = path[i];
      const b = path[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    s -= seg[i];
  }
  return path[path.length - 1];
}

function beginHumiliation(player, d, j, guard, resumed) {
  const s = crime.getSettlementSafe(j.sid);
  const dimId = j.dim ?? player.dimension.id;
  const dim = dimOf(dimId);
  const anchor = centerOf(stocksPoint(s)) ?? j.here ?? { ...player.location };
  const plaza = centerOf(plazaPoint(s)) ?? anchor;
  j.state = 'humiliation';
  if (typeof j.left !== 'number') j.left = j.total ?? law('humiliationSeconds');
  j.tomatoes = j.tomatoes ?? 0;
  removeTags(player, 'rpg_arrested', 'rpg_jailed');
  addTags(player, 'rpg_humiliated', 'rpg_tied');
  setMovement(player, false);
  const elapsed = (j.total ?? 60) - j.left;
  const path = !resumed && valid(guard) && elapsed < law('paradeSeconds') ? paradePath(dim, plaza, 6) : [];
  const face = dist2D(anchor, plaza) > 1 ? { x: plaza.x, y: plaza.y + 1.6, z: plaza.z } : { x: anchor.x, y: anchor.y + 1.6, z: anchor.z + 4 };
  const old = humil.get(player.id);
  if (old) releaseJeerers(old);
  const h = {
    guard: valid(guard) ? guard : undefined, anchor, plaza, face, dimId, path, pathPos: 0, atStocks: false,
    jeerers: new Map(), fam: new Set(), nextJeer: 3, recruitIn: 0, lastTomato: system.currentTick,
  };
  humil.set(player.id, h);
  if (path.length && h.guard) {
    try { h.guard.triggerEvent('rpg:act_sleep'); } catch {} // durante el paseo, al guardia lo mueve el script
    // Empieza en el punto de la vuelta más cercano al guardia.
    let k = 0;
    let best = Infinity;
    try {
      for (let i = 0; i < path.length - 1; i++) {
        const dd = dist2D(path[i], h.guard.location);
        if (dd < best) { best = dd; k = i; }
      }
    } catch {}
    for (let i = 0; i < k; i++) h.pathPos += dist(path[i], path[i + 1]);
    try { h.guard.teleport(path[k], { dimension: dim }); } catch {}
    msg(player, '§c' + GLYPH.shackles + ' El guardia tira de la soga y te pasea por la plaza para que todos te vean...');
  } else bindToStocks(player, h, dim);
  recruitJeerers(player, h);
  if (!resumed) {
    const realm = crime.realmOfSafe(s);
    const text = say(pick(PROCLAMATIONS), { place: s?.name ?? 'este lugar', thief: player.name, condenado: gw(d, 'condenado', 'condenada'), expuesto: gw(d, 'expuesto', 'expuesta'), crimes: crimeList(j.crimes), of: ofRuler(realm) });
    crime.localMsg(dimId, anchor, `§6[Pregón] §f${text}`, 64);
    title(player, '§c§lCASTIGO PÚBLICO', `§7${fmtTime(j.left)} de vergüenza ante el pueblo`);
    psound(player, 'note.bell', 1, 0.5);
  } else msg(player, `§c${GLYPH.tomato} Sigues ${gw(d, 'expuesto', 'expuesta')} en la plaza. §7Quedan §f${fmtTime(j.left)}§7.`);
  dirty(player);
}

function bindToStocks(player, h, dim) {
  h.atStocks = true;
  if (valid(h.guard)) {
    try { h.guard.triggerEvent('rpg:act_escort_stocks'); } catch {}
    try { h.guard.teleport({ x: h.anchor.x + 1.3, y: h.anchor.y, z: h.anchor.z + 0.6 }); } catch {}
  }
  try { player.teleport(h.anchor, { dimension: dim ?? dimOf(h.dimId), facingLocation: h.face }); } catch {}
  msg(player, `§c${GLYPH.tomato} Te dejan ${gw(getP(player), 'atado', 'atada')} junto al cepo, en mitad de la plaza. Los vecinos ya se acercan...`);
}

function recruitJeerers(player, h) {
  const dim = dimOf(h.dimId);
  if (!dim) return;
  let list = [];
  try { list = dim.getEntities({ type: NPC, location: h.anchor, maxDistance: law('jeerRadius'), excludeTags: ['rpg_busy'] }); } catch {}
  for (const e of list) {
    if (h.jeerers.size >= law('maxJeerers')) break;
    try {
      if (h.jeerers.has(e.id) || crime.isGuard(e)) continue;
      const ident = identOf(e);
      if (ident?.owner === player.id) {
        if (!h.fam.has(e.id)) {
          h.fam.add(e.id);
          msg(player, `§7${ident.name} aparta la mirada, ${ident.gender === 'f' ? 'avergonzada' : 'avergonzado'}...`);
        }
        continue;
      }
      e.triggerEvent('rpg:act_jeer');
      e.addTag('rpg_busy');
      e.addTag('rpg_jeer');
      try { e.setProperty('rpg:mood', 1); } catch {}
      h.jeerers.set(e.id, e);
    } catch {}
  }
}

function releaseJeerers(h) {
  if (!h) return;
  // Los que no están cargados los libera orphanSweep/onEntityLoad al volver (ya no estarán en ningún mapa).
  for (const e of h.jeerers.values()) if (valid(e)) crime.freeNpc(e, ['rpg_jeer']);
  h.jeerers.clear();
}

function liveJeerers(h) {
  const out = [];
  for (const [id, e] of h.jeerers) {
    if (valid(e)) out.push(e);
    else h.jeerers.delete(id);
  }
  return out;
}

function jeerPool(j) {
  const last = j.crimes?.[j.crimes.length - 1];
  const extra = JEERS_BY_KIND[CRIMES[last]?.kind] ?? [];
  return [...JEERS, ...extra, ...extra];
}

/** Tomate lanzado por script (si la IA de los vecinos no acierta). */
function throwTomato(e, player, h) {
  let from;
  let vel;
  try {
    const eh = e.getHeadLocation();
    const ph = player.getHeadLocation();
    const dx = ph.x - eh.x;
    const dy = ph.y - 0.3 - eh.y;
    const dz = ph.z - eh.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    from = { x: eh.x + (dx / l) * 0.8, y: eh.y, z: eh.z + (dz / l) * 0.8 };
    const sp = 0.6 + l * 0.03;
    vel = { x: (dx / l) * sp, y: (dy / l) * sp + 0.06 + l * 0.012, z: (dz / l) * sp };
  } catch { return; }
  h.lastTomato = system.currentTick;
  let proj;
  try { proj = e.dimension.spawnEntity('rpg:tomato', from); } catch {}
  if (!proj) {
    splashOn(player);
    return;
  }
  try {
    const c = proj.getComponent('minecraft:projectile');
    if (!c) throw new Error('sin componente');
    try { c.owner = e; } catch {}
    c.shoot(vel);
  } catch {
    try { proj.applyImpulse(vel); } catch {}
  }
}

function splashOn(player) {
  const d = getP(player);
  const j = d?.justice;
  if (j?.state === 'humiliation') j.tomatoes = (j.tomatoes ?? 0) + 1;
  try {
    const hl = player.getHeadLocation();
    particle(player.dimension, 'rpg:tomato_splash', hl);
  } catch {}
  psound(player, 'mob.slime.small', 1, 0.9);
}

function humiliationFast(player, d, j) {
  let h = humil.get(player.id);
  if (!h) {
    beginHumiliation(player, d, j, undefined, true);
    h = humil.get(player.id);
    if (!h) return;
  }
  if (!h.atStocks) {
    const g = h.guard;
    const elapsed = (j.total ?? 60) - j.left;
    if (!valid(g) || elapsed >= law('paradeSeconds') || !h.path.length) return bindToStocks(player, h);
    h.pathPos += 0.17;
    const p = pointOnPath(h.path, h.pathPos);
    const q = pointOnPath(h.path, h.pathPos + 1);
    try { g.teleport(p, { facingLocation: { x: q.x, y: q.y + 1.5, z: q.z } }); } catch {}
    pullOnRope(player, g);
    drawRope(g, player);
    return;
  }
  let l;
  try { l = player.location; } catch { return; }
  if (dist(l, h.anchor) > 0.7) {
    try { player.teleport(h.anchor, { facingLocation: h.face }); } catch {}
  }
  if (fastN % 4 === 0 && valid(h.guard)) {
    try { if (dist(h.guard.location, h.anchor) < 5) drawRope(h.guard, player); } catch {}
  }
}

function humiliationSecond(player, d, j) {
  const h = humil.get(player.id);
  if (!h) return;
  j.left--;
  j.el = (j.el ?? 0) + 1;
  if (j.left <= 0) return finishHumiliation(player, d, j);
  const jeerers = liveJeerers(h);
  if (--h.nextJeer <= 0) {
    h.nextJeer = randInt(3, 5);
    if (jeerers.length) npcSay(pick(jeerers), pick(jeerPool(j)), { fem: d.gender === 'f' }, 32, '§6');
  }
  if (++h.recruitIn >= 8) {
    h.recruitIn = 0;
    recruitJeerers(player, h);
  }
  if (system.currentTick - h.lastTomato > 120 && jeerers.length) {
    let near;
    try { near = jeerers.filter((e) => dist(e.location, player.location) <= 14); } catch { near = []; }
    if (near.length) throwTomato(pick(near), player, h);
  }
  if (j.left <= 5) {
    try { player.onScreenDisplay.setTitle(`§c${j.left}`, { subtitle: '§7...y serás libre', fadeInDuration: 0, stayDuration: 22, fadeOutDuration: 4 }); } catch {}
  }
  if (j.el % 5 === 0) dirty(player);
}

function finishHumiliation(player, d, j) {
  const h = humil.get(player.id);
  humil.delete(player.id);
  releaseJeerers(h);
  if (valid(h?.guard)) {
    npcSay(h.guard, pick(STOCKS_RELEASE), {}, 16);
    releaseGuard(h.guard);
  }
  untie(player);
  d.justice = undefined;
  crime.clearWanted(player);
  crime.thiefOf(d).punished++;
  addKarma(player, -5, 'castigo público');
  try { hooks.onPunished?.(player, 'humiliation', j.crimes ?? []); } catch (e) { console.warn('[Aetheria] onPunished: ' + e); }
  const n = j.tomatoes ?? 0;
  title(player, '§a§lCASTIGO CUMPLIDO', n ? `§7Has recibido §c${n} §7tomatazos` : '§7Eres libre');
  msg(player, `§a✔ Eres libre. §7${n ? `Hueles a salsa de tomate (${n} impactos). ` : ''}La gente tardará en olvidarlo.`);
  if (chance(0.4) && giveItem(player, 'rpg:tomato', 1)) msg(player, '§8Te quedas un tomate de recuerdo.');
  carryPending(player, d, j);
  dirty(player);
}

/* ------------------------------------------------------------------ */
/* Prisión                                                             */
/* ------------------------------------------------------------------ */

function virtualCell(a) {
  const x = Math.floor(a.x);
  const y = Math.floor(a.y);
  const z = Math.floor(a.z);
  return { min: { x: x - 1, y, z: z - 1 }, max: { x: x + 1, y: y + 2, z: z + 1 }, spawn: { x: x + 0.5, y, z: z + 0.5 }, door: [] };
}

function cellCenter(c) {
  return { x: (c.min.x + c.max.x + 1) / 2, y: Math.min(c.min.y, c.max.y), z: (c.min.z + c.max.z + 1) / 2 };
}

function cellOf(j) {
  if (j.virtual) return j.vcell;
  return crime.getSettlementSafe(j.sid)?.jail?.cells?.[j.cell];
}

function insideCell(l, c) {
  const x0 = Math.min(c.min.x, c.max.x) - 0.3;
  const x1 = Math.max(c.min.x, c.max.x) + 1.3;
  const z0 = Math.min(c.min.z, c.max.z) - 0.3;
  const z1 = Math.max(c.min.z, c.max.z) + 1.3;
  const y0 = Math.min(c.min.y, c.max.y) - 1;
  const y1 = Math.max(c.min.y, c.max.y) + 2;
  return l.x >= x0 && l.x <= x1 && l.z >= z0 && l.z <= z1 && l.y >= y0 && l.y <= y1;
}

function onlinePrisoners(sid) {
  const out = [];
  for (const p of world.getAllPlayers()) {
    const j = getP(p)?.justice;
    if (j?.state === 'jail' && j.sid === sid && !j.virtual) out.push(p);
  }
  return out;
}

function pickCell(s, pid) {
  const cells = s?.jail?.cells ?? [];
  if (!cells.length) return -1;
  const used = new Set();
  for (const p of world.getAllPlayers()) {
    if (p.id === pid) continue;
    const j = getP(p)?.justice;
    if (j?.state === 'jail' && j.sid === s.id) used.add(j.cell);
  }
  for (let i = 0; i < cells.length; i++) if (!used.has(i)) return i;
  return randInt(0, cells.length - 1);
}

function enterJail(player, d, j, guard, resumed) {
  const s = crime.getSettlementSafe(j.sid);
  const cells = s?.jail?.cells ?? [];
  let idx = typeof j.cell === 'number' && cells[j.cell] ? j.cell : pickCell(s, player.id);
  let cell = cells[idx];
  if (!cell) {
    const a = centerOf(stocksPoint(s)) ?? j.here ?? { ...player.location };
    cell = j.vcell ?? virtualCell(a);
    j.virtual = true;
    j.vcell = cell;
    idx = -1;
  }
  j.state = 'jail';
  j.cell = idx;
  if (typeof j.left !== 'number') j.left = j.total;
  j.el = j.el ?? 0;
  j.nextFlavor = randInt(60, 120);
  removeTags(player, 'rpg_arrested', 'rpg_humiliated');
  addTags(player, 'rpg_jailed');
  if (!resumed) {
    j.keyOk = false; // solo abre la celda la llave robada al carcelero durante esta condena
    removeItem(player, 'rpg:jail_key', 64);
  }
  if (j.tied) addTags(player, 'rpg_tied');
  else removeTags(player, 'rpg_tied');
  setMovement(player, true);
  const sp = centerOf(cell.spawn ?? cellCenter(cell));
  try { player.teleport(sp, { dimension: dimOf(j.dim) }); } catch {}
  if (valid(guard)) {
    npcSay(guard, pick(['«Que disfrutes de tu estancia.»', '«Aquí dentro se te pasarán las ganas.»', '«Pórtate bien y saldrás algún día.»']), {}, 16);
    releaseGuard(guard);
  }
  if (!j.virtual && s) ensurePatrol(s);
  if (resumed) msg(player, `§7${GLYPH.shackles} Sigues en prisión. Te quedan §f${fmtTime(j.left)}§7${j.tied ? ' §c(con las manos atadas)' : ''}.`);
  else {
    title(player, '§7§lPRISIÓN', `§f${fmtTime(j.left)} §7de condena`);
    msg(player, `§7${GLYPH.shackles} ${say(pick(JAIL_ENTER), { fem: d.gender === 'f' })} §7Condena: §f${fmtTime(j.left)}§7 por ${crimeList(j.crimes)}.`);
    if (!j.virtual) msg(player, KEY_HINT);
    psound(player, 'random.door_close', 1, 0.6);
  }
  dirty(player);
}

function ensurePatrol(s) {
  if (!patrols.has(s.id)) patrols.set(s.id, { sid: s.id, jailer: undefined, left: 0, dur: 0, next: randInt(law('patrolMin'), law('patrolMax')), tried: new Set() });
}

function startPatrol(pt, prisoners) {
  const s = crime.getSettlementSafe(pt.sid);
  const pp = centerOf(s?.jail?.patrol ?? s?.jail?.exit);
  if (!pp) { pt.next = 120; return; }
  const dim = dimOf(s.dim ?? 'minecraft:overworld');
  let cands = [];
  try { cands = dim.getEntities({ type: NPC, families: ['rpg_guard'], location: pp, maxDistance: 64, excludeTags: ['rpg_escort', 'rpg_hunting'] }); } catch {}
  const jailer = cands.find((g) => identOf(g)?.job === 'carcelero') ?? cands[0];
  if (!jailer) { pt.next = 60; return; }
  pt.jailer = jailer;
  pt.left = pt.dur = law('patrolSeconds');
  pt.tried = new Set();
  try { jailer.triggerEvent('rpg:act_patrol_jail'); } catch {}
  try { jailer.addTag('rpg_busy'); jailer.addTag('rpg_jailer'); } catch {}
  const line = pick(PATROL_START);
  for (const p of prisoners) {
    const j = getP(p)?.justice;
    msg(p, '§e' + line);
    if (j?.tied) {
      effect(p, 'saturation', 20, 0);
      msg(p, '§8El carcelero te da de comer en la boca, con muy poca delicadeza.');
    } else {
      if (countItem(p, 'minecraft:bread') < 2 && giveItem(p, 'minecraft:bread', 1)) msg(p, '§8' + PATROL_FOOD);
      if (chance(0.5)) msg(p, KEY_HINT);
    }
  }
}

function endPatrol(pt) {
  releaseGuard(pt.jailer);
  pt.jailer = undefined;
  pt.left = 0;
  pt.next = randInt(law('patrolMin'), law('patrolMax'));
}

function patrolTick() {
  for (const [sid, pt] of [...patrols]) {
    try {
      const prisoners = onlinePrisoners(sid);
      if (!prisoners.length) {
        if (pt.left > 0) endPatrol(pt);
        patrols.delete(sid);
        continue;
      }
      if (pt.left > 0) {
        pt.left--;
        if (valid(pt.jailer) && pt.dur - pt.left === 10) {
          const pp = centerOf(crime.getSettlementSafe(sid)?.jail?.patrol);
          try { if (pp && dist(pt.jailer.location, pp) > 8) pt.jailer.teleport(pp); } catch {}
        }
        if (pt.left <= 0 || !valid(pt.jailer)) endPatrol(pt);
      } else if (--pt.next <= 0) startPatrol(pt, prisoners);
    } catch (e) { console.warn('[Aetheria] ronda: ' + e); }
  }
}

function jailFast(player, d, j) {
  const cell = cellOf(j);
  if (!cell) return;
  let l;
  try { l = player.location; } catch { return; }
  if (!insideCell(l, cell)) {
    try { player.teleport(centerOf(cell.spawn ?? cellCenter(cell)), { dimension: dimOf(j.dim) }); } catch {}
    note(player, '§7Los barrotes no ceden. §8(Cumple tu condena... o consigue la llave.)');
    return;
  }
  if (j.virtual || j.tied || crime.inMinigame(player)) return;
  const pt = patrols.get(j.sid);
  if (!pt || pt.left <= 0 || !valid(pt.jailer) || pt.tried.has(player.id)) return;
  let sneaking = false;
  try { sneaking = !!player.isSneaking; } catch {}
  if (!sneaking) return;
  try { if (dist(pt.jailer.location, l) > law('keyReach')) return; } catch { return; }
  tryKey(player, pt);
}

function tryKey(player, pt) {
  pt.tried.add(player.id);
  const jailer = pt.jailer;
  const rel = crime.relativePos(jailer, player);
  const z = crime.zoneFor(player, 'key', { behind: rel.behind, facing: rel.facing });
  crime.startMinigame(player, {
    kind: 'key', label: `Robando la llave al carcelero ${crime.npcName(jailer)}`,
    victim: jailer, maxDist: 3.6, zone: z.zone, speed: z.speed, exclude: new Set([jailer.id]),
    onSuccess: (g, seers) => keySuccess(player, seers),
    onFail: () => keyCaught(player, jailer),
    onAbort: (reason) => { if (reason === 'released' || reason === 'far') pt.tried.delete(player.id); },
  });
}

function keySuccess(player, seers) {
  const d = getP(player);
  const j = d?.justice;
  if (!j || j.state !== 'jail') return;
  const g = seers.find((x) => crime.isGuard(x.e));
  if (g) return keyCaught(player, g.e);
  if (!crime.giveJailKey(player)) return;
  j.keyOk = true; // esta llave sí abre su celda
  const t = crime.thiefOf(d);
  t.keys++;
  crime.addThiefXp(player, 20);
  title(player, '§a' + EYE.CLOSED, '§a¡Tienes la llave!');
  msg(player, '§a✔ ' + KEY_SUCCESS);
  psound(player, 'random.orb', 0.6, 1.2);
  dirty(player);
}

function keyCaught(player, jailer) {
  const d = getP(player);
  const j = d?.justice;
  if (!j || j.state !== 'jail') return;
  j.tied = true;
  j.keyOk = false;
  j.left += law('tiedExtraSeconds');
  addTags(player, 'rpg_tied');
  removeItem(player, 'rpg:jail_key', 64);
  crime.markSeen(player, 100);
  crime.thiefOf(d).caught++;
  const pt = patrols.get(j.sid);
  if (pt?.left > 0) endPatrol(pt);
  title(player, '§c' + EYE.OPEN, '§c¡Te han pillado!');
  msg(player, `§c${GLYPH.shackles} ${pick(KEY_CAUGHT)} §7(+${law('tiedExtraSeconds')} s de condena)`);
  if (valid(jailer)) npcSay(jailer, pick(['¡Ni lo sueñes, rata!', '¡Las manos donde pueda verlas!', gw(d, '¡Este intentaba escaparse! ¡Atadle!', '¡Esta intentaba escaparse! ¡Atadla!')]), {}, 16);
  psound(player, 'armor.equip_chain', 1, 0.6);
  dirty(player);
}

function isCellDoor(j, block) {
  const cell = cellOf(j);
  if (!cell?.door?.length || !block) return false;
  let l;
  try { l = block.location; } catch { return false; }
  return cell.door.some((p0) => { const p = doorPos(p0); return p.x === l.x && p.y === l.y && p.z === l.z; });
}

/** Usar la llave de la celda (desde el objeto o tocando la puerta). */
export function useKey(player) {
  const d = getP(player);
  const j = d?.justice;
  if (!j || j.state !== 'jail') { actionbar(player, '§7Esta llave no abre nada por aquí.'); return false; }
  if (j.tied) { actionbar(player, `§c${GLYPH.shackles} Con las manos atadas no puedes usar la llave.`); return false; }
  const cell = cellOf(j);
  if (j.virtual || !cell?.door?.length) { actionbar(player, '§7Esta celda no tiene una cerradura que esa llave pueda abrir.'); return false; }
  let l;
  try { l = player.location; } catch { return false; }
  if (!cell.door.some((p) => dist(blockCenter(p), l) <= 3)) { actionbar(player, '§7Acércate a la puerta de la celda.'); return false; }
  if (!j.keyOk) { actionbar(player, '§7Esta llave no encaja en la cerradura de tu celda. §8(Tendrás que robársela al carcelero.)'); return false; }
  const o = crime.observe(player, { guardsOnly: true });
  if (o.seers.length) { keyCaught(player, o.seers[0].e); return false; }
  if (!removeItem(player, 'rpg:jail_key', 1)) return false;
  const dim = dimOf(j.dim) ?? player.dimension;
  openDoor(dim, cell);
  j.state = 'escaped';
  j.esc = law('escapeNoticeSeconds');
  j.pending = Math.max(0, j.left);
  removeTags(player, 'rpg_jailed', 'rpg_tied');
  setMovement(player, true);
  try { player.removeEffect('mining_fatigue'); } catch {}
  crime.thiefOf(d).escapes++;
  crime.addThiefXp(player, 15);
  title(player, '§a§l¡LA PUERTA SE ABRE!', `§7Huye: darán la alarma en ${j.esc} s`);
  msg(player, '§a✔ La cerradura gira con un chirrido. §7¡Corre! Cuando noten la celda vacía, toda la guardia saldrá a buscarte.');
  psound(player, 'random.door_open', 1, 0.7);
  dirty(player);
  return true;
}

function doorPos(p) {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/**
 * Abre la puerta de la celda: quita TODOS los bloques de puerta registrados (los barrotes a la altura de los pies y de
 * la cabeza del preso) y anota cada uno para volver a poner los barrotes de la celda (cell.doorBlock) en doorTick.
 */
function openDoor(dim, cell) {
  const w = W();
  if (!Array.isArray(w.justiceDoors)) w.justiceDoors = [];
  const type = cell.doorBlock ?? 'minecraft:iron_bars';
  for (const p0 of cell.door ?? []) {
    const p = doorPos(p0);
    try { dim.setBlockType(p, 'minecraft:air'); } catch {}
    const old = w.justiceDoors.find((r) => r.dim === dim.id && r.x === p.x && r.y === p.y && r.z === p.z);
    if (old) { old.left = law('doorOpenSeconds'); old.tries = 0; } else w.justiceDoors.push({ dim: dim.id, x: p.x, y: p.y, z: p.z, type, left: law('doorOpenSeconds'), tries: 0 });
  }
  try { sound(dim, 'random.door_open', blockCenter(cell.door[0]), 1, 0.6); } catch {}
  wDirty();
}

/** Cierra las puertas abiertas: vuelve a poner los barrotes en cada bloque anotado (cuando nadie está en el hueco). */
function doorTick() {
  const w = W();
  const list = w.justiceDoors;
  if (!Array.isArray(list) || !list.length) return;
  for (const r of [...list]) {
    if (--r.left > 0) continue;
    const blocked = world.getAllPlayers().some((p) => {
      try { return p.dimension.id === r.dim && Math.floor(p.location.x) === r.x && Math.floor(p.location.z) === r.z && p.location.y > r.y - 2 && p.location.y < r.y + 1; } catch { return false; }
    });
    if (blocked && r.tries++ < 10) { r.left = 1; continue; }
    const dim = dimOf(r.dim);
    try {
      if (!dim) throw new Error('sin dimensión');
      dim.setBlockType({ x: r.x, y: r.y, z: r.z }, r.type || 'minecraft:iron_bars');
    } catch { r.left = 10; r.fails = (r.fails ?? 0) + 1; if (r.fails < 360) continue; } // chunk descargado: se reintenta (~1 h)
    list.splice(list.indexOf(r), 1);
  }
  wDirty();
}

function isDoorOpen(p) {
  const q = doorPos(p);
  return (W().justiceDoors ?? []).some((r) => r.x === q.x && r.y === q.y && r.z === q.z);
}

/** Repara los barrotes de la celda si alguien los rompió. */
function checkBars(j) {
  const cell = cellOf(j);
  if (j.virtual || !cell?.door?.length) return;
  const dim = dimOf(j.dim);
  const type = cell.doorBlock ?? 'minecraft:iron_bars';
  for (const p0 of cell.door) {
    if (isDoorOpen(p0)) continue;
    const p = doorPos(p0);
    try {
      const b = dim.getBlock(p);
      if (b && b.isAir) dim.setBlockType(p, type);
    } catch {}
  }
}

function jailSecond(player, d, j) {
  j.left--;
  j.el = (j.el ?? 0) + 1;
  if (j.left <= 0) return releaseFromJail(player, d, j);
  if (j.el % 5 === 0) {
    effect(player, 'mining_fatigue', 140, 3);
    checkBars(j);
  }
  if (--j.nextFlavor <= 0) {
    j.nextFlavor = randInt(90, 160);
    msg(player, '§8' + pick(JAIL_FLAVOR));
  }
  if (j.left === 60) msg(player, '§7Te queda §f1 minuto§7 de condena.');
  if (j.el % 10 === 0) dirty(player);
}

function releaseFromJail(player, d, j) {
  const s = crime.getSettlementSafe(j.sid);
  const exit = j.virtual ? undefined : centerOf(s?.jail?.exit ?? stocksPoint(s));
  if (exit) try { player.teleport(exit, { dimension: dimOf(j.dim) }); } catch {}
  untie(player);
  d.justice = undefined;
  crime.clearWanted(player);
  try { player.removeEffect('mining_fatigue'); } catch {}
  removeItem(player, 'rpg:jail_key', 64);
  crime.thiefOf(d).punished++;
  addKarma(player, -10, 'condena cumplida');
  try { hooks.onPunished?.(player, 'jail', j.crimes ?? []); } catch (e) { console.warn('[Aetheria] onPunished: ' + e); }
  title(player, '§a§lLIBERTAD', '§7Has cumplido tu condena');
  msg(player, '§a✔ ' + pick(JAIL_RELEASE));
  psound(player, 'random.door_open', 1, 0.9);
  dirty(player);
}

function escapedSecond(player, d, j) {
  j.esc--;
  if (j.esc === 10) actionbar(player, '§c¡Date prisa! §7Pronto notarán la celda vacía...');
  if (j.esc > 0) return;
  const pending = j.pending ?? 0;
  const s = crime.getSettlementSafe(j.sid);
  d.justice = undefined;
  untie(player);
  dirty(player);
  const pp = s?.jail?.patrol ?? s?.jail?.exit;
  if (pp) {
    const g = crime.guardsNear(dimOf(j.dim), pp, 48)[0];
    if (g) npcSay(g, pick(SHOUTS.escape), { thief: player.name, fem: d.gender === 'f' }, 64);
    else crime.localMsg(j.dim, pp, `§c[Prisión] §f${say(pick(SHOUTS.escape), { thief: player.name, fem: d.gender === 'f' })}`, 64);
  }
  reportCrime(player, 'fuga', { known: true, settlement: s });
  const w = getP(player)?.wanted;
  if (w) { w.pending = Math.min(law('maxJailMinutes') * 60, pending); dirty(player); }
}

/* ------------------------------------------------------------------ */
/* Arresto por contacto                                                */
/* ------------------------------------------------------------------ */

function touchArrest(player, d) {
  const w = d.wanted;
  let list = [];
  try { list = crime.guardsNear(player.dimension, player.location, law('arrestTouchDist') + 0.3, w.realmId); } catch {}
  const g = list.find((x) => crime.isHunting(x, player.id)) ?? list.find((x) => { try { return !x.hasTag('rpg_escort') && !x.hasTag('rpg_jailer'); } catch { return false; } });
  if (!g) { touch.delete(player.id); return; }
  const t = (touch.get(player.id) ?? 0) + 4;
  touch.set(player.id, t);
  if (t >= law('arrestTouchTicks')) arrest(player, g);
}

/* ------------------------------------------------------------------ */
/* Eventos (los conecta main.js)                                       */
/* ------------------------------------------------------------------ */

/** before playerInteractWithEntity. true = gestionado (no abrir el menú del NPC). */
export function onBeforeInteractEntity(ev) {
  const player = ev.player;
  const target = ev.target;
  if (!player || !target) return false;
  if (isRestricted(player)) {
    ev.cancel = true;
    note(player, `§c${GLYPH.shackles} Tienes las manos atadas.`);
    return true;
  }
  let tId;
  try { tId = target.typeId; } catch { return false; }
  if (tId !== NPC) return false;
  if (crime.inMinigame(player)) { ev.cancel = true; return true; }
  let sneaking = false;
  try { sneaking = !!player.isSneaking; } catch {}
  if (!sneaking) return false;
  const j = getP(player)?.justice;
  if (j?.state === 'jail') {
    const pt = patrols.get(j.sid);
    ev.cancel = true;
    if (pt?.left > 0 && pt.jailer && pt.jailer.id === target.id && !j.tied && !pt.tried.has(player.id)) system.run(() => { try { tryKey(player, pt); } catch (e) { console.warn('[Aetheria] llave: ' + e); } });
    return true;
  }
  ev.cancel = true;
  system.run(() => { try { crime.startPickpocket(player, target); } catch (e) { console.warn('[Aetheria] robo: ' + e); } });
  return true;
}

/** before playerInteractWithBlock. true = gestionado. */
export function onBeforeInteractBlock(ev) {
  const player = ev.player;
  if (!player) return false;
  if (isRestricted(player)) {
    ev.cancel = true;
    note(player, `§c${GLYPH.shackles} Con las manos atadas no puedes hacer eso.`);
    return true;
  }
  const j = getP(player)?.justice;
  if (j?.state === 'jail' && isCellDoor(j, ev.block)) {
    ev.cancel = true;
    if (ev.itemStack?.typeId === 'rpg:jail_key') system.run(() => { try { useKey(player); } catch (e) { console.warn('[Aetheria] llave: ' + e); } });
    else note(player, '§7Los barrotes no ceden. §8(Necesitarías la llave...)');
    return true;
  }
  try { return crime.onChestInteract(ev); } catch (e) { console.warn('[Aetheria] cofre: ' + e); return false; }
}

const NO_JAIL_ITEMS = new Set(['minecraft:ender_pearl', 'minecraft:chorus_fruit']);

/** before itemUse. true = cancelado. */
export function onBeforeItemUse(ev) {
  const p = ev.source;
  let t;
  try { t = p?.typeId; } catch { return false; }
  if (t !== 'minecraft:player') return false;
  if (isRestricted(p)) {
    ev.cancel = true;
    note(p, `§c${GLYPH.shackles} Tienes las manos atadas.`);
    return true;
  }
  let jailed = false;
  try { jailed = p.hasTag('rpg_jailed'); } catch {}
  if (jailed && NO_JAIL_ITEMS.has(ev.itemStack?.typeId)) {
    ev.cancel = true;
    note(p, '§7Un conjuro de los carceleros protege estas celdas.');
    return true;
  }
  return false;
}

/** before entityHurt: los golpes de un guardia a un buscado son un arresto; nadie daña a un preso atado. */
export function onBeforeEntityHurt(ev) {
  const victim = ev.hurtEntity;
  const src = ev.damageSource;
  const att = src?.damagingEntity;
  let vType;
  let aType;
  let pType;
  try { vType = victim?.typeId; } catch {}
  try { aType = att?.typeId; } catch {}
  try { pType = src?.damagingProjectile?.typeId; } catch {}
  if (pType === 'rpg:tomato' || aType === 'rpg:tomato') { ev.cancel = true; return true; }
  if (aType === 'minecraft:player' && src?.cause === 'entityAttack' && isRestricted(att)) {
    ev.cancel = true;
    note(att, `§c${GLYPH.shackles} Tienes las manos atadas.`);
    return true;
  }
  if (vType !== 'minecraft:player') return false;
  try {
    if (victim.hasTag('rpg_arrested') || victim.hasTag('rpg_humiliated')) {
      if (att || src?.cause === 'entityAttack' || src?.cause === 'projectile') { ev.cancel = true; return true; }
      return false;
    }
    if (aType === NPC) {
      if (victim.hasTag('rpg_jailed')) { ev.cancel = true; return true; }
      if (victim.hasTag('rpg_wanted') && crime.isGuard(att)) {
        ev.cancel = true;
        const p = victim;
        const g = att;
        system.run(() => { try { arrest(p, g); } catch (e) { console.warn('[Aetheria] arresto: ' + e); } });
        return true;
      }
    }
  } catch {}
  return false;
}

/** after entityHurt. */
export function onEntityHurt(ev) {
  try { crime.onEntityHurt(ev); } catch (e) { console.warn('[Aetheria] justicia hurt: ' + e); }
}

/** after entityDie. */
export function onEntityDie(ev) {
  try { crime.onEntityDie(ev); } catch (e) { console.warn('[Aetheria] justicia die: ' + e); }
}

/** after projectileHitEntity / projectileHitBlock. */
export function onProjectileHit(ev) {
  let type;
  try { type = ev.projectile?.typeId; } catch {}
  if (type !== 'rpg:tomato') return false;
  const dim = ev.dimension;
  const loc = ev.location;
  particle(dim, 'rpg:tomato_splash', loc);
  let hit;
  try { hit = ev.getEntityHit?.()?.entity; } catch {}
  if (!hit) { sound(dim, 'mob.slime.small', loc, 0.6, 1.2); return true; }
  let ht;
  try { ht = hit.typeId; } catch { return true; }
  if (ht === 'minecraft:player') {
    const j = getP(hit)?.justice;
    if (j?.state === 'humiliation') {
      j.tomatoes = (j.tomatoes ?? 0) + 1;
      const h = humil.get(hit.id);
      if (h) h.lastTomato = system.currentTick;
      if (chance(0.35)) actionbar(hit, `§c${GLYPH.tomato} ¡Plaf! §7(${j.tomatoes})`);
    }
    psound(hit, 'mob.slime.small', 1, 0.9);
  } else if (ht === NPC) {
    const src = crime.ownerPlayer(ev.source);
    const now = system.currentTick;
    if (src && !crime.isGuard(hit) && now - (npcReact.get(hit.id) ?? -999) > 100) {
      npcReact.set(hit.id, now);
      if (npcReact.size > 200) npcReact.clear();
      npcSay(hit, pick(TOMATO_REACT), {}, 16);
      try { hit.setProperty('rpg:mood', 2); } catch {}
      system.runTimeout(() => { try { if (valid(hit) && !hit.hasTag('rpg_alarm')) hit.setProperty('rpg:mood', 0); } catch {} }, 60);
    }
  }
  return true;
}

/** after itemUse (el integrador pasa el jugador y el objeto). true = gestionado. */
export function onItemUse(player, item) {
  const id = item?.typeId;
  if (!player || !id) return false;
  if (id === 'rpg:jail_key') { useKey(player); return true; }
  if (id === 'rpg:wanted_poster') { showPoster(player); return true; }
  if (id === 'rpg:lockpick') {
    actionbar(player, '§7Agáchate junto a un cofre cerrado y tócalo para forzar la cerradura con la ganzúa.');
    return true;
  }
  return false;
}

/** Cartel de Se Busca: los jugadores buscados del servidor. */
export function showPoster(player) {
  const list = [];
  for (const p of world.getAllPlayers()) {
    const w = getP(p)?.wanted;
    if ((w?.stars ?? 0) > 0) list.push([p, w]);
  }
  list.sort((a, b) => b[1].stars - a[1].stars);
  let body;
  if (!list.length) body = '§7El cartel está en blanco.\n§8No hay nadie en busca y captura... por ahora.';
  else {
    body = list.map(([p, w]) => {
      const s = crime.getSettlementSafe(w.settlementId);
      const realm = crime.realmOfSafe(s);
      return `§c§lSE BUSCA§r\n§f${p.name}\n${starText(w.stars)}\n§7Delitos: §f${crimeList(w.crimes)}\n${realm?.name ? `§7Por orden ${ofRuler(realm)} de §f${realm.name}\n` : ''}§6Recompensa: ${25 * w.stars * w.stars} oro`;
    }).join('\n\n§8────────\n\n');
  }
  guarded(player, () => info(player, '§c§lCartel de Se Busca', body));
}

/** Al aparecer (inicial o reaparición): reanuda escolta, castigo o prisión. */
export function onPlayerSpawn(player, initial) {
  const d = getP(player);
  if (!d) return;
  touch.delete(player.id);
  crime.cancelMinigame(player);
  const j = d.justice;
  if (!j) {
    let stale = false;
    for (const t of CUSTODY_TAGS) try { if (player.hasTag(t)) stale = true; } catch {}
    if (stale || initial) untie(player);
    try {
      if ((d.wanted?.stars ?? 0) > 0) player.addTag('rpg_wanted');
      else player.removeTag('rpg_wanted');
    } catch {}
    if (initial && (d.wanted?.stars ?? 0) > 0) msg(player, `§c${EYE.OPEN} Sigues en busca y captura. ${starText(d.wanted.stars)}`);
    return;
  }
  switch (j.state) {
    case 'parley': {
      parleyGuards.delete(player.id);
      d.justice = undefined;
      removeTags(player, 'rpg_arrested');
      carryPending(player, d, j, true);
      const s = crime.getSettlementSafe(j.sid);
      if ((d.wanted?.stars ?? 0) > 0) beginEscort(player, d, undefined, s, crime.realmOfSafe(s));
      else untie(player);
      break;
    }
    case 'escort':
      escorts.delete(player.id);
      arrive(player, d, j, true);
      break;
    case 'humiliation': {
      const old = humil.get(player.id);
      if (old) { releaseJeerers(old); humil.delete(player.id); }
      beginHumiliation(player, d, j, valid(old?.guard) ? old.guard : undefined, true);
      break;
    }
    case 'jail':
      enterJail(player, d, j, undefined, true);
      break;
    case 'escaped':
      setMovement(player, true);
      break;
    default:
      d.justice = undefined;
      untie(player);
  }
}

/** Al salir el jugador (opcional): limpia el estado de sesión sin tocar los datos guardados. */
export function onPlayerLeave(player) {
  let pid;
  try { pid = player.id; } catch { return; }
  system.run(() => {
    try {
      const h = humil.get(pid);
      if (h) { releaseJeerers(h); if (valid(h.guard)) releaseGuard(h.guard); humil.delete(pid); }
      const es = escorts.get(pid);
      if (es && valid(es.guard)) releaseGuard(es.guard);
      escorts.delete(pid);
      parleyGuards.delete(pid);
      touch.delete(pid);
      crime.releaseHunters(pid);
    } catch {}
  });
  try { crime.forgetPlayer(player); } catch {}
}

/* ------------------------------------------------------------------ */
/* NPCs huérfanos (recarga del mundo o de los scripts, chunk descargado) */
/* ------------------------------------------------------------------ */

const DIMS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];

/** Ids de los NPCs que la justicia controla ahora mismo (escoltas, cepo, abucheos, rondas, negociaciones). */
function liveIds() {
  const ids = new Set();
  const add = (e) => { try { if (e) ids.add(e.id); } catch {} };
  for (const es of escorts.values()) add(es.guard);
  for (const h of humil.values()) {
    add(h.guard);
    for (const id of h.jeerers.keys()) ids.add(id);
  }
  for (const pt of patrols.values()) add(pt.jailer);
  for (const g of parleyGuards.values()) add(g);
  return ids;
}

/**
 * Libera un NPC que conserva etiquetas de la justicia (o el "(!)" en el nombre) pero que ya no está en ningún mapa
 * vivo: los mapas son de sesión, mientras que etiquetas, grupo de actividad y propiedades se guardan con la entidad.
 * Devuelve true si lo ha liberado.
 */
function healOrphan(e, ids) {
  let tagged = false;
  let prefixed = false;
  try {
    if (!valid(e) || e.typeId !== NPC) return false;
    tagged = crime.JUSTICE_TAGS.some((t) => e.hasTag(t));
    prefixed = String(e.nameTag ?? '').startsWith(crime.ALERT_PREFIX);
  } catch { return false; }
  if (!tagged && !prefixed) return false;
  if (crime.attachAlarm(e)) return false; // testigo con una alarma guardada: sigue corriendo hacia la guardia
  if (crime.isTracked(e.id) || (ids ?? liveIds()).has(e.id)) return false;
  crime.freeNpc(e);
  return true;
}

/** Repasa los NPCs ocupados cargados (cada ~10 s desde secondTick). Devuelve cuántos ha liberado. */
export function orphanSweep() {
  const ids = liveIds();
  let n = 0;
  for (const id of DIMS) {
    const dim = dimOf(id);
    if (!dim) continue;
    let list = [];
    try { list = dim.getEntities({ type: NPC, tags: ['rpg_busy'] }); } catch {}
    for (const e of list) try { if (healOrphan(e, ids)) n++; } catch {}
  }
  return n;
}

/** world.afterEvents.entityLoad (lo conecta main.js): un NPC que vuelve a cargarse con restos de la justicia. */
export function onEntityLoad(ev) {
  if (!ready) return; // aún sin mundo: lo recoge la primera limpieza periódica
  try {
    const e = ev?.entity;
    if (!e || e.typeId !== NPC) return;
    healOrphan(e);
  } catch (err) { console.warn('[Aetheria] justicia load: ' + err); }
}

/* ------------------------------------------------------------------ */
/* Bucles                                                              */
/* ------------------------------------------------------------------ */

/** Cada 2 ticks. */
export function fastTick() {
  fastN++;
  try { crime.crimeFastTick(fastN); } catch (e) { console.warn('[Aetheria] crimen rápido: ' + e); }
  for (const player of world.getAllPlayers()) {
    try {
      const d = getP(player);
      if (!d) continue;
      const j = d.justice;
      if (j) {
        if (j.state === 'escort') escortTick(player, d, j);
        else if (j.state === 'humiliation') humiliationFast(player, d, j);
        else if (j.state === 'jail' && fastN % 5 === 0) jailFast(player, d, j);
      } else if ((d.wanted?.stars ?? 0) > 0 && fastN % 2 === 0) touchArrest(player, d);
    } catch (e) { console.warn('[Aetheria] justicia: ' + e + (e?.stack ? '\n' + e.stack : '')); }
  }
}

/** Cada segundo. */
export function secondTick() {
  ready = true;
  try { crime.crimeSecondTick(); } catch (e) { console.warn('[Aetheria] crimen: ' + e); }
  try { doorTick(); } catch (e) { console.warn('[Aetheria] puertas: ' + e); }
  try { patrolTick(); } catch (e) { console.warn('[Aetheria] rondas: ' + e); }
  for (const player of world.getAllPlayers()) {
    try {
      const d = getP(player);
      const j = d?.justice;
      if (!j) continue;
      switch (j.state) {
        case 'parley':
          j.el = (j.el ?? 0) + 1;
          if (j.el > 30) resolveParley(player, false);
          break;
        case 'escort':
          j.el = (j.el ?? 0) + 1;
          break;
        case 'humiliation': humiliationSecond(player, d, j); break;
        case 'jail': jailSecond(player, d, j); break;
        case 'escaped': escapedSecond(player, d, j); break;
      }
    } catch (e) { console.warn('[Aetheria] justicia: ' + e + (e?.stack ? '\n' + e.stack : '')); }
  }
  if (--sweepIn <= 0) {
    sweepIn = 10;
    try { orphanSweep(); } catch (e) { console.warn('[Aetheria] limpieza justicia: ' + e); }
  }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

/** Estado para el HUD: ojo + estrellas, o la cuenta atrás del castigo ('' si no hay nada). */
export function hudStatus(player) {
  let d;
  try { d = getP(player); } catch { return ''; }
  if (!d) return '';
  const j = d.justice;
  if (j) {
    switch (j.state) {
      case 'parley': return `§e${GLYPH.shackles} Negociando con la guardia...`;
      case 'escort': return `§c${GLYPH.shackles} ${gw(d, 'Detenido', 'Detenida')} §7· te llevan ${j.kind === 'stocks' ? 'al cepo' : 'a prisión'}`;
      case 'humiliation': return `§c${GLYPH.tomato} Castigo público §f${fmtTime(j.left)}`;
      case 'jail': {
        const pt = patrols.get(j.sid);
        return `§7${GLYPH.shackles} Prisión §f${fmtTime(j.left)}${j.tied ? ' §c(manos atadas)' : ''}${pt?.left > 0 ? ' §e· ronda del carcelero' : ''}`;
      }
      case 'escaped': return `§c${EYE.OPEN} ¡FUGA! §7Darán la alarma en §f${Math.max(0, j.esc)}s`;
    }
  }
  try { return crime.stealthHud(player); } catch { return ''; }
}

/* ------------------------------------------------------------------ */
/* Diario y administración                                             */
/* ------------------------------------------------------------------ */

/** Resumen de sigilo y antecedentes para el Diario. */
export function profileText(player) {
  const d = getP(player);
  if (!d) return '';
  const t = d.thief ?? { lvl: 1, xp: 0, steals: 0, caught: 0, gold: 0 };
  const lines = [
    `§5Sigilo: §fnivel ${t.lvl ?? 1}§7/${crime.THIEF_MAX} §8(${t.xp ?? 0}/${crime.thiefNeed(t.lvl ?? 1)} XP)`,
    `§7Bolsillos vaciados: §f${t.steals ?? 0} §7· Cofres: §f${t.houses ?? 0} §7· Oro robado: §6${t.gold ?? 0}`,
    `§7Veces que te pillaron: §f${t.caught ?? 0} §7· Castigos: §f${t.punished ?? 0} §7· Fugas: §f${t.escapes ?? 0}`,
  ];
  const w = d.wanted;
  if ((w?.stars ?? 0) > 0) lines.push(`§cSE BUSCA ${starText(w.stars)} §7por ${crimeList(w.crimes)}`);
  else lines.push('§aNadie te busca ahora mismo.');
  if (d.justice) lines.push('§7Estado: ' + hudStatus(player));
  const rec = Object.entries(d.record ?? {}).filter(([k, n]) => CRIMES[k] && n > 0).map(([k, n]) => `${CRIMES[k].name} ×${n}`);
  if (rec.length) lines.push('§7Antecedentes: §f' + rec.join('§7, §f'));
  lines.push('§8Agáchate junto a alguien y tócale para robarle: suelta agacharse cuando la aguja esté en la zona verde. A su espalda, de noche o si duerme es mucho más fácil.');
  return lines.join('\n');
}

/** Administración: fija las estrellas de búsqueda (0 = perdón). */
export function setWanted(player, stars, type = 'hurto') {
  const d = getP(player);
  if (!d) return;
  stars = clamp(Math.round(Number(stars) || 0), 0, law('maxStars'));
  if (!stars) { crime.clearWanted(player); return; }
  let s;
  try { s = crime.jurisdictionOf(player.dimension.id, player.location); } catch {}
  d.wanted = { stars, crimes: [CRIMES[type] ? type : 'hurto'], decay: 0, settlementId: s?.id, realmId: s?.realmId, severity: severityOf(stars), day: world.getDay() };
  try { player.addTag('rpg_wanted'); } catch {}
  dirty(player);
}

/** Administración: indulto total (sale de la custodia y se borra la búsqueda). */
export function pardon(player) {
  const d = getP(player);
  const pid = player.id;
  const h = humil.get(pid);
  if (h) { releaseJeerers(h); if (valid(h.guard)) releaseGuard(h.guard); humil.delete(pid); }
  const es = escorts.get(pid);
  if (es && valid(es.guard)) releaseGuard(es.guard);
  escorts.delete(pid);
  parleyGuards.delete(pid);
  crime.cancelMinigame(player);
  if (d) { d.justice = undefined; dirty(player); }
  crime.clearWanted(player);
  untie(player);
  try { player.removeEffect('mining_fatigue'); } catch {}
  msg(player, '§a✔ Has recibido un indulto real. Eres libre y nadie te busca.');
}

/** Acceso para pruebas. */
export const _t = {
  escorts, humil, patrols, touch, parleyGuards,
  /** Simula una recarga de los scripts: se pierde lo que solo vivía en memoria. */
  reload() { escorts.clear(); humil.clear(); patrols.clear(); parleyGuards.clear(); touch.clear(); crime._t.reload(); },
};
