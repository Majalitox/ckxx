// Sociedad de Aetheria: clases sociales, oficios, horarios de los NPCs, frases ambientales (bocadillos),
// conversaciones entre NPCs, eventos de mercado, categorías de precios, menú de la taberna, jornales,
// rumores y hazañas. Solo datos y funciones puras (sin acceso al mundo).
//
// Convenciones de texto (las resuelve chat.genderize):
//   "palabra/a"  → género del jugador     "palabra/A" → género del NPC que habla
// Variables entre llaves ({p}, {trato}, {reino}...) se rellenan con util/text.fill.

/* ------------------------------------------------------------------ */
/* Clases sociales del jugador                                          */
/* ------------------------------------------------------------------ */

// rank 0..5. name: [masculino, femenino]
export const CLASSES = [
  { id: 'mendigo', rank: 0, name: ['Mendigo', 'Mendiga'], c: '§8', desc: 'Sin hogar ni fortuna. La gente aparta la mirada a tu paso.' },
  { id: 'plebeyo', rank: 1, name: ['Plebeyo', 'Plebeya'], c: '§7', desc: 'Gente sencilla del pueblo llano. Nadie te mira dos veces.' },
  { id: 'ciudadano', rank: 2, name: ['Ciudadano', 'Ciudadana'], c: '§f', desc: 'Vecino respetable, con casa o licencia del Gremio.' },
  { id: 'burgues', rank: 3, name: ['Burgués', 'Burguesa'], c: '§e', desc: 'Tu bolsa pesa. Los mercaderes te tratan como a un buen cliente.' },
  { id: 'caballero', rank: 4, name: ['Caballero', 'Dama'], c: '§b', desc: 'Guerrero/a de prestigio. La plebe te saluda con respeto.' },
  { id: 'noble', rank: 5, name: ['Noble', 'Noble'], c: '§6', desc: 'Tienes título nobiliario. Los campesinos se inclinan ante ti.' },
];
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

// Requisitos de clase (los usa systems/social.playerClass).
export const CLASS_RULES = {
  burguesGold: 1000, // oro para ser burgués
  burguesGoldRich: 600, // si naciste en familia acomodada
  burguesTrade: 3000, // oro total vendido/comprado con éxito (éxito mercantil)
  burguesTradeLvl: 15, // o nivel de comercio
  caballeroGuildRank: 4, // rango B del Gremio
  ciudadanoGold: 150, // si naciste en familia humilde: casa + este oro (o ser del Gremio)
  plebeyoGold: 15, // sin casa, al menos esto para no ser mendigo
};

// Capas de fama (no sustituyen a la clase: se suman a ella).
export const OVERLAYS = {
  heroe: { id: 'heroe', minFame: 400, name: ['Héroe', 'Heroína'], c: '§e' },
  leyenda: { id: 'leyenda', minFame: 900, name: ['Leyenda', 'Leyenda'], c: '§6' },
  temido: { id: 'temido', minInfamy: 300, name: ['Temido', 'Temida'], c: '§c' },
};

// Niveles de fama dentro de un reino.
export const FAME_TIERS = [
  [0, 'Desconocido/a', '§7'], [40, 'Conocido/a', '§f'], [120, 'Respetado/a', '§a'], [250, 'Célebre', '§b'],
  [400, 'Héroe del reino', '§e'], [900, 'Leyenda viva', '§6'],
];
export const INFAMY_TIERS = [
  [0, 'Sin antecedentes', '§7'], [30, 'Sospechoso/a', '§e'], [100, 'Malhechor/a', '§6'], [200, 'Temido/a', '§c'], [400, 'Proscrito/a', '§4'],
];

/** Tratamiento que da un NPC al jugador según su clase: [m, f]. */
export const ADDRESS = {
  noble_from_low: ['mi señor', 'mi señora'],
  noble_from_high: ['excelencia', 'excelencia'],
  caballero: ['señor caballero', 'mi dama'],
  burgues: ['buen señor', 'buena señora'],
  ciudadano: ['vecino', 'vecina'],
  plebeyo: ['muchacho', 'muchacha'],
  mendigo: ['pordiosero', 'pordiosera'],
  hero: ['héroe', 'heroína'],
  child: ['pequeño', 'pequeña'],
};

/* ------------------------------------------------------------------ */
/* Oficios de los NPCs                                                  */
/* ------------------------------------------------------------------ */

export const HAT = { none: 0, straw: 1, hood: 2, noble: 3, helmet: 4, crown: 5, bandana: 6, chef: 7 };
export const TOOL = { none: 0, sword: 1, spear: 2, hoe: 3, hammer: 4, tankard: 5, staff: 6, torch: 7 };
export const CLS_IDS = ['baja', 'media', 'alta'];
export const CLS_INDEX = { baja: 0, media: 1, alta: 2, guardia: 3 };
export const CLS_NAMES = { baja: 'clase baja', media: 'clase media', alta: 'nobleza' };

// Dinero en la bolsa según la clase (mismo rango que data/laws.js WALLET_DEFAULT).
export const WALLET = { baja: [2, 12], media: [10, 35], alta: [40, 140] };
export const MERCHANT_WALLET = [180, 420];

/**
 * Datos de cada oficio:
 *  cls: clase por defecto ('mix' = baja/media al azar), hats/tools: candidatos (por hash), kind: evento de aparición
 *  (guard|citizen|staff|resident), sched: perfil de horario, work: actividad de trabajo, disguise: etiqueta falsa.
 */
