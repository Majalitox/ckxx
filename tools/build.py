#!/usr/bin/env python3
"""Genera los recursos del add-on Aetheria RPG (BP + RP) y empaqueta el .mcaddon.

Uso:
    python3 tools/build.py            # regenera JSON/texturas y crea dist/AetheriaRPG.mcaddon
    python3 tools/build.py --no-zip   # solo regenera

Los scripts (packs/AetheriaRPG_BP/scripts) se escriben a mano; todo lo demás se genera aquí.
"""
import json
import os
import shutil
import sys
import zipfile
import zlib

sys.path.insert(0, os.path.dirname(__file__))
import gen_textures as T  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BP = os.path.join(ROOT, 'packs', 'AetheriaRPG_BP')
RP = os.path.join(ROOT, 'packs', 'AetheriaRPG_RP')
VERSION = [1, 0, 0]
MIN_ENGINE = [1, 21, 90]

UUID = {
    'bp_header': 'a3e1c7d2-5b4f-4e8a-9c1d-2f6b7e8a9d01',
    'bp_data': 'b4f2d8e3-6c5a-4f9b-8d2e-3a7c8f9b0e12',
    'bp_script': 'c5a3e9f4-7d6b-4a0c-9e3f-4b8d9a0c1f23',
    'rp_header': 'd6b4fa05-8e7c-4b1d-af40-5c9eab1d2a34',
    'rp_res': 'e7c50b16-9f8d-4c2e-b051-6daf0c2e3b45',
}


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        if isinstance(data, str):
            f.write(data)
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')


def png(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


# ======================================================================================
# Manifiestos
# ======================================================================================
def manifests():
    write(os.path.join(BP, 'manifest.json'), {
        'format_version': 2,
        'header': {
            'name': 'Aetheria RPG §7(Comportamiento)',
            'description': 'RPG completo: nacimiento y familia, razas, 600 hechizos, rangos F-SSS, Gremio, misiones diarias, NPCs con chat, mazmorras y jefes.',
            'uuid': UUID['bp_header'], 'version': VERSION, 'min_engine_version': MIN_ENGINE,
        },
        'modules': [
            {'type': 'data', 'uuid': UUID['bp_data'], 'version': VERSION},
            {'type': 'script', 'language': 'javascript', 'uuid': UUID['bp_script'], 'version': VERSION, 'entry': 'scripts/main.js'},
        ],
        'dependencies': [
            {'uuid': UUID['rp_header'], 'version': VERSION},
            {'module_name': '@minecraft/server', 'version': '2.0.0'},
            {'module_name': '@minecraft/server-ui', 'version': '2.0.0'},
        ],
        'metadata': {'authors': ['Aetheria RPG'], 'product_type': 'addon'},
    })
    write(os.path.join(RP, 'manifest.json'), {
        'format_version': 2,
        'header': {
            'name': 'Aetheria RPG §7(Recursos)',
            'description': 'Modelos, texturas, partículas y textos de Aetheria RPG.',
            'uuid': UUID['rp_header'], 'version': VERSION, 'min_engine_version': MIN_ENGINE,
        },
        'modules': [{'type': 'resources', 'uuid': UUID['rp_res'], 'version': VERSION}],
        'dependencies': [{'uuid': UUID['bp_header'], 'version': VERSION}],
        'metadata': {'authors': ['Aetheria RPG'], 'product_type': 'addon'},
    })
    T.pack_icon(png(os.path.join(BP, 'pack_icon.png')), '#c070ff', 1)
    T.pack_icon(png(os.path.join(RP, 'pack_icon.png')), '#ffb040', 2)


# ======================================================================================
# Geometrías
# ======================================================================================
def cube(origin, size, uv, **kw):
    c = {'origin': origin, 'size': size, 'uv': uv}
    c.update(kw)
    return c


def humanoid_bones(extra=()):
    bones = [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'body', 'parent': 'root', 'pivot': [0, 24, 0], 'cubes': [cube([-4, 12, -2], [8, 12, 4], [16, 16])]},
        {'name': 'head', 'parent': 'body', 'pivot': [0, 24, 0], 'cubes': [cube([-4, 24, -4], [8, 8, 8], [0, 0])]},
        {'name': 'rightArm', 'parent': 'body', 'pivot': [-5, 22, 0], 'cubes': [cube([-8, 12, -2], [4, 12, 4], [40, 16])]},
        {'name': 'leftArm', 'parent': 'body', 'pivot': [5, 22, 0], 'cubes': [cube([4, 12, -2], [4, 12, 4], [32, 48])]},
        {'name': 'rightLeg', 'parent': 'root', 'pivot': [-1.9, 12, 0], 'cubes': [cube([-3.9, 0, -2], [4, 12, 4], [0, 16])]},
        {'name': 'leftLeg', 'parent': 'root', 'pivot': [1.9, 12, 0], 'cubes': [cube([-0.1, 0, -2], [4, 12, 4], [16, 48])]},
    ]
    return bones + list(extra)


EXTRA = {
    'horns': [
        {'name': 'hornR', 'parent': 'head', 'pivot': [-3, 32, 0], 'rotation': [0, 0, 20], 'cubes': [cube([-4, 31, -1], [2, 4, 2], [40, 32])]},
        {'name': 'hornL', 'parent': 'head', 'pivot': [3, 32, 0], 'rotation': [0, 0, -20], 'cubes': [cube([2, 31, -1], [2, 4, 2], [48, 32])]},
    ],
    'crown': [{'name': 'crown', 'parent': 'head', 'pivot': [0, 32, 0], 'cubes': [cube([-4, 32, -4], [8, 2, 8], [0, 32], inflate=0.4)]}],
    'elf': [
        {'name': 'earR', 'parent': 'head', 'pivot': [-4, 28, 0], 'rotation': [0, -25, 0], 'cubes': [cube([-5, 27, -1], [1, 3, 2], [32, 0])]},
        {'name': 'earL', 'parent': 'head', 'pivot': [4, 28, 0], 'rotation': [0, 25, 0], 'cubes': [cube([4, 27, -1], [1, 3, 2], [38, 0])]},
    ],
    'beast': [
        {'name': 'earR', 'parent': 'head', 'pivot': [-3, 32, 0], 'cubes': [cube([-4, 32, -1], [2, 2, 1], [44, 0])]},
        {'name': 'earL', 'parent': 'head', 'pivot': [3, 32, 0], 'cubes': [cube([2, 32, -1], [2, 2, 1], [50, 0])]},
        {'name': 'tail', 'parent': 'body', 'pivot': [0, 13, 2], 'rotation': [-40, 0, 0], 'cubes': [cube([-1, 12, 2], [2, 2, 8], [44, 38])]},
    ],
    'halo': [{'name': 'halo', 'parent': 'head', 'pivot': [0, 34, 0], 'cubes': [cube([-3, 34, -3], [6, 1, 6], [0, 32])]}],
    'wings': [
        {'name': 'wingR', 'parent': 'body', 'pivot': [-1, 22, 2], 'rotation': [0, 25, 0], 'cubes': [cube([-7, 13, 2], [6, 10, 0], [32, 36])]},
        {'name': 'wingL', 'parent': 'body', 'pivot': [1, 22, 2], 'rotation': [0, -25, 0], 'cubes': [cube([1, 13, 2], [6, 10, 0], [32, 36], mirror=True)]},
    ],
}

HUMANOID_GEOS = {
    'geometry.rpg.humanoid': [],
    'geometry.rpg.humanoid_horns': EXTRA['horns'],
    'geometry.rpg.humanoid_elf': EXTRA['elf'],
    'geometry.rpg.humanoid_beast': EXTRA['beast'],
    'geometry.rpg.humanoid_halo': EXTRA['halo'],
    'geometry.rpg.humanoid_fairy': EXTRA['elf'] + EXTRA['wings'],
    'geometry.rpg.humanoid_crown': EXTRA['crown'],
    'geometry.rpg.humanoid_crown_horns': EXTRA['crown'] + EXTRA['horns'],
}
NPC_GEO_ORDER = ['geometry.rpg.humanoid', 'geometry.rpg.humanoid_horns', 'geometry.rpg.humanoid_elf', 'geometry.rpg.humanoid_beast', 'geometry.rpg.humanoid_halo', 'geometry.rpg.humanoid_fairy']


def geo(identifier, bones, tw=64, th=64, bw=2, bh=3):
    return {'description': {'identifier': identifier, 'texture_width': tw, 'texture_height': th, 'visible_bounds_width': bw, 'visible_bounds_height': bh, 'visible_bounds_offset': [0, bh / 2, 0]}, 'bones': bones}


