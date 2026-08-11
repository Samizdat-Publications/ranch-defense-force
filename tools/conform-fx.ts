/**
 * Conforms the FX pack to LimeZu's palette (§10 step 3).
 *
 *   npm run conform     # re-extract art/palette.json from the LimeZu sheets
 *
 * The FX pack is the one thing in the repo drawn by a different hand. It is more
 * saturated and more arcade than LimeZu's muted farm palette, and the design is
 * emphatic that dropping it in raw is the single most likely way this game ends
 * up looking assembled rather than made.
 *
 * So: extract 32 colours from the LimeZu sheets, then quantise every FX pixel to
 * the nearest entry **in Oklab, not RGB**. Oklab is the point — nearest-in-RGB
 * picks by coordinate distance in a space where equal steps are not equal
 * differences, and on a muted palette it reliably picks the wrong entry for
 * anything saturated, which is exactly what the FX frames are.
 *
 * Alpha is carried through untouched. The shapes and their soft edges are the
 * good part of the pack; only the hues are wrong.
 *
 * This file is both a script and a library: `npm run conform` regenerates the
 * palette, and `build-atlas.ts` imports the quantiser to conform frames as it
 * packs them. There is deliberately no directory of conformed PNGs on disk —
 * one generated artefact (`public/atlas.png`) is enough to keep track of.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { decodePng, type Image } from './png.ts'
import { Rng } from '../src/core/rng.ts'

// ------------------------------------------------------------------- oklab

/** sRGB byte (0-255) to linear light (0-1). */
function toLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export interface Lab { L: number; a: number; b: number }

/** sRGB bytes to Oklab. Björn Ottosson's matrices, unmodified. */
export function oklab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  }
}

function labDistanceSq(p: Lab, q: Lab): number {
  const dL = p.L - q.L
  const da = p.a - q.a
  const db = p.b - q.b
  return dL * dL + da * da + db * db
}

/**
 * Weights for the *matching* distance. Clustering uses plain Oklab above;
 * matching does not, and the difference is load-bearing.
 *
 * Straight nearest-in-Oklab picks by total perceptual difference, which treats
 * "same hue, less saturated" and "same saturation, opposite hue" as equally
 * good swaps. For conforming art they are not remotely equal: a farm palette is
 * muted, so every saturated FX pixel has to lose chroma somewhere, and if hue
 * is not protected it pays the bill by rotating instead. Measured on this
 * palette, that turned the explosion magenta (a saturated red-orange landed on
 * the strawberry crimson rather than the brick red) and boiled the green off the
 * gas cloud (light green landed on cream). Both are the same bug.
 *
 * So hue error is charged the most, chroma error next, lightness least —
 * lightness is the one axis the palette actually has room on, and it is also
 * what carries the shape of a sprite.
 */
const W_LIGHTNESS = 1
const W_CHROMA = 1.7
const W_HUE = 2.6

/**
 * Matching distance, in Oklch rather than Oklab.
 *
 * The hue term is the chord between the two hue angles scaled by the geometric
 * mean of the chromas — the standard trick, and the reason a near-grey is not
 * charged for having an arbitrary hue angle.
 */
function matchDistanceSq(p: Lab, q: Lab): number {
  const dL = p.L - q.L

  const cp = Math.hypot(p.a, p.b)
  const cq = Math.hypot(q.a, q.b)
  const dC = cp - cq

  let dh = Math.atan2(p.b, p.a) - Math.atan2(q.b, q.a)
  while (dh > Math.PI) dh -= Math.PI * 2
  while (dh < -Math.PI) dh += Math.PI * 2
  const dH = 2 * Math.sqrt(cp * cq) * Math.sin(dh / 2)

  return (
    W_LIGHTNESS * dL * dL +
    W_CHROMA * dC * dC +
    W_HUE * dH * dH
  )
}

// ------------------------------------------------------------ the histogram

/** A colour and how much of it there is. */
interface Weighted { r: number; g: number; b: number; w: number }

/**
 * Colours in a source, bucketed to 5 bits per channel before counting.
 *
 * The bucketing is what keeps k-means cheap: a 1792x704 sheet holds up to a
 * million pixels but only a few thousand distinct buckets, and at 32 output
 * colours the difference between a bucket and its exact members is far below
 * the size of a cluster.
 *
 * Fully transparent pixels are skipped; so are near-transparent ones, whose
 * RGB is whatever the exporter left in the hole and not a colour anyone chose.
 */
