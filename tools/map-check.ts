/**
 * Bake every map's whole ground, headlessly, and write one PNG each.
 *
 *     npm run maps -- [wave] [outDir] [seed] [scale]
 *
 * The rig this question needs. `npm run shot` draws a 520x330 camera window of
 * a real run, which is the right tool for "does the game look right" and the
 * wrong one for "does this MAP work" — a map is 2400 to 3200 pixels across and
 * its whole point is the shape at that scale. Same argument that built
 * `npm run range` for the weapon ring and `npm run zoom` for the home scene.
 *
 * `wave` drives the blight, so `npm run maps -- 20` shows what each map looks
 * like three quarters of the way through a run rather than clean. `scale` is an
 * integer DIVISOR — 2 halves it — because a full 3200x2100 bake is a lot of PNG
 * and the composition reads fine at half.
 *
 * It draws the ground and NOTHING ELSE. No props, no entities, no vignette:
 * the question is whether the floor is varied and legible, and everything on
 * top of it is a different question that `npm run shot` already answers.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { blankImage, encodePng, type Image } from './png.ts'
import { frames, atlasImage } from './draw-world.ts'
import { MAPS, TUNING } from '../src/content/index.ts'
import { wangKey, type Corner } from '../src/render/wang.ts'
import { blightField, DEFAULT_BLIGHT, type BlightConfig } from '../src/render/blight.ts'
import { groundLayers } from '../src/render/terrain.ts'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const wave = Number(argv[0] ?? 1)
const outDir = argv[1] ?? 'tools/maps'
const seed = Number(argv[2] ?? 20260811)
const scale = Math.max(1, Math.round(Number(argv[3] ?? 2)))

const BLIGHT: BlightConfig = {
  ...DEFAULT_BLIGHT,
  ...((TUNING as unknown as { terrain?: { blight?: Partial<BlightConfig> } }).terrain?.blight ?? {}),
}

mkdirSync(outDir, { recursive: true })
const tile = 32

/** Nearest-neighbour downscale by an integer divisor. Pixel art, so no filter. */
function shrink(img: Image, by: number): Image {
  if (by <= 1) return img
  const out = blankImage(Math.floor(img.width / by), Math.floor(img.height / by))
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const s = ((y * by) * img.width + x * by) * 4
      const d = (y * out.width + x) * 4
      out.data[d] = img.data[s]
      out.data[d + 1] = img.data[s + 1]
      out.data[d + 2] = img.data[s + 2]
      out.data[d + 3] = img.data[s + 3]
    }
  }
  return out
}

/** One atlas frame onto the canvas at its natural size. */
function put(dst: Image, f: { x: number; y: number; w: number; h: number }, dx: number, dy: number): void {
  for (let y = 0; y < f.h; y++) {
    const sy = f.y + y
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < f.w; x++) {
      const sx = f.x + x
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const si = (sy * atlasImage.width + sx) * 4
      if (atlasImage.data[si + 3] === 0) continue
      const di = (ty * dst.width + tx) * 4
      dst.data[di] = atlasImage.data[si]
      dst.data[di + 1] = atlasImage.data[si + 1]
      dst.data[di + 2] = atlasImage.data[si + 2]
      dst.data[di + 3] = 0xff
    }
  }
}

let missing = 0
for (const map of MAPS) {
  const cols = Math.ceil(map.width / tile)
  const rows = Math.ceil(map.height / tile)
  const vw = cols + 1
  const canvas = blankImage(cols * tile, rows * tile)

  const layers = groundLayers(map, seed, cols, rows)
  // Caves carry no blight — the ash is a thing that happens to a field.
  const blight = map.blight ? blightField(seed, cols, rows, wave, BLIGHT) : null

  const paint = (set: string, at: Uint8Array, coverAll: boolean): number => {
    let painted = 0
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c: [Corner, Corner, Corner, Corner] = [
          at[y * vw + x] as Corner, at[y * vw + x + 1] as Corner,
          at[(y + 1) * vw + x] as Corner, at[(y + 1) * vw + x + 1] as Corner,
        ]
        if (!coverAll && !(c[0] || c[1] || c[2] || c[3])) continue
        const f = frames[wangKey(set, ...c)]
        if (!f) { missing++; continue }
        put(canvas, f, x * tile, y * tile)
        painted++
      }
    }
    return painted
  }

  /*
     COVERAGE, IN PERCENT OF VERTICES, because that is the number to tune to.

     Guessing a patch count and looking at the result got Stony Ground to 80%
     gravel — one grey mass, worse than the flat map it was meant to improve on.
     The blight had the identical failure in session 13 and the fix there was
     the same: write the coverage table, then pick numbers against it.

     The base layer reports its INVERTED share, because its field is 1 for the
     grass everything sits on and the interesting number is how much bare earth
     shows through.
  */
  const share = (f: Uint8Array, invert: boolean): string => {
    let n = 0
    for (let i = 0; i < f.length; i++) if ((f[i] === 1) !== invert) n++
    return `${((n / f.length) * 100).toFixed(1)}%`
  }

  const counts: string[] = []
  const base = map.layers[0]
  counts.push(`${base.set}(worn) ${share(layers[0].field, true)}`)
  paint(base.set, layers[0].field, true)
  if (blight && map.blight) {
    counts.push(`${map.blight} ${share(blight, false)}`)
    paint(map.blight, blight, false)
  }
  for (let i = 1; i < layers.length; i++) {
    counts.push(`${layers[i].set} ${share(layers[i].field, false)}`)
    paint(layers[i].set, layers[i].field, false)
  }

  const out = shrink(canvas, scale)
  const path = `${outDir}/${map.id}.png`
  writeFileSync(path, encodePng(out))
  console.log(
    `${path}  ${map.width}x${map.height} -> ${out.width}x${out.height}  wave ${wave}\n` +
    `  ${map.name} — coverage: ${counts.join('   ')}`,
  )
}

if (missing > 0) {
  console.error(
    `\n${missing} cells had no packed tile. A map names a Wang set that is not ` +
    `in assets/tilesets/ or was not packed — run npm run atlas, and check the ` +
    `set names in src/content/maps.json.`,
  )
  process.exit(1)
}
