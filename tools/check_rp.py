#!/usr/bin/env python3
"""Verificador del paquete de recursos de Aetheria RPG (y renderizador de vistas previas).

Uso:
    python3 tools/check_rp.py                    # verifica packs/AetheriaRPG_RP
    python3 tools/check_rp.py --rp DIR           # verifica otro RP (p. ej. una copia temporal)
    python3 tools/check_rp.py --sheet out.png    # además dibuja una hoja de contacto

Comprueba:
  * cada entidad de cliente: texturas, geometrías, animaciones y controladores existen;
  * cada cubo de cada geometría cabe en el tamaño de textura declarado (UV de caja y por caras);
  * cada par (geometría, textura) usado: las caras visibles de los cubos caen sobre píxeles
    pintados (los cubos con «inflate» son capas opcionales: basta con que alguna textura los pinte);
  * los controladores de render: arrays apuntan a nombres definidos; part_visibility usa huesos reales;
  * las animaciones solo mueven huesos que existen;
  * las partículas: textura existente y UV dentro de la textura; los identificadores rpg:* que usan
    los scripts del BP existen;
  * la hoja de glifos font/glyph_E3.png (256×256, 16 glifos con margen de 1 px);
  * las texturas de objetos de item_texture.json existen.
Sale con código 1 si hay errores.
"""
import glob
import json
import math
import os
import re
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FACES = ('north', 'south', 'east', 'west', 'up', 'down')


def load_json(path):
    with open(path, encoding='utf-8') as f:
        txt = f.read()
    txt = re.sub(r'^\s*//.*$', '', txt, flags=re.M)
    return json.loads(txt)


def find_texture(rp, rel):
    for ext in ('.png', '.tga'):
        p = os.path.join(rp, rel + ext)
        if os.path.isfile(p):
            return p
    return None


# ======================================================================================
# Geometría: cubos, caras y rectángulos UV
# ======================================================================================
def cube_face_rects(cube):
    """Devuelve {cara: (x, y, w, h, flip_u, flip_v)} en píxeles de textura."""
    w, h, d = (cube['size'][0], cube['size'][1], cube['size'][2])
    uv = cube.get('uv', [0, 0])
    out = {}
    if isinstance(uv, list):
        u, v = uv
        W, H, D = int(round(w)), int(round(h)), int(round(d))
        rects = {
            'east': (u, v + D, D, H), 'north': (u + D, v + D, W, H), 'west': (u + D + W, v + D, D, H),
            'south': (u + 2 * D + W, v + D, W, H), 'up': (u + D, v, W, D), 'down': (u + D + W, v, W, D),
        }
        mirror = cube.get('mirror', False)
        for f, (x, y, rw, rh) in rects.items():
            out[f] = (x, y, rw, rh, mirror, False)
        if mirror:
            out['east'], out['west'] = out['west'], out['east']
    else:
        dims = {'north': (w, h), 'south': (w, h), 'east': (d, h), 'west': (d, h), 'up': (w, d), 'down': (w, d)}
        for f, spec in uv.items():
            x, y = spec['uv']
            sw, sh = spec.get('uv_size', dims[f])
            fu, fv = sw < 0, sh < 0
            if fu:
                x, sw = x + sw, -sw
            if fv:
                y, sh = y + sh, -sh
            out[f] = (x, y, sw, sh, fu, fv)
    return out


def face_area(cube, f):
    w, h, d = cube['size']
    return {'north': w * h, 'south': w * h, 'east': d * h, 'west': d * h, 'up': w * d, 'down': w * d}[f]


def geometries_in(rp):
    geos = {}
    for path in glob.glob(os.path.join(rp, 'models', 'entity', '*.json')):
        data = load_json(path)
        for g in data.get('minecraft:geometry', []):
            geos[g['description']['identifier']] = g
    return geos


# ======================================================================================
# Renderizador ortográfico mínimo (pose de reposo) para vistas previas
# ======================================================================================
def _rot_matrix(rx, ry, rz):
    """Rotación de Bedrock (grados) en coordenadas del archivo: X y Z invertidas respecto a la
    regla de la mano derecha (comprobado con las animaciones vanilla de brazos de zombi)."""
    ax, ay, az = math.radians(-rx), math.radians(ry), math.radians(-rz)
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return _mm(Rz, _mm(Ry, Rx))


