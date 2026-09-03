/**
 * The packed atlas, built offline by `tools/build-atlas.ts`. One draw path —
 * the game never reads `assets/`.
 *
 * ## Pages
 *
 * The art arrives as several images of at most 2048x2048 rather than one big
 * sheet, and that is a measured decision, not a tidy one. A 4096x8192 source
 * cost twice a 2048x2048 one per frame at the game's own draw load, seven
 * times the JS self-time inside `drawImage`, and — because ~134MB decoded is
 * far past what Chrome's image-decode cache will hold — was re-decoded from
 * compressed PNG about once a second for the whole run. `tools/atlas-bench.ts`
 * and `tools/play-trace.ts` are the instruments; the numbers are in NOTES.
 *
 * Every frame carries the index of the page it sits on, so a caller draws from
 * `images[f.page]` and never has to know how the packer split anything.
 *
 * A white silhouette copy of each page is rendered once at load. The hit flash
 * then costs a single `drawImage` from a different source instead of a
 * per-sprite `save`/`globalCompositeOperation`/`restore`, which at 800 enemies
 * is the difference between free and not. Measured: the second surface costs
 * what the first one costs and no more, and alternating between them every
 * draw costs nothing on top of that.
 */
import { directionIndex } from './facing'

/**
 * Re-exported: it moved to `core/facing.ts` when the sim and the content layer
 * both needed it and neither may import the atlas reader. Callers here are
 * unchanged.
 */
export { directionIndex } from './facing'
export interface AtlasFrame {
  /** Which page holds it — index into `Atlas.images` / `Atlas.flash`. */
  page: number
  x: number
  y: number
  w: number
  h: number
  /** Offset from the sprite's bottom-centre pivot to the trimmed top-left. */
  ox: number
  oy: number
}

interface AtlasData {
  /** One entry per page image, in order. */
  pages: { w: number; h: number }[]
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
  /** One image per page. Index it with a frame's `page`. */
  readonly images: HTMLImageElement[]
  /** The white-silhouette copy of each page, same indices. */
  readonly flash: HTMLCanvasElement[]
  /** The url each page was loaded from, for the CSS sprite path. */
  readonly pageUrls: string[]
  readonly frames: Record<string, AtlasFrame>
  readonly directions: string[]
  readonly dirSets: Record<string, string[]>
  readonly clips: Record<string, { framesPerDirection: number }>
  readonly clipLengths: Record<string, Record<string, number>>

  private constructor(
    images: HTMLImageElement[],
    flash: HTMLCanvasElement[],
    pageUrls: string[],
    data: AtlasData,
  ) {
    this.images = images
    this.flash = flash
    this.pageUrls = pageUrls
    this.frames = data.frames
    this.directions = data.rig.directions
    this.dirSets = data.dirSets ?? {}
    this.clips = data.rig.clips
    this.clipLengths = data.clipLengths ?? {}
  }

  /*
     The manifest is fetched first and the pages after it, which is one round
     trip in series and deliberate: the manifest is what says how many pages
     there are. The pages themselves then load in PARALLEL, which is where the
     time is — several small PNGs decode concurrently on separate raster
     threads where one big one decodes on a single thread.
  */
  static async load(base: string): Promise<Atlas> {
    const data = await fetch(`${base}atlas.json`).then((r) => {
      if (!r.ok) throw new Error(`atlas.json: ${r.status}`)
      return r.json() as Promise<AtlasData>
    })

    const pageUrls = data.pages.map((_, i) => `${base}atlas-${i}.png`)
    const images = await Promise.all(pageUrls.map(loadImage))

    const flash = images.map((image) => {
      const c = document.createElement('canvas')
      c.width = image.naturalWidth
      c.height = image.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('flash canvas context unavailable')
      ctx.drawImage(image, 0, 0)
      // Keep the alpha, replace every colour with white.
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      return c
    })

    return new Atlas(images, flash, pageUrls, data)
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

