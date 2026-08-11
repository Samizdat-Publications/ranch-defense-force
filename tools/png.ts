/**
 * Minimal PNG decode/encode on Node's built-in zlib.
 *
 * Written rather than pulled in because the design caps dependencies at
 * `vite`, `typescript`, `vitest`, and adding `sharp` (a native binary) or
 * `pngjs` to slice sprites offline is not worth the budget. This covers exactly
 * what the packs use: 8-bit greyscale, RGB, palette and RGBA, non-interlaced.
 * It is a build tool — it never ships in the game bundle.
 *
 * Everything is decoded to straight RGBA8 so the rest of the pipeline has one
 * pixel format to think about.
 */
import { deflateSync, inflateSync } from 'node:zlib'

export interface Image {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Paeth predictor, straight from the PNG spec. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function decodePng(buffer: Buffer): Image {
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)')
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const idat: Buffer[] = []

  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const data = buffer.subarray(dataStart, dataStart + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = new Uint8Array(data)
    } else if (type === 'tRNS') {
      transparency = new Uint8Array(data)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4 // + CRC
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth} (only 8 is handled)`)
  if (interlace !== 0) throw new Error('interlaced PNGs are not handled')

  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  const line = new Uint8Array(stride)
  const prev = new Uint8Array(stride)

  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    for (let x = 0; x < stride; x++) line[x] = raw[pos + x]
    pos += stride

    // Unfilter in place. `channels` is the byte distance to the left pixel.
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      switch (filter) {
        case 0: break
        case 1: line[x] = (line[x] + a) & 0xff; break
        case 2: line[x] = (line[x] + b) & 0xff; break
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break
        case 4: line[x] = (line[x] + paeth(a, b, c)) & 0xff; break
        default: throw new Error(`unknown filter ${filter} on row ${y}`)
      }
    }
    prev.set(line)

    // Expand whatever colour type this is into RGBA.
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 6) {
        const i = x * 4
        out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = line[i + 3]
      } else if (colorType === 2) {
        const i = x * 3
        out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255
      } else if (colorType === 3) {
        const idx = line[x]
        if (!palette) throw new Error('palette image with no PLTE chunk')
        out[o] = palette[idx * 3]
        out[o + 1] = palette[idx * 3 + 1]
        out[o + 2] = palette[idx * 3 + 2]
        out[o + 3] = transparency && idx < transparency.length ? transparency[idx] : 255
      } else if (colorType === 0) {
        const g = line[x]
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255
      } else {
        const i = x * 2
        out[o] = line[i]; out[o + 1] = line[i]; out[o + 2] = line[i]; out[o + 3] = line[i + 1]
      }
    }
  }

  return { width, height, data: out }
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  const crcInput = out.subarray(4, 8 + data.length)
  out.writeUInt32BE(crc32(crcInput), 8 + data.length)
  return out
}

export function encodePng(image: Image): Buffer {
  const { width, height, data } = image
  const stride = width * 4
  // One filter byte per row. Sub (1) beats None on pixel art often enough, but
  // Paeth is the safe general choice and deflate does the rest.
  const raw = Buffer.alloc((stride + 1) * height)
  const prev = new Uint8Array(stride)
  const line = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const src = y * stride
    for (let x = 0; x < stride; x++) line[x] = data[src + x]
    const rowStart = y * (stride + 1)
    raw[rowStart] = 4 // Paeth
    for (let x = stride - 1; x >= 0; x--) {
      const a = x >= 4 ? line[x - 4] : 0
      const b = prev[x]
      const c = x >= 4 ? prev[x - 4] : 0
      raw[rowStart + 1 + x] = (line[x] - paeth(a, b, c)) & 0xff
    }
    prev.set(line)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

// ------------------------------------------------------------------ helpers

export function blankImage(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

/** Copy a rectangle from `src` into `dst`, skipping fully transparent pixels. */
export function blit(
  src: Image, sx: number, sy: number, sw: number, sh: number,
  dst: Image, dx: number, dy: number,
): void {
  for (let y = 0; y < sh; y++) {
    const syy = sy + y
    if (syy < 0 || syy >= src.height) continue
    const dyy = dy + y
    if (dyy < 0 || dyy >= dst.height) continue
    for (let x = 0; x < sw; x++) {
      const sxx = sx + x
      if (sxx < 0 || sxx >= src.width) continue
      const dxx = dx + x
      if (dxx < 0 || dxx >= dst.width) continue
      const si = (syy * src.width + sxx) * 4
      if (src.data[si + 3] === 0) continue
      const di = (dyy * dst.width + dxx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
  empty: boolean
}

/**
 * Content bounds of the tallest *contiguous* band of occupied rows in a
 * sub-rect, rather than of everything in it.
 *
 * Needed because several animal sheets draw a sprite straddling the 32px row
 * boundary, so a naive 32x64 window catches a slice of the clip above or below
 * as well — which produced 10x50 "plank" dogs instead of 22x36 ones. Taking the
 * dominant band throws the stray slice away. A single well-formed sprite has
 * exactly one band, so this is a no-op for everything else.
 *
 * `gap` is how many blank rows end a band; 1 is right for pixel art where a
 * sprite is drawn contiguously.
 */
export function dominantBandBounds(
  img: Image, rx: number, ry: number, rw: number, rh: number, gap = 1,
): Bounds {
  const occupied: boolean[] = new Array(rh).fill(false)
  for (let y = 0; y < rh; y++) {
    const yy = ry + y
    if (yy < 0 || yy >= img.height) continue
    for (let x = 0; x < rw; x++) {
      const xx = rx + x
      if (xx < 0 || xx >= img.width) continue
      if (img.data[(yy * img.width + xx) * 4 + 3] !== 0) {
        occupied[y] = true
        break
      }
    }
  }

  let bestStart = -1
  let bestLen = 0
  let start = -1
  let blanks = 0
  for (let y = 0; y < rh; y++) {
    if (occupied[y]) {
      if (start < 0) start = y
      blanks = 0
    } else if (start >= 0) {
      blanks++
      if (blanks >= gap) {
        const len = y - blanks + 1 - start
        if (len > bestLen) {
          bestLen = len
          bestStart = start
        }
        start = -1
        blanks = 0
      }
    }
  }
  if (start >= 0) {
    const len = rh - start
    if (len > bestLen) {
      bestLen = len
      bestStart = start
    }
  }
  if (bestStart < 0) return { x: rx, y: ry, w: 0, h: 0, empty: true }

  return contentBounds(img, rx, ry + bestStart, rw, bestLen)
}

/** Tightest rectangle containing any non-transparent pixel in a sub-rect. */
export function contentBounds(img: Image, rx: number, ry: number, rw: number, rh: number): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = 0; y < rh; y++) {
    const yy = ry + y
    if (yy < 0 || yy >= img.height) continue
    for (let x = 0; x < rw; x++) {
      const xx = rx + x
      if (xx < 0 || xx >= img.width) continue
      if (img.data[(yy * img.width + xx) * 4 + 3] === 0) continue
      if (xx < minX) minX = xx
      if (xx > maxX) maxX = xx
      if (yy < minY) minY = yy
      if (yy > maxY) maxY = yy
    }
  }
  if (minX === Infinity) return { x: rx, y: ry, w: 0, h: 0, empty: true }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, empty: false }
}
