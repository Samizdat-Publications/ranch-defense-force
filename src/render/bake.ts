/**
 * Things baked once per map: the ground, the fog tile, the scenery and the
 * overhead layer.
 *
 * Plain Canvas 2D, run at load and on a map change, never per frame. The GL
 * renderer uploads the results as textures. Every bake draws from its own RNG
 * stream seeded off the run, so nothing decorative can move a spawn and a
 * replayed seed gets the same field.
 */
import type { World } from '../sim/world'
import type { Atlas, AtlasFrame } from '../core/atlas'
import { Rng } from '../core/rng'
import { decalKindsFor, mapIsBlighted, sceneryKindsFor, type MapBoundary, type MapTerrain } from '../content'
import { wangKey, type Corner } from './wang'

export interface Placed { x: number; y: number; frame: AtlasFrame }

/** Fog tile edge, in world pixels. A power of two so wrap arithmetic is exact. */
export const FOG_TILE = 512
const FOG_BLOBS = 26
const TILE = 32

/** The ground set for a wave: the last blight band whose `fromWave` has been reached. */
export function groundSetFor(t: MapTerrain, wave: number): string {
  let set = t.groundSet
  let best = -Infinity
  for (const b of t.blight) {
    if (wave >= b.fromWave && b.fromWave > best) { best = b.fromWave; set = b.groundSet }
  }
  return set
}

/** The blighted counterpart of a crop sprite once the field has turned, if one is packed. */
export function cropSprite(atlas: Atlas | null, t: MapTerrain, sprite: string, wave: number): string {
  if (!sprite.startsWith('crop.') || !mapIsBlighted(t, wave)) return sprite
  const blighted = `${sprite}Blight`
  return atlas?.has(blighted) ? blighted : sprite
}

/** The whole arena's ground as one canvas: Wang terrain, decals and the boundary. */
export function bakeTerrain(world: World, atlas: Atlas | null, groundSet: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = world.arenaW
  c.height = world.arenaH
  const g = c.getContext('2d')
  if (!g) return c
  g.imageSmoothingEnabled = false
  const cols = Math.ceil(c.width / TILE)
  const rows = Math.ceil(c.height / TILE)
  const grass = atlas?.get('terrain.grass')

  if (!atlas || !grass) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? '#6f7d4f' : '#67754a'
        g.fillRect(x * TILE, y * TILE, TILE, TILE)
      }
    }
    return c
  }

  const imgs = atlas.images
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.drawImage(imgs[grass.page], grass.x, grass.y, grass.w, grass.h, x * TILE, y * TILE, TILE, TILE)
    }
  }
  bakeWangGround(world, atlas, g, cols, rows, groundSet)
  paintDecals(world, atlas, g, c)
  paintBoundary(world, atlas, g, c)
  return c
}

function bakeWangGround(
  world: World, atlas: Atlas, g: CanvasRenderingContext2D, cols: number, rows: number, groundSet: string,
): boolean {
  const t = world.map.terrain
  const base = t.groundSet
  if (!atlas.get(wangKey(groundSet, 0, 0, 0, 0))) {
    if (groundSet !== base && atlas.get(wangKey(base, 0, 0, 0, 0))) {
      return bakeWangGround(world, atlas, g, cols, rows, base)
    }
    return false
  }
  const imgs = atlas.images
  const rng = new Rng(world.seed ^ 0x7e44a1)
  const vw = cols + 1
  const vh = rows + 1
  const field = new Uint8Array(vw * vh).fill(1)
  for (let i = 0; i < 26; i++) {
    const cx = rng.int(2, cols - 3)
    const cy = rng.int(2, rows - 3)
    const r = rng.int(1, 3)
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue
        const vx = cx + x
        const vy = cy + y
        if (vx < 0 || vy < 0 || vx >= vw || vy >= vh) continue
        field[vy * vw + vx] = 0
      }
    }
  }
  const paint = (set: string, at: Uint8Array, skipEmpty: boolean): void => {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const nw = at[y * vw + x] as Corner
        const ne = at[y * vw + x + 1] as Corner
        const sw = at[(y + 1) * vw + x] as Corner
        const se = at[(y + 1) * vw + x + 1] as Corner
        if (skipEmpty && !(nw || ne || sw || se)) continue
        const f = atlas.get(wangKey(set, nw, ne, sw, se))
        if (f) g.drawImage(imgs[f.page], f.x, f.y, f.w, f.h, x * TILE, y * TILE, TILE, TILE)
      }
    }
  }
  paint(groundSet, field, false)

  const soilSet = t.soilSet
  if (atlas.get(wangKey(soilSet, 1, 1, 1, 1))) {
    const soil = new Uint8Array(vw * vh)
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        if (vx < t.soilEdgeCols || vx >= vw - t.soilEdgeCols) soil[vy * vw + vx] = 1
      }
    }
    paint(soilSet, soil, true)
  }
  return true
}

