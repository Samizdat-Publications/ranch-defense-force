/**
 * The Homestead's rules.
 *
 * Meta progression is the one system where a bug is silent and permanent: a
 * miscounted payout or a bonus paid twice does not crash, it just quietly
 * ruins the economy across every future run, and the save keeps the damage.
 */
import { describe, it, expect } from 'vitest'
import { emptySave, type Save } from '../src/sim/save'
import {
  metaStats, unlockedWeapons, unlockedItems, catalogOffers, bunkhouseOffers,
  isClassUnlocked, maxTier, tierHpMultiplier, tierAcreMultiplier, bankRun, spend,
  feedStoreCost, FEED_TRACKS,
} from '../src/sim/meta'
import { META, WEAPONS, ITEMS } from '../src/content'

const FEED = META.feedStore as unknown as {
  ranks: number
  totalEffectCapPct: number
  tracks: Record<string, number>
}

function maxed(): Save {
  const s = emptySave()
  for (const t of FEED_TRACKS) s.feedStoreRanks[t] = FEED.ranks
  return s
}

describe('the Feed Store', () => {
  it('gives nothing on a fresh save', () => {
    const m = metaStats(emptySave())
    expect(Object.values(m).every((v) => v === 0)).toBe(true)
  })

  /**
   * §4: "Total effect at full purchase must land near +25% and no further."
   * The percentage tracks are the ones that can run away, so they are the ones
   * checked against the cap.
   */
  it('caps its total percentage effect where the design says', () => {
    const m = metaStats(maxed())
    const pct = m.moveSpeedPct + m.harvestPct
    expect(pct).toBeLessThanOrEqual(FEED.totalEffectCapPct + 1)
  })

  it('never sells more ranks than exist', () => {
    const s = maxed()
    for (const t of FEED_TRACKS) expect(feedStoreCost(s, t)).toBeNull()
  })

  it('clamps a save that claims more ranks than exist', () => {
    const s = emptySave()
    s.feedStoreRanks.maxHp = 999
    // metaStats clamps rather than trusting the blob; a hand-edited save must
    // not be able to mint stats.
    expect(metaStats(s).maxHp).toBe(FEED.tracks.maxHp * FEED.ranks)
  })
})

describe('the Seed Catalog', () => {
  it('starts a fresh save with the designed teaching set, not everything', () => {
    const s = emptySave()
    const w = unlockedWeapons(s)
    const i = unlockedItems(s)
    expect(w.length).toBeLessThan(Object.keys(WEAPONS).length)
    expect(i.length).toBeLessThan(Object.keys(ITEMS).length)
    expect(w.length).toBe(META.seedCatalog.startingWeapons)
  })

  it('offers exactly what is still locked, and stops offering it once bought', () => {
    const s = emptySave()
    const before = catalogOffers(s)
    expect(before.length).toBeGreaterThan(0)
    s.unlockedPool.push(before[0].id)
    const after = catalogOffers(s)
    expect(after.find((o) => o.id === before[0].id)).toBeUndefined()
    expect(after.length).toBe(before.length - 1)
  })

  it('puts a bought weapon into the run pool', () => {
    const s = emptySave()
    const locked = catalogOffers(s).find((o) => o.kind === 'weapon')
    if (!locked) return
    expect(unlockedWeapons(s)).not.toContain(locked.id)
    s.unlockedPool.push(locked.id)
    expect(unlockedWeapons(s)).toContain(locked.id)
  })

  it('prices everything inside the range the design gives', () => {
    const [lo, hi] = META.seedCatalog.costRange as unknown as [number, number]
    for (const o of catalogOffers(emptySave())) {
      expect(o.cost).toBeGreaterThanOrEqual(lo)
      expect(o.cost).toBeLessThanOrEqual(hi)
    }
  })
})

