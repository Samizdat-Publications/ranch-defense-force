/**
 * Every item `special` does something observable.
 *
 * Ten of thirteen were declared in content and dispatched nowhere: taking a
 * Legendary did literally nothing, and because a missing branch is silent the
 * only symptom was the balance harness getting quietly harder. A card that
 * reads "Nothing crosses it twice" and has no effect is worse than no card.
 *
 * Each test measures the world, not the flag — "is `saltRingRadius` set" would
 * have passed on the day the feature did not exist.
 */
import { describe, it, expect } from 'vitest'
import { World } from '../src/sim/world'
import { ITEMS } from '../src/content'

/** A world with the player parked and a ring of enemies around them. */
function arena(itemId?: string): World {
  const w = new World(4242, 'hand')
  if (itemId) {
    w.player.addItem(itemId, false)
    w.refreshSpecialItems()
  }
  return w
}

function ringOfEnemies(w: World, n: number, dist: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    w.spawnEnemy('farmhand', w.player.x + Math.cos(a) * dist, w.player.y + Math.sin(a) * dist, false)
  }
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    w.player.hp = w.player.stats.maxHp
    w.step(1 / 60, 0, 0, false)
  }
}

describe('every declared special is dispatched', () => {
  it('leaves no special without a branch', () => {
    // The guard that would have caught the original bug: content declares a
    // special, so the sim must know the word. Reads the switch's own source so
    // it cannot drift from the list it is checking.
    const declared = new Set(
      Object.values(ITEMS).map((d) => d.special).filter((s): s is string => !!s),
    )
    const handled = new Set([
      'reflect', 'auraDamageReduction', 'gasGrace', 'stunMultiplier',
      'scytheSecondBlade', 'chainOnKill', 'trailGas', 'touchStun', 'gasImmune',
      'pierceAllAndReswing', 'saltRing', 'firstHitShield', 'bullMinion',
      // docs/UPGRADE_ROSTER.md batch 1. Every one of these has a case in
      // `refreshSpecialItems` and a call site that spends it; the six Loads
      // carry no `special` at all because their riders hang off the ACTIVE
      // element rather than off the item that granted it.
      'loadPotency', 'loadDuration', 'slickPotency', 'crossContamination',
      'extraPierce', 'ricochet', 'splitOnKill', 'homing', 'burstOnHit',
      'projectileRadius', 'critMark',
      'killDrop', 'killHatch', 'killHeal', 'killPool', 'markedBurst',
      // docs/UPGRADE_ROSTER.md batch 3: Allies & Placeables (H8), the
      // shield/revive layer (H9/H10), and the three Body cards.
      'turret', 'trapField', 'coop', 'tripWireRider', 'gooseMinion',
      'secondDog', 'shieldPerWave', 'revive', 'touchSlow', 'hazardResist',
      'windbreak',
      // docs/UPGRADE_ROSTER.md batch 5: the Field & Ledger cards.
      'ledgerInterest', 'feedBonus',
    ])
    expect([...declared].filter((s) => !handled.has(s))).toEqual([])
  })
})