function paintBoundary(world: World, atlas: Atlas, g: CanvasRenderingContext2D, c: HTMLCanvasElement): void {
  const b = world.map.boundary
  if (b && b.kind === 'wall' && paintWallBand(world, atlas, g, c, b)) return
  paintFence(world, atlas, g, c)
}

function paintWallBand(
  world: World, atlas: Atlas, g: CanvasRenderingContext2D, c: HTMLCanvasElement, b: MapBoundary,
): boolean {
  const set = b.wangSet
  if (!set || !atlas.get(wangKey(set, 1, 1, 1, 1))) return false
  const imgs = atlas.images
  const cols = Math.ceil(c.width / TILE)
  const rows = Math.ceil(c.height / TILE)
  const vw = cols + 1
  const vh = rows + 1
  const field = new Uint8Array(vw * vh)
  for (let vy = 0; vy < vh; vy++) {
    for (let vx = 0; vx < vw; vx++) {
      const x = vx * TILE
      const y = vy * TILE
      if (x < b.band || x > c.width - b.band || y < b.band || y > c.height - b.band) field[vy * vw + vx] = 1
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nw = field[y * vw + x] as Corner
      const ne = field[y * vw + x + 1] as Corner
      const sw = field[(y + 1) * vw + x] as Corner
      const se = field[(y + 1) * vw + x + 1] as Corner
      if (!(nw || ne || sw || se)) continue
      const f = atlas.get(wangKey(set, nw, ne, sw, se))
      if (f) g.drawImage(imgs[f.page], f.x, f.y, f.w, f.h, x * TILE, y * TILE, TILE, TILE)
    }
  }
  const kinds = (b.panels ?? []).map((k) => atlas.get(k)).filter((f): f is AtlasFrame => !!f)
  if (kinds.length) {
    const rng = new Rng(world.seed ^ 0xfa11_0000)
    const PITCH = 96
    for (let x = PITCH / 2; x < c.width - PITCH / 2; x += PITCH) {
      if (rng.next() > 0.55) continue
      const f = kinds[rng.int(0, kinds.length - 1)]
      g.drawImage(
        imgs[f.page], f.x, f.y, f.w, f.h,
        Math.round(x - f.w / 2 + f.ox), Math.round(b.band - f.h + f.oy), f.w, f.h,
      )
    }
  }
  return true
}

function paintFence(world: World, atlas: Atlas, g: CanvasRenderingContext2D, c: HTMLCanvasElement): void {
  const post = atlas.get('prop.fencePost')
  const rail = atlas.get('prop.fenceRail')
  const imgs = atlas.images
  if (!post) {
    g.strokeStyle = '#6b5027'
    g.lineWidth = 6
    g.strokeRect(3, 3, c.width - 6, c.height - 6)
    return
  }
  const rng = new Rng(world.seed ^ 0x5eed_fe4c)
  const PITCH = 56
  const put = (f: AtlasFrame, x: number, y: number): void => {
    g.drawImage(imgs[f.page], f.x, f.y, f.w, f.h, Math.round(x + f.ox), Math.round(y + f.oy), f.w, f.h)
  }
  const pick = (): AtlasFrame => (rail && rng.next() < 0.25 ? rail : post)
  for (let x = PITCH / 2; x < c.width; x += PITCH) {
    put(pick(), x, 10)
    put(pick(), x, c.height - 2)
  }
  for (let y = PITCH; y < c.height - PITCH / 2; y += PITCH) {
    put(pick(), 12, y)
    put(pick(), c.width - 12, y)
  }
}