describe('the Bunkhouse', () => {
  it('gives the free classes away and charges for nothing else yet', () => {
    const s = emptySave()
    for (const id of META.bunkhouse.freeClasses as unknown as string[]) {
      expect(isClassUnlocked(s, id)).toBe(true)
    }
    // Every class currently shipped is free, so there is nothing to sell. The
    // test asserts the shape holds rather than that the list is non-empty.
    expect(bunkhouseOffers(s).every((o) => o.cost > 0)).toBe(true)
  })
})

describe('the County Fair', () => {
  it('starts at tier 1 and opens one tier at a time', () => {
    const s = emptySave()
    expect(maxTier(s)).toBe(1)
    s.tierCleared = 1
    expect(maxTier(s)).toBe(2)
  })

  it('scales enemy hp and the payout together, so climbing beats farming', () => {
    expect(tierHpMultiplier(1)).toBe(1)
    expect(tierHpMultiplier(2)).toBeGreaterThan(1)
    expect(tierAcreMultiplier(2)).toBeGreaterThan(tierAcreMultiplier(1))
    expect(tierAcreMultiplier(3)).toBeGreaterThan(tierAcreMultiplier(2))
  })
})

describe('banking a run', () => {
  it('pays per wave and per boss', () => {
    const s = emptySave()
    const a = bankRun(s, { wavesCleared: 5, bossKills: 0, tier: 1, cleared: false }, 1, 'hand')
    const acres = META.acres as unknown as { perWaveCleared: number; perBossKill: number }
    expect(a).toBe(acres.perWaveCleared * 5)
    const b = bankRun(s, { wavesCleared: 5, bossKills: 1, tier: 1, cleared: false }, 1, 'hand')
    expect(b).toBe(acres.perWaveCleared * 5 + acres.perBossKill)
  })

  /**
   * The bug this guards is the reason `tiersPaid` exists at all: deriving
   * "first time" from `tierCleared` re-paid the bonus on every subsequent
   * clear, which is free acres forever.
   */
  it('pays the first-clear bonus exactly once per tier', () => {
    const s = emptySave()
    const first = bankRun(s, { wavesCleared: 24, bossKills: 2, tier: 1, cleared: true }, 1, 'hand')
    const again = bankRun(s, { wavesCleared: 24, bossKills: 2, tier: 1, cleared: true }, 1, 'hand')
    expect(first).toBeGreaterThan(again)
    expect(s.tiersPaid).toEqual([1])
  })

  it('does not pay a first-clear bonus for a run that died', () => {
    const s = emptySave()
    bankRun(s, { wavesCleared: 10, bossKills: 0, tier: 1, cleared: false }, 1, 'hand')
    expect(s.tiersPaid).toEqual([])
    expect(s.tierCleared).toBe(0)
  })

  it('multiplies the payout by the tier', () => {
    const one = emptySave()
    const three = emptySave()
    const a = bankRun(one, { wavesCleared: 10, bossKills: 0, tier: 1, cleared: false }, 1, 'hand')
    const b = bankRun(three, { wavesCleared: 10, bossKills: 0, tier: 3, cleared: false }, 1, 'hand')
    expect(b).toBeGreaterThan(a)
  })

  it('keeps the best run by wave', () => {
    const s = emptySave()
    bankRun(s, { wavesCleared: 12, bossKills: 0, tier: 1, cleared: false }, 7, 'hand')
    bankRun(s, { wavesCleared: 4, bossKills: 0, tier: 1, cleared: false }, 8, 'kid')
    expect(s.bestRun?.wave).toBe(12)
    expect(s.bestRun?.seed).toBe(7)
  })
})

describe('spending', () => {
  it('refuses what cannot be afforded and leaves the balance alone', () => {
    const s = emptySave()
    s.acres = 10
    expect(spend(s, 40)).toBe(false)
    expect(s.acres).toBe(10)
    expect(spend(s, 10)).toBe(true)
    expect(s.acres).toBe(0)
  })
})