export const JOBS = {
  granjero: { cls: 'baja', hats: ['straw', 'straw', 'none'], tools: ['hoe'], kind: 'citizen', sched: 'worker', work: 'work_field', dayJob: 'harvest' },
  herrero: { cls: 'media', hats: ['none', 'bandana'], tools: ['hammer'], kind: 'citizen', sched: 'worker', work: 'work_forge', dayJob: 'ore' },
  mercader: { cls: 'media', hats: ['none', 'bandana', 'straw'], tools: ['none'], kind: 'citizen', sched: 'worker', work: 'work_market' },
  tabernero: { cls: 'media', hats: ['bandana', 'chef'], tools: ['tankard'], kind: 'citizen', sched: 'tavern', work: 'tavern', dayJob: 'serve' },
  sacerdote: { cls: 'media', hats: ['none'], tools: ['staff'], kind: 'citizen', sched: 'priest', work: 'church' },
  sacerdotisa: { cls: 'media', hats: ['none'], tools: ['staff'], kind: 'staff', sched: 'staff', work: 'church' },
  noble: { cls: 'alta', hats: ['noble'], tools: ['none', 'staff'], kind: 'citizen', sched: 'noble', work: 'plaza' },
  mendigo: { cls: 'baja', hats: ['hood', 'none'], tools: ['none'], kind: 'citizen', sched: 'beggar', work: 'plaza' },
  ladron: { cls: 'baja', hats: ['hood', 'none'], tools: ['none'], kind: 'citizen', sched: 'thief', work: 'tavern', disguise: ['Forastero', 'Forastera'] },
  guardia: { cls: 'guardia', hats: ['helmet'], tools: ['spear', 'sword'], kind: 'guard', sched: 'guard', work: 'patrol' },
  carcelero: { cls: 'guardia', hats: ['helmet'], tools: ['sword'], kind: 'guard', sched: 'jailer', work: 'patrol_jail' },
  rey: { cls: 'alta', hats: ['crown'], tools: ['staff'], kind: 'staff', sched: 'ruler', work: 'idle' },
  aldeano: { cls: 'mix', hats: ['none', 'none', 'straw'], tools: ['none'], kind: 'citizen', sched: 'villager', work: 'mix' },
  recepcionista: { cls: 'media', hats: ['none'], tools: ['none'], kind: 'staff', sched: 'staff' },
  maestro: { cls: 'media', hats: ['none'], tools: ['sword'], kind: 'staff', sched: 'staff' },
  sombra: { cls: 'baja', hats: ['hood'], tools: ['none'], kind: 'staff', sched: 'staff' },
  padre: { cls: 'media', hats: ['none'], tools: ['none'], kind: 'resident', sched: 'family' },
  madre: { cls: 'media', hats: ['none'], tools: ['none'], kind: 'resident', sched: 'family' },
  hermano: { cls: 'media', hats: ['none'], tools: ['none'], kind: 'resident', sched: 'family' },
  hermana: { cls: 'media', hats: ['none'], tools: ['none'], kind: 'resident', sched: 'family' },
  aventurero: { cls: 'media', hats: ['none', 'hood'], tools: ['sword', 'spear'], kind: 'resident', sched: 'adventurer' },
  bardo: { cls: 'media', hats: ['noble', 'bandana', 'none'], tools: ['tankard', 'none'], kind: 'citizen', sched: 'bard', work: 'plaza' },
};
export const JOB_IDS = Object.keys(JOBS);
export const GUILD_STAFF = new Set(['recepcionista', 'maestro', 'sombra']);

/* ------------------------------------------------------------------ */
/* Horarios                                                             */
/* ------------------------------------------------------------------ */
// Tiempo del día de Minecraft: 0 = 6:00 (amanecer), 6000 = mediodía, 12000 = 18:00, 18000 = medianoche.
// Cada perfil: lista de [inicio, actividad]. Comodines que resuelve life.js:
//   @work (trabajo del oficio), @lunch (plaza o taberna), @afternoon, @evening (taberna, iglesia, plaza o casa),
//   @patrol (patrol_0..3 rotando cada ~40 s), @thief (taberna o mercado concurrido).
export const SCHEDULES = {
  worker: [[0, 'idle'], [1000, '@work'], [5000, '@lunch'], [7000, '@work'], [11000, '@evening'], [13500, 'home'], [15000, 'sleep'], [23000, 'idle']],
  tavern: [[0, 'sleep'], [1500, 'idle'], [2500, 'work_market'], [4000, 'tavern'], [19000, 'home'], [19800, 'sleep']],
  priest: [[0, 'church'], [5000, 'plaza'], [6500, 'church'], [14000, 'home'], [15000, 'sleep'], [23500, 'church']],
  noble: [[0, 'sleep'], [2000, 'idle'], [3000, 'plaza'], [5000, 'home'], [7000, '@afternoon'], [10500, 'church'], [12000, 'plaza'], [14000, 'home'], [16000, 'sleep']],
  beggar: [[0, 'idle'], [500, 'plaza'], [4500, 'church'], [7000, 'plaza'], [11000, 'tavern'], [14000, 'plaza'], [15500, 'sleep'], [23500, 'idle']],
  thief: [[0, 'sleep'], [4000, 'tavern'], [6000, '@thief'], [11000, 'tavern'], [13000, 'idle'], [23000, 'tavern']],
  guard_day: [[0, '@patrol'], [12000, 'tavern'], [13500, 'home'], [14500, 'sleep'], [23000, '@patrol']],
  guard_night: [[0, 'home'], [800, 'sleep'], [5000, 'idle'], [6000, 'tavern'], [9000, 'plaza'], [11500, '@patrol']],
  jailer: [[0, 'patrol_jail'], [3000, 'idle'], [6000, 'patrol_jail'], [9000, 'idle'], [12000, 'patrol_jail'], [15000, 'idle'], [18000, 'patrol_jail'], [21000, 'idle']],
  ruler: [[0, 'idle']],
  villager: [[0, 'idle'], [1000, '@work'], [5000, '@lunch'], [7000, '@afternoon'], [11000, '@evening'], [13500, 'home'], [15000, 'sleep'], [23000, 'idle']],
  bard: [[0, 'sleep'], [3000, 'idle'], [4000, 'plaza'], [9000, 'tavern'], [20000, 'sleep']],
  adventurer: [[0, 'idle'], [5000, 'tavern'], [7000, 'idle'], [11500, 'tavern'], [17000, 'idle']],
  child: [[0, 'idle'], [1500, 'plaza'], [5500, 'home'], [6500, 'plaza'], [11000, 'home'], [13000, 'sleep'], [23500, 'idle']],
  family: [[0, 'idle'], [14000, 'sleep'], [23000, 'idle']],
  family_child: [[0, 'idle'], [12800, 'sleep'], [23500, 'idle']],
  staff: [[0, 'idle']],
};

// Actividad → tipo de marcador (waypoint) que necesita.
export const ACT_WAYPOINT = {
  work_field: 'field', work_forge: 'forge', work_market: 'market', tavern: 'tavern', plaza: 'plaza', home: 'home', church: 'church',
  patrol_0: 'patrol_0', patrol_1: 'patrol_1', patrol_2: 'patrol_2', patrol_3: 'patrol_3', patrol_jail: 'jail_patrol',
};
// Si falta el marcador: alternativa.
export const ACT_FALLBACK = {
  work_field: 'plaza', work_forge: 'plaza', work_market: 'plaza', tavern: 'plaza', church: 'plaza', home: 'idle', plaza: 'idle',
  patrol_0: 'plaza', patrol_1: 'plaza', patrol_2: 'plaza', patrol_3: 'plaza', patrol_jail: 'idle',
};
// Actividades al aire libre (con lluvia se van a cubierto).
export const OUTDOOR = new Set(['work_field', 'plaza', 'work_market', 'idle']);
export const ACTIVITIES = ['idle', 'work_field', 'work_forge', 'work_market', 'tavern', 'plaza', 'home', 'church', 'sleep',
  'patrol_0', 'patrol_1', 'patrol_2', 'patrol_3', 'patrol_jail', 'alarm', 'jeer', 'flee', 'hunt', 'escort_stocks', 'escort_jail'];

/* ------------------------------------------------------------------ */
/* Bocadillos: frases ambientales                                       */
/* ------------------------------------------------------------------ */

