/**
 * One atlas, one draw path, one pass.
 *
 * Sprites are collected into a flat reusable list, counting-sorted into 8px
 * y-bands, and blitted. `save`/`restore` is used only for the few entities that
 * actually need a transform — a dying enemy spinning, or a fallback square
 * doing the bob-and-lean that stands in for an animation it does not have.
 * Everything with a real walk cycle draws as a plain `drawImage`, because at
 * 800 entities the difference between "one drawImage" and "save, translate,
 * rotate, drawImage, restore" is the frame budget.
 *
 * Anything the atlas has no art for falls back to a coloured square, so a
 * missing sheet degrades to the M0-M3 look for that one entity rather than
 * crashing or drawing nothing.
 */
import type { World } from '../sim/world'
import { Camera } from './camera'
import {
  ENEMIES, NODES, TUNING, WEAPONS, itemCardSprite, projectileScaleFor, type MapTerrain,
} from '../content'
import { Atlas, type AtlasFrame } from '../core/atlas'
import { Rng } from '../core/rng'
import { wangKey, type Corner } from './wang'

const BUCKET = 8

/**
 * Pick the zoom for a canvas height.
 *
 * Integer only — a 32px sprite at 2.5x is a blurry 32px sprite.
 *
 * Derived rather than fixed, because a fixed zoom makes screen size and device
 * pixel ratio control HOW MUCH WORLD you see. At 1920x1080 with dpr 1.5 the
 * canvas is 1620 tall, and a zoom of 2 showed 810 world pixels of a 1600-tall
 * arena: the farmer was 2% of screen width and a 24px bullet was a speck. Six
 * carefully distinguished rounds cannot survive that, which is why they still
 * read as one bullet after the art was fixed. Now a denser screen buys a
 * sharper picture at the same world scale, which is what it should always have
 * bought.
 */
export function zoomFor(canvasHeight: number): number {
  const cam = TUNING.camera as unknown as Record<string, number>
  const target = cam.targetWorldHeight ?? 340
  const raw = Math.round(canvasHeight / target)
  return Math.max(cam.minZoom ?? 2, Math.min(cam.maxZoom ?? 8, raw))
}
/** Walk cycle advances one frame per this many pixels travelled, so sprites
 *  never appear to skate. */
const PIXELS_PER_WALK_FRAME = 11
/**
 * Base scale for a projectile sprite; each weapon multiplies it by its own
 * `projectileScale`.
 *
 * A single number could not serve both a 96x64 mortar shell and a 48x48 pellet
 * burst, and the per-weapon multiplier is what lets each round be drawn at the
 * size its silhouette needs to be recognised at.
 */
const PROJECTILE_SCALE = 0.55
/** unTied's projectile clips are authored at 15fps. */
const PROJECTILE_FPS = 15
/**
 * Ambient prop loops run slower than combat art on purpose. A crop swaying at
 * 15fps reads as a flicker; at 8 it reads as wind, and the whole point of the
 * pass is that the field looks alive without competing with the fight for the
 * player's eye.
 */
const PROP_FPS = 8

/** Fog tile edge, in world pixels. A power of two so the wrap arithmetic is exact. */
const FOG_TILE = 512
/** Blobs per fog tile. More is not denser, only slower -- alpha carries density. */
const FOG_BLOBS = 26

/**
 * Which Wang sets the ground bakes from — now the MAP's, not a global.
 *
 * This used to be `TUNING.terrain`, one ground for every run. It moved into
 * src/content/maps.json when maps arrived, and it moved rather than being
 * copied: two content files naming the same ground would be the same trap as
 * two art groups writing one frame key, where the later one silently wins and
 * nothing tells you which is live. `tuning.json` now carries only a pointer.
 *
 * Blight is still BANDS rather than a blend, for the reason it always was: a
 * Wang set is a whole terrain pair and you cannot cross-fade two of them, you
 * swap and re-bake. A map with an empty `blight` array never changes ground.
 */

interface DrawItem {
  x: number
  y: number
  /**
   * Pixels to lift this item when DRAWING, without moving where it SORTS.
   *
   * y is both the drawn position and the depth key for everything that stands
   * on the ground, which is nearly everything, and 0 here keeps that true. The
   * weapon ring is the exception: a carried weapon is lifted to torso height,
   * and that lift was going into the sort as well — a weapon at the character's
   * side sat at `p.y - 14` and therefore drew BEHIND him. That is most of why
   * the ring read as an orbit passing around the body instead of gear held
   * against it. Lift is a picture; depth is a position; they are not the same
   * number.
   */
  liftY: number
  frame: AtlasFrame | null
  /** Fallback square, used when the atlas has no art for this entity. */
  colour: string
  w: number
  h: number
  flash: boolean
  scaleX: number
  scaleY: number
  rotation: number
  outline: string | null
  alpha: number
}

const PALETTE = {
  void: '#171a1d',
  enemy: '#7a6a86',
  enemyElite: '#d8b23c',
  projectile: '#cfe0a0',
  melee: '#f2ead2',
  xp: '#5fd0c6',
  feed: '#e0b040',
  // Hazards split into two families that must never be confused, because one
  // helps you and the other kills you. Yours are earthy and cool; theirs are
  // sickly, brighter than anything else on a green field, and ringed.
  hazardSlow: 'rgba(94, 74, 46, 0.55)',
  hazardSlowRim: 'rgba(140, 112, 70, 0.75)',
  hazardLure: 'rgba(214, 176, 84, 0.35)',
  hazardLureRim: 'rgba(236, 206, 128, 0.7)',
  hazardGas: 'rgba(196, 214, 108, 0.34)',
  hazardGasRim: 'rgba(226, 240, 150, 0.85)',
  hazardAcid: 'rgba(150, 226, 74, 0.40)',
  hazardAcidRim: 'rgba(198, 250, 120, 0.9)',
  /** 'damage' used to fall through to the acid colours, which was invisible
   *  while the only hazards were weapon-made — nothing in the game raised a
   *  bare `damage` hazard. The Burn's fires do, and an acid-green fire is a
   *  lie about what is hurting you. */
  hazardBurn: 'rgba(226, 122, 46, 0.34)',
  hazardBurnRim: 'rgba(255, 176, 84, 0.9)',
  telegraph: 'rgba(220, 90, 90, 0.28)',
  blood: '#a02c2c',
}

export class Renderer {
  readonly camera: Camera
  /** Integer world-to-screen scale, recomputed on every resize. */
  private zoom: number
  private ctx: CanvasRenderingContext2D
  /** The baked fog tile, or null on a map that declares no fog. */
  private fog: HTMLCanvasElement | null = null
  private decals: HTMLCanvasElement
  private decalCtx: CanvasRenderingContext2D
  private terrain: HTMLCanvasElement | null = null
  /** Which ground set the baked terrain currently holds, so it re-bakes once
   *  per band rather than once per frame. Empty until the first bake — the
   *  map is not readable from a field initialiser. */
  private bakedSet = ''

  /**
   * Static decorative props, y-sorted with everything else.
   *
   * Renderer-owned, not sim-owned, because scenery has no behaviour: it never
   * moves, never collides and never takes damage, so putting it in the world
   * would add a pool and a tick cost for something that is a picture. It draws
   * through the same sorted pass as crops, so the player walks in front of and
   * behind it rather than always on top.
   *
   * Placed in a BAND NEAR THE EDGES. These carry no collision — there is no
   * scenery collider in the sim and adding one is a gameplay change, not a
   * dressing one — and walking through a water trough in open field would read
   * as a bug. Around the periphery, where the fence already is and the player
   * rarely fights, it reads as the farm the arena was cut out of.
   */
  private readonly scenery: { x: number; y: number; frame: AtlasFrame }[] = []

  /** Melee sweeps and auras, collected during the sprite pass and stroked as
   *  arcs afterwards. Fixed length, reused; never reallocated per frame. */
  private readonly arcs: { x: number; y: number; radius: number; angle: number; aura: boolean }[] = []

