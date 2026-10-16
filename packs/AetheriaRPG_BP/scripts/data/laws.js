// Leyes de Aetheria: delitos, estrellas de búsqueda, castigos, botín de los bolsillos y todas las frases
// de la justicia (testigos, guardias, abucheos, cárcel). Solo datos: la lógica vive en
// systems/crime.js (sigilo, robos, testigos, búsqueda) y systems/justice.js (arresto, cepo, prisión).

/* ------------------------------------------------------------------ */
/* Ajustes (los administradores pueden sobrescribirlos en W().settings) */
/* ------------------------------------------------------------------ */

export const LAWS = {
  humiliationSeconds: 60, // castigo público en el cepo (delito menor, 1★)
  jailMinutesSerious: 15, // prisión por delito grave (2-3★), minutos de juego en línea
  jailMinutesMurder: 30, // prisión por asesinato (4-5★)
  maxJailMinutes: 45, // tope al sumar condenas pendientes (fugas)
  maxStars: 5,
  decaySeconds: 120, // −1★ cada 120 s sin que te vea un guardia y fuera de cualquier asentamiento
  witnessTimeout: 25, // s: si el testigo no llega hasta un guardia, sus gritos acaban oyéndose igual
  reportDistance: 3, // bloques: el testigo denuncia al llegar junto a un guardia
  huntRadius: 64, // guardias que salen a buscarte
  escortTimeout: 60, // s: si la escolta se atasca, se teletransporta al destino
  arrestTouchTicks: 20, // ticks junto a un guardia que te persigue = arresto
  arrestTouchDist: 2,
  ropeLength: 1.6,
  jeerRadius: 24,
  maxJeerers: 8,
  paradeSeconds: 24, // parte del castigo en la que te pasean por la plaza
  patrolMin: 120, // s entre rondas del carcelero
  patrolMax: 240,
  patrolSeconds: 40,
  keyReach: 2.5, // distancia al carcelero para intentar robarle la llave
  doorOpenSeconds: 8,
  escapeNoticeSeconds: 20,
  tiedExtraSeconds: 60,
  sightRange: 16, // alcance de la vista a plena luz
  fovHalfAngle: 70, // medio ángulo del campo de visión de los NPCs (grados)
  hearRadius: 2.5, // a esta distancia te oyen aunque estén de espaldas (si no vas agachado)
  sprintHearRadius: 4.5,
  trespassCooldown: 120,
  heroKarma: 400, // a partir de aquí la guardia perdona un delito menor al día por tus hazañas
};

/** Etiquetas visibles de los ajustes (para el menú de administración). */
export const LAW_LABELS = {
  humiliationSeconds: 'Segundos de castigo público (cepo)',
  jailMinutesSerious: 'Minutos de prisión por delito grave',
  jailMinutesMurder: 'Minutos de prisión por asesinato',
  decaySeconds: 'Segundos para perder una estrella de búsqueda',
};

/* ------------------------------------------------------------------ */
/* Delitos                                                             */
/* ------------------------------------------------------------------ */

// stars[strictness]: estrellas que añade según la severidad del reino (0 laxo, 1 normal, 2 estricto).
// kind: familia de frases de los testigos. karma: penalización inmediata al cometerlo. art: artículo ("un hurto", "una agresión").
export const CRIMES = {
  hurto: { name: 'Hurto', art: 'un', stars: [1, 1, 1], kind: 'theft', karma: -4, glyph: '\uE305' },
  robo_casa: { name: 'Robo en vivienda', art: 'un', stars: [1, 1, 2], kind: 'house', karma: -6, glyph: '\uE30E' },
  robo_noble: { name: 'Robo a la nobleza', art: 'un', stars: [1, 2, 2], kind: 'theft', karma: -8, glyph: '\uE309' },
  allanamiento: { name: 'Allanamiento de morada', art: 'un', stars: [1, 1, 1], kind: 'trespass', karma: -3, glyph: '\uE30E' },
  agresion: { name: 'Agresión', art: 'una', stars: [1, 1, 2], kind: 'violence', karma: -5, glyph: '\uE30C' },
  agresion_guardia: { name: 'Agresión a la guardia', art: 'una', stars: [2, 2, 3], kind: 'violence', karma: -8, glyph: '\uE30A' },
  asesinato: { name: 'Asesinato', art: 'un', stars: [4, 4, 5], kind: 'murder', karma: 0, glyph: '\uE30B', min: 4 },
  asesinato_guardia: { name: 'Asesinato de un guardia', art: 'el', stars: [4, 5, 5], kind: 'murder', karma: -20, glyph: '\uE30B', min: 4 },
  fuga: { name: 'Fuga de prisión', art: 'una', stars: [2, 2, 2], kind: 'escape', karma: -10, glyph: '\uE308' },
};

