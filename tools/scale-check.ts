/**
 * Stand sprites next to each other at the game's zoom, on the game's ground.
 *
 *     npm run scale                      # the player against every enemy
 *     npm run scale -- hand feralDog prizeBull
 *
 * **"Stand a new creature next to the player before accepting it"** is the
 * rule this exists to make cheap. It has been broken once already, expensively:
 * the first generated farmhand was better pixel art than LimeZu's farmer and
 * unusable, because its proportions belonged to a different game. Nothing about
 * that is visible in the sprite on its own — only beside the thing it will
 * stand beside.
 *
 * Draws from the PACKED ATLAS, so it shows what the game draws, and aligns
 * every sprite on the bottom-centre pivot using its own `ox`/`oy`, which is the
 * alignment the renderer uses. A sprite that looks right here and wrong in play
 * is a placement bug, not an art one.
 *
 * The grass is the real ground tile where one is packed, tiled, so the contrast
 * a sprite actually has to survive is the contrast being judged.
 */
import { writeFileSync } from 'node:fs'
import { encodePng, blankImage, blit, type Image } from './png.ts'
import { readAtlas } from './atlas-read.ts'
import enemiesRaw from '../src/content/enemies.json'

const atlas = readAtlas()
type Frame = (typeof atlas.frames)[string]

const ZOOM = 2

/*
   Each enemy's own `drawScale`, because leaving it out makes this tool LIE.

   Bosses are drawn at an integer multiple — prizeBull is 2 — and a comparison
   that ignores that shows a boss at the size of its trash mobs. The first
   version of this file did exactly that and produced the conclusion "the bull
   is about player height", which is wrong by a factor of two in play.

   Integer only, and rounded here the same way the renderer rounds it: a 32px
   cow at 2.2 is a blurry cow, and the whole screen stops being pixel art.
*/
const { _bosses: _unused, ...enemies } = enemiesRaw as unknown as Record<string, { drawScale?: number }>
const drawScaleOf = (sheet: string): number => Math.round(enemies[sheet]?.drawScale ?? 1)
const args = process.argv.slice(2).filter((a) => a !== '--')
const sheets = args.length ? args : ['hand', 'feralDog', 'rooster', 'sickHog', 'blownSheep', 'prizeBull']

/** The idle facing the viewer — the pose you compare silhouettes in. */
function frameFor(sheet: string): Frame | undefined {
  return atlas.frames[`${sheet}.idle.down.0`] ?? atlas.frames[`${sheet}.walk.down.0`]
}

const picked = sheets.map((s) => ({ sheet: s, frame: frameFor(s) }))
const missing = picked.filter((p) => !p.frame)
for (const m of missing) console.error(`  no idle/walk down frame for "${m.sheet}"`)
const ok = picked.filter((p) => p.frame) as { sheet: string; frame: Frame }[]
if (!ok.length) process.exit(1)

const scaleOf = (sheet: string): number => ZOOM * drawScaleOf(sheet)
const CELL = Math.max(...ok.map((p) => p.frame.w * scaleOf(p.sheet))) + 24
const H = Math.max(...ok.map((p) => p.frame.h * scaleOf(p.sheet))) + 40
const out: Image = blankImage(CELL * ok.length, H)

// Real ground under them, so the judgement includes the contrast in play.
const ground = atlas.frames['wang.dirt_to_grass_plain.0000'] ?? atlas.frames['terrain.dirt']
if (ground) {
  for (let y = 0; y < H; y += ground.h) {
    for (let x = 0; x < out.width; x += ground.w) {
      blit(atlas.imageFor(ground), ground.x, ground.y, ground.w, ground.h, out, x, y)
    }
  }
} else {
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 71; out.data[i + 1] = 151; out.data[i + 2] = 87; out.data[i + 3] = 255
  }
}

// A common baseline: every sprite's feet on the same line, as in the game.
const BASE = H - 16
ok.forEach((p, i) => {
  const f = p.frame
  const img = atlas.imageFor(f)
  const z = scaleOf(p.sheet)
  // Nearest-neighbour at an integer zoom, which is the only kind this project
  // allows: a 32px sprite at 2.5x is a blurry 32px sprite.
  const scaled = blankImage(f.w * z, f.h * z)
  for (let y = 0; y < scaled.height; y++) {
    const sy = f.y + ((y / z) | 0)
    for (let x = 0; x < scaled.width; x++) {
      const s = (sy * img.width + f.x + ((x / z) | 0)) * 4
      const d = (y * scaled.width + x) * 4
      scaled.data[d] = img.data[s]
      scaled.data[d + 1] = img.data[s + 1]
      scaled.data[d + 2] = img.data[s + 2]
      scaled.data[d + 3] = img.data[s + 3]
    }
  }
  // ox/oy are the offset from the bottom-centre pivot to the trimmed top-left,
  // so this is the renderer's own placement rather than a guess at it.
  const px = i * CELL + (CELL >> 1) + f.ox * z
  const py = BASE + f.oy * z
  blit(scaled, 0, 0, scaled.width, scaled.height, out, Math.round(px), Math.round(py))
})

const dest = '/tmp/scale-check.png'
writeFileSync(dest, encodePng(out))
console.log(ok.map((p) => `${p.sheet}${drawScaleOf(p.sheet) > 1 ? ` (drawScale ${drawScaleOf(p.sheet)})` : ''}`).join('  |  '))
console.log(`-> ${dest}  ${out.width}x${out.height}, camera ${ZOOM}x plus each enemy's drawScale, feet on one baseline`)
