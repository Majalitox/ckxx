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
const birth = await import('./scripts/systems/birth.js');
world.afterEvents.worldLoad.fire({});
world.afterEvents.entityDie.subscribe((ev) => set.onEntityDie(ev));
system.runInterval(() => { try { set.settlementTick(); } catch (e) { console.error('TICK', e); errs.push(String(e)); } }, 40);

const W = () => store.W();

/* ---------------- Réplica de vóxeles de /fill y /setblock ---------------- */
// El mock no aplica /fill: reproducimos los comandos en una rejilla para comprobar que se puede
// entrar en los edificios, que las anclas de los NPC no quedan dentro de bloques, etc.
// 'hollow' rellena las 6 caras (también la inferior) y vacía el interior, como en Bedrock.
class Vox {
  constructor(x0, y0, z0, x1, y1, z1, base) {
    Object.assign(this, { x0, y0, z0, nx: x1 - x0 + 1, ny: y1 - y0 + 1, nz: z1 - z0 + 1, base });
    this.pal = [];
    this.ids = new Map();
    this.a = new Uint16Array(this.nx * this.ny * this.nz);
    for (let y = y0; y <= y1; y++) {
      const v = this.code(base(y));
      for (let z = 0; z < this.nz; z++) this.a.fill(v, ((y - y0) * this.nz + z) * this.nx, ((y - y0) * this.nz + z + 1) * this.nx);
    }
  }
  code(id) { let c = this.ids.get(id); if (c === undefined) { c = this.pal.length; this.pal.push(id); this.ids.set(id, c); } return c; }
  idx(x, y, z) {
    x -= this.x0; y -= this.y0; z -= this.z0;
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return -1;
    return (y * this.nz + z) * this.nx + x;
  }
  get(x, y, z) { const i = this.idx(Math.floor(x), Math.floor(y), Math.floor(z)); return i < 0 ? this.base(Math.floor(y)) : this.pal[this.a[i]]; }
  set(x, y, z, id) { const i = this.idx(x, y, z); if (i >= 0) this.a[i] = this.code(id); }
  /** k 'f'|'s', caja, bloque, modo ('', hollow, outline, keep, replace X). */
  apply(k, c, blk, mode = '', rep = '') {
    let [x1, y1, z1, x2, y2, z2] = k === 's' ? [c[0], c[1], c[2], c[0], c[1], c[2]] : c;
    [x1, x2] = [Math.min(x1, x2), Math.max(x1, x2)];
    [y1, y2] = [Math.min(y1, y2), Math.max(y1, y2)];
    [z1, z2] = [Math.min(z1, z2), Math.max(z1, z2)];
    const ax = Math.max(x1, this.x0), bx = Math.min(x2, this.x0 + this.nx - 1);
    const ay = Math.max(y1, this.y0), by = Math.min(y2, this.y0 + this.ny - 1);
    const az = Math.max(z1, this.z0), bz = Math.min(z2, this.z0 + this.nz - 1);
    if (ax > bx || ay > by || az > bz) return;
    const v = this.code(blk);
    const air = this.code('air');
    const rc = rep ? this.code(rep) : -1;
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
      const i = this.idx(x, y, z);
      const edge = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
      if (mode === 'hollow') this.a[i] = edge ? v : air;
      else if (mode === 'outline') { if (edge) this.a[i] = v; }
      else if (mode === 'keep') { if (this.a[i] === air) this.a[i] = v; }
      else if (mode === 'replace') { if (this.a[i] === rc) this.a[i] = v; }
      else this.a[i] = v;
    }
  }
  /** Comando de texto (log.commands). */
  cmd(c) {
    const m = /^(fill|setblock) (-?\d+) (-?\d+) (-?\d+)(?: (-?\d+) (-?\d+) (-?\d+))? ([a-z_:]+)(?: \[[^\]]*\])?(?: (hollow|keep|outline|destroy|replace)(?: ([a-z_:]+))?)?$/.exec(c);
    if (!m) return;
    const n = m.slice(2, 8).filter((v) => v !== undefined).map(Number);
    this.apply(m[1] === 'fill' ? 'f' : 's', n, m[8].replace('minecraft:', ''), m[9] === 'destroy' ? '' : (m[9] ?? ''), m[10] ?? '');
  }
  /** Operación de un Plan (structures.js). */
  op(o) {
    const id = String(o.b[0]).split(' [')[0].trim();
    const [mode, rep] = (o.m ?? '').split(' ');
    this.apply(o.k, o.a.split(' ').map(Number), id, mode ?? '', rep ?? '');
  }
}
const SMALL_PLANTS = /^(poppy|dandelion|oxeye_daisy|cornflower|\w+_tulip|allium|azure_bluet|lily_of_the_valley|blue_orchid|wither_rose|torchflower|short_grass|tallgrass|fern|deadbush|pink_petals|rose_bush|red_flower|yellow_flower)$/;
const passable = (b) => b === 'air' || /_carpet$|pressure_plate$|_door$|fence_gate$|^ladder$/.test(b) || SMALL_PLANTS.test(b);
const solid = (b) => !passable(b) && !/water|lava|lantern/.test(b);
/** Se puede estar de pie en p: dos bloques libres y suelo firme debajo. */
function standable(V, p) {
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  const f = V.get(x, y, z), h = V.get(x, y + 1, z), u = V.get(x, y - 1, z);
  return { ok: passable(f) && passable(h) && solid(u), why: `${f}/${h} sobre ${u}` };
}
/** ¿Puede alguien salir de la caja (min..max) desde p por bloques transitables (relleno 3D)? */
function escapes(V, p, min, max) {
  const st = [[Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]];
  const seen = new Set([st[0].join()]);
  while (st.length) {
    const [x, y, z] = st.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = [x + dx, y + dy, z + dz];
      const k = n.join();
      if (seen.has(k) || !passable(V.get(...n))) continue;
      if (n[0] < min.x - 1 || n[0] > max.x + 1 || n[1] < min.y - 1 || n[1] > max.y + 1 || n[2] < min.z - 1 || n[2] > max.z + 1) return true;
      seen.add(k);
      st.push(n);
    }
  }
  return false;
}

