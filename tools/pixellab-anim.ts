/**
 * Pull an `animate_image` job down as a strip the scene can actually use.
 *
 *     npm run anim -- <job-id> <name> [frames] [--skip0]
 *
 * `animate_image` returns each frame as a separate file and keeps YOUR INPUT
 * as frame 0, so a `frame_count: 8` job is nine files. This writes:
 *
 *     assets/scene/<name>_strip.png            the strip the scene mounts
 *     assets/pixellab/anim/<name>/00.png ..     every frame, kept
 *     assets/pixellab/anim/<name>/_contact.png  the strip on grey, for judging
 *
 * THE STRIP IS WRITTEN UNTRIMMED AND ON A UNIFORM CELL, which is the whole
 * point. `stripActor` animates with `steps(n)` and divides the strip's width by
 * n, so a trimmed frame makes that division fractional and the walk slides
 * instead of stepping — the same trap that cost this project a six-frame strip,
 * a 32px tile and a stepped walk cycle. Frames are composited onto a fixed cell
 * taken from the largest frame, so they stay registered to each other.
 *
 * `--skip0` drops the input frame. Use it when frame 0 is a rest pose that
 * hitches the loop; keep it when the animation was authored to start there.
 *
 * Judge the CONTACT SHEET, never a single frame. The failure mode of a
 * generated animation is not a bad pixel, it is one frame that belongs to a
 * different animal — invisible one frame at a time, obvious in a row.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { blankImage, blit, decodePng, encodePng, type Image } from './png.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
const skip0 = args.includes('--skip0')
const [jobId, name, framesArg] = args.filter((a) => !a.startsWith('--'))

if (!jobId || !name) {
  console.error('usage: npm run anim -- <job-id> <name> [frames] [--skip0]')
  process.exit(1)
}

/** frame_count + 1: the job stores your input as frame 0. */
const total = Number(framesArg ?? 9)
const outDir = `assets/pixellab/anim/${name}`
mkdirSync(outDir, { recursive: true })

const url = (i: number): string =>
  `https://api.pixellab.ai/mcp/images/${jobId}/download?index=${i}`

const frames: Image[] = []
for (let i = 0; i < total; i++) {
  const res = await fetch(url(i))
  if (!res.ok) {
    // A short job simply has fewer frames; that is not an error worth dying on.
    console.log(`  frame ${i}: ${res.status}, stopping`)
    break
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(`${outDir}/${String(i).padStart(2, '0')}.png`, buf)
  frames.push(decodePng(buf))
}

if (frames.length === 0) {
  console.error('no frames downloaded — is the job id right, and has it finished?')
  process.exit(1)
}

const used = skip0 ? frames.slice(1) : frames
const cellW = Math.max(...used.map((f) => f.width))
const cellH = Math.max(...used.map((f) => f.height))

// One uniform cell per frame, each frame bottom-centred in it. Bottom-centre
// because these are actors standing on ground: their feet must not move between
// frames, and a top-left composite lets a taller frame lift the whole bird.
const strip = blankImage(cellW * used.length, cellH)
used.forEach((f, i) => {
  const dx = i * cellW + Math.floor((cellW - f.width) / 2)
  const dy = cellH - f.height
  blit(f, 0, 0, f.width, f.height, strip, dx, dy)
})
writeFileSync(`assets/scene/${name}_strip.png`, encodePng(strip))

// The same strip on a flat grey, so transparent pixels are not read as content.
const contact = blankImage(strip.width, strip.height)
for (let i = 0; i < contact.width * contact.height; i++) {
  contact.data[i * 4] = 0x55
  contact.data[i * 4 + 1] = 0x55
  contact.data[i * 4 + 2] = 0x55
  contact.data[i * 4 + 3] = 0xff
}
blit(strip, 0, 0, strip.width, strip.height, contact, 0, 0)
writeFileSync(`${outDir}/_contact.png`, encodePng(contact))

console.log(`${name}: ${used.length} frames, cell ${cellW}x${cellH}`)
console.log(`  assets/scene/${name}_strip.png  (${strip.width}x${strip.height})`)
console.log(`  ${outDir}/_contact.png`)
console.log(`  sprites.json -> sceneStrips.files["scene.${name}Strip"] = "${name}_strip.png"`)
console.log(`  stripActor: w:${cellW}, h:${cellH}, sheetW:${strip.width}, sheetH:${cellH}, frames:${used.length}`)
