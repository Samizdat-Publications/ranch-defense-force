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
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import {
  decodePng, encodePng, blankImage, blit, contentBounds, dominantBandBounds, type Image,
} from './png.ts'
import { loadPalette, makeQuantiser } from './conform-fx.ts'
import { wangKey, wangKeysFor, type Corner } from '../src/render/wang.ts'

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
    /** Order the direction bands appear in on the SHEET, which is not
     *  necessarily the order `directions` names them in. */
    directionOrder: string[]
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
  vehicles?: {
    _base: string
    frameWidth: number
    frameHeight: number
    framesPerDirection: number
    directionOrder: string[]
    sheets: Record<string, { path: string; firstBand: number }>
  }
  singles: { _base: string; files: Record<string, string> }
  singlesExtra?: { _base: string; files: Record<string, string> }
  /** Home-screen backdrop crops. DOM art, not field sprites; exempt from 32px. */
  scene?: { _base: string; files: Record<string, string>; noTrim?: boolean }
  portraits?: SingleGroup
  /** Walk strips. Packed untrimmed so steps() lands on cell boundaries. */
  sceneStrips?: { _base: string; files: Record<string, string>; noTrim?: boolean }
  /** Generated card art. Deliberately larger than 32px; cards zoom by integers. */
  pixellab?: { _base: string; files: Record<string, string> }
  /** Generated characters, pre-cut to the game's 32x64 grid. */
  pixellabStrips?: {
    _base: string
    compassToDirection: Record<string, string>
    sheets: Record<string, {
      cellWidth: number
      cellHeight: number
      clips: Record<string, { file: string; frames: number }>
    }>
  }
  /**
   * Generated 8-direction ANIMALS, straight out of a PixelLab object download.
   *
   * Different shape from `pixellabStrips` on purpose. A character arrives
   * pre-cut to 32x64 strips; an object arrives as one PNG per frame under
   * `animations/<slug>/<compass>/frame_NNN.png`, on a square cell whose size
   * is per-animal (56 for the dog, 68 for the bull) rather than the shared
   * humanoid grid.
   *
   * `slug` is PixelLab's own folder name, which is the animation DESCRIPTION
   * slugified and truncated — "walking_with_a_heavy_dragging_stagger_head_swingi".
   * It is per-animal and unguessable, so it is declared here rather than
   * derived. The game-facing clip name (walk/attack/death) is the key.
   */
  pixellabObjects?: {
    _base: string
    compassToDirection: Record<string, string>
    sheets: Record<string, {
      dir: string
      cell: number
      clips: Record<string, { slug: string; frames: number }>
    }>
  }
  /** One cell lifted out of a bigger sheet, for art that already exists. */
  gasMaskIcon?: {
    path: string; cellX: number; cellY: number; cellW: number; cellH: number; name: string
  }
  weapons?: { _base: string; files: Record<string, string> }
  weaponsFarmTools?: { _base: string; files: Record<string, string>; conform?: boolean }
  nodes?: { _base: string; files: Record<string, string> }
  /** Biome nodes and hazard decals for the map system. See art/sprites.json. */
  biome?: { _base: string; files: Record<string, string> }
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
  /**
   * Generated FX, animated from a still and delivered as one PNG per frame.
   *
   * Same frame keys and the same CENTRE pivot as the pack `fx` group, so the
   * renderer cannot tell them apart — an effect is centred on a point in the
   * world, it does not stand on the ground. A clip declared here REPLACES the
   * pack clip of that name, which is why the pack entry has to be deleted
   * rather than left alongside.
   */
  pixellabFx?: { _base: string; clips: Record<string, { dir: string }> }
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
/**
 * How mirror-identical the left and right bands must be.
 *
 * A correct order measures 61-99% across the thirteen sheets: the farmer is
 * near-perfect, the zombies less so because torn clothing is not symmetric. A
 * WRONG order measures 10-12%, because it is comparing a side view against a
 * front or back one. The gap is enormous, so the threshold only has to sit
 * inside it — 45% is well clear of both edges and does not need retuning every
 * time a new sheet lands.
 */