/* ---------------- Edificios: se puede entrar y las anclas son transitables ---------------- */
{
  const S = await import('./scripts/systems/structures.js');
  const { seeded } = await import('./scripts/util/math.js');
  const Y0 = 65;
  const probs = [];
  let jails = 0;
  let built = 0;
  for (const cid of C.CULTURE_IDS) {
    const cul = C.cultureOf(cid);
    for (const type of Object.keys(S.BUILDERS)) {
      for (const extra of type === 'market' ? [{ small: true }, {}, { big: true }] : type === 'temple' ? [{ small: true }, {}] : type === 'jail' ? [{ cells: 2 }, { cells: 3 }] : [{}]) {
        for (let r = 0; r < 4; r++) {
          const rng = seeded(cid.length * 1000 + type.length * 37 + r * 7 + (extra.cells ?? 0) + (extra.small ? 3 : 0) + (extra.big ? 5 : 0));
          const plan = new S.Plan(rng);
          const [w, d] = S.sizeOf(type, cul, rng, extra);
          const cv = new S.Canvas(plan, 0, Y0, 0, w, d, r);
          const ctx = { cul, rng, plan, wool: ['red', 'yellow'], kind: 'pueblo', cls: 'media', cells: extra.cells };
          const inf = S.BUILDERS[type](cv, ctx) ?? {};
          built++;
          // Terreno nivelado como tras prepSite: suelo en Y0-1, aire desde Y0.
          const V = new Vox(-12, Y0 - 8, -12, w + d + 12, Y0 + 40, w + d + 12, (y) => (y < Y0 - 1 ? 'stone' : y === Y0 - 1 ? 'grass_block' : 'air'));
          for (const o of plan.ops) V.op(o);
          const tag = `${cid}/${type}${extra.small ? '-s' : extra.big ? '-b' : extra.cells ? '-' + extra.cells : ''}/r${r}`;
          if (inf.door) {
            for (const dy of [0, 1]) {
              const b = V.get(inf.door.x, inf.door.y + dy, inf.door.z);
              if (!passable(b)) probs.push(`${tag} puerta y+${dy}: ${b}`);
            }
          }
          for (const k of ['inside', 'work', 'shop', 'wp', 'court', 'throne']) {
            if (!inf[k]) continue;
            const st = standable(V, inf[k]);
            if (!st.ok) probs.push(`${tag} ${k}: ${st.why}`);
          }
          for (const [i, g] of (inf.guards ?? []).entries()) { const st = standable(V, g); if (!st.ok) probs.push(`${tag} guards[${i}]: ${st.why}`); }
          if (inf.jail) {
            jails++;
            for (const [i, c] of inf.jail.cells.entries()) {
              const st = standable(V, c.spawn);
              if (!st.ok) probs.push(`${tag} celda${i} spawn: ${st.why}`);
              const sy = Math.floor(c.spawn.y);
              if (c.door[0].y !== sy || c.door[1].y !== sy + 1) probs.push(`${tag} celda${i} barrotes a y=${c.door.map((p) => p.y)} (preso en ${sy})`);
              if (c.door.some((p) => V.get(p.x, p.y, p.z) !== 'iron_bars')) probs.push(`${tag} celda${i} puerta sin barrotes`);
              if (escapes(V, c.spawn, c.min, c.max)) probs.push(`${tag} celda${i} no está cerrada`);
              for (const p of c.door) V.set(p.x, p.y, p.z, 'air');
              if (!escapes(V, c.spawn, c.min, c.max)) probs.push(`${tag} celda${i}: con la puerta abierta no se puede salir`);
            }
          }
        }
      }
    }
  }
  check(`edificios: puertas y anclas transitables (${built} variantes, ${jails} cárceles)`, probs.length === 0, `${probs.length}: ${probs.slice(0, process.env.ALLP ? 999 : 8).join(' | ')}`);
}

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
// Descubrimiento de la villa (el jugador ya está dentro; se espera a que acabe la cinemática de nacimiento)
await until(() => !birth.cinematicActive?.(p), 20000);
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

