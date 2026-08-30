/**
 * The only module that reads content JSON. Everything else imports typed data
 * from here, so a shape change fails in one place.
 */
import classesRaw from './classes.json'
import weaponsRaw from './weapons.json'
import itemsRaw from './items.json'
import enemiesRaw from './enemies.json'
import wavesRaw from './waves.json'
import metaRaw from './meta.json'
import rarityRaw from './rarity.json'
import tuningRaw from './tuning.json'
import nodesRaw from './nodes.json'
import elementsRaw from './elements.json'
import audioRaw from './audio.json'
import mapsRaw from './maps.json'
import breakablesRaw from './breakables.json'

/** Every stat the resolver knows about. Keys ending `Pct` are percentages
 *  summed additively; everything else is a flat addend. */
export interface StatBlock {
  maxHp: number
  hpRegen: number
  armor: number
  dodgePct: number
  lifestealPct: number
  moveSpeedPct: number
  pickupRadiusPct: number
  luck: number
  harvestPct: number
  damagePct: number
  meleePct: number
  rangedPct: number
  attackSpeedPct: number
  critChancePct: number
  critDamagePct: number
  rangePct: number
  projectileCount: number
}

export const STAT_KEYS: readonly (keyof StatBlock)[] = [
  'maxHp', 'hpRegen', 'armor', 'dodgePct', 'lifestealPct', 'moveSpeedPct',
  'pickupRadiusPct', 'luck', 'harvestPct', 'damagePct', 'meleePct',
  'rangedPct', 'attackSpeedPct', 'critChancePct', 'critDamagePct',
  'rangePct', 'projectileCount',
]

/** Human labels for the level-up and shop delta lines. */
export const STAT_LABELS: Record<keyof StatBlock, string> = {
  maxHp: 'Max HP',
  hpRegen: 'HP regen',
  armor: 'Armor',
  dodgePct: 'Dodge',
  lifestealPct: 'Lifesteal',
  moveSpeedPct: 'Move speed',
  pickupRadiusPct: 'Pickup radius',
  luck: 'Luck',
  harvestPct: 'Harvest',
  damagePct: 'Damage',
  meleePct: 'Melee damage',
  rangedPct: 'Ranged damage',
  attackSpeedPct: 'Attack speed',
  critChancePct: 'Crit chance',
  critDamagePct: 'Crit damage',
  rangePct: 'Range',
  projectileCount: 'Projectiles',
}

export type StatMods = Partial<StatBlock>

export interface ClassDef {
  name: string
  sheet: string
  unlocked: boolean
  blurb: string
  stats: StatMods
  passive: { id: string; desc: string; [k: string]: unknown }
  ability: {
    id: string
    name: string
    cooldown: number
    desc: string
    [k: string]: unknown
  }
  startingWeapon: string
  /** Class-card presentation; see the note in classes.json. */
  tag?: string
  bars?: { body: number; speed: number; reach: number }
  cardPassive?: string
}

export type WeaponType = 'melee' | 'ranged' | 'orbit' | 'aura' | 'utility' | 'minion'

export interface WeaponDef {
  name: string
  type: WeaponType
  sprite: string
  /**
   * The icon at each tier, T1 first. Merging changes the weapon — guns step up
   * their category, melee steps up its material — and this is where that is
   * recorded. Authored in `weapons.json` for all sixteen weapons at all four
   * tiers and read by the HUD's weapon slots; `sprite` is the T1 fallback.
   */
  tierSprites?: string[]
  base: number
  cooldown: number
  behaviour: string
  tiers: Record<string, string>
  /** The weapon's signature round; every ranged weapon draws a different one. */
  projectileClip?: string
  /** Multiplies the renderer's base projectile scale. See PROJECTILE_SCALE. */
  projectileScale?: number
  [k: string]: unknown
}

export interface ItemDef {
  name: string
  icon: string
  cost: number
  mods: StatMods
  /** Declared in items.json; drives card colour and the guaranteed-uncommon
   *  slot in every offer set. */
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  /** Where this may be offered. Defaults to 'both'. */
  source?: 'levelup' | 'shop' | 'both'
  special?: string
  [k: string]: unknown
}

