/**
 * Guards on the content that the type system cannot express.
 *
 * These exist because every one of them has actually been wrong in a build that
 * shipped, and none of them was caught by a test that only asked "does the game
 * run" — it ran fine, it just looked wrong.
 */
import { describe, it, expect } from 'vitest'
import { WEAPONS, ELEMENTS, ITEMS, TUNING, MAPS, ENEMIES, projectileScaleFor } from '../src/content/index'

/**
 * Behaviours that put a travelling object on screen.
 *
 * The Chem Sprayer is `ranged` but sprays an aura — a ring around the player,
 * not a round in flight — so it is correctly clipless. Keying off behaviour
 * rather than type is what tells "fires nothing visible" apart from "fires
 * something that is not a projectile".
 */
const LAUNCHES = new Set(['stream', 'pierceShot', 'arcLob', 'bounceSplit', 'throwPuddle', 'hookFurthest'])
const RANGED = Object.entries(WEAPONS).filter(([, d]) => LAUNCHES.has(d.behaviour))

describe('weapon rounds', () => {
  it('gives every ranged weapon a round to fire', () => {
    const silent = RANGED.filter(([, d]) => !d.projectileClip).map(([id]) => id)
    expect(silent).toEqual([])
  })

  /**
   * The complaint this whole pass came from: "all the bullets looked the same,
   * new weapons didn't appear to shoot any kind of novel round". Two weapons
   * sharing a clip is that bug, expressed as data.
   */
  it('never gives two ranged weapons the same round', () => {
    const byClip = new Map<string, string[]>()
    for (const [id, d] of RANGED) {
      const c = d.projectileClip as string
      byClip.set(c, [...(byClip.get(c) ?? []), id])
    }
    const shared = [...byClip].filter(([, ids]) => ids.length > 1)
    expect(shared).toEqual([])
  })

  it('scales every round to something you can actually see', () => {
    // A round below ~0.5 of the base scale is a smudge at this zoom; that is how
    // six distinct bullets came to read as one.
    for (const [id] of RANGED) {
      expect(projectileScaleFor(id), `${id} projectileScale`).toBeGreaterThan(0.5)
    }
  })
})

describe('elements', () => {
  /**
   * An element must RECOLOUR a weapon's round, never replace it. Replacing was
   * the original bug: take an element and all six guns fire one identical
   * bullet. A stray `clip` key on an element is that behaviour coming back.
   */
  it('recolours rounds rather than replacing them', () => {
    for (const [id, e] of Object.entries(ELEMENTS)) {
      expect(e, `element ${id} must not carry its own clip`).not.toHaveProperty('clip')
    }
  })
})

describe('offers', () => {
  it('describes every weapon and item in one sentence', () => {
    const bare = [
      ...Object.entries(WEAPONS).filter(([, d]) => typeof d.blurb !== 'string'),
      ...Object.entries(ITEMS).filter(([, d]) => typeof d.blurb !== 'string'),
    ].map(([id]) => id)
    expect(bare).toEqual([])
  })

  /** `_`-prefixed notes are documentation; a bare string in a roster crashes. */
  it('keeps design notes out of the rosters', () => {
    for (const rec of [WEAPONS, ITEMS, ELEMENTS]) {
      for (const [k, v] of Object.entries(rec)) {
        expect(k.startsWith('_'), `${k} leaked into a roster`).toBe(false)
        expect(typeof v, `${k} should be an object`).toBe('object')
      }
    }
  })
})

describe('camera zoom', () => {
  /**
   * A fixed zoom made screen size and DPI control how much world you see, so a
   * bigger or denser monitor zoomed OUT. At 1920x1080 dpr 1.5 that was 810
   * world pixels of vertical view, the farmer 2% of screen width, and every
   * round a speck — which is why six distinct bullets still read as one after
   * the art was fixed. Zoom must hold the world scale roughly constant instead.
   */
  it('keeps the visible world about the same height on any screen', async () => {
    const { zoomFor } = await import('../src/render/renderer')
    const cam = TUNING.camera as unknown as Record<string, number>
    const target = cam.targetWorldHeight
    // canvas heights for 1366/1080/1440/2160 at plausible pixel ratios
    for (const h of [768, 1080, 1350, 1620, 1440, 2160, 2880, 4320]) {
      const view = h / zoomFor(h)
      // Integer zoom quantises this, and small screens bottom out at minZoom
      // and simply show less, so the band is generous. What it is really
      // guarding is that DPI cannot make the view balloon the way it used to:
      // 1620px canvas showed 810 world px before and 540 now.
      expect(view, `canvas ${h}px -> ${view.toFixed(0)} world px`).toBeGreaterThan(target * 0.6)
      expect(view, `canvas ${h}px -> ${view.toFixed(0)} world px`).toBeLessThan(target * 1.25)
    }
  })

  it('only ever picks an integer zoom', async () => {
    const { zoomFor } = await import('../src/render/renderer')
    for (const h of [400, 768, 1080, 1620, 2160, 4320]) {
      expect(Number.isInteger(zoomFor(h)), `zoomFor(${h})`).toBe(true)
    }
  })
})