def geometries():
    out = [geo(k, humanoid_bones(v)) for k, v in HUMANOID_GEOS.items()]
    legs = []
    for name, piv, org, uv in (('legFR', [-2, 7, -4], [-3, 0, -5], [0, 30]), ('legFL', [2, 7, -4], [1, 0, -5], [8, 30]), ('legBR', [-2, 7, 4], [-3, 0, 3], [16, 30]), ('legBL', [2, 7, 4], [1, 0, 3], [24, 30])):
        legs.append({'name': name, 'parent': 'root', 'pivot': piv, 'cubes': [cube(org, [2, 7, 2], uv)]})
    out.append(geo('geometry.rpg.quadruped', [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'body', 'parent': 'root', 'pivot': [0, 10, 0], 'cubes': [cube([-3, 7, -6], [6, 6, 12], [0, 0])]},
        {'name': 'head', 'parent': 'body', 'pivot': [0, 11, -6], 'cubes': [cube([-3, 8, -11], [6, 6, 5], [0, 18]), cube([-1.5, 8, -14], [3, 3, 3], [22, 18]), cube([-3, 14, -9], [2, 2, 1], [36, 0]), cube([1, 14, -9], [2, 2, 1], [42, 0])]},
        {'name': 'tail', 'parent': 'body', 'pivot': [0, 12, 6], 'rotation': [-35, 0, 0], 'cubes': [cube([-1, 10, 6], [2, 2, 7], [36, 4])]},
    ] + legs, bw=2, bh=2))
    spider_legs = []
    for i, (z, ry) in enumerate(((-3, 40), (-1, 15), (1, -15), (3, -40))):
        spider_legs.append({'name': f'legR{i}', 'parent': 'root', 'pivot': [-3, 7, z], 'rotation': [0, ry, 35], 'cubes': [cube([-19, 6, z - 1], [16, 2, 2], [0, 36])]})
        spider_legs.append({'name': f'legL{i}', 'parent': 'root', 'pivot': [3, 7, z], 'rotation': [0, -ry, -35], 'cubes': [cube([3, 6, z - 1], [16, 2, 2], [0, 36], mirror=True)]})
    out.append(geo('geometry.rpg.arthropod', [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'abdomen', 'parent': 'root', 'pivot': [0, 6, 2], 'cubes': [cube([-5, 4, 2], [10, 8, 12], [0, 0])]},
        {'name': 'thorax', 'parent': 'root', 'pivot': [0, 7, 0], 'cubes': [cube([-3, 5, -4], [6, 6, 6], [0, 20])]},
        {'name': 'head', 'parent': 'thorax', 'pivot': [0, 7, -4], 'cubes': [cube([-4, 4, -12], [8, 8, 8], [24, 20])]},
    ] + spider_legs, bw=3, bh=2))
    out.append(geo('geometry.rpg.mimic', [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'base', 'parent': 'root', 'pivot': [0, 0, 0], 'cubes': [cube([-7, 0, -7], [14, 10, 14], [0, 19]), cube([-2, 10, -5], [4, 1, 6], [0, 43])]},
        {'name': 'lid', 'parent': 'root', 'pivot': [0, 10, 7], 'cubes': [cube([-7, 10, -7], [14, 5, 14], [0, 0]), cube([-1, 8, -8], [2, 4, 1], [20, 43])]},
    ], bw=2, bh=2))
    out.append(geo('geometry.rpg.wisp', [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'core', 'parent': 'root', 'pivot': [0, 10, 0], 'cubes': [cube([-3, 7, -3], [6, 6, 6], [0, 0])]},
        {'name': 'orbit', 'parent': 'core', 'pivot': [0, 10, 0], 'cubes': [cube([4, 9, -1], [2, 2, 2], [0, 12]), cube([-6, 9, -1], [2, 2, 2], [0, 12]), cube([-1, 9, 4], [2, 2, 2], [0, 12]), cube([-1, 9, -6], [2, 2, 2], [0, 12])]},
    ], tw=32, th=32, bw=1.5, bh=2))
    dragon_legs = []
    for name, piv, org in (('legFR', [-5, 10, -6], [-7, 0, -8]), ('legFL', [5, 10, -6], [3, 0, -8]), ('legBR', [-5, 10, 6], [-7, 0, 4]), ('legBL', [5, 10, 6], [3, 0, 4])):
        dragon_legs.append({'name': name, 'parent': 'root', 'pivot': piv, 'cubes': [cube(org, [4, 10, 4], [0, 72])]})
    out.append(geo('geometry.rpg.dragon', [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'body', 'parent': 'root', 'pivot': [0, 14, 0], 'cubes': [cube([-6, 10, -10], [12, 10, 22], [0, 0])]},
        {'name': 'neck', 'parent': 'body', 'pivot': [0, 18, -10], 'rotation': [-20, 0, 0], 'cubes': [cube([-3, 15, -20], [6, 6, 10], [68, 0])]},
        {'name': 'head', 'parent': 'neck', 'pivot': [0, 18, -20], 'rotation': [20, 0, 0], 'cubes': [cube([-5, 14, -32], [10, 8, 12], [0, 32]), cube([-4, 22, -26], [2, 2, 6], [80, 32]), cube([2, 22, -26], [2, 2, 6], [80, 32])]},
        {'name': 'jaw', 'parent': 'head', 'pivot': [0, 14, -21], 'cubes': [cube([-4, 11, -31], [8, 3, 10], [44, 32])]},
        {'name': 'tail', 'parent': 'body', 'pivot': [0, 15, 12], 'rotation': [-10, 0, 0], 'cubes': [cube([-3, 12, 12], [6, 6, 14], [0, 52])]},
        {'name': 'tail2', 'parent': 'tail', 'pivot': [0, 15, 26], 'rotation': [-10, 0, 0], 'cubes': [cube([-2, 13, 26], [4, 4, 12], [40, 52])]},
        {'name': 'wingR', 'parent': 'body', 'pivot': [-6, 20, -4], 'cubes': [cube([-30, 19, -6], [24, 1, 16], [0, 88])]},
        {'name': 'wingL', 'parent': 'body', 'pivot': [6, 20, -4], 'cubes': [cube([6, 19, -6], [24, 1, 16], [0, 88], mirror=True)]},
    ] + dragon_legs, tw=128, th=128, bw=8, bh=5))
    write(os.path.join(RP, 'models', 'entity', 'rpg.geo.json'), {'format_version': '1.12.0', 'minecraft:geometry': out})


# ======================================================================================
# Animaciones y controladores de renderizado
# ======================================================================================
def animations():
    walk = 'math.cos(q.modified_distance_moved * 38.17) * {a} * q.modified_move_speed'
    anims = {
        'animation.rpg.humanoid.walk': {'loop': True, 'bones': {
            'rightArm': {'rotation': [walk.format(a=40), 0, 0]},
            'leftArm': {'rotation': ['-' + walk.format(a=40), 0, 0]},
            'rightLeg': {'rotation': ['-' + walk.format(a=45), 0, 0]},
            'leftLeg': {'rotation': [walk.format(a=45), 0, 0]},
        }},
        'animation.rpg.humanoid.idle': {'loop': True, 'bones': {
            'rightArm': {'rotation': [0, 0, 'math.cos(q.life_time * 90) * 3 + 3']},
            'leftArm': {'rotation': [0, 0, '-math.cos(q.life_time * 90) * 3 - 3']},
        }},
        'animation.rpg.humanoid.attack': {'loop': True, 'bones': {
            'rightArm': {'rotation': ['-math.sin((v.attack_time ?? 0) * 180) * 90', 0, 0]},
        }},
        'animation.rpg.look_at_target': {'loop': True, 'bones': {'head': {'rotation': ['q.target_x_rotation', 'q.target_y_rotation', 0]}}},
        'animation.rpg.quadruped.walk': {'loop': True, 'bones': {
            'legFR': {'rotation': [walk.format(a=50), 0, 0]}, 'legBL': {'rotation': [walk.format(a=50), 0, 0]},
            'legFL': {'rotation': ['-' + walk.format(a=50), 0, 0]}, 'legBR': {'rotation': ['-' + walk.format(a=50), 0, 0]},
            'tail': {'rotation': [0, 'math.cos(q.life_time * 200) * 10', 0]},
        }},
        'animation.rpg.arthropod.walk': {'loop': True, 'bones': {
            **{f'legR{i}': {'rotation': [0, f'math.cos(q.modified_distance_moved * 60 + {i * 90}) * 20 * q.modified_move_speed', f'math.abs(math.sin(q.modified_distance_moved * 60 + {i * 90})) * 15 * q.modified_move_speed']} for i in range(4)},
            **{f'legL{i}': {'rotation': [0, f'-math.cos(q.modified_distance_moved * 60 + {i * 90}) * 20 * q.modified_move_speed', f'-math.abs(math.sin(q.modified_distance_moved * 60 + {i * 90})) * 15 * q.modified_move_speed']} for i in range(4)},
        }},
        'animation.rpg.mimic.chomp': {'loop': True, 'bones': {'lid': {'rotation': ['-math.abs(math.sin(q.life_time * 300)) * (15 + 25 * q.modified_move_speed)', 0, 0]}}},
        'animation.rpg.wisp.float': {'loop': True, 'bones': {
            'core': {'position': [0, 'math.sin(q.life_time * 150) * 1.5', 0]},
            'orbit': {'rotation': [0, 'q.life_time * 180', 0]},
        }},
        'animation.rpg.dragon.fly': {'loop': True, 'bones': {
            'wingR': {'rotation': [0, 0, 'math.sin(q.life_time * 120) * 25']},
            'wingL': {'rotation': [0, 0, '-math.sin(q.life_time * 120) * 25']},
            'tail': {'rotation': ['-10', 'math.sin(q.life_time * 80) * 10', 0]},
            'jaw': {'rotation': ['math.abs(math.sin(q.life_time * 60)) * 12', 0, 0]},
            'legFR': {'rotation': [walk.format(a=35), 0, 0]}, 'legBL': {'rotation': [walk.format(a=35), 0, 0]},
            'legFL': {'rotation': ['-' + walk.format(a=35), 0, 0]}, 'legBR': {'rotation': ['-' + walk.format(a=35), 0, 0]},
        }},
    }
    write(os.path.join(RP, 'animations', 'rpg.animation.json'), {'format_version': '1.8.0', 'animations': anims})

    rcs = {
        'controller.render.rpg.default': {'geometry': 'Geometry.default', 'materials': [{'*': 'Material.default'}], 'textures': ['Texture.default']},
        'controller.render.rpg.npc': {
            'arrays': {
                'textures': {'Array.skins': [f'Texture.s{i}' for i in range(40)]},
                'geometries': {'Array.geos': [f'Geometry.g{i}' for i in range(len(NPC_GEO_ORDER))]},
            },
            'geometry': "Array.geos[q.property('rpg:geo')]",
            'materials': [{'*': 'Material.default'}],
            'textures': ["Array.skins[q.property('rpg:skin')]"],
        },
        'controller.render.rpg.spirit': {
            'arrays': {
                'textures': {'Array.skins': [f'Texture.v{i}' for i in range(12)]},
                'geometries': {'Array.geos': ['Geometry.wisp', 'Geometry.humanoid', 'Geometry.quadruped']},
            },
            'geometry': 'Array.geos[v.geo_idx]',
            'materials': [{'*': 'Material.default'}],
            'textures': ["Array.skins[q.property('rpg:variant')]"],
        },
    }
    write(os.path.join(RP, 'render_controllers', 'rpg.render_controllers.json'), {'format_version': '1.10.0', 'render_controllers': rcs})


