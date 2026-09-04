/**
 * What the Homestead does to a run.
 *
 * Everything here is **derived from purchases at run start** and never stored.
 * That is the whole reason the save holds ranks rather than stat totals: the
 * numbers in `meta.json` are balance, and balance changes.
 *
 * Three of the four tracks make the game *wider* rather than easier. The Seed
 * Catalog is the important one — it puts more of the roster in the pool, so
 * runs get more varied, not stronger. Only the Feed Store is power, and §4 caps
 * its total effect near +25% on purpose.
 */
import { META, WEAPONS, ITEMS, CLASSES } from '../content'
import type { Save } from './save'

interface FeedStoreCfg {
  ranks: number
  totalEffectCapPct: number
  tracks: Record<string, number>
  costCurve: number[]
}
interface TierCfg {
  tier: number
  enemyHpPct: number
  acreMultiplier: number
  modifier: string
}

const FEED = (META as unknown as { feedStore: FeedStoreCfg }).feedStore
const SEED = (META as unknown as {
  seedCatalog: {
    startingWeapons: number
    totalWeapons: number
    startingItems: number
    /** Named opening pools; each falls back to its slice when absent. */
    startingItemIds?: string[]
    startingWeaponIds?: string[]
    totalItems: number
    costRange: [number, number]
  }
}).seedCatalog
const BUNK = (META as unknown as { bunkhouse: { costs: number[]; freeClasses: string[] } }).bunkhouse
const FAIR = (META as unknown as { countyFair: { tiers: TierCfg[] } }).countyFair

/** Ids in content order. The first N of each are what a fresh save starts with. */
const WEAPON_ORDER = Object.keys(WEAPONS)
const ITEM_ORDER = Object.keys(ITEMS)
const CLASS_ORDER = Object.keys(CLASSES)

// ------------------------------------------------------------- the Feed Store

export interface MetaStats {
  maxHp: number
  moveSpeedPct: number
  armor: number
  harvestPct: number
  luck: number
}

export const FEED_TRACKS = Object.keys(FEED.tracks)

/** Cost of the next rank of a track, or null when it is maxed. */
export function feedStoreCost(s: Save, track: string): number | null {
  const owned = s.feedStoreRanks[track] ?? 0
  if (owned >= FEED.ranks) return null
  return FEED.costCurve[owned] ?? FEED.costCurve[FEED.costCurve.length - 1]
}

/**
 * The permanent stat bonus the Feed Store is currently paying out.
 *
 * Flat per rank, matching how the rest of the game stacks: sum flat, sum
 * percentage, apply once. Nothing here multiplies with anything.
 */
export function metaStats(s: Save): MetaStats {
  const per = FEED.tracks
  const rank = (t: string): number => Math.min(FEED.ranks, s.feedStoreRanks[t] ?? 0)
  return {
    maxHp: (per.maxHp ?? 0) * rank('maxHp'),
    moveSpeedPct: (per.moveSpeedPct ?? 0) * rank('moveSpeedPct'),
    armor: (per.armor ?? 0) * rank('armor'),
    harvestPct: (per.harvestPct ?? 0) * rank('harvestPct'),
    luck: (per.luck ?? 0) * rank('luck'),
  }
}

// ---------------------------------------------------------- the Seed Catalog

/**
 * Which weapons and items this save may be offered.
 *
 * A fresh save gets the first N of each in content order, so the opening hours
 * are the designed teaching set rather than a random slice. Everything bought
 * at the Seed Catalog joins permanently.
 */
export function unlockedWeapons(s: Save): string[] {
  const base = startingSet(SEED.startingWeaponIds, WEAPON_ORDER, SEED.startingWeapons, WEAPONS)
  return [...new Set([...base, ...s.unlockedPool.filter((id) => id in WEAPONS)])]
}

/**
 * The named opening set, or the old slice when none is named.
 *
 * An id named here that no longer exists is skipped rather than carried
 * through as a hole in the pool, so a rename cannot quietly shrink the game.
 */
function startingSet(
  named: string[] | undefined, order: string[], n: number, roster: Record<string, unknown>,
): string[] {
  return Array.isArray(named) && named.length > 0
    ? named.filter((id) => id in roster)
    : order.slice(0, n)
}

/**
 * The opening item pool.
 *
 * Named in `meta.json` now, not sliced off the front of `items.json`.
 *
 * The slice was `Object.keys(ITEMS).slice(0, 12)`, and the first twelve keys
 * of that file in authoring order are eleven common stat cards and one
 * uncommon. So a fresh save's whole item pool WAS the eleven percentages, and
 * every board a new player saw was four of them — the exact complaint
 * docs/UPGRADE_ROSTER.md was written to answer, surviving the rebuild
 * untouched and invisible to both harnesses, because neither `balance.ts` nor
 * `offer-stream.ts` calls `setUnlocked` and both therefore measure a pool no
 * new save has. A real run through the browser photographed it at level 6
 * after the offer metrics had already come back clean.
 *
 * An id named here that no longer exists is skipped rather than carried
 * through as a hole in the pool, so a rename cannot quietly shrink the game.
 */
export function unlockedItems(s: Save): string[] {
  const base = startingSet(SEED.startingItemIds, ITEM_ORDER, SEED.startingItems, ITEMS)
  return [...new Set([...base, ...s.unlockedPool.filter((id) => id in ITEMS)])]
}