def _mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mv(m, v):
    return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]


class Xf:
    """Transformación afín (matriz 3×3 + traslación)."""

    def __init__(self, m=None, t=None):
        self.m = m or [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        self.t = t or [0, 0, 0]

    def apply(self, p):
        q = _mv(self.m, p)
        return [q[0] + self.t[0], q[1] + self.t[1], q[2] + self.t[2]]

    def then(self, other):
        """self ∘ other (primero other, luego self)."""
        m = _mm(self.m, other.m)
        t = self.apply(other.t)
        return Xf(m, t)

    @staticmethod
    def about(pivot, rot):
        if not rot or not any(rot):
            return Xf()
        R = _rot_matrix(*rot)
        p = pivot
        rp_ = _mv(R, p)
        return Xf(R, [p[0] - rp_[0], p[1] - rp_[1], p[2] - rp_[2]])


def bone_xforms(geo, pose=None):
    pose = pose or {}
    bones = {b['name']: b for b in geo.get('bones', [])}
    cache = {}

    def get(name):
        if name in cache:
            return cache[name]
        b = bones[name]
        rot = list(b.get('rotation', [0, 0, 0]))
        extra = pose.get(name)
        if extra:
            rot = [rot[i] + extra.get('rot', [0, 0, 0])[i] for i in range(3)]
        local = Xf.about(b.get('pivot', [0, 0, 0]), rot)
        if extra and extra.get('pos'):
            local = Xf(None, extra['pos']).then(local)
        parent = b.get('parent')
        x = get(parent).then(local) if parent in bones else local
        cache[name] = x
        return x
    return {n: get(n) for n in bones}


def render(geo, tex, yaw=-30, pitch=12, scale=6, hidden=None, pose=None, bg=(0, 0, 0, 0), size=None):
    """Dibuja la geometría con su textura. hidden(bone_name) → True para ocultar el hueso."""
    img_t = tex.convert('RGBA')
    tpx = img_t.load()
    TW, TH = geo['description']['texture_width'], geo['description']['texture_height']
    sxr, syr = img_t.width / TW, img_t.height / TH
    xf = bone_xforms(geo, pose)
    bones = {b['name']: b for b in geo.get('bones', [])}

    def is_hidden(name):
        n = name
        while n:
            if hidden and hidden(n):
                return True
            n = bones[n].get('parent') if n in bones else None
        return False
    cyw, syw = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    cp, spt = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))

    def view(p):
        x, y, z = p
        x2 = x * cyw - z * syw
        z2 = x * syw + z * cyw
        y3 = y * cp - z2 * spt
        z3 = y * spt + z2 * cp
        return (x2, y3, z3)
    quads = []
    for b in geo.get('bones', []):
        if is_hidden(b['name']):
            continue
        X = xf[b['name']]
        for cube in b.get('cubes', []):
            o = cube['origin']
            s = cube['size']
            inf = cube.get('inflate', 0)
            x0, y0, z0 = o[0] - inf, o[1] - inf, o[2] - inf
            x1, y1, z1 = o[0] + s[0] + inf, o[1] + s[1] + inf, o[2] + s[2] + inf
            CX = Xf.about(cube.get('pivot', o), cube.get('rotation')) if cube.get('rotation') else Xf()
            T_ = X.then(CX)
            rects = cube_face_rects(cube)
            defs = {
                'north': ((x0, y1, z0), (x1 - x0, 0, 0), (0, -(y1 - y0), 0)),
                'south': ((x1, y1, z1), (-(x1 - x0), 0, 0), (0, -(y1 - y0), 0)),
                'east': ((x0, y1, z1), (0, 0, -(z1 - z0)), (0, -(y1 - y0), 0)),
                'west': ((x1, y1, z0), (0, 0, z1 - z0), (0, -(y1 - y0), 0)),
                'up': ((x0, y1, z1), (x1 - x0, 0, 0), (0, 0, -(z1 - z0))),
                'down': ((x0, y0, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0)),
            }
            for f, r in rects.items():
                if face_area(cube, f) <= 0 or r[2] <= 0 or r[3] <= 0:
                    continue
                O, U, V = defs[f]
                Pw = T_.apply(list(O))
                Uw = [a - b_ for a, b_ in zip(T_.apply([O[0] + U[0], O[1] + U[1], O[2] + U[2]]), Pw)]
                Vw = [a - b_ for a, b_ in zip(T_.apply([O[0] + V[0], O[1] + V[1], O[2] + V[2]]), Pw)]
                quads.append((view(Pw), view(Uw), view(Vw), r, f))
    if not quads:
        return Image.new('RGBA', (8, 8), bg)
    pts = []
    for P0, U, V, r, f in quads:
        for a in (0, 1):
            for c in (0, 1):
                pts.append((P0[0] + a * U[0] + c * V[0], P0[1] + a * U[1] + c * V[1]))
    minx = min(p[0] for p in pts) - 1
    maxx = max(p[0] for p in pts) + 1
    miny = min(p[1] for p in pts) - 1
    maxy = max(p[1] for p in pts) + 1
    W = int((maxx - minx) * scale) + 2
    H = int((maxy - miny) * scale) + 2
    out = Image.new('RGBA', (W, H), bg)
    opx = out.load()
    zb = [[1e9] * H for _ in range(W)]
    light_dir = (0.35, 0.8, -0.5)
    for P0, U, V, r, f in quads:
        # normal en vista para sombrear
        nx = U[1] * V[2] - U[2] * V[1]
        ny = U[2] * V[0] - U[0] * V[2]
        nz = U[0] * V[1] - U[1] * V[0]
        nl = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
        shade_ = 0.72 + 0.28 * abs((nx * light_dir[0] + ny * light_dir[1] + nz * light_dir[2]) / nl)
        det = U[0] * V[1] - U[1] * V[0]
        if abs(det) < 1e-9:
            continue
        xs = [P0[0], P0[0] + U[0], P0[0] + V[0], P0[0] + U[0] + V[0]]
        ys = [P0[1], P0[1] + U[1], P0[1] + V[1], P0[1] + U[1] + V[1]]
        sx0 = int((min(xs) - minx) * scale)
        sx1 = int((max(xs) - minx) * scale) + 1
        sy0 = int((maxy - max(ys)) * scale)
        sy1 = int((maxy - min(ys)) * scale) + 1
        rx, ry, rw, rh, fu, fv = r
        for X in range(max(0, sx0), min(W, sx1 + 1)):
            wx = minx + (X + 0.5) / scale
            for Y in range(max(0, sy0), min(H, sy1 + 1)):
                wy = maxy - (Y + 0.5) / scale
                dx, dy = wx - P0[0], wy - P0[1]
                s = (dx * V[1] - dy * V[0]) / det
                t = (U[0] * dy - U[1] * dx) / det
                if not (0 <= s < 1 and 0 <= t < 1):
                    continue
                z = P0[2] + s * U[2] + t * V[2]
                if z >= zb[X][Y]:
                    continue
                ss = 1 - s if fu else s
                tt = 1 - t if fv else t
                tx = int((rx + ss * rw) * sxr)
                ty = int((ry + tt * rh) * syr)
                if not (0 <= tx < img_t.width and 0 <= ty < img_t.height):
                    continue
                c = tpx[tx, ty]
                if c[3] < 128:
                    continue
                zb[X][Y] = z
                opx[X, Y] = (int(c[0] * shade_), int(c[1] * shade_), int(c[2] * shade_), 255)
    if size:
        out.thumbnail(size, Image.NEAREST)
    return out


