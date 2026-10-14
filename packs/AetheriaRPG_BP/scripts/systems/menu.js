// Diario del Aventurero: menú principal con perfil, magia, misiones, gremio, familia, relaciones, etc.
import { world } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { cfg, setCfg, DEFAULTS, SETTING_LABELS } from '../core/config.js';
import { msg } from '../core/progression.js';
import {
  stat, STAT_NAMES, STAT_DESC, maxMana, manaRegen, stageName, ageYears, growth, magicRank, powerRank, affinity, talent, xpNeed,
  karmaTitle, HOBBIES, HOBBY_IDS, HOBBY_MAX, hobbyNeed, hobbyLevel, spouseName, g,
} from '../core/profile.js';
import { raceOf, RACES } from '../data/races.js';
import { ELEMENTS, ELEMENT_IDS, BRANCHES, TIER_NAMES, getSkill, prereqOk } from '../data/elements.js';
import { RANKS, rk, rkB, MAGIC_XP, GUILD_POINTS, GUILD_LEVEL, RANK_TITLES } from '../data/ranks.js';
import { ROLE_NAMES } from '../data/names.js';
import { questMenu } from './quests.js';
import { relTier, replyLetter } from './npc.js';
import { forgeMenu, alchemyMenu, nearForge, nearAlchemy } from './forge.js';
import { castRacial, slotInfo } from './magic.js';
import { dungeonList, tryGenerate } from './dungeons.js';
import { summonBoss } from './bosses.js';
import { BOSSES } from '../data/mobs.js';
import { rebirth } from './birth.js';
import { atlasText } from './settlements.js';
import { profileText as stealthText } from './justice.js';
import { journalPage as socialPage } from './social.js';
import { buttons, info, confirm, ask, guarded } from '../util/ui.js';
import { bar, fmt, hearts } from '../util/text.js';
import { dist2D, cardinal } from '../util/math.js';

export function openJournal(player) {
  guarded(player, () => mainMenu(player));
}

function isAdmin(player) {
  try {
    if (player.hasTag('rpg_admin')) return true;
    const lvl = player.playerPermissionLevel;
    return lvl === 2 || lvl === 'Operator' || String(lvl).toLowerCase() === 'operator';
  } catch {
    return player.hasTag('rpg_admin');
  }
}

async function mainMenu(player) {
  const d = getP(player);
  if (!d) return msg(player, '§7Aún no has nacido... espera un momento.');
  const race = raceOf(d.race);
  const el = ELEMENTS[d.element];
  const kt = karmaTitle(d.karma ?? 0);
  const unread = (d.inbox ?? []).filter((m) => !m.read).length;
  const body =
    `§f${player.name} ${d.family?.surname ?? ''} §7· ${race.c}${race.name} §7· ${stageName(d)} (${ageYears(d)} años)\n` +
    `§eNivel ${d.level} ${bar(d.xp, xpNeed(d.level), 16, '§e')} §7${fmt(d.xp)}/${fmt(xpNeed(d.level))}\n` +
    `§fElemento: ${el.c}${el.name}${d.element2 ? ` §7+ ${ELEMENTS[d.element2].c}${ELEMENTS[d.element2].name}` : ''} §7· Magia ${rkB(magicRank(d))}\n` +
    `§fGremio: ${d.guild?.member ? rkB(d.guild.rank) + (d.guild.suspended ? ' §c(suspendido)' : '') : '§7no inscrito'} §7· Poder ${rk(powerRank(d))}\n` +
    `§fReputación: ${kt.c}${kt.name} §7(${d.karma}) §7· §6Oro: ${d.gold}\n` +
    (d.statPts ? `§a¡Tienes ${d.statPts} puntos de estadística sin asignar!\n` : '') +
    (d.sp ? `§b¡Tienes ${d.sp} puntos de habilidad!\n` : '');
  const list = [
    { text: '§lPerfil y estadísticas', icon: 'textures/items/book_written', fn: () => profileMenu(player) },
    { text: '§lMagia y habilidades', icon: 'textures/items/rpg_grimoire', fn: () => magicMenu(player) },
    { text: '§lMisiones', icon: 'textures/items/paper', fn: () => questMenu(player) },
    { text: '§lGremio', icon: 'textures/items/rpg_guild_card', fn: () => guildInfo(player) },
    { text: '§lFamilia', icon: 'textures/items/bed_red', fn: () => familyMenu(player) },
    { text: '§lRelaciones', icon: 'textures/items/cake', fn: () => relationsMenu(player) },
    { text: '§lPosición social y hazañas', icon: 'textures/items/gold_ingot', fn: () => info(player, '§l§6Posición social', socialPage(player)) },
    { text: '§lReinos y asentamientos', icon: 'textures/items/map_filled', fn: () => info(player, '§l§2Reinos y asentamientos', atlasText(player)) },
    { text: `§lSigilo y antecedentes${(d.wanted?.stars ?? 0) > 0 ? ' §c(SE BUSCA)' : ''}`, icon: 'textures/items/iron_bars', fn: () => info(player, '§l§5Sigilo y antecedentes', stealthText(player)) },
    { text: `§lMensajes${unread ? ` §c(${unread})` : ''}`, icon: 'textures/items/book_writable', fn: () => inboxMenu(player) },
    { text: '§lPasatiempos', icon: 'textures/items/iron_pickaxe', fn: () => hobbiesMenu(player) },
    { text: `§lRaza: ${race.name}`, icon: 'textures/items/totem', fn: () => raceMenu(player) },
    { text: '§lMazmorras cercanas', icon: 'textures/items/compass_item', fn: () => dungeonMenu(player) },
  ];
  if (nearForge(player)) list.push({ text: '§6§lForja', icon: 'textures/items/iron_ingot', fn: () => forgeMenu(player) });
  if (nearAlchemy(player) || d.race === 'elfo') list.push({ text: '§5§lAlquimia', icon: 'textures/items/potion_bottle_drinkable', fn: () => alchemyMenu(player) });
  list.push({ text: '§lGuía del juego', icon: 'textures/items/map_filled', fn: () => guide(player) });
  list.push({ text: '§lOpciones', icon: 'textures/items/comparator', fn: () => optionsMenu(player) });
  if (isAdmin(player)) list.push({ text: '§c§lAdministración', icon: 'textures/items/redstone_dust', fn: () => adminMenu(player) });
  await buttons(player, '§l§6Diario del Aventurero', body, list);
}

