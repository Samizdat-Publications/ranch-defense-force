/**
 * The field renderer, on WebGL2.
 *
 * Same job as the Canvas 2D renderer it replaces and the same order of layers:
 * ground, stains, fog, hazards, telegraphs, ground effects, then every sprite
 * y-sorted in one pass, then effects, pickups, particles, ceiling and damage
 * numbers. The difference is where it draws: into an art-resolution target
 * that the device scales to the screen (see `gl/device.ts`), through batches
 * that cost one draw call per layer rather than one per sprite.
 *
 * Frame choice (which clip, which direction, which frame) is unchanged from
 * v1 and still reads only public world state. Sim and render stay apart.
 */
import type { World } from '../sim/world'
import { Camera } from './camera'
import {
  CARRY, ENEMIES, ITEMS, NODES, TUNING, WEAPONS, assignCarrySlots, carryAimsOf, carryAngleOf,
  isHeldSlot, carryAnchorOf, carryHeightOf, carryPivotOf, carrySpriteOf, carryThrustOf,
  itemCardSprite, mapIsBlighted, projectileScaleFor, swingStyleOf, thrustPhase, type CarrySlot,
} from '../content'
import type { Atlas, AtlasFrame } from '../core/atlas'
import { GLDevice, newCompositeParams } from './gl/device'
import { dayProgress, evaluateDay, lightning, newDayState, rainAt } from './daylight'
import { bakeLayout, buildBackdrop, groundTiles, placeOf, type Layout, type PlaceConfig } from './place'
import { Target, parseColour, textureFrom } from './gl/glutil'
import { PAGE_GLYPH, PAGE_SOLID } from './gl/sprites'
import { HAZARD_KIND } from './gl/hazards'
import { FrameCache } from './frames'
import {
  bakeTerrain, buildOverhead, buildScenery, groundSetFor, type Placed,
} from './bake'

type RGBA = [number, number, number, number]

const BUCKET = 8
const PIXELS_PER_WALK_FRAME = 11
const HARVEST_TOOLS = ['pickaxe', 'axe'] as const
const PROJECTILE_SCALE = 0.55
const PROJECTILE_FPS = 15
const PROP_FPS = 8
/** How far a hit flash whitens a sprite. Full white read as a missing texture. */
const HIT_FLASH = 0.6
const INJURED_BELOW = (TUNING.combat.injuredBelowPct as number) / 100

const RENDER = (TUNING as unknown as { render?: Record<string, number> }).render ?? {}
/** Height of the world view in art pixels, whatever the window size. */
const VIEW_H = RENDER.viewHeight ?? 540
const RENDER_ANY = (TUNING as unknown as { render?: Record<string, unknown> }).render ?? {}
const PALLOR = RENDER.enemyPallor ?? 0
const EYE_DAY = RENDER.eyeGlowDay ?? 0
const XP_TINT = (RENDER_ANY.xpTint as number[] | undefined) ?? [1, 1, 1]
const STAIN_KEEP = Math.max(1, Math.round(RENDER.stainKeep ?? 3))
const STAIN_WEATHER = RENDER.stainWeather ?? 0.94

const JAB = TUNING.fx.jab as {
  tines: number; tineSpacing: number; lengthFraction: number
  lineWidth: number; colour: string; alpha: number; forwardBias: number
}
const JAB_RGB = JAB.colour.split(',').map((n) => parseFloat(n) / 255)

const DAY = (TUNING as unknown as { daylight: {
  lanternRadius: number; lanternColour: number[]; lanternIntensity: number; personalLight: number
  contactShadow: number
  fogDay: number[]; fogNight: number[]; fogScale: number; fogDrift: number
} }).daylight

const SWAY = TUNING.sway as unknown as {
  rate: number; gustRate: number; phaseScale: number; byPrefix: Record<string, number>
}
const SWAY_PREFIXES: [string, number][] = Object.entries(SWAY?.byPrefix ?? {})

const COL = {
  void: parseColour('#171a1d'),
  enemy: parseColour('#7a6a86'),
  enemyElite: parseColour('#d8b23c'),
  projectile: parseColour('#cfe0a0'),
  melee: parseColour('#f2ead2'),
  xp: parseColour('#5fd0c6'),
  feed: parseColour('#e0b040'),
  crop: parseColour('#8fbf5a'),
  breakable: parseColour('#c9a97a'),
  player: parseColour('#e8d6a8'),
  hazardSlow: parseColour('rgba(94, 74, 46, 0.55)'),
  hazardSlowRim: parseColour('rgba(140, 112, 70, 0.75)'),
  hazardLure: parseColour('rgba(214, 176, 84, 0.35)'),
  hazardLureRim: parseColour('rgba(236, 206, 128, 0.7)'),
  hazardGas: parseColour('rgba(196, 214, 108, 0.34)'),
  hazardGasRim: parseColour('rgba(226, 240, 150, 0.85)'),
  hazardAcid: parseColour('rgba(150, 226, 74, 0.40)'),
  hazardAcidRim: parseColour('rgba(198, 250, 120, 0.9)'),
  hazardBurn: parseColour('rgba(226, 122, 46, 0.34)'),
  hazardBurnRim: parseColour('rgba(255, 176, 84, 0.9)'),
  telegraph: parseColour('rgba(220, 90, 90, 0.28)'),
  blood: parseColour('#8a2626'),
  outlineEnemy: parseColour('rgba(14, 10, 8, 1)'),
  outlineMoon: parseColour('rgba(120, 138, 182, 0.75)'),
  outlineElite: parseColour('#f0d060'),
  outlineText: parseColour('#1a1410'),
  outlinePlayer: parseColour('rgba(255, 232, 168, 0.9)'),
  acid: parseColour('#5c8f2a'),
  bloodDark: parseColour('#5e1a1a'),
  crit: parseColour('#ffd452'),
  number: parseColour('#f4efe2'),
}
const NO_OUTLINE: RGBA = [0, 0, 0, 0]

interface DrawItem {
  x: number
  y: number
  /** Drawn this many pixels higher than it sorts (carried gear). */
  liftY: number
  frame: AtlasFrame | null
  colour: RGBA
  w: number
  h: number
  /** How far toward white this draw is flashed, 0..1. */
  flash: number
  scaleX: number
  scaleY: number
  rotation: number
  outline: RGBA
  alpha: number
  pivotX: number
  pivotY: number
  /** Throws a sun shadow. */
  caster: boolean
  /** Gets a soft contact shadow at its feet (actors, not buildings or fences). */
  contact: boolean
  /** Glows in the dark and feeds the bloom, 0..1. */
  emissive: number
}

/** Something drawn that the sim does not own: the title screen's cast, fireflies. */
export interface DrawExtra {
  frame: AtlasFrame | null
  x: number
  y: number
  /** For a frameless extra: a solid quad this size, in this colour. */
  w: number
  h: number
  colour: RGBA
  flipX: boolean
  alpha: number
  emissive: number
  casts: boolean
}

/** A light the sim does not own. */
export interface LightExtra {
  x: number; y: number; radius: number; r: number; g: number; b: number; intensity: number; squash: number
}

export class GLRenderer {
  readonly camera: Camera
  drawCalls = 0

  /*
     Title-screen hooks. A diorama is a world that is never stepped, dressed
     with actors, held at one time of day and shot from a camera that moves on
     its own. None of these are touched during a run.
  */
  extras: DrawExtra[] = []
  extraLights: LightExtra[] = []
  holdCamera: { x: number; y: number } | null = null
  dayOverride: number | null = null
  hidePlayer = false
  /** Pins how far the blight has come in (0..1), whatever the hour; null follows the day. */
  blightOverride: number | null = null
  /** World view height in art pixels; the diorama shoots closer than the game. */
  viewHeight = VIEW_H
  /** Added to the whole frame (lightning). */
  readonly flash: [number, number, number] = [0, 0, 0]

  private readonly dev: GLDevice
  /** String-free frame lookups; null until the atlas is here. */
  private readonly frames: FrameCache | null
  private terrainTex: WebGLTexture | null = null
  private bakedSet = ''
  private readonly day = newDayState()
  private readonly cp = newCompositeParams()
  /** Enemy outline this frame: dark by day, moonlight by night. */
  private readonly enemyOutline: RGBA = [0, 0, 0, 0]
  /** The same outline, alpha 1 + pallor: the sprite shader reads the excess as the curse. */
  private readonly cursedOutline: RGBA = [0, 0, 0, 0]
  private readonly cursedElite: RGBA = [0, 0, 0, 0]
  private readonly fogRgb = [0, 0, 0]
  private readonly decals: Target
  private scenery: Placed[] = []
  /** The map as a place: ground layout, textures and what stands outside the fence. */
  private place: PlaceConfig | null = null
  private layout: Layout | null = null
  private tiles: Float32Array | null = null
  private backdrop: Placed[] = []
  private overhead: Placed[] = []

  private readonly arcs: { x: number; y: number; radius: number; angle: number; aura: boolean }[] = []
  private readonly jabs: { x: number; y: number; radius: number; angle: number; t: number }[] = []
  private readonly carrySlots: (CarrySlot | null)[] = [null, null, null, null, null, null, null, null]

