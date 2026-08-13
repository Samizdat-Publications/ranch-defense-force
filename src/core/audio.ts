/**
 * Audio (§6): sixteen synthesised effects and three cross-fading music layers.
 *
 * Effects are SYNTHESISED, not sampled. Gemini has Lyria for music and TTS for
 * speech and no sound-effects model, so there was nothing to fetch — and
 * synthesis is the better answer here anyway. It matches the rest of this
 * project (a hand-written PNG codec rather than `sharp`), it adds no dependency
 * and no download, every sound is a handful of numbers in `audio.json`, and
 * retro synthesis is stylistically right for pixel art in a way a recorded
 * sample is not.
 *
 * Music is real audio from Lyria, fetched offline by `npm run music`. If those
 * files are absent — as they are until someone runs it with a key — the game is
 * simply quiet. Missing music must never be an error in a game loop.
 *
 * The context is created lazily on the first user gesture, because every
 * browser refuses to start one before that and doing it eagerly just logs a
 * warning on load.
 */
import { AUDIO } from '../content'

type SfxSpec = {
  wave: string
  freq: number
  freqTo?: number
  decay: number
  gain: number
  limitPerSecond?: number
}

export type SfxName = keyof typeof AUDIO.sfx & string
export type MusicLayer = keyof typeof AUDIO.music.layers & string

const STORAGE_KEY = 'rdf.audio'

export class Audio {
  private ctx: AudioContext | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  /** One shared noise buffer; generating it per shot would be the whole cost. */
  private noise: AudioBuffer | null = null

  private readonly lastPlayed = new Map<string, number>()
  private readonly musicNodes = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>()
  private readonly musicBuffers = new Map<string, AudioBuffer | null>()
  private currentLayer: string | null = null

  sfxVolume = AUDIO.master.sfxVolume
  musicVolume = AUDIO.master.musicVolume
  muted = false

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{ sfx: number; music: number; muted: boolean }>
        if (typeof saved.sfx === 'number') this.sfxVolume = saved.sfx
        if (typeof saved.music === 'number') this.musicVolume = saved.music
        if (typeof saved.muted === 'boolean') this.muted = saved.muted
      }
    } catch {
      // A blocked or full localStorage is not a reason to be silent.
    }
  }

  /** Call from any user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()

    this.sfxBus = this.ctx.createGain()
    this.musicBus = this.ctx.createGain()
    this.sfxBus.connect(this.ctx.destination)
    this.musicBus.connect(this.ctx.destination)
    this.applyVolumes()

    // 2s of white noise, reused by every noise-based effect.
    const rate = this.ctx.sampleRate
    this.noise = this.ctx.createBuffer(1, rate * 2, rate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }

  private applyVolumes(): void {
    if (this.sfxBus) this.sfxBus.gain.value = this.muted ? 0 : this.sfxVolume
    if (this.musicBus) this.musicBus.gain.value = this.muted ? 0 : this.musicVolume
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyVolumes()
    this.save()
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, sfx))
    this.musicVolume = Math.max(0, Math.min(1, music))
    this.applyVolumes()
    this.save()
  }

  private save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sfx: this.sfxVolume, music: this.musicVolume, muted: this.muted }),
      )
    } catch {
      // Not worth failing a run over.
    }
  }

  /**
   * Play an effect.
   *
   * Rate-limited per name. Two hundred enemies dying in the same frame is a
   * normal Tuesday in this game, and without a limit that is two hundred
   * oscillators summing into clipping rather than a sound.
   */
  play(name: SfxName): void {
    const ctx = this.ctx
    const bus = this.sfxBus
    if (!ctx || !bus || this.muted) return

    const spec = (AUDIO.sfx as Record<string, SfxSpec>)[name]
    if (!spec) return

    const now = ctx.currentTime
    const limit = spec.limitPerSecond ?? 10
    const last = this.lastPlayed.get(name) ?? -Infinity
    if (now - last < 1 / limit) return
    this.lastPlayed.set(name, now)

    const gain = ctx.createGain()
    gain.connect(bus)
    // Exponential decay: a linear ramp to zero reads as a click, not a hit.
    gain.gain.setValueAtTime(spec.gain, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.decay)

    if (spec.wave === 'noise') {
      if (!this.noise) return
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      // Start at a random offset so repeated shots are not identical.
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(spec.freq, now)
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, spec.freqTo ?? spec.freq),
        now + spec.decay,
      )
      src.connect(filter)
      filter.connect(gain)
      src.start(now, Math.random() * 1.5)
      src.stop(now + spec.decay)
    } else {
      const osc = ctx.createOscillator()
      osc.type = spec.wave as OscillatorType
      osc.frequency.setValueAtTime(spec.freq, now)
      if (spec.freqTo && spec.freqTo !== spec.freq) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, spec.freqTo),
          now + spec.decay,
        )
      }
      osc.connect(gain)
      osc.start(now)
      osc.stop(now + spec.decay)
    }
  }

  /**
   * Cross-fade to a music layer. A no-op if it is already playing, or if the
   * file was never generated.
   */
  async setLayer(layer: MusicLayer | null): Promise<void> {
    if (!this.ctx || !this.musicBus) return
    if (this.currentLayer === layer) return
    const fade = AUDIO.music.crossfadeSeconds

    const previous = this.currentLayer
    this.currentLayer = layer

    if (previous) {
      const node = this.musicNodes.get(previous)
      if (node) {
        const t = this.ctx.currentTime
        node.gain.gain.setValueAtTime(node.gain.gain.value, t)
        node.gain.gain.linearRampToValueAtTime(0, t + fade)
        node.src.stop(t + fade + 0.1)
        this.musicNodes.delete(previous)
      }
    }
    if (!layer) return

    const buffer = await this.loadLayer(layer)
    // The fade may have been superseded while the file was loading.
    if (!buffer || this.currentLayer !== layer || !this.ctx || !this.musicBus) return

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const gain = this.ctx.createGain()
    const t = this.ctx.currentTime
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(1, t + fade)
    src.connect(gain)
    gain.connect(this.musicBus)
    src.start(t)
    this.musicNodes.set(layer, { src, gain })
  }

  private async loadLayer(layer: string): Promise<AudioBuffer | null> {
    if (this.musicBuffers.has(layer)) return this.musicBuffers.get(layer) ?? null
    const def = (AUDIO.music.layers as Record<string, { file: string }>)[layer]
    if (!def || !this.ctx) return null
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}audio/${def.file}`)
      if (!res.ok) throw new Error(String(res.status))
      const bytes = await res.arrayBuffer()
      const buffer = await this.ctx.decodeAudioData(bytes)
      this.musicBuffers.set(layer, buffer)
      return buffer
    } catch {
      // Not generated yet. Remember that so we do not retry every wave.
      this.musicBuffers.set(layer, null)
      return null
    }
  }
}
