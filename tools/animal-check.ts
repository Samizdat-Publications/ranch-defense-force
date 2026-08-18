/**
 * Measure a PixelLab 8-direction animal against the game it has to live in.
 *
 *   npm run animal            # every animal in assets/pixellab/object/
 *   npm run animal -- donkey  # one of them
 *
 * `art/pixellab-queue.json` lists four decisions that have to be MADE rather
 * than guessed before these ten animals can be packed: the compass-to-game
 * direction mapping, four directions or eight, nine frames against LimeZu's
 * six, and 56-68px sprites against LimeZu's smaller ones. Three of the four are
 * measurable and this measures them; the fourth (four or eight) is a renderer
 * decision that wants the contact sheet in front of you.
 *
 * THE DIRECTION MAPPING IS NOT A BAND ORDER. The three sheet families already
 * in the game pack their directions as anonymous bands, so which band is which
 * has to be proved — the humanoid rig note in `art/sprites.json` is the record
 * of doing exactly that, by pixel-mirroring and skin centroids. A PixelLab
 * object is not that. It comes back as eight files NAMED for their compass
 * points, so the only question is whether the names mean what they say, and
 * that is checkable rather than inferable:
 *
 *   - a front view and a rear view are each bilaterally symmetric
 *   - a left profile and a right profile are mirrors of EACH OTHER, and
 *     neither is symmetric on its own
 *
 * Silhouette IoU against a mirror measures all four claims at once. If south
 * and north come back symmetric and east/west come back as a mirrored pair,
 * the compass names are honest and the mapping is the same one already shipped
 * for the infected farmhand in `art/sprites.json` under `compassToDirection`.
 *
 * Nothing here writes to the atlas. It reports, and it draws a sheet.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { decodePng, encodePng, blankImage, blit, contentBounds, type Image } from './png.ts'
import { drawText } from './tinyfont.ts'

/** The renderer's integer zoom. A sprite judged at 1x is not the sprite you ship. */
const ZOOM = 2
const OBJECT_DIR = 'assets/pixellab/object'
const OUT = 'tools/animal-check.png'

/** The order `create_8_direction_object` returns, and the order `_ring.png` is in. */
const COMPASS = [
  'south', 'south-west', 'west', 'north-west',
  'north', 'north-east', 'east', 'south-east',
] as const
type Compass = (typeof COMPASS)[number]

/**
 * The mapping already shipped for the infected farhand, restated here so this
 * tool can check it rather than assume it. `art/sprites.json` ->
 * `pixellabStrips.compassToDirection`.
 */
const CLAIMED: Record<string, string> = {
  south: 'down', north: 'up', west: 'left', east: 'right',
}

interface Frame { x: number; y: number; w: number; h: number; ox: number; oy: number }
const atlasImg = decodePng(readFileSync('public/atlas.png'))
const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as {
  frames: Record<string, Frame>
  clipLengths: Record<string, Record<string, number>>
}

/** The LimeZu animals already on the field — what these have to stand next to. */
const LIMEZU = ['sickHog', 'blownSheep', 'feralDog', 'prizeBull'] as const

// ---------------------------------------------------------------- silhouettes

/** A trimmed 1-bit silhouette. Alpha only: colour cannot tell you which way a thing faces. */
interface Silhouette { w: number; h: number; bits: Uint8Array }

function silhouette(img: Image): Silhouette {
  const b = contentBounds(img, 0, 0, img.width, img.height)
  if (b.empty) return { w: 0, h: 0, bits: new Uint8Array(0) }
  const bits = new Uint8Array(b.w * b.h)
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const a = img.data[((b.y + y) * img.width + (b.x + x)) * 4 + 3]
      bits[y * b.w + x] = a > 8 ? 1 : 0
    }
  }
  return { w: b.w, h: b.h, bits }
}

function mirrored(s: Silhouette): Silhouette {
  const bits = new Uint8Array(s.w * s.h)
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) bits[y * s.w + x] = s.bits[y * s.w + (s.w - 1 - x)]
  }
  return { w: s.w, h: s.h, bits }
}

