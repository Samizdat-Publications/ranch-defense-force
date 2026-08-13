/**
 * Pause screen (§12).
 *
 * Deliberately the plainest screen in the game. The level-up and shop screens
 * are decisions and earn their weight; pause is a door you opened by accident
 * half the time, so it shows the run at a glance and gets out of the way.
 *
 * It reads the same `.panel` and `.btn` vocabulary as every other surface, so
 * adding it cost no new visual language — that is the point of having one.
 *
 * Freezes the sim by setting `world.paused`, the same lever the level-up and
 * shop screens pull, so the renderer keeps drawing the frozen field behind it.
 */
import type { Audio } from '../core/audio'
import type { World } from '../sim/world'
import { clear, el } from './dom'

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

    const stat = (label: string, value: string): HTMLElement[] => [
      el('span', { text: label }),
      el('b', { text: value }),
    ]

    const mins = Math.floor(world.elapsed / 60)
    const secs = Math.floor(world.elapsed % 60)

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

    const slider = (label: string, value: number, onInput: (v: number) => void): HTMLElement => {
      const input = el('input', { class: 'pause-slider' }) as HTMLInputElement
      input.type = 'range'
      input.min = '0'
      input.max = '100'
      input.value = String(Math.round(value * 100))
      input.addEventListener('input', () => onInput(Number(input.value) / 100))
      return el('label', { class: 'pause-row' }, [el('span', { text: label }), input])
    }

    this.root.appendChild(
      el('div', { class: 'panel pause-card' }, [
        el('h2', { class: 'pause-title', text: 'Paused' }),
        el('p', { class: 'pause-sub', text: 'Esc or P to get back to work' }),
        el('div', { class: 'pause-stats' }, [
          ...stat('Wave', String(world.spawner.wave)),
          ...stat('Level', String(world.player.level)),
          ...stat('Kills', String(world.kills)),
          ...stat('Harvested', String(world.cropsHarvested)),
          ...stat('Feed', String(world.player.feed)),
          ...stat('Time', `${mins}:${String(secs).padStart(2, '0')}`),
        ]),
        el('div', { class: 'pause-audio' }, [
          slider('Effects', audio.sfxVolume, (v) => audio.setVolumes(v, audio.musicVolume)),
          slider('Music', audio.musicVolume, (v) => audio.setVolumes(audio.sfxVolume, v)),
        ]),
        el('div', { class: 'pause-actions' }, [mute, resume, quit]),
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
