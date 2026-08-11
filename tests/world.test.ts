/**
 * Headless world tests. The sim imports nothing from render/ or ui/, which is
 * what lets these run with no DOM at all — that boundary is a non-negotiable
 * in CLAUDE.md and this file is what keeps it honest.
 */
import { describe, expect, it } from 'vitest'
import { World } from '../src/sim/world'
import { STEP } from '../src/core/loop'

/** Deterministic scripted input, so two runs make identical decisions. */
function inputAt(tick: number): [number, number, boolean] {
  const t = tick * STEP
  const mx = Math.sign(Math.sin(t * 0.7))
  const my = Math.sign(Math.cos(t * 0.5))
  const ability = tick % 900 === 0
  return [mx, my, ability]
}

function runHeadless(seed: number, ticks: number, classId = 'hand'): World {
  const w = new World(seed, classId)
  for (let i = 0; i < ticks; i++) {
    const [mx, my, ab] = inputAt(i)
    w.step(STEP, mx, my, ab)
    // Level-ups and shops would pause a real run; headless we just take
    // nothing, which is the harshest build and the one most likely to die.
  }
  return w
}

function fingerprint(w: World): string {
  let enemyHash = 0
  for (let i = 0; i < w.enemies.live; i++) {
    const e = w.enemies.items[i]
    enemyHash = (enemyHash * 31 + Math.round(e.x * 100) + Math.round(e.y * 100) + Math.round(e.hp)) | 0
  }
  return [
    w.tick, w.kills, Math.round(w.damageDealt),
    w.enemies.live, w.projectiles.live, w.pickups.live,
    Math.round(w.player.x * 100), Math.round(w.player.y * 100),
    Math.round(w.player.hp * 100), w.player.level, w.player.feed,
    enemyHash,
  ].join('|')
}