export const CRIME_IDS = Object.keys(CRIMES);

/** Severidad del castigo según las estrellas. */
export function severityOf(stars) {
  if (stars >= 4) return 'murder';
  if (stars >= 2) return 'serious';
  return 'minor';
}

export const SEVERITY_NAMES = { minor: 'delito menor', serious: 'delito grave', murder: 'crimen de sangre' };

export const STRICTNESS_NAMES = ['indulgente', 'firme', 'implacable'];

/* ------------------------------------------------------------------ */
/* Botín                                                               */
/* ------------------------------------------------------------------ */

// Dinero en la bolsa de un NPC si su identidad no trae `wallet` (por clase social).
export const WALLET_DEFAULT = { baja: [2, 12], media: [10, 35], alta: [40, 140] };

// Botín de los cofres de las casas (bolsita escondida), por clase.
export const COFFER_GOLD = { baja: [2, 9], media: [8, 26], alta: [25, 80] };

// Objetos que a veces llevan en el bolsillo según su oficio: [id, min, max, nombre].
export const POCKET_ITEMS = {
  granjero: [['minecraft:wheat_seeds', 2, 6, 'semillas'], ['minecraft:carrot', 1, 3, 'zanahorias'], ['minecraft:bread', 1, 2, 'pan']],
  herrero: [['minecraft:iron_nugget', 2, 7, 'pepitas de hierro'], ['minecraft:iron_ingot', 1, 1, 'un lingote de hierro']],
  mercader: [['minecraft:emerald', 1, 2, 'esmeraldas'], ['minecraft:gold_nugget', 2, 6, 'pepitas de oro'], ['minecraft:paper', 1, 3, 'pagarés']],
  tabernero: [['minecraft:honey_bottle', 1, 1, 'un tarro de miel'], ['rpg:tomato', 1, 3, 'tomates'], ['minecraft:cookie', 1, 3, 'galletas']],
  sacerdote: [['minecraft:candle', 1, 2, 'velas'], ['minecraft:paper', 1, 2, 'oraciones escritas']],
  sacerdotisa: [['minecraft:candle', 1, 2, 'velas'], ['rpg:mana_potion', 1, 1, 'una poción de maná']],
  noble: [['minecraft:gold_ingot', 1, 2, 'lingotes de oro'], ['minecraft:emerald', 1, 3, 'esmeraldas'], ['minecraft:diamond', 1, 1, 'un diamante']],
  rey: [['minecraft:diamond', 1, 2, 'diamantes'], ['minecraft:gold_ingot', 2, 4, 'lingotes de oro']],
  mendigo: [['minecraft:stick', 1, 1, 'un palito'], ['minecraft:bone', 1, 1, 'un hueso roído']],
  ladron: [['rpg:lockpick', 1, 2, 'ganzúas'], ['minecraft:gold_nugget', 1, 4, 'pepitas de oro']],
  guardia: [['minecraft:iron_nugget', 1, 3, 'pepitas de hierro'], ['minecraft:bread', 1, 1, 'su almuerzo']],
  carcelero: [['minecraft:bread', 1, 1, 'un mendrugo']],
  bardo: [['minecraft:string', 1, 3, 'cuerdas de laúd'], ['minecraft:cookie', 1, 2, 'galletas']],
  aventurero: [['minecraft:arrow', 2, 6, 'flechas'], ['minecraft:torch', 1, 4, 'antorchas'], ['rpg:mana_potion', 1, 1, 'una poción de maná']],
  maestro: [['minecraft:book', 1, 1, 'un libro'], ['minecraft:paper', 1, 3, 'pergaminos']],
  recepcionista: [['minecraft:paper', 1, 4, 'formularios del Gremio'], ['minecraft:ink_sac', 1, 1, 'tinta']],
  aldeano: [['minecraft:apple', 1, 2, 'manzanas'], ['minecraft:bread', 1, 1, 'pan']],
};
export const POCKET_ITEMS_DEFAULT = [['minecraft:apple', 1, 2, 'manzanas'], ['minecraft:gold_nugget', 1, 3, 'pepitas de oro']];

// Objetos escondidos en cofres por clase.
export const COFFER_ITEMS = {
  baja: [['minecraft:bread', 1, 2, 'pan'], ['minecraft:coal', 1, 3, 'carbón'], ['minecraft:string', 1, 2, 'cuerda']],
  media: [['minecraft:iron_ingot', 1, 2, 'hierro'], ['minecraft:emerald', 1, 1, 'una esmeralda'], ['minecraft:candle', 1, 2, 'velas']],
  alta: [['minecraft:gold_ingot', 1, 3, 'oro'], ['minecraft:emerald', 1, 3, 'esmeraldas'], ['minecraft:diamond', 1, 1, 'un diamante'], ['minecraft:amethyst_shard', 1, 3, 'amatistas']],
};

