// The one lighting pass of the ridge cards (ruling ridge-cards-runtime-lit): each baked G-buffer card (colour with straight alpha, geometry with the
// 'rt8' normal and log-distance, `scripts/ridge-bake/export.py`) is lit once, for the sky this scene build was made for, in one WebGL2 context on a
// canvas of its own, and copied into a 2D canvas of the card's size. After the last card the context is released: there is no per-frame WebGL, and the
// host canvas stays 2D (`Ridge.ts`). A sky change rebuilds the scene and lights again; nothing patches the lit canvases.
//
// Per pixel: the normal from the geometry card in the column's frame (r along the ray, t across it, up), the sun brought into that frame per column;
// radiance = albedo x (sun transmittance x max(n.s, 0) + ambient irradiance) / pi; aerial perspective L T(d) + Lsky (1 - T(d)) with d from the
// geometry's log-distance and the sky's own extinction at the ground; contours; then the sky's own display (exposure, ACES with `toneMap.ts`'s
// constants written into the shader, the sky's fitted curve, sRGB), so terrain and sky share one exposure. Wall pixels (R = G = 255 in the geometry file, a code
// no real normal reaches) are the extruded face under a ridge: they are lit with the face up and wear no crease ink.
import { extinctionAt } from './earthAtmosphere';
import type { Vec3 } from './earthAtmosphere';
import type { RidgeManifest } from './manifest';
import type { PhysicalSky } from './physicalSky';
import { addNightRadiance, airglow } from './nightSky';
import { ACES_FIT, ACES_IN, ACES_OUT, KNOTS, SCOTOPIC } from './toneMap';
import type { Curve } from './toneMap';
import type { View } from './view';

export interface CardBitmaps {
  colour: ImageBitmap;
  geometry: ImageBitmap;
}

/** A lit card: its pixels, premultiplied by the card's alpha, at the card's own size, and where the card sits in the plane. */
export interface LitCard {
  canvas: HTMLCanvasElement;
  top: number;
  h: number;
  scale: number;
}

/** A real normal has r2 + t2 at most 0.998 (probe on the Vienna bake); the wall code is 2. A code of the data, not of the look. */
export const WALL_RT2 = 1.02;
/** The lookup of the sky's radiance for the haze: azimuth columns by plane rows, filtered in the shader. */
export const SKY_LUT = { w: 64, h: 64 } as const;

/**
 * The look: every number of the art pass (ratatoskr:follow_up:ridge-art-quality-rework), the one owner of them. None is a rule of the machine.
 * The shader reads them as uniforms, so one compiled program serves every look.
 */
export interface RidgeLook {
  /** A neighbour farther by more than this many nats of distance draws occluding ink on this pixel. */
  occludeLogD: number;
  /** A normal turning past this cosine between two non-wall pixels draws crease ink. */
  creaseCos: number;
  /** How much each ink keeps of the radiance it falls on (1 = no ink). */
  inkKeep: { edge: number; occlude: number; crease: number };
  /** Below this sun elevation (degrees) no direct sun reaches the ground (the atmosphere's own cut-off, `earthAtmosphere.ts` irradiance). */
  sunCutoffDeg: number;
  /** Multiplies the optical depth of the aerial perspective: 1 is the sky's own extinction, 0 no haze. */
  hazeScale: number;
  /** Multiplies the ambient irradiance the terrain is lit by. */
  ambientScale: number;
  /** 0 = no normal shading (the flat card tone, as a horizontal surface), 1 = shaded by the normals. */
  reliefWeight: number;
  /** The relief light: `mix` 0 is the sun, 1 a fixed light; `azimuthDeg` is clockwise of the view ray (-45 = upper left, behind the ridge), `elevationDeg` above the horizon. */
  reliefLight: { mix: number; azimuthDeg: number; elevationDeg: number };
  /** Added to the sky radiance used for the haze, rgb in units of that radiance's own luminance (so it holds at every sky): positive blue = cool far. */
  hazeTint: readonly [number, number, number];
  /** Strength (0..1) of a warm tint on the near, fading out with the log-distance across the baked range. */
  nearWarm: number;
  /** The relief's contrast about the pixel's flat tone scales by exp(c (1 - 2 d)), d the log-distance across the baked range: c > 0 near contrasty, far flat. */
  contrastByDistance: number;
  /** Value of each card multiplies by 1 + step (index - centre); the nearest card is index 0, so a positive step makes near darkest. */
  cardToneStep: number;
  /** Value ramp inside each card: 1 + g (y - 1/2), y the fraction down the card; positive lightens toward the foot. */
  cardGradient: number;
  /** Multiplies each ink's darkening: 0 = no lines. */
  inkScale: number;
  /** Procedural albedo variation (a stand-in for land cover we do not bake): fbm in metres on the ground, so its screen frequency follows distance. 0 = none. */
  groundNoise: number;
  /** Low-frequency noise darkening of the direct sun (static). 0 = none. */
  cloudShadows: number;
  /** Cel shading: the lit side of the relief (n.s) in this many flat bands instead of Lambert's ramp (0 = Lambert; at most `CEL_MAX`). */
  celBands: number;
  /** Width of each band edge in n.s units (0 = hard). */
  celSoftness: number;
  /** The level of each band, 0..1, darkest first (default: evenly from 0 to 1). Length `celBands`. */
  celBandLevels?: readonly number[];
  /** The ambient is coarse too: surfaces facing the sky (the normal's up component past `celAmbientEdge`) keep it whole, the rest keep this fraction (1 = no step). */
  celAmbientAway: number;
  celAmbientEdge: number;
}

