/**
 * The sound of the time of day, synthesised: nothing to download.
 *
 *  - wind: looped noise through a slowly wandering low-pass, always there,
 *    rising a little toward evening;
 *  - birds: short rising chirps in runs of two to four, thick at first light,
 *    gone by early afternoon;
 *  - crickets: three-pulse trills at about 4.5 kHz, starting at golden hour
 *    and filling the dark;
 *  - an owl, rarely, after full dark.
 *
 * Driven by run progress (render/daylight.ts), so the title screen at sundown
 * and wave 22 sound like the times they show. Its own seeded RNG stream: it
 * never touches the sim's.
 */
import { Rng } from './rng'

export class Ambience {
  private wind: AudioBufferSourceNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private windGain: GainNode | null = null
  private out: GainNode | null = null
  private readonly rng = new Rng(0xa3b1e7)
  private nextBird = 0
  private nextCricket = 0
  private nextOwl = 0
  private started = false

  constructor(
    private readonly getCtx: () => AudioContext | null,
    private readonly getDest: () => AudioNode | null,
    private readonly getNoise: () => AudioBuffer | null,
  ) {}

  private start(ctx: AudioContext): boolean {
    const dest = this.getDest()
    const noise = this.getNoise()
    if (!dest || !noise) return false
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.out.connect(dest)
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'lowpass'
    this.windFilter.frequency.value = 500
    this.windFilter.Q.value = 0.7
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0.05
    this.wind = ctx.createBufferSource()
    this.wind.buffer = noise
    this.wind.loop = true
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.out)
    this.wind.start()
    const t = ctx.currentTime
    this.nextBird = t + 1
    this.nextCricket = t + 0.5
    this.nextOwl = t + 12
    this.started = true
    return true
  }

  /** Call every frame with run progress 0..1 and whether sound should play at all. */
  update(dayT: number, active: boolean): void {
    const ctx = this.getCtx()
    if (!ctx || ctx.state !== 'running') return
    if (!this.started && !this.start(ctx)) return
    const now = ctx.currentTime
    const out = this.out
    if (!out || !this.windFilter || !this.windGain) return
    out.gain.setTargetAtTime(active ? 1 : 0, now, 0.6)
    if (!active) return

    // Wind: the filter wanders, and evening is breezier.
    const gust = 0.5 + 0.5 * Math.sin(now * 0.23) * Math.sin(now * 0.071 + 1.3)
    this.windFilter.frequency.setTargetAtTime(320 + gust * 520, now, 0.8)
    this.windGain.gain.setTargetAtTime(0.03 + 0.03 * gust + 0.03 * smooth(0.55, 0.85, dayT), now, 0.8)

    const birds = 1 - smooth(0.2, 0.42, dayT)
    const crickets = smooth(0.7, 0.86, dayT)
    const owls = smooth(0.9, 0.96, dayT)

    // Schedule a little ahead so a dropped frame never leaves a gap.
    const horizon = now + 0.25
    while (birds > 0.02 && this.nextBird < horizon) {
      this.birdRun(ctx, out, this.nextBird, birds)
      this.nextBird += this.rng.range(1.2, 4.5) / Math.max(0.3, birds)
    }
    if (birds <= 0.02) this.nextBird = Math.max(this.nextBird, now)
    while (crickets > 0.02 && this.nextCricket < horizon) {
      this.cricket(ctx, out, this.nextCricket, crickets)
      this.nextCricket += this.rng.range(0.08, 0.4) / Math.max(0.35, crickets)
    }
    if (crickets <= 0.02) this.nextCricket = Math.max(this.nextCricket, now)
    if (owls > 0.5 && this.nextOwl < horizon) {
      this.owl(ctx, out, this.nextOwl)
      this.nextOwl += this.rng.range(14, 30)
    }
    if (owls <= 0.5) this.nextOwl = Math.max(this.nextOwl, now + 8)
  }

  /**
   * Thunder, `delay` seconds from now: the noise loop through a low-pass that
   * closes as it decays, so it cracks and then rolls.
   */
  thunder(delay: number): void {
    const ctx = this.getCtx()
    const noise = this.getNoise()
    const out = this.out
    if (!ctx || !noise || !out || ctx.state !== 'running') return
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.exponentialRampToValueAtTime(90, t + 2.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.32, t + 0.06)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.5)
    g.gain.linearRampToValueAtTime(0.16, t + 0.9)
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.2)
    src.connect(lp).connect(g).connect(out)
    src.start(t, this.rng.range(0, 1.5))
    src.stop(t + 3.3)
  }

  private voice(ctx: AudioContext, out: AudioNode, pan: number): { osc: OscillatorNode; env: GainNode } {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    env.gain.value = 0
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    osc.connect(env).connect(p).connect(out)
    return { osc, env }
  }

  private birdRun(ctx: AudioContext, out: AudioNode, at: number, level: number): void {
    const notes = this.rng.int(2, 4)
    const base = this.rng.range(2300, 3600)
    const pan = this.rng.range(-0.8, 0.8)
    for (let i = 0; i < notes; i++) {
      const t = at + i * this.rng.range(0.09, 0.16)
      const { osc, env } = this.voice(ctx, out, pan)
      osc.type = 'sine'
      const f0 = base * this.rng.range(0.9, 1.1)
      osc.frequency.setValueAtTime(f0, t)
      osc.frequency.exponentialRampToValueAtTime(f0 * this.rng.range(1.25, 1.6), t + 0.07)
      const g = 0.018 * level
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(g, t + 0.012)
      env.gain.exponentialRampToValueAtTime(0.0005, t + 0.085)
      osc.start(t)
      osc.stop(t + 0.1)
    }
  }

  private cricket(ctx: AudioContext, out: AudioNode, at: number, level: number): void {
    const { osc, env } = this.voice(ctx, out, this.rng.range(-0.9, 0.9))
    osc.type = 'sine'
    osc.frequency.value = this.rng.range(4300, 4800)
    const g = 0.007 * level * this.rng.range(0.5, 1)
    for (let k = 0; k < 3; k++) {
      const t = at + k * 0.022
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(g, t + 0.004)
      env.gain.linearRampToValueAtTime(0, t + 0.014)
    }
    osc.start(at)
    osc.stop(at + 0.08)
  }

  private owl(ctx: AudioContext, out: AudioNode, at: number): void {
    const pan = this.rng.range(-0.7, 0.7)
    for (let k = 0; k < 2; k++) {
      const t = at + k * 0.55
      const { osc, env } = this.voice(ctx, out, pan)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(420, t)
      osc.frequency.linearRampToValueAtTime(380, t + 0.35)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(0.02, t + 0.06)
      env.gain.linearRampToValueAtTime(0, t + 0.4)
      osc.start(t)
      osc.stop(t + 0.45)
    }
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
