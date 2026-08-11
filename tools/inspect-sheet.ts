/**
 * Reports the frame grid of a sprite sheet: which cells actually contain
 * pixels, how long each row's run of frames is, and the content bounds of the
 * first frame in each row.
 *
 * Used to derive the generator's row layout without guessing, and worth keeping
 * — every new Farmer Generator export can be checked against the rig with it.
 *
 *   npm run inspect -- assets/generated/characters/farmer-01.png
 */
import { readFileSync } from 'node:fs'
import { decodePng, contentBounds } from './png.ts'

const path = process.argv[2] ?? 'assets/generated/characters/farmer-01.png'
const cell = Number(process.argv[3] ?? 32)

const img = decodePng(readFileSync(path))
const cols = Math.floor(img.width / cell)
const rows = Math.floor(img.height / cell)

console.log(`${path}`)
console.log(`${img.width} x ${img.height}  ->  ${cols} cols x ${rows} rows at ${cell}px\n`)

let totalFilled = 0
for (let r = 0; r < rows; r++) {
  const filled: boolean[] = []
  for (let c = 0; c < cols; c++) {
    filled.push(!contentBounds(img, c * cell, r * cell, cell, cell).empty)
  }
  const count = filled.filter(Boolean).length
  totalFilled += count

  // Length of the leading contiguous run — an animation is a run of frames
  // from column 0, so a gap means the row holds more than one clip.
  let run = 0
  while (run < cols && filled[run]) run++

  const gaps: string[] = []
  let inGap = false
  for (let c = run; c < cols; c++) {
    if (filled[c] && !inGap) { gaps.push(String(c)); inGap = true }
    else if (!filled[c]) inGap = false
  }

  const b = count > 0 ? contentBounds(img, 0, r * cell, cell, cell) : null
  const bounds = b && !b.empty
    ? `first frame content ${b.w}x${b.h} at +${b.x},+${b.y - r * cell}`
    : ''
  console.log(
    `row ${String(r).padStart(2)}  frames ${String(count).padStart(3)}  ` +
    `run ${String(run).padStart(3)}` +
    (gaps.length ? `  resumes at ${gaps.join(',')}` : '') +
    (bounds ? `  ${bounds}` : ''),
  )
}
console.log(`\n${totalFilled} filled cells of ${cols * rows}`)