/** Everything the catalog can still sell, cheapest first. */
export function catalogOffers(s: Save): { id: string; kind: 'weapon' | 'item'; name: string; cost: number }[] {
  const locked: { id: string; kind: 'weapon' | 'item'; name: string; cost: number }[] = []
  const [lo, hi] = SEED.costRange

  const price = (index: number, total: number): number =>
    Math.round(lo + ((hi - lo) * index) / Math.max(1, total - 1))

  /*
     What the catalog sells is EVERYTHING NOT IN THE OPENING SET.

     It used to be `slice(startingN)` -- an index into content order -- which
     only agreed with the opening pool while that pool was also an index into
     content order. Now the opening sets are named, so the slice would have
     sold cards the player already had and hidden ones they did not.
  */
  const openWeapons = new Set(
    startingSet(SEED.startingWeaponIds, WEAPON_ORDER, SEED.startingWeapons, WEAPONS),
  )
  const openItems = new Set(
    startingSet(SEED.startingItemIds, ITEM_ORDER, SEED.startingItems, ITEMS),
  )
  WEAPON_ORDER.filter((id) => !openWeapons.has(id)).forEach((id, i, arr) => {
    if (s.unlockedPool.includes(id)) return
    locked.push({ id, kind: 'weapon', name: WEAPONS[id]?.name ?? id, cost: price(i, arr.length) })
  })
  ITEM_ORDER.filter((id) => !openItems.has(id)).forEach((id, i, arr) => {
    if (s.unlockedPool.includes(id)) return
    locked.push({ id, kind: 'item', name: ITEMS[id]?.name ?? id, cost: price(i, arr.length) })
  })
  return locked.sort((a, b) => a.cost - b.cost)
}

// ------------------------------------------------------------- the Bunkhouse

export function isClassUnlocked(s: Save, id: string): boolean {
  return BUNK.freeClasses.includes(id) || s.unlockedClasses.includes(id)
}

export function unlockedClasses(s: Save): string[] {
  return CLASS_ORDER.filter((id) => isClassUnlocked(s, id))
}

/**
 * The Bunkhouse's locked classes, priced in purchase order.
 *
 * Cost comes from the player's position in the ladder, not from which class it
 * is: the fourth class costs the fourth price whichever one you pick, so there
 * is no wrong order to buy them in.
 */
export function bunkhouseOffers(s: Save): { id: string; name: string; cost: number }[] {
  const bought = s.unlockedClasses.length
  return CLASS_ORDER
    .filter((id) => !isClassUnlocked(s, id))
    .map((id, i) => ({
      id,
      name: (CLASSES[id] as { name?: string })?.name ?? id,
      cost: BUNK.costs[Math.min(BUNK.costs.length - 1, bought + i)],
    }))
}

// ------------------------------------------------------------ the County Fair

/** Highest tier the player may select. Tier 1 is always available. */
export function maxTier(s: Save): number {
  return Math.max(1, Math.min(FAIR.tiers.length + 1, s.tierCleared + 1))
}

export function tierConfig(tier: number): TierCfg | null {
  return FAIR.tiers.find((t) => t.tier === tier) ?? null
}

/** Enemy HP multiplier for a tier. Tier 1 is 1. */
export function tierHpMultiplier(tier: number): number {
  const cfg = tierConfig(tier)
  return cfg ? 1 + cfg.enemyHpPct / 100 : 1
}

export function tierAcreMultiplier(tier: number): number {
  return tierConfig(tier)?.acreMultiplier ?? 1
}

/** The one-line rule a tier adds, for the class picker and the pause screen. */
export function tierModifier(tier: number): string | null {
  return tierConfig(tier)?.modifier ?? null
}

// ----------------------------------------------------------------- payout

export interface RunResult {
  wavesCleared: number
  bossKills: number
  tier: number
  cleared: boolean
}

/**
 * Bank a finished run: acres in, first-clear bonuses paid once, best run kept.
 *
 * Returns the acres awarded so the results screen can show the same number that
 * was actually banked, rather than recomputing it and risking the two drifting.
 */
export function bankRun(s: Save, r: RunResult, seed: number, classId: string): number {
  const acres = (META as unknown as { acres: { perWaveCleared: number; perBossKill: number; firstTimeThisTier: number } }).acres
  const firstTime = !s.tiersPaid.includes(r.tier)
  const base = acres.perWaveCleared * r.wavesCleared
    + acres.perBossKill * r.bossKills
    + (firstTime && r.cleared ? acres.firstTimeThisTier : 0)
  const earned = Math.round(base * tierAcreMultiplier(r.tier))

  s.acres += earned
  if (firstTime && r.cleared) s.tiersPaid = [...s.tiersPaid, r.tier]
  if (r.cleared && r.tier > s.tierCleared) s.tierCleared = r.tier
  if (!s.bestRun || r.wavesCleared > s.bestRun.wave) {
    s.bestRun = { wave: r.wavesCleared, seed, classId, tier: r.tier }
  }
  return earned
}

/** Spend, if affordable. Returns whether the purchase happened. */
export function spend(s: Save, cost: number): boolean {
  if (s.acres < cost) return false
  s.acres -= cost
  return true
}
