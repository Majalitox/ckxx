// Motor de conversación de los NPCs: el jugador escribe texto libre y el NPC responde
// según intención detectada, rol, personalidad, humor, relación, karma y memoria.
import { world, system } from '@minecraft/server';
import { INTENTS, RESPONSES, ROLE_RESPONSES, PERSONALITY_FLAVOR, MOOD_TEXT, FALLBACK, NPC_QUESTIONS } from '../data/dialogue.js';
import { normalize, hasKeyword, fill, truncate, cap } from '../util/text.js';
import { pick, hash, seeded } from '../util/math.js';
import { raceOf } from '../data/races.js';
import { ELEMENTS } from '../data/elements.js';
import { RANKS } from '../data/ranks.js';
import { BOSSES } from '../data/mobs.js';
import { ROLE_NAMES, regionName, jobLabel } from '../data/names.js';
import { ageYears, karmaTitle, g } from '../core/profile.js';
import { LAWS, CRIMES, STRICTNESS_NAMES } from '../data/laws.js';
import { cultureOf, GOVERNMENTS } from '../data/cultures.js';
import { CLS_NAMES, DAY_JOBS } from '../data/social.js';
import * as social from './social.js';
import * as economy from './economy.js';
import * as life from './life.js';

/* ------------------------------------------------------------------ */
/* Clima (Dimension.getWeather no existe en 2.x estable: caché del evento) */
/* ------------------------------------------------------------------ */

const weatherCache = new Map(); // dimId -> 'Clear'|'Rain'|'Thunder'
let weatherTick = -1e9;
/** Funciones que otros sistemas pueden asignar. */
export const weatherHooks = { onChange: undefined }; // (dimId, newWeather, previousWeather)

const dimKey = (id) => (String(id ?? 'minecraft:overworld').includes(':') ? String(id) : 'minecraft:' + id);

try {
  world.afterEvents.weatherChange.subscribe((ev) => {
    try {
      const k = dimKey(ev.dimension);
      weatherCache.set(k, String(ev.newWeather ?? 'Clear'));
      weatherTick = system.currentTick;
      weatherHooks.onChange?.(k, String(ev.newWeather ?? 'Clear'), String(ev.previousWeather ?? 'Clear'));
    } catch {}
  });
} catch {}

/** Clima actual conocido ('Clear', 'Rain' o 'Thunder'). */
export function currentWeather(dimId = 'minecraft:overworld') {
  return weatherCache.get(dimKey(dimId)) ?? 'Clear';
}

/** Ticks desde el último cambio de clima. */
export function ticksSinceWeather() {
  return system.currentTick - weatherTick;
}

/** Para pruebas o comandos: fija el clima conocido. */
export function setKnownWeather(w, dimId = 'minecraft:overworld') {
  weatherCache.set(dimKey(dimId), w);
  weatherTick = system.currentTick;
}

const FAMILY_ROLES = new Set(['madre', 'padre', 'hermano', 'hermana']);

export function isFamilyRole(role) {
  return FAMILY_ROLES.has(role);
}

/** Humor diario del NPC (determinista por día). */
export function moodOf(npcId) {
  const rng = seeded(hash(npcId + ':' + world.getDay()));
  return pick(['feliz', 'feliz', 'normal', 'normal', 'normal', 'cansado', 'triste', 'enojado'], rng);
}

function timeOfDay() {
  const t = world.getTimeOfDay();
  if (t < 6000) return 'Buenos días';
  if (t < 12000) return 'Buenas tardes';
  return 'Buenas noches';
}

function timeDesc() {
  let weather = '';
  const w = currentWeather();
  if (w === 'Rain') weather = 'Está lloviendo; ideal para quedarse junto al fuego. ';
  if (w === 'Thunder') weather = '¡Qué tormenta! Los rayos asustan a cualquiera. ';
  const t = world.getTimeOfDay();
  if (t < 6000) return weather + 'Es por la mañana, el mejor momento para salir de aventuras.';
  if (t < 12000) return weather + 'Ya es por la tarde. El sol empieza a caer.';
  if (t < 13000) return weather + 'Está atardeciendo... pronto saldrán los monstruos.';
  return weather + 'Es de noche. Los monstruos acechan; ten cuidado.';
}

