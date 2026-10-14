// Pruebas del área de justicia (crimen, sigilo, búsqueda, arresto, cepo, cárcel, llave, fuga).
// Ejecutar: tools/sim/run.sh test_justice.mjs
// Usa un stub de systems/settlements.js (API del contrato §6.1 sobre W().settlements / W().realms) en la copia
// aislada de los scripts, salvo que se ejecute con REAL_SETTLEMENTS=1 y exista el módulo real.
import fs from 'node:fs';
import { world, system, advance, log, ItemStack } from '@minecraft/server';

const STUB = `// Stub de pruebas (contrato §6.1)
import { W } from '../core/store.js';
const list = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
export const hooks = {};
export function allSettlements() { return list(W().settlements); }
export function allRealms() { return list(W().realms); }
export function getSettlement(id) { return allSettlements().find((s) => s.id === id); }
export function realmOf(s) { if (typeof s === 'string') s = getSettlement(s); return s ? allRealms().find((r) => r.id === s.realmId) : undefined; }
export function settlementAt(dimId, loc) { return allSettlements().find((s) => (s.dim ?? 'minecraft:overworld') === dimId && Math.hypot(loc.x - s.center.x, loc.z - s.center.z) <= s.radius); }
export function nearestSettlement(dimId, loc, maxDist = Infinity) {
  let best; let bd = Infinity;
  for (const s of allSettlements()) { if ((s.dim ?? 'minecraft:overworld') !== dimId) continue; const d = Math.hypot(loc.x - s.center.x, loc.z - s.center.z); if (d < bd && d <= maxDist) { bd = d; best = s; } }
  return best;
}
`;
const target = './scripts/systems/settlements.js';
if (!(process.env.REAL_SETTLEMENTS === '1' && fs.existsSync(target))) fs.writeFileSync(target, STUB);

const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { errs.push(a.join(' ')); origWarn('WARN', ...a); };
let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) { fails++; process.exitCode = 1; } };

const store = await import('./scripts/core/store.js');
const crime = await import('./scripts/systems/crime.js');
const justice = await import('./scripts/systems/justice.js');
const { CRIMES } = await import('./scripts/data/laws.js');
const { EYE, STAR_ON, STAR_OFF } = crime;

// --- Conexiones (lo que hará main.js) ---
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => justice.onBeforeInteractEntity(ev));
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => justice.onBeforeInteractBlock(ev));
world.beforeEvents.itemUse.subscribe((ev) => justice.onBeforeItemUse(ev));
world.beforeEvents.entityHurt.subscribe((ev) => justice.onBeforeEntityHurt(ev));
world.afterEvents.entityHurt.subscribe((ev) => justice.onEntityHurt(ev));
world.afterEvents.entityDie.subscribe((ev) => justice.onEntityDie(ev));
world.afterEvents.projectileHitEntity.subscribe((ev) => justice.onProjectileHit(ev));
world.afterEvents.projectileHitBlock.subscribe((ev) => justice.onProjectileHit(ev));
world.afterEvents.itemUse.subscribe((ev) => justice.onItemUse(ev.source, ev.itemStack));
system.runInterval(() => justice.fastTick(), 2);
system.runInterval(() => justice.secondTick(), 20);
const punished = [];
const crimesSeen = [];
justice.hooks.onPunished = (p, kind, crimes) => punished.push([kind, crimes]);
justice.hooks.onCrime = (p, type, info) => crimesSeen.push([type, info.witnessed]);

// --- Mundo de prueba ---
const ow = world.getDimension('overworld');
const W = store.W();
const s1 = {
  id: 's1', kind: 'pueblo', culture: 'humano', name: 'Villarroble', realmId: 'r1', dim: 'minecraft:overworld',
  center: { x: 0, y: 65, z: 0 }, radius: 60, plaza: { x: 0, y: 65, z: 0 }, stocks: { x: 3, y: 65, z: 3 },
  jail: {
    cells: [{ min: { x: 30, y: 65, z: 30 }, max: { x: 32, y: 67, z: 32 }, spawn: { x: 31, y: 65, z: 31 }, door: [{ x: 31, y: 65, z: 33 }, { x: 31, y: 66, z: 33 }], doorBlock: 'minecraft:iron_bars' }],
    exit: { x: 31, y: 65, z: 37 }, patrol: { x: 31, y: 65, z: 35 },
  },
  houses: [{ id: 'h1', cls: 'media', door: { x: -10, y: 65, z: -13 }, min: { x: -16, y: 65, z: -16 }, max: { x: -10, y: 68, z: -10 }, owner: 'nOWNER' }],
  chests: [{ x: -13, y: 65, z: -13, cls: 'media', house: 'h1' }],
  shops: [], residents: [], guards: [], rulerId: null, built: true, createdDay: 0,
};
const r1 = { id: 'r1', name: 'Reino de Valdoria', culture: 'humano', ruler: { name: 'Aldric', title: 'Rey' }, capitalId: 's1', government: 'monarquía', strictness: 1, attitudes: {}, economy: { focus: 'comercio', prosperity: 1 }, colors: { primary: '#aa3333', secondary: '#ffcc00' } };
W.settlements = [s1];
W.realms = [r1];
for (const p of s1.jail.cells[0].door) ow.setBlockType(p, 'minecraft:iron_bars');