/* --------------------------- Perfil --------------------------- */

async function profileMenu(player) {
  const d = getP(player);
  const race = raceOf(d.race);
  const s2 = d.stats2 ?? {};
  const body =
    `§fFuerza: §c${stat(d, 'str')}  §fVitalidad: §a${stat(d, 'vit')}\n§fAgilidad: §b${stat(d, 'agi')}  §fInteligencia: §d${stat(d, 'int')}\n` +
    `§fManá: §9${Math.floor(d.mana)}/${maxMana(d)} §7(+${manaRegen(d).toFixed(1)}/s)\n` +
    `§fCrecimiento: ${bar(growth(d), 1, 16, '§d')} §7${Math.floor(growth(d) * 100)}%\n` +
    `§fTalento mágico: ${talent(d).name}\n\n` +
    `§7Monstruos derrotados: §f${s2.kills ?? 0} §7· Jefes: §f${s2.bosses ?? 0} §7· Mazmorras: §f${s2.dungeons ?? 0}\n` +
    `§7Misiones: §f${s2.quests ?? 0} §7· Hechizos lanzados: §f${s2.spells ?? 0} §7· Muertes: §f${s2.deaths ?? 0}\n` +
    `§7Distancia recorrida: §f${Math.floor(d.explore?.dist ?? 0)} §7· Regiones: §f${d.explore?.regions?.length ?? 0}\n` +
    (d.titles?.length ? `§6Títulos: §f${d.titles.slice(-5).join(', ')}\n` : '') +
    `\n§aPuntos para asignar: ${d.statPts ?? 0}`;
  const list = Object.keys(STAT_NAMES).map((k) => ({
    text: `+1 ${STAT_NAMES[k]} §7(${stat(d, k)})\n§8${STAT_DESC[k]}`,
    fn: async () => {
      if (!d.statPts) return info(player, '§lEstadísticas', '§7No tienes puntos. Sube de nivel para conseguir 3 por nivel.');
      d.statPts--;
      d.stats[k] = (d.stats[k] ?? 0) + 1;
      dirty(player);
      return profileMenu(player);
    },
  }));
  list.push({ text: '§7Volver', fn: () => mainMenu(player) });
  await buttons(player, '§l§6Perfil', body, list);
}

/* --------------------------- Magia --------------------------- */

