/**
 * The carried weapons, at 4x, beside the man who carries them.
 *
 *     npm run carrysheet -- [out.png]
 *
 * Scale is the whole question this answers, and it is not a question a source
 * PNG can answer: `gun.rifle.0` is a perfectly good rifle at 22x7 and is still
 * wrong, because it was drawn to be held by a 32px character and ours is 52.
 * The only way to see that is to put the weapon next to the man at the same
 * zoom, which is what this does — out of the PACKED atlas, so it proves the
 * manifest entry and the frame key too, the way `npm run contact` does.
 *
 * One row per weapon: the old bundled `gun.*` sheet frame on the left, the
 * purpose-drawn `carry.*` frame on the right, the farmhand standing beside
 * both at the same 4x. The gap between the two columns IS the finding.
 */
import { writeFileSync } from 'node:fs'
import { encodePng, blankImage, blit } from './png.ts'
import { readAtlas } from './atlas-read.ts'
import { drawText } from './tinyfont.ts'

const out = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'docs/progress/carry-scale.png'

const atlas = readAtlas()

/** weapon id, the sheet frame it used to draw, the frame it draws now. */
const ROWS: [string, string, string][] = [
  ['scattergun', 'gun.shotgun.0', 'carry.scattergun'],
  ['varmintRifle', 'gun.rifle.0', 'carry.varmintRifle'],
  ['grenadeLauncher', 'gun.carbine.0', 'carry.grenadeLauncher'],
  ['drumGun', 'gun.lmg.0', 'carry.drumGun'],
  ['tarBomb', 'gun.smg.0', 'carry.tarBomb'],
  ['harpoon', 'gun.pistol.0', 'carry.harpoon'],
]

const ZOOM = 4
const PAD = 10
const COL = 34 * ZOOM + PAD * 2
const MAN = 'hand.idle.right.0'

const man = atlas.frames[MAN]
if (!man) throw new Error(`no ${MAN} in the atlas — run npm run atlas`)

// A row is as tall as the MAN, because he is the ruler. Sizing it to the
// weapons is how the first version of this sheet overlapped every row and
// hid the one measurement it exists to show.
const ROW_H = man.h * ZOOM + PAD * 3

const width = PAD + man.w * ZOOM + PAD + COL * 2 + PAD
const height = PAD + ROWS.length * ROW_H + PAD
const img = blankImage(width, height)

// A flat mid-grey ground so a dark outline and a light one are both readable.
for (let i = 0; i < img.data.length; i += 4) {
  img.data[i] = 0x3a; img.data[i + 1] = 0x40; img.data[i + 2] = 0x38; img.data[i + 3] = 0xff
}

/** Nearest-neighbour blit at an integer zoom — the only honest way to enlarge. */
function drawZoomed(key: string, dx: number, dy: number): boolean {
  const f = atlas.frames[key]
  if (!f) return false
  const src = atlas.imageFor(f)
  const one = blankImage(f.w, f.h)
  blit(src, f.x, f.y, f.w, f.h, one, 0, 0)
  for (let y = 0; y < f.h * ZOOM; y++) {
    for (let x = 0; x < f.w * ZOOM; x++) {
      const si = ((y / ZOOM | 0) * f.w + (x / ZOOM | 0)) * 4
      if (one.data[si + 3] === 0) continue
      const px = dx + x
      const py = dy + y
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue
      const di = (py * img.width + px) * 4
      img.data[di] = one.data[si]
      img.data[di + 1] = one.data[si + 1]
      img.data[di + 2] = one.data[si + 2]
      img.data[di + 3] = 0xff
    }
  }
  return true
}

for (let r = 0; r < ROWS.length; r++) {
  const [id, oldKey, newKey] = ROWS[r]
  const top = PAD + r * ROW_H

  // The man, once per row, so every weapon is measured against him and not
  // against the weapon above it.
  drawZoomed(MAN, PAD, top + PAD * 2)

  const x0 = PAD + man.w * ZOOM + PAD
  drawText(img, id.toUpperCase(), x0, top, 0xd8d0c0, 2)

  const oldF = atlas.frames[oldKey]
  const newF = atlas.frames[newKey]
  const label = (k: string, f: { w: number; h: number } | undefined): string =>
    f ? `${k} ${f.w}x${f.h}` : `${k} MISSING`

  drawText(img, label(oldKey, oldF).toUpperCase(), x0, top + 14, 0x9a9080, 1)
  drawText(img, label(newKey, newF).toUpperCase(), x0 + COL, top + 14, 0x9a9080, 1)

  // Both columns hang from the same line, roughly where a hand would be, so
  // the two sprites are compared against each other and against his hip.
  const hand = top + PAD * 2 + Math.round(man.h * ZOOM * 0.45)
  if (oldF) drawZoomed(oldKey, x0, hand)
  if (newF) drawZoomed(newKey, x0 + COL, hand)
}

writeFileSync(out, encodePng(img))
console.log(`${out}  ${img.width}x${img.height}  ${ROWS.length} weapons at ${ZOOM}x`)
