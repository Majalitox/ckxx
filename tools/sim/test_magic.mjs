// Pruebas del área de magia (v2): proyectiles reales, muros, perforación, estados y reacciones,
// dominios, lluvias, invocaciones (seguir, marcar, curar, desvanecer), hechizos enemigos, títulos,
// sacudidas de cámara, tope contra jefes y límites de rendimiento.
// Ejecutar: tools/sim/run.sh test_magic.mjs
import { world, system, advance, log } from '@minecraft/server';

const errs = [];
const origWarn = console.warn;
console.warn = (...a) => { errs.push(a.join(' ')); origWarn('WARN', ...a); };
let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) { fails++; process.exitCode = 1; } };

const store = await import('./scripts/core/store.js');
const magic = await import('./scripts/systems/magic.js');
const fx = await import('./scripts/systems/spellfx.js');
const summons = await import('./scripts/systems/summons.js');
const E = await import('./scripts/data/elements.js');
const { ELEMENT_IDS, getSkill, REACTIONS, STATUSES } = E;

magic.hooks.spawnSummon = summons.spawnSummon;
const questEvents = [];
magic.hooks.questProgress = (p, type, key) => questEvents.push(type + ':' + key);
const reactionsSeen = [];
magic.hooks.onReaction = (p, r) => reactionsSeen.push(r.id);

const ow = world.getDimension('overworld');
const p = world.addPlayer('Mago');
p._hp = { cur: 200, max: 200 };
const d = {
  race: 'humano', gender: 'f', element: 'fuego', element2: 'agua', level: 40, xp: 0, mana: 9999, magicXp: 20000, karma: 0,
  stats: { int: 15 }, ageTicks: 9e9, learned: [0], slots: ['r', 'p:0'], slotSel: 1, talent: 1,
};
store.setP(p, d);

const rnd = Math.random;
const noCrit = () => { Math.random = () => 0.5; };
const restoreRnd = () => { Math.random = rnd; };
let keySeq = 0;
const skill = (el, idx, extra = {}) => ({ ...getSkill(el, idx), key: 'k' + el + idx + ':' + ++keySeq, el, ...extra });
const cast = (el, idx, extra) => { d.mana = 9999; magic.castSkill(p, d, skill(el, idx, extra)); };
const orc = (x, z, hp = 500, y = 65) => { const e = ow.spawnEntity('rpg:orc', { x, y, z }); e._hp = { cur: hp, max: hp }; return e; };
const clear = () => { for (const e of ow.getEntities()) if (e.typeId !== 'minecraft:player') e.remove(); fx.clearProjectiles(); };
const lost = (e) => e._hp.max - e._hp.cur;
const face = (dir) => { p._view = dir; };
const reset = () => { clear(); p.teleport({ x: 0.5, y: 65, z: 0.5 }); face({ x: 0, y: 0, z: 1 }); p._hp.cur = 200; };

/* ------------------------------------------------------------------ */
console.log('--- Proyectiles ---');
reset();
let t = orc(0.7, 12.5);
const launched0 = fx.stats.launched;
cast('fuego', 0);
await advance(1);
check('el proyectil existe y viaja', fx.activeProjectiles() >= 1 && fx.stats.launched > launched0);
check('aún no ha llegado (bloque 12)', lost(t) === 0);
await advance(10);
check('impacta al orco tras viajar', lost(t) > 0, `daño=${lost(t).toFixed(1)}`);
check('partículas rpg:orb / rpg:circle / rpg:fx_fuego', (log.particleIds['rpg:orb'] ?? 0) > 0 && (log.particleIds['rpg:circle'] ?? 0) > 0 && (log.particleIds['rpg:fx_fuego'] ?? 0) > 0);
check('estado Ardiendo aplicado', magic.hasStatus(t, 'ardiendo'));
check('statusLine para el HUD', magic.statusLine(t).includes('Ardiendo'), JSON.stringify(magic.statusLine(t)));

// Muro: el proyectil choca con los bloques
reset();
for (let x = -1; x <= 1; x++) for (let y = 66; y <= 67; y++) ow.setBlockType({ x, y, z: 6 }, 'minecraft:stone');
t = orc(0.7, 10.5);
const bh0 = fx.stats.blockHits;
cast('fuego', 0);
await advance(15);
check('el muro detiene el proyectil', lost(t) === 0 && fx.stats.blockHits > bh0, `daño=${lost(t)}`);
for (let x = -1; x <= 1; x++) for (let y = 66; y <= 67; y++) ow.setBlockType({ x, y, z: 6 }, 'minecraft:air');

