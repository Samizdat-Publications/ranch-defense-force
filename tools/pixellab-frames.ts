/**
 * Pull every candidate frame of a 1-direction object, plus a contact sheet.
 *
 *     PIXELLAB_API_KEY=... npm run frames -- <object-id> <name>
 *
 * A 1-direction object does not finish. It lands in status `review` holding
 * sixteen candidates in `frame_urls`, and stays there until something selects a
 * frame — so anything polling for `completed` waits forever. That is the whole
 * reason this exists: `tools/pixellab-object.ts` downloads a FINISHED object as
 * a zip, and there is no zip until a pick has been made.
 *
 * Sixteen candidates arrive for one price, so all sixteen are kept, exactly as
 * `art/pixellab-queue.json` `_pickNote` says: they are paid for, and the first
 * cell picked has more than once not been the best one.
 *
 *     assets/pixellab/sheets/<name>/<name>_NN.png   every candidate
 *     assets/pixellab/sheets/<name>/_contact.png    all of them, four across
 *
 * **Judge the contact sheet, never a single frame.** Then cut the one you want:
 *
 *     npm run cut -- single assets/pixellab/sheets/<name>/<name>_07.png \
 *                           assets/pixellab/picked/<name>.png
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, blankImage, blit, type Image } from './png.ts'

const [objectId, name] = process.argv.slice(2).filter((a) => a !== '--')
if (!objectId || !name) {
  console.error('usage: npm run frames -- <object-id> <name>')
  process.exit(1)
}
const key = process.env.PIXELLAB_API_KEY
if (!key) { console.error('PIXELLAB_API_KEY is not set.'); process.exit(1) }

const res = await fetch(`https://api.pixellab.ai/v2/objects/${objectId}`, {
  headers: { Authorization: `Bearer ${key}` },
})
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1) }
const obj = await res.json() as { status: string; frame_urls?: string[] }

const urls = obj.frame_urls ?? []
if (!urls.length) {
  console.error(`no candidate frames (status ${obj.status}) — still generating?`)
  process.exit(1)
}

const dir = `assets/pixellab/sheets/${name}`
mkdirSync(dir, { recursive: true })

const imgs: Image[] = []
for (let i = 0; i < urls.length; i++) {
  const r = await fetch(urls[i])
  if (!r.ok) { console.error(`  frame ${i}: ${r.status}`); continue }
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(`${dir}/${name}_${String(i).padStart(2, '0')}.png`, buf)
  imgs.push(decodePng(buf))
}

// Four across, on mid grey so pale and dark candidates both read.
const COLS = 4
const cw = Math.max(...imgs.map((f) => f.width)) + 8
const ch = Math.max(...imgs.map((f) => f.height)) + 8
const rows = Math.ceil(imgs.length / COLS)
const sheet = blankImage(cw * Math.min(COLS, imgs.length), ch * rows)
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 90; sheet.data[i + 1] = 90; sheet.data[i + 2] = 90; sheet.data[i + 3] = 255
}
imgs.forEach((im, i) => {
  const cx = (i % COLS) * cw + ((cw - im.width) >> 1)
  const cy = Math.floor(i / COLS) * ch + ((ch - im.height) >> 1)
  blit(im, 0, 0, im.width, im.height, sheet, cx, cy)
})
writeFileSync(`${dir}/_contact.png`, encodePng(sheet))

console.log(`  ${name}: ${imgs.length} candidates -> ${dir}/  (_contact.png ${sheet.width}x${sheet.height})`)
