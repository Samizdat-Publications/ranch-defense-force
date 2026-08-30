/**
 * Draws a live `World` into an `Image`, headlessly.
 *
 * This was inside `screenshot.ts` until the weapon range needed the same thing
 * twelve times on one sheet. Two copies of the renderer's frame-selection rules
 * was already one more than ideal; three would have guaranteed they drifted.
 *
 * It deliberately reimplements the renderer rather than importing it — the
 * renderer needs a DOM canvas, and a second independent implementation of "what
 * frame does this entity show" is a check on the first. If the two ever
 * disagree, that is worth knowing. The cost is that changes to frame selection
 * belong in both, and the comments in each say so.
 */
import { decodePng, encodePng, blankImage, type Image } from './png.ts'
import { readFileSync } from 'node:fs'
import { Rng } from '../src/core/rng.ts'
import { TUNING, WEAPONS, projectileScaleFor } from '../src/content/index.ts'
import type { World } from '../src/sim/world.ts'
import { wangKey, type Corner } from '../src/render/wang.ts'

/** Default zoom. The game derives its own; see `zoomFor` in the renderer. */
export const ZOOM = 2
/**
 * The wave-banded ground, matching the renderer. Without this a screenshot of
 * wave 20 shows a healthy pasture the game never draws — and a screenshot that
 * disagrees with the game is the thing this file exists to avoid.
 *
 * Read off the WORLD's map, not off tuning.json, for exactly that reason: once
 * the ground became a per-map choice, a painter still reading one global would
 * have drawn every map as the Home Field and the screenshots would have quietly
 * stopped being evidence.
 */
function groundSetFor(world: World, wave: number): string {
  const t = world.map.terrain
  let set = t.groundSet
  let best = -Infinity
  for (const b of t.blight) {
    if (wave >= b.fromWave && b.fromWave > best) { best = b.fromWave; set = b.groundSet }
  }
  return set
}
const PIXELS_PER_WALK_FRAME = 11
/** Matches `PROP_FPS` in the renderer. Ambient loops run slower than combat art. */
const PROP_FPS = 8

/** Must match src/render/renderer.ts -- a shot that fogs differently is a lie. */
const FOG_TILE = 512
const FOG_BLOBS = 26
/** Matches `PROJECTILE_SCALE` in the renderer; per-weapon multiplier on top. */
const PROJECTILE_SCALE = 0.55
/** unTied's projectile and FX clips are authored at 15fps. */
const CLIP_FPS = 15
/** Matches `tuning.combat.attackClipSeconds`, which the renderer reads. */
const ATTACK_SECONDS = ((TUNING as unknown as { combat?: { attackClipSeconds?: number } }).combat?.attackClipSeconds) ?? 0.6

export interface Frame { x: number; y: number; w: number; h: number; ox: number; oy: number }
interface AtlasJson {
  rig: { directions: string[] }
  /** Per-sheet direction lists; a sheet absent from here is on the rig's four. */
  dirSets?: Record<string, string[]>
  clipLengths: Record<string, Record<string, number>>
  frames: Record<string, Frame>
}

const atlasImg = decodePng(readFileSync('public/atlas.png'))
const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as AtlasJson

export const frames = atlas.frames
export const clipLengths = atlas.clipLengths

/** The renderer's element tinting: `proj.spark` + `fire` -> `proj.spark.fire`. */
function tintedClip(base: string | null, element: string | null): string | null {
  if (!base || !element || element === 'none') return base
  const t = `${base}.${element}`
  return clipLengths[t]?.play ? t : base
}

export function fillRect(img: Image, x: number, y: number, w: number, h: number, rgb: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) {
      const i = (yy * img.width + xx) * 4
      img.data[i] = (rgb >> 16) & 0xff
      img.data[i + 1] = (rgb >> 8) & 0xff
      img.data[i + 2] = rgb & 0xff
      img.data[i + 3] = 255
    }
  }
}

/**
 * Which sprite a projectile draws as — the renderer's rule, restated.
 *
 * Animated clip if the weapon declares one, else its icon. An element tints the
 * clip rather than replacing it, so a fire scattergun still throws sparks.
 *
 * Exported with its key alongside the frame because the weapon range needs to
 * REPORT what was drawn, not just draw it, and a report that recomputes the
 * rule separately is a report that can disagree with the picture above it.
 */