const SIDE_MIRROR_MIN = 0.45

const clipLengths: Record<string, Record<string, number>> = {}

// ------------------------------------------------- pixellab characters

/**
 * Pack a generated character that has already been cut to the game's grid.
 *
 * The raw PixelLab export needs real work first — rotations land on 40x40,
 * animation frames on 56x56, and the feet sit at a different y in every frame,
 * so dropped in as-is a character bobs and does not line up with LimeZu's
 * cells. `tools/pixellab-cut.ts` is what does that; by the time a sheet gets
 * here it is 32x64 cells with the feet on y=52 and there is no geometry left
 * to guess.
 */
if (manifest.pixellabStrips) {
  const cfg = manifest.pixellabStrips
  for (const [id, sheet] of Object.entries(cfg.sheets)) {
    clipLengths[id] ??= {}
    for (const [clipName, clip] of Object.entries(sheet.clips)) {
      clipLengths[id][clipName] = clip.frames
      for (const [compass, dir] of Object.entries(cfg.compassToDirection)) {
        const path = `${cfg._base}${id}/${clip.file.replace('{compass}', compass)}`
        let img: Image
        try {
          img = decodePng(readFileSync(path))
        } catch (e) {
          errors.push(`${path}: ${(e as Error).message}`)
          continue
        }
        const need = sheet.cellWidth * clip.frames
        if (img.width !== need || img.height !== sheet.cellHeight) {
          errors.push(
            `${path}: expected ${need}x${sheet.cellHeight} ` +
            `(${clip.frames} cells of ${sheet.cellWidth}x${sheet.cellHeight}), ` +
            `got ${img.width}x${img.height}.`,
          )
          continue
        }
        for (let f = 0; f < clip.frames; f++) {
          const sx = f * sheet.cellWidth
          const b = contentBounds(img, sx, 0, sheet.cellWidth, sheet.cellHeight)
          if (b.empty) {
            errors.push(`${path}: frame ${f} is entirely transparent`)
            continue
          }
          pending.push({
            name: `${id}.${clipName}.${dir}.${f}`,
            img,
            sx: b.x, sy: b.y, sw: b.w, sh: b.h,
            // Bottom-centre of the CELL, the same convention as every other
            // sheet — which is why the renderer needs no special case.
            ox: b.x - (sx + sheet.cellWidth / 2),
            oy: b.y - sheet.cellHeight,
          })
        }
      }
    }
  }
}

/*
   The eight-direction order, and it is ANGLE-SORTED on purpose.

   The humanoid rig's `directions` is `[down, up, left, right]`, which is not
   sorted by angle — `directionIndex` picks it apart with a comparison that also
   biases toward the side views. That does not generalise to eight, so the
   eight-direction sheets declare their own list in this order and the renderer
   indexes it with a single `round(facing / 45deg)`.

   Screen space, +y down: 0 is east/right and it turns clockwise.
*/
const EIGHT_ORDER = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight']

/** Per-sheet direction lists, for sheets not on the humanoid rig. */
const dirSets: Record<string, string[]> = {}

