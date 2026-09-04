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
import { FOUR_WAY, directionIndex } from '../core/facing'
import { STEP } from '../core/step'

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
  /** H15 (docs/UPGRADE_ROSTER.md §8): additive XP percentage, summed the same
   *  way every other `Pct` key is. Read once, in `World.collect`'s `'xp'`
   *  case, beside the `harvestPct` bonus that already scaled XP pickups. */
  xpPct: number
}

export const STAT_KEYS: readonly (keyof StatBlock)[] = [
  'maxHp', 'hpRegen', 'armor', 'dodgePct', 'lifestealPct', 'moveSpeedPct',
  'pickupRadiusPct', 'luck', 'harvestPct', 'damagePct', 'meleePct',
  'rangedPct', 'attackSpeedPct', 'critChancePct', 'critDamagePct',
  'rangePct', 'projectileCount', 'xpPct',
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
  xpPct: 'XP',
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
 *
 * A `cardSprite` pointing at something that is NOT this item's own icon is a
 * stand-in, and a stand-in outlives its excuse silently. Seven of them did:
 * `saltLick` and `saltCircle` both drew `node.rockSmall`, `barbedWire` drew a
 * silver ore node, `keroseneCan` drew a slop bucket — while `item.saltLick`,
 * `item.barbedWire` and the rest sat packed in the atlas, generated and paid
 * for, drawn by nothing. The audit that found them is the reason
 * `docs/PIXELLAB_LEDGER.md` exists. If you add a stand-in, say so in a
 * `_standInNote` beside it so the next audit can tell a choice from an oversight.
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
  /**
   * Base draw weight, before any map's say. Defaults to 1.
   *
   * 0 means the enemy exists in the roster and appears NOWHERE until a map asks
   * for it by name -- the same mechanism biome node variants use, and the reason
   * the base cast can be added to this file without changing a single surface
   * wave. A map's `enemyBias` entry REPLACES this rather than multiplying it, so
   * a base map can raise a zero.
   */
  weight?: number
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

  /**
   * The six Loads added by docs/UPGRADE_ROSTER.md batch 1 are not all
   * damage-over-time, so a Load's payload now includes a vulnerability mark
   * and a knockback — both fields `World.applyHit` already carried for the
   * weapon riders — and a set of riders the world reads off the ACTIVE
   * element rather than off the item that granted it. See `elements.json`
   * `_riderNote` for why that distinction is load-bearing.
   */
  markPct?: number
  markSeconds?: number
  knockback?: number
  /** H1: Fence Charge arcs to a neighbour. */
  chainCount?: number
  chainRange?: number
  chainMul?: number
  /** H6: the Kerosene Load lays burning ground where a hit lands. */
  hitHazardKind?: string
  hitHazardRadius?: number
  hitHazardSeconds?: number
  hitHazardDps?: number
  /** H6: the Tar Load lays a slick where a kill lands. */
  killHazardKind?: string
  killHazardRadius?: number
  killHazardSeconds?: number
  killHazardSlowPct?: number
  /** H11: Font Water heals on a kill. */
  killHeal?: number
  [k: string]: unknown
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
  /** The way down, on a map that has one. Absent means the map is terminal. */
  exit?: MapExit
}

/**
 * The way to the next level.
 *
 * A door in the wall, not a portal, and that ordering is deliberate: everything
 * about this facility -- poured concrete, stencils, dial indicators, a cage
 * lift -- says *people built this with the engineering they had.* A portal on
 * level two throws that away for a magic door. The lift earns the portal by
 * going deep enough that engineering stops explaining what is down there.
 *
 * It appears only once `afterWave` has been cleared, so a level is a thing you
 * survive rather than a corridor you walk. Placed ON the wall band, which is
 * the other reason the band exists: a door standing in the middle of an open
 * field is a prop, not an exit.
 */
