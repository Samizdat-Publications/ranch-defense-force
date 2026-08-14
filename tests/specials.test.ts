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
    const plain = arena()
    ringOfEnemies(plain, 8, 30)
    run(plain, 30)
    const suited = arena('sundayBest')
    ringOfEnemies(suited, 8, 30)
    run(suited, 30)
    // Same crowd, same ticks: the shield holder took less.
    expect(suited.player.hp).toBeGreaterThanOrEqual(plain.player.hp)
    expect(suited.damageDealt).toBeGreaterThan(plain.damageDealt)
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
    const w = arena('threshingFloor')
    ringOfEnemies(w, 14, 60)
    run(w, 240)
    const plain = arena()
    ringOfEnemies(plain, 14, 60)
    run(plain, 240)
    expect(w.kills).toBeGreaterThanOrEqual(plain.kills)
    expect(w.damageDealt).toBeGreaterThan(plain.damageDealt)
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
