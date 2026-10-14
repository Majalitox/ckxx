// Elementos mágicos y su árbol de 50 habilidades cada uno.
//
// Cada elemento tiene 10 RAMAS (proyectil, explosión, potenciación, maldición, rayo perforante,
// dominio, protección, movilidad, invocación y cataclismo) con 5 NIVELES cada una
// (rango F/E, D/C, B/A, S y SS/SSS). Para aprender una habilidad necesitas la anterior de su rama.

export const BRANCHES = [
  { kind: 'bolt', name: 'Proyectil', icon: 'textures/items/blaze_powder', mana: 8, cd: 1.2, pmul: 1.0, range: 20 },
  { kind: 'nova', name: 'Explosión', icon: 'textures/items/fireball', mana: 14, cd: 5, pmul: 0.85, radius: 4 },
  { kind: 'buff', name: 'Potenciación', icon: 'textures/items/potion_bottle_drinkable', mana: 12, cd: 30, dur: 20, durStep: 10 },
  { kind: 'curse', name: 'Maldición', icon: 'textures/items/spider_eye_fermented', mana: 10, cd: 8, pmul: 0.4, range: 10, dur: 5, durStep: 2 },
  { kind: 'lance', name: 'Haz perforante', icon: 'textures/items/arrow', mana: 16, cd: 4, pmul: 1.15, range: 16 },
  { kind: 'zone', name: 'Dominio', icon: 'textures/items/dragons_breath', mana: 20, cd: 14, pmul: 0.3, radius: 3, range: 20, dur: 4, durStep: 1.5 },
  { kind: 'ward', name: 'Protección', icon: 'textures/items/iron_chestplate', mana: 15, cd: 20, pmul: 0.9 },
  { kind: 'step', name: 'Movilidad', icon: 'textures/items/feather', mana: 8, cd: 4, range: 8 },
  { kind: 'summon', name: 'Invocación', icon: 'textures/items/totem', mana: 25, cd: 40, dur: 30, durStep: 15 },
  { kind: 'rain', name: 'Cataclismo', icon: 'textures/items/nether_star', mana: 30, cd: 22, pmul: 0.75, radius: 5, range: 28 },
];

export const TIER_NAMES = ['I · Novicio', 'II · Adepto', 'III · Experto', 'IV · Maestro', 'V · Leyenda'];
const TIER_LEVEL = [1, 10, 25, 45, 70];
const TIER_STEP = [0.8, 1.2, 1.6, 2.0, 2.5];
const TIER_RANK = [0, 2, 4, 6, 7]; // F, D, B, S, SS
const TIER_POWER = [5, 9, 15, 24, 38];