async function magicMenu(player) {
  const d = getP(player);
  const el = ELEMENTS[d.element];
  const mr = magicRank(d);
  const next = mr < 8 ? `${bar(d.magicXp, MAGIC_XP[mr + 1], 14, '§d')} §7${Math.floor(d.magicXp)}/${MAGIC_XP[mr + 1]}` : '§6Máximo';
  const body =
    `§fElemento: ${el.c}§l${el.name}§r §7(afinidad racial x${affinity(d, d.element).toFixed(2)})\n§7${el.desc}\n` +
    `§fRango mágico: ${rkB(mr)} ${next}\n§fPuntos de habilidad: §b${d.sp ?? 0}\n` +
    `§fHabilidades aprendidas: §f${d.learned.length}/50${d.element2 ? ` §7· ${ELEMENTS[d.element2].name}: ${(d.learned2 ?? []).length}/50` : ''}\n` +
    `§7Ranuras rápidas: ${(d.slots ?? []).map((r) => slotInfo(d, r)?.name ?? '?').join(' §8|§7 ')}`;
  const list = [
    { text: `§l${el.c}Árbol de ${el.name}`, icon: 'textures/items/rpg_grimoire', fn: () => treeMenu(player, 'p') },
  ];
  if (d.element2) list.push({ text: `§l${ELEMENTS[d.element2].c}Árbol de ${ELEMENTS[d.element2].name}`, icon: 'textures/items/book_enchanted', fn: () => treeMenu(player, 's') });
  list.push({ text: '§lRanuras de hechizos', icon: 'textures/items/blaze_rod', fn: () => slotsMenu(player) });
  list.push({ text: `§6Usar habilidad racial: ${raceOf(d.race).racial.name}`, icon: 'textures/items/totem', fn: () => castRacial(player, d) });
  list.push({ text: '§lAfinidades de tu raza', icon: 'textures/items/nether_star', fn: () => info(player, '§lAfinidades', ELEMENT_IDS.map((e) => `${ELEMENTS[e].c}${ELEMENTS[e].name}§7: x${affinity(d, e).toFixed(2)}`).join('\n')) });
  list.push({ text: '§7Volver', fn: () => mainMenu(player) });
  await buttons(player, '§l§dMagia', body, list);
}

async function treeMenu(player, which) {
  const d = getP(player);
  const elId = which === 's' ? d.element2 : d.element;
  const el = ELEMENTS[elId];
  const learned = which === 's' ? (d.learned2 = d.learned2 ?? []) : d.learned;
  const list = BRANCHES.map((b, i) => {
    const n = [0, 1, 2, 3, 4].filter((t) => learned.includes(t * 10 + i)).length;
    return { text: `§l${b.name}§r §7(${n}/5)\n§8${getSkill(elId, i).name} → ${getSkill(elId, 40 + i).name}`, icon: b.icon, fn: () => branchMenu(player, which, i) };
  });
  list.push({ text: '§7Volver', fn: () => magicMenu(player) });
  await buttons(player, `§l${el.c}Árbol de ${el.name}`, `§750 habilidades en 10 ramas de 5 niveles.\n§7Para aprender una habilidad necesitas la anterior de su rama, nivel y rango mágico.\n§fPuntos: §b${d.sp ?? 0} §f· Nivel ${d.level} · Magia ${rk(magicRank(d))}`, list);
}

function skillStatus(d, learned, s) {
  if (learned.includes(s.id)) return '§a✔';
  if (!prereqOk(learned, s.id)) return '§8✖';
  if (d.level < s.level || magicRank(d) < s.rank) return '§c✖';
  if ((d.sp ?? 0) < s.sp) return '§e●';
  return '§b●';
}

async function branchMenu(player, which, branch) {
  const d = getP(player);
  const elId = which === 's' ? d.element2 : d.element;
  const learned = which === 's' ? d.learned2 : d.learned;
  const skills = [0, 1, 2, 3, 4].map((t) => getSkill(elId, t * 10 + branch));
  const list = skills.map((s) => ({
    text: `${skillStatus(d, learned, s)} §l${s.name}§r\n§8${TIER_NAMES[s.tier]} · Nv.${s.level} · ${RANKS[s.rank]} · ${s.sp} PH`,
    fn: () => skillMenu(player, which, s),
  }));
  list.push({ text: '§7Volver', fn: () => treeMenu(player, which) });
  await buttons(player, `§l${BRANCHES[branch].name}`, '§a✔ aprendida  §b● disponible  §e● faltan puntos  §c✖ nivel/rango  §8✖ falta la anterior', list);
}

