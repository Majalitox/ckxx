// Base de conocimiento de diálogo de los NPCs.
// El jugador escribe libremente; el motor detecta intenciones por palabras clave
// y el NPC responde según su rol, personalidad, humor, relación y memoria.

export const INTENTS = [
  { id: 'insult', delta: -10, kw: ['idiota', 'estupido', 'estupida', 'tonto', 'tonta', 'feo', 'fea', 'inutil', 'callate', 'te odio', 'basura', 'imbecil', 'maldito', 'maldita', 'pendejo', 'pendeja', 'burro', 'burra', 'asqueroso', 'asquerosa', 'apestas', 'perdedor', 'perdedora', 'muerete', 'tarado', 'tarada', 'payaso', 'odio'] },
  { id: 'apology', delta: 2, kw: ['perdon', 'lo siento', 'disculpa', 'disculpame', 'perdoname', 'disculpas', 'me equivoque'] },
  { id: 'love', delta: 3, kw: ['te quiero', 'te amo', 'me gustas', 'cita', 'salir conmigo', 'casarte', 'casate', 'novia', 'novio', 'beso', 'besame', 'enamorado', 'enamorada', 'amor', 'mi vida', 'cariño', 'carino', 'corazon', 'casamos', 'boda'] },
  { id: 'compliment', delta: 4, kw: ['bonita', 'bonito', 'hermosa', 'hermoso', 'guapa', 'guapo', 'linda', 'lindo', 'genial', 'increible', 'eres la mejor', 'eres el mejor', 'me caes bien', 'inteligente', 'fuerte', 'admiro', 'buena persona', 'eres asombroso', 'eres asombrosa', 'precioso', 'preciosa', 'que bien', 'impresionante', 'valiente'] },
  { id: 'thanks', delta: 2, kw: ['gracias', 'te agradezco', 'muy amable', 'agradecido', 'agradecida', 'mil gracias'] },
  { id: 'greet', delta: 1, kw: ['hola', 'buenas', 'saludos', 'hey', 'que tal', 'buenos dias', 'buenas tardes', 'buenas noches', 'ola', 'wenas', 'hi', 'hello', 'holi', 'holaa', 'buen dia'] },
  { id: 'bye', delta: 0, kw: ['adios', 'chao', 'chau', 'hasta luego', 'nos vemos', 'bye', 'me voy', 'hasta pronto', 'hasta manana', 'cuidate'] },
  { id: 'how', delta: 1, kw: ['como estas', 'como te va', 'que tal estas', 'como andas', 'como te sientes', 'estas bien', 'como va todo', 'como sigues', 'que tal todo', 'como te encuentras'] },
  { id: 'name', delta: 0, kw: ['como te llamas', 'tu nombre', 'quien eres', 'que eres', 'te llamas'] },
  { id: 'quest', delta: 0, kw: ['mision', 'misiones', 'trabajo', 'tarea', 'encargo', 'necesitas algo', 'necesitas ayuda', 'puedo ayudar', 'te ayudo', 'quest', 'que hago', 'algo que hacer'] },
  { id: 'family', delta: 0, kw: ['familia', 'papa', 'mama', 'padre', 'madre', 'hermano', 'hermana', 'hijo', 'hija', 'padres', 'hermanos', 'abuelo', 'abuela'] },
  { id: 'magic', delta: 0, kw: ['magia', 'hechizo', 'hechizos', 'mana', 'elemento', 'conjuro', 'grimorio', 'habilidad', 'habilidades', 'poder', 'poderes'] },
  { id: 'guild', delta: 0, kw: ['gremio', 'aventurero', 'aventureros', 'rango', 'inscribir', 'inscribirme', 'registro', 'registrarme', 'licencia', 'ascender'] },
  { id: 'monsters', delta: 0, kw: ['monstruo', 'monstruos', 'jefe', 'jefes', 'mazmorra', 'mazmorras', 'cueva', 'cuevas', 'goblin', 'goblins', 'orco', 'dragon', 'liche', 'demonio', 'peligro', 'peligroso', 'bestia', 'araña', 'arana', 'golem', 'troll'] },
  { id: 'trade', delta: 0, kw: ['comprar', 'vender', 'comerciar', 'tienda', 'precio', 'precios', 'oro', 'dinero', 'monedas', 'barato', 'caro', 'ofertas'] },
  { id: 'lore', delta: 1, kw: ['historia', 'leyenda', 'leyendas', 'mundo', 'reino', 'antiguo', 'pasado', 'cuentame', 'sabes algo', 'rumor', 'rumores', 'noticias', 'chisme', 'chismes', 'secreto', 'aetheria'] },
  { id: 'age', delta: 0, kw: ['edad', 'anos tienes', 'cuantos anos', 'viejo', 'vieja', 'joven', 'cumpleanos'] },
  { id: 'race', delta: 0, kw: ['raza', 'razas', 'elfo', 'elfa', 'enano', 'enana', 'humano', 'humana', 'orco', 'orca', 'hombre bestia', 'demonio', 'celestial', 'vampiro', 'vampira', 'hada', 'draconido'] },
  { id: 'weather', delta: 0, kw: ['clima', 'lluvia', 'llueve', 'sol', 'noche', 'calor', 'frio', 'tormenta', 'nieve', 'hora'] },
  { id: 'joke', delta: 2, kw: ['chiste', 'broma', 'gracioso', 'graciosa', 'reir', 'jaja', 'jajaja', 'jeje', 'xd', 'lol', 'divertido'] },
  { id: 'advice', delta: 1, kw: ['consejo', 'consejos', 'aconsejas', 'recomiendas', 'sugieres', 'ayudame', 'que me recomiendas', 'estoy perdido', 'estoy perdida', 'no se que hacer'] },
  { id: 'food', delta: 1, kw: ['comida', 'hambre', 'comer', 'pan', 'pastel', 'cocinar', 'cena', 'desayuno', 'almuerzo', 'tarta', 'galleta', 'galletas', 'sopa'] },
  { id: 'hero', delta: 0, kw: ['heroe', 'villano', 'villana', 'malvado', 'malvada', 'justicia', 'karma', 'bien', 'mal', 'bondad', 'maldad'] },
  { id: 'sad', delta: 1, kw: ['triste', 'cansado', 'cansada', 'solo', 'sola', 'miedo', 'aburrido', 'aburrida', 'llorar', 'deprimido', 'deprimida', 'mal dia', 'me siento mal'] },
  { id: 'happy', delta: 1, kw: ['feliz', 'contento', 'contenta', 'alegre', 'emocionado', 'emocionada', 'genial dia', 'buen dia hoy', 'lo logre'] },
  { id: 'gift_ask', delta: -1, kw: ['regalo', 'regalame', 'dame algo', 'obsequio', 'dame oro', 'dame dinero', 'presta', 'prestame'] },
  { id: 'where', delta: 0, kw: ['donde', 'ubicacion', 'lejos', 'camino', 'mapa', 'direccion', 'casa'] },
  { id: 'work', delta: 0, kw: ['a que te dedicas', 'en que trabajas', 'tu trabajo', 'tu oficio', 'que haces', 'profesion'] },
  { id: 'yes', delta: 0, kw: ['si', 'claro', 'vale', 'ok', 'de acuerdo', 'por supuesto', 'obvio', 'sip', 'sep'] },
  { id: 'no', delta: 0, kw: ['no', 'nunca', 'jamas', 'nel', 'nop', 'para nada'] },
];

