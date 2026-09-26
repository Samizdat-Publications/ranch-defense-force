/**
 * Ground hazards as puddles and clouds, drawn per pixel.
 *
 * v1 drew every hazard as a flat translucent disc with a stroked rim, and a
 * slop puddle 350 px across read as a brown stain over the fight. Here each
 * hazard is a quad whose fragment decides, per art pixel, whether it is inside
 * a noise-ragged edge, and what it looks like by kind:
 *
 *   slow    tar/slop: dark and glossy, opaque enough to read as a surface
 *   lure    scattered grain: a sparse speckle, never a filled shape
 *   gas     a sickly cloud that drifts inside its own edge
 *   acid    a bright puddle with bubbles
 *   damage  embers: dark scorch with flickering orange pixels
 *
 * The rim still carries the warning. Harmful kinds get a brighter rim that
 * pulses, and they write emissive so they glow after dark.
 */
import { compile, Uniforms, type GL } from './glutil'

const STRIDE = 8

export const HAZARD_KIND: Record<string, number> = { slow: 0, lure: 1, gas: 2, acid: 3, damage: 4 }

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPos;     // x, y, radius, kind
layout(location=2) in vec4 iFx;      // fade, seed, -, -
uniform vec2 uView;
uniform vec2 uTarget;
out vec2 vWorld;
flat out vec4 vPos;
flat out vec4 vFx;
void main() {
  vec2 world = iPos.xy + (aCorner * 2.0 - 1.0) * (iPos.z + 3.0);
  vWorld = world;
  vPos = iPos;
  vFx = iFx;
  vec2 p = (world - uView) / uTarget * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
flat in vec4 vPos;
flat in vec4 vFx;
uniform sampler2D uNoise;
uniform float uTime;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 w = floor(vWorld) + 0.5;
  vec2 q = w - vPos.xy;
  float r = max(4.0, vPos.z);
  int kind = int(vPos.w + 0.5);
  float seed = vFx.y;
  // A slow wobble, not a fast one: at /26 the edge of a big pool was a
  // saw-tooth of single pixels and read as a rendering fault.
  float wob = texture(uNoise, (w + seed * 97.0) / 64.0).r;
  float edge = r * (0.94 + 0.06 * (wob - 0.5) * 2.0);
  float d = length(q);
  if (d > edge) discard;
  float fade = vFx.x;
  bool rim = d > edge - 1.5;
  float pulse = 0.8 + 0.2 * sin(uTime * 2.6 + vPos.x * 0.05);
  vec4 c;
  float glow = 0.0;
  float g = hash(w + seed);

  if (kind == 0) {
    // Tar: near-black and glossy, a lit lip along the top edge, slow sheen.
    // The old translucent brown read as a shadow with no caster.
    float sheen = texture(uNoise, (w + vec2(uTime * 2.0, 0.0)) / 18.0).r;
    bool lip = d > edge - 2.5;
    c = vec4(0.09, 0.07, 0.05, 0.36);
    if (sheen > 0.7) c = vec4(0.3, 0.27, 0.23, 0.5);
    if (lip && q.y < -r * 0.2) c = vec4(0.44, 0.38, 0.3, 0.7);
  } else if (kind == 1) {
    if (g > 0.18 && !rim) discard;
    c = rim ? vec4(0.92, 0.78, 0.42, 0.55) : vec4(0.86, 0.7, 0.36, 0.9);
  } else if (kind == 2) {
    float swirl = texture(uNoise, (w + vec2(uTime * 5.0, uTime * 3.0)) / 34.0).r
                * 0.6 + texture(uNoise, (w - vec2(uTime * 4.0, 0.0)) / 13.0).r * 0.4;
    float band = floor(swirl * 4.0) / 4.0;
    // Murk, not neon: a gas you can see the ground through, with a rim that
    // says where it stops. Round 2 found the old one the brightest thing on screen.
    c = vec4(mix(vec3(0.42, 0.46, 0.2), vec3(0.66, 0.7, 0.36), band), 0.12 + band * 0.16);
    if (rim) c = vec4(0.72, 0.78, 0.42, 0.55 * pulse);
    glow = 0.02;
  } else if (kind == 3) {
    c = vec4(0.28, 0.5, 0.13, 0.44);
    float bub = hash(floor(w / 3.0) + floor(uTime * 3.0) * 7.0 + seed);
    if (bub > 0.95) c = vec4(0.6, 0.84, 0.34, 0.7);
    if (rim) c = vec4(0.5, 0.76, 0.28, 0.75 * pulse);
    glow = 0.12;
  } else {
    c = vec4(0.12, 0.07, 0.05, 0.55);
    float ember = hash(w + floor(uTime * 8.0) * 3.1 + seed);
    if (ember > 0.9) { c = vec4(1.0, 0.55, 0.15, 0.95); glow = 1.0; }
    else if (ember > 0.8) { c = vec4(0.8, 0.28, 0.08, 0.85); glow = 0.6; }
    if (rim) { c = vec4(1.0, 0.62, 0.25, 0.85 * pulse); glow = 0.8; }
  }
  c.a *= fade;
  oColor = vec4(c.rgb * c.a, c.a);
  oEmissive = vec4(c.rgb * c.a * glow, c.a * glow);
}`

export class HazardBatch {
  private readonly prog: WebGLProgram
  private readonly u: Uniforms
  private readonly vao: WebGLVertexArrayObject
  private readonly buf: WebGLBuffer
  private data: Float32Array
  private capacity: number
  count = 0

  constructor(private readonly gl: GL, initial = 256) {
    this.prog = compile(gl, VS, FS, 'hazards')
    this.u = new Uniforms(gl, this.prog)
    this.capacity = initial
    this.data = new Float32Array(initial * STRIDE)
    const vao = gl.createVertexArray()
    const quad = gl.createBuffer()
    const buf = gl.createBuffer()
    if (!vao || !quad || !buf) throw new Error('HazardBatch: allocation failed')
    this.vao = vao
    this.buf = buf
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    for (let a = 0; a < 2; a++) {
      gl.enableVertexAttribArray(a + 1)
      gl.vertexAttribPointer(a + 1, 4, gl.FLOAT, false, STRIDE * 4, a * 16)
      gl.vertexAttribDivisor(a + 1, 1)
    }
    gl.bindVertexArray(null)
  }

  push(x: number, y: number, radius: number, kind: number, fade: number, seed: number): void {
    if (this.count >= this.capacity) {
      this.capacity *= 2
      const next = new Float32Array(this.capacity * STRIDE)
      next.set(this.data)
      this.data = next
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buf)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.data.byteLength, this.gl.DYNAMIC_DRAW)
    }
    const d = this.data
    let i = this.count * STRIDE
    d[i++] = x; d[i++] = y; d[i++] = radius; d[i++] = kind
    d[i++] = fade; d[i++] = seed; d[i++] = 0; d[i] = 0
    this.count++
  }

  flush(noise: WebGLTexture, time: number, viewX: number, viewY: number, targetW: number, targetH: number): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.uniform2f(this.u.get('uView'), viewX, viewY)
    gl.uniform2f(this.u.get('uTarget'), targetW, targetH)
    gl.uniform1f(this.u.get('uTime'), time)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, noise)
    gl.uniform1i(this.u.get('uNoise'), 3)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.bindVertexArray(null)
    this.count = 0
  }
}
