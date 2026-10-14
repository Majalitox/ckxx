// Sistema de rangos F → SSS (gremio, magia, poder y monstruos).

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
export const RANK_COLORS = ['§7', '§a', '§2', '§b', '§9', '§d', '§6', '§c', '§4'];
export const RANK_TITLES = ['Novato', 'Aprendiz', 'Iniciado', 'Veterano', 'Experto', 'Élite', 'Maestro', 'Gran Maestro', 'Leyenda Viviente'];

/** Puntos de gremio necesarios para cada rango. */
export const GUILD_POINTS = [0, 120, 350, 800, 1600, 3200, 6500, 13000, 26000];
/** Nivel mínimo del personaje para ascender a cada rango del gremio. */
export const GUILD_LEVEL = [1, 5, 10, 18, 26, 35, 45, 60, 75];
/** Experiencia mágica necesaria para cada rango de magia. */
export const MAGIC_XP = [0, 300, 900, 2200, 5000, 10000, 20000, 40000, 80000];
/** Nivel a partir del cual se considera que tu "poder" es de cierto rango. */
export const LEVEL_RANK = [1, 5, 10, 18, 26, 35, 45, 60, 75];

export const rk = (i) => `${RANK_COLORS[i] ?? '§f'}${RANKS[i] ?? '?'}§r`;
export const rkB = (i) => `${RANK_COLORS[i] ?? '§f'}§l${RANKS[i] ?? '?'}§r`;

export function rankFromLevel(level) {
  let r = 0;
  for (let i = 0; i < LEVEL_RANK.length; i++) if (level >= LEVEL_RANK[i]) r = i;
  return r;
}

export function magicRankFromXp(xp) {
  let r = 0;
  for (let i = 0; i < MAGIC_XP.length; i++) if (xp >= MAGIC_XP[i]) r = i;
  return r;
}
