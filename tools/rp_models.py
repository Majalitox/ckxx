"""Recursos visuales de Aetheria RPG v2 (paquete de recursos).

Genera y SOBRESCRIBE en el RP: geometrías, animaciones, controladores de render, entidades
de cliente, texturas de entidades, partículas (con su atlas) y la hoja de glifos del HUD.
Lo llama tools/build.py al final de main():  lang.update(rp_models.build(RP))

Diseño: cada modelo se describe en Python (huesos + cubos con una «clave» de región UV).
Un empaquetador asigna automáticamente las regiones UV (caja estándar o caras sueltas) y
los pintores dibujan cada región por su clave, de modo que la textura SIEMPRE coincide con
las cajas UV de la geometría (tools/check_rp.py lo verifica).
"""
import json
import math
import os
import random
import shutil
import zlib

import gen_textures as T

FACE_DIMS = {'north': 'wh', 'south': 'wh', 'east': 'dh', 'west': 'dh', 'up': 'wd', 'down': 'wd'}
FACE_KIND = {'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up', 'down': 'down'}


def _r(v):
    """Redondea floats para un JSON limpio."""
    if isinstance(v, float):
        v = round(v, 4)
        if v == int(v):
            return int(v)
    return v


def _vec(v):
    return [_r(float(x)) for x in v]


# ======================================================================================
# Modelo: huesos, cubos y regiones UV empaquetadas automáticamente
# ======================================================================================
class Region:
    def __init__(self, key, size, faces=None):
        self.key = key
        self.size = tuple(int(round(s)) for s in size)
        self.faces = faces  # None → caja UV; dict cara_geo → grupo
        self.pos = {}       # grupo ('box' o nombre) → (x, y)
        self.groups = {}    # grupo → (w, h)
        w, h, d = self.size
        if faces is None:
            self.groups['box'] = (2 * (d + w), d + h)
        else:
            for face, grp in faces.items():
                a, b = FACE_DIMS[face]
                dims = ({'w': w, 'h': h, 'd': d}[a], {'w': w, 'h': h, 'd': d}[b])
                if grp in self.groups and self.groups[grp] != dims:
                    raise ValueError(f'{key}: el grupo {grp} mezcla tamaños {self.groups[grp]} y {dims}')
                self.groups[grp] = dims

    def items(self):
        return [((self.key, g), wh) for g, wh in self.groups.items() if wh[0] > 0 and wh[1] > 0]

    def faces_rects(self):
        w, h, d = self.size
        if self.faces is None:
            u, v = self.pos['box']
            return T.box_faces(u, v, w, h, d)
        rects, kinds = {}, {}
        for face, grp in self.faces.items():
            if grp in rects or grp not in self.pos:
                continue
            x, y = self.pos[grp]
            gw, gh = self.groups[grp]
            rects[grp] = (x, y, gw, gh)
            kinds[grp] = FACE_KIND[face]
        return T.Faces(rects, kinds, self.size)

    def uv_json(self):
        if self.faces is None:
            return list(self.pos['box'])
        out = {}
        for face, grp in self.faces.items():
            if grp not in self.pos:
                continue
            gw, gh = self.groups[grp]
            out[face] = {'uv': list(self.pos[grp]), 'uv_size': [gw, gh]}
        return out


class Model:
    def __init__(self, ident, tw=64, th=64, bw=2.0, bh=3.0, boff=None, grow=True):
        self.ident = ident
        self.tw, self.th = tw, th
        self.bw, self.bh = bw, bh
        self.boff = boff if boff is not None else [0, bh / 2, 0]
        self.grow = grow
        self.bones = []
        self.bone_index = {}
        self.regions = {}
        self.order = []
        self.painters = {}
        self.light_opts = {}
        self.packed = False

    # -- construcción ----------------------------------------------------------------------
    def bone(self, name, parent=None, pivot=(0, 0, 0), rot=None, mirror=False):
        if name in self.bone_index:
            raise ValueError(f'{self.ident}: hueso repetido {name}')
        b = {'name': name, 'pivot': _vec(pivot), 'cubes': []}
        if parent:
            if parent not in self.bone_index:
                raise ValueError(f'{self.ident}: padre desconocido {parent} para {name}')
            b['parent'] = parent
        if rot:
            b['rotation'] = _vec(rot)
        if mirror:
            b['mirror'] = True
        self.bone_index[name] = b
        self.bones.append(b)
        return name

    def _region(self, key, size, faces, paint, light):
        reg = self.regions.get(key)
        if reg is None:
            reg = Region(key, size, faces)
            self.regions[key] = reg
            self.order.append(key)
        else:
            if reg.size != tuple(int(round(s)) for s in size) or (reg.faces is None) != (faces is None):
                raise ValueError(f'{self.ident}: la región {key} se reutiliza con otro tamaño/tipo')
        if paint is not None:
            self.painters[key] = paint
        if light is not None:
            self.light_opts[key] = light
        return reg

    def box(self, bone, key, origin, size, inflate=0, mirror=False, rot=None, pivot=None, paint=None, light=None, faces=None):
        """Cubo con caja UV (faces=None) o con caras sueltas (faces = {cara_geo: grupo})."""
        reg = self._region(key, size, faces, paint, light)
        cube = {'origin': _vec(origin), 'size': _vec(size), '_reg': reg}
        if inflate:
            cube['inflate'] = _r(float(inflate))
        if mirror:
            cube['mirror'] = True
        if rot:
            cube['rotation'] = _vec(rot)
            cube['pivot'] = _vec(pivot if pivot is not None else origin)
        self.bone_index[bone]['cubes'].append(cube)
        return cube

    def plane(self, bone, key, origin, size, face='north', paint=None, light=None, rot=None, pivot=None, inflate=0, mirror=False):
        """Plano de grosor 0 con UNA sola cara (el material entity_alphatest no recorta caras
        traseras, así que se ve por ambos lados sin parpadeo). mirror=True refleja la textura."""
        return self.box(bone, key, origin, size, faces={face: 'face'}, paint=paint, light=light, rot=rot, pivot=pivot, inflate=inflate, mirror=mirror)

    # -- empaquetado UV -------------------------------------------------------------------
    def pack(self):
        items = []
        for key in self.order:
            items.extend(self.regions[key].items())
        items.sort(key=lambda it: (-it[1][1], -it[1][0], str(it[0])))
        while True:
            ok = self._try_pack(items)
            if ok:
                break
            if not self.grow:
                raise ValueError(f'{self.ident}: las regiones UV no caben en {self.tw}×{self.th}')
            if self.th <= self.tw:
                self.th *= 2
            else:
                self.tw *= 2
        self.packed = True

    def _try_pack(self, items):
        W, H = self.tw, self.th
        sky = [0] * W
        placed = {}
        for ident, (w, h) in items:
            if w > W:
                return False
            best = None
            for x in range(0, W - w + 1):
                y = max(sky[x:x + w])
                if y + h <= H and (best is None or y < best[1] or (y == best[1] and x < best[0])):
                    best = (x, y)
            if best is None:
                return False
            x, y = best
            for k in range(x, x + w):
                sky[k] = y + h
            placed[ident] = (x, y)
        for (key, grp), pos in placed.items():
            self.regions[key].pos[grp] = pos
        return True

    def faces(self, key):
        if not self.packed:
            self.pack()
        return self.regions[key].faces_rects()

    # -- salida ---------------------------------------------------------------------------
    def geometry(self):
        if not self.packed:
            self.pack()
        bones = []
        for b in self.bones:
            nb = {k: v for k, v in b.items() if k != 'cubes'}
            cubes = []
            for c in b['cubes']:
                nc = {k: v for k, v in c.items() if k != '_reg'}
                uv = c['_reg'].uv_json()
                if isinstance(uv, dict) and nc.pop('mirror', False):
                    # Caras sueltas reflejadas: tamaño UV negativo en horizontal.
                    for face, spec in uv.items():
                        x, y = spec['uv']
                        w, h = spec['uv_size']
                        spec['uv'] = [x + w, y]
                        spec['uv_size'] = [-w, h]
                nc['uv'] = uv
                cubes.append(nc)
            if cubes:
                nb['cubes'] = cubes
            bones.append(nb)
        return {'description': {'identifier': self.ident, 'texture_width': self.tw, 'texture_height': self.th,
                                'visible_bounds_width': _r(float(self.bw)), 'visible_bounds_height': _r(float(self.bh)),
                                'visible_bounds_offset': _vec(self.boff)}, 'bones': bones}

    def texture(self, ctx=None, seed=0, painters=None):
        """Pinta la textura llamando a cada pintor de región y aplica la iluminación."""
        if not self.packed:
            self.pack()
        c = T.Pix(self.tw, self.th, seed)
        pt = dict(self.painters)
        if painters:
            pt.update(painters)
        for key in self.order:
            fn = pt.get(key)
            F = self.faces(key)
            if fn is None:
                for r in F.all():
                    c.fill(r, '#ff00ff', 0)
                continue
            fn(c, F, ctx) if ctx is not None else fn(c, F)
        for key in self.order:
            opt = self.light_opts.get(key, {})
            if opt is False:
                continue
            c.light(self.faces(key), **opt)
        return c


# ======================================================================================
# Utilidades de pintura comunes
# ======================================================================================
def P(c, F, col, mat='cloth', seed=0, faces=None):
    T.mat_box(c, F, col, mat, seed=seed, faces=faces)


def solid(col, mat='cloth', light=None):
    def fn(c, F, ctx=None):
        P(c, F, col, mat)
    return fn


def eyes2(c, r, i, j, iris, white='#f4f0e8', pupil=None, glow=False, w=1):
    """Ojo de 2 px de alto: blanco exterior + iris con brillo arriba."""
    pupil = pupil or T.dark(iris, 0.45)
    c.at(r, i, j, white)
    c.at(r, i, j + 1, T.shade(T.C(white), 0.86))
    c.at(r, i + w, j, T.light(iris, 1.35), glow=glow)
    c.at(r, i + w, j + 1, pupil if not glow else iris, glow=glow)


def hex_list(*cs):
    return [T.C(x) for x in cs]


# ======================================================================================
# NPC (rpg:npc) — 160 aspectos (contrato §2.2) y geometrías por raza (rpg:geo 0..5)
# ======================================================================================
RACES = ['humano', 'elfo', 'enano', 'orco', 'bestia', 'demonio', 'celestial', 'vampiro', 'hada', 'draconido']
CLASSES = ['baja', 'media', 'alta', 'guardia']
NPC_GEOS = ['geometry.rpg.npc', 'geometry.rpg.npc_horns', 'geometry.rpg.npc_elf', 'geometry.rpg.npc_beast',
            'geometry.rpg.npc_halo', 'geometry.rpg.npc_fairy']
HATS = {1: 'straw', 2: 'hood', 3: 'noble', 4: 'helmet', 5: 'crown', 6: 'bandana', 7: 'chef'}
TOOLS = {1: 'sword', 2: 'spear', 3: 'hoe', 4: 'hammer', 5: 'tankard', 6: 'staff', 7: 'torch'}

# Aspecto de cada raza: tonos de piel, pelo, ojos, metal y colores de la guardia, ropa.
RACE_LOOK = {
    'humano': dict(
        skin=['#f2c9a0', '#e0ac69', '#c68642', '#8d5524', '#f6d4b4', '#b07448', '#e8b888', '#6e4024'],
        hair=['#2b1d14', '#5a3a22', '#c89a48', '#8a3a1a', '#161414', '#7a5634', '#d8b870', '#4a2c18'],
        eyes=['#3a70b0', '#5a3a1a', '#3a7a4a', '#6a5a3a', '#4a8ac0'],
        metal='#a4aab4', tabard=[('#a01818', '#e8c040'), ('#1a3a8a', '#e8e8e8')], emblem='cross',
        cloth={'baja': ['#8a7a5a', '#6a5a40', '#7a6a50', '#5a6a48'], 'media': ['#3a6ea5', '#8a3030', '#4a7a4a', '#a07a2a'],
               'alta': ['#8a1020', '#1a2a7a', '#4a1a6a', '#0a5a3a']}, trim='#e8c040'),
    'elfo': dict(
        skin=['#f6e0c8', '#f1d3b3', '#e8c8a0', '#d8b890', '#f8e8d8', '#c8a07a'],
        hair=['#f0e8b0', '#e8e8f0', '#c8a050', '#7a3a1a', '#22223a', '#d0d8e0', '#a8d0a0'],
        eyes=['#3ab070', '#40a0c0', '#8a60d0', '#70c050'],
        metal='#c8d4cc', tabard=[('#2a6a3a', '#e8e8d0'), ('#e8e8f0', '#4a9a5a')], emblem='leaf',
        cloth={'baja': ['#6a7a4a', '#7a7058', '#5a6a5a', '#8a8060'], 'media': ['#3a7a4a', '#4a8a8a', '#7a8a3a', '#5a6a9a'],
               'alta': ['#1a5a3a', '#e8e8f0', '#2a4a7a', '#5a8a3a']}, trim='#d8e0e8'),
    'enano': dict(
        skin=['#d9a066', '#e0b080', '#c89060', '#b87850', '#e8b890'],
        hair=['#a04a1a', '#5a3a1a', '#2a1a10', '#c87a30', '#8a8a8a', '#d0a060', '#e0e0e0'],
        eyes=['#3a5a8a', '#5a3a1a', '#4a6a4a'],
        metal='#b88a4a', tabard=[('#a02010', '#f0a020'), ('#3a3a3a', '#d84020')], emblem='hammer',
        cloth={'baja': ['#7a5a3a', '#6a5040', '#5a4a3a', '#8a6a48'], 'media': ['#8a3a1a', '#4a5a6a', '#6a4a2a', '#a06020'],
               'alta': ['#7a1010', '#2a2a4a', '#5a3a10', '#1a4a3a']}, trim='#f0b830'),
    'orco': dict(
        skin=['#6b8e3a', '#5a7a32', '#7a9a4a', '#5a6a40', '#4a6a3a', '#7a8a5a'],
        hair=['#1a1a1a', '#2a2a1a', '#3a2a1a', '#4a4a4a', '#5a1a10'],
        eyes=['#d02020', '#e0a020', '#c06010'],
        metal='#6a6a72', tabard=[('#8a1010', '#1a1a1a'), ('#2a2a2a', '#c02020')], emblem='skull',
        cloth={'baja': ['#5a4a3a', '#6a5a40', '#4a3a2a', '#7a6040'], 'media': ['#6a3a2a', '#4a4a3a', '#7a2a1a', '#3a4a2a'],
               'alta': ['#5a0a0a', '#1a1a1a', '#4a3a10', '#2a3a1a']}, trim='#c0a050'),
    'bestia': dict(
        skin=['#c9a26b', '#8a8a8a', '#d08040', '#5a4a3a', '#e8dcc8', '#a06a3a', '#d8b888'],
        hair=['#8a6a3a', '#5a5a5a', '#a05020', '#3a2a1a', '#f0f0f0', '#6a4020', '#c09060'],
        eyes=['#e0b020', '#a0d030', '#e07020', '#40c0e0'],
        metal='#8a7a5a', tabard=[('#c06010', '#f0d080'), ('#5a3a1a', '#e08030')], emblem='paw',
        cloth={'baja': ['#7a6a4a', '#6a5030', '#5a5a3a', '#8a6a40'], 'media': ['#a05a20', '#4a6a3a', '#7a4a2a', '#c08030'],
               'alta': ['#8a3a10', '#3a5a2a', '#6a2a10', '#a07020']}, trim='#e0c060'),
    'demonio': dict(
        skin=['#9b2c2c', '#6a2c70', '#a83a3a', '#7a3a80', '#4a3a6a', '#b04a3a'],
        hair=['#101010', '#e8e8e8', '#5a0a1a', '#2a0a2a', '#3a3a4a'],
        eyes=['#ffd020', '#ff8020', '#ff3020'],
        metal='#3a3038', tabard=[('#8a0a0a', '#ff7020'), ('#2a0a3a', '#c02020')], emblem='flame',
        cloth={'baja': ['#4a3a3a', '#3a2a2a', '#5a3a30', '#3a3040'], 'media': ['#6a1a1a', '#3a1a4a', '#2a2a2a', '#7a3a1a'],
               'alta': ['#1a0a0a', '#5a0a1a', '#2a0a3a', '#7a1010']}, trim='#ff8030'),
    'celestial': dict(
        skin=['#fff1e0', '#f8e8d8', '#ffe8c8', '#f0e0d0', '#f4dcc0'],
        hair=['#f0d060', '#ffffff', '#e8e8f8', '#ffe8a0', '#f8c888'],
        eyes=['#ffc830', '#60c0ff', '#e0e8ff'],
        metal='#f0ecd8', tabard=[('#f0f0f8', '#e0b020'), ('#3a70c0', '#f0f0f8')], emblem='sun',
        cloth={'baja': ['#d8d0c0', '#c8c0b0', '#b8b8c0', '#d0c8a8'], 'media': ['#f0f0f8', '#a0c8f0', '#f0e0a0', '#e8e8e8'],
               'alta': ['#ffffff', '#f0d060', '#80b0f0', '#f8f0e0']}, trim='#f0c040'),
    'vampiro': dict(
        skin=['#e8e0e0', '#e0d8e0', '#d8d8e8', '#f0e8e8', '#d0c8d0'],
        hair=['#101010', '#f0f0f0', '#3a1a1a', '#2a2a3a', '#7a0a1a'],
        eyes=['#c01020', '#ff3030', '#e04060'],
        metal='#2a2a32', tabard=[('#6a0a14', '#101010'), ('#1a1a1a', '#a01020')], emblem='bat',
        cloth={'baja': ['#3a3a40', '#4a4048', '#2a2a30', '#504850'], 'media': ['#4a0a14', '#1a1a2a', '#3a2a3a', '#2a1a1a'],
               'alta': ['#1a1a1a', '#5a0a14', '#2a0a2a', '#101018']}, trim='#c02030'),
    'hada': dict(
        skin=['#ffd6e8', '#ffe0d0', '#e8d8ff', '#d8ffe8', '#ffe8f0', '#fff0d0'],
        hair=['#80c0ff', '#ffa0d0', '#c0a0ff', '#a0f0c0', '#ff80c0', '#ffe080', '#ffffff'],
        eyes=['#40a0ff', '#ff60c0', '#60d080', '#a060ff'],
        metal='#d8c0f0', tabard=[('#e070b0', '#f0f0ff'), ('#70c090', '#ffe0f0')], emblem='flower',
        cloth={'baja': ['#a0b080', '#c0a0a0', '#a0a0c0', '#b0c0a0'], 'media': ['#ff90c0', '#80e0c0', '#c0a0ff', '#ffd080'],
               'alta': ['#e060a0', '#60c0a0', '#a070e0', '#f0f0ff']}, trim='#fff0a0'),
    'draconido': dict(
        skin=['#a83a3a', '#b8860b', '#3a7a4a', '#3a5aa0', '#7a3a7a', '#c86020'],
        hair=['#e0d0b0', '#c8b890', '#f0e0c0'],
        eyes=['#ffd020', '#ff8020', '#80ff40'],
        metal='#b07030', tabard=[('#a01010', '#f0c020'), ('#1a1a1a', '#e06010')], emblem='claw',
        cloth={'baja': ['#6a4a30', '#5a4a40', '#7a5a3a', '#4a4030'], 'media': ['#8a2a1a', '#a06010', '#3a3a4a', '#6a1a1a'],
               'alta': ['#6a0a0a', '#1a1a1a', '#8a5a10', '#3a0a3a']}, trim='#f0c020'),
}

HAIR_STYLES = {
    'humano': {'m': ['short', 'messy'], 'f': ['long', 'braid']},
    'elfo': {'m': ['long', 'ponytail'], 'f': ['long', 'braid']},
    'enano': {'m': ['short', 'bald'], 'f': ['braids', 'braids']},
    'orco': {'m': ['mohawk', 'topknot'], 'f': ['ponytail', 'mohawk']},
    'bestia': {'m': ['mane', 'short'], 'f': ['mane', 'bob']},
    'demonio': {'m': ['slick', 'short'], 'f': ['long', 'bob']},
    'celestial': {'m': ['short', 'long'], 'f': ['long', 'bun']},
    'vampiro': {'m': ['slick', 'long'], 'f': ['long', 'bob']},
    'hada': {'m': ['messy', 'short'], 'f': ['bob', 'pigtails']},
    'draconido': {'m': ['crest', 'crest'], 'f': ['crest', 'frill']},
}


