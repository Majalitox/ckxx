// Pruebas del área "vida": horarios de los NPCs, bocadillos, conversaciones, clases sociales, hazañas, precios,
// regateo, carteristas, jornales, audiencia real, tamaños y cinemática del nacimiento.
// Ejecutar: tools/sim/run.sh test_life.mjs
// Usa un stub de systems/settlements.js (API del contrato §6.1 sobre W().settlements / W().realms) en la copia
// aislada de los scripts, salvo que se ejecute con REAL_SETTLEMENTS=1 y exista el módulo real.
import fs from 'node:fs';
import { world, system, advance, log, ItemStack } from '@minecraft/server';
import { ui } from '@minecraft/server-ui';

const STUB = `// Stub de pruebas (contrato §6.1)
import { W } from '../core/store.js';
import * as T from './town.js';
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
export function ensureStarterVillage(player) { return T.setupGuildTown ? T.setupGuildTown(player) : true; }
let slot = 0;
export function nextHouseSpot() { const t = W().town; slot++; return { x: (t?.center?.x ?? 0) - 30 - slot * 12, z: (t?.center?.z ?? 0) - 30 }; }
export function settlementTick() {}
`;
const target = './scripts/systems/settlements.js';
if (!(process.env.REAL_SETTLEMENTS === '1' && fs.existsSync(target))) fs.writeFileSync(target, STUB);

const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { const s = a.join(' '); if (!s.includes('Cargado')) errs.push(s); origWarn('WARN', ...a); };
let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) { fails++; process.exitCode = 1; } };
const q = (...items) => { ui.queue.length = 0; ui.queue.push(...items); };
// Revisión de todo el texto que ve el jugador (formularios y mensajes): sin variables ni géneros sin resolver.
const BAD_TEXT = /\{[a-z_]+\}|\/a\b|\/A\b|\b[Ee]l\/[Ll]a\b|undefined|NaN|\[object/;
const seenBad = [];
const lintText = (t, where) => { if (typeof t === 'string' && BAD_TEXT.test(t)) seenBad.push(where + ': ' + t.replace(/\n/g, ' ¶ ').slice(0, 300)); };
const origPush = ui.shown.push.bind(ui.shown);
ui.shown.push = (...forms) => {
  for (const f of forms) {
    lintText(f.title, 'título'); lintText(f.body, 'cuerpo ' + (f.title ?? ''));
    for (const b of f.buttons ?? []) lintText(b, 'botón ' + (f.title ?? ''));
    for (const fl of f.fields ?? []) lintText(String(fl?.[1] ?? ''), 'campo ' + (f.title ?? ''));
  }
  return origPush(...forms);
};

// economy.js primero: es el orden de importación con el ciclo más delicado (economy → social → … → life → economy).
const economy = await import('./scripts/systems/economy.js');
const store = await import('./scripts/core/store.js');
const profile = await import('./scripts/core/profile.js');
const social = await import('./scripts/systems/social.js');
const life = await import('./scripts/systems/life.js');
const npc = await import('./scripts/systems/npc.js');
const chat = await import('./scripts/systems/chat.js');
const shop = await import('./scripts/systems/shop.js');
const birth = await import('./scripts/systems/birth.js');
const passives = await import('./scripts/systems/passives.js');

// --- Conexiones (lo que hará main.js) ---
system.runInterval(() => { try { life.tick(); } catch (e) { console.warn('tick ' + e + e.stack); } }, 20);
world.afterEvents.entityHurt.subscribe((ev) => life.onEntityHurt(ev));
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target?.typeId !== npc.NPC_TYPE) return;
  ev.cancel = true;
  system.run(() => npc.openNpc(ev.player, ev.target));
});

// --- Mundo de prueba ---
const ow = world.getDimension('overworld');
const W = store.W();
W.realms = [
  { id: 'r1', name: 'Reino de Valdoria', culture: 'humano', ruler: { name: 'Alfonso', title: 'Rey', gender: 'm' }, capitalId: 's1', government: 'monarquía', strictness: 0,
    attitudes: { humano: 0.9, orco: -0.6, elfo: 0.2 }, economy: { focus: 'comercio', prosperity: 1.2 }, colors: { primary: '#B02E26', secondary: '#FED83D' } },
  { id: 'r2', name: 'Clanes de Khazad', culture: 'enano', ruler: { name: 'Durin', title: 'Thane', gender: 'm' }, capitalId: 's2', government: 'clan', strictness: 2,
    attitudes: { humano: 0.1, enano: 0.9 }, economy: { focus: 'minería', prosperity: 0.9 }, colors: { primary: '#835432', secondary: '#1D1D21' } },
];
W.settlements = [
  { id: 's1', kind: 'capital', culture: 'humano', name: 'Villarroble', realmId: 'r1', dim: 'minecraft:overworld', center: { x: 0, y: 65, z: 0 }, radius: 60,
    plaza: { x: 0, y: 65, z: 0 }, stocks: null, jail: null, houses: [], chests: [], shops: [], residents: [], guards: [], rulerId: null, built: true, createdDay: 0 },
  { id: 's2', kind: 'pueblo', culture: 'enano', name: 'Picohondo', realmId: 'r2', dim: 'minecraft:overworld', center: { x: 400, y: 65, z: 0 }, radius: 40,
    plaza: { x: 400, y: 65, z: 0 }, stocks: null, jail: null, houses: [], chests: [], shops: [], residents: [], guards: [], rulerId: null, built: true, createdDay: 0 },
];
W.town = { built: true, center: { x: -200, y: 65, z: -200 }, hall: { center: { x: -200, y: 65, z: -190 }, staff: {}, sombra: { x: -200, y: 65, z: -180 } }, staff: {}, slots: 0 };

// Marcadores del asentamiento s1
function wp(kind, x, z) {
  const e = ow.spawnEntity(`rpg:waypoint<rpg:wp_${kind}>`, { x, y: 65, z });
  e._families = ['rpg_waypoint', 'rpg_wp_' + kind];
  e.addTag('rpg_wp');
  e.addTag('rpg_set_s1');
  return e;
}
for (const [k, x, z] of [['field', 20, 20], ['forge', -10, 5], ['market', 5, 5], ['tavern', -5, -15], ['plaza', 0, 0], ['home', 15, -10], ['church', -20, 10],
  ['patrol_0', 30, 0], ['patrol_1', 0, 30], ['patrol_2', -30, 0], ['patrol_3', 0, -30]]) wp(k, x, z);

