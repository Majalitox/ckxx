// Prueba de asentamientos y reinos (villa inicial, generación al explorar, todas las culturas,
// registro, marcadores, habitantes, cofres, descubrimiento, mantenimiento y ataques nocturnos).
// Ejecutar: tools/sim/run.sh test_settlements.mjs
// Opcional: BLOCKS_JSON=/ruta/a/b.json (mapa id → estados de mojang-blocks.json) valida ids/estados.
import { world, system, advance, log, ItemStack } from '@minecraft/server';
import { ui } from '@minecraft/server-ui';
import fs from 'node:fs';

const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { const s = a.join(' '); if (!s.includes('Cargado')) errs.push(s); origWarn('WARN', ...a); };
const q = (...items) => { ui.queue.length = 0; ui.queue.push(...items); };
let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) { fails++; process.exitCode = 1; } };

// El mock no tiene getBiome: lo añadimos aquí (sin tocar el mock compartido).
const ow = world.getDimension('overworld');
const DimProto = Object.getPrototypeOf(ow);
let biomeId = 'minecraft:plains';
if (!DimProto.getBiome) DimProto.getBiome = function () { return { id: biomeId }; };

await import('./scripts/main.js');
const store = await import('./scripts/core/store.js');
const set = await import('./scripts/systems/settlements.js');
const town = await import('./scripts/systems/town.js');
const C = await import('./scripts/data/cultures.js');
world.afterEvents.worldLoad.fire({});
world.afterEvents.entityDie.subscribe((ev) => set.onEntityDie(ev));
system.runInterval(() => { try { set.settlementTick(); } catch (e) { console.error('TICK', e); errs.push(String(e)); } }, 40);

const W = () => store.W();
async function until(cond, max = 20000, step = 20) {
  for (let t = 0; t < max; t += step) {
    if (cond()) return true;
    await advance(step);
  }
  return cond();
}

