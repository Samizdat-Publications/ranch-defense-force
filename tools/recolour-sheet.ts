/**
 * Repaint a generated character sheet into the blight palette, offline and free.
 *
 *     npm run recolour -- <srcDir> <outDir>            # write the sheet
 *     npm run recolour -- <srcDir> <outDir> --report   # print the LUT, write nothing
 *     npm run recolour -- <srcDir> <outDir> --mask     # write family masks, for eyeballing
 *
 * ## Why this exists
 *
 * `farmhand` is the enemy the player sees more than anything else in a run, and
 * it wore the player's own clothes: the same straw hat, the same blue dungarees,
 * at the same 32x64. Session 20 and session 21 both filed it — "enemy humanoids
 * share the player's silhouette" — and it is not a cosmetic complaint. In a
 * bullet-heaven you find yourself by picking your own sprite out of a crowd, and
 * the density pass put 2.2x as many farmhands on the field.
 *
 * The obvious fix is to generate a new character. That costs generations, and
 * `docs/PIXELLAB_INVENTORY.md` says the account already holds three turned
 * farmhands, all three already claimed and packed (`farmhand`, `bloatedFarmhand`,
 * `acidZombie`). There is no unclaimed candidate that reads as clearly infected
 * AND is not already in the game. So the art we have gets repainted instead:
 * deterministic, re-runnable, zero generations, zero dependencies.
 *
 * ## What it does
 *
 * Every pixel is classified into a colour FAMILY by its Oklab hue and chroma,
 * and each family is re-ramped onto blight anchors taken from the cursed block
 * of `art/palette.json` (which exists for exactly this: "cursed art is grey-green
 * rot ... those greens must be DISTINCT from the healthy pasture greens").
 *
 * Classification is by colour and not by position, which is the whole reason
 * this is cheap: one rule set covers all 88 frames of a four-direction rig
 * (idle + walk 8 + hit 6 + death 7) without anyone hand-masking a hat.
 *
 * The families, and what each one is FOR:
 *
 *   straw   the hat, and the tan leather that goes with it. Sent to near-black
 *           rotted felt. This is the single most important mapping in the file:
 *           the straw brim is the player's signature read at 1x, and value --
 *           not hue -- is what survives a 32px sprite on a 520px camera.
 *   denim   the dungarees. Sent to a dark rot-green so the body stops being the
 *           player's blue.
 *   flesh   the warm red-browns: mouth, wounds, the blood on the shirt. Kept
 *           red but taken down, so gore still reads without going pink.
 *   pallor  everything neutral or already-green: skin, shirt, grime. Pushed
 *           UP in lightness and over into sick green. Deliberately the only
 *           family that gets brighter -- the resulting figure is a pale green
 *           head and hands on a dark body, which is the exact inverse of the
 *           player's bright hat on a dark body. Inversion reads at a glance
 *           where a hue change does not.
 *
 * Two things are never touched. Anything below `INK_L` is outline or shadow and
 * stays black -- re-ramping the outline is how a repaint turns into a smudge.
 * And anything above `GLOW_C` chroma at high lightness is the sickly yellow eye,
 * which is already the correct horror cue and the brightest thing on the sprite.
 *
 * ## Output
 *
 * Mirrors the source layout exactly -- same filenames, same 32x64 cells, same
 * strip widths -- so `art/sprites.json` needs only its `_base` path pointed at
 * the new directory and every clip, frame count and anchor still lines up.
 * Alpha is copied through untouched: this changes colour and nothing else, so
 * `npm run scale`, `npm run pens` and every measured offset stay true.
 *
 * Re-runnable: it reads the ORIGINAL sheet every time and never its own output,
 * so running it twice is not running it twice on itself.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, type Image } from './png.ts'
import { oklab } from './conform-fx.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [srcDir, outDir] = args.filter((a) => !a.startsWith('--'))
if (!srcDir || !outDir) {
  console.error('usage: npm run recolour -- <srcDir> <outDir> [--report] [--mask]')
  process.exit(1)
}

/** Below this Oklab lightness a pixel is outline or cast shadow. Never re-ramped. */
const INK_L = 0.14
/** At or above this chroma and lightness, a pixel is the sickly eye glow. Kept. */
const GLOW_C = 0.13
const GLOW_L = 0.8

type Family = 'straw' | 'denim' | 'flesh' | 'pallor'

/**
 * Oklab hue, in degrees. NOT the HSL wheel -- in Oklab straw sits near 80,
 * pasture green near 130, denim near 240 and blood near 25. Every boundary
 * below was read off the sheet's own census, not guessed.
 */
function classify(C: number, h: number): Family {
  if (h >= 195 && h < 305 && C >= 0.006) return 'denim'
  if ((h >= 330 || h < 40) && C >= 0.025) return 'flesh'
  if (h >= 40 && h < 108 && C >= 0.038) return 'straw'
  return 'pallor'
}

/** A three-stop ramp, shadow -> mid -> light, sampled by normalised lightness. */
type Ramp = [number, number, number][]