export const ELEMENTS = {
  fuego: {
    name: 'Fuego', c: '§c', rgb: [1, 0.4, 0.05], weight: 12, status: 'burn', step: 'dash', variant: 0,
    sound: 'mob.blaze.shoot', desc: 'Destrucción pura. Quema a los enemigos y potencia tu fuerza.',
    buff: [['strength', 0], ['fire_resistance', 0]],
    names: 'Chispa|Aliento Cálido|Sangre Ardiente|Marca de Ceniza|Hilo de Llama|Brasas Dispersas|Manto de Calor|Paso de Humo|Fuego Fatuo|Lluvia de Chispas|Bola de Fuego|Anillo de Llamas|Corazón de Forja|Quemadura Profunda|Lanza Ígnea|Campo de Brasas|Escudo de Fuego|Impulso Explosivo|Salamandra|Lluvia de Ascuas|Flecha Solar|Nova Ígnea|Furia del Volcán|Maldición Calcinante|Rayo de Magma|Mar de Llamas|Égida Volcánica|Estela Ardiente|Elemental de Fuego|Lluvia de Meteoros|Cometa Carmesí|Supernova|Avatar de Ifrit|Sello del Infierno|Haz del Sol Negro|Infierno Eterno|Renacer de las Cenizas|Vuelo del Fénix|Fénix Menor|Meteoro Celestial|Ira de Surtur|Big Bang Ígneo|Encarnación Solar|Juicio Purgatorio|Lanza de Prometeo|Reino de Fuego|Llama Inmortal|Paso del Sol|Dragón Ígneo Ancestral|Apocalipsis Solar',
  },
  agua: {
    name: 'Agua', c: '§9', rgb: [0.2, 0.5, 1], weight: 12, status: 'soak', step: 'dash', variant: 1,
    sound: 'bucket.empty_water', desc: 'Fluye y adapta. Ralentiza, empuja y cura.',
    buff: [['regeneration', 0], ['water_breathing', 0]],
    names: 'Gota Afilada|Salpicadura|Fluir del Río|Empapar|Chorro a Presión|Charco Resbaladizo|Velo de Rocío|Deslizamiento|Espíritu del Manantial|Llovizna|Bala de Agua|Ola Expansiva|Marea Interior|Ahogo|Hidrocañón|Remolino|Burbuja Protectora|Surf de Ola|Ondina|Aguacero|Látigo Abisal|Tsunami Menor|Corazón del Océano|Presión Abisal|Lanza de Neptuno|Vórtice Marino|Agua Curativa|Corriente Veloz|Serpiente de Mar|Tormenta Torrencial|Tridente de Poseidón|Maremoto|Avatar de la Marea|Prisión de Agua|Hidro-Láser Divino|Maelstrom|Fuente de la Vida|Paso del Leviatán|Kraken Menor|Diluvio|Ira del Océano|Gran Tsunami|Encarnación Abisal|Sentencia de las Profundidades|Lanza de los Mil Mares|Reino Sumergido|Lágrima de Diosa|Danza de Mareas|Leviatán|Diluvio Universal',
  },
  tierra: {
    name: 'Tierra', c: '§6', rgb: [0.6, 0.4, 0.2], weight: 12, status: 'stun', step: 'leap', variant: 2,
    sound: 'dig.stone', desc: 'Firmeza inquebrantable. Aturde enemigos y te vuelve una fortaleza.',
    buff: [['resistance', 0], ['health_boost', 0]],
    names: 'Guijarro|Temblor|Piel de Roca|Polvo Cegador|Púa de Piedra|Arena Movediza|Muro de Barro|Salto de Roca|Gólem de Barro|Lluvia de Piedras|Roca Arrojadiza|Sismo|Fuerza de la Montaña|Petrificar|Estaca Terrestre|Zona de Grietas|Muralla de Piedra|Embestida Sísmica|Gólem de Piedra|Desprendimiento|Bala de Granito|Terremoto|Armadura de Diamante|Maldición de Gaia|Columna Telúrica|Fauces de la Tierra|Bastión de Hierro|Carga del Titán|Gólem de Hierro|Avalancha|Meteorito Terrestre|Cataclismo Sísmico|Avatar de Gaia|Tumba de Piedra|Lanza Tectónica|Abismo Abierto|Fortaleza Inamovible|Paso de Atlas|Titán de Roca|Lluvia de Montañas|Puño del Mundo|Ruptura Continental|Encarnación de la Montaña|Juicio Tectónico|Eje del Mundo|Reino de Piedra|Corazón de la Tierra|Marcha del Coloso|Behemot|Fin de las Placas',
  },
  viento: {
    name: 'Viento', c: '§f', rgb: [0.85, 1, 0.9], weight: 12, status: 'gust', step: 'leap', variant: 3,
    sound: 'mob.enderdragon.flap', desc: 'Libertad y velocidad. Empuja, eleva y te hace volar.',
    buff: [['speed', 1], ['jump_boost', 1], ['slow_falling', 0]],
    names: 'Cuchilla de Aire|Ráfaga|Pies Ligeros|Silbido Desorientador|Corte de Viento|Remolino Menor|Cortina de Aire|Salto del Viento|Sílfide|Brisa Cortante|Bala de Aire|Onda Expansiva|Bendición del Céfiro|Vacío Asfixiante|Guadaña de Viento|Torbellino|Muro de Viento|Doble Salto|Halcón de Viento|Vendaval|Hoja del Huracán|Explosión de Presión|Velocidad del Rayo Azul|Maldición del Silencio|Tajo del Cielo|Tornado|Escudo de Ciclón|Paso Celeste|Grifo|Tormenta de Cuchillas|Lanza de Eolo|Estallido Atmosférico|Avatar del Cielo|Prisión de Vacío|Corte Dimensional|Gran Tornado|Ojo del Huracán|Vuelo de Águila|Roc Gigante|Huracán Devastador|Ira de los Cuatro Vientos|Colapso Atmosférico|Encarnación del Céfiro|Sentencia del Vacío|Filo del Horizonte|Reino de las Tormentas|Aliento de la Creación|Paso Instantáneo|Dragón del Viento|Apocalipsis Celeste',
  },
  rayo: {
    name: 'Rayo', c: '§e', rgb: [1, 0.95, 0.3], weight: 9, status: 'chain', step: 'blink', variant: 4,
    sound: 'ambient.weather.lightning.impact', desc: 'Velocidad devastadora. El daño salta entre enemigos.',
    buff: [['speed', 1], ['haste', 1]],
    names: 'Chispazo|Descarga|Reflejos Eléctricos|Parálisis Menor|Arco Voltaico|Campo Estático|Barrera Estática|Destello|Chispa Viviente|Llovizna Eléctrica|Bola Eléctrica|Pulso Electromagnético|Sobrecarga|Electrocución|Rayo en Cadena|Red Eléctrica|Escudo de Plasma|Paso Relámpago|Lobo de Trueno|Tormenta Eléctrica|Lanza del Trueno|Nova de Plasma|Cuerpo de Relámpago|Parálisis Total|Cañón de Riel|Campo de Tormenta|Égida del Trueno|Teletransporte Voltaico|Ave del Trueno|Lluvia de Relámpagos|Martillo de Thor|Explosión de Plasma|Avatar del Trueno|Juicio Eléctrico|Rayo Divino|Domo de Tormenta|Coraza de Iones|Viaje de Luz|Raijū|Ira de Zeus|Mjolnir|Singularidad Eléctrica|Encarnación de la Tormenta|Castigo de los Cielos|Lanza de Indra|Reino del Trueno|Corazón Galvánico|Velocidad Absoluta|Dragón de Tormenta|Ragnarok Eléctrico',
  },
  hielo: {
    name: 'Hielo', c: '§b', rgb: [0.6, 0.9, 1], weight: 9, status: 'freeze', step: 'dash', variant: 5,
    sound: 'random.glass', desc: 'Control absoluto. Congela y ralentiza a tus enemigos.',
    buff: [['resistance', 0], ['absorption', 1]],
    names: 'Fragmento de Hielo|Aliento Gélido|Sangre Fría|Escarcha|Carámbano|Suelo Helado|Coraza de Escarcha|Patinaje|Lobo de Nieve|Granizo|Lanza de Hielo|Nova de Escarcha|Corazón Invernal|Congelación|Rayo Gélido|Campo de Ventisca|Muro de Hielo|Deslizamiento Glacial|Oso Polar Espectral|Granizada|Estaca Glacial|Explosión Criogénica|Armadura de Permafrost|Prisión de Hielo|Haz del Cero Absoluto|Ventisca|Santuario Helado|Paso Glacial|Gólem de Hielo|Tormenta de Granizo|Cometa de Hielo|Era Glacial|Avatar del Invierno|Ataúd de Cristal|Rayo de Niflheim|Tormenta Polar|Corazón de Glaciar|Espejo de Hielo|Yeti Ancestral|Lluvia de Glaciares|Ira de Bóreas|Cero Absoluto|Encarnación del Invierno Eterno|Sentencia Glacial|Lanza de Ymir|Reino de Hielo Eterno|Flor de Escarcha Inmortal|Paso Congelado del Tiempo|Dragón de Hielo|Fimbulvetr',
  },
  luz: {
    name: 'Luz', c: '§e', rgb: [1, 1, 0.7], weight: 6, status: 'holy', step: 'blink', variant: 6,
    sound: 'beacon.activate', desc: 'Santidad. Cura a los aliados y destruye a los no-muertos (x2).',
    buff: [['regeneration', 0], ['night_vision', 0], ['absorption', 0]],
    names: 'Rayo de Luz|Destello Cegador|Bendición Menor|Marca Radiante|Haz Sagrado|Círculo de Luz|Curación Menor|Paso Luminoso|Hada de Luz|Lluvia de Destellos|Flecha Sagrada|Explosión Radiante|Aura de Valor|Purificación|Lanza de Luz|Santuario|Curación|Destello Veloz|Espíritu Guardián|Lluvia de Estrellas|Orbe Solar|Nova Sagrada|Bendición Divina|Exorcismo|Rayo Celestial|Tierra Santa|Gran Curación|Ascensión|Valquiria|Lluvia Celestial|Lanza de Arcángel|Juicio Radiante|Avatar Seraphim|Sello Sagrado|Haz del Paraíso|Catedral de Luz|Resurrección de Luz|Alas de Luz|Arcángel|Ira del Cielo|Espada del Juicio Final|Génesis|Encarnación Divina|Expiación|Luz de la Creación|Reino Celestial|Milagro|Paso Divino|Serafín|Amanecer Eterno',
  },
  oscuridad: {
    name: 'Oscuridad', c: '§8', rgb: [0.35, 0.1, 0.5], weight: 6, status: 'blind', step: 'blink', variant: 7,
    sound: 'mob.endermen.portal', desc: 'Miedo y sigilo. Ciega, debilita y se oculta en las sombras.',
    buff: [['invisibility', 0], ['strength', 0], ['night_vision', 0]],
    names: 'Bala de Sombra|Pulso Oscuro|Manto de Sombras|Ceguera|Tentáculo Sombrío|Charco de Oscuridad|Velo Nocturno|Paso Sombrío|Sombra Viviente|Lluvia Negra|Orbe del Vacío|Explosión de Sombras|Pacto Nocturno|Terror|Lanza Umbría|Niebla Oscura|Escudo del Abismo|Teletransporte Sombrío|Acechador|Tormenta de Sombras|Proyectil Abisal|Nova del Vacío|Forma de Sombra|Pesadilla|Rayo del Abismo|Dominio Nocturno|Coraza del Vacío|Salto Dimensional|Caballero Oscuro|Lluvia del Abismo|Lanza del Señor Oscuro|Eclipse|Avatar de la Noche|Maldición Eterna|Haz del Vacío|Noche Eterna|Absorción Oscura|Paso del Abismo|Demonio de Sombra|Eclipse Total|Agujero Negro|Colapso del Vacío|Encarnación de la Oscuridad|Sentencia Abisal|Lanza de Erebo|Reino de las Tinieblas|Corazón del Vacío|Paso entre Mundos|Señor de las Sombras|Fin de la Luz',
  },
  necromancia: {
    name: 'Necromancia', c: '§5', rgb: [0.4, 0.9, 0.5], weight: 4, status: 'wither', step: 'blink', variant: 8,
    sound: 'mob.wither.shoot', desc: 'Dominio sobre la muerte. Marchita, roba vida y alza a los muertos.',
    buff: [['strength', 0], ['absorption', 1]],
    names: 'Dardo Óseo|Aliento de Tumba|Pacto de Huesos|Toque Mortal|Lanza de Hueso|Tierra de Cementerio|Escudo de Huesos|Paso Espectral|Alzar Esqueleto|Lluvia de Huesos|Calavera Maldita|Explosión de Cadáver|Fuerza de los Muertos|Plaga|Rayo Necrótico|Pantano de Almas|Barrera de Almas|Forma Espectral|Alzar Zombi|Lluvia de Almas|Proyectil de Almas|Nova Necrótica|Sed de Vida|Marchitar|Haz de la Muerte|Campo de Tumbas|Drenaje Vital|Paso del Más Allá|Caballero Muerto|Lluvia de Calaveras|Lanza del Liche|Peste Negra|Avatar de la Muerte|Condena Eterna|Rayo del Inframundo|Necrópolis|Filacteria|Viaje Fantasmal|Liche Menor|Danza Macabra|Guadaña de la Muerte|Apocalipsis Zombi|Encarnación del Rey Liche|Sentencia Final|Lanza de Hades|Reino de los Muertos|Inmortalidad Profana|Paso del Segador|Dragón Óseo|Ejército de los Condenados',
  },
  naturaleza: {
    name: 'Naturaleza', c: '§a', rgb: [0.3, 0.9, 0.2], weight: 9, status: 'poison', step: 'dash', variant: 9,
    sound: 'block.sweet_berry_bush.place', desc: 'Vida salvaje. Envenena, enreda y regenera.',
    buff: [['regeneration', 0], ['saturation', 0], ['health_boost', 0]],
    names: 'Espina|Esporas|Savia Vital|Veneno Menor|Látigo de Enredadera|Raíces Enredadas|Piel de Corteza|Salto del Ciervo|Lobo del Bosque|Lluvia de Hojas|Semilla Explosiva|Estallido de Polen|Bendición del Bosque|Toxina|Lanza de Espinas|Jardín Venenoso|Regeneración|Carrera Salvaje|Oso Guardián|Lluvia de Espinas|Flecha de Roble|Explosión de Esporas|Fuerza Salvaje|Veneno Mortal|Rayo de Clorofila|Bosque Hostil|Florecer|Vuelo del Halcón|Ent Joven|Tormenta de Pétalos|Lanza de Yggdrasil|Furia del Bosque|Avatar de la Naturaleza|Plaga Vegetal|Rayo de la Vida|Selva Primigenia|Árbol de la Vida|Paso del Druida|Ent Ancestral|Lluvia Primigenia|Ira de Gaia Verde|Explosión Primordial|Encarnación del Bosque Eterno|Juicio de la Naturaleza|Lanza del Árbol Mundo|Reino Esmeralda|Renacimiento|Paso de las Estaciones|Dragón Esmeralda|Edén',
  },
  arcano: {
    name: 'Arcano', c: '§d', rgb: [0.85, 0.4, 1], weight: 5, status: 'arcane', step: 'blink', variant: 10,
    sound: 'mob.evocation_illager.cast_spell', desc: 'Magia pura. Ignora defensas, eleva enemigos y teletransporta.',
    buff: [['absorption', 1], ['haste', 0]],
    names: 'Misil Mágico|Pulso Arcano|Concentración|Silencio|Rayo Arcano|Runa Explosiva|Escudo de Maná|Parpadeo|Familiar Arcano|Lluvia de Runas|Orbe Arcano|Explosión de Maná|Mente Clara|Debilitar|Haz de Maná|Círculo Rúnico|Barrera Mística|Teletransporte|Gólem Arcano|Bombardeo Arcano|Proyectil Prismático|Nova Arcana|Sobrecarga de Maná|Maldición del Mago|Rayo Prismático|Dominio Rúnico|Escudo Prismático|Teletransporte Mayor|Guardián Arcano|Lluvia de Estrellas Fugaces|Lanza del Archimago|Distorsión Arcana|Avatar Arcano|Sello de Anulación|Haz Dimensional|Laberinto Arcano|Égida del Archimago|Puerta Dimensional|Djinn|Lluvia de Cometas|Fin de la Realidad|Big Bang Arcano|Encarnación del Saber|Borrado|Lanza de Merlín|Reino de los Hechizos|Tiempo Detenido|Paso a Través del Tiempo|Dragón Arcano|Colapso Universal',
  },
  sangre: {
    name: 'Sangre', c: '§4', rgb: [0.75, 0.05, 0.1], weight: 4, status: 'bleed', step: 'dash', variant: 11,
    sound: 'mob.ravager.bite', desc: 'Poder prohibido. Desangra, roba vida y potencia a costa de tu salud.',
    buff: [['strength', 1], ['speed', 0]],
    names: 'Gota Carmesí|Salpicadura de Sangre|Hervor de Sangre|Hemorragia|Aguja de Sangre|Charco Carmesí|Transfusión|Paso Sangriento|Murciélago de Sangre|Lluvia Carmesí|Bala de Sangre|Explosión Hemática|Frenesí|Desangrar|Lanza Carmesí|Pantano de Sangre|Vampirismo|Embestida Carmesí|Sabueso de Sangre|Tormenta Carmesí|Proyectil Hemático|Nova Carmesí|Berserker de Sangre|Corrupción Sanguínea|Rayo Hemático|Mar de Sangre|Sed Inagotable|Forma de Niebla|Gólem de Sangre|Lluvia de Dagas Rojas|Lanza del Conde|Luna de Sangre|Avatar Carmesí|Marioneta de Sangre|Haz Escarlata|Castillo Carmesí|Sangre Inmortal|Paso del Vampiro|Señor Vampiro|Diluvio de Sangre|Lanza de Longinus|Eclipse Carmesí|Encarnación de la Sangre|Sentencia Escarlata|Lanza de Drácula|Reino Carmesí|Corazón Eterno|Paso de la Noche Roja|Dragón de Sangre|Apocalipsis Carmesí',
  },
};