/* ---------------- Habitantes que se mudan (boda) y NPCs sobrantes ---------------- */
{
  const npcMod = await import('./scripts/systems/npc.js');
  const identOf = (e) => JSON.parse(e.getDynamicProperty('rpg:npc'));
  const townsfolk = () => ow.getEntities({ type: 'rpg:npc', tags: ['rpg_set_' + starter.id] }).filter((e) => { const i = identOf(e); return starter.residents.includes(i.id) && i.job !== 'guardia'; });
  const copies = (id) => ow.getEntities({ type: 'rpg:npc', tags: ['rpg_fid_' + id] });
  const inRoster = (id) => set.rosterOf(starter.id).some((r) => r.i?.id === id);
  const home = { x: fam.x + 0.5, y: fam.y, z: fam.z + 1.5 };
  const marry = (e) => { const i = identOf(e); e.remove(); delete i.settlement; delete i.realm; i.spouseOf = p.name; i.spouseId = p.id; npcMod.spawnNpc(ow, home, i); return i; };
  // 1) npc.propose llama a releaseResident (interfaz acordada)
  const g1e = townsfolk()[0];
  const g1i = identOf(g1e);
  check('releaseResident: fuera de la lista y de residents', set.releaseResident?.(starter.id, g1i.id) && !starter.residents.includes(g1i.id) && !inRoster(g1i.id));
  marry(g1e);
  await advance(40 * 12);
  check('pareja: sin clon en el pueblo (releaseResident)', copies(g1i.id).length === 1 && !copies(g1i.id)[0].hasTag('rpg_set_' + starter.id));
  // 2) Sin releaseResident (npc.js antiguo): la copia sin etiqueta del pueblo basta para no clonarla
  const g2e = townsfolk()[0];
  const g2i = marry(g2e);
  await advance(40 * 12);
  check('pareja: sin clon aunque no se llame a releaseResident', copies(g2i.id).length === 1 && !starter.residents.includes(g2i.id) && !inRoster(g2i.id), String(copies(g2i.id).length));
  // 3) Clon ya creado (partidas antiguas): se retira el del pueblo, se queda la pareja
  const g3e = townsfolk()[0];
  const g3i = identOf(g3e);
  const clone = { ...g3i };
  marry(g3e);
  const ce = npcMod.spawnNpc(ow, { x: starter.plaza.x, y: starter.plaza.y, z: starter.plaza.z }, clone);
  ce.addTag('rpg_set_' + starter.id);
  await advance(40 * 12);
  check('pareja: clon antiguo retirado', copies(g3i.id).length === 1 && !copies(g3i.id)[0].hasTag('rpg_set_' + starter.id) && !inRoster(g3i.id));
  // 4) Pareja en una casa sin cargar: d.spouse + casa del jugador → no se recrea en el pueblo
  const dd0 = store.getP(p);
  const hadHouse = dd0.family?.house;
  if (!dd0.family) dd0.family = {};
  if (!dd0.family.house) dd0.family.house = { x: fam.x, y: fam.y, z: fam.z, dim: 'overworld' };
  const g4e = townsfolk()[0];
  const g4i = identOf(g4e);
  g4e.remove();
  dd0.spouse = g4i.id;
  await advance(40 * 12);
  check('pareja lejos (sin cargar): no se recrea en el pueblo', copies(g4i.id).length === 0 && !inRoster(g4i.id));
  delete dd0.spouse;
  if (!hadHouse) delete dd0.family.house;
  // 5b) Pareja que se queda en el pueblo (jugador sin casa) aunque se haya liberado de la lista: no se borra
  const g5e = townsfolk()[0];
  const g5i = identOf(g5e);
  set.releaseResident?.(starter.id, g5i.id);
  dd0.spouse = g5i.id;
  await advance(40 * 12);
  check('pareja que vive en el pueblo: no se retira como sobrante', g5e.isValid && copies(g5i.id).length === 1);
  delete dd0.spouse;
  g5e.remove();
  // 5) NPCs del pueblo que no están en la lista (obra interrumpida): sobran
  const orphan = npcMod.spawnNpc(ow, { x: starter.plaza.x, y: starter.plaza.y, z: starter.plaza.z }, npcMod.makeIdentity({ role: 'aldeano', job: 'aldeano', settlement: starter.id, realm: starter.realmId, cls: 'baja' }));
  orphan.addTag('rpg_set_' + starter.id);
  await advance(40 * 12);
  check('NPC huérfano del pueblo retirado', !orphan.isValid);
  check('habitantes = NPCs del pueblo', ow.getEntities({ type: 'rpg:npc', tags: ['rpg_set_' + starter.id] }).length === starter.residents.length + starter.guards.length);
}