/** The first art pass's look: Lambert relief, no procedural variation, the sky's own haze, full ink. Kept for comparison in the look sheet. */
export const PHYSICAL_LOOK: RidgeLook = {
  occludeLogD: 0.35,
  creaseCos: 0.85,
  inkKeep: { edge: 0.45, occlude: 0.55, crease: 0.8 },
  sunCutoffDeg: -1,
  hazeScale: 1,
  ambientScale: 1,
  reliefWeight: 1,
  reliefLight: { mix: 0, azimuthDeg: -45, elevationDeg: 40 },
  hazeTint: [0, 0, 0],
  nearWarm: 0,
  contrastByDistance: 0,
  cardToneStep: 0,
  cardGradient: 0,
  inkScale: 1,
  groundNoise: 0,
  cloudShadows: 0,
  celBands: 0,
  celSoftness: 0,
  celAmbientAway: 1,
  celAmbientEdge: 0.7,
};

/** The default: painterly (ground variation, cloud shadows, warm near, moderate haze, light ink) with cel-shaded relief. */
export const DEFAULT_LOOK: RidgeLook = {
  ...PHYSICAL_LOOK,
  groundNoise: 0.35,
  cloudShadows: 0.5,
  nearWarm: 0.6,
  hazeScale: 2,
  inkScale: 0.4,
  celBands: 3,
  celSoftness: 0.05,
  celAmbientAway: 0.7,
};

/** Most bands the shader's uniform holds. */
export const CEL_MAX = 6;