function mkPlayer(name, over = {}) {
  const p = world.addPlayer(name);
  const d = {
    v: 1, id: p.id, name, gender: 'm', race: 'humano', element: 'fuego', talent: 1, learned: [0], learned2: [], slots: ['r'], slotSel: 0,
    level: 10, xp: 0, sp: 0, statPts: 0, stats: { str: 0, vit: 0, agi: 0, int: 0 }, mana: 50, magicXp: 0, gold: 500, karma: 0,
    guild: { member: false, rank: 0, points: 0 }, shadow: { member: false, rank: 0, points: 0 }, hobbies: {}, quests: {},
    family: { house: { x: 10, y: 65, z: 10, dim: 'overworld' }, members: [], surname: 'García' }, rel: {}, inbox: [], explore: { dist: 0, acc: 0, regions: [] },
    stats2: {}, ageTicks: 40 * 24000, born: 0, social: { birth: 'media' }, ...over,
  };
  store.setP(p, d);
  return [p, d];
}
const spawn = (opts, loc) => npc.spawnNpc(ow, loc, npc.makeIdentity({ settlement: 's1', realm: 'r1', race: 'humano', ...opts }));
const identOf = (e) => JSON.parse(e.getDynamicProperty('rpg:npc'));

const [p, d] = mkPlayer('Ana', { gender: 'f' });
p.teleport({ x: 2.5, y: 65, z: 2.5 });
await advance(5);

/* ================= Clases sociales ================= */
{
  const base = { gender: 'm', gold: 0, karma: 0, guild: { member: false, rank: 0 } };
  check('clase: mendigo sin casa ni oro', social.playerClass({ ...base }).id === 'mendigo');
  check('clase: plebeyo con algo de oro', social.playerClass({ ...base, gold: 40 }).id === 'plebeyo');
  check('clase: ciudadano con casa (familia de artesanos)', social.playerClass({ ...base, family: { house: {} }, social: { birth: 'media' } }).id === 'ciudadano');
  check('clase: plebeyo con casa humilde y poco oro', social.playerClass({ ...base, gold: 20, family: { house: {} }, social: { birth: 'baja' } }).id === 'plebeyo');
  check('clase: ciudadano por el Gremio', social.playerClass({ ...base, guild: { member: true, rank: 1 } }).id === 'ciudadano');
  check('clase: burgués con 1000 de oro', social.playerClass({ ...base, gold: 1200 }).id === 'burgues');
  check('clase: caballero rango B', social.playerClass({ ...base, guild: { member: true, rank: 4 } }).id === 'caballero');
  check('clase: noble con título', social.playerClass({ ...base, social: { noble: { realmId: 'r1' } } }).rank === 5);
  const f = social.playerClass({ ...base, gender: 'f', guild: { member: true, rank: 5 } });
  check('clase: nombre femenino (Dama)', f.name === 'Dama', f.name);
  const hero = social.playerClass({ ...base, gold: 50, social: { fame: { r1: 500 } } });
  check('capa de fama: Héroe', hero.overlay === 'heroe' && hero.label.includes('Héroe'), hero.label);
  const leg = social.playerClass({ ...base, social: { fame: { r1: 1000 } } });
  check('capa de fama: Leyenda', leg.overlay === 'leyenda');
}

/* ================= Fama, hazañas y diario ================= */
{
  social.addDeed(p, social.deed('boss', { name: 'Liche Eterno', realmId: 'r1' }));
  social.recordDeed(p, 'thief', {});
  check('fama local tras derrotar al Liche', social.fame(d, 'r1') >= 60, String(social.fame(d, 'r1')));
  check('la fama viaja a otros reinos (25 %)', social.fame(d, 'r2') > 0 && social.fame(d, 'r2') < social.fame(d, 'r1'));
  check('registro de hazañas', d.social.deeds.length === 2 && d.social.deeds.some((x) => x.who?.includes('Liche')));
  social.addDeed(p, { id: 'x', text: 'Robaste una gallina', fame: -12, realmId: 'r1' });
  check('infamia', social.infamy(d, 'r1') === 12);
  for (let i = 0; i < 60; i++) social.addDeed(p, { id: 'k' + i, text: 'Hazaña ' + i, fame: 1 });
  check('diario limitado a 50 hazañas', d.social.deeds.length === 50);
  const page = social.journalPage(p);
  check('página del Diario', page.includes('Posición social') && page.includes('Reino de Valdoria') && page.includes('Últimas hazañas'));
  const glory = social.lastGlory(d, 'r1');
  check('NPCs recuerdan la mayor gesta aunque el diario rote', glory?.who?.includes('Liche'), glory?.who);
  check('tratamiento a una noble', social.address({ ...d, social: { ...d.social, noble: { realmId: 'r1' } } }, { cls: 'baja' }) === 'mi señora');
}

/* ================= Tamaños (contrato §1) ================= */
{
  const mk = (race, g) => ({ race, ageTicks: g * profile.growth({ ageTicks: 24000 }) ** -1 * 24000 });
  const at = (race, gr) => profile.scalePct(profile.stageScale(gr) * (({ humano: 1, orco: 1.15, hada: 0.45, enano: 0.75 })[race]));
  check('niño humano ≈ 1 bloque (55 %)', at('humano', 0) === 55);
  check('adolescente humano 70–80 %', at('humano', 0.4) === 70 && at('humano', 0.99) === 80);
  check('adulto humano 2 bloques (110 %)', at('humano', 1) === 110);
  check('adulto orco (130 %)', at('orco', 1) === 130);
  check('hada adulta (50 %), niña hada mínimo 30 %', at('hada', 1) === 50 && at('hada', 0) === 30);
  const [pk, dk] = mkPlayer('Kid', { ageTicks: 0 });
  passives.resetCaches(pk);
  passives.applyScale(pk, dk);
  check('evento de escala aplicado al niño', pk._events.includes('rpg:scale_55'), pk._events.join(','));
  void mk;
}

