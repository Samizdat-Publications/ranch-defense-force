/**
 * The upgrade pool. Level-ups and the shop draw from **exactly the same pool**
 * (§3) — the difference is agency and cost, not contents. A level-up is free,
 * fast and random; the shop is slow and paid but rerollable and lockable, which
 * is what makes it the place you go hunting for the item that finishes a build.
 *
 * §14 flags a known risk: a shop can offer what a level-up just gave you. The
 * fix, if it feels bad in play, is the short memory implemented here as
 * `recentlyOffered` — not two separate pools.
 */
import { ITEMS, WEAPONS, type ItemDef, type StatMods, type WeaponDef } from '../content'
import type { Rng } from '../core/rng'
import type { Player } from './player'

export type OfferKind = 'weapon' | 'item'
export type Rarity = 'common' | 'uncommon' | 'rare'

export interface Offer {
  kind: OfferKind
  id: string
  name: string
  /** What the card says it does. */
  detail: string
  cost: number
  rarity: Rarity
  /** Stat changes, for the delta line. Empty for behavioural weapons. */
  mods: StatMods
  /** Set when taking this would merge an owned weapon up a tier. */
  mergesTo: number | null
  locked?: boolean
}

/** Seconds an offered id stays suppressed from later draws. */
const MEMORY_SECONDS = 90

export class OfferPool {
  /** id -> game time it was last offered. */
  private readonly recentlyOffered = new Map<string, number>()
  /** Ids unlocked via the Homestead's Seed Catalog; empty means "all". */
  private unlocked: Set<string> | null = null

  constructor(private readonly rng: Rng) {}

  setUnlocked(ids: readonly string[] | null): void {
    this.unlocked = ids && ids.length > 0 ? new Set(ids) : null
  }

  private isAvailable(id: string): boolean {
    return this.unlocked === null || this.unlocked.has(id)
  }

  /**
   * Draw `count` distinct offers. `now` is world elapsed seconds, used for the
   * short memory. Luck widens the draw slightly toward rarer entries.
   */
  draw(player: Player, count: number, now: number, luck: number): Offer[] {
    const candidates: Offer[] = []

    for (const [id, def] of Object.entries(WEAPONS) as [string, WeaponDef][]) {
      if (!this.isAvailable(id)) continue
      const owned = player.hasWeapon(id)
      // A weapon you can neither take nor merge is not an offer.
      if (owned && player.weaponAtMaxTier(id)) continue
      if (!owned && player.slotsFull) continue
      candidates.push(this.weaponOffer(id, def, player))
    }

    for (const [id, def] of Object.entries(ITEMS) as [string, ItemDef][]) {
      if (!this.isAvailable(id)) continue
      candidates.push(this.itemOffer(id, def))
    }

    if (candidates.length === 0) return []

    const weights = candidates.map((o) => {
      const last = this.recentlyOffered.get(o.id)
      // Suppressed rather than banned: with a thin pool late in a run, a hard
      // ban would leave the shop with nothing to show.
      const suppressed = last !== undefined && now - last < MEMORY_SECONDS ? 0.15 : 1
      const rarityWeight = o.rarity === 'rare' ? 0.4 : o.rarity === 'uncommon' ? 0.8 : 1
      const luckBonus = o.rarity === 'common' ? 1 : 1 + luck / 100
      return suppressed * rarityWeight * luckBonus
    })

    const picked: Offer[] = []
    const taken = new Set<number>()
    const want = Math.min(count, candidates.length)
    let guard = 0
    while (picked.length < want && guard++ < 200) {
      const idx = this.rng.weightedIndex(weights)
      if (taken.has(idx)) {
        weights[idx] = 0
        continue
      }
      taken.add(idx)
      weights[idx] = 0
      picked.push(candidates[idx])
    }

    this.guaranteeOneAboveCommon(candidates, taken, picked)
    for (const offer of picked) this.recentlyOffered.set(offer.id, now)
    return picked
  }

  /**
   * Every set of cards contains at least one uncommon or better.
   *
   * Without this a level-up can be three pieces of chaff, which is the worst
   * moment in a run: the game stops, asks you to choose, and none of the
   * choices matter. Replaces the last pick rather than adding a card, so the
   * count the caller asked for is what it gets.
   */
  private guaranteeOneAboveCommon(
    candidates: readonly Offer[],
    taken: Set<number>,
    picked: Offer[],
  ): void {
    if (picked.length === 0) return
    if (picked.some((o) => o.rarity !== 'common')) return

    const upgradeWeights = candidates.map((o, i) =>
      o.rarity !== 'common' && !taken.has(i) ? (o.rarity === 'rare' ? 0.5 : 1) : 0,
    )
    if (upgradeWeights.every((w) => w === 0)) return // pool has nothing better

    const idx = this.rng.weightedIndex(upgradeWeights)
    picked[picked.length - 1] = candidates[idx]
  }

  private weaponOffer(id: string, def: WeaponDef, player: Player): Offer {
    const slot = player.weapons.find((w) => w.id === id)
    const nextTier = slot ? slot.tier + 1 : null
    const detail = nextTier
      ? `Tier ${nextTier}: ${def.tiers[String(nextTier)] ?? 'stronger'} (+60% damage)`
      : `${def.type} · ${def.base} damage${def.cooldown > 0 ? ` / ${def.cooldown}s` : ''}`
    // A weapon's rarity is its tier: merging is the offensive game, and a
    // merge into tier 4 is the rarest thing the pool can hand you.
    const rarity: Rarity = nextTier === null ? 'common' : nextTier >= 4 ? 'rare' : 'uncommon'
    return {
      kind: 'weapon',
      id,
      name: def.name,
      detail,
      cost: nextTier ? 14 + nextTier * 8 : 20,
      rarity,
      mods: {},
      mergesTo: nextTier,
    }
  }

  private itemOffer(id: string, def: ItemDef): Offer {
    const mods = def.mods ?? {}
    // Rarity is declared in items.json. The old heuristic (special = rare,
    // multi-stat = uncommon) is kept only as a fallback for an item that has
    // not been given one yet.
    const rarity: Rarity = def.rarity
      ?? (def.special ? 'rare' : Object.keys(mods).length > 1 ? 'uncommon' : 'common')
    return {
      kind: 'item',
      id,
      name: def.name,
      detail: describeItem(def),
      cost: def.cost,
      rarity,
      mods,
      mergesTo: null,
    }
  }
}

const PCT_KEYS = new Set([
  'moveSpeedPct', 'pickupRadiusPct', 'harvestPct', 'damagePct', 'meleePct',
  'rangedPct', 'attackSpeedPct', 'critChancePct', 'critDamagePct', 'rangePct',
  'dodgePct', 'lifestealPct',
])

export function describeItem(def: ItemDef): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(def.mods ?? {})) {
    const v = value as number
    const sign = v >= 0 ? '+' : ''
    parts.push(`${sign}${v}${PCT_KEYS.has(key) ? '%' : ''} ${humanKey(key)}`)
  }
  if (def.special === 'reflect') parts.push(`reflects ${def.reflectDamage} to attackers`)
  if (def.special === 'auraDamageReduction') {
    parts.push(`enemies within ${def.radius}px deal ${def.reductionPct}% less`)
  }
  if (def.special === 'gasGrace') parts.push(`immune to gas for ${def.graceSeconds}s of contact`)
  return parts.join(' · ')
}

function humanKey(key: string): string {
  return key
    .replace(/Pct$/, '')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim()
}