// Respuestas genéricas: warm (buena relación), neutral, cold (mala relación).
export const RESPONSES = {
  greet: {
    warm: ['¡{p}! {tod}, qué alegría verte.', '¡Hola, {p}! Justo pensaba en ti.', '¡{tod}, {p}! ¿Qué aventuras traes hoy?', '¡Eh, {p}! Siempre es un placer.'],
    neutral: ['{tod}, {p}.', 'Hola. ¿Necesitas algo?', '{tod}. ¿Qué te trae por aquí?', 'Saludos, viajero.'],
    cold: ['...¿Qué quieres?', 'Ah. Eres tú.', 'Hmph. Hola.', 'No tengo mucho tiempo para ti.'],
  },
  bye: {
    warm: ['¡Cuídate mucho, {p}! Vuelve pronto.', 'Nos vemos. ¡Que la suerte te acompañe!', 'Adiós, {p}. Te estaré esperando.'],
    neutral: ['Hasta luego.', 'Que te vaya bien.', 'Adiós, viajero.'],
    cold: ['Por fin.', 'Sí, vete.', 'No te molestes en volver pronto.'],
  },
  how: {
    warm: ['¡Muy bien ahora que estás aquí! ¿Y tú?', 'Bien, gracias por preguntar. {mood}', 'Mejor que nunca, {p}. {mood}'],
    neutral: ['Bien, supongo. {mood}', 'Tirando, como siempre. ¿Y tú?', 'No me quejo. {mood}'],
    cold: ['Estaba mejor antes de que llegaras.', '¿Y a ti qué te importa?', 'Bien. ¿Algo más?'],
  },
  name: {
    warm: ['¿No te acuerdas? ¡Soy {n}! Jaja.', 'Soy {n}, {rol}. Tu amigo, claro.'],
    neutral: ['Me llamo {n}. Soy {rol}.', '{n}, a tu servicio. Trabajo como {rol}.', 'Mi nombre es {n} {apellido_npc}.'],
    cold: ['{n}. Y no lo olvides.', 'Soy {n}. No necesitas saber más.'],
  },
  thanks: {
    warm: ['¡No hay de qué! Para eso estamos.', 'Lo que sea por ti, {p}.', '¡Cuando quieras!'],
    neutral: ['De nada.', 'No es nada.', 'Un placer ayudar.'],
    cold: ['Hmph. Ya.', 'Ahórratelo.'],
  },
  compliment: {
    warm: ['¡Ay, qué cosas dices! Tú también eres increíble, {p}.', 'Me sonrojas... gracias, {p}.', '¡Me alegras el día!'],
    neutral: ['Vaya... gracias.', 'Qué amable de tu parte.', 'No me lo esperaba. Gracias.'],
    cold: ['¿Intentas engañarme con halagos?', 'Las palabras bonitas no borran lo que hiciste.'],
  },
  insult: {
    warm: ['¿Por qué me dices eso, {p}? Eso dolió...', 'No esperaba eso de ti. Me has herido.', '¿Estás bien? Tú no eres así...'],
    neutral: ['¡Oye! Cuida esa lengua.', 'No tengo por qué soportar esto.', 'Qué grosería. Vete de aquí.'],
    cold: ['¡Lárgate antes de que llame a los guardias!', 'Sabía que eras escoria.', 'Ni siquiera vale la pena responderte.'],
  },
  apology: {
    warm: ['Tranquilo, ya está olvidado.', 'Te perdono, {p}. Todos tenemos malos días.'],
    neutral: ['Está bien. Disculpa aceptada.', 'Bueno... no pasa nada.'],
    cold: ['Hmm... Lo pensaré. Pero que no se repita.', 'Las disculpas son un comienzo. Demuéstralo con hechos.'],
  },
  love: {
    warm: ['*se sonroja* ¿D-de verdad? Yo... también siento algo especial por ti, {p}.', 'Mi corazón late más rápido cuando estás cerca...', 'Eres alguien muy especial para mí, {p}.'],
    neutral: ['¡Vaya! Eh... apenas nos conocemos, {p}.', 'Ja, ja... qué directo. Primero seamos amigos, ¿sí?', 'Me halagas, pero vayamos despacio.'],
    cold: ['¿Es una broma? Ni en tus sueños.', 'Ugh. No.'],
    kid: ['Jiji, eres muy pequeño para esas cosas. ¡Ve a jugar!', 'Aww, qué tierno. Cuando crezcas hablamos, ¿vale?'],
    family: ['¡Y yo a ti, {p}! Eres lo más importante para nuestra familia.', '¡Ay, mi tesoro! Yo también te quiero muchísimo.'],
  },
  quest: {
    warm: ['¡Claro! Echa un vistazo a tu Diario: hoy tienes misiones nuevas. Y si estás en el Gremio, el tablón siempre tiene trabajo.', 'Siempre hay algo que hacer. Revisa tus misiones diarias, cambian cada día.'],
    neutral: ['Las misiones diarias aparecen en tu Diario. El Gremio de Aventureros paga bien por trabajos más serios.', 'Habla con la recepcionista del Gremio si buscas trabajo de verdad.'],
    cold: ['Busca trabajo en otra parte.', 'No tengo nada para alguien como tú.'],
  },
  family: {
    warm: ['La familia es lo más importante. ¿Cómo están {madre} y {padre}?', 'Tus padres hablan maravillas de ti, ¿sabes?'],
    neutral: ['Conozco a tu familia, los {apellido}. Buena gente.', 'Cuida de los tuyos; en este mundo nunca se sabe.'],
    cold: ['Pobre familia la tuya, teniendo a alguien como tú.'],
  },
  magic: {
    warm: ['Tu afinidad es {el}, ¿verdad? Entrena con tu Grimorio y tu rango mágico subirá de F a SSS.', '¡La magia de {el} es fascinante! Cada hechizo que lanzas te hace más fuerte.'],
    neutral: ['La magia se fortalece con el uso. Lanza hechizos y aprende nuevas habilidades con tus puntos.', 'Dicen que hay magos de rango SSS capaces de partir montañas.'],
    cold: ['La magia no te hará mejor persona.'],
  },
  guild: {
    warm: ['El Gremio de Aventureros es el lugar para crecer. Tu rango ahora es {rk}. ¡Llegarás a SSS!', 'Los miembros del Gremio suben de nivel mucho más rápido. ¡Te lo recomiendo!'],
    neutral: ['El Gremio otorga rangos de F a SSS. Inscríbete con la recepcionista.', 'Para ascender en el Gremio necesitas puntos de gremio y nivel suficiente.'],
    cold: ['El Gremio no acepta a cualquiera, ¿sabes?'],
  },
  monsters: {
    warm: ['Ten cuidado ahí fuera. Se habla de {boss} rondando cerca de {region}.', 'Las mazmorras aparecen de la nada... y cada una tiene un rango. No entres en una demasiado alta.'],
    neutral: ['Los monstruos se vuelven más fuertes cuanto más te alejas del pueblo.', 'Dicen que {boss} despertó. Mejor no salir de noche.'],
    cold: ['Ojalá un monstruo te enseñe modales.'],
  },
  trade: {
    warm: ['Si quieres comprar, el mercader del pueblo tiene buenos precios. Dile que vas de mi parte.', 'El oro se gana con misiones, cazando monstruos o vendiendo materiales.'],
    neutral: ['El mercader está en la plaza del Gremio.', 'Todo tiene un precio, viajero.'],
    cold: ['No hago negocios contigo.'],
  },
  lore: {
    warm: ['Cuenta la leyenda que Aetheria fue creada por doce dioses, uno por cada elemento. Por eso cada alma nace con una afinidad distinta.', 'Hace siglos, el Rey del Vacío casi destruye el mundo. Dicen que su sello se debilita...', 'Los enanos forjaron las primeras runas con el fuego del corazón de la montaña. Su secreto nunca salió de su raza.', '¿Sabías que las hadas nacen del primer rayo de sol que toca una flor? O eso dicen.'],
    neutral: ['Se rumorea que hay ruinas antiguas en {region}.', 'Dicen que un aventurero de rango SSS derrotó a un dragón él solo.', 'Hay quien dice que los vampiros fueron humanos que hicieron un pacto con la Luna de Sangre.'],
    cold: ['No comparto historias con extraños.'],
  },
  age: {
    warm: ['¡Eso no se le pregunta a nadie! Jaja. Tú tienes {edad} años, ¿no? ¡Cómo pasa el tiempo!', 'Ya ni cuento los años. Pero tú creces rapidísimo, {p}.'],
    neutral: ['Los suficientes para saber lo que hago.', 'Tú tienes {edad} años, ¿verdad? Aún te queda mucho por vivir.'],
    cold: ['No es asunto tuyo.'],
  },
  race: {
    warm: ['Eres {raza}, ¿verdad? Cada raza tiene sus dones. ¡Aprovecha los tuyos!', 'Yo soy {raza_npc}. Nuestras razas son distintas, pero eso no importa entre amigos.'],
    neutral: ['Soy {raza_npc}. Tú eres {raza}, se nota.', 'Los enanos forjan, los elfos destilan elixires, los orcos combaten... cada raza tiene su camino.'],
    cold: ['Los {raza_plural} siempre dando problemas.'],
  },
  weather: {
    warm: ['{tod_desc} ¡Perfecto para una aventura contigo!', '{tod_desc}'],
    neutral: ['{tod_desc}', 'El tiempo cambia rápido en estas tierras.'],
    cold: ['¿Hablar del clima? ¿En serio?'],
  },
  joke: {
    warm: ['¿Por qué el esqueleto no fue a la fiesta? ¡Porque no tenía cuerpo para ir! Jajaja.', '¿Qué le dijo un creeper a otro? "¡Me explota la cabeza con tanto trabajo!" Jaja.', '¿Sabes por qué los enanos son buenos herreros? ¡Porque siempre están a la altura del yunque! Jajaja.', 'Un goblin entra en una taberna... y sale sin cartera. ¡La tuya! Jaja, es broma.'],
    neutral: ['Ja. Buena esa.', '¿Un chiste? ¿Qué hace un zombi en el gremio? ¡Busca trabajo de muerte!'],
    cold: ['No me hace gracia.'],
  },
  advice: {
    warm: ['Mi consejo: inscríbete en el Gremio, completa tus misiones diarias y no entres en mazmorras de rango mayor al tuyo.', 'Practica tus pasatiempos: minar, talar, pescar... todo te da experiencia.', 'Gasta tus puntos de estadística con cabeza. Un mago necesita Inteligencia; un guerrero, Fuerza.', 'Habla con la gente. Una buena relación abre muchas puertas... y regalos.'],
    neutral: ['Duerme por las noches y lleva siempre comida.', 'No te fíes de las figuras encapuchadas que aparecen de noche.'],
    cold: ['Mi consejo: aléjate de mí.'],
  },
  food: {
    warm: ['¡Me encanta el pastel! Si algún día me traes uno, seré feliz.', 'Nada como pan recién hecho. ¿Tienes hambre? Come algo antes de salir.'],
    neutral: ['Comer bien es importante para un aventurero.', 'El estofado de la taberna no está mal.'],
    cold: ['Si tienes hambre, búscate la vida.'],
  },
  hero: {
    warm: ['Tu reputación es: {karma}. {karma_comment}', 'Cada decisión cuenta. El mundo recordará si fuiste héroe o villano.'],
    neutral: ['Dicen que eres {karma}. {karma_comment}', 'La línea entre héroe y villano es más fina de lo que crees.'],
    cold: ['Todos saben lo que eres: {karma}.'],
  },
  sad: {
    warm: ['Oh, {p}... ven aquí. Todo va a salir bien, te lo prometo.', 'Si necesitas hablar, aquí estoy. Siempre.', 'Hasta los héroes tienen días grises. Mañana será mejor.'],
    neutral: ['Ánimo. Las cosas mejoran.', 'Lo siento mucho. Descansa un poco.'],
    cold: ['Todos tenemos problemas.'],
  },
  happy: {
    warm: ['¡Me alegro muchísimo por ti, {p}!', '¡Eso hay que celebrarlo!'],
    neutral: ['Me alegro.', 'Bien por ti.'],
    cold: ['Qué bien. Para ti.'],
  },
  gift_ask: {
    warm: ['Jaja, ¡qué cara tienes! Bueno... toma, por ser tú.', 'Siempre pidiendo, ¿eh? Anda, toma esto.'],
    neutral: ['¿Un regalo? Gánatelo primero.', 'No regalo nada a quien apenas conozco.'],
    cold: ['¿Encima pides? Increíble.'],
  },
  where: {
    warm: ['Tu casa está en {casa}. El Gremio está cerca del punto de aparición del mundo.', '¿Perdido? Mira tu Diario: ahí aparecen tus mazmorras y la dirección a casa.'],
    neutral: ['El Gremio está junto al punto de inicio del mundo.', 'Usa tu Diario para orientarte.'],
    cold: ['Lejos de mí, espero.'],
  },
  work: {
    warm: ['Soy {rol}. Me encanta mi trabajo, aunque a veces es agotador.'],
    neutral: ['Trabajo como {rol}.', '{rol}. Es un trabajo honrado.'],
    cold: ['Trabajo. Algo que deberías probar.'],
  },
  yes: { warm: ['¡Perfecto!', '¡Genial!'], neutral: ['Bien.', 'Entendido.'], cold: ['Hmph.'] },
  no: { warm: ['Oh, vaya. Está bien.', 'Entiendo, no pasa nada.'], neutral: ['Como quieras.', 'Vale.'], cold: ['Lo que tú digas.'] },
};

