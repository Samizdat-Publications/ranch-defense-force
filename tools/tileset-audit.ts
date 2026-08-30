/**
 * What is on the PixelLab account that is not in `assets/tilesets/`.
 *
 *     npm run tsaudit -- <id> [id ...]          report only
 *     npm run tsaudit -- --pull <id>=<name> ... download those, named
 *
 * ## Why this exists
 *
 * Twice now this project has assumed art did not exist when it did. Session 13
 * found four cursed animals that "had never been downloaded" — they were on the
 * account, finished, and free to fetch. This is the same audit for tilesets:
 * 29 sets exist on the account and 15 are on disk.
 *
 * **Downloading costs no generations.** The metadata and image endpoints are
 * unauthenticated, so this works whether or not the current cycle's allowance
 * is spent — which is the state the account is usually in when someone wants
 * more ground.
 *
 * What it prints per set is what actually decides whether a set is usable:
 * the two terrain descriptions, the STYLE (a `highly detailed` set will not sit
 * beside the plain family whatever its colours), and the base tile ids, which
 * are the only thing that says whether two sets meet seamlessly.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { decodePng } from './png.ts'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const pull = argv.includes('--pull')
const specs = argv.filter((a) => !a.startsWith('--'))
if (specs.length === 0) {
  console.error('usage: npm run tsaudit -- [--pull] <id>[=<name>] ...')
  process.exit(1)
}

/** Everything already on disk, keyed by the id in its own metadata. */
const local = new Map<string, string>()
if (existsSync('assets/tilesets')) {
  for (const f of readdirSync('assets/tilesets').filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(`assets/tilesets/${f}`, 'utf8')) as { id?: string }
    if (d.id) local.set(d.id, f.replace(/\.json$/, ''))
  }
}

interface Meta {
  id: string
  lower_description?: string
  upper_description?: string
  view?: string
  style_settings?: Record<string, string>
  base_tile_ids?: { lower?: string; upper?: string }
  tileset_data?: { tiles?: unknown[] }
}

for (const spec of specs) {
  const [id, name] = spec.split('=')
  const res = await fetch(`https://api.pixellab.ai/mcp/tilesets/${id}/metadata`)
  if (!res.ok) { console.error(`${id}: metadata ${res.status}`); continue }
  const text = await res.text()
  const m = JSON.parse(text) as Meta
  const s = m.style_settings ?? {}
  const tiles = m.tileset_data?.tiles?.length ?? 0
  const on = local.get(id)

  console.log(
    `${id.slice(0, 8)}  ${tiles} tiles  ${m.view ?? '?'}  ` +
    `[${[s.detail, s.outline, s.shading].filter(Boolean).join(', ')}]` +
    (on ? `  ON DISK as ${on}` : '  NOT ON DISK'),
  )
  console.log(`    lower  ${m.lower_description ?? '?'}`)
  console.log(`    upper  ${m.upper_description ?? '?'}`)
  console.log(
    `    chains lower=${(m.base_tile_ids?.lower ?? '').slice(0, 8)} ` +
    `upper=${(m.base_tile_ids?.upper ?? '').slice(0, 8)}`,
  )

  if (pull && name) {
    if (tiles < 16) { console.error(`    NOT PULLED: ${tiles} tiles, expected 16+`); continue }
    const png = await fetch(`https://api.pixellab.ai/mcp/tilesets/${id}/image?inline=true`)
    if (!png.ok) { console.error(`    image ${png.status}`); continue }
    const bytes = Buffer.from(await png.arrayBuffer())
    decodePng(bytes)          // parsed rather than trusted; an error body is valid text
    mkdirSync('assets/tilesets', { recursive: true })
    writeFileSync(`assets/tilesets/${name}.png`, bytes)
    writeFileSync(`assets/tilesets/${name}.json`, text)
    console.log(`    -> assets/tilesets/${name}.{png,json}`)
  }
  console.log()
}
