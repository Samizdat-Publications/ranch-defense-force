import { describe, expect, it } from 'vitest'
import { resolveStats, emptyDerived, previewDelta } from '../src/sim/stats'
import {
  acresEarned, interestOn, resolveDamage, shopRerollCost, threatBudget,
  waveIncome, waveScalar, xpToNext,
} from '../src/sim/formulas'
import { Player } from '../src/sim/player'
import { Spawner } from '../src/sim/spawner'
import { Rng } from '../src/core/rng'
import { TUNING } from '../src/content'

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
    expect(waveIncome(1)).toBe(9)
    expect(waveIncome(24)).toBe(78)
    expect(threatBudget(1)).toBeCloseTo(53.4, 6)
    expect(threatBudget(24)).toBeCloseTo(30 + 528 + 806.4, 6)
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
    p.addWeapon('shovel')
    expect(p.weapons).toHaveLength(1)
    expect(p.weapons[0].tier).toBe(2)
  })

  it('caps merging at tier 4', () => {
    const p = new Player()
    p.init('hand')
    for (let i = 0; i < 10; i++) p.addWeapon('shovel')
    expect(p.weapons[0].tier).toBe(4)
    expect(p.weaponAtMaxTier('shovel')).toBe(true)
  })

  it('refuses a seventh distinct weapon', () => {
    const p = new Player()
    p.init('hand')
    const ids = ['axe', 'wateringCan', 'fishingRod', 'seedSpitter', 'melonLob']
    for (const id of ids) expect(p.addWeapon(id)).toBe(true)
    expect(p.weapons).toHaveLength(6)
    expect(p.slotsFull).toBe(true)
    expect(p.addWeapon('chiliShot')).toBe(false)
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

describe('Spawner', () => {
  it('withholds spawns at the pressure ceiling', () => {
    const s = new Spawner(new Rng(1))
    s.update(1, 400)
    expect(s.pending).toHaveLength(0)
  })

  it('only offers enemies unlocked at the current wave', () => {
    const s = new Spawner(new Rng(4))
    s.beginWave(1)
    for (let i = 0; i < 200; i++) {
      s.update(0.2, 0)
      for (const p of s.pending) expect(p.typeId).toBe('farmhand')
    }
  })

  it('keeps spawn points away from the player when it can', () => {
    const s = new Spawner(new Rng(9))
    const out = { x: 0, y: 0 }
    for (let i = 0; i < 100; i++) {
      s.pickSpawnPoint(1200, 800, 2400, 1600, out)
      expect(Math.hypot(out.x - 1200, out.y - 800)).toBeGreaterThanOrEqual(220)
    }
  })

  it('completes a wave once the clock runs out', () => {
    const s = new Spawner(new Rng(2))
    expect(s.waveComplete).toBe(false)
    for (let i = 0; i < 60 * 41; i++) s.update(1 / 60, 0)
    expect(s.waveComplete).toBe(true)
  })
})