// Respuestas especiales por rol (tienen prioridad).
export const ROLE_RESPONSES = {
  madre: {
    greet: ['¡{p}, mi {tesoro}! {tod}. ¿Has comido bien?', '¡Hola, cariño! Ven, dame un abrazo.', '¡Mi {kid} favorito/a! ¿Cómo te fue hoy?'],
    how: ['Bien, cielo, cuidando de la casa. Me preocupo por ti cuando sales. {mood}', 'Ahora que te veo, de maravilla.'],
    quest: ['Si quieres ayudar, tráeme algo de comida para la cena. ¡Mira tus misiones familiares!', 'Pórtate bien y haz tus tareas, ¿de acuerdo?'],
    advice: ['Abrígate, no hables con extraños encapuchados y vuelve antes de que anochezca.', 'Hijo/a mío/a, sé buena persona. El mundo necesita más héroes.'],
    family: ['Tu padre, {padre}, está orgulloso de ti aunque no lo diga. Y yo también.', 'Somos los {apellido}, y nos cuidamos entre nosotros.'],
    bye: ['¡Ten cuidado ahí fuera! Te quiero.', 'Vuelve para la cena, ¿eh?'],
    insult: ['¡{p}! ¿Así le hablas a tu madre? Estoy muy decepcionada.', '*suspira* No te he criado para esto...'],
    sad: ['Ven aquí, mi {kid}... *te abraza* Mamá está contigo.', 'Nada es tan malo como parece. Te preparo tu comida favorita, ¿sí?'],
  },
  padre: {
    greet: ['¡Ahí está mi {hijo}! {tod}.', '¡{p}! ¿Ya has entrenado hoy?', '¡Hola, campeón/a!'],
    how: ['Bien, trabajando duro como siempre. {mood}', 'Cansado, pero verte me anima.'],
    quest: ['Un buen {hijo} ayuda en casa. Revisa tus misiones familiares.', 'Cuando seas mayor, inscríbete en el Gremio. Yo lo hice a tu edad.'],
    advice: ['Nunca huyas de un reto, pero tampoco seas imprudente.', 'La fuerza sin cabeza no sirve de nada. Entrena cuerpo y mente.', 'Cuando seas adolescente podrás inscribirte en el Gremio de Aventureros.'],
    family: ['Tu madre, {madre}, es la persona más fuerte que conozco.', 'Los {apellido} nunca se rinden. Recuérdalo.'],
    bye: ['¡Ve con cuidado, {hijo}!', 'Haz que me sienta orgulloso.'],
    insult: ['¡Más respeto, jovencito/a!', 'Esa boca... no es así como te eduqué.'],
    sad: ['Arriba ese ánimo. Los {apellido} somos fuertes.', 'Ven, vamos a dar un paseo. Ya verás como te sientes mejor.'],
  },
  hermano: {
    greet: ['¡Ey, {p}! ¿Jugamos a algo?', '¡{herm}! ¿Dónde estabas?', '¡Por fin llegas!'],
    how: ['¡Aburrido! Mamá no me deja salir solo.', 'Bien. ¡Hoy vi un goblin desde la ventana!'],
    joke: ['¿Sabes qué es verde y salta? ¡Un goblin en una cama elástica! JAJAJA.'],
    advice: ['Si papá pregunta, yo no me comí el pastel.'],
    insult: ['¡Pues tú más! Se lo voy a decir a mamá.'],
  },
  hermana: {
    greet: ['¡{p}! ¡Te estaba esperando!', '¡Hola, {herm}! ¿Me traes algo?'],
    how: ['¡Muy bien! Estoy aprendiendo a hacer coronas de flores.', 'Bien, aunque echo de menos jugar contigo.'],
    joke: ['¿Por qué el enano no juega al baloncesto? ¡Porque no llega! Jiji.'],
    advice: ['¡Tienes que regalarle flores a mamá, le encantan!'],
    insult: ['¡Eres malo/a! *se va llorando*'],
  },
  recepcionista: {
    greet: ['¡Bienvenido/a al Gremio de Aventureros, {p}! ¿En qué puedo ayudarte?', '¡Hola, {p}! Hay misiones nuevas en el tablón.'],
    guild: ['Para inscribirte necesitas ser al menos adolescente y pagar la cuota. Los miembros ganan x1.5 de experiencia de combate y misiones.', 'Tu rango actual es {rk}. Consigue puntos de gremio completando misiones del tablón, derrotando jefes y limpiando mazmorras.'],
    quest: ['El tablón de misiones se renueva cada día. ¡Elige las de tu rango o una superior si eres valiente!'],
    work: ['Soy la recepcionista. Registro aventureros, asigno misiones y... aguanto a gente muy rara.'],
  },
  maestro: {
    greet: ['Hmm. {p}. Te he estado observando.', 'Aventurero/a. Espero que estés entrenando.'],
    guild: ['Un rango no se regala: se gana con sangre y sudor. Tú eres {rk}. Demuéstrame que vales más.', 'Los aventureros de rango S y superior son leyendas vivas. Pocos llegan.'],
    advice: ['Nunca subestimes a un enemigo de rango superior al tuyo.', 'Las mazmorras de rango alto esconden tesoros... y tumbas.'],
  },
  mercader: {
    greet: ['¡Bienvenido/a, {p}! Tengo los mejores precios de Aetheria.', '¡Pasa, pasa! ¿Qué te llevas hoy?'],
    trade: ['Compro y vendo de todo. Habla conmigo y elige "Comerciar".', '¡Mis pociones de maná son las mejores! Bueno... las únicas.'],
    work: ['Viajo de pueblo en pueblo comprando barato y vendiendo... a un precio justo, je je.'],
  },
  herrero: {
    greet: ['¡Por la barba de mis ancestros! Hola, {p}.', 'Hmph. ¿Vienes a por acero o a hacerme perder el tiempo?'],
    work: ['Soy herrero. Forjo, reparo y, si eres enano, te enseño a grabar runas.'],
    trade: ['Si no eres enano, no puedes grabar runas. Pero yo te vendo armas ya grabadas... a buen precio.'],
    magic: ['La única magia que respeto es la de las runas enanas.'],
  },
  sacerdotisa: {
    greet: ['Que la luz te guíe, {p}.', 'Bienvenido/a al santuario, hijo/a de los dioses.'],
    hero: ['Tu alma es {karma}. {karma_comment} Si deseas purificarla, una donación al templo ayuda.'],
    advice: ['Puedo bendecirte o curarte. Y si has perdido a alguien querido... hay rituales antiguos.'],
    work: ['Sirvo a los doce dioses. Curo, bendigo y guío a las almas perdidas.'],
  },
  sombra: {
    greet: ['*susurra* ...Llegas tarde.', '¿Buscas trabajo... del que no se habla?'],
    quest: ['La Hermandad de la Sombra tiene encargos para quien no tema mancharse las manos.', 'Los héroes son aburridos. Únete a nosotros y conocerás el verdadero poder.'],
    hero: ['Eres {karma}. {karma_comment} Nosotros no juzgamos.'],
    work: ['Mi trabajo es que nadie sepa cuál es mi trabajo.'],
  },
  pareja: {
    greet: ['¡Mi amor! {tod}. Te eché de menos.', '¡{p}! *te abraza* Por fin en casa.'],
    love: ['Y yo a ti, más que a nada en este mundo.', 'Cada día a tu lado es un regalo.'],
    how: ['Feliz, porque estás aquí.'],
    bye: ['Vuelve sano/a y salvo/a, mi vida.'],
  },
};

