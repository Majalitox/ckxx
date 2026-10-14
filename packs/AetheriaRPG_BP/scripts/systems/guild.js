// Gremio de Aventureros (rangos F → SSS, tablón diario) y Hermandad de la Sombra (camino del villano).
import { world } from '@minecraft/server';
import { getP, dirty, W, wDirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { addXp, addGold, spendGold, addGuildPoints, msg, title, checkGuildRank } from '../core/progression.js';
import { stageOf, xpNeed, karmaTitle, isVillain } from '../core/profile.js';
import { genGuildBoard, genDark } from '../data/quests.js';
import { RANKS, rk, rkB, GUILD_POINTS, GUILD_LEVEL, RANK_TITLES } from '../data/ranks.js';
import { ensureQuests, questLine, deliver } from './quests.js';
import { hash, seeded } from '../util/math.js';
import { bar } from '../util/text.js';
import { giveItem, countItem, removeItem, makeItem, psound } from '../util/compat.js';
import { buttons, confirm, info } from '../util/ui.js';

export function board() {
  const w = W();
  const day = world.getDay();
  if (!w.board || w.board.day !== day) {
    w.board = { day, quests: genGuildBoard(seeded(hash('board:' + day)), 9) };
    wDirty();
  }
  return w.board.quests;
}

function updateRanking(player, d) {
  const w = W();
  w.ranking = w.ranking ?? {};
  w.ranking[player.name] = { r: d.guild?.rank ?? 0, p: d.guild?.points ?? 0, l: d.level, k: d.karma ?? 0 };
  wDirty();
}

export function guildCard(player) {
  const d = getP(player);
  const it = makeItem('rpg:guild_card', 1, `§bLicencia de Aventurero: §f${player.name}`, [
    `§7Rango: ${rkB(d.guild.rank)}`,
    `§7Raza: §f${d.race}`,
    `§7Inscrito el día ${d.guild.joined ?? 0}`,
  ]);
  if (it) giveItem(player, it);
}

export async function guildDesk(player) {
  const d = getP(player);
  if (!d) return;
  updateRanking(player, d);
  if (!d.guild?.member) return registerMenu(player, d);
  if (d.guild.suspended) {
    return info(player, '§l§cLicencia suspendida', `§fLo siento, ${player.name}. El Gremio no puede darte trabajo mientras tu reputación sea la de un criminal.\n\n§7Karma actual: ${d.karma}. Necesitas más de -200.\n§7Puedes purificar tu alma en el templo o ayudar a la gente.`);
  }
  const r = d.guild.rank;
  const next = r < 8 ? `§7Siguiente rango ${rk(r + 1)}§7: ${bar(d.guild.points, GUILD_POINTS[r + 1], 14, '§b')} §f${d.guild.points}/${GUILD_POINTS[r + 1]} PG · Nivel ${d.level}/${GUILD_LEVEL[r + 1]}` : '§6¡Has alcanzado el rango máximo!';
  await buttons(player, '§l§1Gremio de Aventureros', `§fBienvenido/a, aventurero/a de rango ${rkB(r)}§f (${RANK_TITLES[r]}).\n${next}`.replace(/o\/a/g, d.gender === 'f' ? 'a' : 'o'), [
    { text: '§lTablón de misiones', icon: 'textures/items/paper', fn: () => boardMenu(player) },
    { text: 'Entregar encargos', icon: 'textures/items/book_normal', fn: async () => { if (!deliver(player, 'recepcionista')) await info(player, '§lEntregas', '§7No tienes nada que entregar aquí.'); } },
    { text: 'Canjear núcleos de monstruo', icon: 'textures/items/rpg_monster_core', fn: () => exchangeCores(player) },
    { text: 'Tablón de recompensas (villanos)', icon: 'textures/items/iron_sword', fn: () => bountyBoard(player) },
    { text: 'Ranking del Gremio', icon: 'textures/items/diamond', fn: () => rankingMenu(player) },
    { text: 'Reponer mi licencia', icon: 'textures/items/rpg_guild_card', fn: () => guildCard(player) },
    { text: '§7Volver' },
  ]);
}

async function registerMenu(player, d) {
  const fee = cfg('guildFee');
  const body = `§f¡Bienvenido/a al Gremio de Aventureros!\n\n§7Ventajas de ser miembro:\n§a• x${cfg('guildXpMult')} de experiencia en combate, misiones y mazmorras\n§a• Acceso al tablón de misiones diarias\n§a• Rangos F → SSS con recompensas y prestigio\n§a• Acceso a sellos de jefes en la tienda\n\n§7Requisitos: ser al menos adolescente, no ser un criminal buscado.\n§7Cuota: §6${fee} oro §7(tienes ${d.gold})`;
  const sel = await buttons(player, '§l§1Inscripción', body.replace(/o\/a/g, d.gender === 'f' ? 'a' : 'o'), [{ text: '§a§lInscribirme' }, { text: '§7Ahora no' }]);
  if (sel !== 0) return;
  if (stageOf(d) === 'child') return info(player, '§lInscripción', '§fLo siento, pequeño/a. Vuelve cuando seas adolescente. ¡Mientras tanto, ayuda a tu familia y practica tus pasatiempos!'.replace('pequeño/a', d.gender === 'f' ? 'pequeña' : 'pequeño'));
  if (isVillain(d)) return info(player, '§lInscripción', '§cTu reputación te precede. El Gremio no acepta criminales.');
  if (!spendGold(player, fee)) return info(player, '§lInscripción', `§cNecesitas ${fee} de oro. Pide la paga a tus padres o vende materiales al mercader.`);
  d.guild = { member: true, rank: 0, points: 0, joined: world.getDay() };
  dirty(player);
  guildCard(player);
  title(player, '§b§l¡Aventurero/a!'.replace('o/a', d.gender === 'f' ? 'a' : 'o'), '§fRango §7F §f· Novato');
  psound(player, 'random.levelup', 1, 1);
  try { world.sendMessage(`§6[Gremio] §f${player.name} §ese ha inscrito en el Gremio de Aventureros.`); } catch {}
  updateRanking(player, d);
}

export async function boardMenu(player) {
  const d = getP(player);
  const q = ensureQuests(d);
  const quests = board();
  q.guildTaken = q.guildTaken ?? [];
  const list = quests.map((quest) => {
    const taken = q.guildTaken.includes(quest.id);
    const tooHigh = quest.rank > d.guild.rank + 1;
    return { text: `${taken ? '§a✔ ' : tooHigh ? '§c✖ ' : ''}[${RANKS[quest.rank]}] ${quest.title}`, quest };
  });
  const sel = await buttons(player, '§lTablón del Gremio', `§7Misiones del día ${world.getDay()}. Puedes aceptar misiones de tu rango (${RANKS[d.guild.rank]}) o uno superior.\n§7Activas: ${q.guild.filter((x) => !x.done).length}/3`, [...list, { text: '§7Volver' }]);
  if (sel === undefined || sel >= list.length) return;
  const quest = list[sel].quest;
  const ok = await confirm(player, `§l${quest.title}`, questLine({ ...quest, have: 0 }) + '\n\n§f¿Aceptar esta misión?', '§aAceptar', '§cVolver');
  if (!ok) return boardMenu(player);
  if (q.guildTaken.includes(quest.id)) return info(player, '§lTablón', '§7Ya aceptaste esta misión hoy.');
  if (quest.rank > d.guild.rank + 1) return info(player, '§lTablón', '§cEsta misión es demasiado peligrosa para tu rango.');
  if (q.guild.filter((x) => !x.done).length >= 3) return info(player, '§lTablón', '§cYa tienes 3 misiones del gremio activas.');
  q.guild.push({ ...quest, have: 0, done: false, keys: undefined });
  q.guildTaken.push(quest.id);
  dirty(player);
  msg(player, `§b✦ Misión aceptada: §f${quest.title}`);
}

async function exchangeCores(player) {
  const n = countItem(player, 'rpg:monster_core');
  const b = countItem(player, 'rpg:boss_core');
  if (!n && !b) return info(player, '§lCanje', '§7No tienes núcleos de monstruo ni de jefe. Los sueltan los monstruos del mod.');
  removeItem(player, 'rpg:monster_core', n);
  removeItem(player, 'rpg:boss_core', b);
  const pts = n * 5 + b * 120;
  addGuildPoints(player, pts);
  addGold(player, n * 3 + b * 50);
  await info(player, '§lCanje', `§fHas entregado ${n} núcleos de monstruo y ${b} núcleos de jefe.\n§b+${pts} puntos de gremio`);
}

async function bountyBoard(player) {
  const lines = [];
  for (const p of world.getAllPlayers()) {
    const d = getP(p);
    if (!d || (d.karma ?? 0) > -400) continue;
    lines.push(`§c${p.name} §7- ${karmaTitle(d.karma).name} §6Recompensa: ${bountyOf(d)} oro`);
  }
  await info(player, '§l§cSe busca', lines.length ? lines.join('\n') + '\n\n§7Derrótalos en combate para cobrar la recompensa.' : '§7No hay villanos buscados ahora mismo. El reino está en paz... por ahora.');
}

export function bountyOf(d) {
  return Math.min(1000, Math.floor(-(d.karma ?? 0) / 2));
}

async function rankingMenu(player) {
  const rows = Object.entries(W().ranking ?? {}).sort((a, b) => b[1].r - a[1].r || b[1].p - a[1].p).slice(0, 15);
  await info(player, '§lRanking del Gremio', rows.map(([n, r], i) => `§f${i + 1}. ${rkB(r.r)} §f${n} §7Nv.${r.l} · ${r.p} PG`).join('\n') || '§7Aún no hay aventureros.');
}

export async function guildMaster(player) {
  const d = getP(player);
  if (!d) return;
  const r = d.guild?.rank ?? 0;
  const lines = [];
  for (let i = 1; i < 9; i++) lines.push(`${rk(i)} §7${RANK_TITLES[i]}: ${GUILD_POINTS[i]} PG · Nivel ${GUILD_LEVEL[i]}${i <= r && d.guild?.member ? ' §a✔' : ''}`);
  const today = world.getDay();
  const cost = 25 * d.level;
  await buttons(player, '§l§1Maestro del Gremio', `§f"Un rango se gana, no se regala."\n\n${lines.join('\n')}`, [
    { text: `Lección de combate §7(${cost} oro)`, icon: 'textures/items/iron_sword', fn: async () => {
      if (d.lessonDay === today) return info(player, '§lLección', '§7Ya entrenaste conmigo hoy. Descansa.');
      if (!spendGold(player, cost)) return info(player, '§lLección', '§cNo tienes suficiente oro.');
      d.lessonDay = today;
      addXp(player, Math.round(xpNeed(d.level) * 0.15), 'quest');
      await info(player, '§lLección', '§f¡Bien! Tus movimientos mejoran. §a(+XP)');
    } },
    { text: 'Comprobar ascenso', icon: 'textures/items/book_enchanted', fn: () => { checkGuildRank(player); } },
    { text: '§7Volver' },
  ]);
}

/* ------------------------------------------------------------------ */
/* Hermandad de la Sombra                                               */
/* ------------------------------------------------------------------ */

export async function shadowMenu(player) {
  const d = getP(player);
  if (!d) return;
  if (!d.shadow?.member) {
    if ((d.karma ?? 0) > -100) return info(player, '§l§8???', '§7*La figura te mira de arriba abajo* ...Hueles a héroe. Vuelve cuando tus manos estén manchadas. §8(Karma ≤ -100)');
    const ok = await confirm(player, '§l§8Hermandad de la Sombra', '§7"Te hemos observado. Únete a nosotros y conocerás el verdadero poder. Encargos que nadie más se atreve a hacer, recompensas que nadie más puede pagar."\n\n§c(Las misiones oscuras reducen tu karma)', '§8Unirme', '§7No');
    if (!ok) return;
    d.shadow = { member: true, rank: 0, points: 0 };
    dirty(player);
    title(player, '§8§lHermandad de la Sombra', '§7Bienvenido a las sombras');
  }
  const q = ensureQuests(d);
  const today = world.getDay();
  await buttons(player, '§l§8Hermandad de la Sombra', `§7Rango en la Hermandad: ${rkB(d.shadow.rank)} §7(${d.shadow.points} PS)\n§7Karma: §c${d.karma}`, [
    { text: 'Encargos oscuros', icon: 'textures/items/paper', fn: async () => {
      if (q.darkDay !== today) {
        q.darkDay = today;
        q.dark = q.dark.filter((x) => !x.done).concat(genDark(seeded(hash(player.id + 'dark' + today)), Math.max(d.shadow.rank, 0), 3));
        dirty(player);
      }
      await info(player, '§l§8Encargos', q.dark.length ? q.dark.map(questLine).join('\n\n') : '§7No hay encargos.');
    } },
    { text: 'Entregar encargo', icon: 'textures/items/ender_pearl', fn: async () => { if (!deliver(player, 'sombra')) await info(player, '§lEntrega', '§7Nada que entregar.'); } },
    { text: 'Abandonar la Hermandad', fn: async () => { if (await confirm(player, '§lAbandonar', '§c¿Seguro? Perderás tu rango en la Hermandad.')) { d.shadow = { member: false, rank: 0, points: 0 }; dirty(player); } } },
    { text: '§7Volver' },
  ]);
}