def npc_spec(idx):
    """Parámetros de dibujo del aspecto idx = raza*16 + clase*4 + género*2 + variante."""
    race = RACES[idx // 16]
    cls = CLASSES[(idx // 4) % 4]
    g = 'f' if (idx // 2) % 2 else 'm'
    v = idx % 2
    L = RACE_LOOK[race]
    rng = random.Random(idx * 7919 + 13)
    sub = (idx % 16)

    def pick(lst, k=0):
        return lst[(sub * 3 + k * 5 + idx // 16) % len(lst)]
    sp = dict(idx=idx, race=race, cls=cls, g=g, v=v, rng=rng)
    sp['skin'] = T.C(pick(L['skin']))
    sp['hair'] = T.C(pick(L['hair'], 1))
    sp['eyes'] = T.C(pick(L['eyes'], 2))
    sp['metal'] = T.C(L['metal'])
    sp['tab'] = tuple(T.C(x) for x in L['tabard'][v])
    sp['emblem'] = L['emblem']
    sp['trim'] = T.C(L['trim'])
    if cls != 'guardia':
        lst = L['cloth'][cls]
        sp['cloth'] = T.C(lst[(sub + v * 2) % len(lst)])
        sp['cloth2'] = T.C(lst[(sub + v * 2 + 1) % len(lst)])
    else:
        sp['cloth'] = sp['tab'][0]
        sp['cloth2'] = sp['tab'][1]
    sp['style'] = HAIR_STYLES[race][g][v]
    # Rasgos raciales
    sp['beard'] = (race == 'enano' and g == 'm') or (race == 'humano' and g == 'm' and v == 1 and cls in ('baja', 'media')) \
        or (race == 'demonio' and g == 'm' and v == 0 and cls == 'alta')
    sp['beard_kind'] = 'big' if race == 'enano' else ('goatee' if race == 'demonio' else 'short')
    sp['horn'] = T.C({'demonio': '#2a2024', 'draconido': '#e8dcc0'}.get(race, '#3a3028'))
    if race == 'demonio' and v == 1:
        sp['horn'] = T.C('#8a1a1a')
    sp['lip'] = T.mix(sp['skin'], '#a03040', 0.35 if g == 'f' else 0.18)
    sp['barefoot'] = cls == 'baja' and v == 0 and race not in ('vampiro', 'celestial')
    sp['cape'] = (cls == 'alta' and race != 'hada' and (v == 0 or g == 'm')) or (cls == 'guardia' and v == 1 and race not in ('hada',))
    sp['dress'] = g == 'f' and cls in ('baja', 'media', 'alta')
    sp['apron'] = (cls == 'media' and v == 0) or (cls == 'baja' and g == 'f' and v == 1)
    return sp


# --------------------------------------------------------------------------------------
# Geometría del NPC
# --------------------------------------------------------------------------------------
def npc_model(geo_idx):
    m = Model(NPC_GEOS[geo_idx], 64, 128, bw=3.0, bh=3.6, boff=[0, 1.6, 0], grow=False)
    m.bone('root')
    m.bone('body', 'root', (0, 24, 0))
    m.box('body', 'body', (-4, 12, -2), (8, 12, 4))
    m.box('body', 'jacket', (-4, 12, -2), (8, 12, 4), inflate=0.25)
    m.bone('skirt', 'body', (0, 12, 0))
    m.box('skirt', 'skirt', (-4, 3, -2), (8, 9, 4), inflate=0.7,
          faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side'})
    m.bone('cape', 'body', (0, 24, 2.5), rot=(4, 0, 0))
    m.box('cape', 'cape', (-4.5, 5, 2.4), (9, 19, 1), inflate=0.05,
          faces={'south': 'back', 'north': 'inner', 'east': 'edge', 'west': 'edge', 'up': 'top'})
    m.bone('head', 'body', (0, 24, 0))
    m.box('head', 'head', (-4, 24, -4), (8, 8, 8))
    m.box('head', 'hair', (-4, 24, -4), (8, 8, 8), inflate=0.5,
          faces={'north': 'front', 'south': 'back', 'east': 'right', 'west': 'left', 'up': 'up'})
    m.bone('beard', 'head', (0, 24, -4))
    m.box('beard', 'beard', (-4, 20.5, -4.6), (8, 5, 2), inflate=0.1,
          faces={'north': 'front', 'east': 'side', 'west': 'side', 'down': 'under'})
    # Caras de ánimo (planos delante de la cara; se muestran por part_visibility)
    m.bone('lids', 'head', (0, 28, -4))
    m.plane('lids', 'lids', (-4, 27, -4.15), (8, 2, 0), light=False)
    m.bone('brows', 'head', (0, 29, -4))
    m.plane('brows', 'brows', (-4, 28, -4.18), (8, 2, 0), light=False)
    m.bone('mouth_h', 'head', (0, 25, -4))
    m.plane('mouth_h', 'mouth_h', (-4, 24, -4.15), (8, 3, 0), light=False)
    m.bone('mouth_a', 'head', (0, 25, -4))
    m.plane('mouth_a', 'mouth_a', (-4, 24, -4.16), (8, 3, 0), light=False)
    # Brazos y piernas (izquierda = espejo de la derecha)
    m.bone('rightArm', 'body', (-5, 22, 0))
    m.box('rightArm', 'arm', (-8, 12, -2), (4, 12, 4))
    m.box('rightArm', 'sleeve', (-8, 12, -2), (4, 12, 4), inflate=0.25)
    m.bone('leftArm', 'body', (5, 22, 0))
    m.box('leftArm', 'arm', (4, 12, -2), (4, 12, 4), mirror=True)
    m.box('leftArm', 'sleeve', (4, 12, -2), (4, 12, 4), inflate=0.25, mirror=True)
    m.bone('rightLeg', 'root', (-1.9, 12, 0))
    m.box('rightLeg', 'leg', (-3.9, 0, -2), (4, 12, 4))
    m.box('rightLeg', 'pants', (-3.9, 0, -2), (4, 12, 4), inflate=0.25)
    m.bone('leftLeg', 'root', (1.9, 12, 0))
    m.box('leftLeg', 'leg', (-0.1, 0, -2), (4, 12, 4), mirror=True)
    m.box('leftLeg', 'pants', (-0.1, 0, -2), (4, 12, 4), inflate=0.25, mirror=True)

    # ---- Extras raciales (todas las regiones existen en todas las variantes → mismo UV) ----
    def horns(show):
        for side, sx in (('R', -1), ('L', 1)):
            b = m.bone(f'horn{side}', 'head', (2.5 * sx, 31.5, -1), rot=(-25, 0, 18 * sx)) if show else None
            if show:
                m.box(b, 'horn1', (2.5 * sx - 1, 31, -2), (2, 3, 2), mirror=sx > 0)
                t = m.bone(f'horn{side}_tip', b, (2.5 * sx, 34, -1), rot=(-30, 0, 12 * sx))
                m.box(t, 'horn2', (2.5 * sx - 0.5, 33.5, -1.5), (1, 3, 1), mirror=sx > 0)
            else:
                m._region('horn1', (2, 3, 2), None, None, None)
                m._region('horn2', (1, 3, 1), None, None, None)

    def elf_ears(show):
        if show:
            for side, sx in (('R', -1), ('L', 1)):
                b = m.bone(f'ear{side}', 'head', (4 * sx, 28, 0), rot=(-15, -22 * sx, 0))
                x0 = -5.2 if sx < 0 else 4.2
                m.box(b, 'earE', (x0, 26.5, -1), (1, 3, 3), mirror=sx > 0)
                m.box(b, 'earE2', (x0, 29.5, 0), (1, 2, 2), mirror=sx > 0)
        else:
            m._region('earE', (1, 3, 3), None, None, None)
            m._region('earE2', (1, 2, 2), None, None, None)

    def beast(show):
        if show:
            for side, sx in (('R', -1), ('L', 1)):
                b = m.bone(f'bear{side}', 'head', (2.5 * sx, 32, 0), rot=(-8, 0, 14 * sx))
                m.box(b, 'earB', (2.5 * sx - 1.5, 31.5, -0.5), (3, 3, 1), mirror=sx > 0)
            t = m.bone('tail', 'body', (0, 13, 2), rot=(40, 0, 0))
            m.box(t, 'tail1', (-1, 12, 2), (2, 2, 6))
            t2 = m.bone('tail2', t, (0, 13, 8), rot=(20, 0, 0))
            m.box(t2, 'tail2', (-1, 12, 7.5), (2, 2, 5), inflate=0.15)
        else:
            m._region('earB', (3, 3, 1), None, None, None)
            m._region('tail1', (2, 2, 6), None, None, None)
            m._region('tail2', (2, 2, 5), None, None, None)

    def halo(show):
        if show:
            b = m.bone('halo', 'head', (0, 36.5, 0))
            m.box(b, 'haloX', (-3, 36, -3.5), (6, 1, 1), light=False)
            m.box(b, 'haloX', (-3, 36, 2.5), (6, 1, 1), light=False)
            m.box(b, 'haloZ', (-4, 36, -3), (1, 1, 6), light=False)
            m.box(b, 'haloZ', (3, 36, -3), (1, 1, 6), light=False)
        else:
            m._region('haloX', (6, 1, 1), None, None, False)
            m._region('haloZ', (1, 1, 6), None, None, False)

    def wings(show):
        if show:
            for side, sx in (('R', -1), ('L', 1)):
                b = m.bone(f'wing{side}', 'body', (1 * sx, 21, 2.6), rot=(0, -28 * sx, 0))
                x0 = -9 if sx < 0 else 1
                m.plane(b, 'wing1', (x0, 15, 2.7), (8, 10, 0), face='south', light=False, mirror=sx > 0)
                x1 = -7.5 if sx < 0 else 1.5
                m.plane(b, 'wing2', (x1, 9.5, 2.7), (6, 7, 0), face='south', light=False, mirror=sx > 0)
        else:
            m._region('wing1', (8, 10, 0), {'south': 'face'}, None, False)
            m._region('wing2', (6, 7, 0), {'south': 'face'}, None, False)

    horns(geo_idx == 1)
    elf_ears(geo_idx in (2, 5))
    beast(geo_idx == 3)
    halo(geo_idx == 4)
    wings(geo_idx == 5)

    # ---- Sombreros (rpg:hat 1..7) ----
    side4 = {'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'}
    b = m.bone('hat1', 'head', (0, 32, 0))
    m.box(b, 'straw_crown', (-3.5, 32, -3.5), (7, 3, 7), inflate=0.2,
          faces={'north': 'ring', 'south': 'ring', 'east': 'ring', 'west': 'ring', 'up': 'up'})
    m.box(b, 'straw_brim', (-7, 32.6, -7), (14, 0, 14), faces={'up': 'face', 'down': 'face'})
    b = m.bone('hat2', 'head', (0, 24, 0))
    m.box(b, 'hood', (-4, 24, -4), (8, 8, 8), inflate=1.0, faces=side4)
    m.box(b, 'hood_drape', (-4, 20.5, 3.4), (8, 4, 1), faces={'south': 'back', 'east': 'side', 'west': 'side'})
    b = m.bone('hat3', 'head', (0, 32, 0), rot=(-6, 0, 8))
    m.box(b, 'cap', (-4, 31, -4), (8, 2, 8), inflate=0.9, faces={'north': 'side', 'south': 'side', 'east': 'side', 'west': 'side', 'up': 'up', 'down': 'up'})
    m.bone('hat3_feather', b, (3.5, 33, 1), rot=(-25, 0, -10))
    m.plane('hat3_feather', 'feather', (3.9, 32.5, 0), (0, 7, 3), face='east')
    b = m.bone('hat4', 'head', (0, 24, 0))
    m.box(b, 'helm', (-4, 24, -4), (8, 8, 8), inflate=0.9, faces=side4)
    m.box(b, 'helm_nose', (-0.5, 25.5, -5.2), (1, 4, 1))
    m.box(b, 'helm_crest', (-0.5, 32.6, -4.5), (1, 3, 9), faces={'east': 'side', 'west': 'side', 'up': 'up', 'north': 'end', 'south': 'end'})
    b = m.bone('hat5', 'head', (0, 32, 0))
    for z in (-4.6, 3.6):
        m.box(b, 'crown_x', (-4.6, 32, z), (9, 3, 1), faces={'north': 'face', 'south': 'face', 'up': 'top', 'east': 'end', 'west': 'end'})
    for x in (-4.6, 3.6):
        m.box(b, 'crown_z', (x, 32, -3.6), (1, 3, 7), faces={'east': 'face', 'west': 'face', 'up': 'top'})
    m.box(b, 'crown_gem', (-0.5, 33, -5), (1, 1, 1))
    b = m.bone('hat6', 'head', (0, 28, 0))
    m.box(b, 'bandana', (-4, 28, -4), (8, 4, 8), inflate=0.7, faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'})
    m.box(b, 'bandana_knot', (-1, 28.5, 4.4), (2, 2, 1))
    m.bone('hat6_tail', b, (0, 29, 5), rot=(25, 0, 0))
    m.plane('hat6_tail', 'bandana_tail', (-1.5, 25, 5.2), (3, 4, 0), face='south')
    b = m.bone('hat7', 'head', (0, 32, 0))
    m.box(b, 'chef_band', (-4, 31, -4), (8, 2, 8), inflate=0.6, faces={'north': 'band', 'south': 'band', 'east': 'band', 'west': 'band'})
    m.box(b, 'chef_puff', (-4, 33.2, -4), (8, 4, 8), inflate=1.0, faces={'north': 'ring', 'south': 'ring', 'east': 'ring', 'west': 'ring', 'up': 'up', 'down': 'up'})

    # ---- Herramientas en la mano derecha (rpg:tool 1..7) ----
    hand = (-6, 13, -2.5)
    b = m.bone('tool1', 'rightArm', hand, rot=(82, 0, 0))
    m.box(b, 'sword_blade', (-6.5, 15.5, -3.5), (1, 11, 2))
    m.box(b, 'sword_guard', (-6.5, 14.5, -5), (1, 1, 5))
    m.box(b, 'sword_grip', (-6.5, 11.5, -3), (1, 3, 1))
    m.box(b, 'sword_pommel', (-6.5, 10.5, -3), (1, 1, 1))
    b = m.bone('tool2', 'rightArm', hand, rot=(-4, 0, 0))
    m.box(b, 'spear_shaft', (-6.5, 1, -3), (1, 27, 1))
    m.box(b, 'spear_head', (-6.5, 28, -4), (1, 6, 3))
    m.plane(b, 'spear_flag', (-6, 23, -2.5), (0, 4, 5), face='east')
    b = m.bone('tool3', 'rightArm', hand, rot=(-4, 0, 0))
    m.box(b, 'hoe_shaft', (-6.5, 4, -3), (1, 21, 1))
    m.box(b, 'hoe_blade', (-6.5, 23, -7), (1, 2, 4))
    b = m.bone('tool4', 'rightArm', hand, rot=(80, 0, 0))
    m.box(b, 'hammer_handle', (-6.5, 10, -3), (1, 11, 1))
    m.box(b, 'hammer_head', (-7.5, 20, -5), (3, 3, 5))
    b = m.bone('tool5', 'rightArm', hand, rot=(40, 0, 0))
    m.box(b, 'tank_body', (-8, 11, -4.5), (4, 5, 4))
    m.box(b, 'tank_foam', (-8, 16, -4.5), (4, 1, 4), inflate=0.15)
    m.box(b, 'tank_handle', (-6.5, 12, -0.5), (1, 3, 2))
    b = m.bone('tool6', 'rightArm', hand, rot=(-4, 0, 0))
    m.box(b, 'staff_shaft', (-6.5, 1, -3), (1, 25, 1))
    m.box(b, 'staff_cap', (-7, 26, -3.5), (2, 1, 2))
    m.bone('tool6_orb', b, (-6, 28.5, -2.5))
    m.box('tool6_orb', 'staff_orb', (-7.5, 27, -4), (3, 3, 3), light=False)
    b = m.bone('tool7', 'rightArm', hand, rot=(45, 0, 0))
    m.box(b, 'torch_stick', (-6.5, 11, -3), (1, 9, 1))
    m.bone('tool7_flame', b, (-6, 21, -2.5))
    m.box('tool7_flame', 'torch_flame', (-7, 19.5, -3.5), (2, 3, 2), light=False)

    # ---- Alerta "!" sobre la cabeza ----
    m.bone('alert', 'root', (0, 40, 0))
    m.box('alert', 'alert_bar', (-1, 40, -1), (2, 6, 2), light=False)
    m.box('alert', 'alert_dot', (-1, 37, -1), (2, 2, 2), light=False)
    m.pack()
    return m


# --------------------------------------------------------------------------------------
# Pintor de aspectos de NPC
# --------------------------------------------------------------------------------------
def _hair_shade(c, r, base, rng, streak=True):
    x, y, w, h = r
    for i in range(w):
        off = rng.randrange(3)
        for j in range(h):
            p = c.get(x + i, y + j)
            if not p[3]:
                continue
            f = 1.0
            if streak and (j + off) % 3 == 0:
                f = 0.88
            if j == 0:
                f *= 1.12
            c.put(x + i, y + j, T.shade(p, f))


def paint_hair(c, F, sp):
    st = sp['style']
    hair = sp['hair']
    rng = random.Random(sp['idx'] * 31 + 7)
    hd = T.dark(hair, 0.72)
    hl = T.light(hair, 1.22)
    for r in F.all():
        c.clear(r)
    up, fr, bk, rt, lf = F['up'], F['front'], F['back'], F['right'], F['left']

    def full(r, rows, jag=False):
        for i in range(r[2]):
            hh = rows + (rng.choice((0, 0, 1, -1)) if jag else 0)
            for j in range(max(0, min(r[3], hh))):
                c.at(r, i, j, c.jit(hair, 0.05))

    if st == 'bald':
        for r in (bk, rt, lf):
            for i in range(r[2]):
                for j in (5, 6):
                    if rng.random() < 0.7:
                        c.at(r, i, j, hair)
        return
    if st in ('crest', 'frill'):
        ridge = sp['horn']
        for j in range(8):
            c.at(up, 3, j, ridge)
            c.at(up, 4, j, T.shade(ridge, 0.85))
        for j in range(0, 6):
            c.at(bk, 3, j, ridge)
            c.at(bk, 4, j, T.shade(ridge, 0.85))
        c.at(fr, 3, 0, ridge)
        c.at(fr, 4, 0, T.shade(ridge, 0.85))
        if st == 'frill':
            for r in (rt, lf):
                for j in range(2, 7):
                    c.at(r, 7 if r is rt else 0, j, T.mix(ridge, sp['skin'], 0.3))
                    c.at(r, 6 if r is rt else 1, j + 1, T.mix(ridge, sp['skin'], 0.5))
        return
    if st == 'mohawk':
        for j in range(8):
            for i in (3, 4):
                c.at(up, i, j, hair)
        for j in range(7):
            for i in (3, 4):
                c.at(bk, i, j, hair)
        c.at(fr, 3, 0, hair)
        c.at(fr, 4, 0, hair)
        for r in (rt, lf):
            for i in range(8):
                if rng.random() < 0.35:
                    c.at(r, i, rng.randrange(0, 3), hd)
        if sp['g'] == 'f':
            for j in range(7, 8):
                c.at(bk, 3, j, hair)
        _hair_shade(c, up, hair, rng)
        return
    if st == 'topknot':
        for i in (3, 4):
            for j in (3, 4):
                c.at(up, i, j, hair)
        for j in range(0, 3):
            c.at(bk, 3, j, hd)
            c.at(bk, 4, j, hd)
        return
    # Peinados con pelo completo arriba
    c.fill(up, hair, 0.05)
    if st in ('short', 'messy', 'slick', 'mane', 'bob', 'bun', 'ponytail'):
        full(fr, 2 if st != 'slick' else 1, jag=st in ('messy', 'mane'))
        if st == 'bob':
            for j in range(2, 6):
                c.at(fr, 0, j, hair)
                c.at(fr, 7, j, hair)
        side = {'short': 3, 'messy': 3, 'slick': 3, 'mane': 6, 'bob': 6, 'bun': 4, 'ponytail': 4}[st]
        full(rt, side, jag=st in ('messy', 'mane'))
        full(lf, side, jag=st in ('messy', 'mane'))
        for r in (rt, lf):  # patillas
            c.at(r, 6 if r is rt else 1, side, hair)
        full(bk, {'short': 6, 'messy': 6, 'slick': 6, 'mane': 8, 'bob': 7, 'bun': 7, 'ponytail': 7}[st], jag=st == 'messy')
        if st == 'messy':
            for _ in range(4):
                c.at(fr, rng.randrange(8), 2, hair)
        if st == 'slick':
            for i in range(8):
                c.at(up, i, 7, hl)
        if st == 'bun':
            c.area(bk, 2, 1, 4, 3, hd)
            c.area(bk, 3, 1, 2, 2, hl)
        if st == 'ponytail':
            c.area(bk, 3, 5, 2, 3, hd)
    else:  # largos
        full(fr, 2)
        if st in ('long', 'braid', 'braids', 'pigtails'):
            for j in range(2, 8):
                c.at(fr, 0, j, hair)
                c.at(fr, 7, j, hair)
            if st == 'long':
                c.at(fr, 1, 2, hair)
                c.at(fr, 6, 2, hair)
        for r in (rt, lf):
            c.fill(r, hair, 0.05)
        c.fill(bk, hair, 0.05)
        if st in ('braid', 'braids', 'pigtails'):
            for j in range(0, 8, 2):
                c.at(bk, 3, j, hd)
                c.at(bk, 4, j + 1, hd)
    # Sombreado de mechones y brillo superior
    for r in (fr, bk, rt, lf, up):
        _hair_shade(c, r, hair, rng, streak=r is not up)
    for i in range(1, 7, 2):
        c.at(up, i, 2, hl)
    # Separación (raya) para algunos peinados
    if st in ('short', 'long', 'bob') and sp['v'] == 1:
        for j in range(8):
            c.at(up, 2, j, hd)


def paint_head(c, F, sp):
    race, g = sp['race'], sp['g']
    skin = sp['skin']
    rng = random.Random(sp['idx'] * 17 + 3)
    mat = {'bestia': 'fur', 'draconido': 'scales'}.get(race, 'skin')
    T.mat_box(c, F, skin, mat, seed=sp['idx'])
    fr = F['front']
    sd = T.dark(skin, 0.82)
    sdd = T.dark(skin, 0.66)
    hair = sp['hair']
    brow = T.dark(hair, 0.62) if race not in ('draconido',) else T.dark(skin, 0.55)
    eyes = sp['eyes']
    # Cuello/mentón (cara inferior) un poco más oscuro
    c.tint(F['down'], 0.85)
    if race == 'bestia':
        muzzle = T.light(skin, 1.25) if T.lum(skin) < 170 else T.mix(skin, '#ffffff', 0.4)
        c.area(fr, 2, 4, 4, 4, muzzle)
        c.at(fr, 1, 6, muzzle)
        c.at(fr, 6, 6, muzzle)
        c.area(fr, 3, 4, 2, 1, '#2a1a18')
        c.at(fr, 3, 5, T.dark(muzzle, 0.6))
        c.at(fr, 4, 5, T.dark(muzzle, 0.6))
        c.at(fr, 2, 6, T.dark(muzzle, 0.55))
        c.at(fr, 5, 6, T.dark(muzzle, 0.55))
        c.at(fr, 3, 7, T.dark(muzzle, 0.75))
        c.at(fr, 4, 7, T.dark(muzzle, 0.75))
        # ojos rasgados
        for ex in (1, 5):
            c.at(fr, ex, 3, eyes, glow=True)
            c.at(fr, ex + 1, 3, T.light(eyes, 1.3), glow=True)
            c.at(fr, ex, 4, T.dark(eyes, 0.8))
            c.at(fr, ex + 1, 4, eyes)
        c.at(fr, 2, 3, '#101010')
        c.at(fr, 5, 3, '#101010')
        c.at(fr, 1, 2, brow)
        c.at(fr, 6, 2, brow)
        for wx in (0, 7):
            c.at(fr, wx, 5, '#f0f0e8')
        return
    if race == 'draconido':
        belly = T.mix(skin, '#f0d8a0', 0.55)
        c.area(fr, 1, 6, 6, 2, belly)
        c.area(fr, 2, 5, 4, 1, T.mix(skin, belly, 0.5))
        c.hl(fr, 2, sdd, 1, 7)
        for ex in (1, 5):
            c.at(fr, ex, 3, eyes, glow=True)
            c.at(fr, ex + 1, 3, eyes, glow=True)
            c.at(fr, ex, 4, T.dark(eyes, 0.7))
            c.at(fr, ex + 1, 4, T.dark(eyes, 0.7))
        c.at(fr, 2, 3, '#101008', glow=True)
        c.at(fr, 5, 3, '#101008', glow=True)
        c.at(fr, 3, 5, sdd)
        c.at(fr, 4, 5, sdd)
        c.hl(fr, 7, T.dark(belly, 0.7), 2, 6)
        for r in (F['right'], F['left']):
            c.area(r, 1, 6, 6, 2, belly)
        return
    # --- caras humanoides
    white = '#f4f0e8'
    if race == 'demonio':
        white = '#1a1014'
    if race == 'vampiro':
        c.at(fr, 1, 5, T.mix(skin, '#5a3a6a', 0.35))
        c.at(fr, 6, 5, T.mix(skin, '#5a3a6a', 0.35))
    glow = race in ('demonio', 'vampiro', 'celestial')
    if race == 'hada':
        # ojos grandes 2×2 con destello
        for ex in (1, 5):
            c.area(fr, ex, 3, 2, 2, eyes)
            c.at(fr, ex if ex == 1 else ex + 1, 3, '#ffffff')
            c.at(fr, ex + 1 if ex == 1 else ex, 4, T.dark(eyes, 0.6))
        c.at(fr, 1, 5, T.mix(skin, '#ff6090', 0.45))
        c.at(fr, 6, 5, T.mix(skin, '#ff6090', 0.45))
        for _ in range(3):
            c.at(fr, rng.choice((0, 7)), rng.randrange(2, 6), T.light(skin, 1.2))
    else:
        eyes2(c, fr, 1, 3, eyes, white, glow=glow)
        # ojo izquierdo (espejo): iris por dentro
        c.at(fr, 6, 3, white)
        c.at(fr, 6, 4, T.shade(T.C(white), 0.86))
        c.at(fr, 5, 3, T.light(eyes, 1.35), glow=glow)
        c.at(fr, 5, 4, T.dark(eyes, 0.45) if not glow else eyes, glow=glow)
    # cejas
    if race == 'enano':
        c.hl(fr, 2, brow, 0, 3)
        c.hl(fr, 2, brow, 5, 8)
    elif race == 'orco':
        c.hl(fr, 2, T.dark(skin, 0.6), 0, 8)
        c.at(fr, 1, 2, brow)
        c.at(fr, 6, 2, brow)
    elif race != 'hada':
        c.at(fr, 1, 2, brow)
        c.at(fr, 2, 2, brow)
        c.at(fr, 5, 2, brow)
        c.at(fr, 6, 2, brow)
    if g == 'f' and race not in ('hada', 'orco'):
        c.at(fr, 0, 3, T.dark(hair, 0.5))
        c.at(fr, 7, 3, T.dark(hair, 0.5))
    # nariz
    if race == 'enano':
        c.area(fr, 3, 4, 2, 2, T.light(skin, 1.08))
        c.at(fr, 3, 5, T.mix(skin, '#d05050', 0.25))
        c.at(fr, 4, 5, T.mix(skin, '#d05050', 0.25))
        c.at(fr, 3, 6, sdd)
        c.at(fr, 4, 6, sdd)
        c.at(fr, 1, 5, T.mix(skin, '#d06060', 0.3))
        c.at(fr, 6, 5, T.mix(skin, '#d06060', 0.3))
    elif race == 'orco':
        c.at(fr, 3, 5, sdd)
        c.at(fr, 4, 5, sdd)
        c.at(fr, 3, 4, sd)
        c.at(fr, 4, 4, sd)
    else:
        c.at(fr, 3, 5, sd)
        c.at(fr, 4, 5, T.shade(skin, 0.94))
    # boca
    if race == 'orco':
        c.hl(fr, 6, T.dark(skin, 0.45), 2, 6)
        c.at(fr, 2, 5, '#f0ead0')  # colmillos hacia arriba
        c.at(fr, 5, 5, '#f0ead0')
        c.at(fr, 2, 6, '#e0d8b8')
        c.at(fr, 5, 6, '#e0d8b8')
        if sp['v'] == 1:  # cicatriz
            c.at(fr, 6, 1, T.mix(skin, '#e0c0a0', 0.5))
            c.at(fr, 6, 2, T.mix(skin, '#e0c0a0', 0.5))
            c.at(fr, 5, 3, T.mix(skin, '#e0c0a0', 0.3))
    else:
        c.at(fr, 3, 6, sp['lip'] if g == 'f' else sdd)
        c.at(fr, 4, 6, sp['lip'] if g == 'f' else sdd)
        if g == 'f':
            c.at(fr, 3, 7, T.mix(skin, sp['lip'], 0.35))
            c.at(fr, 4, 7, T.mix(skin, sp['lip'], 0.35))
    if race in ('vampiro', 'demonio'):
        c.at(fr, 3, 7, '#f8f8f0')
        c.at(fr, 4, 7, sdd)
    if race == 'demonio':
        mk = T.dark(skin, 0.55)
        c.at(fr, 0, 4, mk)
        c.at(fr, 0, 5, mk)
        c.at(fr, 7, 4, mk)
        c.at(fr, 7, 5, mk)
        c.at(fr, 3, 1, mk)
        c.at(fr, 4, 1, mk)
    if race == 'celestial':
        c.at(fr, 3, 1, '#ffe060', glow=True)
        c.at(fr, 4, 1, '#fff4b0', glow=True)
    if race == 'humano' and sp['v'] == 0 and sp['g'] == 'f' and sp['cls'] == 'baja':
        for (fx, fy) in ((1, 5), (2, 5), (5, 5), (6, 5)):
            c.at(fr, fx, fy, T.mix(skin, '#a0603a', 0.35))
    # orejas humanas en los lados
    for r in (F['right'], F['left']):
        c.at(r, 3 if r is F['right'] else 4, 4, sd)
        c.at(r, 3 if r is F['right'] else 4, 5, sd)


def paint_beard(c, F, sp):
    for r in F.all():
        c.clear(r)
    if not sp['beard']:
        return
    hair = sp['hair'] if sp['race'] != 'enano' else sp['hair']
    rng = random.Random(sp['idx'] * 5 + 1)
    fr = F['front']
    kind = sp['beard_kind']
    if kind == 'big':
        c.fill(fr, hair, 0.06)
        c.clear(fr, 2, 0, 4, 1)          # boca visible
        c.at(fr, 3, 0, T.dark(hair, 0.6))  # bigote
        for i in (0, 7):
            c.clear(fr, i, 4, 1, 1)
        if sp['v'] == 1:  # trenzas con anillas
            for j in range(1, 5):
                c.at(fr, 2, j, T.dark(hair, 0.75))
                c.at(fr, 5, j, T.dark(hair, 0.75))
            c.at(fr, 2, 3, '#e0b040')
            c.at(fr, 5, 3, '#e0b040')
        for r in (F['side'], F['under']):
            c.fill(r, T.dark(hair, 0.85), 0.05)
    elif kind == 'goatee':
        c.area(fr, 3, 2, 2, 3, hair)
    else:
        for i in range(8):
            for j in range(1, 3):
                if rng.random() < (0.85 if i not in (0, 7) else 0.5):
                    c.at(fr, i, j, c.jit(hair, 0.08))
        c.clear(fr, 3, 1, 2, 1)
        c.at(fr, 2, 0, hair)
        c.at(fr, 5, 0, hair)
        c.fill(F['side'], hair, 0.06)
        c.clear(F['side'], 0, 3, 2, 2)
    _hair_shade(c, fr, hair, rng)


def _emblem(c, r, kind, col, cx=None, cy=3):
    cx = (r[2] // 2 - 1) if cx is None else cx
    pats = {
        'cross': ['.X.', 'XXX', '.X.', '.X.'],
        'leaf': ['.X.', 'XXX', 'XXX', '.X.'],
        'hammer': ['XXX', 'XXX', '.X.', '.X.'],
        'skull': ['XXX', 'X.X', 'XXX', 'X.X'],
        'paw': ['X.X', '...', 'XXX', '.X.'],
        'flame': ['.X.', 'XX.', 'XXX', '.X.'],
        'sun': ['X.X', '.X.', 'XXX', 'X.X'],
        'bat': ['X.X', 'XXX', '.X.', '...'],
        'flower': ['.X.', 'X.X', '.X.', '.X.'],
        'claw': ['X.X', 'X.X', 'XXX', '.X.'],
    }
    for j, row in enumerate(pats.get(kind, pats['cross'])):
        for i, ch in enumerate(row):
            if ch == 'X':
                c.at(r, cx + i, cy + j, col)


def paint_npc_clothes(c, L, sp):
    """Cuerpo, chaqueta, brazos, mangas, piernas, pantalón, falda y capa."""
    cls, g, race, v = sp['cls'], sp['g'], sp['race'], sp['v']
    skin = sp['skin']
    smat = {'bestia': 'fur', 'draconido': 'scales'}.get(race, 'skin')
    cloth, cloth2 = sp['cloth'], sp['cloth2']
    trim = sp['trim']
    linen = T.C('#d8ccb0') if cls == 'baja' else T.C('#ece4d4')
    if race == 'vampiro' and cls != 'baja':
        linen = T.C('#e8e0e8')
    seed = sp['idx']
    Fb, Fj, Fa, Fs, Fl, Fp, Fk, Fc = (L['body'], L['jacket'], L['arm'], L['sleeve'], L['leg'], L['pants'], L['skirt'], L['cape'])
    for F in (Fj, Fs, Fp, Fk, Fc):
        for r in F.all():
            c.clear(r)
    # ---------------- base: cuerpo, brazos y piernas ----------------
    shirt = linen if cls in ('media', 'alta') else (cloth if cls == 'baja' else T.C('#5a5a62'))
    mat = 'rough' if cls == 'baja' else 'cloth'
    P(c, Fb, shirt, mat, seed)
    P(c, Fa, shirt, mat, seed + 1)
    for name in ('front', 'back', 'right', 'left'):  # manos de piel
        r = Fa[name]
        T.mat_fill(c, (r[0], r[1] + 9, r[2], 3), skin, smat, seed=seed)
    T.mat_fill(c, Fa['down'], skin, smat, seed=seed)
    if race == 'bestia' or race == 'draconido':
        r = Fa['front']
        c.hl(r, 11, T.dark(skin, 0.5), 0, 4)  # garras
    pants = {'baja': T.C('#5a4a3a'), 'media': T.dark(cloth2, 0.75), 'alta': T.C('#2a2a34') if v == 0 else T.C('#e8e0d0'),
             'guardia': T.C('#4a4a52')}[cls]
    if race in ('celestial',) and cls != 'guardia':
        pants = T.C('#e8e4dc')
    P(c, Fl, pants, 'rough' if cls == 'baja' else 'cloth', seed + 2)
    # pies
    if sp['barefoot']:
        for name in ('front', 'back', 'right', 'left'):
            r = Fl[name]
            T.mat_fill(c, (r[0], r[1] + 10, r[2], 2), skin, smat, seed=seed)
            T.mat_fill(c, (r[0], r[1] + 9, r[2], 1), pants, 'rough', seed=seed)
        T.mat_fill(c, Fl['down'], T.dark(skin, 0.8), 'skin', seed=seed)
        c.hl(Fl['front'], 9, T.dark(pants, 0.7))
    elif cls == 'baja':
        wrap = T.C('#8a7a60')
        for name in ('front', 'back', 'right', 'left'):
            r = Fl[name]
            T.mat_fill(c, (r[0], r[1] + 9, r[2], 3), wrap, 'rough', seed=seed)
            c.hl(r, 10, T.dark(wrap, 0.75))
        T.mat_fill(c, Fl['down'], T.dark(wrap, 0.7), 'leather', seed=seed)
    else:
        boot = {'media': T.C('#5a3a20'), 'alta': T.C('#1a1414'), 'guardia': T.C('#3a2a1a')}[cls]
        top = 7 if cls == 'alta' else 9
        for name in ('front', 'back', 'right', 'left'):
            r = Fl[name]
            T.mat_fill(c, (r[0], r[1] + top, r[2], 12 - top), boot, 'leather', seed=seed)
            c.hl(r, top, T.light(boot, 1.3))
            c.hl(r, 11, T.dark(boot, 0.6))
        T.mat_fill(c, Fl['down'], T.dark(boot, 0.6), 'leather', seed=seed)
        if cls == 'alta':
            c.hl(Fl['front'], 7, trim)
    # ---------------- ropa por clase ----------------
    jf, jb = Fj['front'], Fj['back']
    if cls == 'baja':
        tunic = cloth
        if g == 'm':
            P(c, Fj, tunic, 'rough', seed + 3)
            c.clear(Fj['up'])
            P(c, Fj, tunic, 'rough', seed + 3, faces=('up',))
            # cuello en V y cordón
            c.at(jf, 3, 0, skin)
            c.at(jf, 4, 0, skin)
            c.at(jf, 3, 1, T.dark(tunic, 0.6))
            c.at(jf, 4, 1, T.dark(tunic, 0.6))
            # cinturón de cuerda
            for r in Fj.sides():
                c.hl(r, 9, '#b09060')
                for i in range(0, r[2], 2):
                    c.at(r, i, 9, '#8a7048')
            c.at(jf, 2, 10, '#b09060')
            c.at(jf, 2, 11, '#8a7048')
            # remiendos
            rng = random.Random(seed)
            for _ in range(2):
                r = rng.choice([jf, jb])
                px_, py_ = rng.randrange(0, r[2] - 2), rng.randrange(2, 8)
                pc = T.mix(tunic, rng.choice(['#a08860', '#6a7a5a', '#8a6a5a']), 0.6)
                c.area(r, px_, py_, 2, 2, pc)
                c.at(r, px_, py_, T.dark(pc, 0.7))
            # túnica corta: dobladillo raído en la falda
            P(c, Fk, tunic, 'rough', seed + 4, faces=('front', 'back', 'side'))
            for r in Fk.all():
                x, y, w, h = r
                for i in range(w):
                    cut = 3 + rng.choice((0, 0, 1, -1))
                    c.clear(r, i, cut, 1, h - cut)
            # mangas cortas
            P(c, Fs, tunic, 'rough', seed + 5)
            for r in Fs.all():
                c.clear(r, 0, 4 if r[3] >= 12 else 0, r[2], max(0, r[3] - 4))
            c.clear(Fs['down'])
            c.clear(Fs['up'])
        else:
            # vestido basto con corpiño atado
            P(c, Fb, linen, 'rough', seed)
            P(c, Fj, cloth, 'rough', seed + 3)
            c.clear(Fj['up'])
            for j in range(1, 9):
                c.at(jf, 3 if j % 2 else 4, j, '#d8c8a0')
            c.hl(jf, 0, linen)
            for r in Fj.sides():
                c.hl(r, 9, T.dark(cloth, 0.7))
            P(c, Fk, cloth2 if v else cloth, 'rough', seed + 4, faces=('front', 'back', 'side'))
            for r in Fk.all():
                for i in range(r[2]):
                    if (i * 7 + seed) % 5 == 0:
                        c.clear(r, i, r[3] - 1, 1, 1)
            if sp['apron']:
                ap = T.C('#c8b898')
                r = Fk['front']
                c.area(r, 1, 0, 6, 7, ap)
                c.hl(r, 6, T.dark(ap, 0.8), 1, 7)
            P(c, Fs, linen, 'rough', seed + 5)
            for r in Fs.all():
                c.clear(r, 0, 6 if r[3] >= 12 else 0, r[2], max(0, r[3] - 6))
            c.clear(Fs['down'])
            c.clear(Fs['up'])
    elif cls == 'media':
        if g == 'm':
            P(c, Fj, cloth, 'cloth', seed + 3)
            c.clear(Fj['up'])
            # chaleco abierto: camisa visible en el centro
            for j in range(0, 10):
                c.at(jf, 3, j, linen)
                c.at(jf, 4, j, linen)
            c.at(jf, 2, 0, T.dark(cloth, 0.7))
            c.at(jf, 5, 0, T.dark(cloth, 0.7))
            for j in (2, 5, 8):
                c.at(jf, 2, j, '#d8c070')
            belt = T.C('#4a2e14')
            for r in Fj.sides():
                c.hl(r, 10, belt)
            c.at(jf, 3, 10, '#e0c060')
            c.at(jf, 4, 10, '#e0c060')
            c.clear(Fj['down'])
            # faldón corto del chaleco
            P(c, Fk, cloth, 'cloth', seed + 4, faces=('front', 'back', 'side'))
            for r in Fk.all():
                c.clear(r, 0, 2, r[2], r[3] - 2)
            c.clear(Fk['front'], 3, 0, 2, 2)
            if sp['apron']:  # delantal de artesano (cuero)
                ap = T.C('#7a5030')
                c.area(jf, 1, 4, 6, 6, ap)
                c.area(Fk['front'], 1, 0, 6, 6, ap)
                c.hl(jf, 4, T.light(ap, 1.2), 1, 7)
                c.at(jf, 1, 3, ap)
                c.at(jf, 6, 3, ap)
                c.at(Fk['front'], 2, 2, T.dark(ap, 0.7))
                c.at(Fk['front'], 5, 3, T.dark(ap, 0.7))
            # mangas arremangadas de lino
            P(c, Fs, linen, 'cloth', seed + 5)
            for r in Fs.all():
                c.clear(r, 0, 7 if r[3] >= 12 else 0, r[2], max(0, r[3] - 7))
                if r[3] >= 12:
                    c.hl(r, 6, T.dark(linen, 0.85))
            c.clear(Fs['down'])
            c.clear(Fs['up'])
        else:
            P(c, Fb, linen, 'cloth', seed)
            P(c, Fj, cloth, 'cloth', seed + 3)
            c.clear(Fj['up'])
            c.area(jf, 1, 0, 6, 2, linen)
            c.hl(jf, 2, T.dark(cloth, 0.7), 1, 7)
            for j in range(3, 10):
                c.at(jf, 3 if j % 2 else 4, j, T.light(cloth, 1.5))
            for r in Fj.sides():
                c.hl(r, 10, T.dark(cloth, 0.6))
            P(c, Fk, cloth, 'cloth', seed + 4, faces=('front', 'back', 'side'))
            for r in Fk.all():
                c.hl(r, r[3] - 1, T.dark(cloth, 0.7))
            if sp['apron']:
                ap = T.C('#f0ead8')
                c.area(Fk['front'], 1, 0, 6, 8, ap)
                c.hl(Fk['front'], 7, T.dark(ap, 0.8), 1, 7)
                c.area(jf, 2, 6, 4, 4, ap)
            P(c, Fs, linen, 'cloth', seed + 5)
            for r in Fs.all():
                if r[3] >= 12:
                    c.clear(r, 0, 8, r[2], r[3] - 8)
                    c.hl(r, 7, T.dark(linen, 0.8))
            c.clear(Fs['down'])
            c.clear(Fs['up'])
    elif cls == 'alta':
        rich = cloth
        P(c, Fj, rich, 'cloth', seed + 3)
        c.clear(Fj['up'])
        P(c, Fj, rich, 'cloth', seed + 3, faces=('up',))
        gold = trim
        if g == 'm':
            # jubón con botones dorados, cuello blanco con gorguera y faja
            c.hl(jf, 0, '#f4f4f0')
            c.hl(jf, 1, '#e0e0dc')
            for r in (Fj['right'], Fj['left'], jb):
                c.hl(r, 0, '#f4f4f0')
            for j in range(2, 11):
                c.at(jf, 3, j, gold if j % 2 == 0 else T.dark(rich, 0.7))
                c.at(jf, 4, j, T.dark(rich, 0.7))
            for r in Fj.sides():
                c.hl(r, 9, cloth2)
                c.hl(r, 11, gold)
            for (ex, ey) in ((1, 4), (6, 4), (1, 7), (6, 7)):
                c.at(jf, ex, ey, T.light(gold, 1.1))
            P(c, Fk, rich, 'cloth', seed + 4, faces=('front', 'back', 'side'))
            for r in Fk.all():
                c.clear(r, 0, 5, r[2], r[3] - 5)
                c.hl(r, 4, gold)
            c.clear(Fk['front'], 3, 0, 2, 5)
            P(c, Fs, rich, 'cloth', seed + 5)
            for r in Fs.all():
                if r[3] >= 12:
                    c.hl(r, 8, gold)
                    c.hl(r, 9, '#f4f4f0')
                    c.clear(r, 0, 10, r[2], 2)
            c.clear(Fs['up'])
            c.clear(Fs['down'])
        else:
            # vestido de gala: corsé con cordón dorado, collar, falda larga bordada
            c.area(jf, 1, 0, 6, 1, skin)
            c.hl(jf, 1, gold, 1, 7)
            c.at(jf, 3, 2, '#e04050')  # colgante
            c.at(jf, 4, 2, '#e04050')
            for j in range(3, 11):
                c.at(jf, 3, j, gold if j % 2 else T.dark(rich, 0.65))
                c.at(jf, 4, j, gold if not j % 2 else T.dark(rich, 0.65))
            for r in Fj.sides():
                c.hl(r, 11, gold)
            P(c, Fk, rich, 'cloth', seed + 4, faces=('front', 'back', 'side'))
            for r in Fk.all():
                c.hl(r, r[3] - 1, gold)
                c.hl(r, r[3] - 2, T.dark(rich, 0.75))
                for i in range(0, r[2], 2):
                    c.at(r, i, r[3] - 3, T.mix(rich, gold, 0.6))
            c.area(Fk['front'], 3, 0, 2, 8, T.light(rich, 1.25))
            P(c, Fs, rich, 'cloth', seed + 5)
            for r in Fs.all():
                if r[3] >= 12:
                    c.hl(r, 0, T.light(rich, 1.3))
                    c.hl(r, 2, gold)
                    c.hl(r, 9, gold)
                    c.clear(r, 0, 10, r[2], 2)
            c.clear(Fs['up'])
            c.clear(Fs['down'])
    else:  # guardia
        metal = sp['metal']
        tab, tab2 = sp['tab']
        P(c, Fb, T.C('#6a6a72'), 'chain', seed)
        P(c, Fj, metal, 'metal', seed + 3)
        for r in Fj.sides():
            c.hl(r, 0, T.light(metal, 1.3))
            c.hl(r, 7, T.dark(metal, 0.6))
        # tabardo con emblema
        for r in (jf, jb):
            c.area(r, 1, 1, 6, 11, tab)
            c.vl(r, 1, T.dark(tab, 0.8), 1, 12)
            c.vl(r, 6, T.dark(tab, 0.8), 1, 12)
            c.hl(r, 1, tab2, 1, 7)
        _emblem(c, jf, sp['emblem'], tab2, 2, 3)
        belt = T.C('#3a2414')
        for r in Fj.sides():
            c.hl(r, 10, belt)
        c.at(jf, 3, 10, '#c0b090')
        c.at(jf, 4, 10, '#c0b090')
        # faldón de cota de malla + tabardo
        P(c, Fk, T.C('#7a7a84'), 'chain', seed + 4, faces=('front', 'back', 'side'))
        for r in Fk.all():
            c.clear(r, 0, 4, r[2], r[3] - 4)
        for r in (Fk['front'], Fk['back']):
            c.area(r, 2, 0, 4, 5, tab)
            c.hl(r, 4, tab2, 2, 6)
        # hombreras, malla y guanteletes
        P(c, Fs, T.C('#7a7a84'), 'chain', seed + 5)
        for r in Fs.all():
            if r[3] >= 12:
                T.mat_fill(c, (r[0], r[1], r[2], 3), metal, 'metal', seed=seed)
                c.hl(r, 3, T.dark(metal, 0.6))
                T.mat_fill(c, (r[0], r[1] + 9, r[2], 3), T.dark(metal, 0.85), 'metal', seed=seed)
                c.hl(r, 9, T.light(metal, 1.25))
        P(c, Fs, metal, 'metal', seed + 5, faces=('up',))
        c.clear(Fs['down'])
        # grebas
        P(c, Fp, metal, 'metal', seed + 6)
        for r in Fp.all():
            if r[3] >= 12:
                c.clear(r, 0, 0, r[2], 4)
                c.hl(r, 4, T.light(metal, 1.3))
                c.hl(r, 6, T.dark(metal, 0.7))
        c.clear(Fp['up'])
        c.at(Fp['front'], 1, 6, T.light(metal, 1.4))
        c.at(Fp['front'], 2, 6, T.light(metal, 1.4))
    # ---------------- capa (nobles y algunos guardias) ----------------
    if sp['cape']:
        capec = T.dark(cloth2 if cls == 'alta' else sp['tab'][0], 0.8)
        if race == 'vampiro':
            capec = T.C('#141018')
        P(c, Fc, capec, 'cloth', seed + 7)
        inner = '#b01828' if race == 'vampiro' else T.dark(capec, 0.7)
        T.mat_fill(c, Fc['inner'], inner, 'cloth', seed=seed)
        r = Fc['back']
        if cls == 'alta':
            c.vl(r, 0, trim)
            c.vl(r, r[2] - 1, trim)
            c.hl(r, r[3] - 1, trim)
            c.hl(r, 0, T.C('#f0ece0') if race != 'vampiro' else T.C('#1a1a1a'))
        else:
            c.hl(r, r[3] - 1, T.dark(capec, 0.6))
        for i in range(r[2]):
            if (i + seed) % 3 == 0:
                c.vl(r, i, T.dark(capec, 0.85), 2, r[3] - 1)
    # pelo largo cayendo por la espalda
    if sp['style'] in ('long', 'braid', 'braids', 'mane') and not sp['cape']:
        hair = sp['hair']
        rows = 5 if sp['style'] != 'braid' else 8
        for i in range(1, 7):
            for j in range(0, rows - (1 if i in (1, 6) else 0)):
                c.at(jb, i, j, T.shade(hair, 0.95 if (i + j) % 3 else 0.85))
        if sp['style'] == 'braid':
            for j in range(0, 9):
                c.at(jb, 3, j, T.dark(hair, 0.7) if j % 2 else hair)
                c.at(jb, 4, j, hair if j % 2 else T.dark(hair, 0.7))
    if sp['style'] in ('braids', 'pigtails'):
        hair = sp['hair']
        for i in (1, 6):
            for j in range(0, 6):
                c.at(jf, i, j, T.dark(hair, 0.75) if j % 2 else hair)
        c.at(jf, 1, 6, '#e0b040' if race == 'enano' else '#ff80c0')
        c.at(jf, 6, 6, '#e0b040' if race == 'enano' else '#ff80c0')
    # escamas/pelaje en el pecho para razas animales sin ropa en el cuello
    if race == 'draconido' and cls in ('baja',):
        c.area(jf, 2, 0, 4, 2, T.mix(skin, '#f0d8a0', 0.5))


def paint_npc_extras(c, L, sp):
    skin, hair = sp['skin'], sp['hair']
    race = sp['race']
    smat = {'bestia': 'fur', 'draconido': 'scales'}.get(race, 'skin')
    # cuernos (curvos, con anillos)
    horn = sp['horn']
    for key in ('horn1', 'horn2'):
        F = L[key]
        P(c, F, horn, 'bone', sp['idx'])
        for r in F.sides():
            for j in range(0, r[3], 2):
                c.hl(r, j, T.dark(horn, 0.75))
        if key == 'horn2':
            c.tint(F['up'], 1.25)
    # orejas élficas y de bestia
    ear = skin if race not in ('bestia',) else hair
    for key in ('earE', 'earE2'):
        F = L[key]
        P(c, F, skin, 'skin', sp['idx'])
        for r in (F['right'], F['left']):
            c.at(r, 1, r[3] - 2, T.dark(skin, 0.75))
    F = L['earB']
    P(c, F, ear, 'fur', sp['idx'])
    for r in (F['front'],):
        c.area(r, 1, 1, 1, 2, T.mix(ear, '#f0b0b0', 0.55))
    c.tint(F['up'], 0.8)
    # cola
    tailc = hair if race == 'bestia' else skin
    P(c, L['tail1'], tailc, 'fur', sp['idx'])
    P(c, L['tail2'], tailc, 'fur', sp['idx'] + 1)
    F = L['tail2']
    for r in F.sides():
        c.area(r, 0, 0, min(2, r[2]), r[3], T.mix(tailc, '#ffffff', 0.55) if sp['v'] == 0 else T.dark(tailc, 0.6))
    c.fill(F['back'], T.mix(tailc, '#ffffff', 0.55) if sp['v'] == 0 else T.dark(tailc, 0.6), 0.04)
    # aureola (sin sombra: brilla)
    for key in ('haloX', 'haloZ'):
        F = L[key]
        for r in F.all():
            c.fill(r, '#ffe680', 0.04, glow=True)
            if r[2] >= 4:
                for i in range(0, r[2], 3):
                    c.at(r, i, 0, '#fffbe0', glow=True)
    # alas de hada (membrana con nervios y brillo)
    wc = T.mix(sp['hair'], '#e8f4ff', 0.55)
    for key in ('wing1', 'wing2'):
        r = L[key]['face']
        x, y, w, h = r
        cx, cy = (w - 1) / 2, (h - 1) / 2
        for i in range(w):
            for j in range(h):
                dx, dy = (i - cx) / (w / 2), (j - cy) / (h / 2)
                if dx * dx + dy * dy <= 1.05:
                    t = (dx * dx + dy * dy)
                    col = T.mix(wc, '#ffffff', 0.35 * (1 - t))
                    if abs(dx - dy * 0.5) < 0.12 or abs(dy) < 0.09:
                        col = T.dark(wc, 0.7)
                    c.at(r, i, j, col)
        for i in range(w):
            for j in range(h):
                if c.ga(r, i, j)[3] and any(not c.ga(r, i + a, j + b)[3] for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    c.at(r, i, j, T.dark(wc, 0.6))
        c.at(r, w // 3, h // 3, '#ffffff')


def paint_npc_mood(c, L, sp):
    skin = sp['skin']
    race = sp['race']
    lash = T.dark(skin, 0.42) if race not in ('demonio',) else '#120808'
    lid = T.shade(skin, 0.95)
    # párpados cerrados (dormido / parpadeo)
    r = L['lids']['face']
    c.clear(r)
    for ex in (1, 5):
        c.at(r, ex, 0, lid)
        c.at(r, ex + 1, 0, lid)
        c.at(r, ex, 1, lash)
        c.at(r, ex + 1, 1, lash)
    if race == 'hada':
        c.at(r, 1, 0, lid)
        c.at(r, 6, 0, lid)
    # cejas fruncidas (enfado)
    r = L['brows']['face']
    c.clear(r)
    bc = T.dark(sp['hair'], 0.5) if race != 'draconido' else T.dark(skin, 0.45)
    for (i, j) in ((0, 0), (1, 0), (2, 1), (7, 0), (6, 0), (5, 1)):
        c.at(r, i, j, bc)
    # boca feliz (mejillas sonrosadas + sonrisa)
    r = L['mouth_h']['face']
    c.clear(r)
    blush = T.mix(skin, '#ff5a7a', 0.45)
    c.at(r, 1, 0, blush)
    c.at(r, 6, 0, blush)
    mc = T.dark(skin, 0.45)
    c.at(r, 2, 1, mc)
    c.at(r, 5, 1, mc)
    c.at(r, 3, 2, mc)
    c.at(r, 4, 2, mc)
    c.at(r, 3, 1, '#f8f4f0')
    c.at(r, 4, 1, '#f8f4f0')
    # boca enfadada (rubor rojo + mueca)
    r = L['mouth_a']['face']
    c.clear(r)
    red = T.mix(skin, '#e01818', 0.5)
    for (i, j) in ((0, 0), (1, 0), (6, 0), (7, 0)):
        c.at(r, i, j, red)
    c.at(r, 3, 1, mc)
    c.at(r, 4, 1, mc)
    c.at(r, 2, 2, mc)
    c.at(r, 5, 2, mc)


def paint_npc_hats(c, L, sp):
    race = sp['race']
    metal = sp['metal']
    tab, tab2 = sp['tab']
    rng = random.Random(sp['idx'] * 3 + 11)
    # 1 sombrero de paja
    straw = T.C('#e0c070')
    P(c, L['straw_crown'], straw, 'straw', 1)
    T.band(c, L['straw_crown'], 2, 3, '#a03020')
    r = L['straw_brim']['face']
    x, y, w, h = r
    cx = cy = (w - 1) / 2
    for i in range(w):
        for j in range(h):
            d = max(abs(i - cx), abs(j - cy))
            rr = ((i - cx) ** 2 + (j - cy) ** 2) ** 0.5
            if rr > 7.1:
                c.at(r, i, j, None)
                continue
            f = 1.0 + (0.08 if (i + 2 * j) % 3 == 0 else 0) - (0.1 if rr > 6.2 else 0)
            col = T.shade(straw, f)
            if (i * 7 + j * 3) % 11 == 0 and rr > 6:
                c.at(r, i, j, None)
                continue
            c.at(r, i, j, col)
    # 2 capucha
    hood = T.C('#5a4a3a') if sp['cls'] in ('baja',) else T.dark(sp['cloth'], 0.7)
    if sp['race'] == 'vampiro':
        hood = T.C('#1a1418')
    F = L['hood']
    P(c, F, hood, 'rough', 2)
    fr = F['front']
    c.clear(fr, 1, 2, 6, 6)
    c.hl(fr, 1, T.dark(hood, 0.7), 1, 7)
    c.vl(fr, 0, T.dark(hood, 0.8), 2, 8)
    c.vl(fr, 7, T.dark(hood, 0.8), 2, 8)
    for r in (F['side'],):
        c.vl(r, 0, T.dark(hood, 0.75))
    P(c, L['hood_drape'], hood, 'rough', 3)
    # 3 boina noble con pluma
    capc = sp['cloth'] if sp['cls'] == 'alta' else T.C('#7a1830')
    F = L['cap']
    P(c, F, capc, 'cloth', 4)
    c.hl(F['side'], 1, sp['trim'])
    c.at(F['up'], 3, 3, sp['trim'])
    c.at(F['up'], 4, 4, sp['trim'])
    r = L['feather']['face']
    c.clear(r)
    fc = T.C('#f0f0f0') if race != 'vampiro' else T.C('#202020')
    for j in range(r[3]):
        for i in range(r[2]):
            if abs(i - (r[2] - 1) / 2 - (j - 3) * 0.15) <= (1.2 if 1 <= j <= 5 else 0.6):
                c.at(r, i, j, fc if (i + j) % 2 else T.shade(fc, 0.85))
        c.at(r, 1, j, T.dark(fc, 0.6))
    # 4 yelmo de guardia (color del metal de su cultura) con cimera
    F = L['helm']
    P(c, F, metal, 'metal', 5)
    fr = F['front']
    c.clear(fr, 1, 2, 6, 6)
    c.hl(fr, 1, T.dark(metal, 0.6), 0, 8)
    c.hl(fr, 0, T.light(metal, 1.3), 0, 8)
    c.vl(fr, 0, T.dark(metal, 0.8), 2, 6)
    c.vl(fr, 7, T.dark(metal, 0.8), 2, 6)
    for r in (F['side'], F['back']):
        c.clear(r, 0, 6, r[2], 2)
        c.hl(r, 5, T.dark(metal, 0.6))
        c.hl(r, 2, T.light(metal, 1.2))
    for i in (1, 6):
        c.at(F['back'], i, 3, T.light(metal, 1.4))
    P(c, L['helm_nose'], metal, 'metal', 6)
    P(c, L['helm_crest'], tab, 'fur', 7)
    c.tint(L['helm_crest']['up'], 1.15)
    # 5 corona de oro con gemas
    gold = T.C('#f0c030')
    for key in ('crown_x', 'crown_z'):
        F = L[key]
        P(c, F, gold, 'metal', 8)
        r = F['face']
        for i in range(r[2]):
            if i % 2:
                c.clear(r, i, 0, 1, 1)
        c.hl(r, r[3] - 1, T.dark(gold, 0.7))
        mid = r[2] // 2
        c.at(r, mid, 1, '#e02040' if key == 'crown_x' else '#3060ff')
        if r[2] > 5:
            c.at(r, 2, 1, '#20c060')
            c.at(r, r[2] - 3, 1, '#20c060')
    P(c, L['crown_gem'], T.C('#e02040'), 'crystal', 9)
    # 6 pañuelo (bandana) con lunares
    bc = T.C(['#c02020', '#2050a0', '#208040', '#a06010'][sp['idx'] % 4])
    F = L['bandana']
    P(c, F, bc, 'cloth', 10)
    for r in F.all():
        for i in range(r[2]):
            for j in range(r[3]):
                if (i + 2 * j) % 4 == 0 and (i + j) % 2 == 0:
                    c.at(r, i, j, '#f0f0e8')
    c.clear(F['front'], 0, 3, 8, 1)
    for r in (F['side'],):
        c.clear(r, 0, 3, 3, 1)
    P(c, L['bandana_knot'], T.dark(bc, 0.85), 'cloth', 11)
    r = L['bandana_tail']['face']
    c.clear(r)
    c.area(r, 0, 0, 3, 3, bc)
    c.at(r, 0, 3, bc)
    c.at(r, 2, 3, bc)
    # 7 gorro de cocinero
    F = L['chef_band']
    P(c, F, '#e8e8e8', 'cloth', 12)
    c.hl(F['band'], 0, '#ffffff')
    F = L['chef_puff']
    P(c, F, '#fafaf6', 'cloth', 13)
    for r in (F['ring'],):
        for i in range(0, r[2], 2):
            c.vl(r, i, '#e4e4de', 1, r[3])
    c.tint(F['up'], 1.0)


def paint_npc_tools(c, L, sp):
    steel = T.C('#c8ccd4')
    wood = T.C('#8a5a30')
    dwood = T.C('#5a3a1c')
    gold = T.C('#e0b030')
    # espada
    F = L['sword_blade']
    P(c, F, steel, 'metal', 1)
    for r in F.sides():
        c.vl(r, 0, T.light(steel, 1.25))
    c.tint(F['up'], 1.2)
    P(c, L['sword_guard'], gold, 'metal', 2)
    P(c, L['sword_grip'], T.C('#4a2a18'), 'leather', 3)
    for r in L['sword_grip'].sides():
        c.at(r, 0, 1, '#2a1a10')
    P(c, L['sword_pommel'], gold, 'metal', 4)
    # lanza
    P(c, L['spear_shaft'], wood, 'wood', 5)
    for r in L['spear_shaft'].sides():
        for j in range(12, 16):
            c.at(r, 0, j, '#4a2a18')
    F = L['spear_head']
    P(c, F, steel, 'metal', 6)
    for r in F.sides():
        if r[2] >= 3:
            c.clear(r, 0, 0, 1, 2)
            c.clear(r, r[2] - 1, 0, 1, 2)
            c.clear(r, 0, r[3] - 1, 1, 1)
            c.clear(r, r[2] - 1, r[3] - 1, 1, 1)
            c.vl(r, 1, T.light(steel, 1.3), 0, r[3])
        c.hl(r, r[3] - 1, T.dark(steel, 0.6))
    # banderín con los colores de la cultura
    r = L['spear_flag']['face']
    c.clear(r)
    tab, tab2 = sp['tab']
    for i in range(r[2]):
        for j in range(r[3]):
            if j <= r[3] - 1 - (i * 0.5 if i > 2 else 0) or i < 3:
                c.at(r, i, j, tab if j != 1 else tab2)
    c.clear(r, r[2] - 1, 1, 1, 2)
    # azada
    P(c, L['hoe_shaft'], wood, 'wood', 7)
    F = L['hoe_blade']
    P(c, F, T.C('#8a8a90'), 'metal', 8)
    for r in F.sides():
        c.hl(r, r[3] - 1, T.dark(T.C('#8a8a90'), 0.6))
    # martillo
    P(c, L['hammer_handle'], dwood, 'wood', 9)
    F = L['hammer_head']
    P(c, F, T.C('#6a6a74'), 'metal', 10)
    for r in F.sides():
        c.vl(r, 0, T.light(T.C('#6a6a74'), 1.3))
    # jarra de cerveza
    F = L['tank_body']
    P(c, F, T.C('#9a6a3a'), 'wood', 11)
    for r in F.sides():
        c.hl(r, 1, '#7a7a80')
        c.hl(r, 3, '#7a7a80')
    c.fill(F['up'], '#c08020', 0.05)
    F = L['tank_foam']
    P(c, F, T.C('#f8f4e8'), 'cloth', 12)
    for r in F.sides():
        for i in range(r[2]):
            if i % 2:
                c.at(r, i, 0, '#ffffff')
    P(c, L['tank_handle'], T.C('#7a5030'), 'wood', 13)
    # báculo con orbe
    P(c, L['staff_shaft'], T.C('#6a4a2a'), 'wood', 14)
    for r in L['staff_shaft'].sides():
        for j in range(0, r[3], 6):
            c.at(r, 0, j, gold)
    P(c, L['staff_cap'], gold, 'metal', 15)
    orb = T.C({'celestial': '#ffe880', 'demonio': '#ff5020', 'vampiro': '#e02040', 'elfo': '#60f0a0',
               'hada': '#ff90e0'}.get(sp['race'], '#80c8ff'))
    F = L['staff_orb']
    for r in F.all():
        c.fill(r, orb, 0.06, glow=True)
        c.at(r, 0, 0, '#ffffff', glow=True)
        c.at(r, r[2] - 1, r[3] - 1, T.dark(orb, 0.7), glow=True)
    # antorcha
    P(c, L['torch_stick'], wood, 'wood', 16)
    for r in L['torch_stick'].sides():
        c.at(r, 0, 0, '#3a2a1a')
        c.at(r, 0, 1, '#4a3a2a')
    F = L['torch_flame']
    for name, r in F.rects.items():
        for i in range(r[2]):
            for j in range(r[3]):
                t = j / max(1, r[3] - 1)
                col = T.mix('#fff4a0', '#ff6010', t) if name != 'down' else T.C('#ff6010')
                c.at(r, i, j, col, glow=True)
        if name == 'up':
            c.fill(r, '#fffbd0', 0, glow=True)
    # alerta
    for key in ('alert_bar', 'alert_dot'):
        F = L[key]
        for name, r in F.rects.items():
            c.fill(r, '#ff2414', 0.02, glow=True)
            if name not in ('up', 'down') and key == 'alert_bar':
                c.hl(r, 0, '#ff7a60', glow=True)
                c.hl(r, r[3] - 1, '#c00c00', glow=True)
        c.fill(F['up'], '#ff8a70', 0, glow=True)
        c.fill(F['down'], '#b00a00', 0, glow=True)


def paint_npc(model, idx):
    sp = npc_spec(idx)
    L = {k: model.faces(k) for k in model.order}
    c = T.Pix(model.tw, model.th, idx)
    paint_head(c, L['head'], sp)
    paint_hair(c, L['hair'], sp)
    paint_beard(c, L['beard'], sp)
    paint_npc_clothes(c, L, sp)
    paint_npc_extras(c, L, sp)
    paint_npc_mood(c, L, sp)
    paint_npc_hats(c, L, sp)
    paint_npc_tools(c, L, sp)
    for key in model.order:
        opt = model.light_opts.get(key, {})
        if opt is False:
            continue
        if key == 'head':
            F = L['head']
            c.light(F, skip=('front',))
            c.light_face(F['front'], 'front', 1.04, 0.92, 0)
            continue
        c.light(L[key], **opt)
    return c


# ======================================================================================
# Monstruos y jefes
# ======================================================================================
W = 'math.cos(q.modified_distance_moved * 38.17{ph}) * {a} * q.modified_move_speed'
ATK = 'math.sin(math.clamp(v.attack_time ?? 0, 0, 1) * 180)'
ATK2 = 'math.sin(math.clamp(v.attack_time ?? 0, 0, 1) * 360)'


def walk(a, ph=0, neg=False):
    s = W.format(a=a, ph=f' + {ph}' if ph else '')
    return ('-' + s) if neg else s


def breath(a, f=90, ph=0):
    return f'math.sin(q.life_time * {f}{" + " + str(ph) if ph else ""} + (v.phase ?? 0)) * {a}'


class Mob:
    def __init__(self, key, model, anims, egg, animate=None, scripts=None, material='entity_alphatest'):
        self.key = key
        self.model = model
        self.anims = anims          # nombre corto → cuerpo de la animación
        self.egg = egg
        self.animate = animate or list(anims)
        self.scripts = scripts or {}
        self.material = material


def fp(col, mat='cloth', seed=0):
    """Pintor: rellena toda la región con un material."""
    def f(c, F):
        T.mat_box(c, F, col, mat, seed=seed)
    return f


def front_i(F, name):
    """Columna de una cara lateral que toca la cara frontal."""
    return F[name][2] - 1 if name == 'right' else 0


def jag(c, r, seed, depth=2, rows_from_bottom=True, prob=0.6):
    rng = random.Random(seed)
    x, y, w, h = r
    for i in range(w):
        d = rng.choice([0] + [k for k in range(1, depth + 1)] * 2) if rng.random() < prob else 0
        if d:
            if rows_from_bottom:
                c.clear(r, i, h - d, 1, d)
            else:
                c.clear(r, i, 0, 1, d)


def glow_eyes(c, r, pts, col, core=None):
    for (i, j) in pts:
        c.at(r, i, j, col, glow=True)
    if core:
        for (i, j) in core:
            c.at(r, i, j, T.light(col, 1.6), glow=True)


def stripes(c, F, col, every=3, start=0, names=None):
    for name, r in F.rects.items():
        if names and name not in names:
            continue
        if F.kinds.get(name) in ('up', 'down'):
            continue
        for j in range(start, r[3], every):
            c.hl(r, j, col)


def rivets(c, r, col, step=3, row=1):
    for i in range(1, r[2] - 1, step):
        c.at(r, i, row, col)


def biped_anims(legs=('legR', 'legL'), arms=('armR', 'armL'), head='head', a_leg=40, a_arm=32, atk_arm='armR',
                atk_amp=100, both_attack=False, body=None, extra=None, look=True):
    bones = {}
    if legs:
        bones[legs[0]] = {'rotation': [walk(a_leg), 0, 0]}
        bones[legs[1]] = {'rotation': [walk(a_leg, neg=True), 0, 0]}
    an = {'move': {'loop': True, 'bones': bones}}
    if arms:
        bones[arms[0]] = {'rotation': [walk(a_arm, neg=True), 0, 0]}
        bones[arms[1]] = {'rotation': [walk(a_arm), 0, 0]}
    idle = {}
    if arms:
        idle[arms[0]] = {'rotation': [breath(2, 70), 0, breath(2.5, 90) + ' + 2.5']}
        idle[arms[1]] = {'rotation': [breath(-2, 70), 0, '-(' + breath(2.5, 90) + ') - 2.5']}
    if body:
        idle[body] = {'position': [0, breath(0.25, 90), 0]}
    an['idle'] = {'loop': True, 'bones': idle}
    if atk_arm:
        atk = {atk_arm: {'rotation': [f'-{ATK} * {atk_amp}', f'{ATK} * 12', 0]}}
        if both_attack and arms:
            atk[arms[1]] = {'rotation': [f'-{ATK} * {atk_amp}', f'-{ATK} * 12', 0]}
        if body:
            atk.setdefault(body, {})['rotation'] = [f'{ATK} * 8', f'{ATK} * -10', 0]
        an['attack'] = {'loop': True, 'bones': atk}
    if look and head:
        an['look'] = {'loop': True, 'bones': {head: {'rotation': ['math.clamp(q.target_x_rotation, -40, 40)', 'math.clamp(q.target_y_rotation, -60, 60)', 0]}}}
    if extra:
        for k, v in extra.items():
            an[k] = v
    return an


# --------------------------------------------------------------------------------------
# Goblin
# --------------------------------------------------------------------------------------
def mob_goblin(king=False):
    key = 'goblin_king' if king else 'goblin'
    m = Model(f'geometry.rpg.{key}', 64, 64, bw=3 if not king else 4, bh=3)
    skin = T.C('#5d9a3a') if not king else T.C('#4f8a30')
    sdk = T.dark(skin, 0.7)
    rng = random.Random(7 if not king else 9)
    k = 1.0 if not king else 1.0
    m.bone('root')
    # piernas cortas y pies grandes
    lw = 3 if not king else 4
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (2 * sx if not king else 2.6 * sx, 10 if not king else 9, 0))
        x0 = (-3.5 if sx < 0 else 0.5) if not king else (-4.6 if sx < 0 else 0.6)
        m.box(b, 'g_leg', (x0, 2, -1.5 if not king else -2), (lw, 8 if not king else 7, lw), mirror=sx > 0)
        m.box(b, 'g_foot', (x0, 0, -3 if not king else -3.5), (lw, 2, 5 if not king else 6), mirror=sx > 0)
    if not king:
        m.bone('loin', 'root', (0, 10, 0))
        m.box('loin', 'g_belt', (-4, 9, -2.5), (8, 2, 5))
        m.plane('loin', 'g_loin', (-2.5, 4, -2.7), (5, 5, 0), face='north')
        m.plane('loin', 'g_loinb', (-2.5, 5, 2.7), (5, 4, 0), face='south')
        m.bone('body', 'root', (0, 10, 0), rot=(20, 0, 0))
        m.box('body', 'g_torso', (-3.5, 10, -2), (7, 8, 4))
        hp = (0, 18, -1)
        m.bone('head', 'body', hp, rot=(-15, 0, 0))
        m.box('head', 'g_head', (-4, 17.5, -4.5), (8, 7, 7))
        m.bone('nose', 'head', (0, 20, -4.5), rot=(30, 0, 0))
        m.box('nose', 'g_nose', (-1, 19, -8), (2, 2, 4))
        for side, sx in (('R', -1), ('L', 1)):
            b = m.bone(f'ear{side}', 'head', (4 * sx, 21.5, -1), rot=(0, -15 * sx, -22 * sx))
            m.box(b, 'g_ear', (-10 if sx < 0 else 4, 20, -1.5), (6, 3, 1), mirror=sx > 0)
            b = m.bone(f'arm{side}', 'body', (4.5 * sx, 17, 0))
            m.box(b, 'g_arm', (-6 if sx < 0 else 4, 8, -1), (2, 9, 2), mirror=sx > 0)
            m.box(b, 'g_hand', (-6.5 if sx < 0 else 3.5, 6, -1.5), (3, 2, 3), mirror=sx > 0)
        m.bone('dagger', 'armR', (-5, 7, 0), rot=(70, 0, 0))
        m.box('dagger', 'g_blade', (-5.5, 8.5, -1), (1, 5, 2))
        m.box('dagger', 'g_guard', (-5.5, 8, -2), (1, 1, 4))
        m.box('dagger', 'g_grip', (-5.5, 6, -0.5), (1, 2, 1))
    else:
        m.bone('body', 'root', (0, 9, 0), rot=(10, 0, 0))
        m.box('body', 'g_torso', (-5.5, 8.5, -4.5), (11, 10, 8))
        m.box('body', 'g_robe', (-6, 4, -5), (12, 6, 9), inflate=0.2,
              faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side'})
        m.box('body', 'g_collar', (-6, 17.5, -5), (12, 3, 9), inflate=0.3)
        m.bone('cape', 'body', (0, 19, 3.6), rot=(8, 0, 0))
        m.box('cape', 'g_cape', (-6, 2, 3.6), (12, 17, 1), faces={'south': 'back', 'north': 'inner', 'east': 'edge', 'west': 'edge'})
        m.bone('head', 'body', (0, 19.5, -1), rot=(-10, 0, 0))
        m.box('head', 'g_head', (-4.5, 19, -6), (9, 8, 8))
        m.bone('nose', 'head', (0, 22, -6), rot=(30, 0, 0))
        m.box('nose', 'g_nose', (-1, 21, -10.5), (2, 2, 5))
        for side, sx in (('R', -1), ('L', 1)):
            b = m.bone(f'ear{side}', 'head', (4.5 * sx, 24, -2), rot=(0, -15 * sx, -18 * sx))
            m.box(b, 'g_ear', (-12 if sx < 0 else 4.5, 22.5, -2.5), (8, 4, 1), mirror=sx > 0)
            b = m.bone(f'arm{side}', 'body', (6.5 * sx, 17, 0))
            m.box(b, 'g_arm', (-9 if sx < 0 else 6, 7, -1.5), (3, 11, 3), mirror=sx > 0)
            m.box(b, 'g_hand', (-9.5 if sx < 0 else 5.5, 4.5, -2), (4, 3, 4), mirror=sx > 0)
        b = m.bone('crown', 'head', (0, 27, 0))
        for z in (-6.4, 1.2):
            m.box(b, 'gk_crown_x', (-5, 27, z), (10, 3, 1), faces={'north': 'face', 'south': 'face', 'up': 'top', 'east': 'end', 'west': 'end'})
        for x in (-5, 4):
            m.box(b, 'gk_crown_z', (x, 27, -5.4), (1, 3, 7), faces={'east': 'face', 'west': 'face', 'up': 'top'})
        m.bone('club', 'armR', (-7.5, 6, 0), rot=(60, 0, 0))
        m.box('club', 'gk_shaft', (-8.5, -1, -1), (2, 14, 2))
        m.box('club', 'gk_clubhead', (-9.5, 11, -2), (4, 8, 4))
        for (dx, dy, dz) in ((-10, 13, -0.5), (-6, 15, -0.5), (-8, 17, -2.6), (-8, 14, 1.6), (-8, 19, -0.5)):
            m.box('club', 'gk_stud', (dx, dy, dz), (1, 1, 1))

    # ---------------- pintura ----------------
    def legp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=1)
        T.band(c, F, 1, 3, '#6a4a2a', 'leather')
        stripes(c, F, T.dark('#6a4a2a', 0.7), 2, 1)
    m.painters['g_leg'] = legp

    def footp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=2)
        r = F['front']
        for i in range(0, r[2], 2 if r[2] < 4 else 1):
            c.at(r, i, r[3] - 1, '#2a2a20')
        c.hl(F['up'], 0, sdk) if F['up'][3] else None
    m.painters['g_foot'] = footp

    def headp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=3)
        fr = F['front']
        w, h = fr[2], fr[3]
        c.hl(fr, 1, sdk, 0, w)
        ey = 2 if not king else 3
        for ex in (1, w - 3):
            c.at(fr, ex, ey, '#ffe030', glow=True)
            c.at(fr, ex + 1, ey, '#ff2010', glow=True)
            c.at(fr, ex, ey + 1, T.dark(skin, 0.55))
            c.at(fr, ex + 1, ey + 1, T.dark(skin, 0.55))
        my = h - 2
        c.hl(fr, my, '#2a0a08', 1, w - 1)
        for i in range(1, w - 1, 2):
            c.at(fr, i, my, '#f0e8c8')
        c.at(fr, 1, my - 1, '#2a0a08')
        c.at(fr, w - 2, my - 1, '#2a0a08')
        for _ in range(5):  # verrugas
            r = rng.choice(F.all())
            c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), T.dark(skin, 0.75))
        up = F['up']
        for i in range(0, up[2], 2):
            c.at(up, i, rng.randrange(up[3]), '#1a1a10')
        c.tint(F['down'], 0.8)
    m.painters['g_head'] = headp

    def nosep(c, F):
        T.mat_box(c, F, skin, 'skin', seed=4)
        c.tint(F['front'], 0.8)
        c.at(F['up'], 0, 1, T.dark(skin, 0.6))
    m.painters['g_nose'] = nosep

    def earp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=5)
        for name in ('front', 'up', 'down'):
            r = F[name]
            c.clear(r, 0, 0, 1, 1)
            c.clear(r, 0, r[3] - 1, 1, 1)
        r = F['back']
        c.clear(r, r[2] - 1, 0, 1, 1)
        c.clear(r, r[2] - 1, r[3] - 1, 1, 1)
        c.clear(F['right'], 0, 0, 1, 1)
        c.clear(F['right'], 0, F['right'][3] - 1, 1, 1)
        fr = F['front']
        c.hl(fr, fr[3] // 2, T.mix(skin, '#e08080', 0.45), 2, fr[2] - 1)
    m.painters['g_ear'] = earp

    def torsop(c, F):
        if not king:
            T.mat_box(c, F, skin, 'skin', seed=6)
            fr = F['front']
            for j in range(fr[3]):
                c.at(fr, min(fr[2] - 1, j), j, '#5a3a1a')
                c.at(fr, min(fr[2] - 1, j + 1), j, '#7a5a30')
            c.at(fr, 2, 2, '#e8e0c8')  # colgante de hueso
            c.at(fr, 2, 3, '#e8e0c8')
            c.hl(fr, fr[3] - 2, T.dark(skin, 0.8), 1, fr[2] - 1)
            bk = F['back']
            for j in range(bk[3]):
                c.at(bk, bk[2] - 1 - min(bk[2] - 1, j), j, '#5a3a1a')
        else:
            T.mat_box(c, F, T.C('#a01818'), 'cloth', seed=6)
            fr = F['front']
            c.area(fr, 2, 2, 7, 6, T.mix(skin, '#ffffff', 0.08))
            c.hl(fr, 7, '#e8b830', 1, 10)
            c.area(fr, 4, 7, 3, 2, '#ffd040')
            c.at(fr, 5, 4, T.dark(skin, 0.6))  # ombligo
            for j in range(2, 8):
                c.at(fr, 1, j, '#e8c040')
                c.at(fr, 9, j, '#e8c040')
    m.painters['g_torso'] = torsop

    def armp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=7)
        T.band(c, F, F.size[1] - 3, F.size[1] - 1, '#6a4a2a', 'leather')
        if king:
            T.band(c, F, 0, 4, '#a01818', 'cloth')
            T.band(c, F, 4, 5, '#e8c040')
    m.painters['g_arm'] = armp

    def handp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=8)
        for r in F.sides():
            c.hl(r, r[3] - 1, T.dark(skin, 0.6))
        r = F['down']
        for i in range(0, r[2], 2):
            c.at(r, i, 0, '#2a2a20')
        if king:
            c.at(F['front'], 1, 0, '#ffd040')
    m.painters['g_hand'] = handp
    if not king:
        m.painters['g_belt'] = lambda c, F: (T.mat_box(c, F, T.C('#5a3a1a'), 'leather', seed=9), c.area(F['front'], 3, 0, 2, 2, '#e8e0c8'))

        def loinp(c, F):
            r = F['face']
            T.mat_fill(c, r, '#7a5a30', 'rough', seed=10)
            jag(c, r, 11, 2)
            c.hl(r, 0, '#5a3a1a')
        m.painters['g_loin'] = loinp
        m.painters['g_loinb'] = loinp
        m.painters['g_blade'] = lambda c, F: (T.mat_box(c, F, T.C('#9a9088'), 'metal', seed=12), [c.at(r, 0, 1, '#8a4a2a') for r in F.sides()])
        m.painters['g_guard'] = fp(T.C('#c8c0a8'), 'bone', 13)
        m.painters['g_grip'] = fp(T.C('#4a2a10'), 'leather', 14)
    else:
        def robep(c, F):
            T.mat_box(c, F, T.C('#a01818'), 'cloth', seed=20)
            for r in F.all():
                c.hl(r, r[3] - 1, '#e8c040')
                c.hl(r, 0, T.C('#6a0a0a'))
        m.painters['g_robe'] = robep

        def collarp(c, F):
            for r in F.all():
                c.fill(r, '#f4f0e8', 0.03)
                for i in range(0, r[2], 3):
                    for j in range(r[3]):
                        if (i + j * 2) % 5 == 0:
                            c.at(r, i, j, '#151515')
        m.painters['g_collar'] = collarp

        def capep(c, F):
            T.mat_box(c, F, T.C('#8a1010'), 'cloth', seed=21)
            r = F['back']
            c.vl(r, 0, '#e8c040')
            c.vl(r, r[2] - 1, '#e8c040')
            c.hl(r, r[3] - 1, '#e8c040')
            T.mat_fill(c, F['inner'], '#4a0808', 'cloth', seed=22)
            for i in range(2, r[2] - 2, 3):
                c.at(r, i, 3, '#e8c040')
                c.at(r, i + 1, 9, '#e8c040')
        m.painters['g_cape'] = capep

        def crownp(c, F):
            gold = T.C('#f0c030')
            T.mat_box(c, F, gold, 'metal', seed=23)
            r = F['face']
            for i in range(r[2]):
                if i % 2:
                    c.clear(r, i, 0, 1, 1)
            c.at(r, r[2] // 2, 1, '#e02040')
            if r[2] > 6:
                c.at(r, 2, 1, '#3060ff')
                c.at(r, r[2] - 3, 1, '#3060ff')
            c.hl(r, r[3] - 1, T.dark(gold, 0.7))
        m.painters['gk_crown_x'] = crownp
        m.painters['gk_crown_z'] = crownp
        m.painters['gk_shaft'] = fp(T.C('#6a4020'), 'wood', 24)

        def clubp(c, F):
            T.mat_box(c, F, T.C('#7a4a20'), 'wood', seed=25)
            for r in F.sides():
                c.hl(r, 1, '#5a5a62')
                c.hl(r, r[3] - 2, '#5a5a62')
                c.at(r, 1, 4, '#e8e0c8')
        m.painters['gk_clubhead'] = clubp
        m.painters['gk_stud'] = fp(T.C('#8a8a92'), 'metal', 26)
    extra = {}
    for side in ('R', 'L'):
        extra[f'ear{side}'] = {'rotation': [0, 0, f'math.sin(q.life_time * 400 + (v.phase ?? 0)) * (math.mod(q.life_time + (v.phase ?? 0), 3) < 0.3 ? 8 : 0)']}
    an = biped_anims(a_leg=45, a_arm=40, atk_amp=110, body='body')
    an['ears'] = {'loop': True, 'bones': extra}
    egg = ('#5d9a3a', '#6b4a2a') if not king else ('#5d9a3a', '#e8b830')
    return Mob(key, m, an, egg)


# --------------------------------------------------------------------------------------
# Orco salvaje
# --------------------------------------------------------------------------------------
def mob_orc():
    m = Model('geometry.rpg.orc', 64, 64, bw=3, bh=3.2)
    skin = T.C('#4a7a3a')
    paint = T.C('#a02020')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (2.6 * sx, 11, 0))
        m.box(b, 'o_leg', (-4.6 if sx < 0 else 0.6, 0, -2), (4, 11, 4), mirror=sx > 0)
    m.bone('waist', 'root', (0, 11, 0))
    m.box('waist', 'o_belt', (-5, 10, -3), (10, 3, 6), inflate=0.3)
    m.plane('waist', 'o_loin', (-3, 4, -3.5), (6, 6, 0), face='north')
    m.plane('waist', 'o_loinb', (-3, 5, 3.5), (6, 5, 0), face='south')
    m.bone('body', 'root', (0, 11, 0), rot=(8, 0, 0))
    m.box('body', 'o_torso', (-5, 11, -3), (10, 11, 6))
    m.bone('head', 'body', (0, 22, -1.5), rot=(-8, 0, 0))
    m.box('head', 'o_head', (-4, 21.5, -5.5), (8, 8, 7))
    m.box('head', 'o_jaw', (-3, 20.5, -6.4), (6, 3, 3))
    m.box('head', 'o_tusk', (-2.6, 22.5, -6.9), (1, 2, 1))
    m.box('head', 'o_tusk', (1.6, 22.5, -6.9), (1, 2, 1), mirror=True)
    m.box('head', 'o_knot', (-1, 29.5, -1), (2, 3, 2))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (6.5 * sx, 20.5, 0))
        m.box(b, 'o_arm', (-9.5 if sx < 0 else 5.5, 9, -2), (4, 13, 4), mirror=sx > 0)
        m.box(b, 'o_pad', (-10.5 if sx < 0 else 4.5, 19.5, -3), (6, 3, 6), mirror=sx > 0)
        for dz in (-1.5, 1):
            m.box(b, 'o_spike', (-8.5 if sx < 0 else 7.5, 22.5, dz - 0.5), (1, 2, 1))
    m.bone('axe', 'armR', (-7.5, 10, 0), rot=(70, 0, 0))
    m.box('axe', 'o_haft', (-8, 4, -0.5), (1, 15, 1))
    m.box('axe', 'o_blade', (-8, 14, -5.5), (1, 6, 5))
    m.box('axe', 'o_haft_tip', (-8, 19, -0.5), (1, 2, 1))

    def legp(c, F):
        T.mat_box(c, F, T.C('#4a3424'), 'leather', seed=1)
        T.band(c, F, 7, 11, '#8a6a48', 'fur')
        for r in F.sides():
            c.hl(r, 7, '#b09068')
        c.fill(F['down'], '#3a2a1a', 0.05)
    m.painters['o_leg'] = legp

    def beltp(c, F):
        T.mat_box(c, F, T.C('#3a2414'), 'leather', seed=2)
        fr = F['front']
        c.area(fr, 3, 0, 4, 3, '#e8e0c8')
        c.at(fr, 4, 1, '#1a1a1a')
        c.at(fr, 5, 1, '#1a1a1a')
    m.painters['o_belt'] = beltp

    def loinp(c, F):
        r = F['face']
        T.mat_fill(c, r, '#7a5a3a', 'leather', seed=3)
        c.hl(r, r[3] - 1, '#a08060')
        jag(c, r, 4, 1)
        c.at(r, 2, 1, T.C('#5a3a20'))
    m.painters['o_loin'] = loinp
    m.painters['o_loinb'] = loinp

    def torsop(c, F):
        T.mat_box(c, F, skin, 'skin', seed=5)
        fr = F['front']
        w, h = fr[2], fr[3]
        strap = T.C('#3a2414')
        for j in range(h):
            i1 = int(j * (w - 1) / (h - 1))
            c.at(fr, i1, j, strap)
            c.at(fr, w - 1 - i1, j, strap)
        c.area(fr, w // 2 - 1, h // 2 - 1, 2, 2, '#8a8a92')
        c.hl(fr, 3, T.dark(skin, 0.8), 1, w - 1)
        for j in (6, 8):  # cicatrices
            c.at(fr, 2, j, T.mix(skin, '#e0c0a0', 0.5))
            c.at(fr, 3, j + 1, T.mix(skin, '#e0c0a0', 0.5))
        bk = F['back']
        for j in range(h):
            i1 = int(j * (w - 1) / (h - 1))
            c.at(bk, i1, j, strap)
            c.at(bk, w - 1 - i1, j, strap)
    m.painters['o_torso'] = torsop

    def headp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=6)
        fr = F['front']
        c.hl(fr, 2, T.dark(skin, 0.55))
        c.hl(fr, 3, paint, 0, 8)
        c.at(fr, 2, 3, '#ff3018', glow=True)
        c.at(fr, 5, 3, '#ff3018', glow=True)
        c.at(fr, 1, 3, '#1a0a08')
        c.at(fr, 6, 3, '#1a0a08')
        c.at(fr, 3, 5, T.dark(skin, 0.55))
        c.at(fr, 4, 5, T.dark(skin, 0.55))
        c.vl(fr, 1, paint, 4, 7)
        c.vl(fr, 6, paint, 4, 7)
        up = F['up']
        for i in range(up[2]):
            for j in range(up[3]):
                if (i * 3 + j * 5) % 7 == 0:
                    c.at(up, i, j, '#203018')
        for r in (F['right'], F['left']):
            c.at(r, 3, 3, T.dark(skin, 0.7))
            c.at(r, 3, 4, T.dark(skin, 0.7))
            c.at(r, 2, 2, '#c0a040')  # pendiente
    m.painters['o_head'] = headp

    def jawp(c, F):
        T.mat_box(c, F, T.dark(skin, 0.92), 'skin', seed=7)
        c.hl(F['front'], 0, '#2a0a08', 1, 5)
    m.painters['o_jaw'] = jawp
    m.painters['o_tusk'] = lambda c, F: (T.mat_box(c, F, T.C('#f0ead0'), 'bone', seed=8), c.tint(F['up'], 1.1))
    m.painters['o_knot'] = fp(T.C('#1a1a1a'), 'fur', 9)

    def armp(c, F):
        T.mat_box(c, F, skin, 'skin', seed=10)
        T.band(c, F, 6, 10, '#3a2414', 'leather')
        for r in F.sides():
            c.hl(r, 7, '#6a6a72')
            c.at(r, 1, 3, paint)
            c.at(r, 2, 4, paint)
        for r in F.sides():
            c.hl(r, r[3] - 1, T.dark(skin, 0.6))
    m.painters['o_arm'] = armp

    def padp(c, F):
        T.mat_box(c, F, T.C('#6a6a72'), 'metal', seed=11)
        for r in F.sides():
            rivets(c, r, '#3a3a40', 2, 1)
            c.at(r, 2, 2, '#8a5a3a')
        c.at(F['up'], 1, 1, '#8a5a3a')
    m.painters['o_pad'] = padp
    m.painters['o_spike'] = lambda c, F: (T.mat_box(c, F, T.C('#d8d0b8'), 'bone', seed=12), c.tint(F['up'], 1.15))
    m.painters['o_haft'] = lambda c, F: (T.mat_box(c, F, T.C('#5a3a1a'), 'wood', seed=13), [c.hl(r, 2, '#2a1a0a') for r in F.sides()])
    m.painters['o_haft_tip'] = fp(T.C('#6a6a72'), 'metal', 14)

    def bladep(c, F):
        T.mat_box(c, F, T.C('#7a7a84'), 'metal', seed=15)
        for name in ('right', 'left'):
            r = F[name]
            fi = front_i(F, name)
            c.vl(r, fi, T.C('#d8dce4'))
            back = r[2] - 1 - fi
            c.clear(r, back, 0, 1, 1)
            c.clear(r, back, r[3] - 1, 1, 1)
            c.at(r, (fi + back) // 2, r[3] // 2, '#8a4a2a')
        for name in ('up', 'down'):
            c.tint(F[name], 0.9)
    m.painters['o_blade'] = bladep
    an = biped_anims(a_leg=38, a_arm=30, atk_amp=120, body='body')
    an['attack']['bones']['armL'] = {'rotation': [f'-{ATK} * 30', 0, f'-{ATK} * 15']}
    return Mob('orc', m, an, ('#4a7a3a', '#6a6a72'))


# --------------------------------------------------------------------------------------
# Caballero esqueleto
# --------------------------------------------------------------------------------------
def mob_skeleton_knight():
    m = Model('geometry.rpg.skeleton_knight', 64, 64, bw=3, bh=3.2)
    bone_c = T.C('#d8d4c0')
    steel = T.C('#6a6a74')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (2 * sx, 12, 0))
        x0 = -3 if sx < 0 else 1
        m.box(b, 'sk_legbone', (x0, 1, -1), (2, 11, 2), mirror=sx > 0)
        m.box(b, 'sk_greave', (x0 - 0.5, 2, -1.5), (3, 5, 3), mirror=sx > 0)
        m.box(b, 'sk_boot', (x0 - 0.5, 0, -2.5), (3, 2, 4), mirror=sx > 0)
    m.box('root', 'sk_pelvis', (-3, 11, -1.5), (6, 2, 3))
    m.bone('body', 'root', (0, 12, 0))
    m.box('body', 'sk_spine', (-1, 12, -0.5), (2, 10, 2))
    m.box('body', 'sk_ribs', (-3.5, 15, -2), (7, 6, 4))
    m.box('body', 'sk_plate', (-4, 18.5, -2.5), (8, 4, 5))
    m.plane('body', 'sk_tabard', (-2.5, 6, -2.7), (5, 12, 0), face='north')
    m.bone('head', 'body', (0, 22.5, 0))
    m.box('head', 'sk_skull', (-3.5, 22.5, -3.5), (7, 7, 7))
    m.box('head', 'sk_helm', (-4, 26, -4), (8, 4, 8), inflate=0.25,
          faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'})
    m.box('head', 'sk_plume', (-0.5, 30.2, -3), (1, 3, 7))
    m.bone('jaw', 'head', (0, 23, 2))
    m.box('jaw', 'sk_jaw', (-2.5, 21, -3.8), (5, 2, 5))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (5 * sx, 21.5, 0))
        m.box(b, 'sk_arm', (-6 if sx < 0 else 4, 10, -1), (2, 12, 2), mirror=sx > 0)
        m.box(b, 'sk_pad', (-7 if sx < 0 else 3, 19.5, -2), (4, 3, 4), mirror=sx > 0)
    m.bone('sword', 'armR', (-5, 10.5, 0), rot=(80, 0, 0))
    m.box('sword', 'sk_blade', (-5.5, 12, -1), (1, 13, 2))
    m.box('sword', 'sk_guard', (-5.5, 11, -2.5), (1, 1, 5))
    m.box('sword', 'sk_grip', (-5.5, 8, -0.5), (1, 3, 1))
    m.bone('shield', 'armL', (6, 15, 0))
    m.box('shield', 'sk_shield', (6.1, 7, -4), (1, 10, 8))

    def bonep(c, F):
        T.mat_box(c, F, bone_c, 'bone', seed=1)
        for r in F.sides():
            if r[3] >= 6:
                c.hl(r, r[3] // 2, T.dark(bone_c, 0.7))
            c.hl(r, 0, T.light(bone_c, 1.08))
    for k in ('sk_legbone', 'sk_arm', 'sk_spine', 'sk_pelvis'):
        m.painters[k] = bonep

    def ribsp(c, F):
        T.mat_box(c, F, bone_c, 'bone', seed=2)
        for name in ('front', 'back', 'right', 'left'):
            r = F[name]
            for j in range(r[3]):
                if j % 2 == 1:
                    c.clear(r, 0, j, r[2], 1)
            if name in ('front', 'back'):
                c.vl(r, r[2] // 2, T.dark(bone_c, 0.85))
        c.clear(F['up'])
        c.clear(F['down'])
    m.painters['sk_ribs'] = ribsp

    def metalp(c, F, rust_seed=3):
        T.mat_box(c, F, steel, 'metal', seed=rust_seed)
        rng = random.Random(rust_seed)
        for r in F.all():
            for _ in range(max(1, r[2] * r[3] // 10)):
                c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), rng.choice(['#8a5a3a', '#6a4a30', '#7a6a5a']))
    m.painters['sk_greave'] = lambda c, F: metalp(c, F, 4)
    m.painters['sk_boot'] = lambda c, F: metalp(c, F, 5)
    m.painters['sk_pad'] = lambda c, F: (metalp(c, F, 6), [rivets(c, r, '#3a3a40', 2, 1) for r in F.sides()])

    def platep(c, F):
        metalp(c, F, 7)
        fr = F['front']
        c.hl(fr, 0, T.light(steel, 1.3))
        c.vl(fr, fr[2] // 2, T.dark(steel, 0.7))
        c.at(fr, 2, 2, '#8a1a1a')
    m.painters['sk_plate'] = platep

    def tabardp(c, F):
        r = F['face']
        T.mat_fill(c, r, '#6a1414', 'rough', seed=8)
        c.vl(r, 0, '#4a0a0a')
        c.vl(r, r[2] - 1, '#4a0a0a')
        for (i, j) in ((2, 2), (1, 3), (2, 3), (3, 3), (2, 4), (2, 5)):
            c.at(r, i, j, '#b09040')
        jag(c, r, 9, 3, prob=0.8)
        for _ in range(3):
            c.clear(r, random.Random(_ + 3).randrange(r[2]), 6 + _, 1, 1)
    m.painters['sk_tabard'] = tabardp

    def skullp(c, F):
        T.mat_box(c, F, bone_c, 'bone', seed=10)
        fr = F['front']
        c.area(fr, 1, 3, 2, 2, '#141010')
        c.area(fr, 4, 3, 2, 2, '#141010')
        c.at(fr, 1, 3, '#ff3010', glow=True)
        c.at(fr, 5, 3, '#ff3010', glow=True)
        c.at(fr, 3, 5, '#2a2020')
        c.hl(fr, 6, '#2a2020', 1, 6)
        for i in range(1, 6, 2):
            c.at(fr, i, 6, bone_c)
        for r in (F['right'], F['left']):
            c.at(r, 3, 4, T.dark(bone_c, 0.6))
            c.at(r, 2, 5, T.dark(bone_c, 0.6))
    m.painters['sk_skull'] = skullp

    def jawp(c, F):
        T.mat_box(c, F, T.dark(bone_c, 0.92), 'bone', seed=11)
        for i in range(0, F['front'][2], 2):
            c.at(F['front'], i, 0, '#f0ecd8')
    m.painters['sk_jaw'] = jawp

    def helmp(c, F):
        metalp(c, F, 12)
        fr = F['front']
        c.clear(fr, 1, 2, 6, 2)
        c.hl(fr, 1, T.dark(steel, 0.6))
        c.at(fr, 3, 2, steel)
        c.at(fr, 4, 2, steel)
        c.at(fr, 3, 3, steel)
        c.at(fr, 4, 3, steel)
        for r in (F['side'], F['back']):
            c.hl(r, r[3] - 1, T.dark(steel, 0.6))
            rivets(c, r, '#3a3a40', 3, 2)
    m.painters['sk_helm'] = helmp
    m.painters['sk_plume'] = lambda c, F: (T.mat_box(c, F, T.C('#7a1010'), 'fur', seed=13), jag(c, F['right'], 14, 1, False), jag(c, F['left'], 15, 1, False))

    def bladep(c, F):
        T.mat_box(c, F, T.C('#a8acb4'), 'metal', seed=16)
        for r in F.sides():
            c.vl(r, 0, T.C('#d8dce4'))
            for j in range(2, r[3], 4):
                c.at(r, r[2] - 1, j, '#7a4a2a')
        c.tint(F['up'], 1.2)
    m.painters['sk_blade'] = bladep
    m.painters['sk_guard'] = fp(T.C('#5a4a3a'), 'metal', 17)
    m.painters['sk_grip'] = fp(T.C('#3a2418'), 'leather', 18)

    def shieldp(c, F):
        T.mat_box(c, F, T.C('#6a4a2a'), 'wood', seed=19)
        for name in ('right', 'left'):
            r = F[name]
            c.area(r, 1, 1, r[2] - 2, r[3] - 2, '#5a1010')
            c.area(r, r[2] // 2, 1, (r[2] - 2) // 2, r[3] - 2, '#1a1a1a')
            c.vl(r, 0, '#5a5a62')
            c.vl(r, r[2] - 1, '#5a5a62')
            c.hl(r, 0, '#5a5a62')
            c.hl(r, r[3] - 1, '#5a5a62')
            cx, cy = r[2] // 2 - 1, r[3] // 2 - 1
            for (i, j) in ((0, 0), (1, 0), (0, 1), (1, 1)):
                c.at(r, cx + i, cy + j, '#c8c4b0')
            c.at(r, cx, cy, '#141010')
            c.at(r, cx + 1, cy, '#141010')
            c.at(r, 2, 2, '#8a5a3a')
    m.painters['sk_shield'] = shieldp
    an = biped_anims(a_leg=36, a_arm=28, atk_amp=105, body='body')
    an['attack']['bones']['jaw'] = {'rotation': [f'{ATK} * 25', 0, 0]}
    an['idle']['bones']['jaw'] = {'rotation': [f'math.max(0, math.sin(q.life_time * 200 + (v.phase ?? 0))) * 6', 0, 0]}
    an['idle']['bones']['armL'] = {'rotation': [-20, 0, 0]}
    return Mob('skeleton_knight', m, an, ('#d8d8c8', '#5a5a62'))


# --------------------------------------------------------------------------------------
# Espectro (sin piernas, flota)
# --------------------------------------------------------------------------------------
def mob_wraith():
    m = Model('geometry.rpg.wraith', 64, 64, bw=3, bh=3.2)
    robe = T.C('#1c1a28')
    m.bone('root')
    m.bone('float', 'root', (0, 0, 0))
    m.bone('robe', 'float', (0, 14, 0))
    m.box('robe', 'w_robe', (-4.5, 3, -3), (9, 11, 6), faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side'})
    m.box('robe', 'w_tail', (-3, 0.5, -2), (6, 3, 4), faces={'north': 'ns', 'south': 'ns', 'east': 'side', 'west': 'side', 'down': 'down'})
    m.bone('body', 'float', (0, 14, 0))
    m.box('body', 'w_torso', (-4, 14, -2.5), (8, 10, 5))
    m.bone('cape', 'body', (0, 24, 2.6), rot=(6, 0, 0))
    m.plane('cape', 'w_cape', (-4.5, 2, 2.8), (9, 22, 0), face='south')
    m.bone('head', 'body', (0, 24, 0))
    m.box('head', 'w_hood', (-4.5, 23.5, -5), (9, 9, 9), faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'})
    m.plane('head', 'w_face', (-3.5, 24, -3.6), (7, 7, 0), face='north', light=False)
    m.box('head', 'w_tip', (-2, 30, 3.5), (4, 3, 3), rot=(-30, 0, 0), pivot=(0, 31, 4))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (5 * sx, 22, 0), rot=(-75, 0, 0))
        m.box(b, 'w_sleeve', (-7 if sx < 0 else 3, 15, -2), (4, 7, 4), faces={'north': 'side', 'south': 'side', 'east': 'side', 'west': 'side', 'up': 'up', 'down': 'down'})
        m.box(b, 'w_arm', (-6 if sx < 0 else 4, 9.5, -1), (2, 6, 2), mirror=sx > 0)
        m.box(b, 'w_claw', (-6.5 if sx < 0 else 3.5, 7.5, -1.5), (3, 2, 3), mirror=sx > 0)

    def ragp(c, F, seed, hem=True):
        T.mat_box(c, F, robe, 'rough', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            for _ in range(r[2] * r[3] // 8):
                c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), T.mix(robe, '#4a3a6a', rng.random() * 0.6))
            if hem and F.kinds.get(name) not in ('up', 'down'):
                jag(c, r, seed + len(name), 3, prob=0.75)
    m.painters['w_robe'] = lambda c, F: ragp(c, F, 1)
    m.painters['w_tail'] = lambda c, F: (ragp(c, F, 2), c.clear(F['down']))

    def torsop(c, F):
        ragp(c, F, 3, hem=False)
        fr = F['front']
        c.vl(fr, fr[2] // 2, T.dark(robe, 0.6))
        c.hl(fr, 0, '#3a3450')
        for j in range(2, 9, 3):
            c.at(fr, fr[2] // 2, j, '#8a60c0', glow=True)
    m.painters['w_torso'] = torsop

    def capep(c, F):
        r = F['face']
        T.mat_fill(c, r, T.dark(robe, 0.85), 'rough', seed=4)
        rng = random.Random(5)
        for i in range(r[2]):
            cut = rng.randrange(0, 8)
            c.clear(r, i, r[3] - cut, 1, cut)
            if rng.random() < 0.3:
                c.clear(r, i, rng.randrange(6, r[3] - 4), 1, 2)
        c.vl(r, 2, '#2a2638', 0, r[3] - 6)
        c.vl(r, 6, '#2a2638', 0, r[3] - 6)
    m.painters['w_cape'] = capep

    def hoodp(c, F):
        ragp(c, F, 6, hem=False)
        fr = F['front']
        c.clear(fr, 1, 2, 7, 7)
        c.hl(fr, 1, '#0c0a12')
        for r in (F['side'],):
            c.vl(r, 0, '#0c0a12')
    m.painters['w_hood'] = hoodp

    def facep(c, F):
        r = F['face']
        c.fill(r, '#06050a', 0.05)
        glow_eyes(c, r, [(1, 3), (2, 3), (4, 3), (5, 3)], '#c060ff', core=[(2, 3), (4, 3)])
        c.at(r, 1, 4, '#5a20a0', glow=True)
        c.at(r, 5, 4, '#5a20a0', glow=True)
        c.hl(r, 6, '#100c18')
    m.painters['w_face'] = facep
    m.painters['w_tip'] = lambda c, F: ragp(c, F, 7, hem=False)

    def sleevep(c, F):
        ragp(c, F, 8, hem=False)
        jag(c, F['side'], 9, 3, prob=0.8)
        c.clear(F['down'])
    m.painters['w_sleeve'] = sleevep
    m.painters['w_arm'] = lambda c, F: (T.mat_box(c, F, T.C('#b8b8cc'), 'bone', seed=10), [c.hl(r, 2, '#7a7a90') for r in F.sides()])

    def clawp(c, F):
        T.mat_box(c, F, T.C('#c8c8dc'), 'bone', seed=11)
        for r in F.sides():
            for i in range(0, r[2], 2):
                c.at(r, i, r[3] - 1, '#2a2a3a')
        c.fill(F['down'], '#3a3a4a', 0.05)
    m.painters['w_claw'] = clawp
    an = {
        'float': {'loop': True, 'bones': {
            'float': {'position': [0, 'math.sin(q.life_time * 120 + (v.phase ?? 0)) * 1.2 + 1.5', 0]},
            'robe': {'rotation': [f'math.sin(q.life_time * 160) * 4 + q.modified_move_speed * 22', 0, 'math.cos(q.life_time * 130) * 3']},
            'cape': {'rotation': [f'math.sin(q.life_time * 140) * 5 + q.modified_move_speed * 30', 0, 0]},
        }},
        'reach': {'loop': True, 'bones': {
            'armR': {'rotation': [f'math.sin(q.life_time * 100) * 6 - {ATK} * 50', 0, f'math.cos(q.life_time * 90) * 4']},
            'armL': {'rotation': [f'-math.sin(q.life_time * 100) * 6 - {ATK} * 50', 0, f'-math.cos(q.life_time * 90) * 4']},
        }},
        'look': {'loop': True, 'bones': {'head': {'rotation': ['math.clamp(q.target_x_rotation, -40, 40)', 'math.clamp(q.target_y_rotation, -60, 60)', 0]}}},
    }
    return Mob('wraith', m, an, ('#1a1a24', '#a040ff'))


# --------------------------------------------------------------------------------------
# Mago oscuro
# --------------------------------------------------------------------------------------
def mob_dark_mage():
    m = Model('geometry.rpg.dark_mage', 64, 64, bw=3, bh=3.4)
    robe = T.C('#3a1a5a')
    gold = T.C('#c8a040')
    rune = T.C('#c060ff')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (2 * sx, 12, 0))
        m.box(b, 'dm_leg', (-4 if sx < 0 else 0, 0, -2), (4, 12, 4), mirror=sx > 0)
    m.bone('body', 'root', (0, 12, 0))
    m.box('body', 'dm_body', (-4, 12, -2), (8, 12, 4))
    m.box('body', 'dm_mantle', (-5, 19.5, -3), (10, 5, 6), faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'})
    m.box('body', 'dm_book', (3.8, 9.5, -1.5), (1, 4, 3))
    m.bone('skirt', 'body', (0, 12, 0))
    m.box('skirt', 'dm_skirt', (-4.5, 1, -2.5), (9, 11, 5), faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side'})
    m.bone('head', 'body', (0, 24, 0))
    m.box('head', 'dm_head', (-4, 24, -4), (8, 8, 8))
    m.box('head', 'dm_hood', (-4, 24, -4), (8, 8, 8), inflate=0.8, faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'})
    m.box('head', 'dm_tip', (-2, 31, 1.5), (4, 4, 4), rot=(-35, 0, 0), pivot=(0, 32, 3))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (5 * sx, 22, 0))
        m.box(b, 'dm_arm', (-8 if sx < 0 else 4, 12, -2), (4, 12, 4), mirror=sx > 0)
        m.box(b, 'dm_cuff', (-8.5 if sx < 0 else 3.5, 11, -2.5), (5, 5, 5), faces={'north': 'side', 'south': 'side', 'east': 'side', 'west': 'side', 'down': 'down'})
    m.bone('staff', 'armR', (-6, 13, -2.5), rot=(-5, 0, 0))
    m.box('staff', 'dm_shaft', (-6.5, -1, -3), (1, 29, 1))
    for (x, z) in ((-7.6, -3), (-5.4, -3), (-6.5, -1.9), (-6.5, -4.1)):
        m.box('staff', 'dm_prong', (x, 27, z), (1, 4, 1))
    m.bone('orb', 'staff', (-6, 29.5, -2.5))
    m.box('orb', 'dm_orb', (-7.5, 28, -4), (3, 3, 3), light=False)

    def legp(c, F):
        T.mat_box(c, F, T.C('#2a1a3a'), 'cloth', seed=1)
        T.band(c, F, 8, 12, '#141018', 'leather')
        for r in F.sides():
            c.hl(r, 8, '#6a5a7a')
    m.painters['dm_leg'] = legp

    def runes_row(c, r, j, seed):
        rng = random.Random(seed)
        for i in range(0, r[2], 2):
            if rng.random() < 0.7:
                c.at(r, i, j, rune, glow=True)

    def bodyp(c, F):
        T.mat_box(c, F, robe, 'cloth', seed=2)
        fr = F['front']
        c.vl(fr, 3, gold)
        c.vl(fr, 4, T.dark(robe, 0.6))
        for j in range(2, 11, 3):
            c.at(fr, 4, j, rune, glow=True)
        for r in F.sides():
            c.hl(r, 10, '#1a1018')
            c.at(r, r[2] // 2, 10, gold)
    m.painters['dm_body'] = bodyp

    def mantlep(c, F):
        T.mat_box(c, F, T.dark(robe, 0.8), 'cloth', seed=3)
        for name, r in F.rects.items():
            if name == 'up':
                continue
            c.hl(r, r[3] - 1, gold)
            runes_row(c, r, r[3] - 2, 4 + len(name))
        c.area(F['front'], 4, 0, 2, 2, gold)
        c.at(F['front'], 4, 0, rune, glow=True)
    m.painters['dm_mantle'] = mantlep

    def skirtp(c, F):
        T.mat_box(c, F, robe, 'cloth', seed=5)
        for name, r in F.rects.items():
            c.hl(r, r[3] - 1, gold)
            runes_row(c, r, r[3] - 3, 6 + len(name))
            c.hl(r, r[3] - 4, T.dark(robe, 0.7))
        fr = F['front']
        c.vl(fr, fr[2] // 2, T.dark(robe, 0.55), 0, fr[3] - 1)
        jag(c, F['back'], 7, 1, prob=0.4)
    m.painters['dm_skirt'] = skirtp

    def headp(c, F):
        T.mat_box(c, F, T.C('#c8b8a8'), 'skin', seed=8)
        fr = F['front']
        c.area(fr, 0, 0, 8, 3, '#100a14')
        c.area(fr, 1, 3, 2, 1, '#2a1a2a')
        c.area(fr, 5, 3, 2, 1, '#2a1a2a')
        glow_eyes(c, fr, [(2, 3), (5, 3)], '#d060ff')
        c.at(fr, 3, 5, '#a89888')
        c.hl(fr, 6, '#5a4048', 2, 6)
        c.area(fr, 2, 7, 4, 1, '#d8d0c8')  # barba gris
        c.at(fr, 3, 6, '#d8d0c8')
    m.painters['dm_head'] = headp

    def hoodp(c, F):
        T.mat_box(c, F, T.dark(robe, 0.85), 'cloth', seed=9)
        fr = F['front']
        c.clear(fr, 1, 2, 6, 6)
        c.hl(fr, 1, gold, 1, 7)
        c.vl(fr, 0, gold, 2, 8)
        c.vl(fr, 7, gold, 2, 8)
    m.painters['dm_hood'] = hoodp
    m.painters['dm_tip'] = fp(T.dark(robe, 0.8), 'cloth', 10)

    def armp(c, F):
        T.mat_box(c, F, robe, 'cloth', seed=11)
        for name in ('front', 'back', 'right', 'left'):
            r = F[name]
            T.mat_fill(c, (r[0], r[1] + 10, r[2], 2), '#c8b8a8', 'skin', seed=12)
        T.mat_fill(c, F['down'], '#c8b8a8', 'skin', seed=12)
    m.painters['dm_arm'] = armp

    def cuffp(c, F):
        T.mat_box(c, F, T.dark(robe, 0.9), 'cloth', seed=13)
        c.hl(F['side'], F['side'][3] - 1, gold)
        c.hl(F['side'], 0, T.dark(robe, 0.6))
        c.clear(F['down'], 1, 1, 3, 3)
    m.painters['dm_cuff'] = cuffp
    m.painters['dm_book'] = lambda c, F: (T.mat_box(c, F, T.C('#6a1a1a'), 'leather', seed=14), c.fill(F['down'], '#e8e0c8', 0.02), [c.at(r, 1, 1, gold) for r in (F['right'], F['left'])])

    def shaftp(c, F):
        T.mat_box(c, F, T.C('#2a1a14'), 'wood', seed=15)
        for r in F.sides():
            for j in range(3, r[3], 7):
                c.at(r, 0, j, '#b8b8c8')
    m.painters['dm_shaft'] = shaftp
    m.painters['dm_prong'] = lambda c, F: (T.mat_box(c, F, T.C('#b8b8c8'), 'metal', seed=16), c.tint(F['up'], 1.2))

    def orbp(c, F):
        for name, r in F.rects.items():
            c.fill(r, '#c040ff', 0.04, glow=True)
            c.at(r, 0, 0, '#ffe0ff', glow=True)
            c.at(r, 1, 1, '#f080ff', glow=True)
            c.at(r, r[2] - 1, r[3] - 1, '#7010b0', glow=True)
    m.painters['dm_orb'] = orbp
    an = biped_anims(a_leg=26, a_arm=20, atk_amp=70, both_attack=False, body='body')
    an['cast'] = {'loop': True, 'bones': {
        'armL': {'rotation': [f'-{ATK} * 120', f'{ATK} * -20', 0]},
        'orb': {'rotation': [0, 'q.life_time * 120', 0], 'position': [0, 'math.sin(q.life_time * 160) * 0.6', 0]},
        'skirt': {'rotation': [walk(6), 0, 0]},
    }}
    an['idle']['bones']['armR'] = {'rotation': [-12, 0, breath(2, 90) + ' + 4']}
    return Mob('dark_mage', m, an, ('#3a1a5a', '#c040ff'))


# --------------------------------------------------------------------------------------
# Gólem de escarcha
# --------------------------------------------------------------------------------------
def mob_ice_golem():
    m = Model('geometry.rpg.ice_golem', 64, 64, bw=3.5, bh=3)
    ice = T.C('#9ad4ee')
    deep = T.C('#4a8ac0')
    glow = T.C('#40f4ff')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (3.5 * sx, 8, 0))
        m.box(b, 'ig_leg', (-6 if sx < 0 else 1, 0, -2.5), (5, 8, 5), mirror=sx > 0)
    m.bone('body', 'root', (0, 8, 0), rot=(12, 0, 0))
    m.box('body', 'ig_waist', (-5, 7.5, -3.5), (10, 6, 7))
    m.box('body', 'ig_chest', (-7.5, 13, -5), (15, 9, 9))
    m.box('body', 'ig_core', (-2, 15, -5.6), (4, 4, 1), light=False)
    spikes = [((-6.5, 21, -1), (-15, 0, 25)), ((4.5, 21, 0), (-10, 0, -25)), ((-1.5, 21, 1.5), (-35, 0, 0)),
              ((-5, 18, 3), (-55, 0, 18)), ((3, 18.5, 3), (-55, 0, -18)), ((-1, 15, 3.5), (-70, 0, 0))]
    for k, (o, r) in enumerate(spikes):
        m.box('body', 'ig_spike' if k % 2 == 0 else 'ig_spike2', o, (2, 6, 2) if k % 2 == 0 else (2, 5, 2), rot=r, pivot=(o[0] + 1, o[1], o[2] + 1))
    for k, (o, r) in enumerate((((-4, 21.5, -3), (10, 0, 30)), ((3, 21.5, -2.5), (10, 0, -30)), ((0, 21.5, -1), (-20, 0, 0)))):
        m.box('body', 'ig_spike3', o, (1, 4, 1), rot=r, pivot=(o[0] + 0.5, o[1], o[2] + 0.5))
    m.bone('head', 'body', (0, 20, -4), rot=(-12, 0, 0))
    m.box('head', 'ig_head', (-3.5, 17.5, -9.5), (7, 6, 6))
    m.box('head', 'ig_brow', (-3.5, 22.5, -9.8), (7, 1, 2))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (8.5 * sx, 20, 0))
        m.box(b, 'ig_arm', (-13 if sx < 0 else 8, 7, -2.5), (5, 14, 5), mirror=sx > 0)
        m.box(b, 'ig_fist', (-14 if sx < 0 else 7, 1, -3.5), (7, 6, 7), mirror=sx > 0)
        m.box(b, 'ig_spike3', (-12 if sx < 0 else 11, 20.5, -0.5), (1, 4, 1), rot=(0, 0, 25 * sx), pivot=(-11.5 if sx < 0 else 11.5, 20.5, 0))

    def icep(c, F, seed, base=ice):
        T.mat_box(c, F, base, 'crystal', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            if F.kinds.get(name) == 'up':
                c.fill(r, '#f0fbff', 0.04)
                continue
            for _ in range(max(1, r[2] * r[3] // 18)):  # grietas
                x, y = rng.randrange(r[2]), rng.randrange(r[3])
                for _k in range(rng.randrange(2, 5)):
                    c.at(r, x, y, deep)
                    x += rng.choice((-1, 0, 1))
                    y += 1
            c.hl(r, 0, '#e8f8ff')
    m.painters['ig_leg'] = lambda c, F: icep(c, F, 1)
    m.painters['ig_waist'] = lambda c, F: icep(c, F, 2, T.dark(ice, 0.9))

    def chestp(c, F):
        icep(c, F, 3)
        for r in F.sides():
            for i in range(0, r[2], 3):
                c.at(r, i, 1, '#ffffff')
    m.painters['ig_chest'] = chestp

    def corep(c, F):
        for r in F.all():
            c.fill(r, glow, 0.05, glow=True)
        fr = F['front']
        c.area(fr, 1, 1, 2, 2, '#e0ffff', glow=True)
        c.at(fr, 0, 0, '#1a8ab0', glow=True)
        c.at(fr, 3, 3, '#1a8ab0', glow=True)
    m.painters['ig_core'] = corep

    def spikep(c, F, seed):
        T.mat_box(c, F, T.C('#c8f0ff'), 'crystal', seed=seed)
        for r in F.sides():
            c.vl(r, 0, '#ffffff')
            c.hl(r, r[3] - 1, deep)
        c.fill(F['up'], '#ffffff', 0)
    m.painters['ig_spike'] = lambda c, F: spikep(c, F, 4)
    m.painters['ig_spike2'] = lambda c, F: spikep(c, F, 5)
    m.painters['ig_spike3'] = lambda c, F: spikep(c, F, 6)

    def headp(c, F):
        icep(c, F, 7)
        fr = F['front']
        glow_eyes(c, fr, [(1, 2), (2, 2), (4, 2), (5, 2)], glow, core=[(2, 2), (4, 2)])
        c.hl(fr, 4, T.dark(deep, 0.6), 1, 6)
        c.at(fr, 3, 4, '#c8f0ff')
    m.painters['ig_head'] = headp
    m.painters['ig_brow'] = lambda c, F: icep(c, F, 8, T.dark(ice, 0.85))

    def armp(c, F):
        icep(c, F, 9)
        for r in F.sides():
            c.hl(r, 4, deep)
            c.hl(r, 9, deep)
    m.painters['ig_arm'] = armp

    def fistp(c, F):
        icep(c, F, 10, T.dark(ice, 0.9))
        for r in F.sides():
            for i in range(1, r[2], 2):
                c.at(r, i, r[3] - 1, deep)
                c.at(r, i, r[3] - 2, '#e8f8ff')
    m.painters['ig_fist'] = fistp
    an = biped_anims(a_leg=24, a_arm=16, atk_amp=95, both_attack=True, body='body')
    an['idle']['bones']['body'] = {'rotation': [breath(1.5, 60), 0, 0]}
    an['glow'] = {'loop': True, 'bones': {'head': {'position': [0, breath(0.3, 140), 0]}}}
    return Mob('ice_golem', m, an, ('#a0d8ef', '#20f0ff'))


# --------------------------------------------------------------------------------------
# Diablillo de fuego (alas de murciélago, cola, cuernos)
# --------------------------------------------------------------------------------------
def mob_fire_imp():
    m = Model('geometry.rpg.fire_imp', 64, 64, bw=3.5, bh=3)
    skin = T.C('#b02a1a')
    belly = T.C('#e06a20')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (1.8 * sx, 9, 0))
        m.box(b, 'fi_leg', (-2.8 if sx < 0 else 0.8, 1, -1), (2, 8, 2), mirror=sx > 0)
        m.box(b, 'fi_hoof', (-3.3 if sx < 0 else 0.3, 0, -1.5), (3, 1, 3), mirror=sx > 0)
    m.bone('body', 'root', (0, 9, 0), rot=(10, 0, 0))
    m.box('body', 'fi_body', (-3, 9, -2), (6, 7, 4))
    m.bone('head', 'body', (0, 16, -0.5))
    m.box('head', 'fi_head', (-3.5, 16, -4), (7, 6, 6))
    m.box('head', 'fi_flame', (-2, 21.5, -2.5), (4, 3, 4), rot=(0, 45, 0), pivot=(0, 22, -0.5), light=False)
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'horn{side}', 'head', (2.5 * sx, 21.5, -1.5), rot=(-25, 0, 15 * sx))
        m.box(b, 'fi_horn', (2.5 * sx - 0.5, 21.5, -2), (1, 3, 1))
        t = m.bone(f'horn{side}_tip', b, (2.5 * sx, 24.5, -1.5), rot=(-35, 0, 10 * sx))
        m.box(t, 'fi_horn2', (2.5 * sx - 0.5, 24.2, -2), (1, 2, 1))
        e = m.bone(f'ear{side}', 'head', (3.5 * sx, 19.5, -1), rot=(0, -15 * sx, -20 * sx))
        m.box(e, 'fi_ear', (-6.5 if sx < 0 else 3.5, 19, -1.5), (3, 2, 1), mirror=sx > 0)
        a = m.bone(f'arm{side}', 'body', (3.8 * sx, 15, 0))
        m.box(a, 'fi_arm', (-5 if sx < 0 else 3, 7.5, -1), (2, 8, 2), mirror=sx > 0)
        w = m.bone(f'wing{side}', 'body', (1 * sx, 14.5, 2), rot=(10, -30 * sx, 0))
        m.plane(w, 'fi_wing', (-12 if sx < 0 else 2, 6, 2.2), (10, 10, 0), face='south', mirror=sx > 0)
    m.bone('tail', 'body', (0, 10, 2), rot=(35, 0, 0))
    m.box('tail', 'fi_tail', (-0.5, 9.5, 2), (1, 1, 7))
    m.bone('tail2', 'tail', (0, 10, 9), rot=(25, 0, 0))
    m.box('tail2', 'fi_tail', (-0.5, 9.5, 8.5), (1, 1, 7))
    m.box('tail2', 'fi_spade', (-1.5, 9.5, 14.5), (3, 1, 3))

    def skp(c, F, seed):
        T.mat_box(c, F, skin, 'skin', seed=seed)
    m.painters['fi_leg'] = lambda c, F: (skp(c, F, 1), [c.hl(r, 3, T.dark(skin, 0.75)) for r in F.sides()])
    m.painters['fi_hoof'] = fp(T.C('#1a1010'), 'leather', 2)

    def bodyp(c, F):
        skp(c, F, 3)
        fr = F['front']
        c.area(fr, 1, 1, 4, 6, belly)
        for j in (2, 4):
            c.hl(fr, j, T.dark(belly, 0.8), 1, 5)
        c.vl(fr, 3, T.dark(belly, 0.85), 1, 7)
        c.hl(F['back'], 0, T.dark(skin, 0.7))
    m.painters['fi_body'] = bodyp

    def headp(c, F):
        skp(c, F, 4)
        fr = F['front']
        c.hl(fr, 1, T.dark(skin, 0.6), 0, 7)
        glow_eyes(c, fr, [(1, 2), (2, 2), (4, 2), (5, 2)], '#ffd020', core=[(2, 2), (4, 2)])
        c.hl(fr, 4, '#2a0404', 1, 6)
        for i in (1, 3, 5):
            c.at(fr, i, 4, '#f8f0d0')
        c.at(fr, 1, 3, '#2a0404')
        c.at(fr, 5, 3, '#2a0404')
        c.area(fr, 2, 5, 3, 1, T.dark(skin, 0.75))
    m.painters['fi_head'] = headp

    def flamep(c, F):
        for name, r in F.rects.items():
            for i in range(r[2]):
                for j in range(r[3]):
                    t = j / max(1, r[3] - 1)
                    col = T.mix('#fff6a0', '#ff4010', t)
                    c.at(r, i, j, col, glow=True)
            if F.kinds.get(name) not in ('up', 'down'):
                c.clear(r, 0, 0, 1, 1)
                c.clear(r, r[2] - 1, 0, 1, 1)
                if r[2] > 3:
                    c.clear(r, 2, 0, 1, 1)
    m.painters['fi_flame'] = flamep
    m.painters['fi_horn'] = lambda c, F: (T.mat_box(c, F, T.C('#2a1a18'), 'bone', seed=5), [c.hl(r, 1, '#4a3430') for r in F.sides()])
    m.painters['fi_horn2'] = lambda c, F: (T.mat_box(c, F, T.C('#1a1010'), 'bone', seed=6), c.fill(F['up'], '#5a4a40', 0))

    def earp(c, F):
        skp(c, F, 7)
        for name in ('front', 'up', 'down'):
            c.clear(F[name], 0, 0, 1, 1)
        c.clear(F['back'], F['back'][2] - 1, 0, 1, 1)
        c.at(F['front'], 1, 1, T.mix(skin, '#ffa060', 0.4))
    m.painters['fi_ear'] = earp

    def armp(c, F):
        skp(c, F, 8)
        for r in F.sides():
            c.hl(r, r[3] - 1, '#1a0a08')
            c.hl(r, 2, T.dark(skin, 0.75))
    m.painters['fi_arm'] = armp

    def wingp(c, F):
        r = F['face']
        x, y, w, h = r
        c.clear(r)
        mem = T.C('#7a1a10')
        bone_c = T.C('#2a0a08')
        # membrana: abanico desde la raíz (columna 0 = junto al cuerpo en la cara sur)
        rx, ry = 0, 0
        for i in range(w):
            for j in range(h):
                dx, dy = i - rx, j - ry
                ang = math.degrees(math.atan2(dy, dx + 0.01))
                dist = math.hypot(dx, dy)
                lim = 10.5 - 2.2 * abs(math.sin(math.radians(ang * 4)))
                if dist <= lim:
                    col = T.mix(mem, '#ff6a20', max(0, 0.35 - dist * 0.03))
                    c.at(r, i, j, col)
        for ang in (8, 30, 52, 76):
            for t in range(0, 11):
                i = int(round(rx + t * math.cos(math.radians(ang))))
                j = int(round(ry + t * math.sin(math.radians(ang))))
                if c.ga(r, i, j)[3]:
                    c.at(r, i, j, bone_c)
        c.hl(r, 0, bone_c, 0, w)
        c.at(r, w - 1, 0, '#f0e0d0')
    m.painters['fi_wing'] = wingp
    m.painters['fi_tail'] = lambda c, F: skp(c, F, 9)

    def spadep(c, F):
        T.mat_box(c, F, T.C('#3a0a08'), 'skin', seed=10)
        for name in ('up', 'down'):
            r = F[name]
            c.clear(r, 0, r[3] - 1, 1, 1)
            c.clear(r, r[2] - 1, r[3] - 1, 1, 1)
    m.painters['fi_spade'] = spadep
    an = biped_anims(a_leg=40, a_arm=30, atk_amp=140, body='body')
    an['wings'] = {'loop': True, 'bones': {
        'wingR': {'rotation': [0, 'math.sin(q.life_time * 900) * 28 + 10', 0]},
        'wingL': {'rotation': [0, '-math.sin(q.life_time * 900) * 28 - 10', 0]},
        'tail': {'rotation': [0, 'math.sin(q.life_time * 150) * 18', 0]},
        'tail2': {'rotation': ['math.sin(q.life_time * 150 + 60) * 10', 'math.sin(q.life_time * 150 + 90) * 20', 0]},
        'root': {'position': [0, 'math.sin(q.life_time * 300 + (v.phase ?? 0)) * 0.6 + 0.6', 0]},
    }}
    return Mob('fire_imp', m, an, ('#b02a1a', '#ffd020'))


# --------------------------------------------------------------------------------------
# Trol de las cavernas (barriga enorme, brazos largos, garrote)
# --------------------------------------------------------------------------------------
def mob_troll():
    m = Model('geometry.rpg.troll', 64, 64, bw=4, bh=3)
    skin = T.C('#6b7a5a')
    moss = T.C('#4a6a2a')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (3.5 * sx, 8, 0))
        m.box(b, 'tr_leg', (-6 if sx < 0 else 1, 0, -2.5), (5, 8, 5), mirror=sx > 0)
    m.bone('belly', 'root', (0, 8, 0))
    m.box('belly', 'tr_belly', (-6, 7.5, -6), (12, 9, 10))
    m.plane('belly', 'tr_loin', (-4, 2, -6.3), (8, 6, 0), face='north')
    m.bone('body', 'belly', (0, 16, 0), rot=(18, 0, 0))
    m.box('body', 'tr_chest', (-7, 15.5, -4), (14, 7, 8))
    m.bone('head', 'body', (0, 21, -4), rot=(-18, 0, 0))
    m.box('head', 'tr_head', (-3.5, 18, -9.5), (7, 6, 6))
    m.box('head', 'tr_nose', (-1, 18.5, -11), (2, 3, 2))
    m.bone('jaw', 'head', (0, 18.5, -5))
    m.box('jaw', 'tr_jaw', (-3, 16.5, -10), (6, 2, 5))
    m.box('jaw', 'tr_tusk', (-2.5, 18.5, -10.3), (1, 2, 1))
    m.box('jaw', 'tr_tusk', (1.5, 18.5, -10.3), (1, 2, 1), mirror=True)
    for side, sx in (('R', -1), ('L', 1)):
        m.box('head', 'tr_ear', (-6.5 if sx < 0 else 3.5, 20, -6.5), (3, 3, 1), mirror=sx > 0)
        b = m.bone(f'arm{side}', 'body', (8 * sx, 20.5, 0))
        m.box(b, 'tr_arm', (-11 if sx < 0 else 7, 5, -2), (4, 16, 4), mirror=sx > 0)
        m.box(b, 'tr_hand', (-11.5 if sx < 0 else 6.5, 1, -2.5), (5, 4, 5), mirror=sx > 0)
    m.bone('club', 'armR', (-9, 3, 0), rot=(65, 0, 0))
    m.box('club', 'tr_handle', (-10, -1, -1), (2, 12, 2))
    m.box('club', 'tr_clubhead', (-11, 10, -2), (4, 7, 4))
    for (dx, dy, dz) in ((-11.6, 12, -0.5), (-7.4, 14, -0.5), (-9.5, 13, -2.6), (-9.5, 15, 1.6)):
        m.box('club', 'tr_nail', (dx, dy, dz), (1, 1, 1))

    def skinp(c, F, seed, mossy=False):
        T.mat_box(c, F, skin, 'stone' if seed % 2 else 'skin', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            for _ in range(r[2] * r[3] // 14):
                c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), T.dark(skin, 0.72))
            if mossy and F.kinds.get(name) in ('up', 'back'):
                for _ in range(r[2] * r[3] // 3):
                    c.at(r, rng.randrange(r[2]), rng.randrange(max(1, r[3] // 2)), T.mix(moss, '#6a8a3a', rng.random()))
    m.painters['tr_leg'] = lambda c, F: (skinp(c, F, 1), [c.hl(r, r[3] - 1, '#3a3a2a') for r in F.sides()])

    def bellyp(c, F):
        skinp(c, F, 2)
        fr = F['front']
        light_b = T.C('#8e9c72')
        c.area(fr, 1, 0, fr[2] - 2, fr[3] - 1, light_b)
        c.at(fr, fr[2] // 2, fr[3] // 2, T.dark(light_b, 0.55))
        for j in (2, 6):
            c.hl(fr, j, T.dark(light_b, 0.85), 3, fr[2] - 3)
        for r in F.sides():
            c.hl(r, r[3] - 2, '#5a3a1a')
            c.hl(r, r[3] - 1, '#4a2a10')
    m.painters['tr_belly'] = bellyp

    def loinp(c, F):
        r = F['face']
        T.mat_fill(c, r, '#6a4a2a', 'fur', seed=3)
        jag(c, r, 4, 2)
    m.painters['tr_loin'] = loinp
    m.painters['tr_chest'] = lambda c, F: skinp(c, F, 5, mossy=True)

    def headp(c, F):
        skinp(c, F, 6, mossy=True)
        fr = F['front']
        c.hl(fr, 1, T.dark(skin, 0.55))
        glow_eyes(c, fr, [(1, 2), (5, 2)], '#ffaa00')
        c.at(fr, 2, 2, '#1a1408')
        c.at(fr, 4, 2, '#1a1408')
        up = F['up']
        for i in range(2, 5):
            for j in range(1, 4):
                c.at(up, i, j, '#2a2a1a')
    m.painters['tr_head'] = headp
    m.painters['tr_nose'] = lambda c, F: (skinp(c, F, 7), c.at(F['down'], 0, 0, '#2a2a1a'), c.at(F['down'], 1, 0, '#2a2a1a'))

    def jawp(c, F):
        skinp(c, F, 8)
        fr = F['front']
        c.hl(fr, 0, '#2a1410')
        for i in range(0, fr[2], 2):
            c.at(fr, i, 0, '#d8c890')
    m.painters['tr_jaw'] = jawp
    m.painters['tr_tusk'] = fp(T.C('#e0d4a8'), 'bone', 9)
    m.painters['tr_ear'] = lambda c, F: (skinp(c, F, 10), c.at(F['front'], 1, 1, T.dark(skin, 0.6)))

    def armp(c, F):
        skinp(c, F, 11, mossy=True)
        T.band(c, F, 10, 12, '#5a3a1a', 'leather')
    m.painters['tr_arm'] = armp

    def handp(c, F):
        skinp(c, F, 12)
        for r in F.sides():
            for i in range(0, r[2], 2):
                c.at(r, i, r[3] - 1, '#d8c890')
    m.painters['tr_hand'] = handp
    m.painters['tr_handle'] = lambda c, F: (T.mat_box(c, F, T.C('#5a3a1c'), 'wood', seed=13), [c.hl(r, 3, '#3a2a1a') for r in F.sides()])

    def clubp(c, F):
        T.mat_box(c, F, T.C('#6a4422'), 'wood', seed=14)
        rng = random.Random(14)
        for r in F.all():
            for _ in range(2):
                c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), '#3a2410')
    m.painters['tr_clubhead'] = clubp
    m.painters['tr_nail'] = fp(T.C('#8a8a92'), 'metal', 15)
    an = biped_anims(a_leg=30, a_arm=22, atk_amp=120, body='body', head='head')
    an['idle']['bones']['belly'] = {'position': [0, breath(0.3, 70), 0]}
    an['idle']['bones']['jaw'] = {'rotation': [f'math.max(0, math.sin(q.life_time * 50 + (v.phase ?? 0))) * 10', 0, 0]}
    return Mob('troll', m, an, ('#6b7a5a', '#5a3a1a'))


# --------------------------------------------------------------------------------------
# Caballero demoníaco
# --------------------------------------------------------------------------------------
def mob_demon_knight():
    m = Model('geometry.rpg.demon_knight', 64, 64, bw=3.5, bh=3.6)
    iron = T.C('#24222a')
    crack = T.C('#ff3a10')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (2.2 * sx, 12, 0))
        m.box(b, 'dk_leg', (-4.2 if sx < 0 else 0.2, 0, -2), (4, 12, 4), mirror=sx > 0)
        m.box(b, 'dk_knee', (-2.7 if sx < 0 else 1.7, 6.5, -3), (1, 2, 1))
    m.bone('body', 'root', (0, 12, 0))
    m.box('body', 'dk_body', (-4.5, 12, -2.5), (9, 12, 5))
    m.box('body', 'dk_tasset', (-5, 7.5, -3), (10, 5, 6), faces={'north': 'front', 'south': 'front', 'east': 'side', 'west': 'side'})
    m.box('body', 'dk_cspike', (-2.5, 19, -3.5), (1, 2, 1))
    m.box('body', 'dk_cspike', (1.5, 19, -3.5), (1, 2, 1))
    m.bone('cape', 'body', (0, 24, 2.5), rot=(5, 0, 0))
    m.box('cape', 'dk_cape', (-5, 3, 2.6), (10, 21, 1), faces={'south': 'back', 'north': 'inner', 'east': 'edge', 'west': 'edge'})
    m.bone('head', 'body', (0, 24, 0))
    m.box('head', 'dk_helm', (-4.5, 24, -4.5), (9, 9, 9))
    for side, sx in (('R', -1), ('L', 1)):
        h1 = m.bone(f'horn{side}', 'head', (4.5 * sx, 30.5, -1))
        m.box(h1, 'dk_horn1', (-7.5 if sx < 0 else 4.5, 29.5, -2), (3, 2, 2), mirror=sx > 0)
        h2 = m.bone(f'horn{side}_2', h1, (6.5 * sx, 31, -1), rot=(10, 0, 0))
        m.box(h2, 'dk_horn2', (6.5 * sx - 1, 31, -2), (2, 3, 2))
        h3 = m.bone(f'horn{side}_3', h2, (6.5 * sx, 34, -1), rot=(35, 0, 0))
        m.box(h3, 'dk_horn3', (6.5 * sx - 0.5, 33.8, -1.5), (1, 3, 1))
        a = m.bone(f'arm{side}', 'body', (6 * sx, 22, 0))
        m.box(a, 'dk_arm', (-8.5 if sx < 0 else 4.5, 10, -2), (4, 12, 4), mirror=sx > 0)
        m.box(a, 'dk_pad', (-10 if sx < 0 else 4, 20, -3.5), (6, 4, 7), mirror=sx > 0)
        for dz in (-2, 1):
            m.box(a, 'dk_pspike', (-8 if sx < 0 else 7, 24, dz), (1, 3, 1))
    m.bone('sword', 'armR', (-6.5, 11, 0), rot=(75, 0, 0))
    m.box('sword', 'dk_blade', (-7, 14, -1.5), (1, 18, 3))
    m.box('sword', 'dk_guard', (-7, 13, -4), (1, 1, 8))
    m.box('sword', 'dk_grip', (-7, 9, -0.5), (1, 4, 1))
    m.box('sword', 'dk_pommel', (-7.5, 8, -1), (2, 1, 2))

    def armorp(c, F, seed, cracks=True):
        T.mat_box(c, F, iron, 'metal', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            if cracks and F.kinds.get(name) not in ('up', 'down') and r[2] * r[3] >= 12:
                x, y = rng.randrange(r[2]), rng.randrange(r[3] // 2)
                for _k in range(rng.randrange(3, 6)):
                    c.at(r, x, y, crack, glow=True)
                    x += rng.choice((-1, 0, 1))
                    y += 1
            c.hl(r, 0, T.light(iron, 1.4))
    m.painters['dk_leg'] = lambda c, F: (armorp(c, F, 1), [c.hl(r, 6, '#8a1010') for r in F.sides()])
    m.painters['dk_knee'] = fp(T.C('#c8b8a0'), 'bone', 2)
    m.painters['dk_cspike'] = fp(T.C('#c8b8a0'), 'bone', 3)
    m.painters['dk_pspike'] = lambda c, F: (T.mat_box(c, F, T.C('#c8b8a0'), 'bone', seed=4), c.fill(F['up'], '#fff0d0', 0))

    def bodyp(c, F):
        armorp(c, F, 5)
        fr = F['front']
        c.vl(fr, fr[2] // 2, T.dark(iron, 0.6))
        c.hl(fr, 7, '#8a1010')
        c.area(fr, 3, 3, 3, 3, '#3a0a0a')
        c.at(fr, 4, 4, crack, glow=True)
        for r in F.sides():
            c.hl(r, 10, '#8a1010')
    m.painters['dk_body'] = bodyp

    def tassetp(c, F):
        armorp(c, F, 6, cracks=False)
        for r in F.all():
            for i in range(0, r[2], 3):
                c.vl(r, i, T.dark(iron, 0.6))
            c.hl(r, r[3] - 1, '#8a1010')
    m.painters['dk_tasset'] = tassetp

    def capep(c, F):
        T.mat_box(c, F, T.C('#3a0a0a'), 'cloth', seed=7)
        r = F['back']
        jag(c, r, 8, 4, prob=0.8)
        jag(c, F['inner'], 8, 4, prob=0.8)
        c.hl(r, 0, '#8a1010')
        _emblem(c, r, 'flame', T.C('#7a1010'), r[2] // 2 - 1, 4)
    m.painters['dk_cape'] = capep

    def helmp(c, F):
        armorp(c, F, 9)
        fr = F['front']
        c.hl(fr, 3, '#0a0808')
        glow_eyes(c, fr, [(2, 3), (3, 3), (5, 3), (6, 3)], '#ff2a10', core=[(3, 3), (5, 3)])
        c.vl(fr, 4, T.light(iron, 1.3), 4, 9)
        for j in range(5, 8):
            c.at(fr, 2, j, '#0a0808')
            c.at(fr, 6, j, '#0a0808')
        c.hl(fr, 0, '#8a1010')
    m.painters['dk_helm'] = helmp

    def hornp(c, F, base, tip=False):
        T.mat_box(c, F, base, 'bone', seed=10)
        for r in F.sides():
            for j in range(0, r[3], 2):
                c.hl(r, j, T.dark(base, 0.7))
        if tip:
            c.fill(F['up'], '#e8d8c0', 0)
    m.painters['dk_horn1'] = lambda c, F: hornp(c, F, T.C('#3a1010'))
    m.painters['dk_horn2'] = lambda c, F: hornp(c, F, T.C('#6a2018'))
    m.painters['dk_horn3'] = lambda c, F: hornp(c, F, T.C('#b89880'), tip=True)
    m.painters['dk_arm'] = lambda c, F: (armorp(c, F, 11), T.band(c, F, 8, 12, '#3a3038', 'metal'))
    m.painters['dk_pad'] = lambda c, F: (armorp(c, F, 12), [c.hl(r, r[3] - 1, '#8a1010') for r in F.sides()])

    def bladep(c, F):
        T.mat_box(c, F, T.C('#3a3a44'), 'metal', seed=13)
        for name in ('right', 'left'):
            r = F[name]
            c.vl(r, 0, T.C('#9a9aa8'))
            c.vl(r, r[2] - 1, T.C('#9a9aa8'))
            for j in range(1, r[3] - 1, 2):
                c.at(r, r[2] // 2, j, crack, glow=True)
        c.fill(F['up'], '#c8c8d0', 0)
    m.painters['dk_blade'] = bladep

    def guardp(c, F):
        T.mat_box(c, F, T.C('#5a0a0a'), 'metal', seed=14)
        for r in (F['right'], F['left']):
            c.at(r, 0, 0, '#c8b8a0')
            c.at(r, r[2] - 1, 0, '#c8b8a0')
    m.painters['dk_guard'] = guardp
    m.painters['dk_grip'] = fp(T.C('#1a0a0a'), 'leather', 15)
    m.painters['dk_pommel'] = lambda c, F: (T.mat_box(c, F, T.C('#5a0a0a'), 'metal', seed=16), c.at(F['down'], 0, 0, crack, glow=True))
    an = biped_anims(a_leg=34, a_arm=24, atk_amp=130, both_attack=False, body='body')
    an['attack']['bones']['armL'] = {'rotation': [f'-{ATK} * 90', f'-{ATK} * 20', 0]}
    an['cape'] = {'loop': True, 'bones': {'cape': {'rotation': [f'q.modified_move_speed * 30 + math.sin(q.life_time * 110) * 3', 0, 0]}}}
    return Mob('demon_knight', m, an, ('#202024', '#a01010'))


# --------------------------------------------------------------------------------------
# Arácnidos: araña gigante, reina araña y escorpión
# --------------------------------------------------------------------------------------
def mob_spider(queen=False):
    key = 'spider_queen' if queen else 'giant_spider'
    m = Model(f'geometry.rpg.{key}', 64, 64, bw=4, bh=2.5)
    body = T.C('#3b2a1a') if not queen else T.C('#1c121e')
    mark = T.C('#8a1a1a') if not queen else T.C('#d040a0')
    eye = '#ff2010' if not queen else '#ff40c0'
    s = 1.0 if not queen else 1.15
    m.bone('root')
    m.bone('thorax', 'root', (0, 7, 0))
    m.box('thorax', 'sp_thorax', (-3.5, 4.5, -5), (7, 5, 7) if not queen else (8, 6, 8))
    m.bone('abdomen', 'thorax', (0, 8, 2), rot=(14, 0, 0))
    if not queen:
        m.box('abdomen', 'sp_abdomen', (-5, 4, 1.5), (10, 8, 12))
        m.box('abdomen', 'sp_spin', (-1, 6, 13.5), (2, 2, 1))
    else:
        m.box('abdomen', 'sp_abdomen', (-7, 3.5, 2), (14, 11, 16))
        m.box('abdomen', 'sp_spin', (-1.5, 6.5, 18), (3, 3, 1))
    m.bone('head', 'thorax', (0, 7, -5))
    hz = -9 if not queen else -10
    m.box('head', 'sp_head', (-3, 4.5, hz), (6, 5, 4) if not queen else (7, 6, 5))
    for side, sx in (('R', -1), ('L', 1)):
        f = m.bone(f'fang{side}', 'head', (1.5 * sx, 5, hz + 0.5))
        m.box(f, 'sp_fang', (1.5 * sx - 0.5, 2, hz), (1, 3, 1) if not queen else (2, 4, 2), mirror=sx > 0)
    if queen:
        b = m.bone('crown', 'head', (0, 10.5, -7.5))
        for k, x in enumerate((-3, -1, 1, 3)):
            m.box(b, 'sq_spike' if k in (1, 2) else 'sq_spike2', (x - 0.5, 10.5, -8.5), (1, 3 if k in (1, 2) else 2, 1))
        m.box(b, 'sq_band', (-3.5, 10, -9), (7, 1, 3))
    zs = (-4, -2, 0.5, 2.5) if not queen else (-4.5, -2.2, 0.5, 3)
    yaws = (-38, -12, 14, 38)
    fl = 9 if not queen else 12
    tl = 12 if not queen else 15
    for i, z in enumerate(zs):
        for side, sx in (('R', -1), ('L', 1)):
            name = f'leg{side}{i}'
            px_ = -3 if sx < 0 else 3
            b = m.bone(name, 'thorax', (px_, 7, z), rot=(0, yaws[i] * -sx, 25 * -sx))
            x0 = px_ - fl if sx < 0 else px_
            m.box(b, 'sp_femur', (x0, 6, z - 1), (fl, 2, 2), mirror=sx > 0)
            kx = px_ - fl + 0.5 if sx < 0 else px_ + fl - 0.5
            k = m.bone(name + 'k', b, (kx, 7, z))
            m.box(k, 'sp_tibia', (kx - 1, 7 - tl, z - 1), (2, tl, 2), mirror=sx > 0)

    def furp(c, F, seed, base=body):
        T.mat_box(c, F, base, 'fur', seed=seed)
    m.painters['sp_thorax'] = lambda c, F: (furp(c, F, 1), _emblem(c, F['up'], 'skull' if queen else 'cross', T.dark(body, 0.6), F['up'][2] // 2 - 1, 2))

    def abdp(c, F):
        furp(c, F, 2)
        up = F['up']
        w, h = up[2], up[3]
        for j in range(h):
            half = int(abs(math.sin(j / max(1, h - 1) * math.pi)) * (w // 3)) if not queen else int((1 - abs(j / (h - 1) - 0.5) * 2) * (w // 3))
            c.hl(up, j, mark, w // 2 - half // 2 - 1, w // 2 + half // 2 + 1)
        if queen:
            for j in range(2, h - 2, 3):
                c.at(up, w // 2, j, '#ffa0ff', glow=True)
                c.at(up, w // 2 - 3, j + 1, mark, glow=True)
                c.at(up, w // 2 + 2, j + 1, mark, glow=True)
        bk = F['back']
        c.area(bk, bk[2] // 2 - 2, 2, 4, 3, mark)
        for r in (F['right'], F['left']):
            for i in range(1, r[2], 3):
                c.vl(r, i, T.dark(body, 0.7), 1, r[3] - 1)
    m.painters['sp_abdomen'] = abdp
    m.painters['sp_spin'] = fp(T.dark(body, 0.6), 'leather', 3)

    def headp(c, F):
        furp(c, F, 4, T.dark(body, 0.9))
        fr = F['front']
        w = fr[2]
        big = [(1, 1), (w - 2, 1)] if not queen else [(1, 1), (2, 1), (w - 3, 1), (w - 2, 1)]
        small = [(2, 2), (w - 3, 2), (0, 3), (w - 1, 3), (2, 0), (w - 3, 0)]
        glow_eyes(c, fr, big, eye, core=[big[0]])
        glow_eyes(c, fr, small, T.dark(eye, 0.75))
        c.hl(fr, fr[3] - 1, '#1a0a08', 1, w - 1)
    m.painters['sp_head'] = headp

    def fangp(c, F):
        T.mat_box(c, F, T.C('#e0d8c0'), 'bone', seed=5)
        for r in F.sides():
            c.hl(r, r[3] - 1, '#2a1a10')
        c.fill(F['down'], '#2a1a10', 0)
    m.painters['sp_fang'] = fangp

    def legp(c, F, seed):
        furp(c, F, seed)
        for name, r in F.rects.items():
            if F.kinds.get(name) in ('up', 'down'):
                continue
            if r[2] > r[3]:
                for i in range(0, r[2], 3):
                    c.vl(r, i, T.light(body, 1.4) if not queen else T.dark(mark, 0.7))
            else:
                for j in range(0, r[3], 3):
                    c.hl(r, j, T.light(body, 1.4) if not queen else T.dark(mark, 0.7))
                c.hl(r, r[3] - 1, '#0a0606')
    m.painters['sp_femur'] = lambda c, F: legp(c, F, 6)
    m.painters['sp_tibia'] = lambda c, F: legp(c, F, 7)
    if queen:
        m.painters['sq_spike'] = lambda c, F: (T.mat_box(c, F, T.C('#f0c030'), 'metal', seed=8), c.at(F['front'], 0, 0, '#ff40c0', glow=True))
        m.painters['sq_spike2'] = lambda c, F: T.mat_box(c, F, T.C('#e0b020'), 'metal', seed=10)
        m.painters['sq_band'] = lambda c, F: (T.mat_box(c, F, T.C('#e0b020'), 'metal', seed=9), [c.at(r, 1, 0, '#ff40c0', glow=True) for r in F.sides()])
    bones = {}
    for i in range(4):
        ph = i * 90
        for side, sg in (('R', 1), ('L', -1)):
            bones[f'leg{side}{i}'] = {'rotation': [0,
                                                  f'{sg} * math.cos(q.modified_distance_moved * 55 + {ph + (0 if side == "R" else 180)}) * 18 * q.modified_move_speed',
                                                  f'{sg} * -math.abs(math.sin(q.modified_distance_moved * 55 + {ph + (0 if side == "R" else 180)})) * 14 * q.modified_move_speed']}
    an = {
        'move': {'loop': True, 'bones': bones},
        'idle': {'loop': True, 'bones': {
            'abdomen': {'rotation': [breath(3, 70), 0, 0], 'position': [0, breath(0.3, 70), 0]},
            'fangR': {'rotation': [f'math.sin(q.life_time * 400) * 6 + {ATK} * 30', 0, 0]},
            'fangL': {'rotation': [f'math.sin(q.life_time * 400) * 6 + {ATK} * 30', 0, 0]},
        }},
        'attack': {'loop': True, 'bones': {
            'legR0': {'rotation': [0, 0, f'{ATK} * 35']},
            'legL0': {'rotation': [0, 0, f'-{ATK} * 35']},
            'head': {'rotation': [f'-{ATK} * 15', 0, 0]},
        }},
        'look': {'loop': True, 'bones': {'head': {'rotation': ['math.clamp(q.target_x_rotation, -20, 20)', 'math.clamp(q.target_y_rotation, -30, 30)', 0]}}},
    }
    egg = ('#3b2a1a', '#6a1a1a') if not queen else ('#1a121c', '#a01030')
    return Mob(key, m, an, egg)


def mob_scorpion():
    m = Model('geometry.rpg.scorpion', 64, 64, bw=4, bh=3)
    shell = T.C('#c2a060')
    dark_ = T.C('#8a6a30')
    m.bone('root')
    m.bone('body', 'root', (0, 5, 0))
    m.box('body', 'sc_seg1', (-4, 3, -6), (8, 4, 6))
    m.box('body', 'sc_seg2', (-3.5, 3.2, 0), (7, 4, 4))
    m.box('body', 'sc_seg3', (-3, 3.5, 4), (6, 3, 4))
    m.box('body', 'sc_head', (-3, 3, -9), (6, 3, 3))
    prev = 'body'
    piv = (0, 5, 8)
    rots = (55, 32, 32, 32)
    for k in range(4):
        b = m.bone(f'tail{k}', prev, piv, rot=(rots[k], 0, 0))
        z0 = piv[2] - 0.5
        m.box(b, 'sc_tail' if k < 3 else 'sc_tail2', (-1.5 if k < 3 else -1, 3.5 if k < 3 else 4, z0), (3, 3, 4) if k < 3 else (2, 2, 4))
        prev = b
        piv = (0, 5, piv[2] + 3.5)
    b = m.bone('stinger', prev, piv, rot=(40, 0, 0))
    m.box(b, 'sc_sting', (-1, 4, piv[2] - 0.5), (2, 2, 3))
    m.box(b, 'sc_barb', (-0.5, 2, piv[2] + 1.5), (1, 2, 1))
    for side, sx in (('R', -1), ('L', 1)):
        a = m.bone(f'arm{side}', 'body', (3.5 * sx, 5, -7), rot=(0, -20 * sx, 0))
        ax = -4.5 if sx < 0 else 2.5
        m.box(a, 'sc_arm', (ax, 4, -13), (2, 2, 6), mirror=sx > 0)
        cl = m.bone(f'claw{side}', a, (3.5 * sx, 5, -13), rot=(0, 15 * sx, 0))
        cx = -5.5 if sx < 0 else 1.5
        m.box(cl, 'sc_claw', (cx, 3.5, -17), (4, 3, 4), mirror=sx > 0)
        m.box(cl, 'sc_finger', (cx if sx < 0 else cx + 3, 4, -21), (1, 2, 4), mirror=sx > 0)
        f = m.bone(f'finger{side}', cl, (cx + 3.5 if sx < 0 else cx + 0.5, 5, -17))
        m.box(f, 'sc_finger', (cx + 3 if sx < 0 else cx, 4, -21), (1, 2, 4), mirror=sx < 0)
        for i, z in enumerate((-5, -3, -1, 1)):
            name = f'leg{side}{i}'
            lb = m.bone(name, 'body', (3.5 * sx, 5, z), rot=(0, (-30 + i * 20) * -sx, 25 * -sx))
            x0 = 3.5 * sx - 6 if sx < 0 else 3.5 * sx
            m.box(lb, 'sc_femur', (x0, 4.5, z - 0.5), (6, 1, 1), mirror=sx > 0)
            kx = 3.5 * sx + 6 * sx
            kb = m.bone(name + 'k', lb, (kx, 5, z))
            m.box(kb, 'sc_tibia', (kx - 0.5, 0, z - 0.5), (1, 5, 1))

    def shellp(c, F, seed, base=shell):
        T.mat_box(c, F, base, 'leather', seed=seed)
        for name, r in F.rects.items():
            if F.kinds.get(name) == 'down':
                c.fill(r, T.light(base, 1.15), 0.04)
                continue
            c.hl(r, r[3] - 1, dark_)
            if F.kinds.get(name) == 'up':
                for j in range(0, r[3], 2):
                    c.hl(r, j, T.dark(base, 0.85))
                c.vl(r, r[2] // 2, T.light(base, 1.15))
    m.painters['sc_seg1'] = lambda c, F: shellp(c, F, 1)
    m.painters['sc_seg2'] = lambda c, F: shellp(c, F, 2)
    m.painters['sc_seg3'] = lambda c, F: shellp(c, F, 3)

    def headp(c, F):
        shellp(c, F, 4)
        up = F['up']
        glow_eyes(c, up, [(2, 1), (3, 1)], '#ff2010')
        c.at(up, 0, 0, '#1a1008')
        c.at(up, up[2] - 1, 0, '#1a1008')
        fr = F['front']
        c.hl(fr, fr[3] - 1, '#2a1a08')
    m.painters['sc_head'] = headp
    m.painters['sc_tail'] = lambda c, F: (shellp(c, F, 5), [c.hl(r, 0, dark_) for r in F.sides()])
    m.painters['sc_tail2'] = lambda c, F: shellp(c, F, 6, T.dark(shell, 0.85))

    def stingp(c, F):
        T.mat_box(c, F, T.C('#3a2410'), 'metal', seed=7)
        for r in F.sides():
            c.at(r, 0, 0, '#c8a060')
    m.painters['sc_sting'] = stingp
    m.painters['sc_barb'] = lambda c, F: (T.mat_box(c, F, T.C('#141008'), 'metal', seed=8), c.at(F['front'], 0, 0, '#6a8a20', glow=True))
    m.painters['sc_arm'] = lambda c, F: shellp(c, F, 9)

    def clawp(c, F):
        shellp(c, F, 10)
        for r in F.sides():
            c.hl(r, 0, T.light(shell, 1.2))
    m.painters['sc_claw'] = clawp

    def fingerp(c, F):
        shellp(c, F, 11, T.dark(shell, 0.9))
        for name in ('right', 'left'):
            r = F[name]
            fi = front_i(F, name)
            c.vl(r, fi, '#2a1a08')
        c.fill(F['front'], '#2a1a08', 0)
    m.painters['sc_finger'] = fingerp
    m.painters['sc_femur'] = lambda c, F: shellp(c, F, 12)
    m.painters['sc_tibia'] = lambda c, F: (shellp(c, F, 13, T.dark(shell, 0.9)), [c.hl(r, r[3] - 1, '#2a1a08') for r in F.sides()])
    bones = {}
    for i in range(4):
        for side, sg in (('R', 1), ('L', -1)):
            ph = i * 90 + (0 if side == 'R' else 180)
            bones[f'leg{side}{i}'] = {'rotation': [0, f'{sg} * math.cos(q.modified_distance_moved * 60 + {ph}) * 16 * q.modified_move_speed',
                                                  f'{sg} * -math.abs(math.sin(q.modified_distance_moved * 60 + {ph})) * 12 * q.modified_move_speed']}
    bones['tail0'] = {'rotation': [f'math.sin(q.life_time * 90) * 4 - {ATK} * 30', 'math.sin(q.life_time * 70) * 6', 0]}
    an = {
        'move': {'loop': True, 'bones': bones},
        'idle': {'loop': True, 'bones': {
            'tail3': {'rotation': [f'math.sin(q.life_time * 120) * 5 + {ATK} * 25', 0, 0]},
            'stinger': {'rotation': [f'{ATK} * 40', 0, 0]},
            'fingerR': {'rotation': [0, f'-math.abs(math.sin(q.life_time * 200)) * 12 - {ATK} * 20', 0]},
            'fingerL': {'rotation': [0, f'math.abs(math.sin(q.life_time * 200)) * 12 + {ATK} * 20', 0]},
            'armR': {'rotation': [f'-{ATK} * 20', f'math.sin(q.life_time * 80) * 5', 0]},
            'armL': {'rotation': [f'-{ATK} * 20', f'-math.sin(q.life_time * 80) * 5', 0]},
        }},
    }
    return Mob('scorpion', m, an, ('#c2a060', '#8a6a30'))


# --------------------------------------------------------------------------------------
# Lobo huargo
# --------------------------------------------------------------------------------------
def mob_dire_wolf():
    m = Model('geometry.rpg.dire_wolf', 64, 64, bw=2.5, bh=2)
    fur = T.C('#3d3d44')
    pale = T.C('#7a7a84')
    m.bone('root')
    m.bone('body', 'root', (0, 10, 0))
    m.box('body', 'dw_body', (-3.5, 7, -5), (7, 7, 12))
    m.box('body', 'dw_mane', (-4.5, 6.5, -8), (9, 9, 6))
    m.bone('head', 'body', (0, 12, -8))
    m.box('head', 'dw_head', (-3, 9.5, -13), (6, 6, 5))
    m.box('head', 'dw_snout', (-1.5, 9.5, -17), (3, 3, 4))
    m.box('head', 'dw_ear', (-3, 15.5, -10.5), (2, 3, 1))
    m.box('head', 'dw_ear', (1, 15.5, -10.5), (2, 3, 1), mirror=True)
    m.bone('jaw', 'head', (0, 9.8, -13))
    m.box('jaw', 'dw_jaw', (-1.5, 8.5, -16.5), (3, 1, 4))
    for name, x, z in (('legFR', -2.2, -3.5), ('legFL', 2.2, -3.5), ('legBR', -2.2, 5), ('legBL', 2.2, 5)):
        b = m.bone(name, 'root', (x, 8, z))
        m.box(b, 'dw_leg', (x - 1.5, 0, z - 1.5), (3, 8, 3), mirror=x > 0)
    m.bone('tail', 'body', (0, 12.5, 6.5), rot=(-35, 0, 0))
    m.box('tail', 'dw_tail', (-1, 11.5, 6.5), (2, 2, 6))
    m.box('tail', 'dw_tailf', (-1.5, 11, 11), (3, 3, 5))

    def furp(c, F, seed, base=fur, tips=True):
        T.mat_box(c, F, base, 'fur', seed=seed)
        if tips:
            for name, r in F.rects.items():
                if F.kinds.get(name) in ('up', 'back', 'side'):
                    for i in range(0, r[2], 2):
                        c.at(r, i, 0, T.mix(base, pale, 0.6))
                if F.kinds.get(name) == 'down':
                    c.fill(r, T.mix(base, pale, 0.4), 0.05)
    m.painters['dw_body'] = lambda c, F: (furp(c, F, 1), [c.at(r, 3, 4, T.mix(fur, '#e0c0b0', 0.4)) or c.at(r, 4, 5, T.mix(fur, '#e0c0b0', 0.4)) for r in (F['right'],)])

    def manep(c, F):
        furp(c, F, 2, T.dark(fur, 0.85))
        for r in F.all():
            jag(c, r, 3 + r[0], 1, prob=0.4)
        fr = F['front']
        c.area(fr, 2, 3, 5, 5, T.mix(fur, pale, 0.5))
    m.painters['dw_mane'] = manep

    def headp(c, F):
        furp(c, F, 4, tips=False)
        fr = F['front']
        glow_eyes(c, fr, [(1, 2), (4, 2)], '#ff3020', core=[(1, 2), (4, 2)])
        c.at(fr, 2, 2, '#140808')
        c.at(fr, 3, 2, '#140808')
        c.hl(fr, 1, T.dark(fur, 0.6))
        c.at(fr, 4, 1, T.mix(fur, '#e0c0b0', 0.5))
        c.at(fr, 5, 0, T.mix(fur, '#e0c0b0', 0.5))
    m.painters['dw_head'] = headp

    def snoutp(c, F):
        furp(c, F, 5, T.mix(fur, pale, 0.3), tips=False)
        fr = F['front']
        c.area(fr, 1, 0, 1, 1, '#0a0a0a')
        c.at(fr, 0, 0, '#1a1a1a')
        c.at(fr, 2, 0, '#1a1a1a')
        c.hl(fr, fr[3] - 1, '#f0ecd8')
        for r in (F['right'], F['left']):
            c.hl(r, r[3] - 1, '#2a0a0a')
            c.at(r, front_i(F, 'right' if r is F['right'] else 'left'), r[3] - 1, '#f0ecd8')
    m.painters['dw_snout'] = snoutp
    m.painters['dw_ear'] = lambda c, F: (furp(c, F, 6, tips=False), c.at(F['front'], 0, 1, '#6a3a3a'), c.at(F['front'], 0, 2, '#6a3a3a'))
    m.painters['dw_jaw'] = lambda c, F: (furp(c, F, 7, T.mix(fur, pale, 0.3), tips=False), c.hl(F['up'], 0, '#f0ecd8'), [c.at(r, 0, 0, '#f0ecd8') for r in (F['right'], F['left'])])

    def legp(c, F):
        furp(c, F, 8, tips=False)
        for r in F.sides():
            c.hl(r, r[3] - 1, '#1a1a1a')
            c.hl(r, 0, T.dark(fur, 0.8))
        c.fill(F['down'], '#1a1a1a', 0.05)
    m.painters['dw_leg'] = legp
    m.painters['dw_tail'] = lambda c, F: furp(c, F, 9)
    m.painters['dw_tailf'] = lambda c, F: (furp(c, F, 10, T.dark(fur, 0.9)), c.fill(F['back'], pale, 0.05))
    w = lambda a, neg=False: walk(a, neg=neg)
    an = {
        'move': {'loop': True, 'bones': {
            'legFR': {'rotation': [w(45), 0, 0]}, 'legBL': {'rotation': [w(45), 0, 0]},
            'legFL': {'rotation': [w(45, True), 0, 0]}, 'legBR': {'rotation': [w(45, True), 0, 0]},
            'body': {'rotation': [f'math.sin(q.modified_distance_moved * 76.34) * 2 * q.modified_move_speed', 0, 0]},
        }},
        'idle': {'loop': True, 'bones': {
            'tail': {'rotation': [f'math.sin(q.life_time * 80) * 4', f'math.sin(q.life_time * 220 + (v.phase ?? 0)) * (8 + q.modified_move_speed * 20)', 0]},
            'body': {'position': [0, breath(0.25, 110), 0]},
            'jaw': {'rotation': [f'math.abs(math.sin(q.life_time * 160)) * 4 + {ATK} * 35', 0, 0]},
        }},
        'attack': {'loop': True, 'bones': {'head': {'rotation': [f'{ATK} * 20', 0, 0]}}},
        'look': {'loop': True, 'bones': {'head': {'rotation': ['math.clamp(q.target_x_rotation, -30, 30)', 'math.clamp(q.target_y_rotation, -50, 50)', 0]}}},
    }
    return Mob('dire_wolf', m, an, ('#3d3d42', '#ff3030'))


# --------------------------------------------------------------------------------------
# Mímico
# --------------------------------------------------------------------------------------
def mob_mimic():
    m = Model('geometry.rpg.mimic', 64, 64, bw=2, bh=2)
    wood = T.C('#8a5a2a')
    iron = T.C('#4a4a54')
    flesh = T.C('#6a0a18')
    m.bone('root')
    m.bone('base', 'root', (0, 0, 0))
    m.box('base', 'mi_base', (-7, 0, -7), (14, 10, 14))
    m.plane('base', 'mi_teeth_lo', (-6, 10, -6.3), (12, 2, 0), face='north')
    m.plane('base', 'mi_teeth_side', (-6.3, 10, -6), (0, 2, 12), face='east')
    m.plane('base', 'mi_teeth_side', (6.3, 10, -6), (0, 2, 12), face='east')
    m.bone('lid', 'root', (0, 10, 7))
    m.box('lid', 'mi_lid', (-7, 10, -7), (14, 5, 14))
    m.box('lid', 'mi_lock', (-1.5, 8.5, -7.7), (3, 4, 1), light=False)
    m.plane('lid', 'mi_teeth_up', (-6, 8.2, -6.4), (12, 2, 0), face='north')
    m.plane('lid', 'mi_teeth_side2', (-6.4, 8.2, -6), (0, 2, 12), face='east')
    m.plane('lid', 'mi_teeth_side2', (6.4, 8.2, -6), (0, 2, 12), face='east')
    m.bone('tongue', 'base', (0, 10, 3), rot=(-8, 0, 0))
    m.box('tongue', 'mi_tongue', (-2, 9.6, -3), (4, 1, 6))
    m.bone('tongue2', 'tongue', (0, 10, -3), rot=(-10, 0, 0))
    m.box('tongue2', 'mi_tongue2', (-1.5, 9.6, -7), (3, 1, 4))
    for (x, z) in ((-6.5, -6.5), (4.5, -6.5), (-6.5, 4.5), (4.5, 4.5)):
        b = m.bone(f'leg{int(x)}_{int(z)}', 'base', (x + 1, 1, z + 1))
        m.box(b, 'mi_leg', (x, -1.5, z), (2, 3, 2))

    def woodp(c, F, seed, lid=False):
        T.mat_box(c, F, wood, 'wood', seed=seed)
        for name, r in F.rects.items():
            kind = F.kinds.get(name)
            if kind in ('front', 'back', 'side'):
                for j in range(0, r[3], 4 if not lid else 5):
                    c.hl(r, j, T.dark(wood, 0.6))
                c.vl(r, 0, iron)
                c.vl(r, 1, iron)
                c.vl(r, r[2] - 1, iron)
                c.vl(r, r[2] - 2, iron)
                for j in range(1, r[3], 3):
                    c.at(r, 0, j, '#8a8a94')
                    c.at(r, r[2] - 1, j, '#8a8a94')
                c.hl(r, r[3] - 1 if not lid else 0, iron)
            elif kind == 'up':
                for j in range(0, r[3], 4):
                    c.hl(r, j, T.dark(wood, 0.6))
                c.hl(r, 0, iron)
                c.hl(r, r[3] - 1, iron)
                c.vl(r, 0, iron)
                c.vl(r, r[2] - 1, iron)
    def basep(c, F):
        woodp(c, F, 1)
        up = F['up']
        c.fill(up, flesh, 0.08)
        x, y, w, h = up
        for i in range(w):
            for j in range(h):
                if i in (0, w - 1) or j in (0, h - 1):
                    c.at(up, i, j, T.dark(wood, 0.8))
                elif (i * 7 + j * 3) % 11 == 0:
                    c.at(up, i, j, T.dark(flesh, 0.6))
        c.area(up, w // 2 - 2, h // 2 - 1, 4, 3, T.dark(flesh, 0.45))
    m.painters['mi_base'] = basep

    def lidp(c, F):
        woodp(c, F, 2, lid=True)
        dn = F['down']
        c.fill(dn, T.dark(flesh, 0.85), 0.08)
        for i in range(2, dn[2] - 2, 3):
            c.vl(dn, i, T.dark(flesh, 0.6), 2, dn[3] - 2)
        up = F['up']
        c.area(up, up[2] // 2 - 1, 0, 2, up[3], iron)
    m.painters['mi_lid'] = lidp

    def lockp(c, F):
        T.mat_box(c, F, T.C('#e0b030'), 'metal', seed=3)
        fr = F['front']
        c.area(fr, 0, 1, 3, 2, '#fff090', glow=True)
        c.at(fr, 1, 1, '#100800', glow=True)
        c.at(fr, 1, 2, '#100800', glow=True)
        c.at(fr, 0, 1, '#ffd020', glow=True)
        c.at(fr, 2, 2, '#c08010', glow=True)
    m.painters['mi_lock'] = lockp

    def teethp(c, F, down=False):
        r = F['face']
        c.clear(r)
        w, h = r[2], r[3]
        for i in range(w):
            k = i % 3
            for j in range(h):
                tip = (j == h - 1) if not down else (j == 0)
                if tip and k != 1:
                    continue
                c.at(r, i, j, '#f4eed8' if (k == 1 or not tip) else '#d8d0b0')
    m.painters['mi_teeth_lo'] = lambda c, F: teethp(c, F, down=True)
    m.painters['mi_teeth_side'] = lambda c, F: teethp(c, F, down=True)
    m.painters['mi_teeth_up'] = lambda c, F: teethp(c, F)
    m.painters['mi_teeth_side2'] = lambda c, F: teethp(c, F)

    def tonguep(c, F):
        T.mat_box(c, F, T.C('#c04060'), 'skin', seed=4)
        c.vl(F['up'], F['up'][2] // 2, T.dark('#c04060', 0.7))
    m.painters['mi_tongue'] = tonguep
    m.painters['mi_tongue2'] = tonguep
    m.painters['mi_leg'] = lambda c, F: (T.mat_box(c, F, T.C('#4a1a14'), 'leather', seed=5), [c.hl(r, r[3] - 1, '#e8e0c8') for r in F.sides()])
    an = {
        'chomp': {'loop': True, 'bones': {
            'lid': {'rotation': [f'-(math.abs(math.sin(q.life_time * 260)) * (6 + 30 * q.modified_move_speed) + {ATK} * 45)', 0, 0]},
            'tongue': {'rotation': [f'math.sin(q.life_time * 300) * 6 - q.modified_move_speed * 10', f'math.sin(q.life_time * 170) * 10', 0]},
            'tongue2': {'rotation': [f'math.sin(q.life_time * 300 + 90) * 12', f'math.sin(q.life_time * 170 + 90) * 15', 0]},
        }},
        'hop': {'loop': True, 'bones': {
            'base': {'position': [0, 'math.abs(math.sin(q.modified_distance_moved * 60)) * 3 * q.modified_move_speed', 0]},
            'lid': {'position': [0, 'math.abs(math.sin(q.modified_distance_moved * 60)) * 3 * q.modified_move_speed', 0]},
        }},
    }
    return Mob('mimic', m, an, ('#8a5a2a', '#e8c040'))


# --------------------------------------------------------------------------------------
# Gólem ancestral (piedra, runas, musgo)
# --------------------------------------------------------------------------------------
def mob_ancient_golem():
    m = Model('geometry.rpg.ancient_golem', 64, 64, bw=4, bh=3)
    stone = T.C('#8a8a86')
    moss = T.C('#4a7a32')
    rune = T.C('#ff9a20')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (4 * sx, 10, 0))
        m.box(b, 'ag_leg', (-7 if sx < 0 else 1, 0, -3), (6, 10, 6), mirror=sx > 0)
    m.bone('body', 'root', (0, 10, 0), rot=(6, 0, 0))
    m.box('body', 'ag_waist', (-5, 9.5, -3.5), (10, 5, 7))
    m.box('body', 'ag_chest', (-8, 14, -4.5), (16, 11, 9))
    m.box('body', 'ag_moss', (-8, 24.6, -4.5), (16, 1, 9), inflate=0.2)
    m.plane('body', 'ag_vine', (-6, 15, -4.75), (4, 10, 0), face='north')
    m.plane('body', 'ag_vine2', (3, 13, -4.75), (3, 12, 0), face='north')
    for k, (o, r) in enumerate((((-6, 22, 1), (-20, 10, 15)), ((2, 23, 0), (-10, -20, -10)), ((-2, 19, 3), (-45, 0, 5)))):
        m.box('body', 'ag_rock', o, (4, 4, 4), rot=r, pivot=(o[0] + 2, o[1], o[2] + 2))
    m.bone('head', 'body', (0, 24, -2))
    m.box('head', 'ag_head', (-4, 21.5, -8), (8, 7, 7))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (9 * sx, 23, 0))
        m.box(b, 'ag_arm', (-14 if sx < 0 else 8, 9, -3), (6, 15, 6), mirror=sx > 0)
        m.box(b, 'ag_fist', (-15 if sx < 0 else 7, 2, -4), (8, 7, 8), mirror=sx > 0)
        m.box(b, 'ag_mosspad', (-14 if sx < 0 else 8, 23.6, -3), (6, 1, 6), inflate=0.25, mirror=sx > 0)

    def stonep(c, F, seed, base=stone, runes=0, mossy=False):
        T.mat_box(c, F, base, 'stone', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            kind = F.kinds.get(name)
            if mossy and kind in ('up', 'back', 'side'):
                for _ in range(r[2] * r[3] // 4):
                    i, j = rng.randrange(r[2]), rng.randrange(max(1, r[3] // 3) if kind != 'up' else r[3])
                    c.at(r, i, j, T.mix(moss, '#7aa040', rng.random() * 0.6))
            if runes and kind in ('front', 'side') and r[2] >= 4 and r[3] >= 6:
                for _ in range(runes):
                    x0, y0 = rng.randrange(1, r[2] - 2), rng.randrange(1, r[3] - 3)
                    pat = rng.choice(([(0, 0), (0, 1), (0, 2), (1, 1)], [(0, 0), (1, 0), (1, 1), (1, 2)], [(0, 0), (1, 1), (0, 2)], [(1, 0), (0, 1), (1, 2), (1, 1)]))
                    for (dx, dy) in pat:
                        c.at(r, x0 + dx, y0 + dy, rune, glow=True)
    m.painters['ag_leg'] = lambda c, F: stonep(c, F, 1, runes=1, mossy=True)
    m.painters['ag_waist'] = lambda c, F: stonep(c, F, 2, T.dark(stone, 0.85))

    def chestp(c, F):
        stonep(c, F, 3, mossy=True)
        fr = F['front']
        cx, cy = fr[2] // 2, fr[3] // 2
        for a in range(0, 360, 20):
            i = int(round(cx - 0.5 + 3.4 * math.cos(math.radians(a))))
            j = int(round(cy + 3.4 * math.sin(math.radians(a))))
            c.at(fr, i, j, rune, glow=True)
        c.area(fr, cx - 1, cy - 1, 2, 2, '#ffe080', glow=True)
        for d in (-2, 2):
            c.at(fr, cx - 1 + d, cy, rune, glow=True)
            c.at(fr, cx - 1, cy + d, rune, glow=True)
    m.painters['ag_chest'] = chestp

    def mossp(c, F):
        rng = random.Random(5)
        for r in F.all():
            for i in range(r[2]):
                for j in range(r[3]):
                    if rng.random() < 0.8:
                        c.at(r, i, j, T.mix(moss, '#8ab048', rng.random() * 0.5))
    m.painters['ag_moss'] = mossp
    m.painters['ag_mosspad'] = mossp

    def vinep(c, F, seed):
        r = F['face']
        c.clear(r)
        rng = random.Random(seed)
        for i in range(r[2]):
            if rng.random() < 0.7:
                length = rng.randrange(3, r[3])
                for j in range(length):
                    c.at(r, i, j, T.mix(moss, '#2a5a1a', rng.random() * 0.6))
                if rng.random() < 0.5:
                    c.at(r, i, length - 1, '#d06090')
    m.painters['ag_vine'] = lambda c, F: vinep(c, F, 6)
    m.painters['ag_vine2'] = lambda c, F: vinep(c, F, 7)
    m.painters['ag_rock'] = lambda c, F: stonep(c, F, 8, T.dark(stone, 0.9), mossy=True)

    def headp(c, F):
        stonep(c, F, 9, mossy=True)
        fr = F['front']
        c.hl(fr, 2, T.dark(stone, 0.5), 0, 8)
        c.area(fr, 3, 3, 2, 2, '#ffd040', glow=True)
        c.at(fr, 3, 3, '#fff8c0', glow=True)
        c.at(fr, 2, 3, rune, glow=True)
        c.at(fr, 5, 4, rune, glow=True)
        c.hl(fr, 6, T.dark(stone, 0.55), 2, 6)
    m.painters['ag_head'] = headp
    m.painters['ag_arm'] = lambda c, F: stonep(c, F, 10, runes=2, mossy=True)

    def fistp(c, F):
        stonep(c, F, 11, T.dark(stone, 0.92))
        for r in F.sides():
            for i in range(1, r[2], 2):
                c.at(r, i, r[3] - 1, T.dark(stone, 0.55))
    m.painters['ag_fist'] = fistp
    an = biped_anims(a_leg=22, a_arm=14, atk_amp=90, both_attack=True, body='body')
    an['idle']['bones']['head'] = {'rotation': [0, 'math.sin(q.life_time * 30) * 6', 0]}
    return Mob('ancient_golem', m, an, ('#8a8a8a', '#ff9020'))


# --------------------------------------------------------------------------------------
# Liche eterno (corona, túnica flotante, báculo, almas orbitando)
# --------------------------------------------------------------------------------------
def mob_lich():
    m = Model('geometry.rpg.lich', 64, 64, bw=3.5, bh=3.4)
    robe = T.C('#3a1a4a')
    bone_c = T.C('#cfc6dc')
    green = T.C('#40ff80')
    gold = T.C('#a88a30')
    m.bone('root')
    m.bone('float', 'root', (0, 0, 0))
    m.bone('robe', 'float', (0, 14, 0))
    m.box('robe', 'li_robe', (-5, 1, -3.5), (10, 13, 7), faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side'})
    m.bone('body', 'float', (0, 14, 0))
    m.box('body', 'li_torso', (-4, 14, -2.5), (8, 10, 5))
    m.box('body', 'li_mantle', (-5.5, 20.5, -3.5), (11, 4, 7), faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'up'})
    for sx in (-1, 1):
        m.box('body', 'li_padskull', (-7.5 if sx < 0 else 4.5, 22.5, -1.5), (3, 3, 3), mirror=sx > 0)
    m.bone('cape', 'body', (0, 24, 3), rot=(5, 0, 0))
    m.plane('cape', 'li_cape', (-5, 1, 3.6), (10, 23, 0), face='south')
    m.bone('head', 'body', (0, 24, 0))
    m.box('head', 'li_skull', (-3.5, 24, -3.5), (7, 7, 7))
    m.bone('jaw', 'head', (0, 24.5, 2))
    m.box('jaw', 'li_jaw', (-2.5, 22.5, -3.7), (5, 2, 4))
    b = m.bone('crown', 'head', (0, 31, 0))
    for z in (-4.1, 2.9):
        m.box(b, 'li_crown_x', (-4.1, 30.5, z), (8, 3, 1), faces={'north': 'face', 'south': 'face', 'up': 'top', 'east': 'end', 'west': 'end'})
    for x in (-4.1, 3.1):
        m.box(b, 'li_crown_z', (x, 30.5, -3.1), (1, 3, 6), faces={'east': 'face', 'west': 'face', 'up': 'top'})
    m.box(b, 'li_crown_spike', (-0.5, 33.5, -4.1), (1, 3, 1))
    for side, sx in (('R', -1), ('L', 1)):
        a = m.bone(f'arm{side}', 'body', (5 * sx, 22, 0))
        m.box(a, 'li_sleeve', (-7.5 if sx < 0 else 3.5, 15, -2), (4, 7, 4), faces={'north': 'side', 'south': 'side', 'east': 'side', 'west': 'side', 'up': 'up', 'down': 'down'})
        m.box(a, 'li_arm', (-6.5 if sx < 0 else 4.5, 10, -1), (2, 6, 2), mirror=sx > 0)
        m.box(a, 'li_hand', (-7 if sx < 0 else 4, 8, -1.5), (3, 2, 3), mirror=sx > 0)
    m.bone('staff', 'armR', (-5.5, 9, 0), rot=(-5, 0, 0))
    m.box('staff', 'li_shaft', (-6, -3, -0.5), (1, 29, 1))
    m.box('staff', 'li_staffskull', (-7.5, 26, -2), (4, 4, 4))
    m.bone('staff_fire', 'staff', (-5.5, 31, 0))
    m.box('staff_fire', 'li_fire', (-6.5, 30, -1), (2, 3, 2), light=False)
    m.bone('souls', 'float', (0, 18, 0))
    for k, (x, y, z) in enumerate(((9, 17, -1), (-10, 19, 0), (0, 16, 9), (-1, 21, -10))):
        m.box('souls', 'li_soul', (x, y, z), (2, 2, 2), light=False)

    def robep(c, F, seed, hem=True):
        T.mat_box(c, F, robe, 'cloth', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            if F.kinds.get(name) in ('up', 'down'):
                continue
            for _ in range(r[2] * r[3] // 10):
                c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), T.mix(robe, '#14081a', rng.random()))
            if hem:
                c.hl(r, r[3] - 4, '#b8b8c8')
                for i in range(0, r[2], 2):
                    c.at(r, i, r[3] - 5, green, glow=True)
                jag(c, r, seed + r[0], 3, prob=0.8)
    m.painters['li_robe'] = lambda c, F: robep(c, F, 1)

    def torsop(c, F):
        robep(c, F, 2, hem=False)
        fr = F['front']
        for j in range(1, fr[3] - 1, 2):
            c.hl(fr, j, bone_c, 2, fr[2] - 2)  # costillas a la vista
            c.at(fr, fr[2] // 2, j, T.dark(bone_c, 0.7))
        c.at(fr, fr[2] // 2, 5, green, glow=True)
    m.painters['li_torso'] = torsop

    def mantlep(c, F):
        robep(c, F, 3, hem=False)
        for name, r in F.rects.items():
            if name != 'up':
                c.hl(r, r[3] - 1, gold)
        c.area(F['front'], 4, 1, 3, 2, gold)
        c.at(F['front'], 5, 1, green, glow=True)
    m.painters['li_mantle'] = mantlep

    def skullp(c, F, eyes=True):
        T.mat_box(c, F, bone_c, 'bone', seed=4)
        fr = F['front']
        w = fr[2]
        if eyes:
            c.area(fr, 1, 2 if w > 4 else 1, 2 if w > 4 else 1, 2 if w > 4 else 1, '#0a0810')
            c.area(fr, w - 3 if w > 4 else w - 2, 2 if w > 4 else 1, 2 if w > 4 else 1, 2 if w > 4 else 1, '#0a0810')
            if w > 4:
                glow_eyes(c, fr, [(1, 3), (w - 2, 3)], green, core=[(1, 3), (w - 2, 3)])
                c.at(fr, w // 2, 4, '#2a2030')
                c.hl(fr, 5, '#2a2030', 1, w - 1)
                for i in range(1, w - 1, 2):
                    c.at(fr, i, 5, bone_c)
            else:
                c.at(fr, 0, 1, green, glow=True)
                c.at(fr, w - 1, 1, green, glow=True)
        for r in (F['right'], F['left']):
            c.at(r, r[2] // 2, r[3] // 2, T.dark(bone_c, 0.6))
    m.painters['li_skull'] = skullp
    m.painters['li_padskull'] = skullp
    m.painters['li_jaw'] = lambda c, F: (T.mat_box(c, F, T.dark(bone_c, 0.9), 'bone', seed=5), [c.at(F['front'], i, 0, '#f0ecf8') for i in range(0, F['front'][2], 2)])

    def capep(c, F):
        r = F['face']
        T.mat_fill(c, r, T.dark(robe, 0.75), 'cloth', seed=6)
        rng = random.Random(6)
        for i in range(r[2]):
            cut = rng.randrange(0, 6)
            c.clear(r, i, r[3] - cut, 1, cut)
        c.vl(r, 0, gold, 0, r[3] - 6)
        c.vl(r, r[2] - 1, gold, 0, r[3] - 6)
    m.painters['li_cape'] = capep

    def crownp(c, F):
        T.mat_box(c, F, gold, 'metal', seed=7)
        r = F['face']
        for i in range(r[2]):
            if i % 2:
                c.clear(r, i, 0, 1, 1)
        c.at(r, r[2] // 2, 1, green, glow=True)
    m.painters['li_crown_x'] = crownp
    m.painters['li_crown_z'] = crownp
    m.painters['li_crown_spike'] = lambda c, F: (T.mat_box(c, F, gold, 'metal', seed=8), c.at(F['front'], 0, 1, green, glow=True))

    def sleevep(c, F):
        robep(c, F, 9, hem=False)
        jag(c, F['side'], 10, 2, prob=0.8)
        c.hl(F['side'], 0, gold)
        c.clear(F['down'])
    m.painters['li_sleeve'] = sleevep
    m.painters['li_arm'] = lambda c, F: (T.mat_box(c, F, bone_c, 'bone', seed=11), [c.hl(r, 3, T.dark(bone_c, 0.6)) for r in F.sides()])
    m.painters['li_hand'] = lambda c, F: (T.mat_box(c, F, bone_c, 'bone', seed=12), [[c.at(r, i, r[3] - 1, '#3a3040') for i in range(0, r[2], 2)] for r in F.sides()])
    m.painters['li_shaft'] = lambda c, F: (T.mat_box(c, F, T.C('#2a2018'), 'wood', seed=13), [[c.at(r, 0, j, gold) for j in range(2, r[3], 6)] for r in F.sides()])
    m.painters['li_staffskull'] = skullp

    def firep(c, F):
        for name, r in F.rects.items():
            for i in range(r[2]):
                for j in range(r[3]):
                    c.at(r, i, j, T.mix('#e0ffe8', '#20c050', j / max(1, r[3] - 1)), glow=True)
            if F.kinds.get(name) not in ('up', 'down'):
                c.clear(r, 0, 0, 1, 1)
    m.painters['li_fire'] = firep

    def soulp(c, F):
        for r in F.all():
            c.fill(r, '#a0ffc0', 0.05, glow=True)
            c.at(r, 0, 0, '#ffffff', glow=True)
            c.at(r, 1, 1, '#30d070', glow=True)
    m.painters['li_soul'] = soulp
    an = {
        'float': {'loop': True, 'bones': {
            'float': {'position': [0, 'math.sin(q.life_time * 100 + (v.phase ?? 0)) * 1.2 + 2', 0]},
            'robe': {'rotation': [f'math.sin(q.life_time * 130) * 3 + q.modified_move_speed * 20', 0, 'math.cos(q.life_time * 110) * 2']},
            'cape': {'rotation': [f'math.sin(q.life_time * 120) * 4 + q.modified_move_speed * 25', 0, 0]},
            'souls': {'rotation': [0, 'q.life_time * 90', 0], 'position': [0, 'math.sin(q.life_time * 200) * 1', 0]},
            'staff_fire': {'scale': [1, 'math.sin(q.life_time * 900) * 0.2 + 1.1', 1]},
        }},
        'arms': {'loop': True, 'bones': {
            'armR': {'rotation': [f'-15 - {ATK} * 40', 0, breath(3, 80) + ' + 4']},
            'armL': {'rotation': [f'-30 - {ATK} * 110', f'{ATK} * -25', '-(' + breath(3, 80) + ') - 6']},
            'jaw': {'rotation': [f'math.max(0, math.sin(q.life_time * 150)) * 8 + {ATK} * 20', 0, 0]},
        }},
        'look': {'loop': True, 'bones': {'head': {'rotation': ['math.clamp(q.target_x_rotation, -40, 40)', 'math.clamp(q.target_y_rotation, -60, 60)', 0]}}},
    }
    return Mob('lich', m, an, ('#3a1a4a', '#40ff80'))


# --------------------------------------------------------------------------------------
# Azazel, Señor Demonio (alas, cuernos de carnero, espada llameante)
# --------------------------------------------------------------------------------------
def mob_demon_lord():
    m = Model('geometry.rpg.demon_lord', 64, 64, bw=6, bh=4)
    skin = T.C('#8b1a1a')
    armor = T.C('#1c1a1e')
    fire = T.C('#ff7020')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (3 * sx, 13, 0))
        m.box(b, 'dl_leg', (-5.5 if sx < 0 else 0.5, 2, -2.5), (5, 11, 5), mirror=sx > 0)
        m.box(b, 'dl_hoof', (-5.5 if sx < 0 else 0.5, 0, -3), (5, 2, 6), mirror=sx > 0)
    m.bone('waist', 'root', (0, 13, 0))
    m.box('waist', 'dl_belt', (-6, 12, -3.5), (12, 3, 7))
    m.box('waist', 'dl_skirt', (-6, 6, -3.5), (12, 6, 7), inflate=0.3, faces={'north': 'front', 'south': 'front', 'east': 'side', 'west': 'side'})
    m.bone('body', 'root', (0, 14, 0), rot=(4, 0, 0))
    m.box('body', 'dl_torso', (-6, 14, -3.5), (12, 12, 7))
    m.bone('head', 'body', (0, 26, -0.5))
    m.box('head', 'dl_head', (-4, 26, -4.5), (8, 8, 8))
    m.box('head', 'dl_beard', (-3, 23.5, -5), (6, 3, 2), light=False)
    for side, sx in (('R', -1), ('L', 1)):
        h1 = m.bone(f'horn{side}', 'head', (4 * sx, 32, -1), rot=(0, 0, -20 * sx))
        m.box(h1, 'dl_horn1', (-7 if sx < 0 else 4, 31, -2.5), (3, 3, 3), mirror=sx > 0)
        h2 = m.bone(f'horn{side}_2', h1, (6 * sx, 33.5, -1), rot=(-60, 0, 0))
        m.box(h2, 'dl_horn2', (6 * sx - 1, 33, -1.8), (2, 4, 2))
        h3 = m.bone(f'horn{side}_3', h2, (6 * sx, 37, -1), rot=(-70, 0, 0))
        m.box(h3, 'dl_horn3', (6 * sx - 1, 36.5, -1.8), (2, 3, 2))
        h4 = m.bone(f'horn{side}_4', h3, (6 * sx, 39.5, -1), rot=(-60, 0, 10 * sx))
        m.box(h4, 'dl_horn4', (6 * sx - 0.5, 39, -1.3), (1, 2, 1))
        a = m.bone(f'arm{side}', 'body', (7.5 * sx, 24, 0))
        m.box(a, 'dl_arm', (-11 if sx < 0 else 6, 11, -2.5), (5, 14, 5), mirror=sx > 0)
        m.box(a, 'dl_bracer', (-11 if sx < 0 else 6, 11, -2.5), (5, 5, 5), inflate=0.3, mirror=sx > 0)
        m.box(a, 'dl_pad', (-12 if sx < 0 else 5, 22, -3.5), (7, 4, 7), mirror=sx > 0)
        m.box(a, 'dl_pspike', (-9.5 if sx < 0 else 8.5, 26, -0.5), (1, 3, 1))
        w = m.bone(f'wing{side}', 'body', (2 * sx, 23, 3.5), rot=(0, -30 * sx, 12 * sx))
        m.box(w, 'dl_wbone', (-20 if sx < 0 else 2, 22, 3), (18, 2, 2), mirror=sx > 0)
        m.plane(w, 'dl_wing', (-20 if sx < 0 else 2, 6, 3.8), (18, 17, 0), face='south', mirror=sx > 0)
    m.bone('tail', 'body', (0, 15, 3.5), rot=(-25, 0, 0))
    m.box('tail', 'dl_tail', (-1, 14, 3.5), (2, 2, 10))
    m.bone('tail2', 'tail', (0, 15, 13.5), rot=(-20, 0, 0))
    m.box('tail2', 'dl_tail', (-1, 14, 13), (2, 2, 10))
    m.box('tail2', 'dl_spade', (-2, 14.5, 22.5), (4, 1, 3))
    m.bone('sword', 'armR', (-8.5, 12, 0), rot=(80, 0, 0))
    m.box('sword', 'dl_blade', (-9, 15, -1.5), (1, 20, 3))
    m.box('sword', 'dl_guard', (-9.5, 14, -4), (2, 1, 8))
    m.box('sword', 'dl_grip', (-9, 10, -0.5), (1, 4, 1))
    m.bone('flame', 'sword', (-8.5, 15, 0))
    m.plane('flame', 'dl_flame', (-8.5, 15, -3), (0, 22, 6), face='east', light=False)

    def skinp(c, F, seed):
        T.mat_box(c, F, skin, 'skin', seed=seed)
    m.painters['dl_leg'] = lambda c, F: (skinp(c, F, 1), T.band(c, F, 0, 4, armor, 'metal'), [c.hl(r, 4, fire) for r in F.sides()])
    m.painters['dl_hoof'] = fp(T.C('#141010'), 'leather', 2)
    m.painters['dl_belt'] = lambda c, F: (T.mat_box(c, F, armor, 'metal', seed=3), c.area(F['front'], 4, 0, 4, 3, '#c09030'), c.at(F['front'], 5, 1, fire, glow=True), c.at(F['front'], 6, 1, fire, glow=True))

    def skirtp(c, F):
        T.mat_box(c, F, armor, 'metal', seed=4)
        for r in F.all():
            for i in range(0, r[2], 3):
                c.vl(r, i, T.dark(armor, 0.5))
            c.hl(r, r[3] - 1, fire, glow=True)
            jag(c, r, r[0] + 5, 1, prob=0.3)
    m.painters['dl_skirt'] = skirtp

    def torsop(c, F):
        skinp(c, F, 5)
        fr = F['front']
        w, h = fr[2], fr[3]
        c.vl(fr, w // 2, T.dark(skin, 0.65), 4, h)
        c.hl(fr, 4, T.dark(skin, 0.7), 1, w - 1)
        for j in (6, 8, 10):
            c.hl(fr, j, T.dark(skin, 0.78), 3, w - 3)
        c.area(fr, 0, 0, w, 3, armor)
        c.hl(fr, 3, '#c09030')
        for i in range(1, w - 1, 3):
            c.at(fr, i, 1, fire, glow=True)
        for r in (F['back'], F['right'], F['left']):
            c.area(r, 0, 0, r[2], 3, armor)
    m.painters['dl_torso'] = torsop

    def headp(c, F):
        skinp(c, F, 6)
        fr = F['front']
        c.hl(fr, 2, T.dark(skin, 0.5))
        glow_eyes(c, fr, [(1, 3), (2, 3), (5, 3), (6, 3)], '#ffd020', core=[(2, 3), (5, 3)])
        c.at(fr, 3, 5, T.dark(skin, 0.6))
        c.at(fr, 4, 5, T.dark(skin, 0.6))
        c.hl(fr, 6, '#2a0404', 2, 6)
        c.at(fr, 2, 7, '#f0e8d0')
        c.at(fr, 5, 7, '#f0e8d0')
        up = F['up']
        c.fill(up, '#140a0a', 0.05)
    m.painters['dl_head'] = headp

    def beardp(c, F):
        for name, r in F.rects.items():
            for i in range(r[2]):
                for j in range(r[3]):
                    c.at(r, i, j, T.mix('#ffd060', '#ff3010', j / max(1, r[3] - 1)), glow=True)
            if F.kinds.get(name) in ('front', 'side', 'back'):
                for i in range(0, r[2], 2):
                    c.clear(r, i, r[3] - 1, 1, 1)
    m.painters['dl_beard'] = beardp

    def hornp(c, F, base):
        T.mat_box(c, F, base, 'bone', seed=7)
        for r in F.sides():
            for j in range(0, r[3], 2):
                c.hl(r, j, T.dark(base, 0.75))
    m.painters['dl_horn1'] = lambda c, F: hornp(c, F, T.C('#c8b898'))
    m.painters['dl_horn2'] = lambda c, F: hornp(c, F, T.C('#d8c8a8'))
    m.painters['dl_horn3'] = lambda c, F: hornp(c, F, T.C('#e0d0b0'))
    m.painters['dl_horn4'] = lambda c, F: hornp(c, F, T.C('#3a2a20'))
    m.painters['dl_arm'] = lambda c, F: (skinp(c, F, 8), [c.hl(r, r[3] - 1, '#1a0606') for r in F.sides()])

    def bracerp(c, F):
        T.mat_box(c, F, armor, 'metal', seed=9)
        for r in F.sides():
            c.hl(r, 0, '#c09030')
            c.at(r, r[2] // 2, 2, fire, glow=True)
        c.clear(F['up'])
        c.clear(F['down'])
    m.painters['dl_bracer'] = bracerp
    m.painters['dl_pad'] = lambda c, F: (T.mat_box(c, F, armor, 'metal', seed=10), [c.hl(r, r[3] - 1, '#c09030') for r in F.sides()], [c.at(r, 2, 1, fire, glow=True) for r in F.sides()])
    m.painters['dl_pspike'] = lambda c, F: (T.mat_box(c, F, T.C('#e0d0b0'), 'bone', seed=11), c.fill(F['up'], '#fff0d0', 0))
    m.painters['dl_wbone'] = lambda c, F: (T.mat_box(c, F, T.C('#2a0a0a'), 'bone', seed=12), c.at(F['right'], 0, 0, '#e0d0b0'))

    def wingp(c, F):
        r = F['face']
        c.clear(r)
        w, h = r[2], r[3]
        mem = T.C('#4a0a0a')
        for i in range(w):
            seg = (i % 6) / 5.0
            bottom = h - 1 - int(round(4 * math.sin(seg * math.pi))) - int(i * 0.25)
            for j in range(0, max(1, bottom)):
                col = T.mix(mem, '#a02010', 0.25 * (1 - j / h))
                c.at(r, i, j, col)
        for i in range(0, w, 6):
            for j in range(0, h - 2):
                if c.ga(r, i, j)[3]:
                    c.at(r, i, j, '#1a0404')
        c.hl(r, 0, '#1a0404')
    m.painters['dl_wing'] = wingp
    m.painters['dl_tail'] = lambda c, F: skinp(c, F, 13)
    m.painters['dl_spade'] = lambda c, F: (T.mat_box(c, F, T.C('#2a0606'), 'skin', seed=14), [c.clear(F[n], 0, F[n][3] - 1, 1, 1) or c.clear(F[n], F[n][2] - 1, F[n][3] - 1, 1, 1) for n in ('up', 'down')])

    def bladep(c, F):
        T.mat_box(c, F, T.C('#1a1414'), 'metal', seed=15)
        for name in ('right', 'left'):
            r = F[name]
            c.vl(r, 0, '#ffb040', glow=True)
            c.vl(r, r[2] - 1, '#ffb040', glow=True)
            for j in range(1, r[3], 3):
                c.at(r, 1, j, fire, glow=True)
        c.fill(F['up'], '#ffe080', 0, glow=True)
    m.painters['dl_blade'] = bladep
    m.painters['dl_guard'] = lambda c, F: (T.mat_box(c, F, T.C('#c09030'), 'metal', seed=16), [c.at(r, r[2] // 2, 0, fire, glow=True) for r in F.sides()])
    m.painters['dl_grip'] = fp(T.C('#2a0a0a'), 'leather', 17)

    def flamep(c, F):
        r = F['face']
        c.clear(r)
        w, h = r[2], r[3]
        rng = random.Random(18)
        for j in range(h):
            half = 1.5 + 1.5 * math.sin(j * 0.9) + rng.random()
            for i in range(w):
                d = abs(i - (w - 1) / 2)
                if d <= half:
                    t = d / max(0.1, half)
                    c.at(r, i, j, T.mix('#fff4a0', '#ff4010', t), glow=True)
    m.painters['dl_flame'] = flamep
    an = biped_anims(a_leg=30, a_arm=22, atk_amp=120, body='body')
    an['wings'] = {'loop': True, 'bones': {
        'wingR': {'rotation': [0, 'math.sin(q.life_time * 140) * 14 + 6', 'math.sin(q.life_time * 140 + 60) * 6']},
        'wingL': {'rotation': [0, '-math.sin(q.life_time * 140) * 14 - 6', '-math.sin(q.life_time * 140 + 60) * 6']},
        'tail': {'rotation': [0, 'math.sin(q.life_time * 90) * 15', 0]},
        'tail2': {'rotation': [0, 'math.sin(q.life_time * 90 + 60) * 20', 0]},
        'flame': {'scale': ['math.sin(q.life_time * 1100) * 0.15 + 1', 'math.sin(q.life_time * 900) * 0.08 + 1', 'math.sin(q.life_time * 1300) * 0.2 + 1']},
    }}
    return Mob('demon_lord', m, an, ('#8b1a1a', '#ffd020'))


# --------------------------------------------------------------------------------------
# Wyrm de ceniza (dragón)
# --------------------------------------------------------------------------------------
def mob_ash_dragon():
    m = Model('geometry.rpg.ash_dragon', 128, 128, bw=8, bh=5)
    scale_c = T.C('#3a3434')
    belly = T.C('#c86020')
    ember = T.C('#ff7a20')
    m.bone('root')
    m.bone('body', 'root', (0, 14, 0))
    m.box('body', 'ad_body', (-6, 10, -10), (12, 10, 22))
    for k, z in enumerate((-8, -3, 2, 7)):
        m.box('body', 'ad_spine', (-0.5, 20, z), (1, 3, 3))
    m.bone('neck', 'body', (0, 18, -10), rot=(-25, 0, 0))
    m.box('neck', 'ad_neck', (-3, 15, -20), (6, 6, 10))
    m.box('neck', 'ad_spine2', (-0.5, 21, -18), (1, 2, 3))
    m.box('neck', 'ad_spine2', (-0.5, 21, -14), (1, 2, 3))
    m.bone('head', 'neck', (0, 18, -20), rot=(25, 0, 0))
    m.box('head', 'ad_head', (-5, 14, -31), (10, 7, 11))
    m.box('head', 'ad_snout', (-3.5, 14, -36), (7, 4, 5))
    for sx in (-1, 1):
        m.box('head', 'ad_horn', (-4 if sx < 0 else 2, 20.5, -24), (2, 2, 8), rot=(-25, 0, 0), pivot=(-3 if sx < 0 else 3, 21.5, -24), mirror=sx > 0)
        m.box('head', 'ad_horn2', (-6 if sx < 0 else 5, 17.5, -23), (1, 1, 5), rot=(-10, 25 * -sx, 0), pivot=(-5.5 if sx < 0 else 5.5, 18, -23))
    m.bone('jaw', 'head', (0, 14, -22))
    m.box('jaw', 'ad_jaw', (-4, 11, -35), (8, 3, 13))
    m.plane('jaw', 'ad_teeth', (-3.5, 14, -34.6), (7, 1.5, 0), face='north')
    m.bone('tail', 'body', (0, 15, 12), rot=(8, 0, 0))
    m.box('tail', 'ad_tail1', (-3, 12, 12), (6, 6, 14))
    m.bone('tail2', 'tail', (0, 15, 26), rot=(8, 0, 0))
    m.box('tail2', 'ad_tail2', (-2, 13, 25.5), (4, 4, 12))
    m.bone('tail3', 'tail2', (0, 15, 37.5), rot=(8, 0, 0))
    m.box('tail3', 'ad_tail3', (-1, 14, 37), (2, 2, 10))
    m.plane('tail3', 'ad_tailblade', (0, 12, 42), (0, 6, 6), face='east')
    for side, sx in (('R', -1), ('L', 1)):
        w = m.bone(f'wing{side}', 'body', (6 * sx, 20, -4))
        m.box(w, 'ad_warm', (-22 if sx < 0 else 6, 19, -5), (16, 2, 2), mirror=sx > 0)
        m.plane(w, 'ad_wing', (-22 if sx < 0 else 6, 19.5, -4), (16, 0, 14), face='up', mirror=sx > 0)
        t = m.bone(f'wing{side}_tip', w, (22 * sx, 20, -4))
        m.box(t, 'ad_warm2', (-36 if sx < 0 else 22, 19, -5), (14, 2, 2), mirror=sx > 0)
        m.plane(t, 'ad_wing2', (-36 if sx < 0 else 22, 19.5, -4), (14, 0, 12), face='up', mirror=sx > 0)
    for name, x, z in (('legFR', -5, -6), ('legFL', 5, -6), ('legBR', -5, 6), ('legBL', 5, 6)):
        b = m.bone(name, 'root', (x, 11, z))
        m.box(b, 'ad_leg', (x - 2, 2, z - 2), (4, 9, 4), mirror=x > 0)
        m.box(b, 'ad_claw', (x - 2.5, 0, z - 3.5), (5, 2, 6), mirror=x > 0)

    def scalesp(c, F, seed, base=scale_c, under=True):
        T.mat_box(c, F, base, 'scales', seed=seed)
        rng = random.Random(seed)
        for name, r in F.rects.items():
            kind = F.kinds.get(name)
            if under and kind == 'down':
                c.fill(r, belly, 0.04)
                for j in range(0, r[3], 2):
                    c.hl(r, j, T.dark(belly, 0.7))
                continue
            if kind in ('up', 'side', 'front', 'back') and r[2] * r[3] > 12:
                for _ in range(r[2] * r[3] // 40 + 1):
                    x, y = rng.randrange(r[2]), rng.randrange(r[3])
                    for _k in range(rng.randrange(2, 5)):
                        c.at(r, x, y, ember, glow=True)
                        x += rng.choice((-1, 1))
                        y += rng.choice((0, 1))
    m.painters['ad_body'] = lambda c, F: scalesp(c, F, 1)
    m.painters['ad_spine'] = lambda c, F: (T.mat_box(c, F, T.C('#1a1414'), 'bone', seed=2), c.fill(F['up'], ember, 0, glow=True))
    m.painters['ad_spine2'] = m.painters['ad_spine']
    m.painters['ad_neck'] = lambda c, F: scalesp(c, F, 3)

    def headp(c, F):
        scalesp(c, F, 4)
        for name in ('right', 'left'):
            r = F[name]
            fi = front_i(F, name)
            ex = fi - 3 if fi > 0 else 3
            c.at(r, ex, 2, '#ffb020', glow=True)
            c.at(r, ex + (1 if fi > 0 else -1), 2, '#ff6010', glow=True)
            c.at(r, ex, 1, T.dark(scale_c, 0.5))
        fr = F['front']
        c.hl(fr, 1, T.dark(scale_c, 0.5))
    m.painters['ad_head'] = headp

    def snoutp(c, F):
        scalesp(c, F, 5)
        fr = F['front']
        c.at(fr, 1, 1, '#140808')
        c.at(fr, fr[2] - 2, 1, '#140808')
        c.hl(fr, fr[3] - 1, '#f0e8d0')
        for r in (F['right'], F['left']):
            c.hl(r, r[3] - 1, '#2a0a08')
    m.painters['ad_snout'] = snoutp

    def hornp(c, F):
        T.mat_box(c, F, T.C('#d8ccb0'), 'bone', seed=6)
        for r in F.sides():
            for i in range(0, r[2], 2):
                c.vl(r, i, T.C('#a89878'))
        c.fill(F['back'], '#2a2420', 0)
    m.painters['ad_horn'] = hornp
    m.painters['ad_horn2'] = hornp

    def jawp(c, F):
        scalesp(c, F, 7)
        c.fill(F['up'], '#5a1010', 0.05)
        for r in (F['right'], F['left']):
            for i in range(0, r[2], 2):
                c.at(r, i, 0, '#f0e8d0')
    m.painters['ad_jaw'] = jawp

    def teethp(c, F):
        r = F['face']
        c.clear(r)
        for i in range(0, r[2], 2):
            c.at(r, i, 0, '#f4eedc')
            if r[3] > 1:
                c.at(r, i, 1, '#f4eedc')
    m.painters['ad_teeth'] = teethp
    m.painters['ad_tail1'] = lambda c, F: scalesp(c, F, 8)
    m.painters['ad_tail2'] = lambda c, F: scalesp(c, F, 9)
    m.painters['ad_tail3'] = lambda c, F: scalesp(c, F, 10)

    def bladep(c, F):
        r = F['face']
        c.clear(r)
        w, h = r[2], r[3]
        for i in range(w):
            for j in range(h):
                if abs(j - (h - 1) / 2) <= (h / 2) * (1 - i / max(1, w)) + 0.4:
                    c.at(r, i, j, '#2a2222' if (i + j) % 3 else '#4a3a3a')
        c.at(r, 0, h // 2, ember, glow=True)
    m.painters['ad_tailblade'] = bladep
    m.painters['ad_warm'] = lambda c, F: (T.mat_box(c, F, T.C('#2a2424'), 'bone', seed=11), [c.hl(r, 0, ember) for r in F.sides()])
    m.painters['ad_warm2'] = m.painters['ad_warm']

    def wingp(c, F, seed, tip=False):
        r = F['face']
        c.clear(r)
        w, h = r[2], r[3]
        mem = T.C('#3a1a14')
        rng = random.Random(seed)
        for i in range(w):
            depth = h - int(round(3 * abs(math.sin(i / 4.0 * math.pi)))) - (int(i * 0.5) if tip else 0)
            for j in range(max(2, depth)):
                col = T.mix(mem, '#6a2a14', 0.4 * (1 - j / h))
                if rng.random() < 0.02:
                    col = T.dark(mem, 0.6)
                c.at(r, i, j, col)
            if depth >= 2:
                c.at(r, i, max(1, depth) - 1, ember, glow=True)
        for i in range(0, w, 4):
            for j in range(0, h):
                if c.ga(r, i, j)[3]:
                    c.at(r, i, j, '#1e1414')
    m.painters['ad_wing'] = lambda c, F: wingp(c, F, 12)
    m.painters['ad_wing2'] = lambda c, F: wingp(c, F, 13, tip=True)
    m.painters['ad_leg'] = lambda c, F: scalesp(c, F, 14, under=False)

    def clawp(c, F):
        scalesp(c, F, 15, under=False)
        fr = F['front']
        for i in range(0, fr[2], 2):
            c.at(fr, i, fr[3] - 1, '#f0e8d0')
    m.painters['ad_claw'] = clawp
    w = lambda a, neg=False: walk(a, neg=neg)
    an = {
        'move': {'loop': True, 'bones': {
            'legFR': {'rotation': [w(32), 0, 0]}, 'legBL': {'rotation': [w(32), 0, 0]},
            'legFL': {'rotation': [w(32, True), 0, 0]}, 'legBR': {'rotation': [w(32, True), 0, 0]},
        }},
        'fly': {'loop': True, 'bones': {
            'wingR': {'rotation': [0, 0, 'math.sin(q.life_time * 110) * 22 - 6']},
            'wingL': {'rotation': [0, 0, '-math.sin(q.life_time * 110) * 22 + 6']},
            'wingR_tip': {'rotation': [0, 0, 'math.sin(q.life_time * 110 - 40) * 18']},
            'wingL_tip': {'rotation': [0, 0, '-math.sin(q.life_time * 110 - 40) * 18']},
            'tail': {'rotation': [0, 'math.sin(q.life_time * 70) * 8', 0]},
            'tail2': {'rotation': [0, 'math.sin(q.life_time * 70 - 50) * 12', 0]},
            'tail3': {'rotation': [0, 'math.sin(q.life_time * 70 - 100) * 16', 0]},
            'body': {'position': [0, breath(0.5, 80), 0]},
        }},
        'jaw': {'loop': True, 'bones': {
            'jaw': {'rotation': [f'math.abs(math.sin(q.life_time * 45)) * 8 + {ATK} * 35', 0, 0]},
            'neck': {'rotation': [f'-{ATK} * 10 + math.sin(q.life_time * 40) * 3', 0, 0]},
            'head': {'rotation': [f'{ATK} * 15', 0, 0]},
        }},
        'look': {'loop': True, 'bones': {'neck': {'rotation': [0, 'math.clamp(q.target_y_rotation, -45, 45) * 0.6', 0]}}},
    }
    return Mob('ash_dragon', m, an, ('#3a3434', '#c86020'))


# --------------------------------------------------------------------------------------
# El Rey del Vacío (corona y cuernos, capa estrellada, fragmentos del vacío)
# --------------------------------------------------------------------------------------
def mob_void_king():
    m = Model('geometry.rpg.void_king', 64, 64, bw=4, bh=3.6)
    armor = T.C('#141220')
    trim = T.C('#8a3aff')
    void = T.C('#1a0a2e')
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (2.2 * sx, 13, 0))
        m.box(b, 'vk_leg', (-4.2 if sx < 0 else 0.2, 0, -2), (4, 13, 4), mirror=sx > 0)
    m.bone('body', 'root', (0, 13, 0))
    m.box('body', 'vk_body', (-4.5, 13, -2.5), (9, 12, 5))
    m.box('body', 'vk_core', (-1.5, 18, -3.1), (3, 3, 1), light=False)
    m.box('body', 'vk_skirt', (-5, 4, -3), (10, 9, 6), inflate=0.2, faces={'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side'})
    m.bone('cape', 'body', (0, 25, 2.8), rot=(5, 0, 0))
    m.box('cape', 'vk_cape', (-6, 2, 2.8), (12, 23, 1), faces={'south': 'back', 'north': 'inner', 'east': 'edge', 'west': 'edge'})
    m.bone('head', 'body', (0, 25, 0))
    m.box('head', 'vk_head', (-4, 25, -4), (8, 8, 8))
    cb = m.bone('crown', 'head', (0, 33, 0))
    for z in (-4.6, 3.6):
        m.box(cb, 'vk_crown_x', (-4.6, 32.5, z), (9, 4, 1), faces={'north': 'face', 'south': 'face', 'up': 'top', 'east': 'end', 'west': 'end'})
    for x in (-4.6, 3.6):
        m.box(cb, 'vk_crown_z', (x, 32.5, -3.6), (1, 4, 7), faces={'east': 'face', 'west': 'face', 'up': 'top'})
    for side, sx in (('R', -1), ('L', 1)):
        h = m.bone(f'horn{side}', 'head', (4 * sx, 30, 0), rot=(-15, 0, 35 * sx))
        m.box(h, 'vk_horn', (4 * sx - 1, 30, -1), (2, 5, 2))
        h2 = m.bone(f'horn{side}_2', h, (4 * sx, 35, 0), rot=(-20, 0, -30 * sx))
        m.box(h2, 'vk_horn2', (4 * sx - 0.5, 34.8, -0.5), (1, 4, 1))
        a = m.bone(f'arm{side}', 'body', (6 * sx, 23, 0))
        m.box(a, 'vk_arm', (-8.5 if sx < 0 else 4.5, 11, -2), (4, 12, 4), mirror=sx > 0)
        m.box(a, 'vk_pad', (-9.5 if sx < 0 else 3.5, 21, -3), (6, 4, 6), mirror=sx > 0)
        m.box(a, 'vk_crystal', (-8 if sx < 0 else 6, 24.5, -1), (2, 4, 2), rot=(0, 0, 20 * sx), pivot=(-7 if sx < 0 else 7, 24.5, 0), light=False)
    m.bone('orb', 'armL', (6.5, 9, -1.5))
    m.box('orb', 'vk_orb', (5, 7.5, -3), (3, 3, 3), light=False)
    m.bone('shards', 'root', (0, 20, 0))
    for k, (x, y, z, r) in enumerate(((11, 18, 0, (20, 0, 30)), (-12, 22, 2, (-25, 0, -20)), (0, 16, 11, (30, 20, 0)),
                                     (2, 25, -11, (-30, 0, 15)), (-8, 13, -8, (15, 30, -20)), (8, 27, 7, (-10, -30, 25)))):
        m.box('shards', 'vk_shard' if k % 2 == 0 else 'vk_shard2', (x, y, z), (2, 4, 2) if k % 2 == 0 else (1, 3, 1), rot=r, pivot=(x + 1, y + 2, z + 1), light=False)

    def armorp(c, F, seed):
        T.mat_box(c, F, armor, 'metal', seed=seed)
        for name, r in F.rects.items():
            if F.kinds.get(name) in ('up', 'down'):
                continue
            c.hl(r, 0, trim, glow=True)
    m.painters['vk_leg'] = lambda c, F: (armorp(c, F, 1), [c.hl(r, 7, trim, glow=True) for r in F.sides()])

    def bodyp(c, F):
        armorp(c, F, 2)
        fr = F['front']
        c.vl(fr, 1, trim, glow=True)
        c.vl(fr, fr[2] - 2, trim, glow=True)
        c.hl(fr, 10, '#c0a0ff', glow=True)
    m.painters['vk_body'] = bodyp

    def corep(c, F):
        for r in F.all():
            c.fill(r, '#d040ff', 0.05, glow=True)
        c.at(F['front'], 1, 1, '#ffffff', glow=True)
    m.painters['vk_core'] = corep

    def starsp(c, r, seed, density=10):
        rng = random.Random(seed)
        for i in range(r[2]):
            for j in range(r[3]):
                t = j / max(1, r[3] - 1)
                c.at(r, i, j, T.mix(void, '#3a1060', t * 0.6))
        for _ in range(r[2] * r[3] // density):
            i, j = rng.randrange(r[2]), rng.randrange(r[3])
            c.at(r, i, j, rng.choice(['#ffffff', '#d0a0ff', '#a060ff']), glow=True)

    def skirtp(c, F):
        for name, r in F.rects.items():
            starsp(c, r, 3 + len(name))
            c.hl(r, 0, trim, glow=True)
            jag(c, r, 4 + r[0], 2, prob=0.5)
    m.painters['vk_skirt'] = skirtp

    def capep(c, F):
        T.mat_box(c, F, armor, 'cloth', seed=5)
        starsp(c, F['back'], 6, 8)
        starsp(c, F['inner'], 7, 12)
        r = F['back']
        c.vl(r, 0, trim, glow=True)
        c.vl(r, r[2] - 1, trim, glow=True)
        jag(c, r, 8, 3, prob=0.6)
    m.painters['vk_cape'] = capep

    def headp(c, F):
        T.mat_box(c, F, T.C('#0c0a14'), 'skin', seed=9)
        fr = F['front']
        c.fill(fr, '#06050c', 0.03)
        glow_eyes(c, fr, [(1, 3), (2, 3), (5, 3), (6, 3)], '#e060ff', core=[(2, 3), (5, 3)])
        c.hl(fr, 6, '#3a1060', 2, 6)
        for r in (F['right'], F['left'], F['back']):
            c.hl(r, 0, trim, glow=True)
    m.painters['vk_head'] = headp

    def crownp(c, F):
        T.mat_box(c, F, T.C('#3a1a5a'), 'metal', seed=10)
        r = F['face']
        for i in range(r[2]):
            if i % 2:
                c.clear(r, i, 0, 1, 2)
        c.at(r, r[2] // 2, 2, '#ff60ff', glow=True)
        c.hl(r, r[3] - 1, trim, glow=True)
    m.painters['vk_crown_x'] = crownp
    m.painters['vk_crown_z'] = crownp
    m.painters['vk_horn'] = lambda c, F: (T.mat_box(c, F, T.C('#2a1440'), 'bone', seed=11), [c.hl(r, j, '#4a2470') for r in F.sides() for j in range(0, r[3], 2)])
    m.painters['vk_horn2'] = lambda c, F: (T.mat_box(c, F, T.C('#6a3aa0'), 'bone', seed=12), c.fill(F['up'], '#e0c0ff', 0, glow=True))
    m.painters['vk_arm'] = lambda c, F: (armorp(c, F, 13), T.band(c, F, 9, 12, T.C('#2a2440'), 'metal'))
    m.painters['vk_pad'] = lambda c, F: (armorp(c, F, 14), [c.hl(r, r[3] - 1, trim, glow=True) for r in F.sides()])

    def crystalp(c, F):
        for name, r in F.rects.items():
            for i in range(r[2]):
                for j in range(r[3]):
                    c.at(r, i, j, T.mix('#f0d0ff', '#8a30ff', (i + j) / max(1, r[2] + r[3] - 2)), glow=True)
    m.painters['vk_crystal'] = crystalp
    m.painters['vk_shard'] = crystalp
    m.painters['vk_shard2'] = crystalp

    def orbp(c, F):
        for r in F.all():
            c.fill(r, '#1a0030', 0.05, glow=True)
            c.at(r, 1, 1, '#ff80ff', glow=True)
            c.at(r, 0, 0, '#a040ff', glow=True)
    m.painters['vk_orb'] = orbp
    an = biped_anims(a_leg=30, a_arm=22, atk_amp=110, body='body')
    an['void'] = {'loop': True, 'bones': {
        'shards': {'rotation': [0, 'q.life_time * 60', 0], 'position': [0, 'math.sin(q.life_time * 120) * 1.2', 0]},
        'orb': {'rotation': ['q.life_time * 90', 'q.life_time * 140', 0]},
        'cape': {'rotation': [f'q.modified_move_speed * 28 + math.sin(q.life_time * 100) * 4', 0, 0]},
    }}
    an['attack']['bones']['armL'] = {'rotation': [f'-{ATK} * 100', f'-{ATK} * 20', 0]}
    return Mob('void_king', m, an, ('#1a0a2a', '#d040ff'))


# ======================================================================================
# Espíritus aliados (12 variantes: fuego fatuo, humanoide o bestia según el elemento)
# ======================================================================================
ELEMENTS = ['fuego', 'agua', 'tierra', 'viento', 'rayo', 'hielo', 'luz', 'oscuridad', 'necromancia', 'naturaleza', 'arcano', 'sangre']
ELEMENT_COLORS = ['#ff6a10', '#3a80ff', '#9a6a3a', '#d8ffe8', '#ffe840', '#a0e8ff', '#fff6b0', '#5a1a8a', '#6ae880', '#4ae030', '#d070ff', '#c01020']
SPIRIT_GEO = [0, 0, 1, 0, 2, 2, 0, 1, 1, 2, 0, 0]  # 0 fuego fatuo, 1 humanoide, 2 bestia


def spirit_wisp_model():
    m = Model('geometry.rpg.spirit_wisp', 32, 32, bw=1.5, bh=2)
    m.bone('root')
    m.bone('core', 'root', (0, 10, 0))
    m.box('core', 'sw_core', (-3, 7, -3), (6, 6, 6), light=False)
    m.box('core', 'sw_crown', (-2, 12.5, -2), (4, 4, 4), rot=(0, 45, 0), pivot=(0, 13, 0), light=False)
    m.box('core', 'sw_tail', (-1, 4.5, -1), (2, 3, 2), light=False)
    m.bone('orbit', 'core', (0, 10, 0))
    for (x, z) in ((4.5, -1), (-6.5, -1), (-1, 4.5), (-1, -6.5)):
        m.box('orbit', 'sw_mote', (x, 9, z), (2, 2, 2), light=False)
    m.pack()
    return m


def spirit_wisp_painters(v):
    col = T.C(ELEMENT_COLORS[v])
    el = ELEMENTS[v]
    hot = T.light(col, 1.45)
    deep = T.dark(col, 0.6)

    def core(c, F):
        for name, r in F.rects.items():
            x, y, w, h = r
            for i in range(w):
                for j in range(h):
                    d = max(abs(i - (w - 1) / 2), abs(j - (h - 1) / 2)) / (w / 2)
                    c.at(r, i, j, T.mix(hot, col, d), glow=True)
            if F.kinds.get(name) in ('front',):
                eye = '#ffffff' if el not in ('luz', 'viento') else '#3a3a5a'
                c.at(r, 1, 2, eye, glow=True)
                c.at(r, 4, 2, eye, glow=True)
                c.at(r, 2, 4, deep, glow=True)
                c.at(r, 3, 4, deep, glow=True)
        if el == 'agua':
            for r in F.sides():
                c.at(r, 0, 0, '#e0f4ff', glow=True)
        if el == 'sangre':
            for r in F.sides():
                c.at(r, 2, 5, '#6a0008', glow=True)

    def crown(c, F):
        for name, r in F.rects.items():
            for i in range(r[2]):
                for j in range(r[3]):
                    t = j / max(1, r[3] - 1)
                    c.at(r, i, j, T.mix('#ffffff', col, t * 0.8), glow=True)
            if F.kinds.get(name) not in ('up', 'down'):
                for i in range(0, r[2], 2):
                    c.clear(r, i, 0, 1, 1)
        if el == 'arcano':
            for r in F.sides():
                c.at(r, 1, 2, '#ffffff', glow=True)

    def tail(c, F):
        for r in F.all():
            c.fill(r, T.mix(col, deep, 0.4), 0.05, glow=True)
            c.clear(r, 0, r[3] - 1, 1, 1)

    def mote(c, F):
        for r in F.all():
            c.fill(r, hot, 0.05, glow=True)
            c.at(r, 0, 0, '#ffffff', glow=True)
    return {'sw_core': core, 'sw_crown': crown, 'sw_tail': tail, 'sw_mote': mote}


def spirit_humanoid_model():
    m = Model('geometry.rpg.spirit_humanoid', 64, 64, bw=1.8, bh=2)
    m.bone('root')
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'leg{side}', 'root', (1.6 * sx, 7, 0))
        m.box(b, 'sh_leg', (-3.1 if sx < 0 else 0.1, 0, -1.5), (3, 7, 3), mirror=sx > 0)
    m.bone('body', 'root', (0, 7, 0))
    m.box('body', 'sh_body', (-3.5, 7, -2), (7, 7, 4))
    m.bone('head', 'body', (0, 14, 0))
    m.box('head', 'sh_head', (-3, 14, -3), (6, 6, 6))
    m.box('head', 'sh_crest', (-0.5, 19.5, -2.5), (1, 2, 5))
    for side, sx in (('R', -1), ('L', 1)):
        b = m.bone(f'arm{side}', 'body', (4.5 * sx, 13, 0))
        m.box(b, 'sh_arm', (-6.5 if sx < 0 else 3.5, 6, -1.5), (3, 8, 3), mirror=sx > 0)
        m.box(b, 'sh_shard', (-6.5 if sx < 0 else 4.5, 13.5, -1), (2, 3, 2), rot=(0, 0, 20 * sx), pivot=(-5.5 if sx < 0 else 5.5, 13.5, 0), light=False)
    m.pack()
    return m


def spirit_humanoid_painters(v):
    el = ELEMENTS[v]
    col = T.C(ELEMENT_COLORS[v])
    if el == 'tierra':
        base, mat, accent, eye = T.C('#7a6248'), 'stone', T.C('#ffb040'), '#ffd060'
    elif el == 'oscuridad':
        base, mat, accent, eye = T.C('#241a34'), 'rough', T.C('#a050ff'), '#e080ff'
    else:  # necromancia
        base, mat, accent, eye = T.C('#d8e4d0'), 'bone', T.C('#40ff80'), '#60ff90'

    def body_fill(c, F, seed):
        T.mat_box(c, F, base, mat, seed=seed)
        rng = random.Random(seed + v)
        for name, r in F.rects.items():
            if F.kinds.get(name) in ('down',):
                continue
            for _ in range(max(1, r[2] * r[3] // 14)):
                c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), accent, glow=True)
            if el == 'tierra' and F.kinds.get(name) == 'up':
                c.fill(r, '#4a7a32', 0.1)
            if el == 'oscuridad':
                jag(c, r, seed + r[0], 1, prob=0.25) if F.kinds.get(name) not in ('up',) else None

    def body(c, F):
        body_fill(c, F, 1)
        fr = F['front']
        if el == 'necromancia':
            for j in range(1, fr[3], 2):
                c.hl(fr, j, T.dark(base, 0.6), 1, fr[2] - 1)
            c.at(fr, fr[2] // 2, 3, accent, glow=True)
        else:
            c.area(fr, 2, 2, 3, 3, accent, glow=True)
            c.at(fr, 3, 3, '#ffffff', glow=True)

    def head(c, F):
        body_fill(c, F, 2)
        fr = F['front']
        c.area(fr, 1, 2, 4, 1, T.dark(base, 0.4))
        glow_eyes(c, fr, [(1, 2), (4, 2)], eye, core=[(1, 2), (4, 2)])
        if el == 'necromancia':
            c.hl(fr, 4, '#2a2a2a', 1, 5)
            for i in range(1, 5, 2):
                c.at(fr, i, 4, base)
    return {'sh_leg': lambda c, F: body_fill(c, F, 3), 'sh_body': body, 'sh_head': head,
            'sh_crest': lambda c, F: [c.fill(r, accent, 0.05, glow=True) for r in F.all()],
            'sh_arm': lambda c, F: body_fill(c, F, 4),
            'sh_shard': lambda c, F: [c.fill(r, T.light(accent, 1.2), 0.05, glow=True) for r in F.all()]}


def spirit_beast_model():
    m = Model('geometry.rpg.spirit_beast', 64, 64, bw=1.8, bh=1.5)
    m.bone('root')
    m.bone('body', 'root', (0, 8, 0))
    m.box('body', 'sb_body', (-3, 6, -5), (6, 6, 11))
    for k, z in enumerate((-3, 0, 3)):
        m.box('body', 'sb_spike', (-0.5, 12, z), (1, 2, 2), light=False)
    m.bone('head', 'body', (0, 10, -5))
    m.box('head', 'sb_head', (-2.5, 8, -9.5), (5, 5, 5))
    m.box('head', 'sb_snout', (-1.5, 8, -12), (3, 2, 3))
    m.box('head', 'sb_ear', (-2.5, 13, -7), (1, 2, 1))
    m.box('head', 'sb_ear', (1.5, 13, -7), (1, 2, 1), mirror=True)
    for name, x, z in (('legFR', -2, -3.5), ('legFL', 2, -3.5), ('legBR', -2, 4), ('legBL', 2, 4)):
        b = m.bone(name, 'root', (x, 6, z))
        m.box(b, 'sb_leg', (x - 1, 0, z - 1), (2, 6, 2), mirror=x > 0)
    m.bone('tail', 'body', (0, 11, 6), rot=(20, 0, 0))
    m.box('tail', 'sb_tail', (-1, 10, 6), (2, 2, 7), light=False)
    m.pack()
    return m


def spirit_beast_painters(v):
    el = ELEMENTS[v]
    col = T.C(ELEMENT_COLORS[v])
    if el == 'rayo':
        base, accent = T.C('#f0e070'), T.C('#80e0ff')
    elif el == 'hielo':
        base, accent = T.C('#c8eef8'), T.C('#ffffff')
    else:
        base, accent = T.C('#4a9a30'), T.C('#ff90c0')

    def fur(c, F, seed):
        T.mat_box(c, F, base, 'fur' if el != 'hielo' else 'crystal', seed=seed)
        rng = random.Random(seed + v)
        for name, r in F.rects.items():
            if el == 'rayo' and F.kinds.get(name) in ('side', 'up') and r[3] >= 3:
                x = rng.randrange(r[2])
                for j in range(r[3]):
                    c.at(r, x, j, accent, glow=True)
                    x = max(0, min(r[2] - 1, x + rng.choice((-1, 1))))
            if el == 'naturaleza' and F.kinds.get(name) == 'up':
                for _ in range(2):
                    c.at(r, rng.randrange(r[2]), rng.randrange(r[3]), accent)
            if el == 'hielo':
                c.hl(r, 0, '#ffffff')

    def head(c, F):
        fur(c, F, 1)
        fr = F['front']
        glow_eyes(c, fr, [(1, 2), (3, 2)], '#ffffff' if el != 'hielo' else '#40c0ff', core=[(1, 2), (3, 2)])

    def snout(c, F):
        fur(c, F, 2)
        c.at(F['front'], 1, 0, '#1a1a1a')
    tailc = {'rayo': '#fff4a0', 'hielo': '#e0f8ff', 'naturaleza': '#ffb0d0'}[el]
    return {'sb_body': lambda c, F: fur(c, F, 3), 'sb_head': head, 'sb_snout': snout,
            'sb_ear': lambda c, F: fur(c, F, 4), 'sb_leg': lambda c, F: fur(c, F, 5),
            'sb_spike': lambda c, F: [c.fill(r, accent if el != 'naturaleza' else '#60d040', 0.05, glow=True) for r in F.all()],
            'sb_tail': lambda c, F: [c.fill(r, tailc, 0.05, glow=True) for r in F.all()]}


# ======================================================================================
# Tomate (proyectil) y marcador invisible
# ======================================================================================
def tomato_model():
    m = Model('geometry.rpg.tomato', 16, 16, bw=0.5, bh=0.5, boff=[0, 0.15, 0])
    m.bone('root')
    m.bone('tomato', 'root', (0, 2, 0))
    m.box('tomato', 't_body', (-2, 0, -2), (4, 4, 4))
    m.plane('tomato', 't_leaf', (-2, 4.05, -2), (4, 0, 4), face='up')
    m.box('tomato', 't_stem', (-0.5, 4, -0.5), (1, 1, 1))

    def body(c, F):
        T.mat_box(c, F, T.C('#e03018'), 'skin', seed=1)
        for r in F.sides():
            c.at(r, 1, 1, '#ff8a6a')
            c.hl(r, r[3] - 1, '#a01808')
        c.fill(F['down'], '#a01808', 0.05)
    m.painters['t_body'] = body

    def leaf(c, F):
        r = F['face']
        c.clear(r)
        for (i, j) in ((1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (3, 1), (1, 2), (2, 2), (0, 2), (3, 2), (1, 3), (2, 3)):
            if (i, j) in ((0, 1), (3, 2), (1, 3), (2, 0)):
                c.at(r, i, j, '#3a8a2a')
            elif (i, j) in ((1, 1), (2, 1), (1, 2), (2, 2)):
                c.at(r, i, j, '#4aa030')
    m.painters['t_leaf'] = leaf
    m.painters['t_stem'] = fp(T.C('#3a6a1a'), 'wood', 2)
    m.pack()
    return m


def empty_model():
    m = Model('geometry.rpg.empty', 16, 16, bw=0.1, bh=0.1, boff=[0, 0, 0])
    m.bone('root')
    m.packed = True
    return m


# ======================================================================================
# Animaciones del NPC
# ======================================================================================
def npc_animations():
    tool = "q.property('rpg:tool')"
    mood = "q.property('rpg:mood')"
    hold = f"({tool} == 5 ? -40 : ({tool} == 7 ? -45 : ({tool} == 2 || {tool} == 6 || {tool} == 3 ? -14 : ({tool} > 0 ? -10 : 0))))"
    swing_r = f"({tool} > 0 ? 0.35 : 1.0)"
    a = {
        'animation.rpg.npc.move': {'loop': True, 'bones': {
            'rightLeg': {'rotation': [walk(42), 0, 0]},
            'leftLeg': {'rotation': [walk(42, neg=True), 0, 0]},
            'rightArm': {'rotation': [f'-{W.format(a=38, ph="")} * {swing_r}', 0, 0]},
            'leftArm': {'rotation': [walk(38), 0, 0]},
            'skirt': {'rotation': [f'math.abs({W.format(a=8, ph="")})', 0, 0]},
            'cape': {'rotation': [f'q.modified_move_speed * 28 + math.abs({W.format(a=6, ph="")})', 0, 0]},
            'body': {'position': [0, 'math.abs(math.sin(q.modified_distance_moved * 38.17)) * 0.5 * q.modified_move_speed', 0]},
        }},
        'animation.rpg.npc.idle': {'loop': True, 'bones': {
            'body': {'position': [0, breath(0.18, 80), 0]},
            'rightArm': {'rotation': [hold, 0, breath(2.2, 90) + ' + 2.5']},
            'leftArm': {'rotation': [f'({mood} == 2 ? -12 : 0)', 0, '-(' + breath(2.2, 90) + ') - 2.5']},
            'head': {'rotation': [f'({mood} == 3 ? 6 : 0)', 0, f'({mood} == 1 ? math.sin(q.life_time * 200 + (v.phase ?? 0)) * 4 : 0)']},
            'cape': {'rotation': [f'math.sin(q.life_time * 70 + (v.phase ?? 0)) * 2', 0, 0]},
        }},
        'animation.rpg.npc.attack': {'loop': True, 'bones': {
            'rightArm': {'rotation': [f'-{ATK} * 105', f'{ATK} * 15', 0]},
            'body': {'rotation': [0, f'{ATK} * -10', 0]},
        }},
        'animation.rpg.npc.look': {'loop': True, 'bones': {
            'head': {'rotation': ['math.clamp(q.target_x_rotation, -45, 45)', 'math.clamp(q.target_y_rotation, -70, 70)', 0]},
        }},
        'animation.rpg.npc.extras': {'loop': True, 'bones': {
            'tail': {'rotation': [f'math.sin(q.life_time * 90 + (v.phase ?? 0)) * 6', f'math.sin(q.life_time * 140 + (v.phase ?? 0)) * (14 + q.modified_move_speed * 16)', 0]},
            'tail2': {'rotation': [0, f'math.sin(q.life_time * 140 + 50 + (v.phase ?? 0)) * 18', 0]},
            'wingR': {'rotation': [0, 'math.sin(q.life_time * 700 + (v.phase ?? 0)) * (12 + q.modified_move_speed * 18)', 0]},
            'wingL': {'rotation': [0, '-math.sin(q.life_time * 700 + (v.phase ?? 0)) * (12 + q.modified_move_speed * 18)', 0]},
            'halo': {'rotation': [0, 'q.life_time * 40', 0], 'position': [0, 'math.sin(q.life_time * 120 + (v.phase ?? 0)) * 0.4', 0]},
            'bearR': {'rotation': [0, 0, f'(math.mod(q.life_time + (v.phase ?? 0), 4) < 0.25) ? math.sin(q.life_time * 1600) * 10 : 0']},
            'bearL': {'rotation': [0, 0, f'(math.mod(q.life_time + (v.phase ?? 0) + 1.3, 4) < 0.25) ? -math.sin(q.life_time * 1600) * 10 : 0']},
            'alert': {'rotation': [0, 'q.life_time * 180', 0], 'position': [0, 'math.abs(math.sin(q.life_time * 300)) * 1.5', 0]},
            'tool7_flame': {'scale': ['math.sin(q.life_time * 1300) * 0.12 + 1', 'math.sin(q.life_time * 900) * 0.2 + 1.05', 'math.sin(q.life_time * 1100) * 0.12 + 1']},
            'tool6_orb': {'rotation': [0, 'q.life_time * 90', 0], 'position': [0, 'math.sin(q.life_time * 150) * 0.4', 0]},
            'hat6_tail': {'rotation': [f'q.modified_move_speed * 25 + math.sin(q.life_time * 200) * 5', 0, 0]},
        }},
    }
    return a


NPC_PART_VIS = (
    [{'hat*': False}, {'tool*': False}]
    + [{f'hat{k}*': f"q.property('rpg:hat') == {k}"} for k in HATS]
    + [{f'tool{k}*': f"q.property('rpg:tool') == {k}"} for k in TOOLS]
    + [
        {'alert': "q.property('rpg:alert')"},
        {'lids': "q.property('rpg:mood') == 3 || math.mod(q.life_time + (v.blink_seed ?? 0), 4.2) < 0.12"},
        {'brows': "q.property('rpg:mood') == 2"},
        {'mouth_a': "q.property('rpg:mood') == 2"},
        {'mouth_h': "q.property('rpg:mood') == 1"},
        {'beard': True},
    ]
)


# ======================================================================================
# Partículas
# ======================================================================================
def _uv(name, S):
    x, y, w, h = S[name]
    return {'texture_width': 128, 'texture_height': 128, 'uv': [x, y], 'uv_size': [w, h]}


def _uv_pick(names, S, rnd='v.particle_random_2'):
    """UV elegido al azar entre sprites de la misma fila y tamaño (expresión Molang)."""
    xs = [S[n][0] for n in names]
    y = S[names[0]][1]
    w, h = S[names[0]][2], S[names[0]][3]
    if len(set(S[n][1] for n in names)) != 1:
        raise ValueError('sprites de distintas filas')
    if all(xs[k] == xs[0] + k * w for k in range(len(xs))):
        expr = f'{xs[0]} + math.floor({rnd} * {len(xs)} * 0.999) * {w}'
    else:
        expr = xs[0]
        for k in range(1, len(xs)):
            expr = f'({rnd} < {k / len(xs):.3f}) ? {expr} : {xs[k]}' if k == 1 else f'({rnd} < {k / len(xs):.3f}) ? ({expr}) : {xs[k]}'
    return {'texture_width': 128, 'texture_height': 128, 'uv': [expr, y], 'uv_size': [w, h]}


COLOR_V = ['v.color.r ?? 1', 'v.color.g ?? 1', 'v.color.b ?? 1']
FADE = 'math.clamp(1 - math.pow(v.particle_age / v.particle_lifetime, 2), 0, 1)'
AGE = '(v.particle_age / v.particle_lifetime)'


def _p(ident, material, comps, events=None):
    d = {'format_version': '1.10.0', 'particle_effect': {
        'description': {'identifier': ident, 'basic_render_parameters': {'material': material, 'texture': 'textures/particle/rpg_fx'}},
        'components': comps}}
    if events:
        d['particle_effect']['events'] = events
    return d


def _bb(size, uv, facing='lookat_xyz', direction=None):
    b = {'size': size if isinstance(size, list) else [size, size], 'facing_camera_mode': facing, 'uv': uv}
    if direction:
        b['direction'] = direction
    return b


def _grad(stops, alpha=FADE):
    """Degradado de color a lo largo de la vida con alfa calculado."""
    g = {}
    for t, col in stops:
        cc = T.C(col)
        g[f'{t:.2f}'] = [round(cc[0] / 255, 3), round(cc[1] / 255, 3), round(cc[2] / 255, 3), 1.0]
    return {'color': {'gradient': g, 'interpolant': AGE}}


def particles(S):
    P_ = {}
    shrink = '(1 - v.particle_age / v.particle_lifetime)'
    tint = lambda a=FADE: {'color': COLOR_V + [a]}
    # ---- tintadas con variable.color ----
    P_['rpg:spark'] = _p('rpg:spark', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 1},
        'minecraft:emitter_shape_point': {'direction': ['math.random(-1, 1)', 'math.random(-0.2, 1)', 'math.random(-1, 1)']},
        'minecraft:particle_initial_speed': 0.35,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.35 + v.particle_random_1 * 0.3'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 2.5, 'linear_acceleration': [0, 0.4, 0]},
        'minecraft:particle_appearance_billboard': _bb([f'(0.05 + v.particle_random_3 * 0.05) * {shrink} + 0.02', f'(0.05 + v.particle_random_3 * 0.05) * {shrink} + 0.02'],
                                                      _uv_pick(['glow', 'star'], S)),
        'minecraft:particle_appearance_tinting': tint(),
    })
    P_['rpg:burst'] = _p('rpg:burst', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 22},
        'minecraft:emitter_shape_sphere': {'radius': 0.25, 'direction': 'outwards'},
        'minecraft:particle_initial_speed': '2.5 + v.particle_random_2 * 2.5',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.35 + v.particle_random_1 * 0.45'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 4.5, 'linear_acceleration': [0, 0.6, 0]},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 'math.random(-180, 180)'},
        'minecraft:particle_appearance_billboard': _bb([f'(0.09 + v.particle_random_3 * 0.1) * {shrink} + 0.02', f'(0.09 + v.particle_random_3 * 0.1) * {shrink} + 0.02'],
                                                      _uv_pick(['glow', 'star'], S)),
        'minecraft:particle_appearance_tinting': tint(),
    })
    P_['rpg:aura'] = _p('rpg:aura', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 26},
        'minecraft:emitter_shape_disc': {'radius': 0.8, 'offset': [0, 0.1, 0], 'plane_normal': 'y', 'surface_only': True, 'direction': [0, 1, 0]},
        'minecraft:particle_initial_speed': '0.8 + v.particle_random_2 * 0.8',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.8 + v.particle_random_1 * 0.6'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.5, 0], 'linear_drag_coefficient': 1.0},
        'minecraft:particle_appearance_billboard': _bb([f'0.08 * {shrink} + 0.03', f'0.08 * {shrink} + 0.03'], _uv_pick(['glow', 'star'], S)),
        'minecraft:particle_appearance_tinting': tint(),
    })
    P_['rpg:orb'] = _p('rpg:orb', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 3},
        'minecraft:emitter_shape_point': {},
        'minecraft:particle_lifetime_expression': {'max_lifetime': 0.16},
        'minecraft:particle_appearance_billboard': _bb(
            ['v.particle_random_1 < 0.34 ? 0.1 : (v.particle_random_1 < 0.67 ? 0.2 : 0.32)', 'v.particle_random_1 < 0.34 ? 0.1 : (v.particle_random_1 < 0.67 ? 0.2 : 0.32)'],
            _uv('glow', S)),
        'minecraft:particle_appearance_tinting': {'color': [
            '(v.color.r ?? 1) + (1 - (v.color.r ?? 1)) * (v.particle_random_1 < 0.34 ? 0.75 : 0)',
            '(v.color.g ?? 1) + (1 - (v.color.g ?? 1)) * (v.particle_random_1 < 0.34 ? 0.75 : 0)',
            '(v.color.b ?? 1) + (1 - (v.color.b ?? 1)) * (v.particle_random_1 < 0.34 ? 0.75 : 0)',
            f'(v.particle_random_1 < 0.67 ? 1 : 0.55) * (1 - {AGE} * 0.5)']},
    })
    P_['rpg:circle'] = _p('rpg:circle', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 1},
        'minecraft:emitter_shape_point': {},
        'minecraft:particle_lifetime_expression': {'max_lifetime': 1.1},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 40},
        'minecraft:particle_appearance_billboard': _bb([f'1.35 + {AGE} * 0.35', f'1.35 + {AGE} * 0.35'], _uv('circle', S),
                                                      facing='direction_y', direction={'mode': 'custom', 'custom_direction': [0, 0, -1]}),
        'minecraft:particle_appearance_tinting': tint(f'math.clamp(math.min({AGE} * 8, 1) * (1 - math.pow({AGE}, 3)) * 0.9, 0, 1)'),
    })
    P_['rpg:birth'] = _p('rpg:birth', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 2},
        'minecraft:emitter_shape_sphere': {'radius': 0.12, 'direction': 'outwards'},
        'minecraft:particle_initial_speed': 0.25,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + v.particle_random_1 * 0.5'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.35, 0], 'linear_drag_coefficient': 1.5},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 90)', 'rotation_rate': 90},
        'minecraft:particle_appearance_billboard': _bb(['(0.05 + v.particle_random_3 * 0.05) * (0.6 + 0.4 * math.sin(v.particle_age * 1500 + v.particle_random_4 * 360))',
                                                       '(0.05 + v.particle_random_3 * 0.05) * (0.6 + 0.4 * math.sin(v.particle_age * 1500 + v.particle_random_4 * 360))'],
                                                      _uv('star', S)),
        'minecraft:particle_appearance_tinting': {'color': ['(v.color.r ?? 1) * 0.7 + 0.3', '(v.color.g ?? 1) * 0.7 + 0.3', '(v.color.b ?? 1) * 0.7 + 0.3', FADE]},
    })
    # ---- impactos de elemento (colores propios) ----
    P_['rpg:fx_fuego'] = _p('rpg:fx_fuego', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 18},
        'minecraft:emitter_shape_sphere': {'radius': 0.45, 'direction': ['math.random(-0.6, 0.6)', 'math.random(0.6, 1.4)', 'math.random(-0.6, 0.6)']},
        'minecraft:particle_initial_speed': '1.0 + v.particle_random_2 * 1.4',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.5 + v.particle_random_1 * 0.5'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': ['math.sin(v.particle_age * 600 + v.particle_random_3 * 360) * 1.5', 2.8, 0], 'linear_drag_coefficient': 1.6},
        'minecraft:particle_appearance_billboard': _bb([f'(0.09 + v.particle_random_3 * 0.08) * {shrink} + 0.02', f'(0.13 + v.particle_random_3 * 0.1) * {shrink} + 0.02'],
                                                      _uv('ember', S), facing='lookat_y'),
        'minecraft:particle_appearance_tinting': _grad([(0, '#fff6b0'), (0.25, '#ffb030'), (0.6, '#f04010'), (1.0, '#3a2a28')]),
    })
    P_['rpg:fx_agua'] = _p('rpg:fx_agua', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 18},
        'minecraft:emitter_shape_sphere': {'radius': 0.3, 'direction': ['math.random(-1, 1)', 'math.random(0.6, 1.6)', 'math.random(-1, 1)']},
        'minecraft:particle_initial_speed': '2.4 + v.particle_random_2 * 1.6',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.7 + v.particle_random_1 * 0.4'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -13, 0], 'linear_drag_coefficient': 0.4},
        'minecraft:particle_motion_collision': {'collision_radius': 0.05, 'expire_on_contact': True},
        'minecraft:particle_appearance_billboard': _bb(['0.05 + v.particle_random_3 * 0.04', '0.07 + v.particle_random_3 * 0.05'], _uv('drop', S), facing='lookat_y'),
        'minecraft:particle_appearance_tinting': _grad([(0, '#d8f0ff'), (0.5, '#60a8ff'), (1.0, '#2a60d0')], alpha='1 - math.pow(v.particle_age / v.particle_lifetime, 4)'),
    })
    P_['rpg:fx_tierra'] = _p('rpg:fx_tierra', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 16},
        'minecraft:emitter_shape_sphere': {'radius': 0.4, 'direction': ['math.random(-1, 1)', 'math.random(0.8, 1.8)', 'math.random(-1, 1)']},
        'minecraft:particle_initial_speed': 'v.particle_random_1 < 0.35 ? 0.6 : 2.6 + v.particle_random_2 * 1.2',
        'minecraft:particle_lifetime_expression': {'max_lifetime': 'v.particle_random_1 < 0.35 ? 1.0 : 0.9 + v.particle_random_2 * 0.4'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 'v.particle_random_1 < 0.35 ? 0.3 : -16', 0], 'linear_drag_coefficient': 'v.particle_random_1 < 0.35 ? 2 : 0.3'},
        'minecraft:particle_motion_collision': {'collision_radius': 0.08, 'coefficient_of_restitution': 0.25, 'collision_drag': 4},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 'math.random(-300, 300)'},
        'minecraft:particle_appearance_billboard': _bb(['v.particle_random_1 < 0.35 ? 0.3 : 0.07 + v.particle_random_3 * 0.06', 'v.particle_random_1 < 0.35 ? 0.3 : 0.07 + v.particle_random_3 * 0.06'],
                                                      {'texture_width': 128, 'texture_height': 128, 'uv': [f'v.particle_random_1 < 0.35 ? {S["dust"][0]} : {S["chunk"][0]}', 0], 'uv_size': [16, 16]}),
        'minecraft:particle_appearance_tinting': {'color': ['0.55 + v.particle_random_4 * 0.2', '0.38 + v.particle_random_4 * 0.15', '0.2 + v.particle_random_4 * 0.1',
                                                            f'v.particle_random_1 < 0.35 ? 0.55 * {FADE} : 1 - math.pow({AGE}, 6)']},
    })
    P_['rpg:fx_viento'] = _p('rpg:fx_viento', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 20},
        'minecraft:emitter_shape_point': {},
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.7 + v.particle_random_1 * 0.3'},
        'minecraft:particle_motion_parametric': {'relative_position': [
            'math.cos(v.particle_age * 600 + v.particle_random_2 * 360) * (0.35 + v.particle_age * 1.1)',
            'v.particle_age * 2.0 + v.particle_random_3 * 0.3 - 0.4',
            'math.sin(v.particle_age * 600 + v.particle_random_2 * 360) * (0.35 + v.particle_age * 1.1)']},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 400},
        'minecraft:particle_appearance_billboard': _bb(['0.13 + v.particle_random_3 * 0.08', '0.13 + v.particle_random_3 * 0.08'], _uv('swirl', S)),
        'minecraft:particle_appearance_tinting': _grad([(0, '#ffffff'), (0.5, '#d8ffe8'), (1.0, '#a8e8c8')]),
    })
    P_['rpg:fx_rayo'] = _p('rpg:fx_rayo', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 12},
        'minecraft:emitter_shape_sphere': {'radius': 0.35, 'direction': 'outwards'},
        'minecraft:particle_initial_speed': 'v.particle_random_1 < 0.5 ? 0.3 : 5',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.12 + v.particle_random_2 * 0.2'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 7},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)'},
        'minecraft:particle_appearance_billboard': _bb(['v.particle_random_1 < 0.5 ? 0.3 + v.particle_random_3 * 0.2 : 0.06', 'v.particle_random_1 < 0.5 ? 0.3 + v.particle_random_3 * 0.2 : 0.06'],
                                                      {'texture_width': 128, 'texture_height': 128,
                                                       'uv': [f'v.particle_random_1 < 0.5 ? (v.particle_random_4 < 0.5 ? {S["bolt_a"][0]} : {S["bolt_b"][0]}) : {S["star"][0]}',
                                                              f'v.particle_random_1 < 0.5 ? {S["bolt_a"][1]} : {S["star"][1]}'], 'uv_size': [16, 16]}),
        'minecraft:particle_appearance_tinting': {'color': ['1', '0.95 + v.particle_random_3 * 0.05', '0.55 + v.particle_random_3 * 0.45',
                                                            'math.mod(math.floor(v.particle_age * 40), 2) == 0 ? 1 : 0.45']},
    })
    P_['rpg:fx_hielo'] = _p('rpg:fx_hielo', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 14},
        'minecraft:emitter_shape_disc': {'radius': 0.8, 'offset': [0, 1.3, 0], 'plane_normal': 'y', 'direction': [0, -1, 0]},
        'minecraft:particle_initial_speed': 'v.particle_random_1 < 0.3 ? 0.2 : 0.6',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.8 + v.particle_random_2 * 0.4'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 'v.particle_random_1 < 0.3 ? -0.3 : -9', 0], 'linear_drag_coefficient': 'v.particle_random_1 < 0.3 ? 2 : 0.2'},
        'minecraft:particle_motion_collision': {'collision_radius': 0.06, 'expire_on_contact': True},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(-30, 30)', 'rotation_rate': 'math.random(-60, 60)'},
        'minecraft:particle_appearance_billboard': _bb(['v.particle_random_1 < 0.3 ? 0.06 : 0.07 + v.particle_random_3 * 0.05', 'v.particle_random_1 < 0.3 ? 0.06 : 0.14 + v.particle_random_3 * 0.08'],
                                                      {'texture_width': 128, 'texture_height': 128, 'uv': [f'v.particle_random_1 < 0.3 ? {S["star"][0]} : {S["shard"][0]}', f'v.particle_random_1 < 0.3 ? {S["star"][1]} : {S["shard"][1]}'], 'uv_size': [16, 16]},
                                                      facing='lookat_y'),
        'minecraft:particle_appearance_tinting': _grad([(0, '#ffffff'), (0.4, '#c8f4ff'), (1.0, '#70c8f0')], alpha='1 - math.pow(v.particle_age / v.particle_lifetime, 5)'),
    })
    P_['rpg:fx_luz'] = _p('rpg:fx_luz', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 14},
        'minecraft:emitter_shape_disc': {'radius': 0.7, 'offset': [0, -0.3, 0], 'plane_normal': 'y', 'direction': [0, 1, 0]},
        'minecraft:particle_initial_speed': '0.8 + v.particle_random_2 * 0.8',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + v.particle_random_1 * 0.5'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 1.2},
        'minecraft:particle_appearance_billboard': _bb(['v.particle_random_4 < 0.25 ? 0.08 : 0.05', 'v.particle_random_4 < 0.25 ? 0.08 : 0.45 + v.particle_random_3 * 0.35'],
                                                      {'texture_width': 128, 'texture_height': 128, 'uv': [f'v.particle_random_4 < 0.25 ? {S["star"][0]} : {S["ray"][0]}', f'v.particle_random_4 < 0.25 ? {S["star"][1]} : {S["ray"][1]}'], 'uv_size': [16, 16]},
                                                      facing='rotate_y'),
        'minecraft:particle_appearance_tinting': _grad([(0, '#ffffff'), (0.5, '#fff6b0'), (1.0, '#ffd860')], alpha=f'math.sin({AGE} * 180)'),
    })
    P_['rpg:fx_oscuridad'] = _p('rpg:fx_oscuridad', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 22},
        'minecraft:emitter_shape_sphere': {'radius': 1.6, 'surface_only': True, 'direction': 'inwards'},
        'minecraft:particle_initial_speed': '1.8 + v.particle_random_2 * 1.2',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + v.particle_random_1 * 0.25'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 1.2},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 'math.random(-120, 120)'},
        'minecraft:particle_appearance_billboard': _bb([f'(0.14 + v.particle_random_3 * 0.12) * {shrink} + 0.03', f'(0.14 + v.particle_random_3 * 0.12) * {shrink} + 0.03'], _uv('mote', S)),
        'minecraft:particle_appearance_tinting': _grad([(0, '#7a3ab0'), (0.5, '#3a1060'), (1.0, '#0a0410')], alpha=f'math.min({AGE} * 4, 1) * 0.9'),
    })
    P_['rpg:fx_necromancia'] = _p('rpg:fx_necromancia', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 12},
        'minecraft:emitter_shape_disc': {'radius': 0.6, 'plane_normal': 'y', 'direction': [0, 1, 0]},
        'minecraft:particle_initial_speed': '0.5 + v.particle_random_2 * 0.6',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.9 + v.particle_random_1 * 0.5'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': ['math.sin(v.particle_age * 700 + v.particle_random_3 * 360) * 3', 0.9,
                                                                      'math.cos(v.particle_age * 700 + v.particle_random_3 * 360) * 3'], 'linear_drag_coefficient': 1.4},
        'minecraft:particle_appearance_billboard': _bb([f'0.1 + v.particle_random_3 * 0.06', f'0.16 + v.particle_random_3 * 0.08'], _uv('wisp', S), facing='lookat_y'),
        'minecraft:particle_appearance_tinting': _grad([(0, '#d8ffe0'), (0.3, '#60ff90'), (0.75, '#20a050'), (1.0, '#0a3018')]),
    })
    P_['rpg:fx_naturaleza'] = _p('rpg:fx_naturaleza', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 14},
        'minecraft:emitter_shape_disc': {'radius': 0.9, 'offset': [0, 1.2, 0], 'plane_normal': 'y', 'direction': [0, -1, 0]},
        'minecraft:particle_initial_speed': 0.3,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '1.1 + v.particle_random_1 * 0.6'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': ['math.sin(v.particle_age * 400 + v.particle_random_3 * 360) * 2.5', -1.4,
                                                                      'math.cos(v.particle_age * 300 + v.particle_random_3 * 360) * 1.5'], 'linear_drag_coefficient': 1.6},
        'minecraft:particle_motion_collision': {'collision_radius': 0.05, 'collision_drag': 10},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 'math.random(-200, 200)'},
        'minecraft:particle_appearance_billboard': _bb(['0.08 + v.particle_random_4 * 0.04', '0.08 + v.particle_random_4 * 0.04'],
                                                      {'texture_width': 128, 'texture_height': 128, 'uv': [f'v.particle_random_2 < 0.25 ? {S["petal"][0]} : {S["leaf"][0]}', S['leaf'][1]], 'uv_size': [16, 16]}),
        'minecraft:particle_appearance_tinting': {'color': ['0.85 + v.particle_random_3 * 0.15', '0.9 + v.particle_random_3 * 0.1', '0.8', '1 - math.pow(v.particle_age / v.particle_lifetime, 6)']},
    })
    P_['rpg:fx_arcano'] = _p('rpg:fx_arcano', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 8},
        'minecraft:emitter_shape_point': {},
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.9 + v.particle_random_1 * 0.3'},
        'minecraft:particle_motion_parametric': {'relative_position': [
            'math.cos(v.particle_age * 260 + v.particle_random_2 * 360) * (0.9 - v.particle_age * 0.3)',
            'v.particle_age * 0.7 - 0.2 + v.particle_random_3 * 0.4',
            'math.sin(v.particle_age * 260 + v.particle_random_2 * 360) * (0.9 - v.particle_age * 0.3)']},
        'minecraft:particle_appearance_billboard': _bb(['0.12 + 0.03 * math.sin(v.particle_age * 900)', '0.12 + 0.03 * math.sin(v.particle_age * 900)'],
                                                      _uv_pick(['rune0', 'rune1', 'rune2', 'rune3'], S, 'v.particle_random_4')),
        'minecraft:particle_appearance_tinting': _grad([(0, '#ffffff'), (0.3, '#f0a0ff'), (1.0, '#a040ff')], alpha=f'math.min({AGE} * 6, 1) * {FADE}'),
    })
    P_['rpg:fx_sangre'] = _p('rpg:fx_sangre', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 16},
        'minecraft:emitter_shape_sphere': {'radius': 0.35, 'direction': ['math.random(-1, 1)', 'math.random(0, 1.2)', 'math.random(-1, 1)']},
        'minecraft:particle_initial_speed': '1.2 + v.particle_random_2 * 1.6',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.7 + v.particle_random_1 * 0.4'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -11, 0], 'linear_drag_coefficient': 0.6},
        'minecraft:particle_motion_collision': {'collision_radius': 0.05, 'expire_on_contact': True},
        'minecraft:particle_appearance_billboard': _bb(['0.045 + v.particle_random_3 * 0.035', '0.065 + v.particle_random_3 * 0.05'], _uv('blood', S), facing='lookat_y'),
        'minecraft:particle_appearance_tinting': _grad([(0, '#e02030'), (0.6, '#a00a14'), (1.0, '#5a0008')], alpha='1 - math.pow(v.particle_age / v.particle_lifetime, 5)'),
    })
    # ---- utilidades del mundo vivo ----
    P_['rpg:rope'] = _p('rpg:rope', 'particles_alpha', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 1},
        'minecraft:emitter_shape_point': {},
        'minecraft:particle_lifetime_expression': {'max_lifetime': 0.15},
        'minecraft:particle_appearance_billboard': _bb(0.055, _uv('rope', S)),
        'minecraft:particle_appearance_lighting': {},
    })
    P_['rpg:tomato_splash'] = _p('rpg:tomato_splash', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 16},
        'minecraft:emitter_shape_sphere': {'radius': 0.15, 'direction': ['math.random(-1, 1)', 'math.random(0.2, 1.3)', 'math.random(-1, 1)']},
        'minecraft:particle_initial_speed': '1.5 + v.particle_random_2 * 2',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + v.particle_random_1 * 0.5'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -10, 0], 'linear_drag_coefficient': 0.8},
        'minecraft:particle_motion_collision': {'collision_radius': 0.05, 'coefficient_of_restitution': 0.1, 'collision_drag': 8},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(0, 360)', 'rotation_rate': 'math.random(-200, 200)'},
        'minecraft:particle_appearance_billboard': _bb(['v.particle_random_4 < 0.2 ? 0.04 : 0.06 + v.particle_random_3 * 0.07', 'v.particle_random_4 < 0.2 ? 0.04 : 0.06 + v.particle_random_3 * 0.07'],
                                                      {'texture_width': 128, 'texture_height': 128, 'uv': [f'v.particle_random_4 < 0.2 ? {S["seed"][0]} : {S["pulp"][0]}', f'v.particle_random_4 < 0.2 ? {S["seed"][1]} : {S["pulp"][1]}'], 'uv_size': [16, 16]}),
        'minecraft:particle_appearance_tinting': {'color': ['1', 'v.particle_random_4 < 0.2 ? 1 : 0.55 + v.particle_random_3 * 0.3', 'v.particle_random_4 < 0.2 ? 1 : 0.7', 'math.clamp((1 - v.particle_age / v.particle_lifetime) * 2, 0, 1)']},
        'minecraft:particle_appearance_lighting': {},
    })
    P_['rpg:coins'] = _p('rpg:coins', 'particles_alpha', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 8},
        'minecraft:emitter_shape_point': {'direction': ['math.random(-0.6, 0.6)', 'math.random(1.2, 1.8)', 'math.random(-0.6, 0.6)']},
        'minecraft:particle_initial_speed': '2.6 + v.particle_random_2 * 1.2',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.9 + v.particle_random_1 * 0.4'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -12, 0], 'linear_drag_coefficient': 0.3},
        'minecraft:particle_motion_collision': {'collision_radius': 0.06, 'coefficient_of_restitution': 0.4, 'collision_drag': 3},
        'minecraft:particle_appearance_billboard': _bb(0.085, {'texture_width': 128, 'texture_height': 128, 'flipbook': {
            'base_UV': [S['coin0'][0], S['coin0'][1]], 'size_UV': [16, 16], 'step_UV': [16, 0], 'frames_per_second': 14, 'max_frame': 4, 'loop': True}}),
        'minecraft:particle_appearance_lighting': {},
    })
    P_['rpg:zzz'] = _p('rpg:zzz', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 1.4},
        'minecraft:emitter_rate_steady': {'spawn_rate': 2.2, 'max_particles': 4},
        'minecraft:emitter_shape_point': {'direction': [0.35, 1, 0.15]},
        'minecraft:particle_initial_speed': 0.32,
        'minecraft:particle_lifetime_expression': {'max_lifetime': 1.7},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': ['math.sin(v.particle_age * 300) * 0.3', 0.05, 0]},
        'minecraft:particle_initial_spin': {'rotation': 'math.random(-15, 15)'},
        'minecraft:particle_appearance_billboard': _bb([f'0.07 + {AGE} * 0.12', f'0.07 + {AGE} * 0.12'], _uv('zzz', S)),
        'minecraft:particle_appearance_tinting': {'color': [1, 1, 1, f'math.min({AGE} * 6, 1) * {FADE}']},
    })
    P_['rpg:alarm'] = _p('rpg:alarm', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 1},
        'minecraft:emitter_shape_point': {'direction': [0, 1, 0]},
        'minecraft:particle_initial_speed': 0.6,
        'minecraft:particle_lifetime_expression': {'max_lifetime': 1.0},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 2.5},
        'minecraft:particle_lifetime_events': {'timeline': {'0.0': 'puff'}},
        'minecraft:particle_appearance_billboard': _bb([f'0.3 + math.sin(math.min({AGE} * 4, 1) * 180) * 0.12', f'0.3 + math.sin(math.min({AGE} * 4, 1) * 180) * 0.12'],
                                                      {'texture_width': 128, 'texture_height': 128, 'flipbook': {
                                                          'base_UV': [S['alarm0'][0], S['alarm0'][1]], 'size_UV': [16, 16], 'step_UV': [16, 0],
                                                          'frames_per_second': 8, 'max_frame': 4, 'stretch_to_lifetime': True}}),
        'minecraft:particle_appearance_tinting': {'color': [1, 1, 1, f'1 - math.pow({AGE}, 4)']},
    }, events={'puff': {'particle_effect': {'effect': 'rpg:alarm_puff', 'type': 'emitter'}}})
    P_['rpg:alarm_puff'] = _p('rpg:alarm_puff', 'particles_blend', {
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_rate_instant': {'num_particles': 8},
        'minecraft:emitter_shape_sphere': {'radius': 0.15, 'direction': 'outwards'},
        'minecraft:particle_initial_speed': 1.6,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.35 + v.particle_random_1 * 0.2'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 5},
        'minecraft:particle_appearance_billboard': _bb([f'0.12 * {shrink} + 0.03', f'0.12 * {shrink} + 0.03'], _uv('smoke', S)),
        'minecraft:particle_appearance_tinting': {'color': [1, 0.3, 0.2, FADE]},
    })
    return P_