  private readonly items: DrawItem[] = []
  private itemCount = 0
  private readonly bucketCounts: Int32Array
  private readonly bucketStart: Int32Array
  private readonly bucketCursor: Int32Array
  private order: Int32Array
  private readonly bucketRows: number
  /** World y that maps to bucket 0: the top of the margin the camera can see. */
  private readonly bucketOffset: number
  private readonly digits = new Int8Array(12)
  private lastWeather = -1
  /** This frame's fireflies (x, y, strength), lit in the light pass. */
  private readonly fireflyLights = new Float32Array(36 * 3)
  private fireflyCount = 0
  /** Level-up pulse: the level last seen and the world time it went up. */
  private seenLevel = -1
  private levelUpAt = -10
  private lastDraw = 0
  /** The player's frame this draw, for the outline drawn over everything. */
  private playerFrame: AtlasFrame | null = null
  private playerX = 0
  private playerY = 0

  /** Camera origin of the frame being drawn, in world pixels (integer), and the target size. */
  private vx = 0
  private vy = 0
  private tw = 1
  private th = 1

  constructor(
    canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly atlas: Atlas | null,
  ) {
    this.dev = GLDevice.for(canvas)
    this.frames = atlas ? new FrameCache(atlas) : null
    if (atlas) this.dev.useAtlas(atlas)
    this.camera = new Camera(this.dev.viewW, this.dev.viewH, world.arenaW, world.arenaH)

    this.decals = this.dev.decals(world.arenaW, world.arenaH)

    this.buildPlace()
    const cap = TUNING.pools.enemies + TUNING.pools.projectiles + TUNING.pools.props
      + this.scenery.length + this.backdrop.length + 64
    for (let i = 0; i < cap; i++) this.items.push(this.blankItem())
    this.bucketOffset = this.place?.margin ?? 0
    this.bucketRows = Math.ceil((world.arenaH + this.bucketOffset * 2) / BUCKET) + 2
    this.bucketCounts = new Int32Array(this.bucketRows)
    this.bucketStart = new Int32Array(this.bucketRows + 1)
    this.bucketCursor = new Int32Array(this.bucketRows)
    this.order = new Int32Array(cap)

    this.bake(groundSetFor(world.map.terrain, world.spawner.wave))
    this.overhead = buildOverhead(world, atlas)
  }

  private blankItem(): DrawItem {
    return {
      x: 0, y: 0, liftY: 0, frame: null, colour: COL.void, w: 0, h: 0, flash: 0,
      scaleX: 1, scaleY: 1, rotation: 0, outline: NO_OUTLINE, alpha: 1, pivotX: 0, pivotY: 0,
      caster: false, contact: false, emissive: 0,
    }
  }

  /** Scenery, and on a map with a `place` block the ground layout and the backdrop. */
  private buildPlace(): void {
    const world = this.world
    this.place = placeOf(world)
    this.scenery = buildScenery(world, this.atlas)
    this.backdrop = []
    this.layout = null
    this.tiles = null
    this.camera.margin = 0
    const place = this.place
    if (!place) return
    this.camera.margin = place.margin
    const keep = place.interiorScenery ?? 1
    if (keep < 1) this.scenery = this.scenery.filter((_, i) => (i * 0.618034) % 1 < keep)
    this.layout = bakeLayout(world, place)
    this.dev.ground.setLayout(this.layout.data, this.layout.w, this.layout.h)
    if (this.atlas) {
      this.tiles = groundTiles(this.atlas, place)
      this.backdrop = buildBackdrop(world, this.atlas, place)
    }
  }

  private bake(groundSet: string): void {
    const dev = this.dev
    const gl = dev.gl
    this.bakedSet = groundSet
    // A place draws its ground per pixel; only the older maps bake tiles.
    if (this.place && this.tiles) return
    const ground = bakeTerrain(this.world, this.atlas, groundSet)
    this.terrainTex = textureFrom(gl, ground, gl.NEAREST, gl.CLAMP_TO_EDGE, dev.sharedTexture('terrain'))
    dev.setSharedTexture('terrain', this.terrainTex)
  }

  onMapChanged(): void {
    this.buildPlace()
    this.overhead = buildOverhead(this.world, this.atlas)
    this.bake(groundSetFor(this.world.map.terrain, this.world.spawner.wave))
  }

  resize(w: number, h: number): void {
    this.dev.resize(w, h, this.viewHeight)
    this.camera.resize(this.dev.viewW, this.dev.viewH)
  }

  draw(alpha: number, rand: () => number): void {
    const w = this.world
    const p = w.player
    const dev = this.dev
    dev.sprites.draws = 0
    dev.shapes.draws = 0

    const want = groundSetFor(w.map.terrain, w.spawner.wave)
    if (want !== this.bakedSet) this.bake(want)

    const pxi = p.px + (p.x - p.px) * alpha
    const pyi = p.py + (p.y - p.py) * alpha
    if (this.holdCamera) {
      this.camera.x = this.holdCamera.x
      this.camera.y = this.holdCamera.y
      this.camera.shakeX = 0
      this.camera.shakeY = 0
    } else {
      const now = performance.now()
      const dt = this.lastDraw ? (now - this.lastDraw) / 1000 : 1 / 60
      this.lastDraw = now
      this.camera.update(pxi, pyi, p.vx, p.vy, w.paused ? 0 : w.shake, rand, dt)
    }
    const ox = this.camera.offsetX
    const oy = this.camera.offsetY
    const fx = Math.floor(ox)
    const fy = Math.floor(oy)
    this.vx = fx - 1
    this.vy = fy - 1
    this.tw = dev.world.w
    this.th = dev.world.h

    const day = evaluateDay(this.dayOverride ?? dayProgress(w), this.day)
    const moon = COL.outlineMoon
    const dark = COL.outlineEnemy
    for (let c = 0; c < 4; c++) {
      this.enemyOutline[c] = dark[c] + (moon[c] - dark[c]) * day.night
      this.cursedOutline[c] = this.enemyOutline[c]
      this.cursedElite[c] = COL.outlineElite[c]
    }
    this.cursedOutline[3] = 1 + PALLOR
    this.cursedElite[3] = 1 + PALLOR

    this.flushStains()

    const v = COL.void
    dev.beginWorld(v[0], v[1], v[2])
    dev.bindSpriteTextures()

    // Ground layers: they take shadow, and they do not count as standing sprites.
    dev.groundBlend()
    if (this.place && this.tiles && this.layout) {
      const L = this.layout
      const blight = Math.min(1, Math.max(0, (day.t - 0.35) / 0.65))
      const turned = this.blightOverride ?? blight * blight * (3 - 2 * blight)
      dev.ground.draw(dev.atlasTexture, dev.noise, this.tiles, L.x, L.y, L.worldW, L.worldH,
        w.arenaW, w.arenaH, turned, w.elapsed,
        this.vx, this.vy, this.tw, this.th)
    } else if (this.terrainTex) {
      dev.texQuad(this.terrainTex, 0, 0, w.arenaW, w.arenaH, 0, 0, 1, 1, this.vx, this.vy, this.tw, this.th)
    }
    // The decal target was drawn with GL's y-up rows, so its v runs the other way.
    dev.texQuad(this.decals.tex, 0, 0, w.arenaW, w.arenaH, 0, 1, 1, 0, this.vx, this.vy, this.tw, this.th)
    this.drawFog(day.fog, day.night)
    dev.bindSpriteTextures()
    this.drawArenaBurn()
    this.drawHazards()
    this.drawTelegraphs()
    this.flushShapes()
    this.drawEffects(true)
    this.flushSprites()
    this.drawPlayerMark(pxi, pyi)
    this.drawLevelPulse(pxi, pyi)

    // Standing things.
    dev.spriteBlend()
    this.itemCount = 0
    this.arcs.length = 0
    this.jabs.length = 0
    this.collectSprites(alpha)
    this.drawArcs()
    this.drawJabs()
    this.flushShapes()
    this.sortAndDraw(day.shadowX, day.shadowY, day.shadowAlpha)
    this.drawDusterPlume(alpha)
    this.flushShapes()

    this.drawEffects(false)
    this.drawPickups(alpha)
    this.drawParticles()
    this.drawOverhead(pxi, pyi)
    // The player's outline, over everything: findable in any crowd.
    if (this.playerFrame) {
      this.spr(this.playerFrame, this.playerX, this.playerY, 0, 0, 0, 1, 1, -1, 0, COL.outlinePlayer)
    }
    if (!this.holdCamera) {
      this.drawRain(rainAt(day.t))
      this.drawFireflies(smoothstep(0.72, 0.8, day.t) * (1 - smoothstep(0.86, 0.9, day.t)))
    }
    this.flushSprites()
    this.drawBossMarker()
    this.flushShapes()
    this.drawDamageNumbers()
    this.flushSprites()

    dev.beginLights()
    this.collectLights(pxi, pyi, alpha)
    dev.lights.flush(this.vx, this.vy, this.tw, this.th, dev.lightOut)

    const cp = this.cp
    for (let c = 0; c < 3; c++) {
      cp.ambient[c] = day.ambient[c]
      cp.sun[c] = day.sun[c]
      cp.tint[c] = day.tint[c]
      cp.flash[c] = this.flash[c]
    }
    cp.exposure = day.exposure
    cp.saturation = day.saturation
    cp.contrast = day.contrast
    cp.vignette = day.vignette
    cp.emissiveGain = 0.35 + 0.5 * day.night
    cp.bloomGain = 0.35 + 0.3 * day.night
    cp.time = w.elapsed
    cp.originX = this.vx
    cp.originY = this.vy
    cp.clouds = 0.45 * (1 - day.night)
    // Lightning lights the whole field for a moment: you see what is out there.
    const bolt = this.holdCamera ? 0 : lightning(w.elapsed, day.t)
    if (bolt > 0) {
      cp.ambient[0] += bolt * 0.75
      cp.ambient[1] += bolt * 0.8
      cp.ambient[2] += bolt * 0.95
      cp.flash[0] += bolt * 0.05
      cp.flash[1] += bolt * 0.06
      cp.flash[2] += bolt * 0.08
    }
    const hpFrac = p.stats.maxHp > 0 ? p.hp / p.stats.maxHp : 1
    cp.hurt = Math.min(1, p.invuln * 0.9) * 0.3
      + (hpFrac < 0.3 && p.alive ? (0.3 - hpFrac) * (0.6 + 0.4 * Math.sin(w.elapsed * 5)) : 0)
    dev.present(ox - fx, oy - fy, cp)
    this.drawCalls = dev.sprites.draws + dev.shapes.draws + 4
  }

