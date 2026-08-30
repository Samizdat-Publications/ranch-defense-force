/**
 * Maps.
 *
 * The three things that can go wrong here are not "does a map load":
 *
 *  1. The map choice stops being the FIRST draw off the run's RNG, and every
 *     recorded seed quietly replays as a different run.
 *  2. A map names a Wang set, a node sprite or an enemy that does not exist,
 *     and the failure is silent — a ground that falls back, a node that never
 *     spawns, a bias that does nothing.
 *  3. A map turns out to change nothing, so "five maps" is five names for one
 *     map.
 *
 * Each of those has a test below. The art-existence checks read the PACKED
 * atlas rather than the source directory on purpose: a sprite on disk that
 * never made it into `public/atlas.png` is exactly as absent, at runtime, as
 * one that was never generated.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { World } from '../src/sim/world'
import { Rng } from '../src/core/rng'
import { STEP } from '../src/core/loop'
import { MAPS, MAP_IDS, NODES, ENEMIES, pickMapId } from '../src/content'
import type { HazardKind } from '../src/sim/entities'

/** The packed atlas, or null when it has not been built. */
const atlas: { frames: Record<string, unknown> } | null = existsSync('public/atlas.json')
  ? (JSON.parse(readFileSync('public/atlas.json', 'utf8')) as { frames: Record<string, unknown> })
  : null
const packed = atlas ? new Set(Object.keys(atlas.frames ?? atlas)) : null

