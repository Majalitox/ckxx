// Crecimiento (niño → adolescente → adulto), tamaño, pasivas raciales, estadísticas y runas de armadura.
import { world } from '@minecraft/server';
import { getP, dirty } from '../core/store.js';
import { cfg } from '../core/config.js';
import { msg, title, addKarma } from '../core/progression.js';
import { stat, stageOf, scaleOf, ageYears, stageName, isHero, g } from '../core/profile.js';
import { raceOf } from '../data/races.js';
import { readRunes } from '../data/items.js';
import { rk } from '../data/ranks.js';
import { effect, psound } from '../util/compat.js';

const appliedScale = new Map();
const appliedTag = new Map();

/** Mantiene un efecto activo sin pisar efectos más fuertes (p. ej. pociones). */
function keep(player, id, amp = 0, minTicks = 300, duration = minTicks + 300) {
  let eff;
  try { eff = player.getEffect(id); } catch {}
  if (eff && eff.amplifier > amp) return;
  if (eff && eff.amplifier === amp && eff.duration > minTicks) return;
  effect(player, id, duration, amp, false);
}

export function resetCaches(player) {
  appliedScale.delete(player.id);
  appliedTag.delete(player.id);
}

export function applyScale(player, d) {
  const pct = Math.max(30, Math.min(135, Math.round((scaleOf(d) * 100) / 5) * 5));
  if (appliedScale.get(player.id) === pct) return;
  try {
    player.triggerEvent('rpg:scale_' + pct);
    appliedScale.set(player.id, pct);
  } catch {}
}

export function updateNameTag(player, d) {
  if (!cfg('nametags')) {
    if (appliedTag.get(player.id)) {
      try { player.nameTag = player.name; } catch {}
      appliedTag.delete(player.id);
    }
    return;
  }
  const race = raceOf(d.race);
  const rank = d.guild?.member ? ` ${rk(d.guild.rank)}` : '';
  const tag = `${race.c}[${race.name}]§r ${player.name}${rank}`;
  if (appliedTag.get(player.id) === tag) return;
  try {
    player.nameTag = tag;
    appliedTag.set(player.id, tag);
  } catch {}
}

/** Envejecimiento: se llama cada segundo con los ticks transcurridos. */
export function ageTick(player, d, ticks) {
  const before = stageOf(d);
  d.ageTicks = (d.ageTicks ?? 0) + ticks;
  const after = stageOf(d);
  if (before !== after) {
    if (after === 'teen') {
      title(player, '§d§l¡Has crecido!', `§fAhora eres adolescente (${ageYears(d)} años)`);
      msg(player, '§d✦ Has crecido y ahora eres §ladolescente§r§d. ¡Ya puedes inscribirte en el Gremio de Aventureros! Habla con la recepcionista.');
    } else if (after === 'adult') {
      title(player, `§6§l¡Eres ${g(d, 'adulto', 'adulta')}!`, `§fHas alcanzado la madurez (${ageYears(d)} años)`);
      msg(player, `§6✦ ¡Has alcanzado la edad adulta! Tu cuerpo y tu poder están completos. Ya puedes casarte y tu fuerza ya no tiene penalización.`);
      for (const p of world.getAllPlayers()) if (p.id !== player.id) msg(p, `§7${player.name} ha alcanzado la edad adulta.`);
    }
    psound(player, 'random.levelup', 1, 0.7);
    dirty(player);
  }
}

/** Pasivas que se refrescan cada 2 segundos. */
export function passiveTick(player, d) {
  applyScale(player, d);
  updateNameTag(player, d);
  const race = d.race;
  const time = world.getTimeOfDay();
  const night = time >= 13000 && time <= 23000;
  // Vitalidad → vida extra; runas de vigor
  let runes = [];
  try {
    const eq = player.getComponent('minecraft:equippable');
    for (const slot of ['Head', 'Chest', 'Legs', 'Feet']) runes.push(...readRunes(eq?.getEquipment(slot)));
  } catch {}
  const vigor = runes.filter((r) => r === 'vigor').length;
  const hbAmp = Math.floor((stat(d, 'vit') - 5) / 6) - 1 + vigor + (race === 'orco' ? 1 : 0);
  if (hbAmp >= 0) keep(player, 'health_boost', Math.min(20, hbAmp), 1000, 20000000);
  // Agilidad → velocidad
  const agi = stat(d, 'agi');
  if (agi >= 45) keep(player, 'speed', 1);
  else if (agi >= 25 || race === 'bestia' || runes.includes('viento')) keep(player, 'speed', 0);
  // Raza
  if (race === 'elfo') keep(player, 'night_vision', 0, 400);
  if (race === 'enano' && player.location.y < 50) keep(player, 'haste', 0, 100);
  if (race === 'bestia') {
    keep(player, 'jump_boost', 0);
    if (night) keep(player, 'night_vision', 0, 400);
  }
  if (race === 'demonio' || race === 'draconido') keep(player, 'fire_resistance', 0);
  if (race === 'draconido') keep(player, 'resistance', 0);
  if (race === 'vampiro') {
    keep(player, 'water_breathing', 0);
    if (night) {
      keep(player, 'strength', 0, 100);
      keep(player, 'night_vision', 0, 400);
    } else if (player.dimension.id === 'minecraft:overworld' && underSky(player)) {
      keep(player, 'weakness', 0, 60);
    }
  }
  // Runas de armadura
  if (runes.includes('piedra')) keep(player, 'resistance', 0);
  if (runes.includes('vision')) keep(player, 'night_vision', 0, 400);
  if (runes.includes('llama')) keep(player, 'fire_resistance', 0);
  // Runa del minero en herramienta
  try {
    const inv = player.getComponent('minecraft:inventory')?.container;
    const tool = inv?.getItem(player.selectedSlotIndex);
    if (tool && readRunes(tool).includes('minero')) keep(player, 'haste', 1, 60);
  } catch {}
  // Héroe del pueblo
  if (isHero(d)) keep(player, 'village_hero', 0, 200);
}

function underSky(player) {
  try {
    const top = player.dimension.getTopmostBlock({ x: Math.floor(player.location.x), z: Math.floor(player.location.z) });
    return !top || top.location.y < player.location.y + 1;
  } catch {
    return false;
  }
}

/** Movimiento especial que necesita reaccionar rápido (planeo y aleteo). */
export function fastMoveTick(player, d) {
  if (d.race !== 'celestial' && d.race !== 'draconido' && d.race !== 'hada') return;
  let falling = false;
  try { falling = player.isFalling && !player.isOnGround && !player.isGliding; } catch {}
  if (!falling) return;
  if (d.race === 'hada' || player.isSneaking) effect(player, 'slow_falling', 10, 0, false);
}

/** Deriva diaria de karma racial. */
export function dailyRaceTick(player, d) {
  const drift = raceOf(d.race).karmaDrift;
  if (drift) addKarma(player, drift);
}

export { stageName };