# ======================================================================================
# Datos de criaturas
# ======================================================================================
# geo, textura (spec), escala, caja de colisión, vida, daño, velocidad, rango, familias extra, opciones
MOBS = {
    'goblin': dict(name='Goblin', geo='humanoid', scale=0.7, box=(0.5, 1.3), hp=16, dmg=3, speed=0.3, fam=['goblin'],
                   tex=dict(skin='#5d9a3a', bald=True, eyes='#ffd020', shirt='#6b4a2a', pants='#4a3420', shoes='#2a1a10', tusks=False, ears='#5d9a3a'), ears=True,
                   egg=('#5d9a3a', '#6b4a2a'), spawn=dict(tags=['forest', 'plains', 'taiga', 'rpg_enchanted', 'jungle'], weight=40, herd=(2, 4), dark=False)),
    'dire_wolf': dict(name='Lobo Huargo', geo='quadruped', scale=1.35, box=(0.9, 1.1), hp=24, dmg=5, speed=0.33, fam=['wolf_like'],
                      quad=dict(fur='#3d3d42', eyes='#ff3030', belly='#5a5a60'), egg=('#3d3d42', '#ff3030'),
                      spawn=dict(tags=['taiga', 'forest', 'cold', 'mountains', 'extreme_hills'], weight=25, herd=(2, 3), dark=True)),
    'orc': dict(name='Orco Salvaje', geo='humanoid', scale=1.2, box=(0.75, 2.2), hp=36, dmg=7, speed=0.27, fam=['orc'],
                tex=dict(skin='#4a7a3a', hair='#1a1a1a', eyes='#d02020', armor='#6a6a72', pants='#3a2a1a', tusks=True, trim='#8a6a2a'),
                egg=('#4a7a3a', '#6a6a72'), spawn=dict(tags=['savanna', 'mesa', 'plains', 'rpg_cursed'], weight=18, herd=(1, 3), dark=False)),
    'scorpion': dict(name='Escorpión de las Dunas', geo='arthropod', scale=1.0, box=(1.3, 0.8), hp=28, dmg=6, speed=0.3, fam=['arthropod'], attack_effect='poison',
                     arth=dict(body='#c2a060', accent='#8a6a30'), egg=('#c2a060', '#8a6a30'),
                     spawn=dict(tags=['desert', 'mesa', 'rpg_ash'], weight=25, herd=(1, 2), dark=False)),
    'skeleton_knight': dict(name='Caballero Esqueleto', geo='humanoid', scale=1.05, box=(0.6, 1.95), hp=40, dmg=8, speed=0.26, fam=['undead', 'skeleton'], undead=True,
                            tex=dict(bones='#d8d8c8', armor='#5a5a62', helmet='#6a6a72', eyes='#ff4020', trim='#8a2a2a'),
                            egg=('#d8d8c8', '#5a5a62'), spawn=dict(tags=['monster'], weight=12, herd=(1, 2), dark=True)),
    'giant_spider': dict(name='Araña Gigante', geo='arthropod', scale=1.6, box=(2.0, 1.2), hp=36, dmg=7, speed=0.32, fam=['arthropod'], attack_effect='poison',
                         arth=dict(body='#3b2a1a', accent='#6a1a1a'), egg=('#3b2a1a', '#6a1a1a'),
                         spawn=dict(tags=['monster'], weight=15, herd=(1, 1), dark=True, underground=True)),
    'wraith': dict(name='Espectro', geo='humanoid', scale=1.0, box=(0.6, 1.9), hp=34, dmg=7, speed=0.3, fam=['undead'], undead=True, attack_effect='wither',
                   tex=dict(skin='#9a9aa8', robe='#1a1a24', hood='#141420', eyes='#a040ff', glow=True, translucent=True),
                   egg=('#1a1a24', '#a040ff'), spawn=dict(tags=['swamp', 'rpg_necro', 'rpg_cursed', 'roofed_forest'], weight=20, herd=(1, 2), dark=True)),
    'mimic': dict(name='Mímico', geo='mimic', scale=1.0, box=(0.9, 0.95), hp=50, dmg=10, speed=0.22, fam=['mimic'], mim=True, egg=('#8a5a2a', '#e8c040'), spawn=None),
    'dark_mage': dict(name='Mago Oscuro', geo='humanoid', scale=1.0, box=(0.6, 1.9), hp=34, dmg=4, speed=0.25, fam=['illager_like'], ranged=True,
                      tex=dict(skin='#c8b8a8', robe='#3a1a5a', hood='#2a1040', eyes='#c040ff', glow=True),
                      egg=('#3a1a5a', '#c040ff'), spawn=dict(tags=['rpg_cursed', 'roofed_forest', 'swamp', 'monster'], weight=5, herd=(1, 1), dark=True)),
    'ice_golem': dict(name='Gólem de Escarcha', geo='humanoid', scale=1.6, box=(1.0, 3.0), hp=70, dmg=10, speed=0.22, fam=['golem_like'], attack_effect='slowness',
                      tex=dict(skin='#a0d8ef', bald=True, shirt='#80c0e0', pants='#70b0d8', shoes='#5090c0', eyes='#20f0ff', glow=True),
                      egg=('#a0d8ef', '#20f0ff'), spawn=dict(tags=['frozen', 'cold', 'rpg_crystal'], weight=10, herd=(1, 1), dark=False)),
    'fire_imp': dict(name='Diablillo de Fuego', geo='humanoid_horns', scale=0.6, box=(0.45, 1.15), hp=24, dmg=4, speed=0.33, fam=['imp'], ranged=True, fire=True,
                     tex=dict(skin='#b02a1a', bald=True, eyes='#ffd020', shirt='#3a0a0a', pants='#2a0808', horns='#1a1010', glow=True),
                     egg=('#b02a1a', '#ffd020'), spawn=dict(tags=['nether', 'rpg_ash'], weight=20, herd=(1, 3), dark=False)),
    'troll': dict(name='Trol de las Cavernas', geo='humanoid', scale=1.8, box=(1.1, 3.3), hp=110, dmg=13, speed=0.24, fam=['troll'], regen=True,
                  tex=dict(skin='#6b7a5a', hair='#2a2a1a', eyes='#ffaa00', shirt='#6b7a5a', pants='#5a3a1a', shoes='#6b7a5a', tusks=True),
                  egg=('#6b7a5a', '#5a3a1a'), spawn=dict(tags=['monster'], weight=6, herd=(1, 1), dark=True, underground=True)),
    'demon_knight': dict(name='Caballero Demoníaco', geo='humanoid_horns', scale=1.3, box=(0.8, 2.5), hp=140, dmg=16, speed=0.27, fam=['demon'], fire=True, attack_effect='weakness',
                         tex=dict(skin='#3a0a0a', armor='#202024', helmet='#18181c', horns='#a01010', eyes='#ff2020', trim='#a01010', pants='#202024'),
                         egg=('#202024', '#a01010'), spawn=dict(tags=['nether'], weight=6, herd=(1, 1), dark=False)),
}

BOSSES = {
    'goblin_king': dict(name='Rey Goblin', geo='humanoid_crown', scale=1.8, box=(1.1, 3.2), hp=220, dmg=9, speed=0.27,
                        tex=dict(skin='#5d9a3a', bald=True, eyes='#ff3020', shirt='#a01818', pants='#4a3420', crown='#e8b830', cape='#a01818', tusks=True),
                        loot=[('minecraft:gold_ingot', 4, 9), ('rpg:boss_core', 1, 1), ('minecraft:emerald', 2, 5)], egg=('#5d9a3a', '#e8b830')),
    'spider_queen': dict(name='Reina Araña', geo='arthropod', scale=3.0, box=(3.5, 2.2), hp=380, dmg=11, speed=0.3, attack_effect='poison',
                         arth=dict(body='#1a121c', accent='#a01030', eyes='#ff00a0'), loot=[('minecraft:string', 10, 20), ('rpg:boss_core', 1, 1), ('minecraft:diamond', 1, 3)], egg=('#1a121c', '#a01030')),
    'ancient_golem': dict(name='Gólem Ancestral', geo='humanoid', scale=2.6, box=(1.6, 4.6), hp=650, dmg=16, speed=0.2, kb=1.0,
                          tex=dict(skin='#8a8a8a', bald=True, eyes='#ff9020', glow=True, shirt='#7a7a7a', pants='#6a6a6a', shoes='#5a5a5a', belt='#4a7a3a'),
                          loot=[('minecraft:iron_block', 2, 4), ('rpg:boss_core', 1, 2), ('rpg:mithril_ingot', 3, 6)], egg=('#8a8a8a', '#ff9020')),
    'lich': dict(name='Liche Eterno', geo='humanoid_crown', scale=1.4, box=(0.8, 2.6), hp=820, dmg=12, speed=0.25, undead=True,
                 tex=dict(bones='#c8c0d8', robe='#3a1a4a', crown='#8a7020', eyes='#40ff80', glow=True),
                 loot=[('rpg:boss_core', 2, 2), ('minecraft:diamond', 3, 6), ('rpg:greater_mana_potion', 2, 4), ('rpg:staff_archmage', 0, 1)], egg=('#3a1a4a', '#40ff80')),
    'demon_lord': dict(name='Azazel, Señor Demonio', geo='humanoid_horns', scale=2.2, box=(1.3, 4.0), hp=1400, dmg=20, speed=0.27, fire=True,
                       tex=dict(skin='#8b1a1a', hair='#101010', armor='#1a1a1a', horns='#e0d0b0', eyes='#ffd020', glow=True, trim='#ff6020', cape='#3a0a0a', pants='#1a1a1a'),
                       loot=[('rpg:boss_core', 2, 3), ('rpg:adamantite_ingot', 3, 6), ('minecraft:netherite_ingot', 1, 1)], egg=('#8b1a1a', '#ffd020')),
    'ash_dragon': dict(name='Wyrm de Ceniza', geo='dragon', scale=2.2, box=(3.5, 3.2), hp=2200, dmg=24, speed=0.28, fire=True,
                       drag=dict(body='#3a3434', belly='#c86020', wing='#5a2a1a'), loot=[('rpg:boss_core', 3, 4), ('minecraft:diamond_block', 1, 2), ('rpg:adamantite_ingot', 6, 10)], egg=('#3a3434', '#c86020')),
    'void_king': dict(name='El Rey del Vacío', geo='humanoid_crown_horns', scale=2.4, box=(1.4, 4.4), hp=3500, dmg=26, speed=0.28, fire=True,
                      tex=dict(skin='#1a0a2a', hair='#000000', armor='#0a0a14', crown='#6020a0', horns='#3a1a5a', eyes='#d040ff', glow=True, trim='#8030ff', cape='#14081e', pants='#0a0a14'),
                      loot=[('rpg:boss_core', 5, 6), ('minecraft:nether_star', 1, 1), ('minecraft:netherite_ingot', 2, 3), ('minecraft:enchanted_golden_apple', 1, 2)], egg=('#1a0a2a', '#d040ff')),
}

TIER_MULT = [1, 1.5, 2.2, 3.2, 4.5]
ELEMENT_COLORS = ['#ff6a10', '#3a80ff', '#9a6a3a', '#d8ffe8', '#ffe840', '#a0e8ff', '#fff6b0', '#5a1a8a', '#6ae880', '#4ae030', '#d070ff', '#c01020']
SPIRIT_GEO = [0, 0, 1, 0, 2, 2, 0, 1, 1, 2, 0, 0]  # 0 fuego fatuo, 1 humanoide, 2 bestia


def tex_path(kind, name):
    return f'textures/entity/rpg/{kind}/{name}'


def make_mob_texture(key, m, kind):
    path = png(os.path.join(RP, tex_path(kind, key) + '.png'))
    seed = zlib.crc32(key.encode()) % 10000
    if m['geo'].startswith('humanoid'):
        T.humanoid(path, m['tex'], seed)
    elif m['geo'] == 'quadruped':
        T.quadruped(path, m['quad']['fur'], m['quad']['eyes'], m['quad'].get('belly'), seed)
    elif m['geo'] == 'arthropod':
        T.arthropod(path, m['arth']['body'], m['arth']['accent'], m['arth'].get('eyes', '#ff2020'), seed)
    elif m['geo'] == 'mimic':
        T.mimic(path, seed)
    elif m['geo'] == 'dragon':
        T.dragon(path, m['drag']['body'], m['drag']['belly'], m['drag']['wing'], seed=seed)


def anims_for(geo):
    if geo.startswith('humanoid'):
        return {'walk': 'animation.rpg.humanoid.walk', 'look': 'animation.rpg.look_at_target', 'attack': 'animation.rpg.humanoid.attack'}, ['walk', 'look', 'attack']
    if geo == 'quadruped':
        return {'walk': 'animation.rpg.quadruped.walk', 'look': 'animation.rpg.look_at_target'}, ['walk', 'look']
    if geo == 'arthropod':
        return {'walk': 'animation.rpg.arthropod.walk', 'look': 'animation.rpg.look_at_target'}, ['walk', 'look']
    if geo == 'mimic':
        return {'chomp': 'animation.rpg.mimic.chomp'}, ['chomp']
    if geo == 'dragon':
        return {'fly': 'animation.rpg.dragon.fly', 'look': 'animation.rpg.look_at_target'}, ['fly', 'look']
    return {}, []