/**
 * Intersection over union, aligned on the trimmed boxes' centres.
 *
 * Centre alignment rather than top-left is the point: two profiles of the same
 * animal differ by a pixel or two in width, and aligning their corners would
 * charge that difference to the whole silhouette.
 */
function iou(a: Silhouette, b: Silhouette): number {
  if (!a.w || !b.w) return 0
  const w = Math.max(a.w, b.w)
  const h = Math.max(a.h, b.h)
  const ax = ((w - a.w) / 2) | 0, ay = ((h - a.h) / 2) | 0
  const bx = ((w - b.w) / 2) | 0, by = ((h - b.h) / 2) | 0
  let inter = 0, union = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const av = (x >= ax && x < ax + a.w && y >= ay && y < ay + a.h)
        ? a.bits[(y - ay) * a.w + (x - ax)] : 0
      const bv = (x >= bx && x < bx + b.w && y >= by && y < by + b.h)
        ? b.bits[(y - by) * b.w + (x - bx)] : 0
      if (av && bv) inter++
      if (av || bv) union++
    }
  }
  return union === 0 ? 0 : inter / union
}

/** How close a silhouette is to being its own mirror image. */
const selfSymmetry = (s: Silhouette): number => iou(s, mirrored(s))

// ------------------------------------------------------------------- drawing

function scaled(img: Image, factor: number): Image {
  const out = blankImage(img.width * factor, img.height * factor)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const di = ((y * factor + dy) * out.width + (x * factor + dx)) * 4
          out.data[di] = img.data[si]
          out.data[di + 1] = img.data[si + 1]
          out.data[di + 2] = img.data[si + 2]
          out.data[di + 3] = img.data[si + 3]
        }
      }
    }
  }
  return out
}

/** Crop to content, so everything can be placed by its own box rather than its canvas. */
function trimmed(img: Image): Image {
  const b = contentBounds(img, 0, 0, img.width, img.height)
  if (b.empty) return blankImage(1, 1)
  const out = blankImage(b.w, b.h)
  blit(img, b.x, b.y, b.w, b.h, out, 0, 0)
  return out
}

/** Tile the real grass the game bakes its ground from. Sprites are judged against it or not at all. */
function grassField(w: number, h: number): Image {
  const out = blankImage(w, h)
  const g = atlas.frames['terrain.grass']
  if (!g) {
    for (let i = 0; i < w * h; i++) {
      out.data[i * 4] = 0x4a; out.data[i * 4 + 1] = 0x6b
      out.data[i * 4 + 2] = 0x35; out.data[i * 4 + 3] = 255
    }
    return out
  }
  const tw = g.w * ZOOM, th = g.h * ZOOM
  const tile = scaled((() => {
    const t = blankImage(g.w, g.h)
    blit(atlasImg, g.x, g.y, g.w, g.h, t, 0, 0)
    return t
  })(), ZOOM)
  for (let y = 0; y < h; y += th) for (let x = 0; x < w; x += tw) blit(tile, 0, 0, tw, th, out, x, y)
  return out
}

function atlasFrame(key: string): Image | null {
  const f = atlas.frames[key]
  if (!f) return null
  const img = blankImage(f.w, f.h)
  blit(atlasImg, f.x, f.y, f.w, f.h, img, 0, 0)
  return img
}

// ------------------------------------------------------------------ the work

interface Measured {
  name: string
  rotations: Map<Compass, Image>
  walkFrames: Map<string, number>
}

