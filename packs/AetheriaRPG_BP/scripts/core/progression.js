// Experiencia, niveles, oro, karma, rangos de gremio y magia, pasatiempos.
import { world, system } from '@minecraft/server';
import { getP, dirty } from './store.js';
import { cfg } from './config.js';
import { raceOf } from '../data/races.js';
import { ELEMENT_IDS, ELEMENTS } from '../data/elements.js';
import { RANKS, rk, rkB, GUILD_POINTS, GUILD_LEVEL, RANK_TITLES, magicRankFromXp } from '../data/ranks.js';
import { xpNeed, hobbyNeed, stageOf, karmaTitle, talent, HOBBIES, HOBBY_MAX, maxMana } from './profile.js';
import { psound } from '../util/compat.js';
import { pick } from '../util/math.js';

export const MAX_LEVEL = 100;

export function msg(player, text) {
  try { player.sendMessage(text); } catch {}
}

export function title(player, t, sub) {
  try {
    player.onScreenDisplay.setTitle(t, { subtitle: sub ?? '', fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 15 });
  } catch {}
}

/** Último tick en que otro sistema usó la barra de acción (el HUD espera para no taparlo). */
export const actionbarLock = new Map();

/** Ganchos que asigna main.js. */
export const progressHooks = { onGuildRank: undefined }; // (player, rank)

export function actionbar(player, text) {
  actionbarLock.set(player.id, system.currentTick);
  try { player.onScreenDisplay.setActionBar(text); } catch {}
}

const COMBAT_SOURCES = new Set(['combat', 'quest', 'dungeon', 'boss']);

/** Añade experiencia aplicando multiplicadores de raza, gremio y etapa de vida. */
export function addXp(player, amount, source = 'other', silent = false) {
  const d = getP(player);
  if (!d || amount <= 0) return 0;
  const race = raceOf(d.race);
  let mult = cfg('xpMult') * (race.xp ?? 1);
  if (source === 'combat' && race.combatXp) mult *= race.combatXp;
  const member = (d.guild?.member && !d.guild?.suspended) || d.shadow?.member;
  if (member && COMBAT_SOURCES.has(source)) mult *= cfg('guildXpMult');
  const st = stageOf(d);
  if (st === 'child') mult *= source === 'hobby' ? 1.25 : 0.8;
  const gained = Math.max(1, Math.round(amount * mult));
  d.xp = (d.xp ?? 0) + gained;
  if (!silent) actionbar(player, `§a+${gained} XP §7(${sourceName(source)})`);
  let leveled = false;
  while (d.level < MAX_LEVEL && d.xp >= xpNeed(d.level)) {
    d.xp -= xpNeed(d.level);
    d.level++;
    d.sp = (d.sp ?? 0) + 1 + (d.level % 5 === 0 ? 1 : 0);
    d.statPts = (d.statPts ?? 0) + 3;
    leveled = true;
    onLevelUp(player, d);
  }
  if (d.level >= MAX_LEVEL) d.xp = Math.min(d.xp, xpNeed(MAX_LEVEL));
  if (leveled) checkGuildRank(player);
  dirty(player);
  return gained;
}

function sourceName(s) {
  return { combat: 'combate', quest: 'misión', dungeon: 'mazmorra', boss: 'jefe', hobby: 'pasatiempo', magic: 'magia', social: 'social', explore: 'exploración' }[s] ?? s;
}

function onLevelUp(player, d) {
  title(player, `§6§l¡Nivel ${d.level}!`, '§e+3 puntos de estadística §7| §b+1 punto de habilidad');
  msg(player, `§6✦ ¡Has subido al nivel §l${d.level}§r§6! §7Usa tu Diario para repartir tus puntos.`);
  psound(player, 'random.levelup', 1, 1);
  try {
    const h = player.getComponent('minecraft:health');
    h?.resetToMaxValue();
  } catch {}
  d.mana = maxMana(d);
  // Los humanos despiertan un segundo elemento al nivel 40.
  if (d.race === 'humano' && d.level >= 40 && !d.element2) {
    const opts = ELEMENT_IDS.filter((e) => e !== d.element);
    d.element2 = pick(opts);
    d.learned2 = [];
    const el = ELEMENTS[d.element2];
    title(player, '§b§lDespertar', `§fTu segundo elemento: ${el.c}${el.name}`);
    msg(player, `§b✦ Tu versatilidad humana ha despertado un segundo elemento: ${el.c}${el.name}§b. ¡Ya puedes aprender sus habilidades!`);
  }
}

export function addGold(player, amount, silent = false) {
  const d = getP(player);
  if (!d) return;
  d.gold = Math.max(0, Math.floor((d.gold ?? 0) + amount));
  if (!silent && amount !== 0) msg(player, amount > 0 ? `§6+${Math.floor(amount)} oro §7(total: ${d.gold})` : `§c${Math.floor(amount)} oro §7(total: ${d.gold})`);
  dirty(player);
}

export function spendGold(player, amount) {
  const d = getP(player);
  if (!d || (d.gold ?? 0) < amount) return false;
  d.gold -= amount;
  dirty(player);
  return true;
}