  private readonly items: DrawItem[] = []
  private itemCount = 0
  private readonly bucketCounts: Int32Array
  private readonly bucketStart: Int32Array
  private readonly bucketCursor: Int32Array
  private readonly order: Int32Array
  private readonly bucketRows: number

  drawCalls = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly atlas: Atlas | null,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    this.zoom = zoomFor(canvas.height)
    this.camera = new Camera(canvas.width / this.zoom, canvas.height / this.zoom, world.arenaW, world.arenaH)

    this.decals = document.createElement('canvas')
    this.decals.width = world.arenaW
    this.decals.height = world.arenaH
    const dctx = this.decals.getContext('2d')
    if (!dctx) throw new Error('decal canvas context unavailable')
    this.decalCtx = dctx

    // Scenery is scattered before the draw list is sized, because it competes
    // for the same fixed slots: `push()` returns null when the list is full and
    // the caller breaks, so under-sizing here silently drops whatever sorts
    // last — the far side of the field.
    this.buildScenery()
    const cap = TUNING.pools.enemies + TUNING.pools.projectiles + TUNING.pools.props
      + this.scenery.length + 64
    for (let i = 0; i < cap; i++) {
      this.items.push({
        x: 0, y: 0, liftY: 0, frame: null, colour: '', w: 0, h: 0, flash: false,
        scaleX: 1, scaleY: 1, rotation: 0, outline: null, alpha: 1,
      })
    }
    this.bucketRows = Math.ceil(world.arenaH / BUCKET) + 2
    this.bucketCounts = new Int32Array(this.bucketRows)
    this.bucketStart = new Int32Array(this.bucketRows + 1)
    this.bucketCursor = new Int32Array(this.bucketRows)
    this.order = new Int32Array(cap)

