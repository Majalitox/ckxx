"""Generador procedural de texturas (pieles de NPC, monstruos, objetos, bloques y partículas).

Pinta las regiones UV de cada caja de los modelos con colores, ruido y detalles
(cara, pelo, ropa, armadura...). Se ejecuta desde tools/build.py.
"""
import math
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


# (item_icon v2: ver la sección «Iconos de objetos» al final del archivo)


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


# ======================================================================================
# v2 — Herramientas de pintura pixel-art (las usa tools/rp_models.py)
# ======================================================================================
# Convenciones: un "rect" es (x, y, w, h) en píxeles de la textura; las coordenadas locales
# (i, j) de una cara empiezan en su esquina superior izquierda. Los colores pueden ser
# '#rrggbb' o tuplas (r, g, b[, a]).

def C(c):
    """Color → tupla RGB."""
    if isinstance(c, str):
        return hexc(c)
    return tuple(int(v) for v in c[:3])


def mix(a, b, t):
    a, b = C(a), C(b)
    return tuple(max(0, min(255, int(round(a[k] + (b[k] - a[k]) * t)))) for k in range(3))


def lum(c):
    c = C(c)
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def sat(c, f):
    """Aumenta (f>1) o reduce (f<1) la saturación."""
    c = C(c)
    g = lum(c)
    return tuple(max(0, min(255, int(g + (v - g) * f))) for v in c)


def hue_shift(c, warm):
    """Sombra «cálida/fría» típica del pixel-art: warm>0 empuja a rojo/amarillo, <0 a azul."""
    r, g, b = C(c)
    return (max(0, min(255, int(r + 18 * warm))), max(0, min(255, int(g + 6 * warm))), max(0, min(255, int(b - 16 * warm))))


def dark(c, f=0.7):
    return hue_shift(shade(C(c), f), -0.35 * (1 - f) * 3)


def light(c, f=1.25):
    return hue_shift(shade(C(c), f), 0.25 * (f - 1) * 3)


class Faces:
    """Rectángulos de las caras de una región UV (caja o caras sueltas).

    Atributos: front, back, right, left, up, down (cajas) o los nombres de grupo de una
    región por caras. `kinds[nombre]` indica la orientación ('up', 'down', 'front',
    'back', 'side') para la iluminación. `size` = (w, h, d) del cubo."""

    def __init__(self, rects, kinds, size):
        self.rects = dict(rects)
        self.kinds = dict(kinds)
        self.size = size
        for k, v in rects.items():
            setattr(self, k, v)

    def __getitem__(self, k):
        return self.rects[k]

    def get(self, k, default=None):
        return self.rects.get(k, default)

    def sides(self):
        """Caras laterales en orden alrededor del cubo (para franjas)."""
        return [self.rects[k] for k in ('right', 'front', 'left', 'back', 'side', 'ns', 'ring') if k in self.rects]

    def all(self):
        return list(self.rects.values())


def box_faces(u, v, w, h, d):
    return Faces({
        'up': (u + d, v, w, d), 'down': (u + d + w, v, w, d),
        'right': (u, v + d, d, h), 'front': (u + d, v + d, w, h),
        'left': (u + d + w, v + d, d, h), 'back': (u + 2 * d + w, v + d, w, h),
    }, {'up': 'up', 'down': 'down', 'right': 'side', 'front': 'front', 'left': 'side', 'back': 'back'}, (w, h, d))


class Pix(Canvas):
    """Lienzo con utilidades de caras, iluminación y píxeles «brillantes» (sin sombrear)."""

    def __init__(self, w, h, seed=0):
        super().__init__(w, h, seed)
        self.glow = set()

    # -- píxeles ---------------------------------------------------------------------
    def put(self, x, y, c, a=255, glow=False):
        if 0 <= x < self.w and 0 <= y < self.h:
            if c is None:
                self.px[x, y] = (0, 0, 0, 0)
                self.glow.discard((x, y))
                return
            cc = C(c)
            if len(c) == 4 and not isinstance(c, str):
                a = c[3]
            self.px[x, y] = (cc[0], cc[1], cc[2], a)
            if glow:
                self.glow.add((x, y))
            else:
                self.glow.discard((x, y))

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return (0, 0, 0, 0)

    def jit(self, c, amt):
        f = 1 + self.rng.uniform(-amt, amt)
        return shade(C(c), f)

    # -- coordenadas locales de una cara ------------------------------------------------
    def at(self, r, i, j, c, a=255, glow=False):
        x, y, w, h = r
        if 0 <= i < w and 0 <= j < h:
            self.put(x + i, y + j, c, a, glow)

    def ga(self, r, i, j):
        x, y, w, h = r
        if 0 <= i < w and 0 <= j < h:
            return self.get(x + i, y + j)
        return (0, 0, 0, 0)

    def fill(self, r, c, amt=0.05, glow=False):
        x, y, w, h = r
        for i in range(w):
            for j in range(h):
                self.put(x + i, y + j, self.jit(c, amt) if amt else c, glow=glow)

    def area(self, r, i, j, w, h, c, amt=0.0, glow=False):
        for a in range(i, i + w):
            for b in range(j, j + h):
                self.at(r, a, b, self.jit(c, amt) if amt else c, glow=glow)

    def hl(self, r, j, c, i0=0, i1=None, amt=0.0, glow=False):
        i1 = r[2] if i1 is None else i1
        for i in range(i0, i1):
            self.at(r, i, j, self.jit(c, amt) if amt else c, glow=glow)

    def vl(self, r, i, c, j0=0, j1=None, amt=0.0, glow=False):
        j1 = r[3] if j1 is None else j1
        for j in range(j0, j1):
            self.at(r, i, j, self.jit(c, amt) if amt else c, glow=glow)

    def clear(self, r, i=0, j=0, w=None, h=None):
        x, y, rw, rh = r
        w = rw if w is None else w
        h = rh if h is None else h
        for a in range(i, i + w):
            for b in range(j, j + h):
                if 0 <= a < rw and 0 <= b < rh:
                    self.put(x + a, y + b, None)

    def tint(self, r, f, i=0, j=0, w=None, h=None):
        x, y, rw, rh = r
        w = rw if w is None else w
        h = rh if h is None else h
        for a in range(i, i + w):
            for b in range(j, j + h):
                if 0 <= a < rw and 0 <= b < rh:
                    p = self.get(x + a, y + b)
                    if p[3]:
                        self.px[x + a, y + b] = shade(p, f) + (p[3],)

    def tint_to(self, r, c, t, i=0, j=0, w=None, h=None):
        x, y, rw, rh = r
        w = rw if w is None else w
        h = rh if h is None else h
        for a in range(i, i + w):
            for b in range(j, j + h):
                if 0 <= a < rw and 0 <= b < rh:
                    p = self.get(x + a, y + b)
                    if p[3]:
                        self.px[x + a, y + b] = mix(p, c, t) + (p[3],)

    def grid(self, r, rows, pal, i0=0, j0=0, glow=''):
        """Dibuja un mini-sprite: lista de cadenas; '.' = no tocar, ' ' = transparente."""
        for jj, row in enumerate(rows):
            for ii, ch in enumerate(row):
                if ch == '.':
                    continue
                if ch == ' ':
                    self.at(r, i0 + ii, j0 + jj, None)
                    continue
                col = pal.get(ch)
                if col is None:
                    continue
                self.at(r, i0 + ii, j0 + jj, col, glow=ch in glow)

    # -- iluminación ---------------------------------------------------------------------
    def light_face(self, r, kind, top=1.07, bottom=0.84, edge=0.86, edges='lrb'):
        x, y, w, h = r
        if w <= 0 or h <= 0:
            return
        base = {'up': 1.10, 'down': 0.70, 'front': 1.0, 'side': 0.93, 'back': 0.88}.get(kind, 1.0)
        for j in range(h):
            if kind in ('up', 'down'):
                g = base
            else:
                t = j / max(1, h - 1)
                g = base * (top + (bottom - top) * t)
            for i in range(w):
                if (x + i, y + j) in self.glow:
                    continue
                p = self.px[x + i, y + j]
                if not p[3]:
                    continue
                f = g
                if edge and w > 2 and h > 2:
                    if ('l' in edges and i == 0) or ('r' in edges and i == w - 1):
                        f *= edge + (1 - edge) * 0.35
                    if ('b' in edges and j == h - 1) or ('t' in edges and j == 0):
                        f *= edge
                c = shade(p, f)
                if f < 0.95:
                    c = hue_shift(c, -0.25)
                elif f > 1.04:
                    c = hue_shift(c, 0.2)
                self.px[x + i, y + j] = c + (p[3],)

    def light(self, F, top=1.07, bottom=0.84, edge=0.86, skip=()):
        for name, r in F.rects.items():
            if name in skip:
                continue
            kind = F.kinds.get(name, 'front')
            self.light_face(r, kind, top, bottom, edge, 'lrb' if kind not in ('up', 'down') else '')


