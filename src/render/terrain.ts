/**
 * The ground of one map, as a stack of Wang layers.
 *
 * ## What this replaces
 *
 * The bake used to be three hardcoded passes — grass everywhere, worn dirt
 * blobbed through it, tilled soil down two edges — written out twice, once in
 * `Renderer.bakeWangGround` and once in `tools/draw-world.ts`. That gave one
 * arena, one look, and two copies of the rules to keep in step by hand.
 *
 * Here a map is DATA: an ordered list of layers, each naming a Wang set and a
 * SHAPE that decides where its upper terrain sits. Both renderers ask this
 * module for the fields and then do nothing but paint them, so there is one
 * copy of the map logic and the duplication that remains is only the blitting.
 * Same move `blight.ts` made in session 13, for the same reason.
 *
 * ## Vertices, not cells
 *
 * Every field here is `(cols+1) * (rows+1)` — one entry per tile CORNER. A cell
 * is drawn by asking what sits at its four corners and picking the tile that
 * matches, so a boundary runs THROUGH tiles instead of around them. That is the
 * whole reason the ground stopped looking blocky, and no amount of extra tile
 * detail substitutes for it: the staircase was in the geometry.
 *
 * ## Determinism, and why each layer gets its own stream
 *
 * A run replays from its seed and the ground is part of what replays. Every
 * layer draws from `Rng(seed ^ salt ^ index)` rather than from a shared walk
 * down one stream, so **editing layer 2 cannot move layer 3.** A single shared
 * stream would make every map's appearance depend on the exact draw count of
 * every layer above it, which is the same class of trap as the blight's
 * draw-all-use-some rule and is invisible until someone tunes a number.
 *
 * The map's own stream is separate again and is derived from the seed rather
 * than drawn from the world's RNG — see `mapForSeed` in `src/content`. Nothing
 * here ever touches the simulation's stream.
 */
import { Rng } from '../core/rng'
import type { MapDef, MapLayer } from '../content'

/** One painted pass: a Wang set, where its upper terrain sits, and how. */
export interface GroundLayer {
  /** Wang set name, packed as `wang.<set>.<NW><NE><SW><SE>`. */
  set: string
  /** Vertex field. 1 is the set's upper terrain, 0 its lower. */
  field: Uint8Array
  /**
   * Paint every cell, or only cells that touch a 1.
   *
   * True for the BASE layer only, which is the one actually laying the ground
   * down. Every layer above it shares that layer's grass as its own lower
   * terrain, so painting a clear cell repaints identical pixels — it doubles
   * the bake for no visible change. The soil pass has carried that note since
   * it was written; this generalises it.
   */
  coverAll: boolean
}

/**
 * Round disc of vertices, clipped to the field.
 *
 * The same helper the blight uses, because a blob of ground and a blob of ash
 * are the same shape problem and two copies would drift.
 */
function disc(
  field: Uint8Array, vw: number, vh: number,
  cx: number, cy: number, r: number, value: 0 | 1,
): void {
  const rr = r * r
  for (let y = -r; y <= r; y++) {
    const vy = cy + y
    if (vy < 0 || vy >= vh) continue
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > rr) continue
      const vx = cx + x
      if (vx < 0 || vx >= vw) continue
      field[vy * vw + vx] = value
    }
  }
}

/**
 * Fill one layer's vertex field from its shape.
 *
 * Shapes are deliberately few and deliberately coarse. The ground is what two
 * hundred enemies and their bullets are read AGAINST, so its job is to be
 * varied at the scale of a screen and QUIET at the scale of a tile — interest
 * belongs in the props and decals on top of it. That argument already chose the
 * plain tileset over the detailed one in session 12; it chooses the shapes too.
 */
