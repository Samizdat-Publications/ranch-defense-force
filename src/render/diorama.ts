/**
 * The title screen's backdrop: the Home Field at sundown, live.
 *
 * A World on the Home Field that is never stepped, drawn by the same renderer
 * the game uses, from a camera that drifts along the farmstead on its own. The
 * six classes stand by the gate with the stock around them; a barrel burns;
 * fireflies come out over the grass.
 *
 * Every so often lightning strikes. For a heartbeat the light is gone, the
 * ground is ash and everyone standing in the yard is one of the turned, and
 * then it is sundown again. The owner's idea from the v1 notes: the flash is
 * only frightening because the cursed cast stands where the healthy one stood.
 *
 * Deterministic: motion is a function of elapsed time; the strike schedule is
 * fixed. No Math.random.
 */
import { World } from '../sim/world'
import type { Atlas, AtlasFrame } from '../core/atlas'
import { CLASS_IDS } from '../content'
import { GLRenderer, type DrawExtra, type LightExtra } from './gl-renderer'

interface Actor {
  sheet: string
  /** What stands here after the lightning. */
  cursed: string
  x: number
  y: number
  dir: string
  /** Paces between x and paceTo, walking; idle if absent. */
  paceTo?: number
  speed: number
  phase: number
  classId?: string
}

/** The turned counterpart of each class, by where they stand. */
const CURSED_CLASS: Record<string, string> = {
  hand: 'farmhandBlight', kid: 'acidZombie', widow: 'bloatedFarmhand',
  vet: 'maskedSprayer', agronomist: 'maskedHauler', drifter: 'farmhandBlight',
}

const SUNDOWN = 0.795
const DARK = 0.97
const STRIKE_EVERY = 13
const CURSED_SECONDS = 1.7

export class Diorama {
  readonly world: World
  renderer: GLRenderer
  private readonly actors: Actor[] = []
  private readonly flies: DrawExtra[] = []
  private readonly flyLights: LightExtra[] = []
  private readonly fixedLights: LightExtra[] = []
  private readonly barrel: DrawExtra | null = null
  private time = 0
  private selected = 'hand'
  /** The title shoots the yard round the barrel; the Homestead drifts along the buildings. */
  private mode: 'title' | 'homestead' = 'title'

  constructor(private readonly canvas: HTMLCanvasElement, private readonly atlas: Atlas | null) {
    this.world = new World(0x1987_0924, 'hand', {}, 1, 'homeField')
    this.renderer = this.build()
    this.castTheYard()
    for (let i = 0; i < 26; i++) {
      this.flies.push({
        frame: null, x: 0, y: 0, w: 1, h: 1, colour: [0.86, 1, 0.45, 1],
        flipX: false, alpha: 1, emissive: 1, casts: false,
      })
      this.flyLights.push({ x: 0, y: 0, radius: 12, r: 0.8, g: 1, b: 0.4, intensity: 0.35, squash: 0.8 })
    }
    const f = atlas?.get('prop.burnBarrel.0') ?? atlas?.get('prop.burnBarrel')
    if (f) {
      this.barrel = {
        frame: f, x: 1300, y: -14, w: 0, h: 0, colour: [1, 1, 1, 1],
        flipX: false, alpha: 1, emissive: 0, casts: true,
      }
    }
    this.fixedLights.push(
      { x: 1300, y: -40, radius: 130, r: 1, g: 0.55, b: 0.22, intensity: 1.1, squash: 0.8 },
      { x: 1792, y: -120, radius: 70, r: 1, g: 0.78, b: 0.42, intensity: 0.7, squash: 1 },
      { x: 1700, y: -150, radius: 50, r: 1, g: 0.78, b: 0.42, intensity: 0.55, squash: 1 },
      { x: 790, y: -70, radius: 80, r: 1, g: 0.72, b: 0.38, intensity: 0.6, squash: 0.9 },
    )
  }