# -- materiales ----------------------------------------------------------------------------
def mat_fill(c, r, base, mat='cloth', amt=None, seed=0):
    """Rellena una cara con un material con textura."""
    x, y, w, h = r
    rng = random.Random(seed * 7919 + x * 131 + y * 17 + w)
    base = C(base)
    if mat == 'flat':
        c.fill(r, base, 0)
        return
    if mat == 'skin':
        c.fill(r, base, 0.018 if amt is None else amt)
        return
    if mat == 'cloth':
        for i in range(w):
            for j in range(h):
                f = 1.0 + (0.03 if (i + j) % 2 else -0.02) + rng.uniform(-0.03, 0.03)
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'rough':  # arpillera / lino basto
        for i in range(w):
            for j in range(h):
                f = 1.0 + (0.05 if (i * 3 + j) % 4 == 0 else 0) + rng.uniform(-0.08, 0.06)
                if rng.random() < 0.06:
                    f -= 0.12
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'leather':
        for i in range(w):
            for j in range(h):
                f = 1.0 + rng.uniform(-0.06, 0.05)
                if rng.random() < 0.05:
                    f += 0.12
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'metal':
        for i in range(w):
            for j in range(h):
                f = 1.0 + 0.10 * (1 - j / max(1, h - 1)) - 0.04 + rng.uniform(-0.025, 0.025)
                c.put(x + i, y + j, shade(base, f))
        if w >= 3 and h >= 3:
            c.at(r, 1, 1, light(base, 1.45))
        return
    if mat == 'chain':
        for i in range(w):
            for j in range(h):
                k = (i + (j % 2)) % 2
                c.put(x + i, y + j, shade(base, 1.08 if k else 0.78))
        return
    if mat == 'fur':
        offs = [rng.randrange(4) for _ in range(w)]
        for i in range(w):
            for j in range(h):
                streak = (j + offs[i]) % 4
                f = (1.06, 1.0, 0.93, 0.88)[streak] + rng.uniform(-0.03, 0.03)
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'scales':
        for i in range(w):
            for j in range(h):
                ii = i + (2 if (j // 2) % 2 else 0)
                f = 1.06 if j % 2 == 0 and ii % 4 in (1, 2) else (0.86 if ii % 4 == 0 else 0.98)
                c.put(x + i, y + j, shade(base, f + rng.uniform(-0.02, 0.02)))
        return
    if mat == 'stone':
        for i in range(w):
            for j in range(h):
                f = 1.0 + rng.uniform(-0.09, 0.07)
                c.put(x + i, y + j, shade(base, f))
        for _ in range(max(1, w * h // 40)):
            cx, cy = rng.randrange(w), rng.randrange(h)
            for _k in range(rng.randrange(2, 5)):
                c.at(r, cx, cy, shade(base, 0.62))
                cx += rng.choice((-1, 0, 1))
                cy += 1
        return
    if mat == 'wood':
        for i in range(w):
            line = (i % 3 == 0)
            for j in range(h):
                f = (0.86 if line else 1.0) + rng.uniform(-0.04, 0.04)
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'bone':
        for i in range(w):
            for j in range(h):
                f = 1.0 + rng.uniform(-0.05, 0.04)
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'crystal':
        for i in range(w):
            for j in range(h):
                t = ((i + j) % 6) / 5
                f = 0.85 + 0.35 * (1 - abs(t - 0.5) * 2)
                c.put(x + i, y + j, shade(base, f))
        return
    if mat == 'straw':
        for i in range(w):
            for j in range(h):
                f = 1.08 if (i + 2 * j) % 3 == 0 else (0.9 if (i - j) % 4 == 0 else 1.0)
                c.put(x + i, y + j, shade(base, f + rng.uniform(-0.03, 0.03)))
        return
    if mat == 'glow':
        c.fill(r, base, 0, glow=True)
        return
    c.fill(r, base, 0.05 if amt is None else amt)


def mat_box(c, F, base, mat='cloth', seed=0, faces=None, **kw):
    for name, r in F.rects.items():
        if faces and name not in faces:
            continue
        mat_fill(c, r, base, mat, seed=seed, **kw)


def band(c, F, j0, j1, col, mat='flat', seed=0):
    """Franja horizontal (filas j0..j1 de la altura del cubo) en las caras laterales."""
    for name in ('right', 'front', 'left', 'back', 'side', 'ns', 'ring', 'sides'):
        r = F.get(name)
        if not r:
            continue
        x, y, w, h = r
        jj0, jj1 = max(0, j0), min(h, j1)
        if jj1 > jj0:
            mat_fill(c, (x, y + jj0, w, jj1 - jj0), col, mat, seed=seed)


def outline_alpha(c, r, col, strength=1.0):
    """Contorno de 1 px alrededor de lo pintado dentro de un rectángulo (para sprites)."""
    x, y, w, h = r
    pts = []
    for i in range(w):
        for j in range(h):
            if c.get(x + i, y + j)[3]:
                continue
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ii, jj = i + di, j + dj
                if 0 <= ii < w and 0 <= jj < h and c.get(x + ii, y + jj)[3] and (x + ii, y + jj) not in pts:
                    pts.append((x + i, y + j))
                    break
    for (px_, py_) in pts:
        c.put(px_, py_, col)


# ======================================================================================
# Sprites dibujados con cuadrícula (iconos, glifos, partículas)
# ======================================================================================
def _grid_img(img_px, x0, y0, rows, pal):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in ('.', ' '):
                continue
            col = pal.get(ch)
            if col is None:
                continue
            if len(col) == 3:
                col = tuple(col) + (255,)
            img_px[x0 + i, y0 + j] = tuple(int(v) for v in col)


def _pal(**kw):
    return {k: (C(v) + (255,) if not (isinstance(v, tuple) and len(v) == 4) else v) for k, v in kw.items()}


ICON_GRIDS = {
    'key': [
        '................',
        '.........oooo...',
        '........oAAaao..',
        '.......oAa..aao.',
        '.......oa....ao.',
        '.......oa....ao.',
        '.......oaa..ado.',
        '........oaaddo..',
        '.......oaoooo...',
        '......oao.......',
        '.....oao........',
        '....oaaoo.......',
        '...oaooado......',
        '..oaoo.oo.......',
        '..ooo...........',
        '................',
    ],
    'tomato': [
        '................',
        '.......gG.......',
        '.....ggGGgg.....',
        '....oogggGooo...',
        '...orrRggrrrro..',
        '..orRWRrrrrrrdo.',
        '..orRWrrrrrrrdo.',
        '..orRrrrrrrrrdo.',
        '..orrrrrrrrrrdo.',
        '..orrrrrrrrrddo.',
        '..orrrrrrrrrddo.',
        '...orrrrrrrddo..',
        '....oddrrrddo...',
        '.....ooddddo....',
        '.......oooo.....',
        '................',
    ],
    'lockpick': [
        '................',
        '..........oo....',
        '.........oWWo...',
        '........oWlo....',
        '.......oWlo.....',
        '......oWlo..oo..',
        '.....oWlo..oWWo.',
        '....oWlo..oWlo..',
        '...ohho..oWlo...',
        '..ohHho.oWlo....',
        '..ohHHoohho.....',
        '...ohhohHho.....',
        '....oo.oHHo.....',
        '........oo......',
        '................',
        '................',
    ],
    'scroll': [
        '................',
        '..oooooooooooo..',
        '.oHhhhhhhhhhhHo.',
        '.oHppppppppppHo.',
        '..oPpppppppppo..',
        '..oPkkkkkpppPo..',
        '..oPppppppppPo..',
        '..oPkkkkkkkpPo..',
        '..oPppppppppPo..',
        '..oPkkkkpppaao..',
        '..oPpppppppaAo..',
        '..oPpppppppaao..',
        '.oHppppppppppHo.',
        '.oHhhhhhhhhhhHo.',
        '..oooooooooooo..',
        '................',
    ],
    'poster': [
        '................',
        '.oooooooooooooo.',
        '.oPPPPnPPPPPPPo.',
        '.oPrrrrrrrrrrPo.',
        '.oPppppppppppPo.',
        '.oPpppfffffppPo.',
        '.oPppfSSSSSfpPo.',
        '.oPppfSkSkSfpPo.',
        '.oPppfSSSSSfpPo.',
        '.oPpppSSmSSppPo.',
        '.oPppppppppppPo.',
        '.oPkkkkkkkkkkPo.',
        '.oPpppaaaaapppo.',
        '.oPPPPPPPPPPPdo.',
        '.oooooooooooooo.',
        '................',
    ],
    'book': [
        '................',
        '...ooooooooooo..',
        '..obbbbbbbbbbbo.',
        '..oBbbbbbbbbbbo.',
        '..oBbbbaaabbbbo.',
        '..oBbbaAAAabbbo.',
        '..oBbbaAWAabbbo.',
        '..oBbbaAAAabbbo.',
        '..oBbbbaaabbbbo.',
        '..oBbbbbbbbbbbo.',
        '..oBbbbbbbbbbbo.',
        '..oBdddddddddbo.',
        '..oBpppppppppdo.',
        '..oBWppppppppo..',
        '...oooooooooo...',
        '................',
    ],
    'card': [
        '................',
        '................',
        '................',
        '.oooooooooooooo.',
        '.oddddddddddddo.',
        '.obbbbbbbbbbbbo.',
        '.obaaabbWWWWWbo.',
        '.obaAabbbbbbbbo.',
        '.obaaabbWWWWbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.oddddddddddddo.',
        '.oooooooooooooo.',
        '................',
        '................',
        '................',
    ],
    'potion': [
        '................',
        '.......oo.......',
        '......ohho......',
        '......oHHo......',
        '......oggo......',
        '.....oggggo.....',
        '....oggWggggo...',
        '...obbWlbbbbbo..',
        '...obWlbbbbbbo..',
        '...oblbbbbbbdo..',
        '...obbbbbbbbdo..',
        '...obbbbbbbddo..',
        '....obbbbbddo...',
        '.....oddddo.....',
        '......oooo......',
        '................',
    ],
    'ingot': [
        '................',
        '................',
        '................',
        '................',
        '.....oooooooo...',
        '....oWllllllbo..',
        '...oWllllllbbo..',
        '..oooooooooobo..',
        '..olllllllldbo..',
        '..obbbbbbbbddo..',
        '..obbbbbbbbddo..',
        '..odddddddddo...',
        '..oooooooooo....',
        '................',
        '................',
        '................',
    ],
    'raw': [
        '................',
        '................',
        '......ooo.......',
        '.....olbbo.ooo..',
        '....olWbbbolbbo.',
        '...oolbbbddobbo.',
        '..olbbbbddddbdo.',
        '..olWbbbbsssddo.',
        '..obbbsssssbddo.',
        '..obbsssssbbbo..',
        '...obsssbbbddo..',
        '...obbbbbdddo...',
        '....oddddddo....',
        '.....oooooo.....',
        '................',
        '................',
    ],
    'shard': [
        '................',
        '.......oo.......',
        '......oWlo......',
        '......oWlbo.....',
        '.....oWlbbo.....',
        '.....oWlbbdo....',
        '....oWlbbbdo....',
        '....oWlbbbddo...',
        '....olbbbbddo...',
        '...oolbbbbddo...',
        '..olloolbbddo...',
        '..olbbooldddo...',
        '..obbdo.oddo....',
        '...odo...oo.....',
        '....o...........',
        '................',
    ],
    'rune': [
        '................',
        '...oooooooooo...',
        '..osSSSSSSSSso..',
        '.osSssssssssSso.',
        '.oSsssaaasssssd.',
        '.oSssssAssssssd.',
        '.oSssaaAaassssd.',
        '.oSssssAssssssd.',
        '.oSssssAaasssd..',
        '.oSsssaAsssssd..',
        '.oSssssAssssddo.',
        '.oSsssssssssddo.',
        '..odssssssddddo.',
        '...oddddddddoo..',
        '....oooooooo....',
        '................',
    ],
    'core': [
        '................',
        '.......oo.......',
        '......oWlo......',
        '.....oWllbo.....',
        '....oWlAAbbo....',
        '...oWlAWAbbbo...',
        '..oblAAAAbbbdo..',
        '..obbAAAbbbbdo..',
        '..obbbbbbbbbdo..',
        '...obbbbbbbdo...',
        '....obbbbbdo....',
        '.....obbbdo.....',
        '......oddo......',
        '.......oo.......',
        '................',
        '................',
    ],
    'seal': [
        '................',
        '.....oooooo.....',
        '...oobbbbbboo...',
        '..obblllllbbbo..',
        '..oblaaaaaabdo..',
        '.oblaAAAAAAabdo.',
        '.oblaAaaaaAabdo.',
        '.obbaAaWWaAabdo.',
        '.obbaAaWWaAabdo.',
        '.obbaAaaaaAadbo.',
        '.obbbaAAAAAadbo.',
        '..obbbaaaaaddo..',
        '..oobbbbbbddoo..',
        '...ooddddddoo...',
        '.....oooooo.....',
        '................',
    ],
    'sword': [
        '................',
        '.............oo.',
        '............oWo.',
        '...........oWlo.',
        '..........oWlo..',
        '.........oWlo...',
        '........oWlo....',
        '.......oWlo.....',
        '...oo.oWlo......',
        '...oaoWlo.......',
        '....oaao........',
        '....ohaao.......',
        '...ohHoaao......',
        '..ohHo..oo......',
        '..ooo...........',
        '................',
    ],
    'axe': [
        '................',
        '.........ooo....',
        '........oWlbo...',
        '.......oWlbbbo..',
        '......oWlbbbbo..',
        '......oWbbhbbo..',
        '.......obhhobo..',
        '........hhooo...',
        '.......hHo......',
        '......hHo.......',
        '.....hHo........',
        '....hHo.........',
        '...hHo..........',
        '..hHo...........',
        '..oo............',
        '................',
    ],
    'hammer': [
        '................',
        '........ooooo...',
        '.......oWlllbo..',
        '......oWlaalbbo.',
        '......olbaAabbo.',
        '.......obbaabdo.',
        '........obbhdo..',
        '.......ohhoo....',
        '......ohHo......',
        '.....ohHo.......',
        '....ohHo........',
        '...ohHo.........',
        '..ohHo..........',
        '..ooo...........',
        '................',
        '................',
    ],
    'staff': [
        '................',
        '..........ooo...',
        '.........oWlbo..',
        '........oWllbbo.',
        '........olbbbdo.',
        '........obbbddo.',
        '.........oddoo..',
        '........ohHo....',
        '.......ohHo.....',
        '......ohHo......',
        '.....ohHo.......',
        '....ohHo........',
        '...ohHo.........',
        '..ohHo..........',
        '..oo............',
        '................',
    ],
    'ring': [
        '................',
        '................',
        '......oooo......',
        '.....oaAWao.....',
        '.....oaAAao.....',
        '......oaao......',
        '....oobbbboo....',
        '...obbo..obbo...',
        '..obo......obo..',
        '..obo......odo..',
        '..obo......odo..',
        '...obo....odo...',
        '....obbbbddo....',
        '.....oooooo.....',
        '................',
        '................',
    ],
}


def item_icon(path, kind, color, accent='#ffffff', seed=0):
    """Icono 16×16 de objeto (pixel-art con contorno). kind: book, card, potion, ingot, raw,
    shard, rune, core, seal, sword, axe, hammer, staff, ring, key, tomato, lockpick, scroll, poster."""
    col = C(color)
    acc = C(accent or '#ffffff')
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = img.load()
    outline = shade(dark(col, 0.45), 0.9)
    pal = _pal(o=outline, b=col, l=light(col, 1.3), W=light(col, 1.75), d=dark(col, 0.68),
               B=dark(col, 0.55), a=acc, A=light(acc, 1.3), h='#8a5a30', H='#5a3818',
               g='#cfe8f0', G='#ffffff', p='#efe0b8', P='#c8a870', k='#6a4a30', s='#80808a', S='#a0a0aa',
               r='#d8301c', R='#ff7050', n='#202020', f='#3a2a20', m='#a03020')
    if kind == 'tomato':
        pal.update(_pal(o='#5a1008', r=col, R=light(col, 1.35), W='#ffd0c0', d=dark(col, 0.7), g='#3a8a2a', G='#6ad04a'))
    elif kind == 'key':
        pal.update(_pal(o=dark(col, 0.4), a=col, A=light(col, 1.5), d=dark(col, 0.7)))
    elif kind == 'lockpick':
        pal.update(_pal(o='#1a1a20', W=light(col, 1.5), l=col, h=accent or '#6a4a2a', H=dark(accent or '#6a4a2a', 0.7)))
    elif kind == 'scroll':
        pal.update(_pal(o='#4a3018', h='#d8c090', H='#a08050', p='#f4e8c8', P='#d8c49a', k='#7a6a58', a=col, A=light(col, 1.4)))
    elif kind == 'poster':
        pal.update(_pal(o='#3a2410', P='#c8a870', p='#f0e2bc', r=col, n='#e03020', f='#4a3020', S='#d8b088', k='#3a2a20',
                        m='#8a3020', a=acc, d='#a08860'))
    elif kind == 'ingot':
        pal.update(_pal(W=light(col, 1.8)))
    grid = ICON_GRIDS.get(kind)
    if grid is None:
        grid = ICON_GRIDS['core']
    _grid_img(px, 0, 0, grid, pal)
    # Pequeña variación de brillo para que dos iconos del mismo tipo no sean idénticos.
    rng = random.Random(seed)
    for _ in range(3):
        x, y = rng.randrange(16), rng.randrange(16)
        p = px[x, y]
        if p[3] and p[:3] not in (outline,):
            px[x, y] = shade(p, 1.06) + (p[3],)
    img.save(path)


# ======================================================================================
# Hoja de glifos del HUD (font/glyph_E3.png, 256×256, celdas de 16×16) — contrato §5
# ======================================================================================
GLYPHS = [
    ('eye_closed', [
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '..o..........o..',
        '...oo......oo...',
        '....ooooooooo...',
        '..o...o..o...o..',
        '.....o....o.....',
        '................',
        '................',
        '................',
        '................',
        '................',
    ], dict(o='#c8c8d0')),
    ('eye_half', [
        '................',
        '................',
        '................',
        '................',
        '................',
        '....oooooooo....',
        '..oossssssssoo..',
        '.osssssssssssso.',
        '.llllllllllllll.',
        '..owwiiPPiiwwo..',
        '..oowwiiiiwwoo..',
        '....oooooooo....',
        '................',
        '................',
        '................',
        '................',
    ], dict(o='#3a3020', s='#c8a060', l='#201810', w='#fff4d0', i='#d0a020', P='#201808')),
    ('eye_open', [
        '................',
        '................',
        '................',
        '.....oooooo.....',
        '...oowwwwwwoo...',
        '..owwwiiiiwwwo..',
        '.owwwiiiiiiwwwo.',
        '.owwiiPPPPiiwwo.',
        '.owwiiPWPPiiwwo.',
        '.owwwiiPPiiwwwo.',
        '..owwwiiiiwwwo..',
        '...oowwwwwwoo...',
        '.....oooooo.....',
        '..r..........r..',
        '................',
        '................',
    ], dict(o='#5a0808', w='#ffe8e0', i='#e02020', P='#200000', W='#ffffff', r='#ff4040')),
    ('star_full', [
        '................',
        '.......oo.......',
        '.......oo.......',
        '......oyyo......',
        '......oyyo......',
        '.ooooooyYooooo..',
        '.oyyyyyYYyyyyo..',
        '..oyyyyYYyyyo...',
        '...oyyyyyyyo....',
        '....oyyyyyo.....',
        '...oyyyoyyyo....',
        '...oyyo.oyyo....',
        '..oyyo...oyyo...',
        '..ooo.....ooo...',
        '................',
        '................',
    ], dict(o='#7a4a00', y='#ffd020', Y='#fff8a0')),
    ('star_empty', [
        '................',
        '.......oo.......',
        '.......oo.......',
        '......o..o......',
        '......o..o......',
        '.oooooo..oooooo.',
        '.o............o.',
        '..o..........o..',
        '...o........o...',
        '....o......o....',
        '...o...oo...o...',
        '...o..o..o..o...',
        '..o..o....o..o..',
        '..ooo......ooo..',
        '................',
        '................',
    ], dict(o='#8a8a90')),
    ('coin', [
        '................',
        '................',
        '.....oooooo.....',
        '...ooyyyyyyoo...',
        '..oyyYYYYYYyyo..',
        '..oyYyyyyyyYdo..',
        '.oyYyyy##yyyYdo.',
        '.oyYyy#yyyyyYdo.',
        '.oyYyy#yyyyyYdo.',
        '.oyYyyy##yyyYdo.',
        '..oyYyyyyyyYdo..',
        '..oyyddddddddo..',
        '...ooddddddoo...',
        '.....oooooo.....',
        '................',
        '................',
    ], {'o': '#6a4000', 'y': '#f0b820', 'Y': '#fff090', 'd': '#c08010', '#': '#a06808'}),
    ('heart', [
        '................',
        '................',
        '...ooo....ooo...',
        '..orrro..orrro..',
        '.orWWrrooorrrdo.',
        '.orWrrrrrrrrrdo.',
        '.orrrrrrrrrrrdo.',
        '.orrrrrrrrrrrdo.',
        '..orrrrrrrrrdo..',
        '...orrrrrrrdo...',
        '....orrrrrdo....',
        '.....orrrdo.....',
        '......ordo......',
        '.......oo.......',
        '................',
        '................',
    ], dict(o='#4a0408', r='#e8202c', W='#ffb0b0', d='#a01018')),
    ('mana', [
        '................',
        '.......oo.......',
        '.......oo.......',
        '......obbo......',
        '......obbo......',
        '.....obbbbo.....',
        '....obWbbbbo....',
        '....obWbbbbo....',
        '...obWbbbbbbo...',
        '...obbbbbbbdo...',
        '...obbbbbbbdo...',
        '...obbbbbbddo...',
        '....obbbbddo....',
        '.....oddddo.....',
        '......oooo......',
        '................',
    ], dict(o='#0a1a5a', b='#3a70ff', W='#c0e0ff', d='#2040b0')),
    ('shackles', [
        '................',
        '................',
        '.......ss.......',
        '......s..s......',
        '.......ss.......',
        '......s..s......',
        '..oooo.ss.oooo..',
        '.oMMMMo..oMMMMo.',
        '.oMh.hMooMh.hMo.',
        '.oM...MooM...Mo.',
        '.oM...MooM...Mo.',
        '.oMh.hMooMh.hMo.',
        '.oMMMMo..oMMMMo.',
        '..oooo....oooo..',
        '................',
        '................',
    ], dict(o='#202028', s='#c0c0c8', M='#a0a0aa', h='#6a6a74')),
    ('crown', [
        '................',
        '................',
        '................',
        '..o....o....o...',
        '.oyo..oyo..oyo..',
        '.oyyo.oyo.oyyo..',
        '.oyyyoyYyoyyyo..',
        '.oyyyyyYyyyyyo..',
        '.oyRyyyByyyGyo..',
        '.oyyyyyyyyyyyo..',
        '.oYYYYYYYYYYYo..',
        '.oddddddddddddo.',
        '..oooooooooooo..',
        '................',
        '................',
        '................',
    ], dict(o='#5a3800', y='#f0c020', Y='#fff090', d='#b08010', R='#e02030', B='#3060f0', G='#20c060')),
    ('shield', [
        '................',
        '.oooooooooooooo.',
        '.oSSSSSSrrrrrro.',
        '.oSssssSrRRRrro.',
        '.oSssssSrRrrrro.',
        '.oSssssSrrrrrro.',
        '.oSSSSSSSSSSSSo.',
        '.orrrrrrSsssSso.',
        '.orRRrrrSsssSso.',
        '..orrrrrSsssSo..',
        '..orrrrrSsssSo..',
        '...orrrrSssSo...',
        '....orrrSSSo....',
        '.....oorSoo.....',
        '.......oo.......',
        '................',
    ], dict(o='#1a1a2a', S='#d8d8e0', s='#a8b0c0', r='#3050c0', R='#7090ff')),
    ('skull', [
        '................',
        '.....oooooo.....',
        '...oowwwwwwoo...',
        '..owwwwwwwwwwo..',
        '.owwwwwwwwwwwwo.',
        '.owwwwwwwwwwwgo.',
        '.owwoooowoooowo.',
        '.owwoooowoooowo.',
        '.owwwoowwwoowgo.',
        '..owwwwwoowwgo..',
        '...owwwwwwwgo...',
        '...owowowowgo...',
        '...owowowowoo...',
        '....ooooooo.....',
        '................',
        '................',
    ], dict(o='#201818', w='#f0ead8', g='#b8b0a0')),
    ('sword', [
        '................',
        '.............oo.',
        '............oWo.',
        '...........oWso.',
        '..........oWso..',
        '.........oWso...',
        '........oWso....',
        '...oo..oWso.....',
        '...oyooWso......',
        '....oyWso.......',
        '.....oyo........',
        '....ohoyo.......',
        '...ohoo.oo......',
        '..oho...........',
        '..oo............',
        '................',
    ], dict(o='#202028', W='#ffffff', s='#b0b8c8', y='#e0b020', h='#7a4a20')),
    ('scroll', [
        '................',
        '..oooooooooooo..',
        '.ohhhhhhhhhhhho.',
        '.ohppppppppppho.',
        '..opppppppppo...',
        '..opkkkkkpppo...',
        '..opppppppppo...',
        '..opkkkkkkkpo...',
        '..opppppppppo...',
        '..opkkkkpprro...',
        '..oppppppprRo...',
        '.ohppppppppppho.',
        '.ohhhhhhhhhhhho.',
        '..oooooooooooo..',
        '................',
        '................',
    ], dict(o='#4a3018', h='#c8a060', p='#f4e8c8', k='#7a6a58', r='#c02020', R='#ff6060')),
    ('house', [
        '................',
        '.......oo.......',
        '......orro......',
        '.....orrrro.....',
        '....orrRRrro....',
        '...orrRRRRrro...',
        '..orrrrrrrrrro..',
        '.oooooooooooooo.',
        '..owwwwwwwwwwo..',
        '..owbbwwwwddwo..',
        '..owbbwwwwddwo..',
        '..owwwwwwwddwo..',
        '..owwwwwwwddwo..',
        '..oooooooooooo..',
        '................',
        '................',
    ], dict(o='#2a1a10', r='#c03a20', R='#e86040', w='#e8d8b0', b='#60a0e0', d='#7a4a20')),
    ('tomato', [
        '................',
        '.......gG.......',
        '.....ggGGgg.....',
        '....oogggGooo...',
        '...orrRggrrrro..',
        '..orRWRrrrrrrdo.',
        '..orRWrrrrrrrdo.',
        '..orRrrrrrrrrdo.',
        '..orrrrrrrrrrdo.',
        '..orrrrrrrrrddo.',
        '..orrrrrrrrrddo.',
        '...orrrrrrrddo..',
        '....oddrrrddo...',
        '.....ooddddo....',
        '................',
        '................',
    ], dict(o='#5a1008', r='#e03018', R='#ff7a5a', W='#ffd0c0', d='#a01808', g='#3a8a2a', G='#6ad04a')),
]


def glyph_sheet(path):
    """font/glyph_E3.png: U+E300..U+E30F en la primera fila (16 celdas de 16×16)."""
    img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    px = img.load()
    for idx, (_name, rows, pal) in enumerate(GLYPHS):
        cx, cy = (idx % 16) * 16, (idx // 16) * 16
        _grid_img(px, cx, cy, rows, _pal(**pal) if all(len(k) == 1 and k.isalpha() for k in pal) else {k: C(v) + (255,) for k, v in pal.items()})
        # Margen de 1 px garantizado dentro de la celda.
        for i in range(16):
            for j in range(16):
                if i in (0, 15) or j in (0, 15):
                    px[cx + i, cy + j] = (0, 0, 0, 0)
    img.save(path)


# ======================================================================================
# Atlas de partículas (textures/particle/rpg_fx.png, 128×128)
# ======================================================================================
def _soft(px, x0, y0, size, fn):
    for j in range(size):
        for i in range(size):
            v = fn(i, j)
            if v is None:
                continue
            r, g, b, a = v
            if a > 0:
                px[x0 + i, y0 + j] = (int(r), int(g), int(b), max(0, min(255, int(a))))


PARTICLE_SPRITES = {}


def particle_atlas(path):
    """Dibuja todos los sprites de partículas y devuelve {nombre: (x, y, w, h)}."""
    img = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    px = img.load()
    S = {}

    def cell(name, cx, cy, w=16, h=16):
        S[name] = (cx, cy, w, h)
        return cx, cy

    # --- fila 0
    x, y = cell('glow', 0, 0)
    _soft(px, x, y, 16, lambda i, j: (255, 255, 255, 255 * max(0.0, 1 - ((i - 7.5) ** 2 + (j - 7.5) ** 2) ** 0.5 / 8) ** 1.6))
    x, y = cell('star', 16, 0)

    def star(i, j):
        dx, dy = abs(i - 7.5), abs(j - 7.5)
        v = max(0.0, 1 - (dx * dy) ** 0.5 / 2.2 - (dx + dy) / 16)
        core = max(0.0, 1 - (dx * dx + dy * dy) ** 0.5 / 3)
        a = min(1.0, v * 1.4 + core)
        return (255, 255, 255, 255 * a)
    _soft(px, x, y, 16, star)
    x, y = cell('ring', 32, 0)
    _soft(px, x, y, 16, lambda i, j: (255, 255, 255, 255 * max(0.0, 1 - abs(((i - 7.5) ** 2 + (j - 7.5) ** 2) ** 0.5 - 5.5) / 1.6)))
    x, y = cell('ember', 48, 0)

    def ember(i, j):
        cx = 7.5
        t = j / 15
        half = 1 + 5.5 * math.sin(min(1, t * 1.15) * math.pi * 0.85) * (1 - t * 0.2)
        d = abs(i - cx)
        if d > half or j < 1 or j > 14:
            return None
        k = 1 - d / half
        g = 160 + 95 * k * (0.4 + 0.6 * t)
        return (g, g, g, 255 * min(1, k * 1.6 + 0.2))
    _soft(px, x, y, 16, ember)
    x, y = cell('drop', 64, 0)

    def drop(i, j):
        cx, cy = 7.5, 9.5
        if j >= cy:
            d = ((i - cx) ** 2 + (j - cy) ** 2) ** 0.5
            if d > 4.6:
                return None
        else:
            half = 4.6 * (j - 2) / (cy - 2) if j >= 2 else -1
            if abs(i - cx) > half:
                return None
        shine = 255 if (i, j) in ((6, 8), (6, 9), (7, 8)) else 200 + int(40 * (1 - j / 15))
        return (shine, shine, shine, 255)
    _soft(px, x, y, 16, drop)
    x, y = cell('chunk', 80, 0)
    rng = random.Random(3)
    pts = [(7.5 + 5.5 * math.cos(a) * rng.uniform(0.7, 1.0), 7.5 + 5.5 * math.sin(a) * rng.uniform(0.7, 1.0)) for a in [k * math.pi / 4 for k in range(8)]]

    def inside(xx, yy, poly):
        c_ = False
        n = len(poly)
        for k in range(n):
            x1, y1 = poly[k]
            x2, y2 = poly[(k + 1) % n]
            if (y1 > yy) != (y2 > yy) and xx < (x2 - x1) * (yy - y1) / (y2 - y1 + 1e-9) + x1:
                c_ = not c_
        return c_

    def chunk(i, j):
        if not inside(i + 0.5, j + 0.5, pts):
            return None
        g = 230 - (i + j) * 4 + rng.randrange(-15, 15)
        return (g, g, g, 255)
    _soft(px, x, y, 16, chunk)
    x, y = cell('dust', 96, 0)
    rng2 = random.Random(5)
    blobs = [(7.5 + rng2.uniform(-3, 3), 7.5 + rng2.uniform(-3, 3), rng2.uniform(3, 5)) for _ in range(5)]

    def dust(i, j):
        a = 0
        for (bx, by, br) in blobs:
            a = max(a, 1 - ((i - bx) ** 2 + (j - by) ** 2) ** 0.5 / br)
        if a <= 0:
            return None
        g = 220 - j * 3
        return (g, g, g, 230 * min(1, a * 1.5))
    _soft(px, x, y, 16, dust)
    x, y = cell('swirl', 112, 0)

    def swirl(i, j):
        dx, dy = i - 7.5, j - 7.5
        r = (dx * dx + dy * dy) ** 0.5
        ang = math.atan2(dy, dx)
        target = 2 + (ang + math.pi) / (2 * math.pi) * 5.5
        d = abs(r - target)
        if d > 1.1 or ang < -2.6:
            return None
        return (255, 255, 255, 255 * (1 - d / 1.1) * min(1, (ang + 2.6) / 1.5))
    _soft(px, x, y, 16, swirl)
    # --- fila 1
    for name, cx, seed in (('bolt_a', 0, 11), ('bolt_b', 16, 17)):
        x, y = cell(name, cx, 16)
        rr = random.Random(seed)
        xx = 7.5 + rr.uniform(-2, 2)
        bolt = []
        for j in range(1, 15):
            xx += rr.choice((-1.6, -1, 1, 1.6))
            xx = max(2, min(13, xx))
            bolt.append((xx, j))
        for (pxx, pj) in bolt:
            for i in range(16):
                d = abs(i - pxx)
                if d <= 1.6:
                    v = 255 * (1 - d / 1.8)
                    old = px[x + i, y + pj][3]
                    px[x + i, y + pj] = (255, 255, 255, max(old, int(v)))
    x, y = cell('shard', 32, 16)

    def shard(i, j):
        cx = 7.5
        half = 3.2 * (1 - abs(j - 7) / 7.5)
        if abs(i - cx) > half or j < 0 or j > 15:
            return None
        g = 255 if i < cx else 190
        if abs(i - cx) > half - 0.8:
            g -= 50
        return (g, g, g, 255)
    _soft(px, x, y, 16, shard)
    x, y = cell('ray', 48, 16)
    _soft(px, x, y, 16, lambda i, j: (255, 255, 255, 255 * max(0.0, 1 - abs(i - 7.5) / 3.5) * math.sin(math.pi * (j + 0.5) / 16)))
    x, y = cell('mote', 64, 16)
    rng3 = random.Random(9)
    mb = [(7.5 + rng3.uniform(-2.5, 2.5), 7.5 + rng3.uniform(-2.5, 2.5), rng3.uniform(2.5, 4.5)) for _ in range(6)]

    def mote(i, j):
        a = 0
        for (bx, by, br) in mb:
            a = max(a, 1 - ((i - bx) ** 2 + (j - by) ** 2) ** 0.5 / br)
        if a <= 0:
            return None
        g = 120 + 135 * a
        return (g, g, g, 255 * min(1, a * 1.8))
    _soft(px, x, y, 16, mote)
    x, y = cell('wisp', 80, 16)

    def wisp(i, j):
        t = j / 15
        cx = 7.5 + 2.0 * math.sin(t * 5)
        half = 0.6 + 4.2 * math.sin(min(1.0, t * 1.05) * math.pi * 0.9) * (0.4 + 0.6 * t)
        d = abs(i - cx)
        if d > half:
            return None
        k = 1 - d / half
        g = 170 + 85 * k
        return (g, g, g, 255 * min(1, k * 1.5 + 0.25))
    _soft(px, x, y, 16, wisp)
    leaf = ['................',
            '..........gg....',
            '........ggGGg...',
            '.......gGGgGg...',
            '......gGGgGGg...',
            '.....gGGgGGgg...',
            '....gGGgGGGg....',
            '....gGgGGGg.....',
            '...gGgGGGg......',
            '...ggGGGg.......',
            '...gGGgg........',
            '..dgg...........',
            '.d..............',
            '................',
            '................',
            '................']
    x, y = cell('leaf', 96, 16)
    _grid_img(px, x, y, leaf, {'g': (60, 150, 40, 255), 'G': (110, 200, 60, 255), 'd': (90, 60, 30, 255)})
    petal = ['................',
             '................',
             '......pppp......',
             '.....pPPPPp.....',
             '....pPPWPPPp....',
             '....pPWPPPPp....',
             '....pPPPPPPp....',
             '.....pPPPPp.....',
             '......pPPp......',
             '.......pp.......',
             '................',
             '................',
             '................',
             '................',
             '................',
             '................']
    x, y = cell('petal', 112, 16)
    _grid_img(px, x, y, petal, {'p': (230, 110, 170, 255), 'P': (255, 170, 210, 255), 'W': (255, 235, 245, 255)})
    # --- fila 2: runas, gota de sangre, salpicadura, semilla, cuerda
    runes = [
        ['................', '................', '.......ww.......', '.......ww.......', '...wwwwwwwwww...', '.......ww.......',
         '.....w.ww.w.....', '....w..ww..w....', '...w...ww...w...', '.......ww.......', '.......ww.......', '......wwww......',
         '................', '................', '................', '................'],
        ['................', '................', '...ww......ww...', '....ww....ww....', '.....ww..ww.....', '......wwww......',
         '.......ww.......', '.......ww.......', '......wwww......', '.....ww..ww.....', '....ww....ww....', '...ww......ww...',
         '................', '................', '................', '................'],
        ['................', '................', '....wwwwwwww....', '....ww....ww....', '....ww....ww....', '....wwwwwwww....',
         '.......ww.......', '.......ww.......', '...wwwwwwwwww...', '.......ww.......', '......w..w......', '.....w....w.....',
         '................', '................', '................', '................'],
        ['................', '................', '......wwww......', '....ww....ww....', '...w..wwww..w...', '...w.w....w.w...',
         '...w.w.ww.w.w...', '...w.w.ww.w.w...', '...w.w....w.w...', '...w..wwww..w...', '....ww....ww....', '......wwww......',
         '................', '................', '................', '................'],
    ]
    for k, rows in enumerate(runes):
        x, y = cell(f'rune{k}', k * 16, 32)
        _grid_img(px, x, y, rows, {'w': (255, 255, 255, 255)})
    x, y = cell('blood', 64, 32)
    _soft(px, x, y, 16, lambda i, j: drop(i, j))
    x, y = cell('splat', 80, 32)
    rng4 = random.Random(21)
    sb = [(7.5, 7.5, 4.5)] + [(7.5 + 6 * math.cos(a), 7.5 + 6 * math.sin(a), rng4.uniform(1.0, 1.8)) for a in [rng4.uniform(0, 6.28) for _ in range(6)]]

    def splat(i, j):
        for (bx, by, br) in sb:
            if (i - bx) ** 2 + (j - by) ** 2 <= br * br:
                g = 235 - int(((i - 6) ** 2 + (j - 6) ** 2) ** 0.5 * 5)
                return (g, g, g, 255)
        return None
    _soft(px, x, y, 16, splat)
    seed_g = ['................', '................', '................', '................', '................',
              '......oo........', '.....oyyo.......', '.....oyYyo......', '......oyyo......', '.......oo.......',
              '................', '................', '................', '................', '................', '................']
    x, y = cell('seed', 96, 32)
    _grid_img(px, x, y, seed_g, {'o': (150, 120, 40, 255), 'y': (240, 220, 120, 255), 'Y': (255, 250, 200, 255)})
    rope_g = ['................', '................', '................', '................', '................',
              '......bbbb......', '.....bLbbLb.....', '.....bbLbbb.....', '.....bbbLbb.....', '.....bLbbLb.....',
              '......bbbb......', '................', '................', '................', '................', '................']
    x, y = cell('rope', 112, 32)
    _grid_img(px, x, y, rope_g, {'b': (120, 82, 44, 255), 'L': (176, 136, 84, 255)})
    # --- fila 3: monedas (4 fotogramas), Z, humo, corazón
    coin_frames = [
        ['................', '................', '.....oooooo.....', '....oyyyyyyo....', '...oyYYYYYYyo...', '...oyYy##yYdo...',
         '...oyY#yyyYdo...', '...oyY#yyyYdo...', '...oyYy##yYdo...', '...oyyddddddo...', '....oddddddo....', '.....oooooo.....',
         '................', '................', '................', '................'],
        ['................', '................', '......oooo......', '.....oyyyyo.....', '.....oYYYyo.....', '.....oYy#do.....',
         '.....oY#ydo.....', '.....oY#ydo.....', '.....oYy#do.....', '.....oyddddo....', '.....oddddo.....', '......oooo......',
         '................', '................', '................', '................'],
        ['................', '................', '.......oo.......', '.......oyo......', '.......oYo......', '.......oyo......',
         '.......oyo......', '.......oyo......', '.......oyo......', '.......odo......', '.......odo......', '.......oo.......',
         '................', '................', '................', '................'],
        ['................', '................', '......oooo......', '.....oyyyyo.....', '.....oyYYYo.....', '.....od#yYo.....',
         '.....odyy#Yo....', '.....odyy#Yo....', '.....od#yYo.....', '.....oddddyo....', '.....oddddo.....', '......oooo......',
         '................', '................', '................', '................'],
    ]
    for k, rows in enumerate(coin_frames):
        x, y = cell(f'coin{k}', k * 16, 48)
        _grid_img(px, x, y, rows, {'o': (110, 70, 0, 255), 'y': (240, 184, 32, 255), 'Y': (255, 240, 144, 255), 'd': (192, 128, 16, 255), '#': (160, 104, 8, 255)})
    z_g = ['................', '................', '..oooooooooooo..', '..owwwwwwwwwwo..', '..owwwwwwwwwwo..', '..oooooooowwo...',
           '........owwo....', '.......owwo.....', '......owwo......', '.....owwo.......', '....owwoooooo...', '...owwwwwwwwwo..',
           '...owwwwwwwwwo..', '...ooooooooooo..', '................', '................']
    x, y = cell('zzz', 64, 48)
    _grid_img(px, x, y, z_g, {'o': (60, 80, 140, 255), 'w': (235, 240, 255, 255)})
    x, y = cell('smoke', 80, 48)
    _soft(px, x, y, 16, lambda i, j: (dust(i, j)[0] - 40, dust(i, j)[1] - 40, dust(i, j)[2] - 40, dust(i, j)[3] * 0.8) if dust(i, j) else None)
    heart_g = ['................', '................', '...ooo....ooo...', '..orrro..orrro..', '.orWWrrooorrrro.', '.orWrrrrrrrrrro.',
               '.orrrrrrrrrrrro.', '..orrrrrrrrrro..', '...orrrrrrrro...', '....orrrrrro....', '.....orrrro.....', '......orro......',
               '.......oo.......', '................', '................', '................']
    x, y = cell('heart', 96, 48)
    _grid_img(px, x, y, heart_g, {'o': (90, 8, 16, 255), 'r': (232, 32, 44, 255), 'W': (255, 176, 176, 255)})
    x, y = cell('spark4', 112, 48)
    _soft(px, x, y, 16, lambda i, j: (255, 255, 255, 255) if (abs(i - 7.5) < 1 and abs(j - 7.5) < 6) or (abs(j - 7.5) < 1 and abs(i - 7.5) < 6) else ((255, 255, 255, 140) if abs(i - j) < 1 and 4 < i < 11 or abs(i + j - 15) < 1 and 4 < i < 11 else None))
    # --- círculo mágico 64×64 en (0, 64)
    x, y = cell('circle', 0, 64, 64, 64)

    def circle(i, j):
        dx, dy = i - 31.5, j - 31.5
        r = (dx * dx + dy * dy) ** 0.5
        ang = math.degrees(math.atan2(dy, dx)) % 360
        a = 0.0
        for rad, wdt, val in ((30.5, 1.1, 1.0), (27.5, 0.8, 0.85), (18.5, 0.9, 0.9), (16.0, 0.6, 0.6)):
            a = max(a, val * max(0.0, 1 - abs(r - rad) / wdt))
        if 20 < r < 26.5:  # anillo de runas: marcas alternas
            seg = int(ang // 15)
            if seg % 2 == 0 and 21.5 < r < 25.5 and (int(ang) % 15) in (3, 4, 5, 6, 9, 10):
                a = max(a, 0.9)
            if seg % 2 == 1 and abs(r - 23.5) < 0.7:
                a = max(a, 0.6)
        if r < 18:  # hexagrama interior
            for k in range(6):
                th = math.radians(k * 60 + 90)
                x1, y1 = 17.5 * math.cos(th), 17.5 * math.sin(th)
                th2 = math.radians((k + 2) * 60 + 90)
                x2, y2 = 17.5 * math.cos(th2), 17.5 * math.sin(th2)
                lx, ly = x2 - x1, y2 - y1
                t = max(0, min(1, ((dx - x1) * lx + (dy - y1) * ly) / (lx * lx + ly * ly)))
                d = ((dx - x1 - t * lx) ** 2 + (dy - y1 - t * ly) ** 2) ** 0.5
                a = max(a, 0.85 * max(0.0, 1 - d / 0.9))
        if r < 3:
            a = max(a, 1 - r / 3)
        if a <= 0.02:
            return None
        return (255, 255, 255, 255 * min(1.0, a))
    _soft(px, x, y, 64, circle)
    # --- alarma "!" (4 fotogramas: aparece y hace "puf") en (64, 64)
    for k in range(4):
        x, y = cell(f'alarm{k}', 64 + k * 16, 64)
        s = (0.55, 1.0, 0.9, 0.85)[k]
        ring_r = (0, 4.5, 6.2, 7.4)[k]

        def alarm(i, j, s=s, ring_r=ring_r, k=k):
            cx, cy = 7.5, 7.5
            # signo
            bx = abs(i - cx) <= 1.6 * s
            in_bar = bx and (cy - 6 * s) <= j <= (cy + 1.5 * s)
            in_dot = bx and (cy + 3 * s) <= j <= (cy + 5.5 * s)
            if in_bar or in_dot:
                edge = abs(i - cx) > 1.6 * s - 0.9
                return (150, 0, 0, 255) if edge else (255, 50, 30, 255)
            if ring_r and k > 0:
                d = abs(((i - cx) ** 2 + (j - cy) ** 2) ** 0.5 - ring_r)
                if d < 0.8 and (int(math.degrees(math.atan2(j - cy, i - cx))) // 30) % 2 == 0:
                    return (255, 140, 120, 255 * (1.2 - k * 0.25))
            return None
        _soft(px, x, y, 16, alarm)
    # --- tomate (trozo) y pulpa en (64, 80)
    x, y = cell('pulp', 64, 80)
    _soft(px, x, y, 16, lambda i, j: (lambda v: (v[0], v[1] * 0.35, v[2] * 0.25, v[3]) if v else None)(splat(i, j)))
    img.save(path)
    PARTICLE_SPRITES.clear()
    PARTICLE_SPRITES.update(S)
    return S
