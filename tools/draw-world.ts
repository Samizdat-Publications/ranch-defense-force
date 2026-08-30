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
import { blightField, DEFAULT_BLIGHT, type BlightConfig } from '../src/render/blight.ts'
import { groundLayers } from '../src/render/terrain.ts'

/** Default zoom. The game derives its own; see `zoomFor` in the renderer. */
export const ZOOM = 2
const TERRAIN = (TUNING as unknown as {
  terrain?: { blight?: Partial<BlightConfig> }
}).terrain ?? {}
/** Ash timing is global; which SET it spreads in is per-map. */
const BLIGHT: BlightConfig = { ...DEFAULT_BLIGHT, ...TERRAIN.blight }
const PIXELS_PER_WALK_FRAME = 11
/** Matches `PROJECTILE_SCALE` in the renderer; per-weapon multiplier on top. */
const PROJECTILE_SCALE = 0.55
/** unTied's projectile and FX clips are authored at 15fps. */
const CLIP_FPS = 15

export interface Frame { x: number; y: number; w: number; h: number; ox: number; oy: number }
interface AtlasJson {
  rig: { directions: string[] }
  clipLengths: Record<string, Record<string, number>>
  frames: Record<string, Frame>
}

const atlasImg = decodePng(readFileSync('public/atlas.png'))
const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as AtlasJson

