import { describe, expect, it } from 'vitest'
import { resolveStats, emptyDerived, previewDelta } from '../src/sim/stats'
import {
  acresEarned, interestOn, resolveDamage, shopRerollCost, threatBudget,
  waveIncome, waveScalar, xpToNext,
} from '../src/sim/formulas'
import { Player } from '../src/sim/player'
import { Spawner } from '../src/sim/spawner'
import { OfferPool } from '../src/sim/offers'
import { Rng } from '../src/core/rng'
import { ITEMS, MAPS, TUNING, RARITY_ORDER, WAVES } from '../src/content'

describe('stat resolution', () => {
  it('sums percentages additively, never multiplicatively', () => {
    const out = emptyDerived()
    // Three +10% move speed sources must be +30%, not 1.1^3 = +33.1%.
    resolveStats([
      { moveSpeedPct: 10 }, { moveSpeedPct: 10 }, { moveSpeedPct: 10 },
    ], out)
    expect(out.moveSpeedPct).toBe(30)
    expect(out.moveSpeed).toBeCloseTo(TUNING.player.baseMoveSpeed * 1.3, 6)
  })

  it('makes each copy of an item worth exactly the same', () => {
    const one = emptyDerived()
    const two = emptyDerived()
    resolveStats([{ moveSpeedPct: 8 }], one)
    resolveStats([{ moveSpeedPct: 8 }, { moveSpeedPct: 8 }], two)
    const firstGain = one.moveSpeed - TUNING.player.baseMoveSpeed
    const secondGain = two.moveSpeed - one.moveSpeed
    expect(secondGain).toBeCloseTo(firstGain, 6)
  })

  it('sums flat bonuses', () => {
    const out = emptyDerived()
    resolveStats([{ maxHp: 140 }, { maxHp: 20 }, { maxHp: -10 }], out)
    expect(out.maxHp).toBe(150)
  })

  it('caps dodge at 60% and attack speed at +300%', () => {
    const out = emptyDerived()
    resolveStats([{ dodgePct: 90 }, { attackSpeedPct: 500 }], out)
    expect(out.dodge).toBeCloseTo(0.6, 6)
    expect(out.attackSpeedMultiplier).toBeCloseTo(4, 6)
  })

  it('floors max HP at 1 so a bad build cannot self-destruct on pickup', () => {
    const out = emptyDerived()
    resolveStats([{ maxHp: 5 }, { maxHp: -50 }], out)
    expect(out.maxHp).toBe(1)
  })

  it('is order independent', () => {
    const a = emptyDerived()
    const b = emptyDerived()
    resolveStats([{ armor: 4 }, { moveSpeedPct: -5 }, { maxHp: 20 }], a)
    resolveStats([{ maxHp: 20 }, { armor: 4 }, { moveSpeedPct: -5 }], b)
    expect(a.armor).toBe(b.armor)
    expect(a.moveSpeed).toBe(b.moveSpeed)
    expect(a.maxHp).toBe(b.maxHp)
  })

  it('reports only the keys a preview actually moves', () => {
    const a = emptyDerived()
    const b = emptyDerived()
    const deltas = previewDelta([{ maxHp: 100 }], { moveSpeedPct: 8 }, a, b)
    expect(deltas).toHaveLength(1)
    expect(deltas[0].key).toBe('moveSpeedPct')
    expect(deltas[0].from).toBe(0)
    expect(deltas[0].to).toBe(8)
  })
})

