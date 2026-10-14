// Prueba de regresión del núcleo (v1) sobre el mock de la API. Ejecutar: tools/sim/run.sh
import { world, system, advance, log, ItemStack } from '@minecraft/server';
import { ui } from '@minecraft/server-ui';

const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { const s = a.join(' '); if (!s.includes('Cargado')) errs.push(s); origWarn('WARN', ...a); };
const q = (...items) => { ui.queue.length = 0; ui.queue.push(...items); };
const npcByRole = (dim, role) => dim.getEntities({ type: 'rpg:npc' }).find((e) => { try { return JSON.parse(e.getDynamicProperty('rpg:npc')).role === role; } catch { return false; } });
const check = (name, cond) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`); if (!cond) process.exitCode = 1; };

await import('./scripts/main.js');
const store = await import('./scripts/core/store.js');
world.afterEvents.worldLoad.fire({});

const p = world.addPlayer('Steve');
q(1); // Niña
world.afterEvents.playerSpawn.fire({ player: p, initialSpawn: true });
await advance(900);
let d = store.getP(p);
check('nacimiento', !!d);
console.log('  raza', d?.race, 'elemento', d?.element, 'familia', d?.family?.members.map((m) => m.role + ':' + m.name).join(','));
const ow = world.getDimension('overworld');
check('NPCs creados', ow.getEntities({ type: 'rpg:npc' }).length >= 4);

// Chat con la madre
const mother = npcByRole(ow, 'madre');
check('madre existe', !!mother);
q('Hablar', 'hola mamá, ¿cómo estás?', 'te quiero', 'mi comida favorita es la pizza', 'eres tonta', 'perdón', 'adiós');
const ev = { player: p, target: mother, cancel: false };
world.beforeEvents.playerInteractWithEntity.fire(ev);
await advance(40);
check('interacción cancelada (menú propio)', ev.cancel);
console.log(p._msgs.filter((m) => m.includes('[') && !m.includes('§a+')).slice(-6).join('\n'));

// Regalo y paga
p._inv.setItem(0, new ItemStack('minecraft:poppy', 3));
q('Regalar', undefined);
world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: mother, cancel: false });
await advance(20);
check('regalo consumido', p._inv.getItem(0)?.amount === 2);

// Diario: aprender habilidad
d.sp = 10; d.level = 12; d.magicXp = 1000;
q('Magia y habilidades', 'Árbol de', 0, 0, 'Aprender');
world.afterEvents.itemUse.fire({ source: p, itemStack: new ItemStack('rpg:journal') });
await advance(40);
check('habilidad aprendida', d.learned.length >= 2);

// Todos los hechizos
const magic = await import('./scripts/systems/magic.js');
const { ELEMENT_IDS, getSkill } = await import('./scripts/data/elements.js');
let castErr = 0;
const el0 = d.element;
for (const el of ELEMENT_IDS) {
  d.element = el;
  for (let i = 0; i < 50; i++) {
    const s = { ...getSkill(el, i), key: 'test' + el + i, el };
    d.mana = 9999;
    const t = ow.spawnEntity('rpg:orc', { x: p.location.x + 0.2, y: p.location.y, z: p.location.z + 4 });
    t._hp = { cur: 500, max: 500 };
    try { magic.castSkill(p, d, s); } catch (e) { castErr++; console.log('cast error', el, i, e); }
    await advance(3);
    if (t.isValid) t.remove();
  }
}
await advance(200);
check('600 hechizos sin errores', castErr === 0);
d.element = el0;

// Adulto + gremio
d.ageTicks = 40 * 24000;
await advance(60);
const recep = npcByRole(ow, 'recepcionista');
d.gold = 500;
q('Gremio de Aventureros', 'Inscribirme');
world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: recep, cancel: false });
await advance(40);
check('inscrito en el gremio', !!d.guild?.member);

// Mazmorra y jefe
system.afterEvents.scriptEventReceive.fire({ id: 'rpg:dungeon', message: '3', sourceEntity: p });
const dg = store.W().dungeons.at(-1);
p.teleport({ x: dg.room.x, y: dg.room.y + 0.5, z: dg.room.z });
for (let w = 0; w < 6 && dg.state !== 'cleared'; w++) {
  await advance(100);
  for (const m of ow.getEntities({ tags: ['rpg_dng_' + dg.id] })) m.applyDamage(99999, { cause: 'magic', damagingEntity: p });
  await advance(100);
}
check('mazmorra completada', dg.state === 'cleared');
p.teleport({ x: 0.5, y: 65, z: 0.5 });

// Día nuevo
world._abs += 24000;
await advance(120);
check('misiones diarias', (d.quests?.daily?.length ?? 0) > 0);

// Guardado
store.flush();
check('guardado', (p.getDynamicProperty('rpg:pd_0')?.length ?? 0) > 100);

console.log('WARNINGS:', errs.length, errs.slice(0, 10));
console.log('TIMER/JOB ERRORS:', log.errors.length);
if (errs.length || log.errors.length) process.exitCode = 1;
process.exit();
