#!/usr/bin/env python3
"""Autocomprobación del paquete de comportamiento generado por tools/build.py.

Uso:
    python3 tools/check_bp.py             # regenera (build.py --no-zip) y comprueba
    python3 tools/check_bp.py --no-build  # solo comprueba lo que ya hay en packs/

Comprueba, contra docs/v2-contract.md (§0-§3):
  * que todo el JSON de ambos paquetes se puede leer;
  * manifiestos (versiones de la API y del motor) y que ningún fichero usa un format_version mayor que el motor;
  * rpg:npc: propiedades, eventos de aparición, grupo permanente rpg:guard, TODAS las actividades rpg:act_*
    (cada evento quita las demás y añade la suya, destino y velocidad de la tabla), escalas con tope de colisión;
  * rpg:waypoint (todos los tipos), rpg:tomato (proyectil sin daño), rpg:spirit (filtro de objetivos);
  * jugador (vanilla + escalas), monstruos (IA §2.6, F1 colisión/escala), reglas de aparición (F2, F3);
  * objetos nuevos (§3) con icono, menas con etiqueta de pico (BLK-1), recetas y tablas de botín existentes;
  * nombres en el .lang para todas las entidades, objetos y bloques.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
BP = os.path.join(ROOT, 'packs', 'AetheriaRPG_BP')
RP = os.path.join(ROOT, 'packs', 'AetheriaRPG_RP')
CONTRACT = os.path.join(ROOT, 'docs', 'v2-contract.md')

sys.path.insert(0, HERE)

FAILS = []
OKS = [0]


def check(cond, msg):
    if cond:
        OKS[0] += 1
    else:
        FAILS.append(msg)
    return cond


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def ver_tuple(v):
    if isinstance(v, list):
        return tuple(int(x) for x in v)
    if isinstance(v, str) and re.fullmatch(r'\d+(\.\d+)*', v):
        return tuple(int(x) for x in v.split('.'))
    return None


def walk_json(o):
    """Recorre todos los dicts/listas anidados."""
    yield o
    if isinstance(o, dict):
        for v in o.values():
            yield from walk_json(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk_json(v)


def mentions(o, value):
    return any(x == value for x in walk_json(o) if isinstance(x, str))


def family_tests(o, subject='other'):
    return {x.get('value') for x in walk_json(o) if isinstance(x, dict) and x.get('test') == 'is_family' and x.get('subject', 'self') == subject}


# ---------------------------------------------------------------------------------------------
# Contrato
# ---------------------------------------------------------------------------------------------
def parse_contract():
    text = open(CONTRACT, encoding='utf-8').read()
    s2 = text[text.index('## 2.'):text.index('## 3.')]
    s21 = s2[s2.index('### 2.1'):s2.index('### 2.2')]
    s3 = text[text.index('## 3.'):text.index('## 4.')]
    c = {}
    # Propiedades: | `rpg:skin` | int | 0..159 | ...
    c['props'] = {}
    for m in re.finditer(r'^\|\s*`(rpg:[a-z_]+)`\s*\|\s*(int|bool)\s*\|\s*([0-9.]*)\s*\|', s21, re.M):
        rng = None
        if m.group(3):
            a, b = m.group(3).split('..')
            rng = [int(a), int(b)]
        c['props'][m.group(1)] = (m.group(2), rng)
    c['spawn_events'] = sorted(set(re.findall(r'`(rpg:(?:spawn|make)_[a-z]+)`', s21)))
    m = re.search(r'Group `rpg:guard`.*?`type_family` `(\[[^`]*\])`', s21, re.S)
    c['guard_families'] = json.loads(m.group(1)) if m else None
    # Actividades: | `idle` | ... | o | `patrol_0`..`patrol_3` | `rpg_wp_patrol_0`..`3` | 0.6 |
    acts = []
    table = s21[s21.index('| activity |'):]
    for line in table.splitlines()[2:]:
        if not line.startswith('|'):
            break
        cells = [x.strip() for x in line.strip('|').split('|')]
        names = re.findall(r'`([a-z_0-9]+)`', cells[0])
        if len(names) == 2 and cells[0].count('..'):
            base = names[0].rsplit('_', 1)[0]
            lo, hi = int(names[0].rsplit('_', 1)[1]), int(names[1].rsplit('_', 1)[1])
            names = [f'{base}_{i}' for i in range(lo, hi + 1)]
            fams = [f'rpg_wp_{n}' for n in names]
        else:
            f = re.findall(r'`([a-z_0-9]+)`', cells[1])
            fams = [f[0] if f else None] * len(names)
        try:
            speed = float(cells[2])
        except ValueError:
            speed = None
        for n, f in zip(names, fams):
            acts.append((n, f, speed, cells[1]))
    c['acts'] = acts
    m = re.search(r'Kinds:\s*`([^`]+)`', s2)
    c['wp_kinds'] = [k.strip() for k in m.group(1).split(',')] if m else []
    c['items'] = re.findall(r'`(rpg:[a-z_]+)` \(', s3)
    c['item_specs'] = {}
    for m in re.finditer(r'`(rpg:[a-z_]+)` \(([^)]*)\)', s3):
        c['item_specs'][m.group(1)] = m.group(2)
    c['scale'] = list(range(30, 140, 5))
    return c


# ---------------------------------------------------------------------------------------------
def main():
    if '--no-build' not in sys.argv:
        r = subprocess.run([sys.executable, os.path.join(HERE, 'build.py'), '--no-zip'], cwd=ROOT)
        check(r.returncode == 0, f'build.py --no-zip terminó con código {r.returncode}')

    import build as B  # constantes del generador (MOBS, BOSSES, ITEMS...)
    C = parse_contract()
    min_engine = tuple(B.MIN_ENGINE)

    # ---- Todo el JSON se puede leer --------------------------------------------------------
    data = {}
    for pack in (BP, RP):
        for base, dirs, files in os.walk(pack):
            if os.sep + 'scripts' in base:
                continue
            for f in files:
                if f.endswith('.json'):
                    p = os.path.join(base, f)
                    try:
                        data[os.path.relpath(p, ROOT)] = load(p)
                    except Exception as e:  # noqa: BLE001
                        check(False, f'JSON inválido: {os.path.relpath(p, ROOT)}: {e}')
    check(len(data) > 50, f'muy pocos JSON generados ({len(data)})')

    # ---- §0 Manifiestos y versiones de formato ------------------------------------------------
    bpm = load(os.path.join(BP, 'manifest.json'))
    rpm = load(os.path.join(RP, 'manifest.json'))
    deps = {d.get('module_name'): d.get('version') for d in bpm['dependencies'] if d.get('module_name')}
    check(deps.get('@minecraft/server') == '2.6.0', f"@minecraft/server debe ser 2.6.0 (hay {deps.get('@minecraft/server')})")
    check(deps.get('@minecraft/server-ui') == '2.0.0', f"@minecraft/server-ui debe ser 2.0.0 (hay {deps.get('@minecraft/server-ui')})")
    for name, m in (('BP', bpm), ('RP', rpm)):
        check(m['header']['min_engine_version'] == [1, 26, 10], f'{name}: min_engine_version debe ser [1, 26, 10]')
    check(bpm['header']['version'] == rpm['header']['version'], 'BP y RP deben tener la misma versión')
    for rel, d in data.items():
        if not rel.startswith(os.path.join('packs', 'AetheriaRPG_BP')):
            continue
        fv = ver_tuple(d.get('format_version')) if isinstance(d, dict) else None
        sub = rel.split(os.sep)[2] if len(rel.split(os.sep)) > 2 else ''
        if fv and sub in ('entities', 'items', 'blocks', 'biomes'):
            check(fv <= min_engine, f'{rel}: format_version {d.get("format_version")} > motor mínimo {min_engine}')
    for icon in (os.path.join(BP, 'pack_icon.png'), os.path.join(RP, 'pack_icon.png')):
        check(os.path.isfile(icon), f'falta {icon}')

    ent = {}
    for f in os.listdir(os.path.join(BP, 'entities')):
        d = load(os.path.join(BP, 'entities', f))
        e = d['minecraft:entity']
        ent[e['description']['identifier']] = (f, d, e)

    # ---- §2.1 rpg:npc -----------------------------------------------------------------------
    f, d, npc = ent.get('rpg:npc', (None, None, None))
    if check(npc is not None, 'falta la entidad rpg:npc'):
        props = npc['description'].get('properties', {})
        for p, (typ, rng) in C['props'].items():
            if check(p in props, f'rpg:npc: falta la propiedad {p}'):
                check(props[p]['type'] == typ, f'rpg:npc: {p} debe ser {typ}')
                check(props[p].get('client_sync') is True, f'rpg:npc: {p} debe tener client_sync')
                if rng:
                    check(props[p].get('range') == rng, f'rpg:npc: {p} rango {props[p].get("range")} != {rng}')
        check(len(C['props']) == 6, f'el contrato debería listar 6 propiedades (leídas {len(C["props"])})')
        ev, gr = npc['events'], npc['component_groups']
        check(len(C['spawn_events']) >= 8, f'eventos de aparición leídos del contrato: {C["spawn_events"]}')
        for e_ in C['spawn_events'] + ['minecraft:entity_spawned']:
            check(e_ in ev, f'rpg:npc: falta el evento {e_}')
        for g in ('rpg:wanderer', 'rpg:guard', 'rpg:citizen', 'rpg:resident', 'rpg:staff'):
            check(g in gr, f'rpg:npc: falta el grupo {g}')
        guard = gr.get('rpg:guard', {})
        check(guard.get('minecraft:type_family', {}).get('family') == C['guard_families'],
              f"rpg:guard: familias {guard.get('minecraft:type_family')} != {C['guard_families']}")
        check(guard.get('minecraft:health', {}).get('value') == 60, 'rpg:guard: vida 60')
        check(guard.get('minecraft:attack', {}).get('damage') == 5, 'rpg:guard: daño 5')
        check('minecraft:behavior.melee_attack' in guard, 'rpg:guard: cuerpo a cuerpo')
        check('monster' in family_tests(guard.get('minecraft:behavior.hurt_by_target', {})), 'rpg:guard: hurt_by_target solo monstruos')
        scan = guard.get('minecraft:behavior.nearest_prioritized_attackable_target') or guard.get('minecraft:behavior.nearest_attackable_target') or {}
        check('monster' in family_tests(scan) and scan.get('within_radius') == 16, 'rpg:guard: busca monstruos a 16 bloques')
        for spawn, need in (('rpg:spawn_guard', ['rpg:guard', 'rpg:act_idle']), ('rpg:spawn_citizen', ['rpg:act_idle']),
                            ('rpg:spawn_staff', ['rpg:staff', 'rpg:act_idle']), ('rpg:spawn_resident', ['rpg:resident', 'rpg:act_idle'])):
            added = ev.get(spawn, {}).get('add', {}).get('component_groups', [])
            check(all(n in added for n in need), f'{spawn} debe añadir {need}')
        check(gr.get('rpg:staff', {}).get('minecraft:home', {}).get('restriction_radius') == 3, 'rpg:staff: hogar radio 3')
        check(gr.get('rpg:resident', {}).get('minecraft:home', {}).get('restriction_radius') == 10, 'rpg:resident: hogar radio 10')
        check('minecraft:despawn' in gr.get('rpg:wanderer', {}), 'rpg:wanderer: puede desaparecer')
        check(not any('minecraft:home' in gr.get(g, {}) for g in ('rpg:citizen', 'rpg:guard')), 'ciudadanos y guardias sin restricción de hogar')
        # Actividades
        act_groups = [f'rpg:act_{a}' for a, *_ in C['acts']]
        check(len(act_groups) == 20, f'el contrato debería dar 20 actividades (leídas {len(act_groups)}: {act_groups})')
        all_act_in_json = sorted(g for g in gr if g.startswith('rpg:act_'))
        check(sorted(act_groups) == all_act_in_json, f'grupos rpg:act_* distintos del contrato: {set(act_groups) ^ set(all_act_in_json)}')
        for a, fam, speed, dest in C['acts']:
            g = f'rpg:act_{a}'
            if not check(g in gr and g in ev, f'rpg:npc: falta grupo/evento {g}'):
                continue
            e_ = ev[g]
            check(e_.get('add', {}).get('component_groups') == [g], f'{g}: el evento debe añadir solo {g}')
            check(sorted(e_.get('remove', {}).get('component_groups', [])) == sorted(x for x in act_groups if x != g),
                  f'{g}: el evento debe quitar todas las demás actividades')
            grp = gr[g]
            if fam and 'tag' in dest:
                tgt = grp.get('minecraft:behavior.nearest_attackable_target', {})
                check(mentions(tgt, fam) and 'player' in family_tests(tgt), f'{g}: el objetivo deben ser jugadores con la etiqueta {fam}')
            elif fam and fam.startswith('rpg_'):
                tgt = grp.get('minecraft:behavior.nearest_attackable_target', {})
                check(fam in family_tests(tgt), f'{g}: el objetivo debe ser la familia {fam}')
                check(tgt.get('must_see') is False and tgt.get('within_radius') == 96, f'{g}: nearest_attackable_target must_see false, within_radius 96')
                check(grp.get('minecraft:behavior.move_towards_target', {}).get('within_radius') == 96, f'{g}: move_towards_target within_radius 96')
                check('minecraft:behavior.random_stroll' in grp, f'{g}: paseo de baja prioridad al llegar')
            if speed is not None:
                speeds = {round(x.get('speed_multiplier', -1), 3) for x in walk_json(grp) if isinstance(x, dict) and 'speed_multiplier' in x}
                speeds |= {round(x.get('sprint_speed_multiplier', -1), 3) for x in walk_json(grp) if isinstance(x, dict) and 'sprint_speed_multiplier' in x}
                if speed == 0:
                    check(grp.get('minecraft:movement', {}).get('value') == 0, f'{g}: velocidad 0 (inmóvil)')
                else:
                    check(round(speed, 3) in speeds, f'{g}: ninguna velocidad = {speed} (hay {sorted(speeds)})')
        sleep = gr.get('rpg:act_sleep', {})
        check(not any(k in sleep for k in ('minecraft:behavior.sleep', 'minecraft:behavior.move_to_poi')), 'act_sleep no requiere cama')
        jeer = gr.get('rpg:act_jeer', {})
        check(jeer.get('minecraft:shooter', {}).get('def') == 'rpg:tomato', 'act_jeer: shooter rpg:tomato')
        ra = jeer.get('minecraft:behavior.ranged_attack', {})
        check(ra.get('attack_radius') == 10 and ra.get('attack_interval_min') == 1 and ra.get('attack_interval_max') == 3, 'act_jeer: ranged_attack radio 10, 1-3 s')
        check(mentions(jeer, 'rpg_humiliated'), 'act_jeer: apunta a jugadores con rpg_humiliated')
        hunt = gr.get('rpg:act_hunt', {})
        check(mentions(hunt, 'rpg_wanted') and 'minecraft:behavior.melee_attack' in hunt, 'act_hunt: persigue rpg_wanted con cuerpo a cuerpo')
        flee = gr.get('rpg:act_flee', {}).get('minecraft:behavior.avoid_mob_type', {})
        check('player' in family_tests(flee) and flee.get('max_dist', 0) >= 20, 'act_flee: huye de jugadores a 20')
        check('rpg_guard' in family_tests(gr.get('rpg:act_alarm', {})), 'act_alarm: corre al guardia')
        avoid = npc['components'].get('minecraft:behavior.avoid_mob_type', {})
        check('monster' in family_tests(avoid) and 'rpg_guard' in family_tests(avoid, 'self'), 'los no guardias huyen de monstruos (8)')
        nav = npc['components'].get('minecraft:navigation.walk', {})
        check(nav.get('can_open_doors') and nav.get('can_pass_doors'), 'NPC: abre y atraviesa puertas')
        check('minecraft:annotation.open_door' in npc['components'], 'NPC: minecraft:annotation.open_door')
        ds = npc['components'].get('minecraft:damage_sensor', {}).get('triggers', [])
        check(ds and ds[0].get('deals_damage') == 'yes' and 'player' in family_tests(ds[0]) and ds[-1].get('cause') == 'all' and ds[-1].get('deals_damage') == 'no',
              'NPC: solo los jugadores hacen daño')
        check_scales('rpg:npc', npc, C['scale'])

    # ---- §1 jugador ---------------------------------------------------------------------------
    f, d, pl = ent.get('minecraft:player', (None, None, None))
    if check(pl is not None, 'falta minecraft:player'):
        check(ver_tuple(d['format_version']) <= min_engine, 'player.json: formato <= motor mínimo')
        vanilla = B.vanilla_player()['minecraft:entity']
        for k in vanilla['components']:
            check(k in pl['components'], f'player.json: falta el componente vanilla {k}')
        for k in vanilla['component_groups']:
            check(k in pl['component_groups'], f'player.json: falta el grupo vanilla {k}')
        for k in vanilla['events']:
            check(k in pl['events'], f'player.json: falta el evento vanilla {k}')
        check_scales('minecraft:player', pl, C['scale'])

    # ---- §2.3 marcador ----------------------------------------------------------------------
    f, d, wp = ent.get('rpg:waypoint', (None, None, None))
    if check(wp is not None, 'falta rpg:waypoint'):
        check(len(C['wp_kinds']) == 15, f'tipos de marcador del contrato: {C["wp_kinds"]}')
        for k in C['wp_kinds']:
            g = f'rpg:wp_{k}'
            if check(g in wp['component_groups'] and g in wp['events'], f'rpg:waypoint: falta {g}'):
                fams = wp['component_groups'][g].get('minecraft:type_family', {}).get('family', [])
                check('rpg_waypoint' in fams and f'rpg_wp_{k}' in fams and 'rpg_wp' in fams, f'{g}: familias {fams}')
                check(wp['events'][g].get('add', {}).get('component_groups') == [g], f'{g}: el evento añade su grupo')
        c = wp['components']
        check(c.get('minecraft:physics', {}).get('has_gravity') is False, 'marcador sin gravedad')
        check(c.get('minecraft:pushable', {}).get('is_pushable') is False and c['minecraft:pushable'].get('is_pushable_by_piston') is False, 'marcador no empujable')
        check(c.get('minecraft:damage_sensor', {}).get('triggers') == [{'cause': 'all', 'deals_damage': 'no'}], 'marcador invulnerable')
        check('minecraft:persistent' in c and 'minecraft:despawn' not in c, 'marcador permanente')
        check('minecraft:health' in c and 'minecraft:collision_box' in c, 'marcador: objetivo válido (vida + caja)')
        check(not ({'monster', 'mob', 'player', 'villager'} & set(c.get('minecraft:type_family', {}).get('family', []))), 'marcador: nadie lo ataca')
        check(wp['description'].get('is_summonable') is True, 'marcador invocable por script')

    # ---- §2.4 tomate --------------------------------------------------------------------------
    f, d, tom = ent.get('rpg:tomato', (None, None, None))
    if check(tom is not None, 'falta la entidad rpg:tomato'):
        proj = tom['components'].get('minecraft:projectile')
        check(proj is not None, 'rpg:tomato: minecraft:projectile')
        dmg = [x.get('damage') for x in walk_json(proj) if isinstance(x, dict) and 'damage' in x]
        check(all(v in (0, None) for v in dmg), 'rpg:tomato: sin daño')
    tomato_item = os.path.join(BP, 'items', 'tomato.json')
    if check(os.path.isfile(tomato_item), 'falta el objeto rpg:tomato'):
        comps = load(tomato_item)['minecraft:item']['components']
        check(comps.get('minecraft:food', {}).get('nutrition') == 2, 'rpg:tomato: comida 2')
        check('minecraft:throwable' in comps, 'rpg:tomato: arrojadizo')
        check(comps.get('minecraft:projectile', {}).get('projectile_entity') == 'rpg:tomato', 'rpg:tomato: proyectil rpg:tomato')

    # ---- §2.5 espíritu ------------------------------------------------------------------------
    f, d, sp = ent.get('rpg:spirit', (None, None, None))
    if check(sp is not None, 'falta rpg:spirit'):
        tgt = sp['components'].get('minecraft:behavior.nearest_attackable_target', {})
        check('monster' in family_tests(tgt) and mentions(tgt, 'rpg_marked'), 'rpg:spirit: ataca monstruos o rpg_marked')
        never = [x for x in walk_json(tgt) if isinstance(x, dict) and 'none_of' in x]
        bad = family_tests(never) if never else set()
        check({'player', 'rpg_npc', 'rpg_waypoint'} <= bad and mentions(never, 'rpg_ally'), 'rpg:spirit: nunca jugadores, NPC, marcadores ni aliados')
        check('rpg:variant' in sp['description'].get('properties', {}), 'rpg:spirit: propiedad rpg:variant')
        for i in range(5):
            check(f'rpg:power_{i}' in sp['events'], f'rpg:spirit: evento rpg:power_{i}')

    # ---- §2.6 monstruos y jefes -------------------------------------------------------------
    for table, boss in ((B.MOBS, False), (B.BOSSES, True)):
        for key, m in table.items():
            ident = f'rpg:{key}'
            if not check(ident in ent, f'falta {ident}'):
                continue
            c = ent[ident][2]['components']
            box, sc = c['minecraft:collision_box'], c['minecraft:scale']['value']
            check(abs(box['width'] * sc - m['box'][0]) < 0.01 and abs(box['height'] * sc - m['box'][1]) < 0.01,
                  f'{ident}: caja × escala ({box}×{sc}) != tamaño real {m["box"]} (F1)')
            prey = family_tests(c.get('minecraft:behavior.nearest_attackable_target', {}))
            check({'player', 'rpg_spirit', 'villager', 'rpg_guard'} <= prey and not ({'rpg_npc', 'npc'} & prey), f'{ident}: presas {prey}')
            if boss:
                check('minecraft:despawn' not in c and 'minecraft:persistent' in c, f'{ident}: el jefe nunca desaparece')
                check(c.get('minecraft:knockback_resistance', {}).get('value', 0) >= 0.9, f'{ident}: el jefe resiste el empuje')
    for key in ('dire_wolf', 'giant_spider'):
        check('minecraft:behavior.leap_at_target' in ent[f'rpg:{key}'][2]['components'], f'rpg:{key}: salta sobre su presa')
    check(any(e[2]['components'].get('minecraft:behavior.hurt_by_target', {}).get('alert_same_type') for e in ent.values()), 'manadas: alert_same_type')
    dm = ent['rpg:dark_mage'][2]['components']
    check('player' in family_tests(dm.get('minecraft:behavior.avoid_mob_type', {})) and 'minecraft:behavior.ranged_attack' in dm, 'mago oscuro: mantiene la distancia')
    gob = ent['rpg:goblin'][2]
    check(any('minecraft:environment_sensor' in g for g in gob['component_groups'].values()) and 'rpg:fleeing' in gob['component_groups'], 'goblin: huye con poca vida')
    check(ent['rpg:skeleton_knight'][2]['components'].get('minecraft:knockback_resistance', {}).get('value', 0) >= 0.6, 'caballero esqueleto: resiste el empuje')
    check('rpg:sunlit' in ent['rpg:troll'][2]['component_groups'] and 'minecraft:environment_sensor' in ent['rpg:troll'][2]['components'], 'trol: más lento de día')

    # ---- Reglas de aparición (F2, F3) ----------------------------------------------------------
    valid_pop = {'animal', 'water_animal', 'monster', 'ambient', 'cat', 'pillager'}
    for f in os.listdir(os.path.join(BP, 'spawn_rules')):
        sr = load(os.path.join(BP, 'spawn_rules', f))['minecraft:spawn_rules']
        pop = sr['description'].get('population_control')
        check(pop in valid_pop, f'spawn_rules/{f}: population_control «{pop}» no válido (F3)')
        check(sr['description']['identifier'] in ent, f'spawn_rules/{f}: entidad inexistente')
        for cond in sr.get('conditions', []):
            if mentions(cond.get('minecraft:biome_filter', {}), 'nether'):
                check('minecraft:spawns_underground' in cond and 'minecraft:spawns_on_surface' not in cond, f'spawn_rules/{f}: en el Nether debe usar spawns_underground (F2)')

    # ---- §3 objetos, iconos, bloques, recetas, botín ------------------------------------------
    items = {}
    for f in os.listdir(os.path.join(BP, 'items')):
        it = load(os.path.join(BP, 'items', f))['minecraft:item']
        items[it['description']['identifier']] = it
    blocks = {}
    for f in os.listdir(os.path.join(BP, 'blocks')):
        bl = load(os.path.join(BP, 'blocks', f))['minecraft:block']
        blocks[bl['description']['identifier']] = bl
    check(len(C['items']) == 5, f'objetos nuevos del contrato: {C["items"]}')
    for ident in C['items']:
        if not check(ident in items, f'falta el objeto {ident}'):
            continue
        comps = items[ident]['components']
        spec = C['item_specs'].get(ident, '')
        m = re.search(r'stack (\d+)', spec)
        if m:
            check(comps.get('minecraft:max_stack_size') == int(m.group(1)), f'{ident}: pila {m.group(1)}')
        if 'glint' in spec:
            check(comps.get('minecraft:glint') is True, f'{ident}: brillo')
    for ident in ('rpg:jail_key', 'rpg:lockpick', 'rpg:wanted_poster'):
        check('minecraft:cooldown' in items.get(ident, {}).get('components', {}), f'{ident}: cooldown para disparar itemUse')
    atlas = load(os.path.join(RP, 'textures', 'item_texture.json'))['texture_data']
    for ident, it in items.items():
        key = it['components'].get('minecraft:icon', {}).get('textures', {}).get('default')
        if check(key in atlas, f'{ident}: icono «{key}» no está en item_texture.json'):
            tex = atlas[key]['textures']
            tex = tex if isinstance(tex, str) else tex[0]
            p = os.path.join(RP, tex + '.png')
            if check(os.path.isfile(p), f'{ident}: falta {tex}.png'):
                check(not png_blank(p), f'{ident}: icono vacío {tex}.png')
    for ident, bl in blocks.items():
        if ident.endswith('_ore') or 'crystal' in ident:
            comps = bl['components']
            check('tag:minecraft:is_pickaxe_item_destructible' in comps or 'minecraft:is_pickaxe_item_destructible' in comps.get('minecraft:tags', []),
                  f'{ident}: etiqueta de pico (BLK-1)')
    known = set(items) | set(blocks)
    for f in os.listdir(os.path.join(BP, 'recipes')):
        rec = load(os.path.join(BP, 'recipes', f))
        body = next(v for k, v in rec.items() if k.startswith('minecraft:'))
        refs = [x['item'] for x in walk_json(body) if isinstance(x, dict) and isinstance(x.get('item'), str)]
        refs += [body[k] for k in ('input', 'output') if isinstance(body.get(k), str)]
        for v in refs:
            if v.startswith('rpg:'):
                check(v in known, f'recipes/{f}: {v} no existe')
    for ident, (f, d, e) in ent.items():
        for v in walk_json(e):
            if isinstance(v, dict) and isinstance(v.get('table'), str):
                check(os.path.isfile(os.path.join(BP, v['table'])), f'{ident}: falta la tabla {v["table"]}')
    for ident, bl in blocks.items():
        lt = bl['components'].get('minecraft:loot')
        if lt:
            check(os.path.isfile(os.path.join(BP, lt)), f'{ident}: falta la tabla {lt}')

    # ---- Scripts ↔ JSON: lo que los scripts usan debe existir en el paquete -----------------------
    scripts = os.path.join(BP, 'scripts')
    src = {}
    for base, dirs, files in os.walk(scripts):
        for f in files:
            if f.endswith('.js'):
                p = os.path.join(base, f)
                src[os.path.relpath(p, scripts)] = open(p, encoding='utf-8').read()
    all_events = set()
    all_props = {}
    for ident, (f, d, e) in ent.items():
        all_events |= set(e.get('events', {}))
        for k, v in e['description'].get('properties', {}).items():
            all_props.setdefault(k, []).append(v)
    for rel, code in src.items():
        for ev_ in re.findall(r"triggerEvent\(\s*'([^']+)'\s*\)", code):
            check(ev_ in all_events, f'scripts/{rel}: triggerEvent(\'{ev_}\') no existe en ninguna entidad')
        for prop, val in re.findall(r"setProperty\(\s*'(rpg:[a-z_]+)'\s*,\s*([^)]*)\)", code):
            if check(prop in all_props, f'scripts/{rel}: setProperty(\'{prop}\') no existe'):
                if re.fullmatch(r'-?\d+', val.strip()):
                    n = int(val)
                    check(any(pp['type'] == 'int' and pp['range'][0] <= n <= pp['range'][1] for pp in all_props[prop]),
                          f'scripts/{rel}: {prop} = {n} fuera de rango')
                elif val.strip() in ('true', 'false'):
                    check(any(pp['type'] == 'bool' for pp in all_props[prop]), f'scripts/{rel}: {prop} no es bool')
        for typ in re.findall(r"spawnEntity\(\s*'(rpg:[a-z_]+)", code):
            check(typ in ent, f'scripts/{rel}: spawnEntity(\'{typ}\') no existe')
        for item in re.findall(r"(?:new ItemStack|giveItem|countItem|takeItem|hasItem)\([^)]*?'(rpg:[a-z_]+)'", code):
            check(item in items or item in blocks, f'scripts/{rel}: objeto {item} no existe')
        for arr in re.findall(r"WP_KINDS\s*=\s*\[([^\]]*)\]", code):
            for k in re.findall(r"'([a-z_0-9]+)'", arr):
                check(f'rpg:wp_{k}' in ent.get('rpg:waypoint', (None, None, {'events': {}}))[2]['events'], f'scripts/{rel}: tipo de marcador {k} sin evento rpg:wp_{k}')
    m = re.search(r"export const ACTIVITIES\s*=\s*\[([^\]]*)\]", src.get(os.path.join('data', 'social.js'), ''))
    if check(m is not None, 'scripts/data/social.js: no se encontró ACTIVITIES'):
        for a in re.findall(r"'([a-z_0-9]+)'", m.group(1)):
            check(f'rpg:act_{a}' in all_events, f'actividad «{a}» de data/social.js sin evento rpg:act_{a}')
    for kind in ('guard', 'citizen', 'staff', 'resident'):
        check(f'rpg:spawn_{kind}' in all_events and f'rpg:make_{kind}' in all_events, f'falta rpg:spawn_{kind}/rpg:make_{kind} (npc.spawnNpc)')

    # ---- Textos -------------------------------------------------------------------------------
    for code in ('es_ES', 'es_MX', 'en_US'):
        p = os.path.join(RP, 'texts', f'{code}.lang')
        if not check(os.path.isfile(p), f'falta {p}'):
            continue
        keys = {}
        for line in open(p, encoding='utf-8'):
            if '=' in line and not line.startswith('#'):
                k, v = line.rstrip('\n').split('=', 1)
                keys[k] = v
        for ident in ent:
            if ident != 'minecraft:player':
                check(keys.get(f'entity.{ident}.name'), f'{code}.lang: falta entity.{ident}.name')
        for ident in items:
            check(keys.get(f'item.{ident}.name'), f'{code}.lang: falta item.{ident}.name')
        for ident in blocks:
            check(keys.get(f'tile.{ident}.name'), f'{code}.lang: falta tile.{ident}.name')
        for ident, (f, d, e) in ent.items():
            if e['description'].get('is_spawnable'):
                check(keys.get(f'item.spawn_egg.entity.{ident}.name'), f'{code}.lang: falta el huevo de {ident}')

    print(f'check_bp: {OKS[0]} comprobaciones correctas, {len(FAILS)} fallos.')
    for msg in FAILS:
        print('  FALLO:', msg)
    return 1 if FAILS else 0


def check_scales(ident, e, values):
    for v in values:
        g = f'rpg:scale_{v}'
        if not check(g in e['component_groups'] and g in e['events'], f'{ident}: falta {g}'):
            continue
        grp = e['component_groups'][g]
        s = grp.get('minecraft:scale', {}).get('value')
        check(s is not None and abs(s - v / 100) < 1e-6, f'{ident}: {g} escala {s}')
        box = grp.get('minecraft:collision_box')
        if check(box is not None, f'{ident}: {g} sin collision_box'):
            ew, eh = box['width'] * s, box['height'] * s
            check(abs(ew - min(0.6 * s, 0.66)) < 0.002 and abs(eh - min(1.8 * s, 1.95)) < 0.002,
                  f'{ident}: {g} hitbox efectivo {ew:.3f}×{eh:.3f}')
        ev = e['events'][g]
        check(ev.get('add', {}).get('component_groups') == [g] and len(ev.get('remove', {}).get('component_groups', [])) == len(values) - 1,
              f'{ident}: el evento {g} debe quitar las otras escalas')


def png_blank(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.convert('RGBA').getbbox() is None
    except Exception:  # noqa: BLE001
        return True


if __name__ == '__main__':
    sys.exit(main())