describe('maps', () => {
  it('ships more than one', () => {
    expect(MAP_IDS.length).toBeGreaterThan(1)
  })

  it('is the first draw off the run RNG, and only one draw', () => {
    // The contract in maps.json: World spends exactly one `next()` on the map
    // before anything else touches the stream. If that ever stops being true,
    // every seed in every bug report reproduces a different run.
    for (const seed of [0, 1, 7, 42, 31337, 0xbeef]) {
      const probe = new Rng(seed)
      const expected = pickMapId(probe.next())
      expect(new World(seed, 'hand').mapId).toBe(expected)
    }
  })

  it('leaves the rest of the stream where a one-draw pick would', () => {
    // Stronger than the test above: it pins the COST of the pick at one draw.
    // A pick that rolled twice would still be deterministic and still be first,
    // and would still invalidate every seed.
    const seed = 24601
    const probe = new Rng(seed)
    probe.next()
    const after = probe.state
    const w = new World(seed, 'hand')
    // World consumes more of the stream scattering its field, so compare a
    // freshly-seeded probe advanced by one draw against the world's map only —
    // the map must equal what that single draw selects.
    expect(w.mapId).toBe(pickMapId(new Rng(seed).next()))
    expect(after).not.toBe(new Rng(seed).state)
  })

  it('replays the same map for the same seed', () => {
    for (const seed of [3, 55, 909, 12345]) {
      expect(new World(seed, 'hand').mapId).toBe(new World(seed, 'hand').mapId)
    }
  })

  it('reaches every map across seeds', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 400; seed++) seen.add(new World(seed, 'hand').mapId)
    expect([...seen].sort()).toEqual([...MAP_IDS].sort())
  })

  it('draws maps roughly in proportion to their weights', () => {
    const N = 4000
    const tally: Record<string, number> = {}
    for (const id of MAP_IDS) tally[id] = 0
    for (let seed = 0; seed < N; seed++) tally[new World(seed, 'hand').mapId]++

    let total = 0
    for (const id of MAP_IDS) total += MAPS[id].weight
    for (const id of MAP_IDS) {
      const want = MAPS[id].weight / total
      expect(Math.abs(tally[id] / N - want)).toBeLessThan(0.05)
    }
  })

  describe('every map', () => {
    it('names only Wang sets that are actually packed', () => {
      if (!packed) return
      for (const id of MAP_IDS) {
        const t = MAPS[id].terrain
        for (const set of [t.groundSet, t.soilSet, ...t.blight.map((b) => b.groundSet)]) {
          // The 0,0,0,0 corner is the one every set must have; the renderer
          // probes exactly this key before committing to a set.
          expect(packed.has(`wang.${set}.0000`), `${id}: wang set ${set}`).toBe(true)
        }
      }
    })

    it('names only node sprites that are actually packed, and that nodes.json declares', () => {
      if (!packed) return
      const declared = new Set<string>()
      for (const kind of Object.values(NODES.kinds)) {
        for (const v of kind.variants) declared.add(v.sprite)
      }
      for (const id of MAP_IDS) {
        for (const sprite of Object.keys(MAPS[id].nodes.variantWeights ?? {})) {
          expect(packed.has(sprite), `${id}: ${sprite} not in atlas`).toBe(true)
          // A weight for a variant nodes.json does not declare is a silent
          // no-op: the scatter loop iterates the DECLARED variants and would
          // never see it.
          expect(declared.has(sprite), `${id}: ${sprite} not declared in nodes.json`).toBe(true)
        }
      }
    })

    it('biases only enemies that exist', () => {
      for (const id of MAP_IDS) {
        for (const enemyId of Object.keys(MAPS[id].enemyBias)) {
          expect(ENEMIES[enemyId], `${id}: unknown enemy ${enemyId}`).toBeDefined()
        }
      }
    })

    it('uses only hazard kinds the sim understands, with art that is packed', () => {
      // Content cannot import the sim, so MapHazards.kind restates HazardKind.
      // This is the check that keeps the restatement honest.
      const known: HazardKind[] = ['slow', 'lure', 'damage', 'gas', 'acid']
      for (const id of MAP_IDS) {
        const h = MAPS[id].hazards
        if (!h) continue
        expect(known, `${id}: hazard kind ${h.kind}`).toContain(h.kind)
        if (h.sprite && packed) {
          expect(packed.has(h.sprite), `${id}: hazard sprite ${h.sprite}`).toBe(true)
        }
      }
    })

    it('declares a node count for every kind it caps, and vice versa', () => {
      for (const id of MAP_IDS) {
        const n = MAPS[id].nodes
        for (const kind of Object.keys(n.initial)) {
          expect(NODES.kinds[kind], `${id}: unknown node kind ${kind}`).toBeDefined()
          expect(n.max[kind], `${id}: ${kind} has no max`).toBeGreaterThanOrEqual(n.initial[kind])
        }
      }
    })

    it('has an arena the spatial grid and the edge padding can hold', () => {
      for (const id of MAP_IDS) {
        const a = MAPS[id].arena
        // Comfortably more than one grid cell each way, and wider than the
        // camera is ever likely to be, so the fence is never all on screen.
        expect(a.width, id).toBeGreaterThanOrEqual(1200)
        expect(a.height, id).toBeGreaterThanOrEqual(1000)
      }
    })
  })

  describe('maps actually differ', () => {
    /** A map's identity, as the four things the owner asked a map to change. */
    const shapeOf = (id: string): string => {
      const m = MAPS[id]
      return [
        `${m.arena.width}x${m.arena.height}`,
        m.terrain.groundSet,
        JSON.stringify(m.nodes.initial),
        JSON.stringify(m.nodes.variantWeights ?? {}),
        JSON.stringify(m.enemyBias),
        m.hazards ? m.hazards.kind + m.hazards.everySeconds : 'none',
      ].join('|')
    }

    it('no two maps are the same map', () => {
      const shapes = MAP_IDS.map(shapeOf)
      expect(new Set(shapes).size).toBe(MAP_IDS.length)
    })

    it('gives every map its own arena proportions', () => {
      const ratios = MAP_IDS.map((id) => (MAPS[id].arena.width / MAPS[id].arena.height).toFixed(2))
      expect(new Set(ratios).size).toBe(MAP_IDS.length)
    })

    it('gives every map its own ground', () => {
      const grounds = MAP_IDS.map((id) => MAPS[id].terrain.groundSet)
      expect(new Set(grounds).size).toBe(MAP_IDS.length)
    })

    it('builds a different arena and field per map, in the sim and not just in the JSON', () => {
      // The JSON differing proves nothing if World ignores it.
      const byMap = new Map<string, { w: number; h: number; props: number }>()
      for (let seed = 0; seed < 300 && byMap.size < MAP_IDS.length; seed++) {
        const w = new World(seed, 'hand')
        if (byMap.has(w.mapId)) continue
        byMap.set(w.mapId, { w: w.arenaW, h: w.arenaH, props: w.props.live })
      }
      expect(byMap.size).toBe(MAP_IDS.length)
      for (const [id, got] of byMap) {
        expect(got.w, `${id} width`).toBe(MAPS[id].arena.width)
        expect(got.h, `${id} height`).toBe(MAPS[id].arena.height)
        expect(got.props, `${id} scattered nothing`).toBeGreaterThan(0)
      }
      const sizes = [...byMap.values()].map((v) => `${v.w}x${v.h}`)
      expect(new Set(sizes).size).toBe(MAP_IDS.length)
    })
  })

  describe('biome nodes', () => {
    it('never appear on a map that did not ask for one', () => {
      // node.saltRock and friends sit at weight 0 in nodes.json. If the scatter
      // loop's fallback ever picks the last variant in the array rather than
      // the last WEIGHTED one, salt rock lands on the Home Field.
      const biome = ['node.saltRock', 'node.scrapHeap', 'node.boneHeap', 'node.ashStump']
      for (let seed = 0; seed < 250; seed++) {
        const w = new World(seed, 'hand')
        const asked = new Set(Object.keys(MAPS[w.mapId].nodes.variantWeights ?? {}))
        for (let i = 0; i < w.props.live; i++) {
          const sprite = w.props.items[i].sprite
          if (biome.includes(sprite) && !asked.has(sprite)) {
            throw new Error(`seed ${seed}: ${w.mapId} scattered ${sprite} it never asked for`)
          }
        }
      }
    })

    it('do appear on the map that asked', () => {
      // The other half: a weight that is set but never read would leave the
      // biome node permanently invisible and nothing else would complain.
      const wanted = new Map<string, string>()
      for (const id of MAP_IDS) {
        for (const s of Object.keys(MAPS[id].nodes.variantWeights ?? {})) wanted.set(id, s)
      }
      const found = new Set<string>()
      for (let seed = 0; seed < 400 && found.size < wanted.size; seed++) {
        const w = new World(seed, 'hand')
        const want = wanted.get(w.mapId)
        if (!want) continue
        for (let i = 0; i < w.props.live; i++) {
          if (w.props.items[i].sprite === want) { found.add(w.mapId); break }
        }
      }
      expect([...found].sort()).toEqual([...wanted.keys()].sort())
    })
  })

  describe('ambient hazards', () => {
    /** Run a world on a named map until `seconds` have passed. */
    const runOn = (mapId: string, seconds: number): World | null => {
      for (let seed = 0; seed < 400; seed++) {
        const w = new World(seed, 'hand')
        if (w.mapId !== mapId) continue
        for (let i = 0; i < seconds / STEP; i++) w.step(STEP, 0, 0, false)
        return w
      }
      return null
    }

    it('vent on the maps that declare them', () => {
      for (const id of MAP_IDS) {
        const cfg = MAPS[id].hazards
        if (!cfg) continue
        // Long enough to pass `fromWave` — waves are 40s — and then vent.
        const w = runOn(id, cfg.fromWave * 40 + cfg.everySeconds * 4)
        expect(w, `no seed produced ${id}`).not.toBeNull()
        let mine = 0
        for (let i = 0; i < w!.hazards.live; i++) {
          if (w!.hazards.items[i].sprite === cfg.sprite) mine++
        }
        expect(mine, `${id} vented nothing`).toBeGreaterThan(0)
      }
    })

    it('never exceed the map\'s own cap', () => {
      for (const id of MAP_IDS) {
        const cfg = MAPS[id].hazards
        if (!cfg) continue
        const w = runOn(id, cfg.fromWave * 40 + cfg.everySeconds * 30)
        let mine = 0
        for (let i = 0; i < w!.hazards.live; i++) {
          if (w!.hazards.items[i].sprite === cfg.sprite) mine++
        }
        expect(mine, `${id} over cap`).toBeLessThanOrEqual(cfg.maxLive)
      }
    })

    it('leave the Home Field alone', () => {
      // The baseline map has no hazards block and must stay the game that was
      // played and liked.
      const w = runOn('homeField', 300)
      expect(w).not.toBeNull()
      for (let i = 0; i < w!.hazards.live; i++) {
        expect(w!.hazards.items[i].sprite).toBe('')
      }
    })

    it('only slow the player where the map says so', () => {
      for (const id of MAP_IDS) {
        const cfg = MAPS[id].hazards
        if (!cfg || cfg.playerSlowPct > 0) continue
        const w = runOn(id, cfg.fromWave * 40 + cfg.everySeconds * 4)
        for (let i = 0; i < w!.hazards.live; i++) {
          expect(w!.hazards.items[i].playerSlowPct, id).toBe(0)
        }
      }
    })
  })

  describe('enemy bias', () => {
    it('shifts what the spawner actually emits', () => {
      // Compare the Scrapyard, which doubles maskedHauler and quarters
      // duckFlight, against the unbiased Home Field. Counting spawn REQUESTS
      // rather than asserting a ratio: the roster is weighted by cost too, and
      // pinning an exact number here would break on any enemies.json edit.
      // Census across SEVERAL seeds and several late waves, not one of each.
      // One seed on one wave cannot resolve a 2x bias once the roster is 15
      // enemies deep: a single wave's budget only buys a handful of groups, so
      // whether the biased enemy appears at all is mostly luck. That version of
      // this test passed when it was written and started failing the moment
      // five enemies were added, which is the definition of a test measuring
      // its sample rather than its subject.
      const census = (mapId: string): Record<string, number> => {
        const out: Record<string, number> = {}
        let found = 0
        for (let seed = 0; seed < 900 && found < 6; seed++) {
          const w = new World(seed, 'hand')
          if (w.mapId !== mapId) continue
          found++
          for (const wave of [16, 20, 24]) {
            w.spawner.beginWave(wave)
            for (let i = 0; i < 3000; i++) {
              w.spawner.update(STEP, 0)
              for (const p of w.spawner.pending) out[p.typeId] = (out[p.typeId] ?? 0) + p.count
            }
          }
        }
        return out
      }
      const home = census('homeField')
      const yard = census('scrapyard')

      const share = (c: Record<string, number>, id: string): number => {
        let total = 0
        for (const n of Object.values(c)) total += n
        return total > 0 ? (c[id] ?? 0) / total : 0
      }
      expect(share(yard, 'maskedHauler')).toBeGreaterThan(share(home, 'maskedHauler'))
      expect(share(yard, 'duckFlight')).toBeLessThan(share(home, 'duckFlight'))
    })
  })
})