// Autoapuntado suave: el orco está ligeramente desviado de la mira
reset();
t = orc(2.2, 12.5);
cast('fuego', 0);
await advance(12);
check('autoapuntado suave corrige la trayectoria', lost(t) > 0);

// Haz perforante
reset();
const line3 = [orc(0.6, 4.5), orc(0.6, 8.5), orc(0.6, 13.5)];
cast('fuego', 4);
await advance(10);
check('el haz perforante atraviesa a 3 enemigos', line3.every((e) => lost(e) > 0), line3.map((e) => lost(e).toFixed(1)).join('/'));

// Hielo: 3 esquirlas; Arcano: misiles escalonados que persiguen
reset();
t = orc(0.7, 6.5);
const l1 = fx.stats.launched;
cast('hielo', 0);
await advance(10);
check('hielo dispara 3 esquirlas', fx.stats.launched - l1 === 3 && lost(t) > 0);
reset();
t = orc(4, 9);
const l2 = fx.stats.launched;
cast('arcano', 0);
await advance(25);
check('arcano: 3 misiles teledirigidos', fx.stats.launched - l2 === 3 && lost(t) > 0, `daño=${lost(t).toFixed(1)}`);

/* ------------------------------------------------------------------ */
console.log('--- Reacciones ---');
// Rayo sobre mojado = Electrocución (x2 y cadena)
reset();
noCrit();
const dry = orc(0.7, 5.5);
cast('rayo', 0);
await advance(8);
const base = lost(dry);
dry.remove();
magic.clearStatuses(dry);
const wet = orc(0.7, 5.5);
const bystander = orc(3.5, 6.5);
magic.addStatus(wet, 'mojado', 200);
cast('rayo', 0);
await advance(8);
restoreRnd();
check('Electrocución: daño ≈ x2', lost(wet) >= base * 1.9, `${base.toFixed(1)} → ${lost(wet).toFixed(1)}`);
check('Electrocución: consume Mojado y deja Electrizado', !magic.hasStatus(wet, 'mojado') && magic.hasStatus(wet, 'electrizado'));
check('Electrocución: la descarga salta a otro enemigo', lost(bystander) > 0);
check('Electrocución: aviso en barra de acción', p._ab.includes('Electrocución'), p._ab);
check('reacción descubierta y guardada', d.combos?.includes('electrocucion') && p._msgs.some((m) => m.includes('Reacción descubierta')));
check('gancho onReaction y misión "reaction"', reactionsSeen.includes('electrocucion') && questEvents.includes('reaction:electrocucion'));

// Tabla de reacciones pedida: [elemento atacante, estado previo, id de reacción, comprobación extra]
const table = [
  ['fuego', 'congelado', 'derretir'],
  ['hielo', 'mojado', 'congelacion', (e) => magic.hasStatus(e, 'congelado')],
  ['viento', 'ardiendo', 'torbellino_fuego', (e, o) => magic.hasStatus(o, 'ardiendo')],
  ['tierra', 'congelado', 'fragmentar'],
  ['luz', 'maldito', 'purificacion', () => p._hp.cur > 100],
  ['necromancia', 'envenenado', 'plaga', (e, o) => magic.hasStatus(o, 'envenenado')],
  ['naturaleza', 'mojado', 'florecer', (e) => magic.hasStatus(e, 'enraizado')],
  ['arcano', 'ardiendo', 'resonancia'],
  ['sangre', 'sangrando', 'hemorragia'],
  ['oscuridad', 'aturdido', 'terror', (e) => magic.hasStatus(e, 'aterrado')],
  ['agua', 'ardiendo', 'vapor', (e, o) => !!o._effects.get('blindness')],
  ['rayo', 'ardiendo', 'sobrecarga'],
  ['fuego', 'envenenado', 'combustion'],
  ['tierra', 'mojado', 'lodazal', (e) => magic.hasStatus(e, 'enraizado')],
  ['oscuridad', 'radiante', 'eclipse'],
  ['fuego', 'inestable', 'desestabilizar'],
];
for (const [el, st, id, extra] of table) {
  reset();
  p._hp.cur = 100;
  const e = orc(0.7, 5.5);
  const other = orc(2.6, 6.5);
  magic.addStatus(e, st, 200);
  const before = reactionsSeen.length;
  cast(el, 0);
  await advance(el === 'arcano' ? 20 : 10);
  const got = reactionsSeen.slice(before);
  const ok = got.includes(id) && (!extra || extra(e, other));
  check(`${el} + ${st} → ${id}`, ok, got.join(','));
}
const names = new Set(REACTIONS.map((r) => r.name));
check('las descripciones del Diario muestran los combos', getSkill('rayo', 0).desc.includes('Electrocución') && getSkill('agua', 10).desc.includes('Prepara'));
check('guía de reacciones completa', [...names].every((n) => E.reactionGuide().includes(n)));
check('discoveredReactions', magic.discoveredReactions(d).length >= 10);