/* ---------------- Ataque nocturno ---------------- */
const config = await import('./scripts/core/config.js');
const raidChance0 = config.cfg('raidChance');
config.setCfg('raidChance', 0); // sin ataques al azar durante las pruebas guionizadas
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
{
  // Invasores que se van a chunks sin cargar (el mock los «descarga» quitándolos de la dimensión):
  // no es una victoria; al volver a cargarse, el mantenimiento los retira.
  world._time = 14000;
  const gold1 = d.gold;
  check('startRaid (2)', set.startRaid(starter));
  const rs = ow.getEntities({ tags: ['rpg_raid_' + starter.id] });
  rs[0].applyDamage(9999, { cause: 'entityAttack', damagingEntity: p });
  const hidden = rs.slice(1);
  for (const r of hidden) ow._ents.delete(r);
  await advance(40 * 4);
  check('sin victoria mientras los invasores no estén muertos', !!set.activeRaid() && defended === 1);
  await advance(40 * 16);
  const since = p._msgs.slice(p._msgs.findLastIndex((m) => m.includes('¡Ataque a')));
  check('invasores perdidos: ataque terminado sin recompensa', !set.activeRaid() && defended === 1 && !since.some((m) => m.includes('vitorean')) && since.some((m) => m.includes('se dispersan')));
  for (const r of hidden) ow._ents.add(r);
  await advance(40 * 12);
  check('invasores sobrantes retirados por el mantenimiento', hidden.every((r) => !r.isValid) && ow.getEntities({ tags: ['rpg_raid_' + starter.id] }).length === 0);
  // Ataque cancelado porque el jugador se va (invasores descargados) y reinicio del estado
  check('startRaid (3)', set.startRaid(starter));
  const rs3 = ow.getEntities({ tags: ['rpg_raid_' + starter.id] });
  for (const r of rs3) ow._ents.delete(r);
  const back = { ...p.location };
  // > radio + 120 (sin jugadores cerca) pero < 350 (sin generar asentamientos nuevos)
  p.teleport({ x: starter.center.x + 250, y: 65, z: starter.center.z });
  await advance(40 * 33);
  check('ataque cancelado sin jugadores cerca', !set.activeRaid());
  for (const r of rs3) ow._ents.add(r);
  p.teleport(back);
  await advance(40 * 12);
  check('invasores de un ataque cancelado retirados', rs3.every((r) => !r.isValid));
}
config.setCfg('raidChance', raidChance0);
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