// Coletillas según personalidad (se añaden a veces).
export const PERSONALITY_FLAVOR = {
  amable: { pre: ['', 'Oh, ', 'Mira, '], post: [' Que tengas un buen día.', ' Cuídate mucho.', ''] },
  'gruñón': { pre: ['Hmph. ', 'Bah. ', 'Grr... '], post: [' Y no me molestes más.', ' ¿Contento/a?', ''] },
  'tímido': { pre: ['E-eh... ', 'Um... ', '*mira al suelo* '], post: [' ...creo.', ' *se sonroja*', ''] },
  alegre: { pre: ['¡Jaja! ', '¡Uy! ', '¡Oye! '], post: [' ¡Qué divertido!', ' ¡Je je!', ''] },
  sabio: { pre: ['Hmm... ', 'Verás, ', 'Como decían los antiguos: '], post: [' Medítalo.', ' La sabiduría llega con paciencia.', ''] },
  coqueto: { pre: ['Vaya, vaya... ', 'Hola, guapo/a... ', ''], post: [' *guiña un ojo*', ' ¿Sabes que tienes unos ojos preciosos?', ''] },
  serio: { pre: ['', 'Escucha. ', ''], post: ['', ' Eso es todo.', ''] },
  bromista: { pre: ['¡Ja! ', 'A ver, a ver... ', ''], post: [' Bueno, o no. ¡Jaja!', ' ¿Lo pillas?', ''] },
};

