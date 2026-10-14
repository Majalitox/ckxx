// Nombres para NPCs, familias y regiones.

export const FIRST_NAMES = {
  humano: {
    m: ['Alejandro', 'Bruno', 'Carlos', 'Diego', 'Esteban', 'Fernando', 'Gabriel', 'Hugo', 'Iván', 'Javier', 'Lucas', 'Martín', 'Nicolás', 'Óscar', 'Pablo', 'Rodrigo', 'Sergio', 'Tomás', 'Víctor', 'Mateo'],
    f: ['Ana', 'Beatriz', 'Carmen', 'Daniela', 'Elena', 'Fernanda', 'Gabriela', 'Isabel', 'Julia', 'Laura', 'Lucía', 'María', 'Natalia', 'Olivia', 'Paula', 'Rosa', 'Sofía', 'Valeria', 'Ximena', 'Clara'],
  },
  elfo: {
    m: ['Aelar', 'Thalion', 'Elrohir', 'Faelar', 'Galinndan', 'Ivellios', 'Laucian', 'Mindartis', 'Peren', 'Soveliss', 'Theren', 'Varis'],
    f: ['Adrie', 'Aerith', 'Birel', 'Caelynn', 'Elanor', 'Galadwen', 'Ielenia', 'Lia', 'Mialee', 'Naivara', 'Sariel', 'Valanthe'],
  },
  enano: {
    m: ['Thorin', 'Balin', 'Dwalin', 'Gimrik', 'Brom', 'Durgan', 'Harbek', 'Kildrak', 'Morgran', 'Rurik', 'Torvald', 'Vondal'],
    f: ['Ámbar', 'Bardryn', 'Dagnal', 'Eldeth', 'Gunnloda', 'Helja', 'Kathra', 'Mardred', 'Riswynn', 'Torbera', 'Vistra', 'Hilda'],
  },
  orco: {
    m: ['Grok', 'Thrak', 'Urzog', 'Mog', 'Gorbag', 'Dench', 'Feng', 'Holg', 'Krusk', 'Shump', 'Thokk', 'Ront'],
    f: ['Baggi', 'Emen', 'Engong', 'Kansif', 'Myev', 'Neega', 'Ovak', 'Ownka', 'Shautha', 'Sutha', 'Vola', 'Yevelda'],
  },
  bestia: {
    m: ['Rhen', 'Kael', 'Taro', 'Fenris', 'Garu', 'Lobo', 'Raiko', 'Shiro', 'Tigran', 'Zarek', 'Bao', 'Nahuel'],
    f: ['Mika', 'Nala', 'Rin', 'Sora', 'Kira', 'Luna', 'Yuki', 'Fenna', 'Amaru', 'Tala', 'Sasha', 'Kaia'],
  },
  demonio: {
    m: ['Azael', 'Belial', 'Malphas', 'Xaphan', 'Zagan', 'Vassago', 'Orias', 'Andras', 'Raum', 'Seere'],
    f: ['Lilith', 'Naamah', 'Lamia', 'Morrigan', 'Zepar', 'Agrat', 'Lilim', 'Ishtar', 'Nyx', 'Vepar'],
  },
  celestial: {
    m: ['Uriel', 'Raziel', 'Zadkiel', 'Cassiel', 'Jophiel', 'Ariel', 'Haniel', 'Remiel', 'Sariel', 'Barachiel'],
    f: ['Seraphina', 'Celeste', 'Aurora', 'Angélica', 'Gloria', 'Lumina', 'Elysia', 'Ofelia', 'Selene', 'Iris'],
  },
  vampiro: {
    m: ['Vlad', 'Lucien', 'Dorian', 'Viktor', 'Alucard', 'Cassius', 'Sebastián', 'Damien', 'Lestat', 'Adrián'],
    f: ['Carmilla', 'Elisabeth', 'Mina', 'Lenore', 'Selene', 'Ravena', 'Morgana', 'Ofelia', 'Ingrid', 'Valeska'],
  },
  hada: {
    m: ['Pip', 'Puck', 'Oberón', 'Fennel', 'Bramble', 'Cardo', 'Rowan', 'Acedera'],
    f: ['Titania', 'Campanita', 'Lirio', 'Rocío', 'Brisa', 'Perla', 'Melisa', 'Aurelia'],
  },
  draconido: {
    m: ['Arjhan', 'Balasar', 'Donaar', 'Ghesh', 'Heskan', 'Kriv', 'Medrash', 'Nadarr', 'Rhogar', 'Torinn'],
    f: ['Akra', 'Biri', 'Daar', 'Harann', 'Kava', 'Korinn', 'Mishann', 'Sora', 'Thava', 'Uadjit'],
  },
};

export const SURNAMES = {
  humano: ['García', 'Valdés', 'Montero', 'Herrera', 'Castillo', 'Rivera', 'del Monte', 'Robledo', 'Salvatierra', 'Aranda'],
  elfo: ['Hojaplata', 'Brisalunar', 'Rocíoestelar', 'Cantoalba', 'Ramaeterna', 'Luzdebosque'],
  enano: ['Barbahierro', 'Martillopétreo', 'Yunquedorado', 'Picoprofundo', 'Forjaroja', 'Escudopiedra'],
  orco: ['Rompecráneos', 'Colmillorrojo', 'Puñodehierro', 'Gritoatroz', 'Sangrenegra'],
  bestia: ['Garrafiera', 'Colmilloveloz', 'Aullidoplata', 'Zarpanocturna', 'Melenadorada'],
  demonio: ['Llamanegra', 'Cuernoabismal', 'Ascuaeterna', 'Sombraígnea'],
  celestial: ['Alablanca', 'Luzdivina', 'Coronasolar', 'Plumaeterna'],
  vampiro: ['de Carmesí', 'Nocturna', 'Sangrelunar', 'de Valaquia', 'Rosanegra'],
  hada: ['Polvoestelar', 'Pétalodeluz', 'Alarrocío', 'Flordelirio'],
  draconido: ['Escamarroja', 'Alientoígneo', 'Garradetrueno', 'Colmillodorado'],
};

const REGION_A = ['Valle', 'Bosque', 'Colinas', 'Llanuras', 'Montes', 'Páramo', 'Ciénaga', 'Cañón', 'Tierras', 'Lagos', 'Cumbres', 'Praderas'];
const REGION_B = ['del Alba', 'de Plata', 'del Dragón', 'de Cristal', 'del Rey Caído', 'de los Ancestros', 'del Lobo', 'de Ceniza', 'de Esmeralda', 'del Ocaso', 'de las Brumas', 'del Trueno', 'de los Susurros', 'de Hierro', 'de la Luna', 'del Olvido'];

export function regionName(rng) {
  return REGION_A[Math.floor(rng() * REGION_A.length)] + ' ' + REGION_B[Math.floor(rng() * REGION_B.length)];
}

export const ROLE_NAMES = {
  padre: 'Padre', madre: 'Madre', hermano: 'Hermano', hermana: 'Hermana', recepcionista: 'Recepcionista del Gremio',
  maestro: 'Maestro del Gremio', mercader: 'Mercader', herrero: 'Herrero', sacerdotisa: 'Sacerdotisa', sombra: 'Figura Encapuchada',
  aldeano: 'Aldeano', aventurero: 'Aventurero', bardo: 'Bardo', pareja: 'Pareja',
};

export const PERSONALITIES = ['amable', 'gruñón', 'tímido', 'alegre', 'sabio', 'coqueto', 'serio', 'bromista'];