/* ---------------- Exploración: criba previa, obras de jugadores, espera creciente ---------------- */
{
  const tam = world.tickingAreaManager;
  const origCreate = tam.createTickingArea;
  let areasMade = 0;
  tam.createTickingArea = (...a) => { areasMade++; return origCreate(...a); };
  let biomeCalls = 0;
  const origBiome = DimProto.getBiome;
  DimProto.getBiome = function (...a) { biomeCalls++; return origBiome.apply(this, a); };
  const origTop = DimProto.getTopmostBlock;
  let pmZone = null; // (x, z) → bool: columnas con tablones (obra de jugador)
  DimProto.getTopmostBlock = function (l) {
    if (pmZone?.(Math.floor(l.x), Math.floor(l.z))) return { typeId: 'minecraft:oak_planks', location: { x: Math.floor(l.x), y: 64, z: Math.floor(l.z) }, isAir: false, isLiquid: false, isValid: true };
    return origTop.call(this, l);
  };
  const nS = () => set.allSettlements().length;
  const nR = () => set.allRealms().length;
  const lastX = Math.max(...set.allSettlements().map((s) => s.center.x));
  // a) Océano: se descarta sin crear zonas de carga, y cada vez se espera más
  biomeId = 'minecraft:ocean';
  p.teleport({ x: lastX + 600, y: 65, z: 3000 });
  await advance(40);
  const s0 = nS();
  const a0 = areasMade;
  const b0 = biomeCalls;
  await walkTo(lastX + 600 + 1800, 3000, 180); // 3600 ticks (3 min) caminando
  check('océano: ningún asentamiento ni zona de carga', nS() === s0 && areasMade === a0, `${nS() - s0} / ${areasMade - a0}`);
  check('océano: reintentos con espera creciente', biomeCalls - b0 >= 1 && biomeCalls - b0 <= 4, String(biomeCalls - b0));
  // b) Construcciones de jugadores por todas partes: descartado en la criba
  biomeId = 'minecraft:plains';
  let pmHits = 0;
  pmZone = (x, z) => z > 5000 && z < 7000 && (x + z) % 2 === 0 && ++pmHits > 0;
  p.teleport({ x: lastX + 600, y: 65, z: 6000 });
  await advance(40);
  const s1 = nS();
  const a1 = areasMade;
  await walkTo(lastX + 600 + 1800, 6000, 300);
  check('obras de jugadores: solar descartado sin cargar terreno', pmHits > 0 && nS() === s1 && areasMade === a1, `${pmHits} · ${nS() - s1} / ${areasMade - a1}`);
  // c) Obras que la criba no ve (aparecen tras elegir el solar): se descartan al medir, sin construir
  pmZone = null;
  const s2 = nS();
  const r2 = nR();
  const cmds0 = log.commands.length;
  p.teleport({ x: lastX + 600, y: 65, z: 9000 });
  let cand = null;
  for (let t = 0; t < 12000 && !cand; t++) {
    if (t % 20 === 0) p.teleport({ x: p.location.x + 10, y: 65, z: 9000 });
    await advance(1);
    if (nS() > s2) {
      cand = set.allSettlements().at(-1);
      const cx = cand.center.x + 7;
      const cz = cand.center.z - 5;
      pmZone = (x, z) => x === cx && z === cz;
    }
  }
  await until(() => !set.isBuilding(), 4000);
  const near = (c) => { const n = c.split(' ').slice(1, 4).map(Number); return cand && Math.hypot(n[0] - cand.center.x, n[2] - cand.center.z) < cand.radius + 30; };
  const builtCmds = log.commands.slice(cmds0).filter((c) => /^(fill|setblock)/.test(c) && near(c));
  check('obras de jugadores al medir: asentamiento descartado sin obras', !!cand && !cand.built && nS() === s2 && builtCmds.length === 0, `${cand?.name} · ${builtCmds.length} comandos`);
  check('obras de jugadores al medir: sin reino huérfano', nR() === r2 || set.allRealms().every((r) => r.starter || set.allSettlements().some((s) => s.realmId === r.id)), `${r2} → ${nR()}`);
  pmZone = null;
  DimProto.getTopmostBlock = origTop;
  DimProto.getBiome = origBiome;
  tam.createTickingArea = origCreate;
}

