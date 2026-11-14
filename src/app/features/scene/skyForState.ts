// What each scene is told for a sky state. 'auto' is a choice, not a sky: both functions draw the sky it
// resolves to (`resolveSkyState`, the clock), so every scene paints one of day, dusk or night. Each is drawn
// inside that state's luminance band (skyBand.ts): the ridge sky from gradients whose stops and blends lie in
// it, the terrain sky shaped into it downstream of the scatter function. `skyBackdrop` bounds what comes out,
// and the login text was checked against that bound.
import { baked } from '../../../sky/baked';
import { chooseSky, skyColour, urlSky } from './terrain/terrainSky';
import type { SkyName } from './terrain/terrainSky';
import type { SkyColours, Srgb } from './ridge/skyColour';
import { makePhysicalSky } from './ridge/physicalSky';
import { FALLBACK_VIEW } from './ridge/view';
import type { View } from './ridge/view';
import { BUDGET } from './ridge/toneMap';
import { ridgeWeather, setFedWeather } from './ridge/weather';
import { currentWeather, fetchWeatherFile } from './ridge/weatherFeed';
import { resolveSkyState, skyNow } from './skyState';
import type { SkyState } from './skyState';
import { displayedLuminance, SKY_BAND } from './skyBand';
import type { SkyBand } from './skyBand';
import { luminance } from '../../../sky/skyTokens.js';
import { CAMERA } from './terrain/terrainWorld';

/** Sun elevation in degrees for the terrain's dusk: just above the horizon, between the two bakes (as `?sun=` puts it). */
export const DUSK_SUN_ELEVATION = 2;

/**
 * What a rebuild of the ridge scene is for: the fixed state it draws and the weather. The sun moves with the clock inside a state and
 * is not part of the key (the scene is baked at its start), as the sky was one gradient per state before.
 */
export const ridgeSkyKey = (
  state: SkyState,
  weather: number = ridgeWeather(),
  now: Date = skyNow(),
  view: View = FALLBACK_VIEW
): string => `ridge:${resolveSkyState(state, now)}:${weather}:${view.place.id}`;

const WEATHER_REFRESH_MS = 10 * 60_000;
let weatherAt = -Infinity;
/**
 * Read `weather.json` (the page's own, next to config.json) into the weather the ridge sky is drawn for; at most once in ten minutes.
 * Never throws: a missing, stale or broken file is a clear sky (`currentWeather`).
 */
export async function loadWeather(url: string, now: Date = skyNow()): Promise<void> {
  if (now.getTime() - weatherAt < WEATHER_REFRESH_MS) return;
  weatherAt = now.getTime();
  setFedWeather(currentWeather(await fetchWeatherFile(url), now));
}

/**
 * The ridge scene's `sky` option: the physical sky over the View's place for the state ('auto': the real sun now; a forced state: the
 * sun of today at a moment inside it, `sunForState`), as a palette for the layers and stars plus the `physical` sky the host canvas
 * is painted from. The atmosphere LUTs are baked here, once per scene start (tens of ms).
 */
export function ridgeSkyFor(
  state: SkyState,
  weather: number = ridgeWeather(),
  now: Date = skyNow(),
  view: View = FALLBACK_VIEW
): SkyColours {
  const fixed = resolveSkyState(state, now);
  const physical = makePhysicalSky(fixed, now, weather, view);
  return {
    ...physical.stops,
    physical,
  };
}

/**
 * The terrain scene's `sky`, `sun` and `band` options. An explicit state draws its own sky and ignores the URL. 'auto'
 * draws the sky it resolves to, unless the page URL steers (`?sun=` `?az=` `?sky=`, see `urlSky`): then the URL's sky,
 * shaped into the band of the state the clock resolves to, which keeps any sun the URL picks inside that band.
 */
export function terrainSkyFor(state: SkyState): {
  sky?: SkyName;
  sun?: { elevation: number; azimuth?: number };
  band: SkyBand;
} {
  const fixed = resolveSkyState(state);
  const band = SKY_BAND[fixed];
  if (state === 'auto') {
    const url = urlSky();
    if (url) return { ...url, band };
  }
  switch (fixed) {
    case 'day':
      return { sky: 'noonday', band };
    case 'night':
      return { sky: 'midnight', band };
    default:
      return { sun: { elevation: DUSK_SUN_ELEVATION }, band };
  }
}

/** Relative luminance (WCAG) of the darkest and lightest colour a scene can draw. */
export interface Range {
  readonly darkest: number;
  readonly lightest: number;
}

