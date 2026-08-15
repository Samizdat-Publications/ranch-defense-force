/**
 * Pull an 8-direction object's rotations down, and lay them out for judging.
 *
 *     npm run object -- <object-id> <name>
 *
 * `create_8_direction_object` returns eight URLs rather than a sheet, so this
 * fetches all eight into `assets/pixellab/object/<name>/` and writes one
 * `_ring.png` with them in compass order. Eight rotations have to be judged as
 * a RING — the failure mode is not a bad frame, it is one direction that does
 * not belong to the same animal as the other seven, and that is invisible one
 * frame at a time.
 *
 * The compass order below is PixelLab's, and it is not the game's. The atlas
 * builder's canonical order is down/up/left/right; mapping between them is the
 * job of whatever wires these in, not of this tool.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, type Image } from './png.ts'

const DIRS = [
  'south', 'south-west', 'west', 'north-west',
  'north', 'north-east', 'east', 'south-east',
] as const

const [name, prefix] = process.argv.slice(2).filter((a) => a !== '--')
if (!name || !prefix) {
  console.error(
    'usage: npm run object -- <name> <rotations-url-prefix>\n\n' +
    'The prefix is the part of the rotation URLs before "<direction>.png", copied\n' +
    'from get_object. It is passed rather than derived because it contains an\n' +
    'account id and an object id, and guessing an API shape is how tools end up\n' +
    'lying about what came back.',
  )
  process.exit(1)
}

const dir = `assets/pixellab/object/${name}`
mkdirSync(dir, { recursive: true })

const frames: (Image | null)[] = []
for (const d of DIRS) {
  const url = `${prefix.replace(/\/$/, '')}/${d}.png`
  const res = await fetch(url)
  if (!res.ok) { console.error(`  ${d}: ${res.status}`); frames.push(null); continue }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(`${dir}/${d}.png`, buf)
  const img = decodePng(buf)
  frames.push(img)
  console.log(`  ${dir}/${d}.png  ${img.width}x${img.height}`)
}

const present = frames.filter(Boolean) as Image[]
if (!present.length) {
  console.error('nothing downloaded — pass the rotation URLs directly if the API shape changed')
  process.exit(1)
}

const cw = Math.max(...present.map((f) => f.width)) + 8
const ch = Math.max(...present.map((f) => f.height)) + 8
const ring: Image = {
  width: cw * DIRS.length,
  height: ch,
  data: new Uint8Array(cw * DIRS.length * ch * 4),
}
// Mid grey, so a white pony and a black mule are both judgeable on it.
for (let i = 0; i < ring.data.length; i += 4) {
  ring.data[i] = 92; ring.data[i + 1] = 94; ring.data[i + 2] = 90; ring.data[i + 3] = 255
}
frames.forEach((im, n) => {
  if (!im) return
  const ox = n * cw + Math.floor((cw - im.width) / 2)
  const oy = Math.floor((ch - im.height) / 2)
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      const s = (y * im.width + x) * 4
      const a = im.data[s + 3]
      if (!a) continue
      const d = ((oy + y) * ring.width + ox + x) * 4
      for (let c = 0; c < 3; c++) {
        ring.data[d + c] = Math.round((im.data[s + c] * a + ring.data[d + c] * (255 - a)) / 255)
      }
    }
  }
})
writeFileSync(`${dir}/_ring.png`, encodePng(ring))
console.log(`\n${present.length}/8 rotations -> ${dir}/_ring.png (${ring.width}x${ring.height})`)
console.log('order: ' + DIRS.join(' '))
