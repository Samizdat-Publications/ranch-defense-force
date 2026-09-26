/**
 * The GPU side of the game, created once per canvas and kept for the session.
 *
 * Owns the WebGL2 context, the atlas uploaded as one TEXTURE_2D_ARRAY (a layer
 * per page), the glyph texture for damage numbers, the batches, the lighting
 * buffers and the composite pass. A run's renderer borrows all of this rather
 * than building its own, so starting a new run never re-uploads the atlas.
 *
 * ## The resolution model
 *
 * The world is drawn into a target at ART resolution: one art pixel is one
 * target pixel, for every sprite, so the whole field shares one pixel density.
 * The target is `viewH` pixels tall (a content constant) and as wide as the
 * window's aspect ratio needs, plus a one-pixel margin on every side. The
 * composite pass scales it to the canvas with a sharp-bilinear filter (crisp
 * pixels, a one-pixel soft seam between them so non-integer scales do not
 * shimmer) and applies the camera's sub-pixel offset there, so the camera
 * glides without the whole field crawling a pixel at a time.
 *
 * ## The light model
 *
 * Four buffers at world-target resolution feed the composite:
 *  - colour: what everything looks like in white light;
 *  - emissive: light a surface gives off itself (a tracer, a gem, an eye),
 *    which ignores the dark and is what blooms;
 *  - light: point and cone lights, added together;
 *  - shadow: where the sun is blocked, as a 0..1 mask.
 * Lit colour is `colour * (ambient + sun * (1 - shadow) + light) + emissive`,
 * then exposure, saturation, contrast, tint and vignette from the time of day.
 */
import type { Atlas } from '../../core/atlas'
import { Rng } from '../../core/rng'
import { compile, MultiTarget, Target, Uniforms, type GL, type TargetFormat } from './glutil'
import { SpriteBatch } from './sprites'
import { ShapeBatch } from './shapes'
import { LightBatch } from './lights'
import { GroundPass } from './ground'
import { HazardBatch } from './hazards'

export interface Glyph { x: number; y: number; w: number; h: number }

/** Everything the composite needs from the renderer for one frame. */
export interface CompositeParams {
  ambient: [number, number, number]
  sun: [number, number, number]
  exposure: number
  saturation: number
  contrast: number
  tint: [number, number, number]
  vignette: number
  emissiveGain: number
  bloomGain: number
  /** Added to the whole frame: lightning, a hit. */
  flash: [number, number, number]
  /** Red at the screen edge when the player is hurt, 0..1. */
  hurt: number
  time: number
  /** Top-left of the world target, in world pixels: clouds are fixed to the ground. */
  originX: number
  originY: number
  /** How much drifting cloud shade falls on the sunlit ground, 0..1. */
  clouds: number
}

export function newCompositeParams(): CompositeParams {
  return {
    ambient: [1, 1, 1], sun: [0, 0, 0], exposure: 1, saturation: 1, contrast: 1, tint: [1, 1, 1],
    vignette: 0, emissiveGain: 0.5, bloomGain: 0.6, flash: [0, 0, 0], hurt: 0, time: 0,
    originX: 0, originY: 0, clouds: 0,
  }
}