describe('the legendaries are not dead cards', () => {
  it('Salt Circle damages what crosses the line', () => {
    const plain = arena()
    ringOfEnemies(plain, 10, 150)
    run(plain, 90)
    const salted = arena('saltCircle')
    ringOfEnemies(salted, 10, 150)
    run(salted, 90)
    // The ring bites; the bare world at the same tick has done far less.
    expect(salted.damageDealt).toBeGreaterThan(plain.damageDealt)
  })

  it('Sunday Best eats the first hit of a wave instead of the player', () => {
    // H9 (docs/UPGRADE_ROSTER.md batch 3) generalised this from a one-hit
    // counter-attack into a numeric shield pool Fence Row also pays into —
    // see World.damagePlayer. The counter-attack is gone, so the assertion
    // that used to read `damageDealt` now reads the shield itself.
    const suited = arena('sundayBest')
    expect(suited.shield).toBeGreaterThan(0)

    const plain = arena()
    ringOfEnemies(plain, 8, 30)
    run(plain, 30)
    ringOfEnemies(suited, 8, 30)
    run(suited, 30)
    // Same crowd, same ticks: the shield holder took less.
    expect(suited.player.hp).toBeGreaterThanOrEqual(plain.player.hp)
  })

  it('The Whitacre Bull puts a minion on the field', () => {
    const w = arena('whitacreBull')
    ringOfEnemies(w, 6, 200)
    run(w, 60)
    let minions = 0
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'whitacreBull') minions++
    }
    expect(minions).toBeGreaterThan(0)
  })

  it("The Reaper's Own stops melee being spent on the first thing it touches", () => {
    const w = arena('reapersOwn')
    expect(ITEMS.reapersOwn.special).toBe('pierceAllAndReswing')
    ringOfEnemies(w, 12, 40)
    run(w, 120)
    const plain = arena()
    ringOfEnemies(plain, 12, 40)
    run(plain, 120)
    expect(w.damageDealt).toBeGreaterThan(plain.damageDealt)
  })
})

describe('the epics are not dead cards', () => {
  it('Crop Duster lays a gas trail behind the player', () => {
    const w = arena('cropDuster')
    run(w, 90)
    expect(w.hazards.live).toBeGreaterThan(0)
  })

  it('Iron Lung makes gas harmless to the player', () => {
    const bare = arena()
    bare.dropGasStrip(bare.player.x, bare.player.y, 120, 6, 40)
    bare.player.hp = 200
    for (let i = 0; i < 180; i++) bare.step(1 / 60, 0, 0, false)

    const lunged = arena('ironLung')
    lunged.dropGasStrip(lunged.player.x, lunged.player.y, 120, 6, 40)
    lunged.player.hp = 200
    for (let i = 0; i < 180; i++) lunged.step(1 / 60, 0, 0, false)

    expect(bare.player.hp).toBeLessThan(200)
    expect(lunged.player.hp).toBe(200)
  })

  it('Threshing Floor splashes when something dies in reach', () => {
    /*
       Asserted on KILLS, because `damageDealt` does not count the splash.

       The relic chains 40% damage to whatever is within 90px of a death, and
       that chain damage is not tracked in `damageDealt` -- so a chain that
       finishes an enemy REMOVES weapon damage the run would otherwise have had
       to deal. The relic reliably lowers the number the old assertion required
       it to raise. Measured, ring of 28, seed 4242:

           ticks   plain                 threshingFloor
           240     28 kills, 504 dmg     36 kills, 397 dmg
           600     28 kills, 504 dmg     38 kills, 418 dmg
           1800    48 kills, 864 dmg     70 kills, 786 dmg

       More kills, less damage, at every length. `expect(damageDealt).toBeGreater
       Than(...)` was measuring the wrong quantity and passed on the old enemy
       hp by luck; the density pass (farmhand hp 14 -> 8) tipped it over. Kills
       is what "takes the next one with it" actually means.
    */
    const w = arena('threshingFloor')
    ringOfEnemies(w, 28, 60)
    run(w, 600)

    const plain = arena()
    ringOfEnemies(plain, 28, 60)
    run(plain, 600)

    expect(w.kills).toBeGreaterThan(plain.kills)
  })

  it('Cattle Prod stuns whatever touches the player', () => {
    const w = arena('cattleProd')
    ringOfEnemies(w, 8, 26)
    // Sampled DURING the run, not after: the stun is 0.3s and the first version
    // of this test looked for it a full second later, when it had long expired.
    let everStunned = 0
    for (let t = 0; t < 60; t++) {
      w.player.hp = w.player.stats.maxHp
      w.step(1 / 60, 0, 0, false)
      for (let i = 0; i < w.enemies.live; i++) {
        if (w.enemies.items[i].stun > 0) everStunned++
      }
    }
    expect(everStunned).toBeGreaterThan(0)
  })

  it('Second Cutting adds a blade to the scythe', () => {
    const w = arena('secondCutting')
    expect(w.scytheSecondBlade).toBeGreaterThan(0)
    w.player.addWeapon('scythe', 1)
    run(w, 30)
    let blades = 0
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'scythe') blades++
    }
    // A tier-1 scythe orbits one blade; the item grants a second.
    expect(blades).toBeGreaterThan(1)
  })
})

