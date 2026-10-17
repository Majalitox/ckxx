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
  // Reinos y asentamientos
  settlementGen: true,
  settlementSpacing: 350,
  capitalSpacing: 900,
  maxSettlements: 40,
  raidChance: 0.1,
  // Justicia (data/laws.js lee estos mismos valores)
  humiliationSeconds: 60,
  jailMinutesSerious: 15,
  jailMinutesMurder: 30,
  decaySeconds: 120,
  // Magia
  spellShake: true,
  spellTitles: true,
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
  settlementGen: 'Generar pueblos y reinos al explorar',
  settlementSpacing: 'Distancia mínima entre asentamientos',
  capitalSpacing: 'Distancia mínima entre capitales',
  maxSettlements: 'Máximo de asentamientos generados',
  raidChance: 'Probabilidad de asalto nocturno (0-1)',
  humiliationSeconds: 'Segundos de castigo público (cepo)',
  jailMinutesSerious: 'Minutos de prisión por delito grave',
  jailMinutesMurder: 'Minutos de prisión por asesinato',
  decaySeconds: 'Segundos para perder una estrella de búsqueda',
  spellShake: 'Sacudida de cámara con hechizos poderosos',
  spellTitles: 'Títulos de hechizos legendarios y reacciones',
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** ¿Es un ajuste conocido? (sin nombres heredados como "constructor"). */
export function isSetting(key) {
  return typeof key === 'string' && has(DEFAULTS, key);
}

/**
 * Valor vigente de un ajuste. Un valor guardado inválido (NaN se guarda como null en JSON, tipo distinto
 * del de serie, número no finito) cuenta como no fijado y devuelve el de serie.
 */
export function cfg(key) {
  let s;
  try { s = W().settings; } catch {}
  const def = DEFAULTS[key];
  if (!s || !has(s, key)) return def;
  const v = s[key];
  if (v === undefined || v === null) return def;
  if (def !== undefined && typeof v !== typeof def) return def;
  if (typeof v === 'number' && !Number.isFinite(v)) return def;
  return v;
}

/**
 * Interpreta el texto de un ajuste. Devuelve { ok: true, value } o { ok: false } si no es válido.
 * Booleanos: true/false, 1/0, sí/no, on/off. Números: finitos y no negativos.
 */
export function parseSetting(key, raw) {
  if (!isSetting(key)) return { ok: false };
  const txt = String(raw ?? '').trim().toLowerCase();
  if (typeof DEFAULTS[key] === 'boolean') {
    if (['true', '1', 'si', 'sí', 'on'].includes(txt)) return { ok: true, value: true };
    if (['false', '0', 'no', 'off'].includes(txt)) return { ok: true, value: false };
    return { ok: false };
  }
  if (txt === '') return { ok: false };
  const n = Number(txt.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

export function setCfg(key, value) {
  const w = W();
  w.settings = w.settings ?? {};
  w.settings[key] = value;
  wDirty();
}
