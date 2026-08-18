/**
 * PixelLab post-processing — turns a raw PixelLab export into game-ready cells.
 *
 * PixelLab never returns art on the game's grid. Icons come back as a 4x4 grid
 * of variations on a 256px sheet; characters come back centred on a square
 * canvas sized for motion room (40x40 for rotations, 56x56 for animation
 * frames), with the figure at a different height in every frame. Dropped in
 * as-is, nothing lines up.
 *
 * This does the four things that have to happen every time, and nothing else:
 * slice, trim, place on a cell with a fixed baseline, and assemble strips.
 *
 * No new dependencies — it runs on `tools/png.ts`, the same hand-rolled PNG
 * codec the atlas builder uses.
 *
 *   npx tsx tools/pixellab-cut.ts grid    sheets/cow_bell.png            → 16 cells + a bbox report
 *   npx tsx tools/pixellab-cut.ts icon    sheets/cow_bell.png 0 0 picked/cow_bell.png
 *   npx tsx tools/pixellab-cut.ts cell    raw/walk_south_3.png cells/walk_south_3.png
 *   npx tsx tools/pixellab-cut.ts strip   cells/walk_south_*.png strips/walk_south_strip.png
 *   npx tsx tools/pixellab-cut.ts scale   raw/anything.png               → is it secretly 2x?
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { decodePng, encodePng, blankImage, blit, type Image } from './png.js'

/**
 * PixelLab's background removal leaves a fringe of alpha 1-8 pixels. Trimming
 * at `alpha !== 0` keeps a one-pixel halo and every sprite ends up a pixel or
 * two off centre. Eight is the threshold that was right for all 24 icons and
 * all 72 character frames.
 */
const ALPHA_FLOOR = 8

/**
 * The game's character cell, and where the feet sit in it.
 *
 * BASELINE MOVED 52 -> 58, and the reason is the new cast.
 *
 * 52 was LimeZu's, and it fit LimeZu: their characters are 46px tall, so feet
 * at 52 left six pixels of headroom in the 64px cell. The generated cast is
 * 51-55 tall — a 55px Kid placed feet-at-52 would start at y=-3 and lose the
 * top of his cap, silently, because a cut that overflows just clips.
 *
 * 58 clears the tallest of them with room to spare. It is safe ONLY because
 * every character is being regenerated: the atlas derives each sprite's pivot
 * from where its feet sit in the cell, so a cast cut consistently at 58 aligns
 * with itself. Mixing old-at-52 with new-at-58 is what would break, and that is
 * why this changes once, for all of them, rather than per character.
 */
const CELL_W = 32
const CELL_H = 64
const BASELINE_Y = 58

interface Box { x: number; y: number; w: number; h: number; empty: boolean }

function bounds(img: Image, rx = 0, ry = 0, rw = img.width, rh = img.height): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let y = 0; y < rh; y++) {
    const yy = ry + y
    if (yy < 0 || yy >= img.height) continue
    for (let x = 0; x < rw; x++) {
      const xx = rx + x
      if (xx < 0 || xx >= img.width) continue
      if (img.data[(yy * img.width + xx) * 4 + 3] <= ALPHA_FLOOR) continue
      if (xx < minX) minX = xx
      if (xx > maxX) maxX = xx
      if (yy < minY) minY = yy
      if (yy > maxY) maxY = yy
    }
  }
  if (minX === Infinity) return { x: rx, y: ry, w: 0, h: 0, empty: true }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, empty: false }
}

function crop(img: Image, b: Box): Image {
  const out = blankImage(b.w, b.h)
  blit(img, b.x, b.y, b.w, b.h, out, 0, 0)
  return out
}

function read(path: string): Image {
  return decodePng(readFileSync(path))
}

function write(path: string, img: Image): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encodePng(img))
}

/**
 * Trim to content, then place on a 32x64 cell: centred horizontally, feet on
 * BASELINE_Y. This is the step that makes a generated character stand at the
 * same height as a LimeZu one in every frame of every direction.
 *
 * Refuses to silently squash. If the content is wider than the cell the caller
 * needs to know, because the fix is a re-roll or a hand edit, not a resample.
 */
function toCell(img: Image): Image {
  const b = bounds(img)
  if (b.empty) return blankImage(CELL_W, CELL_H)
  if (b.w > CELL_W) {
    console.warn(`  ! content is ${b.w}px wide, cell is ${CELL_W} — cropping equally at both edges`)
  }
  if (b.h > BASELINE_Y) {
    console.warn(`  ! content is ${b.h}px tall, baseline is at y${BASELINE_Y} — head will clip`)
  }
  const cell = blankImage(CELL_W, CELL_H)
  const dx = Math.round((CELL_W - b.w) / 2)
  const dy = BASELINE_Y - b.h
  blit(img, b.x, b.y, b.w, b.h, cell, dx, dy)
  return cell
}

