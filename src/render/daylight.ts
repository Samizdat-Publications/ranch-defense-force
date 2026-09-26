/**
 * The Long Day: the run's progress as a time of day, and what the light is
 * doing at that time.
 *
 * Wave 1 opens at first light and the last wave ends in full dark. Everything
 * here is read from `tuning.json` -> `daylight.stops`, a list of keyframes
 * over run progress (0 = the first second of wave 1, 1 = the end of the last
 * wave), so moving dusk is a content edit. Purely visual: the sim never reads
 * it, and a replayed seed is unaffected by any of these numbers.
 */
import { TUNING, WAVES } from '../content'
import type { World } from '../sim/world'

interface Stop {
  t: number
  ambient: number[]
  sun: number[]
  sunI: number
  az: number
  el: number
  shadow: number
  exposure: number
  saturation: number
  contrast: number
  tint: number[]
  vignette: number
  lantern: number
  night: number
  fog: number
}

const CFG = (TUNING as unknown as { daylight: {
  stops: Stop[]; clockStart: number; clockEnd: number; maxShadowLength: number
  shadowSkew: number; shadowRise: number; shadowRisePerLength: number; shadowRiseMax: number
} }).daylight
const STOPS = CFG.stops.slice().sort((a, b) => a.t - b.t)

/** The evaluated light for one moment. Preallocated and rewritten in place. */
export interface DayState {
  /** Run progress, 0..1. */
  t: number
  /** Clock hour, for the HUD. */
  hour: number
  ambient: [number, number, number]
  /** Sun (or moon) colour times intensity, added where there is no shadow. */
  sun: [number, number, number]
  /** Ground offset of a shadow per pixel of height. */
  shadowX: number
  shadowY: number
  shadowAlpha: number
  exposure: number
  saturation: number
  contrast: number
  tint: [number, number, number]
  vignette: number
  /** 0 by day, 1 at full dark: how much the player's lantern matters. */
  lantern: number
  /** 0 by day, 1 at night: eyes and projectiles glow, outlines turn to moonlight. */
  night: number
  fog: number
}

export function newDayState(): DayState {
  return {
    t: 0, hour: 6, ambient: [1, 1, 1], sun: [0, 0, 0], shadowX: 0, shadowY: 0, shadowAlpha: 0,
    exposure: 1, saturation: 1, contrast: 1, tint: [1, 1, 1], vignette: 0, lantern: 0, night: 0, fog: 0,
  }
}

let override: number | null = null
if (typeof location !== 'undefined') {
  const q = new URLSearchParams(location.search).get('tod')
  if (q !== null && q !== '') override = Math.min(1, Math.max(0, Number(q)))
}

/** Pin the time of day (0..1) for screenshots and the dev overlay; null follows the run. */
export function setDayOverride(t: number | null): void {
  override = t
}

/**
 * Lightning after dark, as a pure function of time so the sound and the
 * picture agree without talking to each other. Returns the flash strength
 * 0..1 (two strokes a few tenths apart) and is 0 by day. Strikes come every
 * 17 to 29 seconds, chosen by a hash of the strike's index.
 */
export function lightning(elapsed: number, dayT: number): number {
  const storm = Math.min(1, Math.max(0, (dayT - 0.84) / 0.04))
  if (storm <= 0) return 0
  const period = 23
  const k = Math.floor(elapsed / period)
  const h = Math.sin(k * 12.9898) * 43758.5453
  const offset = (h - Math.floor(h)) * 12
  const since = elapsed - k * period - offset
  if (since < 0 || since > 0.9) return 0
  const a = Math.max(0, 1 - since / 0.2)
  const b = Math.max(0, 1 - Math.abs(since - 0.38) / 0.1) * 0.6
  return Math.min(1, a + b) * storm
}

/** How hard it is raining, 0..1: a storm comes in with the dark. */
export function rainAt(dayT: number): number {
  return Math.min(1, Math.max(0, (dayT - 0.85) / 0.05))
}

/** How far through the run this world is, 0..1. */
export function dayProgress(world: World): number {
  if (override !== null) return override
  const dur = WAVES.waveDuration as number
  const count = WAVES.waveCount as number
  const wave = world.spawner.wave
  const inWave = Math.min(1, Math.max(0, world.spawner.waveTime / dur))
  return Math.min(1, Math.max(0, (wave - 1 + inWave) / count))
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

/** Evaluate the curve at `t` into `out`. Allocation-free. */
export function evaluateDay(t: number, out: DayState): DayState {
  let i = 0
  while (i < STOPS.length - 2 && STOPS[i + 1].t <= t) i++
  const a = STOPS[i]
  const b = STOPS[Math.min(i + 1, STOPS.length - 1)]
  const span = b.t - a.t
  const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0
  const e = k * k * (3 - 2 * k)

  out.t = t
  out.hour = lerp(CFG.clockStart, CFG.clockEnd, t)
  for (let c = 0; c < 3; c++) {
    out.ambient[c] = lerp(a.ambient[c], b.ambient[c], e)
    out.sun[c] = lerp(a.sun[c] * a.sunI, b.sun[c] * b.sunI, e)
    out.tint[c] = lerp(a.tint[c], b.tint[c], e)
  }
  const az = (lerp(a.az, b.az, e) * Math.PI) / 180
  const el = Math.max(1, lerp(a.el, b.el, e))
  const len = Math.min(CFG.maxShadowLength, 1 / Math.tan((el * Math.PI) / 180))
  // A flattened silhouette lying BEHIND the thing on the ground (up the
  // screen, which is where the ground behind something is in this view),
  // sheared east or west away from the sun and longer as the sun drops. A
  // physically projected shadow is a thin line whenever the sun is due east
  // or west, which reads as a scratch on the grass rather than a shadow.
  out.shadowX = -Math.sin(az) * len * CFG.shadowSkew
  out.shadowY = -Math.min(CFG.shadowRiseMax, CFG.shadowRise + CFG.shadowRisePerLength * len)
  out.shadowAlpha = lerp(a.shadow, b.shadow, e)
  out.exposure = lerp(a.exposure, b.exposure, e)
  out.saturation = lerp(a.saturation, b.saturation, e)
  out.contrast = lerp(a.contrast, b.contrast, e)
  out.vignette = lerp(a.vignette, b.vignette, e)
  out.lantern = lerp(a.lantern, b.lantern, e)
  out.night = lerp(a.night, b.night, e)
  out.fog = lerp(a.fog, b.fog, e)
  return out
}
