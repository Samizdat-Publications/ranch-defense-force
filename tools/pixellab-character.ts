/**
 * Pull a finished PixelLab character down and cut it onto the game's grid.
 *
 *     npm run character -- <character-id> <name>
 *
 * Writes what `pixellabStrips` in `art/sprites.json` expects, and nothing else:
 *
 *     assets/pixellab/character/<name>/idle_<compass>.png        32x64, 1 frame
 *     assets/pixellab/character/<name>/walk_<compass>_strip.png  32x64 x 8
 *     assets/pixellab/character/<name>/_contact.png              all of it, to judge
 *
 * ## Why this exists rather than `npm run cut` in a loop
 *
 * The cut tool takes one file at a time and a character is 4 rotations plus 32
 * walk frames. More importantly the walk frames have to be cut AND assembled
 * with one shared baseline: cutting each frame to its own content bounds and
 * then concatenating gives a character who bobs up and down as he walks,
 * because a mid-stride frame is a pixel or two shorter than a standing one.
 * The baseline is applied per STRIP, not per frame.
 *
 * ## The two numbers that matter
 *
 * `BASELINE_Y = 58` is where the feet go in the 64px cell, and it is 58 rather
 * than LimeZu's 52 because the generated cast is 51-55px tall — see the note in
 * `pixellab-cut.ts`. `ALPHA_FLOOR = 8` is because PixelLab's background removal
 * leaves a fringe of alpha 1-8, and trimming at `!== 0` keeps a one-pixel halo
 * that puts every sprite a pixel off centre.
 *
 * Only the four CARDINALS are cut. The renderer buckets facing into four; the
 * diagonals are generated and sit in the zip unused, which is deliberate and is
 * the four-vs-eight decision recorded in the queue.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { unzipTo } from './unzip.ts'
import { decodePng, encodePng, blankImage, blit, type Image } from './png.ts'

const CELL_W = 32
const CELL_H = 64
const BASELINE_Y = 58
const ALPHA_FLOOR = 8
/** south/north/west/east — `compassToDirection` in the manifest maps them. */
const CARDINALS = ['south', 'north', 'east', 'west'] as const
const WALK_FRAMES = 8

const args = process.argv.slice(2).filter((a) => a !== '--')
const [characterId, name] = args
if (!characterId || !name) {
  console.error('usage: npm run character -- <character-id> <name>')
  process.exit(1)
}

/** Content bounds at the alpha floor, not at `!== 0`. */
function bounds(img: Image): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] <= ALPHA_FLOOR) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Place frames on cells sharing ONE baseline, taken from the tallest of them.
 *
 * Per-frame baselines are what make a walk cycle bob: a mid-stride pose is
 * shorter than a standing one, so aligning each frame's own bottom edge lifts
 * the character on every other step.
 */
function cells(frames: Image[]): Image[] {
  const boxes = frames.map(bounds)
  const feet = Math.max(...boxes.map((b) => b.y + b.h))
  return frames.map((img, i) => {
    const b = boxes[i]
    if (b.w === 0) return blankImage(CELL_W, CELL_H)
    const cell = blankImage(CELL_W, CELL_H)
    const dx = Math.round((CELL_W - b.w) / 2)
    // Shift by the frame's own offset from the SHARED baseline, so a shorter
    // frame sits lower in the cell rather than being pushed down to the floor.
    const dy = BASELINE_Y - (feet - b.y)
    blit(img, b.x, b.y, b.w, b.h, cell, dx, dy)
    return cell
  })
}

function strip(cellList: Image[]): Image {
  const out = blankImage(CELL_W * cellList.length, CELL_H)
  cellList.forEach((c, i) => blit(c, 0, 0, CELL_W, CELL_H, out, i * CELL_W, 0))
  return out
}

const outDir = `assets/pixellab/character/${name}`
const tmp = `.tmp/char-${name}`
mkdirSync(outDir, { recursive: true })

const res = await fetch(`https://api.pixellab.ai/mcp/characters/${characterId}/download`)
if (!res.ok) {
  console.error(`download failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
unzipTo(Buffer.from(await res.arrayBuffer()), tmp)

// The zip nests everything under the character's state name, which is whatever
// it was called when created — "Idle" for these. Find it rather than assume it.
const root = ['Idle', 'idle', '.'].map((d) => `${tmp}/${d}`).find((d) => existsSync(`${d}/rotations`))
if (!root) {
  console.error(`no rotations/ in the download — layout changed?`)
  process.exit(1)
}

let idles = 0
let strips = 0
const report: string[] = []
for (const dir of CARDINALS) {
  const rot = `${root}/rotations/${dir}.png`
  if (existsSync(rot)) {
    const [cell] = cells([decodePng(readFileSync(rot))])
    writeFileSync(`${outDir}/idle_${dir}.png`, encodePng(cell))
    idles++
  }

  const frames: Image[] = []
  for (let i = 0; i < WALK_FRAMES; i++) {
    const f = `${root}/animations/walk/${dir}/frame_${String(i).padStart(3, '0')}.png`
    if (existsSync(f)) frames.push(decodePng(readFileSync(f)))
  }
  if (frames.length === WALK_FRAMES) {
    const s = strip(cells(frames))
    writeFileSync(`${outDir}/walk_${dir}_strip.png`, encodePng(s))
    strips++
  } else if (frames.length > 0) {
    report.push(`  walk ${dir}: only ${frames.length}/${WALK_FRAMES} frames — NOT written`)
  }
}

console.log(`${name}: ${idles}/4 idles, ${strips}/4 walk strips, feet on y${BASELINE_Y}`)
for (const line of report) console.log(line)
if (strips < 4) console.log('  (a missing walk usually means the animation is still generating)')