export const BARK_TIME = {
  dawn: ['¡Ya canta el gallo!', 'Otro día más... ¡a trabajar!', '*bosteza* Qué pronto amanece.', 'Qué fresco está el alba.', 'Huele a pan recién hecho.'],
  morning: ['Hermosa mañana, ¿verdad?', 'Con este sol da gusto trabajar.', '¡Buenos días a todos!', 'La mañana es de quien madruga.'],
  noon: ['¡Qué hambre! Ya es hora de comer.', 'El sol pega fuerte hoy.', 'Un descanso y un buen guiso, eso necesito.', 'Mediodía... mis tripas suenan más que las campanas.'],
  afternoon: ['La tarde se hace larga.', 'Un poco más y termino por hoy.', 'Qué sopor después de comer...'],
  evening: ['Pronto anochecerá. Hay que recogerse.', 'Una jarra en la taberna no me vendría mal.', 'Mira qué atardecer más rojo.', 'Encended los faroles, que oscurece.'],
  night: ['No deberías andar por ahí de noche...', 'Dicen que los monstruos rondan las murallas.', '*bosteza* Me caigo de sueño.', 'Qué silencio... no me gusta.', 'Cierra bien la puerta esta noche.'],
};

export const BARK_WEATHER = {
  rain: ['¡Maldita lluvia! Se me van a pudrir las coles.', 'Llueve a cántaros...', 'Al menos los campos beberán.', '¡A cubierto, que cae un buen chaparrón!', 'Con este tiempo, mejor junto al fuego.'],
  thunder: ['¡Por los doce dioses, qué trueno!', 'Los rayos me ponen los pelos de punta.', 'Dicen que las tormentas despiertan a los muertos...', '¡Que no caiga un rayo en el campanario otra vez!'],
  clear: ['Por fin escampa.', 'Mira, ya sale el sol.', 'Qué bien huele la tierra mojada.'],
};

export const BARK_ACT = {
  work_field: ['Esta cosecha va a ser buena...', 'Ay, mi espalda...', 'Malditos cuervos.', 'Si llueve un poco más, tendremos trigo para todo el invierno.', '*silba mientras trabaja*'],
  work_forge: ['¡Clang! Este acero no se forja solo.', 'Más carbón, que se enfría la fragua.', 'El hierro hay que trabajarlo al rojo.', '*martillea con fuerza*'],
  work_market: ['¡Manzanas frescas! ¡Barato, barato!', '¡Pasen y vean, género de primera!', '¡Telas de oriente! ¡Especias!', '¡Hoy hago precio, aprovechen!', '¡A buen precio, señores, a buen precio!'],
  tavern: ['¡Otra ronda, tabernero!', '¡Salud!', 'Esta cerveza está aguada...', '*canturrea una canción de taberna*', '¿Una partida de dados?'],
  plaza: ['Qué animada está la plaza hoy.', '¿Has oído las nuevas?', 'Me encanta el sonido de la fuente.', 'Mira cuánta gente.'],
  church: ['Que los doce dioses nos protejan.', '*reza en voz baja*', 'Hoy encenderé una vela por mi abuela.', 'Silencio, que estamos en lugar sagrado.'],
  home: ['Por fin en casa.', 'Hogar, dulce hogar.', 'A ver qué hay para cenar.'],
  sleep: ['Zzz...', 'Zzz... cinco minutos más...', '*ronca*', 'Zzz... mi oro... no...', 'Zzz... ¡no, el queso no!'],
  patrol: ['Circulen, circulen.', 'Todo en orden.', 'Ojos abiertos.', 'Nada que reportar.', 'Mantened la paz.'],
  flee: ['¡Pies, para qué os quiero!', '¡No me cogeréis!'],
  idle: ['Hmm...', 'Qué día...', '¿Dónde habré dejado mis llaves?', 'A ver si hoy pasa algo interesante.'],
};

export const BARK_JOB = {
  granjero: ['Las gallinas no ponen como antes.', 'El trigo de este año está precioso.', 'Si me ayudas con la siega, te pago un jornal.'],
  herrero: ['Una buena espada es para toda la vida.', 'Necesito más mineral de hierro.', 'Esta herradura no se va a hacer sola.'],
  mercader: ['El comercio mueve el mundo.', 'Compro barato, vendo... a precio justo.', 'Mis cuentas no cuadran...'],
  tabernero: ['¡La mejor cerveza del reino!', 'Hoy hay estofado.', 'Si buscas noticias, la taberna lo sabe todo.'],
  sacerdote: ['Los dioses ven todo lo que haces.', 'Una limosna para el templo, hermano/a.', 'Arrepiéntete y serás perdonado/a.'],
  sacerdotisa: ['La luz te guíe.', 'Los doce velan por nosotros.'],
  noble: ['Qué gentuza hay hoy en la plaza.', 'Mañana hay baile en la corte.', 'Mi caballo vale más que esta aldea.', 'Los impuestos son necesarios... para mí.'],
  mendigo: ['Una monedita, por caridad...', 'Tengo hambre...', 'Los dioses se lo pagarán, buena gente.', 'Hace tres días que no como caliente.'],
  ladron: ['Bonita bolsa la tuya...', '*silba disimuladamente*', 'Yo no he visto nada.', 'Hay mucha gente hoy... perfecto.'],
  guardia: ['Circulen.', 'La ley es la ley.', 'Tengo los pies destrozados.', 'Ni un altercado en mi turno, ¿entendido?'],
  carcelero: ['Las celdas están llenas de ratas... y de presos.', 'Nadie se escapa de mi prisión.'],
  rey: ['Mi pueblo es mi orgullo.', 'Que traigan al bufón.', 'La corona pesa más de lo que parece.'],
  aldeano: ['Qué tiempos estos.', 'Mi vecino ronca como un trol.', 'A ver si llega la feria.'],
  bardo: ['♪ Había una vez un dragón y un enano... ♪', '♪ ¡Oh, la doncella del molino! ♪', '♪ Brindad, brindad por los valientes... ♪', 'Necesito una nueva musa.'],
  aventurero: ['Vengo de una mazmorra de rango C. Casi no lo cuento.', '¿Alguien sabe de algún trabajo bien pagado?', 'Mis botas tienen más leguas que yo.'],
};

// Reacciones al jugador según su clase (rango) y la clase del NPC que habla.
// Claves: rango del jugador; dentro, clase del NPC (baja|media|alta) o 'any'.
export const BARK_CLASS = {
  5: {
    baja: ['*hace una reverencia* {trato}.', 'Buenos días tenga, {trato}.', '¡Abrid paso a {trato}!', '*se quita el sombrero* {trato}...', 'Es un honor, {trato}.'],
    media: ['Saludos, {trato}. ¿Desea algo de mi tienda?', '*inclina la cabeza* {trato}.', 'Qué honor verle por aquí, {trato}.'],
    alta: ['Ah, {p}. Un placer ver a alguien de nuestra posición.', 'Querido/a {p}, ¿asistirá al baile de la corte?', '*saluda con elegancia* Mi estimado/a {p}.'],
  },
  4: {
    baja: ['¡Saludos, {trato}!', 'Qué porte... se nota que es del Gremio.', '*se cuadra* ¡{trato}!'],
    media: ['Un placer, {trato}. Gracias por proteger los caminos.', 'Con gente como usted, dormimos tranquilos.'],
    alta: ['Un caballero/a de verdad. Así me gusta.', 'Sir {p}. Su espada honra este reino.'],
  },
  3: {
    baja: ['Qué ropas tan finas...', 'Seguro que ése/a no sabe lo que es pasar hambre.', '*mira tu bolsa con envidia*'],
    media: ['¡Buen cliente! Pase por mi tienda cuando quiera.', 'Buenos días, {trato}.'],
    alta: ['Nuevo rico... se le nota en los modales.', 'El dinero no compra la sangre, querido/a.'],
  },
  2: {
    any: ['Buenas, {trato}.', 'Buen día, {p}.', '¿Qué tal, {trato}?', 'Saludos, vecino/a.'],
    alta: ['*asiente con desgana*', 'Hmm. Buenos días.'],
  },
  1: {
    baja: ['¡Eh, compañero/a!', '¿Qué tal la vida, {p}?', 'Los de abajo tenemos que ayudarnos.'],
    media: ['Buenas.', '¿Buscas trabajo, {trato}?'],
    alta: ['Hmph. Otro/a campesino/a.', 'No te acerques tanto, plebeyo/a.', '*se tapa la nariz con un pañuelo*'],
  },
  0: {
    baja: ['Toma, compartamos este mendrugo.', 'Ánimo, {p}. Saldrás de esta.'],
    media: ['Pobre criatura...', 'Lo siento, no llevo suelto.', '*aparta la mirada*'],
    alta: ['¡Apártate, harapiento/a!', 'Qué olor... ¿No hay leyes contra esto?', '¡Guardias, que alguien se lleve a este/a pordiosero/a!'],
  },
};

