/**
 * The ground, drawn per pixel instead of baked from tiles.
 *
 * The v1 ground was Wang autotiles on a 32 px grid, and every edge between two
 * terrains came out as a staircase: the geometry was the grid, so no amount of
 * tile detail could fix it. This pass draws each art pixel from a handful of
 * seamless base textures (the pure tiles of the Wang sets already packed),
 * choosing between them with masks that are smooth at map scale and ragged at
 * pixel scale:
 *
 *  - a LAYOUT texture baked per map at quarter resolution says where the paths,
 *    tilled field, yard and water are (see `render/place.ts`);
 *  - value noise at three scales perturbs every threshold, so an edge wanders
 *    like a trodden path instead of following a spline;
 *  - where two terrains meet, the lower one gets a one-pixel dark rim, which is
 *    what makes a pixel-art path look cut into the grass rather than painted on.
 *
 * Blight creeps in from the fences as the day goes: withered grass, then rot,
 * then ash, each on its own threshold of the same field so the bands stay in
 * order. Tufts, flowers and pebbles are stamped from tiny bitmaps in the shader
 * on a hashed grid, so they cost nothing and never repeat on a 32 px period.
 */
import { compile, Uniforms, type GL } from './glutil'

/** Texture slots, in the order the shader indexes them. */
export const GROUND_SLOTS = [
  'grassA', 'grassB', 'grassC', 'dirt', 'tilled', 'yard', 'water', 'withered', 'rot', 'ash',
] as const
export type GroundSlot = typeof GROUND_SLOTS[number]

const VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 aCorner;
uniform vec4 uRect;
uniform vec2 uView;
uniform vec2 uTarget;
out vec2 vWorld;
void main() {
  vec2 world = uRect.xy + aCorner * uRect.zw;
  vWorld = world;
  vec2 p = (world - uView) / uTarget * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
in vec2 vWorld;
uniform sampler2DArray uAtlas;
uniform sampler2D uLayout;     // r path, g tilled, b water, a yard
uniform sampler2D uNoise;
uniform vec4 uTiles[10];        // atlas x, y, page, size
uniform vec4 uLayoutRect;       // world x, y, w, h the layout covers
uniform vec2 uArena;            // arena w, h
uniform float uBlight;          // 0 healthy .. 1 fully turned
uniform float uTime;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;

float n(vec2 p, float scale) { return texture(uNoise, p / scale).r; }

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

vec4 tile(int i, ivec2 p) {
  vec4 t = uTiles[i];
  int size = int(t.w);
  ivec2 local = ivec2(((p.x % size) + size) % size, ((p.y % size) + size) % size);
  return texelFetch(uAtlas, ivec3(ivec2(t.xy) + local, int(t.z + 0.5)), 0);
}

// Terrain id at a pixel: 0 grass, 1 dirt path, 2 tilled, 3 yard, 4 water.
int terrainAt(vec2 w, out float grassPick) {
  vec2 luv = (w - uLayoutRect.xy) / uLayoutRect.zw;
  vec4 L = texture(uLayout, luv);
  float big = n(w, 520.0);
  float mid = n(w, 140.0);
  float fine = n(w, 23.0);
  float grain = hash(floor(w));
  grassPick = big * 0.75 + mid * 0.25;
  float jitter = (mid - 0.5) * 0.22 + (fine - 0.5) * 0.16 + (grain - 0.5) * 0.07;
  if (L.b + jitter * 0.6 > 0.5) return 4;
  if (L.a + jitter > 0.5) return 3;
  if (L.g + ((mid - 0.5) * 0.22 + (fine - 0.5) * 0.08) * 0.7 > 0.5) return 2;
  // Worn patches in open field too, not only where the layout draws a path.
  float wear = L.r + max(0.0, mid - 0.74) * 2.2;
  if (wear + jitter > 0.5) return 1;
  return 0;
}

float blightAt(vec2 w) {
  // Distance in from the nearest fence, 0 at the fence, 1 at the middle.
  vec2 d = min(w, uArena - w) / (uArena * 0.5);
  float edge = clamp(min(d.x, d.y), 0.0, 1.0);
  float field = n(w, 380.0) * 0.55 + n(w, 90.0) * 0.3 + edge * 0.55;
  return uBlight * 1.02 - field + (hash(floor(w)) - 0.5) * 0.05;
}

// A 5x5 stamp, packed as 25 bits in an int, row-major from the top.
bool stamp(int bits, ivec2 q) {
  if (q.x < 0 || q.y < 0 || q.x > 4 || q.y > 4) return false;
  return ((bits >> (q.y * 5 + q.x)) & 1) == 1;
}

void main() {
  vec2 w = floor(vWorld) + 0.5;
  ivec2 p = ivec2(floor(vWorld));
  float gp;
  int t = terrainAt(w, gp);
  vec4 c;
  if (t == 4) {
    // Still, murky farm-pond water in three bands, drifting. It sours green
    // as the blight comes in.
    float r1 = n(w + vec2(uTime * 5.0, uTime * 1.3), 46.0);
    float r2 = n(w - vec2(uTime * 2.0, uTime * 3.5), 15.0);
    float v = r1 * 0.62 + r2 * 0.38 + (hash(floor(w)) - 0.5) * 0.04;
    vec3 deep = vec3(0.10, 0.16, 0.17);
    vec3 mid = vec3(0.15, 0.24, 0.24);
    vec3 hi = vec3(0.34, 0.44, 0.40);
    c = vec4(v > 0.64 ? hi : (v > 0.5 ? mid : deep), 1.0);
    c.rgb = mix(c.rgb, c.rgb * vec3(1.15, 1.35, 0.55), clamp(uBlight, 0.0, 1.0) * 0.6);
  } else if (t == 3) {
    c = tile(5, p);
  } else if (t == 2) {
    c = tile(4, p);
  } else if (t == 1) {
    c = tile(3, p);
  } else {
    float d = (hash(floor(w / 2.0)) - 0.5) * 0.08;
    c = gp + d > 0.64 ? tile(1, p) : (gp + d < 0.3 ? tile(2, p) : tile(0, p));
  }

  // Blight turns grass and paths alike, in bands that never reorder.
  float b = blightAt(w);
  if (t <= 1 && b > 0.0) {
    c = b > 0.5 ? tile(9, p) : (b > 0.24 ? tile(8, p) : tile(7, p));
  }

  // Rims: a lower terrain touching grass gets a dark edge, like a cut bank.
  if (t != 0) {
    float g2;
    int up = terrainAt(w + vec2(0.0, -1.0), g2);
    int lf = terrainAt(w + vec2(-1.0, 0.0), g2);
    int rt = terrainAt(w + vec2(1.0, 0.0), g2);
    int dn = terrainAt(w + vec2(0.0, 1.0), g2);
    if (up == 0 || up < t && t != 3) c.rgb *= 0.62;
    else if (lf == 0 || rt == 0) c.rgb *= 0.74;
    else if (dn == 0) c.rgb *= 0.86;
  }

  // Tufts, flowers and pebbles on a hashed 14 px grid.
  if (t == 0 && b <= 0.0) {
    vec2 cell = floor(w / 14.0);
    float h = hash(cell * 1.7 + 3.1);
    if (h < 0.34) {
      ivec2 origin = ivec2(cell * 14.0) + ivec2(int(hash(cell + 7.0) * 9.0), int(hash(cell + 11.0) * 9.0));
      ivec2 q = p - origin;
      float kind = hash(cell + 19.0);
      if (kind < 0.55) {
        // grass tuft: dark blades with a light tip
        int shape = kind < 0.3 ? 0x73880 : 0x23940;
        if (stamp(shape, q)) c.rgb *= 0.66;
        else if (stamp(0x224, q)) c.rgb = mix(c.rgb, vec3(0.78, 0.86, 0.42), 0.6);
      } else if (kind < 0.8) {
        // a small flower
        vec3 petal = kind < 0.64 ? vec3(0.95, 0.93, 0.82) : (kind < 0.72 ? vec3(0.96, 0.8, 0.3) : vec3(0.72, 0.56, 0.86));
        if (stamp(0x23880, q)) c.rgb = petal;
        if (q == ivec2(2, 2)) c.rgb = vec3(0.9, 0.65, 0.2);
      } else if (kind < 0.9) {
        // pebble
        if (stamp(0x73000, q)) c.rgb = mix(c.rgb, vec3(0.62, 0.6, 0.55), 0.8);
        if (q == ivec2(2, 4) || q == ivec2(3, 4)) c.rgb *= 0.72;
      }
    }
  }

  // Broad, stepped variation so the field is not one flat colour.
  float v = n(w, 700.0) * 0.6 + n(w, 210.0) * 0.4;
  float bayer = hash(floor(w)) * 0.12;
  v = floor((v + bayer) * 4.0) / 4.0;
  c.rgb *= 0.9 + v * 0.18;

  oColor = vec4(c.rgb, 1.0);
  oEmissive = vec4(0.0);
}`

export class GroundPass {
  private readonly prog: WebGLProgram
  private readonly u: Uniforms
  private readonly vao: WebGLVertexArrayObject
  private layoutTex: WebGLTexture | null = null

  constructor(private readonly gl: GL) {
    this.prog = compile(gl, VS, FS, 'ground')
    this.u = new Uniforms(gl, this.prog)
    const vao = gl.createVertexArray()
    const buf = gl.createBuffer()
    if (!vao || !buf) throw new Error('GroundPass: allocation failed')
    this.vao = vao
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  /** Upload a map's layout mask: RGBA bytes = path, tilled, water, yard. */
  setLayout(data: Uint8Array, w: number, h: number): void {
    const gl = this.gl
    if (!this.layoutTex) this.layoutTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.layoutTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * Draw the ground over the visible rect. `tiles` is 10 x (atlas x, y, page,
   * size); the atlas must be bound on unit 0 as the sprite batch expects.
   */
  draw(
    atlasTex: WebGLTexture | null, noiseTex: WebGLTexture, tiles: Float32Array,
    layoutX: number, layoutY: number, layoutW: number, layoutH: number,
    arenaW: number, arenaH: number, blight: number, time: number,
    viewX: number, viewY: number, targetW: number, targetH: number,
  ): void {
    if (!this.layoutTex || !atlasTex) return
    const gl = this.gl
    gl.useProgram(this.prog)
    const u = this.u
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTex)
    gl.uniform1i(u.get('uAtlas'), 0)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.layoutTex)
    gl.uniform1i(u.get('uLayout'), 2)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, noiseTex)
    gl.uniform1i(u.get('uNoise'), 3)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform4fv(u.get('uTiles'), tiles)
    gl.uniform4f(u.get('uLayoutRect'), layoutX, layoutY, layoutW, layoutH)
    gl.uniform2f(u.get('uArena'), arenaW, arenaH)
    gl.uniform1f(u.get('uBlight'), blight)
    gl.uniform1f(u.get('uTime'), time)
    gl.uniform4f(u.get('uRect'), viewX, viewY, targetW, targetH)
    gl.uniform2f(u.get('uView'), viewX, viewY)
    gl.uniform2f(u.get('uTarget'), targetW, targetH)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }
}