export function addKarma(player, amount, reason) {
  const d = getP(player);
  if (!d || amount === 0) return;
  const before = karmaTitle(d.karma ?? 0).name;
  d.karma = Math.max(-1000, Math.min(1000, (d.karma ?? 0) + amount));
  const after = karmaTitle(d.karma);
  if (reason) msg(player, `${amount > 0 ? '§a' : '§c'}Karma ${amount > 0 ? '+' : ''}${amount} §7(${reason})`);
  if (after.name !== before) {
    title(player, `${after.c}§l${after.name}`, '§7Tu reputación ha cambiado');
    msg(player, `${after.c}✦ Ahora eres conocido como: §l${after.name}§r. §7${after.comment}`);
  }
  // Licencia del gremio suspendida para villanos.
  if (d.guild?.member) {
    if (d.karma <= -400 && !d.guild.suspended) {
      d.guild.suspended = true;
      msg(player, '§c✖ El Gremio de Aventureros ha suspendido tu licencia por tus crímenes. Recupera tu reputación (karma > -200) para volver.');
    } else if (d.guild.suspended && d.karma > -200) {
      d.guild.suspended = false;
      msg(player, '§a✔ El Gremio ha restaurado tu licencia de aventurero.');
    }
  }
  dirty(player);
}

export function addGuildPoints(player, amount) {
  const d = getP(player);
  if (!d || !d.guild?.member || d.guild.suspended || amount <= 0) return;
  const mult = d.race === 'humano' ? 1.1 : 1;
  const pts = Math.round(amount * mult);
  d.guild.points = (d.guild.points ?? 0) + pts;
  msg(player, `§b+${pts} puntos de gremio §7(${d.guild.points})`);
  checkGuildRank(player);
  dirty(player);
}

export function checkGuildRank(player) {
  const d = getP(player);
  if (!d?.guild?.member) return;
  let changed = false;
  while (d.guild.rank < 8 && d.guild.points >= GUILD_POINTS[d.guild.rank + 1] && d.level >= GUILD_LEVEL[d.guild.rank + 1]) {
    d.guild.rank++;
    changed = true;
  }
  if (changed) {
    const r = d.guild.rank;
    title(player, `§b§lAscenso: Rango ${rkB(r)}`, `§f${RANK_TITLES[r]} del Gremio`);
    psound(player, 'ui.toast.challenge_complete', 1, 1);
    try { world.sendMessage(`§6[Gremio] §f${player.name} §eha ascendido a rango ${rkB(r)}§e (${RANK_TITLES[r]}).`); } catch {}
    addGold(player, 50 * r);
    dirty(player);
    try { progressHooks.onGuildRank?.(player, r); } catch (e) { console.warn('[Aetheria] onGuildRank: ' + e); }
  }
}

export function addShadowPoints(player, amount) {
  const d = getP(player);
  if (!d || !d.shadow?.member || amount <= 0) return;
  d.shadow.points = (d.shadow.points ?? 0) + amount;
  msg(player, `§8+${amount} puntos de la Hermandad §7(${d.shadow.points})`);
  while (d.shadow.rank < 8 && d.shadow.points >= GUILD_POINTS[d.shadow.rank + 1]) {
    d.shadow.rank++;
    title(player, `§8§lHermandad: Rango ${rkB(d.shadow.rank)}`, '§7Las sombras te reconocen');
  }
  dirty(player);
}

export function addMagicXp(player, amount) {
  const d = getP(player);
  if (!d || amount <= 0) return;
  const before = magicRankFromXp(d.magicXp ?? 0);
  d.magicXp = (d.magicXp ?? 0) + amount * talent(d).mult;
  const after = magicRankFromXp(d.magicXp);
  if (after > before) {
    d.sp = (d.sp ?? 0) + 2 * (after - before);
    title(player, `§d§lMagia: Rango ${rkB(after)}`, '§f+2 puntos de habilidad · nuevas habilidades disponibles');
    msg(player, `§d✦ Tu dominio de la magia ha alcanzado el rango ${rkB(after)}§d. ¡Tu poder mágico aumenta!`);
    psound(player, 'random.levelup', 1, 1.4);
  }
  dirty(player);
}

export function addHobbyXp(player, hobby, amount) {
  const d = getP(player);
  if (!d || amount <= 0) return;
  d.hobbies = d.hobbies ?? {};
  const h = (d.hobbies[hobby] = d.hobbies[hobby] ?? { l: 1, x: 0 });
  const mult = raceOf(d.race).hobby?.[hobby] ?? 1;
  const gained = amount * mult;
  h.x += gained;
  while (h.l < HOBBY_MAX && h.x >= hobbyNeed(h.l)) {
    h.x -= hobbyNeed(h.l);
    h.l++;
    msg(player, `§a✦ ${HOBBIES[hobby].name} sube a nivel §l${h.l}§r§a. §7(${HOBBIES[hobby].perk})`);
    psound(player, 'random.orb', 1, 1.2);
  }
  // Parte de la XP de pasatiempos va al personaje.
  d._hobbyXpAcc = (d._hobbyXpAcc ?? 0) + gained * 0.6;
  if (d._hobbyXpAcc >= 1) {
    const whole = Math.floor(d._hobbyXpAcc);
    d._hobbyXpAcc -= whole;
    addXp(player, whole, 'hobby', true);
  }
  dirty(player);
}

export { rk, RANKS };