/* ------------------------------------------------------------------ */
/* Minijuego de robo                                                   */
/* ------------------------------------------------------------------ */

export const MINIGAME = {
  cells: 32, // ancho de la barra
  prepTicks: 8, // tiempo para "meter la mano" antes de que corra la aguja
  maxTicks: 150, // límite para soltar
  zone: { baja: 7.5, media: 5.5, alta: 4, guard: 4, key: 3.5, lock_baja: 7, lock_media: 5, lock_alta: 3.5 },
  speed: { baja: 0.7, media: 0.8, alta: 1.0, guard: 0.95, key: 1.05, lock_baja: 0.65, lock_media: 0.8, lock_alta: 0.95 },
};

/* ------------------------------------------------------------------ */
/* Frases                                                              */
/* ------------------------------------------------------------------ */

// Gritos de los testigos (se rellenan {victim} y {thief}; {masculino|femenino} según el jugador, ver say()).
export const SHOUTS = {
  theft: [
    '¡AL LADRÓN! ¡AL LADRÓN!',
    '¡Guardias! ¡Me han robado la bolsa!',
    '¡Eh, tú! ¡Suelta eso ahora mismo!',
    '¡{Un ratero|Una ratera}! ¡Que alguien llame a la guardia!',
    '¡Socorro! ¡{Un carterista|Una carterista} en la plaza!',
    '¡Te he visto, sinvergüenza! ¡GUARDIAS!',
    '¡Le ha metido la mano en el bolsillo a {victim}! ¡GUARDIAS!',
  ],
  house: [
    '¡Hay {un ladrón|una ladrona} en la casa! ¡GUARDIAS!',
    '¡Están saqueando la casa de los vecinos!',
    '¡Alguien ha forzado un cofre! ¡Que venga la guardia!',
    '¡{Un saqueador|Una saqueadora}! ¡Cerrad las puertas!',
  ],
  trespass: [
    '¡Fuera de mi casa! ¡GUARDIAS!',
    '¡{Un intruso|Una intrusa}! ¡Hay {un intruso|una intrusa} en casa!',
    '¿¡Qué haces aquí dentro a estas horas!? ¡Socorro!',
  ],
  violence: [
    '¡Socorro! ¡Me atacan!',
    '¡GUARDIAS! ¡{Un loco|Una loca} está pegando a la gente!',
    '¡Auxilio! ¡Llamad a la guardia!',
    '¡Ha golpeado a {victim}! ¡A la guardia, rápido!',
  ],
  murder: [
    '¡{ASESINO|ASESINA}! ¡HA MATADO A {victim}!',
    '¡Sangre en la calle! ¡GUARDIAS, {UN ASESINO|UNA ASESINA}!',
    '¡Que alguien avise a la guardia! ¡Han matado a {victim}!',
    '¡No! ¡{victim}! ¡{Asesino, asesino|Asesina, asesina}!',
  ],
  escape: [
    '¡Se ha escapado {un preso|una presa}! ¡Cerrad las puertas!',
    '¡La celda está vacía! ¡A por {thief}!',
    '¡Fuga! ¡Fuga en la prisión!',
  ],
};

// Lo que dice la víctima al pillarte con la mano en su bolsillo.
export const VICTIM_NOTICE = [
  '¡Eh! ¿¡Qué haces con mis cosas!?',
  '¡Esa mano no es la mía! ¡{Ladrón|Ladrona}!',
  '¡Mi bolsa! ¡Suelta mi bolsa!',
  '¿Me estabas robando? ¡GUARDIAS!',
  '¡Te he pillado, rata!',
  '¡Manos quietas, granuja!',
];

// El testigo llega hasta el guardia.
export const REPORT_LINES = [
  '«¡Guardia! ¡{thief} acaba de cometer {crime}! ¡Lo he visto con mis propios ojos!»',
  '«¡Por fin le encuentro! ¡Ha sido {thief}, se lo juro!»',
  '«¡Rápido, guardia! ¡{thief} anda suelto por ahí!»',
];
export const GUARD_ACK = [
  '«Tranquilícese, ciudadano. Daremos con esa rata.»',
  '«¿Hacia dónde ha ido? ¡Vamos!»',
  '«Ya está. Nadie escapa de la guardia.»',
  '«Bien hecho. Nosotros nos encargamos.»',
];

