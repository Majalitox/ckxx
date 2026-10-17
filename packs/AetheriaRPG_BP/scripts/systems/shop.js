// Tienda del mercader: comprar y vender con oro a precios del mercado local (cultura, foco económico y
// prosperidad del reino, eventos del día), con impuesto real, bolsa limitada del mercader y regateo.
// Los héroes tienen descuento; los villanos y los infames pagan más; los nobles no pagan impuesto en su reino.
import { world } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { addGold, spendGold, msg } from '../core/progression.js';
import { SHOP, SELL } from '../data/items.js';
import { RANKS } from '../data/ranks.js';
import { CATEGORY_NAMES } from '../data/social.js';
import * as economy from './economy.js';
import * as social from './social.js';
import { genderize } from './chat.js';
import { giveItem, container, psound, valid } from '../util/compat.js';
import { buttons, info, choose } from '../util/ui.js';
import { pick } from '../util/math.js';

const pretty = (id) => id.replace(/^.*:/, '').replace(/_/g, ' ');

/** Contexto de la tienda: mercader (entidad + identidad), asentamiento y reino. */
function shopCtx(player, ctx = {}) {
  const ident = ctx.ident;
  let s = social.getSettlementSafe(ident?.settlement);
  if (!s) { try { s = social.nearPlace(player).s; } catch {} }
  const realm = social.realmOfSafe(s);
  const entity = ctx.entity && valid(ctx.entity) ? ctx.entity : undefined;
  if (entity && ident) economy.refreshWallet(entity, ident);
  return { ident, entity, s, realm, name: ident?.name ?? 'Mercader' };
}

function walletOf(c) {
  return c.entity && c.ident ? Math.max(0, Math.floor(c.ident.wallet ?? 0)) : undefined;
}

function headerText(player, d, c) {
  const lines = [];
  const ev = economy.marketEvent(c.s);
  const tax = Math.round(economy.salesTax(c.realm, d) * 100);
  lines.push(`§f"${genderize(pick(['¡Lo mejor de Aetheria a precios justos!', '¡Pasa y mira, que mirar no cuesta!', 'Hoy hago precio, aprovecha.']), d.gender, c.ident?.gender)}"`);
  lines.push(`§7Tu oro: §6${d.gold}${walletOf(c) !== undefined ? ` §7· Bolsa del mercader: §6${walletOf(c)}` : ''}`);
  if (c.s?.name) lines.push(`§7Mercado de §f${c.s.name}${c.realm?.name ? ` §7(${c.realm.name})` : ''}`);
  if (ev) lines.push(`§e¡${ev.name}! §7${pick(ev.lines)}`);
  if (tax > 0) lines.push(`§7Impuesto real: §f${tax} %`);
  else if (d.social?.noble && c.realm) lines.push(`§6${d.gender === 'f' ? 'Exenta' : 'Exento'} de impuestos por tu título.`);
  const pf = economy.personalFactor(d, 'buy', c.realm);
  if (Math.abs(pf - 1) >= 0.03) lines.push(`§7Trato personal (clase, fama, raza): §f×${pf.toFixed(2)}`);
  return lines.join('\n');
}

/** Menú de la tienda. ctx: { entity, ident } del mercader (opcional: sin él no hay bolsa ni regateo). */
export async function shopMenu(player, ctx = {}) {
  const d = getP(player);
  if (!d) return;
  const c = shopCtx(player, ctx);
  await buttons(player, `§l§2${c.name}`, headerText(player, d, c), [
    { text: '§lComprar', icon: 'textures/items/emerald', fn: () => buyMenu(player, c) },
    { text: '§lVender', icon: 'textures/items/gold_ingot', fn: () => sellMenu(player, c) },
    { text: '§7Volver' },
  ]);
}

/** Precio de compra de una línea del catálogo (con impuesto). */
export function buyPrice(player, c, id, base) {
  return economy.finalPrice(base, economy.priceFactor(player, c.s, id, 'buy'));
}

/** Precio de venta por unidad. */
export function sellPrice(player, c, id) {
  const base = SELL[id] ?? 0;
  if (!base) return 0;
  return Math.max(1, Math.round(base * economy.priceFactor(player, c.s, id, 'sell')));
}

