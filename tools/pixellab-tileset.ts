/**
 * Pull a Wang tileset down from PixelLab and write it in the shape the atlas
 * packer already reads.
 *
 *     npm run tileset -- <tileset-id> <name>
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json` (see
 * `tools/pixellab-key.ts`). Override with `PIXELLAB_API_KEY=... npm run tileset -- ...`.
 *
 * Why this exists: the tilesets staged in `assets/tilesets/` were saved from
 * the CREATE response, which carries a composed spritesheet and a
 * `bounding_box` per tile. `GET /v2/tilesets/<id>` — the only way to get a set
 * that was generated in an earlier session and never written to disk — does
 * NOT. It returns each tile as its own base64 PNG and no sheet at all, so a set
 * left on the account cannot be recovered by hand.
 *
 * So this composes the 4x4 sheet itself and SYNTHESISES the bounding boxes from
 * the grid it just laid out. That is strictly safer than trusting the ones the
 * create response supplies: the box is true by construction rather than by
 * agreement.
 *
 * Two fields in the API's tile records look like sheet positions and are not.
 * `wang_N` is a NAME and `original_position` is the generation grid, whose row
 * can exceed the sheet entirely; the API's own note says using either is what
 * produces horizontal banding. Neither is read here — the tiles are laid out in
 * the order they arrive and the boxes describe that layout.
 *
 * `corners` is the only field that matters for correctness, because
 * `src/render/wang.ts` keys every tile by its four corner values. The build
 * FAILS on a set missing any of the sixteen combinations rather than drawing a
 * hole in the ground, so a short set is caught by `npm run atlas`, not in play.
 */
import { writeFileSync } from 'node:fs'
import { decodePng, encodePng, blankImage, blit, type Image } from './png.ts'
import { pixellabKey } from './pixellab-key.ts'

const [id, name] = process.argv.slice(2).filter((a) => a !== '--')
if (!id || !name) {
  console.error('usage: npm run tileset -- <tileset-id> <name>')
  process.exit(1)
}

let key: string
try {
  key = pixellabKey()
} catch (e) {
  console.error(`\n${(e as Error).message}\n`)
  process.exit(1)
}

const res = await fetch(`https://api.pixellab.ai/v2/tilesets/${id}`, {
  headers: { Authorization: `Bearer ${key}` },
})
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}

interface Tile {
  id: string
  name: string
  image: { type: string; base64: string }
  corners: Record<string, string>
  description?: string
}
const body = await res.json() as {
  tileset: {
    tiles: Tile[]
    tile_size: { width: number; height: number }
    total_tiles: number
    terrain_types: string[]
  }
}

const set = body.tileset
const tiles = set.tiles ?? []
const tw = set.tile_size?.width ?? 32
const th = set.tile_size?.height ?? 32

if (tiles.length !== 16) {
  console.error(`expected 16 tiles, got ${tiles.length} — refusing to write a short set`)
  process.exit(1)
}

// 4x4, in arrival order. The layout is ours, so the boxes below are true.
const COLS = 4
const sheet: Image = blankImage(COLS * tw, Math.ceil(tiles.length / COLS) * th)

const out: { id: string; name: string; corners: Record<string, string>; bounding_box: { x: number; y: number; width: number; height: number }; description?: string }[] = []

tiles.forEach((t, i) => {
  const img = decodePng(Buffer.from(t.image.base64, 'base64'))
  const x = (i % COLS) * tw
  const y = Math.floor(i / COLS) * th
  blit(img, 0, 0, img.width, img.height, sheet, x, y)
  out.push({
    id: t.id,
    name: t.name,
    corners: t.corners,
    bounding_box: { x, y, width: tw, height: th },
    description: t.description,
  })
})

writeFileSync(`assets/tilesets/${name}.png`, encodePng(sheet))
writeFileSync(`assets/tilesets/${name}.json`, JSON.stringify({
  id,
  name,
  tile_size: set.tile_size,
  terrain_types: set.terrain_types,
  format: 'tileset15',
  layout: { type: 'tileset15', grid_size: { width: COLS, height: Math.ceil(tiles.length / COLS) } },
  _provenance: 'recovered from GET /v2/tilesets/<id> by tools/pixellab-tileset.ts; sheet composed and bounding boxes synthesised locally',
  tileset_data: { tiles: out, tile_size: set.tile_size, total_tiles: set.total_tiles, terrain_types: set.terrain_types },
}, null, 1) + '\n')

const corners = new Set(out.map((t) => `${t.corners.NW}${t.corners.NE}${t.corners.SW}${t.corners.SE}`))
console.log(`  ${name}: ${tiles.length} tiles, ${corners.size}/16 distinct corner combinations -> assets/tilesets/${name}.{png,json}`)