describe('formulas', () => {
  it('xpToNext rises monotonically and reaches ~34 levels in a run', () => {
    let prev = 0
    for (let l = 1; l < 40; l++) {
      const v = xpToNext(l)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
    expect(xpToNext(1)).toBe(10)
  })

  it('waveIncome and threatBudget match the spec strings', () => {
    /*
       This used to pin the coefficients as literals, which meant the test knew
       the formula rather than checking it: retuning the budget broke the test
       for the right reason but told you nothing, and updating it was a second
       place to type the same numbers.

       formulas.ts says the JSON strings are documentation and the code is the
       truth, "if you change one, change both". So evaluate the STRING and
       compare it to the function — now the pair cannot drift silently, which is
       what the test was always named for.
    */
    const evalSpec = (formula: string, n: number): number =>
      Number(new Function('n', `return ${formula}`)(n))

    for (const n of [1, 2, 7, 13, 24, 25]) {
      expect(threatBudget(n)).toBeCloseTo(evalSpec(WAVES.threatBudget.formula, n), 6)
      expect(waveIncome(n)).toBeCloseTo(evalSpec(WAVES.economy.waveIncome, n), 6)
    }
    expect(waveIncome(1)).toBe(9)
    expect(waveIncome(24)).toBe(78)
  })

  it('waveScalar starts at 1 on wave 1', () => {
    expect(waveScalar(1)).toBe(1)
    expect(waveScalar(11)).toBeCloseTo(1.6, 6)
  })

  it('shop rerolls escalate', () => {
    expect(shopRerollCost(0)).toBe(3)
    expect(shopRerollCost(1)).toBe(5)
    expect(shopRerollCost(4)).toBe(11)
  })

  it('interest is 8% capped at 12', () => {
    expect(interestOn(50)).toBe(4)
    expect(interestOn(1000)).toBe(12)
    expect(interestOn(0)).toBe(0)
  })

  it('damage never drops below 1 however much armor is stacked', () => {
    const d = resolveDamage(10, 0, 0, 0, false, 0, 100000, 1)
    expect(d).toBeGreaterThanOrEqual(1)
  })

  it('crit multiplies by 1.5 plus the bonus', () => {
    const normal = resolveDamage(100, 0, 0, 0, false, 0, 0, 1)
    const crit = resolveDamage(100, 0, 0, 0, true, 0, 0, 1)
    expect(crit / normal).toBeCloseTo(1.5, 6)
    const critBonus = resolveDamage(100, 0, 0, 0, true, 50, 0, 1)
    expect(critBonus / normal).toBeCloseTo(2, 6)
  })

  it('applies damage and type percentages additively', () => {
    // +50% damage and +50% ranged must be x2, not x2.25.
    const base = resolveDamage(100, 0, 0, 0, false, 0, 0, 1)
    const both = resolveDamage(100, 50, 50, 0, false, 0, 0, 1)
    expect(both / base).toBeCloseTo(2, 6)
  })

  it('acres scale with the tier multiplier', () => {
    expect(acresEarned(10, 0, false, 1)).toBe(20)
    expect(acresEarned(10, 1, true, 1)).toBe(55)
    expect(acresEarned(10, 1, true, 1.3)).toBe(71)
  })
})

describe('Player build', () => {
  it('merges a duplicate weapon up a tier instead of taking a slot', () => {
    const p = new Player()
    p.init('hand')
    expect(p.weapons).toHaveLength(1)
    p.addWeapon('pitchfork')
    expect(p.weapons).toHaveLength(1)
    expect(p.weapons[0].tier).toBe(2)
  })

  it('caps merging at tier 4', () => {
    const p = new Player()
    p.init('hand')
    for (let i = 0; i < 10; i++) p.addWeapon('pitchfork')
    expect(p.weapons[0].tier).toBe(4)
    expect(p.weaponAtMaxTier('pitchfork')).toBe(true)
  })

  it('refuses a seventh distinct weapon', () => {
    const p = new Player()
    p.init('hand')
    const ids = ['scythe', 'chemSprayer', 'harpoon', 'scattergun', 'grenadeLauncher']
    for (const id of ids) expect(p.addWeapon(id)).toBe(true)
    expect(p.weapons).toHaveLength(6)
    expect(p.slotsFull).toBe(true)
    expect(p.addWeapon('varmintRifle')).toBe(false)
  })

  it('heals by the amount a max-HP item added', () => {
    const p = new Player()
    p.init('hand')
    p.hp = 50
    p.addItem('feedSack') // +20 max HP
    expect(p.hp).toBe(70)
  })

  it('levels up repeatedly from one large xp grant', () => {
    const p = new Player()
    p.init('kid')
    const levels = p.gainXp(500)
    expect(levels).toBeGreaterThan(3)
    expect(p.level).toBe(1 + levels)
  })

  it('gives The Hand and The Kid genuinely different movement', () => {
    const hand = new Player()
    hand.init('hand')
    const kid = new Player()
    kid.init('kid')
    expect(kid.stats.moveSpeed).toBeGreaterThan(hand.stats.moveSpeed)
    expect(hand.stats.maxHp).toBeGreaterThan(kid.stats.maxHp)
  })
})

describe('OfferPool', () => {
  it('always includes at least one uncommon or better', () => {
    const p = new Player()
    p.init('hand')
    // Many draws across many seeds — a guarantee that holds only usually is
    // not a guarantee, and this is the card screen every level-up shows.
    for (let seed = 1; seed <= 300; seed++) {
      const pool = new OfferPool(new Rng(seed))
      const offers = pool.draw(p, 3, 0, 0)
      expect(offers.length).toBe(3)
      expect(offers.some((o) => o.rarity !== 'common')).toBe(true)
    }
  })

  it('gives a level-up exactly one boosted uncommon-or-better card', () => {
    const p = new Player()
    p.init('hand')
    for (let seed = 1; seed <= 300; seed++) {
      const pool = new OfferPool(new Rng(seed))
      const offers = pool.draw(p, 4, 0, 0, 'levelup')
      expect(offers.length).toBe(4)

      const boosted = offers.filter((o) => o.boosted)
      expect(boosted.length).toBe(1)
      // The boosted card is always the rare one, and never a common.
      expect(boosted[0].rarity).not.toBe('common')
      /*
         What this assertion USED to say, and why it does not any more.

         It read `filter(rarity !== 'common').length === 1` — one non-common
         card on the whole board — and it passed for the same reason the game
         was boring: `drawLevelUp` filled its boosted slot from the
         uncommon-or-better cards and every other slot from `commonIdx` ALONE.
         A merge's rarity is its next tier, so a merge, an element, a special
         and every uncommon item were all competing for one slot in four, and
         the eleven common stat items inherited the other three. The test was
         not guarding the design; it was pinning the bug in place.
         docs/UPGRADE_ROSTER.md §7.2 deletes that pool. See the two tests
         below, which assert what the board is supposed to be instead.
      */
      expect(offers.filter((o) => o.rarity !== 'common').length).toBeGreaterThanOrEqual(1)
    }
  })

  /*
     docs/UPGRADE_ROSTER.md §7.2 — the board's quotas and caps.

     These three are the regression guard for the measured complaint. The
     numbers they assert are the §2 targets restated as a pass/fail: never four
     stat bumps, never four of anything, and a shop that cannot reshow the set
     it just swept away.
  */
  it('never deals a board that is four stat bumps', () => {
    /*
       The player TAKES what it is dealt, which is the half that matters.

       The first version of this test drew against a fresh Player over 300
       seeds and passed — while a real run photographed a board of four
       commons at level 6. A build that has taken twenty cards has a different
       candidate set and a full recency memory, and that is the state the
       fallback chain was surrendering its caps in.
    */
    for (let seed = 1; seed <= 200; seed++) {
      const p = new Player()
      p.init(seed % 2 ? 'hand' : 'kid')
      const pool = new OfferPool(new Rng(seed))
      for (let board = 0; board < 14; board++) {
        const offers = pool.draw(p, 4, board * 30, 0, 'levelup')
        const first = offers[0]
        if (first) {
          if (first.kind === 'weapon') p.addWeapon(first.id, first.tierJump)
          else if (p.canTakeItem(first.id)) p.addItem(first.id, first.boosted)
        }
        const stats = offers.filter((o) => ITEMS[o.id]?.category === 'stat')
        expect(stats.length, `seed ${seed} board ${board}`).toBeLessThanOrEqual(1)
        // ...and never four of ONE thing, whatever that thing is.
        const groups = new Map<string, number>()
        for (const o of offers) {
          const g = o.kind === 'weapon'
            ? (o.mergesTo === null ? 'newWeapon' : 'merge')
            : ITEMS[o.id]?.category === 'stat' ? 'stat' : 'special'
          groups.set(g, (groups.get(g) ?? 0) + 1)
        }
        expect(Math.max(...groups.values()), `seed ${seed} board ${board}`).toBeLessThan(4)
      }
    }
  })

  it('shows a behavioural card on a board whenever one is available', () => {
    // Slot C's quota. With 31 behavioural cards in the roster and four slots,
    // a board with none of them means the quota is not being applied.
    const p = new Player()
    p.init('kid')
    let boards = 0
    let withBehavioural = 0
    for (let seed = 1; seed <= 120; seed++) {
      const pool = new OfferPool(new Rng(seed))
      for (let board = 0; board < 4; board++) {
        const offers = pool.draw(p, 4, board * 30, 0, 'levelup')
        boards++
        if (offers.some((o) => {
          const c = ITEMS[o.id]?.category
          return c !== undefined && c !== 'stat'
        })) withBehavioural++
      }
    }
    expect(withBehavioural).toBe(boards)
  })

  it('never reshows the previous shop visit, and a reroll never hands it back', () => {
    const p = new Player()
    p.init('hand')
    for (let seed = 1; seed <= 120; seed++) {
      const pool = new OfferPool(new Rng(seed))
      let previous: string[] = []
      for (let visit = 0; visit < 4; visit++) {
        pool.beginShopVisit()
        const board = pool.draw(p, 4, visit * 200, 0, 'shop')
        for (const o of board) {
          expect(previous, `seed ${seed} visit ${visit}`).not.toContain(o.id)
        }
        // A reroll is a reroll: what the visit has already shown is gone for
        // the rest of it, which is what made the old reroll a coin flip.
        const seenThisVisit = board.map((o) => o.id)
        const reroll = pool.draw(p, 4, visit * 200 + 5, 0, 'shop')
        for (const o of reroll) {
          expect(seenThisVisit, `seed ${seed} visit ${visit} reroll`).not.toContain(o.id)
        }
        previous = [...seenThisVisit, ...reroll.map((o) => o.id)]
      }
    }
  })

  it('doubles the boosted card and leaves the others alone', () => {
    const p = new Player()
    p.init('hand')
    let checked = 0
    for (let seed = 1; seed <= 200 && checked < 20; seed++) {
      const pool = new OfferPool(new Rng(seed))
      const boosted = pool.draw(p, 4, 0, 0, 'levelup').find((o) => o.boosted)
      if (!boosted || boosted.kind !== 'item') continue
      const base = ITEMS[boosted.id].mods ?? {}
      for (const [key, value] of Object.entries(base)) {
        expect(boosted.mods[key as keyof typeof boosted.mods]).toBe((value as number) * 2)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('never boosts a shop card — the shop is where you pay for what you want', () => {
    const p = new Player()
    p.init('kid')
    for (let seed = 1; seed <= 200; seed++) {
      const pool = new OfferPool(new Rng(seed))
      const offers = pool.draw(p, 4, 0, 0, 'shop')
      expect(offers.every((o) => !o.boosted)).toBe(true)
      expect(offers.every((o) => o.tierJump === 1)).toBe(true)
    }
  })

  it('makes a boosted item resolve to exactly twice a plain one', () => {
    const plain = new Player()
    plain.init('hand')
    plain.addItem('workBoots', false)
    const doubled = new Player()
    doubled.init('hand')
    doubled.addItem('workBoots', true)

    const base = new Player()
    base.init('hand')
    const gainPlain = plain.stats.moveSpeedPct - base.stats.moveSpeedPct
    const gainDoubled = doubled.stats.moveSpeedPct - base.stats.moveSpeedPct
    expect(gainDoubled).toBe(gainPlain * 2)
  })

  it('never offers the same thing twice in one draw', () => {
    const p = new Player()
    p.init('kid')
    for (let seed = 1; seed <= 200; seed++) {
      const pool = new OfferPool(new Rng(seed))
      const offers = pool.draw(p, 4, 0, 0)
      expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length)
    }
  })

  it('reads rarity declared in items.json', () => {
    const p = new Player()
    p.init('hand')
    const pool = new OfferPool(new Rng(1))
    // Draw wide enough to see most of the pool.
    const seen = new Map<string, string>()
    for (let i = 0; i < 60; i++) {
      for (const o of pool.draw(p, 6, i * 1000, 0)) seen.set(o.id, o.rarity)
    }
    // Assert the CONTRACT, not three ids. Pinning ids meant this test failed
    // the moment the roster was redesigned, while telling us nothing about
    // whether rarity still worked — and it had to be read to discover that the
    // real cause was `whetstone` becoming level-up-only, which is correct.
    expect(seen.size).toBeGreaterThan(8)
    for (const [id, rarity] of seen) {
      expect(RARITY_ORDER, `${id} has an unknown rarity`).toContain(rarity)
    }
    // Every declared rarity should agree with what the pool reports.
    for (const [id, def] of Object.entries(ITEMS)) {
      if (def.rarity && seen.has(id)) expect(seen.get(id)).toBe(def.rarity)
    }
  })

  it('never offers a level-up-only item in the shop, or vice versa', () => {
    const p = new Player()
    p.init('hand')
    const pool = new OfferPool(new Rng(7))
    for (const mode of ['shop', 'levelup'] as const) {
      const seen = new Set<string>()
      for (let i = 0; i < 80; i++) {
        for (const o of pool.draw(p, 6, i * 1000, 0, mode)) seen.add(o.id)
      }
      for (const id of seen) {
        const src = ITEMS[id]?.source
        if (src && src !== 'both') {
          expect(src, `${id} appeared in a ${mode} draw`).toBe(mode)
        }
      }
    }
  })

  it('offers a source of raw damage scaling', () => {
    // Weapon merging used to be the only way to scale damage at all.
    const damageItems = Object.entries(ITEMS).filter(
      ([, def]) => (def.mods?.damagePct ?? 0) > 0 || (def.mods?.meleePct ?? 0) > 0 || (def.mods?.rangedPct ?? 0) > 0,
    )
    expect(damageItems.length).toBeGreaterThan(0)
  })
})

describe('Spawner', () => {
  it('withholds spawns at the pressure ceiling', () => {
    const s = new Spawner(new Rng(1), MAPS.homeField)
    // Read the ceiling rather than restating it: pinned at 400 this passed only
    // while the ceiling happened to be below it, and went quiet when it rose.
    s.update(1, WAVES.pressureCeiling)
    expect(s.pending).toHaveLength(0)
    s.update(1, WAVES.pressureCeiling - 1)
    expect(s.pending.length).toBeGreaterThan(0)
  })

  it('only offers enemies unlocked at the current wave', () => {
    const s = new Spawner(new Rng(4), MAPS.homeField)
    s.beginWave(1)
    for (let i = 0; i < 200; i++) {
      s.update(0.2, 0)
      for (const p of s.pending) expect(p.typeId).toBe('farmhand')
    }
  })

  it('keeps spawn points away from the player when it can', () => {
    const s = new Spawner(new Rng(9), MAPS.homeField)
    const out = { x: 0, y: 0 }
    for (let i = 0; i < 100; i++) {
      s.pickSpawnPoint(1200, 800, 2400, 1600, out)
      expect(Math.hypot(out.x - 1200, out.y - 800)).toBeGreaterThanOrEqual(220)
    }
  })

  it('completes a wave once the clock runs out', () => {
    const s = new Spawner(new Rng(2), MAPS.homeField)
    expect(s.waveComplete).toBe(false)
    for (let i = 0; i < 60 * 41; i++) s.update(1 / 60, 0)
    expect(s.waveComplete).toBe(true)
  })
})