# ======================================================================================
# Ensamblado: build(RP)
# ======================================================================================
MOB_BUILDERS = {
    'goblin': lambda: mob_goblin(False), 'dire_wolf': mob_dire_wolf, 'orc': mob_orc, 'scorpion': mob_scorpion,
    'skeleton_knight': mob_skeleton_knight, 'giant_spider': lambda: mob_spider(False), 'wraith': mob_wraith,
    'mimic': mob_mimic, 'dark_mage': mob_dark_mage, 'ice_golem': mob_ice_golem, 'fire_imp': mob_fire_imp,
    'troll': mob_troll, 'demon_knight': mob_demon_knight,
}
BOSS_BUILDERS = {
    'goblin_king': lambda: mob_goblin(True), 'spider_queen': lambda: mob_spider(True), 'ancient_golem': mob_ancient_golem,
    'lich': mob_lich, 'demon_lord': mob_demon_lord, 'ash_dragon': mob_ash_dragon, 'void_king': mob_void_king,
}
INIT = ['v.phase = math.random(0, 360);']


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def _png(rp, rel):
    p = os.path.join(rp, rel + '.png')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def _client(ident, textures, geometry, animations, animate, rc, egg=None, scripts=None, material='entity_alphatest'):
    d = {'identifier': ident, 'materials': {'default': material}, 'textures': textures, 'geometry': geometry,
         'render_controllers': [rc]}
    if animations:
        d['animations'] = animations
    sc = {}
    if scripts:
        sc.update(scripts)
    if animate:
        sc['animate'] = animate
    if sc:
        d['scripts'] = sc
    if egg:
        d['spawn_egg'] = {'base_color': egg[0], 'overlay_color': egg[1]}
    return {'format_version': '1.10.0', 'minecraft:client_entity': {'description': d}}


