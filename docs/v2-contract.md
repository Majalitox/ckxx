# Aetheria RPG v2 — shared technical contract

This document is the single source of truth for identifiers shared between the
script modules (`packs/AetheriaRPG_BP/scripts/**`) and the generated pack data
(`tools/build.py` → behavior pack JSON, `tools/rp_models.py` + `tools/gen_textures.py`
→ resource pack). Every name below MUST be spelled exactly as written. All
player-facing text is in **Spanish**. Code comments may be Spanish or English.

## 0. Platform

* `@minecraft/server` **2.6.0** (game 1.26.10+, March 2026). `@minecraft/server-ui` **2.0.0**.
  `min_engine_version` = `[1, 26, 10]`. Available in 2.6.0 (besides older APIs):
  `world.beforeEvents.entityHurt` (cancel/modify damage), `world.tickingAreaManager`,
  `Dimension.getLightLevel/getSkyLightLevel/isChunkLoaded/getBiome`, `Entity.lookAt`,
  `Player.playerPermissionLevel`, `Player.inputPermissions.setPermissionCategory(InputPermissionCategory.X, bool)`,
  `Player.camera.setCamera/fade/clear`, `world.afterEvents.playerButtonInput`, `Player.inputInfo`.
  NOT available: `Dimension.getWeather` (use `world.afterEvents.weatherChange`), `Entity.target`, `Camera.addShake`
  (use the command `camerashake add @s <intensity> <seconds> positional`).
* Early-execution rule: no `world.*` state access at module top level (subscribing to events is fine).
* Before-event handlers run read-only: only read state and set `ev.cancel`; defer writes with `system.run`.
* Simulation harness: `tools/sim/run.sh [test-file.mjs]` copies the scripts and runs a Node mock of the API
  (`tools/sim/node_modules/@minecraft/*`). Add your own test file `tools/sim/test_<area>.mjs` modeled on
  `tools/sim/test.mjs`. The mock is not the game — keep code defensive (try/catch around engine calls).

## 1. Player size (growth)

Human reference heights: child ≈ 1 block, teen ≈ 1.25–1.45 blocks, adult ≈ 2 blocks.
`scaleOf(d)` (core/profile.js) = stage base × race factor:
child 0.55→0.62, teen 0.70→0.80 (interpolated by growth), adult 1.11. Race factor = `RACES[r].scale`
(humano 1.0). Clamp to the player scale groups 30..135 (%), step 5. Player and NPC scale groups
(`rpg:scale_<pct>`) also set a `minecraft:collision_box` so the EFFECTIVE hitbox is
`width = min(0.6·s, 0.66)`, `height = min(1.8·s, 1.95)` (the engine multiplies the box by `minecraft:scale`).

## 2. Entities, properties, events

### 2.1 `rpg:npc` (all townsfolk, family, staff, guards, rulers)
Properties (all `client_sync: true`):
| property | type | range | meaning |
|---|---|---|---|
| `rpg:skin` | int | 0..159 | texture index, see §2.2 |
| `rpg:geo` | int | 0..5 | 0 base, 1 horns, 2 elf ears, 3 beast ears+tail, 4 halo, 5 fairy (ears+wings) |
| `rpg:hat` | int | 0..7 | 0 none, 1 straw hat, 2 hood, 3 noble feathered cap, 4 guard helmet, 5 crown, 6 bandana, 7 chef/baker hat |
| `rpg:tool` | int | 0..7 | 0 none, 1 sword, 2 spear, 3 hoe, 4 hammer, 5 tankard, 6 staff, 7 torch |
| `rpg:alert` | bool | | shows a red "!" above the head |
| `rpg:mood` | int | 0..3 | 0 normal, 1 happy, 2 angry (red face tint/brow), 3 sleeping (eyes closed) |

Spawn events (use `dim.spawnEntity('rpg:npc<EVENT>', loc)`):
* `rpg:spawn_citizen` → persistent, free to walk (no home restriction), starts in `rpg:act_idle`.
* `rpg:spawn_guard` → like citizen + permanent group `rpg:guard` (see below), starts in `rpg:act_idle`.
* `rpg:spawn_staff` → persistent, `minecraft:home` radius 3 (guild staff, rulers on throne).
* `rpg:spawn_resident` → persistent, `minecraft:home` radius 10 (family).
* `minecraft:entity_spawned` (natural spawn) → `rpg:wanderer` (despawnable traveller).
* Fallback events usable after spawn: `rpg:make_resident`, `rpg:make_staff`, `rpg:make_citizen`, `rpg:make_guard`.
* `rpg:scale_<pct>` (30..135 step 5) as today.