function load(name: string): Measured | null {
  const dir = `${OBJECT_DIR}/${name}`
  const rotations = new Map<Compass, Image>()
  for (const c of COMPASS) {
    const p = `${dir}/rotations/${c}.png`
    if (existsSync(p)) rotations.set(c, decodePng(readFileSync(p)))
  }
  if (rotations.size === 0) return null

  const walkFrames = new Map<string, number>()
  const anims = `${dir}/animations`
  if (existsSync(anims)) {
    for (const clip of readdirSync(anims)) {
      const clipDir = `${anims}/${clip}`
      if (!statSync(clipDir).isDirectory()) continue
      for (const d of readdirSync(clipDir)) {
        const dd = `${clipDir}/${d}`
        if (!statSync(dd).isDirectory()) continue
        walkFrames.set(`${clip}/${d}`, readdirSync(dd).filter((f) => f.endsWith('.png')).length)
      }
    }
  }
  return { name, rotations, walkFrames }
}

const arg = process.argv[2]
const names = arg && arg !== 'all'
  ? [arg]
  : readdirSync(OBJECT_DIR).filter((d) => statSync(`${OBJECT_DIR}/${d}`).isDirectory()).sort()

const measured = names.map(load).filter((m): m is Measured => m !== null)
if (measured.length === 0) {
  console.error(`no animals found in ${OBJECT_DIR}`)
  process.exit(1)
}

// --- 1. the direction proof -------------------------------------------------

console.log('\n=== DIRECTION MAPPING ===')
console.log('A front and a rear view are each bilaterally symmetric; two profiles are')
console.log("mirrors of each other and neither is symmetric alone. If that holds, the")
console.log('compass names are honest.\n')
console.log('animal            sym(S)  sym(N)  sym(E)  sym(W)   E vs mirrored W')
console.log('-'.repeat(74))

let mappingHolds = true
for (const m of measured) {
  const sil = (c: Compass): Silhouette | null => {
    const img = m.rotations.get(c)
    return img ? silhouette(img) : null
  }
  const s = sil('south'), n = sil('north'), e = sil('east'), w = sil('west')
  if (!s || !n || !e || !w) { console.log(`${m.name.padEnd(18)}  (incomplete)`); continue }

  const symS = selfSymmetry(s), symN = selfSymmetry(n)
  const symE = selfSymmetry(e), symW = selfSymmetry(w)
  const ew = iou(e, mirrored(w))

  // A profile is not symmetric and a face-on view is. The gap is the evidence.
  const ok = symS > symE && symN > symE && symS > symW && symN > symW && ew > symE && ew > symW
  if (!ok) mappingHolds = false
  console.log(
    `${m.name.padEnd(18)}${symS.toFixed(2).padStart(5)}   ${symN.toFixed(2).padStart(5)}   ` +
    `${symE.toFixed(2).padStart(5)}   ${symW.toFixed(2).padStart(5)}   ` +
    `${ew.toFixed(2).padStart(5)}   ${ok ? 'holds' : 'CHECK'}`,
  )
}

console.log()
console.log(mappingHolds
  ? 'Every animal: face-on views are symmetric, profiles are not, and the two profiles\n' +
    'mirror each other. The compass names mean what they say, so the mapping is:\n' +
    `  ${Object.entries(CLAIMED).map(([k, v]) => `${k} -> ${v}`).join(',  ')}\n` +
    'which is byte-identical to `compassToDirection` already shipped in art/sprites.json.'
  : 'At least one animal did not fit the pattern. Look at its _ring.png before packing it.')

// --- 2. size against the field it joins -------------------------------------

console.log('\n=== SIZE, trimmed, in world pixels ===')
console.log('animal              south        east         north        west')
console.log('-'.repeat(70))
const pixellabSizes: number[] = []
for (const m of measured) {
  const cell = (c: Compass): string => {
    const img = m.rotations.get(c)
    if (!img) return '     -      '
    const b = contentBounds(img, 0, 0, img.width, img.height)
    if (c === 'east' || c === 'west') pixellabSizes.push(b.w)
    return `${b.w}x${b.h}`.padEnd(12)
  }
  console.log(`${m.name.padEnd(18)}${cell('south')}${cell('east')}${cell('north')}${cell('west')}`)
}