function fem(w) {
  if (/^[EeÉé]st?e$/.test(w)) return w.slice(0, -1) + 'a'; // ese/ése/este/éste → esa/ésa/esta/ésta
  if (/ón$/.test(w)) return w.slice(0, -2) + 'ona';
  if (/ío$/.test(w)) return w.slice(0, -2) + 'ía';
  if (/o$/.test(w)) return w.slice(0, -1) + 'a';
  if (/or$/.test(w)) return w + 'a';
  return w;
}

const WORD = '[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+';
const PAIR_RE = new RegExp(`\\b([Ee]l) (${WORD})\\/([Ll]a) (${WORD})`, 'g'); // "el héroe/la heroína"
const ART_RE = /\b([Ee])l\/[Ll]a\b/g; // "el/la", "El/la"
const UN_RE = /\b([Uu])n\/[Uu]na\b/g; // "un/una"
const NPC_RE = new RegExp(`(${WORD})\\/A\\b`, 'g');
const PLAYER_RE = new RegExp(`(${WORD})\\/a\\b`, 'g');

/**
 * Resuelve el género en los textos (los pares con artículo y "el/la" siguen el género del jugador):
 * "palabra/a" y "el/la" → jugador · "palabra/A" → NPC · "el héroe/la heroína" → forma completa.
 */
export function genderize(s, playerGender, npcGender) {
  const f = playerGender === 'f';
  s = String(s ?? '');
  s = s.replace(PAIR_RE, (m, a1, w1, a2, w2) => (f ? `${a2} ${w2}` : `${a1} ${w1}`));
  s = s.replace(ART_RE, (m, e) => (f ? (e === 'E' ? 'La' : 'la') : e + 'l'));
  s = s.replace(UN_RE, (m, u) => (f ? u + 'na' : u + 'n'));
  s = s.replace(NPC_RE, (m, w) => (npcGender === 'f' ? fem(w) : w));
  s = s.replace(PLAYER_RE, (m, w) => (f ? fem(w) : w));
  return s;
}

/** Asentamiento y reino del NPC (o, si no tiene, del lugar donde está el jugador). */
export function placeCtx(c) {
  if (c._place) return c._place;
  let s = social.getSettlementSafe(c.ident?.settlement);
  let realm = s ? social.realmOfSafe(s) : social.realmById(c.ident?.realm);
  if (!s && !realm && c.player) {
    try { const p = social.nearPlace(c.player); s = p.s; realm = p.realm; } catch {}
  }
  c._place = { s, realm };
  return c._place;
}

function lawPhrase(realm) {
  const st = Math.max(0, Math.min(2, Number(realm?.strictness ?? 1) || 0));
  const name = STRICTNESS_NAMES[st] ?? 'firme';
  const tax = Math.round(economy.salesTax(realm, undefined) * 100);
  const where = realm?.name ? social.realmArt(realm.name) : 'estas tierras';
  return `En ${where} la justicia es ${name}: un hurto se paga con ${LAWS.humiliationSeconds} segundos en la picota y una lluvia de tomates; ` +
    `un delito grave, con ${LAWS.jailMinutesSerious} minutos de cárcel; y la sangre, con ${LAWS.jailMinutesMurder}. ` +
    (st === 0 ? 'Los guardias son blandos y a veces aceptan un "donativo". ' : st === 2 ? 'Aquí nadie se libra, ni con oro. ' : 'La guardia castiga lo que ve. ') +
    `El impuesto real es del ${tax} %.`;
}

function crimePhrase(d) {
  const w = d.wanted;
  if ((w?.stars ?? 0) > 0) {
    const names = (w.crimes ?? []).map((k) => CRIMES[k]?.name?.toLowerCase()).filter(Boolean);
    return `Los guardias te buscan${names.length ? ' por ' + [...new Set(names)].slice(-2).join(' y ') : ''}. Yo que tú me andaría con ojo.`;
  }
  const rec = Object.entries(d.record ?? {}).filter(([k, n]) => CRIMES[k] && n > 0).sort((a, b) => b[1] - a[1]);
  if (rec.length) return `Se dice que tienes antecedentes: ${rec.slice(0, 2).map(([k, n]) => `${CRIMES[k].name.toLowerCase()}${n > 1 ? ` (${n} veces)` : ''}`).join(' y ')}.`;
  return 'Que yo sepa, tienes las manos limpias.';
}