describe('card art', () => {
  /**
   * `items.json` used to carry an `icon` field holding plain words — `clover`,
   * `coffee`, `hat` — which were never atlas keys, so 17 of 22 items rendered
   * as text-only cards in the shop, the level-up and the Homestead alike. It
   * was invisible because a missing sprite degrades to nothing rather than
   * erroring, which is exactly why it survived to M7.
   *
   * Reads the built atlas rather than mocking it, so this fails when the art
   * and the content disagree, not merely when a string is absent.
   */
  it('gives every item and weapon a card sprite that is actually packed', async () => {
    const { readFileSync } = await import('node:fs')
    const frames = JSON.parse(readFileSync('public/atlas.json', 'utf8')).frames as Record<string, unknown>
    const bad: string[] = []
    for (const [id, def] of Object.entries(ITEMS)) {
      const key = def.cardSprite as string | undefined
      if (!key || !(key in frames)) bad.push(`item ${id} -> ${key ?? 'none'}`)
    }
    for (const [id, def] of Object.entries(WEAPONS)) {
      const key = def.sprite
      if (!key || !(key in frames)) bad.push(`weapon ${id} -> ${key ?? 'none'}`)
    }
    expect(bad).toEqual([])
  })

  /**
   * The scene scale table.
   *
   * This exists because the first title screens came out with a bulldog the
   * size of a pony, and the cause was that the SOURCE ART IS NOT TO SCALE:
   * every animal is authored on the game's 32x64 grid, so a cat is 16x42, a
   * bulldog 29x42, a pony 25x53 and a grown man 30x52. Drawn at their own size
   * they are a row of identical silhouettes.
   *
   * `art/scene-scale.json` is the correction, and the only property that has to
   * hold is the ORDER. The absolute numbers are stylised on purpose -- a cat at
   * true scale is 9px and unreadable -- so asserting them would be asserting
   * taste. Asserting that a hen is smaller than a dog is smaller than a pony is
   * smaller than a barn is asserting the thing that was actually broken.
   */
  it('draws the cast in an order that matches the real world', async () => {
    const { readFileSync } = await import('node:fs')
    const scale = JSON.parse(readFileSync('art/scene-scale.json', 'utf8')) as {
      drawAt: Record<string, number>
      tallOverrides: Record<string, number>
    }
    const at = scale.drawAt
    const ordered = [
      'chick', 'bantamHen', 'silkieHen', 'brahmaHen', 'farmRooster',
      'rosie', 'fjordPony', 'arabian',
    ]
    for (let i = 1; i < ordered.length; i++) {
      const small = ordered[i - 1]
      const big = ordered[i]
      expect(at[small], `${small} must be smaller than ${big}`).toBeLessThan(at[big])
    }
    // A cat is smaller than a dog is smaller than a person is smaller than a horse.
    expect(at.wiz).toBeLessThan(at.joy)
    expect(at.joy).toBeLessThan(at.hand)
    expect(at.hand).toBeLessThan(at.fjordPony)
    /*
       Buildings are compared only among themselves, and that is not laziness.

       THE TWO FAMILIES ARE IN DIFFERENT UNITS: a cast entry is a HEIGHT and a
       building entry is a WIDTH, because that is the dimension each is
       naturally described by. The first version of this test asserted a horse
       (104 tall) was shorter than a chicken coop (92 wide) and failed, which
       was the test being wrong rather than the data -- a coop really is about
       2.5m wide and about 2m tall, so it is shorter than a horse and wider than
       one at the same time. Comparing across the families means nothing.
    */
    expect(at['ranch.coop']).toBeLessThan(at['ranch.farmhouse'])
    expect(at['ranch.farmhouse']).toBeLessThan(at['ranch.barn'])
    expect(at['ranch.feedBucket']).toBeLessThan(at['ranch.roundBale'])
    expect(at['ranch.roundBale']).toBeLessThan(at['ranch.tractor'])
  })

  it('never draws a sprite at its source size, because that is the bug', async () => {
    // The specific failure: `spriteEl` snaps to whole-pixel zoom, so every one
    // of these came back at roughly its source height whatever box was asked
    // for. If `draw at` ever collapses back toward source size, the same row of
    // identical silhouettes returns.
    const { readFileSync } = await import('node:fs')
    const at = (JSON.parse(readFileSync('art/scene-scale.json', 'utf8')) as {
      drawAt: Record<string, number>
    }).drawAt
    const frames = JSON.parse(readFileSync('public/atlas.json', 'utf8')).frames as
      Record<string, { w: number; h: number }>
    // A pony and a bulldog are within 11px of each other in the SOURCE...
    const ponySrc = frames['fjordPony.idle.down.0']
    const dogSrc = frames['joy.idle.down.0']
    expect(Math.abs(ponySrc.h - dogSrc.h)).toBeLessThan(16)
    // ...and must not be, once drawn.
    expect(at.fjordPony - at.joy).toBeGreaterThan(40)
  })

  /**
   * A `drawAt` entry must point at art that is actually packed.
   *
   * There are THREE shapes a scale key can take and this once knew only two,
   * so it went red the moment the ambient loops were given draw sizes and
   * stayed red across a push:
   *
   *   `ranch.barn`            a still  -> the key IS the frame key
   *   `fjordPony`, `vet`      a cast sheet -> `<k>.idle.down.0`
   *   `vatSpecimen`, `wheat`  an ambient loop -> `<k>.bubble.down.0`, `<k>.sway.down.0`
   *
   * The third has no `idle`; its clip is whatever the loop was named. Matching
   * any packed frame under the key's own prefix covers all three and still
   * fails on what this is for — a key that points at nothing, from a typo or
   * from art that was renamed or dropped.
   */
  it('gives every scale entry something real to scale', async () => {
    const { readFileSync } = await import('node:fs')
    const at = (JSON.parse(readFileSync('art/scene-scale.json', 'utf8')) as {
      drawAt: Record<string, number>
    }).drawAt
    const frames = JSON.parse(readFileSync('public/atlas.json', 'utf8')).frames as
      Record<string, unknown>
    const prefixes = new Set<string>()
    for (const key of Object.keys(frames)) {
      const cut = key.indexOf('.', key.startsWith('vault.') || key.startsWith('ranch.')
        || key.startsWith('scene.') || key.startsWith('pen.') || key.startsWith('sceneBg.')
        ? key.indexOf('.') + 1 : 0)
      if (cut > 0) prefixes.add(key.slice(0, cut))
    }
    const missing = Object.keys(at).filter(
      (k) => !(k in frames) && !prefixes.has(k),
    )
    expect(missing).toEqual([])
  })
})

