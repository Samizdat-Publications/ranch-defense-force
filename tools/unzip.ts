/**
 * Reading a PixelLab download.
 *
 * Its own module because BOTH the object and the character pipelines need it,
 * and a shared helper living inside a CLI script means importing the helper
 * runs the CLI — which it did: `npm run character` printed `npm run object`'s
 * usage and exited.
 *
 * `tar` here is GNU tar and does not read zips at all; the object download is a
 * zip, and the first version of this shelled out and got "This does not look
 * like a tar archive". Zip's central directory is forty lines to walk and its
 * entries are raw-deflated, which Node's zlib already does for the PNG codec —
 * so it is read in-process and cannot be broken by a PATH.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/**
 * Walk a zip's central directory and write every entry out.
 *
 * Only the two compression methods PixelLab actually uses are handled — 0
 * (stored) and 8 (deflate). Anything else throws by name rather than writing a
 * corrupt file, because a silently wrong sprite is this project's most
 * expensive category of bug.
 */
export function unzipTo(buf: Buffer, outDir: string): number {
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