// Guardias al empezar a perseguirte ({of} = "del Rey", "de la Reina", "del Consejo"...).
export const HUNT_SHOUTS = [
  '¡Alto en nombre {of}!',
  '¡Tú! ¡{Quieto|Quieta} ahí!',
  '¡Ríndete y nadie saldrá herido!',
  '¡Ahí está! ¡A por {thief}!',
  '¡No tienes adonde huir, {thief}!',
  '¡Detened a {thief}!',
];

// Guardia al detenerte.
export const ARREST_LINES = [
  '«Quedas {detenido} en nombre {of}.»',
  '«Se acabó la carrera. Las manos a la espalda.»',
  '«Vas a responder por tus crímenes, {thief}.»',
  '«¿Creías que no te íbamos a encontrar? Andando.»',
];
export const ESCORT_STOCKS_LINES = [
  '«Al cepo contigo. A ver si así aprendes.»',
  '«Camina. Que todo el pueblo vea lo que les pasa a los ladrones.»',
  '«Un minuto de vergüenza pública. Lo has ganado a pulso.»',
];
export const ESCORT_JAIL_LINES = [
  '«A la celda. Allí tendrás tiempo de sobra para pensar.»',
  '«Camina y no hagas tonterías, o será peor.»',
  '«El carcelero estará encantado de conocerte.»',
];

// Pregón al llegar a la plaza.
export const PROCLAMATIONS = [
  '¡Escuchad, gentes de {place}! {thief} ha sido {condenado} por {crimes}. ¡Contemplad su vergüenza!',
  '¡Atención, vecinos de {place}! Aquí tenéis a {thief}, culpable de {crimes}. ¡Que sirva de escarmiento!',
  '¡Por orden {of}, {thief} será {expuesto} en la plaza por {crimes}!',
];

// Abucheos durante el castigo público.
export const JEERS = [
  '¡{Ladrón|Ladrona}!',
  '¡Que te sirva de lección!',
  '¡Sinvergüenza!',
  '¡Devuelve lo que robaste!',
  '¡Toma tomate!',
  '¡Mira qué valiente ahora!',
  '¡Mi abuela corre más rápido que tú!',
  '¡Vergüenza te debería dar!',
  '¡A ver si así aprendes!',
  '¡Rata de callejón!',
  '¡Mis tomates valen más que tú!',
  '¡{Ladrón|Ladrona} de gallinas!',
  '¡Buuuuu!',
  '¡Esto por la bolsa de mi vecina!',
  '¡Que no se te ocurra volver por aquí!',
  '¡Ja! ¡Pareces una ensalada!',
  '¡Ese tomate era el más maduro, de nada!',
  '¡Ni los cuervos se te acercan!',
];
export const JEERS_BY_KIND = {
  violence: ['¡{Matón|Matona} de pacotilla!', '¡Ahora no pegas tan fuerte, ¿eh?!', '¡{Abusón|Abusona}!'],
  house: ['¡{Saqueador|Saqueadora} de casas!', '¡Mi cofre no es tuyo!', '¡Ni las gallinas están a salvo contigo!'],
  trespass: ['¡{Fisgón|Fisgona}!', '¡Las casas ajenas no se pisan!'],
  theft: ['¡Carterista!', '¡Manos largas!', '¡Uñas ligeras!'],
};

export const STOCKS_RELEASE = [
  'El guardia corta la cuerda: «Largo de aquí. Y que no te vuelva a ver robando.»',
  'El guardia te desata de un tirón: «Castigo cumplido. La próxima vez será la celda.»',
  '«Ya puedes irte. Y lávate, que apestas a tomate.»',
];