/** The level of each of `bands` cel bands, darkest first: `custom` where given, else evenly 0..1 (one band is fully lit). Padded to `CEL_MAX`. */
export function celLevels(bands: number, custom?: readonly number[]): number[] {
  const n = Math.min(CEL_MAX, Math.max(1, Math.round(bands)));
  return Array.from({ length: CEL_MAX }, (_, i) => {
    const k = Math.min(i, n - 1);
    return custom?.[k] ?? (n === 1 ? 1 : k / (n - 1));
  });
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The cel ramp: the light of a surface whose normal makes `ndl` with the sun, in `bands` flat bands, edges at i / bands (i = 1..bands-1), each
 * edge `softness` wide. The lowest band holds the unlit side too (its level is what ambient light alone leaves). The shader writes the same.
 */
export function celShade(ndl: number, bands: number, softness: number, levels?: readonly number[]): number {
  const n = Math.min(CEL_MAX, Math.max(1, Math.round(bands)));
  const lv = celLevels(n, levels);
  let out = lv[0];
  for (let i = 1; i < n; i += 1) {
    const e = i / n;
    const w = softness / 2;
    out += (lv[i] - lv[i - 1]) * (w > 0 ? smooth(e - w, e + w, ndl) : ndl >= e ? 1 : 0);
  }
  return out;
}

const RAD = Math.PI / 180;

/** The sun in the frame of a column looking at azimuth `columnAzDeg`: along the ray, across it (clockwise, +90 degrees), up. Unit length. */
export function sunInColumn(
  sun: { azimuth: number; elevation: number },
  columnAzDeg: number
): [number, number, number] {
  const el = sun.elevation * RAD;
  const d = (sun.azimuth - columnAzDeg) * RAD;
  return [Math.cos(el) * Math.cos(d), Math.cos(el) * Math.sin(d), Math.sin(el)];
}

/** The azimuth of plane column `x` of `w` (the card is the whole baked window wide). */
export const columnAzimuth = (view: View, x: number, w: number): number =>
  view.lookAzDeg + ((x + 0.5) / w - 0.5) * view.windowDeg;

/** A geometry texel's red and green bytes as the shader reads them: a wall, or the unit normal (along the ray, across it, up). */
export function decodeNormal(
  r8: number,
  g8: number
): { wall: true } | { wall: false; n: [number, number, number] } {
  const r = (r8 / 255) * 2 - 1;
  const t = (g8 / 255) * 2 - 1;
  const rt2 = r * r + t * t;
  return rt2 > WALL_RT2
    ? { wall: true }
    : { wall: false, n: [r, t, Math.sqrt(Math.max(0, 1 - rt2))] };
}

/** Everything the lighting reads of the sky and the manifest, as the numbers the shader's uniforms hold. */
export interface Lighting {
  planeW: number;
  planeH: number;
  logDMin: number;
  logDSpan: number;
  /** Per km of horizontal path, per channel. */
  extinction: Vec3;
  /** Where the key light is (the sun by day and dusk, the moon at night) and what of it reaches the ground. */
  key: KeyLight;
  exposure: number;
  /** The sky's fitted curve (`toneMap.ts`), applied per channel after ACES. */
  curve: Curve;
  /** Weight of the scotopic grade (`toneMap.ts`), applied to the radiance before exposure. */
  grade: number;
}

/**
 * The key light of the ground and what it brings. Day and dusk: the sun, by its transmittance to the ground, cut off below `look.sunCutoffDeg`.
 * Night: the moon, by its transmittance times its irradiance relative to the sun's (phase and distance, `nightSky.ts`), faded out over the
 * horizon; it is the direction the cel bands are cut by, and what is left of it, the sun's twilight and the airglow, is the ambient.
 * `direct` is per unit of sun irradiance, `ambient` the irradiance the sky and the airglow give a horizontal surface.
 */
export interface KeyLight {
  azimuth: number;
  elevation: number;
  direct: Vec3;
  ambient: Vec3;
}

export function keyLight(sky: PhysicalSky, look: RidgeLook = DEFAULT_LOOK): KeyLight {
  const ambient = scale3(sky.atm.irradiance.ambient, look.ambientScale);
  const glow = [0, 0, 0];
  airglow(0.6, glow);
  const base = add3(ambient, scale3([glow[0], glow[1], glow[2]], Math.PI));
  const trans = [0, 0, 0];
  if (sky.state === 'night') {
    const m = sky.night.moon;
    if (!m) return { azimuth: sky.moon.azimuth, elevation: sky.moon.elevation, direct: [0, 0, 0], ambient: base };
    m.atm.transmittanceToSpace(Math.max(Math.sin(m.elevation * RAD), 0), trans);
    const fade = smooth(-0.5, 1.5, m.elevation) * m.ratio;
    return {
      azimuth: m.azimuth,
      elevation: m.elevation,
      direct: [trans[0] * fade, trans[1] * fade, trans[2] * fade],
      ambient: add3(base, scale3(scale3(m.atm.irradiance.ambient, look.ambientScale), m.ratio)),
    };
  }
  sky.atm.transmittanceToSpace(Math.max(Math.sin(sky.sun.elevation * RAD), 0), trans);
  const lit = sky.sun.elevation > look.sunCutoffDeg;
  return {
    azimuth: sky.sun.azimuth,
    elevation: sky.sun.elevation,
    direct: lit ? [trans[0], trans[1], trans[2]] : [0, 0, 0],
    ambient: base,
  };
}

const scale3 = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export function lightingOf(
  manifest: RidgeManifest,
  sky: PhysicalSky,
  look: RidgeLook = DEFAULT_LOOK
): Lighting {
  return {
    planeW: manifest.view.planeW,
    planeH: manifest.view.planeH,
    logDMin: manifest.encoding.logDMin,
    logDSpan: manifest.encoding.logDMax - manifest.encoding.logDMin,
    extinction: scale3(extinctionAt(sky.atm.observerKm, sky.atm.mieScale), look.hazeScale),
    key: keyLight(sky, look),
    exposure: sky.fit.display.exposure,
    curve: sky.fit.display.curve,
    grade: sky.fit.display.grade ?? 0,
  };
}

/** The sun in every column's frame, RGBA32F texels (a, b, c, 0), one row of `planeW`. */
export function sunColumns(view: View, sun: { azimuth: number; elevation: number }): Float32Array {
  const out = new Float32Array(view.planeW * 4);
  for (let x = 0; x < view.planeW; x += 1) {
    const [r, t, u] = sunInColumn(sun, columnAzimuth(view, x, view.planeW));
    out.set([r, t, u, 0], x * 4);
  }
  return out;
}

/**
 * The sky's radiance (per unit of sun irradiance) as the haze needs it: a small grid over the window's azimuths and the plane's rows, the view
 * direction of each texel's centre. Rows below the horizon take the horizon's radiance (the haze in front of a ridge is the air at its foot).
 */
export function skyLut(sky: PhysicalSky, view: View, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  const rgb = [0, 0, 0];
  for (let j = 0; j < h; j += 1) {
    const elDeg = Math.max(0, (view.horizonRow - ((j + 0.5) / h) * view.planeH) / view.pxPerDegV);
    for (let i = 0; i < w; i += 1) {
      const az = columnAzimuth(view, ((i + 0.5) / w) * view.planeW - 0.5, view.planeW);
      sky.atm.radiance(Math.sin(elDeg * RAD), Math.cos((az - sky.sun.azimuth) * RAD), rgb);
      addNightRadiance(sky.night, Math.sin(elDeg * RAD), az * RAD, rgb);
      out.set([rgb[0], rgb[1], rgb[2], 0], (j * w + i) * 4);
    }
  }
  return out;
}

const glsl = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));

