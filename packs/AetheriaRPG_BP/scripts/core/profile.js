// Cálculos derivados del perfil del jugador (estadísticas, edad, maná, rangos...).
import { raceOf } from '../data/races.js';
import { TALENTS } from '../data/elements.js';
import { rankFromLevel, magicRankFromXp } from '../data/ranks.js';
import { cfg } from './config.js';

export const HOBBIES = {
  mineria: { name: 'Minería', icon: 'textures/items/iron_pickaxe', perk: 'Probabilidad de mineral doble' },
  tala: { name: 'Tala', icon: 'textures/items/iron_axe', perk: 'Probabilidad de tronco extra' },
  agricultura: { name: 'Agricultura', icon: 'textures/items/wheat', perk: 'Probabilidad de cosecha extra' },
  pesca: { name: 'Pesca', icon: 'textures/items/fishing_rod_uncast', perk: 'Probabilidad de tesoro al pescar' },
  caza: { name: 'Caza', icon: 'textures/items/bow_standby', perk: 'Botín extra de animales' },
  herreria: { name: 'Herrería', icon: 'textures/items/iron_ingot', perk: 'Forja más barata' },
  alquimia: { name: 'Alquimia', icon: 'textures/items/potion_bottle_drinkable', perk: 'Elixires extra' },
  exploracion: { name: 'Exploración', icon: 'textures/items/map_filled', perk: 'Encuentras oro al descubrir regiones' },
};
export const HOBBY_IDS = Object.keys(HOBBIES);
export const HOBBY_MAX = 50;

export const STAT_NAMES = { str: 'Fuerza', vit: 'Vitalidad', agi: 'Agilidad', int: 'Inteligencia' };
export const STAT_DESC = {
  str: '+2.5% de daño cuerpo a cuerpo por punto.',
  vit: '+4 de vida máxima cada 6 puntos.',
  agi: 'Probabilidad de esquivar, velocidad y resistencia al escalar.',
  int: 'Más maná, regeneración y poder mágico.',
};

export function stat(d, k) {
  return Math.max(1, 5 + (raceOf(d.race).stats[k] ?? 0) + (d.stats?.[k] ?? 0));
}

/** Crecimiento a partir del cual se es adolescente. */
export const TEEN_AT = 0.4;

export function growth(d) {
  return Math.min(1, (d.ageTicks ?? 0) / (Math.max(0.05, cfg('daysToAdult')) * 24000));
}

export function stageOf(d) {
  const g = growth(d);
  return g >= 1 ? 'adult' : g >= TEEN_AT ? 'teen' : 'child';
}

export function g(d, m, f) {
  return d && d.gender === 'f' ? f : m;
}

export function stageName(d) {
  const s = stageOf(d);
  if (s === 'child') return g(d, 'Niño', 'Niña');
  if (s === 'teen') return 'Adolescente';
  return g(d, 'Adulto', 'Adulta');
}

export function ageYears(d) {
  const gr = growth(d);
  if (gr < 1) return 5 + Math.floor(13 * gr);
  const extra = (d.ageTicks - cfg('daysToAdult') * 24000) / (24000 * 10);
  return 18 + Math.max(0, Math.floor(extra));
}

export function stageMult(d) {
  const s = stageOf(d);
  return s === 'child' ? 0.6 : s === 'teen' ? 0.85 : 1;
}

// Alturas de referencia (humano): niño ≈ 1 bloque, adolescente ≈ 1,25–1,45 bloques, adulto ≈ 2 bloques.
// El modelo base mide 1,8 bloques, así que la escala de etapa es: niño 0.55→0.62, adolescente 0.70→0.80, adulto 1.11.
export const STAGE_SCALE = { child: [0.55, 0.62], teen: [0.7, 0.8], adult: [1.11, 1.11] };

/** Escala de etapa (sin raza) según el crecimiento 0..1. */
export function stageScale(gr) {
  gr = Math.max(0, Math.min(1, gr ?? 0));
  if (gr >= 1) return STAGE_SCALE.adult[0];
  if (gr >= TEEN_AT) {
    const t = (gr - TEEN_AT) / (1 - TEEN_AT);
    return STAGE_SCALE.teen[0] + (STAGE_SCALE.teen[1] - STAGE_SCALE.teen[0]) * t;
  }
  const t = gr / TEEN_AT;
  return STAGE_SCALE.child[0] + (STAGE_SCALE.child[1] - STAGE_SCALE.child[0]) * t;
}

/** Escala del jugador = etapa × factor de raza (sin redondear; passives la ajusta a 30..135, paso 5). */
export function scaleOf(d) {
  const race = raceOf(d.race).scale ?? 1;
  return stageScale(growth(d)) * race;
}

/** Porcentaje del grupo de escala (rpg:scale_<pct>): 30..135 en pasos de 5. */
export function scalePct(scale) {
  return Math.max(30, Math.min(135, Math.round((scale * 100) / 5) * 5));
}

export function magicRank(d) {
  return magicRankFromXp(d.magicXp ?? 0);
}

export function powerRank(d) {
  return rankFromLevel(d.level ?? 1);
}

export function maxMana(d) {
  const r = raceOf(d.race);
  return Math.round((40 + stat(d, 'int') * 6 + d.level * 3 + magicRank(d) * 20) * r.mana);
}

export function manaRegen(d) {
  return 1 + stat(d, 'int') * 0.12 + magicRank(d) * 0.3;
}

export function affinity(d, el) {
  return raceOf(d.race).affinity[el] ?? 1;
}

export function talent(d) {
  return TALENTS[d.talent] ?? TALENTS[1];
}

export function xpNeed(level) {
  return Math.floor(25 * Math.pow(level, 1.45) + 75);
}

export function hobbyNeed(level) {
  return Math.floor(40 * Math.pow(level, 1.3) + 20);
}

export function karmaTitle(k) {
  if (k >= 800) return { name: 'Héroe Legendario', c: '§6', comment: 'Las canciones de los bardos hablan de ti.' };
  if (k >= 400) return { name: 'Héroe', c: '§e', comment: 'La gente te admira y confía en ti.' };
  if (k >= 150) return { name: 'Justo', c: '§a', comment: 'Tienes buena reputación.' };
  if (k > -150) return { name: 'Neutral', c: '§7', comment: 'Aún no has decidido tu camino.' };
  if (k > -400) return { name: 'Sombrío', c: '§8', comment: 'Hay rumores oscuros sobre ti.' };
  if (k > -800) return { name: 'Villano', c: '§c', comment: 'La gente te teme. Hay una recompensa por tu cabeza.' };
  return { name: 'Señor Oscuro', c: '§4', comment: 'Tu nombre se pronuncia en susurros de terror.' };
}

export function isVillain(d) {
  return (d.karma ?? 0) <= -400;
}

export function isHero(d) {
  return (d.karma ?? 0) >= 400;
}

export function hobbyLevel(d, id) {
  return d.hobbies?.[id]?.l ?? 1;
}

export function spouseName(d) {
  return d.spouse ? d.rel?.[d.spouse]?.n : undefined;
}