const FULLSCREEN_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aCorner;
out vec2 vUv;
void main() {
  vUv = aCorner;
  gl_Position = vec4(aCorner * 2.0 - 1.0, 0.0, 1.0);
}`

const COMPOSITE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uWorld;
uniform sampler2D uEmissive;
uniform sampler2D uLight;
uniform sampler2D uShadow;
uniform sampler2D uBloom;
uniform sampler2D uNoise;
uniform vec2 uOrigin;
uniform float uClouds;
uniform vec2 uWorldSize;
uniform vec2 uOutSize;
uniform float uScale;
uniform vec2 uFrac;
uniform float uLightScale;
uniform vec3 uAmbient;
uniform vec3 uSun;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform float uVignette;
uniform float uEmissiveGain;
uniform float uBloomGain;
uniform vec3 uFlash;
uniform float uHurt;
uniform float uTime;
out vec4 oColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uOutSize;
  vec2 texel = px / uScale + uFrac + 1.0;
  // Sharp-bilinear for the art: crisp texels, a one-pixel blend between them.
  vec2 fl = floor(texel);
  vec2 f = fract(texel) - 0.5;
  vec2 region = vec2(max(0.0, 0.5 - 0.5 / uScale));
  vec2 s = (f - clamp(f, -region, region)) * uScale + 0.5;
  vec2 uvS = (fl + s) / uWorldSize;
  uvS.y = 1.0 - uvS.y;
  // Plain bilinear for light, which should be smooth.
  vec2 uvL = texel / uWorldSize;
  uvL.y = 1.0 - uvL.y;

  vec4 world = texture(uWorld, uvS);
  vec3 albedo = world.rgb;
  vec3 emis = texture(uEmissive, uvS).rgb;
  vec3 light = texture(uLight, uvL).rgb * uLightScale;
  // r: the sun is blocked here. g: something stands right here (contact
  // shadow), which also takes some of the sky.
  vec2 sh = texture(uShadow, uvL).rg * (1.0 - world.a);
  vec3 bloom = texture(uBloom, uvL).rgb;

  // Cloud shadows drift over the field: big soft shapes that only ever take
  // the sun, so they are gone the moment the sun is.
  vec2 wp = uOrigin + texel;
  float cloud = texture(uNoise, wp / 1100.0 + vec2(uTime * 0.004, uTime * 0.0015)).r * 0.7
              + texture(uNoise, wp / 430.0 + vec2(uTime * 0.007, 0.0)).r * 0.3;
  float shade = smoothstep(0.5, 0.66, cloud);
  // Stepped and dithered on the art's own pixel grid, so a cloud's edge is
  // made of the same size pixels as everything under it.
  shade = floor(shade * 3.0 + hash(floor(wp)) * 0.9) / 3.0 * uClouds;
  vec3 illum = uAmbient * (1.0 - sh.g * 0.55) + uSun * (1.0 - max(sh.r, sh.g)) * (1.0 - shade * 0.6) + light;
  vec3 col = albedo * illum + emis * uEmissiveGain + bloom * uBloomGain + uFlash;
  col *= uExposure;
  // A soft shoulder above 0.75 so a lantern or a muzzle flash never clips flat.
  vec3 over = max(col - 0.75, 0.0);
  col = min(col, 0.75) + 0.25 * (1.0 - exp(-over * 4.0));
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col *= uTint;

  vec2 c = (vUv - 0.5) * vec2(uOutSize.x / uOutSize.y, 1.0);
  float r = length(c);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
  col = mix(col, vec3(0.55, 0.02, 0.02), uHurt * smoothstep(0.45, 1.0, r));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 128.0;
  oColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uHalf;
out vec4 oColor;
void main() {
  vec4 s = texture(uSrc, vUv) * 4.0;
  s += texture(uSrc, vUv - uHalf);
  s += texture(uSrc, vUv + uHalf);
  s += texture(uSrc, vUv + vec2(uHalf.x, -uHalf.y));
  s += texture(uSrc, vUv - vec2(uHalf.x, -uHalf.y));
  oColor = s / 8.0;
}`

const BLOOM_UP_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uHalf;
out vec4 oColor;
void main() {
  vec2 h = uHalf;
  vec4 s = texture(uSrc, vUv + vec2(-h.x * 2.0, 0.0));
  s += texture(uSrc, vUv + vec2(-h.x, h.y)) * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, h.y * 2.0));
  s += texture(uSrc, vUv + vec2(h.x, h.y)) * 2.0;
  s += texture(uSrc, vUv + vec2(h.x * 2.0, 0.0));
  s += texture(uSrc, vUv + vec2(h.x, -h.y)) * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, -h.y * 2.0));
  s += texture(uSrc, vUv + vec2(-h.x, -h.y)) * 2.0;
  oColor = s / 12.0;
}`

const TEXQUAD_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aCorner;
uniform vec4 uRect;
uniform vec4 uUv;
uniform vec2 uView;
uniform vec2 uTarget;
out vec2 vUv;
out vec2 vWorld;
void main() {
  vec2 world = uRect.xy + aCorner * uRect.zw;
  vWorld = world;
  vUv = mix(uUv.xy, uUv.zw, aCorner);
  vec2 p = (world - uView) / uTarget * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`

