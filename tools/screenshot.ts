/**
 * Headless screenshot: runs the real simulation, draws it with the real atlas,
 * writes a PNG. No browser, no canvas.
 *
 *   npm run shot -- [ticks] [out.png] [seed] [class]
 *
 * This exists because verifying "does it look right" through a browser is slow
 * and awkward, and because the sim already runs headlessly — the only missing
 * piece was a blitter, and `tools/png.ts` already had one. It duplicates the
 * renderer's frame selection and y-order deliberately: if the two ever disagree,
 * that is worth knowing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng, blankImage, type Image } from './png.ts'
import { World } from '../src/sim/world.ts'
import { OfferPool, type Offer } from '../src/sim/offers.ts'
import { Rng } from '../src/core/rng.ts'
import { TUNING, WEAPONS } from '../src/content/index.ts'

const STEP = 1 / 60
const ZOOM = 2
const PIXELS_PER_WALK_FRAME = 11
const VIEW_W = 520
const VIEW_H = 330

interface Frame { x: number; y: number; w: number; h: number; ox: number; oy: number }
interface AtlasJson {
  rig: { directions: string[] }
  clipLengths: Record<string, Record<string, number>>
  frames: Record<string, Frame>
}

const ticks = Number(process.argv[2] ?? 1500)
const out = process.argv[3] ?? 'tools/shot.png'
const seed = Number(process.argv[4] ?? 20260811)
const classId = process.argv[5] ?? 'hand'

const atlasImg = decodePng(readFileSync('public/atlas.png'))
const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as AtlasJson

// ------------------------------------------------------------------- the run

const world = new World(seed, classId)
const offers = new OfferPool(world.rng)
let pending = 0
world.events = { onLevelUp: (n) => { pending += n } }

const pickSmart = (list: Offer[]): Offer | undefined =>
  list.find((o) => o.mergesTo !== null) ?? list[0]

for (let i = 0; i < ticks; i++) {
  const t = i * STEP
  world.step(STEP, Math.cos(t * 0.55), Math.sin(t * 0.55), i % 400 === 0)
  if (pending > 0) {
    const o = pickSmart(offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup'))
    if (o) {
      if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
      else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
    }
    pending--
  }
}

// ------------------------------------------------------------------ terrain

const camX = Math.round(world.player.x - VIEW_W / 2)
const camY = Math.round(world.player.y - VIEW_H / 2)
const canvas = blankImage(VIEW_W * ZOOM, VIEW_H * ZOOM)

function fillRect(img: Image, x: number, y: number, w: number, h: number, rgb: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) {
      const i = (yy * img.width + xx) * 4
      img.data[i] = (rgb >> 16) & 0xff
      img.data[i + 1] = (rgb >> 8) & 0xff
      img.data[i + 2] = rgb & 0xff
      img.data[i + 3] = 255
    }
  }
}

/** Draw an atlas frame at a world position, honouring the zoom. */
function drawFrame(f: Frame, worldX: number, worldY: number): void {
  const dx = Math.round((worldX - camX) * ZOOM + f.ox * ZOOM)
  const dy = Math.round((worldY - camY) * ZOOM + f.oy * ZOOM)
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const si = ((f.y + y) * atlasImg.width + (f.x + x)) * 4
      if (atlasImg.data[si + 3] === 0) continue
      for (let py = 0; py < ZOOM; py++) {
        for (let px = 0; px < ZOOM; px++) {
          const tx = dx + x * ZOOM + px
          const ty = dy + y * ZOOM + py
          if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue
          const di = (ty * canvas.width + tx) * 4
          canvas.data[di] = atlasImg.data[si]
          canvas.data[di + 1] = atlasImg.data[si + 1]
          canvas.data[di + 2] = atlasImg.data[si + 2]
          canvas.data[di + 3] = 255
        }
      }
    }
  }
}

/**
 * Draw a frame with rotation and scale, by inverse-mapping each destination
 * pixel back into the source. Nearest neighbour, because everything here is
 * pixel art and any filtering would be a lie about what the game draws.
 */