function fillShape(field: Uint8Array, cols: number, rows: number, layer: MapLayer, rng: Rng): void {
  const vw = cols + 1
  const vh = rows + 1
  const value: 0 | 1 = layer.invert ? 0 : 1
  if (layer.invert) field.fill(1)

  switch (layer.shape) {
    case 'fill':
      field.fill(layer.invert ? 0 : 1)
      return

    /*
       Worn patches. The oldest shape here — this is the dirt the farm gets
       walked on, and it is what the original bake did with its 26 blobs.
    */
    case 'blobs': {
      const margin = layer.margin ?? 2
      for (let i = 0; i < layer.count; i++) {
        const cx = rng.int(margin, Math.max(margin, cols - margin))
        const cy = rng.int(margin, Math.max(margin, rows - margin))
        disc(field, vw, vh, cx, cy, rng.int(layer.minRadius, layer.maxRadius), value)
      }
      return
    }

    /*
       A REGION, not a speck: one seed point with several overlapping lobes
       thrown around it.

       `blobs` at a big radius gives circles, and a circle on the ground reads
       as something someone painted rather than as a stretch of different
       ground. Offsetting three to six lobes inside `spread` breaks the arc.
       Same reasoning as the blight's three-lobe blobs, one scale up.
    */
    case 'patches': {
      const margin = layer.maxRadius + 1
      for (let i = 0; i < layer.count; i++) {
        const cx = rng.int(margin, Math.max(margin, cols - margin))
        const cy = rng.int(margin, Math.max(margin, rows - margin))
        const r = rng.int(layer.minRadius, layer.maxRadius)
        disc(field, vw, vh, cx, cy, r, value)
        for (let l = 0; l < layer.lobes; l++) {
          const sp = Math.max(1, Math.round(r * layer.spread))
          disc(
            field, vw, vh,
            cx + rng.int(-sp, sp), cy + rng.int(-sp, sp),
            Math.max(1, Math.round(r * rng.range(0.45, 0.9))), value,
          )
        }
      }
      return
    }

    /*
       Bands along named edges. This is the tilled corn row the spawner brings
       things out of, generalised — a map can till the top and bottom instead,
       or one side only, and the spawner does not care because it spawns on all
       four edges regardless.
    */
    case 'edges': {
      const d = layer.depth
      for (let vy = 0; vy < vh; vy++) {
        for (let vx = 0; vx < vw; vx++) {
          const hit =
            (layer.sides.includes('left') && vx < d) ||
            (layer.sides.includes('right') && vx >= vw - d) ||
            (layer.sides.includes('top') && vy < d) ||
            (layer.sides.includes('bottom') && vy >= vh - d)
          if (hit) field[vy * vw + vx] = value
        }
      }
      return
    }

    /*
       A BAND THAT WANDERS ACROSS THE MAP — a creek, a gravel track, a gully.

       The only shape here with large-scale STRUCTURE, and the one that makes a
       map read as a place rather than as noise with a theme.

       IT IS A MEAN-REVERTING WALK, NOT A RANDOM ONE, and that is the whole
       lesson of the first version. A plain accumulating drift, clamped to
       `wander`, saturates: once the drift hits its limit it stays there, so the
       ribbon leaves at a constant angle. Measured on the first five maps, a
       "vertical" creek crossed a 2800x2000 field corner to corner at about
       forty degrees, and a "horizontal" farm track arced from the bottom-left
       to the top of the map and back down. Neither is a track; both are a
       diagonal with a wobble on it.

       So the walk carries three terms and needs all three:
       - noise, which is the wander;
       - DAMPING on the drift, so a run of same-sign noise decays instead of
         compounding into an angle;
       - a PULL back toward the line it started on, which is what keeps a farm
         track in its lane over a hundred steps.

       Steps are half a vertex apart along the long axis so consecutive discs
       always overlap. A gap in a creek reads as a rendering fault, and the cost
       of oversampling is a few hundred discs on a bake that happens once a wave.
    */
    case 'ribbon': {
      const horizontal = layer.axis === 'h'
      const along = horizontal ? cols : rows
      const across = horizontal ? rows : cols
      const home = rng.range(across * 0.3, across * 0.7)
      const pull = layer.pull ?? 0.05
      let pos = home
      let drift = 0
      for (let s = 0; s <= along * 2; s++) {
        const t = s / 2
        drift = drift * 0.82 + rng.range(-layer.wander, layer.wander)
        pos += drift + (home - pos) * pull
        pos = Math.max(layer.halfWidth, Math.min(across - layer.halfWidth, pos))
        const cx = Math.round(horizontal ? t : pos)
        const cy = Math.round(horizontal ? pos : t)
        disc(field, vw, vh, cx, cy, layer.halfWidth, value)
      }
      return
    }
  }
}

/**
 * Every ground layer of one map, ready to paint in order.
 *
 * The caller paints these, then the blight over them, then nothing — see
 * `bakeWangGround`. The blight is NOT a layer here because it depends on the
 * wave and these do not: a map's ground is baked once and the ash is what
 * expires.
 */
export function groundLayers(map: MapDef, seed: number, cols: number, rows: number): GroundLayer[] {
  const vw = cols + 1
  const vh = rows + 1
  return map.layers.map((layer, i) => {
    const field = new Uint8Array(vw * vh)
    // Per-layer stream. Editing one layer's numbers must not move the next.
    fillShape(field, cols, rows, layer, new Rng((seed ^ 0x7e44a1) + i * 0x9e3779b1))
    return { set: layer.set, field, coverAll: i === 0 }
  })
}