def client_entity(identifier, geo_id, texture, egg, scale_hint=None, extra_scripts=None):
    anims, animate = anims_for(geo_id.replace('geometry.rpg.', ''))
    desc = {
        'identifier': identifier,
        'materials': {'default': 'entity_alphatest'},
        'textures': {'default': texture},
        'geometry': {'default': geo_id},
        'render_controllers': ['controller.render.rpg.default'],
        'spawn_egg': {'base_color': egg[0], 'overlay_color': egg[1]},
    }
    if anims:
        desc['animations'] = anims
        desc['scripts'] = {'animate': animate}
    return {'format_version': '1.10.0', 'minecraft:client_entity': {'description': desc}}


def tier_groups(hp, dmg):
    groups, events = {}, {}
    names = [f'rpg:tier_{i}' for i in range(5)]
    for i, mult in enumerate(TIER_MULT):
        h = round(hp * mult)
        groups[names[i]] = {'minecraft:health': {'value': h, 'max': h}, 'minecraft:attack': {'damage': round(dmg * (1 + i * 0.35), 1)}}
        events[names[i]] = {'remove': {'component_groups': [n for n in names if n != names[i]]}, 'add': {'component_groups': [names[i]]}}
    return groups, events


def hostile_components(key, m, boss=False):
    fam = ['monster', 'mob', 'rpg_monster'] + m.get('fam', [])
    if m.get('undead'):
        fam.append('undead')
    if boss:
        fam += ['rpg_boss', 'boss']
    targets = [{'filters': {'any_of': [{'test': 'is_family', 'subject': 'other', 'value': 'player'}, {'test': 'is_family', 'subject': 'other', 'value': 'rpg_spirit'}, {'test': 'is_family', 'subject': 'other', 'value': 'villager'}]}, 'max_dist': 32 if boss else 20}]
    attack = {'damage': m['dmg']}
    if m.get('attack_effect'):
        attack.update({'effect_name': m['attack_effect'], 'effect_duration': 4})
    c = {
        'minecraft:type_family': {'family': fam},
        'minecraft:collision_box': {'width': m['box'][0], 'height': m['box'][1]},
        'minecraft:scale': {'value': m['scale']},
        'minecraft:health': {'value': m['hp'], 'max': m['hp']},
        'minecraft:attack': attack,
        'minecraft:movement': {'value': m['speed']},
        'minecraft:movement.basic': {},
        'minecraft:navigation.walk': {'can_path_over_water': True, 'avoid_water': True, 'can_open_doors': False},
        'minecraft:jump.static': {},
        'minecraft:can_climb': {},
        'minecraft:physics': {},
        'minecraft:pushable': {'is_pushable': not boss, 'is_pushable_by_piston': not boss},
        'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0},
        'minecraft:nameable': {},
        'minecraft:follow_range': {'value': 48 if boss else 32},
        'minecraft:loot': {'table': f'loot_tables/entities/rpg_{key}.json'},
        'minecraft:experience_reward': {'on_death': f"query.last_hit_by_player ? {40 if boss else 5 + m['hp'] // 6} : 0"},
        'minecraft:behavior.float': {'priority': 0},
        'minecraft:behavior.hurt_by_target': {'priority': 1},
        'minecraft:behavior.nearest_attackable_target': {'priority': 2, 'must_see': not boss, 'reselect_targets': True, 'within_radius': 32 if boss else 20, 'entity_types': targets},
        'minecraft:behavior.random_stroll': {'priority': 6, 'speed_multiplier': 0.8},
        'minecraft:behavior.look_at_player': {'priority': 7, 'look_distance': 10},
        'minecraft:behavior.random_look_around': {'priority': 8},
        'minecraft:conditional_bandwidth_optimization': {},
    }
    if m.get('ranged'):
        c['minecraft:shooter'] = {'def': 'minecraft:small_fireball'}
        c['minecraft:behavior.ranged_attack'] = {'priority': 3, 'attack_interval_min': 2, 'attack_interval_max': 4, 'attack_radius': 14}
    else:
        c['minecraft:behavior.melee_attack'] = {'priority': 3, 'speed_multiplier': 1.25, 'track_target': True}
    if m.get('fire'):
        c['minecraft:fire_immune'] = {}
    if m.get('undead') and not boss:
        c['minecraft:burns_in_daylight'] = {}
    if m.get('regen'):
        c['minecraft:spell_effects'] = {'add_effects': [{'effect': 'regeneration', 'duration': 999999, 'amplifier': 0, 'display_on_screen_animation': False}]}
    if boss:
        c['minecraft:boss'] = {'should_darken_sky': False, 'hud_range': 55, 'name': m['name']}
        c['minecraft:persistent'] = {}
        c['minecraft:knockback_resistance'] = {'value': m.get('kb', 0.8)}
        c['minecraft:damage_sensor'] = {'triggers': [{'cause': 'fall', 'deals_damage': 'no'}, {'cause': 'suffocation', 'deals_damage': 'no'}, {'cause': 'drowning', 'deals_damage': 'no'}]}
    else:
        c['minecraft:despawn'] = {'despawn_from_distance': {}}
    if m['geo'] == 'arthropod':
        c['minecraft:navigation.climb'] = {'can_path_over_water': True}
        del c['minecraft:navigation.walk']
    return c


def loot_mob(key, m, boss):
    if boss:
        pools = []
        for item, lo, hi in m['loot']:
            pools.append({'rolls': 1, 'entries': [{'type': 'item', 'name': item, 'weight': 1, 'functions': [{'function': 'set_count', 'count': {'min': lo, 'max': hi}}]}]})
        return {'pools': pools}
    common = {
        'goblin': 'minecraft:gold_nugget', 'dire_wolf': 'minecraft:leather', 'orc': 'minecraft:iron_nugget', 'scorpion': 'minecraft:spider_eye',
        'skeleton_knight': 'minecraft:bone', 'giant_spider': 'minecraft:string', 'wraith': 'minecraft:phantom_membrane', 'mimic': 'minecraft:gold_ingot',
        'dark_mage': 'minecraft:lapis_lazuli', 'ice_golem': 'minecraft:packed_ice', 'fire_imp': 'minecraft:blaze_powder', 'troll': 'minecraft:leather',
        'demon_knight': 'minecraft:netherite_scrap',
    }[key]
    hi = 1 if key in ('demon_knight',) else 3
    core_chance = {'goblin': 0.1, 'dire_wolf': 0.12, 'mimic': 1.0, 'troll': 0.5, 'demon_knight': 0.6}.get(key, 0.25)
    pools = [
        {'rolls': 1, 'entries': [{'type': 'item', 'name': common, 'weight': 1, 'functions': [{'function': 'set_count', 'count': {'min': 0, 'max': hi}}, {'function': 'looting_enchant', 'count': {'min': 0, 'max': 1}}]}]},
        {'rolls': 1, 'conditions': [{'condition': 'killed_by_player'}, {'condition': 'random_chance_with_looting', 'chance': core_chance, 'looting_multiplier': 0.05}], 'entries': [{'type': 'item', 'name': 'rpg:monster_core', 'weight': 1}]},
    ]
    if key in ('dark_mage', 'wraith'):
        pools.append({'rolls': 1, 'conditions': [{'condition': 'random_chance', 'chance': 0.3}], 'entries': [{'type': 'item', 'name': 'rpg:mana_crystal_shard', 'weight': 1}]})
    if key == 'mimic':
        pools.append({'rolls': {'min': 1, 'max': 3}, 'entries': [{'type': 'item', 'name': 'minecraft:diamond', 'weight': 1}, {'type': 'item', 'name': 'minecraft:emerald', 'weight': 3}, {'type': 'item', 'name': 'rpg:mana_potion', 'weight': 3}]})
    return {'pools': pools}


def spawn_rule(key, sp):
    cond = {
        'minecraft:weight': {'default': sp['weight']},
        'minecraft:herd': {'min_size': sp['herd'][0], 'max_size': sp['herd'][1]},
        'minecraft:difficulty_filter': {'min': 'easy', 'max': 'hard'},
        'minecraft:biome_filter': {'any_of': [{'test': 'has_biome_tag', 'operator': '==', 'value': t} for t in sp['tags']]},
    }
    if sp.get('underground'):
        cond['minecraft:spawns_underground'] = {}
        cond['minecraft:height_filter'] = {'min': -60, 'max': 40}
    else:
        cond['minecraft:spawns_on_surface'] = {}
    if sp.get('dark'):
        cond['minecraft:brightness_filter'] = {'min': 0, 'max': 7, 'adjust_for_weather': True}
    return {'format_version': '1.8.0', 'minecraft:spawn_rules': {'description': {'identifier': f'rpg:{key}', 'population_control': 'monster'}, 'conditions': [cond]}}


def scale_groups(prefix='rpg:scale_'):
    groups, events = {}, {}
    vals = list(range(30, 140, 5))
    names = [f'{prefix}{v}' for v in vals]
    for v, n in zip(vals, names):
        groups[n] = {'minecraft:scale': {'value': round(v / 100, 2)}}
        events[n] = {'remove': {'component_groups': [x for x in names if x != n]}, 'add': {'component_groups': [n]}}
    return groups, events


