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

export function growth(d) {
  return Math.min(1, (d.ageTicks ?? 0) / (Math.max(0.05, cfg('daysToAdult')) * 24000));
}

export function stageOf(d) {
  const g = growth(d);
  return g >= 1 ? 'adult' : g >= 0.4 ? 'teen' : 'child';
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

export function scaleOf(d) {
  const s = stageOf(d);
  const race = raceOf(d.race).scale;
  if (s === 'adult') return race;
  const gr = growth(d);
  // crece de forma progresiva: de 0.55 a 1.0 del tamaño de su raza
  const f = 0.55 + 0.45 * Math.min(1, gr / 1);
  return race * f;
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
