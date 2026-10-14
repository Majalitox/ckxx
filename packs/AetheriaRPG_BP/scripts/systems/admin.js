// Comandos de administración mediante /scriptevent (requieren permisos de operador).
//   /scriptevent rpg:menu                 → abre el Diario
//   /scriptevent rpg:reset                → renacer
//   /scriptevent rpg:xp 500               → dar XP
//   /scriptevent rpg:gold 100             → dar oro
//   /scriptevent rpg:karma -300           → sumar karma
//   /scriptevent rpg:adult                → crecer hasta adulto
//   /scriptevent rpg:age 5                → sumar días de edad
//   /scriptevent rpg:race enano           → cambiar raza
//   /scriptevent rpg:element fuego        → cambiar elemento
//   /scriptevent rpg:guild 4              → fijar rango del gremio (0=F … 8=SSS)
//   /scriptevent rpg:magic 3              → fijar rango mágico
//   /scriptevent rpg:dungeon 2            → crear mazmorra de rango C cerca
//   /scriptevent rpg:boss rpg:lich        → invocar jefe
//   /scriptevent rpg:set daysToAdult 8    → cambiar un ajuste
//   /scriptevent rpg:letter               → forzar cartas de NPCs
import { getP, dirty } from '../core/store.js';
import { cfg, setCfg, DEFAULTS } from '../core/config.js';
import { addXp, addGold, addKarma, msg, checkGuildRank } from '../core/progression.js';
import { RACES } from '../data/races.js';
import { ELEMENTS } from '../data/elements.js';
import { MAGIC_XP, GUILD_POINTS } from '../data/ranks.js';
import { openJournal } from './menu.js';
import { rebirth } from './birth.js';
import { tryGenerate } from './dungeons.js';
import { summonBoss } from './bosses.js';
import { letterTick } from './npc.js';
import { resetCaches } from './passives.js';

export function onScriptEvent(ev) {
  const id = ev.id;
  if (!id.startsWith('rpg:')) return;
  const player = ev.sourceEntity;
  if (!player || player.typeId !== 'minecraft:player') return;
  const arg = (ev.message ?? '').trim();
  const d = getP(player);
  const n = Number(arg);
  switch (id) {
    case 'rpg:menu': return openJournal(player);
    case 'rpg:reset': return rebirth(player);
    case 'rpg:letter': return letterTick();
    case 'rpg:set': {
      const [k, v] = arg.split(/\s+/);
      if (!(k in DEFAULTS)) return msg(player, `§cAjuste desconocido. Opciones: ${Object.keys(DEFAULTS).join(', ')}`);
      setCfg(k, typeof DEFAULTS[k] === 'boolean' ? v === 'true' || v === '1' : Number(v));
      return msg(player, `§a${k} = ${cfg(k)}`);
    }
    case 'rpg:dungeon': return tryGenerate(player, true, Math.max(0, Math.min(8, n || 0)));
    case 'rpg:boss': return summonBoss(player, arg.includes(':') ? arg : 'rpg:' + arg);
  }
  if (!d) return msg(player, '§cAún no has nacido.');
  switch (id) {
    case 'rpg:xp': addXp(player, n || 100, 'other'); break;
    case 'rpg:gold': addGold(player, n || 100); break;
    case 'rpg:karma': addKarma(player, n || 0, 'administrador'); break;
    case 'rpg:adult': d.ageTicks = cfg('daysToAdult') * 24000; break;
    case 'rpg:age': d.ageTicks += (n || 1) * 24000; break;
    case 'rpg:race': if (RACES[arg]) { d.race = arg; resetCaches(player); } else msg(player, `§cRazas: ${Object.keys(RACES).join(', ')}`); break;
    case 'rpg:element': if (ELEMENTS[arg]) { d.element = arg; d.learned = [0]; d.slots = ['r', 'p:0']; } else msg(player, `§cElementos: ${Object.keys(ELEMENTS).join(', ')}`); break;
    case 'rpg:guild': d.guild = { ...(d.guild ?? {}), member: true, rank: Math.max(0, Math.min(8, n || 0)), points: GUILD_POINTS[Math.max(0, Math.min(8, n || 0))] }; checkGuildRank(player); break;
    case 'rpg:magic': d.magicXp = MAGIC_XP[Math.max(0, Math.min(8, n || 0))]; break;
    default: return msg(player, '§cComando rpg desconocido.');
  }
  dirty(player);
  msg(player, '§a✔ Hecho.');
}