export const MOOD_TEXT = {
  feliz: ['Hoy estoy de muy buen humor.', '¡Hoy es un gran día!'],
  normal: ['', 'Un día normal.'],
  cansado: ['Aunque estoy agotado/A...', 'Hoy no he dormido nada.'],
  triste: ['Aunque hoy me siento un poco triste...', 'Hoy no es mi mejor día.'],
  enojado: ['Aunque hoy estoy de mal humor.', '¡Hoy todo me sale mal!'],
};

export const FALLBACK = {
  question: ['Buena pregunta... no sabría decirte.', 'Hmm, ¿{echo}? No lo sé, la verdad.', 'Eso tendrías que preguntárselo a alguien más sabio que yo.', 'Mmm... déjame pensarlo. No, no tengo ni idea.'],
  statement: ['¿{echo}? Cuéntame más.', 'Ya veo... interesante.', 'Ajá. ¿Y qué más?', 'No estoy seguro/A de entenderte, {p}.', 'Hmm. ¿Por qué lo dices?', 'Comprendo. La vida de un aventurero es complicada.', 'Vaya. No lo había pensado así.'],
};

// Preguntas que el NPC puede hacer para recordar datos del jugador.
export const NPC_QUESTIONS = [
  { key: 'comida', q: 'Por cierto, {p}, ¿cuál es tu comida favorita?', ack: '¡{v}! Lo recordaré. Quizá algún día te prepare algo.', recall: '¿Sigues comiendo mucho {v}? Je je.' },
  { key: 'color', q: 'Oye, ¿cuál es tu color favorito?', ack: '{v}... qué bonito. No lo olvidaré.', recall: 'Vi una flor de color {v} y me acordé de ti.' },
  { key: 'sueno', q: '¿Cuál es tu mayor sueño, {p}?', ack: '"{v}"... Es un gran sueño. Estoy seguro/A de que lo lograrás.', recall: '¿Cómo va eso de "{v}"? ¡No te rindas!' },
  { key: 'lugar', q: '¿Cuál es tu lugar favorito de Aetheria?', ack: '{v}, ¿eh? Algún día tienes que llevarme.', recall: '¿Has vuelto a {v} últimamente?' },
  { key: 'mascota', q: '¿Tienes mascota? ¿Cómo se llama?', ack: '¡{v}! Qué nombre más gracioso.', recall: '¿Cómo está {v}? ¿Le das de comer bien?' },
  { key: 'miedo', q: '¿A qué le tienes más miedo?', ack: '¿{v}? No te preocupes, todos tenemos miedos.', recall: 'Si alguna vez te encuentras con {v}, acuérdate de que eres fuerte.' },
];

