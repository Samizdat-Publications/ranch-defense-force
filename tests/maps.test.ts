/**
 * The maps, and the four properties that make them safe to add.
 *
 * `run.test.ts` pins every one of its runs to `home_quarter`, because a
 * six-seed comparison of two CLASSES should not also be comparing two sets of
 * arenas. That removed a confound and it also removed the only coverage the
 * maps had. This is that coverage, asking the questions that are actually about
 * maps rather than about classes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { CAVE_MAPS, MAPS, mapForSeed, NODES, SURFACE_MAPS, TUNING, WAVES } from '../src/content'
import { groundLayers } from '../src/render/terrain'
import { World } from '../src/sim/world'
import { OfferPool, type Offer } from '../src/sim/offers'
import { bankRun } from '../src/sim/meta'
import { emptySave } from '../src/sim/save'
import { STEP } from '../src/core/loop'

describe('maps', () => {
  it('every layer chains onto the base, so its terrains actually meet', () => {
    /*
       THE ONE MISTAKE THAT IS INVISIBLE UNTIL YOU LOOK AT THE GROUND.

       A Wang set is a PAIR of terrains. A layer painted over the base draws its
       own LOWER terrain in every transition tile, so if that lower is not the
       identical tile the base's upper is, the seam shows as a fringe of the
       wrong colour around every patch. `create_topdown_tileset` records the
       identity in `base_tile_ids`, and matching those ids is the whole check.

       The tilesets fall into two families on exactly this: everything hanging
       off `dirt_to_grass_plain`'s grass, and everything hanging off
       `dirt_to_grass`'s. Mixing them is the failure this catches.
    */
    const baseTiles = (set: string): { lower?: string; upper?: string } => {
      const path = `assets/tilesets/${set}.json`
      if (!existsSync(path)) return {}
      return (JSON.parse(readFileSync(path, 'utf8')) as {
        base_tile_ids?: { lower?: string; upper?: string }
      }).base_tile_ids ?? {}
    }

    for (const map of MAPS) {
      const base = map.layers[0]
      const ground = baseTiles(base.set).upper
      // Only assert where the tilesets are actually on disk; a clone without
      // them should not fail the suite.
      if (!ground) continue
      for (const layer of map.layers.slice(1)) {
        expect(baseTiles(layer.set).lower, `${map.id}: ${layer.set} does not chain onto ${base.set}`)
          .toBe(ground)
      }
      // Caves carry no blight — the ash is a thing that happens to a field.
      if (map.blight) {
        expect(baseTiles(map.blight).lower, `${map.id}: blight ${map.blight} does not chain onto ${base.set}`)
          .toBe(ground)
      }
    }
  })

  it('a layer cannot move the layers around it', () => {
    /*
       Each layer draws from `Rng(seed ^ salt + index * golden)` rather than
       walking one shared stream, so tuning layer 1 leaves layers 0 and 2 byte
       identical. A shared stream would make every field depend on the exact
       number of draws every field above it made — the same class of trap as the
       blight's draw-all-use-some rule, and invisible until someone edits a
       count and the whole map moves.
    */
    // A map with three layers where a MIDDLE one takes a count to bump. Not
    // every shape has one — `edges` and `ribbon` do not — and tweaking a key a
    // layer does not have is a no-op that would pass this test vacuously.
    const map = MAPS.find((m) => m.layers.length >= 3 && 'count' in m.layers[1])
    expect(map, 'need a map whose middle layer takes a count').toBeDefined()
    if (!map) return
    const target = 1

    const before = groundLayers(map, 12345, 60, 40)
    const tweaked = {
      ...map,
      layers: map.layers.map((l, i) =>
        i === target ? { ...l, count: (l as { count: number }).count + 3 } : l),
    }
    const after = groundLayers(tweaked, 12345, 60, 40)

    for (let i = 0; i < before.length; i++) {
      if (i === target) {
        expect(after[i].field, 'the edited layer must actually change')
          .not.toEqual(before[i].field)
      } else {
        expect(after[i].field, `layer ${i} moved when layer ${target} was edited`)
          .toEqual(before[i].field)
      }
    }
  })

  it('a ribbon stays in its lane instead of crossing the map diagonally', () => {
    /*
       THE BUG THIS EXISTS FOR. The first ribbon accumulated drift and clamped
       it, so once the drift hit its limit it stayed there: a "vertical" creek
       left at forty degrees and crossed a 2800x2000 field corner to corner, and
       a "horizontal" track arced from the bottom of the map to the top and back
       down. The walk is mean-reverting now — damping plus a pull toward the
       line it started on — and this is what says so.

       The bound is generous on purpose: a ribbon that never wandered would be a
       ruled line, which is the opposite failure.
    */
    const cols = 100
    const rows = 60
    const vw = cols + 1
    const vh = rows + 1
    const map = {
      id: 't', name: 't', blurb: '', width: cols * 32, height: rows * 32,
      blight: 'grass_to_blight',
      layers: [
        { set: 'dirt_to_grass_plain' as const, shape: 'fill' as const },
        { set: 'grass_to_water_v2' as const, shape: 'ribbon' as const, axis: 'h' as const, halfWidth: 1, wander: 0.3 },
      ],
    }

    // Several seeds: one lucky ribbon proves nothing about the walk.
    for (const seed of [1, 2, 3, 7, 11, 4242, 20260811]) {
      const [, ribbon] = groundLayers(map, seed, cols, rows)
      let min = vh
      let max = -1
      for (let vy = 0; vy < vh; vy++) {
        for (let vx = 0; vx < vw; vx++) {
          if (ribbon.field[vy * vw + vx]) { if (vy < min) min = vy; if (vy > max) max = vy }
        }
      }
      const spread = max - min
      expect(spread, `seed ${seed}: ribbon spans ${spread} of ${rows} rows`).toBeLessThan(rows * 0.5)
      // And it must actually cross: a ribbon pinned to one row is a ruled line.
      expect(spread, `seed ${seed}: ribbon is a straight line`).toBeGreaterThan(1)
    }
  })

  it('scatters the same DENSITY of nodes whatever size the map is', () => {
    /*
       Node counts in nodes.json are quoted against a reference area, because
       they are a density. This caught itself the hard way: maps landed with the
       counts still absolute, and a 1.75x arena with the same 74 nodes has 43%
       of the density, which starved the run economy and failed three acceptance
       tests at once.
    */
    // Against each map's OWN mix, because the caves name their own — measuring
    // a cave against the surface's crop count would only prove they differ.
    for (const m of MAPS) {
      const w = new World(1234, 'hand', undefined, undefined, m.id)
      const mix = m.nodes ?? NODES.field.initial
      const want = Object.values(mix).reduce((a, b) => a + b, 0)
        * ((m.width * m.height) / NODES.field.referenceArea)
      expect(
        Math.abs(w.props.live - want),
        `${m.id} scattered ${w.props.live}, its mix at this size wants about ${want.toFixed(0)}`,
      ).toBeLessThanOrEqual(6)
    }

    // And the pool has to be able to HOLD the biggest map's field. Too small is
    // not an error — acquire() returns null and the field is quietly short.
    const maxNodes = Object.values(NODES.field.max).reduce((a, b) => a + b, 0)
    const largest = Math.max(...MAPS.map((m) => m.width * m.height))
    const needed = Math.ceil(maxNodes * (largest / NODES.field.referenceArea))
    expect((TUNING as { pools: { props: number } }).pools.props).toBeGreaterThanOrEqual(needed)
  })

  it('gives the same seed the same map, and spreads seeds evenly across them', () => {
    for (const seed of [1, 4242, 31337, 20260811]) {
      expect(mapForSeed(seed).id).toBe(mapForSeed(seed).id)
      expect(new World(seed, 'hand').map.id).toBe(mapForSeed(seed).id)
    }
    // SURFACE maps only. A run starts on the farm; the caves are reached by
    // descending, never by the seed, and `mapForSeed` must never return one.
    const counts = new Map<string, number>()
    const N = 4000
    for (let i = 0; i < N; i++) {
      const m = mapForSeed(i * 7919 + 13)
      expect(m.kind ?? 'surface', `${m.id} was seeded into a run`).toBe('surface')
      counts.set(m.id, (counts.get(m.id) ?? 0) + 1)
    }
    const expected = N / SURFACE_MAPS.length
    for (const m of SURFACE_MAPS) {
      const got = counts.get(m.id) ?? 0
      expect(got, `${m.id} drawn ${got} times in ${N}, expected about ${expected}`)
        .toBeGreaterThan(expected * 0.75)
    }
    // And the caves are ordered, contiguous and 1-based, because `descend()`
    // asks for depth+1 and a gap would silently end the descent early.
    CAVE_MAPS.forEach((m, i) => expect(m.depth, `${m.id} is at depth ${m.depth}`).toBe(i + 1))
  })

  it('is playable on every map — none is a dead arena', () => {
    /*
       Deliberately a LOW bar. This is not a balance test — `npm run balance`
       measures that properly, over 24 seeds per configuration, and its numbers
       belong in NOTES rather than in an assertion. What this catches is a map
       that is broken outright: an arena so large the field is starved, a
       descriptor that scatters nothing, a size that makes the wave clock
       unreachable.
    */
    const pickSmart = (offers: Offer[]): Offer | undefined =>
      offers.find((o) => o.mergesTo !== null)
      ?? offers.find((o) => (o.mods.maxHp ?? 0) > 0 || (o.mods.armor ?? 0) > 0)
      ?? offers[0]

    for (const map of MAPS) {
      const waves: number[] = []
      for (const seed of [11, 2029, 777]) {
        const world = new World(seed, 'hand', undefined, undefined, map.id)
        const offers = new OfferPool(world.rng)
        let pending = 0
        world.events = { onLevelUp: (n) => { pending += n } }
        // Density, not headcount — The Seam is a third of the reference area
        // and 18 nodes on it is the same field as 50 on Home Quarter.
        expect(
          world.props.live / world.fieldDensity,
          `${map.id} scattered ${world.props.live} at density ${world.fieldDensity.toFixed(2)}`,
        ).toBeGreaterThan(35)

        let ticks = 0
        while (!world.over && world.spawner.wave <= WAVES.waveCount && ticks < 60 * 60 * 25) {
          const t = ticks * STEP
          world.step(STEP, Math.cos(t * 0.6), Math.sin(t * 0.6), ticks % 400 === 0)
          if (pending > 0) {
            const o = pickSmart(offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup'))
            if (o) {
              if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
              else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
            }
            pending--
          }
          ticks++
        }
        waves.push(world.spawner.wave)
      }
      const best = Math.max(...waves)
      expect(best, `${map.id} never got past wave ${best} on any of three seeds`).toBeGreaterThan(8)
    }
  }, 600_000)
})

