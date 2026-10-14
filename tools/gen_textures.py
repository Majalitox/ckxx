"""Generador procedural de texturas (pieles de NPC, monstruos, objetos, bloques y partículas).

Pinta las regiones UV de cada caja de los modelos con colores, ruido y detalles
(cara, pelo, ropa, armadura...). Se ejecuta desde tools/build.py.
"""
import random
from PIL import Image


def hexc(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3])


def noisy(c, rng, amt=0.08):
    f = 1 + rng.uniform(-amt, amt)
    return shade(c, f) + (255,)


class Canvas:
    def __init__(self, w, h, seed=0):
        self.img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.px = self.img.load()
        self.rng = random.Random(seed)
        self.w, self.h = w, h

    def rect(self, x, y, w, h, color, amt=0.08):
        c = hexc(color) if isinstance(color, str) else color
        for i in range(x, x + w):
            for j in range(y, y + h):
                if 0 <= i < self.w and 0 <= j < self.h:
                    self.px[i, j] = noisy(c, self.rng, amt)

    def dot(self, x, y, color, a=255):
        c = hexc(color) if isinstance(color, str) else color
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = tuple(c[:3]) + (a,)

    def box(self, u, v, w, h, d, color, amt=0.08):
        """Rellena toda la región UV de una caja."""
        self.rect(u + d, v, w, d, color, amt)
        self.rect(u + d + w, v, w, d, color, amt)
        self.rect(u, v + d, 2 * (d + w), h, color, amt)

    def faces(self, u, v, w, h, d):
        """Devuelve los rectángulos de cada cara: up, down, right, front, left, back."""
        return {
            'up': (u + d, v, w, d), 'down': (u + d + w, v, w, d),
            'right': (u, v + d, d, h), 'front': (u + d, v + d, w, h),
            'left': (u + d + w, v + d, d, h), 'back': (u + 2 * d + w, v + d, w, h),
        }

    def band(self, u, v, w, h, d, y0, y1, color, amt=0.08):
        """Pinta una franja horizontal (filas y0..y1 de la altura) alrededor de la caja."""
        for f in ('right', 'front', 'left', 'back'):
            x, y, fw, fh = self.faces(u, v, w, h, d)[f]
            self.rect(x, y + y0, fw, y1 - y0, color, amt)

    def save(self, path):
        self.img.save(path)


# --------------------------------------------------------------------------------------
# Humanoide (diseño estándar 64×64)
# --------------------------------------------------------------------------------------
HEAD = (0, 0, 8, 8, 8)
BODY = (16, 16, 8, 12, 4)
RARM = (40, 16, 4, 12, 4)
LARM = (32, 48, 4, 12, 4)
RLEG = (0, 16, 4, 12, 4)
LLEG = (16, 48, 4, 12, 4)


