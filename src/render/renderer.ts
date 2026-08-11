/**
 * M0-M3 renderer: coloured squares, drawn through the exact draw path the
 * atlas will use in M4 — camera transform, counting-sort y-order, one pass, no
 * per-sprite save/restore. Swapping in `drawImage` from the atlas is then a
 * change inside `drawSprite`, and nothing else moves.
 *
 * The blood decal canvas is the one piece already in its final form: landed
 * pixels stamp onto an offscreen canvas that costs nothing per frame no matter
 * how many have accumulated (§11).
 */
import type { World } from '../sim/world'
import { Camera } from './camera'
import { TUNING } from '../content'

/** Sprites are bucketed by y into 8px bands and drawn band by band — a
 *  counting sort, because Array.sort on 800 entities every frame is not free. */
const BUCKET = 8

interface DrawItem {
  x: number
  y: number
  w: number
  h: number
  colour: string
  flash: number
  scale: number
  rotation: number
  outline: string | null
}

const PALETTE = {
  ground: '#6f7d4f',
  groundAlt: '#67754a',
  fence: '#8a6a43',
  player: '#e8d6a8',
  playerHurt: '#f5f0e0',
  enemy: '#7a6a86',
  enemyElite: '#d8b23c',
  projectile: '#cfe0a0',
  melee: '#e7e2cf',
  xp: '#5fd0c6',
  feed: '#e0b040',
  hazardSlow: 'rgba(120, 96, 60, 0.55)',
  hazardLure: 'rgba(214, 176, 84, 0.35)',
  hazardGas: 'rgba(150, 190, 120, 0.30)',
  hazardAcid: 'rgba(120, 200, 100, 0.35)',
  telegraph: 'rgba(220, 90, 90, 0.28)',
  blood: '#a02c2c',
}

export class Renderer {
  readonly camera: Camera
  private ctx: CanvasRenderingContext2D
  private decals: HTMLCanvasElement
  private decalCtx: CanvasRenderingContext2D
  private terrain: HTMLCanvasElement | null = null

  /** Reused every frame; the draw list never reallocates. */
  private readonly items: DrawItem[] = []
  private itemCount = 0
  private readonly bucketCounts: Int32Array
  private readonly bucketStart: Int32Array
  private readonly order: Int32Array
  private readonly bucketCursor: Int32Array
  private readonly bucketRows: number

  drawCalls = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    this.camera = new Camera(canvas.width, canvas.height, world.arenaW, world.arenaH)

    this.decals = document.createElement('canvas')
    this.decals.width = world.arenaW
    this.decals.height = world.arenaH
    const dctx = this.decals.getContext('2d')
    if (!dctx) throw new Error('decal canvas context unavailable')
    this.decalCtx = dctx

