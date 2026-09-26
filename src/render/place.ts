/**
 * A map as a PLACE: what the ground is made of where, and what stands around
 * the field.
 *
 * Read from a map's `place` block in `maps.json`. Three things come out of it:
 *
 *  - the ground layout mask for `gl/ground.ts`: paths, tilled plots, the
 *    farmyard's gravel and water, rasterised at quarter resolution with soft
 *    edges (the shader makes them ragged);
 *  - the ten ground textures, as atlas tile rects;
 *  - the backdrop: buildings, fence, corn and wrecks. These stand OUTSIDE the
 *    arena, in a margin the camera is allowed to see into, so the field reads
 *    as a field on a farm without a single change to the sim. Nothing out there
 *    collides with anything, because nothing in the fight can reach it.
 *
 * Deterministic from the map and the run seed, on its own RNG stream.
 */
import type { World } from '../sim/world'
import type { Atlas } from '../core/atlas'
import { Rng } from '../core/rng'
import { GROUND_SLOTS } from './gl/ground'
import type { Placed } from './bake'

interface PathDef { width: number; points: [number, number][] }
interface RectDef { x: number; y: number; w: number; h: number }
interface EllipseDef { x: number; y: number; rx: number; ry: number }
interface LandmarkDef { sprite: string; x: number; y: number }
interface RowsDef {
  sprites: string[]
  /** Chance of each alternate sprite after the first. */
  alt?: number
  x0: number; x1: number; y0: number; y1: number; dx: number; dy: number
  /** Pixels of random offset per plant. */
  jitter?: number
}
interface FenceDef {
  run: string
  broken?: string
  post: string
  gate?: string
  /** Gaps in the north and south runs, as x centres. */
  gates?: number[]
  pitch: number
  sidePitch: number
}

export interface PlaceConfig {
  margin: number
  ground: Record<string, string>
  paths?: PathDef[]
  tilled?: RectDef[]
  yard?: RectDef[]
  water?: EllipseDef[]
  landmarks?: LandmarkDef[]
  rows?: RowsDef[]
  fence?: FenceDef
  /** Fraction of v1's interior scenery to keep; the backdrop does that job now. */
  interiorScenery?: number
}

export function placeOf(world: World): PlaceConfig | null {
  return (world.map as unknown as { place?: PlaceConfig }).place ?? null
}

export interface Layout {
  data: Uint8Array
  w: number
  h: number
  /** World rect the mask covers. */
  x: number
  y: number
  worldW: number
  worldH: number
}

const SCALE = 4

/** Rasterise the layout mask: r path, g tilled, b water, a yard. */
export function bakeLayout(world: World, cfg: PlaceConfig): Layout {
  const M = cfg.margin
  const worldW = world.arenaW + M * 2
  const worldH = world.arenaH + M * 2
  const w = Math.ceil(worldW / SCALE)
  const h = Math.ceil(worldH / SCALE)
  const ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]
  const soft = 10

  const splat = (c: Float32Array, x: number, y: number, v: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = y * w + x
    if (v > c[i]) c[i] = v
  }
  const smooth = (d: number, half: number): number => {
    const t = Math.min(1, Math.max(0, (half + soft - d) / (soft * 2)))
    return t * t * (3 - 2 * t)
  }

  for (const path of cfg.paths ?? []) {
    const half = path.width / 2
    for (let s = 0; s + 1 < path.points.length; s++) {
      const [ax, ay] = path.points[s]
      const [bx, by] = path.points[s + 1]
      const minX = Math.floor((Math.min(ax, bx) - half - soft + M) / SCALE)
      const maxX = Math.ceil((Math.max(ax, bx) + half + soft + M) / SCALE)
      const minY = Math.floor((Math.min(ay, by) - half - soft + M) / SCALE)
      const maxY = Math.ceil((Math.max(ay, by) + half + soft + M) / SCALE)
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy || 1
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x * SCALE - M
          const py = y * SCALE - M
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
          const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
          splat(ch[0], x, y, smooth(d, half))
        }
      }
    }
  }
  const rect = (c: Float32Array, r: RectDef): void => {
    for (let y = Math.floor((r.y - soft + M) / SCALE); y <= Math.ceil((r.y + r.h + soft + M) / SCALE); y++) {
      for (let x = Math.floor((r.x - soft + M) / SCALE); x <= Math.ceil((r.x + r.w + soft + M) / SCALE); x++) {
        const px = x * SCALE - M
        const py = y * SCALE - M
        const dx = Math.max(r.x - px, 0, px - (r.x + r.w))
        const dy = Math.max(r.y - py, 0, py - (r.y + r.h))
        splat(c, x, y, smooth(Math.hypot(dx, dy), 0))
      }
    }
  }
  for (const r of cfg.tilled ?? []) rect(ch[1], r)
  for (const r of cfg.yard ?? []) rect(ch[3], r)
  for (const e of cfg.water ?? []) {
    for (let y = Math.floor((e.y - e.ry - soft + M) / SCALE); y <= Math.ceil((e.y + e.ry + soft + M) / SCALE); y++) {
      for (let x = Math.floor((e.x - e.rx - soft + M) / SCALE); x <= Math.ceil((e.x + e.rx + soft + M) / SCALE); x++) {
        const px = (x * SCALE - M - e.x) / e.rx
        const py = (y * SCALE - M - e.y) / e.ry
        const d = (Math.hypot(px, py) - 1) * Math.min(e.rx, e.ry)
        splat(ch[2], x, y, smooth(d, 0))
      }
    }
  }

  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = Math.round(ch[0][i] * 255)
    data[i * 4 + 1] = Math.round(ch[1][i] * 255)
    data[i * 4 + 2] = Math.round(ch[2][i] * 255)
    data[i * 4 + 3] = Math.round(ch[3][i] * 255)
  }
  return { data, w, h, x: -M, y: -M, worldW: w * SCALE, worldH: h * SCALE }
}

