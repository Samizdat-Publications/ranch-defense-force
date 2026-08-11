/**
 * Dev overlay, shipped from M0 on purpose (§13). Without a wave-skip key and a
 * seed box, balancing twenty-four waves means *playing* twenty-four waves,
 * every time.
 *
 * Frame time graph, pool counts with peaks and starvation, draw calls, and the
 * skip/spawn controls. Toggle with F1 (backtick also works).
 */
import type { Loop } from '../core/loop'
import type { Renderer } from '../render/renderer'
import type { World } from '../sim/world'
import { ENEMY_IDS } from '../content'
import { el } from './dom'

const GRAPH_W = 140
const GRAPH_H = 34
/** 16.6ms — the frame ceiling. The graph draws a line at it. */
const BUDGET_MS = 1000 / 60

export class DevOverlay {
  private readonly root: HTMLElement
  private readonly panel: HTMLElement
  private readonly text: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly history = new Float32Array(GRAPH_W)
  private historyIndex = 0
  private visible = true
  private frame = 0

  constructor(
    parent: HTMLElement,
    private readonly hooks: {
      skipWave: () => void
      spawn: (typeId: string, count: number) => void
      restartWithSeed: (seed: string) => void
      killAll: () => void
    },
  ) {
    this.text = el('div')
    this.canvas = el('canvas') as HTMLCanvasElement
    this.canvas.width = GRAPH_W
    this.canvas.height = GRAPH_H
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('dev graph context unavailable')
    this.ctx = ctx

    const seedInput = el('input') as HTMLInputElement
    seedInput.placeholder = 'seed'
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.hooks.restartWithSeed(seedInput.value.trim())
      e.stopPropagation()
    })

    const spawnSelect = el('select') as HTMLSelectElement
    spawnSelect.style.fontFamily = 'inherit'
    spawnSelect.style.fontSize = '10px'
    for (const id of ENEMY_IDS) {
      const opt = el('option', { text: id }) as HTMLOptionElement
      opt.value = id
      spawnSelect.appendChild(opt)
    }

    this.panel = el('div', { class: 'dev-panel' }, [
      this.text,
      this.canvas,
      el('div', { style: { marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' } }, [
        el('button', { text: 'skip wave [N]', onClick: () => this.hooks.skipWave() }),
        el('button', { text: 'kill all', onClick: () => this.hooks.killAll() }),
        el('button', { text: '+20', onClick: () => this.hooks.spawn(spawnSelect.value, 20) }),
        el('button', { text: '+200', onClick: () => this.hooks.spawn(spawnSelect.value, 200) }),
        spawnSelect,
      ]),
      el('div', { style: { marginTop: '4px' } }, [seedInput]),
    ])

    this.root = el('div', {}, [this.panel])
    const host = document.getElementById('dev') ?? parent
    host.appendChild(this.root)

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'F1' || e.key === '`') {
        this.visible = !this.visible
        this.root.style.display = this.visible ? '' : 'none'
        e.preventDefault()
      }
      if (e.key === 'n' || e.key === 'N') this.hooks.skipWave()
    })
  }

  update(loop: Loop, world: World, renderer: Renderer): void {
    this.history[this.historyIndex] = loop.stats.frameMs
    this.historyIndex = (this.historyIndex + 1) % GRAPH_W

    // The text is comparatively expensive to rebuild; 6Hz is plenty to read.
    if (++this.frame % 10 === 0) {
      const s = loop.stats
      const lines = [
        `${s.fps.toFixed(0)} fps   frame ${s.frameMs.toFixed(2)}ms`,
        `  sim ${s.simMs.toFixed(2)}  draw ${s.renderMs.toFixed(2)}`,
        s.dropped > 0 ? `  DROPPED ${s.dropped} steps` : '',
        `draw calls ${renderer.drawCalls}`,
        '',
        `wave ${world.spawner.wave}  t${world.spawner.waveRemaining.toFixed(1)}s`,
        `budget ${world.spawner.budget.toFixed(0)}  seed ${world.seed}`,
        `elapsed ${world.elapsed.toFixed(1)}s  tick ${world.tick}`,
        '',
        poolLine('enemies', world.enemies),
        poolLine('projectiles', world.projectiles),
        poolLine('pickups', world.pickups),
        poolLine('particles', world.particles),
        poolLine('hazards', world.hazards),
        poolLine('dmgNums', world.damageNumbers),
        '',
        `hp ${world.player.hp.toFixed(0)}/${world.player.stats.maxHp.toFixed(0)}  lv ${world.player.level}`,
        `feed ${world.player.feed}  kills ${world.kills}`,
      ]
      this.text.replaceChildren(
        ...lines.map((l) =>
          el('div', {
            text: l,
            class: l.includes('DROPPED') || l.includes('STARVED') ? 'dev-warn' : '',
          }),
        ),
      )
    }

    this.drawGraph()
  }

  private drawGraph(): void {
    const c = this.ctx
    c.clearRect(0, 0, GRAPH_W, GRAPH_H)
    c.fillStyle = 'rgba(0,0,0,0.4)'
    c.fillRect(0, 0, GRAPH_W, GRAPH_H)

    // The 16.6ms budget line — anything above it missed the frame.
    const budgetY = GRAPH_H - (BUDGET_MS / 33) * GRAPH_H
    c.strokeStyle = 'rgba(255, 180, 84, 0.6)'
    c.beginPath()
    c.moveTo(0, budgetY)
    c.lineTo(GRAPH_W, budgetY)
    c.stroke()

    c.strokeStyle = '#9fe6c0'
    c.beginPath()
    for (let i = 0; i < GRAPH_W; i++) {
      const idx = (this.historyIndex + i) % GRAPH_W
      const ms = Math.min(33, this.history[idx])
      const y = GRAPH_H - (ms / 33) * GRAPH_H
      if (i === 0) c.moveTo(i, y)
      else c.lineTo(i, y)
    }
    c.stroke()
  }
}

function poolLine(name: string, pool: { live: number; capacity: number; peak: number; starved: number }): string {
  const starved = pool.starved > 0 ? `  STARVED ${pool.starved}` : ''
  return `${name.padEnd(12)}${String(pool.live).padStart(4)}/${pool.capacity}  peak ${pool.peak}${starved}`
}