/* ================= Identidad, aparición y aspecto ================= */
const farmer = spawn({ job: 'granjero', gender: 'm' }, { x: 4, y: 65, z: 4 });
const guardDay = spawn({ job: 'guardia', gender: 'm' }, { x: 6, y: 65, z: 2 });
const noble = spawn({ job: 'noble', gender: 'f' }, { x: -3, y: 65, z: 3 });
const beggar = spawn({ job: 'mendigo', gender: 'm' }, { x: 1, y: 65, z: -3 });
const keeper = spawn({ job: 'tabernero', gender: 'f' }, { x: -2, y: 65, z: -2 });
const merchant = spawn({ job: 'mercader', gender: 'm', pers: 'amable' }, { x: 3, y: 65, z: -1 });
const king = spawn({ job: 'rey', gender: 'm', name: 'Alfonso', cls: 'alta' }, { x: -6, y: 65, z: -6 });
const fam = npc.spawnNpc(ow, { x: 9, y: 65, z: 9 }, npc.makeIdentity({ role: 'madre', gender: 'f', owner: p.id, ownerName: 'Ana' }));
await advance(4);
{
  check('evento de aparición: guardia', guardDay._events.includes('rpg:spawn_guard'));
  check('evento de aparición: ciudadano', farmer._events.includes('rpg:spawn_citizen'));
  check('evento de aparición: rey (personal)', king._events.includes('rpg:spawn_staff'));
  check('evento de aparición: familia (residente)', fam._events.includes('rpg:spawn_resident'));
  const gi = identOf(guardDay);
  const skin = guardDay.getProperty('rpg:skin');
  check('piel de guardia (clase 3)', skin >= 12 && skin <= 15, String(skin));
  check('piel de noble (raza*16+2*4+f*2)', [10, 11].includes(noble.getProperty('rpg:skin')), String(noble.getProperty('rpg:skin')));
  check('sombrero de guardia (casco) y lanza/espada', guardDay.getProperty('rpg:hat') === 4 && [1, 2].includes(guardDay.getProperty('rpg:tool')));
  check('azada del granjero', farmer.getProperty('rpg:tool') === 3 && [0, 1].includes(farmer.getProperty('rpg:hat')));
  check('corona del rey', king.getProperty('rpg:hat') === 5);
  check('alerta apagada al aparecer', farmer.getProperty('rpg:alert') === false);
  check('identidad con oficio, clase, bolsa y asentamiento', gi.job === 'guardia' && gi.cls === 'media' && typeof gi.wallet === 'number' && gi.settlement === 's1' && gi.role === 'guardia');
  check('nombre del rey con título', king.nameTag.includes('Rey') && king.nameTag.includes('Alfonso'), king.nameTag);
  check('nombre de la noble (Doña)', noble.nameTag.includes('Doña'), noble.nameTag);
  check('tamaño adulto NPC 2 bloques', farmer._events.includes('rpg:scale_110'));
  const thief = spawn({ job: 'ladron', gender: 'm' }, { x: 40, y: 65, z: 40 });
  await advance(3);
  check('el ladrón va disfrazado', thief.nameTag.includes('Forastero') && !thief.nameTag.includes('Ladrón'), thief.nameTag);
  thief.remove();
}

/* ================= Horarios ================= */
{
  world.setTimeOfDay(3000);
  chat.setKnownWeather('Clear');
  await advance(25);
  check('granjero a trabajar al campo por la mañana', farmer.getDynamicProperty('rpg:act') === 'work_field' && farmer._events.includes('rpg:act_work_field'), farmer.getDynamicProperty('rpg:act'));
  check('guardia de ronda', /^patrol_\d$/.test(guardDay.getDynamicProperty('rpg:act') ?? '') || identOf(guardDay) && guardDay.getDynamicProperty('rpg:act') === 'sleep', guardDay.getDynamicProperty('rpg:act'));
  check('el rey en su trono', king.getDynamicProperty('rpg:act') === 'idle');
  const before = farmer._events.length;
  await advance(40);
  check('no repite el evento si no cambia la actividad', farmer._events.slice(before).filter((e) => e.startsWith('rpg:act_')).length === 0);
  // Lluvia: a cubierto.
  chat.setKnownWeather('Rain');
  await advance(25);
  check('con lluvia el granjero se resguarda', ['tavern', 'home'].includes(farmer.getDynamicProperty('rpg:act')), farmer.getDynamicProperty('rpg:act'));
  chat.setKnownWeather('Clear');
  // Noche: a dormir.
  world.setTimeOfDay(18000);
  await advance(25);
  check('de noche el granjero duerme', farmer.getDynamicProperty('rpg:act') === 'sleep' && farmer.getProperty('rpg:mood') === 3);
  check('la familia también duerme', fam.getDynamicProperty('rpg:act') === 'sleep');
  // Guardia nocturno con antorcha.
  let nightGuard;
  for (let i = 0; i < 12 && !nightGuard; i++) {
    const g = spawn({ job: 'guardia' }, { x: 8 + i, y: 65, z: -8 });
    await advance(3);
    if (life.profileOf(identOf(g)) === 'guard_night') nightGuard = g; else g.remove();
  }
  await advance(25);
  check('guardia del turno de noche con antorcha', nightGuard && nightGuard.getProperty('rpg:tool') === 7 && /^patrol_/.test(nightGuard.getDynamicProperty('rpg:act')), nightGuard?.getDynamicProperty('rpg:act'));
  // Rotación de la ronda cada ~40 s.
  const r0 = nightGuard?.getDynamicProperty('rpg:act');
  await advance(820);
  check('la ronda rota de punto de patrulla', nightGuard?.getDynamicProperty('rpg:act') !== r0, `${r0} -> ${nightGuard?.getDynamicProperty('rpg:act')}`);
  // Ocupado por la justicia: no se toca.
  farmer.addTag('rpg_busy');
  world.setTimeOfDay(3000);
  const evs = farmer._events.length;
  await advance(25);
  check('NPC con rpg_busy intacto', farmer._events.length === evs && farmer.getDynamicProperty('rpg:act') === '');
  farmer.removeTag('rpg_busy');
  await advance(25);
  check('al soltarlo vuelve a su horario', farmer.getDynamicProperty('rpg:act') === 'work_field');
  // Sin marcador de iglesia en otra aldea: alternativa.
  const ctx = { time: 0, day: 0, now: 0, weather: 'Clear', kinds: new Set(['plaza', 'home']) };
  const priest = npc.makeIdentity({ job: 'sacerdote', settlement: 's1' });
  check('sin iglesia → plaza', life.activityFor(priest, { ...ctx, time: 1500 }) === 'plaza');
  check('mendigo pide en la plaza de día', life.activityFor(identOf(beggar), { ...ctx, time: 2000, kinds: undefined }) === 'plaza');
}