// Sangrando hace daño con el tiempo
reset();
t = orc(0.7, 5.5);
magic.addStatus(t, 'sangrando', 100, { dps: 2, srcE: p });
await advance(45);
check('Sangrando: daño periódico', lost(t) >= 4, `daño=${lost(t)}`);
// Terror: el enemigo huye
reset();
t = orc(0.7, 5.5);
magic.addStatus(t, 'aterrado', 60, { from: { x: 0.5, y: 65, z: 0.5 } });
await advance(10);
check('Terror: impulso para huir', !!t._imp && t._imp.z > 0);

/* ------------------------------------------------------------------ */
console.log('--- Áreas, dominios y lluvias ---');
reset();
t = orc(0.7, 3.5);
cast('fuego', 1); // nova
await advance(10);
check('nova: onda que daña y empuja', lost(t) > 0 && !!t._kb);

reset();
t = orc(0.7, 8.5);
const pulled = orc(2.6, 9.5);
const zs = skill('agua', 15); // dominio nivel II
d.mana = 9999;
magic.castSkill(p, d, zs);
await advance(5);
const zoneOn = [...Array(50).keys()].some((i) => fx.hasTicker('zone:' + i));
await advance(60);
const zoneHits = lost(t);
check('dominio: anillo persistente (ticker) y daño continuo', zoneOn && zoneHits >= zs.power * 0 + 3 * magic.spellPower(p, d, 'agua', zs.power) * 0.99, `daño=${zoneHits.toFixed(1)}`);
check('dominio de agua: atrae hacia el centro', !!pulled._imp && pulled._imp.x < 0, JSON.stringify(pulled._imp));

reset();
log.commands.length = 0;
t = orc(0.7, 10.5);
const l3 = fx.stats.launched;
cast('fuego', 49); // Apocalipsis Solar (nivel V)
check('título enorme ¡APOCALIPSIS SOLAR!', String(p._title).includes('¡APOCALIPSIS SOLAR!'), p._title);
check('sacudida de cámara (camerashake ... positional)', log.commands.some((c) => /^camerashake add @s [\d.]+ [\d.]+ positional$/.test(c)), log.commands.find((c) => c.startsWith('camera')));
await advance(120);
check('lluvia: proyectiles caen del cielo', fx.stats.launched - l3 >= getSkill('fuego', 49).strikes);
check('lluvia: daña a los enemigos de la zona', lost(t) > 0, `daño=${lost(t).toFixed(1)}`);

reset();
t = orc(0.7, 10.5);
cast('rayo', 19); // lluvia de rayo: relámpagos sin entidad vanilla
await advance(60);
check('lluvia de rayos sin minecraft:lightning_bolt', lost(t) > 0 && !ow.getEntities({ type: 'minecraft:lightning_bolt' }).length);

// Potenciación con aura ofensiva
reset();
t = orc(0.7, 2.2);
cast('fuego', 12); // potenciación nivel II
await advance(45);
check('potenciación: efectos + aura que quema a los cercanos', !!p._effects.get('strength') && lost(t) > 0);

// Maldición en cono
reset();
const c1 = orc(0.7, 4.5);
const c2 = orc(-5, -4); // detrás: fuera del cono
cast('oscuridad', 3);
await advance(5);
check('maldición: cono frontal', lost(c1) > 0 && lost(c2) === 0 && magic.hasStatus(c1, 'maldito'));

// Movilidad: parpadeo
reset();
cast('rayo', 7);
await advance(2);
check('parpadeo teletransporta', p.location.z > 3, `z=${p.location.z.toFixed(1)}`);