// -------------------------------------------------------- pixellab objects
//
// The animals. Same frame-key convention as every other sheet
// (`id.clip.direction.frame`) and the same bottom-centre offset, so the
// renderer needs no special case for them — only a direction list with eight
// entries instead of four.
//
// Trimmed to content, deliberately: an animal is drawn from a pivot, not from
// a box, and these frames are mostly transparent margin (a 56px cell holding a
// dog that never fills it). Trimming is what keeps 2,500 frames affordable.
if (manifest.pixellabObjects) {
  const cfg = manifest.pixellabObjects
  const named = new Set(Object.values(cfg.compassToDirection))
  const missing = EIGHT_ORDER.filter((d) => !named.has(d))
  if (missing.length) {
    errors.push(`pixellabObjects.compassToDirection is missing ${missing.join(', ')} — the renderer indexes the eight-direction list by angle and cannot tolerate a gap.`)
  }
  for (const [id, sheet] of Object.entries(cfg.sheets)) {
    dirSets[id] = EIGHT_ORDER
    clipLengths[id] ??= {}

    /*
       An IDLE clip, from `rotations/`.

       PixelLab generates an object as eight rotations and then animates them,
       so the rotation IS the standing pose — the same drawing every clip starts
       from. Packing it as `idle` costs eight frames an animal and makes these
       sheets shaped like every other sheet in the atlas, which matters well
       beyond the renderer: `items.json` and `weapons.json` both address card
       art as `<sheet>.idle.down.0`, and a sheet with no idle silently loses its
       card. The alternative — teaching every reader to fall back to walk frame
       0 — is the same fix spread over more places.
    */
    clipLengths[id].idle = 1
    for (const [compass, dir] of Object.entries(cfg.compassToDirection)) {
      const path = `${cfg._base}${sheet.dir}/rotations/${compass}.png`
      let img: Image
      try {
        img = decodePng(readFileSync(path))
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`)
        continue
      }
      const b = contentBounds(img, 0, 0, sheet.cell, sheet.cell)
      if (b.empty) { errors.push(`${path}: rotation is entirely transparent`); continue }
      pending.push({
        name: `${id}.idle.${dir}.0`,
        img,
        sx: b.x, sy: b.y, sw: b.w, sh: b.h,
        ox: b.x - sheet.cell / 2,
        oy: b.y - sheet.cell,
      })
    }

    for (const [clipName, clip] of Object.entries(sheet.clips)) {
      clipLengths[id][clipName] = clip.frames
      for (const [compass, dir] of Object.entries(cfg.compassToDirection)) {
        for (let f = 0; f < clip.frames; f++) {
          const path = `${cfg._base}${sheet.dir}/animations/${clip.slug}/${compass}/`
            + `frame_${String(f).padStart(3, '0')}.png`
          let img: Image
          try {
            img = decodePng(readFileSync(path))
          } catch (e) {
            errors.push(`${path}: ${(e as Error).message}`)
            continue
          }
          if (img.width !== sheet.cell || img.height !== sheet.cell) {
            errors.push(`${path}: expected ${sheet.cell}x${sheet.cell}, got ${img.width}x${img.height}.`)
            continue
          }
          const b = contentBounds(img, 0, 0, sheet.cell, sheet.cell)
          if (b.empty) {
            errors.push(`${path}: frame is entirely transparent`)
            continue
          }
          pending.push({
            name: `${id}.${clipName}.${dir}.${f}`,
            img,
            sx: b.x, sy: b.y, sw: b.w, sh: b.h,
            ox: b.x - sheet.cell / 2,
            oy: b.y - sheet.cell,
          })
        }
      }
    }
  }
}

// ------------------------------------------------------------ single cutouts

if (manifest.gasMaskIcon) {
  const c = manifest.gasMaskIcon
  try {
    const img = decodePng(readFileSync(c.path))
    const b = contentBounds(img, c.cellX, c.cellY, c.cellW, c.cellH)
    if (b.empty) errors.push(`${c.path}: cutout is entirely transparent`)
    else {
      pending.push({
        name: c.name, img, sx: b.x, sy: b.y, sw: b.w, sh: b.h,
        ox: b.x - (c.cellX + c.cellW / 2), oy: b.y - (c.cellY + c.cellH),
      })
    }
  } catch (e) {
    errors.push(`${c.path}: ${(e as Error).message}`)
  }
}

// ---------------------------------------------------------------- humanoids

for (const [id, path] of Object.entries(manifest.humanoids)) {
  if (id.startsWith('_')) continue
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

  // THE SECOND ASSERTION: the direction bands really are where directionOrder
  // says they are.
  //
  // A wrong band order has no symptom the build can otherwise see — every
  // frame is present, every frame is non-empty, and the game renders a
  // confident, wrong sprite. It shipped from M0 to M7 with `down` drawing the
  // right-facing pose and `right` drawing the front-facing one, and was found
  // by a player, not by a test.
  //
  // The invariant is geometric and cheap: left and right are the same drawing
  // mirrored, so band(left) flipped must match band(right) almost exactly,
  // while up and down must NOT match each other. Any permutation that swaps a
  // side view with a front or back view breaks one of the two.
  {
    const walk = rig.clips.walk
    const rowY = walk.rowPair * 2 * manifest.cell
    const bandX = (dir: string): number =>
      (walk.start + rig.directionOrder.indexOf(dir) * walk.framesPerDirection) * fw
    const match = (ax: number, bx: number, mirror: boolean): number => {
      let same = 0
      let total = 0
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const ai = ((rowY + y) * sheet.width + ax + x) * 4
          const bi = ((rowY + y) * sheet.width + bx + (mirror ? fw - 1 - x : x)) * 4
          if (sheet.data[ai + 3] === 0 && sheet.data[bi + 3] === 0) continue
          total++
          if (
            sheet.data[ai + 3] === sheet.data[bi + 3] &&
            Math.abs(sheet.data[ai] - sheet.data[bi]) < 8 &&
            Math.abs(sheet.data[ai + 1] - sheet.data[bi + 1]) < 8 &&
            Math.abs(sheet.data[ai + 2] - sheet.data[bi + 2]) < 8
          ) same++
        }
      }
      return total ? same / total : 0
    }

    const sides = match(bandX('left'), bandX('right'), true)
    const frontBack = match(bandX('up'), bandX('down'), false)
    if (sides < SIDE_MIRROR_MIN) {
      errors.push(
        `${path}: directionOrder looks wrong — the "left" and "right" bands are only ` +
        `${(sides * 100).toFixed(0)}% mirror-identical (expected >${SIDE_MIRROR_MIN * 100}%). The bands are ` +
        `probably not [${rig.directionOrder.join(', ')}].`,
      )
    }
    if (frontBack > 0.9) {
      errors.push(
        `${path}: directionOrder looks wrong — the "up" and "down" bands are ` +
        `${(frontBack * 100).toFixed(0)}% identical, so at least one of them is not a ` +
        `front or back view.`,
      )
    }
  }

  clipLengths[id] = {}

  for (const [clipName, clip] of Object.entries(rig.clips)) {
    clipLengths[id][clipName] = clip.framesPerDirection
    const rowY = clip.rowPair * 2 * manifest.cell
    rig.directions.forEach((dir) => {
      // Canonical direction -> SOURCE band, via directionOrder. Using the index
      // of `directions` directly assumes the sheet is laid out in the order the
      // game names its directions, and this sheet is not: it runs right, up,
      // left, down. That assumption shipped `down` drawing the right-facing
      // sprite and `right` drawing the front one for every humanoid in the game.
      const bandIndex = rig.directionOrder.indexOf(dir)
      if (bandIndex < 0) {
        errors.push(`${path}: directionOrder has no entry for "${dir}"`)
        return
      }
      for (let f = 0; f < clip.framesPerDirection; f++) {
        const col = clip.start + bandIndex * clip.framesPerDirection + f
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

// ----------------------------------------------------------------- vehicles

/**
 * Vehicles: one row BAND per direction, not four clips in one band.
 *
 * A third layout in the same project. The humanoids are 32x64 on stacked row
 * pairs, the animals are four direction clips side by side in one band at a
 * 64 or 96px pitch, and this is 192x192 frames stacked by direction. Every one
 * of them was measured; none of them could have been assumed from the others.
 */
const vehicles = manifest.vehicles
if (vehicles) {
  for (const [id, cfg] of Object.entries(vehicles.sheets ?? {})) {
    const path = vehicles._base + cfg.path
    let sheet: Image
    try {
      sheet = decodePng(readFileSync(path))
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`)
      continue
    }
    const fw = vehicles.frameWidth
    const fh = vehicles.frameHeight
    clipLengths[id] = { walk: vehicles.framesPerDirection, idle: 1 }

    for (const dir of rig.directions) {
      const bandIndex = vehicles.directionOrder.indexOf(dir)
      if (bandIndex < 0) {
        errors.push(`${path}: directionOrder has no entry for "${dir}"`)
        continue
      }
      const bandY = (cfg.firstBand + bandIndex) * fh
      if (bandY + fh > sheet.height) {
        errors.push(`${path}: band for "${dir}" runs past the bottom of the sheet`)
        continue
      }
      for (let f = 0; f < vehicles.framesPerDirection; f++) {
        const sx = f * fw
        const b = contentBounds(sheet, sx, bandY, fw, fh)
        if (b.empty) {
          errors.push(`${path}: walk ${dir} frame ${f} is empty`)
          continue
        }
        const frame = {
          name: `${id}.walk.${dir}.${f}`,
          img: sheet,
          sx: b.x, sy: b.y, sw: b.w, sh: b.h,
          ox: b.x - (sx + fw / 2),
          oy: b.y - (bandY + fh),
        }
        pending.push(frame)
        if (f === 0) pending.push({ ...frame, name: `${id}.idle.${dir}.0` })
      }
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

interface SingleGroup {
  _base: string
  files: Record<string, string>
  conform?: boolean
  /**
   * Skip the weapon-size assertion for this group.
   *
   * That assertion catches multi-tile "_Load_" piles in the LimeZu packs, where
   * an oversized icon means the WRONG FILE was picked. Generated card art is
   * legitimately 44-62px — a card window zooms by integers and wants the detail
   * — so the same number would be measuring a different thing and rejecting
   * correct art. Scoped by group rather than loosened for everyone, because the
   * pack assertion is still worth having.
   */
  cardArt?: boolean
  /**
   * Pack the whole image, do not trim to content bounds.
   *
   * A strip animated with `steps(n)` divides its width by n, so the packed
   * width MUST be an exact multiple of the cell. Trimming a 192px six-frame
   * strip down to its content leaves 188px, 188/6 is not an integer, and every
   * step lands a fraction off — the character slides instead of stepping. Only
   * strips need this; a trimmed single sprite is strictly better.
   */
  noTrim?: boolean
}

const singleGroups = [
  manifest.singles, manifest.singlesExtra, manifest.weapons, manifest.weaponsFarmTools,
  manifest.nodes, manifest.biome, manifest.nodeTrees, manifest.tools, manifest.weaponTiers,
  manifest.pixellab ? { ...manifest.pixellab, cardArt: true } : undefined,
  manifest.scene ? { ...manifest.scene, cardArt: true } : undefined,
  manifest.sceneStrips ? { ...manifest.sceneStrips, cardArt: true, noTrim: true } : undefined,
  manifest.portraits,
].filter(Boolean) as SingleGroup[]

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
  const b = group.noTrim
    ? { x: 0, y: 0, w: img.width, h: img.height, empty: false }
    : contentBounds(img, 0, 0, img.width, img.height)
  if (b.empty) {
    errors.push(`${path}: entirely transparent`)
    continue
  }
  if (!group.cardArt && name.startsWith('weapon.') && (b.w > WEAPON_MAX_W || b.h > WEAPON_MAX_H)) {
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

// ------------------------------------------------------- generated fx
//
// NOT conformed to the house palette, unlike the pack FX above.
//
// Conforming exists to drag a bought sheet onto our palette. These were
// generated in the house style already, and the palette is authored for
// terrain and creatures — it has no coverage for an electric blue arc, so
// quantising would send those pixels to the nearest thing it does have. That
// is the "explosion turning magenta" failure ART_STYLE records, and the fix is
// not to quantise art that never left the palette.
if (manifest.pixellabFx) {
  const cfg = manifest.pixellabFx
  for (const [name, clip] of Object.entries(cfg.clips)) {
    const dir = `${cfg._base}${clip.dir}`
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
    } catch (e) {
      errors.push(`${dir}: ${(e as Error).message}`)
      continue
    }
    let packed = 0
    for (const f of files) {
      let img: Image
      try {
        img = decodePng(readFileSync(`${dir}/${f}`))
      } catch (e) {
        errors.push(`${dir}/${f}: ${(e as Error).message}`)
        continue
      }
      const b = contentBounds(img, 0, 0, img.width, img.height)
      if (b.empty) break
      /*
         Drop a frame that has COLLAPSED INTO A SOLID BLOCK.

         The animator's failure mode is a final frame that comes back as a flat
         rectangle of colour — the muzzle flash returned eight good frames and a
         tan square. It is not transparent, so the empty check above misses it,
         and it would flash a filled rectangle over the game on the last frame
         of every shot.

         Bounds alone cannot catch it: an effect legitimately fills its canvas,
         and frames 0-2 of that same muzzle flash do. What separates them is
         measured — the good frames are 43-56% transparent with ~20 colours, the
         bad one is 7% transparent with 4. Both conditions together, so a dense
         explosion is never mistaken for a failure.
      */
      let clear = 0
      const hues = new Set<number>()
      for (let p = 0; p < img.data.length; p += 4) {
        if (img.data[p + 3] < 9) clear++
        else hues.add((img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2])
      }
      const px = img.width * img.height
      if (clear / px < 0.15 && hues.size <= 8) break
      pending.push({
        name: `fx.${name}.${packed}`,
        img,
        sx: b.x, sy: b.y, sw: b.w, sh: b.h,
        ox: b.x - img.width / 2,
        oy: b.y - img.height / 2,
      })
      packed++
    }
    if (!packed) { errors.push(`pixellabFx ${name}: no usable frames in ${dir}`); continue }
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

// ------------------------------------------------------------------ tilesets
//
// Wang tilesets from `create_topdown_tileset`, packed straight out of their own
// metadata rather than from coordinates typed here.
//
// TWO FIELDS IN THAT METADATA LOOK LIKE SHEET POSITIONS AND ARE NOT: `wang_N`
// is a NAME, and `original_position` is the generation grid, whose row can
// exceed this sheet entirely. The API's own note says using either is what
// produces horizontal banding. `bounding_box` is the rect, and it is the only
// one that is.
//
// Packed untrimmed for the reason every tile is: a 32px tile trimmed to its
// content is no longer 32px, and every repeat of it gaps.
const TILESET_DIR = 'assets/tilesets'
if (existsSync(TILESET_DIR)) {
  const cornerBit = (v: string): Corner => (v === 'upper' ? 1 : 0)
  for (const file of readdirSync(TILESET_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const set = file.replace(/\.json$/, '')
    const png = `${TILESET_DIR}/${set}.png`
    let img: Image
    try {
      img = decodePng(readFileSync(png))
    } catch (e) {
      errors.push(`${png}: ${(e as Error).message}`)
      continue
    }
    const meta = JSON.parse(readFileSync(`${TILESET_DIR}/${file}`, 'utf8')) as {
      tileset_data?: {
        tiles?: { corners: Record<string, string>; bounding_box: { x: number; y: number; width: number; height: number } }[]
      }
    }
    /*
       CONFORMED TO THE HOUSE PALETTE, and the palette is why it works now.

       `create_topdown_tileset` has a hard prior for bright saturated green and
       will not be talked out of it — "dry muted sage green, dusty, desaturated"
       still came back arcade. Quantising was the obvious answer and it FAILED
       the first time, making the grass flatter and more saturated: conform
       matches a palette, it cannot shift one, and the palette was sampled from
       the LimeZu sheets, which are full of saturated green.

       `art/palette.json` is authored now (see its own note). Muted daylight is
       in the palette, so conform delivers it whatever the model returns — which
       is the only way to get a consistent look out of a generator that has its
       own opinions.
    */
    try {
      makeQuantiser(loadPalette()).conform(img)
    } catch (e) {
      errors.push(`${png}: ${(e as Error).message}`)
    }

    const tiles = meta.tileset_data?.tiles ?? []
    const got = new Set<string>()
    for (const t of tiles) {
      const c = t.corners
      const b = t.bounding_box
      const name = wangKey(set, cornerBit(c.NW), cornerBit(c.NE), cornerBit(c.SW), cornerBit(c.SE))
      got.add(name)
      pending.push({
        name,
        img,
        sx: b.x, sy: b.y, sw: b.width, sh: b.height,
        // A tile is drawn from its BOX, never from a pivot.
        ox: 0, oy: 0,
      })
    }
    // All sixteen corner combinations or the bake has a hole it will draw as a
    // missing sprite in the middle of the ground. Better to fail the build.
    const missing = wangKeysFor(set).filter((k) => !got.has(k))
    if (missing.length) {
      errors.push(`${png}: tileset is incomplete — missing ${missing.length} of 16 corner combinations (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''})`)
    }
  }
}

// -------------------------------------------------------------------- pack

// Shelf packer, tallest first. The atlas is built once offline and every frame
// is a similar small rectangle, so the packing quality of anything cleverer
// would not pay for itself.
pending.sort((a, b) => b.sh - a.sh || b.sw - a.sw)

/*
   2048, not 1024, and the reason is shape rather than size.

   The eight-direction animals add ~2,400 frames to ~1,860, and at 1024 wide
   that packs to 1024x16384 — measured, not estimated. The AREA is fine either
   way; a 16384 dimension is not. It is past the max texture size a lot of
   hardware will take, and iOS Safari caps a canvas by area at around the same
   number, so the tall page is the one that risks failing to allocate on a
   machine that would happily hold the pixels in a different shape.

   Widening halves the height for the same pixels: 2048x8192, both dimensions
   inside limits everywhere. Nothing reads the width as a constant — the
   renderer takes it from atlas.json and every frame carries absolute coords —
   so this is safe to change again if the atlas keeps growing.
*/
const width = 2048
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

// ------------------------------------------------------------------- ui
//
// The UI is DOM, not canvas, so its art cannot live in the atlas — CSS needs
// real files. LimeZu's Modern UI pack is the same hand as the farm tiles, so
// the screens can match the game exactly with no conforming at all.
//
// Emitted rather than committed for the same reason as the atlas: generated
// art stays out of the repo, and `npm run atlas` is still the one build step.
mkdirSync('public/ui', { recursive: true })
try {
  const uiSheet = decodePng(readFileSync('assets/modern-ui/32x32/Modern_UI_Style_1_32x32.png'))
  // The ornate wood frame, measured not guessed. Used as a CSS border-image,
  // which is exactly the 9-slice this art was drawn for.
  const panel = blankImage(64, 62)
  blit(uiSheet, 16, 16, 64, 62, panel, 0, 0)
  writeFileSync('public/ui/panel.png', encodePng(panel))
  console.log('ui: public/ui/panel.png 64x62')
} catch (e) {
  void e
}

/*
   The rarity plate, emitted as a FILE rather than packed.

   The UI is DOM and CSS needs a real URL, which is the same reason panel.png
   is emitted above. Generated at 192x32 against the real destination — a
   banner spanning a 210px card at 30px tall — after a first attempt produced
   24x30 badges for it and cost about 120 generations for art nothing could
   use. Measure the destination before generating chrome.
*/
try {
  const plate = decodePng(readFileSync('assets/pixellab/ui/plate.png'))
  writeFileSync('public/ui/plate.png', encodePng(plate))
  console.log(`ui: public/ui/plate.png ${plate.width}x${plate.height}`)
} catch (e) {
  // A missing UI pack costs the chrome, not the game — the CSS has colour
  // fallbacks for every border-image.
  console.warn('ui pack unavailable, screens fall back to flat panels:', (e as Error).message)
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
      // Sheets that are NOT on the humanoid rig. A sheet absent from here uses
      // the rig's four directions, so every existing sheet is untouched.
      dirSets,
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
