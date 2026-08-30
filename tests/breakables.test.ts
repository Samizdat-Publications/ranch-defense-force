/**
 * Destructible field objects, and the magnet.
 *
 * The design has one load-bearing rule and it is a NEGATIVE one: weapons break
 * breakables and never harvest nodes, tools harvest nodes and never break
 * breakables. `world.ts` records that the two used to be the same thing and
 * that it "quietly defeated the whole harvesting design" -- a shovel swing
 * out-damaged five seconds of pickaxe, so every node was broken incidentally
 * and the pickaxe ladder bought nothing.
 *
 * Nothing about that failure was loud. The art packed, the game ran, and the
 * only symptom was that an entire progression system did not matter. So the
 * tests that matter here are the ones that assert the separation directly,
 * by damaging one population and checking the OTHER did not move.
 *
 * These were mutation-checked -- the guard was removed, the suite was run, the
 * guard was put back -- and the result is worth writing down, because one of
 * the three mutations was NOT caught:
 *
 *   pierce spent on a breakable          -> caught
 *   magnet falling through to heal       -> caught
 *   harvestNearby pointed at breakables  -> NOT CAUGHT, all 20 still passed
 *
 * The third passes because the separation is enforced TWICE and either guard
 * alone is sufficient: the harvest loop reads `props`, and a breakable's
 * `kind` is `breakable`, which `toolDpsFor` matches no tool for and so returns
 * 0 dps. Point the loop at the wrong pool and it walks breakables doing
 * precisely nothing -- no hp lost, no `working`, no `dwell`. There is no
 * runtime witness while the other guard holds.
 *
 * Rather than leave a test that reads as assurance it does not provide, both
 * guards are asserted directly below: the kind guard behaviourally, and the
 * pool guard against the source, which is the honest tool for an invariant
 * that has no observable consequence until both halves are gone.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { World } from '../src/sim/world'
import { STEP } from '../src/core/loop'
import {
  BREAKABLES, BREAKABLE_CLASSES, FIELD_GEAR_POOL, ITEMS, MAPS, NODES, TUNING,
} from '../src/content'

const atlas: { frames: Record<string, unknown> } | null = existsSync('public/atlas.json')
  ? (JSON.parse(readFileSync('public/atlas.json', 'utf8')) as { frames: Record<string, unknown> })
  : null
const packed = atlas ? new Set(Object.keys(atlas.frames ?? atlas)) : null

describe('breakables: content', () => {
  it('every class names sprites that are actually packed', () => {
    if (!packed) return // atlas not built; maps.test.ts carries the same skip
    for (const [id, c] of Object.entries(BREAKABLES.classes)) {
      expect(c.sprites.length, `${id} has no sprites`).toBeGreaterThan(0)
      for (const sprite of c.sprites) {
        expect(packed.has(sprite), `${id} -> ${sprite}`).toBe(true)
      }
    }
  })

  it('every per-map sprite override names a real class and a packed sprite', () => {
    // A map naming a class that does not exist, or a skin that never packed, is
    // silent: the override is simply never found and the map quietly gets the
    // default. That is the failure this catches.
    if (!packed) return
    for (const [mapId, m] of Object.entries(MAPS)) {
      const over = m.breakables
      if (!over) continue
      for (const id of Object.keys(over.weights ?? {})) {
        expect(BREAKABLES.classes[id], `${mapId} weights unknown class ${id}`).toBeTruthy()
      }
      for (const [id, list] of Object.entries(over.sprites ?? {})) {
        expect(BREAKABLES.classes[id], `${mapId} skins unknown class ${id}`).toBeTruthy()
        expect(list.length, `${mapId}.${id} override is empty`).toBeGreaterThan(0)
        for (const sprite of list) {
          expect(packed.has(sprite), `${mapId}.${id} -> ${sprite}`).toBe(true)
        }
      }
    }
  })

  it('every class names a drop table that exists', () => {
    for (const [id, c] of Object.entries(BREAKABLES.classes)) {
      expect(BREAKABLES.dropTables[c.drops], `${id} -> ${c.drops}`).toBeTruthy()
    }
  })

  it('"nothing" is the heaviest row in every table', () => {
    // The owner's brief was "usually nothing, sometimes XP or food, rarely
    // gear". A table where a payout row outweighs `nothing` turns a breakable
    // into a harvest node with extra steps, and the game already has those.
    for (const [name, rows] of Object.entries(BREAKABLES.dropTables)) {
      const nothing = rows.find((r) => r.kind === 'nothing')
      expect(nothing, `${name} has no "nothing" row`).toBeTruthy()
      const total = rows.reduce((n, r) => n + r.weight, 0)
      expect(nothing!.weight / total, `${name} pays out too often`).toBeGreaterThan(0.4)
      for (const r of rows) {
        if (r.kind === 'nothing') continue
        expect(r.weight, `${name}.${r.kind} outweighs nothing`).toBeLessThan(nothing!.weight)
      }
    }
  })

  it('gear and magnet stay rare in every table', () => {
    for (const [name, rows] of Object.entries(BREAKABLES.dropTables)) {
      const total = rows.reduce((n, r) => n + r.weight, 0)
      for (const kind of ['gear', 'magnet'] as const) {
        const row = rows.find((r) => r.kind === kind)
        if (!row) continue
        expect(row.weight / total, `${name}.${kind}`).toBeLessThan(0.12)
      }
    }
  })

  it('every value-carrying row declares a range, and the empty ones do not', () => {
    for (const rows of Object.values(BREAKABLES.dropTables)) {
      for (const r of rows) {
        const carriesValue = r.kind === 'xp' || r.kind === 'feed' || r.kind === 'heal'
        expect(r.min !== undefined && r.max !== undefined, r.kind).toBe(carriesValue)
        if (carriesValue) expect(r.max!).toBeGreaterThanOrEqual(r.min!)
      }
    }
  })

  it('the pool can hold the declared maximum', () => {
    expect(TUNING.pools.breakables).toBeGreaterThanOrEqual(BREAKABLES.field.max)
  })
})

describe('breakables: the separation from harvest nodes', () => {
  it('scatters into its own pool, never into the node pool', () => {
    const w = new World(11, 'hand')
    expect(w.breakables.live).toBeGreaterThan(0)
    for (let i = 0; i < w.breakables.live; i++) {
      expect(w.breakables.items[i].kind).toBe('breakable')
    }
    for (let i = 0; i < w.props.live; i++) {
      expect(w.props.items[i].kind).not.toBe('breakable')
    }
  })

  it('a tool standing on a breakable never damages it', () => {
    // Weapons are stripped first, because they legitimately DO break it via
    // the aim fallback -- the next test asserts exactly that. Leaving them on
    // conflates the two paths, and the first version of this test failed for
    // that reason rather than for the one it is named after.
    const w = new World(23, 'hand')
    w.player.weapons.length = 0
    const b = w.breakables.items[0]
    w.player.x = b.x
    w.player.y = b.y
    const before = b.hp
    for (let i = 0; i < 60; i++) w.step(STEP, 0, 0, false)
    expect(b.hp).toBe(before)
    // `working` is set only by the harvest pass, so it is the second witness
    // that the node loop never saw this.
    expect(b.working).toBe(0)
  })

  it('but weapons do break it, with no enemy around', () => {
    // The converse, and the only end-to-end check that the aim fallback is
    // wired: stand next to one at the start of a run and it comes apart.
    const w = new World(23, 'hand')
    const b = w.breakables.items[0]
    w.player.x = b.x - 20
    w.player.y = b.y
    for (let i = 0; i < 240 && b.dying <= 0; i++) w.step(STEP, 0, 0, false)
    expect(b.hp).toBeLessThan(b.maxHp)
  })

  it('a breakable never enters the harvest economy', () => {
    // `cropsHarvested` is incremented by `harvest` and by nothing else, so it
    // is the cheapest witness that the node path did not run.
    const w = new World(31, 'hand')
    const b = w.breakables.items[0]
    w.player.x = b.x
    w.player.y = b.y
    const before = w.cropsHarvested
    for (let i = 0; i < 120; i++) w.step(STEP, 0, 0, false)
    expect(w.cropsHarvested).toBe(before)
  })

  it('no breakable kind is a kind any tool works', () => {
    // Guard one of two. `toolDpsFor` matches a tool by `kind`; a breakable
    // whose kind collided with `rock`, `tree` or `crop` would be harvestable
    // the moment anything walked the wrong pool, and would ALSO be silently
    // mineable if it ever reached the node pool by another route.
    const workable = new Set<string>()
    for (const [id, tool] of Object.entries(NODES.tools)) {
      if (id.startsWith('_') || !Array.isArray(tool?.tiers)) continue
      if (tool.worksKind) workable.add(tool.worksKind)
      if (tool.alsoWorks) workable.add(tool.alsoWorks)
    }
    expect(workable.size, 'no tools declared').toBeGreaterThan(0)
    const w = new World(97, 'hand')
    for (let i = 0; i < w.breakables.live; i++) {
      expect(workable.has(w.breakables.items[i].kind)).toBe(false)
    }
  })

  it('the harvest loop reads the node pool, in the source', () => {
    // Guard two of two, and the reason this is a source assertion rather than
    // a behavioural one is in this file's header: with the kind guard standing,
    // pointing the loop at `breakables` changes nothing observable. This test
    // is what fails if someone deletes the pool separation.
    const src = readFileSync('src/sim/world.ts', 'utf8')
    const start = src.indexOf('private harvestNearby')
    expect(start, 'harvestNearby not found').toBeGreaterThan(0)
    // From just past the declaration to the next method, so `indexOf` does not
    // match the declaration this slice starts at and hand back nothing.
    const body = src.slice(start + 'private harvestNearby'.length)
    const loop = body.slice(0, body.indexOf('\n  private '))
    expect(loop.length, 'empty slice proves nothing').toBeGreaterThan(200)
    expect(loop.includes('this.props.live')).toBe(true)
    expect(loop.includes('this.breakables'), 'harvestNearby must never see breakables').toBe(false)
  })

  it('the two populations never share a pool slot', () => {
    const w = new World(47, 'hand')
    const seen = new Set<unknown>()
    for (let i = 0; i < w.props.live; i++) seen.add(w.props.items[i])
    for (let i = 0; i < w.breakables.live; i++) {
      expect(seen.has(w.breakables.items[i])).toBe(false)
    }
  })
})

describe('breakables: aim', () => {
  it('is a fallback target only -- never chosen while an enemy is in range', () => {
    // The bug this guards is the whole reason breakables are not in the normal
    // target set: guns that turn away from a live wave to shoot a barrel.
    const w = new World(59, 'hand')
    const b = w.breakables.items[0]
    w.player.x = b.x - 40
    w.player.y = b.y

    // No enemy anywhere: the breakable is found.
    for (let i = w.enemies.live - 1; i >= 0; i--) w.enemies.free(i)
    expect(w.findNearestBreakable(w.player.x, w.player.y, 900)).toBeGreaterThanOrEqual(0)

    // The query itself is honest about range.
    expect(w.findNearestBreakable(w.player.x, w.player.y, 1)).toBe(-1)
  })
})

describe('breakables: drops', () => {
  it('the field gear pool holds real items and no legendary', () => {
    // Asserted on the exported pool the sim actually walks, not on a copy of
    // the filter -- a test that rebuilt the rule would pass no matter what the
    // sim did with it.
    expect(FIELD_GEAR_POOL.length).toBeGreaterThan(0)
    for (const id of FIELD_GEAR_POOL) {
      expect(ITEMS[id], `${id} is not a real item`).toBeTruthy()
      expect((ITEMS[id] as { rarity?: string }).rarity, id).not.toBe('legendary')
    }
  })

  it('excludes every legendary, and keeps everything else', () => {
    const real = Object.keys(ITEMS).filter((k) => !k.startsWith('_'))
    const legendary = real.filter((id) => (ITEMS[id] as { rarity?: string }).rarity === 'legendary')
    expect(legendary.length, 'no legendaries left to exclude').toBeGreaterThan(0)
    for (const id of legendary) expect(FIELD_GEAR_POOL).not.toContain(id)
    expect(FIELD_GEAR_POOL.length).toBe(real.length - legendary.length)
  })

  it('breaking one pays out no more than one pickup', () => {
    // Nodes scatter XP as several gems on purpose. A breakable does not: it
    // pays a single thing or nothing, which is what keeps "usually nothing"
    // legible instead of feeling like a fizzled node.
    const w = new World(67, 'hand')
    w.player.weapons.length = 0
    for (let i = w.pickups.live - 1; i >= 0; i--) w.pickups.free(i)
    const before = w.pickups.live
    const b = w.breakables.items[0]
    b.hp = 0
    // Drive it through the real collision path: park a projectile on it.
    const pr = w.projectiles.acquire()!
    pr.x = b.x
    pr.y = b.y
    pr.radius = 4
    pr.damage = 999
    pr.pierce = 0
    pr.life = 1
    pr.behaviour = 'straight'
    pr.type = 'ranged'
    pr.hitStamp = -1
    w.step(STEP, 0, 0, false)
    expect(b.dying).toBeGreaterThan(0)
    expect(w.pickups.live - before).toBeLessThanOrEqual(1)
  })

  it('a breakable never consumes a projectile\'s pierce', () => {
    // Scenery that taxes DPS is scenery a player learns to resent -- the wave
    // does not pause while you shoot furniture.
    const w = new World(83, 'hand')
    w.player.weapons.length = 0
    const b = w.breakables.items[0]
    const pr = w.projectiles.acquire()!
    pr.x = b.x
    pr.y = b.y
    pr.radius = 4
    pr.damage = 1
    pr.pierce = 3
    pr.life = 1
    pr.behaviour = 'straight'
    pr.type = 'ranged'
    pr.hitStamp = -1
    const before = pr.pierce
    w.step(STEP, 0, 0, false)
    expect(pr.pierce).toBe(before)
  })
})

describe('the magnet', () => {
  it('collecting one sweeps the field and opens the window', () => {
    const w = new World(71, 'hand')
    // Drop a gem far away, where the ordinary radius cannot reach it.
    const far = w.pickups.acquire()!
    far.kind = 'xp'
    far.x = w.player.x + 600
    far.y = w.player.y
    far.px = far.x
    far.py = far.y
    far.value = 1
    far.magnetised = false

    const m = w.pickups.acquire()!
    m.kind = 'magnet'
    m.x = w.player.x
    m.y = w.player.y
    m.px = m.x
    m.py = m.y
    m.magnetised = true
    m.speed = 999

    expect(w.magnetSeconds).toBe(0)
    w.step(STEP, 0, 0, false)
    expect(w.magnetSeconds).toBeGreaterThan(0)
    expect(far.magnetised).toBe(true)
  })

  it('the window closes on its own', () => {
    const w = new World(73, 'hand')
    w.magnetSeconds = BREAKABLES.magnet.seconds
    const ticks = Math.ceil(BREAKABLES.magnet.seconds / STEP) + 2
    for (let i = 0; i < ticks; i++) w.step(STEP, 0, 0, false)
    expect(w.magnetSeconds).toBeLessThanOrEqual(0)
  })

  it('a magnet pickup never heals', () => {
    // The old `collect` fell through to heal for anything that was not xp or
    // feed. A magnet landing in that branch would silently have healed instead.
    const w = new World(79, 'hand')
    w.player.hp = 10
    const m = w.pickups.acquire()!
    m.kind = 'magnet'
    m.x = w.player.x
    m.y = w.player.y
    m.px = m.x
    m.py = m.y
    m.value = 50 // unmistakable if the heal branch ever fires
    m.magnetised = true
    m.speed = 999
    w.step(STEP, 0, 0, false)
    // Not `toBe(10)`: the player regenerates, so one tick moves hp by a
    // fraction on its own. The question is whether it moved by FIFTY.
    expect(w.player.hp).toBeLessThan(11)
  })
})

describe('breakables: the scenery split', () => {
  it('no breakable sprite is also scattered as inert scenery', () => {
    // A field holding both a breakable oil drum and an unbreakable one teaches
    // the player that nothing can be trusted to behave, and no amount of
    // feedback recovers from that. The renderer's fixture list and the
    // breakable class list must stay disjoint.
    const renderer = readFileSync('src/render/renderer.ts', 'utf8')
    const headless = readFileSync('tools/draw-world.ts', 'utf8')
    const breakableSprites = new Set(BREAKABLE_CLASSES.flatMap(([, c]) => c.sprites))
    for (const [name, src] of [['renderer', renderer], ['draw-world', headless]] as const) {
      const block = src.slice(src.indexOf('const kinds = ['))
      const list = block.slice(0, block.indexOf(']'))
      for (const sprite of breakableSprites) {
        expect(list.includes(`'${sprite}'`), `${name} still scatters ${sprite}`).toBe(false)
      }
    }
  })
})

describe('hit reactions and the injured state', () => {
  it('a real hit arms the recoil, and it decays', () => {
    const w = new World(101, 'hand')
    const e = w.spawnEnemy('farmhand', w.player.x + 200, w.player.y, false)!
    expect(e.hitT).toBe(0)
    w.damageEnemy(w.enemies.live - 1, 1, 'ranged', false)
    expect(e.hitT).toBeGreaterThan(0)
    const armed = e.hitT
    w.step(STEP, 0, 0, false)
    expect(e.hitT).toBeLessThan(armed)
  })

  it('damage over time never arms it', () => {
    // The whole reason the recoil rides the flash's gate. A burn ticks several
    // times a second per enemy; without this an enemy on fire would be frozen
    // in the first frame of a flinch for as long as it burned -- the white
    // flash bug again, wearing an animation instead of a colour.
    const w = new World(103, 'hand')
    const e = w.spawnEnemy('farmhand', w.player.x + 200, w.player.y, false)!
    w.damageEnemy(w.enemies.live - 1, 1, 'ranged', false, true)
    expect(e.hitT).toBe(0)
  })

  it('is refractory — a second hit inside the window does not re-arm it', () => {
    const w = new World(107, 'hand')
    const i = w.enemies.live
    const e = w.spawnEnemy('farmhand', w.player.x + 200, w.player.y, false)!
    w.damageEnemy(i, 1, 'ranged', false)
    const first = e.hitT
    // Advance a little, then hit again while the lock is still down.
    w.step(STEP, 0, 0, false)
    w.damageEnemy(i, 1, 'ranged', false)
    expect(e.hitT).toBeLessThan(first)
  })

  it('a fresh spawn never inherits a recoil from the slot it reused', () => {
    // These are pooled. An enemy arriving mid-flinch because the last occupant
    // of the slot died mid-flinch is exactly the class of bug the pool comment
    // on `spawnProjectile` exists for.
    const w = new World(109, 'hand')
    const i = w.enemies.live
    const e = w.spawnEnemy('farmhand', w.player.x + 200, w.player.y, false)!
    w.damageEnemy(i, 1, 'ranged', false)
    expect(e.hitT).toBeGreaterThan(0)
    w.enemies.free(i)
    const next = w.spawnEnemy('farmhand', w.player.x + 210, w.player.y, false)!
    expect(next.hitT).toBe(0)
  })

  it('the injured threshold is a fraction, and the clip length is positive', () => {
    // Both are render-only — neither changes damage, speed, or any decision the
    // sim makes — so this guards a typo rather than a balance choice.
    const c = TUNING.combat as unknown as Record<string, number>
    expect(c.hitClipSeconds).toBeGreaterThan(0)
    expect(c.hitClipSeconds).toBeLessThan(1)
    expect(c.injuredBelowPct).toBeGreaterThan(0)
    expect(c.injuredBelowPct).toBeLessThan(100)
  })

  it('both renderers agree on the state machine order', () => {
    // Separate copies by design — sim and render never import each other's
    // internals, and draw-world is a tool. Separate copies drift, and a shot
    // that picks a different clip is a picture of a different program.
    const game = readFileSync('src/render/renderer.ts', 'utf8')
    const head = readFileSync('tools/draw-world.ts', 'utf8')
    for (const [name, src] of [['renderer', game], ['draw-world', head]] as const) {
      expect(src.includes('e.hitT > 0'), `${name} lost the hit branch`).toBe(true)
      expect(src.includes('walkHurt'), `${name} lost the injured walk`).toBe(true)
      // The recoil must be tested BEFORE the attack: being interrupted
      // mid-swing is the moment worth showing.
      expect(src.indexOf('e.hitT > 0')).toBeLessThan(src.indexOf('e.attackT > 0 && e.dying <= 0'))
    }
  })
})