/* ------------------------------------------------------------------ */
console.log('--- Jefes y equilibrio ---');
reset();
const boss = ow.spawnEntity('rpg:goblin_king', { x: 0.7, y: 65, z: 6.5 });
boss._hp = { cur: 1000, max: 1000 };
cast('fuego', 40, { power: 9999 });
await advance(10);
check('tope de daño por impacto contra jefes (≤10 %)', lost(boss) > 0 && lost(boss) <= 100 + 1e-6, `daño=${lost(boss).toFixed(1)}`);
reset();
const boss2 = ow.spawnEntity('rpg:goblin_king', { x: 0.7, y: 65, z: 9.5 });
boss2._hp = { cur: 1000, max: 1000 };
cast('fuego', 49, { power: 9999 }); // Apocalipsis Solar absurdo
await advance(120);
check('un solo hechizo nunca supera el 25 % de la vida de un jefe', lost(boss2) > 0 && lost(boss2) <= 250 + 1e-6, `daño=${lost(boss2).toFixed(1)}`);
const dLow = { ...d, level: 1, magicXp: 0, stats: {} };
const dHigh = { ...d, level: 100, magicXp: 80000, stats: { int: 200 } };
const pw = (dd, i) => magic.spellPower(p, dd, 'fuego', getSkill('fuego', i).power);
console.log(`  poder proyectil I nivel 1: ${pw(dLow, 0).toFixed(1)} · V nivel 100 (Int 205, SSS): ${pw(dHigh, 40).toFixed(1)}`);
check('curva: nivel I útil desde el principio (zombi en ≤3 proyectiles)', pw(dLow, 0) >= 20 / 3);
check('curva: nivel V espectacular pero acotado (<200 por proyectil)', pw(dHigh, 40) < 200 && pw(dHigh, 40) > pw(dLow, 0) * 8);
const m0 = getSkill('fuego', 0);
const m4 = getSkill('fuego', 49);
console.log(`  maná/recarga: ${m0.name} ${m0.mana}✦ ${m0.cd / 20}s · ${m4.name} ${m4.mana}✦ ${m4.cd / 20}s`);
check('curva de maná/recarga', m0.mana <= 6 && m0.cd <= 20 && m4.mana >= 100 && m4.cd >= 600);

/* ------------------------------------------------------------------ */
console.log('--- Invocaciones ---');
reset();
d.mana = 9999;
magic.castSkill(p, d, skill('agua', 8)); // espíritu del manantial
await advance(2);
let spirits = ow.getEntities({ type: 'rpg:spirit' });
check('invoca un espíritu aliado', spirits.length === 1 && spirits[0].hasTag('rpg_ally') && spirits[0].getDynamicProperty('rpg:el') === 'agua');
const sp = spirits[0];
t = orc(5, 5);
check('markTarget marca al enemigo', magic.markTarget(p, t) === true && t.hasTag('rpg_marked'));
const npc = ow.spawnEntity('rpg:npc', { x: 2, y: 65, z: 2 });
check('nunca marca NPCs ni jugadores', !magic.markTarget(p, npc) && !npc.hasTag('rpg_marked') && !magic.markTarget(p, p));
const t2 = orc(-5, 5);
magic.onEntityHurt({ hurtEntity: t2, damage: 3, damageSource: { cause: 'entityAttack', damagingEntity: p } });
check('onEntityHurt: lo que golpea el dueño queda marcado', t2.hasTag('rpg_marked'));
await advance(205);
check('la marca dura 10 s', !t.hasTag('rpg_marked'));
// golpe del espíritu: deja Mojado y luego un rayo provoca Electrocución
magic.onEntityHurt({ hurtEntity: t2, damage: 4, damageSource: { cause: 'entityAttack', damagingEntity: sp } });
check('el golpe del espíritu deja su estado (Mojado)', magic.hasStatus(t2, 'mojado'));
// curación del dueño
p._hp.cur = 100;
sp.teleport({ x: 1.5, y: 65, z: 1.5 });
await advance(90);
check('el espíritu de agua cura a su dueño', p._hp.cur > 100, `vida=${p._hp.cur.toFixed(1)}`);
// seguir suavemente / teletransporte si está lejos
for (const e of ow.getEntities()) if (e.typeId !== 'minecraft:player' && e.typeId !== 'rpg:spirit') e.remove();
sp.teleport({ x: 0.5, y: 65, z: 10.5 });
const d0 = Math.hypot(sp.location.x - p.location.x, sp.location.z - p.location.z);
await advance(6);
const d1 = Math.hypot(sp.location.x - p.location.x, sp.location.z - p.location.z);
check('sigue al dueño con pasos suaves', d1 < d0 && d0 - d1 < 4, `${d0.toFixed(1)} → ${d1.toFixed(1)}`);
p.teleport({ x: 60.5, y: 65, z: 0.5 });
await advance(4);
check('reaparece junto al dueño si se aleja', Math.hypot(sp.location.x - 60.5, sp.location.z - 0.5) < 4);
// desvanecerse al caducar
p.teleport({ x: 0.5, y: 65, z: 0.5 });
await advance(getSkill('agua', 8).duration + 40);
check('se desvanece al caducar', !sp.isValid && summons.spiritCount(p) === 0);
// límite por dueño
for (let i = 0; i < 4; i++) { d.mana = 9999; magic.castSkill(p, d, skill('luz', 48)); await advance(1); }
check('máximo de espíritus por jugador', ow.getEntities({ type: 'rpg:spirit' }).length <= summons.MAX_PER_OWNER);
summons.dismissAll(p);
await advance(2);
check('dismissAll los retira', ow.getEntities({ type: 'rpg:spirit' }).length === 0);