export const ELEMENT_IDS = Object.keys(ELEMENTS);

export const TALENTS = [
  { name: '§7Bajo', mult: 0.75, weight: 25 },
  { name: '§fNormal', mult: 1.0, weight: 45 },
  { name: '§aAlto', mult: 1.3, weight: 20 },
  { name: '§bProdigio', mult: 1.7, weight: 8 },
  { name: '§6§lElegido', mult: 2.2, weight: 2 },
];

const STATUS_TEXT = {
  burn: 'quema al objetivo', soak: 'empapa y ralentiza', stun: 'aturde', gust: 'lanza por los aires', chain: 'salta entre enemigos',
  freeze: 'congela', holy: 'inflige el doble a no-muertos', blind: 'ciega y debilita', wither: 'marchita y roba vida', poison: 'envenena',
  arcane: 'ignora defensas y hace levitar', bleed: 'desangra y roba vida',
};

const cache = {};

/** Devuelve la definición completa de la habilidad idx (0-49) de un elemento. */
export function getSkill(elementId, idx) {
  const key = elementId + ':' + idx;
  if (cache[key]) return cache[key];
  const el = ELEMENTS[elementId];
  if (!el || idx < 0 || idx > 49) return undefined;
  const names = el._names ?? (el._names = el.names.split('|'));
  const tier = Math.floor(idx / 10);
  const branch = idx % 10;
  const B = BRANCHES[branch];
  let rank = TIER_RANK[tier];
  if (tier === 4 && branch >= 8) rank = 8; // las dos últimas exigen rango SSS
  const s = {
    id: idx,
    element: elementId,
    tier,
    branch,
    kind: B.kind,
    name: names[idx],
    level: TIER_LEVEL[tier] + Math.floor(branch * TIER_STEP[tier]),
    rank,
    sp: tier + 1,
    mana: Math.round(B.mana * (1 + tier * 0.8)),
    cd: Math.max(10, Math.round(B.cd * (1 + tier * 0.1) * 20)),
    power: Math.round(TIER_POWER[tier] * (B.pmul ?? 1) * 10) / 10,
    radius: B.radius ? B.radius + tier : 0,
    range: B.range ? B.range + tier * 4 : 0,
    duration: B.dur ? Math.round((B.dur + tier * B.durStep) * 20) : 0,
  };
  s.desc = describe(el, s);
  cache[key] = s;
  return s;
}

