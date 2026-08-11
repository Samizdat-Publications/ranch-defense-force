/**
 * Fixed-capacity object pool.
 *
 * Entities are allocated once at construction and never again — the hot loop
 * must not allocate. Live objects occupy [0, live); freeing swaps the freed
 * slot with the last live one and decrements. That makes `free` O(1) but means
 * **iteration order is not stable**, so always iterate in reverse when you may
 * free during the walk:
 *
 *   for (let i = pool.live - 1; i >= 0; i--) { ... pool.free(i) ... }
 */
export class Pool<T extends { active: boolean }> {
  readonly items: T[]
  readonly capacity: number
  /** Number of active items; they are items[0..live-1]. */
  live = 0
  /** Highest `live` seen, for the dev overlay. */
  peak = 0
  /** Times an acquire failed because the pool was full. */
  starved = 0

  constructor(capacity: number, make: () => T) {
    this.capacity = capacity
    this.items = new Array(capacity)
    for (let i = 0; i < capacity; i++) {
      const it = make()
      it.active = false
      this.items[i] = it
    }
  }

  /**
   * Returns the next free item, already marked active, or null if full.
   * The caller is responsible for resetting every field it cares about —
   * pooled objects keep their previous values.
   */
  acquire(): T | null {
    if (this.live >= this.capacity) {
      this.starved++
      return null
    }
    const it = this.items[this.live++]
    it.active = true
    if (this.live > this.peak) this.peak = this.live
    return it
  }

  /** Free by index. Swap-pop: the item at `live-1` moves into `index`. */
  free(index: number): void {
    const last = --this.live
    const it = this.items[index]
    it.active = false
    if (index !== last) {
      this.items[index] = this.items[last]
      this.items[last] = it
    }
  }

  clear(): void {
    for (let i = 0; i < this.live; i++) this.items[i].active = false
    this.live = 0
  }

  resetStats(): void {
    this.peak = this.live
    this.starved = 0
  }
}
