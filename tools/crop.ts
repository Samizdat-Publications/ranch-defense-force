/**
 * Crop a rectangle out of a PNG and magnify it by an integer factor.
 *
 *     npm run crop -- <in.png> <out.png> <x> <y> <w> <h> [zoom]
 *
 * Every art judgement in this repo is made twice: at 1x, because that is the
 * size the game is played at and the only size that settles whether a thing
 * reads, and magnified, because every anchor and offset bug is a two-pixel
 * relationship invisible at 1x. Screenshots come out at the window size, which
 * is neither -- so this is the second half of `npm run play` and `npm run
 * scene`, and it existed as a throwaway in three separate sessions before it
 * was written down.
 *
 * Nearest-neighbour, integer only: it is a magnifying glass over the shot, not
 * a resample, and no pixel is invented.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, blankImage } from './png.ts'

const a = process.argv.slice(2).filter((v) => v !== '--')
if (a.length < 6) {
  console.error('usage: npm run crop -- <in.png> <out.png> <x> <y> <w> <h> [zoom]')
  process.exit(1)
}
const [src, dst] = a
const x0 = Number(a[2]); const y0 = Number(a[3])
const w = Number(a[4]); const h = Number(a[5])
const z = Math.max(1, Math.round(Number(a[6] ?? 4)))

const img = decodePng(readFileSync(src!))
const out = blankImage(w * z, h * z)
for (let y = 0; y < h * z; y++) {
  for (let x = 0; x < w * z; x++) {
    const sx = Math.min(img.width - 1, Math.max(0, x0 + ((x / z) | 0)))
    const sy = Math.min(img.height - 1, Math.max(0, y0 + ((y / z) | 0)))
    const s = (sy * img.width + sx) * 4
    const d = (y * out.width + x) * 4
    out.data[d] = img.data[s]!
    out.data[d + 1] = img.data[s + 1]!
    out.data[d + 2] = img.data[s + 2]!
    out.data[d + 3] = 255
  }
}
writeFileSync(dst!, encodePng(out))
console.log(`${dst}  ${out.width}x${out.height}  (${w}x${h} at ${x0},${y0}, ${z}x)`)
