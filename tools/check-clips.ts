/**
 * Measure every packed animation clip for structural collapse.
 *
 *     npm run clips
 *
 * **Why this exists, in one sentence: a working animation was deleted because
 * it was never measured.**
 *
 * v3 animation redraws every frame rather than displacing pixels, so it can
 * lose the subject entirely partway through a loop. The `vatAlien` clip came
 * back with the glass cylinder gone in eight frames of nine — the creature left
 * standing on the base and the lid floating in mid-air. That was caught.
 *
 * What was NOT caught: `vatSpecimen` was unwired at the same moment, on the
 * assumption that a clip from the same batch of the same kind of object must
 * have failed the same way. It had not. It measures 9/9 and always did, and it
 * is the better asset of the two. An assumption stood in for a measurement and
 * cost a finished thing.
 *
 * So: a number, for every clip, every build.
 *
 * **Scoped to `sceneClips` only, and that scoping is the whole design.** The
 * first version measured all 706 clips and reported 152 as broken, which is
 * the same as reporting none: nobody reads a list that long. They were false
 * positives, and obviously so once looked at — `farmhand.death` legitimately
 * compacts its body as the figure falls, and `agronomist.walk` has five
 * saturated pixels total, so noise in a detail swamps the ratio.
 *
 * A CHARACTER CLIP IS SUPPOSED TO CHANGE SHAPE. An ambient scene object is
 * not: a vat, a console, a windmill must hold its body exactly and move only
 * its contents. That is the only class where "the subject vanished" is even a
 * meaningful failure, and it is precisely the class that fails.
 *
 * **What it measures.** Per frame, the opaque pixel count (the body) and the
 * saturated-colour count (the fluid, the glow, the lit screen). A frame FAILS
 * if the body drops below 75% of the clip's maximum, or the moving part below
 * 45% of its peak. Loose on purpose: this is a smoke alarm for a whole subject
 * vanishing, not a quality bar. 9/9 does not mean a clip is good, it means
 * nothing structurally disappeared. Judging good is still done by looking.
 */
import { readFileSync } from 'node:fs'
import { readAtlas } from './atlas-read.ts'

const atlas = readAtlas()
type Frame = (typeof atlas.frames)[string]

/** The ambient scene objects — the only clips that must hold their shape. */
const manifest = JSON.parse(readFileSync('art/sprites.json', 'utf8')) as {
  sceneClips?: { sheets: Record<string, string[]> }
}
const AMBIENT = new Set(Object.keys(manifest.sceneClips?.sheets ?? {}))

const BODY_FLOOR = 0.75
const MOVER_FLOOR = 0.45

function measure(f: Frame): { body: number; mover: number } {
  const sheet = atlas.imageFor(f)
  let body = 0
  let mover = 0
  for (let y = f.y; y < f.y + f.h; y++) {
    for (let x = f.x; x < f.x + f.w; x++) {
      const i = (y * sheet.width + x) * 4
      if (sheet.data[i + 3] < 20) continue
      body++
      const r = sheet.data[i]
      const g = sheet.data[i + 1]
      const b = sheet.data[i + 2]
      // Any strongly saturated channel: green fluid, amber lamp, a lit screen.
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max > 100 && max - min > 60) mover++
    }
  }
  return { body, mover }
}

let checked = 0
const broken: string[] = []

for (const [id, clips] of Object.entries(atlas.clipLengths)) {
  if (!AMBIENT.has(id)) continue
  const dirs = atlas.dirSets?.[id] ?? atlas.rig.directions
  for (const [clip, frames] of Object.entries(clips)) {
    if (frames < 2) continue
    for (const dir of dirs) {
      const stats: { body: number; mover: number }[] = []
      for (let i = 0; i < frames; i++) {
        const f = atlas.frames[`${id}.${clip}.${dir}.${i}`]
        if (!f) break
        stats.push(measure(f))
      }
      if (stats.length !== frames) continue
      checked++
      const maxBody = Math.max(...stats.map((s) => s.body))
      const maxMover = Math.max(...stats.map((s) => s.mover))
      const bad = stats.filter(
        (s) => s.body < maxBody * BODY_FLOOR
          || (maxMover > 0 && s.mover < maxMover * MOVER_FLOOR),
      ).length
      if (!bad) continue
      broken.push(
        `${id}.${clip}.${dir}: ${frames - bad}/${frames} frames hold\n`
        + `    body  ${stats.map((s) => s.body).join(', ')}\n`
        + `    mover ${stats.map((s) => s.mover).join(', ')}`,
      )
    }
  }
}

console.log(`${checked} ambient clips measured (of ${AMBIENT.size} scene sheets)`)
if (!broken.length) {
  console.log('all hold')
} else {
  console.log(`\n${broken.length} clip(s) lose their subject partway through:\n`)
  for (const b of broken) console.log(`  ${b}\n`)
  console.log('Look at these before shipping them. A clip that drops its body or')
  console.log('its moving part mid-loop flashes the subject out of existence.')
}
