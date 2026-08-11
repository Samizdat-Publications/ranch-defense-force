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
})