Group `rpg:guard` (permanent for guards): `type_family` `["npc","rpg_npc","rpg_guard","mob"]`,
health 60, `minecraft:attack` damage 5, melee attack, targets `monster` family within 16
(priority below activity targets), `hurt_by_target` (only reacts to monsters; players are handled by script).

**Activity groups** — mutually exclusive. Event `rpg:act_<name>` removes every other activity
group and adds `rpg:act_<name>`. Movement to a place uses
`minecraft:behavior.nearest_attackable_target` (must_see false, within_radius 96, filter family
listed) + `minecraft:behavior.move_towards_target` (within_radius 96) and a low-priority
`minecraft:behavior.random_stroll` (xz_dist 3) so they mill around once there.
| activity | goes to nearest family | speed | notes |
|---|---|---|---|
| `idle` | — | 0.5 | random stroll xz 8 |
| `work_field` | `rpg_wp_field` | 0.6 | |
| `work_forge` | `rpg_wp_forge` | 0.6 | |
| `work_market` | `rpg_wp_market` | 0.6 | |
| `tavern` | `rpg_wp_tavern` | 0.6 | |
| `plaza` | `rpg_wp_plaza` | 0.6 | |
| `home` | `rpg_wp_home` | 0.6 | |
| `church` | `rpg_wp_church` | 0.6 | |
| `sleep` | — | 0 | no movement; look around only |
| `patrol_0`..`patrol_3` | `rpg_wp_patrol_0`..`3` | 0.6 | guards |
| `patrol_jail` | `rpg_wp_jail_patrol` | 0.5 | jailer walks past the cells |
| `alarm` | `rpg_guard` | 1.4 | witness runs to nearest guard |
| `jeer` | players with tag `rpg_humiliated` | 0.6 | `minecraft:shooter` def `rpg:tomato` + `minecraft:behavior.ranged_attack` (radius 10, interval 1–3 s) |
| `flee` | — | 1.5 | `minecraft:behavior.avoid_mob_type` players within 20 (thieves running away) |
| `hunt` | players with tag `rpg_wanted` | 1.25 | guards: move + melee (damage is converted to an arrest by script) |
| `escort_stocks` | `rpg_wp_stocks` | 0.55 | guard leading an arrested player |
| `escort_jail` | `rpg_wp_jail` | 0.55 | guard leading an arrested player |

All non-guard NPCs always flee monsters (`avoid_mob_type` family `monster`, within 8).
NPC damage sensor: damage only from players (and only when not cancelled by script); tomato hits deal no damage.

### 2.2 `rpg:skin` index
`skin = race*16 + cls*4 + gender*2 + variant` with
race order `humano, elfo, enano, orco, bestia, demonio, celestial, vampiro, hada, draconido` (0..9),
cls `0 baja (peasant/poor), 1 media (artisan/citizen), 2 alta (noble/rich), 3 guardia (guard armor in the culture's colors)`,
gender `0 m, 1 f`, variant `0..1`. Textures are 64×128 (extra rows for hats/tools/alert).

### 2.3 `rpg:waypoint` (invisible place markers)
Spawn with `dim.spawnEntity('rpg:waypoint<rpg:wp_<kind>>', loc)`. Kinds:
`field, forge, market, tavern, plaza, home, church, stocks, jail, jail_patrol, patrol_0, patrol_1, patrol_2, patrol_3, gate`.
Each group sets `type_family` `["rpg_waypoint", "rpg_wp_<kind>"]`. Invisible, invulnerable, no gravity,
not pushable, persistent, tiny collision, not targetable by monsters/golems. Scripts tag them
`rpg_wp` and `rpg_set_<settlementId>`.

### 2.4 `rpg:tomato` (projectile)
Thrown by `rpg:npc` in `rpg:act_jeer` (shooter def) and by players using item `rpg:tomato`
(`minecraft:throwable` + `minecraft:projectile`). Impact: no real damage; scripts listen to
`world.afterEvents.projectileHitEntity/projectileHitBlock` and spawn particle `rpg:tomato_splash`.

### 2.5 `rpg:spirit`
Targets `monster` family OR any entity with tag `rpg_marked` (scripts tag the last thing the
owner hit for 10 s). Never targets players, NPCs, waypoints.

### 2.6 Monsters & bosses
Same identifiers as v1. AI improvements live in the JSON (pack hunting with `alert_same_type`,
leaping, kiting for casters, fleeing at low health via environment sensor, etc.).

