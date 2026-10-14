// Economía viva: índice de precios por asentamiento (cultura, foco económico y prosperidad del reino, fluctuación
// diaria y eventos de mercado), factor personal (clase, raza, karma, fama, habilidad de comercio), impuesto real,
// bolsas de los NPCs que se rellenan cada día, regateo con los mercaderes y carteristas NPC que te roban la bolsa.
// Contrato §6.4: priceFactor(player, settlement, itemId, mode), haggle(player, merchantIdent, basePrice, mode).
import { world, system } from '@minecraft/server';
import { ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { getP, dirty } from '../core/store.js';
import { msg, title, addGold, addKarma, actionbar } from '../core/progression.js';
import { stat, isHero, isVillain, stageOf } from '../core/profile.js';
import {
  socialOf, playerClass, fame, infamy, attitude, address, placeOf, nearPlace, realmOfSafe, getSettlementSafe, realmById,
  recordDeed, tradeLevel,
} from './social.js';
import {
  CULTURE_PRICES, FOCUS_PRICES, TAX_BY_GOV, MARKET_EVENTS, itemCategory, WALLET, MERCHANT_WALLET, HAGGLE, HAGGLE_PERS,
  CATEGORY_NAMES, JOBS,
} from '../data/social.js';
import { jobLabel } from '../data/names.js';
import { genderize, moodOf } from './chat.js';
import { show, info } from '../util/ui.js';
import { fill } from '../util/text.js';
import { hash, seeded, clamp, randInt, rand, pick, weighted, dist } from '../util/math.js';
import { particle, psound, valid, isSolid } from '../util/compat.js';

const NPC = 'rpg:npc';

/** Funciones que otros sistemas asignan (life.js asigna `bubble`). */
export const hooks = {
  bubble: undefined, // (entity, text, seconds) — bocadillo sobre la cabeza del NPC
  isRestricted: undefined, // (player) => boolean — justicia: manos atadas, arrestado...
};

/* ------------------------------------------------------------------ */
/* Identidades (lectura/escritura directa para no depender de npc.js)   */
/* ------------------------------------------------------------------ */

export function readIdent(e) {
  try {
    const raw = e.getDynamicProperty('rpg:npc');
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
}
export function writeIdent(e, ident) {
  try { e.setDynamicProperty('rpg:npc', JSON.stringify(ident)); } catch {}
}

const say = (ident, d, text, v = {}) => genderize(fill(text, v), d?.gender, ident?.gender);

/* ------------------------------------------------------------------ */
/* Habilidad de comercio                                                */
/* ------------------------------------------------------------------ */

export const TRADE_MAX = 30;
export const tradeNeed = (lvl) => 30 + lvl * 25;

export function addTradeXp(player, n) {
  const d = getP(player);
  if (!d || n <= 0) return;
  const t = socialOf(d).trade;
  t.xp = (t.xp ?? 0) + n;
  while ((t.lvl ?? 1) < TRADE_MAX && t.xp >= tradeNeed(t.lvl ?? 1)) {
    t.xp -= tradeNeed(t.lvl ?? 1);
    t.lvl = (t.lvl ?? 1) + 1;
    msg(player, `§a✦ Comercio sube a nivel §l${t.lvl}§r§a. §7(Mejores precios y regateos más fáciles)`);
    psound(player, 'random.orb', 1, 1.3);
  }
  dirty(player);
}

/* ------------------------------------------------------------------ */
/* Índice de precios                                                    */
/* ------------------------------------------------------------------ */

const eventCache = new Map(); // sid|day -> event|null

/** Evento de mercado del día en un asentamiento (o undefined). Determinista por asentamiento y día. */
export function marketEvent(settlement, day = world.getDay()) {
  const s = getSettlementSafe(settlement);
  if (!s?.id) return undefined;
  const key = s.id + '|' + day;
  if (eventCache.has(key)) return eventCache.get(key) ?? undefined;
  const rng = seeded(hash('mkt:' + s.id + ':' + day));
  let ev = null;
  if (rng() < 0.38) ev = weighted(MARKET_EVENTS.map((e) => [e, e.w ?? 1]), rng);
  eventCache.set(key, ev);
  if (eventCache.size > 300) eventCache.clear();
  return ev ?? undefined;
}

/** Línea de pregón del evento de mercado (para los NPCs). */
export function eventLine(settlement, rng = Math.random) {
  const ev = marketEvent(settlement);
  return ev ? pick(ev.lines, rng) : undefined;
}

/** Índice de mercado de una categoría en un asentamiento (sin factores personales ni impuestos). */
export function priceIndex(settlement, cat, mode = 'buy', day = world.getDay()) {
  const s = getSettlementSafe(settlement);
  let idx = 1;
  const rngKey = (s?.id ?? 'wild') + ':' + cat + ':' + day;
  const fl = seeded(hash(rngKey))();
  idx *= 0.92 + 0.16 * fl; // fluctuación diaria ±8 %
  if (!s) return idx;
  const cul = CULTURE_PRICES[s.culture] ?? {};
  idx *= (cul[cat] ?? 1) * (cul._all ?? 1);
  const realm = realmOfSafe(s);
  const focus = FOCUS_PRICES[realm?.economy?.focus] ?? {};
  idx *= (focus[cat] ?? 1) * (focus._all ?? 1);
  const pros = Number(realm?.economy?.prosperity);
  if (Number.isFinite(pros)) idx *= 0.8 + 0.2 * clamp(pros, 0.5, 1.5); // reinos ricos: precios más altos
  const ev = marketEvent(s, day);
  const t = ev?.[mode];
  if (t) idx *= (t[cat] ?? 1) * (t._all ?? 1);
  return idx;
}

/** Impuesto real sobre las compras (0..0.2). Los nobles del reino están exentos; los extranjeros pagan la mitad. */
export function salesTax(realm, d) {
  if (!realm) return 0;
  let rate = TAX_BY_GOV[realm.government] ?? 0.06;
  rate += 0.02 * clamp(Number(realm.strictness) || 0, 0, 2);
  const so = d?.social;
  if (so?.noble) rate = so.noble.realmId === realm.id ? 0 : rate * 0.5;
  return clamp(rate, 0, 0.2);
}

/** Factor personal: clase, karma, actitud racial del reino, fama, infamia y habilidad de comercio. */
export function personalFactor(d, mode, realm) {
  if (!d) return 1;
  const pc = playerClass(d);
  const lvl = tradeLevel(d);
  const att = clamp(Number(realm?.attitudes?.[d.race]) || 0, -1, 1);
  const rid = realm?.id;
  const fm = fame(d, rid);
  const inf = infamy(d, rid);
  let f = 1;
  if (mode === 'sell') {
    if (isHero(d)) f *= 1.08;
    if (isVillain(d)) f *= 0.85;
    f *= [0.85, 0.95, 1, 1.03, 1.03, 1.0][pc.rank] ?? 1;
    f *= 1 + att * 0.1;
    f *= 1 + Math.min(0.08, fm / 5000);
    f *= 1 - Math.min(0.2, inf / 1000);
    f *= 1 + Math.min(0.18, (lvl - 1) * 0.006);
    return clamp(f, 0.5, 1.4);
  }
  if (isHero(d)) f *= 0.88;
  if (isVillain(d)) f *= 1.22;
  // Mendigo: desconfianza · Noble: "precio de señor" (pero sin impuestos en su reino)
  f *= [1.1, 1.0, 0.98, 0.96, 0.95, 1.04][pc.rank] ?? 1;
  f *= 1 - att * 0.12;
  f *= 1 - Math.min(0.1, fm / 4000);
  f *= 1 + Math.min(0.25, inf / 800);
  f *= 1 - Math.min(0.15, (lvl - 1) * 0.005);
  return clamp(f, 0.55, 1.8);
}

/**
 * Factor de precio total de un objeto para el jugador en un asentamiento (contrato §6.4).
 * 'buy': lo que pagas = base × factor (impuesto incluido). 'sell': lo que te pagan = base × factor.
 */
export function priceFactor(player, settlement, itemId, mode = 'buy') {
  return priceBreakdown(player, settlement, itemId, mode).total;
}

/** Desglose: { index, personal, tax, total, event, cat }. */
export function priceBreakdown(player, settlement, itemId, mode = 'buy') {
  const d = player ? getP(player) : undefined;
  let s = getSettlementSafe(settlement);
  if (!s && player) { try { s = nearPlace(player).s; } catch {} }
  const realm = realmOfSafe(s);
  const cat = itemCategory(itemId);
  const index = priceIndex(s, cat, mode);
  const personal = personalFactor(d, mode, realm);
  const tax = mode === 'buy' ? salesTax(realm, d) : 0;
  const total = index * personal * (1 + tax);
  return { index, personal, tax, total, event: marketEvent(s), cat, settlement: s, realm };
}

/** Precio final redondeado (mínimo 1). */
export function finalPrice(base, factor) {
  return Math.max(1, Math.round(base * factor));
}

/* ------------------------------------------------------------------ */
/* Bolsas de los NPCs                                                   */
/* ------------------------------------------------------------------ */

function walletRange(ident, realm) {
  const job = ident.job ?? ident.role;
  const pros = clamp(Number(realm?.economy?.prosperity) || 1, 0.5, 1.5);
  if (job === 'mercader' || job === 'tabernero') return [Math.round(MERCHANT_WALLET[0] * pros), Math.round(MERCHANT_WALLET[1] * pros)];
  if (job === 'rey') return [300, 900];
  if (job === 'mendigo') return [0, 4];
  const cls = ['baja', 'media', 'alta'].includes(ident.cls) ? ident.cls : 'media';
  const r = WALLET[cls] ?? [5, 20];
  return [Math.round(r[0] * pros), Math.round(r[1] * pros)];
}

/**
 * Rellena la bolsa del NPC una vez al día según su clase (y la prosperidad del reino).
 * Modifica `ident` y lo guarda si `entity` es válida. Devuelve el oro de la bolsa.
 */
export function refreshWallet(entity, ident, day = world.getDay()) {
  if (!ident) return 0;
  if (ident.wday === day && typeof ident.wallet === 'number') return ident.wallet;
  const realm = realmById(ident.realm) ?? realmOfSafe(getSettlementSafe(ident.settlement));
  const [a, b] = walletRange(ident, realm);
  const roll = randInt(a, Math.max(a, b));
  const cur = typeof ident.wallet === 'number' ? ident.wallet : 0;
  ident.wallet = Math.min(Math.max(cur, roll), b * 2);
  ident.wday = day;
  if (entity) writeIdent(entity, ident);
  return ident.wallet;
}

/** Cambia el oro de la bolsa del NPC (positivo o negativo). */
export function walletAdd(entity, ident, n) {
  if (!ident) return 0;
  ident.wallet = Math.max(0, Math.round((ident.wallet ?? 0) + n));
  if (entity && valid(entity)) writeIdent(entity, ident);
  return ident.wallet;
}

/* ------------------------------------------------------------------ */
/* Regateo                                                              */
/* ------------------------------------------------------------------ */

function relOfD(d, ident) {
  d.rel = d.rel ?? {};
  let r = d.rel[ident.id];
  if (!r) r = d.rel[ident.id] = { n: ident.name, r: ident.role ?? ident.job, p: 0, t: 0, race: ident.race, pers: ident.pers, g: ident.gender };
  return r;
}

function bumpRel(player, d, ident, delta) {
  const r = relOfD(d, ident);
  r.p = clamp((r.p ?? 0) + delta, -300, 1000);
  dirty(player);
}

/** Flexibilidad del mercader (0..0.38): cuánto está dispuesto a rebajar o subir. */
export function haggleFlex(d, ident) {
  let f = 0.1;
  f += HAGGLE_PERS[ident?.pers] ?? 0;
  const rel = d?.rel?.[ident?.id]?.p ?? 0;
  f += clamp(rel / 1000, -0.2, 1) * 0.15;
  f += attitude(d, ident) * 0.08;
  f += Math.min(0.12, (tradeLevel(d) - 1) * 0.005);
  if (isHero(d)) f += 0.03;
  if (isVillain(d)) f -= 0.04;
  let mood = 'normal';
  try { mood = moodOf(ident.id); } catch {}
  if (mood === 'feliz') f += 0.03;
  if (mood === 'enojado') f -= 0.05;
  if (mood === 'triste') f += 0.01;
  if (ident?.pers === 'coqueto' && d?.gender && ident.gender && d.gender !== ident.gender) f += 0.03;
  return clamp(f, 0.02, 0.38);
}

function parseOffer(text) {
  const m = String(text ?? '').replace(/[.,](?=\d{3}\b)/g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

const YES = /^(s[ií]|vale|ok|acepto|de acuerdo|trato|hecho|claro)\b/i;
const NO = /^(no|adi[oó]s|me voy|d[eé]jalo|nada|paso)\b/i;

async function haggleRound(player, ident, d, v, ask, round, mode) {
  const f = new ModalFormData().title(`§l§6Regateo · ${ident.name}`);
  const gold = d.gold ?? 0;
  const lines = [
    `§e${ident.name}: §f${v.line}`,
    '',
    mode === 'buy' ? `§7Pide: §6${ask} oro §7· Tu bolsa: §6${gold} oro` : `§7Te ofrece: §6${ask} oro§7${v.wallet !== undefined ? ` · Su bolsa: §6${v.wallet} oro` : ''}`,
    `§7Ronda ${round}/3 · ${mode === 'buy' ? 'Escribe cuánto ofreces' : 'Escribe cuánto pides'} (o «no» para marcharte).`,
  ];
  f.textField(lines.join('\n'), String(ask));
  try { f.toggle(`§aAceptar ${ask} oro`); } catch {}
  try { f.submitButton('Negociar'); } catch {}
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return { walk: true };
  const vals = r.formValues;
  if (vals.some((x) => x === true)) return { accept: true };
  const text = String(vals.find((x) => typeof x === 'string') ?? '').trim();
  if (!text) return { empty: true };
  if (NO.test(text)) return { walk: true };
  if (YES.test(text)) return { accept: true };
  const o = parseOffer(text);
  if (o === undefined) return { walk: true };
  return { offer: o };
}

/**
 * Regatear con un mercader. mode 'buy' (tú compras) o 'sell' (tú vendes).
 * opts: { item: nombre de la mercancía, wallet: oro máximo que puede pagar el mercader (al vender) }.
 * Devuelve el precio acordado o undefined si no hay trato (contrato §6.4).
 */
export async function haggle(player, merchantIdent, basePrice, mode = 'buy', opts = {}) {
  const d = getP(player);
  const ident = merchantIdent;
  if (!d || !ident || !(basePrice > 0)) return undefined;
  const so = socialOf(d);
  const today = world.getDay();
  so.hban = so.hban ?? {};
  const base = Math.max(1, Math.round(basePrice));
  const v = { p: player.name, trato: address(d, ident, player), item: opts.item ?? 'esto', precio: base, oferta: 0, wallet: opts.wallet };
  if (so.hban[ident.id] === today) {
    await info(player, `§l${ident.name}`, `§f${say(ident, d, pick(HAGGLE.banned), v)}`);
    return undefined;
  }
  const flex = haggleFlex(d, ident);
  const sell = mode === 'sell';
  let reserve = sell ? Math.floor(base * (1 + flex)) : Math.ceil(base * (1 - flex));
  let ask = base;
  if (sell && typeof opts.wallet === 'number') {
    reserve = Math.min(reserve, opts.wallet);
    ask = Math.min(ask, opts.wallet);
    if (ask <= 0) {
      await info(player, `§l${ident.name}`, `§f${say(ident, d, pick(HAGGLE.broke), v)}`);
      return undefined;
    }
  }
  const insultBuy = Math.max(1, Math.floor(Math.min(base * (1 - flex) * 0.6, base * 0.5)));
  const insultSell = Math.ceil(Math.max(base * (1 + flex) * 1.6, base * 2));
  v.line = say(ident, d, pick(sell ? HAGGLE.open_sell : HAGGLE.open_buy), { ...v, precio: ask });
  let deal;
  let empties = 0;
  for (let round = 1; round <= 3 && deal === undefined; round++) {
    if (!valid(player)) return undefined;
    const res = await haggleRound(player, ident, d, v, ask, round, mode);
    if (res.empty && ++empties <= 1) {
      // Enviado sin cifra ni aceptar: el mercader insiste una vez, sin gastar ronda.
      v.line = say(ident, d, pick(HAGGLE.nudge), { ...v, precio: ask });
      round--;
      continue;
    }
    if (res.walk || res.empty) {
      msg(player, `§e[${ident.name}] §f${say(ident, d, pick(HAGGLE.walk), v)}`);
      return undefined;
    }
    if (res.accept) { deal = ask; break; }
    const o = Math.max(0, res.offer);
    v.oferta = o;
    if (!sell) {
      if (o >= ask) { deal = ask; break; }
      if (o >= reserve) { deal = o; break; }
      if (o < insultBuy) return offended(player, d, ident, v, so, today);
      let next = Math.round(ask - (ask - o) * (0.3 + 0.12 * round + flex * 0.5));
      next = Math.max(reserve, Math.min(ask - 1, next));
      if (next <= o) { deal = o; break; }
      ask = next;
    } else {
      if (o <= ask) { deal = ask; break; }
      if (o <= reserve) { deal = o; break; }
      if (o > insultSell) return offended(player, d, ident, v, so, today);
      let next = Math.round(ask + (o - ask) * (0.3 + 0.12 * round + flex * 0.5));
      next = Math.min(reserve, Math.max(ask + 1, next));
      if (next >= o) { deal = o; break; }
      ask = next;
    }
    v.precio = ask;
    if (round === 2) {
      // Última oferta: tómalo o déjalo.
      const line = say(ident, d, pick(sell ? HAGGLE.final_sell : HAGGLE.final), v);
      const f = new MessageFormData().title(`§l§6Regateo · ${ident.name}`)
        .body(`§e${ident.name}: §f${say(ident, d, pick(sell ? HAGGLE.counter_sell : HAGGLE.counter), v)}\n\n§f${line}\n\n§7${sell ? 'Te pagaría' : 'Pagarías'}: §6${ask} oro§7 (precio inicial: ${base}).`)
        .button1(`§aAcepto (${ask} oro)`).button2('§cNo, gracias');
      const r = await show(f, player);
      if (r && !r.canceled && r.selection === 0) { deal = ask; break; }
      msg(player, `§e[${ident.name}] §f${say(ident, d, pick(HAGGLE.walk), v)}`);
      return undefined;
    }
    v.line = say(ident, d, pick(sell ? HAGGLE.counter_sell : HAGGLE.counter), v);
  }
  if (deal === undefined) return undefined;
  // Trato cerrado
  const saved = sell ? deal - base : base - deal;
  const t = so.trade;
  t.saved = (t.saved ?? 0) + Math.max(0, saved);
  const fair = sell ? deal <= base * (1 + flex * 0.6) : deal >= base * (1 - flex * 0.6);
  bumpRel(player, d, ident, fair ? 2 : 0);
  addTradeXp(player, Math.max(2, Math.round((Math.max(0, saved) / base) * 40) + 2));
  const happy = fair && Math.random() < 0.5;
  msg(player, `§e[${ident.name}] §f${say(ident, d, pick(happy ? HAGGLE.accept_happy : HAGGLE.accept), v)} §7(${deal} oro${saved > 0 ? `, §a${saved} ${sell ? 'más' : 'menos'}§7` : ''})`);
  psound(player, 'random.orb', 0.7, 1.4);
  dirty(player);
  return deal;
}

async function offended(player, d, ident, v, so, today) {
  so.hban[ident.id] = today;
  bumpRel(player, d, ident, -6);
  const line = say(ident, d, pick(HAGGLE.insult), v);
  msg(player, `§e[${ident.name}] §c${line} §7(-relación)`);
  psound(player, 'mob.villager.no', 1, 0.9);
  await info(player, `§l${ident.name}`, `§c${line}\n\n§7${ident.name} no quiere regatear más contigo hoy.`);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Carteristas NPC                                                      */
/* ------------------------------------------------------------------ */

const stalks = new Map(); // thiefId -> { e, pid, until, runId, ident }
const thefts = new Map(); // thiefId -> { e, pid, gold, until, ident, name, base }
const playerCd = new Map(); // pid -> tick (próximo intento posible)
const CUSTODY = ['rpg_jailed', 'rpg_arrested', 'rpg_humiliated', 'rpg_tied', 'rpg_cinematic'];
let thiefN = 0;

function protectedPlayer(player, d) {
  try { if (CUSTODY.some((t) => player.hasTag(t))) return true; } catch { return true; }
  const st = d?.justice?.state;
  if (st && st !== 'escaped') return true;
  try { if (hooks.isRestricted?.(player)) return true; } catch {}
  try { const gm = String(player.getGameMode?.() ?? '').toLowerCase(); if (gm === 'creative' || gm === 'spectator') return true; } catch {}
  return false;
}

/** Percepción del jugador: reduce la probabilidad de que le roben (Agilidad y oficio de ladrón). */
export function perception(d) {
  const agi = stat(d, 'agi');
  const thief = d?.thief?.lvl ?? 1;
  return clamp(1 - (agi - 5) * 0.025 - (thief - 1) * 0.015, 0.25, 1);
}

function viewDot(player, e) {
  try {
    const v = player.getViewDirection();
    const dx = e.location.x - player.location.x;
    const dz = e.location.z - player.location.z;
    const l = Math.hypot(dx, dz) || 1;
    const vl = Math.hypot(v.x, v.z) || 1;
    return (v.x * dx + v.z * dz) / (l * vl);
  } catch { return 0; }
}

function actOf(e) {
  try { return e.getDynamicProperty('rpg:act'); } catch { return undefined; }
}

/** Cada segundo (desde life.tick). players: jugadores nacidos. */
export function thiefTick(players) {
  thiefN++;
  const now = system.currentTick;
  theftUpkeep(now);
  if (thiefN % 5 !== 0) return;
  const time = world.getTimeOfDay();
  const night = time >= 13000 && time < 23000;
  for (const player of players) {
    try {
      if ((playerCd.get(player.id) ?? 0) > now) continue;
      if ([...stalks.values()].some((s) => s.pid === player.id)) continue;
      const d = getP(player);
      if (!d || (d.gold ?? 0) < 5 || protectedPlayer(player, d)) continue;
      let near = [];
      try { near = player.dimension.getEntities({ type: NPC, location: player.location, maxDistance: 14, excludeTags: ['rpg_busy'] }); } catch { continue; }
      const crowd = near.filter((e) => { try { return dist(e.location, player.location) <= 10; } catch { return false; } }).length;
      const crowded = crowd >= 5;
      if (!night && !crowded) continue;
      const today = world.getDay();
      const thief = near.find((e) => {
        const id = readIdent(e);
        if ((id?.job ?? id?.role) !== 'ladron') return false;
        if (actOf(e) === 'sleep' || stalks.has(e.id) || thefts.has(e.id)) return false;
        try { if (e.getDynamicProperty('rpg:steal_day') === today) return false; } catch {}
        return true;
      });
      if (!thief) continue;
      const p = (night ? 0.22 : 0.12) * perception(d) * (stageOf(d) === 'child' ? 0.5 : 1);
      playerCd.set(player.id, now + 20 * 40); // como mucho un intento cada 40 s
      if (Math.random() > p) continue;
      startStalk(player, thief);
    } catch (e) { console.warn('[Aetheria] carteristas: ' + e); }
  }
}

/** El carterista se acerca disimuladamente al jugador. */
export function startStalk(player, thief) {
  if (!valid(player) || !valid(thief) || stalks.has(thief.id)) return false;
  const ident = readIdent(thief);
  const st = { e: thief, pid: player.id, until: system.currentTick + 20 * 14, ident, warned: false };
  stalks.set(thief.id, st);
  st.runId = system.runInterval(() => {
    try { stalkStep(player, st); } catch (e) { endStalk(st); console.warn('[Aetheria] acecho: ' + e); }
  }, 4);
  return true;
}

function endStalk(st) {
  try { system.clearRun(st.runId); } catch {}
  stalks.delete(st.e?.id);
}

function stalkStep(player, st) {
  const e = st.e;
  if (!valid(player) || !valid(e) || system.currentTick > st.until) return endStalk(st);
  const d = getP(player);
  if (!d || protectedPlayer(player, d)) return endStalk(st);
  try { if (e.hasTag('rpg_busy')) return endStalk(st); } catch { return endStalk(st); }
  if (e.dimension.id !== player.dimension.id) return endStalk(st);
  const dd = dist(e.location, player.location);
  if (dd > 18) return endStalk(st);
  // ¿El jugador le está mirando? Se hace el despistado y se va.
  if (dd < 8 && viewDot(player, e) > 0.8) {
    endStalk(st);
    playerCd.set(player.id, system.currentTick + 20 * 90);
    try { hooks.bubble?.(e, pick(['¿Qué miras?', '*silba y mira hacia otro lado*', 'Yo no he hecho nada...']), 3); } catch {}
    actionbar(player, '§7Un tipo sospechoso se aleja disimuladamente...');
    return;
  }
  if (dd <= 1.8) {
    endStalk(st);
    stealPurse(player, e, st.ident ?? readIdent(e));
    return;
  }
  // Paso hacia el jugador (≈1,75 bloques/s), sin atravesar paredes.
  const dx = player.location.x - e.location.x;
  const dz = player.location.z - e.location.z;
  const l = Math.hypot(dx, dz) || 1;
  const step = Math.min(0.35, l - 1.2);
  if (step <= 0) return;
  const nx = e.location.x + (dx / l) * step;
  const nz = e.location.z + (dz / l) * step;
  let ny = e.location.y;
  const free = (y) => {
    try {
      const f = e.dimension.getBlock({ x: Math.floor(nx), y: Math.floor(y), z: Math.floor(nz) });
      const h = e.dimension.getBlock({ x: Math.floor(nx), y: Math.floor(y) + 1, z: Math.floor(nz) });
      return !isSolid(f) && !isSolid(h);
    } catch { return false; }
  };
  if (!free(ny)) {
    if (free(ny + 1)) ny = Math.floor(ny) + 1;
    else return endStalk(st);
  }
  try { e.teleport({ x: nx, y: ny, z: nz }, { facingLocation: player.getHeadLocation() }); } catch { return endStalk(st); }
}

/** El carterista roba la bolsa y huye. */
export function stealPurse(player, thief, ident) {
  const d = getP(player);
  if (!d || !valid(thief) || protectedPlayer(player, d)) return 0;
  const gold = Math.min(d.gold ?? 0, clamp(Math.round((d.gold ?? 0) * rand(0.06, 0.14)), 3, 120));
  if (gold <= 0) return 0;
  d.gold -= gold;
  dirty(player);
  const so = socialOf(d);
  const name = ident?.name ?? 'Un carterista';
  so.robbed = { name, gold, day: world.getDay() };
  msg(player, `§c✖ ¡Te han robado la bolsa! §7(-${gold} oro) §8Persigue al ladrón y golpéale antes de que escape (30 s).`);
  title(player, '§c§l¡Ladrón!', `§7Te han birlado §6${gold} oro`);
  psound(player, 'random.break', 1, 1.2);
  try { particle(player.dimension, 'rpg:coins', { x: player.location.x, y: player.location.y + 0.8, z: player.location.z }); } catch {}
  let base = '';
  try { base = baseName(thief); } catch {}
  const shown = `§c${name}\n§4¡Al ladrón!`;
  try { thief.addTag('rpg_busy'); thief.addTag('rpg_fleeing'); } catch {}
  try { thief.triggerEvent('rpg:act_flee'); thief.setDynamicProperty('rpg:act', ''); } catch {}
  try { thief.setDynamicProperty('rpg:steal_day', world.getDay()); } catch {}
  // Si el mundo se cierra durante la huida, life.js restaura el nombre y el ladrón se queda el botín.
  try { if (base) thief.setDynamicProperty(NT_KEY, base); thief.setDynamicProperty(LOOT_KEY, gold); } catch {}
  try { thief.setProperty('rpg:mood', 2); } catch {}
  try { thief.nameTag = shown; } catch {}
  fleeing.add(thief.id);
  thefts.set(thief.id, { e: thief, pid: player.id, gold, until: system.currentTick + 20 * 30, ident, name, base, shown });
  return gold;
}

const NT_KEY = 'rpg:nt'; // nombre original (compartido con los bocadillos de life.js)
const LOOT_KEY = 'rpg:loot'; // oro robado durante la huida
const fleeing = new Set(); // ids de carteristas huyendo en esta sesión (robo en curso o recién atrapados)

/** Nombre "de verdad" del NPC (sin bocadillo ni cartel de "¡Al ladrón!"). */
function baseName(e) {
  let cur = '';
  try { cur = e.nameTag ?? ''; } catch {}
  if (cur.includes('\n§f«') || cur.includes('¡Al ladrón!')) {
    try {
      const saved = e.getDynamicProperty(NT_KEY);
      if (typeof saved === 'string' && saved) return saved;
    } catch {}
  }
  return cur;
}

/** Nombre con la máscara quitada: "Forastero" → "Ladrón" en rojo (desenmascarado hoy). */
export function exposedName(base, ident) {
  if (!base || !ident) return base;
  const f = ident.gender === 'f' ? 1 : 0;
  const disguise = JOBS.ladron?.disguise?.[f] ?? 'Forastero';
  const lines = String(base).split('\n');
  lines[0] = '§c' + lines[0].replace(/^(§.)+/, '');
  if (lines[1]) lines[1] = lines[1].replace(disguise, '§c' + jobLabel('ladron', ident.gender) + '§7');
  return lines.join('\n');
}

/** ¿Este NPC huye por un robo gestionado en esta sesión? (life.js no lo toca mientras tanto). */
export function isFleeTracked(id) {
  return fleeing.has(id);
}

function freeThief(e, base) {
  try { e.removeTag('rpg_busy'); e.removeTag('rpg_fleeing'); } catch {}
  try { e.triggerEvent('rpg:act_idle'); e.setDynamicProperty('rpg:act', ''); } catch {}
  try { e.setProperty('rpg:mood', 0); } catch {}
  try {
    const cur = e.nameTag;
    if (base && (cur.includes('¡Al ladrón!') || cur.includes('\n§f«'))) e.nameTag = base;
  } catch {}
  try { e.setDynamicProperty(NT_KEY, undefined); e.setDynamicProperty(LOOT_KEY, undefined); } catch {}
}

function releaseThief(t, delay = 0) {
  const go = () => {
    fleeing.delete(t.e?.id);
    if (!valid(t.e)) return;
    freeThief(t.e, t.base);
  };
  if (delay > 0) system.runTimeout(go, delay); else go();
}

/**
 * Carterista que huía cuando se recargaron los scripts (etiqueta rpg_fleeing sin robo en memoria):
 * se ha escapado con el botín. Lo llama life.js al recorrer los NPCs.
 */
export function releaseStaleThief(e) {
  if (!valid(e) || fleeing.has(e.id)) return false;
  const ident = readIdent(e);
  let loot = 0;
  try { loot = Number(e.getDynamicProperty(LOOT_KEY)) || 0; } catch {}
  if (ident && loot > 0) { ident.wallet = (ident.wallet ?? 0) + loot; writeIdent(e, ident); }
  let base;
  try { base = e.getDynamicProperty(NT_KEY); } catch {}
  if (typeof base !== 'string' || !base) {
    try { base = String(e.nameTag ?? '').split('\n')[0].replace('¡Al ladrón!', '').trim() || undefined; } catch {}
  }
  if (base && ident?.exposed === world.getDay()) base = exposedName(base, ident);
  freeThief(e, base);
  return true;
}

function theftUpkeep(now) {
  for (const [id, t] of [...thefts]) {
    const p = world.getAllPlayers().find((x) => x.id === t.pid);
    if (!valid(t.e)) {
      thefts.delete(id);
      fleeing.delete(id);
      if (p) msg(p, '§7El ladrón ha desaparecido... y tu oro con él.');
      continue;
    }
    // Atrapado: el jugador le alcanza.
    if (p && p.dimension.id === t.e.dimension.id && dist(p.location, t.e.location) <= 1.6) {
      caught(t, p);
      continue;
    }
    if (now >= t.until) {
      thefts.delete(id);
      if (t.ident) { t.ident.wallet = (t.ident.wallet ?? 0) + t.gold; writeIdent(t.e, t.ident); }
      if (p) msg(p, `§7${t.name} se ha esfumado entre la gente con tus §6${t.gold} oro§7... §8(Quizá puedas recuperarlo de sus bolsillos.)`);
      releaseThief(t);
    }
  }
}

function caught(t, catcher) {
  thefts.delete(t.e.id);
  const victim = world.getAllPlayers().find((x) => x.id === t.pid);
  if (victim) {
    addGold(victim, t.gold, true);
    msg(victim, `§a✔ ¡Has recuperado tu bolsa! §6+${t.gold} oro`);
    const so = socialOf(getP(victim));
    if (so) so.robbed = undefined;
  }
  try { hooks.bubble?.(t.e, pick(['¡Vale, vale! ¡Toma tu oro!', '¡Ay! ¡No me pegues! ¡Aquí está todo!', '¡Maldita sea! ¡Llévatelo!']), 4); } catch {}
  try { particle(t.e.dimension, 'rpg:coins', { x: t.e.location.x, y: t.e.location.y + 1, z: t.e.location.z }); } catch {}
  if (catcher) {
    addKarma(catcher, 3, 'atrapar a un carterista');
    try { recordDeed(catcher, 'thief', { key: t.e.id }); } catch {}
  }
  // El ladrón queda desenmascarado hoy (su cartel dirá "Ladrón") y sigue huyendo un rato.
  const ident = readIdent(t.e) ?? t.ident;
  if (ident) {
    ident.exposed = world.getDay();
    writeIdent(t.e, ident);
    t.base = exposedName(t.base, ident);
  }
  try { t.e.setDynamicProperty(LOOT_KEY, undefined); if (t.base) t.e.setDynamicProperty(NT_KEY, t.base); } catch {}
  try { t.e.triggerEvent('rpg:act_flee'); } catch {}
  releaseThief(t, 20 * 6);
}

/** after entityHurt: golpear al carterista que huye recupera el oro. */
export function onEntityHurt(ev) {
  const e = ev?.hurtEntity;
  let id;
  try { id = e?.id; } catch { return; }
  if (!id || !thefts.has(id)) return;
  const att = ev.damageSource?.damagingEntity;
  let isPlayer = false;
  try { isPlayer = att?.typeId === 'minecraft:player'; } catch {}
  if (!isPlayer) return;
  caught(thefts.get(id), att);
}

/** ¿Hay un robo en curso de este jugador? (para pruebas y el HUD). */
export function activeTheft(player) {
  for (const t of thefts.values()) if (t.pid === player.id) return t;
  return undefined;
}

/**
 * Línea para el HUD mientras un carterista huye con tu bolsa: nombre, segundos para atraparlo, distancia
 * y oro robado. Cadena vacía si no hay robo en curso.
 */
export function theftHud(player) {
  const t = activeTheft(player);
  if (!t || !valid(t.e)) return '';
  const left = Math.max(0, Math.ceil((t.until - system.currentTick) / 20));
  let m = '?';
  try { m = String(Math.round(dist(player.location, t.e.location))); } catch {}
  return `§c¡Al ladrón! §f${t.name} §7· §e${left} s §7· §f${m} m §7· §6 ${t.gold}`;
}

/** Al salir un jugador: cancelar acechos. */
export function forgetPlayer(player) {
  for (const st of [...stalks.values()]) if (st.pid === player.id) endStalk(st);
  playerCd.delete(player.id);
}

/** Acceso para pruebas. */
export const _t = { stalks, thefts, playerCd, eventCache, fleeing };

export { CATEGORY_NAMES };
