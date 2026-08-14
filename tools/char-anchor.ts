/**
 * Emits the two anchor images the PixelLab character builder wants.
 *
 *   npm run anchor                 # from the farmer, the default style source
 *   npm run anchor -- hand kid     # from any packed humanoid id
 *
 * The character builder takes TWO images and they do different jobs:
 *
 *   style     — ONE direction, front-facing. Carries palette, outline weight,
 *               shading and colour count.
 *   reference — FOUR directions in a row. Carries the rig: how a character in
 *               this game is posed, framed and turned.
 *
 * Getting them the wrong way round produces a character that looks right and
 * turns wrong, or turns right and looks like a different game.
 *
 * Both are cut from a real sheet rather than drawn, so every character we
 * generate is anchored to art that is already in the game. Writes to
 * `assets/pixellab/anchors/`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { decodePng, encodePng, blankImage, contentBounds } from './png.ts'

interface Manifest {
  humanoidRig: {
    frameWidth: number
    frameHeight: number
    directionOrder: string[]
    clips: Record<string, { rowPair: number; start: number; framesPerDirection: number }>
  }
  humanoids: Record<string, string>
}

const OUT = 'assets/pixellab/anchors'
/** The order the builder expects to read a turnaround in. */
const FACING = ['down', 'left', 'up', 'right'] as const

const manifest = JSON.parse(readFileSync('art/sprites.json', 'utf8')) as Manifest
const rig = manifest.humanoidRig
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const wanted = ids.length ? ids : ['hand']

mkdirSync(OUT, { recursive: true })

for (const id of wanted) {
  const path = manifest.humanoids[id]
  if (!path) {
    console.error(`  ${id}: not a packed humanoid — try one of ${Object.keys(manifest.humanoids).join(', ')}`)
    continue
  }
  const sheet = decodePng(readFileSync(path))
  const { frameWidth: fw, frameHeight: fh } = rig
  const idle = rig.clips.idle

  /** Source x of the idle frame for a facing, via the SHEET's band order. */
  const bandX = (dir: string): number =>
    (idle.start + rig.directionOrder.indexOf(dir) * idle.framesPerDirection) * fw
  const rowY = idle.rowPair * 2 * 32

  const cut = (dirs: readonly string[], file: string): void => {
    const out = blankImage(fw * dirs.length, fh)
    dirs.forEach((dir, i) => {
      const sx = bandX(dir)
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const si = ((rowY + y) * sheet.width + sx + x) * 4
          if (sheet.data[si + 3] === 0) continue
          const di = (y * out.width + (i * fw + x)) * 4
          out.data[di] = sheet.data[si]
          out.data[di + 1] = sheet.data[si + 1]
          out.data[di + 2] = sheet.data[si + 2]
          out.data[di + 3] = 255
        }
      }
    })
    const b = contentBounds(out, 0, 0, out.width, out.height)
    writeFileSync(`${OUT}/${file}`, encodePng(out))
    console.log(`  ${file.padEnd(28)} ${out.width}x${out.height}  content ${b.w}x${b.h}`)
  }

  cut(['down'], `${id}-style.png`)
  cut(FACING, `${id}-reference.png`)
}

console.log(
  `\nStyle image = the single front view. Reference image = the four-direction row.\n`
  + `See docs/PIXELLAB.md for the settings that must go with them: Pro mode,\n`
  + `character size 40, view "low top down".`,
)
