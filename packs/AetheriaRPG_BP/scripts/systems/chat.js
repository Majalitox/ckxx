// Motor de conversación de los NPCs: el jugador escribe texto libre y el NPC responde
// según intención detectada, rol, personalidad, humor, relación, karma y memoria.
import { world } from '@minecraft/server';
import { INTENTS, RESPONSES, ROLE_RESPONSES, PERSONALITY_FLAVOR, MOOD_TEXT, FALLBACK, NPC_QUESTIONS } from '../data/dialogue.js';
import { normalize, hasKeyword, fill, truncate, cap } from '../util/text.js';
import { pick, hash, seeded } from '../util/math.js';
import { raceOf } from '../data/races.js';
import { ELEMENTS } from '../data/elements.js';
import { RANKS } from '../data/ranks.js';
import { BOSSES } from '../data/mobs.js';
import { ROLE_NAMES, regionName } from '../data/names.js';
import { ageYears, karmaTitle, g } from '../core/profile.js';

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
  try {
    const w = world.getDimension('overworld').getWeather();
    if (w === 'Rain') weather = 'Está lloviendo; ideal para quedarse junto al fuego. ';
    if (w === 'Thunder') weather = '¡Qué tormenta! Los rayos asustan a cualquiera. ';
  } catch {}
  const t = world.getTimeOfDay();
  if (t < 6000) return weather + 'Es por la mañana, el mejor momento para salir de aventuras.';
  if (t < 12000) return weather + 'Ya es por la tarde. El sol empieza a caer.';
  if (t < 13000) return weather + 'Está atardeciendo... pronto saldrán los monstruos.';
  return weather + 'Es de noche. Los monstruos acechan; ten cuidado.';
}

function fem(w) {
  if (/ón$/.test(w)) return w.slice(0, -2) + 'ona';
  if (/ío$/.test(w)) return w.slice(0, -2) + 'ía';
  if (/o$/.test(w)) return w.slice(0, -1) + 'a';
  if (/or$/.test(w)) return w + 'a';
  return w;
}

/** Resuelve "palabra/a" (género del jugador) y "palabra/A" (género del NPC). */
export function genderize(s, playerGender, npcGender) {
  s = s.replace(/([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\/A\b/g, (m, w) => (npcGender === 'f' ? fem(w) : w));
  s = s.replace(/([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\/a\b/g, (m, w) => (playerGender === 'f' ? fem(w) : w));
  return s;
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
  return {
    p: player.name,
    n: ident.name,
    rol: (ROLE_NAMES[ident.role] ?? ident.role).toLowerCase(),
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

function toneOf(c) {
  const p = c.rel.p ?? 0;
  const fam = isFamilyRole(c.ident.role) || c.ident.role === 'pareja' || c.rel.partner;
  let tone = p < -20 ? 'cold' : p >= 80 || fam ? 'warm' : 'neutral';
  const k = c.d.karma ?? 0;
  if (c.ident.role === 'sombra') tone = k <= -100 ? 'warm' : 'neutral';
  else if (k <= -400 && !fam && tone === 'neutral') tone = 'cold';
  if (c.mood === 'enojado' && tone === 'warm' && !fam) tone = 'neutral';
  return tone;
}

function lineFor(c, intentId, tone) {
  const role = c.rel.partner ? 'pareja' : c.ident.role;
  const roleLines = ROLE_RESPONSES[role]?.[intentId];
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
  text = genderize(text, c.d.gender, c.ident.gender);
  return { text: text.replace(/\s+/g, ' ').trim(), delta, end, gift };
}

/** Saludo inicial al abrir una conversación. */
export function opening(c) {
  const tone = toneOf(c);
  const v = vars(c);
  let line = lineFor(c, 'greet', tone) ?? 'Hola.';
  const days = c.rel.last !== undefined ? world.getDay() - c.rel.last : -1;
  if (days > 5 && tone !== 'cold') line += ' ¡Hace días que no te veía!';
  if (c.mood !== 'normal' && Math.random() < 0.5) line += ' ' + pick(MOOD_TEXT[c.mood]);
  return genderize(fill(line, v), c.d.gender, c.ident.gender);
}