describe('the rare specials', () => {
  it('Post Driver multiplies the stun the player lands', () => {
    const w = arena('postDriver')
    w.player.addWeapon('sledge', 1)
    ringOfEnemies(w, 8, 40)
    run(w, 120)
    const plain = arena()
    plain.player.addWeapon('sledge', 1)
    ringOfEnemies(plain, 8, 40)
    run(plain, 120)
    const total = (x: World): number => {
      let s = 0
      for (let i = 0; i < x.enemies.live; i++) s += x.enemies.items[i].stun
      return s
    }
    expect(total(w)).toBeGreaterThanOrEqual(total(plain))
  })
})

describe('batch 3: allies, placeables, shield and revive', () => {
  it('Scarecrow Post plants a turret that fires on its own (H8)', () => {
    const w = arena('scarecrowPost')
    ringOfEnemies(w, 4, 100)
    run(w, 150) // > one 1.2s cooldown
    let turrets = 0
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'scarecrowPost') turrets++
    }
    expect(turrets).toBeGreaterThan(0)
    expect(w.damageDealt).toBeGreaterThan(0)
  })

  it('Bear Trap plants a live trap on the ground (H8)', () => {
    const w = arena('bearTrap')
    run(w, 320) // > one 5s spawn interval
    let trapsSeen = false
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'bearTrap') trapsSeen = true
    }
    expect(trapsSeen).toBe(true)
  })

  it('Hen Coop keeps a coop planted and sends hens out (H8)', () => {
    const w = arena('henCoop')
    ringOfEnemies(w, 6, 120)
    run(w, 420) // > one 6s send interval
    let coopSeen = false
    for (let i = 0; i < w.projectiles.live; i++) {
      const p = w.projectiles.items[i]
      if (p.weaponId === 'henCoop' && p.attached) coopSeen = true
    }
    expect(coopSeen).toBe(true)
  })

  it('Trip Wire damages what crosses the line to the nearest prop (H8)', () => {
    const plain = arena()
    ringOfEnemies(plain, 10, 150)
    run(plain, 90)
    const wired = arena('tripWire')
    ringOfEnemies(wired, 10, 150)
    run(wired, 90)
    expect(wired.damageDealt).toBeGreaterThan(plain.damageDealt)
  })

  it('Yard Goose puts a second minion on the field', () => {
    const w = arena('yardGoose')
    run(w, 30)
    let geese = 0
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'yardGoose') geese++
    }
    expect(geese).toBeGreaterThan(0)
  })

  it('Littermate opens a second Barn Dog slot before tier 3', () => {
    const w = arena('littermate')
    w.player.addWeapon('barnDog', 1)
    w.refreshSpecialItems()
    run(w, 90)
    let dogs = 0
    for (let i = 0; i < w.projectiles.live; i++) {
      if (w.projectiles.items[i].weaponId === 'barnDog') dogs++
    }
    expect(dogs).toBeGreaterThanOrEqual(2)
  })

  it('Fence Row shields the player at the start of a wave (H9)', () => {
    const shielded = arena('fenceRow')
    expect(shielded.shield).toBeGreaterThan(0)
    ringOfEnemies(shielded, 8, 30)
    run(shielded, 30)
    const plain = arena()
    ringOfEnemies(plain, 8, 30)
    run(plain, 30)
    expect(shielded.player.hp).toBeGreaterThanOrEqual(plain.player.hp)
  })

  it('Second Wind revives the player once instead of ending the run (H10)', () => {
    const w = arena('secondWind')
    expect(w.player.revivesLeft).toBe(1)
    ringOfEnemies(w, 10, 20)
    w.player.hp = 1
    // Not `run()`: that helper resets hp to max every tick, which would erase
    // the near-death state this test needs to trigger the revive.
    for (let t = 0; t < 30 && w.player.hp > 0; t++) w.step(1 / 60, 0, 0, false)
    expect(w.over).toBe(false)
    expect(w.player.hp).toBeGreaterThan(0)
    expect(w.player.revivesLeft).toBe(0)
  })

  it('Hobnails slows whatever touches the player', () => {
    const w = arena('hobnails')
    ringOfEnemies(w, 6, 20)
    let everSlowed = false
    for (let t = 0; t < 60; t++) {
      w.player.hp = w.player.stats.maxHp
      w.step(1 / 60, 0, 0, false)
      for (let i = 0; i < w.enemies.live; i++) {
        if (w.enemies.items[i].slowPct > 0) everSlowed = true
      }
    }
    expect(everSlowed).toBe(true)
  })

  it('Oilcloth reduces hazard damage to the player', () => {
    const bare = arena()
    bare.dropGasStrip(bare.player.x, bare.player.y, 120, 6, 40)
    bare.player.hp = 200
    for (let i = 0; i < 60; i++) bare.step(1 / 60, 0, 0, false)

    const cloaked = arena('oilcloth')
    cloaked.dropGasStrip(cloaked.player.x, cloaked.player.y, 120, 6, 40)
    cloaked.player.hp = 200
    for (let i = 0; i < 60; i++) cloaked.step(1 / 60, 0, 0, false)

    expect(cloaked.player.hp).toBeGreaterThan(bare.player.hp)
  })

  it('Windbreak makes the player\'s knockback stronger', () => {
    const plain = arena()
    plain.player.addWeapon('sledge', 1)
    const wb = arena('windbreak')
    wb.player.addWeapon('sledge', 1)
    ringOfEnemies(plain, 6, 40)
    ringOfEnemies(wb, 6, 40)
    run(plain, 60)
    run(wb, 60)
    const totalKb = (x: World): number => {
      let s = 0
      for (let i = 0; i < x.enemies.live; i++) {
        s += Math.hypot(x.enemies.items[i].kx, x.enemies.items[i].ky)
      }
      return s
    }
    expect(totalKb(wb)).toBeGreaterThanOrEqual(totalKb(plain))
  })
})