/* ------------------------------------------------------------------ */
console.log('--- Hechizos enemigos ---');
reset();
const mage = ow.spawnEntity('rpg:dark_mage', { x: 0.5, y: 65, z: 12.5 });
const villager = ow.spawnEntity('rpg:npc', { x: 0.5, y: 65, z: 6.5 });
const ally = ow.spawnEntity('rpg:goblin', { x: 0.6, y: 65, z: 9.5 });
p._hp.cur = 200;
check('enemyCast bolt devuelve true', magic.enemyCast(mage, 'oscuridad', 'bolt', p, 6) === true);
await advance(25);
check('el proyectil enemigo daña al jugador', p._hp.cur < 200, `vida=${p._hp.cur}`);
check('atraviesa NPCs y monstruos sin dañarlos', villager._hp.cur === villager._hp.max && ally._hp.cur === ally._hp.max);
check('deja su estado en el jugador', magic.hasStatus(p, 'maldito'));
// reacción sobre el jugador
magic.addStatus(p, 'mojado', 200);
magic.enemyCast(mage, 'rayo', 'bolt', p, 6);
await advance(15);
check('reacciones también contra jugadores', p._ab.includes('Electrocución'), p._ab);
for (const kind of ['lance', 'nova', 'curse', 'zone', 'rain', 'barrage', 'ward']) {
  p._hp.cur = 200;
  const near = kind === 'nova' || kind === 'curse';
  if (near) mage.teleport({ x: 0.5, y: 65, z: 3.5 }); else mage.teleport({ x: 0.5, y: 65, z: 12.5 });
  mage._view = { x: 0, y: 0, z: -1 };
  const ok = magic.enemyCast(mage, 'fuego', kind, p, 5, { tier: 2 });
  await advance(kind === 'rain' ? 80 : 50);
  check(`enemyCast ${kind}`, ok && (kind === 'ward' || p._hp.cur < 200), `vida=${p._hp.cur.toFixed(1)}`);
}
check('enemyCast nunca daña al NPC', villager._hp.cur === villager._hp.max);
check('enemyCast con lanzador inválido → false', magic.enemyCast(undefined, 'fuego', 'bolt', p, 5) === false);
check('enemyCast hacia un punto', magic.enemyCast(mage, 'hielo', 'rain', { x: 5, y: 65, z: 5 }, 4) === true);

