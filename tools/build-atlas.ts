/**
 * Slices every source named in `art/sprites.json` and packs it into one
 * `public/atlas.png` + `public/atlas.json`. Runs offline — the game never sees
 * `assets/`, which is also what keeps the licensed art out of a deployed build.
 *
 *   npm run atlas
 *
 * Each frame is trimmed to its content bounds and records a bottom-centre
 * pivot, so the renderer positions by the character's feet and never has to
 * care that the source cells are mostly empty air.
 *
 * The 1792x704 assertion is the point of the whole file. A 16px export is
 * exactly the same shape as a 32px one and renders at half size silently; the
 * design says this has already gone wrong once. Thirty seconds of code removes
 * the entire category.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  decodePng, encodePng, blankImage, blit, contentBounds, dominantBandBounds, type Image,
} from './png.ts'
import { loadPalette, makeQuantiser } from './conform-fx.ts'

interface Frame {
  /** Position in the atlas. */
  x: number
  y: number
  w: number
  h: number
  /** Offset from the sprite's pivot (bottom-centre of the source cell) to the
   *  top-left of the trimmed content. The renderer adds these to the entity
   *  position, so trimming is invisible to it. */
  ox: number
  oy: number
}

interface Manifest {
  cell: number
  humanoidRig: {
    sheetWidth: number
    sheetHeight: number
    frameWidth: number
    frameHeight: number
    directions: string[]
    clips: Record<string, { rowPair: number; start: number; framesPerDirection: number }>
  }
  humanoids: Record<string, string>
  animals: {
    _base: string
    /** Order the direction clips appear across the sheet, left to right. */
    directionOrder: string[]
    sheets: Record<string, {
      path: string
      rows: number
      /** 64 on the two-row sheets, 32 on the rooster. NOT the cell size. */
      frameWidth: number
      walkRow: number
      framesPerDirection: number
    }>
  }
  singles: { _base: string; files: Record<string, string> }
  singlesExtra?: { _base: string; files: Record<string, string> }
  weapons?: { _base: string; files: Record<string, string> }
  weaponsFarmTools?: { _base: string; files: Record<string, string>; conform?: boolean }
  nodes?: { _base: string; files: Record<string, string> }
  tools?: { _base: string; files: Record<string, string>; conform?: boolean }
  weaponTiers?: { _base: string; files: Record<string, string>; conform?: boolean }
  gunSheet?: {
    path: string
    conform?: boolean
    cellWidth: number
    cellHeight: number
    categories: string[]
    colLefts: number[]
    rowTops: number[]
  }
  nodeTrees?: { _base: string; files: Record<string, string> }
  projectiles?: {
    _base: string
    clips: Record<string, { path: string }>
  }
  fx?: {
    _base: string
    cell: number
    clips: Record<string, { path: string; row: number; frames: number }>
  }
  terrainSource: { path: string; tiles: Record<string, [number, number]> }
}

const PAD = 2 // bleed, so a filtered draw never samples a neighbour

const manifest = JSON.parse(readFileSync('art/sprites.json', 'utf8')) as Manifest
const rig = manifest.humanoidRig

interface Pending {
  name: string
  img: Image
  sx: number
  sy: number
  sw: number
  sh: number
  ox: number
  oy: number
}

const pending: Pending[] = []
const errors: string[] = []
/** Frames per direction, per sheet — a rooster walks in 6 and a pig in 12, so
 *  the renderer cannot assume one number. */
const clipLengths: Record<string, Record<string, number>> = {}

// ---------------------------------------------------------------- humanoids

