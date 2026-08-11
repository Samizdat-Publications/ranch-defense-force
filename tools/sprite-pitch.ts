/**
 * Report the real horizontal pitch of a sprite band, by finding the empty
 * columns between sprites rather than assuming a grid.
 *
 *   npm run pitch -- <sheet.png> <row> [rowSpan]
 *
 * This exists because `inspect-sheet.ts` assumes 32px cells, and that
 * assumption is wrong for a whole family of sheets in this project. The animal
 * walk bands are on a 64px pitch with the animal centred in each frame; read as
 * 32px cells they look like twice as many frames, each one half an animal. That
 * misreading survived a whole milestone and got written up in NOTES as "the
 * front and back clips are drawn at incompatible proportions" — the art was
 * fine, the ruler was wrong.
 *
 * Run this on any new sheet before writing a manifest entry for it. If the
 * reported pitch is not the cell size, the sheet is not on the cell grid.
 */
import { readFileSync } from 'node:fs'
import { decodePng } from './png.ts'

const path = process.argv[2]
const walkRow = Number(process.argv[3])
const rows = Number(process.argv[4] ?? 2)
const CELL = 32

const img = decodePng(readFileSync(path))
const y0 = walkRow * CELL
const y1 = Math.min(img.height, y0 + CELL * rows)

const occupied: boolean[] = []
for (let x = 0; x < img.width; x++) {
  let any = false
  for (let y = y0; y < y1; y++) {
    if (img.data[(y * img.width + x) * 4 + 3] !== 0) { any = true; break }
  }
  occupied.push(any)
}

// Runs of occupied columns = individual sprites (or touching pairs).
const runs: { start: number; end: number }[] = []
let s = -1
for (let x = 0; x <= occupied.length; x++) {
  if (occupied[x]) { if (s < 0) s = x }
  else if (s >= 0) { runs.push({ start: s, end: x - 1 }); s = -1 }
}

console.log(`${path}`)
console.log(`band rows ${walkRow}..${walkRow + rows - 1}, width ${img.width} (${img.width / CELL} cells)`)
console.log(`${runs.length} sprite runs:`)
const centres: number[] = []
for (const r of runs) {
  const w = r.end - r.start + 1
  const c = (r.start + r.end) / 2
  centres.push(c)
  console.log(`  x ${String(r.start).padStart(4)}..${String(r.end).padStart(4)}  w ${String(w).padStart(3)}  centre ${c.toFixed(1)}  cell ${(c / CELL).toFixed(2)}`)
}
if (centres.length > 1) {
  const gaps: number[] = []
  for (let i = 1; i < centres.length; i++) gaps.push(centres[i] - centres[i - 1])
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  console.log(`\ncentre-to-centre pitch: mean ${mean.toFixed(1)}px  (min ${Math.min(...gaps)}, max ${Math.max(...gaps)})`)
}

// Vertical extent per run, to see whether front/back really are taller.
console.log('\nvertical extent per run:')
for (const r of runs) {
  let top = Infinity
  let bot = -1
  for (let y = y0; y < y1; y++) {
    for (let x = r.start; x <= r.end; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] !== 0) {
        if (y < top) top = y
        if (y > bot) bot = y
        break
      }
    }
  }
  console.log(`  x${String(r.start).padStart(4)}  y ${top - y0}..${bot - y0}  h ${bot - top + 1}`)
}