export const BARK_FAME = {
  heroe: ['¡Mira, es {quien}!', '¡Es {p}, el héroe/la heroína de {reino}!', '¡Bendito/a seas, {p}!', '¡Mamá, mamá! ¡Es {p}!', 'Mi hijo quiere ser como tú de mayor, {p}.'],
  leyenda: ['¡Una leyenda viva camina entre nosotros!', '¡Es {p}! ¡{quien}!', 'Los bardos cantan tus gestas, {p}.', '*se arrodilla* ¡Es un honor!'],
  known: ['Oye, ¿ése/a no es {quien}?', 'He oído hablar de ti, {p}.', 'Tú eres {p}, ¿verdad? Algo he oído.'],
};

export const BARK_CRIME = {
  wanted: ['Ése/a es a quien buscan los guardias...', 'Tiene la cara de los carteles de la plaza...', '*susurra* No le mires, que es el/la de los carteles.'],
  thief: ['Ése/a es el ladrón/la ladrona del mercado...', 'Cuidado con tu bolsa, ahí va {p}.', 'Escóndete la bolsa, que por ahí viene el/la carterista.', '*se agarra la bolsa con fuerza*'],
  murder: ['Dicen que ha matado a alguien... no le mires.', 'Asesino/a...', '*se aparta, temblando*', 'Que los dioses nos protejan de ése/a.'],
  humiliated: ['¡Eh, {p}! ¿Te quedan tomates en el pelo?', 'Yo te vi en la picota, ¡ja!', 'Ahí va el/la de los tomates.'],
  villain: ['*se santigua*', 'Que los dioses nos protejan...', 'Mejor entrar en casa...'],
};

export const BARK_CHILD = ['¡Qué niño/a tan mono/a!', '¡Eh, pequeñajo/a, no corras!', '¿Dónde están tus padres, {p}?', '¡Cómo has crecido, {p}!'];

export const BARK_RACE = {
  hate: ['Los {raza_plural} no son bienvenidos aquí.', 'Vigila a ése/a, es {raza}...', '*escupe al suelo*', 'Otro/a {raza}... lo que faltaba.'],
  love: ['¡Un/a {raza}! Siempre es un placer.', 'Los {raza_plural} siempre son bienvenidos aquí.'],
};

// Rumores sobre otros NPCs (sin género para evitar errores).
export const BARK_GOSSIP = [
  '¿Has visto a {otro}? Dicen que le debe dinero a medio pueblo.',
  'Ayer vi a {otro} salir de la taberna a gatas.',
  '{otro} dice que vio un fantasma en el cementerio.',
  'No te fíes de {otro}, que se le pegan los dedos.',
  '{otro} se pasa el día mirando a la hija del herrero.',
  'Dicen que {otro} esconde oro bajo el colchón.',
  '{otro} cocina el mejor estofado del pueblo.',
  '¿Sabías que {otro} sabe leer? Quién lo diría.',
  '{otro} ronca tanto que se oye desde la plaza.',
  'A {otro} le rompieron el corazón la semana pasada.',
];

// El reino y su gobernante. {soberano} = "el Rey Alfonso", {al_soberano} = "al Rey Alfonso", {del_soberano}, {Soberano}; {reino}
export const BARK_REALM = {
  rich: ['¡Larga vida {al_soberano}!', '{reino} nunca fue tan próspero.', 'Con {soberano} no nos falta de nada.'],
  poor: ['Los impuestos {del_soberano} nos van a dejar en la ruina.', 'En palacio comen faisán y aquí, nabos.', 'Algún día el pueblo se cansará...'],
  war: ['Dicen que {soberano} prepara una guerra.', 'Reclutan soldados en la capital.'],
  magic: ['En {reino} la magia lo es todo.', 'Los magos de la corte hacen experimentos raros...'],
  strict: ['Aquí la guardia no perdona ni un robo de manzanas.', 'Las leyes de {reino} son duras, ten cuidado.'],
  lax: ['Aquí los guardias hacen la vista gorda... si les das algo.', 'En {reino} la ley es más bien una sugerencia.'],
};
export const BARK_OTHER_REALM = [
  'En {otro_reino} dicen que los guardias se dejan sobornar.',
  'Mi primo se fue a {otro_reino}. Dice que allí el oro corre como el agua.',
  'No me fío de la gente de {otro_reino}.',
  'Dicen que en {otro_reino} cobran impuestos hasta por respirar.',
  'He oído que en {otro_reino} la cerveza es mejor. Mentira, seguro.',
];

