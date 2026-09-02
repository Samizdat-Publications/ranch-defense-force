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

  // -- the light: a halo, a core, and one slow flicker in nine seconds
  push(box(
    'left:792px;top:372px;width:300px;height:300px;border-radius:50%;' +
    'background:radial-gradient(circle,#fff6d6 0%,#ffd884 26%,rgba(255,176,92,0) 66%);' +
    'animation:y-sun 9s ease-in-out infinite',
  ))
  push(box(
    'left:896px;top:452px;width:92px;height:92px;border-radius:50%;' +
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
  // The doorway that is the Homestead entrance, lit from inside.
  push(box(
    'left:1246px;top:606px;width:132px;height:100px;' +
    'background:radial-gradient(60% 60% at 50% 66%,rgba(255,206,120,0.6),transparent 72%);' +
    'animation:y-door 3.6s ease-in-out infinite',
  ))
  push(shadow(500, 680, 280, 34, 0.52, 7))
  push(plate('ranch.farmhouse', 405, 254, 544, 'filter:brightness(0.86) saturate(0.9);'))
  push(box(
    'left:566px;top:560px;width:140px;height:140px;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,214,140,0.6) 0%,rgba(255,190,110,0.18) 42%,' +
    'transparent 72%);animation:y-porch 11s ease-in-out infinite',
  ))
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
  push(box(
    'left:900px;top:700px;width:760px;height:380px;opacity:0.7;' +
    'background:linear-gradient(180deg,#6a5a3c 0%,#7b6945 36%,#6b5a3a 100%)',
  ))

  push(clipActorAt('scarecrow', 'sway', 'down', 1404, 648, 96, '7.4s'))

  // -- the yard furniture
  push(plate('ranch.roundBale', 605, 657, 107, 'filter:brightness(0.9) saturate(0.94);'))
  push(plate('ranch.squareBales', 729, 743, 21, 'filter:brightness(0.9);'))
  push(plate('ranch.doghouse', 825, 693, 54, 'filter:brightness(0.92);'))
  push(plate('ranch.wellStone', 688, 734, 69, 'filter:brightness(0.92) saturate(0.92);'))
  push(plate('ranch.coop', 958, 626, 171, 'filter:brightness(0.88) saturate(0.88);'))
  push(plate('ranch.nestBox', 1085, 722, 32, 'filter:brightness(0.9);'))
  push(plate('ranch.feedPan', 889, 749, 53, 'filter:brightness(0.94);'))
  push(plate('ranch.eggClutch', 1105, 730, 28))
  push(plate('ranch.eggClutch', 985, 786, 28))

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