async function skillMenu(player, which, s) {
  const d = getP(player);
  const learned = which === 's' ? d.learned2 : d.learned;
  const el = ELEMENTS[s.element];
  const ref = (which === 's' ? 's:' : 'p:') + s.id;
  const has = learned.includes(s.id);
  const body =
    `${el.c}§l${s.name}§r\n§7${TIER_NAMES[s.tier]} · Rama: ${BRANCHES[s.branch].name}\n\n§f${s.desc}\n\n` +
    `§9Maná: ${s.mana} §7· Recarga: ${(s.cd / 20).toFixed(1)}s\n` +
    `§7Requisitos: Nivel ${d.level >= s.level ? '§a' : '§c'}${s.level}§7 · Magia ${magicRank(d) >= s.rank ? '§a' : '§c'}${RANKS[s.rank]}§7 · ${s.sp} PH${s.id >= 10 ? ` · ${getSkill(s.element, s.id - 10).name}` : ''}`;
  const list = [];
  if (!has) list.push({ text: '§a§lAprender', fn: async () => {
    if (!prereqOk(learned, s.id)) return info(player, '§lAprender', '§cPrimero debes aprender la habilidad anterior de esta rama.');
    if (d.level < s.level) return info(player, '§lAprender', `§cNecesitas nivel ${s.level}.`);
    if (magicRank(d) < s.rank) return info(player, '§lAprender', `§cNecesitas rango mágico ${RANKS[s.rank]}. Lanza hechizos para subirlo.`);
    if ((d.sp ?? 0) < s.sp) return info(player, '§lAprender', `§cNecesitas ${s.sp} puntos de habilidad.`);
    d.sp -= s.sp;
    learned.push(s.id);
    if ((d.slots ?? []).length < 6) d.slots.push(ref);
    dirty(player);
    msg(player, `${el.c}✦ Has aprendido: §l${s.name}`);
    try { player.playSound('random.levelup', { pitch: 1.5 }); } catch {}
    return skillMenu(player, which, s);
  } });
  else if (!(d.slots ?? []).includes(ref)) list.push({ text: '§b§lEquipar en ranura', fn: () => equip(player, ref) });
  else list.push({ text: '§7Quitar de las ranuras', fn: () => { d.slots = d.slots.filter((r) => r !== ref); d.slotSel = 0; dirty(player); } });
  list.push({ text: '§7Volver', fn: () => branchMenu(player, which, s.branch) });
  await buttons(player, `§l${s.name}`, body, list);
}

async function equip(player, ref) {
  const d = getP(player);
  d.slots = d.slots ?? [];
  if (d.slots.length < 6) {
    d.slots.push(ref);
    dirty(player);
    return msg(player, '§b✦ Hechizo equipado.');
  }
  const sel = await buttons(player, '§lRanuras llenas', '§7Elige qué hechizo reemplazar:', [...d.slots.map((r) => ({ text: slotInfo(d, r)?.name ?? r })), { text: '§7Cancelar' }]);
  if (sel === undefined || sel >= d.slots.length) return;
  d.slots[sel] = ref;
  dirty(player);
}

async function slotsMenu(player) {
  const d = getP(player);
  const list = (d.slots ?? []).map((r, i) => ({
    text: `${i === d.slotSel ? '§a» ' : ''}${slotInfo(d, r)?.name ?? r}\n§8Toca para seleccionarlo · ranura ${i + 1}`,
    fn: () => { d.slotSel = i; dirty(player); },
  }));
  list.push({ text: '§cVaciar ranuras (excepto racial)', fn: () => { d.slots = ['r']; d.slotSel = 0; dirty(player); } });
  list.push({ text: '§7Volver', fn: () => magicMenu(player) });
  await buttons(player, '§lRanuras de hechizos', '§7Hasta 6 hechizos rápidos. Con el Grimorio: §fusar§7 = lanzar, §fagacharse + usar§7 = cambiar de hechizo.', list);
}

/* --------------------------- Gremio --------------------------- */