const TEXQUAD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uTint;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
void main() {
  vec4 c = texture(uTex, vUv) * uTint;
  oColor = vec4(c.rgb * c.a, c.a);
  oEmissive = vec4(0.0);
}`

/** Drifting ground fog: two octaves of the noise texture, quantised to a few bands. */
const FOG_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
in vec2 vWorld;
uniform sampler2D uNoise;
uniform vec4 uColor;       // rgb, density
uniform vec2 uDrift;
uniform float uScale;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
void main() {
  vec2 p = floor(vWorld) / uScale;
  float n = texture(uNoise, p + uDrift).r * 0.65 + texture(uNoise, p * 2.3 - uDrift * 1.7).r * 0.35;
  float d = smoothstep(0.38, 0.85, n);
  d = floor(d * 5.0 + 0.5) / 5.0;
  float a = d * uColor.a;
  oColor = vec4(uColor.rgb * a, a);
  oEmissive = vec4(0.0);
}`

const GLYPH_CHARS = '0123456789+-x!.%'

const devices = new WeakMap<HTMLCanvasElement, GLDevice>()

export class GLDevice {
  readonly gl: GL
  readonly sprites: SpriteBatch
  readonly shapes: ShapeBatch
  readonly lights: LightBatch
  readonly ground: GroundPass
  readonly hazards: HazardBatch
  /** Colour and emissive, at art resolution. */
  readonly world: MultiTarget
  readonly light: Target
  readonly shadow: Target
  private readonly bloom: Target[] = []
  /** Light buffer values are stored times this; below 1 when the buffer is 8-bit. */
  readonly lightOut: number

  viewW = 960
  viewH = 540
  /** Canvas pixels per texel. */
  scale = 2

  private atlasTex: WebGLTexture | null = null
  private atlasFor: Atlas | null = null
  private glyphTex: WebGLTexture
  readonly glyphs = new Map<string, Glyph>()
  readonly glyphsBig = new Map<string, Glyph>()
  private readonly noiseTex: WebGLTexture

  private readonly quadVao: WebGLVertexArrayObject
  private readonly composite: WebGLProgram
  private readonly compositeU: Uniforms
  private readonly texquad: WebGLProgram
  private readonly texquadU: Uniforms
  private readonly fog: WebGLProgram
  private readonly fogU: Uniforms
  private readonly bloomDown: WebGLProgram
  private readonly bloomDownU: Uniforms
  private readonly bloomUp: WebGLProgram
  private readonly bloomUpU: Uniforms

  private decalTarget: Target | null = null
  private readonly shared = new Map<string, WebGLTexture>()

  static for(canvas: HTMLCanvasElement): GLDevice {
    let d = devices.get(canvas)
    if (!d) {
      d = new GLDevice(canvas)
      devices.set(canvas, d)
    }
    return d
  }