/** The fragment shader. `ACES_IN` and `ACES_OUT` are written as rows and applied with `dot`, so no transposition is in play. */
export const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uColour;
uniform sampler2D uGeo;
uniform sampler2D uSun;
uniform sampler2D uSky;
uniform ivec2 uSize;
uniform ivec2 uSkySize;
uniform int uTop;
uniform vec2 uPlane;
uniform vec2 uLogD;
uniform vec3 uExt;
uniform vec3 uTSun;
uniform vec3 uAmbient;
uniform float uExposure;
uniform float uGrade;
uniform vec3 uScotTint;
uniform float uCx[${KNOTS}];
uniform float uCy[${KNOTS}];
uniform float uCm[${KNOTS}];
uniform vec2 uInkGeometry; // occludeLogD, creaseCos
uniform vec3 uInkKeep; // edge, occlude, crease
uniform float uInkScale;
uniform vec2 uRelief; // weight, mix toward the fixed light
uniform vec3 uFixedLight; // in the column frame
uniform vec3 uHazeTint;
uniform vec2 uDist; // nearWarm, contrastByDistance
uniform vec2 uCard; // value of this card, gradient
uniform vec2 uGround; // groundNoise, cloudShadows
uniform vec4 uCel; // bands (0 = Lambert), softness, ambientAway, ambientEdge
uniform float uBandLevels[${CEL_MAX}];
uniform float uRadPerPx; // radians of azimuth per plane pixel
out vec4 outColor;

const float PI = 3.14159265358979;
const vec3 NEAR_WARM = vec3(1.0, 0.82, 0.62);
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float WALL_RT2 = ${glsl(WALL_RT2)};
${[0, 1, 2]
  .map((i) => `const vec3 IN_R${i} = vec3(${ACES_IN[i].map(glsl).join(', ')});`)
  .join('\n')}
${[0, 1, 2]
  .map((i) => `const vec3 OUT_R${i} = vec3(${ACES_OUT[i].map(glsl).join(', ')});`)
  .join('\n')}
const vec3 FIT_AB = vec3(${glsl(ACES_FIT[0])}, ${glsl(ACES_FIT[1])}, 0.0);
const vec3 FIT_CDE = vec3(${glsl(ACES_FIT[2])}, ${glsl(ACES_FIT[3])}, ${glsl(ACES_FIT[4])});

