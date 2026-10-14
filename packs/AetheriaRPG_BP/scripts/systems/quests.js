// Seguimiento de misiones: diarias (nuevas cada día), familiares, del gremio y oscuras.
import { world } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { addXp, addGold, addKarma, addGuildPoints, addShadowPoints, msg, title } from '../core/progression.js';
import { stageOf, powerRank } from '../core/profile.js';
import { genDaily, genFamily, MINE_TARGETS, ROLE_LABEL } from '../data/quests.js';
import { ANIMALS, VILLAGERS, isHostile, MOBS, BOSSES } from '../data/mobs.js';
import { rk } from '../data/ranks.js';
import { hash, seeded } from '../util/math.js';
import { bar } from '../util/text.js';
import { countItem, removeItem, psound } from '../util/compat.js';
import { buttons, info } from '../util/ui.js';

const LISTS = ['daily', 'guild', 'family', 'dark'];
export const KIND_NAMES = { daily: '§eDiaria', guild: '§bGremio', family: '§dFamilia', dark: '§8Hermandad' };

function ensure(d) {
  d.quests = d.quests ?? {};
  for (const k of LISTS) d.quests[k] = d.quests[k] ?? [];
  return d.quests;
}

/** Renueva las misiones diarias cuando cambia el día del mundo. */
export function dailyCheck(player) {
  const d = getP(player);
  if (!d) return;
  const q = ensure(d);
  const day = world.getDay();
  if (q.day === day) return;
  q.day = day;
  const rng = seeded(hash(player.id + ':' + day));
  q.daily = genDaily(rng, powerRank(d), stageOf(d), 3);
  q.family = q.family.filter((x) => !x.done && (x.expires ?? day) >= day);
  q.dark = q.dark.filter((x) => !x.done);
  q.guildTaken = [];
  dirty(player);
  msg(player, `§e✦ Nuevo día (${day}): tienes §l${q.daily.length}§r§e misiones diarias nuevas. §7Revisa tu Diario.`);
}

function matches(quest, type, key, extra) {
  if (quest.done || quest.type !== type) return false;
  switch (type) {
    case 'kill':
      if (quest.target === '#hostile') return isHostile(key);
      if (quest.target === '#villager') return VILLAGERS.has(key);
      if (quest.target === '#npc') return key === '#npc';
      if (quest.target === '#undead') return !!(MOBS[key]?.undead || BOSSES[key]?.undead);
      return quest.target === key;
    case 'boss':
      return quest.target === key;
    case 'mine': {
      const t = MINE_TARGETS[quest.target];
      return !!t && t.match.some((m) => (m.includes(':') ? key === m : key.includes(m)));
    }
    case 'dungeon':
      return (extra ?? 0) >= quest.target;
    case 'hunt':
      return ANIMALS.has(key) || key === '#animal';
    default:
      return true;
  }
}

/** Notifica un progreso: type (kill, mine, chop, harvest, fish, cast, talk, explore, hunt, boss, dungeon). */
export function progress(player, type, key = '', n = 1, extra) {
  const d = getP(player);
  if (!d) return;
  const q = ensure(d);
  let changed = false;
  for (const list of LISTS) {
    for (const quest of q[list]) {
      if (!matches(quest, type, key, extra)) continue;
      if (type === 'talk') {
        quest.keys = quest.keys ?? [];
        if (quest.keys.includes(key)) continue;
        quest.keys.push(key);
      }
      quest.have = Math.min(quest.need, quest.have + n);
      changed = true;
      if (quest.have >= quest.need && quest.type !== 'deliver') complete(player, quest);
    }
  }
  if (changed) dirty(player);
}

/** Completa una misión y entrega recompensas. */
export function complete(player, quest) {
  const d = getP(player);
  if (!d || quest.done) return;
  quest.done = true;
  const darkBonus = quest.kind === 'dark' && d.race === 'demonio' ? 1.5 : 1;
  addXp(player, Math.round(quest.xp * darkBonus), 'quest', true);
  addGold(player, Math.round(quest.gold * darkBonus), true);
  if (quest.gp) addGuildPoints(player, quest.gp);
  if (quest.sp) addShadowPoints(player, quest.sp);
  if (quest.karma) addKarma(player, quest.karma);
  d.stats2 = d.stats2 ?? {};
  d.stats2.quests = (d.stats2.quests ?? 0) + 1;
  title(player, '§a§l¡Misión completada!', `§f${quest.title}`);
  msg(player, `§a✔ Misión completada: §f${quest.title} §7→ §a+${Math.round(quest.xp * darkBonus)} XP §6+${Math.round(quest.gold * darkBonus)} oro${quest.gp ? ` §b+${quest.gp} PG` : ''}${quest.sp ? ` §8+${quest.sp} PS` : ''}`);
  psound(player, 'random.levelup', 0.7, 1.6);
  dirty(player);
}