async function guildInfo(player) {
  const d = getP(player);
  let body;
  if (!d.guild?.member) {
    body = `§fNo estás inscrito en el Gremio de Aventureros.\n\n§7Ve a la sede del Gremio (cerca del punto de inicio del mundo) y habla con la recepcionista.\n§7Requisitos: ser adolescente o adulto y pagar ${cfg('guildFee')} de oro.\n\n§aLos miembros ganan x${cfg('guildXpMult')} XP en combate, misiones y mazmorras.`;
  } else {
    const r = d.guild.rank;
    body = `§fRango: ${rkB(r)} §f(${RANK_TITLES[r]})\n§fPuntos de gremio: §b${d.guild.points}\n` +
      (r < 8 ? `§7Siguiente: ${rk(r + 1)} §7→ ${GUILD_POINTS[r + 1]} PG y nivel ${GUILD_LEVEL[r + 1]}\n${bar(d.guild.points, GUILD_POINTS[r + 1], 20, '§b')}` : '§6¡Rango máximo alcanzado!') +
      `\n\n§7Consigue puntos con las misiones del tablón, mazmorras, jefes, monstruos de rango D+ y canjeando núcleos de monstruo.`;
  }
  if (d.shadow?.member) body += `\n\n§8Hermandad de la Sombra: ${rkB(d.shadow.rank)} §8(${d.shadow.points} PS)`;
  await info(player, '§l§1Gremio de Aventureros', body);
}

/* --------------------------- Familia --------------------------- */

async function familyMenu(player) {
  const d = getP(player);
  const h = d.family?.house;
  const lines = (d.family?.members ?? []).map((m) => {
    const rel = d.rel?.[m.id];
    return `${m.dead ? '§8✝ ' : '§f'}${m.name} §7(${ROLE_NAMES[m.role]}${m.ident?.age === 'child' ? ', menor' : ''})${m.dead ? ' §8- fallecido/a' : rel ? ` ${relTier(rel).c}${relTier(rel).name}` : ''}`;
  });
  const sp = spouseName(d);
  if (sp) lines.push(`§d♥ ${sp} §7(pareja)`);
  const where = h ? `§7Casa familiar: §fX ${h.x} Y ${h.y} Z ${h.z}${player.dimension.id === 'minecraft:overworld' ? ` §7(${Math.round(dist2D(player.location, h))} bloques al ${cardinal(player.location, h)})` : ''}` : '';
  await info(player, `§l§dFamilia ${d.family?.surname ?? ''}`, `${lines.join('\n')}\n\n${where}\n\n§7Habla con tus padres para pedir la paga o encargos. Si alguien muere, la sacerdotisa del templo puede resucitarle.`);
}

/* --------------------------- Relaciones --------------------------- */

async function relationsMenu(player) {
  const d = getP(player);
  const rows = Object.entries(d.rel ?? {}).sort((a, b) => b[1].p - a[1].p).slice(0, 30);
  const body = rows.length
    ? rows.map(([, r]) => `${relTier(r).c}${r.n} §7(${ROLE_NAMES[r.r] ?? r.r}) ${hearts(Math.max(0, r.p))} §7${Math.round(r.p)}`).join('\n')
    : '§7Aún no conoces a nadie. ¡Habla con la gente!';
  await info(player, '§l§dRelaciones', body + '\n\n§7Conversa a diario, haz regalos que les gusten y evita los insultos. Con 400 puntos puedes invitar a una cita; con 700 y un anillo, proponer matrimonio.');
}

async function inboxMenu(player) {
  const d = getP(player);
  const inbox = d.inbox ?? [];
  if (!inbox.length) return info(player, '§lMensajes', '§7No tienes cartas. Las personas con las que tengas buena relación te escribirán.');
  const sel = await buttons(player, '§lMensajes', '§7Cartas recibidas:', [...inbox.map((m) => ({ text: `${m.read ? '§7' : '§l§e'}${m.from}§r\n§8Día ${m.day}: ${m.text.slice(0, 40)}...` })), { text: '§7Volver' }]);
  if (sel === undefined || sel >= inbox.length) return;
  const letter = inbox[sel];
  letter.read = true;
  dirty(player);
  const r = await buttons(player, `§lCarta de ${letter.from}`, `§f${letter.text}${letter.gold ? `\n\n§6(Incluía ${letter.gold} de oro)` : ''}`, [{ text: '§a§lResponder (escribir)' }, { text: '§cBorrar' }, { text: '§7Volver' }]);
  if (r === 0) await replyLetter(player, letter);
  if (r === 1) { d.inbox.splice(sel, 1); dirty(player); }
  if (r === 2) return inboxMenu(player);
}

