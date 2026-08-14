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
import tuningRaw from './tuning.json'
import nodesRaw from './nodes.json'
import elementsRaw from './elements.json'
import audioRaw from './audio.json'

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
}

export type WeaponType = 'melee' | 'ranged' | 'orbit' | 'aura' | 'utility' | 'minion'

export interface WeaponDef {
  name: string
  type: WeaponType
  sprite: string
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
  rarity?: 'common' | 'uncommon' | 'rare'
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