/** Entregar objetos de misiones tipo "deliver" a un rol. Devuelve true si entregó algo. */
export function deliver(player, role) {
  const d = getP(player);
  if (!d) return false;
  const q = ensure(d);
  let any = false;
  for (const list of LISTS) {
    for (const quest of q[list]) {
      if (quest.done || quest.type !== 'deliver' || quest.role !== role) continue;
      const have = countItem(player, quest.item);
      if (have < quest.need) {
        msg(player, `§7Te faltan objetos para "${quest.title}": ${have}/${quest.need}.`);
        continue;
      }
      removeItem(player, quest.item, quest.need);
      quest.have = quest.need;
      complete(player, quest);
      any = true;
    }
  }
  if (any) dirty(player);
  return any;
}

/** Menú de encargos familiares desde el NPC familiar. */
export async function familyQuestMenu(player, ident) {
  const d = getP(player);
  const q = ensure(d);
  const role = ident.role;
  const pending = q.family.filter((x) => !x.done && x.role === role);
  if (pending.length) {
    const ok = deliver(player, role);
    if (ok) return info(player, `§l${ident.name}`, '§f¡Muchísimas gracias! Eres un sol. Toma tu recompensa.');
    const p = pending[0];
    return info(player, `§l${ident.name}`, `§fTodavía espero: §e${p.desc}\n§7Llevas ${countItem(player, p.item)}/${p.need}.`);
  }
  const day = world.getDay();
  if ((q.familyDay ?? {})[role] === day) return info(player, `§l${ident.name}`, '§fPor hoy no necesito nada más. ¡Gracias, de verdad!');
  const rng = seeded(hash(player.id + role + day));
  const quest = genFamily(rng, role, Math.max(0, powerRank(d) - 1));
  if (!quest) return info(player, `§l${ident.name}`, '§fNo necesito nada, gracias.');
  quest.expires = day + 2;
  q.family.push(quest);
  q.familyDay = q.familyDay ?? {};
  q.familyDay[role] = day;
  dirty(player);
  await info(player, `§l${ident.name}`, `§f¿Me harías un favor? ${quest.desc}\n\n§7Recompensa: §a${quest.xp} XP §6${quest.gold} oro\n§7(Vuelve a hablar conmigo cuando lo tengas)`);
}

export function questLine(quest) {
  const kind = KIND_NAMES[quest.kind] ?? '';
  const status = quest.done ? '§a✔ COMPLETADA' : `${bar(quest.have, quest.need, 12)} §f${quest.have}/${quest.need}`;
  return `${kind} §7[${rk(quest.rank)}§7] §f§l${quest.title}§r\n§7${quest.desc}\n${status}\n§7Recompensa: §a${quest.xp} XP §6${quest.gold} oro${quest.gp ? ` §b${quest.gp} PG` : ''}${quest.sp ? ` §8${quest.sp} PS` : ''}`;
}

export async function questMenu(player) {
  const d = getP(player);
  const q = ensure(d);
  const all = [...q.daily, ...q.family, ...q.guild, ...q.dark];
  const body = all.length ? all.map(questLine).join('\n\n') : '§7No tienes misiones activas.';
  const list = [];
  if (q.guild.some((x) => x.done) || q.dark.some((x) => x.done)) {
    list.push({ text: '§7Limpiar misiones completadas', fn: () => { q.guild = q.guild.filter((x) => !x.done); q.dark = q.dark.filter((x) => !x.done); q.family = q.family.filter((x) => !x.done); dirty(player); } });
  }
  list.push({ text: '§lVolver' });
  await buttons(player, '§l§6Misiones', `§7Día ${world.getDay()} · Las diarias se renuevan cada amanecer.\n\n` + body, list);
}

export { ensure as ensureQuests, ROLE_LABEL };