/* ------------------------------------------------------------------ */
console.log('--- Escalado de monstruos (no muertos) ---');
{
  const combat = await import('./scripts/systems/combat.js');
  // Emula el motor: health_boost sube el máximo (no la vida actual) e instant_health DAÑA a los no muertos.
  const engineLike = (e, undead) => {
    const orig = e.addEffect.bind(e);
    e.addEffect = (id, dur, opts) => {
      orig(id, dur, opts);
      const amp = opts?.amplifier ?? 0;
      if (id === 'health_boost') e._hp.max = 20 + 4 * (amp + 1);
      if (id === 'instant_health') { if (undead) e.applyDamage(3 * 2 ** (amp + 1), { cause: 'magic' }); else e._hp.cur = Math.min(e._hp.max, e._hp.cur + 2 * 2 ** (amp + 1)); }
      if (id === 'instant_damage' && undead) e._hp.cur = Math.min(e._hp.max, e._hp.cur + 2 * 2 ** (amp + 1));
    };
    return e;
  };
  reset();
  world._dayOffset = 100; // día 100 → nivel 4 en todas partes
  const undeadMobs = ['minecraft:zombie', 'minecraft:skeleton', 'minecraft:husk', 'minecraft:stray'].map((t) => engineLike(ow.spawnEntity(t, { x: 3, y: 65, z: 3 }), true));
  for (const e of undeadMobs) combat.setupMob(e);
  await advance(3);
  check('setupMob: zombis/esqueletos de nivel 4 sobreviven con la vida llena', undeadMobs.every((e) => e.isValid && e._hp.cur === e._hp.max && e._hp.max > 20),
    undeadMobs.map((e) => `${e.typeId.slice(10)} ${e.isValid ? e._hp.cur + '/' + e._hp.max : 'MUERTO'}`).join(' · '));
  check('setupMob: sin instant_health', undeadMobs.every((e) => !e.getEffect('instant_health')) && undeadMobs.every((e) => e.getDynamicProperty('rpg:tier') === 4));
  const z = undeadMobs[0];
  z._hp.cur = 10;
  const effBefore = z.getEffects().length;
  combat.setupMob(z);
  await advance(2);
  check('setupMob idempotente: no vuelve a curar ni a aplicar efectos', z._hp.cur === 10 && z.getEffects().length === effBefore);
  const o = ow.spawnEntity('rpg:orc', { x: 4, y: 65, z: 4 });
  combat.setupMob(o);
  combat.setupMob(o);
  check('setupMob idempotente en monstruos rpg: (un solo rpg:tier_N)', o._events.filter((ev) => ev.startsWith('rpg:tier_')).length === 1);
  world._dayOffset = 0;
  Math.random = () => 0.5;
  const z0 = engineLike(ow.spawnEntity('minecraft:zombie', { x: 5, y: 65, z: 5 }), true);
  combat.setupMob(z0);
  world._dayOffset = 100;
  combat.setupMob(z0); // p. ej. al recargar el chunk: no vuelve a tirar el nivel
  restoreRnd();
  check('nivel 0 también queda fijado (sin nueva tirada al recargar)', z0.getDynamicProperty('rpg:tier') === 0 && !z0.getEffect('health_boost'));
  world._dayOffset = undefined;

  // Runa del Trueno: rayo con guion, sin minecraft:lightning_bolt
  reset();
  const { ItemStack } = await import('@minecraft/server');
  const sword = new ItemStack('minecraft:iron_sword');
  sword.setLore(['§eᚱ Runa del Trueno']);
  p._inv.setItem(p.selectedSlotIndex, sword);
  t = orc(0.7, 2.5, 100);
  const rayo0 = log.particleIds['rpg:fx_rayo'] ?? 0;
  Math.random = () => 0;
  combat.onHurt({ hurtEntity: t, damage: 4, damageSource: { cause: 'entityAttack', damagingEntity: p } });
  restoreRnd();
  await advance(12);
  check('runa del Trueno: daño de rayo por guion, sin entidad vanilla', lost(t) >= 5 && !ow.getEntities({ type: 'minecraft:lightning_bolt' }).length && (log.particleIds['rpg:fx_rayo'] ?? 0) > rayo0, `daño=${lost(t)}`);
  p._inv.setItem(p.selectedSlotIndex, undefined);
}