def humanoid(path, spec, seed=0):
    """spec: skin, hair, eyes, shirt, pants, shoes, + opciones (beard, tusks, long_hair, robe, armor, bones, hood, crown, horns, ears, tail, wings, halo, glow)."""
    c = Canvas(64, 64, seed)
    skin = spec.get('skin', '#e0ac69')
    hair = spec.get('hair', '#4a3020')
    shirt = spec.get('shirt', '#3a6ea5')
    pants = spec.get('pants', '#3b3b5a')
    shoes = spec.get('shoes', '#3a2a1a')
    eyes = spec.get('eyes', '#2a4a8a')
    bones = spec.get('bones')
    # Base de piel
    for b in (HEAD, BODY, RARM, LARM, RLEG, LLEG):
        c.box(*b, bones or skin)
    if bones:
        # huesos: costillas y articulaciones oscuras
        x, y, w, h = c.faces(*BODY)['front']
        for r in range(0, 12, 2):
            c.rect(x, y + r + 1, w, 1, shade(hexc(bones), 0.55))
        c.rect(x + 3, y, 2, h, shade(hexc(bones), 0.8))
        for limb in (RARM, LARM, RLEG, LLEG):
            c.band(*limb, 5, 7, shade(hexc(bones), 0.6))
    # Ropa
    if not bones or spec.get('armor') or spec.get('robe'):
        top = spec.get('robe') or spec.get('armor') or shirt
        if not (bones and not spec.get('armor') and not spec.get('robe')):
            c.box(*BODY, top)
            c.band(*RARM, 0, 5, top)
            c.band(*LARM, 0, 5, top)
            leg = spec.get('robe') or pants
            c.box(*RLEG, leg)
            c.box(*LLEG, leg)
            if not spec.get('robe'):
                c.band(*RLEG, 10, 12, shoes)
                c.band(*LLEG, 10, 12, shoes)
            # cinturón
            c.band(*BODY, 10, 11, spec.get('belt', '#4a2e14'))
            if spec.get('robe'):
                c.band(*RARM, 0, 10, top)
                c.band(*LARM, 0, 10, top)
                x, y, w, h = c.faces(*BODY)['front']
                c.rect(x + 3, y, 2, h, shade(hexc(top), 1.25))
    if spec.get('armor'):
        a = hexc(spec['armor'])
        x, y, w, h = c.faces(*BODY)['front']
        c.rect(x + 1, y + 1, w - 2, 5, shade(a, 1.2))
        c.rect(x, y, w, 1, shade(a, 1.4))
        for limb in (RARM, LARM):
            c.band(*limb, 0, 4, shade(a, 1.1))
        for limb in (RLEG, LLEG):
            c.band(*limb, 2, 7, shade(a, 0.9))
        if spec.get('trim'):
            c.band(*BODY, 0, 1, spec['trim'])
            c.band(*BODY, 9, 10, spec['trim'])
    # Cabeza: pelo / capucha / casco
    hf = c.faces(*HEAD)
    if spec.get('hood'):
        hood = spec['hood']
        c.box(*HEAD, hood)
        x, y, w, h = hf['front']
        c.rect(x + 1, y + 2, w - 2, 6, '#141018', 0.05)
        c.rect(x + 2, y + 3, w - 4, 4, bones or skin)
    elif spec.get('helmet'):
        hm = spec['helmet']
        c.box(*HEAD, hm)
        x, y, w, h = hf['front']
        c.rect(x + 1, y + 3, w - 2, 2, '#101010', 0.02)
    elif hair and not spec.get('bald'):
        x, y, w, h = hf['up']
        c.rect(x, y, w, h, hair)
        for f in ('right', 'left'):
            x, y, w, h = hf[f]
            c.rect(x, y, w, 3 if not spec.get('long_hair') else 8, hair)
        x, y, w, h = hf['back']
        c.rect(x, y, w, 8 if spec.get('long_hair') else 6, hair)
        x, y, w, h = hf['front']
        c.rect(x, y, w, 2, hair)
        if spec.get('long_hair'):
            c.rect(x, y + 2, 1, 6, hair)
            c.rect(x + 7, y + 2, 1, 6, hair)
            # pelo cayendo sobre la espalda
            bx, by, bw, bh = c.faces(*BODY)['back']
            c.rect(bx, by, bw, 4, hair)
    # Cara
    x, y, w, h = hf['front']
    if not spec.get('helmet'):
        ew = '#ffffff' if not spec.get('glow') else spec['eyes']
        c.dot(x + 1, y + 4, ew)
        c.dot(x + 2, y + 4, eyes)
        c.dot(x + 5, y + 4, eyes)
        c.dot(x + 6, y + 4, ew)
        if spec.get('glow'):
            for e in (1, 2, 5, 6):
                c.dot(x + e, y + 4, eyes)
        if bones and not spec.get('hood'):
            c.rect(x + 1, y + 3, 2, 2, '#202020', 0.02)
            c.rect(x + 5, y + 3, 2, 2, '#202020', 0.02)
            c.rect(x + 2, y + 6, 4, 1, '#303030', 0.02)
        else:
            c.dot(x + 3, y + 6, shade(hexc(bones or skin), 0.7))
            c.dot(x + 4, y + 6, shade(hexc(bones or skin), 0.7))
    else:
        c.dot(x + 2, y + 4, eyes)
        c.dot(x + 5, y + 4, eyes)
    if spec.get('beard'):
        c.rect(x + 1, y + 5, 6, 3, spec['beard'])
        c.dot(x + 3, y + 6, shade(hexc(bones or skin), 0.6))
        c.dot(x + 4, y + 6, shade(hexc(bones or skin), 0.6))
        for f in ('right', 'left'):
            fx, fy, fw, fh = hf[f]
            c.rect(fx, fy + 5, fw, 3, spec['beard'])
        bx, by, bw, bh = c.faces(*BODY)['front']
        c.rect(bx + 2, by, 4, 3, spec['beard'])
    if spec.get('tusks'):
        c.dot(x + 2, y + 7, '#f0ecd0')
        c.dot(x + 5, y + 7, '#f0ecd0')
        c.dot(x + 2, y + 6, '#f0ecd0')
        c.dot(x + 5, y + 6, '#f0ecd0')
    if spec.get('scales'):
        for _ in range(60):
            fx, fy, fw, fh = c.faces(*HEAD)['front'] if c.rng.random() < 0.2 else c.faces(*BODY)['back']
            c.dot(fx + c.rng.randrange(fw), fy + c.rng.randrange(fh), shade(hexc(skin), 0.75))
    if spec.get('cape'):
        bx, by, bw, bh = c.faces(*BODY)['back']
        c.rect(bx, by, bw, bh, spec['cape'])
    # Extras (regiones libres de la capa externa)
    c.box(0, 32, 8, 2, 8, spec.get('crown', '#e8b830'))  # corona / aureola
    if spec.get('crown'):
        x, y, w, h = c.faces(0, 32, 8, 2, 8)['front']
        c.dot(x + 3, y, '#d02030')
        c.dot(x + 4, y + 1, '#2050d0')
    c.box(40, 32, 2, 4, 2, spec.get('horns', '#2a2420'))
    c.box(48, 32, 2, 4, 2, spec.get('horns', '#2a2420'))
    c.box(32, 0, 1, 3, 2, spec.get('ears', skin))
    c.box(38, 0, 1, 3, 2, spec.get('ears', skin))
    c.box(44, 0, 2, 2, 1, spec.get('ears', hair or skin))
    c.box(50, 0, 2, 2, 1, spec.get('ears', hair or skin))
    c.box(44, 38, 2, 2, 8, spec.get('tail', hair or skin))
    wing = hexc(spec.get('wings', '#c8e8ff'))
    for i in range(32, 44):
        for j in range(36, 46):
            a = 170 if (i + j) % 3 else 220
            c.px[i, j] = wing + (a,)
    if spec.get('translucent'):
        for i in range(64):
            for j in range(16, 64):
                r, g, b, a = c.px[i, j]
                if a and (i, j) not in []:
                    if 16 <= j < 32 and i < 16 or j >= 48 and 16 <= i < 32:
                        c.px[i, j] = (r, g, b, 0)
    c.save(path)


