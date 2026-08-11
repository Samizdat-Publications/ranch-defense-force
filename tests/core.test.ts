import { describe, expect, it } from 'vitest'
import { Rng, seedFromString } from '../src/core/rng'
import { Pool } from '../src/core/pool'
import { SpatialGrid } from '../src/core/spatial'

describe('Rng', () => {
  it('replays identically from the same seed', () => {
    const a = new Rng(12345)
    const b = new Rng(12345)
    for (let i = 0; i < 500; i++) expect(a.next()).toBe(b.next())
  })

  it('diverges on different seeds', () => {
    const a = new Rng(1)
    const b = new Rng(2)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).not.toEqual(seqB)
  })

  it('stays inside [0,1)', () => {
    const r = new Rng(99)
    for (let i = 0; i < 5000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int() covers an inclusive range', () => {
    const r = new Rng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 4))
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('weightedIndex respects zero weights', () => {
    const r = new Rng(3)
    for (let i = 0; i < 200; i++) {
      expect(r.weightedIndex([0, 1, 0])).toBe(1)
    }
  })

  it('seedFromString is stable and case sensitive', () => {
    expect(seedFromString('whitacre')).toBe(seedFromString('whitacre'))
    expect(seedFromString('whitacre')).not.toBe(seedFromString('Whitacre'))
  })
})

describe('Pool', () => {
  interface Thing { active: boolean; id: number }
  const make = (): Thing => ({ active: false, id: -1 })

  it('acquires up to capacity then reports starvation', () => {
    const p = new Pool<Thing>(3, make)
    expect(p.acquire()).not.toBeNull()
    expect(p.acquire()).not.toBeNull()
    expect(p.acquire()).not.toBeNull()
    expect(p.acquire()).toBeNull()
    expect(p.starved).toBe(1)
    expect(p.live).toBe(3)
  })

  it('keeps every live item reachable after a swap-pop free', () => {
    const p = new Pool<Thing>(5, make)
    for (let i = 0; i < 5; i++) p.acquire()!.id = i
    // Free from the middle; the last live item should move into the hole.
    p.free(1)
    expect(p.live).toBe(4)
    const ids = p.items.slice(0, p.live).map((t) => t.id).sort((a, b) => a - b)
    expect(ids).toEqual([0, 2, 3, 4])
    for (let i = 0; i < p.live; i++) expect(p.items[i].active).toBe(true)
  })

  it('survives reverse-iterating and freeing every item', () => {
    const p = new Pool<Thing>(10, make)
    for (let i = 0; i < 10; i++) p.acquire()!.id = i
    for (let i = p.live - 1; i >= 0; i--) p.free(i)
    expect(p.live).toBe(0)
    expect(p.items.every((t) => !t.active)).toBe(true)
  })

  it('tracks peak', () => {
    const p = new Pool<Thing>(4, make)
    p.acquire(); p.acquire(); p.acquire()
    p.free(0)
    expect(p.peak).toBe(3)
    expect(p.live).toBe(2)
  })
})

describe('SpatialGrid', () => {
  it('finds entities inside the query radius', () => {
    const g = new SpatialGrid(640, 640, 100)
    const xs = new Float64Array([10, 100, 300, 605])
    const ys = new Float64Array([10, 100, 300, 605])
    g.rebuild(xs, ys, 4)

    const out = new Int32Array(64)
    const n = g.query(10, 10, 40, out)
    const found = Array.from(out.slice(0, n))
    expect(found).toContain(0)
    expect(found).not.toContain(2)
  })

  it('returns everything when the radius spans the arena', () => {
    const g = new SpatialGrid(320, 320, 50)
    const xs = new Float64Array([5, 150, 300])
    const ys = new Float64Array([5, 150, 300])
    g.rebuild(xs, ys, 3)
    const out = new Int32Array(64)
    const n = g.query(160, 160, 400, out)
    expect(n).toBe(3)
  })

  it('handles an empty rebuild', () => {
    const g = new SpatialGrid(320, 320, 50)
    g.rebuild(new Float64Array(0), new Float64Array(0), 0)
    const out = new Int32Array(8)
    expect(g.query(100, 100, 100, out)).toBe(0)
  })

  it('clamps out-of-bounds positions instead of writing out of range', () => {
    const g = new SpatialGrid(320, 320, 10)
    const xs = new Float64Array([-500, 9999])
    const ys = new Float64Array([-500, 9999])
    expect(() => g.rebuild(xs, ys, 2)).not.toThrow()
    const out = new Int32Array(8)
    expect(g.query(0, 0, 40, out)).toBeGreaterThan(0)
  })

  it('never writes past the output buffer the caller supplied', () => {
    const g = new SpatialGrid(320, 320, 200)
    const n = 100
    const xs = new Float64Array(n).fill(160)
    const ys = new Float64Array(n).fill(160)
    g.rebuild(xs, ys, n)
    const out = new Int32Array(8)
    expect(g.query(160, 160, 64, out)).toBeLessThanOrEqual(8)
  })
})
