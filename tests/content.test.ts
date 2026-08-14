/**
 * Guards on the content that the type system cannot express.
 *
 * These exist because every one of them has actually been wrong in a build that
 * shipped, and none of them was caught by a test that only asked "does the game
 * run" — it ran fine, it just looked wrong.
 */
import { describe, it, expect } from 'vitest'
import { WEAPONS, ELEMENTS, ITEMS, TUNING, projectileScaleFor } from '../src/content/index'

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
})
