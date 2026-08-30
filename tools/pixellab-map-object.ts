/**
 * Pull a PixelLab MAP OBJECT down as a single PNG.
 *
 *     npm run mapobj -- <object-id> <name> [<object-id> <name> ...]
 *
 * A map object is one still image with a transparent background, which is what
 * a tree or a rock is. It is a different endpoint from `npm run object`, which
 * pulls an EIGHT-DIRECTION object as a zip of rotations and animation frames —
 * that is the shape a cursed animal comes in and it is not the shape of a rock.
 *
 * `create_map_object` is used rather than `create_1_direction_object` for one
 * reason and it is the house camera: 1-direction only accepts `top-down` or
 * `sidescroller`, while map objects accept `low top-down`, which is what
 * docs/ART_STYLE.md commits every asset to. Getting that wrong is invisible in
 * a single sprite and obvious the moment it stands next to the cast.
 *
 * **These auto-delete after eight hours.** They are not a library to come back
 * to; download in the same session that generates them. The copy under
 * `assets/pixellab/env/` is the only one that survives.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { decodePng } from './png.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
if (args.length === 0 || args.length % 2 !== 0) {
  console.error('usage: npm run mapobj -- <object-id> <name> [<object-id> <name> ...]')
  process.exit(1)
}

const dir = 'assets/pixellab/env'
mkdirSync(dir, { recursive: true })

let failed = 0
for (let i = 0; i < args.length; i += 2) {
  const [id, name] = [args[i], args[i + 1]]
  const res = await fetch(`https://api.pixellab.ai/mcp/map-objects/${id}/download`)
  if (!res.ok) {
    console.error(`  ${name}: ${res.status} ${res.statusText}`)
    failed++
    continue
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  const path = `${dir}/${name}.png`
  writeFileSync(path, bytes)
  // Decoded rather than trusted: a JSON error body written to a .png is a file
  // that exists, has a plausible size, and fails much later in the atlas build.
  try {
    const img = decodePng(bytes)
    console.log(`  ${path}  ${img.width}x${img.height}`)
  } catch (e) {
    console.error(`  ${path}: not a PNG — ${(e as Error).message}`)
    failed++
  }
}
process.exit(failed > 0 ? 1 : 0)
