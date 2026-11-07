// GLSL ES 3.00. The height map is baked once by CultMath's Phacelle noise (vendored, unedited, MPL-2.0: Rune
// Skovbo Johansen's Phacelle noise, https://blog.runevision.com/2026/01/) composed into a slope-directed gully
// filter after the description in his March 2026 erosion-filter post. The composition is ours, written from
// that description; it is not his filter and has not been compared against it (see harness terrainDemo.ts on
// the terrain-tier-spike branch, from which this is promoted). The height is packed in two bytes of an RGBA8
// target, so no float colour-buffer extension is needed.
import cultmath from '../shaders/CultMath.glsl?raw';
import phacelle from '../shaders/CultMath.Phacelle.glsl?raw';
import { trimGlsl } from '../cultmathTrim';
import { ALBEDO } from './terrainAlbedo';
import { TERRAIN } from './terrainWorld';

const HEADER =
  '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
const f1 = (x: number) => x.toFixed(1);
const lit = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const FULLSCREEN_VERT = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEIGHT_STAGE = `
uniform float uSpan;
uniform vec2 uSeed;
uniform float uTexels;
out vec4 o;

const float BASE_AMP = 60.0;
const float BASE_FREQ = 1.0 / 520.0;
const float BASE_LIFT = 110.0;
const float CELL0 = 160.0;
const float SIDE_LEN = 3.0;
const float NORM = 0.5;
const float SLOPE_REF = 0.55;
const float DETAIL = 1.5;
const float AMP0 = 11.0;
const float HLO = 20.0, HHI = 200.0;

float easeOut(float t) { t = clamp(t, 0.0, 1.0); return 1.0 - (1.0 - t) * (1.0 - t); }
float powInv(float t, float p) { return 1.0 - pow(1.0 - t, p); }

float height(vec2 xz) {
  vec4 fg = cultmath_fbm_grad(vec3(xz * BASE_FREQ, 0.0), 4, 2.0, 0.45);
  float h = BASE_LIFT + BASE_AMP * fg.w;
  vec2 g = BASE_AMP * BASE_FREQ * fg.xy;
  float target = clamp((h - HLO) / (HHI - HLO) * 2.0 - 1.0, -1.0, 1.0);
  float combi = 1.0;
  float amp = AMP0;
  float cell = CELL0;
  for (int i = 0; i < OCTAVES; i++) {
    float slope = length(g);
    vec2 downhill = slope > 1e-4 ? -g / slope : vec2(1.0, 0.0);
    vec2 across = vec2(-downhill.y, downhill.x);
    CultPhasor ph = cultmath_phacelle(vec3(xz / cell, 0.5), vec3(across * SIDE_LEN, 0.0), 0.0, NORM);
    float mask = easeOut(slope / SLOPE_REF) * combi;
    float faded = mix(target, ph.cos.w, mask);
    h += amp * faded;
    g += amp * mask * ph.cos.xy / cell;
    combi = powInv(combi, DETAIL) * (1.0 - abs(ph.sin.w));
    target = faded;
    amp *= 0.5;
    cell *= 0.5;
  }
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(uTexels);
  float h = clamp(height((uv - 0.5) * uSpan + uSeed) / ${f1(TERRAIN.hmax)}, 0.0, 1.0);
  float q = floor(h * 65535.0 + 0.5);
  o = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, 0.0, 1.0);
}`;

/** The height-bake fragment shader: header, the part of CultMath that Phacelle and the stage reach, Phacelle, the stage. */
export function heightFragmentSource(): string {
  const math = trimGlsl(cultmath, [phacelle, HEIGHT_STAGE]);
  return `${HEADER}#define OCTAVES 4\n${math}\n${phacelle}\n${HEIGHT_STAGE}`;
}

const FETCH = `
uniform sampler2D uHeight;
uniform int uTex;
float hAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(uTex - 1));
  vec4 s = texelFetch(uHeight, t, 0);
  return (floor(s.r * 255.0 + 0.5) * 256.0 + floor(s.g * 255.0 + 0.5)) / 65535.0 * ${f1(
    TERRAIN.hmax
  )};
}`;

export const GRID_VERT = `${HEADER}
layout(location = 0) in vec2 a_uv;
uniform mat4 uViewProj;
uniform float uSpan;
out vec2 v_uv;
out vec3 v_world;
${FETCH}
void main() {
  ivec2 t = ivec2(a_uv * float(uTex - 1) + 0.5);
  // The patch's rim sinks to zero so the grid has no cliff edge to show through the haze.
  float rim = 1.0 - smoothstep(0.78, 1.0, 2.0 * max(abs(a_uv.x - 0.5), abs(a_uv.y - 0.5)));
  float h = hAt(t) * rim;
  v_uv = a_uv;
  v_world = vec3((a_uv.x - 0.5) * uSpan, h, (a_uv.y - 0.5) * uSpan);
  gl_Position = uViewProj * vec4(v_world, 1.0);
}`;