/* --------------------------- Pasatiempos y raza --------------------------- */

async function hobbiesMenu(player) {
  const d = getP(player);
  const body = HOBBY_IDS.map((id) => {
    const h = d.hobbies?.[id] ?? { l: 1, x: 0 };
    return `§f${HOBBIES[id].name} §eNv.${h.l}/${HOBBY_MAX} ${h.l < HOBBY_MAX ? bar(h.x, hobbyNeed(h.l), 10, '§a') : '§6MAX'}\n§8${HOBBIES[id].perk}: ${Math.min(60, h.l)}%`;
  }).join('\n');
  await info(player, '§l§aPasatiempos', body + '\n\n§7Minar, talar, cultivar, pescar, cazar, forjar, destilar y explorar te dan experiencia de personaje además de la del pasatiempo.');
}

async function raceMenu(player) {
  const d = getP(player);
  const race = raceOf(d.race);
  const body = `${race.c}§l${race.name}§r\n\n§f${race.unique}\n\n§6Pasivas:\n§7• ${race.passives.join('\n§7• ')}\n\n§6Habilidad racial: §f${race.racial.name}\n§7${race.racial.desc} (recarga ${race.racial.cd}s)\n\n§6Afinidades: §7${Object.entries(race.affinity).filter(([, v]) => v >= 1.15).map(([k]) => ELEMENTS[k].name).join(', ') || 'equilibradas'}`;
  await buttons(player, '§lTu raza', body, [
    { text: `§6Usar ${race.racial.name}`, fn: () => castRacial(player, d) },
    { text: '§lOtras razas de Aetheria', fn: () => info(player, '§lRazas', Object.values(RACES).map((r) => `${r.c}§l${r.name}§r§7: ${r.unique}`).join('\n\n')) },
    { text: '§7Volver', fn: () => mainMenu(player) },
  ]);
}

async function dungeonMenu(player) {
  const list = dungeonList(player).slice(0, 10);
  const body = list.length ? list.map((x) => `${rkB(x.rank)} §fMazmorra #${x.id} §7a ${x.distance} bloques al ${x.dir} §8(${x.state === 'active' ? 'en curso' : 'sin explorar'})`).join('\n') : '§7No conoces mazmorras activas. Aparecen cerca de ti mientras exploras.';
  await info(player, '§l§5Mazmorras', body + '\n\n§7Busca el pozo con columnas de piedra musgosa y faroles de almas. Baja por la escalera.\n§7¡No entres en mazmorras de rango muy superior al tuyo!');
}

async function optionsMenu(player) {
  const d = getP(player);
  await buttons(player, '§lOpciones', '§7Ajustes personales.', [
    { text: `HUD en pantalla: ${d.hud === false ? '§cNO' : '§aSÍ'}`, fn: () => { d.hud = d.hud === false; dirty(player); } },
    { text: '§cRenacer (borrar personaje)', fn: async () => {
      if (await confirm(player, '§c§lRenacer', '§fBorrarás tu personaje y volverás a nacer con otra raza, elemento y familia.\n§c¡Esto no se puede deshacer!')) rebirth(player);
    } },
    { text: '§7Volver', fn: () => mainMenu(player) },
  ]);
}

