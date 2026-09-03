/**
 * Read the built atlas from `public/`, for the offline tools.
 *
 * The atlas is PAGED — `public/atlas-0.png … atlas-N.png` plus one
 * `public/atlas.json` — because a single 4096x8192 sheet measured twice the
 * per-frame cost of a 2048x2048 one and was re-decoded from PNG about once a
 * second during play. See the comment on `PAGE_MAX` in `tools/build-atlas.ts`.
 *
 * Nine tools opened `public/atlas.png` and indexed frames into it. Paging that
 * by hand nine times is nine chances to read the right rect out of the wrong
 * image, which produces a picture of some other sprite rather than an error.
 * So it is done once, here: ask for a frame's page and blit from that.
 */
import { readFileSync } from 'node:fs'
import { decodePng, type Image } from './png.ts'

/** A frame's rect, plus the page it sits on. */
export interface AtlasFrame {
  page: number
  x: number
  y: number
  w: number
  h: number
  ox: number
  oy: number
}

export interface AtlasJson {
  pages: { w: number; h: number }[]
  rig: { directions: string[]; clips?: Record<string, { framesPerDirection: number }> }
  dirSets?: Record<string, string[]>
  clipLengths: Record<string, Record<string, number>>
  frames: Record<string, AtlasFrame>
}

export interface ReadAtlas {
  data: AtlasJson
  frames: Record<string, AtlasFrame>
  clipLengths: Record<string, Record<string, number>>
  dirSets: Record<string, string[]>
  rig: AtlasJson['rig']
  /** Decoded page images, in `atlas.json` order. */
  pages: Image[]
  /** The decoded page a frame was packed onto. */
  imageFor(f: { page: number }): Image
}

/**
 * Decode the manifest and every page.
 *
 * Every page, eagerly: these tools run offline against a few tens of MB and
 * all of them touch frames from more than one page. Laziness would buy nothing
 * and would make `imageFor` a function that can fail.
 */
export function readAtlas(dir = 'public'): ReadAtlas {
  const data = JSON.parse(readFileSync(`${dir}/atlas.json`, 'utf8')) as AtlasJson
  const pages = data.pages.map((_, i) => decodePng(readFileSync(`${dir}/atlas-${i}.png`)))
  return {
    data,
    frames: data.frames,
    clipLengths: data.clipLengths,
    dirSets: data.dirSets ?? {},
    rig: data.rig,
    pages,
    imageFor(f: { page: number }): Image {
      const img = pages[f.page]
      if (!img) throw new Error(`atlas frame names page ${f.page}, but only ${pages.length} were built`)
      return img
    },
  }
}
