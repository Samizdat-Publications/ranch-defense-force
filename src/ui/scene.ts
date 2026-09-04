/**
 * The two home-screen backdrops: the Whitacre yard and the Whitacre field,
 * both at dusk.
 *
 * ## Where this comes from
 *
 * `docs/reference/Whitacre Yard at Dusk.html` and `Whitacre Field at Dusk.html`
 * are Design's own runtime-bundled scenes. **They are the target, and this file
 * is a layer-for-layer port of them.** Every number here was read out of those
 * two documents, not composed by eye and not inferred from a table.
 *
 * That distinction cost this project a whole session. `docs/mockups/PLACEMENTS.md`
 * lists the scenes' `<img>` placements — and only those. It has no sky, no sun,
 * no clouds, no ground, no barn, no farmhouse, no porch light, no chimney smoke,
 * no walking actors, no fireflies and no vignette, because those are CSS layers
 * rather than sprites. A build made faithfully from that table measures correct
 * against it and is still missing two thirds of the picture. The table is an
 * index of the sprites; the reference document is the scene.
 *
 * ## The rules the scenes are built to
 *
 * - **A fixed 1920x1080 stage, letterboxed.** Every number below is a stage
 *   pixel. The stage scales as one unit, so there are no breakpoints anywhere in
 *   this screen — the interface lives in the same coordinate space.
 * - **NOTHING THAT MOVES GOES IN x 0-430 ABOVE y 726.** The left third is
 *   reserved for print. The class panel is only 78% opaque, so anything behind
 *   it ghosts through and reads as a rendering fault rather than as scenery.
 * - **Integer zoom only.** Scenery is 1x and actors are 2x; that difference is
 *   the depth cue that makes the place read as a place. If something wants to be
 *   smaller, it moves further away — it does not scale.
 * - **Strip offsets are pixels, never percentages.** `-600%` on a six-frame
 *   strip lands frame 0 and then five blanks.
 * - **DOM order is paint order.** The order of the calls in `yard()` and
 *   `field()` is the reference's order and is load-bearing: the fence band
 *   paints over the actors that walk behind it, the crop rows paint over the
 *   tractor working between them.
 *
 * The scene sprites are packed **untrimmed** (`noTrim` on the `scene` group in
 * `art/sprites.json`). Design's coordinates are the top-left of each sprite's
 * FULL box, so a trimmed frame draws at the right place with the wrong offset —
 * silently. The scarecrow trimmed 96x96 down to 84x78 and stood twelve pixels
 * left and eighteen high of where it belongs, and so did every other prop.
 */
import { el } from './dom'
import { spriteEl, spriteTileUrl, frameOf, stripUrl, groundWrap, sceneSprite as rawSceneSprite } from './sprite'
// Re-exported so a scene has one place to import from. `sceneSprite` is the
// STILL counterpart of `groundActor` below: exact height, feet on the ground.
export { sceneSprite } from './sprite'

export type SceneKind = 'yard' | 'field' | 'lab' | 'barn'

/** The two scenes that are above ground. The lab is the third and it is below. */
export const SURFACE_SCENES: readonly SceneKind[] = ['yard', 'field']

/**
 * How deep the soil between a surface scene and the lab is, in stage pixels.
 *
 * The lab is "secretly right under the farm", so the descent is a real distance
 * rather than a cut. 520 is a little under half a stage: long enough that the
 * pan reads as going DOWN through something, short enough that three seconds of
 * it is not three seconds of brown.
 */
export const SOIL_H = 520

/** Edge colours the letterbox bleeds with. The scene's own top and bottom. */
export const BLEED: Record<SceneKind, { top: string; bottom: string }> = {
  yard: { top: '#191b36', bottom: '#191d13' },
  field: { top: '#1d2140', bottom: '#201e13' },
  // The lab has no sky. Both edges are the room it is in.
  lab: { top: '#0d1014', bottom: '#0a0c0f' },
  // Nor has the barn. Dark boards above, straw-strewn floor below.
  barn: { top: '#191410', bottom: '#20180f' },
}

/**
 * The Homestead entrance, in stage pixels: the barn's own doorway.
 *
 * Yard barn sits at (1096, 410) and its door at (196, 148) within it; field
 * barn at (1208, 340) with the same door offset. These are derived from those
 * two facts rather than typed, so moving a barn moves its door.
 */
const YARD_BARN = { x: 1096, y: 410 }
const FIELD_BARN = { x: 1208, y: 340 }
const BARN_DOOR = { x: 196, y: 148, w: 92, h: 76 }

/* Underground there is no barn. The way out is the lift, `base.lift3` at
   (820, 244) in a 256 box -- so the door is its centre, at its foot. */
const LAB_LIFT = { x: 820, y: 244, size: 256 }

/* The barn's own doorway, seen from INSIDE: the spill of dusk on the floor at
   the near end of the aisle. The yard's barn door is at stage y 558 and this is
   its other side, so the two screens meet at the same threshold. */
const BARN_MOUTH = { x: 960, y: 1004 }

export const DOOR: Record<SceneKind, { x: number; y: number }> = {
  yard: { x: YARD_BARN.x + BARN_DOOR.x, y: YARD_BARN.y + BARN_DOOR.y + BARN_DOOR.h + 10 },
  field: { x: FIELD_BARN.x + BARN_DOOR.x, y: FIELD_BARN.y + BARN_DOOR.y + BARN_DOOR.h + 10 },
  lab: { x: LAB_LIFT.x + LAB_LIFT.size / 2, y: LAB_LIFT.y + LAB_LIFT.size },
  /* You are already inside the barn. The way out is the doorway you came in
     by, which this scene draws as the light on the floor at BARN_MOUTH. */
  barn: { x: BARN_MOUTH.x, y: BARN_MOUTH.y },
}

/**
 * The band of the stage the UI owns, in stage pixels.
 *
 * `.home-rail` sits at `bottom: 52px` and a `.hero` card is 196 wide by about
 * 283 tall, six of them with 16px gaps and centred. So the class cards cover
 * roughly x 332-1588, y 735-1028, and anything a scene puts there is composed
 * but never seen.
 *
 * Design's artboards are composed WITHOUT the UI over them, which is the right
 * way round -- a backdrop should be a whole picture -- but it means a placement
 * inside this box needs a decision rather than a transcription. Joy was the
 * first one to need it and will not be the last.
 */
export const UI_RAIL = { x: 332, y: 735, w: 1256, h: 293 } as const

// -------------------------------------------------------------- the blight

/**
 * WHAT THE PLACE LOOKS LIKE AFTER THE LIGHTNING.
 *
 * The home screen's sequence turns the farm over: three white flashes, and then
 * every living thing in the scene is its blighted twin. The art for most of
 * them was generated sessions ago and has been sitting in the atlas unused --
 * nineteen `*Blight` sheets plus the cursed roster plus the turned staff.
 *
 * ## The flag is module state, deliberately
 *
 * `yard()` and `field()` are one long push list each, ported layer for layer
 * from Design's documents. Threading a `blight` argument through forty call
 * sites would rewrite both of them and make every future diff against the
 * reference harder to read. `buildScene` sets this, builds, and clears it; the
 * build is synchronous and `buildScene` is the only door in.
 *
 * ## Two ways a thing gets blighted, and the second one is the fallback
 *
 * 1. **A sheet swap**, for anything drawn from a packed clip. Same clip, same
 *    direction, same HEIGHT -- `sceneSprite`/`groundActor` semantics mean the
 *    blighted Joy is exactly as tall as Joy was, even though `joyBlight`'s
 *    frames are 42px where `joy`'s walk is 50. Sizes differ across every one of
 *    these sheets; heights do not, because heights are what the scene asks for.
 * 2. **A colour filter**, for everything with no counterpart: the buildings, the
 *    windmill, the scarecrow, the wheat, the tractor, the treeline. Desaturate,
 *    darken, tint green. Stated as a class rather than applied to the whole
 *    scene root, so a swapped sprite is never double-treated.
 *
 * ## The scarecrow, which used to be what was NOT here
 *
 * It filtered, and the note in this place said why: `rdf-scene-scarecrow-wrong`
 * held four candidates of "a scarecrow gone wrong", generated and paid for in
 * session 15 and never downloaded. The 2026-09-03 inventory audit did the
 * downloading. `1cb96ac6` is packed as `scarecrowBlight.idle.down.0` and is in
 * `BLIGHT_SHEET` and `BLIGHT_STRIP` below, so the yard's animated scarecrow and
 * the field's baked strip both turn. It is a still where the healthy one sways,
 * which is the fallback ladder working as designed rather than a shortfall.
 *
 * Every key below is asserted against `public/atlas.json` by
 * `npm run blight` -- see tools/check-blight.ts. Do not trust this table
 * because it is written down; session 21's lesson was that a document saying
 * art exists is not evidence that it does, and the reverse is just as true.
 */
const BLIGHT_SHEET: Readonly<Record<string, string>> = {
  joy: 'joyBlight',
  tabbyCat: 'tabbyCatBlight',
  brahmaHen: 'brahmaHenBlight',
  leghornHen: 'leghornHenBlight',
  beardedHen: 'beardedHenBlight',
  silkieHen: 'silkieHenBlight',
  barredHen: 'barredHenBlight',
  polishHen: 'polishHenBlight',
  buffHen: 'buffHenBlight',
  bantamHen: 'bantamHenBlight',
  // `farmRoosterBlight` is idle-only, so a rooster that WALKS becomes the
  // infected hen instead -- see `blightStrip`, which falls back by clip.
  farmRooster: 'farmRoosterBlight',
  // The pony is the one animal with a fully rigged counterpart: `fjordPonyCursed`
  // carries walk, attack, hit and death where `fjordPonyBlight` is a still.
  fjordPony: 'fjordPonyCursed',
  arabian: 'arabianCursed',
  blackMule: 'blackMuleBlight',
  beigeMule: 'beigeMuleBlight',
  rosie: 'rosieBlight',
  wiz: 'wizBlight',
  ouiji: 'ouijiBlight',
  siameseCat: 'siameseCatBlight',
  // Not an animal, and the only entry here that is not: the yard's scarecrow is
  // drawn by `clipActorAt('scarecrow', 'sway', ...)`, so its counterpart has to
  // be a SHEET like the rest of them. `scarecrowBlight` carries `idle` only and
  // `blightStrip`'s clip ladder lands on it.
  scarecrow: 'scarecrowBlight',
}

/** Second choice when the first sheet has no walk: the fully rigged infected. */
const BLIGHT_SPARE: Readonly<Record<string, string>> = {
  farmRooster: 'infectedHen',
  brahmaHen: 'infectedHen',
  leghornHen: 'infectedHen',
  fjordPony: 'fjordPonyBlight',
}

/**
 * The field's baked `scene.*` strips, and who they turn into.
 *
 * These are the one case where the swap is not like for like: the strips are
 * pre-composed PNGs on a 32x64 (or 32x32) cell, and the counterparts are packed
 * character clips on their own cells. `sceneStrip` keeps the BOX so the actor
 * lands where the reference put it; the figure inside it is the turned one.
 */
const BLIGHT_STRIP: Readonly<Record<string, { sheet: string; clip: string; dir: string }>> = {
  'scene.farmerIdleBreatheStrip': { sheet: 'farmhandBlight', clip: 'idle', dir: 'down' },
  'scene.farmer2IdleBreatheStrip': { sheet: 'bloatedFarmhand', clip: 'idle', dir: 'down' },
  'scene.farmerWalkStrip': { sheet: 'farmhandBlight', clip: 'walk', dir: 'left' },
  'scene.chickenPeckStrip': { sheet: 'infectedHen', clip: 'idle', dir: 'down' },
  'scene.chickenWalkLeftStrip': { sheet: 'infectedHen', clip: 'walk', dir: 'left' },
  // The one entry here that is not a figure. The field's scarecrow is a seven
  // frame baked sway on a 96 cell; its counterpart is a single still on a 96
  // cell, so `blightBox`'s scale comes out at exactly 1 and it lands in the
  // reference's box without any arithmetic at all.
  'scene.scarecrowSwayStrip': { sheet: 'scarecrowBlight', clip: 'idle', dir: 'down' },
}

