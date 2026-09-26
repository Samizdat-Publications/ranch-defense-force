/**
 * The sprite batch: every textured quad in the game goes through here.
 *
 * One instanced draw per flush. Each instance is a frame from the atlas (a
 * TEXTURE_2D_ARRAY, one layer per page), a glyph from the text texture, or a
 * solid quad, with its own transform, tint, hit flash, emissive amount and an
 * optional 1 px outline. Sampling is `texelFetch`, never filtered: the world
 * target is at art resolution, so a texel is a pixel and nothing blurs.
 *
 * The outline is why the quad is grown by one texel on every side: a pixel
 * outside the frame that touches an opaque pixel inside it becomes outline.
 * The atlas packs frames with 2 px of transparent padding, so the one-texel
 * reach never picks up a neighbouring frame.
 *
 * ## Shadow mode
 *
 * The same uploaded instances can be drawn a second time as sun shadows. Every
 * vertex is projected from the sprite's ground line (its anchor, plus any lift
 * for carried gear) along the sun vector by its height above that line, and
 * the fragment writes a flat shadow strength. Drawn with MAX blending into the
 * shadow mask, so two overlapping shadows are no darker than one.
 */
import { compile, Uniforms, type GL } from './glutil'

/** Floats per instance. Keep in step with the attribute layout below. */
const STRIDE = 24

/** Page value for a glyph from the text texture. */
export const PAGE_GLYPH = -1
/** Page value for a solid quad: the rect is opaque and takes the tint. */
export const PAGE_SOLID = -2

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosOff;      // anchor.xy, local top-left.xy
layout(location=2) in vec4 iSizeSrc;     // size.wh, src texel.xy
layout(location=3) in vec4 iPageRotScale;// page, rotation, scale.xy
layout(location=4) in vec4 iTint;
layout(location=5) in vec4 iFx;          // flash, emissive, casts shadow, lift
layout(location=6) in vec4 iOutline;
uniform vec2 uView;
uniform vec2 uTarget;
uniform int uMode;                       // 0 colour, 1 shadow
uniform vec2 uSun;                       // ground offset per pixel of height
out vec2 vTex;
flat out vec4 vRect;
flat out float vPage;
flat out vec4 vTint;
flat out vec4 vFx;
flat out vec4 vOutline;
void main() {
  if (uMode == 1 && iFx.z < 0.5) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    return;
  }
  float grow = (uMode == 0 && iOutline.a > 0.0) ? 1.0 : 0.0;
  vec2 local = iPosOff.zw - grow + aCorner * (iSizeSrc.xy + 2.0 * grow);
  vTex = iSizeSrc.zw + (local - iPosOff.zw);
  vRect = vec4(iSizeSrc.zw, iSizeSrc.zw + iSizeSrc.xy);
  vec2 s = local * iPageRotScale.zw;
  float c = cos(iPageRotScale.y);
  float n = sin(iPageRotScale.y);
  vec2 world = iPosOff.xy + vec2(s.x * c - s.y * n, s.x * n + s.y * c);
  if (uMode == 1) {
    float ground = iPosOff.y + iFx.w;
    float h = ground - world.y;
    world = vec2(world.x + uSun.x * h, ground + uSun.y * h);
  }
  vec2 p = (world - uView) / uTarget * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vPage = iPageRotScale.x;
  vTint = iTint;
  vFx = iFx;
  vOutline = iOutline;
}`

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
in vec2 vTex;
flat in vec4 vRect;
flat in float vPage;
flat in vec4 vTint;
flat in vec4 vFx;
flat in vec4 vOutline;
uniform sampler2DArray uAtlas;
uniform sampler2D uGlyphs;
uniform int uMode;
uniform float uShadowAlpha;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;

vec4 fetch(ivec2 t) {
  if (float(t.x) < vRect.x || float(t.y) < vRect.y || float(t.x) >= vRect.z || float(t.y) >= vRect.w) return vec4(0.0);
  if (vPage >= 0.0) return texelFetch(uAtlas, ivec3(t, int(vPage + 0.5)), 0);
  if (vPage > -1.5) return texelFetch(uGlyphs, t, 0);
  return vec4(1.0);
}

void main() {
  ivec2 t = ivec2(floor(vTex));
  vec4 c = fetch(t);
  if (uMode == 1) {
    if (c.a < 0.5) discard;
    float a = uShadowAlpha * vTint.a;
    oColor = vec4(a);
    oEmissive = vec4(0.0);
    return;
  }
  // A negative tint alpha draws the outline alone, over everything: how the
  // player stays findable inside a crowd.
  bool outlineOnly = vTint.a < 0.0;
  if (outlineOnly && c.a >= 0.02) discard;
  // Outline alpha above 1 carries the curse: how far toward a cold corpse
  // pallor the sprite is pushed (enemies). The outline itself caps at 1.
  float curse = clamp(vOutline.a - 1.0, 0.0, 1.0);
  float outlineA = min(vOutline.a, 1.0);
  if (c.a < 0.02) {
    if (outlineA <= 0.0) discard;
    float n = fetch(t + ivec2(1, 0)).a + fetch(t - ivec2(1, 0)).a
            + fetch(t + ivec2(0, 1)).a + fetch(t - ivec2(0, 1)).a;
    if (n < 0.5) discard;
    c = vec4(vOutline.rgb, outlineA * (outlineOnly ? 1.0 : vTint.a));
    oColor = vec4(c.rgb * c.a, c.a);
    // A cursed thing after dark keeps a faint moonlit rim of its own, so the
    // crowd past the lantern is a crowd and not an empty field.
    float rim = curse > 0.0 ? max(0.0, -vFx.y - 0.5) : 0.0;
    oEmissive = vec4(c.rgb * c.a * rim, c.a * rim);
    return;
  }
  // A negative emissive means: only the eyes glow. Bright yellow or red
  // pixels on a creature are its eyes, and they are what you see of it in
  // the dark before the lantern reaches it.
  float em = vFx.y;
  float eye = 0.0;
  if (em < 0.0) {
    float yellow = (c.r > 0.72 && c.g > 0.6 && c.b < 0.45 && (c.r + c.g) * 0.5 - c.b > 0.38) ? 1.0 : 0.0;
    float red = (c.r > 0.72 && c.g < 0.3 && c.b < 0.3) ? 1.0 : 0.0;
    eye = max(yellow, red);
    em = eye * -em;
  }
  if (curse > 0.0) {
    // Drained and cold, lifted a little so a body reads against warm ground;
    // the eyes keep their colour, which is the point of them.
    float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
    vec3 pale = vec3(l) * vec3(0.92, 1.04, 0.96) * 1.1 + vec3(0.02, 0.04, 0.03);
    c.rgb = mix(c.rgb, pale, curse * (1.0 - eye));
    c.rgb = mix(c.rgb, vec3(1.0, 0.86, 0.36), eye * curse * 0.6);
  }
  c.rgb = mix(c.rgb, vec3(1.0, 0.96, 0.88), vFx.x);
  c *= vTint;
  oColor = vec4(c.rgb * c.a, c.a);
  oEmissive = vec4(c.rgb * c.a * em, c.a * em);
}`

