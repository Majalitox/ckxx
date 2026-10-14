// Configuración del mod (editable por administradores desde el Diario o con /scriptevent).
import { W, wDirty } from './store.js';

export const DEFAULTS = {
  daysToAdult: 30, // días de juego (jugados) para pasar de niño a adulto: "1 mes"
  xpMult: 1,
  guildXpMult: 1.5,
  guildFee: 25,
  dungeonEveryMin: 12,
  dungeonChance: 0.6,
  dungeonSpacing: 200,
  maxDungeons: 30,
  magicPvP: false,
  climbing: true,
  nametags: true,
  npcLetters: true,
  mobScaling: true,
  deathXpLoss: 0.05,
};

export const SETTING_LABELS = {
  daysToAdult: 'Días de juego hasta la adultez',
  xpMult: 'Multiplicador de experiencia',
  guildXpMult: 'Multiplicador XP del Gremio',
  guildFee: 'Cuota de inscripción al Gremio',
  dungeonEveryMin: 'Minutos entre mazmorras (por jugador)',
  dungeonChance: 'Probabilidad de mazmorra (0-1)',
  dungeonSpacing: 'Distancia mínima entre mazmorras',
  maxDungeons: 'Máximo de mazmorras activas',
  magicPvP: 'La magia daña a otros jugadores',
  climbing: 'Sistema de escalada',
  nametags: 'Mostrar rango/raza sobre el jugador',
  npcLetters: 'Los NPCs envían cartas',
  mobScaling: 'Monstruos más fuertes lejos del inicio',
  deathXpLoss: 'Pérdida de XP al morir (0-1)',
};

export function cfg(key) {
  const s = W().settings ?? {};
  return s[key] !== undefined ? s[key] : DEFAULTS[key];
}

export function setCfg(key, value) {
  const w = W();
  w.settings = w.settings ?? {};
  w.settings[key] = value;
  wDirty();
}