// toneMap.ts scotopic: toward the rods' luminance (Jensen et al. 2001) in a blue-shifted grey, at weight w.
float scotLum(vec3 c) {
  float X = dot(vec3(0.4124, 0.3576, 0.1805), c);
  float Y = dot(vec3(0.2126, 0.7152, 0.0722), c);
  float Z = dot(vec3(0.0193, 0.1192, 0.9505), c);
  return max(0.0, Y * (1.33 * (1.0 + (Y + Z) / max(X, 1e-30)) - 1.68));
}
vec3 scotopic(vec3 c, float w) {
  if (w <= 0.0) return c;
  float k = scotLum(c) / scotLum(vec3(1.0));
  return mix(c, k * uScotTint, w);
}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 fit(vec3 v) {
  return (v * (v + FIT_AB.x) - FIT_AB.y) / (v * (FIT_CDE.x * v + FIT_CDE.y) + FIT_CDE.z);
}
vec3 aces(vec3 x) {
  vec3 p = fit(max(vec3(dot(IN_R0, x), dot(IN_R1, x), dot(IN_R2, x)), 0.0));
  return clamp(vec3(dot(OUT_R0, p), dot(OUT_R1, p), dot(OUT_R2, p)), 0.0, 1.0);
}

// toneMap.ts applyCurve: the monotone cubic Hermite through the sky's five knots.
float curve1(float v) {
  float x = clamp(v, 0.0, 1.0);
  int k = 0;
  for (int i = 1; i < ${KNOTS - 1}; i++) if (x > uCx[i]) k = i;
  float h = uCx[k + 1] - uCx[k];
  float t = (x - uCx[k]) / h;
  float t2 = t * t;
  float t3 = t2 * t;
  return (2.0 * t3 - 3.0 * t2 + 1.0) * uCy[k] + (t3 - 2.0 * t2 + t) * h * uCm[k]
    + (-2.0 * t3 + 3.0 * t2) * uCy[k + 1] + (t3 - t2) * h * uCm[k + 1];
}
vec3 curve(vec3 c) { return vec3(curve1(c.r), curve1(c.g), curve1(c.b)); }

// lightCards.ts celShade: flat bands of n.s, edges at i / bands.
float cel(float x) {
  int n = int(uCel.x);
  float w = uCel.y * 0.5;
  float l = uBandLevels[0];
  for (int i = 1; i < ${CEL_MAX}; i++) {
    if (i >= n) break;
    float e = float(i) / float(n);
    l += (uBandLevels[i] - uBandLevels[i - 1]) * (w > 0.0 ? smoothstep(e - w, e + w, x) : step(e, x));
  }
  return l;
}

vec3 skyAt(vec2 uv) {
  vec2 f = uv * vec2(uSkySize) - 0.5;
  vec2 b = floor(f);
  vec2 t = f - b;
  ivec2 lo = clamp(ivec2(b), ivec2(0), uSkySize - 1);
  ivec2 hi = clamp(ivec2(b) + 1, ivec2(0), uSkySize - 1);
  vec3 a = mix(texelFetch(uSky, ivec2(lo.x, lo.y), 0).rgb, texelFetch(uSky, ivec2(hi.x, lo.y), 0).rgb, t.x);
  vec3 c = mix(texelFetch(uSky, ivec2(lo.x, hi.y), 0).rgb, texelFetch(uSky, ivec2(hi.x, hi.y), 0).rgb, t.x);
  return mix(a, c, t.y);
}

float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) { sum += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return sum / 0.9375;
}

struct Geo { vec3 n; float logD; bool wall; };
Geo geoAt(ivec2 p) {
  vec4 g = texelFetch(uGeo, p, 0);
  vec2 rt = g.rg * 2.0 - 1.0;
  float rt2 = dot(rt, rt);
  Geo o;
  o.wall = rt2 > WALL_RT2;
  o.logD = uLogD.x + g.b * uLogD.y;
  o.n = o.wall ? vec3(0.0, 0.0, 1.0) : vec3(rt, sqrt(max(0.0, 1.0 - rt2)));
  return o;
}

