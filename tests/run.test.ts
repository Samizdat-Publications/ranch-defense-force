/**
 * M3 acceptance, executable.
 *
 * The criterion is "a complete 17-minute run start to finish; wave 24 is
 * survivable with a good build and not with a bad one". That needs two pilots,
 * because a single bot proves nothing: if the good one fails the game is too
 * hard, and if the bad one clears the progression does not matter.
 *
 * These bots are crude — `smart` merges weapons and favours defence, `kite`
 * runs from the crowd's centre of mass. They are nowhere near a competent human
 * and are not a substitute for playing it. What they do prove is that the loop
 * runs end to end, that build quality changes the outcome, and that the run is
 * reproducible.
 */
import { describe, expect, it } from 'vitest'
import { World } from '../src/sim/world'
import { OfferPool, type Offer } from '../src/sim/offers'
import { STEP } from '../src/core/loop'
import { WAVES } from '../src/content'

type Picker = (offers: Offer[]) => Offer | undefined

/** Takes nothing at all — the floor. */
const pickNothing: Picker = () => undefined
/** Whatever came up first. */
const pickFirst: Picker = (o) => o[0]
/** Merge what we own, then take defence, then anything. */
const pickSmart: Picker = (offers) => {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const defensive = offers.find(
    (o) => (o.mods.maxHp ?? 0) > 0 || (o.mods.armor ?? 0) > 0 || (o.mods.hpRegen ?? 0) > 0,
  )
  return defensive ?? offers[0]
}

interface RunResult {
  cleared: boolean
  waveReached: number
  level: number
  kills: number
  weapons: number
  maxTier: number
  items: number
  seconds: number
}

function simulate(
  seed: number,
  classId: string,
  pick: Picker,
  kite: boolean,
): RunResult {
  const world = new World(seed, classId)
  const offers = new OfferPool(world.rng)
  let pending = 0
  let shopQueued = false

  world.events = {
    onLevelUp: (n) => { pending += n },
    onWaveComplete: (wave) => {
      if ((WAVES.shopAfterWaves as number[]).includes(wave)) shopQueued = true
    },
  }

  const take = (o: Offer): void => {
    if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
    else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
  }

  let ticks = 0
  const maxTicks = 60 * 60 * 25
  while (!world.over && world.spawner.wave <= WAVES.waveCount && ticks < maxTicks) {
    const t = ticks * STEP
    let mx = Math.cos(t * 0.6)
    let my = Math.sin(t * 0.6)
    if (kite && world.enemies.live > 0) {
      let cx = 0
      let cy = 0
      const n = Math.min(world.enemies.live, 60)
      for (let i = 0; i < n; i++) { cx += world.enemies.items[i].x; cy += world.enemies.items[i].y }
      const dx = world.player.x - cx / n
      const dy = world.player.y - cy / n
      const d = Math.hypot(dx, dy) || 1
      // Bias back toward the arena centre so the bot doesn't pin itself on a wall.
      mx = dx / d + ((world.arenaW / 2 - world.player.x) / world.arenaW) * 1.5
      my = dy / d + ((world.arenaH / 2 - world.player.y) / world.arenaH) * 1.5
      const m = Math.hypot(mx, my) || 1
      mx /= m
      my /= m
    }

    world.step(STEP, mx, my, ticks % 400 === 0)
    ticks++

    if (pending > 0) {
      const chosen = pick(
        offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup'),
      )
      if (chosen) take(chosen)
      pending--
    }
    if (shopQueued) {
      shopQueued = false
      // The arena clears at a shop, as it does in the real loop.
      for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
      for (let s = 0; s < 4; s++) {
        const o = pick(offers.draw(world.player, 3, world.elapsed, world.player.stats.luck))
        if (o && world.player.feed >= o.cost) { world.player.feed -= o.cost; take(o) }
      }
    }
  }

  return {
    cleared: !world.over,
    waveReached: world.spawner.wave,
    level: world.player.level,
    kills: world.kills,
    weapons: world.player.weapons.length,
    maxTier: Math.max(...world.player.weapons.map((w) => w.tier)),
    items: world.player.items.length,
    seconds: world.elapsed,
  }
}

const SEEDS = [20260810, 4242, 555, 31337, 7, 99]

describe('a full run', () => {
  it('completes all 24 waves on most seeds, in about 17 minutes', () => {
    // Surveyed rather than pinned to one seed: a single seed passing proves
    // that seed, and balance work would silently start optimising for it.
    const results = SEEDS.map((s) => simulate(s, 'hand', pickSmart, true))
    const cleared = results.filter((r) => r.cleared)
    expect(cleared.length).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length / 2))

    for (const r of cleared) {
      // 24 waves x 40s = 960s.
      expect(r.seconds).toBeGreaterThan(900)
      expect(r.seconds).toBeLessThan(1000)
      expect(r.kills).toBeGreaterThan(1000)
      expect(r.maxTier).toBe(4)
    }
  }, 600_000)

  it('treats both classes comparably — neither is a trap pick', () => {
    // The Hand's -20% speed once left it clearing 1 seed in 6 while The Kid
    // cleared all 6. Whatever the enemy speeds are, that gap must not reopen.
    const hand = SEEDS.map((s) => simulate(s, 'hand', pickSmart, true)).filter((r) => r.cleared).length
    const kid = SEEDS.map((s) => simulate(s, 'kid', pickSmart, true)).filter((r) => r.cleared).length
    expect(Math.abs(hand - kid)).toBeLessThanOrEqual(2)
    expect(hand).toBeGreaterThan(0)
    expect(kid).toBeGreaterThan(0)
  }, 600_000)

  it('does not complete with a build that takes nothing', () => {
    for (const seed of SEEDS) {
      const r = simulate(seed, 'hand', pickNothing, true)
      expect(r.cleared).toBe(false)
      expect(r.waveReached).toBeLessThan(WAVES.waveCount)
    }
  }, 600_000)

  it('rewards build quality — merging beats taking whatever came up', () => {
    const smart = simulate(4242, 'hand', pickSmart, false)
    const random = simulate(4242, 'hand', pickFirst, false)
    expect(smart.maxTier).toBeGreaterThanOrEqual(random.maxTier)
    expect(smart.waveReached).toBeGreaterThanOrEqual(random.waveReached)
  }, 300_000)

  it('replays a whole run identically from its seed', () => {
    const a = simulate(31337, 'hand', pickSmart, true)
    const b = simulate(31337, 'hand', pickSmart, true)
    expect(a).toEqual(b)
  }, 300_000)
})