function drawFrameT(f: Frame, worldX: number, worldY: number, rot: number, scale: number): void {
  const cx = (worldX - camX) * ZOOM
  const cy = (worldY - camY) * ZOOM
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const half = (Math.max(f.w, f.h) * Math.abs(scale) * ZOOM) / 2 + 2
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      // Rotate the destination offset back into unrotated frame space.
      const ux = (dx * cos + dy * sin) / (scale * ZOOM)
      const uy = (-dx * sin + dy * cos) / (scale * ZOOM)
      const fx = Math.floor(ux + f.w / 2)
      const fy = Math.floor(uy + f.h / 2)
      if (fx < 0 || fy < 0 || fx >= f.w || fy >= f.h) continue
      const si = ((f.y + fy) * atlasImg.width + (f.x + fx)) * 4
      if (atlasImg.data[si + 3] === 0) continue
      const tx = Math.round(cx + dx)
      const ty = Math.round(cy + dy)
      if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue
      const di = (ty * canvas.width + tx) * 4
      canvas.data[di] = atlasImg.data[si]
      canvas.data[di + 1] = atlasImg.data[si + 1]
      canvas.data[di + 2] = atlasImg.data[si + 2]
      canvas.data[di + 3] = 255
    }
  }
}

const grass = atlas.frames['terrain.grass']
const dirt = atlas.frames['terrain.dirt']
const soil = atlas.frames['terrain.soil']

fillRect(canvas, 0, 0, canvas.width, canvas.height, 0x479757)
const tile = 32
const startTx = Math.floor(camX / tile) - 1
const startTy = Math.floor(camY / tile) - 1
const terrainRng = new Rng(world.seed ^ 0x7e44a1)
// Reproduce the renderer's dirt patches so the shot matches the game.
const patches: [number, number, number][] = []
for (let i = 0; i < 26; i++) {
  patches.push([
    terrainRng.int(2, Math.ceil(world.arenaW / tile) - 3),
    terrainRng.int(2, Math.ceil(world.arenaH / tile) - 3),
    terrainRng.int(1, 3),
  ])
}
const cols = Math.ceil(world.arenaW / tile)
for (let ty = startTy; ty < startTy + VIEW_H / tile + 3; ty++) {
  for (let tx = startTx; tx < startTx + VIEW_W / tile + 3; tx++) {
    if (tx < 0 || ty < 0) continue
    let f = grass
    for (const [cx, cy, r] of patches) {
      const dx = tx - cx
      const dy = ty - cy
      if (dx * dx + dy * dy <= r * r && dirt) f = dirt
    }
    if ((tx < 3 || tx >= cols - 3) && soil) f = soil
    if (f) drawFrame(f, tx * tile + tile / 2, ty * tile + tile)
  }
}

// ------------------------------------------------------------------ sprites

function directionIndex(facing: number): number {
  const c = Math.cos(facing)
  const s = Math.sin(facing)
  if (Math.abs(c) >= Math.abs(s) * 0.85) return c < 0 ? 2 : 3
  return s > 0 ? 0 : 1
}

function sheetFrame(sheet: string, facing: number, travelled: number, moving: boolean): Frame | undefined {
  const dir = atlas.rig.directions[directionIndex(facing)] ?? 'down'
  if (!moving) return atlas.frames[`${sheet}.idle.${dir}.0`]
  const len = atlas.clipLengths[sheet]?.walk ?? 6
  const f = Math.floor(travelled / PIXELS_PER_WALK_FRAME) % len
  return atlas.frames[`${sheet}.walk.${dir}.${f}`]
}

const drawList: { y: number; f: Frame; x: number }[] = []

for (let i = 0; i < world.props.live; i++) {
  const c = world.props.items[i]
  const f = atlas.frames[c.sprite]
  if (f) drawList.push({ y: c.y, x: c.x, f })
}
for (let i = 0; i < world.enemies.live; i++) {
  const e = world.enemies.items[i]
  const moving = e.stun <= 0 && e.dying <= 0 && (e.vx !== 0 || e.vy !== 0)
  const f = sheetFrame(e.typeId, e.facing, e.travelled, moving)
  if (f) drawList.push({ y: e.y, x: e.x, f })
}
{
  const p = world.player
  const f = sheetFrame(p.classId, p.facing, p.travelled, p.vx !== 0 || p.vy !== 0)
  if (f) drawList.push({ y: p.y, x: p.x, f })
}

drawList.sort((a, b) => a.y - b.y)
for (const d of drawList) drawFrame(d.f, d.x, d.y)

/** Blend a colour over the canvas at a world point, for the sweep wedges. */
function tint(worldX: number, worldY: number, rgb: number, a: number): void {
  const tx = Math.round((worldX - camX) * ZOOM)
  const ty = Math.round((worldY - camY) * ZOOM)
  if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) return
  const di = (ty * canvas.width + tx) * 4
  canvas.data[di] = Math.round(((rgb >> 16) & 0xff) * a + canvas.data[di] * (1 - a))
  canvas.data[di + 1] = Math.round(((rgb >> 8) & 0xff) * a + canvas.data[di + 1] * (1 - a))
  canvas.data[di + 2] = Math.round((rgb & 0xff) * a + canvas.data[di + 2] * (1 - a))
}