export interface MapExit {
  /** Cleared this wave, and the door unseals. */
  afterWave: number
  /** Atlas key for the door itself. */
  sprite: string
  /** How close the player must get. Generous on purpose -- this is a reward,
   *  not a precision test, and the player has earned it by surviving. */
  radius: number
  /** Which map is through it. */
  nextMap: string
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

// ------------------------------------------------------------ carried loadout
/*
   Which weapon rides where on the farmhand's body.

   Lives in content rather than in the renderer for the reason
   `projectileScaleFor` above does: `tools/draw-world.ts` is a second,
   deliberately independent painter, and it has to reach the same answer. The
   ANSWER may be derived twice; the RULE that produces it may not, because the
   rule is a design decision and a screenshot that arms the player differently
   to the game is worse than no screenshot at all.

   Nothing here touches the simulation. Slot assignment reads `firedAt`, which
   the sim stamps, and returns a picture; no seed, no draw, no tick depends on
   it.
*/

/**
 * The anchors something can hang from. `hand` is dynamic; the rest rest.
 *
 * `beltR`/`beltL` are NOT weapon slots and are deliberately outside
 * `CARRY.fallbackOrder`: the pickaxe and the axe hang there, and they are not
 * weapons — they never aim and they never fire, and letting them into the six
 * would have cost a third of the loadout to two things that only ever dangle.
 * No weapon names them and the assignment loop cannot reach them.
 */
export type CarrySlot =
  | 'hand' | 'back' | 'backX' | 'shoulder' | 'hipR' | 'hipL' | 'beltR' | 'beltL'

/** Where a slot sits for one facing. See tuning.json -> carry. */
export interface CarryAnchor {
  /** World pixels right of the player's centre. */
  dx: number
  /** World pixels up from his BOOTS — see `CARRY.bootOffsetY`. */
  dy: number
  /** Draw behind the character sprite for this facing. */
  behind: boolean
  /** Mirror the art horizontally; the sources all point right. */
  flip: boolean
  /** Resting rotation, radians. The weapon's `carryAngle` is added to it. */
  angle: number
}

export const CARRY = tuningRaw.carry as unknown as {
  bootOffsetY: number
  fallbackOrder: CarrySlot[]
  freshLiftPixels: number
  freshScale: number
  /** Per slot: the four facings, plus an optional `byClass` override block. */
  slots: Record<string, Record<string, CarryAnchor> & {
    byClass?: Record<string, Record<string, Partial<CarryAnchor>>>
  }>
  /** Per class: which resting slot a weapon asks for, overriding weapons.json. */
  classSlot?: Record<string, Record<string, CarrySlot>>
}

const FACINGS = ['down', 'up', 'left', 'right'] as const

/**
 * Every anchor a class can ask for, merged once, at load.
 *
 * `byClass` in tuning.json names only the fields it changes — `{ "dy": -40 }`
 * raises a shoulder without restating its dx, its depth or its angle — and
 * merging that against the default is an object built per lookup, which is a
 * per-frame allocation for every weapon the player owns. So it is done here
 * instead, once, into complete anchors: `carryAnchorOf` stays a lookup.
 *
 * Keyed `slot|classId` with `slot|` as the default row. A string key rather
 * than nested maps because the miss case has to be as cheap as the hit — five
 * of the six classes have no override for most slots.
 */
const CARRY_ANCHORS: Record<string, CarryAnchor> = (() => {
  const out: Record<string, CarryAnchor> = {}
  for (const [slot, byFacing] of Object.entries(CARRY.slots ?? {})) {
    // `_`-prefixed keys are design notes, not slots. The same filter as
    // `defsOf`, for the same reason it exists: a note that walks into a table
    // as data fails silently and a long way from here.
    if (slot.startsWith('_')) continue
    for (const dir of FACINGS) {
      const base = byFacing[dir] ?? byFacing.down
      if (!base) continue
      out[`${slot}||${dir}`] = base
      for (const [classId, dirs] of Object.entries(byFacing.byClass ?? {})) {
        const over = dirs[dir]
        out[`${slot}|${classId}|${dir}`] = over ? { ...base, ...over } : base
      }
    }
  }
  return out
})()

/**
 * The resting slot a weapon asks for, or `none` if it is not carried at all.
 *
 * A class may override it — the Veteran shoulders the drum gun that every
 * other class wears on its back. The override cannot conjure a slot for a
 * weapon that declared `none`: the Scythe is already orbiting him and the Barn
 * Dog is already running about, and no class carries either.
 */
export function carrySlotOf(weaponId: string, classId?: string): CarrySlot | 'none' {
  const c = WEAPONS[weaponId]?.carry
  const declared = typeof c === 'string' ? (c as CarrySlot | 'none') : 'none'
  if (declared === 'none' || !classId) return declared
  return CARRY.classSlot?.[classId]?.[weaponId] ?? declared
}

/** The on-screen size of the art's longest side, in world pixels. */
export function carryHeightOf(weaponId: string): number {
  const h = WEAPONS[weaponId]?.carryHeight
  return typeof h === 'number' ? h : 0
}

/**
 * The atlas frame the BODY draws for this weapon, or `''` for the card art.
 *
 * A carried weapon and a carded weapon are two different pictures and this is
 * the seam between them. The six firearms card off the bundled 132-gun sheet,
 * which is drawn to be held by a 32px character — at our 52px a rifle across
 * the back reads as a carbine, and `gun.pistol.0` is 3x2. `carry.*` is drawn
 * for the body at 28-31px and has no tiers, because a carried gun does not
 * change shape when it merges. Everything without one falls through to the
 * tier art exactly as before.
 */
export function carrySpriteOf(weaponId: string): string {
  const s = WEAPONS[weaponId]?.carrySprite
  return typeof s === 'string' ? s : ''
}

/**
 * Where the hand grips the art, as a fraction of its own length. Default 0.5.
 *
 * A gun rotated about its centre sweeps its stock through the farmhand's chest
 * as it tracks — the tell that a sprite is being spun rather than held. This
 * moves the turning point to the trigger, and it is also what tells the muzzle
 * flash where the muzzle is: `1 - carryPivot` of the length, forward.
 */
export function carryPivotOf(weaponId: string): number {
  const p = WEAPONS[weaponId]?.carryPivot
  return typeof p === 'number' ? p : 0.5
}

/**
 * The atlas frame a weapon's CARD draws at a tier — HUD slot, offer, shop.
 *
 * Here rather than in the HUD because three callers ask the same question and
 * answering it three times is how they drift; `itemCardSprite` exists for the
 * same reason. `cardSprite` opts a weapon out of the tier ladder entirely, and
 * ALL SIX FIREARMS now do. The Harpoon Gun went first because `gun.pistol.*` is
 * three pixels by two at T1 and eleven by four at T4 — a blank rectangle at
 * every tier. The other five are the same argument with less arithmetic:
 * `gun.shotgun.0` is 8x4 and `gun.smg.0` is 8x6, drawn to be held by a 32px
 * character, and a card window is 96px. Their `carry.*` art is 28-31px long and
 * purpose-drawn. A crisp gun at one tier beats a smear at four, and the tier is
 * not lost — the card's tin plate and its rank pips carry it, which is what
 * they are for.
 */
export function weaponCardSprite(weaponId: string, tier: number): string {
  const def = WEAPONS[weaponId] as
    { cardSprite?: string; tierSprites?: string[]; sprite?: string } | undefined
  if (!def) return ''
  if (typeof def.cardSprite === 'string') return def.cardSprite
  return def.tierSprites?.[Math.min(Math.max(tier, 1), 4) - 1] ?? def.sprite ?? ''
}

/** True when the art is a side view that can be swung round to the aim. */
export function carryAimsOf(weaponId: string): boolean {
  return WEAPONS[weaponId]?.carryAim === true
}

/** Extra rotation on top of the slot's resting angle, radians. */
export function carryAngleOf(weaponId: string): number {
  const a = WEAPONS[weaponId]?.carryAngle
  return typeof a === 'number' ? a : 0
}

/**
 * How a melee weapon PRESENTS its attack: `'sweep'` (the default) or `'thrust'`.
 *
 * The sim is identical either way — `arcSwing` spawns the same attached disc,
 * with the same radius, damage, arc and cooldown — so this is a drawing
 * instruction and nothing else. It exists because the pitchfork was being drawn
 * as a sword: a white crescent (`fx.slash`) over the FX pack's demon-bite loop
 * (`proj.claw`) stretched to the swing's 78px diameter. The owner's words for
 * the second one were "a giant sand mouth eating things", which is exactly what
 * `pj3_demon_bite_loop_large_orange` is. A pitchfork stabs; a sledge and a
 * scythe do not, and they keep what they have.
 *
 * `'thrust'` turns off BOTH — the clip and the tinted wedge it would otherwise
 * fall back to — and turns on the lunge, the jab streak and the tine spark.
 */
export function swingStyleOf(weaponId: string): 'sweep' | 'thrust' {
  return (WEAPONS[weaponId] as { swingStyle?: string } | undefined)?.swingStyle === 'thrust'
    ? 'thrust'
    : 'sweep'
}

/**
 * How far the HELD art lunges forward along its aim as the weapon fires, in
 * world pixels. Zero — the default — leaves the recoil kick exactly as it was.
 *
 * The recoil pulls a gun BACKWARD along its aim, which is what a gun does. A
 * thrust weapon does the opposite, and the difference is the whole animation:
 * without it the pitchfork has no attack pose at all, which was the owner's
 * first complaint and the reason a sword's crescent had been bolted on to
 * stand in for one.
 */
export function carryThrustOf(weaponId: string): number {
  const t = (WEAPONS[weaponId] as { carryThrustPixels?: number } | undefined)?.carryThrustPixels
  return typeof t === 'number' ? t : 0
}

/**
 * How far through its thrust a slot is: 0 at rest, rising to 1 and back to 0.
 *
 * Derived from `slot.firedAt`, the world-tick stamp the sim already writes for
 * the hand slot, and a duration in `tuning.json`. Deliberately NOT new sim
 * state: nothing here can change an outcome, and both painters — the renderer
 * and `tools/draw-world.ts` — read the same function, for the reason
 * `assignCarrySlots` lives in content rather than in the renderer.
 */
export function thrustPhase(firedAt: number, tick: number): number {
  if (firedAt < 0) return 0
  const seconds = (TUNING.carry as { thrustSeconds?: number }).thrustSeconds ?? 0.14
  const since = (tick - firedAt) * STEP
  if (since < 0 || since >= seconds) return 0
  return Math.sin((since / seconds) * Math.PI)
}

/**
 * The anchor for a slot and a facing name (`down`/`up`/`left`/`right`).
 *
 * `classId` picks the class's own version of that anchor where it has one and
 * the shared one where it does not — the Kid's hand is six pixels lower than
 * everyone's, her back is exactly everyone's. Pre-merged; see `CARRY_ANCHORS`.
 */
export function carryAnchorOf(
  slot: CarrySlot, dir: string, classId = '',
): CarryAnchor | undefined {
  return CARRY_ANCHORS[`${slot}|${classId}|${dir}`]
    ?? CARRY_ANCHORS[`${slot}||${dir}`]
    ?? CARRY_ANCHORS[`${slot}||down`]
}

/**
 * Where the muzzle of the HELD weapon is, relative to the player's origin.
 *
 * Written into `out` rather than returned, and `out` is a caller-owned scratch
 * object: this runs on the frame a gun fires and the hot loop allocates
 * nothing.
 *
 * Here, in content, for the same reason `assignCarrySlots` is: the anchors are
 * content, and the alternative was the SIM reaching into the renderer to ask
 * where it had drawn something. The sim owns `aimAngle` and the tick that
 * stamps `firedAt`, so the weapon that is firing is by definition the weapon
 * that will be in his hands on the next frame — the `hand` anchor is the right
 * one without having to run the slot assignment.
 *
 * The geometry: the hand anchor gives the grip; the muzzle is the far end of
 * the art, `1 - carryPivot` of its drawn length forward along the aim. `dy` is
 * from the boots, so `bootOffsetY` converts it back to the origin the sim
 * works in — the same one conversion the painters make.
 *
 * Nothing here is allowed to reach the simulation. It moves a decoration; see
 * `playFx`, which takes no RNG for exactly this reason.
 */
export function carryMuzzleOffset(
  classId: string, weaponId: string, facing: number, aim: number,
  out: { x: number; y: number },
): void {
  const dir = FOUR_WAY[directionIndex(facing, 4)] ?? 'down'
  const a = carryAnchorOf('hand', dir, classId)
  const len = carryHeightOf(weaponId) || CARRY_MUZZLE_FALLBACK
  const reach = len * (1 - carryPivotOf(weaponId))
  out.x = (a?.dx ?? 0) + Math.cos(aim) * reach
  out.y = CARRY.bootOffsetY + (a?.dy ?? 0) + Math.sin(aim) * reach
}

/** How far a weapon with no carried art throws its flash. See tuning.json. */
const CARRY_MUZZLE_FALLBACK =
  (tuningRaw.carry as unknown as { muzzleReachFallback?: number }).muzzleReachFallback ?? 0

/**
 * Decide where every owned weapon is carried this frame.
 *
 * Writes into `out` — one entry per weapon, `null` for the ones that are not
 * carried — rather than returning an array, because this runs once a frame and
 * the hot loop allocates nothing. `out` may be longer than `weapons`; only the
 * first `weapons.length` entries are written.
 *
 * The rules, in order:
 *
 *  1. The weapon that fired most recently is IN HIS HANDS. Ties go to the
 *     lowest index, which is pickup order, which makes the class's starting
 *     weapon the one he holds before a shot has been fired all run.
 *  2. A weapon whose CLASS names a slot for it takes that slot, ahead of
 *     everyone. This pass exists because without it the feature is invisible:
 *     the Veteran's drum gun declares `back`, so does the Varmint Rifle, and
 *     whichever was picked up first won — the Veteran shouldered his rifle only
 *     on the runs where he happened not to own one. A class's own posture is
 *     not a preference to be outranked by pickup order.
 *  3. Everything else claims the slot it declared in weapons.json, in pickup
 *     order. A weapon that finds its slot taken walks forward through
 *     `CARRY.fallbackOrder`, wrapping, to the first free one.
 *  4. `hand` is never a resting destination: it is not in `fallbackOrder` at
 *     all, so a weapon that declares `hand` and is not the active one falls to
 *     the front of the order instead of stacking on the held weapon.
 *
 * Six inventory slots against `hand` plus five anchors means this always fits,
 * so there is no overflow case and nothing is ever dropped.
 */
export function assignCarrySlots(
  weapons: readonly { id: string; firedAt: number }[],
  out: (CarrySlot | null)[],
  classId = '',
): void {
  const order = CARRY.fallbackOrder
  const n = weapons.length

  let hand = -1
  let latest = 0
  for (let i = 0; i < n; i++) {
    if (carrySlotOf(weapons[i].id, classId) === 'none') continue
    if (hand < 0 || weapons[i].firedAt > latest) {
      hand = i
      latest = weapons[i].firedAt
    }
  }

  // A bitmask rather than a scratch array: five anchors, no allocation, and
  // nothing to reset between calls.
  let taken = 0
  for (let i = 0; i < n; i++) out[i] = null

  // The class's own postures claim their slots first. See rule 2.
  const prefs = classId ? CARRY.classSlot?.[classId] : undefined
  if (prefs) {
    for (let i = 0; i < n; i++) {
      if (i === hand || carrySlotOf(weapons[i].id) === 'none') continue
      const pref = prefs[weapons[i].id]
      if (!pref) continue
      const idx = order.indexOf(pref)
      if (idx < 0 || (taken & (1 << idx)) !== 0) continue
      taken |= 1 << idx
      out[i] = pref
    }
  }

  for (let i = 0; i < n; i++) {
    const declared = carrySlotOf(weapons[i].id, classId)
    if (declared === 'none') { out[i] = null; continue }
    if (i === hand) { out[i] = 'hand'; continue }
    if (out[i]) continue
    let start = order.indexOf(declared as CarrySlot)
    if (start < 0) start = 0
    for (let k = 0; k < order.length; k++) {
      const idx = (start + k) % order.length
      if (taken & (1 << idx)) continue
      taken |= 1 << idx
      out[i] = order[idx]
      break
    }
  }
}