/**
 * The atlas frame that draws an item's card.
 *
 * `cardSprite` is declared per item and is the authority; `item.<icon>` is the
 * fallback for the entries that predate the field. Kept here rather than in the
 * renderer because both the card UI and the field pickup ask the same question,
 * and answering it twice is how the two drift apart.
 */
export function itemCardSprite(id: string): string {
  const def = ITEMS[id] as { cardSprite?: string; icon?: string } | undefined
  return def?.cardSprite ?? `item.${def?.icon ?? id}`
}

export interface EnemyDef {
  /**
   * Optional atlas sheets to draw this enemy from, cycled per spawn.
   *
   * Purely cosmetic -- one stat block, many skins. Every sheet named here must
   * carry a `walk` clip, because that is the only lookup with no graceful
   * fallback; `attack` falls back to walk and `death` falls back to the spin.
   */
  sheets?: string[]
  name: string
  sheet: string
  hp: number
  speed: number
  damage: number
  radius: number
  firstWave: number
  threatCost: number
  groupSize: number
  behaviour: string
  xp: number
  teaches: string
  separation?: boolean
  knockbackImmune?: boolean
  frontalReductionPct?: number
  special?: Record<string, unknown>
  [k: string]: unknown
}

/**
 * Drop `_`-prefixed keys, which are design notes rather than entries.
 *
 * The content files carry their reasoning inline, and every consumer that then
 * iterates the object has to know that. Twice now one has not: a `_tierNote`
 * crashed the tool layer at module load, and a `_projectileNote` put a bare
 * string into the weapon roster where the offer pool read `.tiers` off it. The
 * filter belongs here, once, at the boundary — not in each caller.
 */
function defsOf<T>(raw: unknown): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(raw as Record<string, T>)) {
    if (!k.startsWith('_')) out[k] = v
  }
  return out
}

export const CLASSES = defsOf<ClassDef>(classesRaw)
export const WEAPONS = defsOf<WeaponDef>(weaponsRaw)
export const ITEMS = defsOf<ItemDef>(itemsRaw)

// enemies.json carries the bosses under a `_bosses` key; split them out so the
// spawner never has to filter a magic key out of the roster.
const { _bosses, ...enemyRest } = enemiesRaw as unknown as Record<string, unknown>
/**
 * `defsOf` and not a bare spread.
 *
 * This line used to drop only `_bosses`, which meant every OTHER `_`-prefixed
 * design note in enemies.json survived into the roster as a fake enemy. The
 * failure is silent and total: `ENEMY_IDS` includes the note, `refreshRoster`
 * reads `undefined` for its `firstWave` so it is never filtered out, and then
 * `1 / Math.sqrt(undefined)` puts a NaN into the spawn weight table. One NaN
 * makes `weightedIndex` return garbage for EVERY enemy, so the director stops
 * spawning and a whole run reports zero kills.
 *
 * The file got its first such note in session 17 and immediately took the whole
 * acceptance suite down with it. `defsOf` is the utility that already exists for
 * exactly this, and its own comment records that this class of bug had bitten
 * twice before.
 */
export const ENEMIES = defsOf<EnemyDef>(enemyRest)
export const BOSSES = (_bosses ?? {}) as Record<string, Record<string, unknown>>

export const WAVES = wavesRaw
export const META = metaRaw

export interface RarityTier {
  name: string
  /** Relative draw weight before luck. */
  weight: number
  /** How hard a point of luck pushes toward this tier. */
  luckScaling: number
  /** Diamond pips on the plate, 1-5. The pip count survives greyscale. */
  rank: number
  /** Plate gradient: top stop, bottom stop, and the text on it. */
  colour: string
  dark: string
  ink: string
  /** Legendary only — the foil sweep, so the animation means one thing. */
  foil: boolean
}

/** The five tiers, commonest first. See rarity.json. */
export const RARITY = (rarityRaw as unknown as { tiers: Record<string, RarityTier> }).tiers
export const RARITY_ORDER = Object.keys(RARITY) as (keyof typeof RARITY & string)[]
export const AUDIO = audioRaw

export const TUNING = tuningRaw