/* ------------------------------------------------------------------ */
/* Conversaciones entre NPCs (2–3 frases alternas; A, B, A)              */
/* ------------------------------------------------------------------ */
// {a} y {b}: nombres. {evento}: evento de mercado. Grupos por contexto.
export const CONVOS = {
  any: [
    ['¿Qué tal todo, {b}?', 'Tirando, {a}. Como siempre.', 'Pues eso, que no es poco.'],
    ['¿Has oído lo del molino?', '¿Qué ha pasado?', 'Nada, que sigue girando. ¡Ja!'],
    ['Esta noche hay luna llena.', 'Pues yo cierro bien la puerta, {a}.'],
    ['¿Me prestas cinco monedas, {b}?', '¿Otra vez? Aún me debes las del mes pasado.', 'Bueno, bueno... era por preguntar.'],
    ['¿Te has enterado de lo de {otro}?', '¡No! Cuéntamelo todo.', 'Aquí no, que hay orejas por todas partes.'],
    ['Dicen que ha aparecido una mazmorra cerca.', 'Que vayan los del Gremio. Yo no me acerco.'],
  ],
  work: [
    ['¿Qué tal la cosecha, {b}?', 'Mal, {a}. Los cuervos se lo comen todo.', 'Pues pon un espantapájaros, hombre.'],
    ['¿Me arreglas la azada, {b}?', 'Mañana. Hoy tengo diez herraduras pendientes.'],
    ['¿Cuánto por ese saco de trigo?', 'Para ti, precio de amigo.', 'Eso dices siempre... y luego me cobras el doble.'],
  ],
  prices: [
    ['¿Has visto lo que cuesta el pan?', '{evento}... así no hay quien viva.', 'Y luego dicen que no nos quejemos.'],
    ['Hoy he vendido el doble, {b}.', 'Será por {evento}. Aprovecha mientras dure.'],
  ],
  tavern: [
    ['¡Otra ronda, que pago yo!', '¿Tú? ¿Pagando? ¡Que alguien avise al rey!', '¡Ja! Pues hoy sí.'],
    ['Esta cerveza sabe a agua de charco.', 'Pues bien que te has bebido cuatro, {a}.'],
    ['¿Una partida de dados, {b}?', 'Contigo no, que siempre ganas.', 'Será que tengo suerte...'],
  ],
  guard: [
    ['¿Novedades en la muralla?', 'Nada, salvo un gato muy sospechoso.', 'Vigílalo de cerca.'],
    ['Me duelen los pies de tanto patrullar.', 'Y a mí la cabeza de oír tus quejas, {a}.'],
    ['¿Has visto a algún ladrón?', 'Solo al recaudador de impuestos.', 'Shh, que te pueden oír.'],
  ],
  noble: [
    ['¿Asistirá al baile, {b}?', 'Por supuesto. Y estrenaré capa de terciopelo.', 'Qué audaz... a la moda de la capital.'],
    ['La plebe está muy revuelta últimamente.', 'Nada que un par de festejos no arregle.'],
  ],
  noble_low: [
    ['Buenos días, mi señor.', 'Hmph. Apártate, que me manchas la capa.'],
    ['¿Una monedita, señoría?', '¡Fuera de mi vista!', '...que los dioses le guarden, señoría.'],
  ],
  night: [
    ['¿Has oído eso?', 'Será el viento...', 'El viento no gruñe, {b}.'],
    ['Me voy a dormir, {b}.', 'Que descanses. Y cierra bien.'],
  ],
  rain: [
    ['¡Menudo chaparrón!', 'Bueno para el campo, malo para mis huesos.'],
  ],
  player: [
    ['¿Ves a {p}?', '¿El/la de {clase_jugador}?', 'Ése/a mismo/a. Dicen que es {fama_jugador}.'],
    ['¿Conoces a {p}?', 'Algo he oído... {rumor_jugador}'],
  ],
};

/* ------------------------------------------------------------------ */
/* Economía                                                             */
/* ------------------------------------------------------------------ */

export const CATEGORY_NAMES = {
  comida: 'comida', armas: 'armas', armaduras: 'armaduras', pociones: 'pociones', magia: 'objetos mágicos', minerales: 'minerales',
  botin: 'botín de monstruos', lujo: 'artículos de lujo', sellos: 'sellos de jefe', herramientas: 'herramientas', otros: 'mercancías',
};

/** Categoría de un objeto para los precios. */
export function itemCategory(id) {
  const s = String(id ?? '');
  if (s.includes('seal_')) return 'sellos';
  if (/bread|beef|apple|cookie|cake|pie|carrot|potato|wheat|cod|salmon|honey|stew|mutton|chicken|porkchop|melon|berries|beetroot|tomato/.test(s) && !s.includes('golden_apple')) return 'comida';
  if (/potion|elixir/.test(s)) return 'pociones';
  if (/grimoire|staff_|rune_stone|mana_crystal|journal/.test(s)) return 'magia';
  if (/_sword|bow|arrow|_axe|trident|crossbow|greataxe|hammer/.test(s)) return 'armas';
  if (/chestplate|helmet|leggings|boots|shield/.test(s)) return 'armaduras';
  if (/_ore|ingot|raw_|diamond|emerald|coal|redstone|lapis|amethyst|netherite|mithril|adamantite|quartz/.test(s)) return 'minerales';
  if (/rotten_flesh|bone|string|gunpowder|spider_eye|leather|monster_core|boss_core|feather|slime|ender_pearl|blaze_rod/.test(s)) return 'botin';
  if (/ring|golden_apple|noble_title|crown/.test(s)) return 'lujo';
  if (/torch|pickaxe|shovel|hoe|fishing_rod|lockpick/.test(s)) return 'herramientas';
  return 'otros';
}

// Modificadores de precio por cultura del asentamiento (1 = normal; <1 abunda y es barato).
export const CULTURE_PRICES = {
  humano: { comida: 0.95, lujo: 1.0 },
  elfo: { pociones: 0.8, magia: 0.9, armas: 1.15, minerales: 1.15, comida: 0.95 },
  enano: { armas: 0.8, armaduras: 0.8, minerales: 0.8, herramientas: 0.85, pociones: 1.2, comida: 1.1 },
  orco: { armas: 0.85, botin: 0.85, comida: 0.9, magia: 1.3, lujo: 1.2, pociones: 1.15 },
  bestia: { comida: 0.85, botin: 0.85, magia: 1.15, armaduras: 1.1 },
  demonio: { magia: 0.85, pociones: 0.9, botin: 0.9, comida: 1.15 },
  celestial: { pociones: 0.85, magia: 0.95, lujo: 1.1, botin: 1.15 },
  vampiro: { lujo: 0.9, pociones: 0.95, comida: 1.2 },
  hada: { pociones: 0.75, magia: 0.85, comida: 0.9, armas: 1.3, armaduras: 1.3, minerales: 1.2 },
  draconido: { minerales: 0.9, armas: 0.9, lujo: 0.9, comida: 1.1 },
};

// Modificadores por el foco económico del reino.
export const FOCUS_PRICES = {
  minería: { minerales: 0.8, herramientas: 0.9, armas: 0.95 },
  agricultura: { comida: 0.75, pociones: 1.05 },
  comercio: { _all: 0.95, lujo: 0.9 },
  guerra: { armas: 0.85, armaduras: 0.85, comida: 1.1, lujo: 1.1 },
  magia: { pociones: 0.85, magia: 0.85, armas: 1.05 },
};

// Impuesto real sobre las compras, según el gobierno (+2 % por cada nivel de severidad).
export const TAX_BY_GOV = { monarquía: 0.08, consejo: 0.05, tribal: 0.03, teocracia: 0.1, clan: 0.06 };

