// Midnight Sky and Noonday Sky: theme tokens as albedo x irradiance.
// Dependency-free apart from sun.js, so scripts/bake-sky.mjs and the tests run it under plain node.
//
//   bakeSky('midnight' | 'noonday') -> { moment, elevation, sun, ambient_linear, horizon_hex,
//                                        gradient: [hex x GRADIENT_STOPS], tokens, ... }
//
// The sky is lit by sun.js at a fixed moment (clear weather: a build-time bake has no feed).
// A surface is `albedo * irradiance`, where irradiance is the sun and sky on an upward-facing
// surface, rescaled to a per-role brightness `key` (the eye adapts to the scene; only the
// light's colour survives, not its absolute level). Everything marked EYEBALLED is tuned by
// looking and then held to WCAG AA by skyTokens.test.ts.

import { light } from './sun.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export const GRADIENT_STOPS = 7;
export const AA = 4.5; // WCAG 2.x AA, normal text

// Where and when the theme is lit. Equinox, 45N on the prime meridian: noon sun at 45 degrees.
export const MOMENTS = {
  noonday: { time: '2026-09-22T12:00:00Z', lat: 45, lon: 0 },
  midnight: { time: '2026-09-22T00:00:00Z', lat: 45, lon: 0 },
};

// Lowest ambient a baked sky reports, linear RGB. sun.js's night sky is ~0.004, which is
// starlight-true but too dark to see by on a screen; this lifts it to a bluish moonlit-skyglow
// level. Daylight ambient is far above it, so the floor only ever touches the night.
export const AMBIENT_FLOOR = [0.018, 0.024, 0.04];

// Linear-RGB albedos of the things Yggdrasil is made of. EYEBALLED around measured ranges
// (dark bark 0.05-0.1, birch bark ~0.6, leaves ~0.05 red/0.15 green/0.03 blue, wet soil ~0.1).
export const ALBEDO = {
  soil: [0.1, 0.065, 0.04],
  bark: [0.075, 0.048, 0.03],
  barkPale: [0.6, 0.57, 0.5], // birch and lichen
  barkChar: [0.035, 0.026, 0.018],
  leaf: [0.06, 0.2, 0.05],
  leafPale: [0.3, 0.5, 0.16], // new growth
  clay: [0.36, 0.1, 0.07],
  ochre: [0.4, 0.28, 0.06],
};

// Irradiance on an upward surface, unit-luminance: only the light's colour is kept.
function chroma({ direct, diffuse, elevation }) {
  const up = Math.max(0, Math.sin((elevation * Math.PI) / 180));
  const e = diffuse.map((d, i) => d + direct[i] * up);
  const y = luma(e);
  return e.map((v) => v / y);
}

