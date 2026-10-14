// Pueblo inicial: sede del Gremio con su personal, y reparto de parcelas para las casas familiares.
import { world } from '@minecraft/server';
import { W, wDirty } from '../core/store.js';
import { buildGuildHall } from './build.js';
import { makeIdentity, spawnNpc, NPC_TYPE } from './npc.js';
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

/** Construye el pueblo junto al primer jugador que nace. */
export function ensureTown(player) {
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
  try { world.sendMessage('§6✦ El pueblo de los aventureros se alza junto a vosotros. §7La sede del Gremio está al sur del punto de inicio.'); } catch {}
  return true;
}

const SLOTS = [[-24, -4], [22, -4], [-6, -26], [-30, -26], [18, -26], [-32, 20], [26, 20], [-50, 0], [46, 0], [-6, -48]];

/** Devuelve el centro (x, z) para una nueva casa familiar. */
export function nextHouseSpot() {
  const w = W();
  const t = w.town;
  const i = (t.slots = (t.slots ?? 0) + 1) - 1;
  wDirty();
  if (i < SLOTS.length) return { x: t.center.x + SLOTS[i][0], z: t.center.z + SLOTS[i][1] };
  const ring = Math.floor((i - SLOTS.length) / 10);
  const a = ((i - SLOTS.length) % 10) * ((Math.PI * 2) / 10) + ring * 0.3;
  const r = 70 + ring * 18;
  return { x: Math.round(t.center.x + Math.cos(a) * r), z: Math.round(t.center.z + Math.sin(a) * r) };
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
