/**
 * Uniform spatial hash over the arena, 64px cells (CLAUDE.md: no AABB trees, no
 * physics library). Rebuilt every tick from scratch — clearing and refilling
 * flat typed arrays is cheaper than incremental maintenance at these counts.
 *
 * Storage is a counting-sort layout: `cellStart[c]` .. `cellStart[c+1]` indexes
 * into `entries`, which holds entity indices. No per-cell arrays, so no
 * allocation after construction.
 */
export const CELL_SIZE = 64

export class SpatialGrid {
  readonly cols: number
  readonly rows: number
  private readonly cellCount: number
  private readonly counts: Int32Array
  private readonly cellStart: Int32Array
  private readonly entries: Int32Array
  private readonly cursor: Int32Array
  private count = 0

  constructor(width: number, height: number, maxEntities: number) {
    this.cols = Math.ceil(width / CELL_SIZE) + 1
    this.rows = Math.ceil(height / CELL_SIZE) + 1
    this.cellCount = this.cols * this.rows
    this.counts = new Int32Array(this.cellCount)
    this.cellStart = new Int32Array(this.cellCount + 1)
    this.cursor = new Int32Array(this.cellCount)
    this.entries = new Int32Array(maxEntities)
  }

  private cellOf(x: number, y: number): number {
    let cx = (x / CELL_SIZE) | 0
    let cy = (y / CELL_SIZE) | 0
    if (cx < 0) cx = 0
    else if (cx >= this.cols) cx = this.cols - 1
    if (cy < 0) cy = 0
    else if (cy >= this.rows) cy = this.rows - 1
    return cy * this.cols + cx
  }

  /**
   * Rebuild from an array of positioned entities. `xs`/`ys` are read for the
   * first `n` entries, which must line up with the caller's own indices.
   */
  rebuild(xs: Float64Array, ys: Float64Array, n: number): void {
    this.count = n
    this.counts.fill(0)
    for (let i = 0; i < n; i++) this.counts[this.cellOf(xs[i], ys[i])]++

    let running = 0
    for (let c = 0; c < this.cellCount; c++) {
      this.cellStart[c] = running
      this.cursor[c] = running
      running += this.counts[c]
    }
    this.cellStart[this.cellCount] = running

    for (let i = 0; i < n; i++) {
      const c = this.cellOf(xs[i], ys[i])
      this.entries[this.cursor[c]++] = i
    }
  }

  /**
   * Collect indices within `radius` of (x, y) into `out`, returning how many
   * were written. Broad phase only — it returns everything in the overlapping
   * cells, so the caller still does the circle test. `out` is caller-owned and
   * reused; nothing is allocated here.
   */
  query(x: number, y: number, radius: number, out: Int32Array): number {
    if (this.count === 0) return 0
    const minCx = Math.max(0, ((x - radius) / CELL_SIZE) | 0)
    const maxCx = Math.min(this.cols - 1, ((x + radius) / CELL_SIZE) | 0)
    const minCy = Math.max(0, ((y - radius) / CELL_SIZE) | 0)
    const maxCy = Math.min(this.rows - 1, ((y + radius) / CELL_SIZE) | 0)

    let n = 0
    const cap = out.length
    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowBase = cy * this.cols
      for (let cx = minCx; cx <= maxCx; cx++) {
        const c = rowBase + cx
        const end = this.cellStart[c + 1]
        for (let e = this.cellStart[c]; e < end; e++) {
          if (n >= cap) return n
          out[n++] = this.entries[e]
        }
      }
    }
    return n
  }
}