// Lit by the baked sky: uSun (direction), uSunColour (linear, zero when the sun is down), uAmbient, uHaze (linear).
// The same arithmetic as terrainSky.shade(); the normal comes from the height map so shading carries detail finer than the mesh.
const ALBEDO_DEFINES = `
#define ALB_SCREE_FROM ${lit(ALBEDO.screeFrom)}
#define ALB_SCREE_TO ${lit(ALBEDO.screeTo)}
#define ALB_SNOW_BAND ${lit(ALBEDO.snowBand)}
#define ALB_ROCK_HI ${lit(ALBEDO.rockHi)}
#define ALB_ROCK_LO ${lit(ALBEDO.rockLo)}
#define ALB_SNOW_HI ${lit(ALBEDO.snowHi)}
#define ALB_SNOW_LO ${lit(ALBEDO.snowLo)}
#define ALB_WOBBLE_H ${lit(ALBEDO.wobbleHeight)}
#define ALB_WOBBLE_S ${lit(ALBEDO.wobbleSlope)}
`;
export const GRID_FRAG = `${HEADER}${ALBEDO_DEFINES}
in vec2 v_uv;
in vec3 v_world;
uniform vec3 uCamera, uSun, uSunColour, uAmbient, uHaze, uSoil, uScree, uRock, uSnow;
uniform float uSpan, uHazeK, uSnowLine;
out vec4 o;
${FETCH}
// Unnormalised normal at one texel, central differences over its neighbours.
vec3 nAt(ivec2 t, float texel) {
  float dx = hAt(t + ivec2(1, 0)) - hAt(t - ivec2(1, 0));
  float dz = hAt(t + ivec2(0, 1)) - hAt(t - ivec2(0, 1));
  return normalize(vec3(-dx, 2.0 * texel, -dz));
}
void main() {
  // The four texels around this fragment, blended, so the shading is continuous and not one flat square per texel.
  vec2 p = v_uv * float(uTex - 1);
  ivec2 t = ivec2(floor(p));
  vec2 f = fract(p);
  float texel = uSpan / float(uTex - 1);
  vec3 n = normalize(mix(
    mix(nAt(t, texel), nAt(t + ivec2(1, 0), texel), f.x),
    mix(nAt(t + ivec2(0, 1), texel), nAt(t + ivec2(1, 1), texel), f.x), f.y));
  // Procedural albedo, no texture reads; the same arithmetic as terrainAlbedo.albedoAt().
  float w = sin(v_world.x * 0.043 + v_world.z * 0.017) * sin(v_world.z * 0.051 - v_world.x * 0.023);
  float h = v_world.y + ALB_WOBBLE_H * w;
  float flat_ = n.y + ALB_WOBBLE_S * w;
  vec3 ground = mix(uSoil, uScree, smoothstep(ALB_SCREE_FROM, ALB_SCREE_TO, h));
  float snow = smoothstep(uSnowLine - ALB_SNOW_BAND, uSnowLine + ALB_SNOW_BAND, h) * smoothstep(ALB_SNOW_LO, ALB_SNOW_HI, flat_);
  float rockW = 1.0 - smoothstep(ALB_ROCK_LO, ALB_ROCK_HI, flat_);
  vec3 albedo = mix(mix(ground, uSnow, snow), uRock, rockW);
  vec3 lit = albedo * (uSunColour * max(dot(n, uSun), 0.0) + uAmbient * (0.5 + 0.5 * n.y));
  float T = exp(-uHazeK * length(v_world - uCamera));
  o = vec4(pow(mix(uHaze, lit, T), vec3(1.0 / 2.2)), 1.0);
}`;

// The sky behind: the gradient's seven stops, zenith first, by the view ray's elevation (horizon stop at and below the horizon).
export const SKY_FRAG = `${HEADER}
uniform vec3 uGrad[7];
uniform vec3 uRight, uUp, uForward;
uniform vec2 uSize;
uniform float uTanHalf;
out vec4 o;
void main() {
  vec2 ndc = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(uForward + ndc.x * uTanHalf * uSize.x / uSize.y * uRight + ndc.y * uTanHalf * uUp);
  float s = (1.0 - sqrt(smoothstep(-0.15, 1.0, d.y))) * 6.0;
  int i = int(min(floor(s), 5.0));
  vec3 c = mix(uGrad[i], uGrad[i + 1], s - float(i));
  o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;