function paintDecals(world: World, atlas: Atlas, g: CanvasRenderingContext2D, c: HTMLCanvasElement): void {
  const kinds = decalKindsFor(world.map).map((k) => atlas.get(k)).filter((f): f is AtlasFrame => !!f)
  if (!kinds.length) return
  const imgs = atlas.images
  const rng = new Rng(world.seed ^ 0x0dec_a15)
  const pad = 60 + (world.map.boundary?.inset ?? 0)
  const count = Math.round((c.width * c.height) / 240_000)
  for (let i = 0; i < count; i++) {
    const f = kinds[rng.int(0, kinds.length - 1)]
    const x = rng.int(pad, c.width - pad)
    const y = rng.int(pad, c.height - pad)
    g.globalAlpha = 0.75
    g.drawImage(imgs[f.page], f.x, f.y, f.w, f.h, Math.round(x + f.ox), Math.round(y + f.oy), f.w, f.h)
  }
  g.globalAlpha = 1
}

/** One seamless fog tile, or null on a map with no fog. */
export function bakeFog(world: World): HTMLCanvasElement | null {
  const cfg = world.map.fog
  if (!cfg) return null
  const size = FOG_TILE
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) return null
  const rng = new Rng(world.seed ^ 0xf0_9c1a)
  for (let i = 0; i < FOG_BLOBS; i++) {
    const x = rng.range(0, size)
    const y = rng.range(0, size)
    const r = rng.range(size * 0.10, size * 0.30) * cfg.scale
    const a = rng.range(0.25, 1)
    for (let wy = -1; wy <= 1; wy++) {
      for (let wx = -1; wx <= 1; wx++) {
        const cx = x + wx * size
        const cy = y + wy * size
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
        grad.addColorStop(0, cfg.tint)
        grad.addColorStop(1, 'transparent')
        g.globalAlpha = a
        g.fillStyle = grad
        g.beginPath()
        g.arc(cx, cy, r, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  g.globalAlpha = 1
  return c
}

/** Fixtures scattered in a band near the edges, where they never block a fight. */
export function buildScenery(world: World, atlas: Atlas | null): Placed[] {
  const out: Placed[] = []
  if (!atlas) return out
  const kinds = sceneryKindsFor(world.map).map((k) => atlas.get(k)).filter((f): f is AtlasFrame => !!f)
  if (!kinds.length) return out
  const rng = new Rng(world.seed ^ 0x5ce_1e11)
  const W = world.arenaW
  const H = world.arenaH
  const BAND = 220
  const IN = 40 + (world.map.boundary?.inset ?? 0)
  const count = Math.round((W * H) / 90_000)
  for (let i = 0; i < count; i++) {
    const f = kinds[rng.int(0, kinds.length - 1)]
    let x: number
    let y: number
    switch (rng.int(0, 3)) {
      case 0: x = rng.int(IN, W - IN); y = rng.int(IN, BAND); break
      case 1: x = rng.int(IN, W - IN); y = rng.int(H - BAND, H - IN); break
      case 2: x = rng.int(IN, BAND); y = rng.int(IN, H - IN); break
      default: x = rng.int(W - BAND, W - IN); y = rng.int(IN, H - IN); break
    }
    out.push({ x, y, frame: f })
  }
  return out
}

/** Ceiling art for an enclosed map; empty under open sky. */
export function buildOverhead(world: World, atlas: Atlas | null): Placed[] {
  const out: Placed[] = []
  const cfg = world.map.overhead
  if (!cfg || !atlas) return out
  const kinds = cfg.sprites.map((k) => atlas.get(k)).filter((f): f is AtlasFrame => !!f)
  if (!kinds.length) return out
  const rng = new Rng(world.seed ^ 0x0ce1_1a6)
  const W = world.arenaW
  const H = world.arenaH
  const count = Math.round((W * H) / 1_000_000 * cfg.perMillionPx)
  for (let i = 0; i < count; i++) {
    out.push({ x: rng.int(0, W), y: rng.int(0, H), frame: kinds[rng.int(0, kinds.length - 1)] })
  }
  return out
}
