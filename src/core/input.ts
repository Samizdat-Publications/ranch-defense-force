/**
 * Keyboard + gamepad, sampled once per tick (tick order step 1). Nothing else
 * reads key state directly.
 *
 * The move vector is normalised so diagonal movement isn't faster, and the
 * ability button is edge-triggered — `abilityPressed` is true for exactly one
 * tick per press, whichever device it came from.
 */
const DEADZONE = 0.22

export class Input {
  private readonly held = new Set<string>()
  private abilityLatch = false
  private abilityWasDown = false
  private padIndex: number | null = null
  private digitLatch: number | null = null
  private pauseLatch = false
  private interactLatch = false
  private interactWasDown = false

  /** Normalised movement, -1..1 each axis. */
  moveX = 0
  moveY = 0
  /** True for one tick on the frame the ability button went down. */
  abilityPressed = false
  /** 1-5 if a number key was pressed this tick (card picks), else 0. */
  digitPressed = 0
  /** True for one tick on the frame Escape went down. Edge-triggered like the
   *  ability, so holding it does not toggle pause sixty times a second. */
  pausePressed = false
  /**
   * True for one tick on the frame the interact button went down.
   *
   * Edge-triggered like the ability, and SEPARATE from it on purpose: the
   * ability is the thing you mash, and interact is the thing you do once and
   * mean. The only use so far is taking the way down, which is one-way — it
   * must not be reachable by holding a key you are already holding.
   */
  interactPressed = false
  padConnected = false

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
    target.addEventListener('gamepadconnected', this.onPadConnected as EventListener)
    target.addEventListener('gamepaddisconnected', this.onPadDisconnected as EventListener)
  }

  detach(target: Window = window): void {
    target.removeEventListener('keydown', this.onKeyDown)
    target.removeEventListener('keyup', this.onKeyUp)
    target.removeEventListener('blur', this.onBlur)
    target.removeEventListener('gamepadconnected', this.onPadConnected as EventListener)
    target.removeEventListener('gamepaddisconnected', this.onPadDisconnected as EventListener)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Let the seed box and other dev inputs keep their typing.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    this.held.add(e.code)
    if (e.code === 'Space') {
      this.abilityLatch = true
      e.preventDefault()
    }
    if (e.code === 'KeyE') this.interactLatch = true
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.pauseLatch = true
      e.preventDefault()
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5))
      if (n >= 1 && n <= 5) this.digitLatch = n
    }
    if (e.code.startsWith('Arrow')) e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code)
  }

  private onBlur = (): void => {
    this.held.clear()
  }

  private onPadConnected = (e: GamepadEvent): void => {
    this.padIndex = e.gamepad.index
    this.padConnected = true
  }

  private onPadDisconnected = (e: GamepadEvent): void => {
    if (this.padIndex === e.gamepad.index) {
      this.padIndex = null
      this.padConnected = false
    }
  }

  /** Call once per tick, before anything reads the fields. */
  sample(): void {
    let x = 0
    let y = 0
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) x -= 1
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) x += 1
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) y -= 1
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) y += 1

    let abilityDown = this.abilityLatch

    const pad = this.pollPad()
    if (pad) {
      const ax = pad.axes[0] ?? 0
      const ay = pad.axes[1] ?? 0
      if (Math.abs(ax) > DEADZONE || Math.abs(ay) > DEADZONE) {
        // Rescale past the deadzone so a barely-tilted stick isn't full speed.
        const mag = Math.min(1, Math.hypot(ax, ay))
        const scaled = (mag - DEADZONE) / (1 - DEADZONE)
        x = (ax / mag) * scaled
        y = (ay / mag) * scaled
      }
      // A (0) or right trigger (7).
      const rt = pad.buttons[7]
      if (pad.buttons[0]?.pressed || (rt && rt.value > 0.5)) abilityDown = true
    }

    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    this.moveX = x
    this.moveY = y

    this.abilityPressed = abilityDown && !this.abilityWasDown
    this.abilityWasDown = abilityDown

    let interactDown = this.interactLatch
    this.interactLatch = false
    // Gamepad face button 2 (X / square), which is not the ability's button 0.
    if (this.padIndex !== null) {
      const pad = navigator.getGamepads?.()[this.padIndex]
      if (pad?.buttons[2]?.pressed) interactDown = true
    }
    this.interactPressed = interactDown && !this.interactWasDown
    this.interactWasDown = interactDown
    this.abilityLatch = false

    this.digitPressed = this.digitLatch ?? 0
    this.digitLatch = null

    this.pausePressed = this.pauseLatch
    this.pauseLatch = false
  }

  private pollPad(): Gamepad | null {
    if (!navigator.getGamepads) return null
    const pads = navigator.getGamepads()
    if (this.padIndex !== null) {
      const p = pads[this.padIndex]
      if (p) return p
    }
    for (const p of pads) {
      if (p) {
        this.padIndex = p.index
        this.padConnected = true
        return p
      }
    }
    return null
  }

  isHeld(code: string): boolean {
    return this.held.has(code)
  }

  /** Movement magnitude 0..1 — The Kid's Momentum passive reads this. */
  get moveMagnitude(): number {
    return Math.hypot(this.moveX, this.moveY)
  }

  reset(): void {
    this.held.clear()
    this.abilityLatch = false
    this.abilityWasDown = false
    this.digitLatch = null
    this.digitPressed = 0
  }

  // Test seam — the digit/ability latches are otherwise only set by DOM events.
  _testPressDigit(n: number): void {
    this.digitLatch = n
  }
  _testPressAbility(): void {
    this.abilityLatch = true
  }
  _testHold(code: string, down: boolean): void {
    if (down) this.held.add(code)
    else this.held.delete(code)
  }
}
