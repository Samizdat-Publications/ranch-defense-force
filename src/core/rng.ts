/**
 * Seeded RNG. Every random decision in the game goes through one of these so a
 * run replays identically from its seed. `Math.random()` must never appear in
 * src/ — see CLAUDE.md.
 */
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** mulberry32 — small, fast, good enough distribution for a game. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /**
   * Weighted pick. `weights` must be the same length as `items` and sum > 0.
   * Returns index, so callers can avoid allocating a parallel array.
   */
  weightedIndex(weights: readonly number[]): number {
    let total = 0
    for (let i = 0; i < weights.length; i++) total += weights[i]
    let roll = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return i
    }
    return weights.length - 1
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = items[i]
      items[i] = items[j]
      items[j] = tmp
    }
    return items
  }

  /** Snapshot/restore so sub-systems can fork deterministically if needed. */
  get state(): number {
    return this.s
  }
  set state(v: number) {
    this.s = v >>> 0
  }
}

/** Turn a human-typed seed ("whitacre") into a uint32. */
export function seedFromString(text: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