/* ================= Bocadillos y conversaciones ================= */
{
  world.setTimeOfDay(3000);
  const lone = spawn({ job: 'aldeano', name: 'Solitario' }, { x: 300, y: 65, z: 300 }); // lejos de jugadores: sin ambiente
  await advance(3);
  const base = lone.nameTag;
  life.say(lone, '¡Manzanas frescas!', 2);
  check('bocadillo visible', lone.nameTag.includes('«¡Manzanas frescas!»') && lone.nameTag.split('\n').length === 2);
  await advance(60);
  check('bocadillo restaurado', lone.nameTag === base, lone.nameTag);
  life.say(lone, 'Hola', 2);
  lone.nameTag = '§c§l(!)§r\nOtro sistema';
  await advance(60);
  check('no pisa el nombre puesto por otro sistema', lone.nameTag === '§c§l(!)§r\nOtro sistema');
  lone.remove();
  // Reacciones y ambiente con el jugador cerca.
  let bubbles = 0;
  for (let i = 0; i < 20; i++) { await advance(20); bubbles += life._t.bubbles.size; }
  check('vida ambiental: los NPCs hablan solos', bubbles > 0);
  // Conversación entre dos NPCs cercanos.
  const a = spawn({ job: 'aldeano', name: 'Pepe' }, { x: 12, y: 65, z: 12 });
  const b = spawn({ job: 'aldeano', name: 'Lola' }, { x: 13, y: 65, z: 12 });
  await advance(3);
  for (const k of [...life._t.bubbles.keys()]) life._t.bubbles.delete(k);
  life._t.convos.clear();
  const ok = life.startConversation(p, d, [{ e: a, d: 3 }, { e: b, d: 3 }], social.placeOf(p), { now: system.currentTick, time: 3000, weather: 'Clear' });
  await advance(2);
  const aSaid = a.nameTag.includes('«');
  await advance(80);
  const bSaid = b.nameTag.includes('«');
  check('conversación NPC↔NPC alterna frases', ok && aSaid && bSaid, `${a.nameTag} | ${b.nameTag}`);
  // Reacción a la clase: la noble ante una mendiga.
  const [pb, db] = mkPlayer('Pobre', { gold: 0, family: {}, social: { birth: 'baja' } });
  const r = life.reactionLine(pb, db, identOf(noble), social.placeOf(p));
  check('la noble desprecia a la mendiga', r && typeof r.line === 'string', r?.line);
  const [pn, dn] = mkPlayer('Noble', { social: { birth: 'alta', noble: { realmId: 'r1' } } });
  const r2 = life.reactionLine(pn, dn, identOf(beggar), social.placeOf(p));
  check('el mendigo se inclina ante la noble', r2 && /señor|reverencia|sombrero|honor|Abrid/.test(r2.line), r2?.line);
  pb.remove(); pn.remove();
}

/* ================= Chat: clima, reino, ley, rumores ================= */
{
  const gz = chat.genderize;
  check('género: "el/la" y pares completos', gz('Ése/a es el ladrón/la ladrona; el/la de los tomates', 'f', 'm') === 'Ésa es la ladrona; la de los tomates'
    && gz('¡El héroe/La heroína! ¿El/la de antes?', 'm', 'f') === '¡El héroe! ¿El de antes?', gz('Ése/a es el ladrón/la ladrona; el/la de los tomates', 'f', 'm'));
  check('género: demostrativos y NPC', gz('este/a pordiosero/a, ése/a mismo/a', 'f', 'm') === 'esta pordiosera, ésa misma' && gz('Estoy cansado/A', 'm', 'f') === 'Estoy cansada');
  check('género: no toca palabras que acaban en "el"', gz('Miguel/la y papel', 'f', 'f') === 'Miguel/la y papel');
  world.afterEvents.weatherChange.fire({ dimension: 'overworld', newWeather: 'Thunder', previousWeather: 'Clear' });
  check('caché del clima por evento', chat.currentWeather('minecraft:overworld') === 'Thunder');
  chat.setKnownWeather('Clear');
  const gi = identOf(guardDay);
  const rel = npc.relOf(d, gi);
  const c = { player: p, d, ident: gi, rel, stage: 'adult', mood: 'normal' };
  const law = chat.reply(c, '¿cuáles son las leyes de aquí?');
  check('el guardia explica la ley', law.text.includes('picota') || law.text.includes('cárcel') || law.text.includes('ley'), law.text);
  const realm = chat.reply({ ...c, ident: identOf(keeper), rel: npc.relOf(d, identOf(keeper)) }, 'háblame del reino y del rey');
  check('respuesta sobre el reino', /Valdoria|Alfonso|reino/i.test(realm.text), realm.text);
  const rum = chat.reply({ ...c, ident: identOf(keeper), rel: npc.relOf(d, identOf(keeper)) }, '¿qué rumores hay?');
  check('rumores con datos reales', rum.text.length > 20, rum.text);
  const deedsR = chat.reply({ ...c, ident: identOf(merchant), rel: npc.relOf(d, identOf(merchant)) }, '¿sabes quién soy? ¿conoces mis hazañas?');
  check('reconoce tus hazañas', /Liche|carterista|sé quién eres|oído/i.test(deedsR.text), deedsR.text);
  const jobR = chat.reply({ ...c, ident: identOf(farmer), rel: npc.relOf(d, identOf(farmer)) }, 'busco trabajo, ¿me das un jornal?');
  check('el granjero ofrece jornal', /Trabajo por un día/.test(jobR.text), jobR.text);
  const r1 = life.rumour(p, identOf(keeper));
  check('rumor de otro asentamiento o del reino', typeof r1 === 'string' && r1.length > 10, r1);
}

