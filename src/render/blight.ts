/**
 * The ground gets worse as the run goes on.
 *
 * The premise is a ranch where the crop dusters turned everyone, and the note
 * the game kept getting is that the field does not carry it: the cast is sick
 * and the pasture it stands on is a nice lawn. Ash creeping out across the
 * grass, wave by wave, is the cheapest thing that fixes that — no new art at
 * all. `grass_to_blight` was generated chained off the same canonical grass the
 * ground set already uses, so the two terrains meet exactly and the blight
 * autotiles into the pasture instead of sitting on it as a square.
 *
 * **Deterministic and MONOTONIC, and both of those are load-bearing.**
 *
 * Deterministic, because a run replays from its seed and the ground is part of
 * what replays. Every blob is drawn from a fresh `Rng` on a fixed derivation of
 * the run seed, in a fixed order, and the wave only decides how many of them
 * are USED — never how many are drawn. Re-baking at wave 9 therefore produces
 * the wave-3 picture with more on top of it, rather than a different field that
 * happens to be ashier.
 *
 * Monotonic, because ash that came and went would read as a rendering fault
 * rather than as rot. Blobs are sorted by the wave they appear on and the field
 * only ever gains vertices.
 *
 * Lives here rather than in either renderer because `Renderer.bakeWangGround`
 * and `tools/draw-world.ts` bake the same ground twice — that duplication is
 * already noted in draw-world as something that has to stay in step, and a
 * second copy of this would be a third thing to keep in step.
 */
import { Rng } from '../core/rng'

/** How the blight spreads. Content, like every other tunable. */
export interface BlightConfig {
  /** The Wang set painted over the pasture. Its LOWER terrain must be the same
   *  grass the ground set's upper is, or the two will not meet. */
  set: string
  /** First wave with any ash at all. Before this the farm is merely a farm. */
  startWave: number
  /** The wave the spread is complete on. Past it nothing further happens. */
  fullWave: number
  /** Blobs at full spread. Each is a disc of vertices. */
  blobs: number
  /** Radius in VERTICES of the largest blob. */
  maxRadius: number
  /** Shapes the curve between the two waves. 1 is linear; above 1 holds the
   *  early game clean and spends the effect late. Tuned against measured
   *  coverage, not by eye — see the table in NOTES. */
  curve: number
}

export const DEFAULT_BLIGHT: BlightConfig = {
  set: 'grass_to_blight',
  startWave: 2,
  fullWave: 25,
  blobs: 120,
  maxRadius: 9,
  curve: 1.5,
}

/**
 * How far along the spread is at `wave`, 0 to 1.
 *
 * Bent rather than linear on purpose. Linear puts a visible smear of ash on the
 * field almost immediately, which spends the whole effect in the first two
 * minutes and leaves nothing for wave 20 to do. Holding the early game clean is
 * what makes the late game look like it went wrong, and it is the same "the
 * horror works because it is a departure" argument that decided the palette.
 *
 * `curve` was picked against MEASURED coverage rather than by eye, because the
 * first guess (squared, over a 3-22 span) put the field at 0% until wave 7 and
 * 4% at wave 10 — an effect nobody would ever see. The coverage table it was
 * tuned to is in NOTES.
 */
export function blightProgress(wave: number, cfg: BlightConfig): number {
  const span = cfg.fullWave - cfg.startWave
  if (span <= 0) return wave >= cfg.fullWave ? 1 : 0
  const t = (wave - cfg.startWave) / span
  return t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(t, cfg.curve)
}

/**
 * The vertex field the ash is painted from: 1 where the set's UPPER terrain
 * (ash) sits, 0 where its lower (grass) does.
 *
 * Vertices, not cells — `(cols+1) * (rows+1)` of them — because the Wang bake
 * samples corners. That is what lets a blight edge run through a tile rather
 * than around it, and it is the whole reason the ground stopped looking blocky.
 *
 * Returns null before `startWave`, so the caller can skip the pass entirely
 * rather than paint an empty one.
 */
export function blightField(
  seed: number, cols: number, rows: number, wave: number, cfg: BlightConfig,
): Uint8Array | null {
  const t = blightProgress(wave, cfg)
  if (t <= 0) return null

  const vw = cols + 1
  const vh = rows + 1
  const field = new Uint8Array(vw * vh)

  // Its OWN stream, and every blob drawn every time regardless of the wave.
  // Deriving these from the ground bake's rng would make the worn dirt patches
  // depend on which wave the terrain was last baked on, and the dirt is part of
  // what a seed promises to replay.
  const rng = new Rng(seed ^ 0x51a3b7)

  // The full set is generated up front and then cut, so wave N's field is
  // always wave N-1's plus more. Drawing only `live` blobs would advance the
  // stream by a different amount each bake and reshuffle everything after it.
  const live = Math.round(cfg.blobs * t)

  const disc = (cx: number, cy: number, r: number): void => {
    const rr = r * r
    for (let y = -r; y <= r; y++) {
      const vy = cy + y
      if (vy < 0 || vy >= vh) continue
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > rr) continue
        const vx = cx + x
        if (vx < 0 || vx >= vw) continue
        field[vy * vw + vx] = 1
      }
    }
  }

  for (let i = 0; i < cfg.blobs; i++) {
    const cx = rng.int(0, cols)
    const cy = rng.int(0, rows)
    const r = rng.int(2, cfg.maxRadius)
    // Three lobes per blob, always drawn from the stream so the sequence does
    // not depend on the wave. A blob is a UNION of offset discs rather than one
    // disc, because a single one is a perfect circle and a perfect circle on
    // the ground reads as a stain someone painted, not as rot spreading. Three
    // is enough to break the arc and cheap enough to do 120 times.
    // Offsets are HALF the radius and do NOT scale with `t`. Both matter: half
    // keeps every lobe overlapping the core, so a young blob is one shape
    // rather than three specks; fixed is what makes the growth monotonic. The
    // first version drifted the lobes outward as they grew, which uncovered
    // vertices behind them — four of them at wave 9, found by the test and by
    // nothing else, because four vertices flickering back to grass between two
    // bakes is invisible in a screenshot.
    const lobes = [0, 1, 2].map(() => ({
      dx: Math.round(rng.int(-r, r) / 2),
      dy: Math.round(rng.int(-r, r) / 2),
      scale: rng.range(0.5, 0.85),
    }))
    // Drawn from the stream whether used or not; see above.
    if (i >= live) continue
    // Late blobs arrive small, so the spread reads as creeping outward rather
    // than as new patches appearing at full size.
    const grown = Math.max(2, Math.round(r * (0.45 + 0.55 * t)))
    disc(cx, cy, grown)
    for (const l of lobes) {
      disc(cx + l.dx, cy + l.dy, Math.max(1, Math.round(grown * l.scale)))
    }
  }
  return field
}