  private build(): GLRenderer {
    const r = new GLRenderer(this.canvas, this.world, this.atlas)
    r.hidePlayer = true
    r.dayOverride = SUNDOWN
    r.camera.margin = 600
    r.viewHeight = 380
    r.blightOverride = this.mode === 'homestead' ? 0 : 0.12
    return r
  }

  /** The atlas arrived after construction: rebuild the renderer so it has art. */
  rebuild(atlas: Atlas): void {
    ;(this as unknown as { atlas: Atlas }).atlas = atlas
    this.renderer = this.build()
  }

  private castTheYard(): void {
    const classes = CLASS_IDS.slice(0, 6)
    classes.forEach((id, i) => {
      this.actors.push({
        sheet: id, cursed: CURSED_CLASS[id] ?? 'farmhandBlight',
        x: 1060 + i * 64 + (i % 2) * 10, y: -20 + (i % 2) * 14, dir: 'down', speed: 0, phase: i * 0.7, classId: id,
      })
    })
    const stock: [string, string, number, number, number, string][] = [
      ['leghornHen', 'leghornHenBlight', 1080, 60, 1150, 'left'],
      ['brahmaHen', 'brahmaHenBlight', 1460, 40, 1400, 'right'],
      ['farmRooster', 'farmRoosterBlight', 1520, -20, 1480, 'left'],
      ['bantamHen', 'bantamHenBlight', 990, 30, 1040, 'right'],
      ['joy', 'joyBlight', 1390, 4, 0, 'left'],
      ['tabbyCat', 'tabbyCatBlight', 1455, -64, 0, 'left'],
      ['beigeMule', 'beigeMuleBlight', 900, -40, 960, 'right'],
    ]
    stock.forEach(([sheet, cursed, x, y, to, dir], i) => {
      this.actors.push({ sheet, cursed, x, y, dir, paceTo: to || undefined, speed: 9 + i * 1.5, phase: i * 1.3 })
    })
  }

  setMode(mode: 'title' | 'homestead'): void {
    this.mode = mode
    // Between runs the farm is at rest; at the title the rot is only at the fence.
    this.renderer.blightOverride = mode === 'homestead' ? 0 : 0.12
  }

  /** Bring the chosen class to the front of the group. */
  select(classId: string): void {
    this.selected = classId
  }

  resize(w: number, h: number): void {
    this.renderer.resize(w, h)
  }

  private frameFor(sheet: string, clip: string, dir: string, t: number, fps: number): AtlasFrame | null {
    const atlas = this.atlas
    if (!atlas) return null
    const dirs = atlas.directionsFor(sheet)
    const d = dirs.includes(dir) ? dir : dirs[0]
    const len = atlas.clipLength(sheet, clip)
    const f = Math.floor(t * fps) % Math.max(1, len)
    return atlas.get(`${sheet}.${clip}.${d}.${f}`) ?? atlas.get(`${sheet}.idle.${d}.0`) ?? atlas.get(`${sheet}.walk.${d}.0`) ?? null
  }