const p = world.addPlayer('Lia');
const d = { id: p.id, name: 'Lia', gender: 'f', race: 'humano', level: 5, xp: 0, gold: 0, karma: 0, ageTicks: 60 * 24000, stats: {}, mana: 50 };
store.setP(p, d);
world.afterEvents.worldLoad.fire({});

let npcN = 0;
function npc(name, loc, opts = {}) {
  const e = ow.spawnEntity(`rpg:npc<rpg:spawn_${opts.guard ? 'guard' : 'citizen'}>`, loc);
  const ident = { id: 'n' + ++npcN, name, surname: 'Test', gender: opts.gender ?? 'm', race: 'humano', role: opts.job ?? 'aldeano', job: opts.job ?? (opts.guard ? 'guardia' : 'aldeano'), pers: 'amable', age: 'adult', cls: opts.cls ?? 'media', wallet: opts.wallet ?? 30, settlement: 's1', realm: 'r1', owner: opts.owner };
  e.setDynamicProperty('rpg:npc', JSON.stringify(ident));
  e.nameTag = `§e${name}`;
  if (opts.view) e._view = opts.view;
  return e;
}
const ident = (e) => JSON.parse(e.getDynamicProperty('rpg:npc'));
const games = crime._t.games;
const at = (x, y, z) => ({ x, y, z });
const lastEvent = (e) => e._events[e._events.length - 1];

/** Espera a que la aguja esté (in=true) dentro o (in=false) lejos de la zona y suelta agacharse. */
async function playMinigame(want) {
  for (let i = 0; i < 400; i++) {
    const g = games.get(p.id);
    if (g && g.t > 9) {
      const cells = [Math.round(g.pos), Math.round(g.p1 ?? g.pos), Math.round(g.p2 ?? g.pos)];
      const inZone = (c) => c >= g.zA && c <= g.zB;
      const far = cells.every((c) => c < g.zA - 2 || c > g.zB + 2);
      if ((want && inZone(Math.round(g.pos))) || (!want && far)) { p.isSneaking = false; await advance(2); return true; }
    }
    await advance(1);
  }
  return false;
}
async function advanceSec(n) { await advance(n * 20); }

/* ------------------------------------------------------------------ */
console.log('--- 1. Detección y ojo ---');
p.isSneaking = true;
crime.refreshEye(p);
check('ojo cerrado: nadie cerca', crime.eyeLevel(p) === 0 && justice.hudStatus(p).includes(EYE.CLOSED), JSON.stringify(justice.hudStatus(p)));
const A = npc('Ana', at(0.5, 65, 8.5));
A.lookAt(p.getHeadLocation());
check('ojo entreabierto: alguien te mira', crime.refreshEye(p) === 2 && justice.hudStatus(p).includes(EYE.HALF));
A._view = { x: 0, y: 0, z: 1 };
check('ojo entreabierto: alguien cerca de espaldas', crime.refreshEye(p) === 1);
A.lookAt(p.getHeadLocation());
for (let x = -2; x <= 2; x++) for (let y = 65; y <= 67; y++) ow.setBlockType(at(x, y, 5), 'minecraft:stone');
check('un muro tapa la vista: ojo cerrado', crime.refreshEye(p) === 0);
for (let x = -2; x <= 2; x++) for (let y = 65; y <= 67; y++) ow.setBlockType(at(x, y, 5), 'minecraft:air');
for (let y = 65; y <= 67; y++) ow.setBlockType(at(0, y, 5), 'minecraft:glass');
check('a través del cristal sí te ven', crime.refreshEye(p) === 2);
for (let y = 65; y <= 67; y++) ow.setBlockType(at(0, y, 5), 'minecraft:air');
world._time = 15000;
check('de noche y agachado, a 8 bloques no te ven', crime.refreshEye(p) === 0);
A.teleport(at(0.5, 65, 6.5)); A.lookAt(p.getHeadLocation());
check('de noche a 6 bloques: entreabierto', crime.refreshEye(p) === 1);
world._time = 1000;
A.setProperty('rpg:mood', 3);
check('un NPC dormido no ve', crime.refreshEye(p) === 0);
A.remove();
p.isSneaking = false;
crime.refreshEye(p);
check('HUD vacío sin agacharse ni búsqueda', justice.hudStatus(p) === '');