# --------------------------------------------------------------------------------------
# Cuadrúpedo (lobo / bestias) 64×64
# --------------------------------------------------------------------------------------
def quadruped(path, fur, eyes='#ff3030', belly=None, seed=0, glow=False):
    c = Canvas(64, 64, seed)
    c.box(0, 0, 6, 6, 12, fur)          # cuerpo
    c.box(0, 18, 6, 6, 5, fur)          # cabeza
    c.box(22, 18, 3, 3, 3, shade(hexc(fur), 0.85))  # hocico
    c.box(36, 0, 2, 2, 1, shade(hexc(fur), 0.7))
    c.box(42, 0, 2, 2, 1, shade(hexc(fur), 0.7))
    for u in (0, 8, 16, 24):
        c.box(u, 30, 2, 7, 2, shade(hexc(fur), 0.9))
    c.box(36, 4, 2, 2, 7, fur)          # cola
    if belly:
        x, y, w, h = c.faces(0, 0, 6, 6, 12)['down']
        c.rect(x, y, w, h, belly)
    x, y, w, h = c.faces(0, 18, 6, 6, 5)['front']
    c.dot(x + 1, y + 2, eyes)
    c.dot(x + 4, y + 2, eyes)
    x, y, w, h = c.faces(22, 18, 3, 3, 3)['front']
    c.dot(x + 1, y, '#101010')
    c.save(path)


