// Sistema de escalada: mantén SALTAR contra una pared para trepar; AGACHARTE en la pared te sujeta.
import { world } from '@minecraft/server';
import { getP } from '../core/store.js';
import { cfg } from '../core/config.js';
import { stat } from '../core/profile.js';
import { actionbar } from '../core/progression.js';
import { knockback, effect, getBlock, isSolid } from '../util/compat.js';
import { bar } from '../util/text.js';

const stamina = new Map();
const climbingNow = new Set();

export function maxStamina(d) {
  return Math.round((50 + stat(d, 'agi') * 2) * (d.race === 'bestia' ? 1.6 : 1));
}

export function isClimbing(player) {
  return climbingNow.has(player.id);
}

function wallAhead(player) {
  const dir = player.getViewDirection();
  const l = Math.hypot(dir.x, dir.z);
  if (l < 0.25) return false;
  const fx = dir.x / l;
  const fz = dir.z / l;
  const loc = player.location;
  const dim = player.dimension;
  for (const h of [0.3, 1.2]) {
    const b = getBlock(dim, { x: Math.floor(loc.x + fx * 0.7), y: Math.floor(loc.y + h), z: Math.floor(loc.z + fz * 0.7) });
    if (isSolid(b)) return true;
  }
  return false;
}

export function climbTick() {
  if (!cfg('climbing')) return;
  for (const player of world.getAllPlayers()) {
    const d = getP(player);
    if (!d) continue;
    const max = maxStamina(d);
    let st = stamina.get(player.id) ?? max;
    let onGround = true;
    try { onGround = player.isOnGround; } catch {}
    if (onGround) {
      if (climbingNow.delete(player.id)) actionbar(player, '');
      stamina.set(player.id, Math.min(max, st + 3));
      continue;
    }
    let jumping = false;
    let flying = false;
    try { jumping = player.isJumping; flying = player.isFlying || player.isGliding || player.isSwimming || player.isInWater; } catch {}
    if (flying) continue;
    const sneaking = player.isSneaking;
    if ((!jumping && !sneaking) || !wallAhead(player)) {
      if (climbingNow.delete(player.id)) stamina.set(player.id, st);
      continue;
    }
    if (st <= 0) {
      actionbar(player, '§c¡Sin aguante! ' + bar(0, max, 20, '§e', '§8'));
      continue;
    }
    climbingNow.add(player.id);
    const speed = (d.race === 'bestia' ? 0.42 : d.race === 'enano' ? 0.3 : 0.34) + Math.min(0.08, (stat(d, 'agi') - 5) * 0.002);
    if (jumping) {
      knockback(player, 0, 0, 0, speed);
      st -= d.race === 'bestia' ? 0.8 : 1.2;
    } else {
      // Sujetarse a la pared
      effect(player, 'slow_falling', 6, 0, false);
      knockback(player, 0, 0, 0, 0.04);
      st -= 0.4;
    }
    stamina.set(player.id, st);
    actionbar(player, `§eEscalando ${bar(st, max, 20, '§e', '§8')}`);
  }
}