/* ------------------------------------------------------------------ */
console.log('--- 2. Robo de bolsillo con éxito ---');
const V1 = npc('Marta', at(0.5, 65, 2.5), { cls: 'media', job: 'granjero', wallet: 40, gender: 'f' });
p.isSneaking = true;
let ev = { player: p, target: V1, cancel: false };
world.beforeEvents.playerInteractWithEntity.fire(ev);
check('interactuar agachado = robo (evento cancelado)', ev.cancel);
await advance(2);
check('minijuego iniciado', games.has(p.id) && games.get(p.id).spec.kind === 'pocket', games.get(p.id)?.spec.label);
check('barra en la barra de acción', p._ab.includes('[') && p._ab.includes('§a|'));
check('robo exitoso jugado', await playMinigame(true));
check('oro robado', d.gold > 0, `oro=${d.gold}`);
check('bolsa de la víctima reducida y guardada', ident(V1).wallet === 40 - d.gold, `wallet=${ident(V1).wallet}`);
check('robada hoy', V1.getDynamicProperty('rpg:robbed_day') === world.getDay());
check('habilidad de sigilo', d.thief?.steals === 1 && d.thief.xp > 0);
check('sin testigos: no te buscan', !d.wanted && !p.hasTag('rpg_wanted'));
check('partículas de monedas', (log.particleIds['rpg:coins'] ?? 0) > 0);
p.isSneaking = true;
world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: V1, cancel: false });
await advance(2);
check('no se puede robar dos veces el mismo día', !games.has(p.id));
p.isSneaking = false;

/* ------------------------------------------------------------------ */
console.log('--- 3. Robo fallido → testigo → estrella ---');
const G1 = npc('Rodrigo', at(45.5, 65, -45.5), { guard: true, job: 'guardia' });
const V2 = npc('Tomás', at(0.5, 65, -2.5), { cls: 'baja', job: 'aldeano', wallet: 10, view: { x: 0, y: 0, z: 1 } });
const gold0 = d.gold;
p.isSneaking = true;
world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: V2, cancel: false });
await advance(2);
check('minijuego contra una víctima que te mira', games.has(p.id) && games.get(p.id).spec.label.includes('te mira'));
check('fallo jugado', await playMinigame(false));
check('no robas nada', d.gold === gold0);
const al = crime._t.alarms.get(V2.id);
check('la víctima da la alarma', !!al && al.type === 'hurto');
check('signo (!) sobre la víctima', V2.getProperty('rpg:alert') === true && V2.nameTag.startsWith('§c§l(!)'));
check('corre hacia el guardia (rpg:act_alarm + rpg_busy)', V2._events.includes('rpg:act_alarm') && V2.hasTag('rpg_busy'));
check('ojo abierto en el HUD', justice.hudStatus(p).includes(EYE.OPEN), JSON.stringify(justice.hudStatus(p)));
check('grito de alarma en el chat', p._msgs.some((m) => m.includes('[Tomás]')));
await advanceSec(3);
check('aún sin estrellas mientras corre', !d.wanted);
V2.teleport(at(44.5, 65, -44.5));
await advance(12);
check('denuncia: 1 estrella', d.wanted?.stars === 1 && p.hasTag('rpg_wanted'), JSON.stringify(d.wanted));
check('testigo vuelve a la normalidad', V2.getProperty('rpg:alert') === false && !V2.hasTag('rpg_busy') && lastEvent(V2) === 'rpg:act_idle' && V2.nameTag === '§eTomás');
check('el guardia sale a cazarte', G1._events.includes('rpg:act_hunt') && G1.hasTag('rpg_busy'));
const hud3 = justice.hudStatus(p);
check('HUD: 1 estrella llena y 4 vacías', hud3.split(STAR_ON).length - 1 === 1 && hud3.split(STAR_OFF).length - 1 === 4, JSON.stringify(hud3));
check('título SE BUSCA', (p._title ?? '').includes('SE BUSCA'));

/* ------------------------------------------------------------------ */
console.log('--- 4. Arresto por un guardia ---');
const J1 = npc('Pepa', at(8.5, 65, 8.5), { gender: 'f' });
const J2 = npc('Lucas', at(-6.5, 65, 6.5));
const MOM = npc('Mamá', at(-3.5, 65, 9.5), { owner: p.id, job: 'madre', gender: 'f' });
G1.teleport(at(0.5, 65, -1.5));
const hp0 = p._hp.cur;
const karma0 = d.karma;
p.applyDamage(4, { cause: 'entityAttack', damagingEntity: G1 });
check('el golpe del guardia no hace daño', p._hp.cur === hp0);
await advance(2);
check('detenida: escolta al cepo', d.justice?.state === 'escort' && d.justice.kind === 'stocks', JSON.stringify(d.justice));
check('etiquetas de arresto y manos atadas', p.hasTag('rpg_arrested') && p.hasTag('rpg_tied') && !p.hasTag('rpg_wanted'));
check('movimiento desactivado', p.inputPermissions._perms[2] === false);
check('guardia en modo escolta', G1._events.includes('rpg:act_escort_stocks') && G1.hasTag('rpg_escort'));
check('isRestricted', justice.isRestricted(p));
ev = { source: p, itemStack: new ItemStack('minecraft:bread'), cancel: false };
world.beforeEvents.itemUse.fire(ev);
check('no puede usar objetos', ev.cancel);
ev = { player: p, target: J1, cancel: false };
world.beforeEvents.playerInteractWithEntity.fire(ev);
check('no puede interactuar con NPCs', ev.cancel);
ev = { hurtEntity: J1, damage: 3, damageSource: { cause: 'entityAttack', damagingEntity: p }, cancel: false };
world.beforeEvents.entityHurt.fire(ev);
check('no puede atacar', ev.cancel);