    this.bakeTerrain()
    this.bakeFog()
  }

  /**
   * Scatter the scenery once, from a stream of its own.
   *
   * Seeded apart from the ground and the decals for the same reason those are
   * seeded apart from each other and from the sim: nothing decorative may move
   * a tile, a decal or a spawn.
   */
  private buildScenery(): void {
    const atlas = this.atlas
    if (!atlas) return
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
    ].map((k) => atlas.get(k)).filter((f): f is AtlasFrame => !!f)
    if (!kinds.length) return

    const rng = new Rng(this.world.seed ^ 0x5ce_1e11)
    const W = this.world.arenaW
    const H = this.world.arenaH
    // How deep the peripheral band reaches in from each edge.
    const BAND = 220
    const count = Math.round((W * H) / 90_000)
    for (let i = 0; i < count; i++) {
      const f = kinds[rng.int(0, kinds.length - 1)]
      // Pick an edge, then a point inside that edge's band.
      let x: number
      let y: number
      switch (rng.int(0, 3)) {
        case 0: x = rng.int(40, W - 40); y = rng.int(40, BAND); break
        case 1: x = rng.int(40, W - 40); y = rng.int(H - BAND, H - 40); break
        case 2: x = rng.int(40, BAND); y = rng.int(40, H - 40); break
        default: x = rng.int(W - BAND, W - 40); y = rng.int(40, H - 40); break
      }
      this.scenery.push({ x, y, frame: f })
    }
  }

  resize(w: number, h: number): void {
    this.canvas.width = w
    this.canvas.height = h
    this.zoom = zoomFor(h)
    this.camera.resize(w / this.zoom, h / this.zoom)
    this.ctx.imageSmoothingEnabled = false
  }

  /**
   * Terrain bakes once into an offscreen canvas and blits as one image per
   * frame — never per-tile draws (§13). Deterministic from the run seed, so a
   * replayed run gets the same field.
   */
  /** This run's map terrain. */
  private get terrainCfg(): MapTerrain {
    return this.world.map.terrain
  }

  /** The ground set for a wave: the last band whose `fromWave` has been reached. */
  private groundSetFor(wave: number): string {
    const t = this.terrainCfg
    let set = t.groundSet
    let best = -Infinity
    // Scan for the highest reached `fromWave` rather than trusting array order:
    // bands are authored per map now, and one written out of order would
    // otherwise silently pick the wrong ground.
    for (const b of t.blight) {
      if (wave >= b.fromWave && b.fromWave > best) { best = b.fromWave; set = b.groundSet }
    }
    return set
  }

  private bakeTerrain(groundSet: string = this.terrainCfg.groundSet): void {
    this.bakedSet = groundSet
    const c = document.createElement('canvas')
    c.width = this.world.arenaW
    c.height = this.world.arenaH
    const g = c.getContext('2d')
    if (!g) return
    g.imageSmoothingEnabled = false

    const tile = 32
    const cols = Math.ceil(c.width / tile)
    const rows = Math.ceil(c.height / tile)
    const rng = new Rng(this.world.seed ^ 0x7e44a1)

    const grass = this.atlas?.get('terrain.grass')
    const dirt = this.atlas?.get('terrain.dirt')
    const soil = this.atlas?.get('terrain.soil')

    if (!this.atlas || !grass) {
      // No atlas: the M0-M3 checkerboard, so the game still runs.
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          g.fillStyle = (x + y) % 2 === 0 ? '#6f7d4f' : '#67754a'
          g.fillRect(x * tile, y * tile, tile, tile)
        }
      }
      this.terrain = c
      return
    }

    const img = this.atlas.image
    const put = (f: AtlasFrame, x: number, y: number): void => {
      g.drawImage(img, f.x, f.y, f.w, f.h, x, y, tile, tile)
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) put(grass, x * tile, y * tile)
    }

    // Wang ground if the tilesets are packed; the stamped version below if not.
    if (this.bakeWangGround(g, cols, rows, tile, groundSet)) {
      this.paintDecals(g, c)
      this.paintFence(g, c)
      this.terrain = c
      return
    }

    // Worn dirt patches where a farm gets walked on.
    if (dirt) {
      for (let i = 0; i < 26; i++) {
        const cx = rng.int(2, cols - 3)
        const cy = rng.int(2, rows - 3)
        const r = rng.int(1, 3)
        for (let y = -r; y <= r; y++) {
          for (let x = -r; x <= r; x++) {
            if (x * x + y * y > r * r) continue
            put(dirt, (cx + x) * tile, (cy + y) * tile)
          }
        }
      }
    }

    // Tilled rows along two edges — the corn rows things come out of (§8).
    if (soil) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < 3; x++) put(soil, x * tile, y * tile)
        for (let x = cols - 3; x < cols; x++) put(soil, x * tile, y * tile)
      }
    }

    this.paintFence(g, c)
    this.terrain = c
  }

  /** Fence line, drawn flat until the fence tiles are in the atlas. */
  /**
   * The arena boundary, as real fence rather than a stroked rectangle.
   *
   * It was `strokeRect` with a brown line, which read as a border and not as a
   * fence. Posts are stamped at a fixed pitch with the broken rail spliced in
   * on a roll, so the line reads as a fence somebody stopped maintaining.
   *
   * Baked into the terrain, which is right HERE and would not be right in the
   * field: a baked sprite has no y-sort, so the player draws over it. On the
   * boundary that never shows, because the player is always inside it.
   *
   * Falls back to the stroked line if the art is not packed — the boundary has
   * to be legible even with no atlas.
   */
  private paintFence(g: CanvasRenderingContext2D, c: HTMLCanvasElement): void {
    const post = this.atlas?.get('prop.fencePost')
    const rail = this.atlas?.get('prop.fenceRail')
    const img = this.atlas?.image
    if (!post || !img) {
      g.strokeStyle = '#6b5027'
      g.lineWidth = 6
      g.strokeRect(3, 3, c.width - 6, c.height - 6)
      return
    }

    // Its own stream, seeded apart from the ground's, so adding fence variety
    // cannot shift which tile the ground drew.
    const rng = new Rng(this.world.seed ^ 0x5eed_fe4c)
    const PITCH = 56
    const put = (f: AtlasFrame, x: number, y: number): void => {
      g.drawImage(img, f.x, f.y, f.w, f.h, Math.round(x + f.ox), Math.round(y + f.oy), f.w, f.h)
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

  /**
   * Bake the fog tile.
   *
   * ONE seamless tile, drawn once at init, then blitted twice a frame at two
   * offsets. The alternative -- compositing blobs live -- is per-frame work
   * proportional to the blob count, and the whole point of this layer is that
   * it costs almost nothing: two hundred enemies are already on screen.
   *
   * Seamlessness is the only fiddly part, and it is bought by drawing every
   * blob NINE times, once per neighbouring wrap. A blob near an edge therefore
   * has its other half painted on the far side, and the tile abuts itself with
   * no seam. Blurring a non-seamless tile does not fix this; it just makes the
   * seam soft, and a soft straight line across a field is more obviously wrong
   * than a hard one.
   */
  private bakeFog(): void {
    const cfg = this.world.map.fog
    if (!cfg) { this.fog = null; return }

    const size = FOG_TILE
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')
    if (!g) { this.fog = null; return }

    // Seeded off the run, and off its OWN stream, for the same reason the
    // ground and the decals are: nothing decorative may move a spawn.
    const rng = new Rng(this.world.seed ^ 0xf0_9c1a)
    g.fillStyle = cfg.tint
    for (let i = 0; i < FOG_BLOBS; i++) {
      const x = rng.range(0, size)
      const y = rng.range(0, size)
      const r = rng.range(size * 0.10, size * 0.30) * cfg.scale
      const a = rng.range(0.25, 1)
      for (let wy = -1; wy <= 1; wy++) {
        for (let wx = -1; wx <= 1; wx++) {
          const cx = x + wx * size
          const cy = y + wy * size
          // Skip the wraps that cannot reach the tile at all.
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
    this.fog = c
  }

  /**
   * Two banks of fog, drifting at different speeds.
   *
   * Drawn in WORLD space, above the ground and decals and below every sprite,
   * so it lies on the floor rather than over the fight. One bank would read as
   * a moving texture; two at different rates read as depth, which is the only
   * reason there are two.
   *
   * The loop covers the visible rect only, so the cost is a handful of blits
   * regardless of how big the arena is.
   */
  private drawFog(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const cfg = this.world.map.fog
    const tile = this.fog
    if (!cfg || !tile) return

    const vw = this.canvas.width / this.zoom
    const vh = this.canvas.height / this.zoom
    const t = this.world.elapsed

    for (let bank = 0; bank < 2; bank++) {
      // The second bank runs faster and against the first, and carries less of
      // the alpha budget -- a near layer that is as solid as the far one reads
      // as two textures rather than as one volume.
      const speed = bank === 0 ? cfg.drift : -cfg.drift * 1.7
      const alpha = bank === 0 ? cfg.alpha : cfg.alpha * 0.55
      const dx = ((t * speed) % FOG_TILE + FOG_TILE) % FOG_TILE
      const dy = ((t * speed * 0.35) % FOG_TILE + FOG_TILE) % FOG_TILE

      ctx.globalAlpha = alpha
      const x0 = Math.floor((ox - dx) / FOG_TILE) * FOG_TILE + dx
      const y0 = Math.floor((oy - dy) / FOG_TILE) * FOG_TILE + dy
      for (let y = y0; y < oy + vh; y += FOG_TILE) {
        for (let x = x0; x < ox + vw; x += FOG_TILE) {
          ctx.drawImage(tile, Math.round(x), Math.round(y))
          this.drawCalls++
        }
      }
    }
    ctx.globalAlpha = 1
  }

  /**
   * Flat scenery scattered on the ground: ruts, scorch, mud, ash.
   *
   * Baked, and only FLAT things are, which is the whole rule. A decal lies on
   * the ground and can never be walked behind, so it loses nothing by having no
   * y-sort. A hay bale or a trough would — the player would draw on top of it —
   * and those need a sorted layer that does not exist yet.
   *
   * Density is deliberately low. ART_STYLE is explicit that the ground should
   * be BORING because two hundred enemies and their bullets are read against
   * it; this is meant to break up the field, not to decorate it.
   */
  private paintDecals(g: CanvasRenderingContext2D, c: HTMLCanvasElement): void {
    const img = this.atlas?.image
    if (!img) return
    const kinds = ['decal.tireRuts', 'decal.scorch', 'decal.mud', 'decal.ash']
      .map((k) => this.atlas?.get(k))
      .filter((f): f is AtlasFrame => !!f)
    if (!kinds.length) return

    const rng = new Rng(this.world.seed ^ 0x0dec_a15)
    const count = Math.round((c.width * c.height) / 240_000)
    for (let i = 0; i < count; i++) {
      const f = kinds[rng.int(0, kinds.length - 1)]
      const x = rng.int(60, c.width - 60)
      const y = rng.int(60, c.height - 60)
      g.globalAlpha = 0.75
      g.drawImage(img, f.x, f.y, f.w, f.h, Math.round(x + f.ox), Math.round(y + f.oy), f.w, f.h)
    }
    g.globalAlpha = 1
  }

  /**
   * Ground from a Wang tileset: corner autotiling instead of stamped squares.
   *
   * THE FIELD IS SAMPLED AT VERTICES, NOT CELLS, and that is the whole trick. A
   * cell asks what terrain sits at its four CORNERS and draws the tile matching
   * that combination, so a boundary between grass and dirt runs through tiles
   * rather than around them. Stamping whole tiles is what made the ground look
   * blocky; there is no amount of extra tile detail that fixes it, because the
   * staircase is in the geometry and not in the art.
   *
   * Two passes, because a Wang set is a PAIR of terrains and not a palette:
   * worn dirt through the pasture, then tilled soil down the two corn edges the
   * spawner uses. The second is drawn over the first and its own lower terrain
   * is grass, which is what the edges are.
   *
   * Returns false if the tilesets are not packed, and the caller falls back to
   * the stamped bake — a missing tileset costs the ground, not the game.
   */
  private bakeWangGround(
    g: CanvasRenderingContext2D, cols: number, rows: number, tile: number,
    groundSet: string = this.terrainCfg.groundSet,
  ): boolean {
    const atlas = this.atlas
    const base = this.terrainCfg.groundSet
    // A band naming a set that is not packed falls back rather than failing:
    // a missing tileset costs the ground, not the game.
    if (!atlas || !atlas.get(wangKey(groundSet, 0, 0, 0, 0))) {
      if (groundSet !== base && atlas?.get(wangKey(base, 0, 0, 0, 0))) {
        return this.bakeWangGround(g, cols, rows, tile, base)
      }
      return false
    }

    const img = atlas.image
    // Its own RNG stream: the ground must not move a single later spawn, and
    // the seed guarantee is what every replay test rests on.
    const rng = new Rng(this.world.seed ^ 0x7e44a1)

    const vw = cols + 1
    const vh = rows + 1
    /** 1 is the set's upper terrain, 0 its lower. Vertices, so (cols+1)^2. */
    const field = new Uint8Array(vw * vh).fill(1)

    // Worn patches, blobbed at vertices so their edges land between tiles.
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

    const paint = (set: string, at: Uint8Array): void => {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const nw = at[y * vw + x] as Corner
          const ne = at[y * vw + x + 1] as Corner
          const sw = at[(y + 1) * vw + x] as Corner
          const se = at[(y + 1) * vw + x + 1] as Corner
          const f = atlas.get(wangKey(set, nw, ne, sw, se))
          if (f) g.drawImage(img, f.x, f.y, f.w, f.h, x * tile, y * tile, tile, tile)
        }
      }
    }

    paint(groundSet, field)

    // The tilled edges the spawner calls `cornTile`. Upper is soil here, so the
    // field is inverted relative to the pass above: 0 everywhere, 1 at the ends.
    const soilSet = this.terrainCfg.soilSet
    const soilEdgeCols = this.terrainCfg.soilEdgeCols
    if (atlas.get(wangKey(soilSet, 1, 1, 1, 1))) {
      const soil = new Uint8Array(vw * vh)
      let any = false
      for (let vy = 0; vy < vh; vy++) {
        for (let vx = 0; vx < vw; vx++) {
          if (vx < soilEdgeCols || vx >= vw - soilEdgeCols) { soil[vy * vw + vx] = 1; any = true }
        }
      }
      if (any) {
        // Only cells that touch soil, so the pass does not repaint the pasture
        // with this set's own (identical) grass and double the draw cost.
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const nw = soil[y * vw + x] as Corner
            const ne = soil[y * vw + x + 1] as Corner
            const sw = soil[(y + 1) * vw + x] as Corner
            const se = soil[(y + 1) * vw + x + 1] as Corner
            if (!(nw || ne || sw || se)) continue
            const f = atlas.get(wangKey(soilSet, nw, ne, sw, se))
            if (f) g.drawImage(img, f.x, f.y, f.w, f.h, x * tile, y * tile, tile, tile)
          }
        }
      }
    }
    return true
  }

  draw(alpha: number, rand: () => number): void {
    const w = this.world
    const p = w.player
    const ctx = this.ctx
    this.drawCalls = 0

    // The ground degrades with the wave. Re-baking is a full-arena paint, so it
    // happens only when the band actually changes — three times in a long run,
    // never per frame. §13's "never per-tile draws" is about the frame loop.
    {
      const want = this.groundSetFor(w.spawner.wave)
      if (want !== this.bakedSet) this.bakeTerrain(want)
    }

    const pxi = p.px + (p.x - p.px) * alpha
    const pyi = p.py + (p.y - p.py) * alpha
    /*
       NO SHAKE WHILE THE SIM IS FROZEN.

       Trauma decays in `world.step` (`shake -= traumaDecayPerSecond * dt`) but
       is CONSUMED here, every frame, as a fresh random offset. The moment the
       step stops the decay stops with it — while the draw does not — so the
       value sticks at whatever the last hit set it to and the camera jitters at
       full magnitude forever.

       You saw it on the results screen, because dying is a hit: the field
       behind the sheet shook until the tab was closed. Level-up, shop and pause
       all set `paused` too and all had a milder version of it.

       Shake is a reaction to a live hit. A frozen frame should be still, so the
       renderer asks for none rather than the sim being taught to decay while
       paused — which would be the sim doing cosmetic work on a stopped clock.
    */
    this.camera.update(pxi, pyi, p.vx, p.vy, w.paused ? 0 : w.shake, rand)

    const ox = Math.round(this.camera.offsetX * this.zoom) / this.zoom
    const oy = Math.round(this.camera.offsetY * this.zoom) / this.zoom

    ctx.setTransform(this.zoom, 0, 0, this.zoom, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = PALETTE.void
    ctx.fillRect(0, 0, this.canvas.width / this.zoom, this.canvas.height / this.zoom)
    ctx.translate(-ox, -oy)

    if (this.terrain) {
      ctx.drawImage(this.terrain, 0, 0)
      this.drawCalls++
    }
    this.flushStains()
    ctx.drawImage(this.decals, 0, 0)
    this.drawCalls++
    // Above the ground and the decals, below every sprite and every warning:
    // fog on the floor, never over the fight.
    this.drawFog(ctx, ox, oy)

    this.drawArenaBurn(ctx)
    this.drawHazards(ctx)
    this.drawTelegraphs(ctx)
    // Ground effects (dash dust, the Dig In pulse) go under the sprite layer,
    // so they read as being on the field rather than pasted over the player.
    this.drawEffects(ctx, true)

    this.itemCount = 0
    this.arcs.length = 0
    this.collectSprites(alpha)
    this.drawArcs(ctx)
    this.sortAndDraw(ctx)

    this.drawEffects(ctx, false)
    this.drawPickups(ctx, alpha)
    this.drawParticles(ctx)
    this.drawDamageNumbers(ctx)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  private flushStains(): void {
    const s = this.world.stains
    if (s.length === 0) return
    const g = this.decalCtx
    g.globalAlpha = 0.5
    g.fillStyle = PALETTE.blood
    for (let i = 0; i < s.length; i += 3) {
      g.fillRect(Math.round(s[i]), Math.round(s[i + 1]), 2, 2)
    }
    g.globalAlpha = 1
    s.length = 0
  }

  private push(): DrawItem | null {
    if (this.itemCount >= this.items.length) return null
    const it = this.items[this.itemCount++]
    it.frame = null
    it.flash = false
    it.liftY = 0
    it.scaleX = 1
    it.scaleY = 1
    it.rotation = 0
    it.outline = null
    it.alpha = 1
    return it
  }

  /**
   * Pick the humanoid frame for an entity: idle when still, otherwise a walk
   * frame chosen by distance travelled.
   */
  private humanoidFrame(
    sheet: string, facing: number, travelled: number, moving: boolean,
  ): AtlasFrame | undefined {
    if (!this.atlas) return undefined
    // The sheet's OWN direction list: four for the humanoid rig, eight for the
    // generated animals. Asking the atlas keeps the two rigs from having to
    // know about each other here.
    const dir = this.atlas.directionFor(sheet, facing)
    if (!moving) return this.atlas.get(`${sheet}.idle.${dir}.0`)
    const len = this.atlas.clipLength(sheet, 'walk')
    // Heavy things read as heavy by moving at a lower frame rate, not by
    // gaining frames (§9): more pixels travelled per frame of walk cycle.
    const scale = (ENEMIES[sheet] as { animFrameScale?: number } | undefined)?.animFrameScale ?? 1
    const f = Math.floor(travelled / (PIXELS_PER_WALK_FRAME / scale)) % len
    return this.atlas.get(`${sheet}.walk.${dir}.${f}`)
  }

  /**
   * A frame of the attack clip, or undefined if this sheet has none.
   *
   * Clamped to the last frame rather than wrapped, for the same reason the
   * death clip is: the world ends the clip on a timer, and a wrap would restart
   * the lunge for whatever fraction of a frame the two disagree by.
   */
  private attackFrame(sheet: string, facing: number, elapsed: number): AtlasFrame | undefined {
    if (!this.atlas) return undefined
    const len = this.atlas.clipLengths[sheet]?.attack
    if (!len) return undefined
    const dir = this.atlas.directionFor(sheet, facing)
    const total = TUNING.combat.attackClipSeconds as number
    const f = Math.min(len - 1, Math.max(0, Math.floor((elapsed / total) * len)))
    return this.atlas.get(`${sheet}.attack.${dir}.${f}`)
  }

  /**
   * A frame of the death clip, or undefined if this sheet has none.
   *
   * `progress` is 0 at the killing blow and 1 when the slot is freed. The clip
   * is clamped rather than wrapped: the last frame holds if the timing is a
   * fraction off, where a wrap would snap the corpse back onto its feet.
   */
  private deathFrame(sheet: string, facing: number, progress: number): AtlasFrame | undefined {
    if (!this.atlas) return undefined
    const len = this.atlas.clipLengths[sheet]?.death
    if (!len) return undefined
    const dir = this.atlas.directionFor(sheet, facing)
    const f = Math.min(len - 1, Math.max(0, Math.floor(progress * len)))
    return this.atlas.get(`${sheet}.death.${dir}.${f}`)
  }

  private collectSprites(alpha: number): void {
    const w = this.world
    const cam = this.camera
    const left = cam.x - 64
    const right = cam.x + cam.viewW + 64
    const top = cam.y - 96
    const bottom = cam.y + cam.viewH + 64

    // Scenery goes through the same sorted pass as the crops, so a scarecrow
    // occludes what is behind it and not what is in front.
    for (let i = 0; i < this.scenery.length; i++) {
      const sc = this.scenery[i]
      if (sc.x < left || sc.x > right || sc.y < top || sc.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = sc.x
      it.y = sc.y
      it.frame = sc.frame
      it.colour = PALETTE.void
      it.w = 0
      it.h = 0
    }

    // Crops y-sort with everything else, so the player walks in front of and
    // behind them rather than always on top.
    for (let i = 0; i < w.props.live; i++) {
      const c = w.props.items[i]
      if (c.x < left || c.x > right || c.y < top || c.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = c.x
      it.y = c.y
      it.frame = this.propFrame(c.sprite, c.x, c.y)
      it.flash = c.flash > 0
      it.colour = '#8fbf5a'
      it.w = c.radius * 2
      it.h = c.radius * 2
      if (c.dying > 0) {
        const t = c.dying / TUNING.combat.deathSpinSeconds
        it.scaleX = t
        it.scaleY = t
        it.rotation = (1 - t) * 3
      } else if (c.working > 0) {
        // Being worked. The tools fire on their own, so without this there is
        // no signal at all that standing here is doing anything — the node just
        // silently vanishes some seconds later.
        const shake = Math.sin(this.world.elapsed * 42 + c.x) * 1.2
        it.x += shake
        it.scaleY = 1 + Math.sin(this.world.elapsed * 30 + c.y) * 0.05
      }
    }

    // Breakables draw exactly like nodes -- same struct, same y-sort, same pop
    // -- but they are a separate population and so a separate loop. Merging the
    // two loops would be the one place the two mechanics touch, and the whole
    // point of the second pool is that they never do.
    for (let i = 0; i < w.breakables.live; i++) {
      const b = w.breakables.items[i]
      if (b.x < left || b.x > right || b.y < top || b.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = b.x
      it.y = b.y
      it.frame = this.propFrame(b.sprite, b.x, b.y)
      it.flash = b.flash > 0
      it.colour = '#c9a97a'
      it.w = b.radius * 2
      it.h = b.radius * 2
      if (b.dying > 0) {
        const t = b.dying / TUNING.combat.deathSpinSeconds
        it.scaleX = t
        it.scaleY = t
        it.rotation = (1 - t) * 3
      }
    }

    for (let i = 0; i < w.enemies.live; i++) {
      const e = w.enemies.items[i]
      const x = e.px + (e.x - e.px) * alpha
      const y = e.py + (e.y - e.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue

      const it = this.push()
      if (!it) break

      const moving = e.stun <= 0 && e.dying <= 0 && (e.vx !== 0 || e.vy !== 0)
      // An attack pose outranks the walk: the wind-up is the thing the player
      // has to read, and a charging bull that keeps trotting reads as a bug.
      const frame = (e.attackT > 0 && e.dying <= 0
        ? this.attackFrame(e.sheetId, e.facing, e.attackT)
        : undefined)
        ?? this.humanoidFrame(e.sheetId, e.facing, e.travelled, moving)

      it.x = x
      it.y = y
      it.frame = frame ?? null
      it.flash = e.flash > 0
      it.colour = e.elite ? PALETTE.enemyElite : PALETTE.enemy
      it.w = e.radius * 2
      it.h = e.radius * 2
      it.outline = e.elite ? '#f0d060' : null

      // §9: bosses are existing sprites at INTEGER scale. Never 2.5 — a 32px
      // cow at 2.2 is a blurry cow, and the whole screen stops being pixel art.
      const bossDef = ENEMIES[e.typeId] as { drawScale?: number } | undefined
      const bossScale = Math.round(bossDef?.drawScale ?? 1)
      const eliteScale = (e.elite ? 1.5 : 1) * bossScale
      it.scaleX = eliteScale
      it.scaleY = eliteScale

      if (e.dying > 0) {
        /*
           A real death clip where the species has one, the spin where it does
           not.

           The spin-and-scale-to-zero was always a stand-in for art that did not
           exist (§10 step 4). The generated animals have nine death frames per
           direction now, so they play them: the clip runs ONCE, forward, over
           the enemy's own `deathSeconds` — never looping, because a corpse that
           loops back to standing is worse than no animation at all.
        */
        const total = (ENEMIES[e.typeId] as { deathSeconds?: number } | undefined)?.deathSeconds
          ?? TUNING.combat.deathSpinSeconds
        const t = e.dying / total
        const dead = this.deathFrame(e.sheetId, e.facing, 1 - t)
        if (dead) {
          it.frame = dead
        } else {
          it.scaleX = eliteScale * t
          it.scaleY = eliteScale * t
          it.rotation = (1 - t) * 6
        }
      } else if (!frame) {
        // No art for this species yet — bob and lean stand in for the animation
        // it does not have (§10 step 4).
        const bob = Math.sin(e.travelled * 0.16) * 1.5
        it.y += bob
        it.rotation = Math.cos(e.travelled * 0.16) * 0.09 * (moving ? 1 : 0)
        const squash = 1 + Math.sin(e.travelled * 0.16) * 0.06
        it.scaleY = eliteScale * squash
        it.scaleX = eliteScale * (2 - squash)
      }
    }

    for (let i = 0; i < w.projectiles.live; i++) {
      const p = w.projectiles.items[i]
      const x = p.attached ? p.x : p.px + (p.x - p.px) * alpha
      const y = p.attached ? p.y : p.py + (p.y - p.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue

      // A melee arc and an aura are volumes, not objects. Drawing them as a
      // square meant a shovel swing rendered as a ~100px white box — the
      // single loudest thing on screen, and the reason melee "worked" visibly
      // while every ranged weapon looked identical. They get a swept arc now,
      // and only the things that are really objects get a sprite.
      const isArea = p.behaviour === 'arcSwing' || p.type === 'aura'
      // A swept melee arc draws its weapon's own art, stretched to the swing.
      // Without a clip it falls back to the tinted wedge, which is a large pale
      // shape a player reasonably read as an exposed hitbox.
      const swing = isArea && p.type !== 'aura' ? this.swingFrame(p) : null
      if (isArea && !swing) {
        this.arcs.push({ x, y, radius: p.radius, angle: p.angle, aura: p.type === 'aura' })
        continue
      }

      const it = this.push()
      if (!it) break
      const frame = swing ?? this.projectileFrame(p)
      it.x = x
      it.y = y
      it.frame = frame ?? null
      it.colour = p.type === 'melee' || p.type === 'orbit' ? PALETTE.melee : PALETTE.projectile
      it.w = p.radius * 2
      it.h = p.radius * 2
      // Thrown things spin; fired things point where they are going. Either way
      // a projectile that never rotates reads as a decal sliding across grass.
      if (p.type === 'orbit') it.rotation = p.angle + w.elapsed * 6
      else if (p.behaviour === 'arcLob' || p.behaviour === 'bounceSplit') {
        it.rotation = w.elapsed * 7 + p.t1
      } else if (p.vx !== 0 || p.vy !== 0) it.rotation = Math.atan2(p.vy, p.vx)
      else it.rotation = p.angle
      if (swing) {
        // Fill the swing: the art spans the arc's diameter, so a bigger radius
        // from +range visibly means a bigger sweep.
        it.scaleX = (p.radius * 2) / Math.max(8, swing.w)
        it.scaleY = it.scaleX
      } else {
        it.scaleX = frame ? PROJECTILE_SCALE * projectileScaleFor(p.weaponId) : 1
        it.scaleY = it.scaleX
      }
    }

    this.collectWeaponRing()
    this.collectHarvestTools()

    const p = w.player
    const it = this.push()
    if (it) {
      const moving = p.vx !== 0 || p.vy !== 0
      const frame = this.humanoidFrame(p.classId, p.facing, p.travelled, moving)
      it.x = p.px + (p.x - p.px) * alpha
      it.y = p.py + (p.y - p.py) * alpha
      it.frame = frame ?? null
      it.colour = '#e8d6a8'
      it.w = p.radius * 2
      it.h = p.radius * 2 + 6
      it.outline = frame ? null : '#3a3226'
      // i-frames read as a flicker rather than a colour change, so it never
      // gets confused with the enemy hit flash.
      if (p.invuln > 0 && Math.floor(p.anim * 20) % 2 === 0) it.alpha = 0.45
    }
  }

  private sortAndDraw(ctx: CanvasRenderingContext2D): void {
    const n = this.itemCount
    if (n === 0) return
    this.bucketCounts.fill(0)

    for (let i = 0; i < n; i++) {
      let b = (this.items[i].y / BUCKET) | 0
      if (b < 0) b = 0
      else if (b >= this.bucketRows) b = this.bucketRows - 1
      this.bucketCounts[b]++
    }
    let running = 0
    for (let b = 0; b < this.bucketRows; b++) {
      this.bucketStart[b] = running
      this.bucketCursor[b] = running
      running += this.bucketCounts[b]
    }
    for (let i = 0; i < n; i++) {
      let b = (this.items[i].y / BUCKET) | 0
      if (b < 0) b = 0
      else if (b >= this.bucketRows) b = this.bucketRows - 1
      this.order[this.bucketCursor[b]++] = i
    }

    const atlasImg = this.atlas?.image
    const flashImg = this.atlas?.flash

    for (let k = 0; k < n; k++) {
      const it = this.items[this.order[k]]
      const f = it.frame
      const plain = it.rotation === 0 && it.scaleX === 1 && it.scaleY === 1 && it.alpha === 1

      if (f && atlasImg) {
        const src = it.flash && flashImg ? flashImg : atlasImg
        if (plain) {
          // The hot path: one drawImage, no state changes.
          ctx.drawImage(src, f.x, f.y, f.w, f.h, it.x + f.ox, it.y - it.liftY + f.oy, f.w, f.h)
        } else {
          ctx.save()
          ctx.translate(it.x, it.y - it.liftY)
          if (it.rotation !== 0) ctx.rotate(it.rotation)
          if (it.scaleX !== 1 || it.scaleY !== 1) ctx.scale(it.scaleX, it.scaleY)
          if (it.alpha !== 1) ctx.globalAlpha = it.alpha
          ctx.drawImage(src, f.x, f.y, f.w, f.h, f.ox, f.oy, f.w, f.h)
          ctx.restore()
        }
      } else {
        const w = it.w * it.scaleX
        const h = it.h * it.scaleY
        const dy = it.y - it.liftY
        if (it.rotation !== 0) {
          ctx.save()
          ctx.translate(it.x, dy)
          ctx.rotate(it.rotation)
          ctx.globalAlpha = it.alpha
          ctx.fillStyle = it.flash ? '#ffffff' : it.colour
          ctx.fillRect(-w / 2, -h / 2, w, h)
          ctx.restore()
        } else {
          if (it.alpha !== 1) ctx.globalAlpha = it.alpha
          ctx.fillStyle = it.flash ? '#ffffff' : it.colour
          ctx.fillRect(it.x - w / 2, dy - h / 2, w, h)
          if (it.outline) {
            ctx.strokeStyle = it.outline
            ctx.lineWidth = 1
            ctx.strokeRect(it.x - w / 2, dy - h / 2, w, h)
          }
          if (it.alpha !== 1) ctx.globalAlpha = 1
        }
      }
      this.drawCalls++
    }
  }

  /**
   * The conformed FX clips (§10 step 3).
   *
   * Frame is chosen from the effect's remaining life against the clip's packed
   * length, so retiming an effect is one number in `tuning.json` and the clip
   * still plays end to end. Effects carry a centre pivot rather than the
   * bottom-centre one every other sprite uses — an explosion is centred on a
   * point, it does not stand on the ground — and they are drawn in pool order
   * rather than y-sorted, because they are decoration layered over the field,
   * not things in it.
   */
  private drawEffects(ctx: CanvasRenderingContext2D, under: boolean): void {
    const atlas = this.atlas
    if (!atlas) return
    const w = this.world
    const cam = this.camera
    const left = cam.x - 96
    const right = cam.x + cam.viewW + 96
    const top = cam.y - 96
    const bottom = cam.y + cam.viewH + 96

    for (let i = 0; i < w.effects.live; i++) {
      const e = w.effects.items[i]
      if (e.under !== under) continue
      if (e.x < left || e.x > right || e.y < top || e.y > bottom) continue

      // An element-coloured clip falls back to its base if it was never packed
      // — `fx.arrowImpact.acid` to `fx.arrowImpact`. Without this, adding an
      // element to a clip that has no variants would silently draw nothing,
      // which is a worse bug than showing the wrong colour.
      let name = `fx.${e.clip}`
      if (!atlas.has(`${name}.0`)) {
        const dot = name.lastIndexOf('.')
        if (dot > 0) name = name.slice(0, dot)
      }
      const len = atlas.clipLength(name, 'play')
      const t = 1 - e.life / e.maxLife
      let f = (t * len) | 0
      if (f >= len) f = len - 1
      const frame = atlas.get(`${name}.${f}`)
      if (!frame) continue

      ctx.save()
      ctx.translate(e.x, e.y)
      if (e.rotation !== 0) ctx.rotate(e.rotation)
      if (e.scale !== 1) ctx.scale(e.scale, e.scale)
      ctx.drawImage(
        atlas.image,
        frame.x, frame.y, frame.w, frame.h,
        frame.ox, frame.oy, frame.w, frame.h,
      )
      ctx.restore()
      this.drawCalls++
    }
  }

  /**
   * Ground hazards.
   *
   * These were flat translucent discs in near-identical greens, which was
   * survivable while acid and gas were decoration. They damage the player now,
   * so telling "this is yours" from "this will kill you" at a glance became a
   * fairness requirement rather than a polish item.
   *
   * Three things carry that:
   *  - **Colour family.** Your slop and lure are earthy brown and gold; their
   *    acid and gas are yellow-greens brighter than any grass on the field, so
   *    they never read as terrain.
   *  - **A rim.** The disc alone has no edge, and the edge is the thing you
   *    actually need — it is where the damage starts. Harmful hazards get a
   *    brighter, thicker one.
   *  - **A pulse, on harmful hazards only.** Movement in the periphery is what
   *    catches the eye when there are two hundred enemies on screen, and it is
   *    reserved for the ones that hurt so it always means the same thing.
   *
   * Everything fades over its last half second, so a cloud thinning out is
   * distinguishable from one about to expand into you.
   */
  /**
   * Melee sweeps and aura fields.
   *
   * A swept wedge rather than a filled disc: the disc is what the sim collides
   * with, but drawing it whole reads as a wall rather than a swing, and at a
   * shovel's ~50px radius it covered everything the player needed to see.
   */
  private drawArcs(ctx: CanvasRenderingContext2D): void {
    for (const a of this.arcs) {
      ctx.save()
      ctx.translate(a.x, a.y)
      if (a.aura) {
        // Auras are a persistent field: a soft ring, no direction.
        ctx.strokeStyle = 'rgba(150, 205, 225, 0.5)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(0, 0, a.radius * 0.9, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.rotate(a.angle)
        const half = 0.85 // radians either side — a swing, not a circle
        ctx.fillStyle = 'rgba(242, 234, 210, 0.30)'
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, a.radius, -half, half)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 250, 235, 0.75)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, a.radius, -half, half)
        ctx.stroke()
      }
      ctx.restore()
      this.drawCalls++
    }
  }

  /**
   * The sprite a projectile is drawn as.
   *
   * Falls back through the weapon's own icon, so a new weapon is visibly a new
   * weapon the moment it is packed — which is the whole point. Returns
   * undefined for anything with no art, and the caller draws its square.
   */
  /**
   * The art for a swept melee arc, if its weapon declares one.
   *
   * Separate from `projectileFrame` because a swing is sized by its radius
   * rather than by a per-weapon scale — the hit area IS the picture, so the art
   * has to stretch with the stat.
   */
  private swingFrame(
    p: { weaponId: string; angle: number },
  ): AtlasFrame | undefined {
    const atlas = this.atlas
    if (!atlas) return undefined
    const clip = (WEAPONS[p.weaponId] as { swingClip?: string } | undefined)?.swingClip
    if (!clip) return undefined
    const len = atlas.clipLength(clip, 'play')
    if (len <= 0) return undefined
    // Advance through the clip over the arc's short life so the swing moves.
    const f = (((this.world.elapsed * PROJECTILE_FPS) | 0) + ((p.angle * 4) | 0)) % len
    return atlas.get(`${clip}.${f}`) ?? atlas.get(`${clip}.0`)
  }

  /**
   * A prop's frame, animated if the atlas has a loop for it.
   *
   * Props were drawn from one static key. A crop that sways, a crystal that
   * glimmers or a barrel that smokes is the difference between a field and a
   * diorama, and the frames cost a cent each -- but nothing would ever have
   * played them, because this line only ever asked for `node.oreGold` and never
   * `node.oreGold.3`.
   *
   * Static keys still work untouched: an unanimated prop has no `.0` frame, so
   * `len` is 1 and this returns exactly what it always did. Adding a loop is
   * therefore an atlas change alone, with no content edit and no code edit.
   *
   * Phase comes from world position, not from a per-prop timer. Two reasons:
   * there is no per-prop animation state to keep (props are pooled and reused),
   * and a field of forty crops all swaying on the same frame reads as a screen
   * refreshing rather than as wind. The same trick the projectile pass uses.
   */
  private propFrame(sprite: string, x: number, y: number): AtlasFrame | null {
    const atlas = this.atlas
    if (!atlas) return null
    const len = atlas.clipLength(sprite, 'play')
    if (len <= 1) return atlas.get(sprite) ?? null
    const phase = ((x * 0.7 + y * 1.3) | 0)
    const f = (((this.world.elapsed * PROP_FPS) | 0) + phase) % len
    return atlas.get(`${sprite}.${f}`) ?? atlas.get(sprite) ?? null
  }

  private projectileFrame(
    p: { weaponId: string; behaviour: string; type: string; x: number },
  ): AtlasFrame | undefined {
    const atlas = this.atlas
    if (!atlas) return undefined
    // The barn dog is a real animal, not an icon.
    if (p.behaviour === 'minionHunt') {
      return atlas.get('feralDog.idle.down.0') ?? atlas.get('feralDog.walk.down.0')
    }

    // An animated clip if the weapon declares one, otherwise its icon. The
    // icon is a decent bullet for thrown produce and a poor one for anything
    // else — a spinning hacksaw was never going to read as a projectile.
    const def = WEAPONS[p.weaponId] as { projectileClip?: string; shardClip?: string } | undefined
    // An element RECOLOURS the weapon's own round rather than replacing it.
    // Swapping the clip outright made every weapon fire an identical bullet the
    // moment you took an element, which erased exactly the weapon identity the
    // bullets exist to communicate.
    const element = this.world.player.element
    const base = p.behaviour === 'stream' && def?.shardClip && p.weaponId === 'drumGun'
      ? def.shardClip
      : def?.projectileClip
    const tinted = base && element !== 'none' ? `${base}.${element}` : undefined
    const clipName = (tinted && this.atlas?.clipLength(tinted, 'play') ? tinted : base)
    if (clipName) {
      const len = atlas.clipLength(clipName, 'play')
      if (len > 0) {
        // Phase off the projectile's own x so a volley does not flicker in
        // lockstep, without needing per-projectile animation state.
        const phase = (p.x * 0.35) | 0
        const f = (((this.world.elapsed * PROJECTILE_FPS) | 0) + phase) % len
        const frame = atlas.get(`${clipName}.${f}`)
        if (frame) return frame
      }
    }
    // `weapon.<id>` does not exist for weapons whose art is per-tier, and the
    // miss fell through to a coloured rectangle — the Scythe's orbiting blade
    // rendered as a large cream square for the whole of M5-M7. Ask for the
    // weapon's declared sprite, which is always packed.
    const def2 = WEAPONS[p.weaponId] as { sprite?: string } | undefined
    return atlas.get(`weapon.${p.weaponId}`) ?? (def2?.sprite ? atlas.get(def2.sprite) : undefined)
  }

  /**
   * The weapon ring: every weapon the player owns, spaced around them and
   * pointed at what it is shooting.
   *
   * This is the readout the game was missing. Six weapons all firing invisible
   * bullets is indistinguishable from one, and picking up a seventh weapon
   * looked like nothing had happened at all. The ring makes ownership,
   * aiming and rate of fire legible at a glance, Brotato-style.
   *
   * Angles come from the sim (`slot.ringAngle`, `slot.aimAngle`) — the renderer
   * decides nothing about targeting, it only draws the answer.
   */
  private collectWeaponRing(): void {
    const atlas = this.atlas
    if (!atlas) return
    const w = this.world
    const p = w.player
    const cfg = TUNING.fx

    for (const slot of p.weapons) {
      // Tier art: merging a weapon changes the weapon. A gun steps up its
      // category, a melee tool steps up its material. Falls back to the base
      // sprite so a weapon without a tier list still draws.
      const def = WEAPONS[slot.id] as { tierSprites?: string[]; sprite?: string } | undefined
      const tierKey = def?.tierSprites?.[Math.min(slot.tier, 4) - 1]
      const frame = (tierKey ? atlas.get(tierKey) : undefined)
        ?? (def?.sprite ? atlas.get(def.sprite) : undefined)
        ?? atlas.get(`weapon.${slot.id}`)
      if (!frame) continue
      const it = this.push()
      if (!it) return

      // A newly taken or merged weapon announces itself: it sits further out,
      // rides above the ring and pulses. Two and a half seconds is long enough
      // to find it and short enough not to become the normal look.
      const fresh = p.weaponFlash.get(slot.id) ?? 0
      const lift = fresh > 0 ? Math.sin(fresh * 12) * 3 : 0
      const push = fresh > 0 ? 10 * Math.min(1, fresh) : 0

      // Recoil kicks the weapon back along its own aim as it fires.
      const kick = slot.recoil > 0
        ? (slot.recoil / cfg.weaponRecoilSeconds) * cfg.weaponRecoilPixels
        : 0
      const r = cfg.weaponRingRadius + push
      it.x = p.x + Math.cos(slot.ringAngle) * r - Math.cos(slot.aimAngle) * kick
      // Depth: where on the ground this weapon is, so one at his front draws
      // over him and one behind his shoulder draws under him.
      it.y = p.y + Math.sin(slot.ringAngle) * r - Math.sin(slot.aimAngle) * kick
      // Picture: carried at torso height. Never folded into y — see `liftY`.
      it.liftY = 14 - lift
      it.frame = frame
      it.colour = PALETTE.melee
      it.w = 10
      it.h = 10
      // The art is drawn pointing right, so aim is the rotation directly. Left
      // of the player it would read upside down, so it flips instead.
      const facingLeft = Math.abs(slot.aimAngle) > Math.PI / 2
      it.rotation = facingLeft ? slot.aimAngle + Math.PI : slot.aimAngle
      // Normalise to a target width rather than applying one flat scale. The
      // sources are not the same size: a tool icon fills a 32px cell while a
      // gun is drawn ~20px wide to be HELD by a 32px character. One shared
      // multiplier shrank the guns twice and left them unreadable.
      const fit = Math.min(1.15, cfg.weaponRingTargetWidth / Math.max(8, frame.w))
        * (fresh > 0 ? 1.35 : 1)
      it.scaleX = fit * (facingLeft ? -1 : 1)
      it.scaleY = fit
    }
  }

  /**
   * The pickaxe and axe, carried at the player's hips.
   *
   * Kept out of the weapon ring on purpose. They are not weapons, they never
   * aim at anything, and folding them into the ring would both eat two of its
   * slots and imply they fire. Hanging them low and angled at the ground reads
   * as equipment, and it is the only place a tier upgrade is ever visible —
   * buying a Titanium Pickaxe is otherwise a number nobody sees.
   */
  private collectHarvestTools(): void {
    const atlas = this.atlas
    if (!atlas) return
    const w = this.world
    const p = w.player

    // Do the tools have something to chew on right now?
    let working = false
    for (let i = 0; i < w.props.live; i++) {
      if (w.props.items[i].working > 0) { working = true; break }
    }

    const carry: [string, number, number][] = [
      ['pickaxe', p.pickaxeTier, -1],
      ['axe', p.axeTier, 1],
    ]
    for (const [toolId, tierIndex, side] of carry) {
      const tiers = NODES.tools[toolId]?.tiers
      if (!Array.isArray(tiers) || tiers.length === 0) continue
      const tier = tiers[Math.min(tierIndex, tiers.length - 1)]
      const frame = atlas.get(`tool.${toolId}.${tier.id}`)
      if (!frame) continue
      const it = this.push()
      if (!it) return

      // A small swing while they are cutting, so the automatic tools do not
      // look idle while they work.
      const swing = working ? Math.sin(w.elapsed * 24 + side) * 0.5 : 0
      it.x = p.x + side * 15
      it.y = p.y - 4
      it.frame = frame
      it.colour = PALETTE.melee
      it.w = 8
      it.h = 8
      it.rotation = side * (0.7 + swing)
      it.scaleX = TUNING.fx.weaponRingScale * 0.85 * side
      it.scaleY = TUNING.fx.weaponRingScale * 0.85
    }
  }

  /**
   * The Duster's fire closing in from the edges.
   *
   * Drawn as four filled bands with a bright inner lip, under the hazards, so
   * the edge you must not cross is the brightest thing at the border. The band
   * itself pulses like the other harmful hazards — same visual grammar, so it
   * needs no separate explanation.
   */
  private drawArenaBurn(ctx: CanvasRenderingContext2D): void {
    const w = this.world
    const i = w.arenaBurnInset
    if (i <= 0) return
    const pulse = 0.72 + Math.sin(w.elapsed * 2.6) * 0.16

    ctx.globalAlpha = pulse
    ctx.fillStyle = 'rgba(150, 46, 28, 0.55)'
    ctx.fillRect(0, 0, w.arenaW, i)
    ctx.fillRect(0, w.arenaH - i, w.arenaW, i)
    ctx.fillRect(0, i, i, w.arenaH - i * 2)
    ctx.fillRect(w.arenaW - i, i, i, w.arenaH - i * 2)

    ctx.strokeStyle = 'rgba(255, 176, 84, 0.95)'
    ctx.lineWidth = 3
    ctx.strokeRect(i, i, w.arenaW - i * 2, w.arenaH - i * 2)
    ctx.globalAlpha = 1
    this.drawCalls++
  }

  private drawHazards(ctx: CanvasRenderingContext2D): void {
    const w = this.world
    for (let i = 0; i < w.hazards.live; i++) {
      const h = w.hazards.items[i]
      const harmful = h.kind === 'gas' || h.kind === 'acid' || h.kind === 'damage'

      const fill =
        h.kind === 'slow' ? PALETTE.hazardSlow
        : h.kind === 'lure' ? PALETTE.hazardLure
        : h.kind === 'gas' ? PALETTE.hazardGas
        : h.kind === 'damage' ? PALETTE.hazardBurn
        : PALETTE.hazardAcid
      const rim =
        h.kind === 'slow' ? PALETTE.hazardSlowRim
        : h.kind === 'lure' ? PALETTE.hazardLureRim
        : h.kind === 'gas' ? PALETTE.hazardGasRim
        : h.kind === 'damage' ? PALETTE.hazardBurnRim
        : PALETTE.hazardAcidRim

      // Fade out over the last half second rather than vanishing on a frame.
      const fade = h.life < 0.5 ? Math.max(0, h.life / 0.5) : 1
      // Harmful hazards breathe. 2.6 rad/s is quick enough to catch the eye and
      // slow enough not to strobe.
      const pulse = harmful ? 0.82 + Math.sin(w.elapsed * 2.6 + h.x * 0.05) * 0.18 : 1

      ctx.globalAlpha = fade
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2)
      ctx.fill()

      // The map's own hazards carry art, centred in the disc and drawn OVER the
      // fill but UNDER the rim. Under the rim on purpose: the rim and its pulse
      // are what say "this hurts", and a sprite allowed to cover them would
      // turn a warning into decoration. Weapon-made hazards have no sprite and
      // are untouched.
      if (h.sprite) {
        const f = this.atlas?.get(h.sprite)
        if (f) {
          ctx.drawImage(
            this.atlas!.image, f.x, f.y, f.w, f.h,
            Math.round(h.x - f.w / 2), Math.round(h.y - f.h / 2), f.w, f.h,
          )
          this.drawCalls++
        }
      }

      ctx.globalAlpha = fade * pulse
      ctx.strokeStyle = rim
      ctx.lineWidth = harmful ? 2 : 1
      ctx.beginPath()
      ctx.arc(h.x, h.y, h.radius - (harmful ? 1 : 0.5), 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
      this.drawCalls++
    }
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D): void {
    for (const t of this.world.telegraphs) {
      const half = ((t.spread / 2) * Math.PI) / 180
      ctx.fillStyle = PALETTE.telegraph
      ctx.beginPath()
      ctx.moveTo(t.x, t.y)
      ctx.arc(t.x, t.y, t.range, t.angle - half, t.angle + half)
      ctx.closePath()
      ctx.fill()
      this.drawCalls++
    }
  }

  private drawPickups(ctx: CanvasRenderingContext2D, alpha: number): void {
    const w = this.world
    const img = this.atlas?.image
    for (let i = 0; i < w.pickups.live; i++) {
      const g = w.pickups.items[i]
      const x = g.px + (g.x - g.px) * alpha
      const y = g.py + (g.y - g.py) * alpha
      const bob = g.magnetised ? 0 : Math.sin(g.bob * 4) * 1.5
      // A gear drop draws as the card it will hand over, not as a generic
      // parcel. The player is being asked whether the walk is worth it while a
      // wave is on top of them, and they cannot answer that without seeing
      // which item it is.
      const f = g.kind === 'gear' && g.itemId
        ? this.atlas?.get(itemCardSprite(g.itemId)) ?? this.atlas?.get('pickup.feed')
        : this.atlas?.get(`pickup.${g.kind}`)
      if (f && img) {
        ctx.drawImage(img, f.x, f.y, f.w, f.h, Math.round(x + f.ox), Math.round(y + f.oy + bob), f.w, f.h)
      } else {
        ctx.fillStyle = g.kind === 'xp' ? PALETTE.xp : PALETTE.feed
        const s = g.kind === 'xp' ? 5 : 7
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2 + bob), s, s)
      }
      this.drawCalls++
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    const w = this.world
    for (let i = 0; i < w.particles.live; i++) {
      const p = w.particles.items[i]
      ctx.fillStyle = '#' + p.colour.toString(16).padStart(6, '0')
      ctx.globalAlpha = Math.min(1, p.life / p.maxLife)
      ctx.fillRect(p.x, p.y, p.size, p.size)
      this.drawCalls++
    }
    ctx.globalAlpha = 1
  }

  private drawDamageNumbers(ctx: CanvasRenderingContext2D): void {
    const w = this.world
    ctx.textAlign = 'center'
    for (let i = 0; i < w.damageNumbers.live; i++) {
      const d = w.damageNumbers.items[i]
      const t = d.life / d.maxLife
      ctx.globalAlpha = Math.min(1, t * 1.6)
      ctx.font = d.crit ? 'bold 11px monospace' : '8px monospace'
      ctx.fillStyle = d.crit ? '#ffd452' : '#f4efe2'
      ctx.fillText(String(Math.round(d.value)), d.x, d.y)
      this.drawCalls++
    }
    ctx.globalAlpha = 1
  }
}