def entities():
    lang = {}
    for boss, table in ((False, MOBS), (True, BOSSES)):
        for key, m in table.items():
            ident = f'rpg:{key}'
            tg, te = tier_groups(m['hp'], m['dmg'])
            events = {'minecraft:entity_spawned': {'add': {'component_groups': ['rpg:tier_0']}}}
            events.update(te)
            data = {'format_version': '1.21.0', 'minecraft:entity': {
                'description': {'identifier': ident, 'is_spawnable': True, 'is_summonable': True},
                'component_groups': tg, 'components': hostile_components(key, m, boss), 'events': events}}
            write(os.path.join(BP, 'entities', f'{key}.json'), data)
            write(os.path.join(BP, 'loot_tables', 'entities', f'rpg_{key}.json'), loot_mob(key, m, boss))
            if not boss and m.get('spawn'):
                write(os.path.join(BP, 'spawn_rules', f'{key}.json'), spawn_rule(key, m['spawn']))
            kind = 'boss' if boss else 'mob'
            make_mob_texture(key, m, kind)
            write(os.path.join(RP, 'entity', f'{key}.entity.json'), client_entity(ident, 'geometry.rpg.' + m['geo'], tex_path(kind, key), m['egg']))
            lang[f'entity.{ident}.name'] = m['name']
            lang[f'item.spawn_egg.entity.{ident}.name'] = f'Generar {m["name"]}'

    # ---------------- NPC ----------------
    sg, se = scale_groups()
    npc_groups = {
        'rpg:wanderer': {
            'minecraft:despawn': {'despawn_from_distance': {'min_distance': 48, 'max_distance': 96}},
            'minecraft:behavior.random_stroll': {'priority': 6, 'speed_multiplier': 0.6},
        },
        'rpg:resident': {
            'minecraft:persistent': {},
            'minecraft:home': {'restriction_radius': 10},
            'minecraft:behavior.move_towards_home_restriction': {'priority': 4, 'speed_multiplier': 0.6},
            'minecraft:behavior.random_stroll': {'priority': 6, 'speed_multiplier': 0.5, 'xz_dist': 4},
        },
        'rpg:staff': {
            'minecraft:persistent': {},
            'minecraft:home': {'restriction_radius': 3},
            'minecraft:behavior.move_towards_home_restriction': {'priority': 3, 'speed_multiplier': 0.6},
            'minecraft:behavior.random_stroll': {'priority': 7, 'speed_multiplier': 0.4, 'xz_dist': 2, 'interval': 400},
        },
    }
    npc_groups.update(sg)
    npc_events = {
        'minecraft:entity_spawned': {'add': {'component_groups': ['rpg:wanderer']}},
        'rpg:spawn_resident': {'add': {'component_groups': ['rpg:resident']}},
        'rpg:spawn_staff': {'add': {'component_groups': ['rpg:staff']}},
        'rpg:make_resident': {'remove': {'component_groups': ['rpg:wanderer', 'rpg:staff']}, 'add': {'component_groups': ['rpg:resident']}},
        'rpg:make_staff': {'remove': {'component_groups': ['rpg:wanderer', 'rpg:resident']}, 'add': {'component_groups': ['rpg:staff']}},
        'rpg:interacted': {},
    }
    npc_events.update(se)
    write(os.path.join(BP, 'entities', 'npc.json'), {'format_version': '1.21.0', 'minecraft:entity': {
        'description': {'identifier': 'rpg:npc', 'is_spawnable': True, 'is_summonable': True, 'properties': {
            'rpg:skin': {'type': 'int', 'range': [0, 39], 'default': 0, 'client_sync': True},
            'rpg:geo': {'type': 'int', 'range': [0, len(NPC_GEO_ORDER) - 1], 'default': 0, 'client_sync': True},
        }},
        'component_groups': npc_groups,
        'components': {
            'minecraft:type_family': {'family': ['npc', 'rpg_npc', 'mob']},
            'minecraft:health': {'value': 40, 'max': 40},
            'minecraft:collision_box': {'width': 0.6, 'height': 1.8},
            'minecraft:movement': {'value': 0.5},
            'minecraft:movement.basic': {},
            'minecraft:navigation.walk': {'can_path_over_water': True, 'avoid_water': True, 'avoid_damage_blocks': True, 'can_open_doors': True, 'can_pass_doors': True},
            'minecraft:jump.static': {},
            'minecraft:can_climb': {},
            'minecraft:physics': {},
            'minecraft:pushable': {'is_pushable': True, 'is_pushable_by_piston': True},
            'minecraft:nameable': {'always_show': True, 'allow_name_tag_renaming': False},
            'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0},
            'minecraft:interact': {'interactions': [{'on_interact': {'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}, 'event': 'rpg:interacted'}, 'interact_text': 'action.interact.rpg_talk'}]},
            'minecraft:damage_sensor': {'triggers': [
                {'on_damage': {'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}}, 'deals_damage': 'yes'},
                {'cause': 'all', 'deals_damage': 'no'},
            ]},
            'minecraft:behavior.float': {'priority': 0},
            'minecraft:behavior.look_at_player': {'priority': 5, 'look_distance': 8, 'probability': 0.3},
            'minecraft:behavior.random_look_around': {'priority': 8},
            'minecraft:behavior.open_door': {'priority': 6, 'close_door_after': True},
            'minecraft:conditional_bandwidth_optimization': {},
        },
        'events': npc_events,
    }})
    write(os.path.join(BP, 'spawn_rules', 'npc.json'), {'format_version': '1.8.0', 'minecraft:spawn_rules': {
        'description': {'identifier': 'rpg:npc', 'population_control': 'creature'},
        'conditions': [{
            'minecraft:spawns_on_surface': {},
            'minecraft:brightness_filter': {'min': 8, 'max': 15, 'adjust_for_weather': False},
            'minecraft:weight': {'default': 2},
            'minecraft:herd': {'min_size': 1, 'max_size': 1},
            'minecraft:biome_filter': {'any_of': [{'test': 'has_biome_tag', 'operator': '==', 'value': t} for t in ('plains', 'forest', 'savanna', 'taiga', 'rpg_enchanted')]},
        }],
    }})
    # Pieles de NPC: 10 razas × 4 (2 hombres, 2 mujeres)
    races = [
        ('humano', [('#e0ac69', '#4a3020', '#3a6ea5', '#3b3b5a'), ('#c68642', '#1a1a1a', '#8a3a3a', '#4a3a2a')], [('#f0c8a0', '#8a5a2a', '#a04a7a', '#5a3a6a'), ('#d09060', '#2a1a10', '#4a8a5a', '#3a4a3a')], {}),
        ('elfo', [('#f1d3b3', '#e8e0a0', '#3a7a3a', '#2a4a2a'), ('#e8c8a8', '#c0c0d0', '#2a5a6a', '#2a3a4a')], [('#f6dcc0', '#f0e8b0', '#5a9a5a', '#3a5a3a'), ('#f0d0b0', '#d8d8e8', '#6a4a9a', '#3a2a5a')], {'ears': None}),
        ('enano', [('#d9a066', '#8a3a1a', '#6a4a2a', '#3a2a1a'), ('#c89060', '#4a3020', '#5a5a6a', '#3a2a1a')], [('#e0b080', '#a04a1a', '#8a5a3a', '#4a3020'), ('#d0a070', '#5a3a1a', '#4a6a8a', '#3a3a4a')], {'beard': True}),
        ('orco', [('#6b8e3a', '#1a1a1a', '#5a4a3a', '#3a2a1a'), ('#5a7a32', '#2a2a2a', '#6a6a72', '#3a3a3a')], [('#7a9a4a', '#1a1a1a', '#7a4a3a', '#4a3020'), ('#6a8a42', '#3a2a1a', '#4a5a3a', '#3a2a1a')], {'tusks': True}),
        ('bestia', [('#c9a26b', '#8a6a3a', '#6a5a3a', '#4a3a2a'), ('#8a8a8a', '#5a5a5a', '#3a5a3a', '#2a3a2a')], [('#d8b07a', '#a07a4a', '#8a6a4a', '#5a4a3a'), ('#a0a0a0', '#e0e0e0', '#5a3a5a', '#3a2a3a')], {}),
        ('demonio', [('#9b2c2c', '#1a1a1a', '#2a1a1a', '#1a1010'), ('#6a2c70', '#0a0a0a', '#3a1a1a', '#1a1010')], [('#a83a3a', '#2a0a0a', '#4a1a2a', '#2a1018'), ('#7a3a80', '#1a0a1a', '#2a1a3a', '#1a1028')], {'horns': '#2a2420'}),
        ('celestial', [('#fff1e0', '#f0d060', '#f0f0f0', '#d8d8e8'), ('#f8e8d8', '#e8e8f8', '#e8e0c0', '#c8c0a0')], [('#fff4e8', '#ffe080', '#ffffff', '#e8e8f8'), ('#fbeee0', '#f8f8ff', '#f0e8c8', '#d8d0b0')], {'crown': '#ffe060'}),
        ('vampiro', [('#e8e0e0', '#101010', '#5a0a10', '#1a1a1a'), ('#e0d8e0', '#3a1a1a', '#1a1a1a', '#2a0a10')], [('#f0e8e8', '#1a0a0a', '#7a0a1a', '#1a1a1a'), ('#e8e0e8', '#f0f0f0', '#2a0a2a', '#1a1a1a')], {'eyes': '#c01020'}),
        ('hada', [('#ffd6e8', '#80c0ff', '#60c080', '#409060'), ('#ffe0d0', '#ffa0d0', '#c0a0ff', '#8060c0')], [('#ffd8ea', '#ff80c0', '#ff90c0', '#c060a0'), ('#ffe8f0', '#a0f0c0', '#80e0ff', '#40a0c0')], {'wings': '#c8e8ff'}),
        ('draconido', [('#a83a3a', '#3a1a1a', '#5a4a2a', '#3a2a1a'), ('#b8860b', '#4a3010', '#3a3a4a', '#2a2a3a')], [('#c04a4a', '#4a1a1a', '#6a3a2a', '#4a2a1a'), ('#c8961b', '#5a4010', '#4a4a5a', '#3a3a4a')], {'scales': True, 'horns': '#e0d0b0'}),
    ]
    npc_tex = {}
    i = 0
    for race, males, females, extra in races:
        for gi, group in enumerate((males, females)):
            for (skin, hair, shirt, pants) in group:
                spec = dict(skin=skin, hair=hair, shirt=shirt, pants=pants, shoes='#3a2a1a', eyes=extra.get('eyes', '#2a4a8a'), long_hair=gi == 1)
                if extra.get('beard') and gi == 0:
                    spec['beard'] = hair
                if extra.get('tusks'):
                    spec['tusks'] = True
                if extra.get('horns'):
                    spec['horns'] = extra['horns']
                if extra.get('crown'):
                    spec['crown'] = extra['crown']
                if extra.get('wings'):
                    spec['wings'] = extra['wings']
                if extra.get('scales'):
                    spec['scales'] = True
                if race == 'bestia':
                    spec['ears'] = hair
                    spec['tail'] = hair
                if race == 'celestial':
                    spec['robe'] = shirt
                name = f'npc_{i}'
                T.humanoid(png(os.path.join(RP, tex_path('npc', name) + '.png')), spec, 1000 + i)
                npc_tex[f's{i}'] = tex_path('npc', name)
                i += 1
    write(os.path.join(RP, 'entity', 'npc.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {'description': {
        'identifier': 'rpg:npc',
        'materials': {'default': 'entity_alphatest'},
        'textures': npc_tex,
        'geometry': {f'g{k}': g for k, g in enumerate(NPC_GEO_ORDER)},
        'animations': {'walk': 'animation.rpg.humanoid.walk', 'look': 'animation.rpg.look_at_target', 'idle': 'animation.rpg.humanoid.idle'},
        'scripts': {'animate': ['walk', 'look', 'idle']},
        'render_controllers': ['controller.render.rpg.npc'],
        'spawn_egg': {'base_color': '#e0c080', 'overlay_color': '#3a6ea5'},
    }}})
    lang['entity.rpg:npc.name'] = 'Habitante de Aetheria'
    lang['item.spawn_egg.entity.rpg:npc.name'] = 'Generar Habitante'
    lang['action.interact.rpg_talk'] = 'Hablar'

    # ---------------- Espíritu aliado ----------------
    pg = {}
    pe = {}
    names = [f'rpg:power_{i}' for i in range(5)]
    for i, n in enumerate(names):
        hp = [20, 35, 55, 80, 120][i]
        pg[n] = {'minecraft:health': {'value': hp, 'max': hp}, 'minecraft:attack': {'damage': [4, 7, 11, 16, 24][i]}}
        pe[n] = {'remove': {'component_groups': [x for x in names if x != n]}, 'add': {'component_groups': [n]}}
    pe['minecraft:entity_spawned'] = {'add': {'component_groups': ['rpg:power_0']}}
    write(os.path.join(BP, 'entities', 'spirit.json'), {'format_version': '1.21.0', 'minecraft:entity': {
        'description': {'identifier': 'rpg:spirit', 'is_spawnable': False, 'is_summonable': True, 'properties': {
            'rpg:variant': {'type': 'int', 'range': [0, 11], 'default': 0, 'client_sync': True},
        }},
        'component_groups': pg,
        'components': {
            'minecraft:type_family': {'family': ['rpg_spirit', 'rpg_ally']},
            'minecraft:health': {'value': 20, 'max': 20},
            'minecraft:attack': {'damage': 4},
            'minecraft:collision_box': {'width': 0.7, 'height': 1.2},
            'minecraft:movement': {'value': 0.32},
            'minecraft:movement.basic': {},
            'minecraft:navigation.walk': {'can_path_over_water': True, 'avoid_water': False},
            'minecraft:jump.static': {},
            'minecraft:physics': {},
            'minecraft:pushable': {'is_pushable': True, 'is_pushable_by_piston': True},
            'minecraft:fire_immune': {},
            'minecraft:nameable': {'always_show': False},
            'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0, 'breathes_water': True},
            'minecraft:damage_sensor': {'triggers': [
                {'on_damage': {'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}}, 'deals_damage': 'no'},
                {'cause': 'fall', 'deals_damage': 'no'},
                {'cause': 'suffocation', 'deals_damage': 'no'},
            ]},
            'minecraft:behavior.float': {'priority': 0},
            'minecraft:behavior.melee_attack': {'priority': 2, 'speed_multiplier': 1.3, 'track_target': True},
            'minecraft:behavior.nearest_attackable_target': {'priority': 1, 'must_see': False, 'reselect_targets': True, 'within_radius': 18, 'entity_types': [{'filters': {'test': 'is_family', 'subject': 'other', 'value': 'monster'}, 'max_dist': 18}]},
            'minecraft:behavior.random_stroll': {'priority': 6, 'speed_multiplier': 0.8},
            'minecraft:behavior.look_at_player': {'priority': 7, 'look_distance': 6},
            'minecraft:conditional_bandwidth_optimization': {},
        },
        'events': pe,
    }})
    sp_tex = {}
    for v, col in enumerate(ELEMENT_COLORS):
        name = f'spirit_{v}'
        path = png(os.path.join(RP, tex_path('spirit', name) + '.png'))
        g = SPIRIT_GEO[v]
        if g == 0:
            T.wisp(path, col, v)
        elif g == 1:
            if v == 8:
                T.humanoid(path, dict(bones='#d8e8d0', eyes='#40ff80', glow=True), v)
            else:
                T.humanoid(path, dict(skin=col, bald=True, shirt=col, pants=T.shade(T.hexc(col), 0.8), shoes=T.shade(T.hexc(col), 0.6), eyes='#ffffff', glow=True), v)
        else:
            T.quadruped(path, col, '#ffffff', None, v)
        sp_tex[f'v{v}'] = tex_path('spirit', name)
    # El fuego fatuo usa 32×32: generamos versión 64×64 para humanoides/bestias y 32×32 para fuegos fatuos (UV distintos por geometría).
    write(os.path.join(RP, 'entity', 'spirit.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {'description': {
        'identifier': 'rpg:spirit',
        'materials': {'default': 'entity_alphatest'},
        'textures': sp_tex,
        'geometry': {'wisp': 'geometry.rpg.wisp', 'humanoid': 'geometry.rpg.humanoid', 'quadruped': 'geometry.rpg.quadruped'},
        'animations': {'float': 'animation.rpg.wisp.float', 'walk': 'animation.rpg.humanoid.walk', 'qwalk': 'animation.rpg.quadruped.walk'},
        'scripts': {
            'pre_animation': ["v.v = q.property('rpg:variant'); v.geo_idx = (v.v == 2 || v.v == 7 || v.v == 8) ? 1 : ((v.v == 4 || v.v == 5 || v.v == 9) ? 2 : 0);"],
            'animate': ['float', 'walk', 'qwalk'],
        },
        'render_controllers': ['controller.render.rpg.spirit'],
    }}})
    lang['entity.rpg:spirit.name'] = 'Espíritu Elemental'
    return lang


# ======================================================================================
# Jugador (tamaño según raza y edad)
# ======================================================================================
def player_json():
    sg, se = scale_groups()
    groups = {
        'minecraft:add_raid_omen': {
            'minecraft:spell_effects': {'add_effects': [{'effect': 'raid_omen', 'duration': 30, 'display_on_screen_animation': True}], 'remove_effects': 'bad_omen'},
            'minecraft:timer': {'time': [0.0, 0.0], 'looping': False, 'time_down_event': {'event': 'minecraft:clear_add_raid_omen', 'target': 'self'}},
        },
        'minecraft:clear_raid_omen_spell_effect': {'minecraft:spell_effects': {}},
        'minecraft:raid_trigger': {'minecraft:raid_trigger': {'triggered_event': {'event': 'minecraft:remove_raid_trigger', 'target': 'self'}}},
    }
    groups.update(sg)
    events = {
        'minecraft:gain_raid_omen': {'add': {'component_groups': ['minecraft:add_raid_omen']}},
        'minecraft:clear_add_raid_omen': {'remove': {'component_groups': ['minecraft:add_raid_omen']}, 'add': {'component_groups': ['minecraft:clear_raid_omen_spell_effect']}},
        'minecraft:trigger_raid': {'add': {'component_groups': ['minecraft:raid_trigger']}},
        'minecraft:remove_raid_trigger': {'remove': {'component_groups': ['minecraft:raid_trigger']}},
    }
    events.update(se)
    data = {'format_version': '1.21.0', 'minecraft:entity': {
        'description': {'identifier': 'minecraft:player', 'spawn_category': 'creature', 'is_spawnable': False, 'is_summonable': False},
        'component_groups': groups,
        'components': {
            'minecraft:experience_reward': {'on_death': 'Math.Min(query.player_level * 7, 100)'},
            'minecraft:type_family': {'family': ['player']},
            'minecraft:is_hidden_when_invisible': {},
            'minecraft:loot': {'table': 'loot_tables/empty.json'},
            'minecraft:collision_box': {'width': 0.6, 'height': 1.8},
            'minecraft:can_climb': {},
            'minecraft:movement': {'value': 0.1},
            'minecraft:hurt_on_condition': {'damage_conditions': [{'filters': {'test': 'in_lava', 'subject': 'self', 'operator': '==', 'value': True}, 'cause': 'lava', 'damage_per_tick': 4}]},
            'minecraft:attack': {'damage': 1},
            'minecraft:exhaustion_values': {'heal': 6, 'jump': 0.05, 'sprint_jump': 0.2, 'mine': 0.005, 'attack': 0.1, 'damage': 0.1, 'walk': 0.0, 'sprint': 0.1, 'swim': 0.01},
            'minecraft:player.saturation': {'value': 5, 'max': 20},
            'minecraft:player.exhaustion': {'value': 0, 'max': 20},
            'minecraft:player.level': {'value': 0, 'max': 24791},
            'minecraft:player.experience': {'value': 0, 'max': 1},
            'minecraft:breathable': {'total_supply': 15, 'suffocate_time': -1, 'inhale_time': 3.75, 'generates_bubbles': False},
            'minecraft:nameable': {'always_show': True, 'allow_name_tag_renaming': False},
            'minecraft:physics': {'push_towards_closest_space': True},
            'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': True},
            'minecraft:insomnia': {'days_until_insomnia': 3},
            'minecraft:rideable': {'seat_count': 2, 'family_types': ['parrot_tame'], 'pull_in_entities': True, 'seats': [
                {'position': [0.4, -0.2, -0.1], 'min_rider_count': 0, 'max_rider_count': 0, 'lock_rider_rotation': 0},
                {'position': [-0.4, -0.2, -0.1], 'min_rider_count': 1, 'max_rider_count': 2, 'lock_rider_rotation': 0},
            ]},
            'minecraft:conditional_bandwidth_optimization': {},
            'minecraft:block_climber': {},
            'minecraft:environment_sensor': {'triggers': [{'filters': {'all_of': [
                {'test': 'has_mob_effect', 'subject': 'self', 'value': 'bad_omen'},
                {'test': 'is_in_village', 'subject': 'self', 'value': True},
            ]}, 'event': 'minecraft:gain_raid_omen'}]},
        },
        'events': events,
    }}
    write(os.path.join(BP, 'entities', 'player.json'), data)
    write(os.path.join(BP, 'loot_tables', 'empty.json'), {'pools': []})


# ======================================================================================
# Objetos
# ======================================================================================
ITEMS = [
    # id, nombre, icono(kind, color, accent), extras
    ('journal', 'Diario del Aventurero', ('book', '#8a5a2a', '#e8c040'), dict(stack=1, cooldown=0.5)),
    ('grimoire', 'Grimorio', ('book', '#4a1a7a', '#c070ff'), dict(stack=1, cooldown=0.2, glint=True)),
    ('guild_card', 'Licencia de Aventurero', ('card', '#2a4a8a', '#e8c040'), dict(stack=1, cooldown=0.5)),
    ('mana_potion', 'Poción de Maná', ('potion', '#3a60ff', '#ffffff'), dict(stack=16, drink=True)),
    ('greater_mana_potion', 'Poción de Maná Mayor', ('potion', '#8040ff', '#ffffff'), dict(stack=16, drink=True, glint=True)),
    ('elixir_life', 'Elixir de Vida', ('potion', '#ff3050', '#ffffff'), dict(stack=16, drink=True)),
    ('elixir_strength', 'Elixir de Fuerza', ('potion', '#c02010', '#ffffff'), dict(stack=16, drink=True)),
    ('elixir_swiftness', 'Elixir de Agilidad', ('potion', '#60e0ff', '#ffffff'), dict(stack=16, drink=True)),
    ('elixir_elven', 'Elixir Élfico', ('potion', '#40e080', '#ffffff'), dict(stack=16, drink=True, glint=True)),
    ('raw_mithril', 'Mitrilo en Bruto', ('raw', '#8ac8e8', ''), {}),
    ('mithril_ingot', 'Lingote de Mitrilo', ('ingot', '#9ad8f8', ''), {}),
    ('raw_adamantite', 'Adamantita en Bruto', ('raw', '#c03050', ''), {}),
    ('adamantite_ingot', 'Lingote de Adamantita', ('ingot', '#d04060', ''), {}),
    ('mana_crystal_shard', 'Fragmento de Cristal de Maná', ('shard', '#a070ff', ''), {}),
    ('rune_stone', 'Piedra Rúnica', ('rune', '#ff9020', ''), dict(stack=16)),
    ('monster_core', 'Núcleo de Monstruo', ('core', '#c02040', ''), {}),
    ('boss_core', 'Núcleo de Jefe', ('core', '#ffb020', ''), dict(glint=True)),
    ('seal_goblin_king', 'Sello del Rey Goblin', ('seal', '#5d9a3a', '#e8b830'), dict(stack=16, cooldown=1, glint=True)),
    ('seal_spider_queen', 'Sello de la Reina Araña', ('seal', '#2a1a2a', '#a01030'), dict(stack=16, cooldown=1, glint=True)),
    ('seal_ancient_golem', 'Sello del Gólem Ancestral', ('seal', '#8a8a8a', '#ff9020'), dict(stack=16, cooldown=1, glint=True)),
    ('seal_lich', 'Sello del Liche Eterno', ('seal', '#3a1a4a', '#40ff80'), dict(stack=16, cooldown=1, glint=True)),
    ('seal_demon_lord', 'Sello de Azazel', ('seal', '#8b1a1a', '#ffd020'), dict(stack=16, cooldown=1, glint=True)),
    ('seal_ash_dragon', 'Sello del Wyrm de Ceniza', ('seal', '#3a3434', '#c86020'), dict(stack=16, cooldown=1, glint=True)),
    ('seal_void_king', 'Sello del Rey del Vacío', ('seal', '#1a0a2a', '#d040ff'), dict(stack=16, cooldown=1, glint=True)),
    ('mithril_sword', 'Espada de Mitrilo', ('sword', '#9ad8f8', '#e8c040'), dict(weapon=(8, 1400, 'sword'))),
    ('adamantite_sword', 'Espada de Adamantita', ('sword', '#d04060', '#202020'), dict(weapon=(10, 2600, 'sword'))),
    ('dwarven_greataxe', 'Gran Hacha Enana', ('axe', '#9ad8f8', ''), dict(weapon=(12, 2000, 'axe'))),
    ('runic_hammer', 'Martillo Rúnico', ('hammer', '#d04060', '#ff9020'), dict(weapon=(11, 2400, 'axe'), glint=True)),
    ('staff_apprentice', 'Báculo de Aprendiz', ('staff', '#a070ff', ''), dict(weapon=(4, 600, 'sword'), cooldown=0.2)),
    ('staff_archmage', 'Báculo del Archimago', ('staff', '#ffd040', ''), dict(weapon=(6, 1600, 'sword'), cooldown=0.2, glint=True)),
    ('wedding_ring', 'Anillo de Compromiso', ('ring', '#e8c040', '#80e0ff'), dict(stack=1, glint=True)),
]


def items():
    tex = {}
    for key, name, (kind, color, accent), ex in ITEMS:
        ident = f'rpg:{key}'
        comps = {
            'minecraft:icon': {'textures': {'default': f'rpg_{key}'}},
            'minecraft:display_name': {'value': name},
            'minecraft:max_stack_size': ex.get('stack', 64),
        }
        if ex.get('glint'):
            comps['minecraft:glint'] = True
        if ex.get('cooldown'):
            comps['minecraft:cooldown'] = {'category': f'rpg_{key}', 'duration': ex['cooldown']}
        if ex.get('drink'):
            comps['minecraft:food'] = {'nutrition': 0, 'saturation_modifier': 0, 'can_always_eat': True, 'using_converts_to': 'minecraft:glass_bottle'}
            comps['minecraft:use_animation'] = 'drink'
            comps['minecraft:use_modifiers'] = {'use_duration': 1.6, 'movement_modifier': 0.35}
        if ex.get('weapon'):
            dmg, dur, slot = ex['weapon']
            comps['minecraft:max_stack_size'] = 1
            comps['minecraft:hand_equipped'] = True
            comps['minecraft:damage'] = dmg
            comps['minecraft:durability'] = {'max_durability': dur}
            comps['minecraft:enchantable'] = {'slot': slot, 'value': 14}
            comps['minecraft:can_destroy_in_creative'] = False
            if slot == 'sword':
                comps['minecraft:tags'] = {'tags': ['minecraft:is_sword']}
            else:
                comps['minecraft:tags'] = {'tags': ['minecraft:is_axe']}
        cat = 'equipment' if ex.get('weapon') else 'items'
        write(os.path.join(BP, 'items', f'{key}.json'), {'format_version': '1.21.40', 'minecraft:item': {
            'description': {'identifier': ident, 'menu_category': {'category': cat}}, 'components': comps}})
        T.item_icon(png(os.path.join(RP, 'textures', 'items', f'rpg_{key}.png')), kind, color, accent or '#ffffff', zlib.crc32(key.encode()) % 1000)
        tex[f'rpg_{key}'] = {'textures': f'textures/items/rpg_{key}'}
    write(os.path.join(RP, 'textures', 'item_texture.json'), {'resource_pack_name': 'aetheria_rpg', 'texture_name': 'atlas.items', 'texture_data': tex})
    return {f'item.rpg:{k}': n for k, n, _, _ in ITEMS}


# ======================================================================================
# Bloques, menas y rasgos del mundo
# ======================================================================================
BLOCKS = [
    ('mithril_ore', 'Mena de Mitrilo', 'ore', '#8ac8e8', 'rpg:raw_mithril', 4.0, 0),
    ('adamantite_ore', 'Mena de Adamantita', 'ore', '#c03050', 'rpg:raw_adamantite', 6.0, 0),
    ('mana_crystal_block', 'Cristal de Maná', 'crystal', '#a070ff', 'rpg:mana_crystal_shard', 2.0, 9),
]


def blocks():
    terrain = {}
    blocks_json = {'format_version': [1, 1, 0]}
    lang = {}
    for key, name, kind, color, drop, hardness, light in BLOCKS:
        ident = f'rpg:{key}'
        comps = {
            'minecraft:destructible_by_mining': {'seconds_to_destroy': hardness},
            'minecraft:destructible_by_explosion': {'explosion_resistance': 6},
            'minecraft:geometry': 'minecraft:geometry.full_block',
            'minecraft:material_instances': {'*': {'texture': f'rpg_{key}', 'render_method': 'opaque'}},
            'minecraft:loot': f'loot_tables/blocks/{key}.json',
            'minecraft:map_color': color,
        }
        if light:
            comps['minecraft:light_emission'] = light
        write(os.path.join(BP, 'blocks', f'{key}.json'), {'format_version': '1.21.40', 'minecraft:block': {
            'description': {'identifier': ident, 'menu_category': {'category': 'nature'}}, 'components': comps}})
        count = {'min': 1, 'max': 1} if kind == 'ore' else {'min': 2, 'max': 4}
        write(os.path.join(BP, 'loot_tables', 'blocks', f'{key}.json'), {'pools': [{'rolls': 1, 'entries': [{'type': 'item', 'name': drop, 'weight': 1, 'functions': [{'function': 'set_count', 'count': count}]}]}]})
        p = png(os.path.join(RP, 'textures', 'blocks', f'rpg_{key}.png'))
        if kind == 'ore':
            T.ore_block(p, color, seed=zlib.crc32(key.encode()) % 1000)
        else:
            T.crystal_block(p, color, seed=7)
        terrain[f'rpg_{key}'] = {'textures': f'textures/blocks/rpg_{key}'}
        blocks_json[ident] = {'sound': 'stone' if kind == 'ore' else 'amethyst_block'}
        lang[f'tile.{ident}.name'] = name
    write(os.path.join(RP, 'textures', 'terrain_texture.json'), {'resource_pack_name': 'aetheria_rpg', 'texture_name': 'atlas.terrain', 'padding': 8, 'num_mip_levels': 4, 'texture_data': terrain})
    write(os.path.join(RP, 'blocks.json'), blocks_json)

    stone = ['minecraft:stone', 'minecraft:deepslate', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite', 'minecraft:tuff']
    ores = [
        ('mithril_ore', 'rpg:mithril_ore', 4, 3, [-50, 30], 'overworld'),
        ('adamantite_ore', 'rpg:adamantite_ore', 3, 1, [-62, -20], 'overworld'),
        ('mana_crystal', 'rpg:mana_crystal_block', 3, 3, [-40, 50], 'overworld'),
        ('mana_crystal_rich', 'rpg:mana_crystal_block', 6, 6, [-20, 70], 'rpg_crystal'),
        ('mithril_rich', 'rpg:mithril_ore', 6, 6, [-30, 90], 'rpg_dwarven'),
    ]
    for name, block, count, iterations, yr, tag in ores:
        write(os.path.join(BP, 'features', f'{name}_feature.json'), {'format_version': '1.13.0', 'minecraft:ore_feature': {
            'description': {'identifier': f'rpg:{name}_feature'}, 'count': count,
            'replace_rules': [{'places_block': block, 'may_replace': stone}]}})
        write(os.path.join(BP, 'feature_rules', f'{name}_rule.json'), {'format_version': '1.13.0', 'minecraft:feature_rules': {
            'description': {'identifier': f'rpg:{name}_rule', 'places_feature': f'rpg:{name}_feature'},
            'conditions': {'placement_pass': 'underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': tag}]},
            'distribution': {'iterations': iterations, 'coordinate_eval_order': 'zyx',
                             'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': {'distribution': 'uniform', 'extent': yr},
                             'z': {'distribution': 'uniform', 'extent': [0, 16]}}}})
    # Cristales en superficie de los biomas mágicos
    write(os.path.join(BP, 'features', 'surface_crystal_feature.json'), {'format_version': '1.13.0', 'minecraft:single_block_feature': {
        'description': {'identifier': 'rpg:surface_crystal_feature'},
        'places_block': 'rpg:mana_crystal_block',
        'enforce_placement_rules': False, 'enforce_survivability_rules': False,
        'may_attach_to': {'min_sides_must_attach': 1, 'bottom': ['minecraft:grass_block', 'minecraft:snow', 'minecraft:stone', 'minecraft:moss_block', 'minecraft:packed_ice']}}})
    for tag in ('rpg_crystal', 'rpg_enchanted'):
        write(os.path.join(BP, 'feature_rules', f'surface_crystal_{tag}_rule.json'), {'format_version': '1.13.0', 'minecraft:feature_rules': {
            'description': {'identifier': f'rpg:surface_crystal_{tag}_rule', 'places_feature': 'rpg:surface_crystal_feature'},
            'conditions': {'placement_pass': 'surface_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': tag}]},
            'distribution': {'iterations': 1, 'scatter_chance': {'numerator': 1, 'denominator': 6},
                             'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': 'query.heightmap(variable.worldx, variable.worldz)',
                             'z': {'distribution': 'uniform', 'extent': [0, 16]}}}})
    return lang