/* ------------------------------------------------------------------ */
console.log('--- 5. Escolta con cuerda ---');
G1.teleport(at(3.5, 65, 16.5));
const rope0 = log.particleIds['rpg:rope'] ?? 0;
let maxGap = 0;
for (let z = 16.5; z > 6; z -= 0.25) {
  G1.teleport(at(3.5, 65, z));
  G1._view = { x: 0, y: 0, z: -1 };
  await advance(2);
  if (d.justice?.state !== 'escort') break;
  maxGap = Math.max(maxGap, Math.hypot(p.location.x - G1.location.x, p.location.z - G1.location.z));
}
check('la cuerda mantiene al jugador detrás del guardia', maxGap < 2.6 && maxGap > 1, `máx=${maxGap.toFixed(2)}`);
check('partículas de cuerda', (log.particleIds['rpg:rope'] ?? 0) > rope0 + 50);
for (let z = 6; z > 2 && d.justice?.state === 'escort'; z -= 0.5) { G1.teleport(at(3.5, 65, z)); await advance(2); }
await advance(2);
check('llegada a la plaza: castigo público', d.justice?.state === 'humiliation' && p.hasTag('rpg_humiliated'), d.justice?.state);

/* ------------------------------------------------------------------ */
console.log('--- 6. Castigo público (60 s) ---');
const h = justice._t.humil.get(p.id);
check('vecinos reclutados para abuchear', J1._events.includes('rpg:act_jeer') && J1.hasTag('rpg_jeer') && J2.hasTag('rpg_jeer'));
check('la familia no tira tomates', !MOM.hasTag('rpg_jeer') && p._msgs.some((m) => m.includes('aparta la mirada')));
check('pregón en la plaza', log.messages.some((m) => m.includes('[Pregón]')));
check('paseo de la vergüenza preparado', h && h.path.length >= 6 && !h.atStocks && G1._events.includes('rpg:act_sleep'));
const g0 = { ...G1.location };
await advanceSec(5);
check('el guardia pasea al jugador por la plaza', Math.hypot(G1.location.x - g0.x, G1.location.z - g0.z) > 1 && Math.hypot(p.location.x - G1.location.x, p.location.z - G1.location.z) < 2.6);
const tomato = ow.spawnEntity('rpg:tomato', at(5, 66, 5));
world.afterEvents.projectileHitEntity.fire({ projectile: tomato, location: p.getHeadLocation(), dimension: ow, source: J1, hitVector: at(0, 0, 1), getEntityHit: () => ({ entity: p }) });
check('tomatazo contado y salpicadura', d.justice.tomatoes >= 1 && (log.particleIds['rpg:tomato_splash'] ?? 0) >= 1);
ev = { hurtEntity: p, damage: 1, damageSource: { cause: 'projectile', damagingEntity: J1, damagingProjectile: tomato }, cancel: false };
world.beforeEvents.entityHurt.fire(ev);
check('los tomates no hacen daño', ev.cancel);
await advanceSec(22);
check('tras el paseo, atado al cepo', h.atStocks && Math.hypot(p.location.x - 3.5, p.location.z - 3.5) < 0.8, JSON.stringify(p.location));
p.teleport(at(10, 65, 10));
await advance(4);
check('no puede alejarse del cepo', Math.hypot(p.location.x - 3.5, p.location.z - 3.5) < 0.8);
await advanceSec(20);
check('a los ~50 s sigue en el cepo', d.justice?.state === 'humiliation' && p.hasTag('rpg_humiliated'), `quedan ${d.justice?.left}`);
check('HUD: cuenta atrás del castigo', justice.hudStatus(p).includes('Castigo público'));
check('abucheos con nombre en el chat', p._msgs.some((m) => m.includes('[Pepa]') || m.includes('[Lucas]')));
const leftAt50 = d.justice.left;
await advanceSec(leftAt50 - 1);
check('justo antes del minuto sigue castigada', d.justice?.state === 'humiliation');
await advanceSec(2);
check('liberada a los 60 s', !d.justice && !p.hasTag('rpg_humiliated') && !p.hasTag('rpg_tied') && !p.hasTag('rpg_arrested'), JSON.stringify(d.justice));
check('movimiento restaurado', p.inputPermissions._perms[2] === true);
check('estrellas borradas', !d.wanted && !p.hasTag('rpg_wanted'));
check('karma -5', d.karma === karma0 - 5, `${karma0} → ${d.karma}`);
check('hook onPunished(humiliation)', punished.some(([k, c]) => k === 'humiliation' && c.includes('hurto')));
check('vecinos vuelven a su vida', lastEvent(J1) === 'rpg:act_idle' && !J1.hasTag('rpg_busy') && !J1.hasTag('rpg_jeer'));
check('guardia libre', lastEvent(G1) === 'rpg:act_idle' && !G1.hasTag('rpg_escort'));