  draw(dt: number): void {
    this.time += dt
    const t = this.time
    const r = this.renderer
    const vw = r.camera.viewW
    const vh = r.camera.viewH

    // A slow drift along the farmstead, barn to farmhouse and back.
    if (this.mode === 'homestead') {
      // Along the farmstead, coop to bunkhouse and back, buildings whole.
      // Barn to farmhouse, buildings standing in the upper half and the yard
      // below them, where the signs stand.
      const hx = 1290 + Math.sin(t * 0.03) * 200
      r.holdCamera = { x: Math.round(hx - vw / 2), y: Math.round(-40 - vh * 0.52) }
    } else {
      const cx = 1180 + Math.sin(t * 0.045) * 190
      r.holdCamera = { x: Math.round(cx - vw / 2), y: Math.round(-8 - vh * 0.62) }
    }

    // Lightning: two flashes, then the dark and the turned, then sundown again.
    const cycle = t % STRIKE_EVERY
    const since = cycle - (STRIKE_EVERY - 2.2)
    const cursed = this.mode === 'title' && since >= 0 && since < CURSED_SECONDS
    const flash = this.mode === 'title' && since >= 0 ? Math.max(0, 1 - since / 0.22) * 0.9 + Math.max(0, 1 - Math.abs(since - 0.42) / 0.12) * 0.5 : 0
    r.flash[0] = flash * 0.85
    r.flash[1] = flash * 0.9
    r.flash[2] = flash
    r.dayOverride = cursed ? DARK : SUNDOWN

    const extras = r.extras
    extras.length = 0
    for (const a of this.actors) {
      let x = a.x
      let y = a.y
      let dir = a.dir
      let clip = 'idle'
      if (a.paceTo !== undefined) {
        const span = a.paceTo - a.x
        const period = Math.abs(span) / a.speed * 2 + 4
        const u = ((t + a.phase * 3) % period) / period
        const k = u < 0.5 ? u * 2 : 2 - u * 2
        const moving = Math.abs(k - 0.5) < 0.45
        x = a.x + span * Math.min(1, Math.max(0, (k - 0.05) / 0.9))
        dir = (u < 0.5) === (span > 0) ? 'right' : 'left'
        clip = moving ? 'walk' : 'idle'
      }
      if (a.classId) {
        const i = CLASS_IDS.indexOf(a.classId)
        // Round the barrel: the one you are taking out stands nearest the
        // camera, the others in a loose ring behind.
        if (a.classId === this.selected) { x = 1262; y = 10 } else {
          const others = CLASS_IDS.slice(0, 6).filter((id) => id !== this.selected)
          const j = others.indexOf(a.classId)
          const ang = Math.PI * (0.95 + j * 0.27)
          x = 1300 + Math.cos(ang) * 74
          y = -26 + Math.sin(ang) * 26 + ((j + i) % 2) * 3
        }
      }
      const sheet = cursed ? a.cursed : a.sheet
      const frame = this.frameFor(sheet, clip, dir, t + a.phase, clip === 'walk' ? 8 : 4)
      extras.push({
        frame, x: Math.round(x), y: Math.round(y), w: 12, h: 24, colour: [0.8, 0.7, 0.6, 1],
        flipX: false, alpha: 1, emissive: cursed ? -1 : 0, casts: true,
      })
    }
    if (this.barrel) {
      const atlas = this.atlas
      const len = atlas ? atlas.clipLength('prop.burnBarrel', 'play') : 1
      const f = len > 1 ? atlas?.get(`prop.burnBarrel.${Math.floor(t * 8) % len}`) : undefined
      if (f) this.barrel.frame = f
      extras.push(this.barrel)
    }

    const lights = r.extraLights
    lights.length = 0
    const flicker = 0.85 + 0.15 * Math.sin(t * 17.3) * Math.sin(t * 5.1)
    for (const l of this.fixedLights) lights.push(l)
    lights[0].intensity = 1.1 * flicker
    if (!cursed) {
      for (let i = 0; i < this.flies.length; i++) {
        const fly = this.flies[i]
        const fx = 860 + ((i * 97) % 760) + Math.sin(t * 0.4 + i * 1.7) * 40
        const fy = -60 + ((i * 53) % 160) + Math.sin(t * 0.63 + i * 2.3) * 16
        const blink = 0.5 + 0.5 * Math.sin(t * 2.1 + i * 3.7)
        fly.x = Math.round(fx)
        fly.y = Math.round(fy)
        fly.alpha = blink
        extras.push(fly)
        const fl = this.flyLights[i]
        fl.x = fx
        fl.y = fy
        fl.intensity = 0.3 * blink
        lights.push(fl)
      }
    }

    r.draw(1, () => 0.5)
  }
}