console.log('--- Proyectiles con gravedad (Tierra) ---');
{
  reset();
  t = orc(0.7, 18.5);
  cast('tierra', 0); // Guijarro (alcance 20): antes caía al suelo a ~11 bloques
  await advance(40);
  check('roca de Tierra alcanza a un objetivo a 18 bloques', lost(t) > 0, `daño=${lost(t).toFixed(1)}`);
  reset();
  t = orc(0.7, 6.5);
  cast('tierra', 0);
  await advance(20);
  check('roca de Tierra sigue acertando de cerca', lost(t) > 0);
  reset();
  t = orc(0.7, 14.5);
  cast('agua', 0);
  await advance(30);
  check('bala de agua (gravedad ligera) alcanza a 14 bloques', lost(t) > 0);
  // Ataque de roca de jefe (Pedrusco del Rey Goblin, Roca Rúnica del Gólem) contra un jugador lejos
  reset();
  const gk = ow.spawnEntity('rpg:goblin_king', { x: 0.5, y: 65, z: 18.5 });
  p._hp.cur = 200;
  magic.enemyCast(gk, 'tierra', 'bolt', p, 7, { tier: 1, name: 'Pedrusco' });
  await advance(40);
  check('Pedrusco del Rey Goblin alcanza a 18 bloques', p._hp.cur < 200, `vida=${p._hp.cur.toFixed(1)}`);
  reset();
  const ag = ow.spawnEntity('rpg:ancient_golem', { x: 0.5, y: 65, z: 21.5 });
  p._hp.cur = 200;
  magic.enemyCast(ag, 'tierra', 'bolt', p, 12, { tier: 2, name: 'Roca Rúnica' });
  await advance(40);
  check('Roca Rúnica del Gólem alcanza a 21 bloques', p._hp.cur < 200, `vida=${p._hp.cur.toFixed(1)}`);
  const bd = fx.ballisticDir({ x: 0, y: 66, z: 0 }, { x: 0, y: 66, z: 6 }, 1.36, 0.03);
  check('ballisticDir no corrige cuando la línea recta ya llega', bd === undefined || bd.y < 0.2);
}

console.log('--- Jefes: esbirros, línea de visión y teletransporte ---');
{
  const bosses = await import('./scripts/systems/bosses.js');
  bosses.hooks.enemyCast = magic.enemyCast;
  // Tope de esbirros: el Rey Goblin invoca en cada turno (aleatorio 0,1 < 0,5)
  reset();
  ow.spawnEntity('rpg:goblin_king', { x: 0.5, y: 65, z: 8.5 });
  Math.random = () => 0.1;
  for (let i = 0; i < 6; i++) { bosses.bossTick(); await advance(150); }
  restoreRnd();
  const minions = ow.getEntities({ tags: ['rpg_minion'] }).length;
  check(`tope de esbirros (≤ ${bosses.MINION_CAP})`, minions > 0 && minions <= bosses.MINION_CAP, `esbirros=${minions}`);

  // Lanzadores: no lanzan a través de paredes
  reset();
  const wall = (type) => { for (let x = -3; x <= 3; x++) for (let y = 65; y <= 68; y++) ow.setBlockType({ x, y, z: 5 }, type); };
  wall('minecraft:stone');
  const dm = ow.spawnEntity('rpg:dark_mage', { x: 0.5, y: 65, z: 9.5 });
  const l0 = fx.stats.launched;
  p._hp.cur = 200;
  Math.random = () => 0;
  bosses.casterTick();
  restoreRnd();
  await advance(30);
  check('mago oscuro no ataca a través de una pared', fx.stats.launched === l0 && p._hp.cur === 200);
  // maldición enemiga a través de la pared: no afecta
  magic.clearStatuses(p);
  dm.teleport({ x: 0.5, y: 65, z: 7.5 });
  dm._view = { x: 0, y: 0, z: -1 };
  magic.enemyCast(dm, 'oscuridad', 'curse', p, 6, { tier: 2 });
  await advance(10);
  check('maldición enemiga no atraviesa paredes', p._hp.cur === 200 && !magic.hasStatus(p, 'maldito'), `vida=${p._hp.cur}`);
  wall('minecraft:air');
  Math.random = () => 0;
  bosses.casterTick();
  restoreRnd();
  await advance(30);
  check('sin pared sí lanza', fx.stats.launched > l0);

  // Reina Araña: una sola maldición aunque haya varios jugadores
  reset();
  const p2 = world.addPlayer('Aprendiz');
  p2.teleport({ x: 2.5, y: 65, z: 0.5 });
  p2._hp = { cur: 200, max: 200 };
  ow.spawnEntity('rpg:spider_queen', { x: 0.5, y: 65, z: 6.5 });
  const kinds = [];
  bosses.hooks.enemyCast = (c, el, kind, ...rest) => { kinds.push(kind); return magic.enemyCast(c, el, kind, ...rest); };
  Math.random = () => 0.9;
  bosses.bossTick();
  restoreRnd();
  await advance(10);
  check('Reina Araña: una maldición por turno (no una por jugador)', kinds.filter((k) => k === 'curse').length === 1, kinds.join(','));
  bosses.hooks.enemyCast = magic.enemyCast;
  p2.remove();

  // Liche: nunca se teletransporta dentro de bloques
  reset();
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 65; y <= 68; y++) if (!(x === 0 && z === 0 && y <= 66)) ow.setBlockType({ x, y, z }, 'minecraft:stone');
  const lich = ow.spawnEntity('rpg:lich', { x: 0.5, y: 65, z: 15.5 });
  Math.random = () => 0.4; // rama de teletransporte
  bosses.bossTick();
  restoreRnd();
  await advance(2);
  check('Liche: no se teletransporta a un túnel sin hueco', lich.location.z === 15.5, JSON.stringify(lich.location));
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 65; y <= 68; y++) ow.setBlockType({ x, y, z }, 'minecraft:air');
  const lich2 = ow.spawnEntity('rpg:lich', { x: 0.5, y: 65, z: 15.5 });
  Math.random = () => 0.4;
  bosses.bossTick();
  restoreRnd();
  await advance(2);
  check('Liche: con espacio libre sí se teletransporta junto al jugador', Math.hypot(lich2.location.x - 0.5, lich2.location.z - 0.5) < 4.5, JSON.stringify(lich2.location));
}