function realmPhrase(realm, s) {
  if (!realm) return s?.name ? `${s.name} es tierra libre: aquí no manda ningún rey.` : 'Por aquí no manda ningún rey. Tierra de nadie.';
  const gov = GOVERNMENTS[realm.government]?.name?.toLowerCase() ?? 'monarquía';
  const people = cultureOf(realm.culture)?.people ?? 'gentes diversas';
  const ruler = realm.ruler ? social.sovereign(realm).soberano : 'la corona';
  return social.fixEs(`${social.realmArt(realm.name)} es una ${gov} de ${people}, gobernada por ${ruler}.`);
}

function realmOpinion(realm, ident) {
  const pros = Number(realm?.economy?.prosperity ?? 1);
  const cls = social.npcCls(ident);
  if (pros >= 1.15) return cls === 'baja' ? 'Dicen que el reino es rico... pero a mi plato no llega.' : 'Vivimos buenos tiempos, gracias a los dioses.';
  if (pros <= 0.8) return cls === 'alta' ? 'Los campesinos se quejan de hambre; siempre se quejan.' : 'Los impuestos nos ahogan y la cosecha no da para todos.';
  return 'No nos va mal, aunque podría ir mejor.';
}

function classPhrase(d, ident, player) {
  const pc = social.playerClass(d);
  const cls = social.npcCls(ident);
  let base = `Para la gente de aquí eres ${pc.name.toLowerCase()}: ${pc.desc.charAt(0).toLowerCase() + pc.desc.slice(1)}`;
  if (pc.rank >= 5) base = cls === 'alta' ? 'Eres de los nuestros: la nobleza.' : `Sois noble, ${social.address(d, ident, player)}. Se os nota en el porte.`;
  else if (pc.rank === 0) base = cls === 'alta' ? 'Eres un/a pordiosero/a. Ni siquiera deberías dirigirme la palabra.' : 'Vas hecho/a un harapo, amigo/a. Busca un techo y un oficio.';
  if (pc.overlay === 'heroe' || pc.overlay === 'leyenda') base += ` Aunque, con tu fama, eso es lo de menos: eres ${pc.overlayName.toLowerCase()}.`;
  if (pc.rank < 5 && pc.rank >= 2) base += ' Dicen que la corona vende títulos nobiliarios a quien tenga oro o hazañas.';
  return base;
}

function famePhrase(d, realm) {
  const glory = social.lastGlory(d, realm?.id);
  const f = social.fame(d, realm?.id);
  const t = social.fameTier(f);
  const inf = social.infamy(d, realm?.id);
  if (inf > f && inf >= 60) {
    const shame = social.lastShame(d);
    return `Claro que sé quién eres... ${shame ? shame.text.charAt(0).toLowerCase() + shame.text.slice(1) + '.' : 'Y no por nada bueno.'}`;
  }
  if (glory && f >= 40) return social.fixEs(`¡Claro que sé quién eres! Eres ${glory.who}. En ${realm?.name ? social.realmArt(realm.name) : 'estas tierras'} eres ${t.name.toLowerCase()}.`);
  if (f >= 40) return `Algo he oído de ti. Aquí eres ${t.name.toLowerCase()}.`;
  return 'No me suena tu nombre... todavía. Haz algo memorable y los bardos lo cantarán.';
}

function jobPhrase(ident) {
  const job = ident?.job ?? ident?.role;
  if (DAY_JOBS[job]) return `Sí, me vendría bien ayuda. Elige «Trabajo por un día» y te pagaré un jornal.`;
  return 'Pregunta a los granjeros, al herrero o al tabernero: siempre necesitan manos y pagan un jornal honrado.';
}