# ======================================================================================
# Verificaciones
# ======================================================================================
class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.info = []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)


def painted_fraction(px, img_w, img_h, rect, sx, sy):
    x, y, w, h = rect[:4]
    tot = 0
    n = 0
    for i in range(int(math.floor(x)), int(math.ceil(x + w))):
        for j in range(int(math.floor(y)), int(math.ceil(y + h))):
            ti, tj = int(i * sx), int(j * sy)
            if 0 <= ti < img_w and 0 <= tj < img_h:
                tot += 1
                if px[ti, tj][3] >= 128:
                    n += 1
    return n / tot if tot else 0.0


def check_uv_bounds(rep, gid, geo):
    TW, TH = geo['description']['texture_width'], geo['description']['texture_height']
    for b in geo.get('bones', []):
        for k, cube in enumerate(b.get('cubes', [])):
            for f, r in cube_face_rects(cube).items():
                if face_area(cube, f) <= 0:
                    continue
                x, y, w, h = r[:4]
                if x < 0 or y < 0 or x + w > TW + 1e-6 or y + h > TH + 1e-6:
                    rep.err(f'{gid}: hueso {b["name"]} cubo {k} cara {f} UV {r[:4]} fuera de {TW}×{TH}')


def pair_ok(geo, img, tolerant_inflate=True):
    """(ok, problemas) — caras visibles de cubos no inflados con algún píxel pintado."""
    TW, TH = geo['description']['texture_width'], geo['description']['texture_height']
    px = img.convert('RGBA').load()
    sx, sy = img.width / TW, img.height / TH
    probs = []
    covered = {}
    for b in geo.get('bones', []):
        for k, cube in enumerate(b.get('cubes', [])):
            any_px = False
            for f, r in cube_face_rects(cube).items():
                if face_area(cube, f) <= 0 or r[2] <= 0 or r[3] <= 0:
                    continue
                frac = painted_fraction(px, img.width, img.height, r, sx, sy)
                if frac > 0:
                    any_px = True
                elif not cube.get('inflate'):
                    probs.append(f'{b["name"]}#{k}.{f}')
            covered[(b['name'], k)] = any_px
    return (not probs), probs, covered


