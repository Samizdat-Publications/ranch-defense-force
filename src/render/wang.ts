/**
 * The Wang tileset naming convention, in one place.
 *
 * `create_topdown_tileset` returns sixteen tiles covering every combination of
 * four corner terrains. A cell is drawn by sampling terrain at its four CORNERS
 * — not its centre — and picking the tile whose corners match. That is what
 * gives ground a real boundary instead of a staircase of whole tiles, and it is
 * the whole reason the floor stopped looking blocky.
 *
 * Corner order is **NW NE SW SE, most significant first**, so `wang.x.1101` is
 * upper/upper/lower/upper. The order is arbitrary; agreeing on it is not. The
 * atlas builder and the renderer both call this, so a key can never be built
 * one way in the pack and read another way at draw time — six bugs in this
 * project have been exactly that shape.
 */
export type Corner = 0 | 1

/** 0 is the tileset's `lower` terrain, 1 its `upper`. */
export function wangKey(set: string, nw: Corner, ne: Corner, sw: Corner, se: Corner): string {
  return `wang.${set}.${nw}${ne}${sw}${se}`
}

/** Every key a set publishes, for validating a pack is complete. */
export function wangKeysFor(set: string): string[] {
  const keys: string[] = []
  for (let i = 0; i < 16; i++) {
    keys.push(wangKey(
      set,
      ((i >> 3) & 1) as Corner, ((i >> 2) & 1) as Corner,
      ((i >> 1) & 1) as Corner, (i & 1) as Corner,
    ))
  }
  return keys
}
