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
import { ENEMIES, NODES, TUNING, WEAPONS, projectileScaleFor } from '../content'
import { Atlas, directionIndex, type AtlasFrame } from '../core/atlas'
import { Rng } from '../core/rng'

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

interface DrawItem {
  x: number
  y: number
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
  telegraph: 'rgba(220, 90, 90, 0.28)',
  blood: '#a02c2c',
}

export class Renderer {
  readonly camera: Camera
  /** Integer world-to-screen scale, recomputed on every resize. */
  private zoom: number
  private ctx: CanvasRenderingContext2D
  private decals: HTMLCanvasElement
  private decalCtx: CanvasRenderingContext2D
  private terrain: HTMLCanvasElement | null = null

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

    const cap = TUNING.pools.enemies + TUNING.pools.projectiles + TUNING.pools.props + 64
    for (let i = 0; i < cap; i++) {
      this.items.push({
        x: 0, y: 0, frame: null, colour: '', w: 0, h: 0, flash: false,
        scaleX: 1, scaleY: 1, rotation: 0, outline: null, alpha: 1,
      })
    }
    this.bucketRows = Math.ceil(world.arenaH / BUCKET) + 2
    this.bucketCounts = new Int32Array(this.bucketRows)
    this.bucketStart = new Int32Array(this.bucketRows + 1)
    this.bucketCursor = new Int32Array(this.bucketRows)
    this.order = new Int32Array(cap)

    this.bakeTerrain()
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
  private bakeTerrain(): void {
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

    // Fence line, drawn flat until the fence tiles are in the atlas.
    g.strokeStyle = '#6b5027'
    g.lineWidth = 6
    g.strokeRect(3, 3, c.width - 6, c.height - 6)

    this.terrain = c
  }

  draw(alpha: number, rand: () => number): void {
    const w = this.world
    const p = w.player
    const ctx = this.ctx
    this.drawCalls = 0

    const pxi = p.px + (p.x - p.px) * alpha
    const pyi = p.py + (p.y - p.py) * alpha
    this.camera.update(pxi, pyi, p.vx, p.vy, w.shake, rand)

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
    const dir = this.atlas.directions[directionIndex(facing)] ?? 'down'
    if (!moving) return this.atlas.get(`${sheet}.idle.${dir}.0`)
    const len = this.atlas.clipLength(sheet, 'walk')
    // Heavy things read as heavy by moving at a lower frame rate, not by
    // gaining frames (§9): more pixels travelled per frame of walk cycle.
    const scale = (ENEMIES[sheet] as { animFrameScale?: number } | undefined)?.animFrameScale ?? 1
    const f = Math.floor(travelled / (PIXELS_PER_WALK_FRAME / scale)) % len
    return this.atlas.get(`${sheet}.walk.${dir}.${f}`)
  }

  private collectSprites(alpha: number): void {
    const w = this.world
    const cam = this.camera
    const left = cam.x - 64
    const right = cam.x + cam.viewW + 64
    const top = cam.y - 96
    const bottom = cam.y + cam.viewH + 64

    // Crops y-sort with everything else, so the player walks in front of and
    // behind them rather than always on top.
    for (let i = 0; i < w.props.live; i++) {
      const c = w.props.items[i]
      if (c.x < left || c.x > right || c.y < top || c.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = c.x
      it.y = c.y
      it.frame = this.atlas?.get(c.sprite) ?? null
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

    for (let i = 0; i < w.enemies.live; i++) {
      const e = w.enemies.items[i]
      const x = e.px + (e.x - e.px) * alpha
      const y = e.py + (e.y - e.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue

      const it = this.push()
      if (!it) break

      const moving = e.stun <= 0 && e.dying <= 0 && (e.vx !== 0 || e.vy !== 0)
      const frame = this.humanoidFrame(e.typeId, e.facing, e.travelled, moving)

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
        // No death frames needed: spin and scale to zero over 200ms (§10).
        const t = e.dying / TUNING.combat.deathSpinSeconds
        it.scaleX = eliteScale * t
        it.scaleY = eliteScale * t
        it.rotation = (1 - t) * 6
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
          ctx.drawImage(src, f.x, f.y, f.w, f.h, it.x + f.ox, it.y + f.oy, f.w, f.h)
        } else {
          ctx.save()
          ctx.translate(it.x, it.y)
          if (it.rotation !== 0) ctx.rotate(it.rotation)
          if (it.scaleX !== 1 || it.scaleY !== 1) ctx.scale(it.scaleX, it.scaleY)
          if (it.alpha !== 1) ctx.globalAlpha = it.alpha
          ctx.drawImage(src, f.x, f.y, f.w, f.h, f.ox, f.oy, f.w, f.h)
          ctx.restore()
        }
      } else {
        const w = it.w * it.scaleX
        const h = it.h * it.scaleY
        if (it.rotation !== 0) {
          ctx.save()
          ctx.translate(it.x, it.y)
          ctx.rotate(it.rotation)
          ctx.globalAlpha = it.alpha
          ctx.fillStyle = it.flash ? '#ffffff' : it.colour
          ctx.fillRect(-w / 2, -h / 2, w, h)
          ctx.restore()
        } else {
          if (it.alpha !== 1) ctx.globalAlpha = it.alpha
          ctx.fillStyle = it.flash ? '#ffffff' : it.colour
          ctx.fillRect(it.x - w / 2, it.y - h / 2, w, h)
          if (it.outline) {
            ctx.strokeStyle = it.outline
            ctx.lineWidth = 1
            ctx.strokeRect(it.x - w / 2, it.y - h / 2, w, h)
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
      it.y = p.y + Math.sin(slot.ringAngle) * r - Math.sin(slot.aimAngle) * kick - 14 + lift
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
      const harmful = h.kind === 'gas' || h.kind === 'acid'

      const fill =
        h.kind === 'slow' ? PALETTE.hazardSlow
        : h.kind === 'lure' ? PALETTE.hazardLure
        : h.kind === 'gas' ? PALETTE.hazardGas
        : PALETTE.hazardAcid
      const rim =
        h.kind === 'slow' ? PALETTE.hazardSlowRim
        : h.kind === 'lure' ? PALETTE.hazardLureRim
        : h.kind === 'gas' ? PALETTE.hazardGasRim
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
      const f = this.atlas?.get(`pickup.${g.kind}`)
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