describe('the descent', () => {
  /** Run a world to a wave boundary without ever pressing interact. */
  const runTo = (w: World, wave: number): void => {
    let ticks = 0
    while (w.spawner.wave < wave && !w.over && ticks < 60 * 60 * 30) {
      const t = ticks * STEP
      w.player.hp = w.player.stats.maxHp        // this is not a balance test
      w.step(STEP, Math.cos(t * 0.4), Math.sin(t * 0.31), false)
      ticks++
    }
  }

  it('opens no way down before its wave, and one after', () => {
    const w = new World(4242, 'hand', undefined, undefined, 'home_quarter')
    expect(w.depth).toBe(0)
    runTo(w, (WAVES as unknown as { descentFromWave: number }).descentFromWave)
    expect(w.descentPoint, 'a way down opened before descentFromWave').toBeNull()
    runTo(w, (WAVES as unknown as { descentFromWave: number }).descentFromWave + 1)
    expect(w.descentPoint, 'no way down after descentFromWave').not.toBeNull()
  })

  it('does not move the run: the same seed spawns the same way with it open', () => {
    /*
       THE BUG THIS EXISTS FOR, and the acceptance suite found it within the
       hour. `openDescent` drew its position from `world.rng`, which took up to
       twelve numbers off the stream at the wave-10 boundary and moved every
       spawn, drop and offer after it — two of six seeds cleared instead of
       five, with nothing about the descent itself wrong.

       It derives from the seed now, like `mapForSeed`, the terrain bake and the
       blight. This is the third time this project has paid for that rule.
    */
    const play = (): number[] => {
      const w = new World(31337, 'hand', undefined, undefined, 'home_quarter')
      runTo(w, 12)
      return [w.kills, w.player.level, Math.round(w.player.feed), w.spawner.wave]
    }
    expect(play()).toEqual(play())
  })

  it('needs a deliberate press — standing on it is not enough', () => {
    /*
       A one-way trip you can take by wandering across a 34px circle is a trap
       rather than a choice, and the acceptance bots proved it by falling in and
       dying two levels down. `step`'s interact argument defaults to false so
       every existing caller means "did not choose to".
    */
    const w = new World(4242, 'hand', undefined, undefined, 'home_quarter')
    runTo(w, (WAVES as unknown as { descentFromWave: number }).descentFromWave + 1)
    const d = w.descentPoint
    expect(d).not.toBeNull()
    if (!d) return

    w.player.x = d.x
    w.player.y = d.y
    for (let i = 0; i < 120; i++) w.step(STEP, 0, 0, false)
    expect(w.depth, 'descended without asking to').toBe(0)
    expect(w.onDescentPoint, 'standing on it should be reported').toBe(true)

    w.player.x = d.x
    w.player.y = d.y
    w.step(STEP, 0, 0, false, true)
    expect(w.depth, 'pressing interact on it did not descend').toBe(1)
  })

  it('rebuilds the field it lands in, and leaves nothing in the old arena', () => {
    const w = new World(4242, 'hand', undefined, undefined, 'home_quarter')
    runTo(w, (WAVES as unknown as { descentFromWave: number }).descentFromWave + 1)
    const d = w.descentPoint
    expect(d).not.toBeNull()
    if (!d) return

    const surfaceW = w.arenaW
    const surfaceH = w.arenaH
    const feed = w.player.feed
    const level = w.player.level

    w.player.x = d.x
    w.player.y = d.y
    w.step(STEP, 0, 0, false, true)

    const cave = CAVE_MAPS[0]
    expect(w.map.id).toBe(cave.id)
    expect(w.arenaW).toBe(cave.width)
    expect(w.arenaH).toBe(cave.height)
    expect(w.arenaW, 'a cave should be tighter than the field above it').toBeLessThan(surfaceW)
    expect(w.arenaH).toBeLessThan(surfaceH)

    // The player survives the trip; the field does not.
    expect(w.player.feed).toBeGreaterThanOrEqual(feed)
    expect(w.player.level).toBe(level)
    expect(w.enemies.live, 'enemies left behind in an arena that no longer exists').toBe(0)
    expect(w.props.live, 'the cave scattered no field').toBeGreaterThan(10)

    // NOTHING may be holding a coordinate outside the new arena — that is a
    // pool slot leaked per descent and an enemy that can never be reached.
    for (let i = 0; i < w.props.live; i++) {
      const p = w.props.items[i]
      expect(p.x, `prop ${i} is outside the cave`).toBeLessThanOrEqual(w.arenaW)
      expect(p.y).toBeLessThanOrEqual(w.arenaH)
    }
    expect(w.player.x).toBeLessThanOrEqual(w.arenaW)
    expect(w.player.y).toBeLessThanOrEqual(w.arenaH)
  })

  it('goes down exactly as far as there are caves, and no further', () => {
    const w = new World(1, 'hand', undefined, undefined, CAVE_MAPS[CAVE_MAPS.length - 1].id)
    expect(w.depth).toBe(CAVE_MAPS.length)
    expect(w.descend(), 'descended past the deepest cave').toBe(false)

    // And from the top, each level leads to the next.
    const top = new World(1, 'hand', undefined, undefined, 'home_quarter')
    for (const cave of CAVE_MAPS) {
      expect(top.descend()).toBe(true)
      expect(top.map.id).toBe(cave.id)
      expect(top.depth).toBe(cave.depth)
    }
    expect(top.descend()).toBe(false)
  })

  it('pays for depth, and only for depth', () => {
    const run = { wavesCleared: 12, bossKills: 1, tier: 1, cleared: false }
    const flat = bankRun(emptySave(), { ...run, depth: 0 }, 1, 'hand')
    const deep = bankRun(emptySave(), { ...run, depth: CAVE_MAPS.length }, 1, 'hand')
    expect(deep, 'descending must be worth something').toBeGreaterThan(flat)
    // An absent depth is the surface, so every existing caller is unchanged.
    expect(bankRun(emptySave(), run, 1, 'hand')).toBe(flat)
  })
})