def check(rp, rep, scripts_dir=None):
    geos = geometries_in(rp)
    if not geos:
        rep.err('no hay geometrías en models/entity')
    for gid, g in geos.items():
        check_uv_bounds(rep, gid, g)
    # Render controllers
    rcs = {}
    for path in glob.glob(os.path.join(rp, 'render_controllers', '*.json')):
        rcs.update(load_json(path).get('render_controllers', {}))
    # Animaciones
    anims = {}
    for path in glob.glob(os.path.join(rp, 'animations', '*.json')):
        anims.update(load_json(path).get('animations', {}))
    acs = {}
    for path in glob.glob(os.path.join(rp, 'animation_controllers', '*.json')):
        acs.update(load_json(path).get('animation_controllers', {}))
    entities = {}
    for path in sorted(glob.glob(os.path.join(rp, 'entity', '*.json'))):
        data = load_json(path)
        d = data.get('minecraft:client_entity', {}).get('description', {})
        ident = d.get('identifier')
        if not ident:
            rep.err(f'{path}: sin identificador')
            continue
        if ident in entities:
            rep.err(f'identificador de cliente duplicado: {ident} ({path})')
        entities[ident] = (path, d)
    seen_pairs = 0
    for ident, (path, d) in entities.items():
        textures = d.get('textures', {})
        geom = d.get('geometry', {})
        imgs = {}
        for k, rel in textures.items():
            p = find_texture(rp, rel)
            if not p:
                rep.err(f'{ident}: textura «{k}» no existe: {rel}')
            else:
                imgs[k] = Image.open(p)
        for k, gid in geom.items():
            if gid not in geos:
                rep.err(f'{ident}: geometría «{k}» no existe: {gid}')
        for rc in d.get('render_controllers', []):
            name = rc if isinstance(rc, str) else list(rc.keys())[0]
            if name not in rcs:
                rep.err(f'{ident}: controlador de render no existe: {name}')
                continue
            R = rcs[name]
            for kind, arrs in R.get('arrays', {}).items():
                for an, lst in arrs.items():
                    for ref in lst:
                        nm = ref.split('.', 1)[1]
                        pool = textures if kind == 'textures' else geom if kind == 'geometries' else d.get('materials', {})
                        if nm not in pool:
                            rep.err(f'{ident}: {name} {an} referencia {ref} inexistente')
            for ref in R.get('textures', []):
                if ref.startswith('Texture.') and ref.split('.', 1)[1] not in textures:
                    rep.err(f'{ident}: {name} usa {ref} inexistente')
            gref = R.get('geometry', '')
            if gref.startswith('Geometry.') and gref.split('.', 1)[1] not in geom:
                rep.err(f'{ident}: {name} usa {gref} inexistente')
            bones_all = set()
            for gid in geom.values():
                if gid in geos:
                    bones_all |= {b['name'] for b in geos[gid].get('bones', [])}
            for pv in R.get('part_visibility', []):
                for pat in pv:
                    if pat == '*':
                        continue
                    rx = re.compile('^' + re.escape(pat).replace('\\*', '.*') + '$')
                    if not any(rx.match(bn) for bn in bones_all):
                        rep.warn(f'{ident}: part_visibility «{pat}» no coincide con ningún hueso')
        # animaciones
        for k, aid in d.get('animations', {}).items():
            if aid.startswith('controller.'):
                if aid not in acs:
                    rep.err(f'{ident}: controlador de animación no existe: {aid}')
                continue
            if aid not in anims:
                rep.err(f'{ident}: animación no existe: {aid}')
                continue
            bones_all = set()
            for gid in geom.values():
                if gid in geos:
                    bones_all |= {b['name'] for b in geos[gid].get('bones', [])}
            for bn in anims[aid].get('bones', {}):
                if bn not in bones_all:
                    rep.warn(f'{ident}: la animación {aid} mueve el hueso «{bn}» que no existe')
        for a in d.get('scripts', {}).get('animate', []):
            nm = a if isinstance(a, str) else list(a.keys())[0]
            if nm not in d.get('animations', {}):
                rep.err(f'{ident}: scripts.animate usa «{nm}» que no está en animations')
        # pares geometría/textura
        gl = [(k, geos[g]) for k, g in geom.items() if g in geos]
        if not gl or not imgs:
            continue
        rcname = d.get('render_controllers', [''])[0]
        rcname = rcname if isinstance(rcname, str) else list(rcname.keys())[0]
        R = rcs.get(rcname, {})
        gexpr, texpr = R.get('geometry', ''), ' '.join(R.get('textures', []))
        independent = 'q.property' in gexpr and 'q.property' in texpr and \
            re.findall(r"property\('([^']+)'\)", gexpr) != re.findall(r"property\('([^']+)'\)", texpr)
        valid = {}
        cover_any = {}
        for gk, g in gl:
            for tk, img in imgs.items():
                ok, probs, covered = pair_ok(g, img)
                seen_pairs += 1
                valid[(gk, tk)] = (ok, probs)
                for key, v in covered.items():
                    cover_any[(gk,) + key] = cover_any.get((gk,) + key, False) or v
        for (gk, key0, key1), v in cover_any.items():
            if not v:
                rep.err(f'{ident}: geometría {gk}: el cubo {key0}#{key1} no está pintado en ninguna textura')
        for gk, g in gl:
            if not any(valid[(gk, tk)][0] for tk in imgs):
                ex = valid[(gk, next(iter(imgs)))][1][:6]
                rep.err(f'{ident}: la geometría {gk} no tiene ninguna textura que pinte todas sus caras visibles (p. ej. {ex})')
        for tk in imgs:
            if not any(valid[(gk, tk)][0] for gk, _ in gl):
                ex = valid[(gl[0][0], tk)][1][:6]
                rep.err(f'{ident}: la textura {tk} no encaja con ninguna geometría (caras sin pintar: {ex})')
        if len(gl) == 1 or independent:
            for (gk, tk), (ok, probs) in valid.items():
                if not ok:
                    rep.err(f'{ident}: {gk}+{tk}: caras sin pintar {probs[:6]}')
    rep.info.append(f'{len(entities)} entidades de cliente, {len(geos)} geometrías, {seen_pairs} pares geometría/textura')
    # ---------------- partículas ----------------
    pids = set()
    for path in sorted(glob.glob(os.path.join(rp, 'particles', '*.json'))):
        data = load_json(path)
        pe = data.get('particle_effect', {})
        ident = pe.get('description', {}).get('identifier')
        pids.add(ident)
        brp = pe.get('description', {}).get('basic_render_parameters', {})
        tex = brp.get('texture')
        p = find_texture(rp, tex) if tex else None
        if not p and tex not in ('atlas.terrain', 'atlas.items'):
            rep.err(f'partícula {ident}: textura {tex} no existe')
            continue
        if brp.get('material') not in ('particles_alpha', 'particles_blend', 'particles_add', 'particles_opaque'):
            rep.err(f'partícula {ident}: material desconocido {brp.get("material")}')
        comps = pe.get('components', {})
        bb = comps.get('minecraft:particle_appearance_billboard')
        if not bb:
            rep.err(f'partícula {ident}: sin minecraft:particle_appearance_billboard')
            continue
        uv = bb.get('uv', {})
        tw, th = uv.get('texture_width', 1), uv.get('texture_height', 1)
        if p:
            im = Image.open(p)
            if (im.width, im.height) != (tw, th):
                rep.warn(f'partícula {ident}: texture_width/height {tw}×{th} ≠ imagen {im.width}×{im.height}')
            rects = []
            fb = uv.get('flipbook')
            if fb:
                bx, by = fb['base_UV']
                sw, sh = fb['size_UV']
                stx, sty = fb.get('step_UV', [0, 0])
                mf = fb.get('max_frame', 1)
                if all(isinstance(v, (int, float)) for v in (bx, by, sw, sh, stx, sty, mf)):
                    for k in range(int(mf)):
                        rects.append((bx + stx * k, by + sty * k, sw, sh))
            else:
                u = uv.get('uv', [0, 0])
                us = uv.get('uv_size', [tw, th])
                for cand in _uv_candidates(u, us):
                    rects.append(cand)
            ipx = im.convert('RGBA').load()
            for (x, y, w, h) in rects:
                if x < 0 or y < 0 or x + w > tw or y + h > th:
                    rep.err(f'partícula {ident}: UV {(x, y, w, h)} fuera de {tw}×{th}')
                    continue
                n = sum(1 for i in range(int(x), int(x + w)) for j in range(int(y), int(y + h))
                        if ipx[int(i * im.width / tw), int(j * im.height / th)][3] > 0)
                if n == 0:
                    rep.err(f'partícula {ident}: el sprite UV {(x, y, w, h)} está vacío')
        for ev in pe.get('events', {}).values():
            eff = ev.get('particle_effect', {}).get('effect')
            if eff and eff.startswith('rpg:') and not os.path.isfile(os.path.join(rp, 'particles', eff.split(':')[1] + '.json')):
                rep.err(f'partícula {ident}: el evento usa {eff} que no existe')
    rep.info.append(f'{len(pids)} partículas')
    if scripts_dir and os.path.isdir(scripts_dir):
        used = set()
        rx_calls = [
            re.compile(r"spawnParticle\(\s*'(rpg:[a-z0-9_]+)'"),
            re.compile(r"particle\([^,]+,\s*'(rpg:[a-z0-9_]+)'"),
            re.compile(r"px\([^,]+,\s*'(rpg:[a-z0-9_]+)'"),
        ]
        for path in glob.glob(os.path.join(scripts_dir, '**', '*.js'), recursive=True):
            txt = open(path, encoding='utf-8').read()
            for rxc in rx_calls:
                used |= set(rxc.findall(txt))
            if "'rpg:fx_' +" in txt or "'rpg:fx_'+" in txt:
                for el in ('fuego', 'agua', 'tierra', 'viento', 'rayo', 'hielo', 'luz', 'oscuridad', 'necromancia', 'naturaleza', 'arcano', 'sangre'):
                    used.add('rpg:fx_' + el)
        for u in sorted(used):
            if u not in pids:
                rep.err(f'los scripts usan la partícula {u} pero no existe en el RP')
        rep.info.append(f'{len(used)} partículas rpg:* usadas por los scripts')
    # ---------------- glifos ----------------
    gp = os.path.join(rp, 'font', 'glyph_E3.png')
    if not os.path.isfile(gp):
        rep.err('falta font/glyph_E3.png')
    else:
        im = Image.open(gp).convert('RGBA')
        if im.size != (256, 256):
            rep.err(f'glyph_E3.png mide {im.size}, se esperaba 256×256')
        else:
            px = im.load()
            for k in range(16):
                cx, cy = k * 16, 0
                n = sum(1 for i in range(16) for j in range(16) if px[cx + i, cy + j][3])
                border = sum(1 for i in range(16) for j in range(16) if (i in (0, 15) or j in (0, 15)) and px[cx + i, cy + j][3])
                if n < 12:
                    rep.err(f'glifo U+E3{k:02X} vacío o casi vacío ({n} px)')
                if border:
                    rep.err(f'glifo U+E3{k:02X} invade el margen de 1 px')
    # ---------------- objetos ----------------
    itp = os.path.join(rp, 'textures', 'item_texture.json')
    if os.path.isfile(itp):
        for k, v in load_json(itp).get('texture_data', {}).items():
            t = v.get('textures')
            for rel in (t if isinstance(t, list) else [t]):
                if not find_texture(rp, rel):
                    rep.err(f'icono {k}: falta {rel}')
    return entities, geos


