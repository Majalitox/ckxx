// Aetheria RPG — punto de entrada.
// Conecta todos los sistemas a los eventos del juego y arranca los bucles periódicos.
import { world, system } from '@minecraft/server';
import { getP, W, flush, savePlayer, forgetPlayer, wDirty } from './core/store.js';
import { msg } from './core/progression.js';
import { DRINKS } from './data/items.js';
import { BOSSES, MOBS } from './data/mobs.js';
import { beginBirth, familyUpkeep } from './systems/birth.js';
import { ageTick, passiveTick, fastMoveTick, dailyRaceTick, resetCaches, applyScale } from './systems/passives.js';
import * as npc from './systems/npc.js';
import * as quests from './systems/quests.js';
import * as guild from './systems/guild.js';
import { shopMenu } from './systems/shop.js';
import { forgeMenu } from './systems/forge.js';
import * as magic from './systems/magic.js';
import { spawnSummon, summonTick } from './systems/summons.js';
import * as combat from './systems/combat.js';
import * as hobbies from './systems/hobbies.js';
import * as explore from './systems/explore.js';
import { climbTick } from './systems/climb.js';
import { hudTick, CASTERS } from './systems/hud.js';
import * as dungeons from './systems/dungeons.js';
import * as bosses from './systems/bosses.js';
import { townTick } from './systems/town.js';
import { openJournal } from './systems/menu.js';
import { onScriptEvent } from './systems/admin.js';
import { guarded, info } from './util/ui.js';
import { heal, effect, heldItem, setHeldItem } from './util/compat.js';
import { getP as dataOf } from './core/store.js';
import { maxMana } from './core/profile.js';
import { rkB } from './data/ranks.js';

/* ------------------------------ Conexiones ------------------------------ */

const progress = quests.progress;
Object.assign(npc.hooks, {
  guildDesk: (p) => guild.guildDesk(p),
  guildMaster: (p) => guild.guildMaster(p),
  shop: (p) => shopMenu(p),
  forge: (p, fromNpc) => forgeMenu(p, fromNpc),
  shadow: (p) => guild.shadowMenu(p),
  familyQuest: (p, ident) => quests.familyQuestMenu(p, ident),
  deliver: (p, role) => quests.deliver(p, role),
  questProgress: progress,
});
Object.assign(magic.hooks, { questProgress: progress, spawnSummon });
Object.assign(combat.hooks, {
  questProgress: progress,
  onNpcDeath: npc.onNpcDeath,
  onBossDeath: bosses.onBossDeath,
  bossDamage: bosses.bossDamage,
});
hobbies.hooks.questProgress = progress;
explore.hooks.questProgress = progress;
dungeons.hooks.questProgress = progress;

/* ------------------------------ Eventos ------------------------------ */

world.afterEvents.playerSpawn.subscribe((ev) => {
  const player = ev.player;
  system.runTimeout(() => {
    if (!player.isValid) return;
    const d = getP(player);
    if (!d) return beginBirth(player);
    resetCaches(player);
    applyScale(player, d);
    if (ev.initialSpawn) {
      msg(player, `§6✦ Bienvenido/a de nuevo a Aetheria, ${player.name}. §7Nivel ${d.level}${d.guild?.member ? ' · Gremio ' + rkB(d.guild.rank) : ''}.`.replace('Bienvenido/a', d.gender === 'f' ? 'Bienvenida' : 'Bienvenido'));
      quests.dailyCheck(player);
      const unread = (d.inbox ?? []).filter((m) => !m.read).length;
      if (unread) msg(player, `§d✉ Tienes ${unread} carta(s) sin leer.`);
    }
  }, ev.initialSpawn ? 60 : 5);
});

world.beforeEvents.playerLeave.subscribe((ev) => {
  try { forgetPlayer(ev.player); } catch {}
});

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target?.typeId !== npc.NPC_TYPE) return;
  ev.cancel = true;
  const player = ev.player;
  const target = ev.target;
  system.run(() => npc.openNpc(player, target));
});

const SEALS = new Map(Object.entries(BOSSES).map(([id, b]) => [b.seal, id]));

