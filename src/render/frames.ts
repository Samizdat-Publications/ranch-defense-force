/**
 * Frame lookups without strings.
 *
 * The renderer used to find every animated frame by building its key each
 * frame (`${sheet}.walk.${dir}.${f}`), which is a string allocation per entity
 * per frame and a hash lookup on top: at 400 enemies that is garbage the
 * collector has to sweep in the middle of a fight. This caches, per sheet,
 * each clip as a flat array indexed `dir * length + frame`, built once on
 * first use; each named strip (`fx.*`, `prop.*`, projectile clips) as an
 * array indexed by frame; and every two-part name the renderer used to
 * concatenate, in nested maps keyed by the parts, so a hit allocates nothing.
 */
import type { Atlas, AtlasFrame } from '../core/atlas'
import { directionIndex } from '../core/facing'

export interface Clip {
  len: number
  frames: (AtlasFrame | undefined)[]
}

interface SheetFrames {
  dirs: string[]
  clips: Map<string, Clip>
}

const EMPTY: Clip = { len: 0, frames: [] }

/** A two-level cache: first part, then second part, then the built value. */
class Pairs<V> {
  private readonly outer = new Map<string, Map<string | number, V>>()
  constructor(private readonly build: (a: string, b: string | number) => V) {}
  get(a: string, b: string | number): V {
    let inner = this.outer.get(a)
    if (!inner) {
      inner = new Map()
      this.outer.set(a, inner)
    }
    let v = inner.get(b)
    if (v === undefined) {
      v = this.build(a, b)
      inner.set(b, v)
    }
    return v
  }
}

export class FrameCache {
  private readonly sheets = new Map<string, SheetFrames>()
  private readonly strips = new Map<string, (AtlasFrame | undefined)[]>()
  private readonly singles = new Map<string, AtlasFrame | null>()
  private readonly blight = new Map<string, string>()
  private readonly fxStrips = new Map<string, (AtlasFrame | undefined)[]>()

  /** `${base}.${element}` rounds: the tinted strip, or the base strip when none is packed. */
  readonly tinted: Pairs<(AtlasFrame | undefined)[]>
  /** `weapon.${id}.t${tier}` */
  readonly weaponTier: Pairs<AtlasFrame | null>
  /** `tool.${tool}.${tier}` */
  readonly tool: Pairs<AtlasFrame | null>
  /** `pickup.${kind}` as a name, for the strip lookup. */
  readonly named: Pairs<string>

  constructor(private readonly atlas: Atlas) {
    this.tinted = new Pairs((base, element) => {
      const t = this.strip(`${base}.${element}`)
      return t.length ? t : this.strip(base)
    })
    this.weaponTier = new Pairs((id, tier) => atlas.get(`weapon.${id}.t${tier}`) ?? null)
    this.tool = new Pairs((tool, tier) => atlas.get(`tool.${tool}.${tier}`) ?? null)
    this.named = new Pairs((prefix, name) => `${prefix}.${name}`)
  }

  private sheet(name: string): SheetFrames {
    let s = this.sheets.get(name)
    if (!s) {
      s = { dirs: this.atlas.directionsFor(name), clips: new Map() }
      this.sheets.set(name, s)
    }
    return s
  }

  /** A clip of a directional sheet; `len` 0 when the sheet has no such clip. */
  clip(sheet: string, clip: string): Clip {
    const s = this.sheet(sheet)
    let c = s.clips.get(clip)
    if (!c) {
      const atlas = this.atlas
      const known = atlas.clipLengths[sheet]?.[clip]
      const len = known ?? (clip === 'idle' ? 1 : atlas.clipLength(sheet, clip))
      const frames: (AtlasFrame | undefined)[] = []
      for (const dir of s.dirs) {
        for (let f = 0; f < len; f++) frames.push(atlas.get(`${sheet}.${clip}.${dir}.${f}`))
      }
      c = frames.some((f) => !!f) ? { len, frames } : EMPTY
      s.clips.set(clip, c)
    }
    return c
  }

  /** Frame `f` (clamped) of a clip, facing `facing`, or undefined. */
  frame(sheet: string, clip: string, facing: number, f: number): AtlasFrame | undefined {
    const c = this.clip(sheet, clip)
    if (c.len === 0) return undefined
    const d = directionIndex(facing, this.sheet(sheet).dirs.length)
    return c.frames[d * c.len + Math.min(c.len - 1, Math.max(0, f))]
  }

  /** A numbered strip `name.0 .. name.n-1`; empty when it is not packed. */
  strip(name: string): (AtlasFrame | undefined)[] {
    let s = this.strips.get(name)
    if (!s) {
      s = []
      if (this.atlas.has(`${name}.0`)) {
        const len = this.atlas.clipLength(name, 'play')
        for (let f = 0; f < len; f++) s.push(this.atlas.get(`${name}.${f}`))
      }
      this.strips.set(name, s)
    }
    return s
  }

  /** An effect clip, falling back from `fx.a.b` to `fx.a` when the variant is not packed. */
  fx(clip: string): (AtlasFrame | undefined)[] {
    let s = this.fxStrips.get(clip)
    if (!s) {
      let name = `fx.${clip}`
      if (!this.atlas.has(`${name}.0`)) {
        const dot = name.lastIndexOf('.')
        if (dot > 0) name = name.slice(0, dot)
      }
      s = this.strip(name)
      this.fxStrips.set(clip, s)
    }
    return s
  }

  /** A plain named frame, cached; null when absent. */
  single(name: string): AtlasFrame | null {
    let f = this.singles.get(name)
    if (f === undefined) {
      f = this.atlas.get(name) ?? null
      this.singles.set(name, f)
    }
    return f
  }

  /** The `Blight` variant of a sprite name if one is packed, else the name itself. */
  blighted(name: string): string {
    let b = this.blight.get(name)
    if (b === undefined) {
      const k = `${name}Blight`
      b = this.atlas.has(k) ? k : name
      this.blight.set(name, b)
    }
    return b
  }
}