/* ---------------- Villa inicial ---------------- */
const p = world.addPlayer('Alex');
q(0);
world.afterEvents.playerSpawn.fire({ player: p, initialSpawn: true });
await until(() => !!store.getP(p), 2000);
check('nacimiento', !!store.getP(p));
const starter = set.starterSettlement();
check('villa inicial registrada', !!starter && starter.kind === 'inicio' && starter.culture === 'humano', starter?.name);
check('W().town compatible', !!W().town?.built && !!W().town.center && !!W().town.hall?.staff && !!W().town.staff);
check('W().town.plots (8 parcelas)', W().town.plots?.length === 8);
const fam = W().houses[0];
check('casa familiar en la primera parcela', !!fam && fam.cx === W().town.plots[0].x && fam.cz === W().town.plots[0].z);
await until(() => starter.built, 30000);
check('villa inicial construida', starter.built, set.constructionStatus());
console.log('  ', set.describeSettlement(starter).replace(/§./g, '').replace(/\n/g, ' | '));
check('villa: casas', starter.houses.length >= 5, String(starter.houses.length));
check('villa: cofres con dueño', starter.chests.length >= 5, String(starter.chests.length));
const shopKinds = new Set(starter.shops.map((s) => s.kind));
check('villa: mercado, herrería, taberna, templo', ['market', 'forge', 'tavern', 'temple'].every((k) => shopKinds.has(k)), [...shopKinds].join(','));
check('villa: plaza y picota', !!starter.plaza && !!starter.stocks);
check('villa: cárcel con 2 celdas', starter.jail?.cells?.length === 2 && starter.jail.cells.every((c) => c.door.length === 2 && c.doorBlock === 'minecraft:iron_bars' && c.spawn && c.min && c.max));
check('villa: guardias (4 + carcelero)', starter.guards.length >= 5, String(starter.guards.length));
check('villa: habitantes', starter.residents.length >= 6, String(starter.residents.length));
const wpList = set.waypointList(starter);
const wps = ow.getEntities({ type: 'rpg:waypoint', tags: ['rpg_set_' + starter.id] });
check('villa: marcadores creados', wps.length === wpList.length && wps.length > 10, `${wps.length}/${wpList.length}`);
const kinds = new Set(wps.map((e) => e._events[0]));
check('villa: marcadores con eventos correctos', ['plaza', 'market', 'forge', 'tavern', 'church', 'home', 'stocks', 'jail', 'jail_patrol', 'patrol_0', 'patrol_3', 'field'].every((k) => kinds.has('rpg:wp_' + k)), [...kinds].join(','));
check('villa: marcadores etiquetados', wps.every((e) => e.hasTag('rpg_wp') && e.hasTag('rpg_set_' + starter.id)));
const npcs = ow.getEntities({ type: 'rpg:npc', tags: ['rpg_set_' + starter.id] });
check('villa: NPCs etiquetados', npcs.length === starter.residents.length + starter.guards.length, `${npcs.length}`);
const idents = npcs.map((e) => JSON.parse(e.getDynamicProperty('rpg:npc')));
check('identidades con settlement/realm/cls/job', idents.every((i) => i.settlement === starter.id && i.realm === starter.realmId && i.cls && i.job && typeof i.wallet === 'number'));
const jobs = new Set(idents.map((i) => i.job));
check('empleos variados', ['guardia', 'carcelero', 'mercader', 'herrero', 'tabernero', 'sacerdote', 'granjero', 'noble'].every((j) => jobs.has(j)), [...jobs].join(','));
check('casas con dueño y homeId', starter.houses.filter((h) => h.owner).length >= 3 && idents.some((i) => i.homeId));
// cofres con botín
let filled = 0;
for (const c of starter.chests) {
  const b = ow.getBlock(c);
  const inv = b?.getComponent('minecraft:inventory')?.container;
  if (inv && inv.slots.some(Boolean)) filled++;
}
check('cofres con botín', filled >= Math.floor(starter.chests.length * 0.6), `${filled}/${starter.chests.length}`);
// API del registro
check('settlementAt(centro)', set.settlementAt('minecraft:overworld', starter.center)?.id === starter.id);
check('settlementAt(lejos) = undefined', !set.settlementAt('minecraft:overworld', { x: starter.center.x + 500, y: 64, z: starter.center.z }));
check('nearestSettlement', set.nearestSettlement('minecraft:overworld', { x: starter.center.x + 200, y: 64, z: starter.center.z })?.id === starter.id);
check('nearestSettlement con límite', !set.nearestSettlement('minecraft:overworld', { x: starter.center.x + 200, y: 64, z: starter.center.z }, 100));
const realm0 = set.realmOf(starter);
check('realmOf / getSettlement / allRealms', realm0?.id === starter.realmId && set.getSettlement(starter.id) === starter && set.allRealms().includes(realm0));
check('reino completo', !!realm0.name && !!realm0.ruler?.title && ['monarquía', 'consejo', 'teocracia'].includes(realm0.government) && [0, 1, 2].includes(realm0.strictness) && Object.keys(realm0.attitudes).length === 10 && realm0.economy?.focus && realm0.colors?.primary?.startsWith('#'), realm0.name + ' / ' + set.rulerName(realm0));
const spot2 = town.nextHouseSpot();
check('nextHouseSpot dentro de la villa', !!spot2 && Math.hypot(spot2.x - starter.center.x, spot2.z - starter.center.z) < starter.radius, JSON.stringify(spot2));
check('houseAt / chestAt', !!set.chestAt('minecraft:overworld', starter.chests[0]) && !!set.houseAt('minecraft:overworld', { x: starter.houses[0].min.x + 1, y: starter.houses[0].min.y + 1, z: starter.houses[0].min.z + 1 }));
// Descubrimiento de la villa (el jugador ya está dentro)
await advance(60);
const d = store.getP(p);
check('descubrimiento: visited', d.visited?.includes(starter.id));
check('descubrimiento: título', (p._title ?? '').includes(starter.name), p._title);

/* ---------------- Mantenimiento ---------------- */
const victim = npcs.find((e) => JSON.parse(e.getDynamicProperty('rpg:npc')).job === 'aldeano' || JSON.parse(e.getDynamicProperty('rpg:npc')).job === 'granjero');
const victimId = JSON.parse(victim.getDynamicProperty('rpg:npc')).id;
victim.remove();
await advance(40 * 12);
check('reaparece un habitante desaparecido', ow.getEntities({ type: 'rpg:npc', tags: ['rpg_fid_' + victimId] }).length === 1);
const wp0 = ow.getEntities({ type: 'rpg:waypoint', tags: ['rpg_set_' + starter.id, 'rpg_wpi_0'] })[0];
wp0.remove();
await advance(40 * 12);
check('reaparece un marcador desaparecido', ow.getEntities({ type: 'rpg:waypoint', tags: ['rpg_set_' + starter.id, 'rpg_wpi_0'] }).length === 1);
// Muerte: no reaparece hasta pasados 3 días, luego con identidad nueva
const dead = ow.getEntities({ type: 'rpg:npc', tags: ['rpg_fid_' + victimId] })[0];
dead.applyDamage(9999, { cause: 'entityAttack', damagingEntity: p });
await advance(40 * 12);
check('muerto no reaparece enseguida', ow.getEntities({ type: 'rpg:npc', tags: ['rpg_fid_' + victimId] }).length === 0);
world._abs += 3 * 24000;
await advance(40 * 12);
check('muerto sustituido tras 3 días', !starter.residents.includes(victimId) && starter.residents.length > 0 && ow.getEntities({ type: 'rpg:npc', tags: ['rpg_set_' + starter.id] }).length === starter.residents.length + starter.guards.length);