function histogram(img: Image): Map<number, Weighted> {
  const counts = new Map<number, Weighted>()
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const hit = counts.get(key)
    if (hit) {
      hit.w++
      continue
    }
    counts.set(key, { r, g, b, w: 1 })
  }
  return counts
}

/** Every PNG under a directory, recursively. */
function pngsUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`
    if (statSync(path).isDirectory()) out.push(...pngsUnder(path))
    else if (entry.toLowerCase().endsWith('.png')) out.push(path)
  }
  return out
}

/**
 * The sources the palette is extracted from, grouped.
 *
 * Groups are normalised to equal weight before merging. Raw pixel frequency
 * would hand the palette to whichever sheet is biggest, and a palette that is 28
 * greens and 4 of everything else has nothing to render a fire in.
 *
 * The complete tileset is the whole pack on one sheet — every terrain, building,
 * crop, tree, fence, vehicle and pickup LimeZu drew. It is deliberately the
 * broadest source available: a first pass sampled only terrain, crops and
 * animals, and the resulting 32 had no saturated red between hue 20 and 40
 * degrees and no light green at all, so the explosion conformed to the
 * strawberry magenta and the gas cloud lost its green to cream. Neither was a
 * quantiser bug — the palette simply had nowhere right to send them.
 */
const SOURCE_GROUPS: Record<string, string[]> = {
  tileset: ['assets/modern-farm/32x32/0_Complete_Tileset_32x32.png'],
  characters: pngsUnder('assets/generated/characters'),
  animals: pngsUnder('assets/modern-farm/32x32/Animals_32x32'),
}

// --------------------------------------------------------------- extraction

export interface Palette {
  /** 32 entries, each `[r, g, b]`. */
  colors: [number, number, number][]
}

const PALETTE_SIZE = 32
/** Enough for the centroids to settle; it converges well before this. */
const KMEANS_ITERATIONS = 40

/**
 * k-means in Oklab over the LimeZu sources, seeded so the palette is
 * reproducible — this writes a file that gets committed, and a palette that
 * shifted every time it was regenerated would make every atlas diff noise.
 */
export function extractPalette(): Palette {
  const samples: Weighted[] = []

  for (const [group, paths] of Object.entries(SOURCE_GROUPS)) {
    const merged = new Map<number, Weighted>()
    let total = 0
    for (const path of paths) {
      let img: Image
      try {
        img = decodePng(readFileSync(path))
      } catch {
        continue // a source we cannot read is not worth failing the palette over
      }
      for (const [key, c] of histogram(img)) {
        const hit = merged.get(key)
        if (hit) hit.w += c.w
        else merged.set(key, { ...c })
        total += c.w
      }
    }
    if (total === 0) {
      console.warn(`  ${group}: no readable pixels`)
      continue
    }
    // Normalise the group to weight 1, so no group can dominate by size alone.
    for (const c of merged.values()) samples.push({ ...c, w: c.w / total })
    console.log(`  ${group}: ${paths.length} file(s), ${merged.size} distinct colours`)
  }

  const labs = samples.map((s) => oklab(s.r, s.g, s.b))

  // k-means++ seeding: pick spread-out starts, so a cluster is never wasted
  // landing next to another one. Weighted by the same weights as the fit.
  const rng = new Rng(0x11e2a17)
  const centroids: Lab[] = []
  const centroidRgb: [number, number, number][] = []

  const first = weightedPick(samples, rng)
  centroids.push(labs[first])
  centroidRgb.push([samples[first].r, samples[first].g, samples[first].b])

  const nearestSq = new Float64Array(samples.length).fill(Infinity)
  while (centroids.length < PALETTE_SIZE) {
    const last = centroids[centroids.length - 1]
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const d = labDistanceSq(labs[i], last)
      if (d < nearestSq[i]) nearestSq[i] = d
      sum += nearestSq[i] * samples[i].w
    }
    if (sum <= 0) break // fewer distinct colours than PALETTE_SIZE
    let target = rng.next() * sum
    let pick = samples.length - 1
    for (let i = 0; i < samples.length; i++) {
      target -= nearestSq[i] * samples[i].w
      if (target <= 0) { pick = i; break }
    }
    centroids.push(labs[pick])
    centroidRgb.push([samples[pick].r, samples[pick].g, samples[pick].b])
  }

  // Lloyd's algorithm. Averaging happens in Oklab; the RGB written out is the
  // *nearest real source colour* to each settled centroid, not the average
  // converted back. A centroid can land on a colour no LimeZu artist ever used,
  // and the whole point is to end up with their palette rather than a blend of
  // it.
  const assignment = new Int32Array(samples.length)
  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    let moved = false
    for (let i = 0; i < samples.length; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < centroids.length; c++) {
        const d = labDistanceSq(labs[i], centroids[c])
        if (d < bestD) { bestD = d; best = c }
      }
      if (assignment[i] !== best) { assignment[i] = best; moved = true }
    }
    if (!moved && iter > 0) break

    const sumL = new Float64Array(centroids.length)
    const sumA = new Float64Array(centroids.length)
    const sumB = new Float64Array(centroids.length)
    const sumW = new Float64Array(centroids.length)
    for (let i = 0; i < samples.length; i++) {
      const c = assignment[i]
      const w = samples[i].w
      sumL[c] += labs[i].L * w
      sumA[c] += labs[i].a * w
      sumB[c] += labs[i].b * w
      sumW[c] += w
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sumW[c] === 0) continue // empty cluster: leave it where it is
      centroids[c] = { L: sumL[c] / sumW[c], a: sumA[c] / sumW[c], b: sumB[c] / sumW[c] }
    }
  }

  // Snap each centroid to the closest colour that actually appears in the art.
  for (let c = 0; c < centroids.length; c++) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < samples.length; i++) {
      const d = labDistanceSq(labs[i], centroids[c])
      if (d < bestD) { bestD = d; best = i }
    }
    if (best >= 0) centroidRgb[c] = [samples[best].r, samples[best].g, samples[best].b]
  }

  // Sort by lightness so the file reads as a ramp and a diff is legible.
  centroidRgb.sort((p, q) => oklab(p[0], p[1], p[2]).L - oklab(q[0], q[1], q[2]).L)

  return { colors: centroidRgb }
}

function weightedPick(samples: Weighted[], rng: Rng): number {
  let total = 0
  for (const s of samples) total += s.w
  let target = rng.next() * total
  for (let i = 0; i < samples.length; i++) {
    target -= samples[i].w
    if (target <= 0) return i
  }
  return samples.length - 1
}

// -------------------------------------------------------------- quantising

export interface Quantiser {
  /** Rewrites `img` in place: every opaque pixel snapped to the palette. */
  conform(img: Image): void
}

/**
 * A quantiser over a palette, with a memo table.
 *
 * The memo is what makes this affordable: an FX sheet is a million pixels drawn
 * from a few thousand distinct colours, and the nearest-entry search is 32
 * cube-roots deep. Keyed on the full 24-bit colour, so the memo is exact and
 * costs nothing in quality.
 */
export function makeQuantiser(palette: Palette): Quantiser {
  const labs = palette.colors.map(([r, g, b]) => oklab(r, g, b))
  const memo = new Map<number, number>()

  const nearest = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const lab = oklab(r, g, b)
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < labs.length; i++) {
      const d = matchDistanceSq(lab, labs[i])
      if (d < bestD) { bestD = d; best = i }
    }
    memo.set(key, best)
    return best
  }

  return {
    conform(img: Image): void {
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] === 0) continue
        const idx = nearest(img.data[i], img.data[i + 1], img.data[i + 2])
        const c = palette.colors[idx]
        img.data[i] = c[0]
        img.data[i + 1] = c[1]
        img.data[i + 2] = c[2]
      }
    },
  }
}

/** Reads the committed palette. Throws with a usable message if it is missing. */
export function loadPalette(path = 'art/palette.json'): Palette {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Palette
  } catch {
    throw new Error(`${path} is missing — run \`npm run conform\` to generate it`)
  }
}

// ------------------------------------------------------------------- script

// vite-node leaves its own binary in argv[1], so there is no reliable way to ask
// "am I the entry module?" — hence an explicit flag. `npm run conform` passes
// it; `build-atlas.ts` importing the quantiser does not.
if (process.argv.includes('--write')) {
  console.log('extracting the LimeZu palette:')
  const palette = extractPalette()
  const body =
    '{\n' +
    '  "_note": "Generated by tools/conform-fx.ts (npm run conform). 32 colours extracted from the LimeZu sheets by k-means in Oklab, each snapped to a colour that really appears in the art. build-atlas.ts quantises every FX frame to these. Sorted by lightness. Do not hand-edit — regenerate.",\n' +
    '  "colors": [\n' +
    palette.colors.map((c) => `    [${c[0]}, ${c[1]}, ${c[2]}]`).join(',\n') +
    '\n  ]\n}\n'
  writeFileSync('art/palette.json', body)
  console.log(`\npalette: ${palette.colors.length} colours -> art/palette.json`)
  for (const [r, g, b] of palette.colors) {
    console.log(`  #${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
  }
}
