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

export const CLASSES = classesRaw as unknown as Record<string, ClassDef>
export const WEAPONS = weaponsRaw as unknown as Record<string, WeaponDef>
export const ITEMS = itemsRaw as unknown as Record<string, ItemDef>

// enemies.json carries the bosses under a `_bosses` key; split them out so the
// spawner never has to filter a magic key out of the roster.
const { _bosses, ...enemyRest } = enemiesRaw as unknown as Record<string, unknown>
export const ENEMIES = enemyRest as unknown as Record<string, EnemyDef>
export const BOSSES = (_bosses ?? {}) as Record<string, Record<string, unknown>>

export const WAVES = wavesRaw
export const META = metaRaw
export const TUNING = tuningRaw

export const CLASS_IDS = Object.keys(CLASSES)
export const WEAPON_IDS = Object.keys(WEAPONS)
export const ITEM_IDS = Object.keys(ITEMS)
export const ENEMY_IDS = Object.keys(ENEMIES)
