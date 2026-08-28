/**
 * Draw frames straight OUT of the packed atlas, to see what the game will
 * actually draw.
 *
 *     npm run contact -- feralDog walk        # one clip, every direction
 *     npm run contact -- prizeBull attack out.png
 *
 * Every other way of looking at this art inspects the SOURCE files. This reads
 * `public/atlas.png` through `public/atlas.json`, so it proves the whole chain
 * — manifest entry, packer, frame key, direction list — rather than the pixels
 * that went in. A sheet can be perfect on disk and still be drawn wrong because
 * its key is not the one the renderer asks for; that has happened here.
 *
 * One row per direction, in the sheet's own declared order, labelled by nothing
 * — the order IS the label, and a row that does not belong to the same animal
 * as the others is the failure this is for.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, blankImage, blit, type Image } from './png.ts'

const [sheet, clip, outArg] = process.argv.slice(2).filter((a) => a !== '--')
if (!sheet || !clip) {
  console.error('usage: npm run contact -- <sheet> <clip> [out.png]')
  process.exit(1)
}
const out = outArg ?? `/tmp/contact_${sheet}_${clip}.png`

interface Frame { x: number; y: number; w: number; h: number; ox: number; oy: number }
const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as {
  rig: { directions: string[] }
  dirSets?: Record<string, string[]>
  clipLengths: Record<string, Record<string, number>>
  frames: Record<string, Frame>
}
const img = decodePng(readFileSync('public/atlas.png'))

const dirs = atlas.dirSets?.[sheet] ?? atlas.rig.directions
const len = atlas.clipLengths[sheet]?.[clip] ?? 1

const picked: (Frame | undefined)[][] = dirs.map((d) =>
  Array.from({ length: len }, (_, f) => atlas.frames[`${sheet}.${clip}.${d}.${f}`]),
)
const found = picked.flat().filter(Boolean) as Frame[]
if (!found.length) {
  console.error(`no frames for ${sheet}.${clip}.* — is the sheet id right? (dirs: ${dirs.join(', ')})`)
  process.exit(1)
}

// One cell big enough for the largest frame, so nothing is cropped and the
// animal's size differences between directions stay visible.
const cw = Math.max(...found.map((f) => f.w)) + 6
const ch = Math.max(...found.map((f) => f.h)) + 6
const sheetImg: Image = blankImage(cw * len, ch * dirs.length)
for (let i = 0; i < sheetImg.data.length; i += 4) {
  sheetImg.data[i] = 90; sheetImg.data[i + 1] = 90; sheetImg.data[i + 2] = 90; sheetImg.data[i + 3] = 255
}

let missing = 0
picked.forEach((row, r) => {
  row.forEach((fr, c) => {
    if (!fr) { missing++; return }
    blit(img, fr.x, fr.y, fr.w, fr.h, sheetImg,
      c * cw + ((cw - fr.w) >> 1), r * ch + ((ch - fr.h) >> 1))
  })
})

writeFileSync(out, encodePng(sheetImg))
console.log(`${sheet}.${clip}: ${dirs.length} directions x ${len} frames`
  + `${missing ? `, ${missing} MISSING` : ''} -> ${out}`)
console.log(`  rows, top to bottom: ${dirs.join(', ')}`)
