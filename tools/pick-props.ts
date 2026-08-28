/**
 * Choose one candidate per generated prop, and lay every choice out on one
 * sheet so the whole set can be judged in a single look.
 *
 *     npm run pick                 # report + contact grid, writes nothing
 *     npm run pick -- --write      # also cut the picks into assets/pixellab/picked/
 *     npm run pick -- --set corn_rows_rotted=7 --write
 *
 * 76 props arrived with 4 to 64 candidates each — around 1,900 images. Opening
 * every contact sheet is not a good use of a session, and frame 0 is not a good
 * default: the failure modes are a nearly-empty cell and one that overflows its
 * box, and frame 0 is as likely to be either as any other.
 *
 * **The heuristic is the median silhouette.** Take every candidate's content
 * bounds, take the median area, and pick the candidate closest to it. That
 * rejects both failure modes at once without knowing anything about the
 * subject: an empty cell is far below the median, a cell where the model drew
 * a whole scene is far above, and the cluster in the middle is the set of
 * candidates that drew the thing that was asked for. It is a starting point to
 * be overridden, not a judgement — `--set <name>=<index>` is the override, and
 * every choice is recorded in art/prop-picks.json so it survives a re-run.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { decodePng, encodePng, blankImage, blit, contentBounds, type Image } from './png.ts'

const SHEETS = 'assets/pixellab/sheets'
const PICKED = 'assets/pixellab/picked'
const RECORD = 'art/prop-picks.json'

const args = process.argv.slice(2).filter((a) => a !== '--')
const write = args.includes('--write')
const overrides: Record<string, number> = {}
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue
  const [k, v] = (args[i + 1] ?? '').split('=')
  if (k && v !== undefined) overrides[k] = Number(v)
}

const prior: Record<string, number> = existsSync(RECORD)
  ? JSON.parse(readFileSync(RECORD, 'utf8')) as Record<string, number>
  : {}

/**
 * A prop is a DIRECTORY of `<name>_NN.png` candidates. `sheets/` also holds
 * loose single PNGs from earlier sessions, which are already-chosen art rather
 * than candidate sets, so directories only.
 */
const props = readdirSync(SHEETS)
  .filter((d) => statSync(`${SHEETS}/${d}`).isDirectory())
  .map((d) => ({
    name: d,
    files: readdirSync(`${SHEETS}/${d}`).filter((f) => /_\d+\.png$/.test(f)).sort(),
  }))
  .filter((p) => p.files.length > 0)

interface Pick { name: string; index: number; img: Image; source: string }
const picks: Pick[] = []

for (const p of props) {
  const cands = p.files.map((f) => {
    const img = decodePng(readFileSync(`${SHEETS}/${p.name}/${f}`))
    const b = contentBounds(img, 0, 0, img.width, img.height)
    /*
       Reject a candidate drawn on a CARD — an opaque rectangle behind the
       subject, usually white, left when background removal did not take.

       These are glaring to a human and invisible to an area heuristic, because
       a card is a perfectly ordinary area. The test is the four corners of the
       content box: a cleanly cut-out prop has transparent corners, a card has
       opaque ones. It costs four pixel reads and catches the whole class,
       including the case where the card is smaller than the frame — which the
       first attempt at this (full-frame only) missed on dig_in_fx and
       milk_cans.

       `heal_glow` has 24 of its 64 candidates like this, so on a big set the
       picker simply routes around them.
    */
    const card = !b.empty && (() => {
      const corners = [[b.x, b.y], [b.x + b.w - 1, b.y], [b.x, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]]
      let opaque = 0
      for (const [x, y] of corners) if (img.data[(y * img.width + x) * 4 + 3] > 200) opaque++
      return opaque >= 3
    })()
    return { f, img, area: b.empty || card ? 0 : b.w * b.h, card }
  })
  const areas = cands.map((c) => c.area).slice().sort((a, b) => a - b)
  const median = areas[areas.length >> 1] || 1

  /*
     A prop that already has art in `picked/` was chosen by hand in an earlier
     session, and this heuristic must not overwrite it. Roughly thirty of these
     sets predate this pass — the tool ladders, the item icons, the yard rooster
     — and they were picked by eye against the item they serve. Replacing a
     considered choice with a median is a silent downgrade.

     Only an explicit `--set` overrides an existing pick.
  */
  const alreadyPicked = existsSync(`${PICKED}/${p.name}.png`)

  let index: number
  let source: string
  if (overrides[p.name] !== undefined) { index = overrides[p.name]; source = 'override' }
  else if (alreadyPicked && prior[p.name] === undefined) { index = -1; source = 'kept' }
  else if (prior[p.name] !== undefined) { index = prior[p.name]; source = 'recorded' }
  else {
    let best = 0
    let bestD = Infinity
    cands.forEach((c, i) => {
      if (!c.area) return
      const d = Math.abs(c.area - median)
      if (d < bestD) { bestD = d; best = i }
    })
    index = best
    source = 'median'
  }
  if (source === 'kept') {
    // Show the art that is actually in use, not a candidate.
    picks.push({ name: p.name, index, img: decodePng(readFileSync(`${PICKED}/${p.name}.png`)), source })
    continue
  }
  index = Math.max(0, Math.min(cands.length - 1, index))
  picks.push({ name: p.name, index, img: cands[index].img, source })
}

// One grid of every pick, which is the point: the set has to look like one set.
const COLS = 10
const cw = Math.max(...picks.map((p) => p.img.width)) + 6
const ch = Math.max(...picks.map((p) => p.img.height)) + 6
const rows = Math.ceil(picks.length / COLS)
const grid: Image = blankImage(cw * COLS, ch * rows)
for (let i = 0; i < grid.data.length; i += 4) {
  grid.data[i] = 90; grid.data[i + 1] = 90; grid.data[i + 2] = 90; grid.data[i + 3] = 255
}
picks.forEach((p, i) => {
  const x = (i % COLS) * cw + ((cw - p.img.width) >> 1)
  const y = Math.floor(i / COLS) * ch + ((ch - p.img.height) >> 1)
  blit(p.img, 0, 0, p.img.width, p.img.height, grid, x, y)
})
writeFileSync('/tmp/prop-picks.png', encodePng(grid))

for (const p of picks) {
  console.log(`${p.name.padEnd(24)} #${String(p.index).padStart(2)}  ${p.source}`)
}
console.log(`\n${picks.length} props -> /tmp/prop-picks.png (${COLS} across, reading order below)`)
console.log(picks.map((p) => p.name).join(', '))

if (write) {
  mkdirSync(PICKED, { recursive: true })
  const record: Record<string, number> = {}
  for (const p of picks) {
    if (p.source === 'kept') continue
    record[p.name] = p.index
    // Trim at alpha > 8, not > 0: background removal leaves a 1-8 alpha fringe
    // and trimming at zero keeps a one-pixel halo and lands the sprite off
    // centre. Same rule tools/pixellab-cut.ts uses.
    const b = contentBounds(p.img, 0, 0, p.img.width, p.img.height)
    const out = blankImage(Math.max(1, b.w), Math.max(1, b.h))
    blit(p.img, b.x, b.y, b.w, b.h, out, 0, 0)
    writeFileSync(`${PICKED}/${p.name}.png`, encodePng(out))
  }
  writeFileSync(RECORD, JSON.stringify(record, null, 1) + '\n')
  const kept = picks.filter((p) => p.source === 'kept').length
  console.log(`\nwrote ${picks.length - kept} picks to ${PICKED}/, kept ${kept} existing, recorded in ${RECORD}`)
}