def _clean(rp):
    """Borra los recursos que genera este módulo (para no dejar restos de la v1)."""
    for sub in ('entity', 'models/entity', 'animations', 'animation_controllers', 'render_controllers', 'particles'):
        d = os.path.join(rp, sub)
        if os.path.isdir(d):
            for name in os.listdir(d):
                p = os.path.join(d, name)
                if os.path.isfile(p) and name.endswith('.json'):
                    os.remove(p)
    for sub in ('textures/entity/rpg', 'font'):
        d = os.path.join(rp, sub)
        if os.path.isdir(d):
            shutil.rmtree(d)
    d = os.path.join(rp, 'textures', 'particle')
    if os.path.isdir(d):
        for name in os.listdir(d):
            if name.startswith('rpg_'):
                os.remove(os.path.join(d, name))


def build(rp):
    """Genera todos los recursos visuales en el RP. Devuelve entradas extra de idioma."""
    _clean(rp)
    geos, anims = [], {}
    rcs = {'controller.render.rpg.default': {'geometry': 'Geometry.default', 'materials': [{'*': 'Material.default'}], 'textures': ['Texture.default']}}
    lang = {}

    # ---------------- NPC ----------------
    models = [npc_model(i) for i in range(len(NPC_GEOS))]
    base_uv = {k: dict(models[0].regions[k].pos) for k in models[0].order}
    for mdl in models:
        geos.append(mdl.geometry())
        for k in mdl.order:
            if dict(mdl.regions[k].pos) != base_uv.get(k):
                raise ValueError(f'UV distinto en {mdl.ident}: {k}')
    npc_tex = {}
    for idx in range(160):
        c = paint_npc(models[0], idx)
        rel = f'textures/entity/rpg/npc/npc_{idx}'
        c.save(_png(rp, rel))
        npc_tex[f's{idx}'] = rel
    for k, v in npc_animations().items():
        anims[k] = v
    npc_anim_names = {'move': 'animation.rpg.npc.move', 'idle': 'animation.rpg.npc.idle', 'look': 'animation.rpg.npc.look',
                      'attack': 'animation.rpg.npc.attack', 'extras': 'animation.rpg.npc.extras'}
    rcs['controller.render.rpg.npc'] = {
        'arrays': {'textures': {'Array.skins': [f'Texture.s{i}' for i in range(160)]},
                   'geometries': {'Array.geos': [f'Geometry.g{i}' for i in range(len(NPC_GEOS))]}},
        'geometry': "Array.geos[q.property('rpg:geo')]",
        'materials': [{'*': 'Material.default'}],
        'textures': ["Array.skins[q.property('rpg:skin')]"],
        'part_visibility': NPC_PART_VIS,
    }
    _write(os.path.join(rp, 'entity', 'npc.entity.json'), _client(
        'rpg:npc', npc_tex, {f'g{i}': g for i, g in enumerate(NPC_GEOS)}, npc_anim_names,
        ['move', 'idle', 'look', 'attack', 'extras'], 'controller.render.rpg.npc', ('#e0c080', '#3a6ea5'),
        scripts={'initialize': INIT + ['v.blink_seed = math.random(0, 4.2);'], 'scale': '0.9375'}))

    # ---------------- Monstruos y jefes ----------------
    for kind, table in (('mob', MOB_BUILDERS), ('boss', BOSS_BUILDERS)):
        for key, fn in table.items():
            mb = fn()
            mdl = mb.model
            geos.append(mdl.geometry())
            rel = f'textures/entity/rpg/{kind}/{key}'
            mdl.texture(seed=zlib.crc32(key.encode()) % 1000).save(_png(rp, rel))
            names = {}
            for short, body in mb.anims.items():
                aid = f'animation.rpg.{key}.{short}'
                anims[aid] = body
                names[short] = aid
            _write(os.path.join(rp, 'entity', f'{key}.entity.json'), _client(
                f'rpg:{key}', {'default': rel}, {'default': mdl.ident}, names, mb.animate,
                'controller.render.rpg.default', mb.egg, scripts={'initialize': list(INIT)}, material=mb.material))

    # ---------------- Espíritus ----------------
    sw, sh, sb = spirit_wisp_model(), spirit_humanoid_model(), spirit_beast_model()
    geos += [sw.geometry(), sh.geometry(), sb.geometry()]
    sp_tex = {}
    for v in range(12):
        g = SPIRIT_GEO[v]
        mdl, pt = ((sw, spirit_wisp_painters(v)), (sh, spirit_humanoid_painters(v)), (sb, spirit_beast_painters(v)))[g]
        rel = f'textures/entity/rpg/spirit/spirit_{v}'
        mdl.texture(seed=v, painters=pt).save(_png(rp, rel))
        sp_tex[f'v{v}'] = rel
    anims['animation.rpg.spirit.float'] = {'loop': True, 'bones': {
        'core': {'position': [0, 'math.sin(q.life_time * 150 + (v.phase ?? 0)) * 1.5', 0], 'rotation': [0, 'q.life_time * 40', 0]},
        'orbit': {'rotation': [0, 'q.life_time * 200', 'math.sin(q.life_time * 90) * 15']},
    }}
    anims['animation.rpg.spirit.walk'] = biped_anims(a_leg=40, a_arm=30, atk_amp=90, body='body')['move']
    anims['animation.rpg.spirit.attack'] = biped_anims(a_leg=40, a_arm=30, atk_amp=90, body='body')['attack']
    anims['animation.rpg.spirit.beast'] = {'loop': True, 'bones': {
        'legFR': {'rotation': [walk(45), 0, 0]}, 'legBL': {'rotation': [walk(45), 0, 0]},
        'legFL': {'rotation': [walk(45, neg=True), 0, 0]}, 'legBR': {'rotation': [walk(45, neg=True), 0, 0]},
        'tail': {'rotation': [0, 'math.sin(q.life_time * 240 + (v.phase ?? 0)) * 18', 0]},
        'head': {'rotation': [f'{ATK} * 25', 0, 0]},
    }}
    rcs['controller.render.rpg.spirit'] = {
        'arrays': {'textures': {'Array.skins': [f'Texture.v{i}' for i in range(12)]},
                   'geometries': {'Array.geos': ['Geometry.wisp', 'Geometry.humanoid', 'Geometry.beast']}},
        'geometry': 'Array.geos[v.geo_idx ?? 0]',
        'materials': [{'*': 'Material.default'}],
        'textures': ["Array.skins[q.property('rpg:variant')]"],
    }
    _write(os.path.join(rp, 'entity', 'spirit.entity.json'), _client(
        'rpg:spirit', sp_tex, {'wisp': sw.ident, 'humanoid': sh.ident, 'beast': sb.ident},
        {'float': 'animation.rpg.spirit.float', 'walk': 'animation.rpg.spirit.walk', 'attack': 'animation.rpg.spirit.attack',
         'beast': 'animation.rpg.spirit.beast'},
        [{'float': 'v.geo_idx == 0'}, {'walk': 'v.geo_idx == 1'}, {'attack': 'v.geo_idx == 1'}, {'beast': 'v.geo_idx == 2'}],
        'controller.render.rpg.spirit', ('#6ae8ff', '#ffffff'),
        scripts={'initialize': list(INIT),
                 'pre_animation': ["v.v = q.property('rpg:variant'); v.geo_idx = (v.v == 2 || v.v == 7 || v.v == 8) ? 1 : ((v.v == 4 || v.v == 5 || v.v == 9) ? 2 : 0);"]}))

    # ---------------- Tomate y marcador ----------------
    tm = tomato_model()
    geos.append(tm.geometry())
    rel = 'textures/entity/rpg/misc/tomato'
    tm.texture().save(_png(rp, rel))
    anims['animation.rpg.tomato.spin'] = {'loop': True, 'bones': {'tomato': {'rotation': ['q.life_time * 720', 'q.life_time * 360', 0]}}}
    _write(os.path.join(rp, 'entity', 'tomato.entity.json'), _client(
        'rpg:tomato', {'default': rel}, {'default': tm.ident}, {'spin': 'animation.rpg.tomato.spin'}, ['spin'],
        'controller.render.rpg.default'))
    em = empty_model()
    geos.append(em.geometry())
    rel = 'textures/entity/rpg/misc/empty'
    T.Pix(16, 16).save(_png(rp, rel))
    _write(os.path.join(rp, 'entity', 'waypoint.entity.json'), _client(
        'rpg:waypoint', {'default': rel}, {'default': em.ident}, None, None, 'controller.render.rpg.default', ('#8a8a8a', '#e8c040')))

    _write(os.path.join(rp, 'models', 'entity', 'rpg.geo.json'), {'format_version': '1.12.0', 'minecraft:geometry': geos})
    _write(os.path.join(rp, 'animations', 'rpg.animation.json'), {'format_version': '1.8.0', 'animations': anims})
    _write(os.path.join(rp, 'render_controllers', 'rpg.render_controllers.json'), {'format_version': '1.8.0', 'render_controllers': rcs})

    # ---------------- Partículas y glifos ----------------
    S = T.particle_atlas(_png(rp, 'textures/particle/rpg_fx'))
    for ident, data in particles(S).items():
        _write(os.path.join(rp, 'particles', ident.split(':')[1] + '.json'), data)
    os.makedirs(os.path.join(rp, 'font'), exist_ok=True)
    T.glyph_sheet(os.path.join(rp, 'font', 'glyph_E3.png'))

    lang['entity.rpg:tomato.name'] = 'Tomate'
    lang['entity.rpg:waypoint.name'] = 'Marcador'
    lang['item.spawn_egg.entity.rpg:waypoint.name'] = 'Generar Marcador'
    return lang


if __name__ == '__main__':
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'packs', 'AetheriaRPG_RP')
    print(build(os.path.abspath(target)))
