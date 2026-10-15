// Prueba del área "bp-data": contrasta lo que los scripts hacen con las entidades en tiempo de ejecución
// (eventos, propiedades y apariciones con evento) con el JSON que genera tools/build.py.
// Ejecutar: python3 tools/build.py --no-zip && tools/sim/run.sh test_bpdata.mjs
//   BPDATA_FAST=1 -> no ejecuta las otras suites (solo comprobaciones estáticas).
// Para registrar lo que hacen los scripts, vuelve a lanzar las demás suites con AETHERIA_RECORD (el mock
// de @minecraft/server anota entonces cada triggerEvent / setProperty / spawnEntity).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('../../..');
const BP = path.join(ROOT, 'packs', 'AetheriaRPG_BP');
let fails = 0;
let oks = 0;
const check = (name, cond, extra = '') => {
  if (cond) oks++;
  else { fails++; process.exitCode = 1; }
  if (!cond || process.env.BPDATA_VERBOSE) console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  return cond;
};

/* ---------------- JSON generado ---------------- */
const entDir = path.join(BP, 'entities');
if (!fs.existsSync(path.join(entDir, 'npc.json'))) {
  console.log('FAIL no hay JSON generado: ejecuta antes  python3 tools/build.py --no-zip');
  process.exit(1);
}
const ENT = {};
for (const f of fs.readdirSync(entDir)) {
  const d = JSON.parse(fs.readFileSync(path.join(entDir, f), 'utf8'));
  const e = d['minecraft:entity'];
  ENT[e.description.identifier] = { events: new Set(Object.keys(e.events ?? {})), groups: new Set(Object.keys(e.component_groups ?? {})), props: e.description.properties ?? {}, e };
}
const ITEMS = new Set(fs.readdirSync(path.join(BP, 'items')).map((f) => JSON.parse(fs.readFileSync(path.join(BP, 'items', f), 'utf8'))['minecraft:item'].description.identifier));

/* ---------------- Comprobaciones estáticas ---------------- */
const social = await import('./scripts/data/social.js');
check('data/social.js exporta ACTIVITIES', Array.isArray(social.ACTIVITIES) && social.ACTIVITIES.length >= 20);
for (const a of social.ACTIVITIES ?? []) {
  check(`rpg:npc tiene rpg:act_${a}`, ENT['rpg:npc']?.events.has(`rpg:act_${a}`) && ENT['rpg:npc']?.groups.has(`rpg:act_${a}`));
}
for (const [act, kind] of Object.entries(social.ACT_WAYPOINT ?? {})) {
  check(`marcador ${kind} (para ${act})`, ENT['rpg:waypoint']?.events.has(`rpg:wp_${kind}`));
  const grp = JSON.stringify(ENT['rpg:npc']?.e.component_groups?.[`rpg:act_${act}`] ?? {});
  check(`rpg:act_${act} va a rpg_wp_${kind}`, grp.includes(`"rpg_wp_${kind}"`));
}
for (const k of ['guard', 'citizen', 'staff', 'resident']) {
  check(`rpg:spawn_${k} y rpg:make_${k}`, ENT['rpg:npc']?.events.has(`rpg:spawn_${k}`) && ENT['rpg:npc']?.events.has(`rpg:make_${k}`));
}
for (const id of ['rpg:jail_key', 'rpg:tomato', 'rpg:lockpick', 'rpg:noble_title', 'rpg:wanted_poster']) check(`objeto ${id}`, ITEMS.has(id));
for (const t of ['rpg:npc', 'rpg:waypoint', 'rpg:tomato', 'rpg:spirit']) check(`entidad ${t}`, !!ENT[t]);

/* ---------------- Registro dinámico de las demás suites ---------------- */
const rec = { events: {}, props: {}, spawns: {} };
const merge = (dst, src) => { for (const [k, v] of Object.entries(src ?? {})) dst[k] = [...new Set([...(dst[k] ?? []), ...v])]; };
if (!process.env.BPDATA_FAST) {
  const suites = ['test.mjs', 'test_justice.mjs', 'test_settlements.mjs', 'test_life.mjs', 'test_magic.mjs']
    .filter((s) => fs.existsSync(path.join(ROOT, 'tools', 'sim', s)));
  for (const s of suites) {
    const out = path.join(os.tmpdir(), `aetheria_rec_${process.pid}_${s}.json`);
    let status = 0;
    try {
      execFileSync('bash', [path.join(ROOT, 'tools', 'sim', 'run.sh'), s], { env: { ...process.env, AETHERIA_RECORD: out }, stdio: 'pipe', timeout: 900000 });
    } catch (err) { status = err.status ?? 1; }
    let r = {};
    try { r = JSON.parse(fs.readFileSync(out, 'utf8')); fs.unlinkSync(out); } catch {}
    console.log(`  suite ${s}: código ${status}, ${Object.values(r.events ?? {}).flat().length} eventos, ${Object.keys(r.props ?? {}).length} propiedades, ${Object.keys(r.spawns ?? {}).length} apariciones`);
    check(`la suite ${s} deja registro`, !!r.events);
    for (const k of Object.keys(rec)) merge(rec[k], r[k]);
  }
}

const JSON_TYPES = (t) => t.startsWith('rpg:') || t === 'minecraft:player';
for (const [type, evs] of Object.entries(rec.events)) {
  if (!JSON_TYPES(type)) continue;
  if (!check(`entidad ${type} existe`, !!ENT[type])) continue;
  for (const ev of evs) check(`${type}: evento ${ev}`, ENT[type].events.has(ev));
}
for (const [key, vals] of Object.entries(rec.props)) {
  const [type, prop] = key.split('|');
  if (!JSON_TYPES(type) || !ENT[type]) continue;
  const p = ENT[type].props[prop];
  if (!check(`${type}: propiedad ${prop}`, !!p)) continue;
  for (const v of vals) {
    if (p.type === 'int') check(`${type}: ${prop}=${v} en [${p.range}]`, Number.isInteger(v) && v >= p.range[0] && v <= p.range[1]);
    else if (p.type === 'bool') check(`${type}: ${prop}=${v} es bool`, typeof v === 'boolean');
    else if (p.type === 'float') check(`${type}: ${prop}=${v} en [${p.range}]`, typeof v === 'number' && v >= p.range[0] && v <= p.range[1]);
    else if (p.type === 'enum') check(`${type}: ${prop}=${v} en ${p.values}`, p.values.includes(v));
  }
}
for (const spec of Object.keys(rec.spawns)) {
  const m = /^(.*?)(?:<(.+)>)?$/.exec(spec);
  if (!m[1].startsWith('rpg:')) continue;
  if (!check(`aparición ${m[1]}`, !!ENT[m[1]])) continue;
  if (m[2]) check(`aparición ${spec}`, ENT[m[1]].events.has(m[2]));
}
const nAct = (rec.events['rpg:npc'] ?? []).filter((e) => e.startsWith('rpg:act_')).length;
if (!process.env.BPDATA_FAST) check('las suites ejercitan actividades de NPC', nAct >= 5, `(${nAct})`);

console.log(`bp-data: ${oks} OK, ${fails} FAIL`);
console.log(fails ? 'HAY FALLOS' : 'TODO OK');
