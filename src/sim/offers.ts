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
import { ITEMS, RARITY, WEAPONS, type ItemDef, type StatMods, type WeaponDef } from '../content'
import type { Rng } from '../core/rng'
import type { Player } from './player'

export type OfferKind = 'weapon' | 'item'
/**
 * Five tiers, rarest last. Every offer carries one — there is no unrated card.
 *
 * The weights and the per-tier colour live in `src/content/rarity.json`, not
 * here: a rarity is a balance knob and a visual language at the same time, and
 * both belong in content where they can be tuned without a rebuild of meaning.
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** Where an offer may appear. Shop-only is how the shop gets to be special. */
export type OfferSource = 'levelup' | 'shop' | 'both'

/**
 * How likely a tier is to be drawn, before the recency penalty.
 *
 * Both numbers come from `rarity.json`: the base weight, and how hard a point
 * of luck pushes toward this tier. Luck therefore makes good cards likelier
 * without ever making commons impossible, which is what keeps a luck build a
 * build rather than a different game.
 */
export function rarityWeight(rarity: Rarity, luck: number): number {
  const tier = RARITY[rarity] ?? RARITY.common
  return tier.weight * (1 + (luck / 100) * tier.luckScaling)
}

export interface Offer {
  kind: OfferKind
  id: string
  name: string
  /** What the card says it does. */
  detail: string
  /** Atlas frame key to show on the card, if this offer has art. */
  sprite?: string
  cost: number
  rarity: Rarity
  /** Stat changes, for the delta line. Empty for behavioural weapons. */
  mods: StatMods
  /** Set when taking this would merge an owned weapon up a tier. */
  mergesTo: number | null
  /** Doubled magnitude. The level-up screen always has exactly one, and it is
   *  always the uncommon-or-better card — so the choice is a smaller boost to
   *  the stat you want against a double boost to one you want less. */
  boosted: boolean
  /** Tiers a weapon merge jumps: 2 when boosted, 1 otherwise. */
  tierJump: number
  locked?: boolean
}

