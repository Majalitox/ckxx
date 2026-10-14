// Migración de un mundo v1: ya existe la sede del Gremio y casas familiares, pero no hay villa
// registrada. La villa inicial debe crecer alrededor sin pisar lo existente.
// Ejecutar: tools/sim/run.sh test_settlements_v1.mjs
import { world, system, advance, log } from '@minecraft/server';

const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { const s = a.join(' '); if (!s.includes('Cargado')) errs.push(s); origWarn('WARN', ...a); };
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };

const store = await import('./scripts/core/store.js');
const set = await import('./scripts/systems/settlements.js');
const town = await import('./scripts/systems/town.js');
const p = world.addPlayer('Vieja');
p.teleport({ x: 200.5, y: 65, z: -100.5 });
// Estado v1: gremio + dos casas familiares en las parcelas 0 y 1 de la v1
check('sede del Gremio (v1)', town.setupGuildTown(p));
const W = store.W();
W.town.slots = 2;
W.houses.push({ owner: 'x1', name: 'A', x: 176, y: 65, z: -105, dim: 'overworld', cx: 176, cz: -105 });
W.houses.push({ owner: 'x2', name: 'B', x: 222, y: 65, z: -105, dim: 'overworld', cx: 222, cz: -105 });
check('sin villa registrada', !W.starterId);
system.runInterval(() => set.settlementTick(), 40);
for (let i = 0; i < 400 && !(set.starterSettlement()?.built); i++) await advance(20);
const s = set.starterSettlement();
check('villa creada alrededor del gremio v1', !!s && s.built && s.center.x === W.town.center.x && s.center.z === W.town.center.z, s?.name);
check('sin parcelas nuevas (sigue la lista v1)', !Array.isArray(W.town.plots));
const spot = town.nextHouseSpot();
check('nextHouseSpot continúa con la parcela v1 nº3', spot.x === W.town.center.x - 6 && spot.z === W.town.center.z - 26, JSON.stringify(spot));
// Ningún edificio nuevo pisa las casas antiguas ni el gremio
const o = W.town.hall.origin;
const keepOut = [[o.x - 2, o.z - 3, o.x + 16, o.z + 12], ...W.houses.map((h) => [h.cx - 4, h.cz - 4, h.cx + 4, h.cz + 4])];
const overlaps = s.houses.filter((h) => keepOut.some(([x1, z1, x2, z2]) => !(h.max.x < x1 || h.min.x > x2 || h.max.z < z1 || h.min.z > z2)));
check('casas nuevas fuera de las reservas', overlaps.length === 0, String(overlaps.length));
check('villa con mercado/taberna/herrería/templo', ['market', 'forge', 'tavern', 'temple'].every((k) => s.shops.some((x) => x.kind === k)), s.shops.map((x) => x.kind).join(','));
check('reservas eliminadas tras construir', !s.reserved);
console.log('WARNINGS:', errs.length, errs.slice(0, 10));
console.log('TIMER/JOB ERRORS:', log.errors.length);
if (errs.length || log.errors.length) process.exitCode = 1;
process.exit();