  private constructor(readonly canvas: HTMLCanvasElement) {
    const tour = typeof location !== 'undefined' && new URLSearchParams(location.search).has('tour')
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: tour,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl

    const rgba8: TargetFormat = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }
    const float = !!gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')
    const hdr: TargetFormat = float
      ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR }
      : rgba8
    this.lightOut = float ? 1 : 0.25

    this.sprites = new SpriteBatch(gl)
    this.shapes = new ShapeBatch(gl)
    this.lights = new LightBatch(gl)
    this.ground = new GroundPass(gl)
    this.hazards = new HazardBatch(gl)
    const w = this.viewW + 2
    const h = this.viewH + 2
    this.world = new MultiTarget(gl, [rgba8, rgba8], w, h)
    this.light = new Target(gl, hdr, w, h)
    this.shadow = new Target(gl, rgba8, w, h)
    for (let i = 1; i <= 4; i++) this.bloom.push(new Target(gl, hdr, w >> i, h >> i))

    const vao = gl.createVertexArray()
    const buf = gl.createBuffer()
    if (!vao || !buf) throw new Error('GLDevice: allocation failed')
    this.quadVao = vao
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    this.composite = compile(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite')
    this.compositeU = new Uniforms(gl, this.composite)
    this.texquad = compile(gl, TEXQUAD_VS, TEXQUAD_FS, 'texquad')
    this.texquadU = new Uniforms(gl, this.texquad)
    this.fog = compile(gl, TEXQUAD_VS, FOG_FS, 'fog')
    this.fogU = new Uniforms(gl, this.fog)
    this.bloomDown = compile(gl, FULLSCREEN_VS, BLOOM_DOWN_FS, 'bloomDown')
    this.bloomDownU = new Uniforms(gl, this.bloomDown)
    this.bloomUp = compile(gl, FULLSCREEN_VS, BLOOM_UP_FS, 'bloomUp')
    this.bloomUpU = new Uniforms(gl, this.bloomUp)

    this.glyphTex = this.buildGlyphs()
    this.noiseTex = this.buildNoise()
    void this.refreshGlyphs()

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  /**
   * Size the buffers for a canvas. The world target is `viewH` texels tall
   * whatever the window, so every screen sees the same amount of field.
   */
  resize(canvasW: number, canvasH: number, viewH: number): void {
    this.canvas.width = canvasW
    this.canvas.height = canvasH
    this.viewH = viewH
    this.scale = canvasH / viewH
    this.viewW = Math.ceil(canvasW / this.scale)
    const w = this.viewW + 2
    const h = this.viewH + 2
    this.world.resize(w, h)
    this.light.resize(w, h)
    this.shadow.resize(w, h)
    this.bloom.forEach((t, i) => t.resize(w >> (i + 1), h >> (i + 1)))
  }

  /** Upload the atlas pages into one texture array. Once per atlas. */
  useAtlas(atlas: Atlas): void {
    if (this.atlasFor === atlas) return
    const gl = this.gl
    if (this.atlasTex) gl.deleteTexture(this.atlasTex)
    const tex = gl.createTexture()
    if (!tex) throw new Error('useAtlas: allocation failed')
    let w = 1
    let h = 1
    for (const img of atlas.images) {
      w = Math.max(w, img.naturalWidth)
      h = Math.max(h, img.naturalHeight)
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, atlas.images.length)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    atlas.images.forEach((img, layer) => {
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, img.naturalWidth, img.naturalHeight, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, img,
      )
    })
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    this.atlasTex = tex
    this.atlasFor = atlas
  }

  /**
   * The arena-sized decal target (blood that stains). One per device, reused
   * by every run, cleared here: a new run must not inherit the last one's stains.
   */
  decals(w: number, h: number): Target {
    const gl = this.gl
    if (!this.decalTarget) {
      this.decalTarget = new Target(gl, {
        internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST,
      }, w, h)
    } else {
      this.decalTarget.resize(w, h)
    }
    this.decalTarget.bind()
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return this.decalTarget
  }

  /**
   * Let old stains weather: multiply the decal target by `keep`. Called every
   * couple of seconds, so a patch you fought on stays dark for a minute or so
   * and the whole field never turns into one red carpet.
   */
  weatherDecals(keep: number): void {
    const t = this.decalTarget
    if (!t) return
    const gl = this.gl
    t.bind()
    gl.useProgram(this.texquad)
    gl.blendColor(0, 0, 0, keep)
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA)
    const u = this.texquadU
    gl.uniform4f(u.get('uRect'), 0, 0, t.w, t.h)
    gl.uniform4f(u.get('uUv'), 0, 0, 1, 1)
    gl.uniform2f(u.get('uView'), 0, 0)
    gl.uniform2f(u.get('uTarget'), t.w, t.h)
    gl.uniform4f(u.get('uTint'), 0, 0, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex)
    gl.uniform1i(u.get('uTex'), 0)
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** A texture slot that survives across runs, so re-baking reuses the allocation. */
  sharedTexture(name: string): WebGLTexture | undefined {
    return this.shared.get(name)
  }

  setSharedTexture(name: string, tex: WebGLTexture | null): void {
    if (tex) this.shared.set(name, tex)
    else this.shared.delete(name)
  }

  get atlasTexture(): WebGLTexture | null { return this.atlasTex }
  get noise(): WebGLTexture { return this.noiseTex }

  /** Bind the atlas and glyph textures to the units the sprite shader reads. */
  bindSpriteTextures(): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTex)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** Draw a plain texture as a world-space rectangle into the bound target. */
  texQuad(
    tex: WebGLTexture, x: number, y: number, w: number, h: number,
    u0: number, v0: number, u1: number, v1: number,
    viewX: number, viewY: number, targetW: number, targetH: number,
    r = 1, g = 1, b = 1, a = 1,
  ): void {
    const gl = this.gl
    gl.useProgram(this.texquad)
    const u = this.texquadU
    gl.uniform4f(u.get('uRect'), x, y, w, h)
    gl.uniform4f(u.get('uUv'), u0, v0, u1, v1)
    gl.uniform2f(u.get('uView'), viewX, viewY)
    gl.uniform2f(u.get('uTarget'), targetW, targetH)
    gl.uniform4f(u.get('uTint'), r, g, b, a)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(u.get('uTex'), 0)
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /** Procedural ground fog over the visible rect of the bound target. */
  fogQuad(
    viewX: number, viewY: number, targetW: number, targetH: number,
    r: number, g: number, b: number, density: number, driftX: number, driftY: number, scale: number,
  ): void {
    if (density <= 0.001) return
    const gl = this.gl
    gl.useProgram(this.fog)
    const u = this.fogU
    gl.uniform4f(u.get('uRect'), viewX, viewY, targetW, targetH)
    gl.uniform4f(u.get('uUv'), 0, 0, 1, 1)
    gl.uniform2f(u.get('uView'), viewX, viewY)
    gl.uniform2f(u.get('uTarget'), targetW, targetH)
    gl.uniform4f(u.get('uColor'), r, g, b, density)
    gl.uniform2f(u.get('uDrift'), driftX, driftY)
    gl.uniform1f(u.get('uScale'), scale)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex)
    gl.uniform1i(u.get('uNoise'), 0)
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /**
   * Bind and clear the world target: colour to `r, g, b`, emissive to nothing.
   *
   * The colour target's ALPHA is not opacity here. It records how much of a
   * pixel is covered by a standing sprite, and the composite keeps sun shadow
   * off those pixels. In a three-quarter view a noon shadow falls up the
   * screen, which is exactly where a sprite's own body is drawn; without this
   * every sprite would stand in its own shadow.
   */
  beginWorld(r: number, g: number, b: number): void {
    const gl = this.gl
    this.world.bind()
    gl.clearBufferfv(gl.COLOR, 0, [r, g, b, 0])
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0])
  }

  /** Ground layers: blend colour normally but leave the sprite-coverage alpha alone. */
  groundBlend(): void {
    this.gl.blendFuncSeparate(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ZERO, this.gl.ONE)
  }

  /** Standing things: colour and coverage both blend. */
  spriteBlend(): void {
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)
  }

  /** Start the light buffer: cleared, bound, ready for `lights.flush`. */
  beginLights(): void {
    const gl = this.gl
    this.light.bind()
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** Start the shadow mask: cleared, bound, MAX blending until `endShadows`. */
  beginShadows(): void {
    const gl = this.gl
    this.shadow.bind()
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.blendEquation(gl.MAX)
  }

  endShadows(): void {
    this.gl.blendEquation(this.gl.FUNC_ADD)
  }

  private fullscreen(): void {
    const gl = this.gl
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /** Dual-filter bloom from the emissive buffer into `bloom[0]` (half resolution). */
  private runBloom(): void {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.useProgram(this.bloomDown)
    gl.uniform1i(this.bloomDownU.get('uSrc'), 0)
    gl.activeTexture(gl.TEXTURE0)
    let srcTex = this.world.texs[1]
    let srcW = this.world.w
    let srcH = this.world.h
    for (const t of this.bloom) {
      t.bind()
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      gl.uniform2f(this.bloomDownU.get('uHalf'), 0.5 / srcW, 0.5 / srcH)
      this.fullscreen()
      srcTex = t.tex
      srcW = t.w
      srcH = t.h
    }
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(this.bloomUp)
    gl.uniform1i(this.bloomUpU.get('uSrc'), 0)
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const src = this.bloom[i]
      const dst = this.bloom[i - 1]
      dst.bind()
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform2f(this.bloomUpU.get('uHalf'), 0.5 / src.w, 0.5 / src.h)
      this.fullscreen()
    }
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** Light, grade and scale the world onto the canvas. `fracX/Y` is the camera's sub-pixel part. */
  present(fracX: number, fracY: number, p: CompositeParams): void {
    const gl = this.gl
    this.runBloom()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.disable(gl.BLEND)
    gl.useProgram(this.composite)
    const u = this.compositeU
    const bind = (unit: number, tex: WebGLTexture, name: string): void => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(u.get(name), unit)
    }
    bind(0, this.world.texs[0], 'uWorld')
    bind(1, this.world.texs[1], 'uEmissive')
    bind(2, this.light.tex, 'uLight')
    bind(3, this.shadow.tex, 'uShadow')
    bind(4, this.bloom[0].tex, 'uBloom')
    bind(5, this.noiseTex, 'uNoise')
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform2f(u.get('uWorldSize'), this.world.w, this.world.h)
    gl.uniform2f(u.get('uOutSize'), this.canvas.width, this.canvas.height)
    gl.uniform1f(u.get('uScale'), this.scale)
    gl.uniform2f(u.get('uFrac'), fracX, fracY)
    gl.uniform1f(u.get('uLightScale'), 1 / this.lightOut)
    gl.uniform3f(u.get('uAmbient'), p.ambient[0], p.ambient[1], p.ambient[2])
    gl.uniform3f(u.get('uSun'), p.sun[0], p.sun[1], p.sun[2])
    gl.uniform1f(u.get('uExposure'), p.exposure)
    gl.uniform1f(u.get('uSaturation'), p.saturation)
    gl.uniform1f(u.get('uContrast'), p.contrast)
    gl.uniform3f(u.get('uTint'), p.tint[0], p.tint[1], p.tint[2])
    gl.uniform1f(u.get('uVignette'), p.vignette)
    gl.uniform1f(u.get('uEmissiveGain'), p.emissiveGain)
    gl.uniform1f(u.get('uBloomGain'), p.bloomGain)
    gl.uniform3f(u.get('uFlash'), p.flash[0], p.flash[1], p.flash[2])
    gl.uniform1f(u.get('uHurt'), p.hurt)
    gl.uniform1f(u.get('uTime'), p.time)
    gl.uniform2f(u.get('uOrigin'), p.originX, p.originY)
    gl.uniform1f(u.get('uClouds'), p.clouds)
    this.fullscreen()
    gl.enable(gl.BLEND)
  }

  /** A tileable value-noise texture for fog, from a fixed seed. */
  private buildNoise(): WebGLTexture {
    const N = 128
    const rng = new Rng(0x0f09_5eed)
    const data = new Uint8Array(N * N * 4)
    const acc = new Float32Array(N * N)
    let amp = 1
    let total = 0
    for (let cell = 8; cell <= 64; cell *= 2) {
      const g = N / cell
      const lattice = new Float32Array(cell * cell)
      for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next()
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const fx = x / g
          const fy = y / g
          const x0 = Math.floor(fx) % cell
          const y0 = Math.floor(fy) % cell
          const x1 = (x0 + 1) % cell
          const y1 = (y0 + 1) % cell
          let tx = fx - Math.floor(fx)
          let ty = fy - Math.floor(fy)
          tx = tx * tx * (3 - 2 * tx)
          ty = ty * ty * (3 - 2 * ty)
          const a = lattice[y0 * cell + x0] + (lattice[y0 * cell + x1] - lattice[y0 * cell + x0]) * tx
          const b = lattice[y1 * cell + x0] + (lattice[y1 * cell + x1] - lattice[y1 * cell + x0]) * tx
          acc[y * N + x] += (a + (b - a) * ty) * amp
        }
      }
      total += amp
      amp *= 0.5
    }
    for (let i = 0; i < N * N; i++) {
      const v = Math.round((acc[i] / total) * 255)
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('noise texture allocation failed')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    return tex
  }

  /**
   * Render the damage-number glyphs into a texture with the game's pixel font.
   *
   * Drawn at the font's native size and thresholded, so the glyphs are
   * hard-edged pixel art like everything else. The sprite shader's outline
   * gives them their dark border, so the texture is white only.
   */
  private buildGlyphs(): WebGLTexture {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('glyph canvas unavailable')
    const rows: [Map<string, Glyph>, string, number, number][] = [
      [this.glyphs, '8px Silkscreen, monospace', 10, 2],
      [this.glyphsBig, '16px Silkscreen, monospace', 20, 16],
    ]
    g.fillStyle = '#fff'
    g.textBaseline = 'top'
    for (const [map, font, height, top] of rows) {
      g.font = font
      let x = 2
      for (const ch of GLYPH_CHARS) {
        const w = Math.max(1, Math.ceil(g.measureText(ch).width))
        g.fillText(ch, x, top)
        map.set(ch, { x, y: top, w, h: height })
        x += w + 3
      }
    }
    const img = g.getImageData(0, 0, c.width, c.height)
    const d = img.data
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0
    g.putImageData(img, 0, 0)

    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('glyph texture allocation failed')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return tex
  }

  /** Rebuild the glyphs once the pixel font has actually loaded. */
  private async refreshGlyphs(): Promise<void> {
    try {
      await document.fonts.load('8px Silkscreen')
      await document.fonts.load('16px Silkscreen')
    } catch { return }
    const old = this.glyphTex
    this.glyphTex = this.buildGlyphs()
    this.gl.deleteTexture(old)
  }
}
