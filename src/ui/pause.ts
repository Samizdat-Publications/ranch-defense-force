/**
 * Pause screen (§12).
 *
 * Deliberately the plainest screen in the game. The level-up and shop screens
 * are decisions and earn their weight; pause is a door you opened by accident
 * half the time, so it shows the run at a glance and gets out of the way.
 *
 * It reads the same `.panel` and `.btn` vocabulary as every other surface, so
 * adding it cost no new visual language - that is the point of having one.
 *
 * Freezes the sim by setting `world.paused`, the same lever the level-up and
 * shop screens pull, so the renderer keeps drawing the frozen field behind it.
 */
import type { Audio } from '../core/audio'
import type { World } from '../sim/world'
import { clear, el } from './dom'
import { buildLedger } from './ledger'

export class PauseScreen {
  private readonly root: HTMLElement
  private onResume: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'pause-wrap' })
    this.root.style.display = 'none'
    parent.appendChild(this.root)
  }

  get isOpen(): boolean {
    return this.root.style.display !== 'none'
  }

  open(world: World, audio: Audio, onResume: () => void, onQuit: () => void): void {
    this.onResume = onResume
    clear(this.root)

    const mins = Math.floor(world.elapsed / 60)
    const secs = Math.floor(world.elapsed % 60)

    // A tally sheet: label, dotted leader, value. Staggered so the rows land
    // one after another rather than all at once.
    const stat = (label: string, value: string, i: number): HTMLElement => {
      const row = el('div', { class: 'psheet-stat' }, [
        el('span', { class: 'psheet-stat-label', text: label }),
        el('span', { class: 'psheet-stat-lead' }),
        el('b', { class: 'psheet-stat-value', text: value }),
      ])
      row.style.animationDelay = `${i * 50}ms`
      return row
    }

    const resume = el('button', { class: 'btn btn-primary', text: 'Resume' })
    resume.addEventListener('click', () => this.close(onResume))
    const quit = el('button', { class: 'btn btn-danger', text: 'Give up the field' })
    quit.addEventListener('click', () => {
      this.root.style.display = 'none'
      onQuit()
    })

    // Audio lives here rather than in a settings screen of its own. Pause is
    // where you already are when you want the sound turned down, and one more
    // screen to build and dismiss would be worse than two rows of controls.
    const mute = el('button', {
      class: 'btn',
      text: audio.muted ? 'Sound: off' : 'Sound: on',
    })
    mute.addEventListener('click', () => {
      audio.setMuted(!audio.muted)
      mute.textContent = audio.muted ? 'Sound: off' : 'Sound: on'
    })

    /**
     * A gauge, not an `<input type=range>`.
     *
     * The design draws these as a filled bar with a square handle, and a range
     * input cannot be styled into that shape across browsers without fighting
     * every vendor pseudo-element. It is a div with a pointer handler, which is
     * less code than the styling would have been.
     */
    // Ten pips, like a volume meter on a radio, rather than a web form's
    // track and knob (critic round 19: "form-style sliders"). Click or drag;
    // the value steps by a tenth.
    const slider = (label: string, value: number, onInput: (v: number) => void): HTMLElement => {
      const readout = el('span', { text: String(Math.round(value * 10)) })
      const pips: HTMLElement[] = []
      for (let i = 0; i < 10; i++) pips.push(el('div', { class: 'psheet-pip' }))
      const show = (v: number): void => {
        const n = Math.round(v * 10)
        pips.forEach((p, i) => p.classList.toggle('is-on', i < n))
        readout.textContent = String(n)
      }
      show(value)

      const track = el('div', { class: 'psheet-meter' }, pips)
      const setFrom = (clientX: number): void => {
        const b = track.getBoundingClientRect()
        const v = Math.round(Math.min(1, Math.max(0, (clientX - b.left) / b.width)) * 10) / 10
        show(v)
        onInput(v)
      }
      track.addEventListener('pointerdown', (e: PointerEvent) => {
        track.setPointerCapture(e.pointerId)
        setFrom(e.clientX)
      })
      track.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.buttons & 1) setFrom(e.clientX)
      })

      return el('div', {}, [
        el('div', { class: 'psheet-slider-head' }, [
          el('span', { text: label }),
          readout,
        ]),
        track,
      ])
    }

    /*
     * The ledger (docs/UPGRADE_ROSTER.md batch 5, part 1): weapons with the
     * mods each slot has taken, class cards, and everything else with its
     * stack printed n/N - the same footer the card itself shows. One builder
     * in `ledger.ts` shared with the shop, so the two cannot say two
     * different things about the same run.
     */
    const ledger = buildLedger(world.player)
    const chips = el('div', { class: 'psheet-chips' })
    for (const w of ledger.weapons) {
      chips.append(el('span', {
        class: 'psheet-chip',
        text: w.mods.length > 0 ? `${w.name} T${w.tier}: ${w.mods.join(', ')}` : `${w.name} T${w.tier}`,
      }))
    }
    for (const name of ledger.classCards) {
      chips.append(el('span', { class: 'psheet-chip is-class', text: name }))
    }
    for (const it of ledger.items) {
      chips.append(el('span', {
        class: 'psheet-chip',
        text: it.stack ? `${it.name} ${it.stack}` : it.name,
      }))
    }
    if (!ledger.weapons.length && !ledger.classCards.length && !ledger.items.length) {
      chips.append(el('span', { class: 'psheet-chip', text: 'nothing yet' }))
    }

    this.root.appendChild(
      el('div', { class: 'psheet-scrim' }, [
        el('div', { class: 'psheet' }, [
          el('div', { class: 'psheet-body' }, [
            el('div', { class: 'psheet-head' }, [
              el('h2', { class: 'psheet-title', text: 'Paused' }),
              el('span', { class: 'psheet-hint', text: 'Esc or P to get back to work' }),
            ]),
            el('div', { class: 'psheet-rule' }),
            el('div', { class: 'psheet-stats' }, [
              stat('Wave', String(world.spawner.wave), 0),
              stat('Level', String(world.player.level), 1),
              stat('Kills', String(world.kills), 2),
              stat('Harvested', String(world.cropsHarvested), 3),
              stat('Feed', String(world.player.feed), 4),
              stat('Time', `${mins}:${String(secs).padStart(2, '0')}`, 5),
            ]),
            el('div', { class: 'psheet-rule', style: { marginTop: '22px' } }),
            el('div', { class: 'psheet-section', text: 'What you are carrying' }),
            chips,
            el('div', { class: 'psheet-sliders' }, [
              slider('Effects', audio.sfxVolume, (v) => audio.setVolumes(v, audio.musicVolume)),
              slider('Music', audio.musicVolume, (v) => audio.setVolumes(audio.sfxVolume, v)),
            ]),
          ]),
          el('div', { class: 'psheet-foot' }, [
            resume, mute,
            el('span', { class: 'spacer' }),
            quit,
          ]),
        ]),
      ]),
    )
    this.root.style.display = ''
  }

  /** Close and resume. Safe to call when already closed. */
  close(onResume?: () => void): void {
    if (!this.isOpen) return
    this.root.style.display = 'none'
    const cb = onResume ?? this.onResume
    this.onResume = null
    cb?.()
  }
}