// Cartas que los NPCs envían por iniciativa propia.
export const LETTERS = {
  madre: ['¡Hola, cariño! Espero que estés comiendo bien. Te he guardado un trozo de pastel. Te quiere, mamá.', 'Hoy soñé contigo de pequeño/a. Crecéis tan rápido... Ven a visitarnos pronto.', 'Tu padre dice que no me preocupe, pero no puedo evitarlo. Cuídate mucho.', 'He oído rumores de monstruos cerca. Por favor, ten cuidado.'],
  padre: ['Hijo/a: he oído que te va bien. Sigue así. Estoy orgulloso.', 'Recuerda entrenar cada día. El que no avanza, retrocede.', 'Si necesitas oro, ven a casa. Siempre habrá un plato para ti.'],
  hermano: ['¡Ey! ¿Cuándo vienes a jugar? Mamá no me deja salir solo.', 'Hoy encontré un escarabajo enorme. ¡Tienes que verlo!'],
  hermana: ['¡Te hice una corona de flores! Ven a buscarla.', 'Te echo de menos. ¿Me cuentas una aventura cuando vuelvas?'],
  amigo: ['¡Hola, {p}! Solo quería saludarte. ¿Qué tal todo?', 'Me acordé de ti hoy. ¡Ven a verme cuando puedas!', 'He oído que te va muy bien. ¡Me alegro por ti!', '¿Cuándo nos vemos? Tengo algo que contarte.'],
  pareja: ['Te echo de menos, mi amor. Vuelve pronto a casa.', 'Cada vez que sales de aventura, cuento los minutos hasta que vuelves.', 'Hoy preparé tu comida favorita. ¿Vienes a cenar?'],
  sombra: ['*Una nota sin firma*: La Hermandad tiene un encargo para ti. Búscanos de noche.'],
};

