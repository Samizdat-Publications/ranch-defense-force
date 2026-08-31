/**
 * Strip the opaque "card" background PixelLab returns on scene-scale assets.
 *
 *     npm run decard -- <file.png> [more.png ...]
 *     npm run decard -- --check <file.png> [more.png ...]     # report only
 *
 * **This is the free, offline half of `npm run rmbg`.** The API's
 * `remove-background` costs one generation per image and needs a live key;
 * this costs nothing and is deterministic. Prefer it whenever the card is a
 * flat fill, which is the shape the failure actually takes: at ~300px the
 * generator returns a framed illustration standing on a solid ground, and that
 * ground is one colour, opaque, and touching the border. Reach for `rmbg` only
 * when the background is textured or graded, which this tool will tell you by
 * refusing to make a confident cut.
 *
 * **Why it matters beyond the look.** A card is 100% opaque, so the alpha
 * content box equals the canvas, so `npm run scale` measures the CARD and not
 * the art. `vault.drumRank` is 253x58 of drums inside a 300x180 canvas; carded,
 * the scale table published it as 210x126 when the truth is 210x49 -- 2.6x too
 * tall. The card is a scale bug wearing a cosmetic bug's clothes.
 *
 * Method: 4-connected flood from every border pixel, matching the corner colour
 * within a tolerance, opaque pixels only. Only background-connected regions go;
 * a pixel of the same grey inside a drum is never reached. Enclosed pockets of
 * card colour that the flood cannot reach are counted and REPORTED rather than
 * removed, because a pocket is as likely to be a highlight as it is a gap.
 *
 * Verifies after writing rather than assuming the write worked, same contract
 * as `rmbg`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decodePng, encodePng } from './png.ts'

/** Colour distance tolerance for "this is the card". Chebyshev, 0-255. */
const TOLERANCE = 12
/** Below this share of the canvas, a border-connected region is art, not a card. */
const MIN_CARD_SHARE = 0.15

const args = process.argv.slice(2).filter((a) => a !== '--')
const checkOnly = args.includes('--check')
const files = args.filter((a) => a.endsWith('.png'))
if (!files.length) {
  console.error('usage: npm run decard -- [--check] <file.png> [more.png ...]')
  process.exit(1)
}

let wrote = 0
for (const path of files) {
  const name = basename(path)
  const img = decodePng(readFileSync(path))
  const { width: W, height: H, data } = img
  const at = (x: number, y: number) => (y * W + x) * 4

  const seed = [data[0], data[1], data[2], data[3]] as const
  if (seed[3] <= 8) { console.log(`  ${name}: already cut out (transparent corner)`); continue }

  const isCard = (i: number) =>
    data[i + 3] > 8 &&
    Math.abs(data[i] - seed[0]) <= TOLERANCE &&
    Math.abs(data[i + 1] - seed[1]) <= TOLERANCE &&
    Math.abs(data[i + 2] - seed[2]) <= TOLERANCE

  // Flood 4-connected from every border pixel.
  const card = new Uint8Array(W * H)
  const stack: number[] = []
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1)
  for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y)
  let cardPx = 0
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    if (x < 0 || y < 0 || x >= W || y >= H) continue
    const k = y * W + x
    if (card[k] || !isCard(at(x, y))) continue
    card[k] = 1
    cardPx++
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }

  const share = cardPx / (W * H)
  if (share < MIN_CARD_SHARE) {
    console.log(`  ${name}: no card (border region is ${(share * 100).toFixed(0)}% of canvas)`)
    continue
  }

  // Pockets: card-coloured pixels the flood could not reach. Reported, not cut.
  let pockets = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!card[y * W + x] && isCard(at(x, y))) pockets++
  }

  // Content box of what survives.
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[at(x, y) + 3] > 8 && !card[y * W + x]) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) { console.log(`  ${name}: REFUSED -- the whole canvas reads as card`); continue }

  const before = `${W}x${H}`
  const after = `${x1 - x0 + 1}x${y1 - y0 + 1}`
  const note = pockets ? `  (${pockets}px of enclosed card colour left alone)` : ''
  if (checkOnly) {
    console.log(`  ${name}: carded ${(share * 100).toFixed(0)}%  box ${before} -> ${after}${note}`)
    continue
  }

  for (let k = 0; k < W * H; k++) {
    if (card[k]) { data[k * 4] = 0; data[k * 4 + 1] = 0; data[k * 4 + 2] = 0; data[k * 4 + 3] = 0 }
  }
  writeFileSync(path, encodePng(img))

  // Verify the write, do not assume it.
  const back = decodePng(readFileSync(path))
  const cornerAlpha = back.data[3]
  let stillOpaque = 0
  for (let i = 3; i < back.data.length; i += 4) if (back.data[i] > 8) stillOpaque++
  const ok = cornerAlpha === 0 && stillOpaque < W * H
  console.log(
    `  ${name}: ${ok ? 'cut' : 'FAILED'}  ${before} -> ${after}  ` +
    `opaque now ${((stillOpaque / (W * H)) * 100).toFixed(0)}%${note}`,
  )
  if (ok) wrote++
}
if (!checkOnly) console.log(`${wrote}/${files.length} rewritten`)
