/**
 * Follow camera with a dead zone, lead, and trauma-based shake (§11).
 *
 * The dead zone is what stops the view twitching with every step; the lead is
 * what stops you running blind into the edge of the screen.
 */
import { TUNING } from '../content'

const C = TUNING.camera

export class Camera {
  x = 0
  y = 0
  /** Shake offset, recomputed each frame from trauma. */
  shakeX = 0
  shakeY = 0

  constructor(
    public viewW: number,
    public viewH: number,
    private readonly arenaW: number,
    private readonly arenaH: number,
  ) {}

  resize(w: number, h: number): void {
    this.viewW = w
    this.viewH = h
  }

  snapTo(x: number, y: number): void {
    this.x = x - this.viewW / 2
    this.y = y - this.viewH / 2
    this.clamp()
  }

  /**
   * `trauma` is 0..1 from the world; shake is trauma squared so small hits are
   * barely felt and a bull charge is unmistakable.
   */
  update(targetX: number, targetY: number, velX: number, velY: number, trauma: number, rand: () => number): void {
    const leadScale = C.leadDistance
    const speed = Math.hypot(velX, velY)
    const leadX = speed > 1 ? (velX / speed) * leadScale : 0
    const leadY = speed > 1 ? (velY / speed) * leadScale : 0

    const desiredX = targetX + leadX - this.viewW / 2
    const desiredY = targetY + leadY - this.viewH / 2

    const dx = desiredX - this.x
    const dy = desiredY - this.y
    const dist = Math.hypot(dx, dy)
    if (dist > C.deadZoneRadius) {
      // Only chase the part of the offset outside the dead zone, so the camera
      // sits still for small movements instead of creeping.
      const excess = (dist - C.deadZoneRadius) / dist
      this.x += dx * excess * C.lerp
      this.y += dy * excess * C.lerp
    }
    this.clamp()

    const mag = trauma * trauma * C.maxShakePixels
    this.shakeX = (rand() * 2 - 1) * mag
    this.shakeY = (rand() * 2 - 1) * mag
  }

  private clamp(): void {
    const maxX = Math.max(0, this.arenaW - this.viewW)
    const maxY = Math.max(0, this.arenaH - this.viewH)
    if (this.x < 0) this.x = 0
    else if (this.x > maxX) this.x = maxX
    if (this.y < 0) this.y = 0
    else if (this.y > maxY) this.y = maxY
  }

  /** Total offset including shake — what the renderer translates by. */
  get offsetX(): number {
    return this.x + this.shakeX
  }
  get offsetY(): number {
    return this.y + this.shakeY
  }
}