describe('enemy art', () => {
  /**
   * Every enemy a map can roll must have its sheet in the atlas.
   *
   * `baseOperator` and `baseBreacher` shipped wired into `enemies.json` and
   * given spawn weights in two sector maps while neither was ever declared in
   * `art/sprites.json` — so neither had a single packed frame, and both would
   * have walked into the lab as plain coloured rectangles. Nothing caught it:
   * the maps test asserts a biased enemy is a DEFINED enemy, which they were,
   * and the renderer degrades a missing frame to `null` and draws the fallback
   * box rather than erroring. A defect that only shows up by looking is exactly
   * the kind this file exists for.
   *
   * Spawnable means `weight > 0` (the default) or ANY map raising it by name —
   * `enemyBias` replaces the weight rather than multiplying it, which is the
   * whole mechanism by which the base cast sits at 0 and still appears
   * underground.
   *
   * Reads the built atlas, so it fails when the art and the content disagree.
   * Checks every direction of every clip the sheet claims, because a partial
   * ring is the documented failure of the v3 rotations and it animates into
   * empty space rather than erroring too.
   */
  it('packs a sheet for every enemy a map can roll', async () => {
    const { readFileSync } = await import('node:fs')
    const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as {
      rig: { directions: string[] }
      dirSets?: Record<string, string[]>
      clipLengths: Record<string, Record<string, number>>
      frames: Record<string, unknown>
    }

    const spawnable = new Set<string>()
    for (const [id, def] of Object.entries(ENEMIES)) {
      if ((def.weight ?? 1) > 0) spawnable.add(id)
    }
    for (const map of Object.values(MAPS)) {
      for (const [id, w] of Object.entries(map.enemyBias)) if (w > 0) spawnable.add(id)
    }

    const bad: string[] = []
    for (const id of [...spawnable].sort()) {
      // What the SIM actually uses (`world.ts` spawn): the `sheets` array when
      // the type declares variants, else the type id. NOT `def.sheet` -- that
      // singular field is vestigial and disagrees with the packed art for six
      // enemies (`farmhand` claims "zombie", `sickHog` claims "pig"), which is
      // exactly the trap that makes a check like this look broken when it is
      // the field that is.
      const sheets = (ENEMIES[id]?.sheets as string[] | undefined) ?? [id]
      for (const sheet of sheets) {
        const clips = atlas.clipLengths[sheet]
        if (!clips) { bad.push(`${id} -> sheet "${sheet}" is not packed at all`); continue }
        const dirs = atlas.dirSets?.[sheet] ?? atlas.rig.directions
        // `idle` and `walk` ONLY. Everything above them in the renderer's chain
        // -- hit, attack, walkHurt, death -- returns undefined when absent and
        // falls through to the next by design, which is what lets the roster
        // gain clips one animal at a time. `humanoidFrame` is the last link and
        // has nothing to fall back to, so these two are the real floor.
        for (const clip of ['idle', 'walk']) {
          const frames = clips[clip]
          if (!frames) { bad.push(`${id} -> sheet "${sheet}" has no ${clip} clip`); continue }
          for (const dir of dirs) {
            for (let i = 0; i < frames; i++) {
              const key = `${sheet}.${clip}.${dir}.${i}`
              if (!(key in atlas.frames)) { bad.push(`${id} -> missing ${key}`); break }
            }
          }
        }
      }
    }
    expect(bad).toEqual([])
  })
})