for (const [id, path] of Object.entries(manifest.humanoids)) {
  let sheet: Image
  try {
    sheet = decodePng(readFileSync(path))
  } catch (e) {
    errors.push(`${path}: ${(e as Error).message}`)
    continue
  }

  // THE ASSERTION. A 16px export is 896x352 and would render at half size with
  // no other symptom.
  if (sheet.width !== rig.sheetWidth || sheet.height !== rig.sheetHeight) {
    errors.push(
      `${path}: expected ${rig.sheetWidth}x${rig.sheetHeight}, got ${sheet.width}x${sheet.height}. ` +
      `This is almost certainly a ${sheet.width === 896 ? '16px' : 'wrong-scale'} export — re-export at 32x32.`,
    )
    continue
  }

  const fw = rig.frameWidth
  const fh = rig.frameHeight
  clipLengths[id] = {}

  for (const [clipName, clip] of Object.entries(rig.clips)) {
    clipLengths[id][clipName] = clip.framesPerDirection
    const rowY = clip.rowPair * 2 * manifest.cell
    rig.directions.forEach((dir, dirIndex) => {
      for (let f = 0; f < clip.framesPerDirection; f++) {
        const col = clip.start + dirIndex * clip.framesPerDirection + f
        const sx = col * fw
        const b = contentBounds(sheet, sx, rowY, fw, fh)
        if (b.empty) {
          errors.push(`${path}: ${clipName} ${dir} frame ${f} (col ${col}) is empty`)
          continue
        }
        pending.push({
          name: `${id}.${clipName}.${dir}.${f}`,
          img: sheet,
          sx: b.x,
          sy: b.y,
          sw: b.w,
          sh: b.h,
          // Pivot is bottom-centre of the source cell: feet on the ground,
          // horizontally centred.
          ox: b.x - (sx + fw / 2),
          oy: b.y - (rowY + fh),
        })
      }
    })
  }
}

// ------------------------------------------------------------------ animals

for (const [id, cfg] of Object.entries(manifest.animals?.sheets ?? {})) {
  const path = manifest.animals._base + cfg.path
  let sheet: Image
  try {
    sheet = decodePng(readFileSync(path))
  } catch (e) {
    errors.push(`${path}: ${(e as Error).message}`)
    continue
  }

  // These sheets are NOT on the 32px cell grid the humanoids use. Each walk
  // band is four direction clips of six frames, and on the two-row sheets a
  // frame is 64px wide with the animal centred in it — a side-view pig is 54px
  // across and would be cut in half by a 32px slice. See art/sprites.json.
  const fw = cfg.frameWidth
  const fh = manifest.cell * cfg.rows
  const rowY = cfg.walkRow * manifest.cell
  const order = manifest.animals.directionOrder
  const needWidth = order.length * cfg.framesPerDirection * fw
  clipLengths[id] = { walk: cfg.framesPerDirection, idle: 1 }

  if (rowY + fh > sheet.height || needWidth > sheet.width) {
    errors.push(
      `${path}: walk clip at row ${cfg.walkRow} needs ${needWidth}x${fh}px but the sheet ` +
      `is ${sheet.width}x${sheet.height}`,
    )
    continue
  }

  for (const dir of rig.directions) {
    const clipIndex = order.indexOf(dir)
    if (clipIndex < 0) {
      errors.push(`${path}: directionOrder has no entry for "${dir}"`)
      continue
    }
    for (let f = 0; f < cfg.framesPerDirection; f++) {
      const sx = (clipIndex * cfg.framesPerDirection + f) * fw
      // Dominant band, not raw bounds: cheap insurance if a frame window ever
      // catches a slice of the clip above or below.
      const b = dominantBandBounds(sheet, sx, rowY, fw, fh)
      if (b.empty) {
        errors.push(`${path}: walk ${dir} frame ${f} (x ${sx}) is empty`)
        continue
      }
      const frame = {
        name: `${id}.walk.${dir}.${f}`,
        img: sheet,
        sx: b.x, sy: b.y, sw: b.w, sh: b.h,
        // Bottom-centre of the frame, same convention as the humanoids.
        ox: b.x - (sx + fw / 2),
        oy: b.y - (rowY + fh),
      }
      pending.push(frame)
      // Animals have no separate idle clip, so frame 0 of the walk stands in.
      // One extra atlas entry beats a special case in the renderer.
      if (f === 0) pending.push({ ...frame, name: `${id}.idle.${dir}.0` })
    }
  }
}

// ------------------------------------------------------------------ singles

