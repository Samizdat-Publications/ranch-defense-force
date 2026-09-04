/**
 * Composite a cave web over an existing sprite, offline and free.
 *
 *     npm run webbed -- <web.png> <base.png> <out.png> <x> <y> <w> <h> [flip]
 *
 * ## Why this rather than generating webbed variants
 *
 * Five webs were generated, packed as `cave.web0..5`, and drawn by nothing for
 * two sessions -- sixteen rows of the ledger's open queue, the largest single
 * group in it. `art/sprites.json` had already worked out why: they are
 * CORNER-ANCHORED and they are not overhead art. Hung in the air they read as
 * floating rags. A web belongs ON something, in the angle between two surfaces,
 * and the breakable-variant system already expresses exactly that -- a class
 * holds a list of skins and a map may replace it.
 *
 * What was missing was the webbed variants themselves, and generating them
 * would have been paying twice for art the account already holds. This makes
 * them out of the two halves that exist. Deterministic, offline, no key, no
 * credits.
 *
 * ## The one rule it obeys
 *
 * NOTHING IS RESAMPLED. The webs are 64x64 and the things they go on are 32x45
 * and 48x48; the obvious move is to scale the web down to fit, and it is the
 * move this repo does not make -- a non-integer resample of pixel art lies
 * about the grid it was drawn on, which is the same argument that stops
 * carried weapons being enlarged past their source. So a RECTANGLE of the web
 * is cut at 1:1 and placed in a corner of the base, which is also the truer
 * picture: what you want on a crate is the corner of a web, not a whole web
 * shrunk to crate size.
 *
 * `flip` mirrors the cut horizontally, so one corner-anchored web makes both a
 * left-hand and a right-hand variant. `a=<0..1>` scales the web's alpha: the
 * generated webs are drawn as a subject on their own and are dense enough at
 * full strength to read as a white patch pasted over a 32px drum. A web on
 * something is mostly the thing, with strands across it.
 *
 * Straight source-over alpha, and the base's own alpha is preserved where the
 * web is transparent -- so a web that overhangs the silhouette stays inside the
 * canvas and does not grow the sprite's box, which would move its pivot.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decodePng, encodePng } from './png.ts'

const a = process.argv.slice(2).filter((v) => v !== '--')
if (a.length < 7) {
  console.error('usage: npm run webbed -- <web.png> <base.png> <out.png> <x> <y> <w> <h> [flip]')
  process.exit(1)
}
const [webPath, basePath, outPath] = a
const dx = Number(a[3]); const dy = Number(a[4])
const cw = Number(a[5]); const ch = Number(a[6])
const flip = a.includes('flip')
const alphaScale = Number(a.find((v) => v.startsWith('a='))?.slice(2) ?? 1)

const web = decodePng(readFileSync(webPath!))
const img = decodePng(readFileSync(basePath!))

let laid = 0
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const sx = flip ? cw - 1 - x : x
    if (sx < 0 || sx >= web.width || y >= web.height) continue
    const s = (y * web.width + sx) * 4
    const alpha = (web.data[s + 3]! / 255) * alphaScale
    if (alpha <= 0.02) continue
    const tx = dx + x; const ty = dy + y
    if (tx < 0 || ty < 0 || tx >= img.width || ty >= img.height) continue
    const d = (ty * img.width + tx) * 4
    const da = img.data[d + 3]! / 255
    const outA = alpha + da * (1 - alpha)
    for (let c = 0; c < 3; c++) {
      img.data[d + c] = Math.round(
        (web.data[s + c]! * alpha + img.data[d + c]! * da * (1 - alpha)) / (outA || 1),
      )
    }
    img.data[d + 3] = Math.round(outA * 255)
    laid++
  }
}

writeFileSync(outPath!, encodePng(img))
console.log(
  `  ${basename(outPath!)}: ${basename(webPath!)} ${cw}x${ch}${flip ? ' flipped' : ''}`
  + ` onto ${basename(basePath!)} at ${dx},${dy} at alpha ${alphaScale} -- ${laid}px laid`,
)