/* ================= Calidad del texto generado ================= */
{
  const bad = [];
  const lint = (t, where) => { if (typeof t !== 'string') return; if (/\{[a-z_]+\}|\/a\b|\/A\b|\b[Ee]l\/[Ll]a\b|undefined|NaN|\[object/.test(t)) bad.push(where + ': ' + t); };
  const idents = [farmer, guardDay, noble, beggar, keeper, merchant, king].map(identOf);
  const variants = [
    { gender: 'f', gold: 0, family: {}, social: { birth: 'baja' } },
    { gender: 'm', gold: 30, social: { birth: 'baja' } },
    { gender: 'f', gold: 300, social: { birth: 'media' } },
    { gender: 'm', gold: 1500, social: { birth: 'media', fame: { r1: 500 } } },
    { gender: 'f', guild: { member: true, rank: 5, points: 0 }, social: { birth: 'alta', fame: { r1: 1000 } } },
    { gender: 'm', social: { birth: 'alta', noble: { realmId: 'r1' } }, karma: -600, wanted: { stars: 2, crimes: ['hurto'] }, record: { hurto: 2, asesinato: 1 } },
    { gender: 'f', ageTicks: 0, social: { birth: 'media' }, race: 'orco' },
  ];
  const place = social.placeOf(p);
  for (let i = 0; i < variants.length; i++) {
    const [pv, dv] = mkPlayer('Lint' + i, variants[i]);
    social.addDeed(pv, social.deed(['boss', 'royal', 'guild_rank', 'crime', 'title'][i % 5], { name: 'Liche Eterno', ruler: 'el Rey Alfonso', rank: 'B', crime: 'hurto', realm: 'el Reino de Valdoria', realmId: 'r1', fame: i === 3 ? -40 : 30 }));
    for (const id of idents) {
      for (let k = 0; k < 12; k++) {
        const r = life.reactionLine(pv, dv, id, place);
        if (r) lint(r.line, 'reacción ' + id.job);
        lint(life.ambientLine(farmer, id, pv, dv, place, { time: k * 2000, weather: ['Clear', 'Rain', 'Thunder'][k % 3], weatherFresh: k % 4 === 0, otherName: 'Pepe' }), 'ambiente ' + id.job);
      }
      const c = { player: pv, d: dv, ident: id, rel: npc.relOf(dv, id), stage: profile.stageOf(dv), mood: 'normal' };
      for (const t of ['hola', '¿quién eres?', 'háblame del reino', '¿cuáles son las leyes?', '¿qué opinas de mi clase social?', '¿conoces mis hazañas?', 'me buscan por robar', 'quiero regatear', 'busco trabajo', '¿qué rumores hay?', 'adiós']) lint(chat.reply(c, t).text, 'chat ' + id.job + ' «' + t + '»');
      lint(chat.opening(c), 'saludo ' + id.job);
    }
    for (let k = 0; k < 15; k++) lint(life.rumour(pv, idents[4]), 'rumor');
    lint(social.journalPage(pv), 'diario');
    pv.remove();
  }
  for (const b of bad.slice(0, 6)) console.log('  >> ' + b.replace(/\n/g, ' ¶ ').slice(0, 600));
  check('texto generado sin variables ni géneros sin resolver', bad.length === 0, String(bad.length));
}

/* ================= Economía: precios, impuestos, eventos ================= */
{
  const s1 = social.getSettlementSafe('s1');
  const s2 = social.getSettlementSafe('s2');
  const iH = economy.priceIndex(s1, 'armas', 'buy');
  const iE = economy.priceIndex(s2, 'armas', 'buy');
  check('las armas son más baratas entre enanos mineros', iE < iH, `${iE.toFixed(2)} < ${iH.toFixed(2)}`);
  const fH = economy.priceFactor(p, s1, 'minecraft:iron_sword', 'buy');
  check('priceFactor incluye índice, trato e impuesto', fH > 0.4 && fH < 2, fH.toFixed(2));
  check('impuesto real de la monarquía', Math.abs(economy.salesTax(social.realmById('r1'), d) - 0.08) < 1e-9);
  check('los nobles del reino no pagan impuesto', economy.salesTax(social.realmById('r1'), { social: { noble: { realmId: 'r1' } } }) === 0);
  const e1 = economy.marketEvent(s1, 5);
  const e2 = economy.marketEvent(s1, 5);
  check('evento de mercado determinista por día', e1 === e2);
  let anyEvent = false;
  for (let day = 0; day < 30; day++) if (economy.marketEvent(s1, day)) anyEvent = true;
  check('hay eventos de mercado algunos días', anyEvent);
  const vill = economy.personalFactor({ ...d, karma: -600 }, 'buy', social.realmById('r1'));
  const heroF = economy.personalFactor({ ...d, karma: 600 }, 'buy', social.realmById('r1'));
  check('villano paga más que héroe', vill > heroF, `${vill.toFixed(2)} > ${heroF.toFixed(2)}`);
  const orcF = economy.personalFactor({ ...d, race: 'orco' }, 'buy', social.realmById('r1'));
  const humF = economy.personalFactor({ ...d, race: 'humano' }, 'buy', social.realmById('r1'));
  check('actitud racial del reino en los precios', orcF > humF);
  const mi = identOf(merchant);
  economy.refreshWallet(merchant, mi, 99);
  check('bolsa del mercader se rellena', identOf(merchant).wallet >= 100 && identOf(merchant).wday === 99);
}

/* ================= Regateo ================= */
{
  const mi = identOf(merchant);
  d.rel = {};
  q(['', true]);
  const a = await economy.haggle(p, mi, 100, 'buy', { item: 'una espada' });
  check('regateo: aceptar el precio', a === 100, String(a));
  q(['60'], ['72'], true);
  const b = await economy.haggle(p, mi, 100, 'buy', { item: 'una espada' });
  check('regateo: contraoferta y trato final más barato', typeof b === 'number' && b < 100 && b >= 62, String(b));
  check('regateo: sube la habilidad de comercio', (d.social.trade.xp ?? 0) > 0 || (d.social.trade.lvl ?? 1) > 1);
  q(['95']);
  const c = await economy.haggle(p, mi, 100, 'buy', { item: 'algo' });
  check('regateo: oferta razonable aceptada', c === 95, String(c));
  const relBefore = d.rel[mi.id]?.p ?? 0;
  q(['5'], undefined);
  const e = await economy.haggle(p, mi, 100, 'buy', { item: 'algo' });
  check('regateo: oferta insultante cierra el trato', e === undefined && (d.rel[mi.id]?.p ?? 0) < relBefore);
  q(undefined);
  const f = await economy.haggle(p, mi, 100, 'buy', { item: 'algo' });
  check('regateo: ofendido no regatea más hoy', f === undefined && d.social.hban[mi.id] === world.getDay());
  // Vender con la bolsa del mercader limitada.
  const k = identOf(keeper);
  q(['', true]);
  const g = await economy.haggle(p, k, 300, 'sell', { item: 'diamantes', wallet: 120 });
  check('vender: limitado por la bolsa del mercader', g === 120, String(g));
  q(['no']);
  const h = await economy.haggle(p, k, 50, 'sell', { item: 'pieles' });
  check('regateo: marcharse', h === undefined);
  ui.shown.length = 0;
  q([''], ['', true]);
  const i2 = await economy.haggle(p, k, 50, 'sell', { item: 'pieles' });
  const nudged = ui.shown.filter((f) => f.kind === 'modal').length === 2 && /Y bien|callad|tamborilea/.test(ui.shown[1]?.fields?.[0]?.[1] ?? '');
  check('regateo: enviar sin cifra hace insistir al mercader (sin gastar ronda)', i2 === 50 && nudged, ui.shown[1]?.fields?.[0]?.[1]);
  q([''], ['']);
  const j2 = await economy.haggle(p, k, 50, 'sell', { item: 'pieles' });
  check('regateo: dos veces sin cifra = se acabó', j2 === undefined);
}

/* ================= Tienda con regateo ================= */
{
  const goldBefore = d.gold;
  const mi = identOf(merchant);
  d.social.hban = {};
  p._inv.slots.fill(undefined);
  q('Comprar', 0, 'Regatear', ['', true], undefined, undefined);
  await shop.shopMenu(p, { entity: merchant, ident: mi });
  check('tienda: compra tras regatear', d.gold < goldBefore && p._inv.slots.some((s) => s?.typeId === 'minecraft:bread'), `${goldBefore} -> ${d.gold}`);
  p._inv.setItem(5, new ItemStack('minecraft:diamond', 5));
  const g2 = d.gold;
  q('Vender', 'diamond', 'Vender por', undefined, undefined);
  await shop.shopMenu(p, { entity: merchant, ident: identOf(merchant) });
  check('tienda: venta y bolsa del mercader', d.gold > g2 && !p._inv.slots.some((s) => s?.typeId === 'minecraft:diamond'), `${g2} -> ${d.gold}`);
}

/* ================= Carteristas ================= */
{
  world.setTimeOfDay(16000);
  p.teleport({ x: 100.5, y: 65, z: 100.5 });
  p._view = { x: 0, y: 0, z: 1 };
  d.gold = 400;
  const thief = npc.spawnNpc(ow, { x: 100.5, y: 65, z: 94.5 }, npc.makeIdentity({ job: 'ladron', settlement: 's1', gender: 'm', name: 'Rufo' }));
  await advance(3);
  economy.startStalk(p, thief);
  for (let i = 0; i < 200 && !economy.activeTheft(p); i++) await advance(1);
  const t = economy.activeTheft(p);
  check('el carterista se acerca a escondidas y roba', !!t && d.gold < 400, `oro ${d.gold}`);
  check('el ladrón huye ocupado', thief.hasTag('rpg_busy') && thief._events.includes('rpg:act_flee') && thief.nameTag.includes('ladrón'));
  const hud = economy.theftHud(p);
  check('HUD de persecución', /¡Al ladrón!.*Rufo.*\d+ s.*\d+ m/.test(hud), hud);
  const stolen = t?.gold ?? 0;
  const goldAfter = d.gold;
  world.afterEvents.entityHurt.fire({ hurtEntity: thief, damage: 1, damageSource: { cause: 'entityAttack', damagingEntity: p } });
  check('golpear al ladrón recupera el oro', d.gold === goldAfter + stolen && !economy.activeTheft(p) && economy.theftHud(p) === '', `${goldAfter}+${stolen}=${d.gold}`);
  check('hazaña por atrapar al carterista', d.social.deeds.some((x) => x.text.includes('carterista')));
  await advance(130);
  check('el ladrón se libera tras huir', !thief.hasTag('rpg_busy'));
  check('el ladrón queda desenmascarado', identOf(thief).exposed === world.getDay());
  life.clearBubble(thief); // un bocadillo ambiental puede ocupar la segunda línea en este momento
  check('su cartel ya no dice «Forastero» sino «Ladrón»', thief.nameTag.includes('Ladrón') && !thief.nameTag.includes('Forastero') && !thief.nameTag.includes('¡Al ladrón!'), thief.nameTag);
  check('sin restos del robo en el NPC', thief.getDynamicProperty('rpg:nt') === undefined && thief.getDynamicProperty('rpg:loot') === undefined && !economy.isFleeTracked(thief.id));
  // Escapa con el oro.
  const thief2 = npc.spawnNpc(ow, { x: 102.5, y: 65, z: 100.5 }, npc.makeIdentity({ job: 'ladron', settlement: 's1', name: 'Zorro' }));
  await advance(3);
  p.teleport({ x: 130.5, y: 65, z: 100.5 });
  const w0 = identOf(thief2).wallet;
  const got = economy.stealPurse(p, thief2, identOf(thief2));
  await advance(20 * 31);
  check('si no lo atrapas, escapa con tu oro', got > 0 && !thief2.hasTag('rpg_busy') && identOf(thief2).wallet === w0 + got, `${w0}+${got}=${identOf(thief2).wallet}`);
  // Nunca roba a presos.
  p.addTag('rpg_jailed');
  const g3 = d.gold;
  check('no roba a los presos', economy.stealPurse(p, thief2, identOf(thief2)) === 0 && d.gold === g3);
  p.removeTag('rpg_jailed');
  // El jugador lo mira: se aleja.
  p.teleport({ x: 100.5, y: 65, z: 100.5 });
  const thief3 = npc.spawnNpc(ow, { x: 100.5, y: 65, z: 105.5 }, npc.makeIdentity({ job: 'ladron', settlement: 's1', name: 'Garduña' }));
  await advance(3);
  p._view = { x: 0, y: 0, z: 1 };
  economy.startStalk(p, thief3);
  await advance(30);
  check('si le miras, el carterista desiste', !economy.activeTheft(p) && economy._t.stalks.size === 0);
  thief.remove(); thief2.remove(); thief3.remove();
  p.teleport({ x: 2.5, y: 65, z: 2.5 });
  world.setTimeOfDay(3000);
}

/* ================= Jornales ================= */
{
  const fi = identOf(farmer);
  d.social.jobDay = undefined;
  d.social.job = undefined;
  q(true);
  await life.dayJobMenu(p, fi, farmer);
  const j = d.social.job;
  check('jornal del granjero aceptado', j?.type === 'harvest' && j.need > 0);
  life.onProgress(p, 'harvest', 'minecraft:wheat', j.need);
  const g0 = d.gold;
  q(undefined);
  await life.dayJobMenu(p, fi, farmer);
  check('jornal cobrado', j.paid && d.gold === g0 + j.wage, `${g0} -> ${d.gold}`);
  q(undefined);
  await life.dayJobMenu(p, identOf(keeper), keeper);
  check('un solo jornal por día', !d.social.job?.served?.length && d.social.job.npcId === fi.id);
  // Taberna (otro jugador).
  const [pw, dw] = mkPlayer('Mozo');
  pw.teleport({ x: 0.5, y: 65, z: 0.5 });
  q(true);
  await life.dayJobMenu(pw, identOf(keeper), keeper);
  check('jornal de taberna aceptado', dw.social.job?.type === 'serve');
  check('puede servir a un cliente', life.canServe(pw, identOf(merchant)) && !life.canServe(pw, identOf(keeper)));
  await life.serveDrink(pw, identOf(merchant), merchant);
  check('jarra servida', dw.social.job.have === 1);
  pw.remove();
}

/* ================= Menú de NPC por oficio y audiencia real ================= */
{
  ui.shown.length = 0;
  q(undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: king, cancel: false });
  await advance(5);
  const menu = ui.shown.find((f) => f.title?.includes('Alfonso'));
  check('menú del rey con audiencia real', menu?.buttons?.some((b) => b.includes('Audiencia real')), menu?.buttons?.join(' | '));
  d.social.fame.r1 = 450;
  d.social.noble = undefined;
  d.social.titleItem = undefined;
  p._inv.slots.fill(undefined);
  q('Audiencia real', 'título', true, undefined, undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: king, cancel: false });
  await advance(10);
  check('título nobiliario gratis por fama ≥ 400', !!d.social.noble && p._inv.slots.some((s) => s?.typeId === 'rpg:noble_title'));
  check('ahora eres noble', social.playerClass(d).rank === 5);
  ui.shown.length = 0;
  q(undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: beggar, cancel: false });
  await advance(5);
  check('menú del mendigo con limosna', ui.shown.some((f) => f.buttons?.some((b) => b.includes('limosna'))));
  const k0 = d.karma;
  q('limosna', 2, undefined, undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: beggar, cancel: false });
  await advance(10);
  check('dar limosna sube el karma', d.karma > k0);
  ui.shown.length = 0;
  q('ley', undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: guardDay, cancel: false });
  await advance(5);
  check('el guardia explica la ley del reino', ui.shown.some((f) => (f.title ?? '').includes('La ley') && (f.body ?? '').includes('picota')));
  ui.shown.length = 0;
  q('Rumores', true, undefined, undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: keeper, cancel: false });
  await advance(10);
  check('la tabernera cuenta rumores', ui.shown.some((f) => (f.title ?? '').includes('Rumores')));
  // Royal quest
  q('Audiencia real', 'encargo real', undefined, undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: king, cancel: false });
  await advance(10);
  const rq = d.quests?.guild?.find((x) => x.royal);
  check('encargo real añadido a las misiones', !!rq && rq.title.startsWith('Encargo real'));
  rq.done = true;
  life.onProgress(p, 'kill', rq.target ?? '', 1);
  check('hazaña inmediata al completar el encargo real', d.social.deeds.some((x) => x.text.includes('encargo real')) && rq.deedDone);
  await advance(110);
  check('el encargo real cuenta una sola vez', d.social.deeds.filter((x) => x.text.includes('encargo real')).length === 1);
  // El bardo compone una copla con tus gestas.
  const bard = spawn({ job: 'bardo', gender: 'm', name: 'Juglar' }, { x: 1, y: 65, z: 4 });
  await advance(3);
  ui.shown.length = 0;
  const gb = d.gold;
  q('canción', true, undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: bard, cancel: false });
  await advance(10);
  const songForm = ui.shown.find((f) => (f.title ?? '').includes('La copla de'));
  check('el bardo canta tus gestas', !!songForm && /Liche|carterista|rango|noble|campeona/.test(songForm.body ?? '') && d.gold === gb - 3, songForm?.body);
  check('la copla no deja "el/la" sin resolver', !/\b[Ee]l\/[Ll]a\b|\/a\b|\/A\b/.test(songForm?.body ?? ''));
  ui.shown.length = 0;
  q('canción', undefined);
  world.beforeEvents.playerInteractWithEntity.fire({ player: p, target: bard, cancel: false });
  await advance(10);
  check('una canción por día', ui.shown.some((f) => /Ya te canté|Mañana te compongo/.test(f.body ?? '')));
  bard.remove();
  // Chat de una noble con una mendiga: se corta pronto.
  const [pb2] = mkPlayer('Harapos', { gold: 0, family: {}, social: { birth: 'baja' } });
  pb2.teleport({ x: -3, y: 65, z: 3 });
  q('Hablar', 'hola', 'qué tal', 'qué opinas del reino', 'adiós');
  world.beforeEvents.playerInteractWithEntity.fire({ player: pb2, target: noble, cancel: false });
  await advance(20);
  check('la noble se niega a charlar con la plebe', pb2._msgs.some((m) => /Basta|demasiado tiempo|criados/.test(m)));
  pb2.remove();
}