export const JAIL_ENTER = [
  'La puerta de hierro se cierra con un golpe seco tras de ti.',
  'El guardia te empuja dentro de la celda y echa la llave con una sonrisa.',
  'Huele a humedad y a paja vieja. {Bienvenido|Bienvenida} a tu nuevo hogar.',
];
export const JAIL_FLAVOR = [
  'Una rata cruza la celda y te mira con desprecio.',
  'Gotea agua del techo. Plic. Plic. Plic.',
  'Alguien en otra celda tararea una canción triste.',
  'Rascas una marca más en la pared.',
  'Te llega el olor del guiso de los guardias. No es para ti.',
  'A lo lejos, un guardia ronca como un oso.',
  'Las cadenas de la pared tintinean con la corriente.',
  'Un preso susurra: «Dicen que el carcelero es muy descuidado con sus llaves...»',
  'Cuentas las piedras del muro. Otra vez.',
];
export const PATROL_START = [
  'Se oyen pasos y el tintineo de un manojo de llaves... el carcelero hace su ronda.',
  'El carcelero baja las escaleras silbando, con las llaves colgando del cinto.',
  'Una antorcha se acerca por el pasillo: es la ronda del carcelero.',
];
export const PATROL_FOOD = 'El carcelero te pasa un mendrugo de pan duro entre los barrotes.';
export const KEY_HINT = '§8(Agáchate junto a los barrotes cuando el carcelero pase cerca para intentar robarle la llave.)';
export const KEY_CAUGHT = [
  '¡El carcelero te agarra la muñeca! «¿Buscabas esto?» Te atan las manos hasta el final de tu condena.',
  '«¡Ja! ¿Creías que no me daría cuenta?» El carcelero te ata las manos a la espalda.',
];
export const KEY_SUCCESS = '¡Tienes la llave de la celda! Úsala junto a la puerta cuando nadie mire.';
export const JAIL_RELEASE = [
  'Has cumplido tu condena. El carcelero abre la puerta: «Fuera. Y no vuelvas.»',
  'La puerta chirría. «Eres libre... por ahora. Te estaremos vigilando.»',
  'Tu condena ha terminado. El aire de fuera nunca había olido tan bien.',
];

export const BRIBE_OFFER = [
  'El guardia mira a ambos lados y baja la voz: «Por {gold} monedas... podría no haberte visto.»',
  '«Mira, a mí me pagan una miseria. {gold} de oro y aquí no ha pasado nada.»',
];
export const BRIBE_ACCEPT = ['«Un placer hacer negocios. Ahora, esfúmate.»', '«No te he visto. Nunca.»'];
export const BRIBE_REFUSE_STRICT = '«¿Sobornarme a mí? En este reino la ley no se vende.»';

export const NOBLE_FINE = '«Ah, alguien de buena familia... Pagad la multa de {gold} de oro y olvidaremos el asunto.»';
export const HERO_PARDON = [
  '«Un momento... ¡tú eres quien {deed}! Por esta vez, quedará en una advertencia.»',
  '«Héroes como tú no deberían rebajarse a esto. Te lo perdono... una vez.»',
];
export const HERO_DEEDS = ['salvó a la aldea de los monstruos', 'limpió aquella mazmorra', 'derrotó a aquel jefe terrible', 'ayuda a todo el mundo'];

export const DECAY_LINES = [
  'La guardia está perdiendo tu rastro...',
  'Parece que han dejado de buscarte por aquí.',
  'Los carteles con tu cara empiezan a despegarse.',
];
export const LOST_TRAIL = 'La guardia ha perdido tu pista. Ya no te buscan.';

// Reacciones al recibir un tomatazo de un jugador (sin delito).
export const TOMATO_REACT = [
  '¡Oye! ¡Que esto no es la fiesta de la Tomatina!',
  '¡Mi ropa nueva!',
  '¡Puaj! ¡Gamberro!',
  '¿Pero qué...? ¡Qué falta de respeto!',
];

/* ------------------------------------------------------------------ */
/* Utilidades de texto                                                 */
/* ------------------------------------------------------------------ */

const FEM_TITLES = new Set(['reina', 'emperatriz', 'matriarca', 'gran matriarca', 'suma sacerdotisa', 'sacerdotisa', 'duquesa', 'archiduquesa', 'princesa', 'jefa', 'gran jefa', 'señora', 'dama', 'regente', 'gran dama']);

/** "del Rey", "de la Reina", "del Consejo", "de la ley"... */
export function ofRuler(realm) {
  const gov = realm?.government;
  const t = realm?.ruler?.title;
  if (gov === 'consejo' && !t) return 'del Consejo';
  if (!t) return 'de la ley';
  return (FEM_TITLES.has(String(t).toLowerCase()) ? 'de la ' : 'del ') + t;
}

/** Rellena {claves} y elige {masculino|femenino} según ctx.fem (el jugador al que se refiere la frase). */
export function say(template, ctx = {}) {
  return String(template)
    .replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (m, a, b) => (ctx.fem ? b : a))
    .replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? String(ctx[k]) : m));
}

/** "un hurto", "una agresión", "el asesinato de un guardia"... */
export function crimeWithArticle(type) {
  const c = CRIMES[type];
  if (!c) return 'un delito';
  return `${c.art ?? 'un'} ${c.name.toLowerCase()}`;
}

/** Lista legible de delitos: "Hurto y Agresión". */
export function crimeList(types) {
  const names = [...new Set((types ?? []).map((t) => CRIMES[t]?.name ?? t))].map((n) => n.toLowerCase());
  if (!names.length) return 'alterar el orden';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
}
