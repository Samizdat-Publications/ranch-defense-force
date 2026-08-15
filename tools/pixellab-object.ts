/**
 * Pull a PixelLab 8-direction object down whole, and lay it out for judging.
 *
 *     npm run object -- <object-id> <name>
 *
 * The object endpoint serves a zip of everything the object owns — eight
 * rotations and every frame of every animation, in named folders — which is
 * one request instead of eight rotation URLs plus nine frame URLs per
 * direction, each carrying its own uuid.
 *
 * It writes:
 *
 *     assets/pixellab/object/<name>/rotations/<dir>.png
 *     assets/pixellab/object/<name>/animations/<clip>/<dir>/frame_NNN.png
 *     assets/pixellab/object/<name>/_ring.png        the eight rotations, in compass order
 *     assets/pixellab/object/<name>/_walk_<dir>.png  one direction's frames, left to right
 *
 * **Judge the _ring, never a single frame.** The failure mode of an eight-way
 * rotation is not a bad frame, it is ONE DIRECTION that does not belong to the
 * same animal as the other seven, and that is invisible one frame at a time.
 * The same goes for a walk: a strip read left to right shows a hitch or a
 * skated foot that no single frame does.
 *
 * PixelLab's compass order is south, south-west, west, north-west, north,
 * north-east, east, south-east. That is NOT the game's order, and it is the
 * fourth distinct direction order in this project after the humanoid sheets,
 * the animal sheets and the tractor. Measure the mapping; do not assume it.
 *
 * The zip is read HERE rather than shelled out to, in the same spirit as
 * `tools/png.ts`: the platform's unzip is not dependable. This machine's `tar`
 * is GNU tar, which does not read zips at all, and whether `unzip` exists
 * varies by shell. Zip's central directory is forty lines to walk and the
 * entries are raw-deflated, which Node's own zlib already does for the PNG
 * codec — so this costs no dependency and cannot be broken by a PATH.
 */
import { inflateRawSync } from 'node:zlib'
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { decodePng, encodePng, type Image } from './png.ts'

/**
 * Walk a zip's central directory and write every entry out.
 *
 * Only the two compression methods PixelLab actually uses are handled — 0
 * (stored) and 8 (deflate). Anything else throws by name rather than writing a
 * corrupt file, because a silently wrong sprite is this project's most
 * expensive category of bug.
 */
function unzipTo(buf: Buffer, outDir: string): number {
  // End of central directory: signature 0x06054b50, scanned from the back
  // because the comment field is variable length.
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  let written = 0

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue

    // The local header repeats the name and extra fields, and its extra length
    // is NOT always the central directory's — read it from the local header.
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)

    let data: Buffer
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`${name}: unsupported zip compression method ${method}`)

    const dest = `${outDir}/${name}`
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, data)
    written++
  }
  return written
}

const DIRS = [
  'south', 'south-west', 'west', 'north-west',
  'north', 'north-east', 'east', 'south-east',
] as const

const [objectId, name] = process.argv.slice(2).filter((a) => a !== '--')
if (!objectId || !name) {
  console.error('usage: npm run object -- <object-id> <name>')
  process.exit(1)
}

const dir = `assets/pixellab/object/${name}`
mkdirSync(dir, { recursive: true })

const res = await fetch(`https://api.pixellab.ai/mcp/objects/${objectId}/download`)
if (!res.ok) {
  console.error(`download failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
const n = unzipTo(Buffer.from(await res.arrayBuffer()), dir)
console.log(`  ${n} files -> ${dir}`)

/** Lay images out left to right on mid grey, so pale and dark both read. */
function contact(imgs: Image[], out: string): void {
  if (!imgs.length) return
  const cw = Math.max(...imgs.map((f) => f.width)) + 8
  const ch = Math.max(...imgs.map((f) => f.height)) + 8
  const sheet: Image = {
    width: cw * imgs.length, height: ch,
    data: new Uint8Array(cw * imgs.length * ch * 4),
  }
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = 92; sheet.data[i + 1] = 94; sheet.data[i + 2] = 90; sheet.data[i + 3] = 255
  }
  imgs.forEach((im, n) => {
    const ox = n * cw + Math.floor((cw - im.width) / 2)
    const oy = Math.floor((ch - im.height) / 2)
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const s = (y * im.width + x) * 4
        const a = im.data[s + 3]
        if (!a) continue
        const d = ((oy + y) * sheet.width + ox + x) * 4
        for (let c = 0; c < 3; c++) {
          sheet.data[d + c] = Math.round((im.data[s + c] * a + sheet.data[d + c] * (255 - a)) / 255)
        }
      }
    }
  })
  writeFileSync(out, encodePng(sheet))
  console.log(`  ${out}  ${sheet.width}x${sheet.height}`)
}

const rots = DIRS
  .map((d) => `${dir}/rotations/${d}.png`)
  .filter(existsSync)
  .map((f) => decodePng(readFileSync(f)))
contact(rots, `${dir}/_ring.png`)
console.log(`  ${rots.length}/8 rotations — order: ${DIRS.join(' ')}`)

const animRoot = `${dir}/animations`
if (existsSync(animRoot)) {
  for (const clip of readdirSync(animRoot)) {
    for (const d of DIRS) {
      const dd = `${animRoot}/${clip}/${d}`
      if (!existsSync(dd)) continue
      const frames = readdirSync(dd).filter((f) => f.endsWith('.png')).sort()
        .map((f) => decodePng(readFileSync(`${dd}/${f}`)))
      contact(frames, `${dir}/_${clip.slice(0, 12)}_${d}.png`)
    }
  }
}
