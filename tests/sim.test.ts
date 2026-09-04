import { describe, expect, it } from 'vitest'
import { resolveStats, emptyDerived, previewDelta } from '../src/sim/stats'
import {
  acresEarned, interestOn, resolveDamage, shopRerollCost, threatBudget,
  waveIncome, waveScalar, xpToNext,
} from '../src/sim/formulas'
import { Player, hasMod } from '../src/sim/player'
import { World } from '../src/sim/world'
import { Spawner } from '../src/sim/spawner'
import { OfferPool, applySwap, describeItem, loadStatDelta } from '../src/sim/offers'
import { Rng } from '../src/core/rng'
import { CLASSES, ELEMENTS, ITEMS, MAPS, TUNING, RARITY_ORDER, WAVES, elementStat } from '../src/content'
import { loadItemFor } from '../src/ui/hud'

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

/**
 * The Load family (items.json `_familyNote`, elements.json `_stackNote`).
 *
 * Before this, `Player.addItem` set `element` and stopped: a second or third
 * copy of the SAME Load re-asserted the same string over itself and did
 * nothing, and the ledger could show two maxed Loads at once with no way to
 * tell which one, if either, was doing anything. These are that report,
 * turned into assertions.
 */
describe('Loads', () => {
  it('replaces the active load rather than stacking two at once', () => {
    const p = new Player()
    p.init('hand')
    p.addItem('tracerRounds') // fire
    expect(p.element).toBe('fire')
    p.addItem('coldRounds') // frost
    expect(p.element).toBe('frost')
    // Superseded, not refunded (the simpler of the two options) -- the old
    // copy stays on the ledger, it just no longer drives anything.
    expect(p.itemIds).toContain('tracerRounds')
    expect(p.itemIds).toContain('coldRounds')
  })

  it('deepens a load that is taken again, additively', () => {
    const p = new Player()
    p.init('hand')
    p.addItem('tracerRounds')
    expect(p.loadStacks).toBe(1)
    p.addItem('tracerRounds')
    expect(p.loadStacks).toBe(2)
    p.addItem('tracerRounds')
    expect(p.loadStacks).toBe(3) // tracerRounds' own maxStacks
  })

  it('resumes a load\'s depth on switching back rather than restarting it', () => {
    const p = new Player()
    p.init('hand')
    p.addItem('tracerRounds')
    p.addItem('tracerRounds') // fire at 2
    p.addItem('coldRounds') // switch to frost
    expect(p.element).toBe('frost')
    expect(p.loadStacks).toBe(1)
    p.addItem('tracerRounds') // back to fire -- the two earlier copies still count
    expect(p.element).toBe('fire')
    expect(p.loadStacks).toBe(3)
  })

  it('scales burn/bleed/slow by stack count, off content, not a hardcoded step', () => {
    const fire = ELEMENTS.fire
    expect(elementStat(fire, 'burnDps', 1)).toBe(fire.burnDps)
    expect(elementStat(fire, 'burnDps', 2)).toBe((fire.burnDps ?? 0) + (fire.burnDpsPerStack ?? 0))
    expect(elementStat(fire, 'burnDps', 3))
      .toBe((fire.burnDps ?? 0) + (fire.burnDpsPerStack ?? 0) * 2)
    // A Load with no `<field>PerStack` (every batch-1 Load, `maxStacks: 1`) is
    // unaffected regardless of the stack argument -- the "one rule" applies
    // uniformly rather than special-casing the three that can go past 1.
    const salt = ELEMENTS.salt
    expect(elementStat(salt, 'markPct', 1)).toBe(salt.markPct)
    expect(elementStat(salt, 'markPct', 3)).toBe(salt.markPct)
  })

  it('applies the deepened numbers to a live shot, not just the content table', () => {
    // `applyElementTo` is private, so the assertion goes through the public
    // number it is supposed to change: a fired shot must burn at the
    // 3-stack rate, not the flat base `elements.json` used to leave it at.
    const w = new World(9001, 'hand')
    w.player.addWeapon('scattergun')
    w.player.addItem('tracerRounds')
    w.player.addItem('tracerRounds')
    w.player.addItem('tracerRounds') // 3/3
    w.spawnEnemy('farmhand', w.player.x + 100, w.player.y, false)
    // 'hand' starts with the Pitchfork, a melee weapon elements do not touch,
    // so this waits for the scattergun's OWN shot rather than assuming index 0.
    let shot: { burnDps: number } | undefined
    for (let i = 0; i < 60 && !shot; i++) {
      w.step(1 / 60, 0, 0, false)
      for (let j = 0; j < w.projectiles.live; j++) {
        if (w.projectiles.items[j].weaponId === 'scattergun') { shot = w.projectiles.items[j]; break }
      }
    }
    expect(shot).toBeDefined()
    const burnAt3 = elementStat(ELEMENTS.fire, 'burnDps', 3)
    expect(shot?.burnDps).toBe(burnAt3)
  })

  it('states a delta only from the second copy on, off the same numbers the sim applies', () => {
    expect(loadStatDelta('fire', 1)).toBeNull()
    const at2 = loadStatDelta('fire', 2)
    const at3 = loadStatDelta('fire', 3)
    expect(at2).toMatch(/burn 7 → 10 dps/)
    expect(at3).toMatch(/burn 10 → 13 dps/)
    // A Load stuck at stack 1 forever (every batch-1 one) never has a delta
    // to show -- `stack` here is what `itemCount(id) + 1` would be, and a
    // `maxStacks: 1` item's offer is never drawn past `stack === 1` anyway.
    expect(loadStatDelta('spark', 2)).toBeNull()
  })

  it('tells the card it is about to replace the current load', () => {
    const fireDef = ITEMS.tracerRounds
    const frostDef = ITEMS.coldRounds
    // Taking Fire while nothing is active: no replace notice.
    expect(describeItem(fireDef, 1, 'none')).not.toMatch(/Replaces/)
    // Taking Frost while Fire is active: the card says so.
    expect(describeItem(frostDef, 1, 'fire')).toMatch(/Replaces your current load \(Fire\)\./)
    // Taking a SECOND Fire while Fire is already active is a deepen, not a
    // replace, and states the concrete delta instead.
    expect(describeItem(fireDef, 2, 'fire')).toMatch(/2\/3 — burn 7 → 10 dps/)
  })

  it('names the right item for the HUD\'s Load slot, one per element', () => {
    expect(loadItemFor('none')).toBeNull()
    for (const [id, def] of Object.entries(ITEMS)) {
      const element = (def as { element?: string }).element
      if (typeof element !== 'string') continue
      expect(loadItemFor(element)).toBe(id)
    }
    // Every element the HUD can be asked to show has a name to print.
    for (const el of Object.keys(ELEMENTS)) {
      if (el === 'none') continue
      expect(ELEMENTS[el].name).toBeTruthy()
    }
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

  /*
     docs/UPGRADE_ROSTER.md batch 2, H12 — the 48 weapon-upgrade cards (plus
     the Smudge Pot's own three) never appear before the weapon they belong
     to, and always do once it is owned.
  */
  it('never offers a weapon upgrade before the weapon it belongs to', () => {
    const p = new Player()
    p.init('hand') // starts with the pitchfork only
    const pool = new OfferPool(new Rng(3))
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      for (const o of pool.draw(p, 6, i * 1000, 0, 'shop')) seen.add(o.id)
    }
    for (const id of seen) {
      const requires = ITEMS[id]?.requiresWeapon
      if (typeof requires === 'string') {
        expect(p.hasWeapon(requires), `${id} requires ${requires}, which The Hand does not own`).toBe(true)
      }
    }
    // And the gate opens the instant the weapon is owned, rather than the
    // card being lost entirely — the whole point of a gate over an omission.
    p.addWeapon('scattergun')
    const pool2 = new OfferPool(new Rng(3))
    const seenAfter = new Set<string>()
    for (let i = 0; i < 100; i++) {
      for (const o of pool2.draw(p, 6, i * 1000, 0, 'shop')) seenAfter.add(o.id)
    }
    expect(['scattergunChokeTube', 'scattergunBuckBall', 'scattergunCutShell'].some(
      (id) => seenAfter.has(id),
    )).toBe(true)
  })

  it('caps a weapon upgrade at one copy, same as any other ONE ONLY card', () => {
    const p = new Player()
    p.init('hand')
    expect(p.canTakeItem('pitchforkLongHaft')).toBe(true)
    p.addItem('pitchforkLongHaft')
    expect(p.canTakeItem('pitchforkLongHaft')).toBe(false)
    // And the mod actually landed on the right slot, not just the item log.
    const slot = p.weapons.find((w) => w.id === 'pitchfork')
    expect(slot && hasMod(slot, 'longHaft')).toBe(true)
  })

  /*
     docs/UPGRADE_ROSTER.md §7.5 — slots full.
  */
  it('fills a full loadout with weapon-upgrade cards and a swap, not new weapons', () => {
    const p = new Player()
    p.init('hand')
    for (const id of ['scythe', 'chemSprayer', 'harpoon', 'scattergun', 'grenadeLauncher']) {
      expect(p.addWeapon(id)).toBe(true)
    }
    expect(p.slotsFull).toBe(true)

    const pool = new OfferPool(new Rng(5))
    let sawWeaponMod = false
    let sawSwap = false
    for (let i = 0; i < 60; i++) {
      for (const o of pool.draw(p, 6, i * 1000, 0, 'shop')) {
        // No NEW weapon is ever offered once the loadout is full.
        if (o.kind === 'weapon') expect(o.mergesTo, `${o.id} offered as new while full`).not.toBeNull()
        if (o.kind === 'swap') sawSwap = true
        if (o.kind === 'item' && ITEMS[o.id]?.category === 'weaponMod') sawWeaponMod = true
      }
    }
    expect(sawWeaponMod).toBe(true)
    expect(sawSwap).toBe(true)
  })

  it('a swap trades the lowest-tier weapon for one the run does not own, at tier 1', () => {
    const p = new Player()
    p.init('hand')
    for (const id of ['scythe', 'chemSprayer', 'harpoon', 'scattergun', 'grenadeLauncher']) p.addWeapon(id)
    expect(p.weapons).toHaveLength(6)
    p.addWeapon('scythe') // tier 2, so it is not the one traded away
    const before = new Set(p.weapons.map((w) => w.id))
    const lowest = p.lowestTierWeaponId()
    expect(lowest).not.toBeNull()
    expect(p.weapons.find((w) => w.id === lowest)?.tier).toBe(1)

    applySwap(p, new Rng(11))

    expect(p.weapons).toHaveLength(6)
    expect(p.hasWeapon(lowest as string)).toBe(false)
    const added = [...new Set(p.weapons.map((w) => w.id))].find((id) => !before.has(id))
    expect(added, 'a new weapon must have arrived').toBeDefined()
    expect(p.weapons.find((w) => w.id === added)?.tier).toBe(1)
  })
})

/*
   docs/UPGRADE_ROSTER.md batch 4, H13 — the 18 class cards.
*/
describe('class cards (H13)', () => {
  const CLASS_IDS = Object.keys(CLASSES).filter((k) => !k.startsWith('_'))
  const CLASS_CARDS = Object.entries(ITEMS)
    .filter(([, def]) => typeof def.requiresClass === 'string')

  it('exist for every class, three each, gated on requiresClass', () => {
    for (const classId of CLASS_IDS) {
      const own = CLASS_CARDS.filter(([, def]) => def.requiresClass === classId)
      expect(own, `${classId} has no class cards`).toHaveLength(3)
      for (const [, def] of own) {
        expect(def.category, `${def.name} category`).toBe('class')
        expect(def.maxStacks, `${def.name} maxStacks`).toBe(1)
      }
    }
  })

  // Mirrors "never offers a weapon upgrade before the weapon it belongs to"
  // above: a class card must never appear for a run playing a different
  // class, and must appear for the run it is gated to.
  it('never offers a class card for the wrong class, and always for the right one', () => {
    for (const classId of CLASS_IDS) {
      const p = new Player()
      p.init(classId)
      const pool = new OfferPool(new Rng(7))
      const seen = new Set<string>()
      for (let i = 0; i < 120; i++) {
        for (const o of pool.draw(p, 6, i * 1000, 0, 'shop')) seen.add(o.id)
      }
      for (const id of seen) {
        const requires = ITEMS[id]?.requiresClass
        if (typeof requires === 'string') {
          expect(requires, `${id} appeared for ${classId}`).toBe(classId)
        }
      }
      const own = CLASS_CARDS.filter(([, def]) => def.requiresClass === classId).map(([id]) => id)
      expect(
        own.some((id) => seen.has(id)),
        `${classId} never saw any of its own class cards (${own.join(', ')})`,
      ).toBe(true)
    }
  })

  /*
     "Each overlay changes the number it claims to" — for every one of the 18
     cards, taking it must move every field its own `classBonus` block names,
     by exactly the value declared, on the player of the class it is gated
     to. This is the wiring check: `resolveClassBonus` reading the right key
     off the right item into the right slot of `player.classBonus`. The
     behavioural end of each overlay (Braced's cap, Overwatch's bands, the
     rest) is exercised individually below and, in aggregate, by the balance
     harness's parity ladder.
  */
  it('moves player.classBonus by exactly the amount each card declares', () => {
    for (const [id, def] of CLASS_CARDS) {
      const classId = def.requiresClass as string
      const p = new Player()
      p.init(classId)
      const bonus = def.classBonus as Record<string, number>
      expect(bonus, `${id} has a requiresClass but no classBonus`).toBeTruthy()
      for (const key of Object.keys(bonus)) {
        expect(
          (p.classBonus as unknown as Record<string, number>)[key],
          `${id} before taking it: ${key}`,
        ).toBe(0)
      }
      p.addItem(id)
      for (const [key, value] of Object.entries(bonus)) {
        expect(
          (p.classBonus as unknown as Record<string, number>)[key],
          `${id} after taking it: ${key}`,
        ).toBeCloseTo(value, 6)
      }
    }
  })

  it("Deep Rooted raises the Hand's realised Braced cap past today's base 45%", () => {
    const p = new Player()
    p.init('hand')
    for (let i = 0; i < 600; i++) p.move(0, 0, 1 / 60, 2000, 2000) // stand still well past the cap
    p.updatePassive(1 / 60)
    const before = p.passiveDamageReduction
    expect(before).toBeCloseTo(0.45, 3) // today's shipped base (batch 1)

    p.addItem('handDeepRooted')
    p.updatePassive(1 / 60)
    expect(p.passiveDamageReduction).toBeCloseTo(0.55, 3)
    expect(p.passiveDamageReduction).toBeGreaterThan(before)
  })

  it("Long Stride raises the Kid's realised Momentum cap past the base 50%", () => {
    const p = new Player()
    p.init('kid')
    // Full speed, held for several ticks so the echo (Following Wind's field,
    // unrelated and zero here) has settled to the raw value.
    for (let i = 0; i < 5; i++) {
      p.move(1, 0, 1 / 60, 4000, 4000)
      p.updatePassive(1 / 60)
    }
    const before = p.passiveDamagePct
    expect(before).toBeCloseTo(50, 3)

    p.addItem('kidLongStride')
    p.move(1, 0, 1 / 60, 4000, 4000)
    p.updatePassive(1 / 60)
    expect(p.passiveDamagePct).toBeCloseTo(70, 3)
    expect(p.passiveDamagePct).toBeGreaterThan(before)
  })

  it("Enfilade zeroes the Veteran's near-contact Overwatch penalty", () => {
    const p = new Player()
    p.init('vet')
    expect(p.overwatchPct(10, 0)).toBeLessThan(0) // -20% at contact range, base

    p.addItem('vetEnfilade')
    expect(p.overwatchPct(10, 0)).toBe(0)
  })

  it('Cut and Run leaves half the streak standing instead of clearing it', () => {
    const p = new Player()
    p.init('drifter')
    for (let i = 0; i < 10; i++) p.onKill(0, 0)
    expect(p.streak).toBe(10)
    p.onHurt()
    expect(p.streak).toBe(0) // base: one hit clears it outright

    for (let i = 0; i < 10; i++) p.onKill(0, 0)
    p.addItem('drifterCutAndRun')
    expect(p.streak).toBe(10)
    p.onHurt()
    expect(p.streak).toBe(5)
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