world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  const id = ev.itemStack?.typeId;
  if (!player || !id) return;
  if (id === 'rpg:journal') return openJournal(player);
  if (CASTERS.has(id)) {
    if (!getP(player)) return;
    if (player.isSneaking) return magic.cycleSlot(player);
    return magic.castSelected(player);
  }
  if (id === 'rpg:guild_card') {
    const d = getP(player);
    if (!d) return;
    return guarded(player, () => info(player, '§l§bLicencia de Aventurero', d.guild?.member ? `§f${player.name}\n§7Rango: ${rkB(d.guild.rank)}\n§7Puntos: §b${d.guild.points}\n§7Nivel: §e${d.level}\n§7Estado: ${d.guild.suspended ? '§cSuspendida' : '§aEn regla'}` : '§7Esta licencia no está registrada a tu nombre.'));
  }
  if (SEALS.has(id)) {
    if (bosses.summonBoss(player, SEALS.get(id))) {
      const it = heldItem(player);
      if (it && it.typeId === id) {
        if (it.amount > 1) { it.amount--; setHeldItem(player, it); } else setHeldItem(player, undefined);
      }
    }
    return;
  }
  if (id === 'minecraft:fishing_rod') hobbies.onRodUse(player);
});

world.afterEvents.itemCompleteUse.subscribe((ev) => {
  const player = ev.source;
  const drink = DRINKS[ev.itemStack?.typeId];
  if (!drink || !player) return;
  const d = dataOf(player);
  if (drink.mana && d) {
    d.mana = Math.min(maxMana(d), (d.mana ?? 0) + drink.mana);
    msg(player, `§9+${drink.mana} maná`);
  }
  if (drink.heal) heal(player, drink.heal);
  for (const [e, t, a] of drink.effects ?? []) effect(player, e, t, a, true);
});

world.afterEvents.entityHurt.subscribe((ev) => {
  try { combat.onHurt(ev); } catch (e) { console.warn('[Aetheria] onHurt: ' + e); }
});

world.afterEvents.entityDie.subscribe((ev) => {
  try { combat.onDie(ev); } catch (e) { console.warn('[Aetheria] onDie: ' + e); }
});

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  try { hobbies.onBreak(ev); } catch (e) { console.warn('[Aetheria] onBreak: ' + e); }
});

world.afterEvents.entitySpawn.subscribe((ev) => {
  const e = ev.entity;
  let type;
  try { type = e.typeId; } catch { return; }
  if (type === npc.NPC_TYPE) {
    system.runTimeout(() => { if (e.isValid && !npc.identOf(e)) npc.ensureIdentity(e); }, 10);
  } else if (MOBS[type]) {
    system.runTimeout(() => { if (e.isValid) combat.setupMob(e); }, 2);
  }
});

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  try { onScriptEvent(ev); } catch (e) { console.warn('[Aetheria] scriptevent: ' + e); }
});

/* ------------------------------ Bucles ------------------------------ */

let started = false;
let seconds = 0;

function each(fn) {
  for (const p of world.getAllPlayers()) {
    try { fn(p); } catch (e) { console.warn('[Aetheria] ' + e + (e?.stack ? '\n' + e.stack : '')); }
  }
}

function secondTick() {
  seconds++;
  const w = W();
  // Cambio de día
  const day = world.getDay();
  if (w.lastDay !== day) {
    const first = w.lastDay === -1;
    w.lastDay = day;
    wDirty();
    if (!first) each((p) => { const d = getP(p); if (d) dailyRaceTick(p, d); });
  }
  each((player) => {
    const d = getP(player);
    if (!d) {
      if (seconds % 5 === 0) beginBirth(player);
      return;
    }
    ageTick(player, d, 20);
    magic.manaTick(player, d);
    explore.exploreTick(player);
    if (seconds % 2 === 0) passiveTick(player, d);
    if (seconds % 5 === 0) quests.dailyCheck(player);
    if (seconds % 10 === 0) familyUpkeep(player);
  });
  try { bosses.bossTick(); } catch (e) { console.warn('[Aetheria] bossTick: ' + e); }
  if (seconds % 2 === 0) {
    try { summonTick(); } catch {}
    try { dungeons.dungeonTick(); } catch (e) { console.warn('[Aetheria] dungeonTick: ' + e); }
  }
  if (seconds % 3 === 0) try { npc.greetTick(); } catch {}
  if (seconds % 10 === 0) try { townTick(); } catch (e) { console.warn('[Aetheria] townTick: ' + e); }
  if (seconds % 480 === 0) try { npc.letterTick(); } catch {}
  if (seconds % 5 === 0) try { flush(); } catch (e) { console.warn('[Aetheria] flush: ' + e); }
}

function start() {
  if (started) return;
  started = true;
  W();
  system.runInterval(secondTick, 20);
  system.runInterval(() => {
    try { climbTick(); } catch {}
    each((p) => { const d = getP(p); if (d) fastMoveTick(p, d); });
  }, 2);
  system.runInterval(() => { try { hudTick(); } catch {} }, 10);
  console.warn('[Aetheria RPG] Cargado correctamente.');
}

world.afterEvents.worldLoad.subscribe(() => start());
system.runTimeout(() => { try { world.getAllPlayers(); start(); } catch {} }, 100);

export { savePlayer };
