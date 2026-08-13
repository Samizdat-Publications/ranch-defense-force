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

    // Stand the player on a node and let the tools do the work.
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

  /**
   * M5's promise: the cards advertise tier riders, so a higher tier must
   * actually do more. Before M5 most riders were text and several tiers were
   * indistinguishable in play.
   */
  describe('weapon tier riders', () => {
    /**
     * Damage a weapon puts out at a tier, against a ring of dummies that cannot
     * die.
     *
     * The indestructibility is the point. Topping a ring back up as enemies die
     * measures throughput *and* how long replacements take to walk in, and
     * those pull against each other: a stronger tier clears faster, then stands
     * idle waiting, and scores lower. That artifact made a T2 axe look worse
     * than a T1 one. Freezing the targets isolates the only thing this test is
     * asking about.
     */
    function output(weaponId: string, tier: number, seed: number, moving: boolean): number {
      const w = new World(seed, 'hand')
      w.player.weapons.length = 0
      w.player.addWeapon(weaponId, 0)
      const slot = w.player.weapons.find((s2) => s2.id === weaponId)
      if (!slot) throw new Error(`no slot for ${weaponId}`)
      slot.tier = tier
      for (let i = 0; i < 900; i++) {
        while (w.enemies.live < 16) {
          const a = (w.enemies.live / 16) * Math.PI * 2
          w.spawnEnemy('farmhand', w.player.x + Math.cos(a) * 120, w.player.y + Math.sin(a) * 120, false)
        }
        for (let k = 0; k < w.enemies.live; k++) {
          const e = w.enemies.items[k]
          e.hp = 1e9
          e.maxHp = 1e9
        }
        const t = i * STEP
        w.step(STEP, moving ? Math.cos(t * 0.6) : 0, moving ? Math.sin(t * 0.6) : 0, false)
      }
      return w.damageDealt
    }

    const seeds = [3, 11, 29]
    const mean = (id: string, tier: number, moving: boolean): number =>
      seeds.reduce((s2, sd) => s2 + output(id, tier, sd, moving), 0) / seeds.length

    // Every weapon is measured standing. The axe used to need measuring on the
    // move to look like it worked at all; its orbit now tightens as you slow,
    // so it earns its keep in either stance and needs no special case.
    const MOVERS = new Set<string>()
    // Grain Lure has no base damage at all: it is a pull, and its T2 is
    // duration. It earns its place at T3, where it detonates.
    const DAMAGE_WEAPONS = [
      'pitchfork', 'scythe', 'chemSprayer', 'harpoon', 'scattergun', 'grenadeLauncher',
      'varmintRifle', 'drumGun', 'tarBomb', 'sledge', 'barnDog',
    ]

    for (const id of DAMAGE_WEAPONS) {
      it(`${id}: every tier outperforms the one below it`, () => {
        const moving = MOVERS.has(id)
        const t = [1, 2, 3, 4].map((tier) => mean(id, tier, moving))
        expect(t[0], `${id} T1 must do something`).toBeGreaterThan(0)
        expect(t[1], `${id} T2 (${t[1]}) must beat T1 (${t[0]})`).toBeGreaterThan(t[0])
        expect(t[2], `${id} T3 (${t[2]}) must beat T2 (${t[1]})`).toBeGreaterThan(t[1])
        expect(t[3], `${id} T4 (${t[3]}) must beat T3 (${t[2]})`).toBeGreaterThan(t[2])
      })
    }

    it('grainLure only deals damage once it detonates at T3', () => {
      expect(mean('baitDrum', 2, false)).toBe(0)
      expect(mean('baitDrum', 3, false)).toBeGreaterThan(0)
      expect(mean('baitDrum', 4, false)).toBeGreaterThan(mean('baitDrum', 3, false))
    })

    it('the axe deals damage at all, standing or moving', () => {
      // Two regressions in one weapon. The blade stamped its hits with a
      // constant -1, which is the value spawnEnemy leaves in e.t1, so the
      // "already hit" guard was true before it touched anything and the axe
      // dealt zero damage in every run ever played. And once it did hit, a
      // fixed 74px orbit swept clear over enemies pressed to ~25px, so it only
      // worked at a sprint.
      expect(output('scythe', 1, 3, false), 'standing').toBeGreaterThan(0)
      expect(output('scythe', 1, 3, true), 'moving').toBeGreaterThan(0)
    })
  })

  it('burns, and a burn kills on its own', () => {
    const w = new World(21, 'hand')
    const e = w.spawnEnemy('farmhand', w.player.x + 300, w.player.y, false)
    if (!e) throw new Error('no enemy')
    e.hp = 40
    w.applyBurn(e, 20, 4)
    const start = e.hp
    for (let i = 0; i < 60; i++) w.step(STEP, 0, 0, false)
    expect(e.hp).toBeLessThan(start)
    for (let i = 0; i < 240; i++) w.step(STEP, 0, 0, false)
    expect(w.kills).toBeGreaterThan(0)
  })

  it('a mark makes the target take more', () => {
    const bare = new World(22, 'hand')
    const marked = new World(22, 'hand')
    const runs = [bare, marked].map((w, idx) => {
      const e = w.spawnEnemy('farmhand', w.player.x + 40, w.player.y, false)
      if (!e) throw new Error('no enemy')
      e.hp = 100000
      if (idx === 1) w.applyMark(e, 100, 99)
      w.damageEnemy(0, 100, 'ranged', false)
      return 100000 - e.hp
    })
    expect(runs[1]).toBeGreaterThan(runs[0])
  })

  it('acid pools and gas clouds hurt the player', () => {
    // These spawned and rendered but were harmless before M5 — the pool was the
    // acid zombie's entire point.
    for (const kind of ['acid', 'gas'] as const) {
      const w = new World(23, 'hand')
      const h = w.spawnHazard()
      if (!h) throw new Error('no hazard')
      h.kind = kind
      h.x = w.player.x
      h.y = w.player.y
      h.radius = 120
      h.maxLife = 5
      h.life = 5
      h.playerDps = 10
      const before = w.player.hp
      for (let i = 0; i < 120; i++) w.step(STEP, 0, 0, false)
      expect(w.player.hp, `${kind} must hurt`).toBeLessThan(before)
    }
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
