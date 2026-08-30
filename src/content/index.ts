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

export interface EnemyDef {
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
export const ENEMIES = enemyRest as unknown as Record<string, EnemyDef>
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
    /**
     * The arena area the counts above are quoted against, in square world
     * pixels — 2400x1600, the one arena that existed before maps.
     *
     * Every count is multiplied by `arenaArea / referenceArea`, so they are a
     * DENSITY. Without that a bigger map is a sparser one, and the economy is
     * downstream of harvest-per-minute; see `World.fieldDensity`.
     */
    referenceArea: number
  }
  mobDrops: { seedPackChance: number; seedPackFeed: number }
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

/* ------------------------------------------------------------------ maps */

/**
 * One ground layer of a map: a Wang set and the shape its upper terrain takes.
 *
 * The shapes are a closed set on purpose. Anything a map wants that is not
 * expressible as blobs, patches, edges or a ribbon is a new shape in
 * `src/render/terrain.ts` with a reason written next to it — not a free-form
 * script in content, which would put drawing code in a JSON file and make the
 * two renderers interpret it.
 */
export type MapLayer =
  & {
    /** Wang set name; must chain onto the base layer's grass or it will not meet. */
    set: string
    /** Start the field FULL and let the shape carve it. The base layer does this. */
    invert?: boolean
  }
  & (
    | { shape: 'fill' }
    | { shape: 'blobs'; count: number; minRadius: number; maxRadius: number; margin?: number }
    | {
      shape: 'patches'
      count: number; lobes: number; minRadius: number; maxRadius: number
      /** Lobe offset as a fraction of the patch radius. Above ~1 it fragments. */
      spread: number
    }
    | { shape: 'edges'; sides: ('left' | 'right' | 'top' | 'bottom')[]; depth: number }
    | {
      shape: 'ribbon'
      axis: 'h' | 'v'
      /** Radius in vertices, so a ribbon is `halfWidth * 2 + 1` across. */
      halfWidth: number
      /** Noise per step. Higher meanders more. */
      wander: number
      /**
       * Restoring pull toward the line it started on, per step. Default 0.05.
       *
       * WITHOUT THIS A RIBBON IS A DIAGONAL. Drift with no pull saturates and
       * the band leaves at a constant angle — see the note in terrain.ts, which
       * measured it. Lower is a lazier river; higher is a surveyed track.
       */
      pull?: number
    }
  )

export interface MapDef {
  id: string
  name: string
  blurb: string
  /** World pixels. These become `world.arenaW` / `arenaH`. */
  width: number
  height: number
  /**
   * A surface map is the farm and the seed picks one. A cave is entered by
   * walking into the way down that opens once the blight has taken the field,
   * and caves are ordered by `depth` with no way back up.
   */
  kind?: 'surface' | 'cave'
  /** 1-based, caves only. `depth + 1` is the next level down. */
  depth?: number
  /**
   * How far the dark closes in, 0 to 1, as a radial hole around the player.
   * Absent on the surface. See the note in maps.json — it is the biggest single
   * thing that makes a cave a cave, and it is also what earns floors that carry
   * a visible repeat at full brightness.
   */
  darkness?: number
  /**
   * Overrides `nodes.field.initial` for this map, before the density scale.
   *
   * The caves are rock-dominant but never all rock: the tool ladder gates
   * harvesting — pickaxe works rock, axe works tree and crop — so an all-rock
   * cave is a feed desert for a player who took the axe.
   */
  nodes?: Record<string, number>
  /** The Wang set the ash spreads in. Must chain onto the base layer's grass.
   *  Absent underground: the ash is a thing that happens to a field. */
  blight?: string
  layers: MapLayer[]
}

export const MAPS = (mapsRaw as unknown as { maps: MapDef[] }).maps

/**
 * Which map a seed plays on.
 *
 * **Derived from the seed, NEVER drawn from the world's RNG**, and that is the
 * whole reason this is a function rather than a call to `world.rng`. The
 * handoff has warned for two sessions that "the map choice has to be the FIRST
 * draw off the RNG or every existing seed stops replaying" — true, and it is
 * also avoidable. Deriving a separate stream from the seed consumes nothing
 * from the simulation's, so wave order, drops and offers are byte-identical to
 * what that seed produced before. The same trick the terrain bake and the
 * blight already use.
 *
 * The arena SIZE still changes what a seed plays out as, because spawns and
 * scatter are in arena coordinates. That is a real difference and not an
 * ordering bug: the same seed replays itself exactly, which is what
 * `run.test.ts` asserts.
 */
export function mapForSeed(seed: number): MapDef {
  return SURFACE_MAPS[Math.abs(Math.imul(seed ^ 0x4d3a17, 0x27d4eb2d) >>> 8) % SURFACE_MAPS.length]
}

/** The farm. A run starts on one of these. */
export const SURFACE_MAPS = MAPS.filter((m) => (m.kind ?? 'surface') === 'surface')

/**
 * The caves, shallowest first.
 *
 * Ordered by `depth` rather than by their order in the file, because the file
 * is grouped for reading and the descent is a sequence — `caveAtDepth(n)` is
 * what the game asks for and it must not depend on how the JSON is laid out.
 */
export const CAVE_MAPS = MAPS
  .filter((m) => m.kind === 'cave')
  .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))

/** The cave at this depth, 1-based, or undefined when there is no deeper one. */
export function caveAtDepth(depth: number): MapDef | undefined {
  return CAVE_MAPS.find((m) => m.depth === depth)
}

/** How deep the descent goes. */
export const MAX_DEPTH = CAVE_MAPS.reduce((n, m) => Math.max(n, m.depth ?? 0), 0)

/** A map by id, for tools and the dev overlay. Falls back to the first. */
export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]
}