// Eventos de mercado (uno como mucho por asentamiento y día). buy/sell: multiplicadores por categoría (_all = todo).
export const MARKET_EVENTS = [
  { id: 'escasez_pan', name: 'Escasez de pan', w: 3, buy: { comida: 1.6 }, sell: { comida: 1.5 },
    lines: ['¡El pan está por las nubes! ¡Escasez de trigo!', 'Dicen que la cosecha se ha perdido... el pan cuesta el doble.', 'Si tienes trigo, véndelo hoy: pagan una fortuna.'] },
  { id: 'cosecha', name: 'Cosecha abundante', w: 3, buy: { comida: 0.7 }, sell: { comida: 0.75 },
    lines: ['¡Cosecha abundante! La comida está regalada.', 'Hay tanto grano que no saben dónde guardarlo.'] },
  { id: 'caravana_enana', name: 'Caravana enana', w: 2, buy: { armas: 0.8, armaduras: 0.8, minerales: 0.85 },
    lines: ['Ha llegado una caravana enana: armas baratas en el mercado.', '¡Acero enano a buen precio! Corre antes de que se acabe.'] },
  { id: 'fiebre_oro', name: 'Fiebre del mineral', w: 2, sell: { minerales: 1.35 }, buy: { minerales: 1.15 },
    lines: ['¡Pagan el mineral a precio de oro!', 'Los herreros compran todo el hierro que les lleves.'] },
  { id: 'guerra', name: 'Rumores de guerra', w: 2, buy: { armas: 1.35, armaduras: 1.35, comida: 1.1 }, sell: { armas: 1.3, armaduras: 1.25 },
    lines: ['Rumores de guerra... las espadas han subido de precio.', 'El ejército compra todo el acero. ¡Precios de locos!'] },
  { id: 'festival', name: 'Fiesta mayor', w: 2, buy: { comida: 1.15, lujo: 0.85 }, sell: { lujo: 1.2 },
    lines: ['¡Hoy es fiesta mayor! Hay música en la plaza.', '¡Fiesta! Los joyeros hacen descuentos.'] },
  { id: 'bandidos', name: 'Bandidos en los caminos', w: 2, buy: { _all: 1.15 }, sell: { _all: 0.95 },
    lines: ['Hay bandidos en los caminos; las caravanas no llegan y todo sube.', 'Sin caravanas no hay género. Todo está más caro.'] },
  { id: 'tormenta_mana', name: 'Tormenta de maná', w: 1, buy: { pociones: 1.4, magia: 1.3 }, sell: { magia: 1.3, pociones: 1.3 },
    lines: ['Una tormenta de maná ha agotado las pociones.', 'Los magos pagan lo que sea por cristales de maná.'] },
  { id: 'plaga', name: 'Plaga de ratas', w: 1, buy: { comida: 1.3 }, sell: { comida: 1.2, botin: 1.1 },
    lines: ['¡Las ratas se han comido los graneros!', 'Plaga de ratas... ya no queda queso en todo el pueblo.'] },
  { id: 'feria', name: 'Gran feria', w: 2, buy: { _all: 0.88 }, sell: { _all: 1.05 },
    lines: ['¡Gran feria! Los mercaderes rebajan sus precios.', '¡Feria, feria! Hoy todo es más barato.'] },
  { id: 'caza', name: 'Temporada de caza', w: 2, sell: { botin: 1.4 }, buy: { armas: 1.05 },
    lines: ['Pagan bien las pieles y el botín de monstruos.', 'Temporada de caza: el Gremio compra núcleos a buen precio.'] },
];

/* ------------------------------------------------------------------ */
/* Taberna                                                              */
/* ------------------------------------------------------------------ */

// [id, cantidad, precio base, nombre, efecto opcional]
export const TAVERN_MENU = [
  ['minecraft:bread', 2, 4, 'Pan recién horneado ×2'],
  ['minecraft:mushroom_stew', 1, 5, 'Sopa de setas de la casa'],
  ['minecraft:cooked_beef', 2, 9, 'Estofado de ternera (2 raciones)'],
  ['minecraft:cooked_salmon', 1, 6, 'Salmón a la brasa'],
  ['minecraft:pumpkin_pie', 1, 7, 'Tarta de calabaza'],
  ['minecraft:cookie', 4, 3, 'Galletas de la abuela ×4'],
  ['minecraft:honey_bottle', 1, 5, 'Hidromiel', 'mead'],
  ['rpg:mana_potion', 1, 24, 'Licor de maná del sótano'],
];
export const ROUND_PRICE = 15; // invitar a una ronda

/* ------------------------------------------------------------------ */
/* Jornales ("Trabajo por un día")                                      */
/* ------------------------------------------------------------------ */

export const DAY_JOBS = {
  granjero: {
    type: 'harvest', need: [8, 14], wage: [16, 26], xp: 30,
    title: 'Jornal en el campo', desc: 'Cosecha {n} cultivos maduros en los campos de {s} y vuelve a por tu paga.',
    offer: ['Me vendrían bien unas manos más en el campo. ¿Te animas?', 'La siega no espera. Te pago un jornal justo.'],
    done: ['¡Buen trabajo! Aquí tienes tu jornal, bien ganado.', 'Tienes buena mano para el campo. Toma, tu paga.'],
  },
  herrero: {
    type: 'ore', need: [4, 8], wage: [22, 36], xp: 35,
    items: [['minecraft:raw_iron', 'hierro en bruto'], ['minecraft:coal', 'carbón'], ['minecraft:raw_copper', 'cobre en bruto']],
    title: 'Encargo de la fragua', desc: 'Lleva {n} × {item} a la fragua de {s}.',
    offer: ['Me he quedado sin mineral. Tráeme algo y te pago bien.', 'La fragua tiene hambre. ¿Me traes mineral?'],
    done: ['¡Esto es justo lo que necesitaba! Toma tu paga.', 'Buen mineral. Así da gusto. Aquí tienes.'],
  },
  tabernero: {
    type: 'serve', need: [3, 5], wage: [12, 20], xp: 25,
    title: 'Mozo/a de taberna', desc: 'Sirve jarras a {n} clientes de {s} (habla con ellos y elige «Servir una jarra»).',
    offer: ['Hoy viene mucha gente y voy desbordado/A. ¿Me echas una mano sirviendo mesas?', 'Necesito alguien que sirva jarras. Las propinas son tuyas.'],
    done: ['¡Has servido como un/a profesional! Aquí tienes tu paga.', 'Los clientes están contentos. Toma, te lo has ganado.'],
  },
};

/* ------------------------------------------------------------------ */
/* Diálogos especiales por oficio                                       */
/* ------------------------------------------------------------------ */

// Nobles según la diferencia de clase del jugador.
export const NOBLE_TALK = {
  low: [
    'No tengo tiempo para la chusma. Circula.',
    '¿Me hablas a mí? Qué atrevimiento...',
    'Lávate antes de dirigirte a tus superiores.',
    '*te mira de arriba abajo* ¿Y tú quién te crees que eres?',
  ],
  mid: [
    'Hmm, un/a {clase}. Bueno, supongo que puedo dedicarte un momento.',
    'Los de tu clase sois el motor del reino, dicen. Yo prefiero no mancharme las manos.',
    '¿Sabes montar a caballo? Qué pregunta, claro que no.',
  ],
  high: [
    '¡{p}! Qué alegría ver a alguien con modales en este lugar.',
    'Querido/a {p}, la corte habla de ti. Bien, por supuesto.',
    'Los de nuestra posición debemos apoyarnos. ¿Una partida de ajedrez?',
  ],
  hero: [
    'Pocas veces he visto tanto valor. Es un honor, {p}.',
    'Aunque no tengas sangre noble, tus hazañas hablan por ti, {p}.',
  ],
  court: [
    'Dicen que {soberano} busca pareja para su heredero. Medio reino está conspirando.',
    'El duque de la capital ha perdido su fortuna a los dados. ¡Qué escándalo!',
    'En la última cacería real, el jabalí casi se come al chambelán.',
    'Los impuestos subirán este invierno, lo sé de buena tinta.',
    'He oído que en {otro_reino} los nobles visten de seda de araña gigante. Qué vulgaridad.',
  ],
  refuse_chat: ['Basta. Tengo asuntos más importantes que atender.', 'Ya te he dedicado demasiado tiempo. Retírate.', 'Mis criados se encargarán de ti. Adiós.'],
};