/* ---------------- Réplica de vóxeles de cada asentamiento ---------------- */
{
  const fills = log.commands.filter((c) => c.startsWith('fill') || c.startsWith('setblock'));
  const all = [];
  for (const s of set.allSettlements().filter((x) => x.built)) {
    const { x: cx, z: cz } = s.center;
    const R = s.radius + 24;
    const V = new Vox(cx - R, 40, cz - R, cx + R, 160, cz + R, (y) => (y < 64 ? 'stone' : y === 64 ? 'grass_block' : 'air'));
    for (const c of fills) V.cmd(c);
    const probs = [];
    const at = (name, pos) => { if (!pos) return; const st = standable(V, pos); if (!st.ok) probs.push(`${name}@${Math.floor(pos.x - cx)},${Math.floor(pos.y)},${Math.floor(pos.z - cz)} ${st.why}`); };
    at('plaza', s.plaza);
    // Puntos de guardia de la plaza (no se guardan en el registro): a 3 bloques del centro en el eje X
    if (s.plaza) { at('guardia.plaza.E', { x: cx + 3.5, y: s.plaza.y, z: cz + 0.5 }); at('guardia.plaza.O', { x: cx - 2.5, y: s.plaza.y, z: cz + 0.5 }); }
    at('picota', s.stocks);
    at('trono', s.throne);
    for (const sh of s.shops) { at(sh.kind + '.at', sh.at); at(sh.kind + '.wp', sh.wp); }
    for (const h of s.houses) {
      at('casa.' + h.id, h.home);
      for (const dy of [0, 1]) { const b = V.get(h.door.x, h.door.y + dy, h.door.z); if (!passable(b)) probs.push(`puerta.${h.id} y+${dy}: ${b}`); }
    }
    if (s.jail) {
      for (const [i, c] of s.jail.cells.entries()) {
        at('celda' + i, c.spawn);
        if (c.door[0].y !== Math.floor(c.spawn.y)) probs.push(`celda${i}: barrotes en y=${c.door[0].y}, preso en ${Math.floor(c.spawn.y)}`);
        if (c.door.some((q) => V.get(q.x, q.y, q.z) !== 'iron_bars')) probs.push(`celda${i}: puerta sin barrotes`);
        if (escapes(V, c.spawn, c.min, c.max)) probs.push(`celda${i}: se puede salir`);
        for (const q of c.door) V.set(q.x, q.y, q.z, 'air');
        if (!escapes(V, c.spawn, c.min, c.max)) probs.push(`celda${i}: abierta y sin salida`);
      }
      at('cárcel.salida', s.jail.exit);
      at('cárcel.patrulla', s.jail.patrol);
    }
    // Murallas: con las puertas (3 celdas en el eje de cada camino) cerradas, no se puede pasar de
    // fuera a dentro a la altura del suelo (y 65-66 en el mock, terreno llano).
    if (s.walls) {
      const Rw = s.radius - 17;
      const B = Rw + 3;
      const gate = (x, z) => (Math.abs(x - cx) === Rw && Math.abs(z - cz) <= 1) || (Math.abs(z - cz) === Rw && Math.abs(x - cx) <= 1);
      const open = (x, z) => !gate(x, z) && passable(V.get(x, 65, z)) && passable(V.get(x, 66, z));
      const seen = new Set();
      const st = [];
      for (let t = -B; t <= B; t++) for (const [x, z] of [[cx + t, cz - B], [cx + t, cz + B], [cx - B, cz + t], [cx + B, cz + t]]) if (open(x, z)) { seen.add(x + ',' + z); st.push([x, z]); }
      const leaks = [];
      while (st.length) {
        const [x, z] = st.pop();
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) < Rw - 3) { leaks.push(`${x - cx},${z - cz}`); if (leaks.length > 3) break; continue; }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (Math.max(Math.abs(nx - cx), Math.abs(nz - cz)) > B || seen.has(nx + ',' + nz) || !open(nx, nz)) continue;
          seen.add(nx + ',' + nz);
          st.push([nx, nz]);
        }
      }
      // Hueco = celda del lienzo alcanzable desde fuera que comunica con el interior
      const holes = [];
      for (let t = -Rw; t <= Rw; t++) for (const [x, z] of [[cx + t, cz - Rw], [cx + t, cz + Rw], [cx - Rw, cz + t], [cx + Rw, cz + t]]) {
        if (!seen.has(x + ',' + z)) continue;
        const ins = [[x + Math.sign(cx - x), z], [x, z + Math.sign(cz - z)]];
        if (ins.some(([a, b]) => open(a, b) && Math.max(Math.abs(a - cx), Math.abs(b - cz)) < Rw)) holes.push(`${x - cx},${z - cz}`);
      }
      if (leaks.length || holes.length) probs.push(`muralla con huecos: ${[...new Set(holes)].slice(0, 8).join(' ')} (llega dentro: ${leaks.join(' ')})`);
      if (s.gates.length !== 4) probs.push(`muralla: ${s.gates.length} puertas`);
    }
    if (probs.length) all.push(`${s.name}(${s.kind},${s.culture}): ${probs.slice(0, 5).join(' · ')}`);
  }
  check('asentamientos: anclas, puertas, celdas y murallas (réplica de vóxeles)', all.length === 0, all.slice(0, 6).join(' | '));
}