# --------------------------------------------------------------------------------------
# Artrópodo (araña / escorpión) 64×64
# --------------------------------------------------------------------------------------
def arthropod(path, body, accent, eyes='#ff2020', seed=0):
    c = Canvas(64, 64, seed)
    c.box(0, 0, 10, 8, 12, body)
    x, y, w, h = c.faces(0, 0, 10, 8, 12)['up']
    for i in range(0, h, 3):
        c.rect(x + 2, y + i, w - 4, 1, accent)
    c.box(0, 20, 6, 6, 6, shade(hexc(body), 0.85))
    c.box(24, 20, 8, 8, 8, shade(hexc(body), 0.9))
    x, y, w, h = c.faces(24, 20, 8, 8, 8)['front']
    for (ex, ey) in ((1, 2), (2, 2), (5, 2), (6, 2), (2, 4), (5, 4), (3, 3), (4, 3)):
        c.dot(x + ex, y + ey, eyes)
    c.rect(x + 2, y + 6, 1, 2, '#e8e0c8')
    c.rect(x + 5, y + 6, 1, 2, '#e8e0c8')
    c.box(0, 36, 16, 2, 2, shade(hexc(body), 0.75))
    c.save(path)


# --------------------------------------------------------------------------------------
# Mímico (cofre) 64×64
# --------------------------------------------------------------------------------------
def mimic(path, seed=0):
    c = Canvas(64, 64, seed)
    c.box(0, 0, 14, 5, 14, '#8a5a2a')
    c.box(0, 19, 14, 10, 14, '#7a4a20')
    for (u, v, w, h, d) in ((0, 0, 14, 5, 14), (0, 19, 14, 10, 14)):
        f = c.faces(u, v, w, h, d)
        for k in ('front', 'back', 'right', 'left'):
            x, y, fw, fh = f[k]
            c.rect(x, y, fw, 1, '#3a2410')
            c.rect(x, y + fh - 1, fw, 1, '#3a2410')
    x, y, w, h = c.faces(0, 19, 14, 10, 14)['up']
    c.rect(x, y, w, h, '#5a0a10')
    for i in range(0, w, 2):
        c.dot(x + i, y, '#f0f0e0')
        c.dot(x + i, y + h - 1, '#f0f0e0')
    x, y, w, h = c.faces(0, 0, 14, 5, 14)['down']
    c.rect(x, y, w, h, '#5a0a10')
    for i in range(0, w, 2):
        c.dot(x + i, y + h - 1, '#f0f0e0')
    c.box(0, 43, 4, 1, 6, '#c03040')
    c.box(20, 43, 2, 4, 1, '#e8c040')
    x, y, w, h = c.faces(0, 0, 14, 5, 14)['front']
    c.dot(x + 4, y + 2, '#ffd020')
    c.dot(x + 9, y + 2, '#ffd020')
    c.save(path)


# --------------------------------------------------------------------------------------
# Espíritu elemental (fuego fatuo) 32×32
# --------------------------------------------------------------------------------------
def wisp(path, color, seed=0):
    c = Canvas(32, 32, seed)
    col = hexc(color)
    c.box(0, 0, 6, 6, 6, shade(col, 1.0), 0.15)
    x, y, w, h = c.faces(0, 0, 6, 6, 6)['front']
    c.rect(x + 1, y + 1, 4, 4, shade(col, 1.35), 0.05)
    c.dot(x + 1, y + 2, '#ffffff')
    c.dot(x + 4, y + 2, '#ffffff')
    c.box(0, 12, 2, 2, 2, shade(col, 1.2), 0.1)
    c.save(path)