## 3. Items (behavior pack)
New: `rpg:jail_key` (Llave de la celda, stack 1, icon kind `key`), `rpg:tomato` (Tomate, food 2 + throwable, icon `tomato`),
`rpg:lockpick` (Ganzúa, stack 16, icon `lockpick`), `rpg:noble_title` (Título nobiliario, stack 1, glint, icon `scroll`),
`rpg:wanted_poster` (Cartel de Se Busca, stack 16, icon `poster`). Icon kinds are drawn by `gen_textures.item_icon`.

## 4. Particles (resource pack, `particles/*.json`)
Existing: `rpg:spark`, `rpg:burst`, `rpg:aura` (tinted with `variable.color` via `MolangVariableMap.setColorRGB`).
New:
* `rpg:orb` — glowing projectile head, tinted with `variable.color`, lifetime ~0.15 s.
* `rpg:circle` — flat expanding ring on the ground, tinted with `variable.color`.
* `rpg:fx_<element>` for the 12 elements (`fuego, agua, tierra, viento, rayo, hielo, luz, oscuridad,
  necromancia, naturaleza, arcano, sangre`) — impact effect with element-specific shape/motion and baked colors.
* `rpg:rope` (brown dot, ~0.15 s, no motion), `rpg:tomato_splash`, `rpg:coins`, `rpg:zzz`, `rpg:birth` (swirling sparkles),
  `rpg:alarm` (red "!" puff).

## 5. HUD glyphs (resource pack `font/glyph_E3.png`, 256×256, 16×16 cells)
| code | char | meaning |
|---|---|---|
| U+E300 | `` | eye closed (nobody sees you) |
| U+E301 | `` | eye half-closed (someone is watching nearby) |
| U+E302 | `` | eye open (you were seen) |
| U+E303 | `` | wanted star (filled) |
| U+E304 | `` | wanted star (empty) |
| U+E305 | `` | coin |
| U+E306 | `` | heart |
| U+E307 | `` | mana |
| U+E308 | `` | shackles / tied hands |
| U+E309 | `` | crown (noble) |
| U+E30A | `` | shield (guard) |
| U+E30B | `` | skull (murder) |
| U+E30C | `` | sword |
| U+E30D | `` | scroll |
| U+E30E | `` | house |
| U+E30F | `` | tomato |

## 6. Script module ownership and APIs

Ownership (only the owner edits these files; others read them):
* **settlements**: `systems/settlements.js` (new), `systems/structures.js` (new), `data/cultures.js` (new), `systems/town.js`, `systems/build.js`.
* **justice**: `systems/crime.js` (new), `systems/justice.js` (new), `data/laws.js` (new).
* **life**: `systems/life.js` (new), `systems/economy.js` (new), `systems/social.js` (new), `data/social.js` (new),
  `systems/npc.js`, `systems/chat.js`, `systems/shop.js`, `systems/birth.js`, `systems/passives.js`, `core/profile.js`, `data/dialogue.js`, `data/names.js`.
* **magic**: `systems/magic.js`, `systems/spellfx.js` (new), `systems/summons.js`, `data/elements.js`.
* **bp-data**: `tools/build.py` (behavior pack JSON, items, blocks, recipes, spawn rules, loot, manifests).
* **rp-assets**: `tools/rp_models.py` (new; geometry, animations, render controllers, client entities,
  entity textures, particles, font glyphs) and `tools/gen_textures.py`.
* **integrator (lead)**: `main.js`, `systems/hud.js`, `systems/combat.js`, `systems/menu.js`, `core/*` except profile.js — wiring only.
Each module exposes `hooks` objects / exported functions; the integrator wires them in `main.js`.
Every agent returns an "integration notes" list: which exported function must be called from which event in `main.js`.