export function vars(c) {
  const { player, d, ident } = c;
  const race = raceOf(d.race);
  const npcRace = raceOf(ident.race);
  const fam = d.family?.members ?? [];
  const madre = fam.find((m) => m.role === 'madre')?.name ?? 'tu madre';
  const padre = fam.find((m) => m.role === 'padre')?.name ?? 'tu padre';
  const kt = karmaTitle(d.karma ?? 0);
  const rng = seeded(hash(ident.id + world.getDay()));
  const bossList = Object.values(BOSSES).filter((b) => b.rank <= Math.max(2, (d.guild?.rank ?? 0) + 1));
  const house = d.family?.house;
  const out = {
    p: player.name,
    n: ident.name,
    rol: jobLabel(ident.role ?? ident.job, ident.gender).toLowerCase(),
    apellido_npc: ident.surname ?? '',
    apellido: d.family?.surname ?? '',
    tod: timeOfDay(),
    tod_desc: timeDesc(),
    kid: g(d, 'pequeño', 'pequeña'),
    hijo: g(d, 'hijo', 'hija'),
    herm: g(d, 'hermanito', 'hermanita'),
    tesoro: 'tesoro',
    raza: race.name.toLowerCase(),
    raza_npc: npcRace.name.toLowerCase(),
    raza_plural: race.plural.toLowerCase(),
    el: ELEMENTS[d.element]?.name ?? 'desconocida',
    rk: d.guild?.member ? RANKS[d.guild.rank] : 'sin rango',
    lvl: d.level,
    edad: ageYears(d),
    karma: kt.name,
    karma_comment: kt.comment,
    boss: pick(bossList.length ? bossList : Object.values(BOSSES), rng).name,
    region: regionName(rng),
    madre,
    padre,
    casa: house ? `X ${house.x}, Z ${house.z}` : 'algún lugar',
    mood: pick(MOOD_TEXT[c.mood] ?? [''], Math.random),
  };
  // v2: oficio, lugar, reino, clase social, fama, crímenes, economía y rumores.
  const place = placeCtx(c);
  const realm = place.realm;
  const job = ident.job ?? ident.role;
  const extra = {
    oficio: jobLabel(job, ident.gender).toLowerCase(),
    npc_clase: CLS_NAMES[social.npcCls(ident)] ?? 'clase media',
    asentamiento: place.s?.name ?? 'este lugar',
    reino: social.realmArt(realm?.name),
    titulo: realm?.ruler?.title ?? 'el Rey',
    gobernante: realm?.ruler?.name ?? '',
    ...social.sovereign(realm),
    ley: STRICTNESS_NAMES[Number(realm?.strictness ?? 1)] ?? 'firme',
    impuesto: Math.round(economy.salesTax(realm, d) * 100) + ' %',
  };
  Object.assign(out, extra);
  const lazy = {
    clase: () => social.playerClass(d).name.toLowerCase(),
    trato: () => social.address(d, ident, player),
    fama: () => social.fameTier(social.fame(d, realm?.id)).name.toLowerCase(),
    quien: () => social.lastGlory(d, realm?.id)?.who ?? player.name,
    hazana: () => social.lastGlory(d, realm?.id)?.text ?? 'nada que yo sepa',
    evento: () => economy.marketEvent(place.s)?.name?.toLowerCase() ?? 'nada especial',
    evento_linea: () => economy.eventLine(place.s) ?? '',
    ley_frase: () => lawPhrase(realm),
    crimen_frase: () => crimePhrase(d),
    reino_frase: () => realmPhrase(realm, place.s),
    reino_opinion: () => realmOpinion(realm, ident),
    clase_frase: () => classPhrase(d, ident, player),
    fama_frase: () => famePhrase(d, realm),
    jornal_frase: () => jobPhrase(ident),
    rumor: () => { try { return life.rumour(player, ident) ?? 'No he oído nada interesante últimamente.'; } catch { return 'No he oído nada interesante últimamente.'; } },
    otro_reino: () => social.realmArt(social.allRealmsSafe().filter((r) => r.id !== realm?.id).map((r) => r.name)[0]) ?? 'las tierras del norte',
  };
  for (const [k, fn] of Object.entries(lazy)) {
    let cached;
    let done = false;
    Object.defineProperty(out, k, {
      enumerable: true,
      get() {
        if (!done) { done = true; try { cached = fn(); } catch { cached = ''; } }
        return cached;
      },
    });
  }
  return out;
}

/** Detecta intenciones en el texto. */
export function detectIntents(norm) {
  const found = [];
  for (const intent of INTENTS) {
    for (const kw of intent.kw) {
      if (hasKeyword(norm, kw)) {
        found.push(intent);
        break;
      }
    }
  }
  // Prioridad: insultos > disculpas > amor > el resto (máx. 2)
  if (found.some((i) => i.id === 'insult')) return found.filter((i) => i.id === 'insult');
  return found.slice(0, 2);
}

/** Actitud social del NPC hacia el jugador (clase, raza, fama, karma), con caché por conversación. */
export function attitudeOf(c) {
  if (c._att === undefined) {
    try { c._att = social.attitude(c.d, c.ident, placeCtx(c).realm); } catch { c._att = 0; }
  }
  return c._att;
}