# --------------------------------------------------------------------------------------
# Dragón 128×128
# --------------------------------------------------------------------------------------
def dragon(path, body, belly, wing, eyes='#ff8000', seed=0):
    c = Canvas(128, 128, seed)
    c.box(0, 0, 12, 10, 22, body)
    x, y, w, h = c.faces(0, 0, 12, 10, 22)['down']
    c.rect(x, y, w, h, belly)
    x, y, w, h = c.faces(0, 0, 12, 10, 22)['up']
    for i in range(0, h, 4):
        c.rect(x + 5, y + i, 2, 2, shade(hexc(body), 0.6))
    c.box(68, 0, 6, 6, 10, body)
    c.box(0, 32, 10, 8, 12, body)
    x, y, w, h = c.faces(0, 32, 10, 8, 12)['front']
    c.dot(x + 2, y + 2, eyes)
    c.dot(x + 7, y + 2, eyes)
    c.box(44, 32, 8, 3, 10, shade(hexc(body), 0.85))
    c.box(80, 32, 2, 2, 6, '#e8e0c8')
    c.box(0, 52, 6, 6, 14, body)
    c.box(40, 52, 4, 4, 12, body)
    c.box(0, 72, 4, 10, 4, shade(hexc(body), 0.9))
    c.box(0, 88, 24, 1, 16, wing)
    x, y, w, h = c.faces(0, 88, 24, 1, 16)['up']
    for i in range(0, w, 6):
        c.rect(x + i, y, 1, h, shade(hexc(wing), 0.6))
    c.save(path)