export function projectileSprite(
  world: World,
  p: { weaponId: string; behaviour: string; type?: string; x: number; angle?: number },
): { key: string; frame: Frame | undefined } {
  if (p.type === 'aura') return { key: '(aura)', frame: undefined }
  if (p.behaviour === 'arcSwing') {
    const sw = swingSprite(world, p as { weaponId: string; angle: number })
    return sw ?? { key: '(melee arc)', frame: undefined }
  }
  // The barn dog is a real animal, not an icon.
  if (p.behaviour === 'minionHunt') {
    return { key: 'feralDog', frame: frames['feralDog.idle.down.0'] }
  }

  const def = (WEAPONS as Record<string, Record<string, unknown>>)[p.weaponId]
  const raw = p.behaviour === 'stream' && p.weaponId === 'drumGun' && typeof def?.shardClip === 'string'
    ? def.shardClip
    : def?.projectileClip
  const base = typeof raw === 'string' ? raw : null
  const clip = tintedClip(base, world.player.element)
  if (clip) {
    const len = clipLengths[clip]?.play ?? 0
    if (len > 0) {
      // Phase off the projectile's own x so a volley does not flicker in
      // lockstep, without needing per-projectile animation state.
      const phase = (p.x * 0.35) | 0
      const frame = frames[`${clip}.${(((world.elapsed * CLIP_FPS) | 0) + phase) % len}`]
      if (frame) return { key: clip, frame }
    }
  }
  const key = `weapon.${p.weaponId}`
  if (frames[key]) return { key, frame: frames[key] }
  // Weapons with per-tier art have no `weapon.<id>`; the miss used to fall
  // through to a coloured rectangle.
  const sprite = typeof def?.sprite === 'string' ? def.sprite : null
  return { key: sprite ?? key, frame: sprite ? frames[sprite] : undefined }
}

/** The art for a swept melee arc, if its weapon declares one. */
export function swingSprite(
  world: World, p: { weaponId: string; angle: number },
): { key: string; frame: Frame } | null {
  const clip = (WEAPONS[p.weaponId] as unknown as { swingClip?: string } | undefined)?.swingClip
  if (!clip) return null
  const len = clipLengths[clip]?.play ?? 0
  if (len <= 0) return null
  const f = (((world.elapsed * CLIP_FPS) | 0) + ((p.angle * 4) | 0)) % len
  const frame = frames[`${clip}.${f}`] ?? frames[`${clip}.0`]
  return frame ? { key: clip, frame } : null
}

/**
 * Draw one atlas frame centred at `cx,cy` in any image, at an arbitrary scale.
 *
 * Standalone rather than a `WorldPainter` method because the rounds sheet has no
 * world and no camera — it just needs a bullet drawn at exactly the size the
 * game draws it, on a background it can be judged against.
 */
export function drawSpriteScaled(
  img: Image, f: Frame, cx: number, cy: number, scale: number,
): void {
  const w = Math.max(1, Math.round(f.w * scale))
  const h = Math.max(1, Math.round(f.h * scale))
  const x0 = Math.round(cx - w / 2)
  const y0 = Math.round(cy - h / 2)
  for (let y = 0; y < h; y++) {
    const sy = f.y + Math.min(f.h - 1, Math.floor((y / h) * f.h))
    const ty = y0 + y
    if (ty < 0 || ty >= img.height) continue
    for (let x = 0; x < w; x++) {
      const sx = f.x + Math.min(f.w - 1, Math.floor((x / w) * f.w))
      const tx = x0 + x
      if (tx < 0 || tx >= img.width) continue
      const si = (sy * atlasImg.width + sx) * 4
      if (atlasImg.data[si + 3] === 0) continue
      const di = (ty * img.width + tx) * 4
      img.data[di] = atlasImg.data[si]
      img.data[di + 1] = atlasImg.data[si + 1]
      img.data[di + 2] = atlasImg.data[si + 2]
      img.data[di + 3] = 255
    }
  }
}

/** The on-screen scale a weapon's round is drawn at, for a given zoom. */
export function roundScale(weaponId: string, zoom = ZOOM): number {
  return PROJECTILE_SCALE * projectileScaleFor(weaponId) * zoom
}

/**
 * One painted view of a world: its own pixel buffer and camera.
 *
 * Held as an object rather than a free function because the weapon range paints
 * a dozen of these and then composites them, and each needs its own buffer.
 */
export class WorldPainter {
  readonly canvas: Image
  private camX = 0
  private camY = 0

  /**
   * @param viewW world pixels visible across
   * @param viewH world pixels visible down
   * @param zoom  world-to-image scale; pass the game's own so a contact sheet
   *              shows a bullet at the size a player actually sees it. Tiles
   *              tighter than the real view make every round look bigger than
   *              it is, which is how six of them got signed off as legible
   *              while still reading as one speck in play.
   */
  constructor(readonly viewW: number, readonly viewH: number, readonly zoom = ZOOM) {
    this.canvas = blankImage(viewW * zoom, viewH * zoom)
  }