// Preferencias de regalos.
export const GIFT_PREFS = {
  default: {
    love: ['minecraft:cake', 'minecraft:diamond', 'minecraft:emerald', 'minecraft:golden_apple'],
    like: ['minecraft:bread', 'minecraft:apple', 'minecraft:cookie', 'minecraft:pumpkin_pie', 'minecraft:gold_ingot', 'minecraft:poppy', 'minecraft:dandelion', 'minecraft:cornflower', 'minecraft:oxeye_daisy', 'minecraft:allium', 'minecraft:blue_orchid', 'minecraft:lily_of_the_valley', 'minecraft:sunflower', 'minecraft:honey_bottle', 'minecraft:cooked_beef', 'minecraft:cooked_chicken'],
    hate: ['minecraft:rotten_flesh', 'minecraft:poisonous_potato', 'minecraft:spider_eye', 'minecraft:dirt', 'minecraft:bone', 'minecraft:gunpowder', 'minecraft:cobblestone', 'minecraft:gravel'],
  },
  madre: { love: ['minecraft:poppy', 'minecraft:lily_of_the_valley', 'minecraft:cornflower', 'minecraft:cake', 'minecraft:sunflower'] },
  padre: { love: ['minecraft:iron_ingot', 'minecraft:cooked_beef', 'minecraft:diamond', 'minecraft:golden_carrot'] },
  hermano: { love: ['minecraft:cookie', 'minecraft:cake', 'minecraft:slime_ball', 'minecraft:egg'] },
  hermana: { love: ['minecraft:cookie', 'minecraft:poppy', 'minecraft:allium', 'minecraft:cake', 'minecraft:amethyst_shard'] },
  recepcionista: { love: ['minecraft:allium', 'minecraft:cake', 'minecraft:amethyst_shard', 'minecraft:book'] },
  maestro: { love: ['rpg:monster_core', 'rpg:boss_core', 'minecraft:diamond', 'minecraft:netherite_ingot'] },
  mercader: { love: ['minecraft:emerald', 'minecraft:gold_ingot', 'minecraft:diamond', 'rpg:adamantite_ingot'] },
  herrero: { love: ['rpg:mithril_ingot', 'rpg:adamantite_ingot', 'minecraft:diamond', 'minecraft:netherite_ingot', 'minecraft:iron_ingot'] },
  sacerdotisa: { love: ['minecraft:golden_apple', 'minecraft:lily_of_the_valley', 'minecraft:amethyst_shard', 'minecraft:candle'] },
  sombra: { love: ['minecraft:wither_rose', 'minecraft:ender_pearl', 'minecraft:emerald', 'minecraft:skull'] },
  aventurero: { love: ['minecraft:golden_apple', 'minecraft:diamond', 'rpg:mana_potion', 'minecraft:cooked_beef'] },
};

export const RACE_GIFT_LOVE = {
  enano: ['minecraft:gold_ingot', 'rpg:mithril_ingot', 'minecraft:diamond'],
  elfo: ['minecraft:lily_of_the_valley', 'minecraft:blue_orchid', 'minecraft:honey_bottle'],
  orco: ['minecraft:cooked_beef', 'minecraft:cooked_porkchop', 'minecraft:iron_axe'],
  vampiro: ['minecraft:sweet_berries', 'minecraft:red_dye', 'minecraft:wither_rose'],
  hada: ['minecraft:honey_bottle', 'minecraft:sunflower', 'minecraft:glow_berries'],
  demonio: ['minecraft:blaze_powder', 'minecraft:magma_cream', 'minecraft:wither_rose'],
  celestial: ['minecraft:feather', 'minecraft:golden_apple', 'minecraft:amethyst_shard'],
  bestia: ['minecraft:cooked_chicken', 'minecraft:cooked_mutton', 'minecraft:bone'],
  draconido: ['minecraft:gold_block', 'minecraft:blaze_rod', 'minecraft:emerald'],
};