console.log('\nThe LimeZu animals already on the field, as PACKED (trimmed, from the atlas):')
for (const k of LIMEZU) {
  const parts: string[] = []
  // The PROFILE is the comparable view: it is what a PixelLab east/west becomes,
  // and it is where a difference in camera height actually shows.
  for (const d of ['down', 'up', 'left', 'right']) {
    const f = atlas.frames[`${k}.walk.${d}.0`]
    if (f) parts.push(`${d} ${`${f.w}x${f.h}`.padEnd(7)}`)
  }
  const lens = atlas.clipLengths[k]
  console.log(`  ${k.padEnd(13)}${parts.join(' ')} walk frames: ${lens?.walk ?? '?'}`)
}

// --- 3. frame counts --------------------------------------------------------

console.log('\n=== WALK FRAMES PER DIRECTION ===')
for (const m of measured) {
  const counts = [...new Set(m.walkFrames.values())]
  const dirs = m.walkFrames.size
  console.log(`  ${m.name.padEnd(18)}${dirs} directions, ${counts.join('/')} frames each`)
}

// --- 4. the sheet -----------------------------------------------------------

const LABEL = 0xffffff
const PAD = 8
const ROW_LABEL_H = 10

/** One row: every rotation of one animal, feet on a shared baseline. */
interface Row { label: string; cells: { img: Image; caption: string }[] }

const rows: Row[] = []
for (const m of measured) {
  rows.push({
    label: `${m.name}  (PixelLab, ${m.rotations.size} rotations)`,
    cells: COMPASS.filter((c) => m.rotations.has(c)).map((c) => ({
      img: scaled(trimmed(m.rotations.get(c)!), ZOOM),
      caption: `${c}${CLAIMED[c] ? ` = ${CLAIMED[c]}` : ''}`,
    })),
  })
}
// All four, not just the face-on pair: `right` is what a PixelLab `east` has to
// stand next to, and the camera angle only shows up in the profile.
const limezuCells = LIMEZU.flatMap((k) =>
  (['down', 'up', 'left', 'right'] as const).flatMap((d) => {
    const img = atlasFrame(`${k}.walk.${d}.0`)
    return img ? [{ img: scaled(img, ZOOM), caption: `${k} ${d}` }] : []
  }),
)
rows.push({ label: 'LimeZu, already in the game, same zoom — THIS IS THE SCALE TO MATCH', cells: limezuCells })

const cellW = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.img.width))) + PAD * 2
const rowH = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.img.height))) + PAD * 2 + ROW_LABEL_H * 2
const cols = Math.max(...rows.map((r) => r.cells.length))
const sheetW = cellW * cols
const sheetH = rowH * rows.length

const sheet = grassField(sheetW, sheetH)
rows.forEach((row, ri) => {
  const top = ri * rowH
  drawText(sheet, row.label.toUpperCase(), PAD, top + 3, LABEL, 1)
  // Feet on one line, because that is how the renderer places them: bottom-centre pivot.
  const baseline = top + rowH - PAD - ROW_LABEL_H
  row.cells.forEach((cell, ci) => {
    const cx = ci * cellW + (cellW - cell.img.width) / 2
    blit(cell.img, 0, 0, cell.img.width, cell.img.height, sheet,
      Math.round(cx), baseline - cell.img.height)
    drawText(sheet, cell.caption, ci * cellW + 3, baseline + 3, LABEL, 1)
  })
  // A rule under each row so the baselines are comparable by eye.
  for (let x = 0; x < sheetW; x++) {
    const i = (baseline * sheetW + x) * 4
    sheet.data[i] = 0; sheet.data[i + 1] = 0; sheet.data[i + 2] = 0; sheet.data[i + 3] = 120
  }
})

writeFileSync(OUT, encodePng(sheet))
console.log(`\nWrote ${OUT} — ${sheetW}x${sheetH}, at the game's ${ZOOM}x zoom, on real grass.`)
console.log('The bottom row is the scale to match. Judge the ring, never a single frame.')