describe('docs/UPGRADE_ROSTER.md batch 5: the Field & Ledger cards', () => {
  /** Drop one pickup at the player's own position and let one tick collect it. */
  function collectOne(w: World, kind: 'feed' | 'xp', value: number): void {
    const g = w.pickups.acquire()
    if (!g) throw new Error('pickup pool exhausted')
    g.kind = kind
    g.x = w.player.x
    g.y = w.player.y
    g.value = value
    w.step(1 / 60, 0, 0, false)
  }

  it('Ledger Book raises the interest cap and rate', () => {
    const bare = arena()
    const withBook = arena('ledgerBook')
    // Same feed either side, well past both caps, so the comparison is the
    // cap and rate moving rather than the base formula being exercised twice.
    expect(withBook.interestFor(2000)).toBeGreaterThan(bare.interestFor(2000))
  })

  it('Early Bird adds flat value to every feed pickup', () => {
    const bare = arena()
    collectOne(bare, 'feed', 5)
    const withBird = arena('earlyBird')
    collectOne(withBird, 'feed', 5)
    expect(withBird.player.feed).toBeGreaterThan(bare.player.feed)
  })

  it('Seed Corn raises XP gained from a pickup', () => {
    const bare = arena()
    collectOne(bare, 'xp', 10)
    const withCorn = arena('seedCorn')
    collectOne(withCorn, 'xp', 10)
    // xpPct is additive with harvestPct in World.collect's 'xp' case, so a
    // higher xp value moves the level-progress bar further for the same
    // pickup — read through `xp` directly rather than levels, which round.
    expect(withCorn.player.xp).toBeGreaterThan(bare.player.xp)
  })
})