void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), uSize.y - 1 - int(gl_FragCoord.y));
  vec4 c = texelFetch(uColour, p, 0);
  if (c.a <= 0.0) { outColor = vec4(0.0); return; }
  Geo g = geoAt(p);

  vec3 s = texelFetch(uSun, ivec2(p.x, 0), 0).xyz;
  if (uRelief.y > 0.0) s = normalize(mix(s, uFixedLight, uRelief.y));
  float dist = exp(g.logD);
  vec2 world = vec2(float(p.x) * uRadPerPx, 1.0) * dist;
  vec3 albedo = toLinear(c.rgb);
  if (uGround.x > 0.0) albedo *= max(1.0 + uGround.x * (2.0 * fbm(world / 250.0) - 1.0), 0.0);
  float cloud = uGround.y > 0.0 ? 1.0 - uGround.y * smoothstep(0.5, 0.72, fbm(world / 4000.0 + 17.0)) : 1.0;
  float lit = uCel.x > 0.5 ? cel(dot(g.n, s)) : max(dot(g.n, s), 0.0);
  float ndl = mix(max(s.z, 0.0), lit, uRelief.x);
  float ambStep = uCel.x > 0.5 ? mix(uCel.z, 1.0, smoothstep(uCel.w - uCel.y * 0.5, uCel.w + uCel.y * 0.5 + 1e-4, g.n.z)) : 1.0;
  vec3 radiance = albedo * (uTSun * ndl * cloud + uAmbient * mix(1.0, ambStep, uRelief.x)) / PI;
  float dn = clamp((g.logD - uLogD.x) / uLogD.y, 0.0, 1.0);
  if (uDist.y != 0.0) {
    vec3 flatTone = albedo * (uTSun * max(s.z, 0.0) * cloud + uAmbient) / PI;
    radiance = flatTone + (radiance - flatTone) * exp(uDist.y * (1.0 - 2.0 * dn));
  }
  radiance *= mix(vec3(1.0), NEAR_WARM, uDist.x * (1.0 - dn));
  vec3 T = exp(-uExt * (dist / 1000.0));
  vec2 uv = vec2((float(p.x) + 0.5) / uPlane.x, (float(uTop + p.y) + 0.5) / uPlane.y);
  vec3 haze = skyAt(uv);
  haze += uHazeTint * dot(haze, LUMA);
  radiance = radiance * T + haze * (1.0 - T);
  radiance *= max(uCard.x * (1.0 + uCard.y * ((float(p.y) + 0.5) / float(uSize.y) - 0.5)), 0.0);

  float keep = 1.0;
  ivec2 dirs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  for (int k = 0; k < 4; k++) {
    ivec2 q = p + dirs[k];
    if (q.x < 0 || q.y < 0 || q.x >= uSize.x || q.y >= uSize.y) continue;
    float an = texelFetch(uColour, q, 0).a;
    Geo gn = geoAt(q);
    if (c.a >= 0.5 && an < 0.5) keep = min(keep, uInkKeep.x);
    else if (an >= 0.5 && gn.logD - g.logD > uInkGeometry.x) keep = min(keep, uInkKeep.y);
    else if (an >= 0.5 && !g.wall && !gn.wall && dot(g.n, gn.n) < uInkGeometry.y) keep = min(keep, uInkKeep.z);
  }
  radiance *= 1.0 - (1.0 - keep) * uInkScale;

  vec3 rgb = toSrgb(curve(aces(scotopic(radiance, uGrade) * uExposure)));
  outColor = vec4(rgb * c.a, c.a);
}
`;

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('ridge: no shader');
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(`ridge: shader did not compile: ${gl.getShaderInfoLog(sh) ?? ''}`);
  return sh;
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('ridge: no program');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`ridge: shader did not link: ${gl.getProgramInfoLog(p) ?? ''}`);
  return p;
}

function texture(gl: WebGL2RenderingContext, unit: number): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('ridge: no texture');
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function floatTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  w: number,
  h: number,
  data: Float32Array
): WebGLTexture {
  const t = texture(gl, unit);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  return t;
}

function bitmapTexture(gl: WebGL2RenderingContext, unit: number, bmp: ImageBitmap): WebGLTexture {
  const t = texture(gl, unit);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  return t;
}

/**
 * Light the cards of `manifest` for `sky`, nearest first, as the manifest lists them. Throws without WebGL2 or when the shader will not link;
 * the caller (`loadBackdrop`) turns any throw into the sky alone. Closes the bitmaps, and releases the context after the last card.
 */
export function lightCards(
  manifest: RidgeManifest,
  bitmaps: CardBitmaps[],
  sky: PhysicalSky,
  look: RidgeLook = DEFAULT_LOOK
): LitCard[] {
  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) throw new Error('ridge: no WebGL2');
  try {
    const lit = lightingOf(manifest, sky, look);
    const prog = program(gl);
    gl.useProgram(prog);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    ['uColour', 'uGeo', 'uSun', 'uSky'].forEach((n, i) => gl.uniform1i(u(n), i));
    gl.uniform2f(u('uPlane'), lit.planeW, lit.planeH);
    gl.uniform2f(u('uLogD'), lit.logDMin, lit.logDSpan);
    gl.uniform3f(u('uExt'), ...lit.extinction);
    gl.uniform3f(u('uTSun'), ...lit.key.direct);
    gl.uniform3f(u('uAmbient'), ...lit.key.ambient);
    gl.uniform1f(u('uGrade'), lit.grade);
    gl.uniform3f(u('uScotTint'), ...SCOTOPIC.tint);
    gl.uniform1f(u('uExposure'), lit.exposure);
    gl.uniform1fv(u('uCx'), lit.curve.x);
    gl.uniform1fv(u('uCy'), lit.curve.y);
    gl.uniform1fv(u('uCm'), lit.curve.m);
    gl.uniform2f(u('uInkGeometry'), look.occludeLogD, look.creaseCos);
    gl.uniform3f(u('uInkKeep'), look.inkKeep.edge, look.inkKeep.occlude, look.inkKeep.crease);
    gl.uniform1f(u('uInkScale'), look.inkScale);
    gl.uniform2f(u('uRelief'), look.reliefWeight, look.reliefLight.mix);
    const fl = look.reliefLight;
    gl.uniform3f(
      u('uFixedLight'),
      Math.cos(fl.elevationDeg * RAD) * Math.cos(fl.azimuthDeg * RAD),
      Math.cos(fl.elevationDeg * RAD) * Math.sin(fl.azimuthDeg * RAD),
      Math.sin(fl.elevationDeg * RAD)
    );
    gl.uniform3f(u('uHazeTint'), ...look.hazeTint);
    gl.uniform2f(u('uDist'), look.nearWarm, look.contrastByDistance);
    gl.uniform2f(u('uGround'), look.groundNoise, look.cloudShadows);
    gl.uniform4f(u('uCel'), look.celBands, look.celSoftness, look.celAmbientAway, look.celAmbientEdge);
    gl.uniform1fv(u('uBandLevels'), celLevels(look.celBands, look.celBandLevels));
    gl.uniform1f(u('uRadPerPx'), (manifest.view.windowDeg * RAD) / lit.planeW);
    gl.uniform2i(u('uSkySize'), SKY_LUT.w, SKY_LUT.h);
    const sunTex = floatTexture(gl, 2, lit.planeW, 1, sunColumns(manifest.view, lit.key));
    const skyTex = floatTexture(
      gl,
      3,
      SKY_LUT.w,
      SKY_LUT.h,
      skyLut(sky, manifest.view, SKY_LUT.w, SKY_LUT.h)
    );
    const out = manifest.cards.map((card, i): LitCard => {
      const { colour, geometry } = bitmaps[i];
      glCanvas.width = colour.width;
      glCanvas.height = colour.height;
      gl.viewport(0, 0, colour.width, colour.height);
      const colourTex = bitmapTexture(gl, 0, colour);
      const geoTex = bitmapTexture(gl, 1, geometry);
      gl.uniform2i(u('uSize'), colour.width, colour.height);
      gl.uniform1i(u('uTop'), card.top);
      gl.uniform2f(
        u('uCard'),
        1 + look.cardToneStep * (i - (manifest.cards.length - 1) / 2),
        look.cardGradient
      );
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const canvas = document.createElement('canvas');
      canvas.width = colour.width;
      canvas.height = colour.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('ridge: no 2D context for a lit card');
      ctx.drawImage(glCanvas, 0, 0);
      gl.deleteTexture(colourTex);
      gl.deleteTexture(geoTex);
      colour.close();
      geometry.close();
      return { canvas, top: card.top, h: card.h, scale: card.scale };
    });
    gl.deleteTexture(sunTex);
    gl.deleteTexture(skyTex);
    return out;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