export const BEGGAR = {
  ask: ['Una monedita, por caridad...', 'Buen/a señor/a, ¿tiene algo para un pobre?', 'Hace días que no como caliente...'],
  thanks_small: ['Gracias... que los dioses se lo paguen.', 'Algo es algo. Gracias.'],
  thanks_mid: ['¡Que los doce le bendigan! Hoy comeré caliente.', '¡Gracias, gracias! Es usted un ángel.'],
  thanks_big: ['¡¿Tanto?! ¡Que los dioses le colmen de dicha! ¡No lo olvidaré jamás!', '*llora de alegría* ¡Gracias! ¡Por fin podré comprar unas botas!'],
  noble: ['¡Una noble que se acuerda de los pobres! ¡Que los dioses bendigan a su señoría!'],
  again: ['Ya me ha ayudado hoy, buen/a señor/a. Que otros lo necesitan más.'],
  rumor: ['Los pobres vemos lo que nadie ve. {rumor}', 'Un consejo gratis, por su bondad: {rumor}'],
};

export const ROYAL = {
  greet: {
    low: ['¿Quién ha dejado entrar a este/a {clase}? ...Bueno, habla. Y sé breve.', 'El trono escucha incluso a los más humildes. Habla.'],
    mid: ['Bienvenido/a a la corte de {reino}, {p}. ¿Qué te trae ante el trono?', 'Te escucho, {p}.'],
    high: ['¡{p}! El reino se honra con tu presencia.', 'Ah, {trato}. Siempre es un placer recibirte.'],
    hero: ['¡El héroe/La heroína de {reino}! Acércate, {p}. Mi pueblo te debe mucho.'],
    wanted: ['¿Te presentas ante el trono con las manos manchadas? Tienes valor... o eres idiota.'],
  },
  title_given: ['Por tus servicios a {reino}, yo, {soberano}, te nombro noble de este reino. ¡Levántate, {trato}!'],
  title_bought: ['El oro también sirve a la corona. Desde hoy, eres noble de {reino}. Que tu linaje sea largo.'],
  title_have: ['Ya eres noble, {p}. No abuses de tu posición.'],
  title_poor: ['Un título cuesta {coste} de oro, o hazañas dignas de canción. Vuelve cuando tengas una cosa u otra.'],
  pardon_ok: ['La corona es misericordiosa... y la tesorería está vacía. Quedas perdonado/a.'],
  pardon_no: ['¿Perdonar tus crímenes? En {reino} la ley no se compra.', 'No hay oro suficiente en el mundo para borrar lo que hiciste.'],
  pardon_nothing: ['No tienes cuentas pendientes con la justicia de {reino}. Mejor así.'],
  quest: ['Tengo un encargo para alguien de tu talla. Los bardos cantarán tu nombre si lo cumples.'],
  quest_busy: ['Ya te encomendé una tarea hoy. Cúmplela antes de pedir más.'],
};

// Canciones del bardo sobre el jugador. {p}: nombre, {hazana}: gesta en 3.ª persona, {verguenza}: fechoría,
// {heroe}: héroe/heroína, {asentamiento}, {trato}, {c}: propina.
export const BARD_SONG = {
  tip: 3,
  ask: ['¿Una canción? Por {c} monedas te compongo algo que hará llorar a las piedras.', '♪ Una moneda para el bardo y una copla para ti... ♪ Son {c} de oro, {trato}.', 'Dame {c} de oro y tu nombre sonará en cada taberna de aquí al mar.'],
  again: ['Ya te canté hoy, {trato}. Mi garganta necesita cerveza, no más versos.', 'Mañana te compongo otra, palabra de bardo. Hoy ya no me queda voz.'],
  open: ['♪ Escuchad, gentes de {asentamiento}, escuchad esta canción... ♪', '♪ Brindad, brindad, y prestad atención... ♪', '♪ De tierras lejanas os traigo una historia... ♪', '♪ Callad un momento, que el bardo va a cantar... ♪'],
  glory: [
    '♪ Cantan los vientos que {p} {hazana}, ♪\n♪ y tiemblan los monstruos al oír su nombre. ♪',
    '♪ Ni el miedo ni el frío detienen sus pasos: ♪\n♪ {p} {hazana}, ¡qué grande es su hazaña! ♪',
    '♪ Dicen los viejos junto al fuego del hogar ♪\n♪ que {p} {hazana}... ¡y lo volverá a hacer! ♪',
  ],
  unknown: [
    '♪ De {p} poco se sabe, apenas un nombre, ♪\n♪ mas dicen que un día será gran {heroe}. ♪',
    '♪ Llegó sin hazañas, con polvo en las botas, ♪\n♪ y {p} se llama: ¡recordad su nombre! ♪',
  ],
  shame: [
    '♪ Mas ojo, vecinos, guardad bien la bolsa, ♪\n♪ que {p} {verguenza}... y eso no se olvida. ♪',
    '♪ Y aunque sonría con cara de santo/a, ♪\n♪ {p} {verguenza}: ¡la guardia lo sabe! ♪',
  ],
  cls: {
    0: '♪ No tiene ni casa, ni pan, ni camisa, ♪\n♪ pero le sobran valor y sonrisa. ♪',
    1: '♪ Del pueblo llano, de manos curtidas, ♪\n♪ camina sin miedo por calles y ermitas. ♪',
    2: '♪ Vecino/a honrado/a de buena reputación, ♪\n♪ saluda a la gente con el corazón. ♪',
    3: '♪ Su bolsa tintinea con oro y con plata: ♪\n♪ ¡que pague la ronda quien tanto se trata! ♪',
    4: '♪ Con espada y escudo, orgullo del Gremio, ♪\n♪ protege caminos sin pedir ni un premio. ♪',
    5: '♪ Noble de cuna o noble de mérito, ♪\n♪ ¡larga vida a su casa y a su linaje bendito! ♪',
  },
  close: ['♪ ¡Y aquí acaba la copla, que el bardo tiene sed! ♪', '♪ ¡Brindad por {p}, y otra ronda también! ♪', '♪ Y colorín colorado, esta copla se ha acabado. ♪'],
  cheer: ['¡Bravo!', '¡Otra, otra!', '¡Viva {p}!', '*aplaude*', '¡Qué bien canta el condenado!'],
};

export const GUARD_LAW_INTRO = [
  'Escucha bien, que no lo repetiré.',
  'La ley de {reino} es clara.',
  'Más te vale cumplir las normas mientras estés aquí.',
];

/* ------------------------------------------------------------------ */
/* Rumores (la taberna, los mendigos, las respuestas del chat)           */
/* ------------------------------------------------------------------ */