/** The ten ground textures as (atlas x, y, page, size), in `GROUND_SLOTS` order. */
export function groundTiles(atlas: Atlas, cfg: PlaceConfig): Float32Array {
  const out = new Float32Array(GROUND_SLOTS.length * 4)
  GROUND_SLOTS.forEach((slot, i) => {
    const f = atlas.get(cfg.ground[slot] ?? '') ?? atlas.get(cfg.ground.grassA ?? '')
    if (!f) return
    out[i * 4] = f.x
    out[i * 4 + 1] = f.y
    out[i * 4 + 2] = f.page
    out[i * 4 + 3] = Math.min(f.w, f.h)
  })
  return out
}

/** Everything that stands around the field: landmarks, the fence and the rows. */
export function buildBackdrop(world: World, atlas: Atlas | null, cfg: PlaceConfig): Placed[] {
  const out: Placed[] = []
  if (!atlas) return out
  const rng = new Rng(world.seed ^ 0xbac_d209)
  const W = world.arenaW
  const H = world.arenaH

  for (const l of cfg.landmarks ?? []) {
    const f = atlas.get(l.sprite)
    if (f) out.push({ x: l.x, y: l.y, frame: f })
  }

  for (const r of cfg.rows ?? []) {
    const frames = r.sprites.map((s) => atlas.get(s)).filter((f) => !!f)
    if (!frames.length) continue
    const j = r.jitter ?? 0
    for (let y = r.y0; y <= r.y1; y += r.dy) {
      const row = Math.round((y - r.y0) / r.dy)
      for (let x = r.x0 + (row % 2) * (r.dx / 2); x <= r.x1; x += r.dx) {
        const pick = frames.length > 1 && rng.next() < (r.alt ?? 0) ? frames[rng.int(1, frames.length - 1)] : frames[0]
        if (!pick) continue
        out.push({ x: Math.round(x + rng.range(-j, j)), y: Math.round(y + rng.range(-j * 0.5, j * 0.5)), frame: pick })
      }
    }
  }

  const fence = cfg.fence
  if (fence) {
    const run = atlas.get(fence.run)
    const broken = fence.broken ? atlas.get(fence.broken) : undefined
    const post = atlas.get(fence.post)
    const gate = fence.gate ? atlas.get(fence.gate) : undefined
    const gates = fence.gates ?? []
    if (run) {
      for (const edgeY of [6, H + 14]) {
        for (let x = fence.pitch / 2; x < W; x += fence.pitch) {
          const g = gates.find((gx) => Math.abs(gx - x) < fence.pitch / 2)
          if (g !== undefined) {
            if (gate && edgeY < H) out.push({ x: g, y: edgeY, frame: gate })
            continue
          }
          const f = broken && rng.next() < 0.18 ? broken : run
          out.push({ x, y: edgeY, frame: f })
        }
      }
    }
    if (post) {
      for (const edgeX of [-4, W + 4]) {
        for (let y = fence.sidePitch; y < H; y += fence.sidePitch) {
          if (rng.next() < 0.1) continue
          out.push({ x: edgeX, y, frame: post })
        }
      }
    }
  }
  // Depth order within a y-bucket is insertion order, so hand them over sorted.
  out.sort((a, b) => a.y - b.y)
  return out
}