/** Harvestable nodes and the pickaxe/axe ladder. */
export interface NodeVariant {
  sprite: string
  hp: number
  feed: number
  xp: number
  weight: number
}
export interface NodeKind {
  tool: string
  radius: number
  hpPerWave: number
  variants: NodeVariant[]
}
export interface ToolTier { id: string; name: string; dps: number }
/** An elemental modifier applied to every ranged weapon the player owns. */
export interface ElementDef {
  name: string
  clip?: string
  impact: string
  burnDps?: number
  burnSeconds?: number
  bleedDps?: number
  bleedSeconds?: number
  slowOnHit?: number
  slowSeconds?: number
  ignitesSlicks?: boolean
  slickDps?: number
}
export const ELEMENTS = (elementsRaw as unknown as { elements: Record<string, ElementDef> }).elements

export const NODES = nodesRaw as unknown as {
  tools: Record<string, { worksKind: string; alsoWorks?: string; tiers: ToolTier[] }>
  kinds: Record<string, NodeKind>
  field: {
    initial: Record<string, number>
    regrowPerWave: Record<string, number>
    max: Record<string, number>
    minDistanceFromPlayer: number
  }
  mobDrops: { seedPackChance: number; seedPackFeed: number }
}

/**
 * Destructible field objects and what falls out of them.
 *
 * A drop row's `min`/`max` are absent on the rows that carry no number --
 * `nothing`, `gear` and `magnet` -- so the roll reads them only for the kinds
 * that have a value. See breakables.json for why `nothing` is the heaviest row
 * in every table.
 */
export interface DropRow {
  kind: 'nothing' | 'xp' | 'feed' | 'heal' | 'gear' | 'magnet'
  weight: number
  min?: number
  max?: number
}
export interface BreakableClass {
  /** Every skin this class may wear. One is drawn per instance. */
  sprites: string[]
  weight: number
  hp: number
  radius: number
  drops: string
}

/**
 * A map's say over the breakables standing on it.
 *
 * `weights` replaces a class's draw weight -- 0 removes it from this map
 * entirely -- and `sprites` replaces its skin list. Both are per class and both
 * are optional, so a map that says nothing gets the defaults, which is what
 * every map did before this existed.
 */
export interface MapBreakables {
  weights?: Record<string, number>
  sprites?: Record<string, string[]>
}
export const BREAKABLES = breakablesRaw as unknown as {
  field: {
    initial: number
    regrowPerWave: number
    max: number
    minDistanceFromPlayer: number
    edgePad: number
  }
  classes: Record<string, BreakableClass>
  dropTables: Record<string, DropRow[]>
  magnet: { sprite: string; radiusMultiplier: number; seconds: number }
  gear: { sprite: string }
}

/**
 * The breakable classes as ordered ENTRIES, built once.
 *
 * Entries rather than values because a map's overrides are keyed by class id,
 * so the scatter needs the id alongside the definition. Building this per
 * scatter would allocate inside a call the wave boundary makes.
 */
export const BREAKABLE_CLASSES: [string, BreakableClass][] =
  Object.entries(BREAKABLES.classes)

/**
 * Which item cards a breakable may hand over.
 *
 * Everything but the legendaries. A legendary reshapes a run -- The Reaper's
 * Own makes melee infinitely piercing -- and finding one under a barrel would
 * make the run about barrels. Those stay behind the level-up screen and the
 * shop, where the player chose them over something else.
 *
 * It lives HERE and not in the sim because "which items may be found in the
 * field" is a content decision, and because a rule that is only expressed
 * inside a private function is a rule no test can reach without the sim
 * growing a hole for it.
 */
export const FIELD_GEAR_POOL: string[] = Object.entries(ITEMS)
  .filter(([id, def]) => !id.startsWith('_') && (def as { rarity?: string }).rarity !== 'legendary')
  .map(([id]) => id)

/**
 * Where a run happens. See maps.json — a map owns the ground it bakes from, the
 * node and enemy mix standing on it, the arena's size and shape, and whatever
 * hazards vent out of it.
 */
export interface MapTerrain {
  groundSet: string
  soilSet: string
  soilEdgeCols: number
  blight: { fromWave: number; groundSet: string }[]
}
/**
 * Drifting ground fog. Absent means a map has none, which is the default.
 *
 * `alpha` caps the whole layer; `drift` is pixels per second of the slow bank,
 * and the fast bank moves at a different rate so the parallax reads as depth.
 */