/* ---------------- Obra atascada: se aborta, se cancela su trabajo y se repuebla sin duplicados ---------------- */
{
  const last = set.allSettlements().filter((s) => s.built).at(-1);
  p.teleport({ x: last.center.x, y: 65, z: last.center.z + 20 });
  const old = ow.getEntities({ tags: ['rpg_set_' + last.id] }); // NPCs y marcadores de la primera población
  const n0 = old.filter((e) => e.typeId === 'rpg:npc').length;
  const origRunJob = system.runJob;
  let stalled = 0;
  system.runJob = () => { stalled++; return 987654321; }; // el trabajo nunca avanza
  last.built = false;
  await until(() => stalled > 0, 4000);
  check('obra atascada en marcha', stalled === 1 && set.isBuilding(), set.constructionStatus());
  await advance(20 * 590);
  check('obra atascada: sigue antes de 10 min', set.isBuilding() && stalled === 1);
  // La obra atascada ya no avanzará; las siguientes (tras abortarla) usan el runJob real.
  system.runJob = origRunJob;
  const aborted = () => errs.some((e) => e.includes('Obras abortadas por tiempo: ' + last.id));
  await until(aborted, 20 * 60);
  check('obra atascada abortada a los 10 min', aborted() && stalled === 1);
  await until(() => last.built, 20000);
  for (const e of errs.filter((x) => /Obras abortadas|interrumpida/.test(x))) errs.splice(errs.indexOf(e), 1);
  const ents = ow.getEntities({ type: 'rpg:npc', tags: ['rpg_set_' + last.id] });
  const fids = new Set(ents.map((e) => e.getTags().find((t) => t.startsWith('rpg_fid_'))));
  check('rehecha: una sola población, sin duplicados', last.built && old.every((e) => !e.isValid) && ents.length === last.residents.length + last.guards.length && fids.size === ents.length, `${n0} → ${ents.length} (${last.residents.length}+${last.guards.length}), quedan ${old.filter((e) => e.isValid).length} de antes`);
  const wpsL = ow.getEntities({ type: 'rpg:waypoint', tags: ['rpg_set_' + last.id] });
  check('rehecha: marcadores sin duplicados', wpsL.length === set.waypointList(last).length, `${wpsL.length}/${set.waypointList(last).length}`);
}

/* ---------------- Textos ---------------- */
check('etiqueta del pueblo enano en español', C.kindLabel('enano', 'pueblo') === 'Bastión enano' && !C.CULTURE_IDS.some((c) => ['aldea', 'pueblo', 'ciudad', 'capital', 'inicio'].some((k) => /\bHold\b/i.test(C.kindLabel(c, k)))));

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