# --------------------------------------------------------------------------------------
# Iconos de objetos (16×16) y bloques
# --------------------------------------------------------------------------------------
def item_icon(path, kind, color, accent='#ffffff', seed=0):
    c = Canvas(16, 16, seed)
    col = hexc(color)
    acc = hexc(accent)
    dark = shade(col, 0.55)
    if kind == 'book':
        c.rect(3, 2, 10, 12, col)
        c.rect(3, 2, 2, 12, dark)
        c.rect(5, 13, 8, 1, '#e8e0c8')
        c.rect(7, 5, 4, 4, acc)
        c.dot(8, 6, '#ffffff')
    elif kind == 'card':
        c.rect(2, 4, 12, 8, col)
        c.rect(2, 4, 12, 2, dark)
        c.rect(4, 7, 3, 3, acc)
        c.rect(8, 8, 5, 1, '#f0f0f0')
        c.rect(8, 10, 4, 1, '#d0d0d0')
    elif kind == 'potion':
        c.rect(7, 2, 2, 2, '#c8a070')
        c.rect(6, 4, 4, 2, '#d8e8f0')
        c.rect(4, 6, 8, 8, col)
        c.rect(5, 7, 2, 2, shade(col, 1.5))
        c.rect(4, 13, 8, 1, dark)
    elif kind == 'ingot':
        for i in range(10):
            c.rect(3 + (i // 3), 6 + i // 2, 10 - (i // 3), 1, col if i % 4 else shade(col, 1.3))
        c.rect(4, 6, 8, 1, shade(col, 1.4))
    elif kind == 'raw':
        for (x, y) in ((5, 5), (8, 4), (6, 8), (9, 7), (4, 9), (8, 10)):
            c.rect(x, y, 3, 3, col)
            c.dot(x, y, shade(col, 1.4))
    elif kind == 'shard':
        for i in range(8):
            c.rect(7 - i // 2, 2 + i, 2 + i // 2, 1, col)
        for i in range(5):
            c.rect(6, 10 + i, 4 - i // 2, 1, shade(col, 0.8))
        c.dot(7, 4, '#ffffff')
    elif kind == 'rune':
        c.rect(3, 3, 10, 10, '#707078')
        c.rect(3, 3, 10, 1, '#9a9aa2')
        c.rect(7, 5, 2, 6, col)
        c.rect(5, 6, 6, 1, col)
        c.rect(5, 9, 2, 1, col)
    elif kind == 'core':
        c.rect(5, 4, 6, 8, col)
        c.rect(4, 5, 8, 6, col)
        c.rect(6, 6, 3, 3, shade(col, 1.6))
        c.dot(6, 6, '#ffffff')
    elif kind == 'seal':
        for y in range(16):
            for x in range(16):
                if (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 36:
                    c.dot(x, y, col)
        for y in range(16):
            for x in range(16):
                if 9 <= (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 16:
                    c.dot(x, y, dark)
        c.rect(6, 6, 4, 4, acc)
    elif kind == 'sword':
        for i in range(9):
            c.rect(4 + i, 11 - i, 2, 1, col)
            c.dot(5 + i, 11 - i, shade(col, 1.4))
        c.rect(3, 10, 4, 1, accent)
        c.rect(5, 9, 1, 4, accent)
        c.rect(2, 12, 3, 2, '#5a3a1a')
    elif kind == 'axe':
        for i in range(10):
            c.dot(3 + i, 13 - i, '#6a4a2a')
        c.rect(9, 1, 5, 6, col)
        c.rect(8, 2, 1, 4, shade(col, 0.7))
        c.rect(13, 1, 1, 6, shade(col, 1.4))
    elif kind == 'hammer':
        for i in range(10):
            c.dot(3 + i, 13 - i, '#6a4a2a')
        c.rect(8, 1, 7, 5, col)
        c.rect(10, 2, 3, 3, accent)
    elif kind == 'staff':
        for i in range(11):
            c.dot(3 + i, 14 - i, '#7a5230')
            c.dot(4 + i, 14 - i, '#5a3a20')
        c.rect(11, 1, 4, 4, col)
        c.dot(12, 2, '#ffffff')
    elif kind == 'ring':
        for y in range(16):
            for x in range(16):
                d = (x - 7.5) ** 2 + (y - 8.5) ** 2
                if 9 <= d <= 22:
                    c.dot(x, y, col)
        c.rect(6, 2, 4, 3, accent)
        c.dot(7, 3, '#ffffff')
    c.save(path)


def ore_block(path, ore, base='#7d7d7d', seed=0):
    c = Canvas(16, 16, seed)
    c.rect(0, 0, 16, 16, base, 0.12)
    rng = random.Random(seed)
    for _ in range(6):
        x, y = rng.randrange(1, 13), rng.randrange(1, 13)
        c.rect(x, y, 2 + rng.randrange(2), 2, ore, 0.1)
        c.dot(x, y, shade(hexc(ore), 1.4))
    c.save(path)


def crystal_block(path, color, seed=0):
    c = Canvas(16, 16, seed)
    col = hexc(color)
    c.rect(0, 0, 16, 16, shade(col, 0.6), 0.1)
    rng = random.Random(seed)
    for _ in range(5):
        x = rng.randrange(0, 14)
        h = rng.randrange(5, 12)
        c.rect(x, 16 - h, 2, h, shade(col, 1.1), 0.05)
        c.rect(x, 16 - h, 1, h, shade(col, 1.45), 0.02)
    c.save(path)


def particle_tex(path):
    c = Canvas(16, 16)
    for y in range(16):
        for x in range(16):
            d = ((x - 7.5) ** 2 + (y - 7.5) ** 2) ** 0.5
            a = max(0, min(255, int(255 * max(0.0, 1 - d / 8) ** 1.5)))
            c.px[x, y] = (255, 255, 255, a)
    c.save(path)


def pack_icon(path, accent, seed=0):
    img = Image.new('RGBA', (128, 128), (30, 20, 40, 255))
    px = img.load()
    rng = random.Random(seed)
    col = hexc(accent)
    for y in range(128):
        for x in range(128):
            d = ((x - 64) ** 2 + (y - 64) ** 2) ** 0.5
            f = max(0.0, 1 - d / 70)
            n = rng.uniform(0.9, 1.1)
            px[x, y] = (int((30 + col[0] * f) * n) % 256, int((20 + col[1] * f) * n) % 256, int((40 + col[2] * f) * n) % 256, 255)
    # estrella de 4 puntas
    for i in range(-40, 41):
        w = max(0, 6 - abs(i) // 7)
        for k in range(-w, w + 1):
            for (x, y) in ((64 + i, 64 + k), (64 + k, 64 + i)):
                px[x, y] = (255, 240, 200, 255)
    img.save(path)
