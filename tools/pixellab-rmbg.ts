/**
 * Strip the opaque "card" background PixelLab sometimes returns.
 *
 *   npm run rmbg -- <file.png> [more.png ...]
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json` (see
 * `tools/pixellab-key.ts`). Override with `PIXELLAB_API_KEY=... npm run rmbg -- ...`.
 *
 * **Needs a live key**, and costs **1 generation per image** — the API docs
 * claim `remove-background` is free; it is not, it was measured. See
 * docs/PIXELLAB.md.
 *
 * Large subjects are the ones that come back carded: at ~400px the endpoint
 * returns a framed illustration on a solid ground rather than a cut-out sprite,
 * while the same prompt at 96px comes back clean. Every barn, house, silo and
 * tree in the yard batch needed this and none of the small props did.
 *
 * Rewrites each file IN PLACE and then checks that the card is actually gone by
 * sampling the corners of the content bounds, rather than assuming the call
 * worked. **Protect before you write**: any pass that re-cuts from these files
 * must run AFTER this one, or it re-cuts the carded original.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decodePng, contentBounds } from './png.ts'
import { pixellabKey } from './pixellab-key.ts'

const key = pixellabKey()
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const BASE = 'https://api.pixellab.ai/v2'

const files = process.argv.slice(2).filter((a) => a !== '--' && a.endsWith('.png'))
if (!files.length) { console.error('usage: npm run rmbg -- <file.png> [more.png ...]'); process.exit(1) }

const balance = async (): Promise<number> => {
  const r = await fetch(`${BASE}/balance`, { headers: H })
  return ((await r.json()) as { subscription: { generations: number } }).subscription.generations
}

const start = await balance()
console.log(`balance ${start}; ${files.length} images`)

for (const path of files) {
  const name = basename(path)
  const buf = readFileSync(path)
  const img = decodePng(buf)
  const res = await fetch(`${BASE}/remove-background`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      image: { type: 'base64', base64: buf.toString('base64') },
      image_size: { width: img.width, height: img.height },
      background_removal_task: 'remove_simple_background',
    }),
  })
  if (!res.ok) { console.log(`  ${name}: HTTP ${res.status} ${(await res.text()).slice(0, 140)}`); continue }
  const j = await res.json() as { image?: { base64: string } }
  if (!j.image) { console.log(`  ${name}: no image back`); continue }
  const out = Buffer.from(j.image.base64, 'base64')
  writeFileSync(path, out)

  const after = decodePng(out)
  const b = contentBounds(after, 0, 0, after.width, after.height)
  const corners = [[b.x, b.y], [b.x + b.w - 1, b.y], [b.x, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]]
  let opaque = 0
  for (const [x, y] of corners) if (after.data[(y * after.width + x) * 4 + 3] > 200) opaque++
  console.log(`  ${name}: ${img.width}x${img.height} -> ${opaque >= 3 ? 'STILL ON A CARD' : 'clean'}`)
}

const end = await balance()
console.log(`spent ${start - end}; balance ${end}`)