export interface MapFog {
  alpha: number
  tint: string
  drift: number
  scale: number
}
/**
 * Art hanging above the field, drawn over everything and fading when the player
 * walks under it. Absent means a map has none.
 *
 * `perMillionPx` keeps density independent of arena size, which the scenery band
 * learned the hard way: a fixed count is sparse on a big map and a thicket on a
 * small one.
 */
export interface MapOverhead {
  sprites: string[]
  perMillionPx: number
  fadeRadius: number
  minAlpha: number
  /** Base opacity when the player is nowhere near. */
  alpha: number
}
export interface MapHazards {
  kind: HazardKindName
  /** Atlas frame drawn under the hazard circle. Optional — a hazard without
   *  art still reads, because the circle is what carries the warning. */
  sprite?: string
  fromWave: number
  everySeconds: number
  maxLive: number
  radius: number
  growth: number
  life: number
  /** Damage per second to enemies standing inside. */
  dps: number
  /** Damage per second to the player. Separate, so a map can make a hazard a
   *  tool rather than only a tax. */
  playerDps: number
  /** Slow applied to enemies standing inside, 0-100. */
  slowPct: number
  /** Slow applied to the player standing inside, 0-100. */
  playerSlowPct: number
  /** Vents no closer than this to the player. */
  minDistanceFromPlayer: number
  /** ...and no further than this, so a hazard is something you walk into
   *  rather than a lottery held somewhere on a four-million-pixel field. */
  maxDistanceFromPlayer: number
}
/** Mirrors `HazardKind` in sim/entities.ts. Duplicated rather than imported
 *  because content must not depend on the sim; `maps.test.ts` asserts the two
 *  lists stay identical, which is the check that makes the duplication safe. */
export type HazardKindName = 'slow' | 'lure' | 'damage' | 'gas' | 'acid'

export interface MapDef {
  name: string
  blurb: string
  /** Relative draw weight when the run picks its map. */
  weight: number
  arena: { width: number; height: number }
  terrain: MapTerrain
  nodes: {
    initial: Record<string, number>
    max: Record<string, number>
    regrowPerWave: Record<string, number>
    /** Raises a node variant's draw weight for this map only. Biome variants
     *  sit at weight 0 in nodes.json and only appear where a map asks. */
    variantWeights?: Record<string, number>
  }
  /** Multiplies an enemy's spawn weight on this map. Absent means 1. */
  enemyBias: Record<string, number>
  hazards: MapHazards | null
  /** Drifting ground fog, or absent for none. */
  fog?: MapFog
  /** This map's overrides for the breakable classes standing on it. */
  breakables?: MapBreakables
  /** Ceiling art drawn over everything, or absent for open sky. */
  overhead?: MapOverhead
  /** Props and ground marks this map is dressed with. Absent means the default
   *  farm set; see `sceneryKindsFor`. */
  dressing?: MapDressing
  /** What the arena edge is made of. Absent means the farm fence. */
  boundary?: MapBoundary
}

/**
 * The arena edge.
 *
 * The edge was a clamp and a stroked line, then a clamp and a fence. A bunker
 * is neither: it is a ROOM, and a room that just stops at an invisible line
 * reads as a bug rather than as a wall.
 *
 * `inset` is the only part of this that touches the sim -- it pulls the player
 * clamp in by that many pixels so the band is wall rather than floor you can
 * stand on. It DEFAULTS TO 0, which is what every surface map uses, so the
 * five farm maps clamp exactly where they always did and every seeded replay
 * still holds. Enemies are deliberately not inset: they spawn outside the
 * arena and walk in, which is what they already did through the fence.
 */