export const frames = atlas.frames
/** The packed sheet itself, for tools that blit frames without a WorldPainter. */
export const atlasImage = atlasImg
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

  private directionIndex(facing: number): number {
    const c = Math.cos(facing)
    const s = Math.sin(facing)
    if (Math.abs(c) >= Math.abs(s) * 0.85) return c < 0 ? 2 : 3
    return s > 0 ? 0 : 1
  }

  private sheetFrame(sheet: string, facing: number, travelled: number, moving: boolean): Frame | undefined {
    const dir = atlas.rig.directions[this.directionIndex(facing)] ?? 'down'
    if (!moving) return frames[`${sheet}.idle.${dir}.0`]
    const len = clipLengths[sheet]?.walk ?? 6
    const f = Math.floor(travelled / PIXELS_PER_WALK_FRAME) % len
    return frames[`${sheet}.walk.${dir}.${f}`]
  }

  private terrain(world: World): void {
    fillRect(this.canvas, 0, 0, this.canvas.width, this.canvas.height, 0x479757)
    if (this.wangTerrain(world)) return

    const grass = frames['terrain.grass']
    const dirt = frames['terrain.dirt']
    const soil = frames['terrain.soil']

    const tile = 32
    const startTx = Math.floor(this.camX / tile) - 1
    const startTy = Math.floor(this.camY / tile) - 1
    const terrainRng = new Rng(world.seed ^ 0x7e44a1)
    // THE PRE-WANG STAMPED GROUND, and it no longer draws the map — it draws
    // the one arena that existed before maps did. It fires only when the
    // tilesets are not packed, which is a fresh clone that has not run
    // `npm run atlas`, and in that state the point is that the game RUNS.
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
   * **The field generation is no longer restated.** It used to be — 26 blobs and
   * two soil columns, hand-copied, with a note saying they had to stay in step.
   * Maps made that untenable: five map descriptors and four layer shapes is far
   * too much to keep in step by hand, and the failure would be silent, so
   * `groundLayers` is imported and this method does nothing but BLIT. What is
   * still duplicated is the camera window and the draw order, which is the part
   * a second implementation is a useful check on.
   */
  private wangTerrain(world: World): boolean {
    const map = world.map
    const base = map.layers[0]
    if (!base || !frames[wangKey(base.set, 0, 0, 0, 0)]) return false

    const tile = 32
    const cols = Math.ceil(world.arenaW / tile)
    const rows = Math.ceil(world.arenaH / tile)
    const vw = cols + 1
    const layers = groundLayers(map, world.seed, cols, rows)
    // Shared with the renderer rather than restated, same as the layers.
    const blight = blightField(world.seed, cols, rows, world.spawner?.wave ?? 1, BLIGHT)
    const blightSet = map.blight ?? BLIGHT.set

    const startTx = Math.max(0, Math.floor(this.camX / tile) - 1)
    const startTy = Math.max(0, Math.floor(this.camY / tile) - 1)
    const endTx = Math.min(cols, startTx + Math.ceil(this.viewW / tile) + 3)
    const endTy = Math.min(rows, startTy + Math.ceil(this.viewH / tile) + 3)
    const corners = (at: Uint8Array, x: number, y: number): [Corner, Corner, Corner, Corner] => [
      at[y * vw + x] as Corner, at[y * vw + x + 1] as Corner,
      at[(y + 1) * vw + x] as Corner, at[(y + 1) * vw + x + 1] as Corner,
    ]
    const put = (set: string, at: Uint8Array, tx: number, ty: number, coverAll: boolean): void => {
      const c = corners(at, tx, ty)
      if (!coverAll && !(c[0] || c[1] || c[2] || c[3])) return
      const f = frames[wangKey(set, ...c)]
      if (f) this.drawFrame(f, tx * tile, ty * tile)
    }

    for (let ty = startTy; ty < endTy; ty++) {
      for (let tx = startTx; tx < endTx; tx++) {
        // Base, then the ash, then the map's features — the renderer's order,
        // and the ash sits under the features on purpose. See bakeWangGround.
        put(base.set, layers[0].field, tx, ty, true)
        if (blight) put(blightSet, blight, tx, ty, false)
        for (let i = 1; i < layers.length; i++) put(layers[i].set, layers[i].field, tx, ty, false)
      }
    }
    return true
  }

  /** Paint everything, camera centred on the player. */
  paint(world: World): void {
    /*
       CLAMPED TO THE ARENA, like the real camera and unlike this method until
       now. It centred on the player unconditionally, so standing near an edge
       put the void on screen — invisible on a 3200x2100 field where the player
       rarely reaches one, and immediately obvious in a 1400x1000 cave, where
       the bottom third of every shot was flat green.

       `Camera.clamp` does the same two lines. A headless picture that shows
       something the game never shows is worse than no picture.
    */
    this.camX = Math.max(0, Math.min(
      Math.round(world.player.x - this.viewW / 2), Math.max(0, world.arenaW - this.viewW)))
    this.camY = Math.max(0, Math.min(
      Math.round(world.player.y - this.viewH / 2), Math.max(0, world.arenaH - this.viewH)))
    this.terrain(world)

    const drawList: { y: number; f: Frame; x: number }[] = []
    for (let i = 0; i < world.props.live; i++) {
      const c = world.props.items[i]
      const f = frames[c.sprite]
      if (f) drawList.push({ y: c.y, x: c.x, f })
    }
    for (let i = 0; i < world.enemies.live; i++) {
      const e = world.enemies.items[i]
      const moving = e.stun <= 0 && e.dying <= 0 && (e.vx !== 0 || e.vy !== 0)
      const f = this.sheetFrame(e.typeId, e.facing, e.travelled, moving)
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
        : [0x96e24a, 0xc6fa78]
      const alpha = h.kind === 'slow' ? 0.55 : h.kind === 'lure' ? 0.35 : 0.38
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

    this.dark(world)
  }

  /**
   * The dark, underground — the renderer's `drawDark`, restated per-pixel.
   *
   * Restated because it has to be. `Renderer.drawDark` is a canvas radial
   * gradient and there is no canvas here, so this walks the pixels and computes
   * the same falloff. It matters more than most of the duplication in this file:
   * a headless shot of a cave WITHOUT it is a picture of a floor nobody will
   * ever see that brightly, which would make every screenshot in
   * `docs/progress/` a lie about the cave levels.
   *
   * The numbers are the renderer's, exactly — lit radius, the three stops, and
   * the alphas — so if one is tuned the other has to be. Both say so.
   */
  private dark(world: World): void {
    const k = world.map.darkness ?? 0
    if (k <= 0) return

    const view = Math.max(this.viewW, this.viewH)
    const lit = view * (0.62 - k * 0.34)
    const inner = lit * 0.35
    const px = (world.player.x - this.camX) * this.zoom
    const py = (world.player.y - this.camY) * this.zoom
    const litPx = lit * this.zoom
    const innerPx = inner * this.zoom
    const midAlpha = k * 0.5
    const outAlpha = 0.55 + k * 0.42

    const img = this.canvas
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const d = Math.hypot(x - px, y - py)
        let a: number
        if (d <= innerPx) a = 0
        else if (d >= litPx) a = outAlpha
        else {
          // The canvas gradient's two segments: 0 -> midAlpha to the 0.55 stop,
          // then midAlpha -> outAlpha to the rim.
          const t = (d - innerPx) / (litPx - innerPx)
          a = t <= 0.55
            ? (t / 0.55) * midAlpha
            : midAlpha + ((t - 0.55) / 0.45) * (outAlpha - midAlpha)
        }
        if (a <= 0) continue
        const i = (y * img.width + x) * 4
        img.data[i] = Math.round(img.data[i] * (1 - a) + 6 * a)
        img.data[i + 1] = Math.round(img.data[i + 1] * (1 - a) + 6 * a)
        img.data[i + 2] = Math.round(img.data[i + 2] * (1 - a) + 8 * a)
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
