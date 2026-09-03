/**
 * Facing angle to a direction index. Screen space: +y is down.
 *
 * The two rigs are indexed differently because their direction lists are
 * ordered differently, and neither order is arbitrary:
 *
 * - **Four** is the humanoid rig's `[down, up, left, right]`, which is not
 *   angle-sorted. It is picked apart by comparison so it can BIAS toward the
 *   side views, which carry more information than the front-on pose.
 * - **Eight** is angle-sorted from east, turning clockwise, so it is a single
 *   rounded division. There is no bias to apply: with a diagonal of its own
 *   for every 45 degrees, the nearest direction is always the right one.
 *
 * It lives in its own file, below both the sim and the renderer, because three
 * layers now need the same answer and none of them may import the others. The
 * renderer asks it which sprite row to draw; the content layer asks it which
 * carry anchor a weapon hangs from; the sim asks it where the muzzle of the
 * held weapon is. It used to live in `core/atlas.ts`, which re-exports it, and
 * a sim that had to import the atlas reader to find out which way a man was
 * facing would be the wrong shape entirely.
 */
export function directionIndex(facing: number, count = 4): number {
  if (count === 8) {
    return ((Math.round(facing / (Math.PI / 4)) % 8) + 8) % 8
  }
  const c = Math.cos(facing)
  const s = Math.sin(facing)
  if (Math.abs(c) >= Math.abs(s) * 0.85) return c < 0 ? 2 : 3
  return s > 0 ? 0 : 1
}

/** The humanoid rig's direction list, in its own order. Indexed by the above. */
export const FOUR_WAY = ['down', 'up', 'left', 'right'] as const