BIOMES = [
    ('bosque_encantado', 'Bosque Encantado', ['forest', 'birch_forest'], 0.25, (0.7, 0.8), 'minecraft:moss_block', 'minecraft:dirt', ['forest', 'rpg_enchanted']),
    ('tierras_malditas', 'Tierras Malditas', ['plains', 'savanna'], 0.12, (0.9, 0.2), 'minecraft:podzol', 'minecraft:coarse_dirt', ['plains', 'rpg_cursed']),
    ('picos_enanos', 'Picos Enanos', ['extreme_hills'], 0.35, (0.3, 0.3), 'minecraft:stone', 'minecraft:stone', ['extreme_hills', 'mountains', 'rpg_dwarven']),
    ('desierto_ceniza', 'Desierto de Ceniza', ['desert'], 0.2, (2.0, 0.0), 'minecraft:red_sand', 'minecraft:red_sandstone', ['desert', 'rpg_ash']),
    ('pantano_necrotico', 'Pantano Necrótico', ['swampland'], 0.4, (0.8, 0.9), 'minecraft:mud', 'minecraft:dirt', ['swamp', 'rpg_necro']),
    ('tundra_cristalina', 'Tundra Cristalina', ['ice_plains'], 0.35, (0.0, 0.5), 'minecraft:snow', 'minecraft:packed_ice', ['frozen', 'cold', 'rpg_crystal']),
]