    const cap = TUNING.pools.enemies + TUNING.pools.projectiles + 64
    for (let i = 0; i < cap; i++) {
      this.items.push({
        x: 0, y: 0, w: 0, h: 0, colour: '', flash: 0,
        scale: 1, rotation: 0, outline: null,
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
    this.camera.resize(w, h)
    // Nearest-neighbour: this is pixel art, and it will be actual pixel art in
    // M4. Setting it here means the switch changes nothing about the look.
    this.ctx.imageSmoothingEnabled = false
  }

  /**
   * Terrain bakes once into an offscreen canvas and blits as a single image
   * per frame — never per-tile draws (§13). In M4 this is where the real
   * tileset lands; the per-frame cost is identical either way.
   */
  private bakeTerrain(): void {
    const c = document.createElement('canvas')
    c.width = this.world.arenaW
    c.height = this.world.arenaH
    const g = c.getContext('2d')
    if (!g) return
    const tile = 32
    for (let y = 0; y < c.height; y += tile) {
      for (let x = 0; x < c.width; x += tile) {
        const checker = ((x / tile) + (y / tile)) % 2 === 0
        g.fillStyle = checker ? PALETTE.ground : PALETTE.groundAlt
        g.fillRect(x, y, tile, tile)
      }
    }
    g.strokeStyle = PALETTE.fence
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

    const ox = Math.round(this.camera.offsetX)
    const oy = Math.round(this.camera.offsetY)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#20242a'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.translate(-ox, -oy)

    if (this.terrain) {
      ctx.drawImage(this.terrain, 0, 0)
      this.drawCalls++
    }
    this.flushStains()
    ctx.drawImage(this.decals, 0, 0)
    this.drawCalls++

    this.drawHazards(ctx)
    this.drawTelegraphs(ctx)

    this.itemCount = 0
    this.collectSprites(alpha)
    this.sortAndDraw(ctx)

    this.drawPickups(ctx, alpha)
    this.drawParticles(ctx)
    this.drawDamageNumbers(ctx)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** Drain the sim's landed-blood list onto the permanent decal canvas. */
  private flushStains(): void {
    const s = this.world.stains
    if (s.length === 0) return
    const g = this.decalCtx
    for (let i = 0; i < s.length; i += 3) {
      const x = s[i]
      const y = s[i + 1]
      g.fillStyle = PALETTE.blood
      g.globalAlpha = 0.5
      g.fillRect(Math.round(x), Math.round(y), 2, 2)
    }
    g.globalAlpha = 1
    s.length = 0
  }

  private push(
    x: number, y: number, w: number, h: number, colour: string,
    flash = 0, scale = 1, rotation = 0, outline: string | null = null,
  ): void {
    if (this.itemCount >= this.items.length) return
    const it = this.items[this.itemCount++]
    it.x = x
    it.y = y
    it.w = w
    it.h = h
    it.colour = colour
    it.flash = flash
    it.scale = scale
    it.rotation = rotation
    it.outline = outline
  }

  private collectSprites(alpha: number): void {
    const w = this.world
    const cam = this.camera
    const left = cam.x - 64
    const right = cam.x + cam.viewW + 64
    const top = cam.y - 64
    const bottom = cam.y + cam.viewH + 64

    for (let i = 0; i < w.enemies.live; i++) {
      const e = w.enemies.items[i]
      const x = e.px + (e.x - e.px) * alpha
      const y = e.py + (e.y - e.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue

      let scale = e.elite ? 1.5 : 1
      if (e.dying > 0) {
        // Spin and scale to zero over 200ms — no death frames needed (§10).
        scale *= e.dying / TUNING.combat.deathSpinSeconds
      }
      const size = e.radius * 2
      this.push(
        x, y, size, size,
        e.elite ? PALETTE.enemyElite : PALETTE.enemy,
        e.flash > 0 ? 1 : 0,
        scale,
        e.dying > 0 ? (1 - e.dying / TUNING.combat.deathSpinSeconds) * 6 : 0,
        e.elite ? '#f0d060' : null,
      )
    }

    for (let i = 0; i < w.projectiles.live; i++) {
      const p = w.projectiles.items[i]
      const x = p.attached ? p.x : p.px + (p.x - p.px) * alpha
      const y = p.attached ? p.y : p.py + (p.y - p.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue
      const melee = p.type === 'melee' || p.type === 'orbit' || p.type === 'aura'
      const size = p.radius * 2
      this.push(x, y, size, size, melee ? PALETTE.melee : PALETTE.projectile, 0, 1, p.angle)
    }

    const p = w.player
    const pxi = p.px + (p.x - p.px) * alpha
    const pyi = p.py + (p.y - p.py) * alpha
    this.push(
      pxi, pyi, p.radius * 2, p.radius * 2 + 6,
      p.invuln > 0 ? PALETTE.playerHurt : PALETTE.player,
      0, 1, 0, '#3a3226',
    )
  }

  /** Counting sort into 8px y-bands, then draw band by band. */
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

    for (let k = 0; k < n; k++) {
      const it = this.items[this.order[k]]
      const w = it.w * it.scale
      const h = it.h * it.scale
      const x = it.x - w / 2
      const y = it.y - h / 2

      if (it.rotation !== 0) {
        ctx.save()
        ctx.translate(it.x, it.y)
        ctx.rotate(it.rotation)
        ctx.fillStyle = it.flash > 0 ? '#ffffff' : it.colour
        ctx.fillRect(-w / 2, -h / 2, w, h)
        ctx.restore()
      } else {
        ctx.fillStyle = it.flash > 0 ? '#ffffff' : it.colour
        ctx.fillRect(x, y, w, h)
        if (it.outline) {
          ctx.strokeStyle = it.outline
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, w, h)
        }
      }
      this.drawCalls++
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D): void {
    const w = this.world
    for (let i = 0; i < w.hazards.live; i++) {
      const h = w.hazards.items[i]
      ctx.fillStyle =
        h.kind === 'slow' ? PALETTE.hazardSlow
        : h.kind === 'lure' ? PALETTE.hazardLure
        : h.kind === 'gas' ? PALETTE.hazardGas
        : PALETTE.hazardAcid
      ctx.beginPath()
      ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2)
      ctx.fill()
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
    for (let i = 0; i < w.pickups.live; i++) {
      const g = w.pickups.items[i]
      const x = g.px + (g.x - g.px) * alpha
      const y = g.py + (g.y - g.py) * alpha
      const bob = g.magnetised ? 0 : Math.sin(g.bob * 4) * 1.5
      ctx.fillStyle = g.kind === 'xp' ? PALETTE.xp : PALETTE.feed
      const s = g.kind === 'xp' ? 6 : 8
      ctx.fillRect(x - s / 2, y - s / 2 + bob, s, s)
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
      ctx.font = d.crit ? 'bold 18px monospace' : '13px monospace'
      ctx.fillStyle = d.crit ? '#ffd452' : '#f4efe2'
      ctx.fillText(String(Math.round(d.value)), d.x, d.y)
      this.drawCalls++
    }
    ctx.globalAlpha = 1
  }
}