def _uv_candidates(u, us):
    """UV posibles para expresiones Molang sencillas (evalúa random 0 y 1)."""
    out = []
    for r in (0.0, 0.999):
        vals = []
        ok = True
        for e in list(u) + list(us):
            if isinstance(e, (int, float)):
                vals.append(float(e))
                continue
            try:
                ex = str(e).lower()
                ex = re.sub(r'v(ariable)?\.particle_random_[1-4]', str(r), ex)
                ex = ex.replace('math.floor', 'math.floor').replace('math.', '__m.')
                vals.append(float(eval(ex, {'__builtins__': {}}, {'__m': math})))  # noqa: S307
            except Exception:  # noqa: BLE001
                ok = False
                break
        if ok:
            out.append(tuple(vals))
    return out


# ======================================================================================
# Hoja de contacto
# ======================================================================================
def contact_sheet(rp, out, entities, geos):
    from PIL import ImageDraw
    tiles = []

    def ent(ident):
        return entities.get(ident, (None, {}))[1]

    def tex_of(d, key):
        p = find_texture(rp, d['textures'][key])
        return Image.open(p) if p else None
    # NPCs: una muestra por raza y clase con sombreros y herramientas variados
    d = ent('rpg:npc')
    if d:
        hats = ['', 'hat1', 'hat2', 'hat3', 'hat4', 'hat5', 'hat6', 'hat7']
        tools = ['', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5', 'tool6', 'tool7']
        k = 0
        for race in range(10):
            for cls in range(4):
                idx = race * 16 + cls * 4 + ((race + cls) % 2) * 2 + (race % 2)
                gi = [0, 2, 0, 0, 3, 1, 4, 0, 5, 1][race]
                geo = geos.get(d['geometry'].get(f'g{gi}'))
                img = tex_of(d, f's{idx}')
                if not geo or img is None:
                    continue
                hat = 'hat4' if cls == 3 else hats[(k * 3) % 8]
                tool = 'tool2' if cls == 3 and k % 2 else ('tool1' if cls == 3 else tools[(k * 5) % 8])
                mood = ['', 'lids', 'brows', 'mouth_h'][k % 4]

                def hid(n, hat=hat, tool=tool, mood=mood):
                    if n.startswith('hat') and not n.startswith(hat or '@'):
                        return True
                    if n.startswith('tool') and not n.startswith(tool or '@'):
                        return True
                    if n in ('lids', 'brows', 'mouth_h', 'mouth_a'):
                        return not (n == mood or (mood == 'brows' and n == 'mouth_a'))
                    if n == 'alert':
                        return k % 7 != 3
                    return False
                tiles.append(render(geo, img, yaw=-28 if k % 2 else 25, pitch=10, scale=5, hidden=hid))
                k += 1
    # Monstruos, jefes, espíritus y demás
    for ident in sorted(entities):
        if ident == 'rpg:npc':
            continue
        d = ent(ident)
        geom = d.get('geometry', {})
        texs = d.get('textures', {})
        if ident == 'rpg:spirit':
            gmap = {0: 'wisp', 1: 'humanoid', 2: 'beast'}
            sg = [0, 0, 1, 0, 2, 2, 0, 1, 1, 2, 0, 0]
            for v in range(12):
                g = geos.get(geom.get(gmap[sg[v]]))
                img = tex_of(d, f'v{v}') if f'v{v}' in texs else None
                if g and img:
                    tiles.append(render(g, img, yaw=-30, pitch=12, scale=5))
            continue
        gk = 'default' if 'default' in geom else (next(iter(geom)) if geom else None)
        tk = 'default' if 'default' in texs else (next(iter(texs)) if texs else None)
        if not gk or not tk or geom[gk] not in geos:
            continue
        img = tex_of(d, tk)
        if img is None:
            continue
        g = geos[geom[gk]]
        sc = 5 if g['description']['visible_bounds_width'] <= 3 else 3
        tiles.append(render(g, img, yaw=-35, pitch=14, scale=sc))
    # Glifos, atlas de partículas e iconos
    gp = os.path.join(rp, 'font', 'glyph_E3.png')
    if os.path.isfile(gp):
        g = Image.open(gp).convert('RGBA').crop((0, 0, 256, 16))
        tiles.append(g.resize((256 * 3, 48), Image.NEAREST))
    for p in sorted(glob.glob(os.path.join(rp, 'textures', 'particle', 'rpg_fx*.png'))):
        im = Image.open(p).convert('RGBA')
        bg = Image.new('RGBA', im.size, (24, 24, 32, 255))
        bg.alpha_composite(im)
        tiles.append(bg.resize((im.width * 3, im.height * 3), Image.NEAREST))
    icons = sorted(glob.glob(os.path.join(rp, 'textures', 'items', '*.png')))
    if icons:
        strip = Image.new('RGBA', (len(icons) * 18, 16), (0, 0, 0, 0))
        for k, p in enumerate(icons):
            strip.alpha_composite(Image.open(p).convert('RGBA'), (k * 18, 0))
        tiles.append(strip.resize((strip.width * 3, 48), Image.NEAREST))
    # Composición en filas
    maxw = 1800
    rows, row, rw, rh = [], [], 0, 0
    for t in tiles:
        if rw + t.width + 6 > maxw and row:
            rows.append((row, rh))
            row, rw, rh = [], 0, 0
        row.append(t)
        rw += t.width + 6
        rh = max(rh, t.height)
    if row:
        rows.append((row, rh))
    H = sum(h + 6 for _, h in rows) + 6
    sheet = Image.new('RGBA', (maxw, max(8, H)), (58, 62, 74, 255))
    y = 6
    for row, h in rows:
        x = 6
        for t in row:
            sheet.alpha_composite(t, (x, y + h - t.height))
            x += t.width + 6
        y += h + 6
    sheet.save(out)
    return out


def main(argv):
    rp = os.path.join(ROOT, 'packs', 'AetheriaRPG_RP')
    sheet = None
    if '--rp' in argv:
        rp = argv[argv.index('--rp') + 1]
    if '--sheet' in argv:
        sheet = argv[argv.index('--sheet') + 1]
    rep = Report()
    entities, geos = check(rp, rep, os.path.join(ROOT, 'packs', 'AetheriaRPG_BP', 'scripts'))
    for m in rep.info:
        print('·', m)
    for w in rep.warnings:
        print('AVISO:', w)
    for e in rep.errors:
        print('ERROR:', e)
    if sheet:
        contact_sheet(rp, sheet, entities, geos)
        print('Hoja de contacto:', sheet)
    print(f'{len(rep.errors)} errores, {len(rep.warnings)} avisos')
    return 1 if rep.errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