def biomes():
    for key, name, targets, amount, (temp, down), top, mid, tags in BIOMES:
        write(os.path.join(BP, 'biomes', f'{key}.biome.json'), {'format_version': '1.21.110', 'minecraft:biome': {
            'description': {'identifier': f'rpg:{key}'},
            'components': {
                'minecraft:climate': {'downfall': down, 'snow_accumulation': [0.0, 0.125], 'temperature': temp},
                'minecraft:surface_builder': {'builder': {
                    'type': 'minecraft:overworld', 'top_material': top, 'mid_material': mid, 'foundation_material': 'minecraft:stone',
                    'sea_floor_material': 'minecraft:gravel', 'sea_material': 'minecraft:water', 'sea_floor_depth': 7}},
                'minecraft:replace_biomes': {'replacements': [{'dimension': 'minecraft:overworld', 'targets': targets, 'amount': amount, 'noise_frequency_scale': 1.0}]},
                'minecraft:tags': {'tags': ['animal', 'monster', 'overworld'] + tags},
            }}})


# ======================================================================================
# Recetas
# ======================================================================================
def recipes():
    def shaped(name, pattern, key, result, count=1):
        write(os.path.join(BP, 'recipes', f'{name}.json'), {'format_version': '1.20.10', 'minecraft:recipe_shaped': {
            'description': {'identifier': f'rpg:{name}'}, 'tags': ['crafting_table'], 'pattern': pattern,
            'key': {k: {'item': v} for k, v in key.items()}, 'result': {'item': result, 'count': count}}})

    def shapeless(name, ingredients, result, count=1):
        write(os.path.join(BP, 'recipes', f'{name}.json'), {'format_version': '1.20.10', 'minecraft:recipe_shapeless': {
            'description': {'identifier': f'rpg:{name}'}, 'tags': ['crafting_table'],
            'ingredients': [{'item': i, 'count': c} for i, c in ingredients], 'result': {'item': result, 'count': count}}})

    def furnace(name, inp, out):
        write(os.path.join(BP, 'recipes', f'{name}.json'), {'format_version': '1.20.10', 'minecraft:recipe_furnace': {
            'description': {'identifier': f'rpg:{name}'}, 'tags': ['furnace', 'blast_furnace'], 'input': inp, 'output': out}})

    furnace('smelt_mithril', 'rpg:raw_mithril', 'rpg:mithril_ingot')
    furnace('smelt_adamantite', 'rpg:raw_adamantite', 'rpg:adamantite_ingot')
    shaped('mithril_sword', [' M ', ' M ', ' S '], {'M': 'rpg:mithril_ingot', 'S': 'minecraft:stick'}, 'rpg:mithril_sword')
    shaped('adamantite_sword', [' A ', ' A ', ' S '], {'A': 'rpg:adamantite_ingot', 'S': 'minecraft:stick'}, 'rpg:adamantite_sword')
    shaped('staff_apprentice', ['  C', ' S ', 'S  '], {'C': 'rpg:mana_crystal_shard', 'S': 'minecraft:stick'}, 'rpg:staff_apprentice')
    shaped('staff_archmage', [' DC', ' AD', 'A  '], {'C': 'rpg:boss_core', 'D': 'minecraft:diamond', 'A': 'rpg:adamantite_ingot'}, 'rpg:staff_archmage')
    shaped('wedding_ring', [' D ', 'G G', ' G '], {'D': 'minecraft:diamond', 'G': 'minecraft:gold_ingot'}, 'rpg:wedding_ring')
    shaped('rune_stone', ['OCO', 'CSC', 'OCO'], {'O': 'minecraft:obsidian', 'C': 'rpg:mana_crystal_shard', 'S': 'minecraft:stone'}, 'rpg:rune_stone')
    shaped('mana_crystal_block', ['CC', 'CC'], {'C': 'rpg:mana_crystal_shard'}, 'rpg:mana_crystal_block')
    shapeless('grimoire', [('minecraft:book', 1), ('rpg:mana_crystal_shard', 1)], 'rpg:grimoire')
    shapeless('grimoire_alt', [('minecraft:book', 1), ('minecraft:lapis_lazuli', 4)], 'rpg:grimoire')
    shapeless('journal', [('minecraft:book', 1), ('minecraft:feather', 1)], 'rpg:journal')
    shapeless('mana_potion', [('minecraft:glass_bottle', 1), ('rpg:mana_crystal_shard', 1)], 'rpg:mana_potion')
    shapeless('seal_goblin_king', [('rpg:monster_core', 4), ('minecraft:gold_ingot', 1)], 'rpg:seal_goblin_king')