/** True while `buildScene` is building a blighted scene. See BLIGHT_SHEET. */
let BLIGHT = false

/** The class that carries the fallback grade. Styled in home.css. */
const FALLBACK = 'is-blighted'

/**
 * Resolve a clip through the blight, by sheet and then by clip.
 *
 * The sheets do not all carry the same clips: `brahmaHenBlight` walks but does
 * not peck, `farmRoosterBlight` and `joyBlight` are idle-only stills. So the
 * order is: the same clip on the blighted sheet, then the spare sheet's version
 * of it, then `walk`, then `idle`. A blighted farm being STILLER than the farm
 * was is the right failure, which is why `idle` is the last resort rather than
 * giving up and drawing the healthy animal.
 */
function blightStrip(
  sheet: string, clip: string, dir: string,
): { url: string; cell: number; frames: number } | null {
  if (!BLIGHT) return stripUrl(sheet, clip, dir)
  const sheets = [BLIGHT_SHEET[sheet], BLIGHT_SPARE[sheet]].filter((s): s is string => !!s)
  if (sheets.length === 0) return null
  for (const s of sheets) {
    for (const c of [clip, 'walk', 'idle']) {
      const hit = stripUrl(s, c, dir)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Desaturate, darken, tint green: what a thing with no blighted twin gets.
 *
 * `sepia` then `hue-rotate` rather than a green overlay, because an overlay
 * flattens the art it covers and this has to sit under a scene that is already
 * two vignette passes deep. Sepia pushes everything onto one warm axis and the
 * rotation swings that axis into the green — the standard trick, and the only
 * one that keeps pixel edges rather than veiling them.
 */
const BLIGHT_FILTER = 'saturate(0.25) brightness(0.78) sepia(0.55) hue-rotate(55deg)'

/**
 * Mark an element for the fallback grade when there is no blighted art.
 *
 * COMPOSED INTO THE INLINE FILTER, not left to a stylesheet rule. Half the
 * scene already carries an inline `filter` -- the treeline's blur, the wheat
 * bands' blur, every plate's brightness -- and an inline declaration beats a
 * class every time. A rule in home.css would have silently done nothing to
 * exactly the layers that most need it.
 */
function graded<T extends HTMLElement | null>(e: T): T {
  if (e && BLIGHT) {
    e.classList.add(FALLBACK)
    const own = e.style.filter
    e.style.filter = own ? `${own} ${BLIGHT_FILTER}` : BLIGHT_FILTER
  }
  return e
}

// --------------------------------------------------------------- primitives

/** A bare positioned div carrying literal CSS. The scene's sky, light and air. */
function box(css: string): HTMLElement {
  const d = document.createElement('div')
  d.style.cssText = `position:absolute;${css}`
  return d
}

/**
 * One sprite at an integer zoom, placed by the top-left of its full box.
 *
 * Returns null when the atlas has no frame — a missing sprite costs its own
 * layer and nothing else. The screen is built at module load and the atlas
 * resolves later, so this runs twice and only the second run draws.
 */
function sprite(
  name: string, x: number, y: number, zoom = 1, css = '',
): HTMLElement | null {
  const s = spriteEl(name, 4096, zoom)
  if (!s) return null
  s.style.position = 'absolute'
  s.style.left = `${x}px`
  s.style.top = `${y}px`
  if (css) s.style.cssText += css
  return graded(s)
}

/**
 * A band of one tile repeated horizontally.
 *
 * A tiled band needs a STANDALONE tile texture, never an atlas window: pointing
 * `background-repeat` at the atlas repeats the entire atlas, and the first
 * version of the ground band came out as a wall of every sprite in the game.
 */
function tileBand(name: string, css: string, tileW: number, tileH: number): HTMLElement | null {
  const url = spriteTileUrl(name)
  if (!url) return null
  return graded(box(
    `background-image:url('${url}');background-size:${tileW}px ${tileH}px;` +
    `background-repeat:repeat-x;image-rendering:pixelated;${css}`,
  ))
}

/**
 * A stepped walk strip, drawn at an integer zoom.
 *
 * `sheetW`/`sheetH` are the strip's size ON SCREEN — native size times the
 * zoom — and the frame is `sheetW / frames` wide. The keyframe scrolls by
 * exactly `sheetW` pixels, which is why the strips are packed untrimmed: a
 * 192px six-frame strip trimmed to 188px makes 188/6 fractional and the walk
 * slides instead of stepping.
 */
function stripActor(
  name: string,
  opts: {
    w: number; h: number; sheetW: number; sheetH: number
    frames: number; dur: string; keyframe: string; delay?: string
  },
): HTMLElement | null {
  const url = spriteTileUrl(name)
  if (!url) return null
  const d = document.createElement('div')
  d.style.cssText =
    `width:${opts.w}px;height:${opts.h}px;background-image:url('${url}');` +
    `background-size:${opts.sheetW}px ${opts.sheetH}px;background-repeat:no-repeat;` +
    // Published for the generic `y-strip` keyframe, which scrolls by exactly
    // this much. Set unconditionally so any strip can use either keyframe.
    `--strip-w:${opts.sheetW}px;` +
    `image-rendering:pixelated;` +
    `animation:${opts.keyframe} ${opts.dur} steps(${opts.frames}) infinite${opts.delay ? ` ${opts.delay}` : ''}`
  return d
}

/**
 * An animated actor, at an exact height, standing on the ground.
 *
 * This is `clipActor` with the two things a SCENE needs and a card does not.
 *
 * **It positions by the FEET.** `clipActor` takes a `top`, which puts the
 * sprite's head somewhere and tells you nothing about where it stands. `footY`
 * is the ground line the animal is standing on, which is the only y a scene
 * actually cares about -- and in a low top-down scene it is also the depth, so
 * sorting by `footY` sorts back-to-front for free.
 *
 * **It scales to `height` exactly, fractional zoom included.** `clipActor`'s
 * integer `zoom` cannot hit a target size, and every animal here is authored on
 * the same 32x64 grid, so integer zoom renders a cat and a mule at the same
 * fifty pixels. See `sceneSprite` in ui/sprite.ts for the long version; the
 * heights to pass are the `draw at` column in docs/ASSET_CATALOG.md.
 *
 * And it gets a contact shadow, because *"everything is in the air"* was the
 * note the first title screens came back with, and one soft ellipse is the
 * entire fix.
 */
export function groundActor(
  sheet: string, clip: string, dir: string,
  x: number, footY: number, height: number, dur: string, delay?: string,
): HTMLElement | null {
  const swap = BLIGHT ? blightStrip(sheet, clip, dir) : null
  const strip = swap ?? stripUrl(sheet, clip, dir)
  if (!strip) return null
  const scale = height / strip.cell
  const w = strip.cell * scale
  const sheetW = w * strip.frames
  const d = document.createElement('div')
  d.style.cssText =
    `width:${w}px;height:${w}px;background-image:url('${strip.url}');` +
    `background-size:${sheetW}px ${w}px;background-repeat:no-repeat;` +
    `--strip-w:${sheetW}px;image-rendering:pixelated;` +
    `animation:y-strip ${dur} steps(${strip.frames}) infinite${delay ? ` ${delay}` : ''}`
  const wrap = groundWrap(d, w)
  wrap.style.position = 'absolute'
  wrap.style.left = `${Math.round(x - w / 2)}px`
  wrap.style.top = `${Math.round(footY - w)}px`
  // Depth IS the ground line in a scene like this, so sorting is free.
  wrap.style.zIndex = String(Math.round(footY))
  return BLIGHT && !swap ? graded(wrap) : wrap
}

/** A travelling wrapper: where an actor starts, and the path it walks. */
function travelling(x: number, y: number, anim: string, child: HTMLElement | null): HTMLElement | null {
  if (!child) return null
  const wrap = box(`left:${x}px;top:${y}px;animation:${anim}`)
  wrap.append(child)
  return wrap
}

/**
 * A generated actor strip, placed by its top-left like every other scene sprite.
 *
 * `npm run anim` writes one cell per frame at the SOURCE SPRITE'S OWN SIZE, so
 * the only numbers needed here are the cell and the frame count — and that tool
 * prints both when it assembles the strip. Everything else derives, which is
 * the point: a sheet width typed by hand is a number that fails silently by
 * sliding the animation instead of stepping it.
 *
 * These replaced `y-bob`, a CSS float that made a frozen sprite hover. A bob is
 * what you do when the art cannot move; it should not survive art that can.
 */
function actor(
  name: string, x: number, y: number,
  cellW: number, cellH: number, frames: number,
  dur: string, zoom = 1, delay?: string,
): HTMLElement | null {
  const opts = {
    w: cellW * zoom, h: cellH * zoom,
    sheetW: cellW * frames * zoom, sheetH: cellH * zoom,
    frames, dur, keyframe: 'y-strip', delay,
  }
  const s = travelStrip(name, opts)
  if (!s) return null
  s.style.cssText += `position:absolute;left:${x}px;top:${y}px`
  return s
}

/**
 * A blighted figure standing in a baked strip's box.
 *
 * The field's people and hens are pre-composed PNG strips on a 32x64 or 32x32
 * cell; their counterparts are packed clips on cells of their own (a farmhand
 * is 54, an infected hen 65). So the BOX is kept -- it is the reference's
 * placement -- and the figure is scaled to the box's height and centred in it,
 * bottom-aligned, so the feet land on the line the original stood on. Passing
 * the cell width instead would put a blighted farmhand's feet 12px up in the
 * air, which is session 19's whole lesson wearing different clothes.
 */
function blightBox(
  name: string, w: number, h: number, dur: string, delay?: string,
): HTMLElement | null {
  const m = BLIGHT_STRIP[name]
  if (!m) return null
  const strip = stripUrl(m.sheet, m.clip, m.dir)
  if (!strip) return null
  const scale = h / strip.cell
  const fw = strip.cell * scale
  const sheetW = fw * strip.frames
  const wrap = document.createElement('div')
  wrap.style.cssText = `position:relative;width:${w}px;height:${h}px`
  const d = document.createElement('div')
  d.style.cssText =
    `position:absolute;left:${Math.round((w - fw) / 2)}px;top:0;width:${fw}px;height:${fw}px;` +
    `background-image:url('${strip.url}');background-size:${sheetW}px ${fw}px;` +
    `background-repeat:no-repeat;--strip-w:${sheetW}px;image-rendering:pixelated;` +
    `animation:y-strip ${dur} steps(${strip.frames}) infinite${delay ? ` ${delay}` : ''}`
  wrap.append(d)
  return wrap
}

/** A baked `scene.*` strip, or the thing it turns into. Same box either way. */
function travelStrip(
  name: string,
  opts: {
    w: number; h: number; sheetW: number; sheetH: number
    frames: number; dur: string; keyframe: string; delay?: string
  },
): HTMLElement | null {
  const turned = BLIGHT ? blightBox(name, opts.w, opts.h, opts.dur, opts.delay) : null
  if (turned) return turned
  return graded(stripActor(name, opts))
}

/** One firefly. Four in the yard, two in the field; the last thing still awake. */
function firefly(
  x: number, y: number, size: number, glow: number, alpha: number,
  fx: string, fy: string, anim: string,
): HTMLElement {
  return box(
    `left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;` +
    `background:#ffe9a0;box-shadow:0 0 ${glow}px 3px rgba(255,220,130,${alpha});` +
    `--fx:${fx};--fy:${fy};animation:${anim}`,
  )
}

/**
 * The colour grade the blight puts over a surface scene.
 *
 * Two passes and they do different jobs. The multiply carries the CAST -- a
 * green that darkens what is already dark and drags the warm mid-tones toward
 * sick -- and a multiply is what keeps the paper-white highlights from going
 * flat the way a flat overlay would. The second is a plain dim, heavier at the
 * bottom, because the ground is the part the blight came out of.
 *
 * Both are pushed before the vignette, and both go UNDER the two warm lights,
 * which are pushed after them. See `yard()`.
 */
function wash(): HTMLElement[] {
  return [
    box('inset:0;pointer-events:none;mix-blend-mode:multiply;' +
      'background:linear-gradient(180deg,#9cb38e 0%,#87a279 44%,#6b8760 100%)'),
    box('inset:0;pointer-events:none;' +
      'background:linear-gradient(180deg,rgba(10,18,12,0.3) 0%,rgba(8,16,10,0.16) 40%,' +
      'rgba(6,12,8,0.4) 100%)'),
  ]
}

/** The two shaped passes every scene ends with. There is no flat scrim. */
function vignette(radial: string, linear: string): HTMLElement[] {
  return [
    box(`inset:0;pointer-events:none;background:${radial}`),
    box(`inset:0;pointer-events:none;background:${linear}`),
  ]
}

// -------------------------------------------------------------------- yard

/**
 * The yard: the house on the left, the barn in the middle, stock on the right,
 * and the near ground in front of the fence.
 *
 * Built from Design's `Yard Grounding Fix.dc.html` -- the numbers are in
 * `docs/mockups/PLACEMENTS.md`, which `npm run placements` regenerates.
 *
 * ## Why this was rebuilt rather than nudged
 *
 * The previous yard was a port of an older reference and it carried a long
 * note explaining that it had to DISAGREE with the placement table: the table
 * put the treeline at y 268-414, the ground began at 620, and three of four
 * oaks therefore hung a hundred pixels up in the sky. That note ended "ground
 * wins -- it is in the reference and the table is not."
 *
 * The Grounding Fix is Design's answer to exactly that conflict. **The ground
 * moved up to 540**, so the trees now stand ON it, and the whole scene is
 * rebuilt around the new horizon. The table and the ground agree for the first
 * time, so there is nothing left to overrule.
 *
 * ## What "grounding" turned out to mean
 *
 * Every standing thing gets a blurred contact ellipse pushed BEFORE it, so
 * paint order puts the shadow under the object. That is the same fix session 19
 * found for the first title screens -- *"everything is in the air"* -- applied
 * to the props rather than only to the animals, and it is most of why this
 * version reads as a place rather than a collage.
 *
 * The treeline is five oaks at 250x212, blurred 2-2.4px and dimmed to 0.4-0.48
 * opacity. That is not decoration: a sharp tree at the back of a scene reads as
 * a prop standing in the yard. Depth here is entirely blur and value.
 */
function yard(): (HTMLElement | null)[] {
  const L: (HTMLElement | null)[] = []
  const push = (...items: (HTMLElement | null)[]): void => { L.push(...items) }

  /*
     -- the light: a halo, a core, and one slow flicker in nine seconds.

     Under the blight the halo goes and the core becomes a pale disc: the sun is
     still there and it has stopped doing anything. That reads as wrong far
     faster than dimming the whole sky does, because a sky can be night and a
     white sun at dusk cannot be anything.
  */
  push(box(BLIGHT
    ? 'left:792px;top:372px;width:300px;height:300px;border-radius:50%;opacity:0.34;' +
      'background:radial-gradient(circle,#c9d6bd 0%,#8b9a80 30%,rgba(96,110,86,0) 68%);'
    : 'left:792px;top:372px;width:300px;height:300px;border-radius:50%;' +
      'background:radial-gradient(circle,#fff6d6 0%,#ffd884 26%,rgba(255,176,92,0) 66%);' +
      'animation:y-sun 9s ease-in-out infinite',
  ))
  push(box(BLIGHT
    ? 'left:896px;top:452px;width:92px;height:92px;border-radius:50%;opacity:0.7;' +
      'background:radial-gradient(circle,#dfe6d4 0%,#b6c0a6 62%,rgba(150,162,134,0) 100%);'
    : 'left:896px;top:452px;width:92px;height:92px;border-radius:50%;' +
      'background:radial-gradient(circle,#fffbe8 0%,#ffe6a2 58%,rgba(255,214,124,0) 100%);' +
      'animation:y-sun 9s ease-in-out infinite',
  ))

  // -- three cloud bands, each 3040 wide so the drift never shows an end
  push(cloud(128, 34, 0.13, 9, 'rgba(255,220,190,0.55)', 200, 470, '140s'))
  push(cloud(232, 24, 0.12, 7, 'rgba(255,208,170,0.6)', 130, 380, '96s'))
  push(cloud(338, 18, 0.11, 6, 'rgba(255,196,150,0.65)', 90, 300, '70s'))

  // -- a skein crossing the whole sky once every twenty-nine seconds
  push(birds(1990, 296))

  // -- the ground. THE HORIZON IS 540; everything below is field.
  push(box(
    'left:0;right:0;top:540px;bottom:0;' +
    'background:linear-gradient(180deg,#7c744c 0%,#6c6341 5%,#5c5637 13%,#4d4a2f 28%,' +
    '#3c3a26 50%,#2a2a1d 74%,#1a1b13 100%)',
  ))
  push(box(
    'left:0;right:0;top:540px;bottom:0;opacity:0.26;background-image:' +
    'repeating-linear-gradient(92deg,rgba(0,0,0,0.3) 0 4px,transparent 4px 13px)',
  ))
  // The lit lip of the horizon, and the dust hanging over it.
  push(box(
    'left:0;right:0;top:518px;height:54px;filter:blur(11px);' +
    'background:linear-gradient(180deg,rgba(255,214,150,0) 0%,rgba(255,204,136,0.42) 50%,' +
    'rgba(255,186,116,0) 100%)',
  ))
  push(box(
    'left:0;right:0;top:536px;height:148px;filter:blur(6px);' +
    'background:linear-gradient(180deg,rgba(200,174,156,0.44) 0%,rgba(150,132,118,0.26) 34%,' +
    'rgba(100,92,80,0.08) 70%,transparent 100%)',
  ))

  /*
     The treeline, five oaks along the back.

     Blurred and dimmed hard on purpose -- see the header. These are also pushed
     BEFORE the buildings so paint order tucks their trunks behind the barn and
     the house, which is what makes a row of five props read as one treeline.
  */
  const oaks: readonly (readonly [number, number, number, number, number, number])[] = [
    [230, 368, 0.4, 2.4, 0.4, 0.5],
    [520, 360, 0.46, 2, 0.46, 0.58],
    [1130, 364, 0.43, 2.2, 0.43, 0.54],
    [1408, 356, 0.48, 2, 0.48, 0.58],
    [1716, 366, 0.41, 2.4, 0.41, 0.5],
  ]
  for (const [x, y, op, blur, bright, sat] of oaks) {
    push(plate('scene.treeOak', x, y, 212,
      `opacity:${op};filter:blur(${blur}px) brightness(${bright}) saturate(${sat});`))
  }

  // -- the buildings, each on its own contact shadow
  push(shadow(1620, 696, 120, 30, 0.55, 7))
  push(plate('ranch.silo', 1559, 337, 406, 'filter:brightness(0.92) saturate(0.9);'))
  push(shadow(170, 668, 220, 34, 0.5, 7))
  push(plate('ranch.bunkhouse', 132, 453, 290, 'filter:brightness(0.8) saturate(0.86);'))
  push(shadow(1140, 684, 340, 38, 0.55, 8))
  push(plate('ranch.barn', 1079, 476, 257, 'filter:brightness(0.92) saturate(0.94);'))
  /*
     The two warm lights: the barn doorway lit from inside, and the porch lamp.

     THEY ARE THE ONE THING THE BLIGHT DOES NOT TAKE. Everything else in the
     yard goes green and dim; the porch light stays the colour it was, and that
     is what makes the rest read as wrong rather than as night. So when the
     scene is blighted they are built here and pushed at the END, over the green
     wash, instead of in place under it.
  */
  const doorGlow = (): HTMLElement => box(
    'left:1246px;top:606px;width:132px;height:100px;' +
    'background:radial-gradient(60% 60% at 50% 66%,rgba(255,206,120,0.6),transparent 72%);' +
    'animation:y-door 3.6s ease-in-out infinite',
  )
  const porchGlow = (): HTMLElement => box(
    'left:566px;top:560px;width:140px;height:140px;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,214,140,0.6) 0%,rgba(255,190,110,0.18) 42%,' +
    'transparent 72%);animation:y-porch 11s ease-in-out infinite',
  )
  if (!BLIGHT) push(doorGlow())
  push(shadow(500, 680, 280, 34, 0.52, 7))
  push(plate('ranch.farmhouse', 405, 254, 544, 'filter:brightness(0.86) saturate(0.9);'))
  if (!BLIGHT) push(porchGlow())
  push(smoke(18, 0.5, 4), smoke(22, 0.42, 5, '2.5s'), smoke(15, 0.46, 3, '5s'))

  push(shadow(822, 676, 112, 26, 0.5, 6))
  push(clipActorAt('windmill', 'spin', 'down', 806, 510, 188, '4.5s', undefined,
    'filter:brightness(0.86) saturate(0.85);'))

  // The haze that separates the middle distance from the yard proper, and the
  // worn dirt of the yard itself.
  push(box(
    'left:0;right:0;top:656px;height:96px;filter:blur(9px);' +
    'background:linear-gradient(180deg,rgba(124,114,88,0) 0%,rgba(102,96,74,0.3) 46%,' +
    'rgba(74,70,56,0.04) 100%)',
  ))
  /*
     The track to the barn doors. `docs/mockups/Yard Grounding Fix.dc.html`
     draws this same box with a trapezoid `clip-path` narrowing it to a strip
     as it recedes toward the barn -- a perspective road, not a ground patch.
     The port dropped the clip-path, so the box painted as a hard-edged
     rectangle of a different shade sitting behind the coop, the hens and the
     ponies: "a weird square that's a different shade," reported off the live
     site. Restoring the clip-path is the whole fix.
  */
  push(box(
    'left:900px;top:700px;width:760px;height:380px;opacity:0.7;' +
    'clip-path:polygon(46% 0,55% 0,100% 100%,0 100%);' +
    'background:linear-gradient(180deg,#6a5a3c 0%,#7b6945 36%,#6b5a3a 100%)',
  ))

  push(clipActorAt('scarecrow', 'sway', 'down', 1404, 648, 96, '7.4s'))

  // -- the yard furniture
  push(plate('ranch.roundBale', 605, 657, 107, 'filter:brightness(0.9) saturate(0.94);'))
  push(plate('ranch.squareBales', 729, 743, 21, 'filter:brightness(0.9);'))
  /*
     The doghouse, the well and the coop were all sized off `ranch.*`'s literal
     canvas-and-content maths -- correct against the "a grown person is 64px"
     reference in ASSET_CATALOG.md, and undersized against the animals
     standing next to them, which are DELIBERATELY drawn above life scale (see
     session 19). A hen nearly as tall as the coop door and a cat the height of
     the well are the result. Heights only, feet kept on the same ground line
     (the y below is recomputed from each sprite's own content-to-canvas
     ratio, measured with `tools/bbox-check.ts`, so the content's bottom edge
     -- not the padded canvas edge -- stays put): doghouse 44->58px content,
     well 44->96px ("a person and a half"), coop 90->100px, its box height
     held to 190 rather than pushed further so its content stays clear of the
     barn's own content box instead of lapping into its wall
     (`tools/bbox-check.ts` again).
  */
  push(plate('ranch.doghouse', 825, 676, 73, 'filter:brightness(0.92);'))
  push(plate('ranch.wellStone', 688, 701, 104, 'filter:brightness(0.92) saturate(0.92);'))
  push(plate('ranch.coop', 958, 613, 190, 'filter:brightness(0.88) saturate(0.88);'))
  push(plate('ranch.nestBox', 1085, 722, 32, 'filter:brightness(0.9);'))
  push(plate('ranch.feedPan', 889, 749, 53, 'filter:brightness(0.94);'))
  push(plate('ranch.eggClutch', 1105, 730, 28))
  push(plate('ranch.eggClutch', 985, 786, 28))
  /*
     `scene.nest` -- straw bedding and a nesting box, distinct from the smaller
     `ranch.nestBox` above -- was packed for this yard sessions ago and never
     placed. Set past the coop's right edge, clear of the wandering hens'
     start points and the egg clutches already on the ground here.
  */
  push(plate('scene.nest', 1148, 706, 46, 'filter:brightness(0.9);'))

  // -- the flock. Two peck in place; four wander a fixed beat.
  push(shadow(848, 740, 32, 9, 0.5, 3))
  push(clipActorAt('brahmaHen', 'peck', 'downRight', 856, 708, 40, '1.9s'))
  push(shadow(926, 766, 32, 9, 0.5, 3))
  push(clipActorAt('brahmaHen', 'peck', 'down', 934, 734, 40, '2.3s', '0.6s'))
  push(shadow(1004, 744, 30, 8, 0.48, 3))
  push(still('leghornHen', 'walk', 'down', 1002, 716, 36))
  push(shadow(830, 782, 28, 8, 0.48, 3))
  push(still('beardedHen', 'walk', 'down', 828, 756, 34))
  push(shadow(1042, 792, 26, 8, 0.46, 3))
  push(still('silkieHen', 'walk', 'down', 1040, 770, 30))

  push(wander('barredHen', 'down', 1150, 702, 34, -70, '53s', '0.8s', [3, 27, 28, 8, 0.48]))
  push(wander('polishHen', 'down', 1204, 738, 34, -60, '43s', '0.8s', [3, 27, 28, 8, 0.48]))
  push(wander('farmRooster', 'down', 1264, 702, 46, -90, '67s', '0.9s', [5, 37, 36, 9, 0.5]))
  push(wander('tabbyCat', 'left', 760, 792, 36, -120, '71s', '0.7s', [4, 29, 30, 8, 0.48]))

  // -- the stock
  /*
     `scene.fenceRail` -- a standalone post-and-rail section, distinct from the
     tiled `scene.fencePicket` band nearer the camera -- marks the near corner
     of the stock pen. Packed for this yard and never placed; behind the stock
     tank so paint order reads it as the pen boundary rather than a prop lying
     in the open.
  */
  push(plate('scene.fenceRail', 1600, 706, 90, 'filter:brightness(0.76) saturate(0.9);'))
  push(plate('ranch.stockTank', 1558, 750, 52, 'filter:brightness(0.94);'))
  push(shadow(1468, 792, 76, 16, 0.5, 5))
  push(clipActorAt('fjordPony', 'graze', 'downRight', 1450, 704, 96, '5.3s'))
  push(wander('fjordPony', 'left', 1640, 740, 96, -170, '61s', '1.4s', [14, 82, 70, 16, 0.5]))

  /*
     -- Joy, who sits, walks out, and comes back.

     Design places her at (1372, 770). That is the exact centre of the class
     card rail, so she was invisible in the built screen while being perfectly
     placed in the artboard -- the artboards are composed without the UI over
     them. See `UI_RAIL` below for the band that is not available.

     Moved to her own kennel instead of anywhere merely empty: `ranch.doghouse`
     is at (825, 693), so she sits beside it and her 150px walk takes her out
     past the feed pan and the hens and back. Same behaviour, same beat, and it
     reads better than the original spot did -- a dog by her house is a reason
     to be there.
  */
  push(joy(880, 668, 60))

  /*
     The near fence, and everything in front of it.

     Full width at -20 so neither end shows, and dimmed harder than anything
     else in the scene (0.6) because it is the nearest thing to the camera and
     most deeply in its own shadow.

     TILED, not stretched. The placement table reports this as 1960x32 because
     that is the box it fills in the artboard, but the sprite is a 96x32 TILE --
     handing that width to `plate()` scales one picket across the whole screen
     and it came out as a row of smears. A width in the table is not always a
     size.
  */
  push(tileBand('scene.fencePicket',
    'left:-20px;right:-20px;top:834px;height:32px;filter:brightness(0.6) saturate(0.85)', 96, 32))

  // Wheat in front of the fence, each clump dimmer and slower than the last so
  // the near ground falls away rather than stopping.
  push(clipActorAt('wheat', 'sway', 'down', 1403, 732, 88, '5.1s', undefined,
    'opacity:0.88;filter:brightness(0.8);'))
  push(clipActorAt('wheat', 'sway', 'down', 1563, 772, 88, '6.3s', '1.1s',
    'opacity:0.82;filter:brightness(0.72);'))
  push(clipActorAt('wheat', 'sway', 'down', 303, 820, 88, '8.1s', '2.4s',
    'opacity:0.76;filter:brightness(0.6);'))
  push(clipActorAt('wheat', 'sway', 'down', 1683, 860, 88, '9.7s', '3.6s',
    'opacity:0.7;filter:brightness(0.44);'))
  push(plate('ranch.feedBucket', 487, 858, 52, 'filter:brightness(0.6);'))
  push(plate('ranch.feedBucket', 539, 876, 52, 'filter:brightness(0.54);'))

  // -- the last things still awake
  push(firefly(560, 790, 6, 10, 0.7, '90px', '-120px', 'y-fly 9s ease-in-out infinite'))
  push(firefly(1240, 812, 5, 10, 0.7, '-70px', '-150px', 'y-fly 12s ease-in-out infinite 2s'))
  push(firefly(1660, 786, 6, 12, 0.7, '60px', '-190px', 'y-fly 10.5s ease-in-out infinite 4s'))
  push(firefly(900, 836, 4, 9, 0.6, '120px', '-100px', 'y-fly 14s ease-in-out infinite 1s'))

  push(box(
    'left:0;right:0;top:900px;bottom:0;' +
    'background:linear-gradient(180deg,rgba(8,7,10,0) 0%,rgba(8,7,10,0.6) 38%,rgba(6,6,8,0.95) 100%)',
  ))
  if (BLIGHT) push(...wash(), doorGlow(), porchGlow())
  push(...vignette(
    'radial-gradient(120% 78% at 50% 56%,transparent 42%,rgba(12,10,14,0.56) 100%)',
    'linear-gradient(180deg,rgba(10,9,14,0.44) 0%,transparent 22%,transparent 52%,rgba(10,9,8,0.72) 100%)',
  ))
  return L
}

/** One drifting cloud band, 3040 wide so the loop never shows an end. */
function cloud(
  top: number, h: number, op: number, blur: number,
  colour: string, on: number, off: number, dur: string,
): HTMLElement {
  return box(
    `left:0;top:${top}px;width:3040px;height:${h}px;opacity:${op};filter:blur(${blur}px);` +
    `background:repeating-linear-gradient(90deg,${colour} 0 ${on}px,transparent ${on}px ${off}px);` +
    `animation:y-cloud ${dur} linear infinite`,
  )
}

/** A blurred contact ellipse. The whole of "grounding", one element at a time. */
function shadow(
  x: number, y: number, w: number, h: number, alpha: number, blur: number,
): HTMLElement {
  return box(
    `left:${x}px;top:${y}px;width:${w}px;height:${h}px;filter:blur(${blur}px);` +
    `background:radial-gradient(50% 50% at 50% 50%,rgba(10,10,12,${alpha}),transparent 70%)`,
  )
}

/** One puff off the farmhouse chimney. */
function smoke(size: number, alpha: number, blur: number, delay?: string): HTMLElement {
  return box(
    `left:596px;top:430px;width:${size}px;height:${size}px;border-radius:50%;` +
    `background:rgba(214,206,196,${alpha});filter:blur(${blur}px);` +
    `animation:y-smoke 7.5s linear infinite${delay ? ` ${delay}` : ''}`,
  )
}

/** A skein crossing the whole sky, each bird flapping on its own beat. */
function birds(x: number, y: number): HTMLElement {
  const wrap = box(`left:${x}px;top:${y}px;width:120px;height:60px;animation:ev-birds 29s linear infinite`)
  const marks: readonly (readonly [number, number, number, number, string])[] = [
    [0, 2, 9, 4, '0.9s'], [22, 12, 8, 4, '1.05s'], [41, 26, 7, 3, '0.96s'],
    [18, 34, 7, 3, '1.14s'], [52, 6, 8, 4, '0.86s'],
  ]
  for (const [bx, by, w, h, dur] of marks) {
    wrap.append(box(
      `left:${bx}px;top:${by}px;width:${w}px;height:${h}px;` +
      `background:rgba(40,34,40,0.55);border-radius:50% 50% 0 0;` +
      `animation:ev-flap ${dur} ease-in-out infinite`,
    ))
  }
  return wrap
}

/** A single standing frame of a walk clip -- an animal that is simply there. */
function still(
  sheet: string, clip: string, dir: string, x: number, y: number, height: number,
): HTMLElement | null {
  const l = patrolLayer(sheet, clip, dir, height, '')
  if (!l) return null
  const wrap = box(`left:${x}px;top:${y}px`)
  wrap.append(l)
  return wrap
}

/**
 * An animal that stands a while, walks a leg, and comes back.
 *
 * Three layers on one clock -- stand, walk out, walk back -- over a wrapper
 * carrying `mull-path`, whose distance is this animal's own `--leg`. One
 * keyframe set drives five animals at five different beats, which is why the
 * yard never looks choreographed.
 *
 * The return leg reuses the SAME left-facing walk rather than a right-facing
 * one. Design's table does that deliberately for the hens and the cat: at this
 * size a flipped bird reads as a different bird, and a walk cycle playing while
 * the parent slides back the other way is legible as "coming back" anyway.
 */
function wander(
  sheet: string, idleDir: string, x: number, y: number, size: number,
  leg: number, dur: string, walkDur: string,
  shade: readonly [number, number, number, number, number],
): HTMLElement | null {
  const [sx, sy, sw, sh, alpha] = shade
  const layers = [
    patrolLayer(sheet, 'walk', idleDir, size, `mull-idle ${dur} step-end infinite`),
    patrolLayer(sheet, 'walk', 'left', size, `y-strip ${walkDur} steps(9) infinite, mull-out ${dur} step-end infinite`),
    patrolLayer(sheet, 'walk', 'left', size, `y-strip ${walkDur} steps(9) infinite, mull-back ${dur} step-end infinite`),
  ].filter((l): l is HTMLElement => l !== null)
  if (layers.length === 0) return null
  const wrap = box(
    `left:${x}px;top:${y}px;width:${size}px;height:${size}px;--leg:${leg}px;` +
    `animation:mull-path ${dur} linear infinite`,
  )
  wrap.append(shadow(sx, sy, sw, sh, alpha, 3))
  for (const l of layers) wrap.append(l)
  return wrap
}

/** Joy: sits, gets up and walks right, comes back left, sits again. */
function joy(x: number, y: number, size: number): HTMLElement | null {
  const layers = [
    patrolLayer('joy', 'sit', 'downRight', size, 'y-strip 3.1s steps(9) infinite, joy-sit 43s step-end infinite'),
    patrolLayer('joy', 'walk', 'right', size, 'y-strip 0.62s steps(9) infinite, joy-right 43s step-end infinite'),
    patrolLayer('joy', 'walk', 'left', size, 'y-strip 0.62s steps(9) infinite, joy-left 43s step-end infinite'),
  ].filter((l): l is HTMLElement => l !== null)
  if (layers.length === 0) return null
  const wrap = box(
    `left:${x}px;top:${y}px;width:${size}px;height:${size}px;` +
    'animation:joy-path 43s ease-in-out infinite',
  )
  wrap.append(shadow(8, size - 9, 46, 12, 0.6, 3))
  for (const l of layers) wrap.append(l)
  return wrap
}



/**
 * The far treeline: real oaks, small, hazed, on the horizon line.
 *
 * Spacings and sizes come from the gradient band this replaces — 640px of
 * repeat carrying five trees at roughly 60, 190, 300, 430 and 560 — so the
 * rhythm is Design's and only the art changed. Every oak is drawn at 1x on its
 * own baseline; the varied look comes from spacing and vertical offset rather
 * than from scaling, because scaling a pixel tree is what made the pack's oak
 * unusable in the first place.
 */
function treeline(): HTMLElement | null {
  if (!frameOf('scene.oak')) return null
  const band = box(
    'left:-40px;right:-40px;top:486px;height:82px;opacity:0.5;filter:blur(3px);' +
    'overflow:hidden',
  )
  // Offsets within one 640px repeat: x, and how far the crown sits above the
  // band's floor. Two trees never share both.
  const rhythm = [[60, 0], [190, -6], [300, 4], [430, -10], [560, 2]] as const
  for (let x = -640; x < 2040; x += 640) {
    for (const [dx, dy] of rhythm) {
      const t = sprite('scene.oak', x + dx, 82 - 54 + dy, 1)
      if (t) band.append(t)
    }
  }
  return band
}

// ------------------------------------------------------------------- field

/**
 * The field: the place seen from out in the crop, with the yard reduced to a
 * hazed silhouette on the horizon and a tractor still working the row.
 *
 * Port of `docs/reference/Whitacre Field at Dusk.html`, in its DOM order.
 */
function field(): (HTMLElement | null)[] {
  const L: (HTMLElement | null)[] = []

  // The sun, and the pale disc it becomes. See the same note in `yard()`.
  L.push(box(BLIGHT
    ? 'left:660px;top:400px;width:260px;height:260px;border-radius:50%;opacity:0.42;' +
      'background:radial-gradient(circle,#d3ddc8 0%,#93a288 32%,rgba(102,116,90,0) 68%);'
    : 'left:660px;top:400px;width:260px;height:260px;border-radius:50%;' +
      'background:radial-gradient(circle,#fff6d4 0%,#ffd67e 28%,rgba(255,176,92,0) 66%);' +
      'animation:f-sun 9s ease-in-out infinite',
  ))

  L.push(box(
    'left:0;top:120px;width:3040px;height:26px;opacity:0.2;filter:blur(4px);' +
    'background:repeating-linear-gradient(90deg,rgba(255,222,192,0.55) 0 220px,transparent 220px 500px);' +
    'animation:f-cloud 150s linear infinite',
  ))
  L.push(box(
    'left:0;top:224px;width:3040px;height:18px;opacity:0.18;filter:blur(3px);' +
    'background:repeating-linear-gradient(90deg,rgba(255,210,172,0.6) 0 140px,transparent 140px 400px);' +
    'animation:f-cloud 104s linear infinite',
  ))
  L.push(box(
    'left:0;top:322px;width:3040px;height:12px;opacity:0.16;filter:blur(2px);' +
    'background:repeating-linear-gradient(90deg,rgba(255,198,152,0.65) 0 100px,transparent 100px 320px);' +
    'animation:f-cloud 76s linear infinite',
  ))

  L.push(box(
    'left:0;right:0;top:486px;height:110px;filter:blur(2px);' +
    'background:linear-gradient(180deg,rgba(46,40,44,0) 0%,rgba(40,36,40,0.55) 60%,rgba(34,32,34,0.8) 100%)',
  ))

  // THE TREELINE, and it is real trees now.
  //
  // Design's own field draws this band as five repeating radial gradients —
  // the green mounds — and says why: "a distant tree needs a small SPRITE, not
  // a small scale", and the LimeZu pack's modular oak read as three identical
  // shrubs at any size that fit here. The mounds were a placeholder for art
  // that did not exist.
  //
  // It exists now: `scene.oak` is generated at 59x54, which is already a small
  // sprite, so it goes in at 1x with no scaling at all. The band keeps the
  // gradients' own numbers — same y, same 82px height, same 0.5 opacity and
  // 3px blur — because those are what make it read as distance rather than as
  // a row of trees in the middle ground.
  L.push(treeline())

  /*
     A second, nearer band: standing corn beyond the crop rows.

     `sceneBg.cornWall` sat packed and drawn by nothing since it was generated
     -- its own note in art/sprites.json calls it "the RIGHT horizon for this
     farm... standing corn is what the real scenery outside Canton looks
     like" and says a scene may "layer corn in front of trees" rather than
     choosing one over the other. Pushed AFTER `treeline()` so paint order puts
     it in front of the oaks, tiled at 1x (the art is a 400x120 band, not a
     seamless texture, so the repeat shows at the seams the way the wheat bands'
     does -- acceptable at this opacity and this far from the camera).
  */
  L.push(tileBand('sceneBg.cornWall',
    'left:-40px;right:-40px;top:470px;height:120px;opacity:0.82;' +
    'filter:blur(1px) brightness(0.86) saturate(0.94);', 400, 120))

  // The far end of the place, all at 1x on the horizon line. Distance comes
  // from position and haze, never from scale.
  L.push(sprite('scene.silo', 1672, 116, 1, 'opacity:0.94;filter:blur(0.6px)'))
  L.push(sprite('scene.barn', FIELD_BARN.x, FIELD_BARN.y, 1, 'opacity:0.94;filter:blur(0.6px)'))
  L.push(sprite('scene.house', 560, 244, 1, 'opacity:0.9;filter:blur(0.6px)'))

  L.push(box(
    'left:0;right:0;top:564px;bottom:0;' +
    'background:linear-gradient(180deg,#6b6338 0%,#5a5531 22%,#454026 54%,#2e2b1a 82%,#201e13 100%)',
  ))
  L.push(box(
    'left:0;right:0;top:564px;height:16px;' +
    'background:linear-gradient(180deg,rgba(248,206,138,0.5),transparent)',
  ))

  // -- the far end still working: two hands standing, two walking
  // Two hands standing by the field. Breathing, at different rates, because two
  // people idling in lockstep is the one thing worse than two people frozen.
  L.push(actor('scene.farmerIdleBreatheStrip', 1392, 508, 32, 64, 7, '3.4s')
    ?? sprite('scene.farmerIdle', 1392, 508))
  L.push(actor('scene.farmer2IdleBreatheStrip', 1436, 512, 32, 64, 7, '4.1s', 1, '0.7s')
    ?? sprite('scene.farmer2Idle', 1436, 512))
  L.push(travelling(1660, 508, 'f-horizon 92s linear infinite',
    travelStrip('scene.farmerWalkStrip', {
      w: 32, h: 64, sheetW: 192, sheetH: 64, frames: 6, dur: '1.2s', keyframe: 'f-strip-192',
    })))
  L.push(travelling(540, 512, 'f-horizon-back 118s linear infinite',
    travelStrip('scene.farmerWalkStrip', {
      w: 32, h: 64, sheetW: 192, sheetH: 64, frames: 6, dur: '1.34s', keyframe: 'f-strip-192',
    })))

  for (const [x, y, dur, delay] of [
    [1350, 542, '2.4s', undefined], [1386, 548, '3.1s', '0.7s'],
    [1478, 544, '2.8s', '1.5s'], [1560, 540, '3.4s', '2.2s'],
  ] as const) {
    const s = travelStrip('scene.chickenPeckStrip', {
      w: 32, h: 32, sheetW: 128, sheetH: 32, frames: 4, dur, keyframe: 'f-strip-128', delay,
    })
    if (s) { s.style.cssText += `position:absolute;left:${x}px;top:${y}px`; L.push(s) }
  }

  for (const [x, y, travel, step] of [
    [1700, 540, 'f-horizon 140s linear infinite 8s', '1.3s'],
    [1620, 552, 'f-horizon 116s linear infinite 24s', '1.5s'],
  ] as const) {
    L.push(travelling(x, y, travel, travelStrip('scene.chickenWalkLeftStrip', {
      w: 32, h: 32, sheetW: 192, sheetH: 32, frames: 6, dur: step, keyframe: 'f-strip-192',
    })))
  }

  // -- heat still coming off the ground at the horizon
  L.push(box(
    'left:0;right:0;top:552px;height:26px;pointer-events:none;filter:blur(3px);' +
    'background:linear-gradient(180deg,rgba(255,222,170,0.5),transparent);' +
    'animation:f-shimmer 6.5s ease-in-out infinite',
  ))

  // -- birds, high and far off
  for (const [x, y, bx, by, w, h, alpha, travel, flap] of [
    [1980, 196, '-2300px', '60px', 7, 3, 0.75, 'f-bird 74s linear infinite', '0.9s'],
    [2020, 232, '-2340px', '34px', 6, 3, 0.7, 'f-bird 88s linear infinite 6s', '1.1s'],
    [2060, 168, '-2380px', '84px', 8, 4, 0.65, 'f-bird 102s linear infinite 15s', '1.3s'],
  ] as const) {
    const wrap = box(`left:${x}px;top:${y}px;--bx:${bx};--by:${by};animation:${travel}`)
    const bird = document.createElement('div')
    bird.style.cssText =
      `width:${w}px;height:${h}px;border-top:2px solid rgba(28,24,26,${alpha});` +
      `border-radius:50% 50% 0 0;animation:f-flap ${flap} ease-in-out infinite`
    wrap.append(bird)
    L.push(wrap)
  }

  // -- the field itself. Nearer rows are taller and slower, phases offset so
  //    the tiling never reads as wallpaper, and each band carries a different
  //    background-position so the seams do not line up vertically.
  for (const [name, top, h, tile, opacity, offset, anim, blur] of [
    ['scene.wheat', 574, 64, 64, 0.9, -50, 'f-crop 5.2s ease-in-out infinite', 0],
    ['scene.wheat', 636, 64, 64, 0.62, -36, 'f-crop 5.9s ease-in-out infinite 0.7s', 0],
    ['scene.wheat2', 700, 96, 96, 0.92, -36, 'f-crop 6.4s ease-in-out infinite', 0],
    ['scene.wheat2', 806, 96, 96, 0.55, -10, 'f-crop-slow 7.1s ease-in-out infinite 1.2s', 1.2],
    ['scene.wheat2', 902, 128, 128, 0.95, -42, 'f-crop-slow 8.3s ease-in-out infinite', 2.6],
  ] as const) {
    L.push(tileBand(name,
      `left:-32px;right:-32px;top:${top}px;height:${h}px;opacity:${opacity};` +
      `background-position:${offset}px 0;transform-origin:50% 100%;` +
      (blur ? `filter:blur(${blur}px);` : '') + `animation:${anim}`,
      tile, tile))
  }

  // -- the tractor working the row: exhaust up, dust behind
  const tractor = box('left:1980px;top:596px;animation:f-tractor 76s linear infinite')
  const tImg = spriteEl('scene.tractorLeft', 4096, 1)
  if (tImg) { tImg.style.cssText += 'position:relative'; tractor.append(tImg) }
  tractor.append(
    box('left:26px;top:-14px;width:14px;height:14px;border-radius:50%;' +
      'background:rgba(90,80,70,0.5);filter:blur(4px);animation:f-smoke 3.4s linear infinite'),
    box('left:26px;top:-14px;width:17px;height:17px;border-radius:50%;' +
      'background:rgba(90,80,70,0.42);filter:blur(5px);animation:f-smoke 3.4s linear infinite 1.7s'),
    box('left:128px;top:92px;width:20px;height:12px;border-radius:50%;' +
      'background:rgba(176,152,110,0.6);filter:blur(3px);animation:f-dust 2.2s linear infinite'),
    box('left:132px;top:96px;width:26px;height:14px;border-radius:50%;' +
      'background:rgba(176,152,110,0.5);filter:blur(4px);animation:f-dust 2.2s linear infinite 1.1s'),
  )
  L.push(tractor)

  L.push(actor('scene.scarecrowSwayStrip', 640, 522, 96, 96, 7, '6.6s')
    ?? sprite('scene.scarecrow', 640, 522,
      1, 'transform-origin:50% 92%;animation:f-sway 6.6s ease-in-out infinite'))
  L.push(sprite('scene.hay', 700, 606))

  // -- somebody walking the row, left to right, at 2x
  L.push(travelling(-180, 662, 'f-cross 96s linear infinite',
    travelStrip('scene.farmerWalkStrip', {
      w: 64, h: 128, sheetW: 384, sheetH: 128, frames: 6, dur: '1.12s', keyframe: 'f-strip-384',
    })))

  L.push(firefly(480, 880, 5, 10, 0.7, '80px', '-130px', 'f-fly 11s ease-in-out infinite'))
  L.push(firefly(1420, 840, 6, 11, 0.7, '-60px', '-160px', 'f-fly 13s ease-in-out infinite 3s'))

  if (BLIGHT) L.push(...wash())
  L.push(...vignette(
    'radial-gradient(120% 76% at 50% 52%,transparent 40%,rgba(12,10,14,0.5) 100%)',
    'linear-gradient(180deg,rgba(10,9,14,0.42) 0%,transparent 20%,transparent 54%,rgba(10,9,8,0.7) 100%)',
  ))
  return L
}

// -------------------------------------------------------------------- mount

/**
 * Build one backdrop.
 *
 * The sky is the scene's own background rather than the page's: pointing the
 * page at the flat bleed colour once deleted the dusk entirely and the scene
 * rendered against a solid navy rectangle.
 */
/* ------------------------------------------------------------------- lab */

/**
 * A still from the atlas at an exact height, placed by its top-left.
 *
 * `sprite()` above snaps to whole-pixel zoom, which is right for a card and
 * fatal in a scene -- see the session 19 notes: it is what rendered a bulldog
 * and a pony at the same size. Design's table gives every plate an exact box,
 * so this scales fractionally and hits it.
 */
function plate(name: string, x: number, y: number, h: number, css = ''): HTMLElement | null {
  const el2 = rawSceneSprite(name, h, { shadow: false })
  if (!el2) return null
  el2.style.position = 'absolute'
  el2.style.left = `${x}px`
  el2.style.top = `${y}px`
  if (css) el2.style.cssText += css
  return graded(el2)
}

/** A soft pool of light: a blurred radial, lighting the room rather than lit. */
function glow(
  x: number, y: number, w: number, h: number, colour: string, anim: string, at = '50% 50%',
): HTMLElement {
  return box(
    `left:${x}px;top:${y}px;width:${w}px;height:${h}px;pointer-events:none;` +
    `background:radial-gradient(50% 50% at ${at},${colour},transparent 72%);` +
    `filter:blur(6px);animation:${anim}`,
  )
}

/**
 * A packed clip animated at an exact height, placed by its top-left.
 *
 * Ask `clipsOf(sheet)` in ui/sprite.ts for what a sheet can actually do.
 * Directions are the game's eight: down, downLeft, left, upLeft, up, upRight,
 * right, downRight.
 *
 * The cell and the frame count come back FROM the strip composer rather than
 * being typed here, and that is the whole reason to prefer this over a
 * hand-sized sheet: every generated clip has a different cell, and a width
 * typed by hand fails silently by SLIDING the animation instead of stepping it.
 *
 * `clipActor` takes an INTEGER zoom and cannot hit a target size; `groundActor`
 * hits the size but positions by the feet and adds a contact shadow, which is
 * wrong for a bubbling tank bolted to a wall. This is the third case: exact
 * height, top-left placement, no shadow.
 */
function clipActorAt(
  sheet: string, clip: string, dir: string,
  x: number, y: number, height: number, dur: string, delay?: string, css = '',
): HTMLElement | null {
  /*
     A blighted scene draws the counterpart where there is one and grades the
     original where there is not. `windmill`, `scarecrow`, `wheat` and the tank
     bank all land in the second case, which is why this asks for the swap first
     and only falls back to the healthy sprite plus the filter.
  */
  const strip = (BLIGHT ? blightStrip(sheet, clip, dir) : null) ?? stripUrl(sheet, clip, dir)
  if (!strip) return null
  const scale = height / strip.cell
  const w = strip.cell * scale
  const sheetW = w * strip.frames
  const d = document.createElement('div')
  d.style.cssText =
    `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${w}px;` +
    `background-image:url('${strip.url}');background-size:${sheetW}px ${w}px;` +
    `background-repeat:no-repeat;--strip-w:${sheetW}px;image-rendering:pixelated;` +
    `animation:y-strip ${dur} steps(${strip.frames}) infinite${delay ? ` ${delay}` : ''};${css}`
  return BLIGHT && !BLIGHT_SHEET[sheet] ? graded(d) : d
}

/**
 * One layer of a patrol: a walk strip at an exact height, taking its animation
 * whole.
 *
 * `clipActor` and `clipActorAt` both hard-code `animation:y-strip`, and a
 * patrol layer needs either NO strip animation (it is a standing frame) or
 * `y-strip` PLUS an opacity track in the same declaration.
 */
function patrolLayer(
  sheet: string, clip: string, dir: string, height: number, anim: string, css = '',
): HTMLElement | null {
  const swap = BLIGHT ? blightStrip(sheet, clip, dir) : null
  const strip = swap ?? stripUrl(sheet, clip, dir)
  if (!strip) return null
  const scale = height / strip.cell
  const w = strip.cell * scale
  const sheetW = w * strip.frames
  /*
     A patrol layer takes its animation WHOLE, so a swapped clip with a different
     frame count would step through the wrong number of cells and slide. Rewrite
     the `steps(n)` the caller asked for to the strip's own count -- the only
     number in the declaration that is a property of the ART rather than of the
     beat. `joyBlight` is one frame where `joy.walk` is nine, and without this
     the blighted dog scrolls sideways off her own strip.
  */
  const fixed = swap ? anim.replace(/steps\(\d+\)/g, `steps(${strip.frames})`) : anim
  const d = document.createElement('div')
  d.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${w}px;` +
    `background-image:url('${strip.url}');background-size:${sheetW}px ${w}px;` +
    `background-repeat:no-repeat;--strip-w:${sheetW}px;image-rendering:pixelated;` +
    `animation:${fixed};${css}`
  return BLIGHT && !swap ? graded(d) : d
}

/**
 * A figure that walks a beat and stands at each end of it.
 *
 * Four stacked layers on one clock -- face-right still, face-left still,
 * walk-left, walk-right -- with exactly one opaque at a time, over a wrapper
 * carrying the `-path` keyframe that does the travelling.
 *
 * The swaps are `step-end` so a figure CUTS between facings. A cross-fade would
 * dissolve a pixel sprite through its own mirror image, which reads as a ghost
 * rather than a turn.
 *
 * Timings are Design's, from `Lab at Depth.dc.html`; the keyframes are copied
 * verbatim into home.css. Every figure walks at 1.2s for 8 frames, so only the
 * patrol clock differs between them.
 */
function patrol(
  sheet: string, x: number, y: number, height: number, key: string, dur: string, css = '',
): HTMLElement | null {
  const step = `${dur} step-end infinite`
  const layers = [
    patrolLayer(sheet, 'walk', 'right', height, `mull-${key}-pr ${step}`, css),
    patrolLayer(sheet, 'walk', 'left', height, `mull-${key}-pl ${step}`, css),
    patrolLayer(sheet, 'walk', 'left', height, `y-strip 1.2s steps(8) infinite, mull-${key}-wl ${step}`, css),
    patrolLayer(sheet, 'walk', 'right', height, `y-strip 1.2s steps(8) infinite, mull-${key}-wr ${step}`, css),
  ].filter((l): l is HTMLElement => l !== null)
  if (layers.length === 0) return null
  /*
     THE PATH IS `linear`. THE LAYER SWAPS ARE `step-end`. THEY ARE NOT THE SAME
     ANIMATION AND THEY MUST NOT SHARE A TIMING FUNCTION.

     This wrapper carried `step-end` too, and `step-end` on a transform does not
     travel — it holds the old value and JUMPS at the keyframe. So every figure
     in the lab played its eight-frame walk on the spot for a couple of seconds
     and then teleported three hundred pixels. The owner's words were "a
     treadmill", which is exactly what a walk cycle with no translation is.
     The yard's `wander()` had `linear` here from the start; the lab did not, and
     the two were written a session apart.

     One consequence worth knowing: the `-path` keyframes' travel windows now
     have to line up with the `-wl`/`-wr` opacity windows to the percent,
     because a mismatch is no longer invisible — it is a figure sliding while
     standing still. They are matched in home.css and commented there.
  */
  const wrap = box(`left:${x}px;top:${y}px;animation:mull-${key}-path ${dur} linear infinite`)
  for (const l of layers) wrap.append(l)
  return wrap
}

/**
 * The fourth scene: a lab, at depth.
 *
 * Every number below is Design's, out of `docs/mockups/PLACEMENTS.md`, which
 * `npm run placements` regenerates from the artboard. If the artboard moves,
 * re-run the tool and diff it -- do not nudge anything here by hand.
 *
 * Two of Design's rules are encoded in those coordinates and worth stating,
 * because they are what stops an interior reading as a sticker sheet:
 *
 * - **The wall/floor junction is the horizon.** Nothing stands in y 496-556 and
 *   the first foot line is 636. Wall furniture above it, floor furniture below,
 *   and the gap between is the join.
 * - **One scale throughout.** A grown person is 174px, so 97px to the metre.
 *   The guard is 190 because he is a big man, not because he is nearer.
 *
 * Layers are appended in paint order, which is the order the table lists them.
 */
function lab(): (HTMLElement | null)[] {
  const dim = (b: number): string => `filter:brightness(${b});`
  return [
    /*
       THE ROOM ITSELF, and it is not in the placement table.

       `npm run placements` extracts SPRITES. The wall, the floor and the join
       between them are CSS in Design's artboard, so a scene built from the table
       alone comes out as furniture floating in black -- which is exactly how the
       first build of this looked.

       The geometry is Design's, read off the artboard: wall 0-496, a 26px
       junction band AT 496, floor 496 to the bottom. That is the same horizon
       the handoff states as a rule ("nothing stands in y 496-556, first foot
       line is 636"), and having it here as a drawn band is what makes the rule
       visible rather than merely obeyed.

       The two tile grids are the perspective. The wall is 96x144 straight on;
       the floor is 192 WIDE and only 68 DEEP, because a floor plate seen at a
       shallow angle is short. Getting that ratio wrong is what makes an interior
       read as wallpaper.
    */
    box(
      'left:0;right:0;top:0;height:496px;' +
      'background:linear-gradient(180deg,#23272a 0%,#2c3134 26%,#33383b 62%,#3a3f42 88%,#2f3437 100%)',
    ),
    box(
      'left:0;right:0;top:0;height:496px;background-image:' +
      'repeating-linear-gradient(90deg,rgba(0,0,0,0.28) 0 1px,transparent 1px 96px),' +
      'repeating-linear-gradient(180deg,rgba(0,0,0,0.22) 0 1px,transparent 1px 144px)',
    ),
    box(
      'left:0;right:0;top:496px;bottom:0;' +
      'background:linear-gradient(180deg,#4c5052 0%,#44484c 8%,#3b3f44 22%,' +
      '#32363c 44%,#26282e 70%,#171920 100%)',
    ),
    box(
      'left:0;right:0;top:496px;bottom:0;background-image:' +
      'repeating-linear-gradient(180deg,rgba(0,0,0,0.4) 0 1px,transparent 1px 68px),' +
      'repeating-linear-gradient(90deg,rgba(0,0,0,0.3) 0 1px,transparent 1px 192px)',
    ),
    // The join. 26px of skirting is the whole difference between a room and two
    // stacked rectangles.
    box(
      'left:0;right:0;top:496px;height:26px;' +
      'background:linear-gradient(180deg,#63696d 0%,#4b5054 46%,#383c40 100%)',
    ),
    // Weight above and below: the ceiling presses down, the far floor falls away.
    box(
      'left:0;right:0;top:0;height:240px;' +
      'background:linear-gradient(180deg,rgba(8,10,12,0.74) 0%,rgba(8,10,12,0.3) 62%,transparent 100%)',
    ),
    box(
      'left:0;right:0;top:940px;bottom:0;' +
      'background:linear-gradient(180deg,rgba(6,8,10,0) 0%,rgba(6,8,10,0.5) 42%,rgba(4,6,8,0.9) 100%)',
    ),

    // The ceiling, and the strip lights hung off it.
    plate('base.ceilingPipes', 0, 0, 96, dim(0.72)),
    plate('base.striplightLit', 260, 44, 96, 'animation:l-hum 5.3s ease-in-out infinite;'),
    plate('base.striplightLit', 700, 44, 96, 'animation:l-hum 6.7s ease-in-out infinite 1.4s;'),
    plate('base.striplightLit', 1500, 44, 96, 'animation:l-hum 7.9s ease-in-out infinite 0.6s;'),
    plate('base.striplightDead', 1060, 36, 144, dim(0.5)),

    /*
       What the lights actually do to the room.

       Three cold pools under the working strips and one warm one under the wall
       lamp, each blurred and on the same `l-hum` clock as the fitting above it,
       so a flicker dims the pool with the tube rather than after it. Without
       these the strips are stickers: bright objects lighting nothing.
    */
    glow(180, 130, 352, 390, 'rgba(206,232,240,0.16)', 'l-hum 5.3s ease-in-out infinite'),
    glow(620, 130, 352, 390, 'rgba(206,232,240,0.16)', 'l-hum 6.7s ease-in-out infinite 1.4s'),
    glow(1420, 130, 352, 390, 'rgba(206,232,240,0.16)', 'l-hum 7.9s ease-in-out infinite 0.6s'),
    glow(1300, 280, 216, 250, 'rgba(255,214,150,0.3)', 'l-hum 8.3s ease-in-out infinite', '50% 24%'),

    // Wall furniture, all of it above the junction.
    plate('base.wallPipes', 200, 280, 144, dim(0.88)),
    plate('base.wallHazard', 330, 280, 144, dim(0.9)),
    plate('base.warningSign', 104, 300, 144),
    plate('base.wallVent', 1120, 280, 144, dim(0.86)),
    plate('base.wallStencil', 1240, 280, 144, dim(0.9)),
    plate('base.wallLamp', 1360, 280, 144, dim(1.05)),
    plate('base.warningSign', 1462, 300, 144),
    plate('base.wallPipes', 1790, 280, 144, dim(0.82)),
    plate('base.lift3', LAB_LIFT.x, LAB_LIFT.y, LAB_LIFT.size),
    plate('base.blastDoor5', 1500, 248, 256),

    // The tank bank, each on its own clock so the room never pulses in unison.
    clipActorAt('tankSwirl', 'swirl', 'down', 1167, 475, 192, '2.9s'),
    clipActorAt('tankSwirl', 'churn', 'down', 1352, 483, 192, '3.3s', '0.6s'),
    clipActorAt('tankPanel', 'churn', 'down', 1540, 491, 192, '3.9s', '1.3s'),
    clipActorAt('tankBarrel', 'swirl', 'down', 1710, 496, 192, '4.3s', '2.1s'),

    // The vats. This is the thing the scene is about.
    plate('vault.vatBroken', 673, 410, 292, dim(0.82)),
    plate('vault.vatAlien', 565, 460, 241, dim(0.94)),
    clipActorAt('vatSpecimen', 'bubble', 'down', 386, 456, 261, '3.6s'),

    // A hazmat tech working the right-hand aisle.
    patrol('baseHazmat', 1455, 596, 174, 'haz', '41s', dim(0.9)),

    plate('vault.floorGrate', 980, 890, 143, dim(0.62)),
    plate('vault.floorGrate', 1420, 930, 143, dim(0.56)),
    clipActorAt('labConsole', 'flicker', 'down', 825, 491, 374, '1.8s'),
    plate('vault.jarRack', 1162, 682, 210, dim(0.92)),
    plate('vault.drumRank', 1335, 615, 309, dim(0.84)),
    plate('base.labBench', 544, 707, 150, dim(0.96)),

    // 26s, not 47: the scientist's loop is an errand to the vats and back now
    // rather than 1.8 seconds of walking in three quarters of a minute. The
    // retimed keyframes are in home.css and say why.
    patrol('baseTech', 861, 696, 174, 'tech', '26s'),
    patrol('baseGuard', 420, 770, 190, 'guard', '59s', dim(0.86)),

    /*
       The split drum, and it is the thing the room is about.

       `vault.drumWeeping` -- a containment drum burst open and what came out of
       it -- was packed in the atlas and drawn by nothing until the 2026-09-03
       inventory audit. `art/sprites.json` calls it "the story of the game in
       one asset" in the same file that never placed it, which is this project's
       whole failure mode in two lines of the same JSON.

       Far left, downstage of everything, below the y-726 print reservation and
       clear of drumScatter's box at x 264. Not dimmed as far as its neighbours:
       the leak is the one thing in the frame that should catch the eye.
    */
    plate('vault.drumWeeping', 40, 812, 178, dim(0.86)),
    plate('vault.drumScatter', 264, 782, 239, dim(0.62)),
    plate('vault.examTable', 539, 779, 296, dim(1.02)),
    clipActorAt('tankVat', 'swirl', 'down', 1147, 848, 179, '5.4s', undefined, dim(0.86)),
    plate('vault.drumStack', 1544, 797, 241, dim(0.7)),

    // Underground the light comes from the room itself, so the vignette is
    // tighter and colder than either scene above ground.
    ...vignette(
      'radial-gradient(ellipse 62% 54% at 50% 46%,rgba(0,0,0,0) 40%,rgba(4,6,9,0.66) 100%)',
      'linear-gradient(180deg,rgba(6,8,11,0.5) 0%,rgba(0,0,0,0) 26%,rgba(0,0,0,0) 72%,rgba(4,5,8,0.72) 100%)',
    ),
  ]
}

/**
 * The barn, from the inside. The Homestead's room.
 *
 * ## Why this exists at all
 *
 * Eight assets -- two stall fronts, a stall divider, a loft edge, a lit and an
 * unlit hanging lantern, a floor tile and a bolted ladder -- were generated,
 * claimed and packed sessions ago and drawn by NOTHING, because the one thing
 * they all needed was a barn interior and no barn interior existed. That is
 * nine rows of `docs/PIXELLAB_LEDGER.md`'s open queue and the second largest
 * group in it. The Homestead was already ENTERED THROUGH THE BARN DOOR from
 * both surface scenes and then composed the yard again behind itself, so the
 * player walked into a building and came out standing in front of it.
 *
 * ## The geometry, and it is the lab's argument in wood
 *
 * `npm run placements` extracts SPRITES; a room is mostly not sprites. The
 * wall, the floor and the join between them are drawn here, and the numbers
 * follow the rule the lab already obeys: a back wall down to the junction, a
 * skirting band AT the junction, a floor receding from it. Wall 0-430,
 * junction 430-458, floor 458 down.
 *
 * The two grids are the perspective, and getting their ratio wrong is what
 * makes an interior read as wallpaper. The wall is vertical planking, 42px
 * wide, straight on. The floor is `ranch.barnFloor` tiled at 128 by 84 --
 * WIDER THAN IT IS DEEP, because a floor plate seen at a shallow angle is
 * short. The lab uses 192 by 68 for the same reason at the same room depth.
 *
 * ## What it is lit by
 *
 * One hanging lantern, and the doorway. The lab is lit by fixtures because a
 * bunker is; a barn at dusk is lit by the hole it has for a door, which is why
 * `BARN_MOUTH` is a warm pool on the floor at the near end of the aisle rather
 * than a decoration -- it is the way out, and `DOOR.barn` points at it.
 *
 * The second lantern is the DARK one, hung at the far end. Two lit lanterns
 * would say the barn is in use; one lit and one dead says somebody stopped
 * coming out here, which is the game this is the menu for.
 *
 * ## The UI rail
 *
 * `UI_RAIL` covers x 332-1588, y 735-1028, and the Homestead's building cards
 * sit in it. Everything below y 700 here is floor, straw and light: no object
 * is placed where a card will cover it, which is a decision rather than a
 * transcription -- see the note on `UI_RAIL`.
 */
function barn(): (HTMLElement | null)[] {
  const dim = (b: number): string => `filter:brightness(${b});`
  const L: (HTMLElement | null)[] = []
  const push = (e: HTMLElement | null): void => { if (e) L.push(e) }

  // The back wall: dark barn boards, warmer where the doorway light reaches.
  push(box(
    'left:0;right:0;top:0;height:430px;'
    + 'background:linear-gradient(180deg,#191410 0%,#241c14 22%,#33261a 54%,#3d2d1e 82%,#2b2016 100%)',
  ))
  // Vertical planking, 42px, with a lighter line down one edge of each board so
  // the wall reads as grain rather than as a stripe.
  push(box(
    'left:0;right:0;top:0;height:430px;background-image:'
    + 'repeating-linear-gradient(90deg,rgba(0,0,0,0.34) 0 2px,'
    + 'rgba(255,232,190,0.045) 2px 4px,transparent 4px 42px)',
  ))
  /*
     The floor, and it is NOT `ranch.barnFloor`.

     `ranch.barnFloor` is a 64px OBJECT -- one drawn patch of packed dirt and
     straw with its own soft edge -- and tiling an object gives a grid of
     separate pads, which is exactly what the first build of this came out as.
     A floor wants a TILE, and the atlas already had one nobody had ever named:
     `terrain.hay`, cut from the terrain sheet, cell-sized and packed untrimmed
     precisely so it tiles. It was on the ledger's packed-and-dead list.

     `background-repeat:repeat` overrides tileBand's repeat-x: a floor tiles
     both ways, a band does not. The 44px cell against a 32px source is the
     perspective -- the aisle is seen at a shallow angle, so the straw runs
     coarser near the camera than the boards behind it.
  */
  push(tileBand(
    'terrain.hay',
    'left:0;right:0;top:458px;bottom:0;background-repeat:repeat;filter:brightness(0.44) saturate(0.8)',
    44, 44,
  ))
  // One drawn patch of trodden floor where the doorway light lands, because a
  // tiled floor with nothing on it is a texture and not a place.
  push(plate('ranch.barnFloor', 866, 856, 190, dim(0.78) + 'opacity:0.85;'))
  // The join. 28px of skirting is the whole difference between a room and two
  // stacked rectangles -- the lab's lesson, in wood.
  push(box(
    'left:0;right:0;top:430px;height:28px;'
    + 'background:linear-gradient(180deg,#4a3722 0%,#33261a 52%,#1d1610 100%)',
  ))
  // Weight above and below: the loft presses down, the near floor falls into
  // shadow at the bottom of the frame.
  push(box(
    'left:0;right:0;top:0;height:250px;'
    + 'background:linear-gradient(180deg,rgba(6,5,4,0.82) 0%,rgba(6,5,4,0.36) 60%,transparent 100%)',
  ))
  push(box(
    'left:0;right:0;top:900px;bottom:0;'
    + 'background:linear-gradient(180deg,rgba(8,6,4,0) 0%,rgba(8,6,4,0.5) 40%,rgba(6,4,3,0.92) 100%)',
  ))
  // The two long walls, off frame, as darkness down each side. Without them the
  // floor runs to the edge of the stage and the barn reads as open ground with
  // a wall at the back.
  push(box(
    'left:0;top:430px;width:300px;bottom:0;'
    + 'background:linear-gradient(90deg,rgba(8,6,4,0.8) 0%,rgba(8,6,4,0.28) 52%,transparent 100%)',
  ))
  push(box(
    'right:0;top:430px;width:300px;bottom:0;'
    + 'background:linear-gradient(270deg,rgba(8,6,4,0.8) 0%,rgba(8,6,4,0.28) 52%,transparent 100%)',
  ))

  // The hay loft, running the width of the barn above the stalls. Nine plates
  // rather than a tiled band: `ranch.loftEdge` is drawn boards with straw
  // hanging off the lip, and repeating it as a texture tiles the straw into a
  // pattern. Drawn at its catalogued 220 by 60.
  push(box(
    'left:0;right:0;top:112px;height:52px;'
    + 'background:linear-gradient(180deg,#160f0a 0%,#241a10 62%,#120c08 100%);'
    + 'box-shadow:0 10px 22px rgba(0,0,0,0.6)',
  ))
  // Overlapped, not abutted. `ranch.loftEdge` draws straw hanging in a curve off
  // the lip, so laying the plates end to end gives a row of scallops rather than
  // a loft; at 160 the curves run into each other and the fringe is continuous.
  for (let i = 0; i < 13; i++) push(plate('ranch.loftEdge', i * 160 - 40, 122, 58, dim(0.58)))

  // The stalls. Front, divider, broken front -- so the row reads as a barn that
  // has been let go at one end rather than as three of the same object.
  const JUNCTION = 458
  const stall = (name: string, x: number, h: number, b: number): void => {
    // Placed by the FOOT, not by the top. Every one of these stands on the
    // junction line, and a row typed by its tops stands on nothing -- the first
    // build had them floating in the middle of the wall like hung gates.
    push(plate(name, x, JUNCTION - h, h, dim(b)))
  }
  stall('ranch.stallDivider', 24, 210, 0.74)
  stall('ranch.stallFront', 108, 196, 0.86)
  stall('ranch.stallDivider', 268, 210, 0.78)
  stall('ranch.stallFront', 352, 196, 0.9)
  stall('ranch.stallDivider', 512, 210, 0.78)
  stall('ranch.stallFrontBroken', 596, 140, 0.86)
  stall('ranch.stallDivider', 1180, 210, 0.78)
  stall('ranch.stallFront', 1264, 196, 0.86)
  stall('ranch.stallDivider', 1424, 210, 0.76)
  stall('ranch.stallFrontBroken', 1508, 140, 0.82)
  stall('ranch.stallDivider', 1772, 210, 0.7)

  // The ladder to the loft, bolted to the wall in the gap between the two stall
  // runs. It has to SPAN loft to floor -- a ladder that stops in mid-air is the
  // floating-stall mistake in one object -- so it is drawn at 268 against a
  // 128px source, which the scene layer is allowed to do (it scales buildings
  // the same way; the 32x32 rule is the field's, not the stage's).
  push(plate('ranch.barnLadder', 902, JUNCTION - 268, 268, dim(0.8)))

  // Two lanterns hung off the loft beam, one lit and one not.
  push(plate('ranch.barnLantern', 704, 150, 112, 'animation:l-hum 6.1s ease-in-out infinite;'))
  push(plate('ranch.barnLanternDark', 1128, 150, 124, dim(0.55)))
  push(glow(540, 150, 400, 480, 'rgba(255,196,110,0.22)', 'l-hum 6.1s ease-in-out infinite'))

  // The doorway you came in by: a warm spill on the floor, and the only thing
  // in the room that is not the room. `DOOR.barn` points at its centre.
  push(box(
    `left:${BARN_MOUTH.x - 300}px;top:${BARN_MOUTH.y - 320}px;width:600px;height:420px;`
    + 'pointer-events:none;background:radial-gradient(50% 50% at 50% 88%,'
    + 'rgba(255,214,140,0.52),rgba(255,196,110,0.20) 44%,transparent 76%);filter:blur(12px)',
  ))

  // Floor dressing, all of it clear of the UI rail: bales and feed against the
  // walls, nothing in the aisle the cards sit over.
  push(plate('ranch.squareBales', 40, 470, 150, dim(0.82)))
  push(plate('ranch.roundBale', 1700, 448, 176, dim(0.78)))
  push(plate('ranch.hayWagon', 236, 494, 210, dim(0.7)))
  push(plate('ranch.feedBucket', 128, 646, 64, dim(0.84)))
  push(plate('ranch.nestBox', 1580, 620, 116, dim(0.78)))
  push(plate('ranch.eggClutch', 1516, 726, 48, dim(0.8)))
  push(plate('ranch.feedPan', 90, 760, 58, dim(0.8)))
  push(plate('ranch.squareBales', 1768, 700, 150, dim(0.72)))

  // Dust in the lantern light: the barn's answer to the yard's fireflies, and
  // the only motion in the room besides the flicker.
  for (let i = 0; i < 7; i++) {
    push(box(
      `left:${640 + i * 44}px;top:${300 + (i % 3) * 90}px;width:3px;height:3px;`
      + 'border-radius:50%;background:rgba(255,224,168,0.5);'
      + `animation:l-hum ${5 + i * 0.7}s ease-in-out infinite ${i * 0.5}s`,
    ))
  }

  L.push(...vignette(
    'radial-gradient(ellipse 64% 58% at 50% 52%,rgba(0,0,0,0) 38%,rgba(10,7,4,0.7) 100%)',
    'linear-gradient(180deg,rgba(10,7,4,0.52) 0%,rgba(0,0,0,0) 24%,'
    + 'rgba(0,0,0,0) 70%,rgba(8,5,3,0.7) 100%)',
  ))
  return L
}

export function buildScene(kind: SceneKind, blight = false): HTMLElement {
  // The lab never blights. It is what the blight came out of.
  BLIGHT = blight && kind !== 'lab'
  try {
    const root = el('div', { class: `home-yard is-${kind}${BLIGHT ? ' is-blight' : ''}` })
    const layers = kind === 'lab' ? lab()
      : kind === 'barn' ? barn()
        : kind === 'field' ? field() : yard()
    for (const layer of layers) {
      if (layer) root.append(layer)
    }
    return root
  } finally {
    BLIGHT = false
  }
}

/**
 * The ground between the farm and the lab under it.
 *
 * The home screen's sequence descends through this rather than cutting, so it
 * has to survive being LOOKED AT for a second and a half. Four things carry it:
 *
 * - a soil fill, `terrain.soil` tiled at 32px, which is the same dirt the game
 *   walks on rather than a brown gradient invented for the occasion;
 * - a darkening down the column, because the light comes from the hole above;
 * - roots and stones scattered off a FIXED table, not the run's RNG. The map
 *   draw is the first draw off the seeded stream and costs exactly one; a menu
 *   backdrop calling `rng` at all would invalidate every seed in the game;
 * - one buried conduit, `base.wallPipes` stacked the whole way down, which is
 *   the only thing in the column that says the lab was BUILT and is connected
 *   to the farm rather than merely below it.
 */
export function buildSoil(): HTMLElement {
  const root = el('div', { class: 'home-soil' })
  /*
     TWO LAYERS OF GROUND, BECAUSE A CROSS-SECTION HAS TWO.

     `terrain.dirt` averages rgb(170,143,90) and `terrain.soil` rgb(102,68,60) —
     measured off the atlas, not guessed — so the pack already carries a light
     topsoil and a dark subsoil, and stacking them in that order is the whole of
     the geology. One tile the whole way down reads as a texture; two read as a
     dig. The first build of this dimmed the column to 0.92 black at the bottom
     and the entire descent was three seconds of nothing at all.
  */
  const sub = tileBand('terrain.soil', `left:0;right:0;top:0;height:${SOIL_H}px;` +
    'background-repeat:repeat;image-rendering:pixelated', 32, 32)
  if (sub) root.append(sub)
  const top = tileBand('terrain.dirt', 'left:0;right:0;top:0;height:104px;' +
    'background-repeat:repeat;image-rendering:pixelated', 32, 32)
  if (top) root.append(top)
  // The seam between them, blurred, so the two bands are a transition.
  root.append(box(
    'left:0;right:0;top:88px;height:44px;filter:blur(6px);' +
    'background:linear-gradient(180deg,rgba(84,58,40,0) 0%,rgba(72,50,36,0.85) 55%,' +
    'rgba(102,68,60,0) 100%)',
  ))
  // Light falls off with depth, and the last 90px goes to the lab's own dark so
  // the two scenes meet on the same value rather than on a line.
  root.append(box(
    `left:0;right:0;top:0;height:${SOIL_H}px;` +
    'background:linear-gradient(180deg,rgba(20,14,10,0.12) 0%,rgba(18,13,10,0.3) 46%,' +
    'rgba(12,10,10,0.52) 82%,rgba(9,10,13,0.9) 100%)',
  ))

  /*
     Roots, stones and the conduit. Fixed positions off a fixed table.

     NOT off the run's RNG, and that is not fussiness: the map choice is the
     first draw off the seeded stream and costs exactly one, so anything that
     calls `rng` before a run starts invalidates every seed in the game. A menu
     backdrop has no business touching it.

     `cave.branches*` averages rgb(11,11,12) — near black — which is why they go
     in at full brightness and read as roots against the brown rather than
     needing a filter to darken them.
  */
  const roots: readonly (readonly [string, number, number, number, number])[] = [
    ['cave.branches0', 190, 34, 128, 0.92], ['cave.branches3', 1420, 22, 140, 0.88],
    ['cave.branches1', 640, 120, 104, 0.8], ['cave.branches5', 1130, 200, 112, 0.7],
    ['cave.branches2', 320, 262, 96, 0.6], ['cave.branches4', 1660, 296, 100, 0.55],
  ]
  for (const [name, x, y, h, op] of roots) {
    const r = plate(name, x, y, h, `opacity:${op};filter:saturate(0.7);`)
    if (r) root.append(r)
  }
  const stones: readonly (readonly [string, number, number, number, number])[] = [
    ['node.rockMedium', 860, 88, 46, 0.9], ['node.rockSmall', 1290, 146, 32, 0.82],
    ['node.rockBig', 460, 184, 54, 0.78], ['node.rockSmall', 1540, 220, 30, 0.7],
    ['node.rockMedium', 240, 350, 42, 0.6], ['node.rockBig', 1030, 380, 48, 0.55],
  ]
  for (const [name, x, y, h, op] of stones) {
    const s = plate(name, x, y, h, `opacity:${op};filter:brightness(0.72) saturate(0.5);`)
    if (s) root.append(s)
  }
  /*
     Stone hanging off the strata, in the bottom half only.

     `cave.stalactite*` was generated for the OVERHEAD layer -- `art/sprites.json`
     says so, and says why they are packed untrimmed: they hang from the top of
     their own sprite, so the placement point is the attachment and the art
     falls away from it. Then no map with a rock ceiling was ever built, and six
     paid-for sprites sat in the atlas drawing nothing until the 2026-09-03
     audit. This column is the one place in the game that already asks for art
     that hangs: it is a CROSS-SECTION, the fixed plate table above is the same
     idea, and the anchor semantics are exactly right without any new code.

     Bottom half only, and dark. Near the top they would read as icicles in
     topsoil; from y 250 down, where the light has already fallen away, they
     read as the underside of stone -- which is the last thing you go past
     before the ceiling of a room that people built.
  */
  const strata: readonly (readonly [string, number, number, number, number])[] = [
    ['cave.stalactite0', 96, 268, 74, 0.62], ['cave.stalactite3', 1224, 250, 82, 0.6],
    ['cave.stalactite1', 700, 330, 64, 0.5], ['cave.stalactite4', 1830, 312, 70, 0.48],
    ['cave.stalactite2', 396, 404, 58, 0.4], ['cave.stalactite5', 1520, 386, 62, 0.38],
  ]
  for (const [name, x, y, h, op] of strata) {
    const t = plate(name, x, y, h, `opacity:${op};filter:brightness(0.6) saturate(0.4);`)
    if (t) root.append(t)
  }
  // The one thing in the column that says the lab was BUILT: a conduit coming
  // off the farm and going all the way down to it.
  const pipe = tileBand('base.wallPipes',
    `left:1478px;width:32px;top:0;height:${SOIL_H}px;background-repeat:repeat-y;` +
    'filter:brightness(0.82) saturate(0.55);opacity:0.94', 32, 48)
  if (pipe) root.append(pipe)

  return root
}
