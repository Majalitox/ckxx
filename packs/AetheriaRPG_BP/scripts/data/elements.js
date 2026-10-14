// Elementos mágicos, su árbol de 50 habilidades cada uno, estados elementales y reacciones (combos).
//
// Cada elemento tiene 10 RAMAS (proyectil, explosión, potenciación, maldición, rayo perforante,
// dominio, protección, movilidad, invocación y cataclismo) con 5 NIVELES cada una
// (rango F/E, D/C, B/A, S y SS/SSS). Para aprender una habilidad necesitas la anterior de su rama.
//
// v2: cada elemento deja un ESTADO en sus víctimas (mojado, ardiendo, congelado…). Si otro elemento
// golpea a un objetivo con un estado, se produce una REACCIÓN con efectos extra (ver REACTIONS).
// Este archivo es solo datos: no accede al mundo.

export const BRANCHES = [
  { kind: 'bolt', name: 'Proyectil', icon: 'textures/items/blaze_powder', mana: 8, cd: 1.0, pmul: 1.0, range: 20, speed: 1.7 },
  { kind: 'nova', name: 'Explosión', icon: 'textures/items/fireball', mana: 14, cd: 5, pmul: 0.85, radius: 4 },
  { kind: 'buff', name: 'Potenciación', icon: 'textures/items/potion_bottle_drinkable', mana: 12, cd: 30, dur: 20, durStep: 10 },
  { kind: 'curse', name: 'Maldición', icon: 'textures/items/spider_eye_fermented', mana: 10, cd: 8, pmul: 0.45, range: 10, dur: 5, durStep: 2 },
  { kind: 'lance', name: 'Haz perforante', icon: 'textures/items/arrow', mana: 16, cd: 4, pmul: 1.15, range: 16, speed: 3.2 },
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
// Curvas de equilibrio (v2): los primeros hechizos son baratos y contundentes (un zombi cae con
// 3 proyectiles de nivel I); el nivel V es espectacular pero caro y con recarga larga para que no
// gane un combate de un solo golpe (además, systems/magic.js limita el daño por impacto contra jefes
// y la Inteligencia escala con rendimientos decrecientes).
const TIER_POWER = [7, 11, 17, 26, 38];
const TIER_MANA = [0.75, 1.5, 2.3, 3.2, 4.2];
const TIER_CD = [1, 1.12, 1.25, 1.4, 1.6];
/** Ramas "definitivas": en el nivel V su recarga se alarga un 25 %. */
const ULT_KINDS = new Set(['nova', 'zone', 'rain', 'summon']);

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

/* ------------------------------------------------------------------ */
/* Datos visuales/sonoros por elemento (v2)                             */
/* ------------------------------------------------------------------ */
// statusId: estado que deja el elemento. trail: partícula vanilla que acompaña al proyectil.
// impact/cast: sonidos. orbScale: tamaño visual del orbe.
// proj: estilo del proyectil (rama Proyectil) que interpreta systems/magic.js:
//   speedMul (× velocidad), size (radio de colisión), gravity (caída por tick), homing (fuerza del
//   autoapuntado), count/spread/share (varios proyectiles en abanico, grados y fracción de daño de cada uno),
//   stagger (ticks entre proyectiles), pierce (enemigos que atraviesa), splash/splashMul (salpicadura),
//   knock (empuje extra), noun/trait (texto para la descripción).
// zone: efecto especial de su Dominio. rain: lo que cae del cielo en su Cataclismo.
const ELEMENT_EXTRA = {
  fuego: {
    statusId: 'ardiendo', trail: 'minecraft:basic_flame_particle', impact: 'mob.ghast.fireball', cast: 'mob.blaze.shoot', orbScale: 1.15,
    proj: { speedMul: 1.0, size: 0.4, splash: 1.6, splashMul: 0.35, noun: 'una bola de fuego', trait: 'Estalla al impactar y salpica llamas a su alrededor.' },
    zone: 'las llamas queman todo lo que pisa el círculo', rain: 'meteoritos en llamas',
  },
  agua: {
    statusId: 'mojado', trail: 'minecraft:water_evaporation_bucket_emitter', impact: 'random.splash', cast: 'bucket.empty_water', orbScale: 1.0,
    proj: { speedMul: 1.1, gravity: 0.012, knock: 0.35, noun: 'una bala de agua a presión', trait: 'Describe una ligera parábola y empuja al objetivo.' },
    zone: 'un remolino arrastra a los enemigos hacia el centro', rain: 'trombas de agua',
  },
  tierra: {
    statusId: 'aturdido', trail: 'minecraft:knockback_roar_particle', impact: 'dig.stone', cast: 'dig.gravel', orbScale: 1.3,
    proj: { speedMul: 0.8, gravity: 0.03, size: 0.5, knock: 0.8, noun: 'una roca', trait: 'Es lenta y cae en parábola, pero golpea con mucha fuerza.' },
    zone: 'el suelo se agrieta y frena a los enemigos', rain: 'rocas gigantes',
  },
  viento: {
    statusId: 'desequilibrado', trail: undefined, impact: 'mob.enderdragon.flap', cast: 'mob.enderdragon.flap', orbScale: 0.9,
    proj: { speedMul: 1.35, size: 0.3, pierce: 1, knock: 0.5, noun: 'una cuchilla de aire', trait: 'Es muy rápida y atraviesa a un enemigo.' },
    zone: 'un torbellino atrae a los enemigos y los zarandea', rain: 'cuchillas de viento',
  },
  rayo: {
    statusId: 'electrizado', trail: 'minecraft:electric_spark_particle', impact: 'random.fizz', cast: 'ambient.weather.lightning.impact', orbScale: 0.9,
    proj: { speedMul: 1.7, size: 0.3, noun: 'una centella', trait: 'Es el proyectil más veloz y la descarga salta a enemigos cercanos.' },
    zone: 'descargas saltan entre los enemigos atrapados', rain: 'relámpagos',
  },
  hielo: {
    statusId: 'congelado', trail: 'minecraft:snowflake_particle', impact: 'random.glass', cast: 'random.glass', orbScale: 1.0,
    proj: { count: 3, spread: 5, share: 0.45, size: 0.3, noun: '3 esquirlas de hielo en abanico', trait: 'Cada esquirla inflige el 45 % del daño.' },
    zone: 'la escarcha ralentiza a todo el que entra', rain: 'carámbanos gigantes',
  },
  luz: {
    statusId: 'radiante', trail: 'minecraft:totem_particle', impact: 'random.orb', cast: 'beacon.activate', orbScale: 1.0,
    proj: { homing: 0.25, noun: 'un orbe sagrado', trait: 'Persigue al enemigo con fuerza.' },
    zone: 'cura a los aliados que estén dentro', rain: 'lanzas de luz',
  },
  oscuridad: {
    statusId: 'maldito', trail: 'minecraft:portal_reverse_particle', impact: 'mob.endermen.portal', cast: 'mob.endermen.portal', orbScale: 1.1,
    proj: { speedMul: 0.85, size: 0.45, homing: 0.18, noun: 'una esfera de sombra', trait: 'Lenta pero persistente: sigue a su presa.' },
    zone: 'la oscuridad ciega a quien quede dentro', rain: 'esferas del vacío',
  },
  necromancia: {
    statusId: 'marchito', trail: 'minecraft:soul_particle', impact: 'mob.wither.hurt', cast: 'mob.wither.shoot', orbScale: 1.0,
    proj: { speedMul: 0.95, homing: 0.15, noun: 'una calavera espectral', trait: 'Persigue al enemigo y te devuelve parte de la vida robada.' },
    zone: 'las almas drenan la vida de los enemigos para ti', rain: 'calaveras malditas',
  },
  naturaleza: {
    statusId: 'envenenado', trail: 'minecraft:villager_happy', impact: 'dig.grass', cast: 'block.sweet_berry_bush.place', orbScale: 0.9,
    proj: { count: 2, spread: 6, share: 0.6, size: 0.3, noun: '2 espinas venenosas', trait: 'Cada espina inflige el 60 % del daño.' },
    zone: 'las raíces atrapan a los enemigos', rain: 'semillas explosivas',
  },
  arcano: {
    statusId: 'inestable', trail: 'minecraft:enchanting_table_particle', impact: 'mob.evocation_illager.cast_spell', cast: 'mob.evocation_illager.cast_spell', orbScale: 1.0,
    proj: { count: 3, stagger: 3, homing: 0.3, share: 0.38, speedMul: 0.9, size: 0.3, noun: '3 misiles arcanos', trait: 'Salen uno tras otro y buscan al enemigo; cada uno inflige el 38 % del daño.' },
    zone: 'las runas hacen levitar a los enemigos', rain: 'cometas arcanos',
  },
  sangre: {
    statusId: 'sangrando', trail: 'minecraft:critical_hit_emitter', impact: 'mob.ravager.bite', cast: 'mob.ravager.bite', orbScale: 1.0,
    proj: { speedMul: 1.25, size: 0.3, noun: 'una aguja de sangre', trait: 'Veloz; te devuelve parte de la vida robada.' },
    zone: 'el charco carmesí desangra a los enemigos y te alimenta', rain: 'dagas de sangre',
  },
};
for (const [id, x] of Object.entries(ELEMENT_EXTRA)) Object.assign(ELEMENTS[id], x, { fx: 'rpg:fx_' + id });

export const ELEMENT_IDS = Object.keys(ELEMENTS);

/* ------------------------------------------------------------------ */
/* Estados elementales                                                  */
/* ------------------------------------------------------------------ */
// ticks: duración por defecto. sym: símbolo (BMP) para el HUD.
export const STATUSES = {
  mojado: { name: 'Mojado', c: '§9', rgb: [0.3, 0.55, 1], ticks: 160, sym: '☂' },
  ardiendo: { name: 'Ardiendo', c: '§c', rgb: [1, 0.45, 0.1], ticks: 100, sym: '♨' },
  congelado: { name: 'Congelado', c: '§b', rgb: [0.65, 0.9, 1], ticks: 90, sym: '❄' },
  electrizado: { name: 'Electrizado', c: '§e', rgb: [1, 0.95, 0.3], ticks: 90, sym: '⚡' },
  envenenado: { name: 'Envenenado', c: '§2', rgb: [0.35, 0.85, 0.2], ticks: 140, sym: '☣' },
  maldito: { name: 'Maldito', c: '§8', rgb: [0.4, 0.1, 0.55], ticks: 160, sym: '☾' },
  aturdido: { name: 'Aturdido', c: '§6', rgb: [0.7, 0.5, 0.2], ticks: 60, sym: '✶' },
  sangrando: { name: 'Sangrando', c: '§4', rgb: [0.75, 0.05, 0.1], ticks: 110, sym: '♦' },
  enraizado: { name: 'Enraizado', c: '§a', rgb: [0.3, 0.8, 0.2], ticks: 60, sym: '♣' },
  marchito: { name: 'Marchito', c: '§5', rgb: [0.4, 0.85, 0.5], ticks: 130, sym: '☠' },
  radiante: { name: 'Radiante', c: '§e', rgb: [1, 1, 0.7], ticks: 130, sym: '☼' },
  inestable: { name: 'Inestable', c: '§d', rgb: [0.85, 0.4, 1], ticks: 130, sym: '✧' },
  desequilibrado: { name: 'Desequilibrado', c: '§f', rgb: [0.85, 1, 0.9], ticks: 50, sym: '~' },
  aterrado: { name: 'Aterrado', c: '§0', rgb: [0.2, 0.05, 0.3], ticks: 80, sym: '!' },
};

/** Estado que aplica cada elemento. */
export const ELEMENT_STATUS = Object.fromEntries(Object.entries(ELEMENT_EXTRA).map(([id, x]) => [id, x.statusId]));

/* ------------------------------------------------------------------ */
/* Reacciones elementales (combos)                                      */
/* ------------------------------------------------------------------ */
// el: elemento que golpea ('*' = cualquiera). on: estado que ya tiene el objetivo ('*' = cualquiera).
// mult: multiplicador de daño. fx: efectos extra (los interpreta systems/magic.js):
//   chain(n)    la descarga salta a n enemigos cercanos        explode   explosión en área (50 %)
//   stun        aturde (lentitud extrema + estado Aturdido)   freeze    congela en el sitio 3 s
//   spreadFire  el fuego se propaga a los enemigos cercanos  spreadPoison  el veneno se propaga
//   heal(x)     cura al lanzador x·daño                      root      enraíza (no puede moverse)
//   crit        golpe crítico con robo de vida               fear      el enemigo huye aterrado
//   blindAoE    nube que ciega a los enemigos cercanos       weaken    debilidad y defensas rotas
//   chill       aplica Congelado                             burst     pequeña onda (40 %)
//   refund      devuelve parte del maná                      blind     ceguera
//   wither      marchitamiento                               smite     castigo sagrado (x más a no-muertos)
// consume: el estado desaparece. noApply: el elemento atacante no deja su propio estado.
export const REACTIONS = [
  { id: 'electrocucion', name: 'Electrocución', c: '§e', el: 'rayo', on: 'mojado', mult: 2.0, fx: ['chain:3', 'stun'], consume: true, short: 'daño x2, la descarga salta a 3 enemigos y aturde' },
  { id: 'electrocucion_agua', name: 'Electrocución', c: '§e', el: 'agua', on: 'electrizado', mult: 1.8, fx: ['chain:2'], consume: true, short: 'daño x1.8 y la corriente salta a 2 enemigos' },
  { id: 'superconduccion', name: 'Superconducción', c: '§b', el: 'rayo', on: 'congelado', mult: 1.6, fx: ['weaken'], consume: true, short: 'daño x1.6 y rompe sus defensas' },
  { id: 'sobrecarga', name: 'Sobrecarga', c: '§6', el: 'rayo', on: 'ardiendo', mult: 1.5, fx: ['explode'], consume: true, short: 'daño x1.5 y explosión en área' },
  { id: 'sobrecarga_fuego', name: 'Sobrecarga', c: '§6', el: 'fuego', on: 'electrizado', mult: 1.5, fx: ['explode'], consume: true, short: 'daño x1.5 y explosión en área' },
  { id: 'derretir', name: 'Derretir', c: '§c', el: 'fuego', on: 'congelado', mult: 1.8, fx: [], consume: true, short: 'daño x1.8' },
  { id: 'vapor', name: 'Vapor', c: '§7', el: 'agua', on: 'ardiendo', mult: 1.3, fx: ['blindAoE'], consume: true, noApply: true, short: 'daño x1.3 y una nube de vapor ciega a los enemigos cercanos' },
  { id: 'vapor_fuego', name: 'Vapor', c: '§7', el: 'fuego', on: 'mojado', mult: 1.2, fx: ['blindAoE'], consume: true, noApply: true, short: 'daño x1.2 y una nube de vapor ciega a los cercanos' },
  { id: 'congelacion', name: 'Congelación', c: '§b', el: 'hielo', on: 'mojado', mult: 1.25, fx: ['freeze'], consume: true, short: 'congela al enemigo en el sitio' },
  { id: 'congelacion_agua', name: 'Congelación', c: '§b', el: 'agua', on: 'congelado', mult: 1.2, fx: ['freeze'], consume: true, short: 'congela al enemigo en el sitio' },
  { id: 'choque_termico', name: 'Choque Térmico', c: '§3', el: 'hielo', on: 'ardiendo', mult: 1.6, fx: [], consume: true, short: 'daño x1.6' },
  { id: 'torbellino_fuego', name: 'Torbellino de Fuego', c: '§6', el: 'viento', on: 'ardiendo', mult: 1.3, fx: ['spreadFire'], consume: false, short: 'aviva las llamas y las propaga a los enemigos cercanos' },
  { id: 'tormenta_electrica', name: 'Tormenta Eléctrica', c: '§e', el: 'viento', on: 'electrizado', mult: 1.3, fx: ['chain:2'], consume: true, short: 'el viento arrastra la carga a 2 enemigos más' },
  { id: 'viento_helado', name: 'Viento Helado', c: '§b', el: 'viento', on: 'mojado', mult: 1.2, fx: ['chill'], consume: true, short: 'congela al enemigo empapado' },
  { id: 'fragmentar', name: 'Fragmentar', c: '§6', el: 'tierra', on: 'congelado', mult: 2.0, fx: ['burst'], consume: true, short: 'daño x2: el hielo estalla en esquirlas' },
  { id: 'aplastamiento', name: 'Aplastamiento', c: '§6', el: 'tierra', on: 'desequilibrado', mult: 1.7, fx: ['stun'], consume: true, short: 'daño x1.7 y aturde al enemigo en el aire' },
  { id: 'lodazal', name: 'Lodazal', c: '§6', el: 'tierra', on: 'mojado', mult: 1.2, fx: ['root'], consume: true, short: 'convierte el agua en barro y lo enraíza' },
  { id: 'purificacion', name: 'Purificación', c: '§e', el: 'luz', on: 'maldito', mult: 1.5, fx: ['heal:0.3'], consume: true, short: 'daño x1.5 y te cura' },
  { id: 'consagracion', name: 'Consagración', c: '§e', el: 'luz', on: 'marchito', mult: 1.6, fx: ['smite'], consume: true, short: 'daño x1.6 (aún más contra no-muertos)' },
  { id: 'eclipse', name: 'Eclipse', c: '§5', el: 'oscuridad', on: 'radiante', mult: 1.7, fx: ['blind'], consume: true, short: 'daño x1.7 y lo deja ciego' },
  { id: 'terror', name: 'Terror', c: '§8', el: 'oscuridad', on: 'aturdido', mult: 1.3, fx: ['fear'], consume: true, short: 'el enemigo huye aterrado' },
  { id: 'plaga', name: 'Plaga', c: '§2', el: 'necromancia', on: 'envenenado', mult: 1.4, fx: ['spreadPoison'], consume: false, short: 'el veneno se pudre y contagia a los enemigos cercanos' },
  { id: 'festin_almas', name: 'Festín de Almas', c: '§5', el: 'necromancia', on: 'sangrando', mult: 1.3, fx: ['heal:0.4'], consume: true, short: 'devora la sangre derramada y te cura' },
  { id: 'florecer', name: 'Florecer', c: '§a', el: 'naturaleza', on: 'mojado', mult: 1.2, fx: ['heal:0.2', 'root'], consume: true, short: 'brotan raíces que lo atrapan y te curan' },
  { id: 'hemorragia', name: 'Hemorragia', c: '§4', el: 'sangre', on: 'sangrando', mult: 1.6, fx: ['crit'], consume: true, short: 'golpe crítico x1.6 con robo de vida' },
  { id: 'septicemia', name: 'Septicemia', c: '§4', el: 'sangre', on: 'envenenado', mult: 1.5, fx: ['wither'], consume: true, short: 'daño x1.5 y marchitamiento' },
  { id: 'combustion', name: 'Combustión Tóxica', c: '§6', el: 'fuego', on: 'envenenado', mult: 1.5, fx: ['explode'], consume: true, short: 'el gas venenoso explota' },
  { id: 'pira', name: 'Pira Forestal', c: '§c', el: 'fuego', on: 'enraizado', mult: 1.8, fx: [], consume: true, short: 'las raíces arden: daño x1.8' },
  { id: 'desestabilizar', name: 'Desestabilizar', c: '§d', el: '*', on: 'inestable', mult: 1.35, fx: ['burst'], consume: true, short: 'la marca arcana estalla (x1.35 y onda)' },
  { id: 'resonancia', name: 'Resonancia', c: '§d', el: 'arcano', on: '*', mult: 1.3, fx: ['refund'], consume: true, short: '+30 % de daño contra cualquier estado y recuperas maná' },
];

/** Busca la reacción que provoca el elemento elId sobre un objetivo con los estados dados (en orden de prioridad). */
export function findReaction(elId, statusIds) {
  if (!statusIds || !statusIds.length) return undefined;
  const own = ELEMENT_STATUS[elId];
  for (const r of REACTIONS) {
    if (r.el !== '*' && r.el !== elId) continue;
    if (r.el === '*' && elId === 'arcano') continue;
    if (r.on === '*') {
      const st = statusIds.find((s) => s !== own && s !== 'aterrado');
      if (st) return { ...r, status: st };
      continue;
    }
    if (statusIds.includes(r.on)) return { ...r, status: r.on };
  }
  return undefined;
}

/** Reacciones que provoca el elemento (como atacante) y las que prepara (su estado). */
export function reactionsFor(elId) {
  const own = ELEMENT_STATUS[elId];
  const triggers = REACTIONS.filter((r) => r.el === elId || (r.el === '*' && elId !== 'arcano'));
  const setups = REACTIONS.filter((r) => r.on === own && r.el !== elId && r.el !== '*');
  return { triggers, setups, status: own };
}

function stName(id) {
  const st = STATUSES[id];
  return st ? `${st.c}${st.name}` : '§fcualquier estado';
}

function elName(id) {
  const e = ELEMENTS[id];
  return e ? `${e.c}${e.name}` : '§fcualquier elemento';
}

/** Texto de combos para la descripción de una habilidad. */
function combosText(elId) {
  const { triggers, setups, status } = reactionsFor(elId);
  const lines = [];
  if (status) lines.push(`§7Deja al objetivo ${stName(status)}§7.`);
  if (triggers.length) lines.push('§d✦ Combos: ' + triggers.slice(0, 4).map((r) => `§7sobre ${stName(r.on)}§7 → ${r.c}${r.name}§7`).join(' · '));
  if (setups.length) lines.push('§5✦ Prepara: ' + setups.slice(0, 3).map((r) => `${elName(r.el)}§7 → ${r.c}${r.name}§7`).join(' · '));
  return lines.join('\n');
}

/** Guía completa de reacciones para el Diario (texto multilínea en español). */
export function reactionGuide() {
  const head = '§l§dReacciones elementales§r\n§7Cada elemento deja un estado en sus víctimas. Si las golpeas con OTRO elemento mientras dura, se produce una reacción con efectos especiales. ¡Combina hechizos o juega en grupo!\n\n§l§fEstados§r\n' +
    ELEMENT_IDS.map((e) => `${elName(e)}§7 → ${stName(ELEMENT_STATUS[e])}`).join('\n');
  const seen = new Set();
  const body = REACTIONS.filter((r) => !seen.has(r.name) && seen.add(r.name)).map((r) => {
    const pairs = REACTIONS.filter((x) => x.name === r.name).map((x) => `${elName(x.el)}§7 + ${stName(x.on)}`).join('§7 o ');
    return `${r.c}§l${r.name}§r§7: ${pairs}§7 — ${r.short}.`;
  }).join('\n');
  return head + '\n\n§l§fReacciones§r\n' + body;
}

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
  const ult = tier === 4 && ULT_KINDS.has(B.kind) ? 1.25 : 1;
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
    mana: Math.max(4, Math.round(B.mana * TIER_MANA[tier])),
    cd: Math.max(10, Math.round(B.cd * TIER_CD[tier] * ult * 20)),
    power: Math.round(TIER_POWER[tier] * (B.pmul ?? 1) * 10) / 10,
    radius: B.radius ? B.radius + tier : 0,
    range: B.range ? B.range + tier * 4 : 0,
    duration: B.dur ? Math.round((B.dur + tier * B.durStep) * 20) : 0,
    // v2
    speed: B.speed ? Math.round((B.speed + tier * 0.22) * 100) / 100 : 0,
    strikes: B.kind === 'rain' ? 3 + tier * 2 : 0,
    count: B.kind === 'summon' ? (tier >= 4 ? 3 : tier >= 2 ? 2 : 1) : 0,
    statusId: ELEMENT_STATUS[elementId],
    ultimate: tier === 4,
  };
  s.desc = describe(el, s);
  cache[key] = s;
  return s;
}