export class SpriteBatch {
  private readonly prog: WebGLProgram
  private readonly u: Uniforms
  private readonly vao: WebGLVertexArrayObject
  private readonly instBuf: WebGLBuffer
  private data: Float32Array
  private capacity: number
  /** Instances queued since the last flush. */
  count = 0
  /** Draw calls issued since the counter was last zeroed. */
  draws = 0

  constructor(private readonly gl: GL, initialCapacity = 8192) {
    this.prog = compile(gl, VS, FS, 'sprites')
    this.u = new Uniforms(gl, this.prog)
    this.capacity = initialCapacity
    this.data = new Float32Array(initialCapacity * STRIDE)

    const vao = gl.createVertexArray()
    const quad = gl.createBuffer()
    const inst = gl.createBuffer()
    if (!vao || !quad || !inst) throw new Error('SpriteBatch: allocation failed')
    this.vao = vao
    this.instBuf = inst

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, inst)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    const bytes = STRIDE * 4
    for (let a = 0; a < 6; a++) {
      const loc = a + 1
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, bytes, a * 16)
      gl.vertexAttribDivisor(loc, 1)
    }
    gl.bindVertexArray(null)

    gl.useProgram(this.prog)
    gl.uniform1i(this.u.get('uAtlas'), 0)
    gl.uniform1i(this.u.get('uGlyphs'), 1)
  }

  private grow(): void {
    this.capacity *= 2
    const next = new Float32Array(this.capacity * STRIDE)
    next.set(this.data)
    this.data = next
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
  }

  /**
   * Queue one quad.
   *
   * `x, y` is the anchor in world pixels. `ox, oy` is where the art's top-left
   * sits relative to the anchor before scale and rotation (a frame's own
   * offset, plus any pivot correction). `sx, sy` are the atlas texel origin.
   * `caster` puts it in the shadow pass; `lift` is how far above its ground
   * line it is drawn (carried gear), so its shadow starts from the ground.
   */
  push(
    x: number, y: number, ox: number, oy: number, w: number, h: number,
    sx: number, sy: number, page: number,
    rotation: number, scaleX: number, scaleY: number,
    r: number, g: number, b: number, a: number,
    flash: number, emissive: number,
    or: number, og: number, ob: number, oa: number,
    caster = 0, lift = 0,
  ): void {
    if (this.count >= this.capacity) this.grow()
    const d = this.data
    let i = this.count * STRIDE
    d[i++] = x; d[i++] = y; d[i++] = ox; d[i++] = oy
    d[i++] = w; d[i++] = h; d[i++] = sx; d[i++] = sy
    d[i++] = page; d[i++] = rotation; d[i++] = scaleX; d[i++] = scaleY
    d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a
    d[i++] = flash; d[i++] = emissive; d[i++] = caster; d[i++] = lift
    d[i++] = or; d[i++] = og; d[i++] = ob; d[i] = oa
    this.count++
  }

  /** Send the queued instances to the GPU. */
  upload(): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE)
  }

  /** Draw the uploaded instances into the bound framebuffer. */
  drawUploaded(
    viewX: number, viewY: number, targetW: number, targetH: number,
    mode: 0 | 1 = 0, sunX = 0, sunY = 0, shadowAlpha = 0,
  ): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.uniform2f(this.u.get('uView'), viewX, viewY)
    gl.uniform2f(this.u.get('uTarget'), targetW, targetH)
    gl.uniform1i(this.u.get('uMode'), mode)
    gl.uniform2f(this.u.get('uSun'), sunX, sunY)
    gl.uniform1f(this.u.get('uShadowAlpha'), shadowAlpha)
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.bindVertexArray(null)
    this.draws++
  }

  /** Draw everything queued into the currently bound framebuffer, then clear the queue. */
  flush(viewX: number, viewY: number, targetW: number, targetH: number): void {
    if (this.count === 0) return
    this.upload()
    this.drawUploaded(viewX, viewY, targetW, targetH)
    this.count = 0
  }
}