function describe(el, s) {
  const st = STATUS_TEXT[el.status];
  const secs = (s.duration / 20).toFixed(0);
  switch (s.kind) {
    case 'bolt': return `Lanza un proyectil de ${el.name.toLowerCase()} (alcance ${s.range}) que inflige ~${s.power} de daño y ${st}.`;
    case 'nova': return `Libera una explosión de ${el.name.toLowerCase()} a tu alrededor (radio ${s.radius}) que inflige ~${s.power} y ${st}.`;
    case 'buff': return `Te otorga ${el.buff.map((b) => b[0].replace(/_/g, ' ')).join(', ')} de nivel ${s.tier + 1} durante ${secs} s.`;
    case 'curse': return `Maldice a los enemigos frente a ti (alcance ${s.range}): ${st} con gran intensidad durante ${secs} s.`;
    case 'lance': return `Dispara un haz que atraviesa a todos los enemigos en línea (alcance ${s.range}), ~${s.power} de daño cada uno.`;
    case 'zone': return `Crea un dominio de ${el.name.toLowerCase()} (radio ${s.radius}) durante ${secs} s que daña continuamente y ${st}.`;
    case 'ward': return `Te protege con absorción y te cura ~${Math.round(s.power * 3 + 4)} de vida${['luz', 'agua', 'naturaleza'].includes(s.element) ? ' (también a aliados cercanos)' : ''}.`;
    case 'step': return el.step === 'blink' ? `Te teletransporta hasta ${s.range} bloques hacia donde miras.` : el.step === 'leap' ? `Un gran salto impulsado por ${el.name.toLowerCase()}.` : `Una embestida veloz que daña a quien atravieses.`;
    case 'summon': return `Invoca ${s.tier >= 2 ? (s.tier >= 4 ? 3 : 2) : 1} aliado(s) elementales que luchan por ti durante ${secs} s.`;
    case 'rain': return `Desata ${3 + s.tier * 2} impactos de ${el.name.toLowerCase()} sobre la zona objetivo (radio ${s.radius}), ~${s.power} cada uno.`;
  }
  return '';
}

/** Habilidades que se pueden aprender ahora (requisitos de rama). */
export function prereqOk(learned, idx) {
  if (idx < 10) return true;
  return learned.includes(idx - 10);
}