async function buyMenu(player, c) {
  const d = getP(player);
  const rank = d.guild?.member ? d.guild.rank : -1;
  const items = SHOP.filter((s) => s[4] === undefined || rank >= s[4]);
  const priced = items.map((s) => ({ s, price: buyPrice(player, c, s[0], s[2]) }));
  const sel = await buttons(player, '§l§2Comprar', `§7Oro: §6${d.gold}\n§7Los sellos de jefe requieren rango del Gremio.${c.ident ? '\n§7Elige un artículo para pagarlo o regatear.' : ''}`, [
    ...priced.map(({ s, price }) => {
      const diff = price - s[2];
      const mark = Math.abs(diff) >= Math.max(2, s[2] * 0.08) ? (diff > 0 ? ' §c▲' : ' §a▼') : '';
      return { text: `${s[3]}\n§6${price} oro${mark}${s[4] !== undefined ? ` §7· Rango ${RANKS[s[4]]}` : ''}` };
    }),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= priced.length) return;
  const { s, price } = priced[sel];
  const [id, n, , name] = s;
  let cost = price;
  let haggled = false;
  if (c.ident) {
    const tax = economy.salesTax(c.realm, d);
    const pre = Math.max(1, Math.round(price / (1 + tax)));
    const choice = await buttons(player, `§l${name}`, `§7Precio: §6${price} oro§7${tax > 0 ? ` (incluye ${Math.round(tax * 100)} % de impuesto real)` : ''}\n§7Tu oro: §6${d.gold}\n§7Categoría: §f${CATEGORY_NAMES[economy.priceBreakdown(player, c.s, id, 'buy').cat] ?? 'mercancías'}`, [
      { text: `§aPagar ${price} oro` },
      { text: '§6Regatear' },
      { text: '§7Volver' },
    ]);
    if (choice === undefined || choice === 2) return buyMenu(player, c);
    if (choice === 1) {
      const deal = await economy.haggle(player, c.ident, pre, 'buy', { item: name.replace(/ ×\d+$/, '') });
      if (deal === undefined) return buyMenu(player, c);
      cost = Math.max(1, Math.round(deal * (1 + tax)));
      haggled = true;
    }
  }
  if (!spendGold(player, cost)) {
    // Sin pagar no hay trato: ni experiencia de comercio, ni ahorro, ni relación con el mercader.
    if (haggled) economy.dropHaggle?.(player);
    return info(player, `§l${c.name}`, `§c¡No tienes suficiente oro! Necesitas ${cost}.`);
  }
  if (haggled) economy.commitHaggle?.(player);
  giveItem(player, id, n);
  if (c.entity) economy.walletAdd(c.entity, c.ident, cost);
  const t = social.socialOf(d).trade;
  t.bought = (t.bought ?? 0) + cost;
  economy.addTradeXp(player, 1);
  dirty(player);
  psound(player, 'random.orb', 1, 1);
  msg(player, `§aHas comprado ${name} por §6${cost} oro§a.`);
  return buyMenu(player, c);
}

async function sellMenu(player, c) {
  const inv = container(player);
  if (!inv) return;
  const d = getP(player);
  const totals = {};
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it && SELL[it.typeId]) totals[it.typeId] = (totals[it.typeId] ?? 0) + it.amount;
  }
  const ids = Object.keys(totals);
  if (!ids.length) return info(player, '§lVender', '§7No tienes nada que me interese. Compro minerales, botín de monstruos, núcleos y comida básica.');
  const wallet = walletOf(c);
  if (wallet !== undefined && wallet <= 0) return info(player, `§l${c.name}`, '§fMe he quedado sin una moneda en la bolsa. Vuelve mañana y te compro lo que quieras.');
  const unit = Object.fromEntries(ids.map((id) => [id, sellPrice(player, c, id)]));
  const all = ids.reduce((a, id) => a + unit[id] * totals[id], 0);
  const opts = ids.map((id) => `${pretty(id)} ×${totals[id]} → ${unit[id] * totals[id]} oro §8(${unit[id]}/u)`);
  const sel = await buttons(player, '§l§2Vender', `§7Elige qué vender (se vende todo lo de ese tipo).${wallet !== undefined ? `\n§7El mercader tiene §6${wallet} oro§7 en la bolsa.` : ''}`,
    [{ text: `§a§lVender TODO §r§7(${all} oro)` }, ...opts.map((t) => ({ text: t })), { text: '§7Volver' }]);
  if (sel === undefined || sel > ids.length) return;
  const chosen = sel === 0 ? ids : [ids[sel - 1]];
  let offer = chosen.reduce((a, id) => a + unit[id] * totals[id], 0);
  let label = sel === 0 ? 'todo' : pretty(chosen[0]);
  let haggled = false;
  if (c.ident) {
    const capped = wallet !== undefined ? Math.min(offer, wallet) : offer;
    const choice = await buttons(player, `§l${c.name}`, `§7Te ofrece: §6${capped} oro§7 por ${label}.${capped < offer ? `\n§c(Valdría ${offer}, pero no tiene más oro.)` : ''}`, [
      { text: `§aVender por ${capped} oro` },
      { text: '§6Regatear' },
      { text: '§7Volver' },
    ]);
    if (choice === undefined || choice === 2) return sellMenu(player, c);
    if (choice === 1) {
      const deal = await economy.haggle(player, c.ident, offer, 'sell', { item: label, wallet });
      if (deal === undefined) return sellMenu(player, c);
      offer = deal;
      haggled = true;
    } else offer = capped;
  }
  if (wallet !== undefined) offer = Math.min(offer, walletOf(c) ?? offer);
  let removed = 0;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it && chosen.includes(it.typeId)) {
      removed += it.amount;
      inv.setItem(i, undefined);
    }
  }
  if (!removed) {
    if (haggled) economy.dropHaggle?.(player);
    return;
  }
  if (haggled) economy.commitHaggle?.(player);
  addGold(player, offer);
  if (c.entity) economy.walletAdd(c.entity, c.ident, -offer);
  const t = social.socialOf(d).trade;
  t.sold = (t.sold ?? 0) + offer;
  economy.addTradeXp(player, 1 + Math.floor(offer / 100));
  dirty(player);
  psound(player, 'random.orb', 1, 0.8);
  return sellMenu(player, c);
}

export { choose };
