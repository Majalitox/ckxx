// HUD en la barra de acción: vida, maná, nivel, rango, hechizo seleccionado y enemigo apuntado.
import { world, system } from '@minecraft/server';
import { getP } from '../core/store.js';
import { actionbarLock } from '../core/progression.js';
import { maxMana, xpNeed, stageOf } from '../core/profile.js';
import { rk } from '../data/ranks.js';
import { ELEMENTS } from '../data/elements.js';
import { slotInfo, cooldownLeft } from './magic.js';
import { targetInfo } from './combat.js';
import { hpOf, heldItem } from '../util/compat.js';

export const CASTERS = new Set(['rpg:grimoire', 'rpg:staff_apprentice', 'rpg:staff_archmage']);

export function hudTick() {
  const now = system.currentTick;
  for (const player of world.getAllPlayers()) {
    const d = getP(player);
    if (!d || d.hud === false) continue;
    if (now - (actionbarLock.get(player.id) ?? -999) < 40) continue;
    const h = hpOf(player);
    const mm = maxMana(d);
    const pct = Math.floor(((d.xp ?? 0) / xpNeed(d.level)) * 100);
    const el = ELEMENTS[d.element];
    const rank = d.guild?.member ? rk(d.guild.rank) : '§8-';
    let line = `§c♥${Math.ceil(h.cur)}/${Math.ceil(h.max)} §9✦${Math.floor(d.mana ?? 0)}/${mm} §eNv.${d.level} §7(${pct}%) §fRango:${rank} ${el ? el.c + el.name : ''}`;
    const held = heldItem(player)?.typeId;
    if (held && CASTERS.has(held) && d.slots?.length) {
      const info = slotInfo(d, d.slots[(d.slotSel ?? 0) % d.slots.length]);
      if (info) {
        const cd = cooldownLeft(player, info.key);
        line = `§b» ${info.name} §9(${info.mana}✦)${cd ? ` §c${cd}s` : ' §a✔'} §7[${(d.slotSel ?? 0) + 1}/${d.slots.length}]\n` + line;
      }
    } else {
      const t = targetInfo(player);
      if (t) line = t + '\n' + line;
    }
    if (stageOf(d) !== 'adult') line += stageOf(d) === 'child' ? ' §d[Niño/a]'.replace('o/a', d.gender === 'f' ? 'a' : 'o') : ' §d[Adolescente]';
    try { player.onScreenDisplay.setActionBar(line); } catch {}
  }
}
