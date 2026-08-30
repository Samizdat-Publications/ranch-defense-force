/**
 * Turn a PixelLab OBJECT's walk clip into a horizontal strip the home scene
 * can mount.
 *
 *     npm run objstrip -- <object> <compass> <name> [--clip <slug>] [--skip0]
 *
 * ## Why this exists rather than `npm run anim`
 *
 * `npm run anim` downloads an `animate_image` job from the API. **The PixelLab
 * account is cancelled**, so nothing new can be fetched — but a dozen objects
 * were pulled down before it lapsed and each one holds a full walk as
 * `animations/<clip>/<compass>/frame_NNN.png`. That is the same picture the
 * scene wants, in the wrong shape. This is the shape change, offline.
 *
 * ## The registration rule, which is the whole tool
 *
 * `pixellab-anim.ts` composites each frame BOTTOM-CENTRED on a cell taken from
 * the largest frame, because an `animate_image` job returns ragged frames.
 * **Doing that here would be a bug.** Every frame of a PixelLab object walk is
 * already drawn on one shared canvas — 56x56 or 68x68, verified per object —
 * so the generator has already registered them. Re-registering on content
 * bounds is exactly the bobbing bug NOTES session 12 records: a mid-stride pose
 * is shorter than a standing one, so bottom-centring each frame separately
 * makes the animal rise and fall by the swing of its own legs.
 *
 * So frames are concatenated RAW, and the only thing measured is a SINGLE crop
 * rectangle — the union of every frame's content — applied identically to every
 * cell. Identical crop, identical registration, and no dead margin around a
 * small animal in a large canvas.
 *
 * ## What it prints is what you type into scene.ts
 *
 * The cell size and frame count go straight into an `actor()` call, and the
 * printed baseline is how far the lowest foot sits above the cell's bottom
 * edge — which is 0 by construction, and stated so the placement arithmetic in
 * scene.ts has a number to cite rather than an assumption.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { blankImage, blit, contentBounds, decodePng, encodePng, type Image } from './png.ts'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i < 0 ? undefined : argv[i + 1]
}
const skip0 = argv.includes('--skip0')
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--clip')
const [object, compass, name] = positional

if (!object || !compass || !name) {
  console.error('usage: npm run objstrip -- <object> <compass> <name> [--clip <slug>] [--skip0]')
  process.exit(1)
}

const animRoot = `assets/pixellab/object/${object}/animations`
if (!existsSync(animRoot)) {
  console.error(`no animations for ${object} — looked in ${animRoot}`)
  process.exit(1)
}

// The clip folder is named from the animation DESCRIPTION, never from the
// display name passed to animate_object. Defaulting to the only one present is
// right for every object here and fails loudly the moment one has two.
const clips = readdirSync(animRoot)
const clip = flag('--clip') ?? (clips.length === 1 ? clips[0] : undefined)
if (!clip) {
  console.error(`${object} has ${clips.length} clips; name one with --clip:\n  ${clips.join('\n  ')}`)
  process.exit(1)
}

const dir = `${animRoot}/${clip}/${compass}`
if (!existsSync(dir)) {
  console.error(`no ${compass} in ${clip} — have: ${readdirSync(`${animRoot}/${clip}`).join(', ')}`)
  process.exit(1)
}

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
const frames: Image[] = files.map((f) => decodePng(readFileSync(`${dir}/${f}`)))
const used = skip0 ? frames.slice(1) : frames

if (used.length === 0) {
  console.error(`no frames in ${dir}`)
  process.exit(1)
}

const canvasW = used[0].width
const canvasH = used[0].height
const ragged = used.find((f) => f.width !== canvasW || f.height !== canvasH)
if (ragged) {
  // The premise of the raw concatenation above. If it ever fails, the frames
  // are not registered and this tool is the wrong one — say so rather than
  // silently producing a walk that slides.
  console.error(`frames are not on one canvas (${canvasW}x${canvasH} vs ${ragged.width}x${ragged.height}) — bail`)
  process.exit(1)
}

// ONE crop for every frame: the union of all their content. Per-frame bounds is
// the bobbing bug; this is the fix.
let x0 = canvasW, y0 = canvasH, x1 = -1, y1 = -1
for (const f of used) {
  const b = contentBounds(f, 0, 0, f.width, f.height)
  if (b.empty) continue
  x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
  x1 = Math.max(x1, b.x + b.w - 1); y1 = Math.max(y1, b.y + b.h - 1)
}
if (x1 < 0) {
  console.error(`every frame of ${object}/${compass} is empty`)
  process.exit(1)
}
const cellW = x1 - x0 + 1
const cellH = y1 - y0 + 1

const strip = blankImage(cellW * used.length, cellH)
used.forEach((f, i) => blit(f, x0, y0, cellW, cellH, strip, i * cellW, 0))
mkdirSync('assets/scene', { recursive: true })
writeFileSync(`assets/scene/${name}_strip.png`, encodePng(strip))

// The same strip on flat grey, because a transparent pixel and a dark pixel are
// the same thing on a dark page and the failure mode of a generated walk is one
// frame belonging to a different animal — invisible alone, obvious in a row.
const contact = blankImage(strip.width, strip.height)
for (let i = 0; i < contact.width * contact.height; i++) {
  contact.data[i * 4] = 0x55
  contact.data[i * 4 + 1] = 0x55
  contact.data[i * 4 + 2] = 0x55
  contact.data[i * 4 + 3] = 0xff
}
blit(strip, 0, 0, strip.width, strip.height, contact, 0, 0)
const outDir = `assets/pixellab/anim/${name}`
mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/_contact.png`, encodePng(contact))

console.log(
  `${object}/${clip}/${compass} -> assets/scene/${name}_strip.png\n` +
  `  ${used.length} frames, cell ${cellW}x${cellH}, cropped from ${canvasW}x${canvasH} at (${x0},${y0})\n` +
  `  scene.ts:  actor('scene.${name}Strip', x, y, ${cellW}, ${cellH}, ${used.length}, dur, zoom)`,
)
