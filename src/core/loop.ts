/**
 * Fixed-timestep loop with an accumulator. The simulation always advances in
 * whole 1/60s steps; the renderer gets an alpha in [0,1) to interpolate with.
 * Simulation is never tied to frame time (CLAUDE.md, non-negotiable).
 */
export { STEP } from './step'
import { STEP } from './step'
/** Never simulate more than this many steps in one frame — after a tab switch
 *  or a long stall, drop the backlog rather than spiralling. */
const MAX_STEPS_PER_FRAME = 5

export interface LoopStats {
  /** ms spent in the last frame's sim + render. */
  frameMs: number
  simMs: number
  renderMs: number
  /** Sim steps run in the last frame. */
  steps: number
  /** Steps discarded because the frame ran long. */
  dropped: number
  fps: number
}

export class Loop {
  private accumulator = 0
  private lastTime = 0
  private rafId = 0
  private running = false
  private fpsFrames = 0
  private fpsClock = 0

  readonly stats: LoopStats = {
    frameMs: 0,
    simMs: 0,
    renderMs: 0,
    steps: 0,
    dropped: 0,
    fps: 0,
  }

  constructor(
    private readonly step: (dt: number) => void,
    private readonly draw: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.accumulator = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  private frame = (now: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.frame)

    const frameStart = now
    let elapsed = (now - this.lastTime) / 1000
    this.lastTime = now
    // A tab that was backgrounded returns a huge delta; clamp before it lands
    // in the accumulator or we simulate minutes in one frame.
    if (elapsed > 0.25) elapsed = 0.25
    this.accumulator += elapsed

    const simStart = performance.now()
    let steps = 0
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.step(STEP)
      this.accumulator -= STEP
      steps++
    }
    let dropped = 0
    if (this.accumulator >= STEP) {
      dropped = Math.floor(this.accumulator / STEP)
      this.accumulator = 0
    }
    const simEnd = performance.now()

    this.draw(this.accumulator / STEP)
    const renderEnd = performance.now()

    this.stats.steps = steps
    this.stats.dropped = dropped
    this.stats.simMs = simEnd - simStart
    this.stats.renderMs = renderEnd - simEnd
    this.stats.frameMs = renderEnd - frameStart

    this.fpsFrames++
    this.fpsClock += elapsed
    if (this.fpsClock >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsClock
      this.fpsFrames = 0
      this.fpsClock = 0
    }
  }
}