/* ------------------------------------------------------------------ */
console.log('--- Rendimiento y robustez ---');
reset();
for (let i = 0; i < 80; i++) { d.mana = 9999; magic.castSkill(p, d, skill('fuego', 0)); }
check('límite de proyectiles por jugador', fx.activeProjectiles() <= fx.MAX_PER_OWNER, `activos=${fx.activeProjectiles()}`);
const others = [];
for (let i = 0; i < 6; i++) { const m = ow.spawnEntity('rpg:dark_mage', { x: i * 3, y: 65, z: 30 }); others.push(m); for (let k = 0; k < 12; k++) magic.enemyCast(m, 'fuego', 'bolt', p, 1); }
check('límite global de proyectiles', fx.activeProjectiles() <= fx.MAX_PROJECTILES, `activos=${fx.activeProjectiles()}`);
const p0 = log.particles;
await advance(1);
check('presupuesto de partículas por tick', log.particles - p0 <= fx.PARTICLE_BUDGET + 120, `partículas=${log.particles - p0}`);
await advance(80);

// Si el motor rechaza excludeTypes (identificador desconocido), las colisiones siguen funcionando
reset();
const origGet = ow.getEntities;
ow.getEntities = function (o = {}) { if (o.excludeTypes?.includes('rpg:tomato')) throw new Error('Invalid entity type'); return origGet.call(this, o); };
t = orc(0.7, 6.5);
cast('fuego', 0);
await advance(8);
delete ow.getEntities;
check('colisiones con consulta de respaldo (excludeTypes rechazado)', lost(t) > 0);

// Todas las habilidades (12 × 50) y todos los tipos de hechizo enemigo para cada elemento
reset();
const t0 = Date.now();
let castErr = 0;
for (const el of ELEMENT_IDS) {
  for (let i = 0; i < 50; i++) {
    const e = orc(0.7, 4.5, 300);
    try { cast(el, i); } catch (err) { castErr++; console.log('cast error', el, i, err); }
    await advance(2);
    e.remove();
  }
  for (const kind of ['bolt', 'lance', 'nova', 'curse', 'zone', 'rain', 'barrage', 'ward']) {
    try { magic.enemyCast(mage, el, kind, p, 3, { tier: 4 }); } catch (err) { castErr++; console.log('enemy error', el, kind, err); }
  }
  await advance(2);
  p._hp.cur = 200;
}
await advance(300);
console.log(`  600 hechizos + 96 enemigos en ${Date.now() - t0} ms`);
check('600 hechizos + hechizos enemigos sin excepciones', castErr === 0);
check('motor de efectos sin errores internos', fx.stats.errors === 0, String(fx.stats.lastError?.stack ?? fx.stats.lastError ?? ''));
check('los bucles se detienen solos cuando no hay nada activo', fx.activeProjectiles() === 0);

console.log('WARNINGS:', errs.length, errs.slice(0, 10));
console.log('TIMER/JOB ERRORS:', log.errors.length, log.errors.slice(0, 3));
if (errs.length || log.errors.length) process.exitCode = 1;
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
process.exit();