/**
 * Weapon icons must be ONE object at roughly one tile.
 *
 * Asserted for the same reason the 1792x704 humanoid check exists: this pack
 * contains files named *_Load_* and *_Stack_* that are multi-tile piles, and
 * `Bucket_Load` (58x64 of stacked buckets) sailed into the weapon ring and
 * rendered as an unreadable brown slab twice the size of the player. Nothing
 * else about it looked wrong — it was just a bucket that was actually nine
 * buckets. The shovel is 30x48 and legitimately tall, so height is the looser
 * bound.
 */
const WEAPON_MAX_W = 36
const WEAPON_MAX_H = 52

const singleGroups = [
  manifest.singles, manifest.singlesExtra, manifest.weapons, manifest.weaponsFarmTools,
  manifest.nodes, manifest.nodeTrees, manifest.tools, manifest.weaponTiers,
].filter(Boolean) as { _base: string; files: Record<string, string>; conform?: boolean }[]

for (const group of singleGroups) {
for (const [name, file] of Object.entries(group.files ?? {})) {
  const path = group._base + file
  let img: Image
  try {
    img = decodePng(readFileSync(path))
  } catch (e) {
    errors.push(`${path}: ${(e as Error).message}`)
    continue
  }
  // A group can ask to be conformed — used for the icon pack, which is a
  // different artist's palette entirely.
  if (group.conform) {
    try {
      makeQuantiser(loadPalette()).conform(img)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  const b = contentBounds(img, 0, 0, img.width, img.height)
  if (b.empty) {
    errors.push(`${path}: entirely transparent`)
    continue
  }
  if (name.startsWith('weapon.') && (b.w > WEAPON_MAX_W || b.h > WEAPON_MAX_H)) {
    errors.push(
      `${path}: weapon icon is ${b.w}x${b.h}, over the ${WEAPON_MAX_W}x${WEAPON_MAX_H} limit. ` +
      `This is almost certainly a multi-tile "_Load_" or "_Stack_" pile rather than a single ` +
      `object — pick the "_Single_" variant.`,
    )
    continue
  }
  pending.push({
    name,
    img,
    sx: b.x, sy: b.y, sw: b.w, sh: b.h,
    // Bottom-centre pivot, same convention as the humanoids.
    ox: b.x - img.width / 2,
    oy: b.y - img.height,
  })
}
}

// ----------------------------------------------------------------------- fx

// Conformed to the LimeZu palette on the way in (§10 step 3). The pack is drawn
// by a different hand — more saturated, more arcade — and quantising here rather
// than shipping a second copy of the art means there is exactly one generated
// artefact to keep track of.
const fx = manifest.fx
if (fx && Object.keys(fx.clips ?? {}).length > 0) {
  let quantiser: ReturnType<typeof makeQuantiser> | null = null
  try {
    quantiser = makeQuantiser(loadPalette())
  } catch (e) {
    errors.push((e as Error).message)
  }

  const cell = fx.cell
  for (const [name, clip] of Object.entries(fx.clips)) {
    const path = fx._base + clip.path
    let sheet: Image
    try {
      sheet = decodePng(readFileSync(path))
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`)
      continue
    }

    const cols = Math.floor(sheet.width / cell)
    const rows = Math.floor(sheet.height / cell)
    if (clip.row >= rows) {
      errors.push(`fx ${name}: ${path} has ${rows} colour rows, manifest asks for row ${clip.row}`)
      continue
    }
    if (clip.frames > cols) {
      errors.push(`fx ${name}: ${path} has ${cols} frames, manifest asks for ${clip.frames}`)
      continue
    }

    // Conform a private copy: the same sheet may back more than one clip, and
    // quantising is not idempotent across different palettes.
    const conformed: Image = {
      width: sheet.width,
      height: sheet.height,
      data: new Uint8Array(sheet.data),
    }
    quantiser?.conform(conformed)

    const rowY = clip.row * cell
    let packed = 0
    for (let f = 0; f < clip.frames; f++) {
      const sx = f * cell
      const b = contentBounds(conformed, sx, rowY, cell, cell)
      // A tail frame that has faded to nothing is normal, not an error — the
      // clip just ends early. clipLengths records what was actually packed.
      if (b.empty) break
      pending.push({
        name: `fx.${name}.${f}`,
        img: conformed,
        sx: b.x, sy: b.y, sw: b.w, sh: b.h,
        // Centre pivot: an effect is centred on a point in the world.
        ox: b.x - (sx + cell / 2),
        oy: b.y - (rowY + cell / 2),
      })
      packed++
    }
    if (packed === 0) {
      errors.push(`fx ${name}: ${path} row ${clip.row} is entirely transparent`)
      continue
    }
    clipLengths[`fx.${name}`] = { play: packed }
  }
}

// -------------------------------------------------------------- firearms

/**
 * The gun sheet: six category columns of 22, sliced on measured bands.
 *
 * Not a uniform grid — the columns sit 85.2px apart and the guns inside them
 * vary from 14 to 25px wide. Cells are cut generously from the measured band
 * origins and trimmed to content, which is why only the origins need listing.
 */
const gunSheet = manifest.gunSheet
if (gunSheet) {
  let sheet: Image | null = null
  try {
    sheet = decodePng(readFileSync(gunSheet.path))
  } catch (e) {
    errors.push(`${gunSheet.path}: ${(e as Error).message}`)
  }
  if (sheet) {
    if (gunSheet.conform) {
      try {
        makeQuantiser(loadPalette()).conform(sheet)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    gunSheet.categories.forEach((cat, c) => {
      const left = gunSheet.colLefts[c]
      if (left === undefined) return
      gunSheet.rowTops.forEach((top, r) => {
        const b = contentBounds(sheet, left, top, gunSheet.cellWidth, gunSheet.cellHeight)
        if (b.empty) return
        pending.push({
          name: `gun.${cat}.${r}`,
          img: sheet,
          sx: b.x, sy: b.y, sw: b.w, sh: b.h,
          // Centre pivot, like the other held art.
          ox: b.x - (left + b.w / 2),
          oy: b.y - (top + gunSheet.cellHeight / 2),
        })
      })
    })
  }
}

// ---------------------------------------------------------- projectiles

/**
 * unTied Games projectile clips.
 *
 * Every variant ships a `spritesheet.txt` listing the exact rect of each frame,
 * so this reads the artist's own metadata instead of inferring a grid. That is
 * strictly better than measuring: these sheets are horizontal strips but the
 * frame width differs per type (a kunai is 16x8, a shockwave 64x32), and a
 * single assumed cell size would have been wrong for nine of the twelve.
 *
 * Conformed to the LimeZu palette on the way in, like the fx clips — the whole
 * point of §10 step 3 is that a second artist's work should not read as a
 * second artist's work.
 */
const projectiles = manifest.projectiles
if (projectiles && Object.keys(projectiles.clips ?? {}).length > 0) {
  let quantiser: ReturnType<typeof makeQuantiser> | null = null
  try {
    quantiser = makeQuantiser(loadPalette())
  } catch (e) {
    errors.push((e as Error).message)
  }

  for (const [name, clip] of Object.entries(projectiles.clips)) {
    const dir = projectiles._base + clip.path
    let sheet: Image
    let meta: string
    try {
      sheet = decodePng(readFileSync(`${dir}/spritesheet.png`))
      meta = readFileSync(`${dir}/spritesheet.txt`, 'utf8')
    } catch (e) {
      errors.push(`${dir}: ${(e as Error).message}`)
      continue
    }

    // Lines look like: `pj2_kunai_small_gray/frame0000.png = 0 0 16 8`
    const rects: { x: number; y: number; w: number; h: number }[] = []
    for (const line of meta.split(/\r?\n/)) {
      const m = line.match(/=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/)
      if (m) rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] })
    }
    if (rects.length === 0) {
      errors.push(`${dir}/spritesheet.txt: no frame rects parsed`)
      continue
    }

    const conformed: Image = {
      width: sheet.width,
      height: sheet.height,
      data: new Uint8Array(sheet.data),
    }
    quantiser?.conform(conformed)

    let packed = 0
    for (let f = 0; f < rects.length; f++) {
      const r = rects[f]
      const b = contentBounds(conformed, r.x, r.y, r.w, r.h)
      if (b.empty) continue // a lead-in or trailing blank frame is normal
      pending.push({
        name: `${name}.${packed}`,
        img: conformed,
        sx: b.x, sy: b.y, sw: b.w, sh: b.h,
        // Centre pivot: a bullet is centred on its position.
        ox: b.x - (r.x + r.w / 2),
        oy: b.y - (r.y + r.h / 2),
      })
      packed++
    }
    if (packed === 0) {
      errors.push(`${dir}: every frame is transparent`)
      continue
    }
    clipLengths[name] = { play: packed }
  }
}

// ------------------------------------------------------------------ terrain

const terrainTiles = Object.entries(manifest.terrainSource.tiles ?? {})
if (terrainTiles.length > 0) {
  let sheet: Image | null = null
  try {
    sheet = decodePng(readFileSync(manifest.terrainSource.path))
  } catch (e) {
    errors.push(`${manifest.terrainSource.path}: ${(e as Error).message}`)
  }
  if (sheet) {
    const cell = manifest.cell
    for (const [name, [col, row]] of terrainTiles) {
      const sx = col * cell
      const sy = row * cell
      if (sx + cell > sheet.width || sy + cell > sheet.height) {
        errors.push(`terrain ${name}: cell ${col},${row} is outside ${sheet.width}x${sheet.height}`)
        continue
      }
      // Tiles are not trimmed — they must stay exactly cell-sized to tile.
      pending.push({
        name: `terrain.${name}`,
        img: sheet,
        sx, sy, sw: cell, sh: cell,
        ox: 0, oy: 0,
      })
    }
  }
}

if (errors.length > 0) {
  console.error('\natlas build failed:\n')
  for (const e of errors) console.error('  ' + e)
  console.error('')
  process.exit(1)
}

if (pending.length === 0) {
  console.error('atlas build failed: nothing to pack')
  process.exit(1)
}

// -------------------------------------------------------------------- pack

// Shelf packer, tallest first. The atlas is built once offline and every frame
// is a similar small rectangle, so the packing quality of anything cleverer
// would not pay for itself.
pending.sort((a, b) => b.sh - a.sh || b.sw - a.sw)

const width = 1024
let x = PAD
let y = PAD
let shelfHeight = 0
const placed: (Pending & { px: number; py: number })[] = []

for (const p of pending) {
  if (x + p.sw + PAD > width) {
    x = PAD
    y += shelfHeight + PAD * 2
    shelfHeight = 0
  }
  placed.push({ ...p, px: x, py: y })
  x += p.sw + PAD * 2
  if (p.sh > shelfHeight) shelfHeight = p.sh
}
const height = nextPowerOfTwo(y + shelfHeight + PAD * 2)

function nextPowerOfTwo(v: number): number {
  let p = 1
  while (p < v) p *= 2
  return p
}

const atlas = blankImage(width, height)
const frames: Record<string, Frame> = {}

for (const p of placed) {
  blit(p.img, p.sx, p.sy, p.sw, p.sh, atlas, p.px, p.py)
  frames[p.name] = { x: p.px, y: p.py, w: p.sw, h: p.sh, ox: p.ox, oy: p.oy }
}

mkdirSync('public', { recursive: true })
writeFileSync('public/atlas.png', encodePng(atlas))
writeFileSync(
  'public/atlas.json',
  JSON.stringify(
    {
      width,
      height,
      rig: { directions: rig.directions, clips: rig.clips },
      clipLengths,
      frames,
    },
    null,
    0,
  ),
)

const bytes = readFileSync('public/atlas.png').length
console.log(
  `atlas: ${Object.keys(frames).length} frames, ${width}x${height}, ` +
  `${(bytes / 1024).toFixed(0)}KB -> public/atlas.png`,
)