/* ================= Hazañas automáticas (ganchos del integrador) ================= */
{
  const n0 = d.social.deeds.length;
  social.deedForBoss(p, 'rpg:spider_queen');
  check('hazaña al derrotar un jefe', d.social.deeds[0]?.text.includes('a la Reina Araña'), d.social.deeds[0]?.text);
  const nb0 = d.social.deeds.length;
  social.deedForBoss(p, 'rpg:spider_queen'); // el mismo suceso llega por otro gancho
  life.onProgress(p, 'boss', 'rpg:spider_queen', 1);
  check('el mismo jefe no cuenta dos veces', d.social.deeds.length === nb0);
  social.deedForDungeon(p, 4);
  check('hazaña al limpiar una mazmorra', d.social.deeds[0]?.text.includes('rango B'), d.social.deeds[0]?.text);
  const nd0 = d.social.deeds.length;
  life.onProgress(p, 'dungeon', '', 1, 4);
  check('onProgress no duplica la hazaña de la mazmorra', d.social.deeds.length === nd0);
  const inf0 = social.infamy(d, 'r1');
  social.deedForCrime(p, 'hurto', { witnessed: true, stars: 1, settlement: social.getSettlementSafe('s1'), realm: social.realmById('r1') });
  check('infamia por un crimen presenciado', social.infamy(d, 'r1') > inf0 && d.social.deeds[0].fame < 0);
  check('crimen sin testigos no da infamia', social.deedForCrime(p, 'hurto', { witnessed: false }) === false);
  d.guild = { member: true, rank: 1, points: 0 };
  await advance(110);
  d.guild.rank = 3;
  await advance(110);
  check('hazaña al ascender en el Gremio', d.social.deeds.some((x) => x.text.includes('rango C del Gremio')) && d.social.deeds.some((x) => x.text.includes('rango D')));
  check('artículos del reino', social.realmArt('Clanes de Khazad') === 'los Clanes de Khazad' && social.fixEs('la corte de el Reino') === 'La corte del Reino');
  check('complemento con artículo', social.withA('El Rey del Vacío') === 'al Rey del Vacío' && social.withA('Azazel, Señor Demonio') === 'a Azazel, Señor Demonio');
  void n0;
}