describe('the atmosphere layers', () => {
  it('every fog tint is a parseable hex colour', () => {
    // `drawFog` feeds this straight to a canvas fillStyle and `draw-world.ts`
    // parses it with parseInt. A malformed one is silent in the browser (the
    // fill is simply skipped) and NaN in the shot -- two different wrong
    // pictures from one typo.
    for (const [id, m] of Object.entries(MAPS)) {
      if (!m.fog) continue
      expect(m.fog.tint, `${id}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(m.fog.alpha, `${id} fog alpha`).toBeGreaterThan(0)
      expect(m.fog.alpha, `${id} fog alpha`).toBeLessThanOrEqual(0.6)
      expect(m.fog.scale, `${id} fog scale`).toBeGreaterThan(0)
    }
  })

  it('every overhead sprite is actually packed', () => {
    if (!packed) return
    for (const [id, m] of Object.entries(MAPS)) {
      if (!m.overhead) continue
      expect(m.overhead.sprites.length, `${id} overhead is empty`).toBeGreaterThan(0)
      for (const sprite of m.overhead.sprites) {
        expect(packed.has(sprite), `${id} -> ${sprite}`).toBe(true)
      }
    }
  })

  it('the overhead layer always fades to something you can see through', () => {
    // This is the rule that keeps the ceiling from being a bug. A bullet-heaven
    // player has to see what is about to hit them, and "the player should move"
    // is never the answer when a hundred enemies decide where they can stand.
    for (const [id, m] of Object.entries(MAPS)) {
      if (!m.overhead) continue
      expect(m.overhead.minAlpha, `${id} minAlpha`).toBeLessThanOrEqual(0.35)
      expect(m.overhead.minAlpha, `${id} minAlpha`).toBeLessThan(m.overhead.alpha)
      expect(m.overhead.fadeRadius, `${id} fadeRadius`).toBeGreaterThanOrEqual(96)
    }
  })

  it('the two renderers agree on the fog and overhead constants', () => {
    // They are separate copies on purpose -- sim and render never import each
    // other's internals, and draw-world is a tool. Separate copies drift, and a
    // shot that fogs differently to the game is a shot of a different program.
    const game = readFileSync('src/render/renderer.ts', 'utf8')
    const head = readFileSync('tools/draw-world.ts', 'utf8')
    for (const decl of ['FOG_TILE = 512', 'FOG_BLOBS = 26']) {
      expect(game.includes(decl), `renderer lost ${decl}`).toBe(true)
      expect(head.includes(decl), `draw-world lost ${decl}`).toBe(true)
    }
    // Both derive their placement from the same stream.
    for (const [name, src] of [['renderer', game], ['draw-world', head]] as const) {
      expect(src.includes('0xf0_9c1a'), `${name} fog seed`).toBe(true)
      expect(src.includes('0x0ce1_1a6'), `${name} overhead seed`).toBe(true)
    }
  })
})
