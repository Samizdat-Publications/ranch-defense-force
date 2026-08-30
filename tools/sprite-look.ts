/**
 * Put sprites side by side on flat grey, at an integer zoom, so they can be
 * LOOKED AT.
 *
 *     npm run look -- <a.png|atlas:frame.name> ... [--zoom 6] [--conform] [--tile 6] [--out f.png]
 *
 * An input of the form `atlas:prizeBull.walk.left.2` is cut out of the PACKED
 * atlas rather than read off disk. That is the only way to check what actually
 * SHIPPED, as opposed to what the source file looks like — the two differ by a
 * conform, a trim and a compass mapping, and every one of those has been wrong
 * at some point in this project.
 *
 * `--conform` appends the house-palette version of every input after the raw
 * ones, which is the other half of the same question.
 *
 * `--tile N` repeats each input N by N. **This is the only honest test of a
 * ground tile**, and it has now decided two of them. A 32px tile judged alone
 * looks like texture; the same tile repeated across a field turns its mottling
 * into a visible grid of identical marks, and that is what the eye reads at
 * play zoom. `grass_to_gravel_v2` looked like plausible gravel as one tile and
 * tiled into a column of repeated grey glyphs that read as printed characters.
 * The same failure rejected `dirt_to_grass` for the base in session 12.
 *
 * ## Why this is a tool and not a one-off
 *
 * Two faults in session 14 were invisible in every other check and obvious the
 * moment two images were put next to each other:
 *
 * 1. **`rotations/west.png` faces LEFT on the dog, the pony, the donkey, the
 *    arabian and the mule — and RIGHT on the bull.** The generator did not hold
 *    one convention. Nothing downstream could catch it: the renderer never
 *    mirrors, so `prizeBull` charged left showing a bull pointed right, and it
 *    read as a sliding model rather than as an error. The silhouette-IoU check
 *    the compass mapping was signed off with proves east mirrors west — true of
 *    all of them — and says NOTHING about which way either faces.
 *
 * 2. **The conform pass deletes the LimeZu hen's comb and wattle.** The palette
 *    has no saturated red at that value, so it quantises into the body brown
 *    and the bird loses its face. Same family as the ore tier that went missing
 *    in session 13.
 *
 * Neither is a crash, a type error or a failing test. Both are one glance.
 *
 * Grey, not transparent: on a dark page a transparent pixel and a dark pixel
 * look identical, and a sprite standing on baked-in ground is the failure this
 * is most often used to find.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { blankImage, blit, decodePng, encodePng, type Image } from './png.ts'
import { loadPalette, makeQuantiser } from './conform-fx.ts'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const opt = (n: string, d: string): string => {
  const i = argv.indexOf(n)
  return i < 0 ? d : (argv[i + 1] ?? d)
}
const zoom = Math.max(1, Math.round(Number(opt('--zoom', '5'))))
const tileN = Math.max(1, Math.round(Number(opt('--tile', '1'))))
const out = opt('--out', 'sprite-look.png')
const withConform = argv.includes('--conform')
const files = argv.filter((a, i) =>
  !a.startsWith('--') && argv[i - 1] !== '--zoom'
  && argv[i - 1] !== '--out' && argv[i - 1] !== '--tile')

if (files.length === 0) {
  console.error('usage: npm run look -- <a.png|atlas:frame.name> ... [--zoom 6] [--conform] [--tile 6] [--out f.png]')
  process.exit(1)
}

/** `atlas:<frame>` cuts from public/atlas.png; anything else is a file path. */
function load(spec: string): Image {
  if (!spec.startsWith('atlas:')) return decodePng(readFileSync(spec))
  const name = spec.slice(6)
  const sheet = decodePng(readFileSync('public/atlas.png'))
  const meta = JSON.parse(readFileSync('public/atlas.json', 'utf8'))
  const f = (meta.frames ?? meta)[name]
  if (!f) throw new Error(`${name}: not in the packed atlas. Run npm run atlas?`)
  const cut = blankImage(f.w, f.h)
  blit(sheet, f.x, f.y, f.w, f.h, cut, 0, 0)
  return cut
}

/** Repeat an image N by N, so its own motif becomes visible as a grid. */
function tiled(img: Image, n: number): Image {
  if (n <= 1) return img
  const out = blankImage(img.width * n, img.height * n)
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) blit(img, 0, 0, img.width, img.height, out, tx * img.width, ty * img.height)
  }
  return out
}

const raw: Image[] = files.map((f) => tiled(load(f), tileN))
const shown: Image[] = [...raw]
if (withConform) {
  const q = makeQuantiser(loadPalette())
  for (const img of raw) {
    const copy: Image = { width: img.width, height: img.height, data: Buffer.from(img.data) }
    q.conform(copy)
    shown.push(copy)
  }
}

const pad = 4
const cellW = Math.max(...shown.map((i) => i.width))
const cellH = Math.max(...shown.map((i) => i.height))
const sheet = blankImage((cellW + pad) * shown.length + pad, cellH + pad * 2)
for (let i = 0; i < sheet.width * sheet.height; i++) {
  sheet.data[i * 4] = 0x55; sheet.data[i * 4 + 1] = 0x55
  sheet.data[i * 4 + 2] = 0x55; sheet.data[i * 4 + 3] = 0xff
}
// Bottom-aligned, so animals of different heights stand on one line.
shown.forEach((im, i) => blit(
  im, 0, 0, im.width, im.height,
  sheet, pad + i * (cellW + pad) + Math.floor((cellW - im.width) / 2), pad + (cellH - im.height),
))

const big = blankImage(sheet.width * zoom, sheet.height * zoom)
for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) {
  const s = (Math.floor(y / zoom) * sheet.width + Math.floor(x / zoom)) * 4
  const d = (y * big.width + x) * 4
  big.data[d] = sheet.data[s]; big.data[d + 1] = sheet.data[s + 1]
  big.data[d + 2] = sheet.data[s + 2]; big.data[d + 3] = sheet.data[s + 3]
}
writeFileSync(out, encodePng(big))
console.log(
  `${out} ${big.width}x${big.height} — ${files.length} sprite(s)` +
  (withConform ? ', raw then conformed' : '') + `\n  ${files.join('\n  ')}`,
)
