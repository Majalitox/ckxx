// Tienda del mercader: comprar y vender con oro. Los héroes tienen descuento; los villanos pagan más.
import { getP } from '../core/store.js';
import { addGold, spendGold, msg } from '../core/progression.js';
import { isHero, isVillain } from '../core/profile.js';
import { SHOP, SELL } from '../data/items.js';
import { RANKS } from '../data/ranks.js';
import { giveItem, container, psound } from '../util/compat.js';
import { buttons, info, choose } from '../util/ui.js';

function priceMult(d) {
  if (isHero(d)) return 0.85;
  if (isVillain(d)) return 1.25;
  return 1;
}

export async function shopMenu(player) {
  const d = getP(player);
  if (!d) return;
  await buttons(player, '§l§2Mercader', `§f"¡Lo mejor de Aetheria a precios justos!"\n§7Tu oro: §6${d.gold}${priceMult(d) !== 1 ? `\n§7Modificador por reputación: x${priceMult(d)}` : ''}`, [
    { text: '§lComprar', icon: 'textures/items/emerald', fn: () => buyMenu(player) },
    { text: '§lVender', icon: 'textures/items/gold_ingot', fn: () => sellMenu(player) },
    { text: '§7Volver' },
  ]);
}

async function buyMenu(player) {
  const d = getP(player);
  const m = priceMult(d);
  const rank = d.guild?.member ? d.guild.rank : -1;
  const items = SHOP.filter((s) => s[4] === undefined || rank >= s[4]);
  const sel = await buttons(player, '§l§2Comprar', `§7Oro: §6${d.gold}\n§7Los sellos de jefe requieren rango del Gremio.`, [
    ...items.map((s) => ({ text: `${s[3]}\n§6${Math.ceil(s[2] * m)} oro${s[4] !== undefined ? ` §7· Rango ${RANKS[s[4]]}` : ''}` })),
    { text: '§7Volver' },
  ]);
  if (sel === undefined || sel >= items.length) return;
  const [id, n, price, name] = items[sel];
  const cost = Math.ceil(price * m);
  if (!spendGold(player, cost)) return info(player, '§lMercader', `§c¡No tienes suficiente oro! Necesitas ${cost}.`);
  giveItem(player, id, n);
  psound(player, 'random.orb', 1, 1);
  msg(player, `§aHas comprado ${name} por §6${cost} oro§a.`);
  return buyMenu(player);
}

async function sellMenu(player) {
  const c = container(player);
  if (!c) return;
  const totals = {};
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && SELL[it.typeId]) totals[it.typeId] = (totals[it.typeId] ?? 0) + it.amount;
  }
  const ids = Object.keys(totals);
  if (!ids.length) return info(player, '§lVender', '§7No tienes nada que me interese. Compro minerales, botín de monstruos, núcleos y comida básica.');
  const opts = ids.map((id) => `${id.replace(/^.*:/, '').replace(/_/g, ' ')} ×${totals[id]} → ${SELL[id] * totals[id]} oro`);
  const sel = await buttons(player, '§l§2Vender', '§7Elige qué vender (se vende todo lo de ese tipo):', [{ text: '§a§lVender TODO' }, ...opts.map((t) => ({ text: t })), { text: '§7Volver' }]);
  if (sel === undefined || sel > ids.length) return;
  const chosen = sel === 0 ? ids : [ids[sel - 1]];
  let gold = 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && chosen.includes(it.typeId)) {
      gold += SELL[it.typeId] * it.amount;
      c.setItem(i, undefined);
    }
  }
  addGold(player, gold);
  psound(player, 'random.orb', 1, 0.8);
  return sellMenu(player);
}

export { choose };