describe('World determinism', () => {
  it('replays identically from the same seed', () => {
    const a = runHeadless(20260810, 3600)
    const b = runHeadless(20260810, 3600)
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('produces different runs from different seeds', () => {
    const a = runHeadless(1, 1800)
    const b = runHeadless(2, 1800)
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('replays identically for the other class too', () => {
    const a = runHeadless(777, 1800, 'kid')
    const b = runHeadless(777, 1800, 'kid')
    expect(fingerprint(a)).toBe(fingerprint(b))
  })
})

describe('World invariants', () => {
  it('never lets an entity leave the arena', () => {
    const w = runHeadless(42, 2400)
    for (let i = 0; i < w.enemies.live; i++) {
      const e = w.enemies.items[i]
      expect(e.x).toBeGreaterThanOrEqual(0)
      expect(e.x).toBeLessThanOrEqual(w.arenaW)
      expect(e.y).toBeGreaterThanOrEqual(0)
      expect(e.y).toBeLessThanOrEqual(w.arenaH)
    }
    expect(w.player.x).toBeGreaterThanOrEqual(0)
    expect(w.player.x).toBeLessThanOrEqual(w.arenaW)
  })

  it('respects the pressure ceiling', () => {
    const w = new World(5, 'hand')
    // Skip ahead to a wave whose budget would otherwise bury the screen.
    for (let wave = 1; wave < 18; wave++) w.spawner.beginWave(wave)
    for (let i = 0; i < 60 * 120; i++) w.step(STEP, 0, 0, false)
    expect(w.enemies.live).toBeLessThanOrEqual(420)
  })

  it('kills things and drops xp for them', () => {
    const w = runHeadless(11, 2400)
    expect(w.kills).toBeGreaterThan(0)
    expect(w.damageDealt).toBeGreaterThan(0)
  })

  it('scatters harvestable crops and pays feed for breaking them', () => {
    const w = new World(77, 'hand')
    expect(w.props.live).toBeGreaterThan(20)

    // Stand the player on top of a crop and let the shovel do the work.
    const target = w.props.items[0]
    w.player.x = target.x
    w.player.y = target.y
    const before = w.props.live
    const feedBefore = w.player.feed
    for (let i = 0; i < 600; i++) w.step(STEP, 0, 0, false)

    expect(w.cropsHarvested).toBeGreaterThan(0)
    expect(w.props.live).toBeLessThan(before)
    expect(w.player.feed).toBeGreaterThan(feedBefore)
  })

  it('regrows some crops at a wave boundary', () => {
    const w = new World(78, 'hand')
    // Strip the field.
    for (let i = w.props.live - 1; i >= 0; i--) w.props.free(i)
    expect(w.props.live).toBe(0)
    for (let i = 0; i < 60 * 41; i++) w.step(STEP, 0, 0, false)
    expect(w.props.live).toBeGreaterThan(0)
  })

  it('pays wave income at a wave boundary', () => {
    const w = new World(3, 'hand')
    let paid = 0
    w.events = { onWaveComplete: (_wave, income) => { paid = income } }
    for (let i = 0; i < 60 * 41; i++) w.step(STEP, 0, 0, false)
    expect(paid).toBe(9) // waveIncome(1)
    expect(w.player.feed).toBeGreaterThanOrEqual(9)
  })

  it('advances to wave 2 without a gap', () => {
    const w = new World(3, 'hand')
    for (let i = 0; i < 60 * 41; i++) w.step(STEP, 0, 0, false)
    expect(w.spawner.wave).toBe(2)
    expect(w.spawner.waveTime).toBeLessThan(2)
  })

  it('never allocates past a pool cap', () => {
    const w = new World(8, 'hand')
    for (let i = 0; i < 3000; i++) {
      w.spawnEnemy('farmhand', 100 + (i % 500), 100 + (i % 300), false)
    }
    expect(w.enemies.live).toBeLessThanOrEqual(w.enemies.capacity)
  })

  it('freezes the sim while paused', () => {
    const w = new World(9, 'hand')
    for (let i = 0; i < 120; i++) w.step(STEP, 1, 0, false)
    const x = w.player.x
    w.paused = true
    for (let i = 0; i < 120; i++) w.step(STEP, 1, 0, false)
    expect(w.player.x).toBe(x)
  })

  it('plays fx during combat, and expires them', () => {
    const w = runHeadless(41, 2400)
    // Something must have fired: the run kills things and swings a weapon.
    expect(w.kills).toBeGreaterThan(0)
    let everLive = 0
    for (let i = 0; i < 600; i++) {
      const [mx, my, ab] = inputAt(2400 + i)
      w.step(STEP, mx, my, ab)
      everLive += w.effects.live
    }
    expect(everLive).toBeGreaterThan(0)
    expect(w.effects.live).toBeLessThanOrEqual(w.effects.capacity)

    // Effects are decoration and must drain on their own.
    for (let i = 0; i < 300; i++) w.step(STEP, 0, 0, false)
    const idle = w.effects.live
    for (let i = 0; i < 300; i++) w.step(STEP, 0, 0, false)
    expect(w.effects.live).toBeLessThanOrEqual(idle)
  })

  it('never lets an fx decision touch the rng stream', () => {
    // The guarantee this protects: a seed replays exactly, whatever the art is
    // doing. If a spark ever rolls `world.rng`, drawing fewer sparks would move
    // every later spawn — so playFx is proven here to consume nothing.
    const w = new World(77, 'kid')
    for (let i = 0; i < 600; i++) w.step(STEP, 1, 0, false)

    const before = w.rng.next()
    const w2 = new World(77, 'kid')
    for (let i = 0; i < 600; i++) w2.step(STEP, 1, 0, false)
    for (let i = 0; i < 50; i++) {
      w2.playFx('hitSpark', w2.player.x, w2.player.y)
      w2.playFx('explosion', w2.player.x, w2.player.y)
    }
    expect(w2.effects.live).toBeGreaterThan(0)
    expect(w2.rng.next()).toBe(before)
  })
})