/* ------------------------------------------------------------------ */
console.log('--- 7. Agresión a la guardia → prisión 15 min ---');
G1.applyDamage(2, { cause: 'entityAttack', damagingEntity: p });
check('agresión a la guardia: 2 estrellas inmediatas', d.wanted?.stars === 2 && d.wanted.crimes.includes('agresion_guardia'), JSON.stringify(d.wanted));
p.applyDamage(3, { cause: 'entityAttack', damagingEntity: G1 });
await advance(2);
check('escolta a prisión', d.justice?.state === 'escort' && d.justice.kind === 'jail' && d.justice.total === 15 * 60);
check('guardia en modo escolta a prisión', G1._events.includes('rpg:act_escort_jail'));
G1.teleport(at(31.5, 65, 38.5));
await advance(4);
check('entra en la celda', d.justice?.state === 'jail' && p.hasTag('rpg_jailed') && !p.hasTag('rpg_tied'), d.justice?.state);
check('dentro de la celda', Math.abs(p.location.x - 31.5) < 0.1 && Math.abs(p.location.z - 31.5) < 0.1);
check('puede moverse en la celda', p.inputPermissions._perms[2] === true && !justice.isRestricted(p));
const left0 = d.justice.left;
await advanceSec(3);
check('la condena descuenta tiempo en línea', d.justice.left <= left0 - 2 && d.justice.left >= left0 - 4, `${left0} → ${d.justice.left}`);
check('HUD de prisión', justice.hudStatus(p).includes('Prisión'));
p.teleport(at(40, 65, 40));
await advance(12);
check('no se puede salir de la celda', Math.abs(p.location.x - 31.5) < 0.1 && Math.abs(p.location.z - 31.5) < 0.1);
ev = { player: p, block: ow.getBlock(at(31, 65, 33)), itemStack: undefined, isFirstEvent: true, cancel: false };
world.beforeEvents.playerInteractWithBlock.fire(ev);
check('los barrotes no se abren sin llave', ev.cancel);

/* ------------------------------------------------------------------ */
console.log('--- 8. Ronda del carcelero, llave y fuga ---');
const pt = justice._t.patrols.get('s1');
check('rondas programadas', !!pt && pt.next >= 1);
pt.next = 1;
await advanceSec(2);
check('el carcelero hace su ronda', pt.left > 0 && pt.jailer?.id === G1.id && G1._events.includes('rpg:act_patrol_jail'));
check('aviso de la ronda', p._msgs.some((m) => m.includes('carcelero')));
G1.teleport(at(31.5, 65, 34.5));
p.teleport(at(31.5, 65, 32.8));
p.isSneaking = true;
await advance(12);
check('agachado junto a los barrotes: minijuego de la llave', games.get(p.id)?.spec.kind === 'key');
check('llave robada', (await playMinigame(true)) && p._inv.slots.some((s) => s?.typeId === 'rpg:jail_key'));
G1.teleport(at(31.5, 65, 80)); // el carcelero se aleja
await advanceSec(1);
const key = p._inv.slots.find((s) => s?.typeId === 'rpg:jail_key');
world.afterEvents.itemUse.fire({ source: p, itemStack: key });
check('la puerta se abre', ow.getBlock(at(31, 65, 33)).typeId === 'minecraft:air' && ow.getBlock(at(31, 66, 33)).typeId === 'minecraft:air');
check('estado de fuga', d.justice?.state === 'escaped' && !p.hasTag('rpg_jailed') && !p._inv.slots.some((s) => s?.typeId === 'rpg:jail_key'));
check('HUD de fuga', justice.hudStatus(p).includes('FUGA'));
p.teleport(at(31.5, 65, 40.5));
await advanceSec(9);
check('la puerta se vuelve a cerrar', ow.getBlock(at(31, 65, 33)).typeId === 'minecraft:iron_bars' && !(store.W().justiceDoors ?? []).length);
await advanceSec(12);
check('notan la fuga: +2 estrellas', d.wanted?.stars === 2 && d.wanted.crimes.includes('fuga') && !d.justice, JSON.stringify(d.wanted));
check('condena pendiente guardada', (d.wanted?.pending ?? 0) > 800, `pendiente ${d.wanted?.pending}`);

