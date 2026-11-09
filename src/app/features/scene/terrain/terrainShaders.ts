// GLSL ES 3.00. The height map is baked once by CultMath's Phacelle noise (vendored, unedited, MPL-2.0: Rune
// Skovbo Johansen's Phacelle noise, https://blog.runevision.com/2026/01/) composed into a slope-directed gully
// filter after the description in his March 2026 erosion-filter post. The composition is ours, written from
// that description; it is not his filter and has not been compared against it (see harness terrainDemo.ts on
// the terrain-tier-spike branch, from which this is promoted). The height is packed in two bytes of an RGBA8
// target, so no float colour-buffer extension is needed.
import cultmath from '../shaders/CultMath.glsl?raw';
import phacelle from '../shaders/CultMath.Phacelle.glsl?raw';
import { trimGlsl } from '../cultmathTrim';
import { ALBEDO, CAVITY } from './terrainAlbedo';
import { AERIAL_GLSL, AP_DISTANCE_SCALE, SCATTER_GLSL } from './terrainScatter';
import { GLOW_ZENITH, MOON_HAZE, SKY_EXPOSURE, SKY_FADE, STAR_FLOOR } from './terrainSky';
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
}
// The height at a point in texel units, bilinear over the four texels around it (the packed texture cannot be filtered by the GPU).
float hBil(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  return mix(mix(hAt(i), hAt(i + ivec2(1, 0)), f.x), mix(hAt(i + ivec2(0, 1)), hAt(i + ivec2(1, 1)), f.x), f.y);
}`;

export const GRID_VERT = `${HEADER}
layout(location = 0) in vec2 a_uv;
uniform mat4 uViewProj;
uniform float uSpan;
out vec2 v_uv;
out vec3 v_world;
${FETCH}
void main() {
  // The grid is packed toward the centre, where the camera stands (terrainWorld.warpUv): s = 2u - 1, 0.5 + 0.5 (0.5 s + 0.5 s |s|).
  vec2 s = a_uv * 2.0 - 1.0;
  vec2 uv = 0.5 + 0.5 * (0.5 * s + 0.5 * s * abs(s));
  // The patch's rim sinks to zero so the grid has no cliff edge to show through the haze.
  float rim = 1.0 - smoothstep(0.78, 1.0, 2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
  float h = hBil(uv * float(uTex - 1)) * rim;
  v_uv = uv;
  v_world = vec3((uv.x - 0.5) * uSpan, h, (uv.y - 0.5) * uSpan);
  gl_Position = uViewProj * vec4(v_world, 1.0);
}`;

// Lit by the baked sky: uSun (direction), uSunColour (linear, zero when the sun is down), uAmbient; hazed toward the
// scattered sky at the horizon in the ray's azimuth (SKY_COLOUR_GLSL).
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
#define ALB_GRAIN_COARSE ${lit(ALBEDO.grainCoarse)}
#define ALB_GRAIN_FINE ${lit(ALBEDO.grainFine)}
#define ALB_STRATA ${lit(ALBEDO.strata)}
#define ALB_FINE_NEAR ${lit(ALBEDO.fineNear)}
#define ALB_FINE_FAR ${lit(ALBEDO.fineFar)}
#define CAV_RADIUS ${lit(CAVITY.radius)}
#define CAV_RANGE ${lit(CAVITY.range)}
#define CAV_DARK ${lit(CAVITY.dark)}
#define CAV_LIGHT ${lit(CAVITY.light)}
`;
// The sky colour along a unit direction: scattering lifted by the exposure, tone-mapped, plus the night glow. The
// same arithmetic as terrainSky.skyColour(). uGlow is the baked horizon colour already scaled by how dark the sun is.
const SKY_COLOUR_GLSL = `${SCATTER_GLSL}
uniform vec3 uGlow;
vec3 skyColour(vec3 d) {
  return 1.0 - exp(-${lit(SKY_EXPOSURE)} * skyScatter(d)) + uGlow * mix(1.0, ${lit(
  GLOW_ZENITH
)}, sqrt(clamp(d.y, 0.0, 1.0)));
}`;

export const GRID_FRAG = `${HEADER}${ALBEDO_DEFINES}${SKY_COLOUR_GLSL}${AERIAL_GLSL}
in vec2 v_uv;
in vec3 v_world;
uniform vec3 uCamera, uLightDir, uLight, uAmbient, uSoil, uScree, uRock, uSnow;
uniform float uSpan, uSnowLine, uNight, uMoonIndex;
out vec4 o;
${FETCH}
// Triplanar patterns: each projection plane's value, blended by the weights of the face's normal (terrainAlbedo.triWeights).
float wob2(vec2 q) { return sin(q.x * 0.043 + q.y * 0.017) * sin(q.y * 0.051 - q.x * 0.023); }
float waves3(vec2 q, vec2 a, vec2 b, vec2 c) { return (sin(dot(q, a)) + sin(dot(q, b)) + sin(dot(q, c))) / 3.0; }
void main() {
  // Normal from the bilinear height at a continuous position, a stencil 1.5 texels each side: smooth across texel borders.
  vec2 p = v_uv * float(uTex - 1);
  float texel = uSpan / float(uTex - 1);
  float dx = hBil(p + vec2(1.5, 0.0)) - hBil(p - vec2(1.5, 0.0));
  float dz = hBil(p + vec2(0.0, 1.5)) - hBil(p - vec2(0.0, 1.5));
  vec3 n = normalize(vec3(-dx, 3.0 * texel, -dz));
  vec3 tw = pow(abs(n), vec3(4.0));
  tw /= tw.x + tw.y + tw.z;
  vec2 qx = v_world.zy, qy = v_world.xz, qz = v_world.xy;
  // Procedural albedo, no texture reads; the same arithmetic as terrainAlbedo.albedoAt().
  float w = tw.x * wob2(qx) + tw.y * wob2(qy) + tw.z * wob2(qz);
  float h = v_world.y + ALB_WOBBLE_H * w;
  float flat_ = n.y + ALB_WOBBLE_S * w;
  vec3 ground = mix(uSoil, uScree, smoothstep(ALB_SCREE_FROM, ALB_SCREE_TO, h));
  float snow = smoothstep(uSnowLine - ALB_SNOW_BAND, uSnowLine + ALB_SNOW_BAND, h) * smoothstep(ALB_SNOW_LO, ALB_SNOW_HI, flat_);
  float rockW = 1.0 - smoothstep(ALB_ROCK_LO, ALB_ROCK_HI, flat_);
  vec3 albedo = mix(mix(ground, uSnow, snow), uRock, rockW);
  // Surface grain and rock strata, the same arithmetic as terrainAlbedo.grainAt().
  float coarse = tw.x * waves3(qx, vec2(0.31, 0.27), vec2(-0.22, 0.35), vec2(0.38, -0.12)) + tw.y * waves3(qy, vec2(0.31, 0.27), vec2(-0.22, 0.35), vec2(0.38, -0.12)) + tw.z * waves3(qz, vec2(0.31, 0.27), vec2(-0.22, 0.35), vec2(0.38, -0.12));
  float fine = tw.x * waves3(qx, vec2(1.1, 0.7), vec2(-0.8, 1.2), vec2(1.3, -0.6)) + tw.y * waves3(qy, vec2(1.1, 0.7), vec2(-0.8, 1.2), vec2(1.3, -0.6)) + tw.z * waves3(qz, vec2(1.1, 0.7), vec2(-0.8, 1.2), vec2(1.3, -0.6));
  float near = 1.0 - smoothstep(ALB_FINE_NEAR, ALB_FINE_FAR, length(v_world - uCamera));
  float layers = sin(v_world.y * 0.9 + w * 3.0);
  albedo *= max(0.0, 1.0 + ALB_GRAIN_COARSE * coarse + ALB_GRAIN_FINE * near * fine + ALB_STRATA * rockW * layers);
  // Cavity: a point lower than its surroundings sits in shade, one higher catches light (terrainAlbedo.cavityAt). Shader-only, from the height map,
  // read bilinear at a continuous position so it does not snap to a texel (that made the shading blocks of one texel, 3 m).
  float cr = CAV_RADIUS / texel;
  float curv = 0.25 * (hBil(p + vec2(cr, 0.0)) + hBil(p - vec2(cr, 0.0)) + hBil(p + vec2(0.0, cr)) + hBil(p - vec2(0.0, cr))) - hBil(p);
  float cavity = 1.0 - CAV_DARK * clamp(curv / CAV_RANGE, 0.0, 1.0) + CAV_LIGHT * clamp(-curv / CAV_RANGE, 0.0, 1.0);
  vec3 lit = albedo * cavity * (uLight * max(dot(n, uLightDir), 0.0) + uAmbient * (0.5 + 0.5 * n.y));
  vec3 toSurface = v_world - uCamera;
  float dist = length(toSurface);
  // Aerial perspective (terrainSky.aerialPerspective): the baked volume by this ray's elevation, azimuth from the light and path.
  vec3 ray = toSurface / dist;
  float el = min(degrees(asin(clamp(ray.y, -1.0, 1.0))), 0.0);
  vec2 hz = ray.xz, sz = uSun.xz;
  float az = (length(hz) < 1e-4 || length(sz) < 1e-4) ? 0.0 : degrees(acos(clamp(dot(normalize(hz), normalize(sz)), -1.0, 1.0)));
  float km = dist * ${lit(AP_DISTANCE_SCALE / 1000)};
  vec4 ap = aerial(uSunIndex, el, az, km);
  vec3 L = ap.rgb;
  // The moon lights the haze from where the sun is mirrored above the horizon, sharing its azimuth; a starlight floor stays.
  if (uNight > 0.0) L += uNight * vec3(${MOON_HAZE.map(lit).join(
    ', '
  )}) * aerial(uMoonIndex, el, az, km).rgb;
  vec3 haze = 1.0 - exp(-${lit(SKY_EXPOSURE)} * L) + uNight * ap.a * vec3(${STAR_FLOOR.map(
  lit
).join(', ')});
  // Past SKY_FADE the surface is the sky at the horizon in this ray's azimuth, the colour the sky pass draws there (terrainSky.aerialPerspective).
  float toSky = smoothstep(${lit(SKY_FADE[0])}, ${lit(SKY_FADE[1])}, dist);
  vec3 horizon = skyColour(vec3(ray.x, 0.0, ray.z));
  o = vec4(pow(mix(lit * (1.0 - ap.a) + haze, horizon, toSky), vec3(1.0 / 2.2)), 1.0);
}`;

// The sky behind: the baked scattering tables by the view ray's elevation and azimuth from the sun, a sun disc, and a
// dither of +-0.5/255 on the 8-bit output so the dusk glow does not band.
const DISC = {
  inner: Math.cos((0.5 * Math.PI) / 180),
  outer: Math.cos((1.1 * Math.PI) / 180),
  gain: 6.0,
};
export const SKY_FRAG = `${HEADER}${SKY_COLOUR_GLSL}
uniform vec3 uSunColour;
uniform vec3 uRight, uUp, uForward;
uniform vec2 uSize;
uniform float uTanHalf;
out vec4 o;
void main() {
  vec2 ndc = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(uForward + ndc.x * uTanHalf * uSize.x / uSize.y * uRight + ndc.y * uTanHalf * uUp);
  vec3 c = skyColour(d) + uSunColour * ${lit(DISC.gain)} * smoothstep(${DISC.outer}, ${
  DISC.inner
}, dot(d, uSun));
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  o = vec4(pow(c, vec3(1.0 / 2.2)) + dither / 255.0, 1.0);
}`;