### 6.1 Settlement data (settlements module; stored in `W().settlements`, `W().realms`)
```js
Settlement = {
  id: 's3', kind: 'aldea'|'pueblo'|'ciudad'|'capital'|'inicio', culture: 'humano'|...|'draconido',
  name: 'Villarroble', realmId: 'r1', dim: 'minecraft:overworld',
  center: {x,y,z}, radius: 40,            // horizontal radius of the settlement
  plaza: {x,y,z},                          // town square
  stocks: {x,y,z} | null,                  // where a humiliated player stands (pillory)
  jail: { cells: [{ min:{x,y,z}, max:{x,y,z}, spawn:{x,y,z}, door:[{x,y,z}], doorBlock:'minecraft:iron_bars' }],
          exit:{x,y,z}, patrol:{x,y,z} } | null,
  houses: [{ id:'h1', cls:'baja'|'media'|'alta', door:{x,y,z}, min:{x,y,z}, max:{x,y,z}, owner: identId|null }],
  chests: [{ x,y,z, cls:'baja'|'media'|'alta', house:'h1' }],   // owned containers (stealing = crime)
  shops: [{ kind:'market'|'forge'|'tavern'|'temple', at:{x,y,z} }],
  residents: [identId], guards: [identId], rulerId: identId|null,
  built: true, createdDay: n
}
Realm = { id:'r1', name:'Reino de Valdoria', culture, ruler:{ name, title:'Rey'|'Reina'|'Gran Jefe'|..., identId },
          capitalId, government:'monarquía'|'consejo'|'tribal'|'teocracia'|'clan', strictness: 0|1|2,
          attitudes: { [raceId]: -1..1 }, economy: { focus:'minería'|'agricultura'|'comercio'|'guerra'|'magia', prosperity: 0.5..1.5 },
          colors: { primary:'#hex', secondary:'#hex' } }
```
Exports from `systems/settlements.js`:
`settlementAt(dimId, loc)` (inside radius), `nearestSettlement(dimId, loc, maxDist?)`, `getSettlement(id)`,
`realmOf(settlementOrId)`, `allSettlements()`, `allRealms()`, `ensureStarterVillage(player)`,
`nextHouseSpot()` (inside the starter village), `settlementTick()` (generation + upkeep, called every 2 s),
`hooks` (e.g. `hooks.onEnter(player, settlement)` assigned by the integrator).
NPC spawning goes through `npc.spawnNpc(dim, loc, ident)` and `npc.makeIdentity(opts)` (life module) —
the event chosen by `spawnNpc` follows `ident.job` (guard → `rpg:spawn_guard`, settlement citizen → `rpg:spawn_citizen`).

### 6.2 NPC identity (stored in the entity dynamic property `rpg:npc`)
```js
ident = { id, name, surname, gender:'m'|'f', race, role, pers, age:'adult'|'child', owner?, ownerName?,
          settlement?: 's3', realm?: 'r1', cls: 'baja'|'media'|'alta', job, wallet: number, homeId?: 'h1' }
```
`job` ∈ `granjero, herrero, mercader, tabernero, sacerdote, noble, mendigo, ladron, guardia, carcelero, rey,
aldeano, recepcionista, maestro, sacerdotisa, sombra, padre, madre, hermano, hermana, aventurero, bardo`.
`role` stays for v1 compatibility (family/staff); for townsfolk `role === job`.

### 6.3 Justice APIs (justice module)
`crime.reportCrime(player, type, { victim?, witness?, settlement?, value? })` with types
`hurto` (pickpocket), `robo_casa`, `robo_noble`, `allanamiento`, `agresion`, `agresion_guardia`, `asesinato`,
`asesinato_guardia`, `fuga`. Stars: 1–5. Severity → punishment: minor (1★) public humiliation 60 s at the
stocks; serious (2–3★) prison 15 min; murder (4–5★) prison 30 min (real minutes of online time; configurable).
Tags used on players: `rpg_wanted` (≥1★, guards hunt), `rpg_arrested`, `rpg_humiliated`, `rpg_jailed`, `rpg_tied`.
Exports the integrator wires: `onBeforeInteractEntity(ev) → boolean handled`, `onBeforeInteractBlock(ev) → boolean`,
`onBeforeItemUse(ev)`, `onBeforeEntityHurt(ev)`, `onEntityHurt(ev)`, `onEntityDie(ev)`, `onProjectileHit(ev)`,
`onItemUse(player, item)`, `onPlayerSpawn(player, initial)`, `fastTick()` (every 2 ticks), `secondTick()`,
`hudStatus(player) → string` (eye + stars glyphs, '' when nothing to show), `isRestricted(player) → boolean`.

### 6.4 Life / economy / society APIs (life module)
`life.tick()` (every second: schedules, speech bubbles), `economy.priceFactor(player, settlement, itemId, 'buy'|'sell')`,
`economy.haggle(player, merchantIdent, basePrice, 'buy'|'sell') → Promise<number|undefined>`,
`social.playerClass(d) → {id, name, rank 0..5}`, `social.fame(d, realmId)`, `social.addDeed(player, deed)`
(deed = `{ id, text, fame, realmId? }`), `social.hooks`.
Deeds come from integrator hooks: boss kill, dungeon clear, guild rank-up, raid defended, crimes (infamy).

### 6.5 Magic APIs (magic module)
Unchanged public API (`castSelected`, `cycleSlot`, `castSkill`, `castRacial`, `manaTick`, `slotInfo`,
`cooldownLeft`, `spellPower`, `isEnemy`, `hooks`). New: `magic.markTarget(player, entity)` (tags `rpg_marked` 10 s),
`spellfx.*` helpers. Element statuses tracked for reactions (combos).