  private flushSprites(): void {
    this.dev.sprites.flush(this.vx, this.vy, this.tw, this.th)
  }

  private flushShapes(): void {
    this.dev.shapes.flush(this.vx, this.vy, this.tw, this.th)
  }

  /**
   * New blood, stamped permanently into the decal target. Each drop lands as a
   * small clump in one of two reds (or acid green), shaped by a hash of where
   * it fell, so a kill leaves a splat rather than a sprinkle of single pixels.
   */
  private flushStains(): void {
    // Weather the old stains on a slow clock, whether or not new ones landed.
    const clock = Math.floor(this.world.elapsed / 2)
    if (clock !== this.lastWeather) {
      this.lastWeather = clock
      this.dev.weatherDecals(STAIN_WEATHER)
    }
    const s = this.world.stains
    if (s.length === 0) return
    const batch = this.dev.sprites
    for (let i = 0; i < s.length; i += 3) {
      const x = Math.round(s[i])
      const y = Math.round(s[i + 1])
      const col = s[i + 2]
      const acid = ((col >> 8) & 255) > ((col >> 16) & 255)
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0
      // Most drops soak in without a mark; the ones that land make a splat
      // (a body, a longer smear, a few flecks) rather than a pixel of static.
      if (((h >> 12) % STAIN_KEEP) !== 0) continue
      const c = acid ? COL.acid : (h & 1) ? COL.blood : COL.bloodDark
      const a = 0.5 + ((h >> 3) & 3) * 0.06
      const w0 = 5 + ((h >> 5) & 3)
      const h0 = 3 + ((h >> 6) & 1)
      batch.push(x - 1, y, 0, 0, w0, h0, 0, 0, PAGE_SOLID, 0, 1, 1, c[0], c[1], c[2], a, 0, 0, 0, 0, 0, 0)
      batch.push(x, y - 1, 0, 0, w0 - 2, h0 + 2, 0, 0, PAGE_SOLID, 0, 1, 1, c[0], c[1], c[2], a, 0, 0, 0, 0, 0, 0)
      const sx = ((h >> 7) & 1) ? 1 : -1
      batch.push(x + sx * (w0 + 1), y + ((h >> 8) & 1), 0, 0, 2, 1, 0, 0, PAGE_SOLID, 0, 1, 1, c[0], c[1], c[2], a * 0.85, 0, 0, 0, 0, 0, 0)
      if ((h >> 9) & 1) batch.push(x - sx * 3, y + h0 + 1, 0, 0, 1, 1, 0, 0, PAGE_SOLID, 0, 1, 1, c[0], c[1], c[2], a * 0.8, 0, 0, 0, 0, 0, 0)
      if ((h >> 10) & 1) batch.push(x + sx * 2, y - 3, 0, 0, 1, 1, 0, 0, PAGE_SOLID, 0, 1, 1, c[0], c[1], c[2], a * 0.7, 0, 0, 0, 0, 0, 0)
    }
    s.length = 0
    this.decals.bind()
    this.dev.bindSpriteTextures()
    batch.flush(0, 0, this.decals.w, this.decals.h)
  }

  /**
   * Ground fog: the map's own plus the day's (mist at dawn, murk after dark).
   * On the ground layer, so it lies under everything that stands.
   */
  private drawFog(dayFog: number, night: number): void {
    const cfg = this.world.map.fog
    const density = Math.max(dayFog, cfg?.alpha ?? 0) * 0.6
    if (density <= 0.001) return
    const c = this.fogRgb
    for (let i = 0; i < 3; i++) c[i] = DAY.fogDay[i] + (DAY.fogNight[i] - DAY.fogDay[i]) * night
    const t = this.world.elapsed * DAY.fogDrift
    this.dev.fogQuad(this.vx, this.vy, this.tw, this.th, c[0], c[1], c[2], density, t, t * 0.35, DAY.fogScale)
  }

  /** Queue one atlas frame. `ox/oy` add to the frame's own offset. */
  private spr(
    f: AtlasFrame, x: number, y: number, ox: number, oy: number,
    rot: number, sx: number, sy: number, a: number, flash: number,
    outline: RGBA = NO_OUTLINE, r = 1, g = 1, b = 1, emissive = 0, caster = false, lift = 0,
  ): void {
    this.dev.sprites.push(
      x, y, f.ox + ox, f.oy + oy, f.w, f.h, f.x, f.y, f.page,
      rot, sx, sy, r, g, b, a, flash, emissive,
      outline[0], outline[1], outline[2], outline[3], caster ? 1 : 0, lift,
    )
  }

  private push(): DrawItem | null {
    if (this.itemCount >= this.items.length) return null
    const it = this.items[this.itemCount++]
    it.frame = null
    it.flash = 0
    it.liftY = 0
    it.scaleX = 1
    it.scaleY = 1
    it.rotation = 0
    it.outline = NO_OUTLINE
    it.alpha = 1
    it.pivotX = 0
    it.pivotY = 0
    it.w = 0
    it.h = 0
    it.caster = false
    it.contact = false
    it.emissive = 0
    return it
  }

  // ---------------------------------------------------------------- frames

  private humanoidFrame(sheet: string, facing: number, travelled: number, moving: boolean): AtlasFrame | undefined {
    const fc = this.frames
    if (!fc) return undefined
    if (!moving) return fc.frame(sheet, 'idle', facing, 0)
    const len = fc.clip(sheet, 'walk').len
    if (len === 0) return fc.frame(sheet, 'idle', facing, 0)
    const scale = (ENEMIES[sheet] as { animFrameScale?: number } | undefined)?.animFrameScale ?? 1
    return fc.frame(sheet, 'walk', facing, Math.floor(travelled / (PIXELS_PER_WALK_FRAME / scale)) % len)
  }

  private hitFrame(sheet: string, facing: number, remaining: number): AtlasFrame | undefined {
    const fc = this.frames
    const len = fc ? fc.clip(sheet, 'hit').len : 0
    if (!fc || !len) return undefined
    const total = TUNING.combat.hitClipSeconds as number
    const t = Math.min(1, Math.max(0, 1 - remaining / total))
    return fc.frame(sheet, 'hit', facing, Math.floor(t * len))
  }

  private hurtWalkFrame(sheet: string, facing: number, travelled: number): AtlasFrame | undefined {
    const fc = this.frames
    const len = fc ? fc.clip(sheet, 'walkHurt').len : 0
    if (!fc || !len) return undefined
    return fc.frame(sheet, 'walkHurt', facing, Math.floor(travelled / PIXELS_PER_WALK_FRAME) % len)
  }

  private attackFrame(sheet: string, facing: number, elapsed: number): AtlasFrame | undefined {
    const fc = this.frames
    const len = fc ? fc.clip(sheet, 'attack').len : 0
    if (!fc || !len) return undefined
    const total = TUNING.combat.attackClipSeconds as number
    return fc.frame(sheet, 'attack', facing, Math.floor((elapsed / total) * len))
  }

  private deathFrame(sheet: string, facing: number, progress: number): AtlasFrame | undefined {
    const fc = this.frames
    const len = fc ? fc.clip(sheet, 'death').len : 0
    if (!fc || !len) return undefined
    return fc.frame(sheet, 'death', facing, Math.floor(progress * len))
  }