/**
 * Is this image really at 1:1, or is it a smaller image drawn at 2x/3x?
 *
 * PixelLab sometimes returns art whose real pixel grid is coarser than its
 * canvas. Packing that as-is puts half-pixels in the atlas. Checks whether
 * every NxN block is a single flat colour.
 */
function detectScale(img: Image): number {
  for (const n of [4, 3, 2]) {
    if (img.width % n || img.height % n) continue
    let uniform = true
    outer:
    for (let by = 0; by < img.height; by += n) {
      for (let bx = 0; bx < img.width; bx += n) {
        const i0 = (by * img.width + bx) * 4
        for (let y = 0; y < n && uniform; y++) {
          for (let x = 0; x < n; x++) {
            const i = ((by + y) * img.width + bx + x) * 4
            if (img.data[i] !== img.data[i0] || img.data[i + 1] !== img.data[i0 + 1]
              || img.data[i + 2] !== img.data[i0 + 2] || img.data[i + 3] !== img.data[i0 + 3]) {
              uniform = false
              break outer
            }
          }
        }
      }
    }
    if (uniform) return n
  }
  return 1
}

function downscale(img: Image, n: number): Image {
  const out = blankImage(img.width / n, img.height / n)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = ((y * n) * img.width + x * n) * 4
      const di = (y * out.width + x) * 4
      out.data[di] = img.data[si]
      out.data[di + 1] = img.data[si + 1]
      out.data[di + 2] = img.data[si + 2]
      out.data[di + 3] = img.data[si + 3]
    }
  }
  return out
}

/** Frames left to right on one row. The game reads strips with steps(n). */
function strip(frames: Image[]): Image {
  const w = Math.max(...frames.map((f) => f.width))
  const h = Math.max(...frames.map((f) => f.height))
  const out = blankImage(w * frames.length, h)
  frames.forEach((f, i) => blit(f, 0, 0, f.width, f.height, out, i * w, 0))
  return out
}

// ---------------------------------------------------------------- commands

const [cmd, ...args] = process.argv.slice(2)

if (cmd === 'grid') {
  // A style-reference sheet is 4x4. Report every cell so a human can pick one.
  const sheet = read(args[0])
  const cw = sheet.width / 4
  const ch = sheet.height / 4
  console.log(`${args[0]} — ${sheet.width}x${sheet.height}, cells ${cw}x${ch}`)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const b = bounds(sheet, c * cw, r * ch, cw, ch)
      console.log(`  r${r}c${c}  ${b.empty ? 'EMPTY' : `${b.w}x${b.h}`}`)
    }
  }
} else if (cmd === 'icon') {
  // One cell out of a sheet, trimmed to content. Card art: no cell, no baseline.
  const [src, r, c, dst] = args
  const sheet = read(src)
  const cw = sheet.width / 4
  const ch = sheet.height / 4
  const b = bounds(sheet, Number(c) * cw, Number(r) * ch, cw, ch)
  if (b.empty) throw new Error(`cell r${r}c${c} is empty`)
  let out = crop(sheet, b)
  const n = detectScale(out)
  if (n > 1) {
    console.log(`  detected ${n}x pixel scale, downscaling`)
    out = downscale(out, n)
  }
  write(dst, out)
  console.log(`${dst} — ${out.width}x${out.height}`)
} else if (cmd === 'single') {
  /*
    Trim ONE image to content. The `icon` command above assumes a 4x4 sheet,
    which is what the web UI exports; the REST API returns each candidate as its
    own file instead, so there is no grid to index into. Same alpha floor, same
    secretly-2x check, one image.
  */
  const [src, dst] = args
  const img = read(src)
  const b = bounds(img)
  if (b.empty) throw new Error(`${src} is entirely transparent`)
  let out = crop(img, b)
  const n = detectScale(out)
  if (n > 1) {
    console.log(`  detected ${n}x pixel scale, downscaling`)
    out = downscale(out, n)
  }
  write(dst, out)
  console.log(`${dst} — ${out.width}x${out.height}`)
} else if (cmd === 'cell') {
  // One character frame onto the 32x64 grid.
  const [src, dst] = args
  const out = toCell(read(src))
  write(dst, out)
  console.log(`${dst} — ${CELL_W}x${CELL_H}, feet on y${BASELINE_Y}`)
} else if (cmd === 'strip') {
  const dst = args[args.length - 1]
  const frames = args.slice(0, -1).map(read)
  const out = strip(frames)
  write(dst, out)
  console.log(`${dst} — ${out.width}x${out.height}, ${frames.length} frames`)
} else if (cmd === 'scale') {
  const img = read(args[0])
  const n = detectScale(img)
  const b = bounds(img)
  console.log(`${args[0]} — canvas ${img.width}x${img.height}, content ${b.w}x${b.h}, pixel scale ${n}x`)
} else {
  console.log('commands: grid | icon | single | cell | strip | scale — see the header of this file')
}