/* ---------------- Ataque nocturno ---------------- */
world._time = 14000;
const goldBefore = d.gold;
check('startRaid', set.startRaid(starter));
const raiders = ow.getEntities({ tags: ['rpg_raid_' + starter.id] });
check('invasores con etiqueta', raiders.length >= 3, String(raiders.length));
let defended = 0;
set.hooks.onRaidDefended = () => defended++;
for (const r of raiders) r.applyDamage(9999, { cause: 'entityAttack', damagingEntity: p });
await advance(40 * 4);
check('ataque rechazado: recompensa y gancho', d.gold > goldBefore && defended === 1, `${goldBefore} → ${d.gold}`);
world._time = 1000;

/* ---------------- Generación al explorar ---------------- */
async function walkTo(x, z, steps = 30) {
  const sx = p.location.x;
  const sz = p.location.z;
  for (let i = 1; i <= steps; i++) {
    p.teleport({ x: sx + ((x - sx) * i) / steps, y: 65, z: sz + ((z - sz) * i) / steps });
    await advance(20);
  }
}
const before = set.allSettlements().length;
await walkTo(starter.center.x + 520, starter.center.z, 40);
await until(() => set.allSettlements().length > before && set.allSettlements().at(-1).built, 40000);
const g1 = set.allSettlements().at(-1);
check('asentamiento generado al explorar', set.allSettlements().length > before && g1.built, g1 ? `${g1.name} ${g1.kind} ${g1.culture}` : '');
check('primer asentamiento del reino inicial = capital', g1?.kind === 'capital' && g1.realmId === starter.realmId && set.realmOf(g1).capitalId === g1.id);
const ahead = g1 && g1.center.x - starter.center.x;
check('aparece por delante del jugador (350 + 110..170)', ahead > 440 && ahead < 580 && Math.abs(g1.center.z - starter.center.z) < 80, String(ahead));
console.log('   no colocados:', JSON.stringify({ inicio: starter.skipped ?? [], capital: g1?.skipped ?? [] }));
check('capital: trono y rey', !!g1.throne && !!g1.rulerId && ow.getEntities({ type: 'rpg:npc', tags: ['rpg_fid_' + g1.rulerId] }).length === 1);
const king = ow.getEntities({ type: 'rpg:npc', tags: ['rpg_fid_' + g1.rulerId] })[0];
const kingIdent = king && JSON.parse(king.getDynamicProperty('rpg:npc'));
await advance(10);
check('rey: trabajo rey, título y corona', kingIdent?.job === 'rey' && kingIdent?.role === 'rey' && !!kingIdent?.title && king._props['rpg:hat'] === 5, kingIdent && `${kingIdent.title} ${kingIdent.name}`);
check('capital: 12 guardias + carcelero', g1.guards.length >= 13, String(g1.guards.length));
check('capital: murallas y puertas', g1.walls && g1.gates.length === 4);
check('capital: cárcel de 3 celdas', g1.jail?.cells?.length === 3);
check('capital: población limitada', g1.residents.length <= 34, String(g1.residents.length));
// Entrar en la capital
await walkTo(g1.center.x, g1.center.z, 10);
await advance(60);
check('descubrimiento de la capital', d.visited.includes(g1.id) && d.realms?.includes(g1.realmId));

// Lejos: nuevo reino (otra cultura según bioma)
biomeId = 'minecraft:mesa';
await walkTo(g1.center.x + 1300, g1.center.z, 60);
await until(() => set.allSettlements().at(-1).id !== g1.id && set.allSettlements().at(-1).built, 40000);
const g2 = set.allSettlements().at(-1);
check('nuevo reino lejos de la capital', g2 && g2.realmId !== g1.realmId && g2.kind === 'capital', g2 && `${g2.name} ${g2.kind} ${g2.culture} ${set.realmOf(g2)?.name}`);
check('cultura según bioma (mesa → dracónidos/orcos)', g2?.culture === 'draconido' || g2?.culture === 'orco', g2?.culture);
check('capitales separadas ≥ 900', Math.hypot(g2.center.x - g1.center.x, g2.center.z - g1.center.z) >= 900);

// Aldea/pueblo/ciudad del mismo reino
await walkTo(g2.center.x + 420, g2.center.z + 50, 40);
await until(() => set.allSettlements().at(-1).id !== g2.id && set.allSettlements().at(-1).built, 40000);
const g3 = set.allSettlements().at(-1);
check('asentamiento menor del reino', g3 && g3.realmId === g2.realmId && ['aldea', 'pueblo', 'ciudad'].includes(g3.kind), g3 && `${g3.name} ${g3.kind} ${g3.culture}`);
check('separación ≥ 350 entre asentamientos', set.allSettlements().every((a, i, arr) => arr.every((b, j) => i === j || Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) >= 260)));