  private swayOf(sprite: string, x: number, y: number): number {
    if (SWAY_PREFIXES.length === 0) return 0
    let amp = 0
    for (let i = 0; i < SWAY_PREFIXES.length; i++) {
      if (sprite.startsWith(SWAY_PREFIXES[i][0])) { amp = SWAY_PREFIXES[i][1]; break }
    }
    if (amp === 0) return 0
    const t = this.world.elapsed
    const phase = (x + y) * SWAY.phaseScale
    const gust = 0.65 + 0.35 * Math.sin(t * SWAY.gustRate + phase * 0.3)
    return Math.sin(t * SWAY.rate + phase) * amp * gust
  }

  private propFrame(sprite: string, x: number, y: number): AtlasFrame | null {
    const fc = this.frames
    if (!fc) return null
    const strip = fc.strip(sprite)
    if (strip.length <= 1) return fc.single(sprite) ?? strip[0] ?? null
    const phase = ((x * 0.7 + y * 1.3) | 0)
    const f = (((this.world.elapsed * PROP_FPS) | 0) + phase) % strip.length
    return strip[f] ?? fc.single(sprite)
  }

  private swingFrame(p: { weaponId: string; angle: number }): AtlasFrame | undefined {
    const fc = this.frames
    if (!fc) return undefined
    const clip = (WEAPONS[p.weaponId] as { swingClip?: string } | undefined)?.swingClip
    if (!clip) return undefined
    const strip = fc.strip(clip)
    if (strip.length === 0) return undefined
    const f = (((this.world.elapsed * PROJECTILE_FPS) | 0) + ((p.angle * 4) | 0)) % strip.length
    return strip[f] ?? strip[0]
  }

  private projectileFrame(p: { weaponId: string; behaviour: string; type: string; x: number }): AtlasFrame | undefined {
    const atlas = this.atlas
    if (!atlas) return undefined
    if (p.behaviour === 'minionHunt') {
      const minion = (ITEMS[p.weaponId] as { minionSprite?: string } | undefined)?.minionSprite
      if (minion) {
        const f = atlas.get(minion)
        if (f) return f
      }
      return atlas.get('feralDog.idle.down.0') ?? atlas.get('feralDog.walk.down.0')
    }
    if (p.type === 'placeable') {
      const sprite = (ITEMS[p.weaponId] as { cardSprite?: string } | undefined)?.cardSprite
      const f = sprite ? atlas.get(sprite) : undefined
      if (f) return f
    }
    const def = WEAPONS[p.weaponId] as { projectileClip?: string; shardClip?: string; sprite?: string } | undefined
    const element = this.world.player.element
    const base = p.behaviour === 'stream' && def?.shardClip && p.weaponId === 'drumGun'
      ? def.shardClip
      : def?.projectileClip
    const fc = this.frames
    if (base && fc) {
      const strip = fc.tinted.get(base, element)
      if (strip.length > 0) {
        const phase = (p.x * 0.35) | 0
        const f = (((this.world.elapsed * PROJECTILE_FPS) | 0) + phase) % strip.length
        const frame = strip[f]
        if (frame) return frame
      }
    }
    return (fc?.single(fc.named.get('weapon', p.weaponId)) ?? undefined)
      ?? (def?.sprite ? atlas.get(def.sprite) : undefined)
  }

  // ---------------------------------------------------------------- collection

