/**
 * A 3x5 bitmap font, for labelling headless contact sheets.
 *
 * The build tools draw into raw pixel buffers with no canvas and no font stack,
 * and an unlabelled twelve-tile weapon sheet is a puzzle rather than a report.
 * Three by five is the smallest grid that stays legible for A-Z and 0-9; at the
 * 3x scale the sheets use it reads cleanly.
 *
 * Glyphs are written as five explicit rows rather than one flat string, because
 * the flat form is one miscounted character away from smearing every glyph
 * after it and there is no visual diff to catch that.
 *
 * Lowercase folds to uppercase — there is no descender room, and weapon ids are
 * camelCase, so `varmintRifle` renders as VARMINTRIFLE. Anything unmapped
 * renders as a space rather than throwing: a label is not worth failing on.
 */
import type { Image } from './png.ts'

export const GLYPH_W = 3
export const GLYPH_H = 5

const BLANK = ['...', '...', '...', '...', '...']

const G: Record<string, string[]> = {
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['###', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '_': ['...', '...', '...', '...', '###'],
  '(': ['..#', '.#.', '.#.', '.#.', '..#'],
  ')': ['#..', '.#.', '.#.', '.#.', '#..'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  '*': ['#.#', '.#.', '###', '.#.', '#.#'],
  '=': ['...', '###', '...', '###', '...'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
}

/** Pixel width of `text` at `scale`, including the 1px gaps between glyphs. */
export function textWidth(text: string, scale = 1): number {
  return text.length * (GLYPH_W + 1) * scale
}

/**
 * Draw `text` at `x,y` (top-left), in `rgb`, scaled by whole pixels.
 *
 * Nearest-neighbour blocks, not antialiased — everything else on these sheets
 * is pixel art, and a smooth label next to hard-edged sprites reads as a bug.
 */
export function drawText(img: Image, text: string, x: number, y: number, rgb: number, scale = 1): void {
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  let cx = x
  for (const raw of text.toUpperCase()) {
    const glyph = G[raw] ?? BLANK
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const row = glyph[gy]
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (row[gx] !== '#') continue
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const tx = cx + gx * scale + px
            const ty = y + gy * scale + py
            if (tx < 0 || ty < 0 || tx >= img.width || ty >= img.height) continue
            const i = (ty * img.width + tx) * 4
            img.data[i] = r
            img.data[i + 1] = g
            img.data[i + 2] = b
            img.data[i + 3] = 255
          }
        }
      }
    }
    cx += (GLYPH_W + 1) * scale
  }
}