function toneOf(c) {
  const p = c.rel.p ?? 0;
  const fam = isFamilyRole(c.ident.role) || c.ident.role === 'pareja' || c.rel.partner;
  let tone = p < -20 ? 'cold' : p >= 80 || fam ? 'warm' : 'neutral';
  const k = c.d.karma ?? 0;
  if (c.ident.role === 'sombra') tone = k <= -100 ? 'warm' : 'neutral';
  else if (k <= -400 && !fam && tone === 'neutral') tone = 'cold';
  // Clase social, raza y fama: un noble desprecia al mendigo; la plebe admira al héroe.
  if (!fam && c.ident.role !== 'sombra') {
    const att = attitudeOf(c);
    if (att <= -0.45 && p < 120 && tone === 'neutral') tone = 'cold';
    else if (att >= 0.45 && p >= -20 && tone === 'neutral') tone = 'warm';
  }
  if (c.mood === 'enojado' && tone === 'warm' && !fam) tone = 'neutral';
  return tone;
}

function lineFor(c, intentId, tone) {
  const role = c.rel.partner ? 'pareja' : c.ident.role;
  const job = c.ident.job;
  const roleLines = ROLE_RESPONSES[role]?.[intentId] ?? (job && job !== role ? ROLE_RESPONSES[job]?.[intentId] : undefined);
  if (intentId === 'love') {
    if (isFamilyRole(c.ident.role) && c.ident.owner === c.d.id) return pick(RESPONSES.love.family);
    if (c.stage === 'child' || c.ident.age === 'child') return pick(RESPONSES.love.kid);
  }
  if (roleLines && (tone !== 'cold' || isFamilyRole(role)) && Math.random() < 0.8) return pick(roleLines);
  const set = RESPONSES[intentId];
  if (!set) return undefined;
  return pick(set[tone] ?? set.neutral);
}

/**
 * Genera la respuesta del NPC.
 * c = { player, d, ident, rel, stage, mood }
 * Devuelve { text, delta, end, gift? }
 */
export function reply(c, raw) {
  const norm = normalize(raw);
  const v = vars(c);
  const out = [];
  let delta = 0;
  let end = false;
  let gift;

  const intents = detectIntents(norm);
  const tone = toneOf(c);

  // El jugador cuenta algo sobre sí mismo: "mi comida favorita es la pizza".
  const fact = norm.match(/\bmi (comida|color|lugar|mascota|sueno) (?:favorit[oa] )?(?:es|se llama) (.+)/);
  if (fact) {
    const key = fact[1];
    const q = NPC_QUESTIONS.find((x) => x.key === key);
    if (q) {
      const value = cap(truncate(fact[2].replace(/\?/g, '').trim(), 32));
      c.rel.f = c.rel.f ?? {};
      c.rel.f[key] = value;
      if (c.rel.q === key) c.rel.q = undefined;
      out.push(fill(q.ack, { ...v, v: value }));
      return finish(c, out, 2, false, undefined, v);
    }
  }

  // Respuesta a una pregunta pendiente del NPC (memoria).
  const skipAnswer = intents.some((i) => ['insult', 'bye', 'greet', 'apology', 'thanks', 'love'].includes(i.id)) || norm.length < 2;
  if (c.rel.q && !skipAnswer) {
    const q = NPC_QUESTIONS.find((x) => x.key === c.rel.q);
    c.rel.q = undefined;
    if (q) {
      const value = cap(truncate(raw.trim().replace(/[{}§]/g, ''), 32));
      c.rel.f = c.rel.f ?? {};
      c.rel.f[q.key] = value;
      out.push(fill(q.ack, { ...v, v: value }));
      delta += 2;
      return finish(c, out, delta, false, undefined, v);
    }
  }

  for (const intent of intents) {
    let line;
    if (intent.id === 'gift_ask') {
      const today = world.getDay();
      if (tone === 'warm' && (c.rel.p ?? 0) >= 250 && c.rel.ga !== today) {
        c.rel.ga = today;
        gift = pick(['minecraft:cookie', 'minecraft:bread', 'minecraft:apple', 'minecraft:emerald', 'rpg:mana_potion']);
        line = pick(RESPONSES.gift_ask.warm);
        delta += 0;
      } else {
        line = pick(RESPONSES.gift_ask[tone === 'warm' ? 'neutral' : tone]);
        delta += intent.delta;
      }
    } else {
      line = lineFor(c, intent.id, tone);
      let dlt = intent.delta;
      if (intent.id === 'insult' && isFamilyRole(c.ident.role)) dlt = Math.round(dlt * 1.5);
      if (intent.id === 'compliment' && tone === 'cold') dlt = 1;
      if (intent.id === 'apology' && (c.rel.p ?? 0) < 0) dlt = 8;
      if (intent.id === 'love') {
        if (c.stage === 'child' || c.ident.age === 'child') dlt = 0;
        else if (tone === 'cold') dlt = -3;
        else if ((c.rel.p ?? 0) < 300 && !isFamilyRole(c.ident.role)) dlt = 0;
      }
      if (c.mood === 'feliz' && dlt > 0) dlt += 1;
      delta += dlt;
    }
    if (intent.id === 'bye') end = true;
    if (line) out.push(line);
  }

  if (!out.length) {
    const facts = c.rel.f ? Object.keys(c.rel.f) : [];
    if (facts.length && Math.random() < 0.3) {
      const key = pick(facts);
      const q = NPC_QUESTIONS.find((x) => x.key === key);
      if (q) out.push(fill(q.recall, { ...v, v: c.rel.f[key] }));
    }
    if (!out.length) {
      const words = norm.split(' ').filter((w) => w.length >= 5 && w !== '?');
      const echo = words.length ? words.sort((a, b) => b.length - a.length)[0] : raw.trim().slice(0, 20);
      const isQ = raw.includes('?') || /^(que|como|cuando|donde|por que|quien|cual|cuanto)\b/.test(norm);
      out.push(fill(pick(isQ ? FALLBACK.question : FALLBACK.statement), { ...v, echo }));
    }
  }

  // El NPC a veces pregunta algo para recordarlo después.
  if (!end && tone !== 'cold' && !c.rel.q && Math.random() < 0.22) {
    const known = c.rel.f ?? {};
    const pending = NPC_QUESTIONS.filter((q) => !known[q.key]);
    if (pending.length) {
      const q = pick(pending);
      c.rel.q = q.key;
      out.push(q.q);
    }
  }

  return finish(c, out, delta, end, gift, v);
}