/**
 * The ridge sky's range: what its display is fitted to hold (`BUDGET`, toneMap.ts), which `physicalSky.test.ts` proves over the
 * sun's whole year over Vienna. Dark ink needs the floor; light ink the ceiling.
 */
export function ridgeDrawn(state: SkyState): Range {
  const b = BUDGET[resolveSkyState(state)];
  return { darkest: b.floor, lightest: b.ceiling };
}

/**
 * How high the terrain camera can see, in degrees of elevation: it is frozen at a downward pitch and only turns
 * (no pull-back), so the top edge of its view, at the centre column, is the pitch down subtracted from half the
 * field of view (14.5 degrees; off-centre columns look lower). Plus a 1.5 degree margin. The terrain's range is
 * over 0 to this, all azimuths, not the whole upper sphere; below the horizon the sky is the horizon's colour.
 */
export const TERRAIN_REACH_DEG = Math.ceil((CAMERA.fov / 2 - CAMERA.pitch) * (180 / Math.PI) + 1.5);

const SAMPLE_DEG = 3;
const SUN_DEG = 0.1;
const SUN_SPAN_DEG = 8;
const HORIZON_DEG = 0.5;
const REFINE_FROM = 6;

/**
 * The terrain sky's range as the 8-bit screen shows it (`displayedLuminance`, read 'low' for the darkest and 'high' for the
 * lightest: one 8-bit step each way, rounding and dither at their worst): `skyColour` (the CPU twin of its sky shader) over the part of the sky the camera reaches
 * (0 to TERRAIN_REACH_DEG, every azimuth: it turns), for the sky the scene picks for this state. A 3 degree grid, a 0.5 degree
 * ring of the horizon, the top of the reach and a 0.25 degree patch around the sun find where the extremes are; each of the
 * best few is then refined by a compass search whose step halves from 1 degree to under 5e-7, because the sun's glow peaks
 * (and the sky's darkest patch sits) between any fixed grid's samples.
 */
export function terrainDrawn(state: SkyState): Range {
  const sky = chooseSky(terrainSkyFor(state));
  const rad = Math.PI / 180;
  type Point = { el: number; az: number; read: number; score: number };
  const extreme = (reading: 'low' | 'high', sign: 1 | -1): number => {
    const point = (el: number, az: number): Point => {
      const e = Math.min(TERRAIN_REACH_DEG, Math.max(0, el)) * rad;
      const a = az * rad;
      const c = skyColour(sky, [
        Math.cos(e) * Math.sin(a),
        Math.sin(e),
        -Math.cos(e) * Math.cos(a),
      ]);
      const read = displayedLuminance(c, reading);
      return { el, az, read, score: read };
    };
    const seen: Point[] = [];
    const at = (el: number, az: number) => seen.push(point(el, az));
    for (let el = 0; el <= TERRAIN_REACH_DEG; el += SAMPLE_DEG) {
      for (let az = 0; az < 360; az += SAMPLE_DEG) at(el, az);
    }
    for (let az = 0; az < 360; az += HORIZON_DEG) at(0, az);
    at(TERRAIN_REACH_DEG, 0);
    for (let dEl = -SUN_SPAN_DEG; dEl <= SUN_SPAN_DEG; dEl += SUN_DEG) {
      for (let dAz = -SUN_SPAN_DEG; dAz <= SUN_SPAN_DEG; dAz += SUN_DEG) {
        at(sky.elevation + dEl, sky.azimuth + dAz);
      }
    }
    const around = (p: Point, step: number): Point[] =>
      [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ].map(([dEl, dAz]) =>
        point(Math.min(TERRAIN_REACH_DEG, Math.max(0, p.el + dEl)), p.az + dAz)
      );
    const refine = (from: Point) => {
      let best = from;
      for (let step = 1; step > 5e-7; step /= 2) {
        let improved = true;
        while (improved) {
          const cur = best;
          best = around(cur, step).reduce((b, c) => (sign * c.score > sign * b.score ? c : b), cur);
          improved = best !== cur;
        }
      }
      return best.read;
    };
    const ranked = [...seen].sort((p, q) => sign * (q.score - p.score));
    return sign === 1
      ? Math.max(ranked[0].read, ...ranked.slice(0, REFINE_FROM).map(refine))
      : Math.min(ranked[0].read, ...ranked.slice(0, REFINE_FROM).map(refine));
  };
  return { darkest: extreme('low', -1), lightest: extreme('high', 1) };
}