/* ------------------------------------------------------------------ */
console.log('--- 9. Manos atadas por intentar robar la llave ---');
G1.teleport(at(31.5, 65, 41.5));
p.applyDamage(3, { cause: 'entityAttack', damagingEntity: G1 });
await advance(2);
check('nueva detención con condena acumulada', d.justice?.kind === 'jail' && d.justice.total > 15 * 60 + 800, `total ${d.justice?.total}`);
G1.teleport(at(31.5, 65, 37.5));
await advance(4);
check('de vuelta en la celda', d.justice?.state === 'jail');
pt.next = 1;
justice._t.patrols.get('s1').next = 1;
await advanceSec(2);
const pt2 = justice._t.patrols.get('s1');
check('nueva ronda', pt2.left > 0 && !!pt2.jailer);
pt2.jailer.teleport(at(31.5, 65, 34.5));
pt2.jailer.lookAt(p.getHeadLocation());
p.teleport(at(31.5, 65, 32.8));
p.isSneaking = true;
await advance(12);
check('minijuego de la llave', games.get(p.id)?.spec.kind === 'key');
const leftBefore = d.justice.left;
check('intento fallido', await playMinigame(false));
check('manos atadas', d.justice.tied === true && p.hasTag('rpg_tied') && justice.isRestricted(p));
check('+60 s de condena', d.justice.left >= leftBefore + 58, `${leftBefore} → ${d.justice.left}`);
p.isSneaking = false;
check('HUD: manos atadas', justice.hudStatus(p).includes('manos atadas'));
ev = { source: p, itemStack: new ItemStack('minecraft:bread'), cancel: false };
world.beforeEvents.itemUse.fire(ev);
check('atada: no puede comer ni usar objetos', ev.cancel);
pt2.next = 1;
await advanceSec(2);
p.isSneaking = true;
if (pt2.left > 0 && pt2.jailer) pt2.jailer.teleport(at(31.5, 65, 34.5));
await advance(12);
check('atada: no puede volver a intentarlo', !games.has(p.id));
p.isSneaking = false;

/* ------------------------------------------------------------------ */
console.log('--- 10. Reconexión: la condena continúa ---');
const leftSaved = d.justice.left;
store.forgetPlayer(p); // guarda y olvida la caché (como al salir)
p.removeTag('rpg_jailed'); p.removeTag('rpg_tied');
p.teleport(at(100, 65, 100));
const d2 = store.getP(p);
check('datos persistidos', d2 && d2 !== d && d2.justice?.state === 'jail' && Math.abs(d2.justice.left - leftSaved) <= 1);
justice.onPlayerSpawn(p, true);
check('de vuelta en la celda al reconectar', Math.abs(p.location.x - 31.5) < 0.1 && p.hasTag('rpg_jailed') && p.hasTag('rpg_tied'));
check('mensaje de reanudación', p._msgs.some((m) => m.includes('Sigues en prisión')));
d2.justice.left = 3;
await advanceSec(4);
check('condena cumplida: libre en la salida', !d2.justice && !p.hasTag('rpg_jailed') && !p.hasTag('rpg_tied') && Math.abs(p.location.z - 37.5) < 0.1, JSON.stringify(p.location));
check('hook onPunished(jail)', punished.some(([k]) => k === 'jail'));
check('sin búsqueda tras cumplir', !d2.wanted && !p.hasTag('rpg_wanted'));

/* ------------------------------------------------------------------ */
console.log('--- 11. Robo en una casa (cerradura) ---');
const D = d2;
ow.setBlockType(at(-13, 65, -13), 'minecraft:chest');
p.teleport(at(-12.5, 65, -11.5));
p.isSneaking = false;
ev = { player: p, block: ow.getBlock(at(-13, 65, -13)), isFirstEvent: true, cancel: false };
world.beforeEvents.playerInteractWithBlock.fire(ev);
await advance(2);
check('cofre ajeno cerrado con llave', ev.cancel && !games.has(p.id) && p._ab.includes('cerrado'));
p._inv.addItem(new ItemStack('rpg:lockpick', 2));
p.isSneaking = true;
ev = { player: p, block: ow.getBlock(at(-13, 65, -13)), isFirstEvent: true, cancel: false };
world.beforeEvents.playerInteractWithBlock.fire(ev);
await advance(2);
check('agachado: minijuego de cerradura', ev.cancel && games.get(p.id)?.spec.kind === 'lock');
const goldH = D.gold;
check('cerradura forzada', await playMinigame(true));
check('botín del cofre', D.gold > goldH, `${goldH} → ${D.gold}`);
ev = { player: p, block: ow.getBlock(at(-13, 65, -13)), isFirstEvent: true, cancel: false };
world.beforeEvents.playerInteractWithBlock.fire(ev);
check('ya se puede abrir', !ev.cancel);
await advance(2);
check('sin testigos no hay delito', !D.wanted);
p.isSneaking = false;

