// Persistencia: datos de cada jugador (individuales) y datos del mundo, guardados en propiedades dinámicas.
import { world } from '@minecraft/server';

const CHUNK = 30000;
const players = new Map();
const dirtyPlayers = new Set();
let worldData;
let worldDirty = false;

function readStr(holder, key) {
  const n = holder.getDynamicProperty(key + '_n');
  if (typeof n !== 'number') return undefined;
  let s = '';
  for (let i = 0; i < n; i++) {
    const part = holder.getDynamicProperty(`${key}_${i}`);
    if (typeof part !== 'string') return undefined;
    s += part;
  }
  return s;
}

function writeStr(holder, key, str) {
  const n = Math.max(1, Math.ceil(str.length / CHUNK));
  const old = holder.getDynamicProperty(key + '_n');
  for (let i = 0; i < n; i++) holder.setDynamicProperty(`${key}_${i}`, str.slice(i * CHUNK, (i + 1) * CHUNK));
  holder.setDynamicProperty(key + '_n', n);
  if (typeof old === 'number') for (let i = n; i < old; i++) holder.setDynamicProperty(`${key}_${i}`, undefined);
}

function clearStr(holder, key) {
  const old = holder.getDynamicProperty(key + '_n');
  if (typeof old === 'number') for (let i = 0; i < old; i++) holder.setDynamicProperty(`${key}_${i}`, undefined);
  holder.setDynamicProperty(key + '_n', undefined);
}

/** Datos del jugador (o undefined si aún no ha nacido). */
export function getP(player) {
  let d = players.get(player.id);
  if (d) return d;
  let raw;
  try { raw = readStr(player, 'rpg:pd'); } catch { return undefined; }
  if (!raw) return undefined;
  try { d = JSON.parse(raw); } catch { return undefined; }
  players.set(player.id, d);
  return d;
}

export function setP(player, d) {
  players.set(player.id, d);
  dirtyPlayers.add(player.id);
}

export function dirty(player) {
  dirtyPlayers.add(player.id);
}

export function savePlayer(player) {
  const d = players.get(player.id);
  if (!d) return;
  try {
    writeStr(player, 'rpg:pd', JSON.stringify(d));
    dirtyPlayers.delete(player.id);
  } catch (e) {
    console.warn('[Aetheria] No se pudo guardar a ' + player.name + ': ' + e);
  }
}

export function forgetPlayer(player) {
  try { savePlayer(player); } catch {}
  players.delete(player.id);
  dirtyPlayers.delete(player.id);
}

export function wipePlayer(player) {
  players.delete(player.id);
  dirtyPlayers.delete(player.id);
  try { clearStr(player, 'rpg:pd'); } catch {}
}

function defaultWorld() {
  return {
    v: 1,
    settings: {},
    town: null,
    houses: [],
    dungeons: [],
    board: { day: -1, quests: [] },
    npcCount: 0,
    lastDay: -1,
    bosses: {},
  };
}

export function W() {
  if (!worldData) {
    let raw;
    try { raw = readStr(world, 'rpg:wd'); } catch {}
    try { worldData = raw ? JSON.parse(raw) : undefined; } catch { worldData = undefined; }
    worldData = Object.assign(defaultWorld(), worldData ?? {});
  }
  return worldData;
}

export function wDirty() {
  worldDirty = true;
}

export function flush() {
  for (const p of world.getAllPlayers()) {
    if (dirtyPlayers.has(p.id)) savePlayer(p);
  }
  if (worldDirty && worldData) {
    try {
      writeStr(world, 'rpg:wd', JSON.stringify(worldData));
      worldDirty = false;
    } catch (e) {
      console.warn('[Aetheria] No se pudo guardar el mundo: ' + e);
    }
  }
}

export function allLoaded() {
  return players;
}