/* ---------------- Todas las culturas ---------------- */
let x = g3.center.x + 900;
for (const cul of C.CULTURE_IDS) {
  p.teleport({ x, y: 65, z: 0 });
  const n0 = set.allSettlements().length;
  const kind = ['aldea', 'pueblo', 'ciudad'][C.CULTURE_IDS.indexOf(cul) % 3];
  set.forceSettlement(p, kind, cul);
  await until(() => set.allSettlements().length > n0 && set.allSettlements().at(-1).built, 40000);
  const s = set.allSettlements().at(-1);
  const ok = s && s.built && s.culture === cul && s.houses.length >= 3 && s.residents.length >= 3 && s.guards.length >= 2;
  check(`cultura ${cul} (${kind})`, ok, s && `${s.name} · casas ${s.houses.length} · hab ${s.residents.length} · guardias ${s.guards.length} · cofres ${s.chests.length}`);
  x += 700;
}

console.log('   no colocados:', JSON.stringify(Object.fromEntries(set.allSettlements().map((s) => [s.name + '(' + s.kind + ',' + s.culture + ')', s.skipped ?? []]))));

console.log('  Mensajes de descubrimiento:');
for (const m of p._msgs.filter((x) => /descubierto|territorio|Gobierna|recelo|bien recibidos|Ataque|salvo|vitorean|despierta/.test(x)).slice(0, 14)) console.log('    ' + m.replace(/§./g, ''));

/* ---------------- Comandos ---------------- */
const cmds = log.commands.filter((c) => c.startsWith('fill') || c.startsWith('setblock'));
if (process.env.DUMP_CMDS) {
  fs.writeFileSync(process.env.DUMP_CMDS, cmds.join('\n'));
  fs.writeFileSync(process.env.DUMP_CMDS + '.json', JSON.stringify(set.allSettlements().map((s) => ({ id: s.id, name: s.name, kind: s.kind, culture: s.culture, center: s.center, radius: s.radius }))));
}
const bad = cmds.filter((c) => !/^(fill -?\d+ -?\d+ -?\d+ -?\d+ -?\d+ -?\d+|setblock -?\d+ -?\d+ -?\d+) [a-z_]+( \[[^\]]*\])?( (hollow|keep|outline|replace [a-z_]+))?$/.test(c));
check('sintaxis de /fill y /setblock', bad.length === 0, bad.slice(0, 3).join(' | '));
const big = cmds.filter((c) => c.startsWith('fill')).filter((c) => {
  const n = c.split(' ').slice(1, 7).map(Number);
  return (Math.abs(n[3] - n[0]) + 1) * (Math.abs(n[4] - n[1]) + 1) * (Math.abs(n[5] - n[2]) + 1) > 32768;
});
check('volúmenes de /fill ≤ 32768', big.length === 0, String(big.length));
console.log('  comandos de construcción:', cmds.length);
if (process.env.BLOCKS_JSON && fs.existsSync(process.env.BLOCKS_JSON)) {
  const B = JSON.parse(fs.readFileSync(process.env.BLOCKS_JSON, 'utf8'));
  const unknown = new Map();
  const badStates = new Map();
  for (const c of cmds) {
    const m = /^(?:fill(?: -?\d+){6}|setblock(?: -?\d+){3}) ([a-z_]+)(?: \[([^\]]*)\])?(?: replace ([a-z_]+))?/.exec(c);
    if (!m) continue;
    for (const id of [m[1], m[3]].filter(Boolean)) if (!(id in B)) unknown.set(id, (unknown.get(id) ?? 0) + 1);
    if (m[2] && B[m[1]]) {
      for (const kv of m[2].split(',')) {
        const k = kv.split('=')[0].replace(/"/g, '');
        if (!B[m[1]].includes(k)) badStates.set(m[1] + '.' + k, (badStates.get(m[1] + '.' + k) ?? 0) + 1);
      }
    }
  }
  check('ids de bloque vanilla', unknown.size === 0, [...unknown.keys()].join(', '));
  check('estados de bloque válidos', badStates.size === 0, [...badStates.keys()].join(', '));
}

store.flush();
const wd = world.getDynamicProperty('rpg:wd_n');
let total = 0;
for (let i = 0; i < wd; i++) total += world.getDynamicProperty('rpg:wd_' + i).length;
console.log('  tamaño de W():', total, 'caracteres ·', set.allSettlements().length, 'asentamientos ·', set.allRealms().length, 'reinos');
check('W() razonable (< 120k)', total < 120000);

console.log('WARNINGS:', errs.length, errs.slice(0, 10));
console.log('TIMER/JOB ERRORS:', log.errors.length, log.errors.slice(0, 3));
if (errs.length || log.errors.length) process.exitCode = 1;
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
process.exit();