// sRGB transfer, linear <-> encoded.
const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const toHex = (lin) =>
  `#${ 
  lin
    .map((v) =>
      Math.round(clamp(encode(clamp(v, 0, 1)), 0, 1) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
export const fromHex = (hex) =>
  [1, 3, 5].map((i) => decode(parseInt(hex.slice(i, i + 2), 16) / 255));
export const luminance = (hex) => luma(fromHex(hex));
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Per-theme brightness keys (target luminance of an albedo-1 surface). EYEBALLED.
const DARK = {
  skyKey: 0.06, // zenith of the baked gradient
  main: 0.85, // buttons and accents: lit pale albedos
  container: 0.06, // tinted panels: lit mid albedos
  text: 1.1,
  steps: { Hover: 1.18, Active: 1.36, Line: 1.7 },
};
const LIGHT = {
  skyKey: 0.55,
  main: 0.55,
  container: 1.0,
  text: 1.0,
  steps: { Hover: 0.93, Active: 0.86, Line: 0.76 },
};

// Pigments for other people's names (--mx-uc-1..8): flower and berry albedos. EYEBALLED hues.
const PIGMENTS = [
  [0.1, 0.25, 0.7],
  [0.45, 0.15, 0.6],
  [0.1, 0.5, 0.3],
  [0.7, 0.15, 0.3],
  [0.8, 0.35, 0.08],
  [0.1, 0.5, 0.55],
  [0.3, 0.3, 0.8],
  [0.45, 0.6, 0.12],
];

export function bakeSky(name) {
  const dark = name === 'midnight';
  const T = dark ? DARK : LIGHT;
  const moment = MOMENTS[name];
  const l = light(moment);
  const c = chroma(l);
  const lit = (albedo, key) => albedo.map((a, i) => a * c[i] * key);
  const hex = (albedo, key) => toHex(lit(albedo, key));

  // Sky gradient, top to bottom: zenith radiance ~ diffuse, horizon whitened by aerosol and
  // warmed by whatever direct light is left. EYEBALLED mix.
  const zenith = l.diffuse;
  const grey = luma(zenith);
  const horizon = zenith.map((z, i) => z * 0.6 + grey * 0.7 + l.direct[i] * 0.05);
  const scale = T.skyKey / luma(zenith);
  const gradient = Array.from({ length: GRADIENT_STOPS }, (_, k) => {
    const t = (k / (GRADIENT_STOPS - 1)) ** 1.6; // dwell on the upper sky
    return toHex(mix3(zenith, horizon, t).map((v) => v * scale));
  });

  const stepped = (albedo, key) =>
    Object.fromEntries(Object.entries(T.steps).map(([n, s]) => [n, hex(albedo, key * s)]));
  const PALE = ALBEDO.barkPale;
  const tint = (a) => (dark ? a : mix3(a, PALE, 0.8)); // light containers are pale tints
  const text = hex(dark ? PALE : ALBEDO.barkChar, T.text);

  const panel = (albedo, key) => ({
    Container: hex(albedo, key),
    ...Object.fromEntries(
      Object.entries(stepped(albedo, key)).map(([n, v]) => [`Container${  n}`, v])
    ),
    OnContainer: text,
  });
  const accent = (albedo) => {
    const main = dark ? mix3(albedo, PALE, 0.35) : albedo;
    // Label: whichever of a charred or a pale lit surface reads better. The button is then
    // pushed away from it (brighter on dark, darker on light) until the pair clears AA.
    const labels = [hex(ALBEDO.barkChar, 0.9), hex(PALE, 1.4)];
    let key = T.main;
    let mainHex = hex(main, key);
    const onMain = labels.sort((a, b) => contrast(mainHex, b) - contrast(mainHex, a))[0];
    for (let n = 0; n < 40 && contrast(mainHex, onMain) < AA; n += 1) {
      key *= dark ? 1.04 : 0.96;
      mainHex = hex(main, key);
    }
    return {
      Main: mainHex,
      ...Object.fromEntries(Object.entries(stepped(main, key)).map(([n, v]) => [`Main${  n}`, v])),
      OnMain: onMain,
      Container: hex(tint(albedo), T.container),
      ...Object.fromEntries(
        Object.entries(stepped(tint(albedo), T.container)).map(([n, v]) => [`Container${  n}`, v])
      ),
      OnContainer: text,
    };
  };

  // Depth reads as brightness: Background < Surface < SurfaceVariant on dark, the reverse on light.
  const depth = dark ? [0.05, 0.12, 0.2] : [0.85, 1.15, 1.0];
  const tokens = {
    Background: panel(dark ? ALBEDO.soil : PALE, depth[0]),
    Surface: panel(dark ? ALBEDO.bark : ALBEDO.barkPale, depth[1]),
    SurfaceVariant: panel(dark ? ALBEDO.bark : ALBEDO.barkPale, depth[2]),
    Primary: accent(dark ? ALBEDO.leafPale : ALBEDO.leaf),
    Secondary: accent(dark ? ALBEDO.barkPale : ALBEDO.bark),
    Success: accent(dark ? ALBEDO.leafPale : ALBEDO.leaf),
    Warning: accent(ALBEDO.ochre),
    Critical: accent(ALBEDO.clay),
  };

  // Chat bubbles, same lighting: other people's on bark, your own on leaf.
  const bubbles = {
    Other: hex(dark ? ALBEDO.bark : mix3(ALBEDO.barkPale, ALBEDO.bark, 0.0), dark ? 0.06 : 0.82),
    OtherText: text,
    Own: hex(dark ? ALBEDO.leaf : mix3(ALBEDO.leafPale, PALE, 0.55), dark ? 0.1 : 0.9),
    OwnText: text,
  };

  // Names must clear AA on every panel a message can sit on: pushed away from them until they do.
  const grounds = [
    tokens.Background.Container,
    tokens.Surface.Container,
    tokens.SurfaceVariant.Container,
    bubbles.Other,
    bubbles.Own,
  ];
  const readable = (h) => grounds.every((g) => contrast(h, g) >= AA);
  const fit = (albedo) => {
    let key = 0.5;
    let h = hex(albedo, key);
    for (let n = 0; n < 80 && !readable(h); n += 1) {
      key *= dark ? 1.05 : 0.95;
      h = hex(albedo, key);
    }
    return h;
  };

  return {
    moment,
    elevation: l.elevation,
    // Sun for consumers that light a scene themselves: direction in degrees (azimuth clockwise
    // from north) and the direct light's colour at normal incidence (black while it is below the horizon).
    sun: { elevation_deg: l.elevation, azimuth_deg: l.azimuth, color_linear: l.direct },
    ambient_linear: l.diffuse.map((v, i) => Math.max(v, AMBIENT_FLOOR[i])),
    horizon_hex: gradient[GRADIENT_STOPS - 1], // last stop: the horizon end of the gradient
    gradient,
    tokens,
    bubbles,
    userColors: PIGMENTS.map(fit),
    link: fit(dark ? ALBEDO.leafPale : ALBEDO.leaf),
  };
}