/* ================= Recuperación tras recargar los scripts ================= */
{
  world.setTimeOfDay(3000);
  p.teleport({ x: 2.5, y: 65, z: 2.5 });
  // Lejos del ambiente (>16) pero dentro del radio de horarios (≤64).
  const eco = spawn({ job: 'aldeano', name: 'Eco', gender: 'm' }, { x: 42, y: 65, z: 2 });
  await advance(3);
  const base = eco.nameTag;
  life.say(eco, 'Esto se quedará colgado', 60);
  life._t.bubbles.delete(eco.id); // se pierde la memoria (recarga a mitad del bocadillo)
  check('bocadillo colgado tras recargar', eco.nameTag.includes('«') && eco.getDynamicProperty('rpg:nt') === base);
  await advance(25);
  check('al recargar se restaura el nombre', eco.nameTag === base && eco.getDynamicProperty('rpg:nt') === undefined, eco.nameTag);
  // Carterista que huía cuando se cerró el mundo.
  const st = npc.spawnNpc(ow, { x: 44, y: 65, z: 6 }, npc.makeIdentity({ job: 'ladron', settlement: 's1', name: 'Sombra', gender: 'm' }));
  await advance(3);
  const real = st.nameTag;
  const w0 = identOf(st).wallet;
  st.addTag('rpg_busy'); st.addTag('rpg_fleeing');
  st.setDynamicProperty('rpg:nt', real); st.setDynamicProperty('rpg:loot', 25);
  st.nameTag = '§cSombra\n§4¡Al ladrón!';
  await advance(25);
  check('carterista colgado: se libera, recupera su nombre y se queda el botín', !st.hasTag('rpg_busy') && !st.hasTag('rpg_fleeing') && st.nameTag === real && identOf(st).wallet === w0 + 25, `${st.nameTag} · ${w0}→${identOf(st).wallet}`);
  check('y vuelve a su horario', typeof st.getDynamicProperty('rpg:act') === 'string' && st.getDynamicProperty('rpg:act') !== '');
  // Un NPC retenido por la justicia sigue intacto.
  st.addTag('rpg_busy');
  const ev0 = st._events.length;
  await advance(25);
  check('la justicia conserva el control de sus NPCs', st.hasTag('rpg_busy') && st._events.length === ev0);
  st.removeTag('rpg_busy');
  eco.remove(); st.remove();
  // NPC de un mundo de la v1 (identidad sin oficio, clase, bolsa ni versión; piel del esquema antiguo).
  const old = ow.spawnEntity('rpg:npc', { x: 40, y: 65, z: -4 });
  old.setDynamicProperty('rpg:npc', JSON.stringify({ id: 'nv1', name: 'Viejo', surname: 'García', gender: 'm', race: 'elfo', role: 'aldeano', pers: 'sabio', age: 'adult' }));
  old.setProperty('rpg:skin', 5);
  old.nameTag = '§eViejo\n§7aldeano · §aElfo';
  await advance(25);
  const oi = identOf(old);
  check('migración v1: identidad completada', oi.lv === npc.LOOK_VERSION && oi.job === 'aldeano' && ['baja', 'media'].includes(oi.cls) && typeof oi.wallet === 'number', JSON.stringify(oi));
  const sk = old.getProperty('rpg:skin');
  check('migración v1: piel del esquema nuevo (elfo = 16..31)', sk >= 16 && sk <= 31, String(sk));
  check('migración v1: altura adulta y nombre con oficio', old._events.includes('rpg:scale_110') && old.nameTag.includes('Aldeano'), old.nameTag);
  const evs = old._events.filter((x) => x.startsWith('rpg:scale')).length;
  await advance(25);
  check('migración v1: solo una vez', old._events.filter((x) => x.startsWith('rpg:scale')).length === evs);
  old.remove();
}