  private collectSprites(alpha: number): void {
    const w = this.world
    const cam = this.camera
    const left = cam.x - 64
    const right = cam.x + cam.viewW + 64
    const top = cam.y - 96
    const bottom = cam.y + cam.viewH + 64

    if (w.exit) {
      const e = w.exit
      const f = this.atlas?.get(e.frame)
      const it = f ? this.push() : null
      if (it && f) {
        it.x = e.x
        it.y = e.y
        it.frame = f
      }
    }

    for (let i = 0; i < this.backdrop.length; i++) {
      const sc = this.backdrop[i]
      const f = sc.frame
      if (sc.x + f.ox + f.w < left || sc.x + f.ox > right || sc.y < top || sc.y + f.oy > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = sc.x
      it.y = sc.y
      it.frame = f
      it.caster = true
    }

    for (let i = 0; i < this.scenery.length; i++) {
      const sc = this.scenery[i]
      if (sc.x < left || sc.x > right || sc.y < top || sc.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = sc.x
      it.y = sc.y
      it.frame = sc.frame
      it.caster = true
    }

    const blighted = mapIsBlighted(w.map.terrain, w.spawner.wave)
    for (let i = 0; i < w.props.live; i++) {
      const c = w.props.items[i]
      if (c.x < left || c.x > right || c.y < top || c.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = c.x
      it.y = c.y
      it.frame = this.propFrame(blighted && this.frames && c.sprite.startsWith('crop.') ? this.frames.blighted(c.sprite) : c.sprite, c.x, c.y)
      it.flash = c.flash > 0 ? HIT_FLASH : 0
      it.colour = COL.crop
      it.caster = true
      it.contact = true
      it.w = c.radius * 2
      it.h = c.radius * 2
      if (c.dying > 0) {
        const t = c.dying / TUNING.combat.deathSpinSeconds
        it.scaleX = t
        it.scaleY = t
        it.rotation = (1 - t) * 3
      } else if (c.working > 0) {
        it.x += Math.sin(w.elapsed * 42 + c.x) * 1.2
        it.scaleY = 1 + Math.sin(w.elapsed * 30 + c.y) * 0.05
      } else {
        it.rotation = this.swayOf(c.sprite, c.x, c.y)
      }
    }

    for (let i = 0; i < w.breakables.live; i++) {
      const b = w.breakables.items[i]
      if (b.x < left || b.x > right || b.y < top || b.y > bottom) continue
      const it = this.push()
      if (!it) break
      it.x = b.x
      it.y = b.y
      it.frame = this.propFrame(b.sprite, b.x, b.y)
      it.flash = b.flash > 0 ? HIT_FLASH : 0
      it.colour = COL.breakable
      it.caster = true
      it.contact = true
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
      const hurt = e.maxHp > 0 && e.hp / e.maxHp < INJURED_BELOW
      const frame = (e.dying <= 0 && e.hitT > 0 ? this.hitFrame(e.sheetId, e.facing, e.hitT) : undefined)
        ?? (e.attackT > 0 && e.dying <= 0 ? this.attackFrame(e.sheetId, e.facing, e.attackT) : undefined)
        ?? (moving && hurt ? this.hurtWalkFrame(e.sheetId, e.facing, e.travelled) : undefined)
        ?? this.humanoidFrame(e.sheetId, e.facing, e.travelled, moving)

      it.x = x
      it.y = y
      it.frame = frame ?? null
      it.flash = e.flash > 0 ? HIT_FLASH : 0
      it.colour = e.elite ? COL.enemyElite : COL.enemy
      it.w = e.radius * 2
      it.h = e.radius * 2
      const bossDef = ENEMIES[e.typeId] as { drawScale?: number; deathSeconds?: number; boss?: boolean } | undefined
      // The cast is cursed; a boss is a thing in its own right and keeps its colours.
      it.outline = bossDef?.boss ? this.enemyOutline : e.elite ? this.cursedElite : this.cursedOutline
      it.caster = true
      it.contact = true
      it.emissive = -Math.max(EYE_DAY, this.day.night)

      const bossScale = Math.round(bossDef?.drawScale ?? 1)
      if (bossScale > 1 || e.typeId === 'duster') it.flash *= 0.4
      const scale = (e.elite ? 1.5 : 1) * bossScale
      it.scaleX = scale
      it.scaleY = scale

      if (e.dying > 0) {
        const total = bossDef?.deathSeconds ?? TUNING.combat.deathSpinSeconds
        const t = e.dying / total
        const dead = this.deathFrame(e.sheetId, e.facing, 1 - t)
        it.outline = NO_OUTLINE
        if (dead) {
          it.frame = dead
        } else {
          it.scaleX = scale * t
          it.scaleY = scale * t
          it.rotation = (1 - t) * 6
        }
      } else if (!frame) {
        const bob = Math.sin(e.travelled * 0.16) * 1.5
        it.y += bob
        it.rotation = Math.cos(e.travelled * 0.16) * 0.09 * (moving ? 1 : 0)
        const squash = 1 + Math.sin(e.travelled * 0.16) * 0.06
        it.scaleY = scale * squash
        it.scaleX = scale * (2 - squash)
      }
    }

    for (let i = 0; i < w.projectiles.live; i++) {
      const p = w.projectiles.items[i]
      const x = p.attached ? p.x : p.px + (p.x - p.px) * alpha
      const y = p.attached ? p.y : p.py + (p.y - p.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue

      const isArea = p.behaviour === 'arcSwing' || p.type === 'aura'
      if (isArea && p.type !== 'aura' && swingStyleOf(p.weaponId) === 'thrust') {
        this.jabs.push({ x, y, radius: p.radius, angle: p.angle, t: thrustPhase(p.hitStamp, w.tick) })
        continue
      }
      const swing = isArea && p.type !== 'aura' ? this.swingFrame(p) : undefined
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
      it.colour = p.type === 'melee' || p.type === 'orbit' ? COL.melee : COL.projectile
      it.emissive = p.type === 'melee' || p.type === 'orbit' || p.behaviour === 'minionHunt' || p.type === 'placeable' ? 0 : 0.6
      it.caster = p.behaviour === 'minionHunt' || p.type === 'placeable'
      it.w = p.radius * 2
      it.h = p.radius * 2
      if (p.type === 'orbit') it.rotation = p.angle + w.elapsed * 6
      else if (p.behaviour === 'arcLob' || p.behaviour === 'bounceSplit') it.rotation = w.elapsed * 7 + p.t1
      else if (p.vx !== 0 || p.vy !== 0) it.rotation = Math.atan2(p.vy, p.vx)
      else it.rotation = p.angle
      if (swing) {
        it.scaleX = (p.radius * 2) / Math.max(8, swing.w)
        it.scaleY = it.scaleX
      } else {
        it.scaleX = frame ? PROJECTILE_SCALE * projectileScaleFor(p.weaponId) : 1
        it.scaleY = it.scaleX
      }
    }

    for (let i = 0; i < this.extras.length; i++) {
      const e = this.extras[i]
      const it = this.push()
      if (!it) break
      it.x = e.x
      it.y = e.y
      it.frame = e.frame
      it.w = e.w
      it.h = e.h
      it.colour = e.colour
      it.scaleX = e.flipX ? -1 : 1
      it.alpha = e.alpha
      it.emissive = e.emissive
      it.caster = e.casts
      it.contact = e.casts
    }

    this.playerFrame = null
    if (this.hidePlayer) return
    assignCarrySlots(w.player.weapons, this.carrySlots, w.player.classId)
    this.collectCarried(true)
    this.collectHarvestTools(true)

    const p = w.player
    const it = this.push()
    if (it) {
      const moving = p.vx !== 0 || p.vy !== 0
      const frame = this.humanoidFrame(p.classId, p.facing, p.travelled, moving)
      it.x = p.px + (p.x - p.px) * alpha
      it.y = p.py + (p.y - p.py) * alpha
      it.frame = frame ?? null
      this.playerFrame = p.alive ? frame ?? null : null
      this.playerX = it.x
      this.playerY = it.y
      it.colour = COL.player
      it.caster = true
      it.contact = true
      it.w = p.radius * 2
      it.h = p.radius * 2 + 6
      if (p.invuln > 0 && Math.floor(p.anim * 20) % 2 === 0) it.alpha = 0.45
    }

    this.collectCarried(false)
    this.collectHarvestTools(false)
  }

  private collectCarried(behind: boolean): void {
    const atlas = this.atlas
    if (!atlas) return
    const w = this.world
    const p = w.player
    const cfg = TUNING.fx
    const dir = atlas.directionFor(p.classId, p.facing)
    const bootY = CARRY.bootOffsetY

    for (let i = 0; i < p.weapons.length; i++) {
      const slot = p.weapons[i]
      const anchorSlot = this.carrySlots[i]
      if (!anchorSlot) continue
      const a = carryAnchorOf(anchorSlot, dir, p.classId)
      if (!a || a.behind !== behind) continue
      const carryKey = carrySpriteOf(slot.id)
      const def = WEAPONS[slot.id] as { tierSprites?: string[]; sprite?: string } | undefined
      const tierKey = def?.tierSprites?.[Math.min(slot.tier, 4) - 1]
      const frame = (carryKey ? atlas.get(carryKey) : undefined)
        ?? (tierKey ? atlas.get(tierKey) : undefined)
        ?? (this.frames?.weaponTier.get(slot.id, Math.min(slot.tier, 4)) ?? undefined)
        ?? (def?.sprite ? atlas.get(def.sprite) : undefined)
        ?? (this.frames?.single(this.frames.named.get('weapon', slot.id)) ?? undefined)
      if (!frame) continue
      const it = this.push()
      if (!it) return

      const fresh = p.weaponFlash.get(slot.id) ?? 0
      const lift = fresh > 0 ? Math.sin(fresh * 12) * CARRY.freshLiftPixels : 0
      const held = isHeldSlot(anchorSlot)
      const kick = held && slot.recoil > 0 ? (slot.recoil / cfg.weaponRecoilSeconds) * cfg.weaponRecoilPixels : 0
      const lunge = held ? carryThrustOf(slot.id) * thrustPhase(slot.firedAt, w.tick) : 0
      const along = lunge - kick

      it.x = p.x + a.dx + Math.cos(slot.aimAngle) * along
      it.y = p.y
      it.liftY = -(bootY + a.dy) + lift - Math.sin(slot.aimAngle) * along
      it.frame = frame
      it.colour = COL.melee
      it.caster = true
      it.w = 10
      it.h = 10
      it.pivotX = -(frame.ox + frame.w * carryPivotOf(slot.id))
      it.pivotY = -(frame.oy + frame.h / 2)
      const aims = held && carryAimsOf(slot.id)
      const facingLeft = aims ? Math.abs(slot.aimAngle) > Math.PI / 2 : a.flip
      it.rotation = aims
        ? (facingLeft ? slot.aimAngle + Math.PI : slot.aimAngle)
        : (a.angle + carryAngleOf(slot.id)) * (a.flip ? -1 : 1)
      const fit = Math.min(1, carryHeightOf(slot.id) / Math.max(1, Math.max(frame.w, frame.h)))
        * (fresh > 0 ? CARRY.freshScale : 1)
      it.scaleX = fit * (facingLeft ? -1 : 1)
      it.scaleY = fit
    }
  }

  private collectHarvestTools(behind: boolean): void {
    const atlas = this.atlas
    if (!atlas) return
    const w = this.world
    const p = w.player
    const dir = atlas.directionFor(p.classId, p.facing)
    const bootY = CARRY.bootOffsetY
    let working = false
    for (let i = 0; i < w.props.live; i++) {
      if (w.props.items[i].working > 0) { working = true; break }
    }
    for (let k = 0; k < HARVEST_TOOLS.length; k++) {
      const toolId = HARVEST_TOOLS[k]
      const a = carryAnchorOf(k === 0 ? 'beltR' : 'beltL', dir, p.classId)
      if (!a || a.behind !== behind) continue
      const tiers = NODES.tools[toolId]?.tiers
      if (!Array.isArray(tiers) || tiers.length === 0) continue
      const tier = tiers[Math.min(k === 0 ? p.pickaxeTier : p.axeTier, tiers.length - 1)]
      const frame = this.frames?.tool.get(toolId, tier.id)
      if (!frame) continue
      const it = this.push()
      if (!it) return
      const swing = working ? Math.sin(w.elapsed * 24 + k) * 0.5 : 0
      it.x = p.x + a.dx
      it.y = p.y
      it.liftY = -(bootY + a.dy)
      it.frame = frame
      it.colour = COL.melee
      it.caster = true
      it.w = 8
      it.h = 8
      it.rotation = a.angle + (a.flip ? -swing : swing)
      it.pivotX = -(frame.ox + frame.w / 2)
      it.pivotY = -(frame.oy + frame.h / 2)
      it.scaleX = TUNING.fx.harvestToolScale * (a.flip ? -1 : 1)
      it.scaleY = TUNING.fx.harvestToolScale
    }
  }

  // ---------------------------------------------------------------- passes

  /**
   * Counting sort into 8 px y-bands, then the lot uploaded once and drawn
   * twice: as sun shadows into the shadow mask, then in colour.
   */
  private sortAndDraw(sunX: number, sunY: number, shadowAlpha: number): void {
    const n = this.itemCount
    if (n === 0) return
    if (this.order.length < n) this.order = new Int32Array(n * 2)
    this.bucketCounts.fill(0)
    const rows = this.bucketRows
    const off = this.bucketOffset
    for (let i = 0; i < n; i++) {
      let b = ((this.items[i].y + off) / BUCKET) | 0
      if (b < 0) b = 0
      else if (b >= rows) b = rows - 1
      this.bucketCounts[b]++
    }
    let running = 0
    for (let b = 0; b < rows; b++) {
      this.bucketStart[b] = running
      this.bucketCursor[b] = running
      running += this.bucketCounts[b]
    }
    for (let i = 0; i < n; i++) {
      let b = ((this.items[i].y + off) / BUCKET) | 0
      if (b < 0) b = 0
      else if (b >= rows) b = rows - 1
      this.order[this.bucketCursor[b]++] = i
    }

    const batch = this.dev.sprites
    for (let k = 0; k < n; k++) {
      const it = this.items[this.order[k]]
      const f = it.frame
      const y = it.y - it.liftY
      if (f) {
        this.spr(f, it.x, y, it.pivotX, it.pivotY, it.rotation, it.scaleX, it.scaleY, it.alpha, it.flash,
          it.outline, 1, 1, 1, it.emissive, it.caster, it.liftY)
      } else {
        const c = it.colour
        const fl = it.flash
        batch.push(it.x, y, -it.w / 2, -it.h / 2, it.w, it.h, 0, 0, PAGE_SOLID,
          it.rotation, it.scaleX, it.scaleY, c[0], c[1], c[2], it.alpha * c[3], fl, 0,
          it.outline[0], it.outline[1], it.outline[2], it.outline[3], it.caster ? 1 : 0, it.liftY)
      }
    }
    const dev = this.dev
    batch.upload()
    dev.beginShadows()
    if (shadowAlpha > 0.01) batch.drawUploaded(this.vx, this.vy, this.tw, this.th, 1, sunX, sunY, shadowAlpha)
    // Contact shadows: a soft pool under everything that stands, whatever
    // the sun is doing, so nothing floats. The green channel of the mask.
    const shapes = dev.shapes
    const cs = DAY.contactShadow
    for (let k = 0; k < n; k++) {
      const it = this.items[k]
      if (!it.contact) continue
      const fw = it.frame ? it.frame.w * Math.abs(it.scaleX) : it.w
      const rx = Math.max(5, Math.min(40, fw * 0.36))
      shapes.wedge(it.x, it.y - 1, rx, rx * 0.38, 0, Math.PI * 2, 0, 1, 0, cs * it.alpha)
    }
    this.flushShapes()
    dev.endShadows()
    dev.world.bind()
    batch.drawUploaded(this.vx, this.vy, this.tw, this.th, 0)
    batch.count = 0
  }

  /**
   * Every light this frame: the lantern (which matters more as the day goes),
   * muzzle flashes, rounds in flight, fires and blasts, harmful ground, gems,
   * and the Duster's lamps. Brighter at night, faint by day, never zero, so a
   * shot still reads as a hot thing in daylight.
   */
  private collectLights(px: number, py: number, alpha: number): void {
    const w = this.world
    const day = this.day
    const L = this.dev.lights
    const night = day.night
    const t = w.elapsed
    const p = w.player
    const cam = this.camera
    const left = cam.x - 80
    const right = cam.x + cam.viewW + 80
    const top = cam.y - 80
    const bottom = cam.y + cam.viewH + 80
    const lc = DAY.lanternColour

    for (let i = 0; i < this.fireflyCount; i++) {
      const k = this.fireflyLights[i * 3 + 2]
      if (k > 0.05) L.point(this.fireflyLights[i * 3], this.fireflyLights[i * 3 + 1], 14, 0.8, 1, 0.4, 0.4 * k, 0.9)
    }
    this.fireflyCount = 0

    for (let i = 0; i < this.extraLights.length; i++) {
      const e = this.extraLights[i]
      L.point(e.x, e.y, e.radius, e.r, e.g, e.b, e.intensity, e.squash)
    }

    const pulseAge = w.elapsed - this.levelUpAt
    if (pulseAge >= 0 && pulseAge < 0.7) {
      L.point(px, py - 12, 120, 1, 0.8, 0.35, 1.4 * (1 - pulseAge / 0.7), 0.7)
    }

    if (p.alive && !this.hidePlayer) {
      const flicker = 1 + 0.035 * Math.sin(t * 13.1) + 0.025 * Math.sin(t * 7.3 + 1.7)
      const li = DAY.lanternIntensity * day.lantern * flicker
      L.point(px, py - 18, DAY.lanternRadius * (0.75 + 0.25 * day.lantern), lc[0], lc[1], lc[2], li, 0.78)
      L.point(px, py - 20, 56, lc[0], lc[1], lc[2], DAY.personalLight * (0.3 + 0.7 * night), 0.9)
      for (let i = 0; i < p.weapons.length; i++) {
        const slot = p.weapons[i]
        const age = w.tick - slot.firedAt
        if (age < 0 || age > 4) continue
        const k = 1 - age / 5
        L.point(px + Math.cos(slot.aimAngle) * 16, py - 24 + Math.sin(slot.aimAngle) * 10, 64,
          1, 0.82, 0.5, (0.25 + 0.9 * night) * k, 0.85)
      }
    }

    const shot = 0.1 + 0.5 * night
    let budget = 360
    for (let i = 0; i < w.projectiles.live && budget > 0; i++) {
      const q = w.projectiles.items[i]
      if (q.type === 'melee' || q.type === 'orbit' || q.type === 'aura' || q.type === 'placeable') continue
      if (q.behaviour === 'arcSwing' || q.behaviour === 'minionHunt') continue
      const x = q.px + (q.x - q.px) * alpha
      const y = q.py + (q.y - q.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue
      const el = w.player.element
      if (el === 'fire') L.point(x, y, 30, 1, 0.5, 0.18, shot * 1.2)
      else if (el === 'ice') L.point(x, y, 30, 0.5, 0.78, 1, shot * 1.2)
      else if (el === 'acid') L.point(x, y, 30, 0.55, 1, 0.3, shot * 1.2)
      else if (el === 'shock') L.point(x, y, 30, 0.62, 0.7, 1, shot * 1.3)
      else L.point(x, y, 24, 1, 0.84, 0.56, shot)
      budget--
    }

    for (let i = 0; i < w.effects.live; i++) {
      const e = w.effects.items[i]
      if (e.under) continue
      if (e.x < left || e.x > right || e.y < top || e.y > bottom) continue
      const k = Math.max(0, e.life / e.maxLife)
      L.point(e.x, e.y, 44 * Math.max(0.6, e.scale), 1, 0.62, 0.32, (0.2 + 0.7 * night) * k)
    }

    for (let i = 0; i < w.hazards.live; i++) {
      const h = w.hazards.items[i]
      if (h.x < left - h.radius || h.x > right + h.radius || h.y < top - h.radius || h.y > bottom + h.radius) continue
      const fade = h.life < 0.5 ? Math.max(0, h.life / 0.5) : 1
      if (h.kind === 'damage') {
        const fl = 0.85 + 0.15 * Math.sin(t * 17 + h.x)
        L.point(h.x, h.y, h.radius * 1.6, 1, 0.52, 0.2, (0.25 + 0.7 * night) * fl * fade)
      } else if (h.kind === 'gas') {
        L.point(h.x, h.y, h.radius * 1.2, 0.72, 0.92, 0.3, (0.03 + 0.14 * night) * fade)
      } else if (h.kind === 'acid') {
        L.point(h.x, h.y, h.radius * 1.3, 0.5, 1, 0.3, (0.05 + 0.3 * night) * fade)
      }
    }

    const gem = 0.02 + 0.1 * night
    for (let i = 0; i < w.pickups.live; i++) {
      const g = w.pickups.items[i]
      if (g.kind !== 'xp') continue
      const x = g.px + (g.x - g.px) * alpha
      const y = g.py + (g.y - g.py) * alpha
      if (x < left || x > right || y < top || y > bottom) continue
      L.point(x, y, 14, 0.4, 0.9, 1, gem)
    }

    for (let i = 0; i < w.enemies.live; i++) {
      const e = w.enemies.items[i]
      if (e.typeId !== 'duster' || e.dying > 0) continue
      const x = e.px + (e.x - e.px) * alpha
      const y = e.py + (e.y - e.py) * alpha
      const dx = Math.cos(e.facing)
      const dy = Math.sin(e.facing)
      L.cone(x + dx * 60, y - 20 + dy * 30, 170, 1, 0.82, 0.55, 0.08 + 0.32 * night, dx, dy, 0.88, 0.8, 1)
      L.point(x, y - 30, 90, 1, 0.6, 0.3, 0.2 + 0.4 * night)
    }
  }

  /**
   * The Duster trails its spray: a drift of sour yellow-green puffs off the
   * boom behind it, so the thing reads as a crop-dusting rig and not the farm's
   * tractor, and you can see which way it is heading from its wake. Pure
   * function of the boss's position, heading and the sim clock.
   */
  private drawDusterPlume(alpha: number): void {
    const w = this.world
    const S = this.dev.shapes
    for (let i = 0; i < w.enemies.live; i++) {
      const e = w.enemies.items[i]
      if (e.typeId !== 'duster' || e.dying > 0) continue
      const x = e.px + (e.x - e.px) * alpha
      const y = e.py + (e.y - e.py) * alpha
      const bx = -Math.cos(e.facing)
      const by = -Math.sin(e.facing)
      const t = w.elapsed
      const drift = (t * 26) % 18
      for (let k = 0; k < 9; k++) {
        const d = 58 + k * 18 + drift
        const side = Math.sin(k * 1.9 + t * 1.3) * (4 + k * 2.4)
        const px = x + bx * d - by * side
        const py = y - 18 + by * d * 0.7 + bx * side - k * 2
        const fade = 1 - (k + drift / 18) / 9
        S.disc(Math.round(px), Math.round(py), 7 + k * 2.4, 0.64, 0.66, 0.32, 0.2 * fade)
        S.disc(Math.round(px + 2), Math.round(py - 2), 4 + k * 1.6, 0.8, 0.82, 0.46, 0.12 * fade)
      }
    }
  }

  private drawEffects(under: boolean): void {
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
      const strip = this.frames?.fx(e.clip)
      if (!strip || strip.length === 0) continue
      const len = strip.length
      const t = 1 - e.life / e.maxLife
      let fi = (t * len) | 0
      if (fi >= len) fi = len - 1
      const frame = strip[fi]
      if (!frame) continue
      // Never a fractional upscale: 1.2x doubles every fifth pixel and the
      // effect reads at another pixel density from everything around it.
      const s = e.scale >= 1.75 ? 2 : Math.min(1, e.scale)
      this.spr(frame, e.x, e.y, 0, 0, e.rotation, s, s, 1, 0)
    }
  }

  private drawArenaBurn(): void {
    const w = this.world
    const i = w.arenaBurnInset
    if (i <= 0) return
    const s = this.dev.shapes
    const pulse = 0.72 + Math.sin(w.elapsed * 2.6) * 0.16
    const a = 0.55 * pulse
    s.rect(0, 0, w.arenaW, i, 150 / 255, 46 / 255, 28 / 255, a)
    s.rect(0, w.arenaH - i, w.arenaW, i, 150 / 255, 46 / 255, 28 / 255, a)
    s.rect(0, i, i, w.arenaH - i * 2, 150 / 255, 46 / 255, 28 / 255, a)
    s.rect(w.arenaW - i, i, i, w.arenaH - i * 2, 150 / 255, 46 / 255, 28 / 255, a)
    const la = 0.95 * pulse
    s.rect(i, i - 1, w.arenaW - i * 2, 3, 1, 176 / 255, 84 / 255, la)
    s.rect(i, w.arenaH - i - 2, w.arenaW - i * 2, 3, 1, 176 / 255, 84 / 255, la)
    s.rect(i - 1, i, 3, w.arenaH - i * 2, 1, 176 / 255, 84 / 255, la)
    s.rect(w.arenaW - i - 2, i, 3, w.arenaH - i * 2, 1, 176 / 255, 84 / 255, la)
  }

  /**
   * Hazards: every fill, then every hazard's own art, then every rim. Three
   * flushes for all of them rather than three per hazard.
   */
  /**
   * Hazards: every puddle and cloud in one instanced pass (gl/hazards.ts),
   * then any map hazard's own art on top of its puddle.
   */
  private drawHazards(): void {
    const w = this.world
    const hz = this.dev.hazards
    const cam = this.camera
    for (let i = 0; i < w.hazards.live; i++) {
      const h = w.hazards.items[i]
      if (h.x + h.radius < cam.x - 8 || h.x - h.radius > cam.x + cam.viewW + 8) continue
      if (h.y + h.radius < cam.y - 8 || h.y - h.radius > cam.y + cam.viewH + 8) continue
      const fade = h.life < 0.5 ? Math.max(0, h.life / 0.5) : 1
      hz.push(h.x, h.y, h.radius, HAZARD_KIND[h.kind] ?? 0, fade, (i * 0.618) % 1)
    }
    this.flushShapes()
    hz.flush(this.dev.noise, w.elapsed, this.vx, this.vy, this.tw, this.th)
    for (let i = 0; i < w.hazards.live; i++) {
      const h = w.hazards.items[i]
      if (!h.sprite) continue
      const f = this.propFrame(h.sprite, h.x, h.y)
      if (!f) continue
      const fade = h.life < 0.5 ? Math.max(0, h.life / 0.5) : 1
      this.dev.sprites.push(Math.round(h.x - f.w / 2), Math.round(h.y - f.h / 2), 0, 0, f.w, f.h, f.x, f.y, f.page,
        0, 1, 1, 1, 1, 1, fade, 0, 0, 0, 0, 0, 0)
    }
    this.flushSprites()
  }

  private drawTelegraphs(): void {
    const s = this.dev.shapes
    const c = COL.telegraph
    // A faint fill with a hard pixel edge: where the danger ends is the
    // information. A flat filled wedge read as debug geometry.
    for (const t of this.world.telegraphs) {
      const half = ((t.spread / 2) * Math.PI) / 180
      const a0 = t.angle - half
      const a1 = t.angle + half
      s.wedge(t.x, t.y, t.range, t.range, a0, a1, c[0], c[1], c[2], c[3] * 0.45)
      s.arc(t.x, t.y, t.range - 1, a0, a1, 2, c[0], c[1], c[2], Math.min(1, c[3] * 2.2))
      s.line(t.x, t.y, t.x + Math.cos(a0) * t.range, t.y + Math.sin(a0) * t.range, 1, c[0], c[1], c[2], Math.min(1, c[3] * 1.6))
      s.line(t.x, t.y, t.x + Math.cos(a1) * t.range, t.y + Math.sin(a1) * t.range, 1, c[0], c[1], c[2], Math.min(1, c[3] * 1.6))
    }
  }

  private drawPlayerMark(x: number, y: number): void {
    const p = this.world.player
    if (!p.alive || this.hidePlayer) return
    const m = TUNING.playerMark
    const cy = y + m.footOffsetY
    const s = this.dev.shapes
    const rc = parseColourCached(m.ringColour)
    s.ellipseRing(x, cy, m.ringRadiusX, m.ringRadiusY, m.ringWidth, rc[0], rc[1], rc[2], rc[3] * m.ringAlpha)
    this.flushShapes()
  }

  /** A gold ring that rolls out from the player's feet when a level lands. */
  private drawLevelPulse(x: number, y: number): void {
    const p = this.world.player
    if (this.seenLevel < 0) this.seenLevel = p.level
    if (p.level > this.seenLevel) {
      this.seenLevel = p.level
      this.levelUpAt = this.world.elapsed
    }
    const age = this.world.elapsed - this.levelUpAt
    if (age < 0 || age > 0.7) return
    const k = age / 0.7
    const s = this.dev.shapes
    s.ellipseRing(x, y - 2, 10 + k * 70, (10 + k * 70) * 0.45, 3 * (1 - k) + 1, 1, 0.85, 0.35, 0.9 * (1 - k))
    this.flushShapes()
  }

  private drawArcs(): void {
    const s = this.dev.shapes
    for (const a of this.arcs) {
      if (a.aura) {
        const r = a.radius * 0.9
        const dashes = Math.max(12, Math.round(r / 9))
        const step = (Math.PI * 2) / dashes
        const spin = this.world.elapsed * 0.4
        for (let d = 0; d < dashes; d++) {
          const a0 = spin + d * step
          s.arc(a.x, a.y, r, a0, a0 + step * 0.45, 1.5, 170 / 255, 215 / 255, 235 / 255, 0.26)
        }
      } else {
        const half = 0.85
        s.wedge(a.x, a.y, a.radius, a.radius, a.angle - half, a.angle + half, 242 / 255, 234 / 255, 210 / 255, 0.3)
        s.arc(a.x, a.y, a.radius, a.angle - half, a.angle + half, 2, 1, 250 / 255, 235 / 255, 0.75)
      }
    }
  }

  private drawJabs(): void {
    if (this.jabs.length === 0) return
    const j = JAB
    const pl = this.world.player
    const dir = this.atlas?.directionFor(pl.classId, pl.facing) ?? 'down'
    const hand = carryAnchorOf('hand', dir, pl.classId)
    const lift = -(CARRY.bootOffsetY + (hand?.dy ?? 0))
    const s = this.dev.shapes
    for (const a of this.jabs) {
      const cx = a.x
      const cy = a.y - lift
      const cos = Math.cos(a.angle)
      const sin = Math.sin(a.angle)
      const half = (a.radius * j.lengthFraction) / 2
      const mid = (j.tines - 1) / 2
      const c = a.radius * j.forwardBias
      for (let t = 0; t < j.tines; t++) {
        const off = (t - mid) * j.tineSpacing
        const x0 = cx + cos * (c - half) - sin * off
        const y0 = cy + sin * (c - half) + cos * off
        const x1 = cx + cos * (c + half) - sin * off
        const y1 = cy + sin * (c + half) + cos * off
        s.line(x0, y0, x1, y1, j.lineWidth, JAB_RGB[0], JAB_RGB[1], JAB_RGB[2], j.alpha * a.t)
      }
    }
  }

  private drawPickups(alpha: number): void {
    const w = this.world
    const atlas = this.atlas
    const batch = this.dev.sprites
    for (let i = 0; i < w.pickups.live; i++) {
      const g = w.pickups.items[i]
      const x = g.px + (g.x - g.px) * alpha
      const y = g.py + (g.y - g.py) * alpha
      const bob = g.magnetised ? 0 : Math.sin(g.bob * 4) * 1.5
      const f = g.kind === 'gear' && g.itemId
        ? atlas?.get(itemCardSprite(g.itemId)) ?? atlas?.get('pickup.feed')
        : this.frames ? this.propFrame(this.frames.named.get('pickup', g.kind), g.x, g.y) : null
      // Loot left lying settles into the ground: full strength for its first
      // eight seconds, then down to 55% over twelve more, so a field of old
      // drops stops shouting over the fight. `bob` only runs while it lies.
      const settle = g.magnetised ? 1 : 1 - Math.min(0.45, Math.max(0, g.bob - 8) / 12 * 0.45)
      if (f) {
        const xp = g.kind === 'xp'
        // Seeds sit back after dark: the eye should find the threats first.
        const dim = xp ? 1 - 0.4 * this.day.night : 1
        this.spr(f, Math.round(x), Math.round(y + bob), 0, 0, 0, 1, 1, settle, 0, NO_OUTLINE,
          xp ? XP_TINT[0] * dim : 1, xp ? XP_TINT[1] * dim : 1, xp ? XP_TINT[2] * dim : 1)
      } else {
        const c = g.kind === 'xp' ? COL.xp : COL.feed
        const s = g.kind === 'xp' ? 5 : 7
        batch.push(Math.round(x), Math.round(y + bob), -s / 2, -s / 2, s, s, 0, 0, PAGE_SOLID,
          0, 1, 1, c[0], c[1], c[2], 1, 0, 0, 0, 0, 0, 0)
      }
    }
  }

  private drawParticles(): void {
    const w = this.world
    const batch = this.dev.sprites
    for (let i = 0; i < w.particles.live; i++) {
      const p = w.particles.items[i]
      const c = p.colour
      const a = Math.min(1, p.life / p.maxLife)
      batch.push(p.x, p.y, 0, 0, p.size, p.size, 0, 0, PAGE_SOLID, 0, 1, 1,
        ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, a, 0, 0, 0, 0, 0, 0)
    }
  }

  private drawOverhead(px: number, py: number): void {
    const cfg = this.world.map.overhead
    if (!cfg || !this.overhead.length) return
    const cam = this.camera
    const pad = 96
    const left = cam.x - pad
    const top = cam.y - pad
    const right = cam.x + cam.viewW + pad
    const bottom = cam.y + cam.viewH + pad
    const r2 = cfg.fadeRadius * cfg.fadeRadius
    for (const o of this.overhead) {
      if (o.x < left || o.x > right || o.y < top || o.y > bottom) continue
      const dx = o.x - px
      const dy = o.y - py
      const d2 = dx * dx + dy * dy
      let a = cfg.alpha
      if (d2 < r2) {
        const t = Math.sqrt(d2) / cfg.fadeRadius
        const e = t * t * (3 - 2 * t)
        a = cfg.minAlpha + (cfg.alpha - cfg.minAlpha) * e
      }
      if (a <= 0.01) continue
      this.spr(o.frame, o.x, o.y, 0, 0, 0, 1, 1, a, 0)
    }
  }

  /**
   * A marker on the edge of the view pointing at a boss that is off it, so a
   * boss wave never starts with a health bar and nothing to look at.
   */
  private drawBossMarker(): void {
    const b = this.world.findBoss()
    if (!b) return
    const cam = this.camera
    const m = 26
    const cx = cam.x + cam.viewW / 2
    const cy = cam.y + cam.viewH / 2
    if (b.x > cam.x + m && b.x < cam.x + cam.viewW - m && b.y > cam.y + m && b.y < cam.y + cam.viewH - m) return
    const dx = b.x - cx
    const dy = b.y - cy
    const k = Math.min((cam.viewW / 2 - m) / Math.max(1e-3, Math.abs(dx)), (cam.viewH / 2 - m) / Math.max(1e-3, Math.abs(dy)))
    const x = cx + dx * k
    const y = cy + dy * k
    const ang = Math.atan2(dy, dx)
    const pulse = 0.75 + 0.25 * Math.sin(this.world.elapsed * 6)
    const s = this.dev.shapes
    const c = Math.cos(ang)
    const n = Math.sin(ang)
    const tipX = x + c * 12
    const tipY = y + n * 12
    s.tri(tipX, tipY, x - c * 6 - n * 9, y - n * 6 + c * 9, x - c * 6 + n * 9, y - n * 6 - c * 9, 0.95, 0.35, 0.18, pulse)
    s.ring(x - c * 16, y - n * 16, 7, 2, 0.95, 0.35, 0.18, pulse)
  }

  /**
   * Fireflies over the grass between golden hour and the rain: a few dozen
   * blinking points, placed by hash and wandering on sines, glowing into the
   * bloom. Nothing is stored.
   */
  private drawFireflies(amount: number): void {
    if (amount <= 0.01) return
    const batch = this.dev.sprites
    const t = this.world.elapsed
    const n = Math.floor(36 * amount)
    for (let i = 0; i < n; i++) {
      const hx = fract(Math.sin(i * 91.7) * 43758.5453)
      const hy = fract(Math.sin(i * 47.3) * 24634.6345)
      const x = this.vx + mod(hx * this.tw + Math.sin(t * 0.37 + i * 1.9) * 40 + t * 3, this.tw)
      const y = this.vy + mod(hy * this.th + Math.sin(t * 0.53 + i * 2.7) * 24, this.th)
      const blink = Math.max(0, Math.sin(t * 1.7 + i * 3.1)) * amount
      this.fireflyLights[i * 3 + 2] = 0
      if (blink < 0.05) continue
      batch.push(Math.round(x), Math.round(y), 0, 0, 1, 1, 0, 0, PAGE_SOLID,
        0, 1, 1, 0.85, 1, 0.45, blink, 0, 1, 0, 0, 0, 0)
      this.fireflyLights[i * 3] = x
      this.fireflyLights[i * 3 + 1] = y
      this.fireflyLights[i * 3 + 2] = blink
    }
    this.fireflyCount = n
  }

  /**
   * Rain over the view: thin streaks falling on a slant, placed by hash so
   * nothing is stored, and the odd splash on the ground. Faintly emissive so it
   * still reads in the dark.
   */
  private drawRain(amount: number): void {
    if (amount <= 0.01) return
    const batch = this.dev.sprites
    const t = this.world.elapsed
    const n = Math.floor(340 * amount)
    const W = this.tw
    const H = this.th
    for (let i = 0; i < n; i++) {
      const hx = fract(Math.sin(i * 78.233) * 43758.5453)
      const hy = fract(Math.sin(i * 12.989) * 24634.6345)
      const speed = 420 + hx * 180
      const x = this.vx + mod(hx * W + t * speed * 0.28, W)
      const y = this.vy + mod(hy * H + t * speed, H)
      batch.push(Math.round(x), Math.round(y), 0, 0, 1, 5, 0, 0, PAGE_SOLID,
        -0.27, 1, 1, 0.72, 0.8, 0.92, 0.32 * amount, 0, 0.18, 0, 0, 0, 0)
      if (i % 5 === 0) {
        const life = mod(t * 3 + hx * 7, 1)
        if (life < 0.18) {
          const sx = this.vx + hy * W
          const sy = this.vy + hx * H
          batch.push(Math.round(sx), Math.round(sy), 0, 0, 2, 1, 0, 0, PAGE_SOLID,
            0, 1, 1, 0.8, 0.86, 0.95, 0.45 * amount * (1 - life / 0.18), 0, 0.2, 0, 0, 0, 0)
        }
      }
    }
  }

  /** Damage numbers from the glyph texture: white or gold, with a dark outline from the shader. */
  private drawDamageNumbers(): void {
    const w = this.world
    const batch = this.dev.sprites
    const ol = COL.outlineText
    for (let i = 0; i < w.damageNumbers.live; i++) {
      const d = w.damageNumbers.items[i]
      // Tick damage (a 1 or a 2 from a cloud, a pool, a rider) is real but not
      // worth reading, and fifty of them stacked into '1111' smears.
      if (!d.crit && d.value < 3) continue
      const t = d.life / d.maxLife
      const a = Math.min(1, t * 1.6)
      const glyphs = d.crit || d.value >= 40 ? this.dev.glyphsBig : this.dev.glyphs
      const c = d.crit ? COL.crit : COL.number
      let v = Math.max(0, Math.round(d.value))
      let n = 0
      do { this.digits[n++] = v % 10; v = (v / 10) | 0 } while (v > 0 && n < this.digits.length)
      let width = 0
      for (let k = 0; k < n; k++) width += (glyphs.get(DIGIT_CHARS[this.digits[k]])?.w ?? 5) + 1
      let x = Math.round(d.x - width / 2)
      const top = Math.round(d.y - (d.crit ? 14 : 8))
      for (let k = n - 1; k >= 0; k--) {
        const g = glyphs.get(DIGIT_CHARS[this.digits[k]])
        if (!g) continue
        // Self-lit: a number is information, not part of the scene, and the
        // night had been greying them into the ground.
        batch.push(x, top, 0, 0, g.w, g.h, g.x, g.y, PAGE_GLYPH, 0, 1, 1,
          c[0], c[1], c[2], a, 0, 0.8, ol[0], ol[1], ol[2], a)
        x += g.w + 1
      }
    }
  }
}

const DIGIT_CHARS = '0123456789'

function fract(x: number): number { return x - Math.floor(x) }
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
function mod(a: number, b: number): number { return ((a % b) + b) % b }

const colourCache = new Map<string, RGBA>()
function parseColourCached(css: string): RGBA {
  let c = colourCache.get(css)
  if (!c) {
    c = parseColour(css)
    colourCache.set(css, c)
  }
  return c
}