const DAMAGING = new Set(['bolt', 'nova', 'curse', 'lance', 'zone', 'rain']);
/** Elementos cuya Potenciación crea además un aura que daña a los enemigos cercanos (systems/magic.js). */
export const OFFENSIVE_AURA = new Set(['fuego', 'rayo', 'hielo', 'oscuridad', 'necromancia', 'sangre', 'viento']);
const HEALERS = new Set(['luz', 'agua', 'naturaleza']);
const EFFECT_NAMES = {
  strength: 'Fuerza', fire_resistance: 'Resistencia al fuego', regeneration: 'Regeneración', water_breathing: 'Respiración acuática',
  resistance: 'Resistencia', health_boost: 'Vida extra', speed: 'Velocidad', jump_boost: 'Salto', slow_falling: 'Caída lenta',
  haste: 'Prisa', absorption: 'Absorción', night_vision: 'Visión nocturna', invisibility: 'Invisibilidad', saturation: 'Saturación',
};

/** Elemento con artículo ("el fuego", "la luz"...). */
const WITH_ARTICLE = {
  fuego: 'el fuego', agua: 'el agua', tierra: 'la tierra', viento: 'el viento', rayo: 'el rayo', hielo: 'el hielo', luz: 'la luz',
  oscuridad: 'la oscuridad', necromancia: 'la necromancia', naturaleza: 'la naturaleza', arcano: 'la magia arcana', sangre: 'la sangre',
};

