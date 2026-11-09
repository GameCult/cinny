// What each scene is told for a sky state. 'auto' is a choice, not a sky: both functions draw the sky it
// resolves to (`resolveSkyState`, the clock), so every scene paints one of day, dusk or night. Each is drawn
// inside that state's luminance band (skyBand.ts): the ridge sky from gradients whose stops and blends lie in
// it, the terrain sky shaped into it downstream of the scatter function. `skyBackdrop` bounds what comes out,
// and the login text was checked against that bound.
import { baked } from '../../../sky/baked';
import { chooseSky, skyColour } from './terrain/terrainSky';
import type { SkyName } from './terrain/terrainSky';
import type { SkyColours, Srgb } from './ridge/skyColour';
import { skyColours } from './ridge/skyColour';
import { resolveSkyState } from './skyState';
import type { SkyState } from './skyState';
import { displayedLuminance, SKY_BAND } from './skyBand';
import type { SkyBand } from './skyBand';
import { luminance } from '../../../sky/skyTokens.js';

const rgb = (hex: string): Srgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Srgb;

const fromGradient = (g: readonly string[], ground: Srgb): SkyColours => ({
  top: rgb(g[0]),
  mid: rgb(g[Math.floor(g.length / 2)]),
  horizon: rgb(g[g.length - 1]),
  ground,
});

/** Sun elevation in degrees for the terrain's dusk: just above the horizon, between the two bakes (as `?sun=` puts it). */
export const DUSK_SUN_ELEVATION = 2;

/** The ridge scene's `sky` option: the gradient of the state's sky ('auto': of the sky it resolves to). */
export function ridgeSkyFor(state: SkyState): SkyColours {
  const { ground } = skyColours();
  switch (resolveSkyState(state)) {
    case 'dusk':
      return skyColours();
    case 'day':
      return fromGradient(baked.noonday.gradient, ground);
    default:
      return fromGradient(baked.midnight.gradient, ground);
  }
}

/** The terrain scene's `sky`, `sun` and `band` options: the state's sky ('auto': the sky it resolves to), shaped into the state's band. */
export function terrainSkyFor(state: SkyState): {
  sky?: SkyName;
  sun?: { elevation: number };
  band: SkyBand;
} {
  const fixed = resolveSkyState(state);
  const band = SKY_BAND[fixed];
  switch (fixed) {
    case 'day':
      return { sky: 'noonday', band };
    case 'night':
      return { sky: 'midnight', band };
    default:
      return { sun: { elevation: DUSK_SUN_ELEVATION }, band };
  }
}

const rgbHex = (c: Srgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Relative luminance (WCAG) of the darkest and lightest colour a scene can draw. */
export interface Range {
  readonly darkest: number;
  readonly lightest: number;
}

/**
 * The ridge sky's range: its top, middle and horizon stops and the blends between them (the canvas interpolates
 * encoded sRGB, and luminance is convex in it, so a blend can be darker than both ends: each stop pair is sampled).
 */
export function ridgeDrawn(state: SkyState): Range {
  const { top, mid, horizon } = ridgeSkyFor(state);
  const l: number[] = [];
  [
    [top, mid],
    [mid, horizon],
    [top, horizon],
  ].forEach(([a, b]) => {
    for (let k = 0; k <= 100; k += 1) {
      l.push(
        luminance(
          rgbHex(a.map((v, i) => Math.round(v + ((b[i] - v) * k) / 100)) as unknown as Srgb)
        )
      );
    }
  });
  return { darkest: Math.min(...l), lightest: Math.max(...l) };
}

const SAMPLE_DEG = 3;
const SUN_DEG = 0.25;
const SUN_SPAN_DEG = 8;
const HORIZON_DEG = 0.5;
const REFINE_FROM = 6;

/**
 * The terrain sky's range, as displayed (`displayedLuminance`): `skyColour` (the CPU twin of its sky shader) over the whole upper sphere, which the camera
 * sweeps as it turns, for the sky the scene picks for this state. A 3 degree grid, a 0.5 degree ring of the horizon, the
 * zenith and a 0.25 degree patch around the sun find where the extremes are; each of the best few is then refined by a
 * compass search whose step halves from 1 degree to under 0.001, because the sun's glow peaks (and the sky's darkest
 * patch sits) between any fixed grid's samples.
 */
export function terrainDrawn(state: SkyState): Range {
  const sky = chooseSky(terrainSkyFor(state));
  const rad = Math.PI / 180;
  const lum = (el: number, az: number) => {
    const e = Math.min(90, Math.max(0, el)) * rad;
    const a = az * rad;
    return displayedLuminance(
      skyColour(sky, [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)])
    );
  };
  const seen: { el: number; az: number; l: number }[] = [];
  const at = (el: number, az: number) => seen.push({ el, az, l: lum(el, az) });
  for (let el = 0; el <= 90; el += SAMPLE_DEG) {
    for (let az = 0; az < 360; az += SAMPLE_DEG) at(el, az);
  }
  for (let az = 0; az < 360; az += HORIZON_DEG) at(0, az);
  at(90, 0);
  for (let dEl = -SUN_SPAN_DEG; dEl <= SUN_SPAN_DEG; dEl += SUN_DEG) {
    for (let dAz = -SUN_SPAN_DEG; dAz <= SUN_SPAN_DEG; dAz += SUN_DEG) {
      at(sky.elevation + dEl, sky.azimuth + dAz);
    }
  }
  type Point = { el: number; az: number; l: number };
  const around = (p: Point, step: number): Point[] =>
    [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ].map(([dEl, dAz]) => {
      const el = Math.min(90, Math.max(0, p.el + dEl));
      return { el, az: p.az + dAz, l: lum(el, p.az + dAz) };
    });
  const refine = (from: Point, sign: 1 | -1) => {
    let best = from;
    for (let step = 1; step > 0.0005; step /= 2) {
      let improved = true;
      while (improved) {
        const cur = best;
        best = around(cur, step).reduce((b, c) => (sign * c.l > sign * b.l ? c : b), cur);
        improved = best !== cur;
      }
    }
    return best.l;
  };
  const byLight = [...seen].sort((p, q) => q.l - p.l);
  const lightest = Math.max(
    byLight[0].l,
    ...byLight.slice(0, REFINE_FROM).map((p) => refine(p, 1))
  );
  const darkest = Math.min(
    byLight[byLight.length - 1].l,
    ...byLight.slice(-REFINE_FROM).map((p) => refine(p, -1))
  );
  return { darkest, lightest };
}
