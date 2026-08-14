/**
 * Composes character sheets from the Farmer Generator's layer pieces.
 *
 *   npm run characters
 *
 * The design says a new class is "one Farmer Generator export plus a stat block
 * and one ability", and treated that export as a manual step — which is what
 * blocked the Bunkhouse: the ladder was built and priced with nothing to sell,
 * because adding a class meant leaving the codebase, opening a generator, and
 * exporting a PNG by hand.
 *
 * It does not have to be manual. Every piece in `Character Pieces/` is a full
 * 1792x704 sheet in the same rig the atlas builder already reads, so a
 * character is just those sheets alpha-composited in the right order. A class
 * becomes a recipe in `art/characters.json` — five strings — and the art is
 * generated, reproducible, and diffable like everything else.
 *
 * Output goes to `assets/generated/characters/`, which is where the manual
 * exports already live and which never ships; only the packed atlas does.
 *
 * Layer order is fixed and matters: skin, then eyes, then clothes over the
 * body, then hair over the collar, then a hat over the hair. Any other order
 * puts a hat under a fringe.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { decodePng, encodePng, type Image } from './png.ts'

const PIECES = 'assets/modern-farm/Farmer_Generator_Pieces/Character Pieces'
const OUT_DIR = 'assets/generated/characters'
const SHEET_W = 1792
const SHEET_H = 704

/** Layer order, outermost last. Renaming these renames the recipe keys. */
const LAYERS = [
  { key: 'body', dir: 'Bodies', prefix: 'Body_' },
  { key: 'eyes', dir: 'Eyes', prefix: 'Eyes_' },
  { key: 'outfit', dir: 'Outfits', prefix: 'Outfit_' },
  { key: 'hair', dir: 'Hairstyles', prefix: 'Hairstyle_' },
  { key: 'accessory', dir: 'Accessories', prefix: 'Accessory_' },
] as const

type Recipe = Partial<Record<(typeof LAYERS)[number]['key'], string>>

interface Manifest {
  _note?: string
  characters: Record<string, Recipe>
}

/** Straight alpha-over of `src` onto `dst`, both full sheets, same size. */
function over(dst: Image, src: Image): void {
  for (let i = 0; i < dst.data.length; i += 4) {
    const a = src.data[i + 3]
    if (a === 0) continue
    if (a === 255) {
      dst.data[i] = src.data[i]
      dst.data[i + 1] = src.data[i + 1]
      dst.data[i + 2] = src.data[i + 2]
      dst.data[i + 3] = 255
      continue
    }
    // The pieces are pixel art and very nearly binary alpha, but the odd
    // feathered edge exists; blending it is cheaper than explaining a fringe.
    const sa = a / 255
    const da = dst.data[i + 3] / 255
    const outA = sa + da * (1 - sa)
    for (let c = 0; c < 3; c++) {
      dst.data[i + c] = Math.round(
        (src.data[i + c] * sa + dst.data[i + c] * da * (1 - sa)) / (outA || 1),
      )
    }
    dst.data[i + 3] = Math.round(outA * 255)
  }
}

function loadLayer(dir: string, prefix: string, name: string, id: string): Image {
  const path = `${PIECES}/${dir}/32x32/${prefix}${name}.png`
  if (!existsSync(path)) {
    throw new Error(
      `${id}: no such piece "${name}" in ${dir}.\n  looked for ${path}`,
    )
  }
  const img = decodePng(readFileSync(path))
  // The same assertion the atlas builder makes, made earlier. A 16px piece is
  // the same shape as a 32px one and would compose into a half-size character
  // with no other symptom.
  if (img.width !== SHEET_W || img.height !== SHEET_H) {
    throw new Error(
      `${path}: expected ${SHEET_W}x${SHEET_H}, got ${img.width}x${img.height} — `
      + 'this is the 16x16 piece set; use the 32x32 one.',
    )
  }
  return img
}

function compose(id: string, recipe: Recipe): Image {
  let sheet: Image | null = null
  for (const layer of LAYERS) {
    const name = recipe[layer.key]
    if (!name) continue
    const img = loadLayer(layer.dir, layer.prefix, name, id)
    if (!sheet) sheet = img
    else over(sheet, img)
  }
  if (!sheet) throw new Error(`${id}: recipe has no layers`)
  return sheet
}

const manifest = JSON.parse(readFileSync('art/characters.json', 'utf8')) as Manifest
const entries = Object.entries(manifest.characters).filter(([k]) => !k.startsWith('_'))

mkdirSync(OUT_DIR, { recursive: true })
const errors: string[] = []

for (const [id, recipe] of entries) {
  try {
    const sheet = compose(id, recipe)
    const path = `${OUT_DIR}/${id}.png`
    writeFileSync(path, encodePng(sheet))
    const parts = LAYERS.map((l) => recipe[l.key]).filter(Boolean).join(' + ')
    console.log(`  ${id.padEnd(14)} ${parts}`)
  } catch (e) {
    errors.push((e as Error).message)
  }
}

if (errors.length) {
  console.error(`\n${errors.length} character(s) failed:\n  ${errors.join('\n  ')}\n`)
  process.exit(1)
}
console.log(`\n${entries.length} character sheets -> ${OUT_DIR}/`)