export interface MapBoundary {
  /** `fence` is the farm's posts and rails. `wall` is a solid band. */
  kind: 'fence' | 'wall'
  /** How far the band reaches in from each edge, in pixels. */
  band: number
  /** Pixels the PLAYER clamp is pulled in by. Usually `band`, and 0 for a
   *  fence, which the player has always been able to stand on. */
  inset: number
  /**
   * Wang set whose UPPER terrain is the wall and whose lower is this map's
   * floor. A wall is a TERRAIN, not a row of stamped sprites, and that is the
   * whole reason the corners work: corner autotiling already turns a band into
   * a room with four proper corners, and stamping sprites would have needed a
   * hand-written corner case for each. It is the same `bakeWangGround` the
   * ground uses -- one machine, two fields.
   */
  wangSet?: string
  /**
   * Wall-mounted dressing -- pipe runs, hazard striping, a caged lamp -- stamped
   * along the band on a roll.
   *
   * These are OBJECTS and not tiles, which is the distinction that cost a
   * generation to learn: a map-object comes back with an outline all the way
   * round, so eight of them in a row read as eight bricks with gaps, never as a
   * wall. As things bolted ONTO a wall that already tiles, they are exactly
   * right.
   */
  panels?: string[]
}

/**
 * What a map is dressed with: standing props round the edges, flat marks on
 * the ground.
 *
 * REPLACES the default wholesale rather than merging. A bunker floor wants none
 * of the farm, and a merging scheme would have made "no scarecrows" cost ten
 * lines of exclusions to remove ten props. An empty array means bare, and is a
 * legal answer.
 */
export interface MapDressing {
  scenery?: string[]
  decals?: string[]
}

/**
 * The dressing a map gets when it names none.
 *
 * Lives in maps.json rather than in either renderer because it USED to live in
 * both of them, hardcoded, and that is how the first bunker preview came out
 * with a plough and a grave marker on a concrete floor. Fog, overhead art,
 * breakable skins and the ground were already per-map; scenery and decals were
 * the one dressing layer that was not, so every new biome silently inherited a
 * barnyard.
 *
 * Both the browser renderer and `tools/draw-world.ts` call these, which is also
 * what keeps them agreeing: there is one list now, not two that drift.
 */
const DEFAULT_DRESSING = (mapsRaw as unknown as { defaultDressing: MapDressing }).defaultDressing

export function sceneryKindsFor(map: MapDef): readonly string[] {
  return map.dressing?.scenery ?? DEFAULT_DRESSING.scenery ?? []
}

export function decalKindsFor(map: MapDef): readonly string[] {
  return map.dressing?.decals ?? DEFAULT_DRESSING.decals ?? []
}

export const MAPS = defsOf<MapDef>(
  (mapsRaw as unknown as { maps: Record<string, MapDef> }).maps,
)
export const MAP_IDS = Object.keys(MAPS)

/**
 * Pick a run's map.
 *
 * The caller MUST call this as the first draw off a run's RNG — see the
 * `_rngNote` in maps.json. It takes the raw `next()` rather than an Rng method
 * so the cost in stream position is exactly one draw, whatever the map count.
 */
export function pickMapId(roll: number): string {
  let total = 0
  for (const id of MAP_IDS) total += MAPS[id].weight
  let r = roll * total
  for (const id of MAP_IDS) {
    r -= MAPS[id].weight
    if (r <= 0) return id
  }
  return MAP_IDS[MAP_IDS.length - 1]
}

export const CLASS_IDS = Object.keys(CLASSES)
export const WEAPON_IDS = Object.keys(WEAPONS)

/**
 * How much to multiply the base projectile scale by for this weapon.
 *
 * Lives here rather than in the renderer so the number stays in content, and so
 * the headless painter reads the identical value — a screenshot tool that
 * scales projectiles differently to the game is worse than no screenshot tool.
 */
export function projectileScaleFor(weaponId: string): number {
  const s = WEAPONS[weaponId]?.projectileScale
  return typeof s === 'number' ? s : 1
}
export const ITEM_IDS = Object.keys(ITEMS)
/**
 * The spawner's roster — every enemy EXCEPT bosses.
 *
 * Bosses are placed explicitly by `World.spawnBoss` on their wave. Leaving them
 * in here let the wave director pick the Prize Bull like any other enemy, and
 * because a boss carries `threatCost: 0` so the budget cannot refuse it, it
 * cost nothing and spawned without limit. Every bot run died on wave one.
 */
export const ENEMY_IDS = Object.keys(ENEMIES).filter((id) => ENEMIES[id]?.boss !== true)

/** Every enemy id including bosses, for lookups rather than spawning. */
export const ALL_ENEMY_IDS = Object.keys(ENEMIES)
