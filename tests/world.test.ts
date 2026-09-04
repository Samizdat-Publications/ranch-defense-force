/**
 * Headless world tests. The sim imports nothing from render/ or ui/, which is
 * what lets these run with no DOM at all — that boundary is a non-negotiable
 * in CLAUDE.md and this file is what keeps it honest.
 */
import { describe, expect, it } from 'vitest'
import { ENEMIES, WAVES } from '../src/content'
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

  describe('bosses', () => {
    it('never lets the wave director spawn one', () => {
      // Bosses carry threatCost 0 so the budget cannot refuse them, which means
      // leaving them in the spawner roster let the director pick the Prize Bull
      // like any other enemy — free, and without limit. Every bot run died on
      // wave one.
      const w = new World(5, 'hand')
      for (let i = 0; i < 3600; i++) w.step(STEP, 1, 0, false)
      for (let i = 0; i < w.enemies.live; i++) {
        expect(ENEMIES[w.enemies.items[i].typeId]?.boss ?? false).toBe(false)
      }
    })

    it('spawns the Prize Bull on its wave, and only one', () => {
      const w = new World(6, 'hand')
      expect(w.findBoss()).toBeNull()
      w.spawnBoss('prizeBull')
      const boss = w.findBoss()
      expect(boss, 'a boss must be on the field').not.toBeNull()
      expect(boss?.typeId).toBe('prizeBull')
      expect(boss!.maxHp).toBeGreaterThan(500)
    })

    it('the Duster patrols without ever chasing, and lays gas', () => {
      // §9's whole idea for phase 1: it does not know you exist. If this ever
      // starts homing, the fight has become the Bull with more health.
      const w = new World(11, 'hand')
      w.spawnBoss('duster')
      const b = w.findBoss()
      expect(b).not.toBeNull()
      // Park the player far off its lane; it must not close on them.
      w.player.x = 200
      w.player.y = 1400
      const startGap = Math.hypot(b!.x - w.player.x, b!.y - w.player.y)
      let travelled = 0
      for (let i = 0; i < 60 * 10; i++) {
        const px = b!.x
        w.step(STEP, 0, 0, false)
        travelled += Math.abs(b!.x - px)
      }
      expect(travelled, 'it must actually drive').toBeGreaterThan(200)
      expect(w.hazards.live, 'it must lay a gas strip').toBeGreaterThan(0)
      const endGap = Math.hypot(b!.x - w.player.x, b!.y - w.player.y)
      expect(endGap, 'it must not close on the player in phase 1')
        .toBeGreaterThan(startGap * 0.6)
    })

    it('burns the arena inward to about a third, and only in phase 2', () => {
      const w = new World(12, 'hand')
      w.spawnBoss('duster')
      const b = w.findBoss()!
      expect(w.arenaBurnInset, 'no burn before phase 2').toBe(0)
      expect(w.insideArena(4, 4)).toBe(true)

      b.hp = b.maxHp * 0.4
      for (let i = 0; i < 60 * 95; i++) {
        w.player.hp = w.player.stats.maxHp // measuring the burn, not survival
        w.step(STEP, 0, 0, false)
      }
      const shorter = Math.min(w.arenaW, w.arenaH)
      const remaining = shorter - w.arenaBurnInset * 2
      expect(remaining / shorter, 'roughly a third of the field left')
        .toBeGreaterThan(0.28)
      expect(remaining / shorter).toBeLessThan(0.42)
      expect(w.insideArena(4, 4), 'the corners must have burned').toBe(false)
      expect(w.insideArena(w.arenaW / 2, w.arenaH / 2), 'the middle must not').toBe(true)
    })

    it('makes wave 25 reachable at all', () => {
      // Section 9 puts the Duster on wave 25 while waveCount was 24, so the run
      // finished the instant wave 24 completed and wave 25 never began — the
      // final boss could not be fought.
      expect(WAVES.waveCount).toBeGreaterThanOrEqual(
        Math.max(...Object.keys(WAVES.bossWaves as Record<string, string>).map(Number)),
      )
    })
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

/**
 * The Smudge Pot — docs/UPGRADE_ROSTER.md batch 1's aura weapon.
 *
 * The owner asked for "a floating ring around you that causes damage in a
 * radius around you and powers up with larger size area/circle or more
 * damage". The three things that can go wrong with one are all here: it can
 * spawn a hitbox per tick and eat the pool, it can fail to grow with the tier,
 * and it can be carried — which the farmhand's loadout has no answer for.
 */
describe('the aura weapon', () => {
  const equip = (w: World): void => {
    w.player.weapons.length = 0
    w.player.addWeapon('smudgePot')
  }

  const ringOf = (w: World): { x: number; y: number; radius: number; type: string; attached: boolean } | null => {
    for (let i = 0; i < w.projectiles.live; i++) {
      const p = w.projectiles.items[i]
      if (p.weaponId === 'smudgePot') return p
    }
    return null
  }

  it('keeps exactly one ring alive however long it runs', () => {
    const w = new World(11, 'hand')
    equip(w)
    for (let i = 0; i < 600; i++) w.step(STEP, 0, 0, false)
    let rings = 0
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'smudgePot') rings++
    }
    // One, not six hundred. A ring that spawned a hitbox per tick would fill
    // the pool inside ten seconds and starve every other weapon of a slot.
    expect(rings).toBe(1)
    const ring = ringOf(w)!
    expect(ring.type).toBe('aura')
    expect(ring.attached).toBe(true)
    // On the player, so it moves with him. That is the whole ask.
    expect(Math.hypot(ring.x - w.player.x, ring.y - w.player.y)).toBeLessThan(1)
  })

  it('kills things on its own', () => {
    const w = new World(12, 'hand')
    equip(w)
    for (let i = 0; i < 3600; i++) w.step(STEP, 0, 0, false)
    expect(w.kills).toBeGreaterThan(0)
  })

  it('grows its radius with the tier, which is the upgrade the card promises', () => {
    const radiusAt = (tier: number): number => {
      const w = new World(13, 'hand')
      equip(w)
      w.player.weapons[0].tier = tier
      for (let i = 0; i < 10; i++) w.step(STEP, 0, 0, false)
      return ringOf(w)?.radius ?? 0
    }
    const t1 = radiusAt(1)
    const t2 = radiusAt(2)
    expect(t1).toBeGreaterThan(0)
    expect(t2).toBeGreaterThan(t1)
    expect(radiusAt(4)).toBeGreaterThan(t2)
  })

  /*
   * The bug this test would have caught: `sustainAura` computed
   * `p.damage = damage * burn * interval`, which folds `hitInterval` into the
   * per-pass bite a SECOND time — `interval` already governs how often a pass
   * lands (the rearm above it), so multiplying it into the pass's size too
   * halved the delivered dps at every tier, silently, since the weapon
   * shipped. None of the three tests above catch it: "kills things on its
   * own" only asserts `kills > 0`, and half of a working dps still gets
   * there eventually against a wave-1 farmhand.
   *
   * `weapons.json`'s own tier table states the dps this weapon is supposed to
   * deal -- 10, 16, 41, 65.5 -- so the assertion is exact, not a floor.
   */
  it('deals the dps its own card states, at every tier', () => {
    const dpsAt = (tier: number): number => {
      const w = new World(15, 'hand')
      equip(w)
      w.player.weapons[0].tier = tier
      const e = w.spawnEnemy('farmhand', w.player.x, w.player.y, false)!
      e.hp = 1e9
      e.speed = 0 // stands still, so it never drifts out of the ring
      let dealt = 0
      const seconds = 6
      for (let i = 0; i < seconds * 60; i++) {
        const before = e.hp
        w.step(STEP, 0, 0, false)
        e.x = w.player.x
        e.y = w.player.y // pinned on the player, exactly like the ring itself
        dealt += Math.max(0, before - e.hp)
      }
      return dealt / seconds
    }
    expect(dpsAt(1)).toBeCloseTo(10, 1)
    expect(dpsAt(2)).toBeCloseTo(16, 1)
    expect(dpsAt(3)).toBeCloseTo(41, 1)
    expect(dpsAt(4)).toBeCloseTo(65.5, 1)
  })

  it('is carried by nothing, and the loadout copes', async () => {
    const { assignCarrySlots } = await import('../src/content')
    const w = new World(14, 'hand')
    equip(w)
    w.player.addWeapon('scattergun')
    const out: (string | null)[] = [null, null, null, null, null, null, null, null]
    assignCarrySlots(w.player.weapons, out as never, 'hand')
    // `carry: "none"` means the farmhand never tries to hang a smoking pot off
    // his belt — the same answer the Scythe and the Barn Dog already give, and
    // `assignCarrySlots` skips it without needing to know why.
    expect(out[0]).toBe(null)
    expect(out[1]).toBe('hand')
  })
})
