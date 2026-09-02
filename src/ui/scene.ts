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
import { spriteEl, spriteTileUrl, frameOf, stripUrl, clipsOf, groundWrap, sceneSprite as rawSceneSprite } from './sprite'
// Re-exported so a scene has one place to import from. `sceneSprite` is the
// STILL counterpart of `groundActor` below: exact height, feet on the ground.
export { sceneSprite } from './sprite'

export type SceneKind = 'yard' | 'field' | 'lab'

/** Edge colours the letterbox bleeds with. The scene's own top and bottom. */
export const BLEED: Record<SceneKind, { top: string; bottom: string }> = {
  yard: { top: '#191b36', bottom: '#191d13' },
  field: { top: '#1d2140', bottom: '#201e13' },
  // The lab has no sky. Both edges are the room it is in.
  lab: { top: '#0d1014', bottom: '#0a0c0f' },
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

export const DOOR: Record<SceneKind, { x: number; y: number }> = {
  yard: { x: YARD_BARN.x + BARN_DOOR.x, y: YARD_BARN.y + BARN_DOOR.y + BARN_DOOR.h + 10 },
  field: { x: FIELD_BARN.x + BARN_DOOR.x, y: FIELD_BARN.y + BARN_DOOR.y + BARN_DOOR.h + 10 },
  lab: { x: LAB_LIFT.x + LAB_LIFT.size / 2, y: LAB_LIFT.y + LAB_LIFT.size },
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
  return s
}

/**
 * A sprite bottom-centred inside a fixed box.
 *
 * For the one place a game sprite stands in for scene art: the scene's own
 * rooster crop is entirely transparent, so the yard borrows the rooster the
 * field sprites use, and that one IS trimmed. Bottom-centring puts its feet
 * where the box's feet are, which is the only alignment that matters.
 */
function spriteInBox(
  name: string, x: number, y: number, w: number, h: number, zoom: number, css = '',
): HTMLElement | null {
  const s = spriteEl(name, 4096, zoom)
  if (!s) return null
  const wrap = box(`left:${x}px;top:${y}px;width:${w}px;height:${h}px;${css}`)
  s.style.position = 'absolute'
  s.style.left = '50%'
  s.style.bottom = '0'
  s.style.transform = 'translateX(-50%)'
  wrap.append(s)
  return wrap
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
  return box(
    `background-image:url('${url}');background-size:${tileW}px ${tileH}px;` +
    `background-repeat:repeat-x;image-rendering:pixelated;${css}`,
  )
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
 * Animate ANY packed clip, without a baked strip PNG.
 *
 *     clipActor('brahmaHenBlight', 'walk', 'down', 820, 470, '1.1s', 2)
 *
 * `actor()` above needs a strip that `npm run anim` baked, and only fifteen of
 * those exist -- all of them LimeZu-era. Everything generated since is packed
 * as individual frames, so this composes the strip at runtime out of the atlas
 * (see `stripUrl`) and hands the result to the same `stripActor`.
 *
 * The cell and the frame count come back FROM the composer rather than being
 * typed here, which is the whole reason to prefer this over `actor()` for
 * generated art: `actor`'s own comment warns that a hand-typed sheet width
 * fails silently by sliding the animation instead of stepping it, and every
 * generated clip has a different cell.
 *
 * Ask `clipsOf(sheet)` for what a sheet can do. Directions are the game's
 * eight: down, downLeft, left, upLeft, up, upRight, right, downRight.
 */
function clipActor(
  sheet: string, clip: string, dir: string,
  x: number, y: number, dur: string, zoom = 1, delay?: string,
): HTMLElement | null {
  const strip = stripUrl(sheet, clip, dir)
  if (!strip) return null
  const d = document.createElement('div')
  const w = strip.cell * zoom
  const sheetW = w * strip.frames
  d.style.cssText =
    `position:absolute;left:${x}px;top:${y}px;` +
    `width:${w}px;height:${w}px;background-image:url('${strip.url}');` +
    `background-size:${sheetW}px ${w}px;background-repeat:no-repeat;` +
    `--strip-w:${sheetW}px;image-rendering:pixelated;` +
    `animation:y-strip ${dur} steps(${strip.frames}) infinite${delay ? ` ${delay}` : ''}`
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
  const strip = stripUrl(sheet, clip, dir)
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
  return wrap
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
  const s = stripActor(name, {
    w: cellW * zoom, h: cellH * zoom,
    sheetW: cellW * frames * zoom, sheetH: cellH * zoom,
    frames, dur, keyframe: 'y-strip', delay,
  })
  if (!s) return null
  s.style.cssText += `position:absolute;left:${x}px;top:${y}px`
  return s
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
 * Port of `docs/reference/Whitacre Yard at Dusk.html`, in its DOM order.
 */
function yard(): (HTMLElement | null)[] {
  const L: (HTMLElement | null)[] = []

  // -- the light: a halo, a core, and one slow flicker in nine seconds
  L.push(box(
    'left:792px;top:372px;width:300px;height:300px;border-radius:50%;' +
    'background:radial-gradient(circle,#fff6d6 0%,#ffd884 26%,rgba(255,176,92,0) 66%);' +
    'animation:y-sun 9s ease-in-out infinite',
  ))
  L.push(box(
    'left:896px;top:476px;width:92px;height:92px;border-radius:50%;' +
    'background:radial-gradient(circle,#fffbe8 0%,#ffe6a2 58%,rgba(255,214,124,0) 100%);' +
    'animation:y-sun 9s ease-in-out infinite',
  ))

  // -- three cloud bands, each 3040 wide so the drift never shows an end
  L.push(box(
    'left:0;top:128px;width:3040px;height:30px;opacity:0.22;filter:blur(4px);' +
    'background:repeating-linear-gradient(90deg,rgba(255,220,190,0.55) 0 200px,transparent 200px 470px);' +
    'animation:y-cloud 140s linear infinite',
  ))
  L.push(box(
    'left:0;top:232px;width:3040px;height:20px;opacity:0.2;filter:blur(3px);' +
    'background:repeating-linear-gradient(90deg,rgba(255,208,170,0.6) 0 130px,transparent 130px 380px);' +
    'animation:y-cloud 96s linear infinite',
  ))
  L.push(box(
    'left:0;top:338px;width:3040px;height:14px;opacity:0.18;filter:blur(2px);' +
    'background:repeating-linear-gradient(90deg,rgba(255,196,150,0.65) 0 90px,transparent 90px 300px);' +
    'animation:y-cloud 70s linear infinite',
  ))

  // -- the haze the buildings stand in front of
  L.push(box(
    'left:0;right:0;top:512px;height:120px;filter:blur(2px);' +
    'background:linear-gradient(180deg,rgba(58,46,52,0) 0%,rgba(46,38,44,0.5) 62%,rgba(40,34,38,0.78) 100%)',
  ))

  // -- the ground: the field itself, its lit top edge, and the furrows
  L.push(box(
    'left:0;right:0;top:620px;bottom:0;' +
    'background:linear-gradient(180deg,#575c33 0%,#454c2b 20%,#333a21 50%,#23281a 78%,#191d13 100%)',
  ))
  L.push(box(
    'left:0;right:0;top:620px;height:18px;' +
    'background:linear-gradient(180deg,rgba(244,196,126,0.48),transparent)',
  ))
  L.push(box(
    'left:0;right:0;top:620px;bottom:0;opacity:0.3;' +
    'background-image:repeating-linear-gradient(92deg,rgba(0,0,0,0.3) 0 4px,transparent 4px 13px)',
  ))

  // -- the track worn up to the barn doors
  L.push(box(
    'left:900px;top:630px;width:760px;height:450px;opacity:0.72;' +
    'background:linear-gradient(180deg,#6a5a3c 0%,#7b6945 36%,#6b5a3a 100%);' +
    'clip-path:polygon(46% 0,55% 0,100% 100%,0 100%)',
  ))

  // -- the treeline behind the place, from PLACEMENTS.md
  //
  // These were REMOVED last pass with the note "a wrong tree is louder than no
  // tree": the pack's oak is a modular piece and read as three identical shrubs
  // at this size. The generated one is 59x54, so it goes in at 4x — 236x216
  // against the table's 250x212, and 4 is the integer that lands closest.
  // Design's own final yard drops the oaks entirely; they are back because the
  // owner wants them and the art is now good enough to carry them.
  // The dusk correction is not a preference. Everything else in this scene is
  // lit by a setting sun and carries a warm, low-key palette; the generated oak
  // is drawn at full daylight saturation and read as pasted on until it was
  // brought down to meet the rest. The fence does the same thing harder
  // (brightness 0.62) because it is nearer the camera and more in shadow.
  //
  // THE Y VALUES ARE NOT THE TABLE'S, AND THEY CANNOT BE.
  //
  // PLACEMENTS.md puts these four at y 268/300/282/414 in a 250x212 box. The
  // oak packs at 59x54, so at 4x it is 236x216 and those tops put its BASE at
  // 484, 516, 498 and 630 — against a ground that starts at 620. Three of the
  // four hung 104-136px up in the sky, which is exactly how it looked.
  //
  // There is no reference to copy for this one: `tree_oak` does not appear in
  // `docs/reference/` at all, because Design's final yard drops the oaks and
  // they are here because the owner wants them. So the table is the only source
  // and the table disagrees with the ground layer, which is a CSS layer the
  // table never had. Ground wins — it is in the reference and the table is not.
  //
  // Placed by their base instead: 620 minus the 216 the sprite actually
  // measures, varied a few pixels either side so four identical trees do not
  // line up on a ruler. They are pushed before the buildings, so DOM order —
  // which is paint order — tucks the trunks behind the barn and the house and
  // the row reads as a treeline rather than four props.
  for (const [x, y] of [[596, 410], [1150, 418], [1420, 412], [1742, 414]] as const) {
    L.push(sprite('scene.oak', x, y, 4, 'opacity:0.9;filter:brightness(0.78) saturate(0.82)'))
  }

  // -- the far buildings, all at 1x
  L.push(sprite('scene.silo', 1664, 192))

  // The barn, and the doorway that is the Homestead entrance. The glow is the
  // only thing on this screen that says "you can go in there".
  const barn = box(`left:${YARD_BARN.x}px;top:${YARD_BARN.y}px;width:480px;height:224px`)
  const barnImg = spriteEl('scene.barn', 4096, 1)
  if (barnImg) {
    barnImg.style.cssText += 'position:absolute;inset:0'
    barn.append(barnImg)
  }
  barn.append(box(
    `left:${BARN_DOOR.x - 10}px;top:${BARN_DOOR.y - 10}px;` +
    `width:${BARN_DOOR.w + 20}px;height:${BARN_DOOR.h + 20}px;pointer-events:none;` +
    'background:radial-gradient(60% 60% at 50% 62%,rgba(255,206,120,0.6),transparent 72%);' +
    'animation:y-door 3.6s ease-in-out infinite',
  ))
  L.push(barn)

  // The farmhouse: a porch light that catches once, and the stove still lit.
  const house = box('left:430px;top:320px;width:256px;height:320px')
  const houseImg = spriteEl('scene.house', 4096, 1)
  if (houseImg) {
    houseImg.style.cssText += 'position:absolute;inset:0'
    house.append(houseImg)
  }
  house.append(box(
    'left:146px;top:226px;width:104px;height:104px;' +
    'background:radial-gradient(circle,rgba(255,214,140,0.7) 0%,rgba(255,190,110,0.2) 42%,transparent 72%);' +
    'animation:y-porch 11s ease-in-out infinite',
  ))
  for (const [size, alpha, blur, delay] of [
    [16, 0.5, 4, ''], [19, 0.42, 5, '2.5s'], [13, 0.46, 3, '5s'],
  ] as const) {
    house.append(box(
      `left:118px;top:46px;width:${size}px;height:${size}px;border-radius:50%;` +
      `background:rgba(214,206,196,${alpha});filter:blur(${blur}px);` +
      `animation:y-smoke 7.5s linear infinite${delay ? ` ${delay}` : ''}`,
    ))
  }
  L.push(house)

  // -- the yard's own furniture
  L.push(sprite('scene.coop', 800, 478))
  L.push(sprite('scene.nest', 936, 542))
  // A real sway rather than `y-sway`, which rotated the whole sprite about its
  // base — a scarecrow tips, its straw does not stay rigid while the post leans.
  L.push(actor('scene.scarecrowSwayStrip', 968, 546, 96, 96, 7, '7.4s')
    ?? sprite('scene.scarecrow', 968, 546,
      1, 'transform-origin:50% 92%;animation:y-sway 7.4s ease-in-out infinite'))
  L.push(sprite('scene.well', 1112, 596))
  L.push(sprite('scene.hay', 646, 616))
  L.push(sprite('scene.doghouse', 722, 552))

  /*
     THE OWNER'S OWN FLOCK, around the coop.

     Ten different birds rather than one bird ten times, which was the explicit
     ask -- and they differ in SIZE as well as plumage (the chick packs at 34px,
     the buff Orpington at 56), so a row of them at one zoom already reads as a
     real flock with no per-bird treatment.

     `clipActor` where a bird has an ambient clip and `spriteEl` where it does
     not, so this degrades to a still yard rather than to a missing one while
     the rest of the animations generate. Durations are deliberately coprime,
     the same rule the cow/calf/sheep in the pen already follow: three animals
     pecking on the same beat read as one machine.

     Facings are mixed on purpose. A yard where every animal faces the camera is
     a lineup, not a farm.
  */
  const FLOCK: [string, string, number, number, string, string][] = [
    ['brahmaHen', 'downRight', 792, 566, '1.7s', '0s'],
    ['buffHen', 'down', 862, 590, '2.3s', '0.4s'],
    ['barredHen', 'downLeft', 928, 604, '1.9s', '0.9s'],
    ['leghornHen', 'right', 744, 604, '2.1s', '0.2s'],
    ['silkieHen', 'downRight', 690, 636, '2.7s', '1.1s'],
    ['polishHen', 'down', 836, 640, '2.9s', '0.6s'],
    ['beardedHen', 'downLeft', 906, 656, '2.2s', '1.4s'],
    ['bantamHen', 'right', 776, 668, '1.5s', '0.8s'],
    ['chick', 'downRight', 820, 690, '1.3s', '0.3s'],
    ['farmRooster', 'downLeft', 964, 596, '3.4s', '0s'],
  ]
  for (const [id, dir, x, y, dur, delay] of FLOCK) {
    const clips = clipsOf(id)
    const ambient = clips.peck ? 'peck' : clips.crow ? 'crow' : null
    L.push(ambient
      ? clipActor(id, ambient, dir, x, y, dur, 2, delay)
      : sprite(`${id}.idle.${dir}`, x, y, 2))
  }

  // Joy on the porch side of her house, and the cats where cats go.
  {
    const joyClips = clipsOf('joy')
    L.push(joyClips.sit
      ? clipActor('joy', 'sit', 'downRight', 700, 620, '3.1s', 2)
      : sprite('joy.idle.downRight', 700, 620, 2))
  }
  L.push(sprite('wiz.idle.downLeft', 1104, 672, 2))
  L.push(sprite('tabbyCat.idle.right', 1180, 640, 2))

  // -- the stock pen: rails, a gate, two posts and a sign
  const pen = box('left:1596px;top:646px;width:324px;height:74px')
  const rail = 'height:26px;'
  for (const css of [
    `left:0;right:0;top:0;${rail}opacity:0.92`,
    `left:0;width:132px;bottom:0;${rail}`,
    `right:0;width:108px;bottom:0;${rail}`,
  ]) {
    const b = tileBand('scene.penH', css, 24, 26)
    if (b) pen.append(b)
  }
  for (const [name, css] of [
    ['scene.penC1', 'left:-4px;top:0'],
    ['scene.penGate', 'left:138px;bottom:0'],
    ['scene.penV', 'left:-2px;top:20px'],
    ['scene.penV', 'right:-2px;top:20px'],
    ['scene.signCow', 'left:96px;bottom:14px'],
  ] as const) {
    const s = spriteEl(name, 4096, 1)
    if (s) { s.style.cssText += `position:absolute;${css}`; pen.append(s) }
  }
  L.push(pen)

  // The pen: grazing rather than bobbing. Durations are deliberately coprime so
  // three animals in one pen never fall into step and read as one machine.
  L.push(actor('scene.cowGrazeStrip', 1628, 658, 90, 54, 9, '5.4s')
    ?? sprite('scene.cow', 1628, 658))
  L.push(actor('scene.calfGrazeStrip', 1746, 672, 52, 40, 9, '3.1s', 1, '0.6s')
    ?? sprite('scene.calf', 1746, 672))
  L.push(actor('scene.sheepGrazeStrip', 1826, 678, 52, 34, 9, '4.3s', 1, '1.4s')
    ?? sprite('scene.sheep', 1826, 678))
  L.push(sprite('scene.trough', 1600, 700))

  /*
     The owner's equines, at the rail beside the pen rather than inside it.

     Outside on purpose: the pen already holds a cow, a calf and a sheep, and
     five more animals in a 324px box is a pile. Standing along the rail reads
     as a yard that has more animals than pens, which is what a real one looks
     like.
  */
  const RAIL: [string, string, number, number, string][] = [
    ['fjordPony', 'downRight', 1420, 668, '4.7s'],
    ['arabian', 'down', 1520, 690, '5.3s'],
    ['blackMule', 'downLeft', 1352, 706, '6.1s'],
    ['beigeMule', 'right', 1276, 674, '5.9s'],
    ['rosie', 'downRight', 1444, 736, '4.1s'],
  ]
  for (const [id, dir, x, y, dur] of RAIL) {
    L.push(clipsOf(id).graze
      ? clipActor(id, 'graze', dir, x, y, dur, 2)
      : sprite(`${id}.idle.${dir}`, x, y, 2))
  }

  // -- actors at 2x. Two hens cross the whole yard, right to left.
  for (const [anim, step] of [
    ['y-cross 132s linear infinite', '1.15s'],
    ['y-cross 168s linear infinite 20s', '1.35s'],
  ] as const) {
    L.push(travelling(2000, 664, anim, stripActor('scene.chickenWalkLeftStrip', {
      w: 64, h: 64, sheetW: 384, sheetH: 64, frames: 6, dur: step, keyframe: 'y-strip-384',
    })))
  }

  L.push(peck(856, 676, '2s'))
  L.push(actor('scene.chickPeckStrip', 920, 678, 32, 32, 9, '2.2s', 2)
    ?? sprite('scene.chick', 920, 678, 2))
  // The scene pack's own rooster crop is entirely transparent. This is
  // generated art rather than the game's 32px field rooster, so he is a head
  // taller than the hens pecking beside him — which is the point of a rooster.
  // It is a trimmed frame, hence the box: the reference's slot is 64x64 and the
  // bird stands on its floor.
  /*
     THE ROOSTER WALKS A BEAT, PECKS, AND CROWS — one 24s cycle, four layers.

     A wrapper carries the PATH and the three strips sit inside it at 0,0, each
     cut in and out by a keyframe sharing that period. Splitting movement from
     appearance is what keeps this tractable: the wrapper only ever translates,
     and a strip only ever decides whether it is the one on screen.

     He walks out and BACK rather than in a circle, because the sprite has one
     facing. A circle would have him moonwalking through half of it; the return
     leg flips `scaleX` instead, which is why the path keyframe carries both
     transforms in every stop — writing only one silently drops the other.

     Placed at 763,642 so his feet land where the old still frame's did; see the
     note on `spriteInBox` for that arithmetic. A missing strip falls back to
     the static bird rather than an empty yard.
  */
  const roosterWalk = actor('scene.roosterWalkStrip', 0, 0, 54, 62, 9, '0.9s')
  const roosterPeck = actor('scene.roosterPeckStrip', 0, 0, 54, 62, 9, '2.4s')
  const roosterCrow = actor('scene.roosterCrowStrip', 0, 0, 54, 62, 9, '1.4s')
  if (roosterWalk && roosterPeck && roosterCrow) {
    const beat = '24s'
    roosterWalk.style.animation += `, y-rooster-walk ${beat} infinite`
    roosterPeck.style.animation += `, y-rooster-peck ${beat} infinite`
    roosterCrow.style.animation += `, y-rooster-crow ${beat} infinite`
    const yard = box(`left:763px;top:642px;width:54px;height:62px;animation:y-rooster-path ${beat} infinite`)
    yard.append(roosterWalk, roosterPeck, roosterCrow)
    L.push(yard)
  } else {
    L.push(spriteInBox('scene.rooster', 758, 640, 64, 64, 1))
  }
  L.push(peck(992, 660, '2.6s', '0.8s'))
  L.push(peck(1064, 674, '3.1s', '1.9s'))

  // -- a hand crossing the yard, and another walking away up the track
  L.push(travelling(470, 566, 'y-across 61s linear infinite',
    stripActor('scene.farmerWalkStrip', {
      w: 64, h: 128, sheetW: 384, sheetH: 128, frames: 6, dur: '1.1s', keyframe: 'y-strip-384',
    })))
  L.push(travelling(1290, 1010, 'y-up 74s linear infinite',
    stripActor('scene.farmerWalkUpStrip', {
      w: 64, h: 128, sheetW: 384, sheetH: 128, frames: 6, dur: '1.05s', keyframe: 'y-strip-384',
    })))

  // -- the fence, which everything above walks behind
  L.push(tileBand('scene.fencePicket',
    'left:-20px;right:-20px;top:742px;height:32px;filter:brightness(0.62)', 96, 32))

  // -- the nearest ground, in front of the fence, at 2x
  L.push(actor('scene.dogIdleStrip', 132, 818, 60, 42, 9, '2.9s', 2)
    ?? sprite('scene.dogLab', 132, 818, 2))
  L.push(sprite('scene.milkcan', 24, 872, 2))
  L.push(sprite('scene.milkcan', 66, 890, 2))

  L.push(firefly(560, 830, 6, 10, 0.7, '90px', '-120px', 'y-fly 9s ease-in-out infinite'))
  L.push(firefly(1240, 860, 5, 10, 0.7, '-70px', '-150px', 'y-fly 12s ease-in-out infinite 2s'))
  L.push(firefly(1660, 800, 6, 12, 0.7, '60px', '-190px', 'y-fly 10.5s ease-in-out infinite 4s'))
  L.push(firefly(900, 880, 4, 9, 0.6, '120px', '-100px', 'y-fly 14s ease-in-out infinite 1s'))

  L.push(...vignette(
    'radial-gradient(120% 78% at 50% 56%,transparent 42%,rgba(12,10,14,0.52) 100%)',
    'linear-gradient(180deg,rgba(10,9,14,0.44) 0%,transparent 22%,transparent 56%,rgba(10,9,8,0.68) 100%)',
  ))
  return L
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

/** A pecking hen at 2x: a four-frame strip, 256px wide on screen. */
function peck(x: number, y: number, dur: string, delay?: string): HTMLElement | null {
  const s = stripActor('scene.chickenPeckStrip', {
    w: 64, h: 64, sheetW: 256, sheetH: 64, frames: 4, dur, keyframe: 'y-strip-256', delay,
  })
  if (!s) return null
  s.style.cssText += `position:absolute;left:${x}px;top:${y}px`
  return s
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

  L.push(box(
    'left:660px;top:400px;width:260px;height:260px;border-radius:50%;' +
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
    stripActor('scene.farmerWalkStrip', {
      w: 32, h: 64, sheetW: 192, sheetH: 64, frames: 6, dur: '1.2s', keyframe: 'f-strip-192',
    })))
  L.push(travelling(540, 512, 'f-horizon-back 118s linear infinite',
    stripActor('scene.farmerWalkStrip', {
      w: 32, h: 64, sheetW: 192, sheetH: 64, frames: 6, dur: '1.34s', keyframe: 'f-strip-192',
    })))

  for (const [x, y, dur, delay] of [
    [1350, 542, '2.4s', undefined], [1386, 548, '3.1s', '0.7s'],
    [1478, 544, '2.8s', '1.5s'], [1560, 540, '3.4s', '2.2s'],
  ] as const) {
    const s = stripActor('scene.chickenPeckStrip', {
      w: 32, h: 32, sheetW: 128, sheetH: 32, frames: 4, dur, keyframe: 'f-strip-128', delay,
    })
    if (s) { s.style.cssText += `position:absolute;left:${x}px;top:${y}px`; L.push(s) }
  }

  for (const [x, y, travel, step] of [
    [1700, 540, 'f-horizon 140s linear infinite 8s', '1.3s'],
    [1620, 552, 'f-horizon 116s linear infinite 24s', '1.5s'],
  ] as const) {
    L.push(travelling(x, y, travel, stripActor('scene.chickenWalkLeftStrip', {
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
    stripActor('scene.farmerWalkStrip', {
      w: 64, h: 128, sheetW: 384, sheetH: 128, frames: 6, dur: '1.12s', keyframe: 'f-strip-384',
    })))

  L.push(firefly(480, 880, 5, 10, 0.7, '80px', '-130px', 'f-fly 11s ease-in-out infinite'))
  L.push(firefly(1420, 840, 6, 11, 0.7, '-60px', '-160px', 'f-fly 13s ease-in-out infinite 3s'))

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
  return el2
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
 * `clipActor` takes an INTEGER zoom and cannot hit a target size; `groundActor`
 * hits the size but positions by the feet and adds a contact shadow, which is
 * wrong for a bubbling tank bolted to a wall. This is the third case: exact
 * height, top-left placement, no shadow.
 */
function clipActorAt(
  sheet: string, clip: string, dir: string,
  x: number, y: number, height: number, dur: string, delay?: string, css = '',
): HTMLElement | null {
  const strip = stripUrl(sheet, clip, dir)
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
  return d
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
  const strip = stripUrl(sheet, clip, dir)
  if (!strip) return null
  const scale = height / strip.cell
  const w = strip.cell * scale
  const sheetW = w * strip.frames
  const d = document.createElement('div')
  d.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${w}px;` +
    `background-image:url('${strip.url}');background-size:${sheetW}px ${w}px;` +
    `background-repeat:no-repeat;--strip-w:${sheetW}px;image-rendering:pixelated;` +
    `animation:${anim};${css}`
  return d
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
  const wrap = box(`left:${x}px;top:${y}px;animation:mull-${key}-path ${dur} step-end infinite`)
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

    patrol('baseTech', 861, 696, 174, 'tech', '47s'),
    patrol('baseGuard', 420, 770, 190, 'guard', '59s', dim(0.86)),

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

export function buildScene(kind: SceneKind): HTMLElement {
  const root = el('div', { class: `home-yard is-${kind}` })
  const layers = kind === 'lab' ? lab() : kind === 'field' ? field() : yard()
  for (const layer of layers) {
    if (layer) root.append(layer)
  }
  return root
}
