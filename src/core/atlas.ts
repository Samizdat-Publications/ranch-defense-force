/**
 * The packed atlas, built offline by `tools/build-atlas.ts`. One image, one
 * draw path — the game never reads `assets/`.
 *
 * A white silhouette copy is rendered once at load. The hit flash then costs a
 * single `drawImage` from a different source instead of a per-sprite
 * `save`/`globalCompositeOperation`/`restore`, which at 800 enemies is the
 * difference between free and not.
 */
export interface AtlasFrame {
  x: number
  y: number
  w: number
  h: number
  /** Offset from the sprite's bottom-centre pivot to the trimmed top-left. */
  ox: number
  oy: number
}

interface AtlasData {
  width: number
  height: number
  rig: { directions: string[]; clips: Record<string, { framesPerDirection: number }> }
  /**
   * Per-sheet direction lists for sheets that are not on the humanoid rig —
   * the generated animals, which have eight. A sheet absent from here uses the
   * rig's four, so this is additive and no existing sheet changes.
   */
  dirSets?: Record<string, string[]>
  /** Frames per direction per sheet — species differ, so this cannot be one number. */
  clipLengths: Record<string, Record<string, number>>
  frames: Record<string, AtlasFrame>
}

export class Atlas {
  readonly image: HTMLImageElement
  readonly flash: HTMLCanvasElement
  readonly frames: Record<string, AtlasFrame>
  readonly directions: string[]
  readonly dirSets: Record<string, string[]>
  readonly clips: Record<string, { framesPerDirection: number }>
  readonly clipLengths: Record<string, Record<string, number>>

  private constructor(image: HTMLImageElement, flash: HTMLCanvasElement, data: AtlasData) {
    this.image = image
    this.flash = flash
    this.frames = data.frames
    this.directions = data.rig.directions
    this.dirSets = data.dirSets ?? {}
    this.clips = data.rig.clips
    this.clipLengths = data.clipLengths ?? {}
  }

  static async load(base: string): Promise<Atlas> {
    const [image, data] = await Promise.all([
      loadImage(`${base}atlas.png`),
      fetch(`${base}atlas.json`).then((r) => {
        if (!r.ok) throw new Error(`atlas.json: ${r.status}`)
        return r.json() as Promise<AtlasData>
      }),
    ])

    const flash = document.createElement('canvas')
    flash.width = image.naturalWidth
    flash.height = image.naturalHeight
    const ctx = flash.getContext('2d')
    if (!ctx) throw new Error('flash canvas context unavailable')
    ctx.drawImage(image, 0, 0)
    // Keep the alpha, replace every colour with white.
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, flash.width, flash.height)

    return new Atlas(image, flash, data)
  }

  has(name: string): boolean {
    return name in this.frames
  }

  get(name: string): AtlasFrame | undefined {
    return this.frames[name]
  }

  /** Frames per direction for a sheet's clip, 1 if unknown. */
  clipLength(sheet: string, clip: string): number {
    return this.clipLengths[sheet]?.[clip] ?? this.clips[clip]?.framesPerDirection ?? 1
  }

  /** The sheet's own direction list, falling back to the humanoid rig's four. */
  directionsFor(sheet: string): string[] {
    return this.dirSets[sheet] ?? this.directions
  }

  /** The direction name this sheet uses for a facing angle. */
  directionFor(sheet: string, facing: number): string {
    const dirs = this.directionsFor(sheet)
    return dirs[directionIndex(facing, dirs.length)] ?? dirs[0] ?? 'down'
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })
}

/**
 * Facing angle to a direction index. Screen space: +y is down.
 *
 * The two rigs are indexed differently because their direction lists are
 * ordered differently, and neither order is arbitrary:
 *
 * - **Four** is the humanoid rig's `[down, up, left, right]`, which is not
 *   angle-sorted. It is picked apart by comparison so it can BIAS toward the
 *   side views, which carry more information than the front-on pose.
 * - **Eight** is angle-sorted from east, turning clockwise, so it is a single
 *   rounded division. There is no bias to apply: with a diagonal of its own
 *   for every 45 degrees, the nearest direction is always the right one.
 */
export function directionIndex(facing: number, count = 4): number {
  if (count === 8) {
    return ((Math.round(facing / (Math.PI / 4)) % 8) + 8) % 8
  }
  const c = Math.cos(facing)
  const s = Math.sin(facing)
  if (Math.abs(c) >= Math.abs(s) * 0.85) return c < 0 ? 2 : 3
  return s > 0 ? 0 : 1
}
