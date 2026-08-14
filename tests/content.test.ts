/**
 * Guards on the content that the type system cannot express.
 *
 * These exist because every one of them has actually been wrong in a build that
 * shipped, and none of them was caught by a test that only asked "does the game
 * run" — it ran fine, it just looked wrong.
 */
import { describe, it, expect } from 'vitest'
import { WEAPONS, ELEMENTS, ITEMS, projectileScaleFor } from '../src/content/index'

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