# ======================================================================================
# Partículas y textos
# ======================================================================================
def particles():
    T.particle_tex(png(os.path.join(RP, 'textures', 'particle', 'rpg_magic.png')))
    base_app = {
        'minecraft:particle_appearance_billboard': {
            'size': ['v.size * (1 - v.particle_age / v.particle_lifetime) + 0.02', 'v.size * (1 - v.particle_age / v.particle_lifetime) + 0.02'],
            'facing_camera_mode': 'rotate_xyz',
            'uv': {'texture_width': 16, 'texture_height': 16, 'uv': [0, 0], 'uv_size': [16, 16]},
        },
        'minecraft:particle_appearance_tinting': {'color': ['v.color.r ?? 1', 'v.color.g ?? 1', 'v.color.b ?? 1', 1.0]},
    }

    def p(ident, emitter, extra):
        comps = {'minecraft:emitter_lifetime_once': {'active_time': 0.1}}
        comps.update(emitter)
        comps.update(extra)
        comps.update(base_app)
        write(os.path.join(RP, 'particles', ident.split(':')[1] + '.json'), {'format_version': '1.10.0', 'particle_effect': {
            'description': {'identifier': ident, 'basic_render_parameters': {'material': 'particles_add', 'texture': 'textures/particle/rpg_magic'}},
            'components': comps}})

    p('rpg:spark', {
        'minecraft:emitter_initialization': {'creation_expression': 'v.size = 0.14;'},
        'minecraft:emitter_rate_instant': {'num_particles': 2},
        'minecraft:emitter_shape_sphere': {'radius': 0.12, 'direction': 'outwards'},
    }, {
        'minecraft:particle_initial_speed': 0.4,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.35 + v.particle_random_1 * 0.3'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 3.0},
    })
    p('rpg:burst', {
        'minecraft:emitter_initialization': {'creation_expression': 'v.size = 0.22;'},
        'minecraft:emitter_rate_instant': {'num_particles': 24},
        'minecraft:emitter_shape_sphere': {'radius': 0.3, 'direction': 'outwards'},
    }, {
        'minecraft:particle_initial_speed': 4.0,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.4 + v.particle_random_1 * 0.4'},
        'minecraft:particle_motion_dynamic': {'linear_drag_coefficient': 4.0},
    })
    p('rpg:aura', {
        'minecraft:emitter_initialization': {'creation_expression': 'v.size = 0.16;'},
        'minecraft:emitter_rate_instant': {'num_particles': 30},
        'minecraft:emitter_shape_disc': {'radius': 0.8, 'offset': [0, 0.1, 0], 'plane_normal': 'y', 'surface_only': True, 'direction': [0, 1, 0]},
    }, {
        'minecraft:particle_initial_speed': '1.0 + v.particle_random_2',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.8 + v.particle_random_1 * 0.6'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.5, 0], 'linear_drag_coefficient': 1.0},
    })


def texts(lang):
    lang = dict(lang)
    lang['pack.name'] = 'Aetheria RPG'
    lang['pack.description'] = 'RPG completo para Minecraft Bedrock'
    for key, name, *_ in BIOMES:
        lang[f'biome.rpg:{key}.name'] = name
    body = '\n'.join(f'{k}={v}' for k, v in sorted(lang.items())) + '\n'
    for code in ('es_ES', 'es_MX', 'en_US'):
        write(os.path.join(RP, 'texts', f'{code}.lang'), body)
    write(os.path.join(RP, 'texts', 'languages.json'), ['es_ES', 'es_MX', 'en_US'])
    bp_lang = 'pack.name=Aetheria RPG\npack.description=RPG completo para Minecraft Bedrock\n'
    for code in ('es_ES', 'es_MX', 'en_US'):
        write(os.path.join(BP, 'texts', f'{code}.lang'), bp_lang)
    write(os.path.join(BP, 'texts', 'languages.json'), ['es_ES', 'es_MX', 'en_US'])


# ======================================================================================
def clean():
    keep_bp = {'scripts'}
    for d in (BP, RP):
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if d == BP and name in keep_bp:
                continue
            path = os.path.join(d, name)
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)


def _zip_pack(z, pack, arc_prefix):
    for base, dirs, files in os.walk(pack):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(base, f)
            rel = os.path.relpath(full, pack).replace(os.sep, '/')
            z.write(full, f'{arc_prefix}/{rel}' if arc_prefix else rel)


def package():
    """Crea el .mcaddon (ambos paquetes) y los .mcpack sueltos (uno por paquete)."""
    dist = os.path.join(ROOT, 'dist')
    os.makedirs(dist, exist_ok=True)
    out = os.path.join(dist, 'AetheriaRPG.mcaddon')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for pack, arc in ((BP, 'AetheriaRPG_BP'), (RP, 'AetheriaRPG_RP')):
            _zip_pack(z, pack, arc)
    print('Paquete creado:', os.path.relpath(out, ROOT))
    for pack, name in ((BP, 'AetheriaRPG_BP.mcpack'), (RP, 'AetheriaRPG_RP.mcpack')):
        path = os.path.join(dist, name)
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
            _zip_pack(z, pack, '')
        print('Paquete creado:', os.path.relpath(path, ROOT))


def main():
    clean()
    manifests()
    geometries()
    animations()
    lang = {}
    lang.update(entities())
    player_json()
    lang.update(items())
    lang.update(blocks())
    biomes()
    recipes()
    particles()
    # Recursos visuales v2 (modelos, texturas, partículas, glifos): sobrescriben los anteriores.
    try:
        import rp_models  # noqa: WPS433
    except ImportError:
        rp_models = None
    if rp_models is not None:
        lang.update(rp_models.build(RP) or {})
    texts(lang)
    if '--no-zip' not in sys.argv:
        package()
    print('Recursos generados en packs/.')


if __name__ == '__main__':
    main()