  /** Draw an atlas frame at a world position, honouring the zoom. */
  /**
   * Draw a frame CENTRED on a world point, ignoring its bottom-centre pivot.
   *
   * Everything that stands on the ground is drawn from that pivot, which is
   * what makes a tree's base sit where the tree is. A hazard is not standing on
   * the ground, it IS a patch of ground, so it wants its middle over the disc's
   * middle. The renderer centres it the same way; the two painters agreeing is
   * the only reason a screenshot is worth taking.
   */
  private drawFrameCentred(f: Frame, worldX: number, worldY: number): void {
    this.drawFrame(f, worldX - f.w / 2 - f.ox, worldY - f.h / 2 - f.oy)
  }

  private drawFrame(f: Frame, worldX: number, worldY: number): void {
    const dx = Math.round((worldX - this.camX) * this.zoom + f.ox * this.zoom)
    const dy = Math.round((worldY - this.camY) * this.zoom + f.oy * this.zoom)
    const { canvas } = this
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const si = ((f.y + y) * atlasImg.width + (f.x + x)) * 4
        if (atlasImg.data[si + 3] === 0) continue
        for (let py = 0; py < this.zoom; py++) {
          for (let px = 0; px < this.zoom; px++) {
            const tx = dx + x * this.zoom + px
            const ty = dy + y * this.zoom + py
            if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue
            const di = (ty * canvas.width + tx) * 4
            canvas.data[di] = atlasImg.data[si]
            canvas.data[di + 1] = atlasImg.data[si + 1]
            canvas.data[di + 2] = atlasImg.data[si + 2]
            canvas.data[di + 3] = 255
          }
        }
      }
    }
  }

  /**
   * Draw a frame with rotation and scale, by inverse-mapping each destination
   * pixel back into the source. Nearest neighbour, because everything here is
   * pixel art and any filtering would be a lie about what the game draws.
   */
  private drawFrameT(f: Frame, worldX: number, worldY: number, rot: number, scale: number): void {
    const { canvas } = this
    const cx = (worldX - this.camX) * this.zoom
    const cy = (worldY - this.camY) * this.zoom
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const half = (Math.max(f.w, f.h) * Math.abs(scale) * this.zoom) / 2 + 2
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        // Rotate the destination offset back into unrotated frame space.
        const ux = (dx * cos + dy * sin) / (scale * this.zoom)
        const uy = (-dx * sin + dy * cos) / (scale * this.zoom)
        const fx = Math.floor(ux + f.w / 2)
        const fy = Math.floor(uy + f.h / 2)
        if (fx < 0 || fy < 0 || fx >= f.w || fy >= f.h) continue
        const si = ((f.y + fy) * atlasImg.width + (f.x + fx)) * 4
        if (atlasImg.data[si + 3] === 0) continue
        const tx = Math.round(cx + dx)
        const ty = Math.round(cy + dy)
        if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue
        const di = (ty * canvas.width + tx) * 4
        canvas.data[di] = atlasImg.data[si]
        canvas.data[di + 1] = atlasImg.data[si + 1]
        canvas.data[di + 2] = atlasImg.data[si + 2]
        canvas.data[di + 3] = 255
      }
    }
  }

  /**
   * Blend a colour over the canvas at a world point.
   *
   * Fills the whole ZOOM x ZOOM block a world pixel occupies. Setting a single
   * canvas pixel leaves every other one untouched at 2x, which reads as a dither
   * screen rather than a wash — the reason hazard discs came out as moire.
   */
  private tint(worldX: number, worldY: number, rgb: number, a: number): void {
    const { canvas } = this
    const bx = Math.round((worldX - this.camX) * this.zoom)
    const by = Math.round((worldY - this.camY) * this.zoom)
    for (let py = 0; py < this.zoom; py++) {
      const ty = by + py
      if (ty < 0 || ty >= canvas.height) continue
      for (let px = 0; px < this.zoom; px++) {
        const tx = bx + px
        if (tx < 0 || tx >= canvas.width) continue
        const di = (ty * canvas.width + tx) * 4
        canvas.data[di] = Math.round(((rgb >> 16) & 0xff) * a + canvas.data[di] * (1 - a))
        canvas.data[di + 1] = Math.round(((rgb >> 8) & 0xff) * a + canvas.data[di + 1] * (1 - a))
        canvas.data[di + 2] = Math.round((rgb & 0xff) * a + canvas.data[di + 2] * (1 - a))
      }
    }
  }

  /*
     Kept byte-for-byte in step with `directionIndex` in src/core/atlas.ts.
     This file deliberately holds a second copy of the renderer's
     frame-selection rules (see the header), and the cost of that is that a
     change there is a change here — a screenshot that picks directions by a
     different rule than the game is worse than no screenshot, because it looks
     authoritative.
  */
  private directionIndex(facing: number, count: number): number {
    if (count === 8) return ((Math.round(facing / (Math.PI / 4)) % 8) + 8) % 8
    const c = Math.cos(facing)
    const s = Math.sin(facing)
    if (Math.abs(c) >= Math.abs(s) * 0.85) return c < 0 ? 2 : 3
    return s > 0 ? 0 : 1
  }

  /**
   * The renderer's baked scenery — flat decals and the boundary fence —
   * restated so a headless shot shows them. Neither was drawn here before, so
   * every screenshot so far has been of a field with no fence in it.
   *
   * Same RNG seeds as the renderer, kept apart from the ground's stream for the
   * same reason it keeps them apart: scattering scenery must not move a tile.
   */
  /**
   * Ground fog, matching `Renderer.bakeFog`/`drawFog` in structure and seed.
   *
   * The browser gets radial gradients from the canvas API; there is no canvas
   * here, so the falloff is evaluated per pixel. Same blob count, same stream,
   * same nine-way wrap for seamlessness, so a shot and the game agree -- which
   * is the whole reason this exists rather than a note saying shots have no fog.
   *
   * A screenshot that quietly omits a layer is worse than no screenshot: this
   * repo's verification step is `npm run shot` and LOOK, and a layer the shot
   * cannot show is a layer nobody ever looks at.
   */
  private fog(world: World): void {
    const cfg = world.map.fog
    if (!cfg) return

    const size = FOG_TILE
    const tint = parseInt(cfg.tint.slice(1), 16)
    const tr = (tint >> 16) & 0xff
    const tg = (tint >> 8) & 0xff
    const tb = tint & 0xff

    // The tile, as a coverage field in [0,1]. Built once per shot.
    const cov = new Float32Array(size * size)
    const rng = new Rng(world.seed ^ 0xf0_9c1a)
    for (let i = 0; i < FOG_BLOBS; i++) {
      const bx = rng.range(0, size)
      const by = rng.range(0, size)
      const r = rng.range(size * 0.10, size * 0.30) * cfg.scale
      const a = rng.range(0.25, 1)
      for (let wy = -1; wy <= 1; wy++) {
        for (let wx = -1; wx <= 1; wx++) {
          const cx = bx + wx * size
          const cy = by + wy * size
          if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue
          const x0 = Math.max(0, Math.floor(cx - r))
          const x1 = Math.min(size - 1, Math.ceil(cx + r))
          const y0 = Math.max(0, Math.floor(cy - r))
          const y1 = Math.min(size - 1, Math.ceil(cy + r))
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const d = Math.hypot(x - cx, y - cy)
              if (d >= r) continue
              // Linear falloff, which is what a two-stop radial gradient is.
              const v = cov[y * size + x] + a * (1 - d / r)
              cov[y * size + x] = v > 1 ? 1 : v
            }
          }
        }
      }
    }

    const img = this.canvas
    const t = world.elapsed
    for (let bank = 0; bank < 2; bank++) {
      const speed = bank === 0 ? cfg.drift : -cfg.drift * 1.7
      const alpha = bank === 0 ? cfg.alpha : cfg.alpha * 0.55
      const dx = ((t * speed) % size + size) % size
      const dy = ((t * speed * 0.35) % size + size) % size
      for (let py = 0; py < img.height; py++) {
        const wy = py + this.camY - dy
        const sy = ((wy % size) + size) % size | 0
        for (let px = 0; px < img.width; px++) {
          const wx = px + this.camX - dx
          const sx = ((wx % size) + size) % size | 0
          const c = cov[sy * size + sx]
          if (c <= 0) continue
          const k = c * alpha
          const i = (py * img.width + px) * 4
          img.data[i] = img.data[i] * (1 - k) + tr * k
          img.data[i + 1] = img.data[i + 1] * (1 - k) + tg * k
          img.data[i + 2] = img.data[i + 2] * (1 - k) + tb * k
        }
      }
    }
  }

  private decals(world: World): void {
    const kinds = ['decal.tireRuts', 'decal.scorch', 'decal.mud', 'decal.ash']
      .map((k) => frames[k]).filter((f): f is Frame => !!f)
    if (!kinds.length) return
    const rng = new Rng(world.seed ^ 0x0dec_a15)
    const count = Math.round((world.arenaW * world.arenaH) / 240_000)
    for (let i = 0; i < count; i++) {
      const f = kinds[rng.int(0, kinds.length - 1)]
      const x = rng.int(60, world.arenaW - 60)
      const y = rng.int(60, world.arenaH - 60)
      this.drawFrame(f, x, y)
    }
  }

  /** The renderer's peripheral scenery band, restated. Same seed, same order. */
  private scenery(world: World): { x: number; y: number; f: Frame }[] {
    // FIXTURES ONLY. Everything container-shaped -- drum, barrel, bale, bin,
    // cans, barrow, trough, log and bone pile -- moved to breakables.json and
    // is scattered by the sim through the interior instead.
    //
    // The split is what makes the mechanic legible without a tutorial: a
    // container pays out and a fixture does not, and a player can tell which is
    // which by looking. Leaving the containers here as well would have put an
    // unbreakable oil drum in the same field as a breakable one, and no amount
    // of feedback recovers from that.
    const kinds = [
      'prop.carcass', 'prop.plough', 'prop.graveMarker', 'prop.treeStump',
      'prop.barbedWire', 'prop.scarecrow', 'prop.scarecrowRotted',
      'prop.fencePost', 'prop.fenceRail', 'prop.gate',
    ].map((k) => frames[k]).filter((f): f is Frame => !!f)
    const out: { x: number; y: number; f: Frame }[] = []
    if (!kinds.length) return out
    const rng = new Rng(world.seed ^ 0x5ce_1e11)
    const W = world.arenaW
    const H = world.arenaH
    const BAND = 220
    const count = Math.round((W * H) / 90_000)
    for (let i = 0; i < count; i++) {
      const f = kinds[rng.int(0, kinds.length - 1)]
      let x: number
      let y: number
      switch (rng.int(0, 3)) {
        case 0: x = rng.int(40, W - 40); y = rng.int(40, BAND); break
        case 1: x = rng.int(40, W - 40); y = rng.int(H - BAND, H - 40); break
        case 2: x = rng.int(40, BAND); y = rng.int(40, H - 40); break
        default: x = rng.int(W - BAND, W - 40); y = rng.int(40, H - 40); break
      }
      out.push({ x, y, f })
    }
    return out
  }

  private fence(world: World): void {
    const post = frames['prop.fencePost']
    const rail = frames['prop.fenceRail']
    if (!post) return
    const rng = new Rng(world.seed ^ 0x5eed_fe4c)
    const PITCH = 56
    const pick = (): Frame => (rail && rng.next() < 0.25 ? rail : post)
    for (let x = PITCH / 2; x < world.arenaW; x += PITCH) {
      this.drawFrame(pick(), x, 10)
      this.drawFrame(pick(), x, world.arenaH - 2)
    }
    for (let y = PITCH; y < world.arenaH - PITCH / 2; y += PITCH) {
      this.drawFrame(pick(), 12, y)
      this.drawFrame(pick(), world.arenaW - 12, y)
    }
  }

  /** One clip frame by progress 0..1, clamped. Mirrors the renderer. */
  private clipFrame(sheet: string, facing: number, clip: string, progress: number): Frame | undefined {
    const len = clipLengths[sheet]?.[clip]
    if (!len) return undefined
    const dirs = atlas.dirSets?.[sheet] ?? atlas.rig.directions
    const dir = dirs[this.directionIndex(facing, dirs.length)] ?? dirs[0] ?? 'down'
    const f = Math.min(len - 1, Math.max(0, Math.floor(progress * len)))
    return frames[`${sheet}.${clip}.${dir}.${f}`]
  }

  private sheetFrame(sheet: string, facing: number, travelled: number, moving: boolean): Frame | undefined {
    const dirs = atlas.dirSets?.[sheet] ?? atlas.rig.directions
    const dir = dirs[this.directionIndex(facing, dirs.length)] ?? dirs[0] ?? 'down'
    if (!moving) return frames[`${sheet}.idle.${dir}.0`]
    const len = clipLengths[sheet]?.walk ?? 6
    const f = Math.floor(travelled / PIXELS_PER_WALK_FRAME) % len
    return frames[`${sheet}.walk.${dir}.${f}`]
  }

  private terrain(world: World): void {
    fillRect(this.canvas, 0, 0, this.canvas.width, this.canvas.height, 0x479757)
    if (this.wangTerrain(world)) { this.decals(world); this.fence(world); this.fog(world); return }

    const grass = frames['terrain.grass']
    const dirt = frames['terrain.dirt']
    const soil = frames['terrain.soil']

    const tile = 32
    const startTx = Math.floor(this.camX / tile) - 1
    const startTy = Math.floor(this.camY / tile) - 1
    const terrainRng = new Rng(world.seed ^ 0x7e44a1)
    // Reproduce the renderer's dirt patches so the shot matches the game.
    const patches: [number, number, number][] = []
    for (let i = 0; i < 26; i++) {
      patches.push([
        terrainRng.int(2, Math.ceil(world.arenaW / tile) - 3),
        terrainRng.int(2, Math.ceil(world.arenaH / tile) - 3),
        terrainRng.int(1, 3),
      ])
    }
    const cols = Math.ceil(world.arenaW / tile)
    for (let ty = startTy; ty < startTy + this.viewH / tile + 3; ty++) {
      for (let tx = startTx; tx < startTx + this.viewW / tile + 3; tx++) {
        if (tx < 0 || ty < 0) continue
        let f = grass
        for (const [cx, cy, r] of patches) {
          const dx = tx - cx
          const dy = ty - cy
          if (dx * dx + dy * dy <= r * r && dirt) f = dirt
        }
        if ((tx < 3 || tx >= cols - 3) && soil) f = soil
        if (f) this.drawFrame(f, tx * tile + tile / 2, ty * tile + tile)
      }
    }
  }

  /**
   * The renderer's Wang ground, restated so a headless shot shows the ground the
   * GAME draws rather than a second one that merely resembles it.
   *
   * This is a duplicate of `Renderer.bakeWangGround` and it has to stay in step
   * with it — the same RNG stream in the same order, or the shot is of a
   * different field than the run it claims to picture. The tile KEY is the one
   * thing not restated: `wangKey` is imported from the renderer's own module, so
   * the naming cannot drift even if the field generation does.
   */
  private wangTerrain(world: World): boolean {
    const banded = groundSetFor(world, world.spawner.wave)
    const ground = frames[wangKey(banded, 0, 0, 0, 0)] ? banded : world.map.terrain.groundSet
    const probe = frames[wangKey(ground, 0, 0, 0, 0)]
    if (!probe) return false

    const tile = 32
    const cols = Math.ceil(world.arenaW / tile)
    const rows = Math.ceil(world.arenaH / tile)
    const vw = cols + 1
    const vh = rows + 1
    const rng = new Rng(world.seed ^ 0x7e44a1)
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
    const soilSet = world.map.terrain.soilSet
    const soilEdgeCols = world.map.terrain.soilEdgeCols
    const soil = new Uint8Array(vw * vh)
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        if (vx < soilEdgeCols || vx >= vw - soilEdgeCols) soil[vy * vw + vx] = 1
      }
    }

    const startTx = Math.max(0, Math.floor(this.camX / tile) - 1)
    const startTy = Math.max(0, Math.floor(this.camY / tile) - 1)
    const endTx = Math.min(cols, startTx + Math.ceil(this.viewW / tile) + 3)
    const endTy = Math.min(rows, startTy + Math.ceil(this.viewH / tile) + 3)
    const corners = (at: Uint8Array, x: number, y: number): [Corner, Corner, Corner, Corner] => [
      at[y * vw + x] as Corner, at[y * vw + x + 1] as Corner,
      at[(y + 1) * vw + x] as Corner, at[(y + 1) * vw + x + 1] as Corner,
    ]
    for (let ty = startTy; ty < endTy; ty++) {
      for (let tx = startTx; tx < endTx; tx++) {
        const g = frames[wangKey(ground, ...corners(field, tx, ty))]
        if (g) this.drawFrame(g, tx * tile, ty * tile)
        const sc = corners(soil, tx, ty)
        if (sc[0] || sc[1] || sc[2] || sc[3]) {
          const sf = frames[wangKey(soilSet, ...sc)]
          if (sf) this.drawFrame(sf, tx * tile, ty * tile)
        }
      }
    }
    return true
  }

  /** Paint everything, camera centred on the player. */
  paint(world: World): void {
    /*
       Centred on the player and CLAMPED TO THE ARENA, matching
       `Camera.clamp` in src/render/camera.ts.

       Without the clamp a shot near an edge shows ground beyond the fence that
       the game never lets you see — the arena canvas simply ends and the base
       fill shows through as a flat green band. That is precisely the class of
       divergence this file exists to avoid: a screenshot that looks
       authoritative and is of a view the player cannot have.
    */
    const maxX = Math.max(0, world.arenaW - this.viewW)
    const maxY = Math.max(0, world.arenaH - this.viewH)
    this.camX = Math.round(Math.min(maxX, Math.max(0, world.player.x - this.viewW / 2)))
    this.camY = Math.round(Math.min(maxY, Math.max(0, world.player.y - this.viewH / 2)))
    this.terrain(world)

    const drawList: { y: number; f: Frame; x: number }[] = []
    // Scenery joins the same sorted list as everything else, as in the game.
    for (const sc of this.scenery(world)) drawList.push({ y: sc.y, x: sc.x, f: sc.f })
    for (let i = 0; i < world.props.live; i++) {
      const c = world.props.items[i]
      // Animated if the atlas has a loop for it, static otherwise. Mirrors
      // Renderer.propFrame exactly, including the position-derived phase --
      // a screenshot where the whole field sways on one frame while the game
      // staggers them would be a screenshot of a different program.
      const len = clipLengths[c.sprite]?.play ?? 1
      const f = len > 1
        ? frames[`${c.sprite}.${((((world.elapsed * PROP_FPS) | 0) + ((c.x * 0.7 + c.y * 1.3) | 0)) % len)}`] ?? frames[c.sprite]
        : frames[c.sprite]
      if (f) drawList.push({ y: c.y, x: c.x, f })
    }
    // Breakables: a separate pool, so a separate loop, same as in the renderer.
    for (let i = 0; i < world.breakables.live; i++) {
      const b = world.breakables.items[i]
      const len = clipLengths[b.sprite]?.play ?? 1
      const f = len > 1
        ? frames[`${b.sprite}.${((((world.elapsed * PROP_FPS) | 0) + ((b.x * 0.7 + b.y * 1.3) | 0)) % len)}`] ?? frames[b.sprite]
        : frames[b.sprite]
      if (f) drawList.push({ y: b.y, x: b.x, f })
    }
    for (let i = 0; i < world.enemies.live; i++) {
      const e = world.enemies.items[i]
      const moving = e.stun <= 0 && e.dying <= 0 && (e.vx !== 0 || e.vy !== 0)
      const f = (e.attackT > 0 && e.dying <= 0
        ? this.clipFrame(e.sheetId, e.facing, 'attack', e.attackT / ATTACK_SECONDS)
        : undefined)
        ?? this.sheetFrame(e.sheetId, e.facing, e.travelled, moving)
      if (f) drawList.push({ y: e.y, x: e.x, f })
    }
    {
      const p = world.player
      const f = this.sheetFrame(p.classId, p.facing, p.travelled, p.vx !== 0 || p.vy !== 0)
      if (f) drawList.push({ y: p.y, x: p.x, f })
    }
    drawList.sort((a, b) => a.y - b.y)
    for (const d of drawList) this.drawFrame(d.f, d.x, d.y)

    // Melee sweeps and auras: swept wedges, matching the renderer. These used to
    // draw as a filled square the size of the whole hitbox — a ~100px white block
    // that was the loudest thing on screen.
    for (let i = 0; i < world.projectiles.live; i++) {
      const p = world.projectiles.items[i]
      const aura = p.type === 'aura'
      if (p.behaviour !== 'arcSwing' && !aura) continue
      // A swing with its own art is drawn as a sprite below, not as a wedge.
      if (!aura && swingSprite(world, p)) continue
      const half = 0.85
      for (let r = 0; r <= p.radius; r += 0.5) {
        const inner = aura ? p.radius * 0.86 : 0
        if (r < inner) continue
        const from = aura ? -Math.PI : p.angle - half
        const to = aura ? Math.PI : p.angle + half
        for (let a = from; a <= to; a += 0.02) {
          this.tint(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, aura ? 0x96cde1 : 0xf2ead2, 0.3)
        }
      }
    }

    for (let i = 0; i < world.projectiles.live; i++) {
      const p = world.projectiles.items[i]
      const swing = p.type !== 'aura' ? swingSprite(world, p) : null
      if ((p.behaviour === 'arcSwing' || p.type === 'aura') && !swing) continue
      const f = swing?.frame ?? this.projectileFrame(world, p)
      if (!f) continue
      const rot = p.vx !== 0 || p.vy !== 0 ? Math.atan2(p.vy, p.vx) : p.angle
      const scale = swing
        ? (p.radius * 2) / Math.max(8, swing.frame.w)
        : PROJECTILE_SCALE * projectileScaleFor(p.weaponId)
      this.drawFrameT(f, p.x, p.y, rot, scale)
    }

    this.weaponRing(world)

    // Ground hazards, under the FX. The renderer fills and rims a disc per
    // hazard; this does the same flatly. Without it a Bait Drum or Chem Sprayer
    // paints an empty field, and the range would report a working weapon as
    // drawing nothing — which is exactly what it did before this existed.
    for (let i = 0; i < world.hazards.live; i++) {
      const h = world.hazards.items[i]
      const [fill, rim] =
        h.kind === 'slow' ? [0x5e4a2e, 0x8c7046]
        : h.kind === 'lure' ? [0xd6b054, 0xecce80]
        : h.kind === 'gas' ? [0xc4d66c, 0xe2f096]
        // Matches PALETTE.hazardBurn in the renderer; see the note there.
        : h.kind === 'damage' ? [0xe27a2e, 0xffb054]
        : [0x96e24a, 0xc6fa78]
      const alpha = h.kind === 'slow' ? 0.55 : h.kind === 'lure' ? 0.35 : h.kind === 'damage' ? 0.34 : 0.38
      // Scanned as a filled disc over the bounding box, not swept by angle.
      // Sweeping leaves moire rings that get denser toward the centre, which
      // turned a 260px lure into an opaque dithered pancake covering the tile.
      const rr = h.radius * h.radius
      const rim2 = (h.radius - 2) * (h.radius - 2)
      for (let dy = -h.radius; dy <= h.radius; dy++) {
        for (let dx = -h.radius; dx <= h.radius; dx++) {
          const d = dx * dx + dy * dy
          if (d > rr) continue
          const onRim = d > rim2
          this.tint(h.x + dx, h.y + dy, onRim ? rim : fill, onRim ? 0.9 : alpha)
        }
      }
      // The map's own hazards carry art. Same order as the renderer — over the
      // fill, under nothing else here, because the painter draws the rim in the
      // same pass above. A screenshot that omitted this would show the Burn's
      // fires as plain orange discs.
      if (h.sprite) {
        const f = frames[h.sprite]
        if (f) this.drawFrameCentred(f, h.x, h.y)
      }
    }

    for (let i = 0; i < world.effects.live; i++) {
      const e = world.effects.items[i]
      // Same element fallback as the renderer: fx.arrowImpact.acid -> fx.arrowImpact.
      let name = `fx.${e.clip}`
      if (!frames[`${name}.0`]) {
        const dot = name.lastIndexOf('.')
        if (dot > 0) name = name.slice(0, dot)
      }
      const len = clipLengths[name]?.play ?? 1
      const t = 1 - e.life / e.maxLife
      let fi = (t * len) | 0
      if (fi >= len) fi = len - 1
      const f = frames[`${name}.${fi}`]
      if (f) this.drawFrame(f, e.x, e.y)
    }

    for (let i = 0; i < world.pickups.live; i++) {
      const g = world.pickups.items[i]
      const f = frames[`pickup.${g.kind}`]
      if (f) {
        this.drawFrame(f, g.x, g.y)
      } else {
        const s = g.kind === 'xp' ? 5 : 7
        fillRect(
          this.canvas,
          Math.round((g.x - this.camX) * this.zoom - (s * this.zoom) / 2),
          Math.round((g.y - this.camY) * this.zoom - (s * this.zoom) / 2),
          s * this.zoom, s * this.zoom,
          g.kind === 'xp' ? 0x5fd0c6 : 0xe0b040,
        )
      }
    }
  }

  /**
   * The sprite a projectile draws as — the renderer's rule, restated.
   *
   * Animated clip if the weapon declares one, else its icon. An element tints
   * the clip rather than replacing it, so a fire scattergun still throws sparks.
   */
  private projectileFrame(world: World, p: {
    weaponId: string; behaviour: string; x: number
  }): Frame | undefined {
    return projectileSprite(world, p).frame
  }

  /** The weapon ring. Angles come straight from the sim, as in the renderer. */
  private weaponRing(world: World): void {
    for (const slot of world.player.weapons) {
      const wd = (WEAPONS as Record<string, Record<string, unknown>>)[slot.id]
      const tiers = Array.isArray(wd?.tierSprites) ? (wd.tierSprites as string[]) : null
      const key = tiers?.[Math.min(slot.tier, 4) - 1]
        ?? (typeof wd?.sprite === 'string' ? wd.sprite : `weapon.${slot.id}`)
      const f = frames[key]
      if (!f) continue
      const cfg = TUNING.fx as unknown as Record<string, number>
      const kick = slot.recoil > 0
        ? (slot.recoil / cfg.weaponRecoilSeconds) * cfg.weaponRecoilPixels
        : 0
      const r = cfg.weaponRingRadius
      const x = world.player.x + Math.cos(slot.ringAngle) * r - Math.cos(slot.aimAngle) * kick
      const y = world.player.y + Math.sin(slot.ringAngle) * r - Math.sin(slot.aimAngle) * kick - 14
      const facingLeft = Math.abs(slot.aimAngle) > Math.PI / 2
      this.drawFrameT(
        f, x, y,
        facingLeft ? slot.aimAngle + Math.PI : slot.aimAngle,
        Math.min(1.15, cfg.weaponRingTargetWidth / Math.max(8, f.w)),
      )
    }
  }
}

export { encodePng, blankImage, type Image }