/* ------------------------------------------------------------------ */
console.log('--- 12. Testigo silenciado, asesinato y guardias ---');
p.teleport(at(-40.5, 65, 30.5));
const V3 = npc('Iñigo', at(-40.5, 65, 32.5), { view: { x: 0, y: 0, z: -1 } });
p.isSneaking = true;
world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: V3, cancel: false });
await advance(2);
await playMinigame(false);
check('alarma de la víctima', crime._t.alarms.has(V3.id));
V3.applyDamage(999, { cause: 'entityAttack', damagingEntity: p });
check('testigo muerto: la alarma se apaga', !crime._t.alarms.has(V3.id));
await advanceSec(30);
check('sin testigos del asesinato: sin estrellas', !D.wanted, JSON.stringify(D.wanted));
p.isSneaking = false;
const V4 = npc('Bruno', at(-40.5, 65, 32.5));
const W5 = npc('Clara', at(-40.5, 65, 38.5), { gender: 'f' });
W5.lookAt(p.getHeadLocation());
V4.applyDamage(999, { cause: 'entityAttack', damagingEntity: p });
check('asesinato visto: alarma de asesinato', crime._t.alarms.get(W5.id)?.type === 'asesinato');
W5.teleport(at(G1.location.x + 1, 65, G1.location.z));
await advance(12);
check('asesinato denunciado: 4 estrellas', D.wanted?.stars === 4, JSON.stringify(D.wanted));
const G2 = npc('Hugo', at(-30.5, 65, 30.5), { guard: true });
G2.applyDamage(999, { cause: 'entityAttack', damagingEntity: p });
check('matar a un guardia: la guardia lo sabe (5★)', D.wanted?.stars === 5 && D.wanted.crimes.includes('asesinato_guardia'));
check('hook onCrime', crimesSeen.some(([t, w]) => t === 'asesinato' && w) && crimesSeen.some(([t]) => t === 'hurto'));

/* ------------------------------------------------------------------ */
console.log('--- 13. Las estrellas se enfrían lejos de los pueblos ---');
D.wanted = { stars: 1, crimes: ['hurto'], settlementId: 's1', realmId: 'r1', decay: 0 };
p.addTag('rpg_wanted');
p.teleport(at(600.5, 65, 600.5));
await advanceSec(60);
check('a los 60 s sigue buscada', D.wanted?.stars === 1);
await advanceSec(62);
check('a los ~120 s pierden la pista', !D.wanted && !p.hasTag('rpg_wanted'));

/* ------------------------------------------------------------------ */
console.log('--- 14. Contacto con un guardia que te persigue ---');
D.wanted = { stars: 1, crimes: ['allanamiento'], settlementId: 's1', realmId: 'r1', decay: 0 };
p.addTag('rpg_wanted');
p.teleport(at(10.5, 65, -20.5));
G1.teleport(at(11.5, 65, -20.5));
await advanceSec(2);
check('arrestada al quedarse junto al guardia', D.justice?.state === 'escort' || D.justice?.state === 'humiliation', D.justice?.state);
// sin guardia (desconexión durante la escolta): directo al destino
justice._t.escorts.delete(p.id);
justice.onPlayerSpawn(p, false);
await advance(2);
check('reanudar escolta sin guardia: castigo en la plaza', D.justice?.state === 'humiliation');
D.justice.left = 1;
await advanceSec(2);
check('castigo terminado', !D.justice && !justice.isRestricted(p));