async function guide(player) {
  await info(player, '§l§6Guía de Aetheria', [
    '§6§lNacimiento y crecimiento',
    '§fNaces como niño/a en una familia de NPCs. Creces jugando: en el primer 40% eres niño/a, luego adolescente, y al completar el "mes" de juego (configurable) eres adulto/a. Los niños son más pequeños y débiles pero aprenden pasatiempos más rápido.',
    '§6§lRazas',
    '§fCada raza tiene tamaño, estadísticas, afinidades mágicas, pasivas y algo único: los enanos graban runas en la forja, los elfos destilan elixires, los orcos crecen en batalla, los hombres bestia escalan y cazan, etc.',
    '§6§lMagia',
    '§fNaces con un elemento aleatorio (12 posibles) y una habilidad. Cada elemento tiene 50 habilidades en 10 ramas. El rango mágico (F → SSS) sube lanzando hechizos y desbloquea los niveles altos del árbol.',
    '§6§lGremio y rangos',
    '§fInscríbete con la recepcionista. Rangos F, E, D, C, B, A, S, SS y SSS. Sube completando el tablón, mazmorras y jefes.',
    '§6§lHéroe o villano',
    '§fTus actos cambian tu karma. Los héroes tienen descuentos y bendiciones; los villanos acceden a la Hermandad de la Sombra (de noche, junto al Gremio), pero tienen recompensa por su cabeza.',
    '§6§lNPCs',
    '§fToca a un NPC y elige "Hablar": escribe lo que quieras y te responderá según su personalidad, humor y vuestra relación. Recuerdan cosas que les cuentes y te envían cartas.',
    '§6§lEscalada',
    '§fMantén SALTAR contra una pared para trepar. Agáchate para sujetarte. Gasta aguante.',
    '§6§lMazmorras y jefes',
    '§fLas mazmorras aparecen cerca mientras exploras. Los jefes se invocan con sellos (tienda del Gremio, mazmorras).',
    '§6§lReinos, pueblos y aldeas',
    '§fAl explorar aparecen aldeas, pueblos, ciudades y capitales de 10 culturas distintas, cada reino con su soberano, sus leyes y su economía. Los habitantes trabajan, comercian, van a la taberna, a misa y a dormir; los guardias patrullan y de noche puede haber asaltos.',
    '§6§lEconomía y regateo',
    '§fLos precios cambian según el pueblo, el día, tu clase social y tu fama. En las tiendas puedes regatear: ofrece menos y mira cómo reacciona el mercader.',
    '§6§lRobos y justicia',
    '§fAgáchate y toca a alguien para robarle del bolsillo (minijuego). El ojo del HUD indica si te observan: cerrado = nadie mira, entreabierto = alguien te ve, abierto = te han pillado. Un testigo con (!) correrá al guardia: delito menor = 1 minuto en el cepo (te tirarán tomates), grave = 15 min de cárcel, asesinato = 30 min. Puedes robarle la llave al carcelero para fugarte.',
    '§6§lClase social y hazañas',
    '§fTu origen, tu riqueza, tus títulos y tus hazañas deciden tu clase. Los nobles te tratan distinto que los campesinos, y tu fama (o infamia) llega antes que tú a cada reino.',
  ].join('\n'));
}

/* --------------------------- Administración --------------------------- */

async function adminMenu(player) {
  await buttons(player, '§c§lAdministración', '§7Ajustes del servidor y herramientas de prueba.', [
    { text: 'Ajustes del mundo', fn: () => settingsMenu(player) },
    { text: 'Crear mazmorra aquí', fn: async () => {
      const r = await ask(player, 'Mazmorra', 'Rango (0=F ... 8=SSS)', '2');
      if (r === undefined) return;
      tryGenerate(player, true, Math.max(0, Math.min(8, Number(r) || 0)));
    } },
    { text: 'Invocar jefe', fn: async () => {
      const ids = Object.keys(BOSSES);
      const sel = await buttons(player, 'Jefe', '', [...ids.map((i) => ({ text: BOSSES[i].name })), { text: '§7Cancelar' }]);
      if (sel !== undefined && sel < ids.length) summonBoss(player, ids[sel]);
    } },
    { text: 'Hacerme adulto/a', fn: () => { const d = getP(player); d.ageTicks = cfg('daysToAdult') * 24000; dirty(player); } },
    { text: '+1000 XP, +500 oro, +5 PH', fn: () => { const d = getP(player); d.xp += 1000; d.gold += 500; d.sp += 5; dirty(player); } },
    { text: '§7Volver', fn: () => mainMenu(player) },
  ]);
}

async function settingsMenu(player) {
  const keys = Object.keys(DEFAULTS);
  const sel = await buttons(player, '§lAjustes del mundo', '§7Toca un ajuste para cambiarlo.', [...keys.map((k) => ({ text: `${SETTING_LABELS[k]}\n§8${cfg(k)}` })), { text: '§7Volver' }]);
  if (sel === undefined || sel >= keys.length) return adminMenu(player);
  const k = keys[sel];
  if (typeof DEFAULTS[k] === 'boolean') {
    setCfg(k, !cfg(k));
  } else {
    const v = await ask(player, SETTING_LABELS[k], `Valor actual: ${cfg(k)} (por defecto ${DEFAULTS[k]})`, String(cfg(k)));
    if (v !== undefined && v.trim() !== '' && !isNaN(Number(v))) setCfg(k, Number(v));
  }
  return settingsMenu(player);
}

export { isAdmin, g };
