// Villa inicial: sede del Gremio con su personal (v1) y enlace con la villa completa
// (mercado, taberna, herrería, templo, cárcel, guardias...) que construye systems/settlements.js.
import { world } from '@minecraft/server';
import { W, wDirty } from '../core/store.js';
import { buildGuildHall } from './build.js';
import { makeIdentity, spawnNpc, NPC_TYPE } from './npc.js';
import { ensureStarterVillage, nextHouseSpot as settlementHouseSpot } from './settlements.js';
import { dist2D } from '../util/math.js';

const missing = new Map();

const STAFF_SPEC = {
  recepcionista: { race: 'humano', gender: 'f', name: 'Lía', pers: 'alegre' },
  maestro: { race: 'orco', gender: 'm', name: 'Brakus', pers: 'serio' },
  mercader: { race: 'humano', gender: 'm', name: 'Tobías', pers: 'bromista' },
  herrero: { race: 'enano', gender: 'm', name: 'Durgan', pers: 'gruñón' },
  sacerdotisa: { race: 'celestial', gender: 'f', name: 'Seraphina', pers: 'sabio' },
  sombra: { race: 'demonio', gender: 'm', name: 'Malphas', pers: 'serio' },
};

export function town() {
  return W().town;
}

/**
 * Núcleo de la villa inicial: construye la sede del Gremio junto al jugador y hace aparecer a su
 * personal. Rellena W().town (center, hall, staff, slots) como en la v1. Devuelve true si existe.
 */
export function setupGuildTown(player) {
  const w = W();
  if (w.town?.built) return true;
  if (player.dimension.id !== 'minecraft:overworld') return false;
  const cx = Math.floor(player.location.x);
  const cz = Math.floor(player.location.z);
  const hall = buildGuildHall(player.dimension, cx, cz + 16);
  if (!hall) return false;
  const staff = {};
  for (const [role, spec] of Object.entries(STAFF_SPEC)) staff[role] = makeIdentity({ role, ...spec });
  w.town = { built: true, center: { x: cx, y: hall.origin.y, z: cz }, hall, staff, slots: 0 };
  wDirty();
  for (const role of Object.keys(staff)) if (role !== 'sombra') spawnNpc(player.dimension, hall.staff[role], staff[role]);
  try { world.sendMessage('§6✦ La sede del Gremio de Aventureros se alza junto a vosotros. §7A su alrededor empieza a crecer una villa.'); } catch {}
  return true;
}

/** Construye (o reanuda) la villa inicial junto al primer jugador que nace. */
export function ensureTown(player) {
  try {
    return ensureStarterVillage(player);
  } catch (e) {
    console.warn('[Aetheria] ensureTown: ' + e);
    return setupGuildTown(player);
  }
}

/** Devuelve el centro (x, z) para una nueva casa familiar (parcelas dentro de la villa inicial). */
export function nextHouseSpot() {
  return settlementHouseSpot();
}

/** Mantiene al personal del Gremio (cada 10 s). */
export function townTick() {
  const t = W().town;
  if (!t?.built) return;
  const dim = world.getDimension('overworld');
  const near = world.getAllPlayers().some((p) => p.dimension.id === 'minecraft:overworld' && dist2D(p.location, t.hall.center) < 48);
  if (!near) return;
  const time = world.getTimeOfDay();
  const night = time >= 13000 && time <= 23000;
  for (const [role, ident] of Object.entries(t.staff)) {
    let found = [];
    try { found = dim.getEntities({ type: NPC_TYPE, tags: ['rpg_fid_' + ident.id] }); } catch {}
    if (role === 'sombra') {
      if (!night) {
        for (const e of found) try { e.remove(); } catch {}
        continue;
      }
    }
    if (found.length > 1) for (const e of found.slice(1)) try { e.remove(); } catch {}
    if (found.length) {
      missing.delete(role);
      continue;
    }
    const n = (missing.get(role) ?? 0) + 1;
    missing.set(role, n);
    if (n < 2) continue;
    missing.delete(role);
    const pos = role === 'sombra' ? t.hall.sombra : t.hall.staff[role];
    spawnNpc(dim, pos, ident);
  }
}