/* ------------------------------------------------------------------ */
console.log('--- 16. Hazañas, sobornos y multas de la nobleza ---');
const { ui } = await import('@minecraft/server-ui');
const wantOne = () => { D.wanted = { stars: 1, crimes: ['hurto'], settlementId: 's1', realmId: 'r1', decay: 0 }; p.addTag('rpg_wanted'); };
const guardHit = async () => { p.teleport(at(10.5, 65, -20.5)); G1.teleport(at(11.5, 65, -20.5)); p.applyDamage(2, { cause: 'entityAttack', damagingEntity: G1 }); await advance(3); };
const finishNow = async () => { if (D.justice?.state === 'escort') { justice._t.escorts.delete(p.id); justice.onPlayerSpawn(p, false); await advance(2); } if (D.justice) { D.justice.left = 1; await advanceSec(2); } };
D.karma = 500;
wantOne();
await guardHit();
check('héroe: perdón con advertencia', !D.justice && !D.wanted && (p._title ?? '').includes('ADVERTENCIA'));
wantOne();
await guardHit();
check('el perdón solo una vez al día', D.justice?.state === 'escort');
await finishNow();
check('limpio tras el castigo', !D.justice && !justice.isRestricted(p));
D.karma = 0;
r1.strictness = 0;
D.gold = 500;
wantOne();
ui.queue.length = 0; ui.queue.push(true);
await guardHit();
await advance(5);
check('reino laxo: soborno pagado', !D.justice && !D.wanted && D.gold === 465 && punished.some(([k]) => k === 'bribe'), `oro ${D.gold} ${JSON.stringify(D.justice)}`);
check('movimiento libre tras el soborno', p.inputPermissions._perms[2] === true && !p.hasTag('rpg_arrested'));
r1.strictness = 2;
justice.hooks.classRank = () => 5;
wantOne();
ui.queue.length = 0; ui.queue.push(true);
await guardHit();
await advance(5);
check('nobleza en reino estricto: multa en vez del cepo', !D.justice && D.gold === 465 - 70 && punished.some(([k]) => k === 'fine'), `oro ${D.gold}`);
justice.hooks.classRank = () => 0;
D.gold = 500;
wantOne();
await guardHit();
check('reino implacable: no hay soborno posible', D.justice?.state === 'escort');
await finishNow();
r1.strictness = 1;
ev = { player: p, block: ow.getBlock(at(-13, 65, -13)), isFirstEvent: false, cancel: false };
crime._t.unlocked.clear();
p.teleport(at(-12.5, 65, -11.5));
world.beforeEvents.playerInteractWithBlock.fire(ev);
check('mantener pulsado no abre un cofre cerrado', ev.cancel && !games.has(p.id));
ev = { player: p, block: ow.getBlock(at(-13, 65, -13)), itemStack: p._inv.slots.find((x) => x?.typeId === 'rpg:lockpick'), isFirstEvent: true, cancel: false };
p.isSneaking = false;
world.beforeEvents.playerInteractWithBlock.fire(ev);
await advance(5);
check('con la ganzúa en la mano: espera a que te agaches', ev.cancel && games.get(p.id)?.armed === false && p._ab.includes('Agáchate'));
p.isSneaking = true;
await advance(2);
check('al agacharte empieza la cerradura', games.get(p.id)?.armed === true);
await playMinigame(true);
p.isSneaking = false;
const JAILER = npc('Gaspar', at(-20.5, 65, -20.5), { guard: true, job: 'carcelero', view: { x: 0, y: 0, z: -1 } });
p.teleport(at(-20.5, 65, -18.5));
p.isSneaking = true;
world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: JAILER, cancel: false });
await advance(2);
check('slowness a la víctima durante el robo', !!JAILER.getEffect('slowness'));
await playMinigame(true);
check('al carcelero se le roba la llave', p._inv.slots.some((x) => x?.typeId === 'rpg:jail_key'));
check('sin minijuego, la víctima recupera su paso', !JAILER.getEffect('slowness'));
p.isSneaking = false;
justice.onItemUse(p, p._inv.slots.find((x) => x?.typeId === 'rpg:jail_key'));
check('la llave fuera de prisión no abre nada', p._ab.includes('no abre nada'));
justice.onItemUse(p, new ItemStack('rpg:wanted_poster'));
await advance(2);
check('cartel de Se Busca', ui.shown.some((f) => (f.title ?? '').includes('Se Busca')));

/* ------------------------------------------------------------------ */
console.log('--- 15. Delitos sin ley / textos ---');
p.teleport(at(900.5, 65, 900.5));
const info = crime.reportCrime(p, 'hurto', {});
check('fuera de cualquier asentamiento no hay denuncia', !info.witnessed && !D.wanted);
check('todos los delitos tienen nombre y estrellas', Object.values(CRIMES).every((c) => c.name && c.stars.length === 3));
check('mensajes en español sin emoji fuera del BMP', log.messages.every((m) => ![...m].some((ch) => ch.codePointAt(0) > 0xffff)));

const ptxt = justice.profileText(p);
check('texto del Diario', ptxt.includes('Sigilo') && ptxt.includes('Antecedentes'));
justice.setWanted(p, 3, 'robo_noble');
check('admin: fijar estrellas', D.wanted?.stars === 3 && p.hasTag('rpg_wanted'));
justice.pardon(p);
check('admin: indulto', !D.wanted && !D.justice && !p.hasTag('rpg_wanted') && !justice.isRestricted(p));
console.log('Ejemplos de mensajes:');
for (const m of p._msgs.slice(-8)) console.log('   ', m);
console.log('WARNINGS:', errs.length, errs.slice(0, 10));
console.log('TIMER/JOB ERRORS:', log.errors.length, log.errors.slice(0, 3));
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
if (errs.length || log.errors.length) process.exitCode = 1;
process.exit();
