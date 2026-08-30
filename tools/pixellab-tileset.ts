/**
 * Pull a finished PixelLab Wang tileset into `assets/tilesets/`.
 *
 *     npm run tileset -- <tileset-id> <name>
 *
 * Writes the pair the atlas packer expects, `<name>.png` and `<name>.json`, and
 * that pairing is the whole contract: `tools/build-atlas.ts` walks the
 * directory, reads each `.json` for the tile layout and slices the `.png` by
 * it, emitting `wang.<name>.<NW><NE><SW><SE>` through `src/render/wang.ts`. The
 * build FAILS if a set is short any of its 16 corner combinations rather than
 * drawing a hole in the ground, so a half-written pair is caught here rather
 * than at run time.
 *
 * Two things worth knowing before generating one, both learned the hard way and
 * both written up in docs/ART_STYLE.md:
 *
 * - **Chain off the canonical grass.** Pass the ground set's UPPER base tile id
 *   as the new set's `lower_base_tile_id` and the two terrains are the same
 *   pixels, so the boundary autotiles instead of butting together.
 * - **Ask for a texture, not a substance.** `bare earth, smooth, matte, almost
 *   featureless` comes back as ground; `dead ash` and `grey-green rot` both
 *   come back as RUBBLE, because the model hears the noun and draws stones. The
 *   phrasing that works keeps the known-good noun and changes only the colour.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { decodePng } from './png.ts'

const [id, name] = process.argv.slice(2).filter((a) => a !== '--')
if (!id || !name) {
  console.error('usage: npm run tileset -- <tileset-id> <name>')
  process.exit(1)
}

mkdirSync('assets/tilesets', { recursive: true })
const base = `https://api.pixellab.ai/mcp/tilesets/${id}`

const meta = await fetch(`${base}/metadata`)
if (!meta.ok) {
  console.error(`metadata: ${meta.status} ${meta.statusText}`)
  process.exit(1)
}
const metaText = await meta.text()
// Parsed rather than trusted: an error body is valid text and would land as a
// .json the packer then fails on, a long way from here.
const parsed = JSON.parse(metaText) as { tileset_data?: { tiles?: unknown[] } }
const tiles = parsed.tileset_data?.tiles?.length ?? 0
if (tiles < 16) {
  console.error(`metadata has ${tiles} tiles, expected at least 16 — not written`)
  process.exit(1)
}

// `?inline=true` is the same PNG served from api.pixellab.ai rather than
// backblaze, and it is the one that works from behind egress filtering.
const png = await fetch(`${base}/image?inline=true`)
if (!png.ok) {
  console.error(`image: ${png.status} ${png.statusText}`)
  process.exit(1)
}
const bytes = Buffer.from(await png.arrayBuffer())
const img = decodePng(bytes)

writeFileSync(`assets/tilesets/${name}.json`, metaText)
writeFileSync(`assets/tilesets/${name}.png`, bytes)
console.log(`  assets/tilesets/${name}.png  ${img.width}x${img.height}, ${tiles} tiles`)
console.log('  run npm run atlas to pack it')