function finish(c, out, delta, end, gift, v) {
  let text = out.join(' ');
  const fl = PERSONALITY_FLAVOR[c.ident.pers];
  if (fl && Math.random() < 0.3) {
    if (Math.random() < 0.5) text = pick(fl.pre) + text;
    else text = text + pick(fl.post);
  }
  text = fill(text, v);
  text = social.fixEs(genderize(text, c.d.gender, c.ident.gender));
  return { text: text.replace(/\s+/g, ' ').trim(), delta, end, gift };
}

/** Saludo inicial al abrir una conversación. */
export function opening(c) {
  const tone = toneOf(c);
  const v = vars(c);
  let line = lineFor(c, 'greet', tone) ?? 'Hola.';
  // Reverencias y desplantes según la clase social.
  const fam = isFamilyRole(c.ident.role) || c.rel.partner;
  if (!fam && c.ident.role !== 'sombra') {
    try {
      const pc = social.playerClass(c.d);
      const cls = social.npcCls(c.ident);
      if (pc.rank >= 4 && cls !== 'alta' && Math.random() < 0.7) line = pick(['*hace una reverencia* ', '*se inclina respetuosamente* ', '*se quita el sombrero* ']) + line;
      else if (pc.rank <= 1 && cls === 'alta' && tone !== 'warm' && Math.random() < 0.6) line = pick(['*arruga la nariz* ', '*te mira con desdén* ', '*suspira con fastidio* ']) + line;
      else if ((pc.overlay === 'heroe' || pc.overlay === 'leyenda') && Math.random() < 0.4) line = `¡${pick(['Vaya', 'Por los doce dioses', 'Increíble'])}! ¡Si es ${v.quien}! ` + line;
    } catch {}
  }
  const days = c.rel.last !== undefined ? world.getDay() - c.rel.last : -1;
  if (days > 5 && tone !== 'cold') line += ' ¡Hace días que no te veía!';
  if (c.mood !== 'normal' && Math.random() < 0.5) line += ' ' + pick(MOOD_TEXT[c.mood]);
  return social.fixEs(genderize(fill(line, v), c.d.gender, c.ident.gender));
}
