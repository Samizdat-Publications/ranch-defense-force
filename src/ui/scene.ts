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
import { spriteEl, spriteTileUrl, frameOf } from './sprite'

export type SceneKind = 'yard' | 'field'

/** Edge colours the letterbox bleeds with. The scene's own top and bottom. */
export const BLEED: Record<SceneKind, { top: string; bottom: string }> = {
  yard: { top: '#191b36', bottom: '#191d13' },
  field: { top: '#1d2140', bottom: '#201e13' },
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

export const DOOR: Record<SceneKind, { x: number; y: number }> = {
  yard: { x: YARD_BARN.x + BARN_DOOR.x, y: YARD_BARN.y + BARN_DOOR.y + BARN_DOOR.h + 10 },
  field: { x: FIELD_BARN.x + BARN_DOOR.x, y: FIELD_BARN.y + BARN_DOOR.y + BARN_DOOR.h + 10 },
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
export function buildScene(kind: SceneKind): HTMLElement {
  const root = el('div', { class: `home-yard is-${kind}` })
  for (const layer of kind === 'field' ? field() : yard()) {
    if (layer) root.append(layer)
  }
  return root
}