export const RUMOR_TEMPLATES = {
  settlement: ['Al {dir} de aquí, a unos {dist} pasos, está {nombre} ({tipo}). Dicen que {chisme}.', 'Si vas hacia el {dir}, llegarás a {nombre}. Allí viven sobre todo {cultura}... y dicen que {chisme}.', 'Dicen que en {nombre}, al {dir}, {chisme}.'],
  settlement_gossip: ['hay una taberna donde sirven la mejor cerveza de la región', 'los guardias son muy estrictos', 'el mercado es enorme', 'viven gentes muy raras', 'la gente es muy hospitalaria', 'hay más ladrones que gallinas'],
  dungeon: ['Unos cazadores vieron una mazmorra de rango {rango} al {dir}, a unos {dist} pasos.', 'Se habla de una cripta de rango {rango} hacia el {dir}. Nadie ha vuelto de allí.'],
  boss: ['Dicen que {jefe} ha vuelto a despertar.', 'Un viejo juraba haber visto la sombra de {jefe}.', 'Si alguna vez te cruzas con {jefe}, corre.'],
  crime: ['Buscan a {nombre} por {crimen}. Hay carteles por toda la plaza.', 'A {nombre} le dieron tomatazos en la picota. ¡Qué espectáculo!'],
  robbed: ['A {nombre} le robaron la bolsa en plena calle. Ojo con los carteristas.'],
  realm: ['{reino} lo gobierna {soberano}. {opinion}', 'En {reino} mandan con mano {mano}. {opinion}'],
  realm_opinion: { rich: 'Al menos nos va bien.', poor: 'Y los impuestos no paran de subir.', mid: 'Podría ser peor.' },
  other_realm: ['Más allá, en {otro_reino}, dicen que manda {otro_soberano}.', 'En {otro_reino} viven sobre todo {otro_pueblo}. Gente extraña, dicen.'],
  thieves: ['Por las noches rondan carteristas. Vigila tu bolsa.', 'Hay un tipo encapuchado que siempre está en la taberna... no me gusta nada.'],
  market: ['Hoy en el mercado: {evento}. {linea}'],
};

/* ------------------------------------------------------------------ */
/* Hazañas                                                              */
/* ------------------------------------------------------------------ */
// fame > 0 suma fama, < 0 suma infamia. who: cómo te recuerda la gente ("¡Mira, es {who}!").
export const DEEDS = {
  boss: { text: 'Derrotaste {a_name}', who: 'quien derrotó {a_name}', fame: 60 },
  dungeon: { text: 'Limpiaste una mazmorra de rango {rank}', who: 'quien limpió la mazmorra de rango {rank}', fame: 20 },
  guild_rank: { text: 'Ascendiste a rango {rank} del Gremio', who: 'el/la aventurero/a de rango {rank}', fame: 25 },
  raid: { text: 'Defendiste {place} de una incursión', who: 'quien defendió {place}', fame: 45 },
  thief: { text: 'Atrapaste a un carterista en {place}', who: 'quien atrapó al carterista de {place}', fame: 8 },
  alms: { text: 'Socorriste a los pobres de {place}', who: 'el alma generosa de {place}', fame: 4 },
  round: { text: 'Invitaste a una ronda en la taberna de {place}', who: 'quien invitó a una ronda en {place}', fame: 3 },
  royal: { text: 'Cumpliste un encargo real para {ruler}', who: 'el/la campeón/a de {ruler}', fame: 50 },
  title: { text: 'Fuiste nombrado/a noble de {realm}', who: 'el/la noble de {realm}', fame: 30 },
  work: { text: 'Trabajaste honradamente en {place}', who: 'el/la trabajador/a de {place}', fame: 2 },
  crime: { text: 'Cometiste {crime} en {place}', who: 'el/la de {crime}', fame: -15 },
  punished: { text: 'Fuiste castigado/a públicamente en {place}', who: 'el/la de la picota de {place}', fame: -5 },
  escape: { text: 'Te fugaste de la prisión de {place}', who: 'el/la fugado/a de {place}', fame: -25 },
};

/* ------------------------------------------------------------------ */
/* Regateo                                                              */
/* ------------------------------------------------------------------ */
// {precio}: cifra en juego, {item}: mercancía, {p}: jugador, {trato}: tratamiento.
export const HAGGLE = {
  open_buy: ['{item}, ¿eh? Buena elección. Son {precio} de oro.', 'Para ti, {trato}, {precio} monedas. Y es un precio de amigo.', '{precio} de oro. Ni una moneda menos... bueno, ya veremos.'],
  open_sell: ['¿Quieres venderme {item}? Te doy {precio} de oro, y ya es mucho.', 'Hmm... {precio} monedas. Tómalo o déjalo.', 'Te ofrezco {precio} de oro por todo.'],
  accept: ['¡Trato hecho!', 'Me arruinas, pero... de acuerdo. ¡Trato hecho!', 'Sabes negociar. Está bien.', '*escupe en la mano y te la tiende* ¡Hecho!'],
  accept_happy: ['¡Encantado/A de hacer negocios contigo!', '¡Un placer! Vuelve cuando quieras.'],
  counter: ['Ni hablar. Te lo dejo en {precio}.', '¿{oferta}? Ja. {precio}, y porque me caes bien.', 'Tengo hijos que alimentar... {precio}.', 'Mira la calidad de esto. {precio}, última rebaja... casi.'],
  counter_sell: ['¿{oferta}? Imposible. Te doy {precio}.', 'Eso es demasiado. Puedo llegar a {precio}.', 'Mi bolsa no da para tanto: {precio}.'],
  final: ['Mi última oferta: {precio}. ¿Lo tomas o lo dejas?', '{precio}. Y no pienso bajar más.'],
  final_sell: ['{precio}, y es mi última palabra.', 'Lo máximo que puedo darte es {precio}.'],
  insult: ['¿Me estás tomando el pelo? ¡Fuera de mi puesto!', '¡Qué insulto! Con gente como tú no hago tratos.', '¿{oferta}? ¡Eso es un robo! No pienso seguir hablando contigo.', '¡Ladrón/a! ¡Largo de aquí!'],
  walk: ['Como quieras. Ya volverás.', 'Tú te lo pierdes.', 'Nadie te dará un precio mejor, ya verás.'],
  nudge: ['¿Y bien? ¿Cuánto ofreces? Sigo esperando: {precio}.', 'No te quedes callado/a. Di una cifra o acepta mis {precio}.', '*tamborilea en el mostrador* ¿Hacemos trato o no? {precio} de oro.'],
  banned: ['Hoy no quiero tratos contigo. Vuelve mañana con mejores modales.', 'Después de tu insulto, hoy pagas el precio de la tabla o nada.'],
  broke: ['Ya no me queda oro en la bolsa para comprarte nada más hoy.', 'Me has dejado sin blanca. Vuelve mañana.'],
};
// Margen de rebaja por personalidad del mercader (se suma a la flexibilidad base).
export const HAGGLE_PERS = {
  amable: 0.05, 'gruñón': -0.05, 'tímido': 0.06, alegre: 0.03, sabio: 0, coqueto: 0.03, serio: -0.02, bromista: 0.02,
};
