/**
 * Tile every PNG in a directory onto one sheet, so a batch of raw generation
 * candidates can be judged in a single look instead of file by file.
 *
 *     npm run contactdir -- assets/pixellab/yard out.png [maxWidth] [zoom]
 *
 * Sibling of `npm run contact`, which reads the PACKED atlas and proves the
 * whole chain. This one reads source files and proves nothing about the game —
 * it is for choosing between candidates before anything is packed.
 *
 * Candidates are grouped by subject: `barn_0.png`, `barn_1.png` land on the
 * same row, so the choice is a left-to-right comparison rather than a hunt.
 * Drawn on a dark ground because generated art comes back with a transparent
 * background and white-on-white is unreadable.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, blankImage, type Image } from './png.ts'

const [dir, out = 'contact.png', maxWArg, zoomArg] = process.argv.slice(2).filter((a) => a !== '--')
if (!dir) { console.error('usage: npm run contactdir -- <dir> [out.png] [maxWidth] [zoom]'); process.exit(1) }
const MAXW = Number(maxWArg ?? 2400)
/** Nearest-neighbour only, and integer only — the house rule. A 32px sprite
 *  cannot be judged at 1:1 and smoothing it would hide exactly the pixel-level
 *  faults this sheet exists to catch. */
const Z = Math.max(1, Math.round(Number(zoomArg ?? 1)))
const PAD = 6

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
/** `name_3.png` -> subject `name`; anything else is its own subject. */
const subject = (f: string): string => f.replace(/\.png$/, '').replace(/_\d+$/, '')

const rows: { key: string; imgs: Image[] }[] = []
for (const f of files) {
  const img = decodePng(readFileSync(`${dir}/${f}`))
  const key = subject(f)
  const row = rows.find((r) => r.key === key)
  if (row) row.imgs.push(img)
  else rows.push({ key, imgs: [img] })
}
if (!rows.length) { console.error(`no PNGs in ${dir}`); process.exit(1) }

// Rows wrap if a subject has more candidates than fit; height is the sum of
// each row's own tallest frame, so a silo row does not pad out a milkcan row.
const laid = rows.flatMap((r) => {
  const perRow = Math.max(1, Math.floor(MAXW / (Math.max(...r.imgs.map((i) => i.width)) * Z + PAD)))
  const out: Image[][] = []
  for (let i = 0; i < r.imgs.length; i += perRow) out.push(r.imgs.slice(i, i + perRow))
  return out
})
const width = Math.max(...laid.map((r) => r.reduce((s, i) => s + i.width * Z + PAD, PAD)))
const height = laid.reduce((s, r) => s + Math.max(...r.map((i) => i.height)) * Z + PAD, PAD)

const sheet = blankImage(width, height)
for (let p = 0; p < sheet.data.length; p += 4) {
  sheet.data[p] = 30; sheet.data[p + 1] = 28; sheet.data[p + 2] = 26; sheet.data[p + 3] = 255
}
let y = PAD
for (const row of laid) {
  let x = PAD
  for (const im of row) {
    for (let sy = 0; sy < im.height * Z; sy++) for (let sx = 0; sx < im.width * Z; sx++) {
      const s = (((sy / Z) | 0) * im.width + ((sx / Z) | 0)) * 4
      const a = im.data[s + 3]
      if (a === 0) continue
      const d = ((y + sy) * width + x + sx) * 4
      // Composite rather than copy: generated PNGs carry soft alpha at the
      // outline, and a straight copy leaves a dark fringe on every edge.
      for (let c = 0; c < 3; c++) sheet.data[d + c] = (im.data[s + c] * a + sheet.data[d + c] * (255 - a)) / 255
    }
    x += im.width * Z + PAD
  }
  y += Math.max(...row.map((i) => i.height)) * Z + PAD
}
writeFileSync(out, encodePng(sheet))
console.log(`${files.length} frames, ${rows.length} subjects -> ${out} (${width}x${height})`)
console.log(rows.map((r) => `${r.key}x${r.imgs.length}`).join('  '))