// Melee sweeps and auras: swept wedges, matching the renderer. These used to
// draw as a filled square the size of the whole hitbox — a ~100px white block
// that was the loudest thing on screen.
for (let i = 0; i < world.projectiles.live; i++) {
  const p = world.projectiles.items[i]
  const aura = p.type === 'aura'
  if (p.behaviour !== 'arcSwing' && !aura) continue
  const half = 0.85
  for (let r = 0; r <= p.radius; r += 0.5) {
    const inner = aura ? p.radius * 0.86 : 0
    if (r < inner) continue
    const from = aura ? -Math.PI : p.angle - half
    const to = aura ? Math.PI : p.angle + half
    for (let a = from; a <= to; a += 0.02) {
      tint(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, aura ? 0x96cde1 : 0xf2ead2, 0.3)
    }
  }
}

// Projectiles, drawn as their weapon's sprite the way the renderer does.
for (let i = 0; i < world.projectiles.live; i++) {
  const p = world.projectiles.items[i]
  if (p.behaviour === 'arcSwing' || p.type === 'aura') continue // areas, not objects
  // Animated clip if the weapon declares one, else its icon — same order as the
  // renderer, so what this shows is what the game draws.
  const wdef = (WEAPONS as Record<string, Record<string, unknown>>)[p.weaponId]
  const clip = typeof wdef?.projectileClip === 'string' ? wdef.projectileClip : null
  let f: Frame | undefined
  if (clip) {
    const len = atlas.clipLengths[clip]?.play ?? 0
    if (len > 0) {
      const phase = (p.x * 0.35) | 0
      f = atlas.frames[`${clip}.${(((world.elapsed * 15) | 0) + phase) % len}`]
    }
  }
  if (!f) f = atlas.frames[p.behaviour === 'minionHunt' ? 'feralDog.idle.down.0' : `weapon.${p.weaponId}`]
  if (!f) continue
  const rot = p.vx !== 0 || p.vy !== 0 ? Math.atan2(p.vy, p.vx) : p.angle
  drawFrameT(f, p.x, p.y, rot, 0.55)
}

// The weapon ring. Angles come straight from the sim, as in the renderer.
for (const slot of world.player.weapons) {
  const key = slot.id === 'barnDog' ? 'feralDog.idle.down.0' : `weapon.${slot.id}`
  const f = atlas.frames[key]
  if (!f) continue
  const cfg = TUNING.fx as unknown as Record<string, number>
  const kick = slot.recoil > 0
    ? (slot.recoil / cfg.weaponRecoilSeconds) * cfg.weaponRecoilPixels
    : 0
  const r = cfg.weaponRingRadius
  const x = world.player.x + Math.cos(slot.ringAngle) * r - Math.cos(slot.aimAngle) * kick
  const y = world.player.y + Math.sin(slot.ringAngle) * r - Math.sin(slot.aimAngle) * kick - 14
  const facingLeft = Math.abs(slot.aimAngle) > Math.PI / 2
  drawFrameT(f, x, y, facingLeft ? slot.aimAngle + Math.PI : slot.aimAngle, cfg.weaponRingScale)
}

// FX clips, over the sprite layer. Same frame selection as the renderer.
for (let i = 0; i < world.effects.live; i++) {
  const e = world.effects.items[i]
  const len = atlas.clipLengths[`fx.${e.clip}`]?.play ?? 1
  const t = 1 - e.life / e.maxLife
  let fi = (t * len) | 0
  if (fi >= len) fi = len - 1
  const f = atlas.frames[`fx.${e.clip}.${fi}`]
  if (f) drawFrame(f, e.x, e.y)
}

for (let i = 0; i < world.pickups.live; i++) {
  const g = world.pickups.items[i]
  const f = atlas.frames[`pickup.${g.kind}`]
  if (f) {
    drawFrame(f, g.x, g.y)
  } else {
    const s = g.kind === 'xp' ? 5 : 7
    fillRect(
      canvas,
      Math.round((g.x - camX) * ZOOM - (s * ZOOM) / 2),
      Math.round((g.y - camY) * ZOOM - (s * ZOOM) / 2),
      s * ZOOM, s * ZOOM,
      g.kind === 'xp' ? 0x5fd0c6 : 0xe0b040,
    )
  }
}

writeFileSync(out, encodePng(canvas))
console.log(
  `${out}  ${canvas.width}x${canvas.height}\n` +
  `wave ${world.spawner.wave}  lv ${world.player.level}  enemies ${world.enemies.live}  ` +
  `crops ${world.props.live}  kills ${world.kills}  sprites drawn ${drawList.length}  ` +
  `fx live ${world.effects.live}`,
)