/*
   The blight anchors.

   Straw and denim both land DARKER than anything they replace, and pallor lands
   lighter. That is the point: the player is a light hat over a dark body, so the
   farmhand becomes a dark hat over a body that is darker still, with a pale
   green head. The two figures now differ in the arrangement of their values and
   not only in their hues, and value is what survives being 32 pixels tall.

   The greens are the cursed family out of art/palette.json -- [52,60,48],
   [82,94,62], [116,124,78] -- widened at both ends so a ramp has somewhere to
   go. They are deliberately far from the pasture greens in the same file.
*/
const RAMPS: Record<Family, Ramp> = {
  // Rotted felt. Brown-black, and kept a shade off the denim's green so a brim
  // still separates from a shoulder at 32 pixels.
  straw: [
    [18, 16, 13],
    [42, 38, 29],
    [72, 64, 48],
  ],
  // Rot-green work cloth where the dungarees were.
  denim: [
    [20, 26, 21],
    [42, 54, 40],
    [70, 86, 62],
  ],
  // Blood and mouth. Still red, taken down and dulled.
  flesh: [
    [34, 20, 20],
    [78, 40, 38],
    [126, 68, 58],
  ],
  /*
     Sick skin, and the only family that gets BRIGHTER than its source.

     Its shadow anchor is darker than the family's job needs, because `pallor`
     is also where every unclassifiable near-black grime pixel lands -- the
     sheet has eight of them sitting a hair above INK_L. Anchoring the ramp
     light enough for skin alone lifted those to a mid green and the figure
     picked up a rash of pale speckles. The span below reaches down to INK_L for
     the same reason: it gives the dark end somewhere to go instead of clamping.
  */
  pallor: [
    [44, 54, 38],
    [126, 142, 94],
    [190, 202, 144],
  ],
}

/**
 * Where in its ramp a source colour lands.
 *
 * Per-family so a family that occupies a narrow slice of the sheet's lightness
 * still uses its whole ramp. Fixed rather than measured, because measuring per
 * sheet would make two sheets recoloured by the same rules disagree.
 */
const SPAN: Record<Family, [number, number]> = {
  straw: [0.28, 0.80],
  denim: [0.26, 0.60],
  flesh: [0.25, 0.60],
  pallor: [INK_L, 0.78],
}

function rampAt(ramp: Ramp, t: number): [number, number, number] {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t
  const s = u * 2
  const i = s < 1 ? 0 : 1
  const f = s - i
  const a = ramp[i]
  const b = ramp[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

const MASK_COLOUR: Record<Family | 'ink' | 'glow', [number, number, number]> = {
  straw: [255, 200, 0],
  denim: [0, 120, 255],
  flesh: [255, 0, 80],
  pallor: [0, 220, 120],
  ink: [40, 40, 40],
  glow: [255, 255, 255],
}

interface Mapped {
  rgb: [number, number, number]
  family: Family | 'ink' | 'glow'
}

const lut = new Map<number, Mapped>()
const counts = new Map<number, number>()

function map(key: number): Mapped {
  const hit = lut.get(key)
  if (hit) return hit
  const r = (key >> 16) & 255
  const g = (key >> 8) & 255
  const b = key & 255
  const lab = oklab(r, g, b)
  const C = Math.hypot(lab.a, lab.b)
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  if (h < 0) h += 360

  let out: Mapped
  if (lab.L < INK_L) {
    out = { rgb: [r, g, b], family: 'ink' }
  } else if (C >= GLOW_C && lab.L >= GLOW_L) {
    out = { rgb: [r, g, b], family: 'glow' }
  } else {
    const family = classify(C, h)
    const [lo, hi] = SPAN[family]
    out = { rgb: rampAt(RAMPS[family], (lab.L - lo) / (hi - lo)), family }
  }
  lut.set(key, out)
  return out
}

const files = readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.png'))
if (!files.length) {
  console.error(`no PNGs in ${srcDir}`)
  process.exit(1)
}

const write = !flags.has('--report')
if (write) mkdirSync(outDir, { recursive: true })

let pixels = 0
for (const name of files) {
  const im = decodePng(readFileSync(`${srcDir}/${name}`))
  const dst: Image = { width: im.width, height: im.height, data: new Uint8Array(im.data.length) }
  for (let i = 0; i < im.data.length; i += 4) {
    const a = im.data[i + 3]
    dst.data[i + 3] = a
    if (a < 8) continue
    const key = (im.data[i] << 16) | (im.data[i + 1] << 8) | im.data[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
    pixels++
    const m = map(key)
    const rgb = flags.has('--mask') ? MASK_COLOUR[m.family] : m.rgb
    dst.data[i] = rgb[0]
    dst.data[i + 1] = rgb[1]
    dst.data[i + 2] = rgb[2]
  }
  if (write) writeFileSync(`${outDir}/${name}`, encodePng(dst))
}

const hex = (c: [number, number, number]) =>
  '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

const rows = [...counts].sort((a, b) => b[1] - a[1])
console.log(`${srcDir} -> ${write ? outDir : '(report only)'}`)
console.log(`  ${files.length} frames, ${pixels} opaque pixels, ${rows.length} source colours`)
const perFamily = new Map<string, number>()
for (const [key, n] of rows) perFamily.set(map(key).family, (perFamily.get(map(key).family) ?? 0) + n)
for (const [f, n] of [...perFamily].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(7)} ${((n / pixels) * 100).toFixed(1)}%`)
}
if (flags.has('--report')) {
  console.log('\n  source   ->  blight    family   share')
  for (const [key, n] of rows) {
    const m = map(key)
    const src = '#' + key.toString(16).padStart(6, '0')
    console.log(
      `  ${src}  ->  ${hex(m.rgb)}   ${m.family.padEnd(7)} ${((n / pixels) * 100).toFixed(2)}%`,
    )
  }
}
