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
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
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

/*
   EVERY animation in the download, not just `walk`.

   This used to look for one hardcoded folder called `walk`, which was true when
   a humanoid had a walk and nothing else. It is what blocked the whole
   hit/attack/death tier for the five humanoid enemies: the art could be
   generated and would simply never be cut, so the pipeline appeared to work and
   produced nothing.

   Scanning means a clip added upstream lands here with no edit. The folder name
   IS the clip name -- PixelLab names it after the template or the description --
   and `_slug` on the manifest sheet maps whatever came back to the clip name the
   renderer asks for.

   Frame count is read per clip rather than assumed: `walk` is eight,
   `taking-punch` is whatever the template says, and a hardcoded 8 would silently
   refuse to write a six-frame recoil.
*/
let idles = 0
const written: Record<string, number> = {}
const report: string[] = []
const animRoot = `${root}/animations`
const clipDirs = existsSync(animRoot)
  ? readdirSync(animRoot).filter((d) => statSync(`${animRoot}/${d}`).isDirectory())
  : []

for (const dir of CARDINALS) {
  const rot = `${root}/rotations/${dir}.png`
  if (existsSync(rot)) {
    const [cell] = cells([decodePng(readFileSync(rot))])
    writeFileSync(`${outDir}/idle_${dir}.png`, encodePng(cell))
    idles++
  }

  for (const clip of clipDirs) {
    const src = `${animRoot}/${clip}/${dir}`
    if (!existsSync(src)) continue
    const files = readdirSync(src).filter((f) => f.endsWith('.png')).sort()
    if (!files.length) continue
    const frames = files.map((f) => decodePng(readFileSync(`${src}/${f}`)))
    // One shared baseline PER CLIP, never across clips: a recoil is a
    // different pose family to a walk, and forcing them to one baseline would
    // sink the recoil into the ground.
    const s = strip(cells(frames))
    writeFileSync(`${outDir}/${clip}_${dir}_strip.png`, encodePng(s))
    written[clip] = (written[clip] ?? 0) + 1
    if (clip === 'walk' && frames.length !== WALK_FRAMES) {
      report.push(`  walk ${dir}: ${frames.length} frames, expected ${WALK_FRAMES}`)
    }
  }
}

const summary = Object.entries(written).map(([c, n]) => `${c} ${n}/4`).join(', ')
console.log(`${name}: ${idles}/4 idles, ${summary || 'no clips'}, feet on y${BASELINE_Y}`)

/*
   Print the manifest block, with the frame counts READ off the strips.

   `pixellabStrips` slices a strip by the `frames` number in the manifest, so a
   wrong one does not error -- it slices at the wrong width and the animation
   slides instead of stepping. Template clips are whatever length the template
   is (taking-punch came back 6, falling-back-death 7, walk 8), so hand-typing
   this is three chances to be silently wrong per character.
*/
const blocks = Object.keys(written).map((clip) => {
  const probe = `${outDir}/${clip}_south_strip.png`
  const frames = existsSync(probe) ? decodePng(readFileSync(probe)).width / CELL_W : 0
  return `    "${clip}": { "file": "${clip}_{compass}_strip.png", "frames": ${frames} }`
})
if (blocks.length) {
  console.log(`\n  art/sprites.json -> pixellabStrips.sheets.${name}.clips:`)
  console.log(blocks.join(',\n'))
}
for (const line of report) console.log(line)
for (const [clip, n] of Object.entries(written)) {
  if (n < 4) console.log(`  ${clip}: only ${n}/4 directions — still generating, or lost by v3`)
}