function boltText(el, s, st, eln) {
  const p = el.proj ?? {};
  const many = (p.count ?? 1) > 1;
  const noun = p.noun ?? `un orbe de ${eln}`;
  let t = `Dispara ${noun} desde tu mano hacia donde apuntas (alcance ${s.range}). ` +
    (many ? 'Vuelan de verdad: chocan con los muros y se curvan' : 'Vuela de verdad: choca con los muros y se curva') +
    ` suavemente hacia el enemigo más cercano a tu mira. ${many ? 'Potencia total' : 'Daño'} ~${s.power}; además, ${st}.`;
  if (p.trait) t += ' ' + p.trait;
  if (s.tier >= 3) t += ' A este nivel estalla al impactar y salpica a los enemigos cercanos.';
  return t;
}

function spirits(n, eln) {
  return n === 1 ? `un espíritu de ${eln} que te sigue, reaparece a tu lado si te alejas y ataca` : `${n} espíritus de ${eln} que te siguen, reaparecen a tu lado si te alejas y atacan`;
}

function describe(el, s) {
  const st = STATUS_TEXT[el.status];
  const secs = (s.duration / 20).toFixed(0);
  const eln = el.name.toLowerCase();
  let main = '';
  switch (s.kind) {
    case 'bolt': main = boltText(el, s, st, eln); break;
    case 'nova': main = `Libera una onda expansiva de ${eln} que crece desde tus pies (radio ${s.radius}): inflige ~${s.power} a cada enemigo que alcanza y lo empuja; además, ${st}.`; break;
    case 'buff': {
      const effs = el.buff.map((b) => EFFECT_NAMES[b[0]] ?? b[0].replace(/_/g, ' ')).join(', ');
      main = `Te envuelve en un aura de ${eln} durante ${secs} s: ${effs} (nivel ${s.tier + 1}).`;
      if (OFFENSIVE_AURA.has(s.element) && s.tier >= 1) main += ` Mientras dure, el aura daña a los enemigos que se te acerquen y les deja ${eln === 'viento' ? 'desequilibrados' : 'su marca elemental'}.`;
      if (s.element === 'sangre') main += ' Cuesta un poco de tu propia vida.';
      if (s.element === 'arcano') main += ' Duplica tu regeneración de maná.';
      break;
    }
    case 'curse': main = `Lanza zarcillos de ${eln} a los enemigos frente a ti (cono, alcance ${s.range}, hasta 6 objetivos): ~${s.power} de daño; además, ${st} con gran intensidad y su estado elemental dura mucho más: ideal para preparar reacciones.`; break;
    case 'lance': main = `Dispara un haz de ${eln} veloz como una flecha que atraviesa a todos los enemigos en línea (alcance ${s.range}), ~${s.power} de daño a cada uno.`; break;
    case 'zone': main = `Crea un dominio de ${eln} en el suelo (radio ${s.radius}), marcado por un anillo brillante durante ${secs} s: cada medio segundo inflige ~${s.power} a quien esté dentro (${st}); además, ${el.zone ?? 'castiga a quien entre'}.`; break;
    case 'ward': main = `Te rodea de un escudo de ${eln}: absorción y cura ~${Math.round(s.power * 3 + 4)} de vida${HEALERS.has(s.element) ? ' (también a los aliados cercanos)' : ''}${['necromancia', 'sangre'].includes(s.element) ? '; además drena la vida de los enemigos cercanos' : ''}${['tierra', 'hielo'].includes(s.element) ? '; además te da Resistencia' : ''}${s.element === 'oscuridad' ? '; además te vuelve invisible un momento' : ''}.`; break;
    case 'step': main = el.step === 'blink' ? `Te teletransporta hasta ${s.range} bloques hacia donde miras, dejando una estela de ${eln}.` : el.step === 'leap' ? `Un gran salto impulsado por ${WITH_ARTICLE[s.element] ?? eln}${s.element === 'tierra' ? '; al aterrizar provoca un temblor que daña y aturde' : s.element === 'viento' ? '; al aterrizar suelta una ráfaga que derriba a los enemigos' : ''}.` : `Una embestida de ${eln} que daña a quien atravieses (~${Math.round(s.power * 0.6 * 10) / 10}).`; break;
    case 'summon': main = `Invoca durante ${secs} s ${spirits(s.count, eln)} a lo que tú golpeas${HEALERS.has(s.element) ? (s.count === 1 ? '; además te cura cada pocos segundos' : '; además te curan cada pocos segundos') : ''}. Sus golpes dejan el estado de su elemento.`; break;
    case 'rain': main = `Marca una zona (radio ${s.radius}) y hace caer del cielo ${s.strikes} ${el.rain ?? 'impactos de ' + eln} que buscan a los enemigos; cada impacto inflige ~${s.power} en área.`; break;
  }
  if (s.tier === 4) main += ' §6Hechizo legendario: su lanzamiento sacude la tierra.§r';
  else if (s.tier === 3 && ['nova', 'zone', 'rain'].includes(s.kind)) main += ' Su poder hace temblar el suelo.';
  return DAMAGING.has(s.kind) || (s.kind === 'step' && el.step !== 'blink') ? main + '\n' + combosText(s.element) : main;
}

/** Habilidades que se pueden aprender ahora (requisitos de rama). */
export function prereqOk(learned, idx) {
  if (idx < 10) return true;
  return learned.includes(idx - 10);
}