export type DrawMode = 'levelup' | 'shop'

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
  draw(
    player: Player,
    count: number,
    now: number,
    luck: number,
    mode: DrawMode = 'shop',
  ): Offer[] {
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
      // Shop-only items are the reason a shop visit is worth stopping for: the
      // level-up hands you what the run offers, the shop is where the run's
      // best cards live and you pay feed for them.
      const source = def.source ?? 'both'
      if (source !== 'both' && source !== mode) continue
      candidates.push(this.itemOffer(id, def))
    }

    if (candidates.length === 0) return []
    if (mode === 'levelup') return this.drawLevelUp(candidates, count, now, luck)

    const weights = candidates.map((o) => {
      const last = this.recentlyOffered.get(o.id)
      // Suppressed rather than banned: with a thin pool late in a run, a hard
      // ban would leave the shop with nothing to show.
      const suppressed = last !== undefined && now - last < MEMORY_SECONDS ? 0.15 : 1
      return suppressed * rarityWeight(o.rarity, luck)
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

    this.guaranteeOneAboveCommon(candidates, taken, picked, luck)
    for (const offer of picked) this.recentlyOffered.set(offer.id, now)
    return picked
  }

  /**
   * The level-up screen: exactly one uncommon-or-better card at **double**
   * magnitude, the rest common at normal magnitude.
   *
   * The point is the decision it forces. The boosted card is rarely the stat
   * you were hoping for, so every level-up asks whether you want a small step
   * toward the build you are aiming at, or a large step somewhere else. When
   * the boosted card *is* what you wanted, that is the good roll.
   *
   * Doubling is level-up only. The shop is where you go to buy exactly what
   * you need, and it charges you for the privilege; handing out doubles there
   * too would flatten the difference between the two systems.
   */
  private drawLevelUp(candidates: Offer[], count: number, now: number, luck: number): Offer[] {
    const commonIdx: number[] = []
    const betterIdx: number[] = []
    candidates.forEach((o, i) => (o.rarity === 'common' ? commonIdx : betterIdx).push(i))

    const picked: Offer[] = []
    const taken = new Set<number>()

    const weightFor = (i: number): number => {
      const o = candidates[i]
      const last = this.recentlyOffered.get(o.id)
      const suppressed = last !== undefined && now - last < MEMORY_SECONDS ? 0.15 : 1
      const rare = rarityWeight(o.rarity, luck) / RARITY.common.weight
      return suppressed * rare
    }

    // The boosted slot first, so a thin pool spends what it has on the card
    // that matters most.
    if (betterIdx.length > 0) {
      const w = betterIdx.map(weightFor)
      const chosen = betterIdx[this.rng.weightedIndex(w)]
      taken.add(chosen)
      picked.push(boost(candidates[chosen]))
    }

    const pool = commonIdx.length > 0 ? commonIdx : candidates.map((_, i) => i)
    let guard = 0
    while (picked.length < Math.min(count, candidates.length) && guard++ < 200) {
      const available = pool.filter((i) => !taken.has(i))
      if (available.length === 0) break
      const chosen = available[this.rng.weightedIndex(available.map(weightFor))]
      taken.add(chosen)
      picked.push(candidates[chosen])
    }

    for (const o of picked) this.recentlyOffered.set(o.id, now)
    // Shuffle so the boosted card is not always in slot 1 — it should have to
    // be read for, not learned by position.
    return this.rng.shuffle(picked)
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
    luck: number,
  ): void {
    if (picked.length === 0) return
    if (picked.some((o) => o.rarity !== 'common')) return

    const upgradeWeights = candidates.map((o, i) =>
      o.rarity !== 'common' && !taken.has(i) ? rarityWeight(o.rarity, luck) : 0,
    )
    if (upgradeWeights.every((w) => w === 0)) return // pool has nothing better

    const idx = this.rng.weightedIndex(upgradeWeights)
    picked[picked.length - 1] = candidates[idx]
  }

  private weaponOffer(id: string, def: WeaponDef, player: Player): Offer {
    const slot = player.weapons.find((w) => w.id === id)
    const nextTier = slot ? slot.tier + 1 : null
    // A new weapon leads with what it DOES; the numbers are the second line.
    // Leading with numbers produced "utility · 0 damage / 6s" for the Bait
    // Drum, which is a card nobody would ever pick and says nothing about the
    // fact that it gathers the crowd for everything else you own.
    const stats = `${def.type} · ${def.base > 0 ? `${def.base} damage` : 'no damage'}` +
      `${def.cooldown > 0 ? ` / ${def.cooldown}s` : ''}`
    const detail = nextTier
      ? `Tier ${nextTier}: ${def.tiers[String(nextTier)] ?? 'stronger'} (+60% damage)`
      : typeof def.blurb === 'string' ? `${def.blurb}
${stats}` : stats
    // A weapon's rarity is its tier: merging is the offensive game, and a
    // merge into tier 4 is the rarest thing the pool can hand you.
    // A weapon's rarity is its tier: merging is the offensive game, so a merge
    // into tier 4 should read as the rarest thing the pool can hand you.
    const rarity: Rarity = nextTier === null
      ? 'common'
      : nextTier >= 4 ? 'legendary' : nextTier === 3 ? 'epic' : 'uncommon'
    const tierSprites = Array.isArray(def.tierSprites) ? (def.tierSprites as string[]) : null
    return {
      kind: 'weapon',
      id,
      name: def.name,
      detail,
      sprite: tierSprites?.[Math.min(nextTier ?? 1, 4) - 1]
        ?? (typeof def.sprite === 'string' ? def.sprite : undefined),
      cost: nextTier ? 14 + nextTier * 8 : 20,
      rarity,
      mods: {},
      mergesTo: nextTier,
      boosted: false,
      tierJump: 1,
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
      // Elements and tool upgrades have real art; ordinary stat items do not,
      // and a card without a sprite simply shows no sprite.
      sprite: typeof def.cardSprite === 'string' ? def.cardSprite : undefined,
      cost: def.cost,
      rarity,
      mods,
      mergesTo: null,
      boosted: false,
      tierJump: 1,
    }
  }
}

/** Double an offer's magnitude for the level-up screen's guaranteed slot. */
function boost(offer: Offer): Offer {
  const mods: StatMods = {}
  for (const [k, v] of Object.entries(offer.mods)) {
    mods[k as keyof StatMods] = (v as number) * 2
  }
  const doubledDetail = offer.kind === 'item'
    ? describeMods(mods) || offer.detail
    : offer.mergesTo !== null
      ? `Tier ${Math.min(4, offer.mergesTo + 1)} — jumps two tiers`
      : offer.detail
  return {
    ...offer,
    mods,
    boosted: true,
    tierJump: 2,
    detail: doubledDetail,
    // Cost is untouched: the doubling is the reward for the rarity roll, not
    // something the player pays extra for.
  }
}

const PCT_KEYS = new Set([
  'moveSpeedPct', 'pickupRadiusPct', 'harvestPct', 'damagePct', 'meleePct',
  'rangedPct', 'attackSpeedPct', 'critChancePct', 'critDamagePct', 'rangePct',
  'dodgePct', 'lifestealPct',
])

export function describeMods(mods: StatMods): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(mods)) {
    const v = value as number
    const sign = v >= 0 ? '+' : ''
    parts.push(`${sign}${v}${PCT_KEYS.has(key) ? '%' : ''} ${humanKey(key)}`)
  }
  return parts.join(' · ')
}

export function describeItem(def: ItemDef): string {
  const parts: string[] = []
  // An item whose whole effect is behavioural — an element, a tool tier — has
  // no stat mods to describe, and was rendering a completely blank card. The
  // blurb IS the description for those.
  if (typeof def.blurb === 'string') parts.push(def.blurb)
  const base = describeMods(def.mods ?? {})
  if (base) parts.push(base)
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
