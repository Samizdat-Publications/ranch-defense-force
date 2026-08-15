/**
 * Pull a finished PixelLab job's candidates down into the repo.
 *
 *     npm run fetch -- <job-id> <name> [count]
 *
 * `create_image_pro` returns each candidate as a SEPARATE file rather than the
 * web UI's 4x4 contact sheet, so there is nothing for `pixellab-cut grid` to
 * slice. This writes them side by side into one sheet as well as individually,
 * which is the form a human can actually choose from:
 *
 *     assets/pixellab/sheets/<name>/<name>_00.png .. _15.png   the candidates
 *     assets/pixellab/sheets/<name>/_contact.png               all of them, tiled
 *
 * Keep every candidate. They are already paid for, and more than once the cell
 * picked first was not the best one on the sheet.
 *
 * The download URLs need no auth, which is why this is a fetch and not a
 * signed request — but the JOB ID is the only thing guarding them, so do not
 * paste job ids into anything public.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, type Image } from './png.ts'

const [jobId, name, countArg] = process.argv.slice(2).filter((a) => a !== '--')
if (!jobId || !name) {
  console.error('usage: npm run fetch -- <job-id> <name> [count]')
  process.exit(1)
}
const count = Number(countArg ?? 16)
const dir = `assets/pixellab/sheets/${name}`
mkdirSync(dir, { recursive: true })

const url = (i: number) =>
  `https://api.pixellab.ai/mcp/images/${jobId}/download?index=${i}`

const frames: Image[] = []
for (let i = 0; i < count; i++) {
  const res = await fetch(url(i))
  if (!res.ok) {
    // A job with four candidates 404s on index 4. That is the end of the sheet,
    // not an error worth failing the run over.
    if (res.status === 404 && i > 0) break
    console.error(`  index ${i}: ${res.status} ${res.statusText}`)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const file = `${dir}/${name}_${String(i).padStart(2, '0')}.png`
  writeFileSync(file, buf)
  frames.push(decodePng(buf))
  console.log(`  ${file}  ${frames[frames.length - 1].width}x${frames[frames.length - 1].height}`)
}

if (!frames.length) {
  console.error('nothing downloaded')
  process.exit(1)
}

// One contact sheet, four across, so the whole set can be judged at once. The
// rejection bar is "can you identify it at thumbnail size", and that question
// is only answerable side by side.
const cols = Math.min(4, frames.length)
const rows = Math.ceil(frames.length / cols)
const cw = Math.max(...frames.map((f) => f.width))
const ch = Math.max(...frames.map((f) => f.height))
const sheet: Image = {
  width: cols * cw,
  height: rows * ch,
  data: new Uint8Array(cols * cw * rows * ch * 4),
}
frames.forEach((f, i) => {
  const ox = (i % cols) * cw
  const oy = Math.floor(i / cols) * ch
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const s = (y * f.width + x) * 4
      const d = ((oy + y) * sheet.width + ox + x) * 4
      sheet.data[d] = f.data[s]
      sheet.data[d + 1] = f.data[s + 1]
      sheet.data[d + 2] = f.data[s + 2]
      sheet.data[d + 3] = f.data[s + 3]
    }
  }
})
writeFileSync(`${dir}/_contact.png`, encodePng(sheet))
console.log(`\n${frames.length} candidates -> ${dir}/_contact.png (${sheet.width}x${sheet.height})`)