/* ================= Llegada a un asentamiento ================= */
{
  life._t.enterMemo.clear();
  const before = p._msgs.length;
  life.onEnterSettlement(p, social.getSettlementSafe('s1'));
  check('al entrar: pregón o reputación', p._msgs.length > before);
}

/* ================= Cinemática del nacimiento ================= */
{
  const nb = world.addPlayer('Bebe');
  nb.teleport({ x: -200.5, y: 65, z: -230.5 });
  q(1);
  birth.beginBirth(nb);
  let sawCine = false;
  let sawFree = false;
  let lockedMove = false;
  for (let i = 0; i < 160; i++) {
    await advance(5);
    if (nb.hasTag('rpg_cinematic')) sawCine = true;
    if (nb.inputPermissions._perms[2] === false) lockedMove = true;
    if (nb.camera.calls.some((c) => c[0] === 'set' && c[1] === 'minecraft:free' && c[2]?.facingLocation)) sawFree = true;
    if (sawCine && !nb.hasTag('rpg_cinematic') && !birth.cinematicActive(nb)) break;
  }
  await advance(60); // la historia se muestra 1,5 s después de la cinemática
  const nd = store.getP(nb);
  check('nace el bebé', !!nd);
  check('cinemática: etiqueta y controles bloqueados', sawCine && lockedMove);
  check('cinemática: fundido y cámara libre con ease', nb.camera.calls.some((c) => c[0] === 'fade') && sawFree && nb.camera.calls.some((c) => c[2]?.easeOptions?.easeTime > 0));
  check('cinemática: controles restaurados', nb.inputPermissions._perms[2] === true && nb.inputPermissions._perms[1] === true && !nb.hasTag('rpg_cinematic'));
  check('cinemática: cámara liberada', nb.camera.calls.some((c) => c[0] === 'clear'));
  check('cinemática: HUD restaurado', nd && nd.hud === undefined && nd.cine === undefined);
  check('cinemática: partículas de nacimiento', (log.particleIds['rpg:birth'] ?? 0) > 10);
  const famNpcs = ow.getEntities({ type: 'rpg:npc' }).filter((e) => { try { return identOf(e).owner === nb.id; } catch { return false; } });
  check('cinemática: la familia queda libre', famNpcs.length >= 2 && famNpcs.every((e) => !e.hasTag('rpg_busy')));
  check('cuna colocada', [...ow._blocks.values()].some((b) => b.typeId === 'minecraft:white_carpet'));
  check('el bebé crece a tamaño de niño (55 %) tras la escena', nb._events.includes('rpg:scale_40') || nb._events.some((e) => e === 'rpg:scale_' + profile.scalePct(0.42 * ({ humano: 1, elfo: 1, enano: 0.75, orco: 1.15, bestia: 1, demonio: 1.05, celestial: 1.05, vampiro: 1, hada: 0.45, draconido: 1.1 })[nd.race])), nb._events.filter((e) => e.startsWith('rpg:scale')).join(','));
  check('clase social de la familia al nacer', ['baja', 'media', 'alta'].includes(nd?.social?.birth));
  check('objetos iniciales entregados', nb._inv.slots.some((s) => s?.typeId === 'rpg:journal') && nb._inv.slots.some((s) => s?.typeId === 'rpg:grimoire'));
  check('historia del nacimiento mostrada', nd && nd.storyPending === undefined && ui.shown.some((f) => (f.title ?? '').includes('Tu historia comienza')));
  // Si salió durante la cinemática: la historia se muestra al volver (familyUpkeep).
  nd.storyPending = '§fHistoria de prueba';
  ui.shown.length = 0;
  q(0);
  birth.familyUpkeep(nb);
  await advance(5);
  check('historia pendiente mostrada más tarde', nd.storyPending === undefined && ui.shown.some((f) => (f.body ?? '').includes('Historia de prueba')));
  // Familia retenida por una cinemática que ya no existe (el mundo se cerró a mitad).
  famNpcs[0].addTag('rpg_busy'); famNpcs[0].addTag('rpg_cinematic_npc');
  birth.familyUpkeep(nb);
  check('familia liberada de una cinemática antigua', !famNpcs[0].hasTag('rpg_busy') && !famNpcs[0].hasTag('rpg_cinematic_npc'));
  // Salir a mitad: se recupera en el siguiente pasivo.
  nb.addTag('rpg_cinematic');
  nb.inputPermissions.setPermissionCategory(2, false);
  nd.cine = { hud: null };
  nd.hud = false;
  passives.passiveTick(nb, nd);
  check('recuperación tras salir a mitad de la escena', !nb.hasTag('rpg_cinematic') && nb.inputPermissions._perms[2] === true && nd.hud === undefined);
}

for (const pl of world.getAllPlayers()) for (const m of pl._msgs ?? []) lintText(m, 'mensaje a ' + pl.name);
for (const m of log.messages) if (m.startsWith('[WORLD]')) lintText(m, 'anuncio');
for (const b of [...new Set(seenBad)].slice(0, 8)) console.log('  >> ' + b);
check('todo el texto mostrado al jugador está bien formado', seenBad.length === 0, String(seenBad.length));
console.log('WARNINGS:', errs.length, errs.slice(0, 10));
console.log('TIMER/JOB ERRORS:', log.errors.length, log.errors.slice(0, 3).map((e) => String(e?.stack ?? e)));
if (errs.length || log.errors.length) process.exitCode = 1;
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit();
