// What each scene is told for a sky state. 'auto' returns nothing: the scene chooses for itself
// (the ridges' fixed dusk, the terrain's clock with `?sky=` `?sun=` `?az=`), exactly as before
// there was a state. The other states name a sky explicitly, drawn from the same gradients
// `skyBackdrop` bounds, so the colours a scene paints lie inside the luminance range the login
// text was checked against.
import { baked } from '../../../sky/baked';
import { chooseSky, skyColour } from './terrain/terrainSky';
import type { SkyName, Vec3 } from './terrain/terrainSky';
import type { SkyColours, Srgb } from './ridge/skyColour';
import { skyColours } from './ridge/skyColour';
import type { SkyState } from './skyState';
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

/** The ridge scene's `sky` option; undefined leaves the scene on `skyColours()`. */
export function ridgeSkyFor(state: SkyState): SkyColours | undefined {
  const { ground } = skyColours();
  switch (state) {
    case 'dusk':
      return skyColours();
    case 'day':
      return fromGradient(baked.noonday.gradient, ground);
    case 'night':
      return fromGradient(baked.midnight.gradient, ground);
    default:
      return undefined;
  }
}

/** The terrain scene's `sky` and `sun` options; `{}` leaves the scene on its clock and URL choice. */
export function terrainSkyFor(state: SkyState): { sky?: SkyName; sun?: { elevation: number } } {
  switch (state) {
    case 'day':
      return { sky: 'noonday' };
    case 'night':
      return { sky: 'midnight' };
    case 'dusk':
      return { sun: { elevation: DUSK_SUN_ELEVATION } };
    default:
      return {};
  }
}

const rgbHex = (c: Srgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Relative luminance (WCAG) of the darkest and lightest colour a scene can draw. */
export interface Range {
  readonly darkest: number;
  readonly lightest: number;
}

/** The ridge sky's range: its top, middle and horizon stops (the canvas blends between them). */
export function ridgeDrawn(state: SkyState): Range | undefined {
  const sky = ridgeSkyFor(state === 'auto' ? 'dusk' : state);
  if (!sky) return undefined;
  const l = [sky.top, sky.mid, sky.horizon].map((c) => luminance(rgbHex(c)));
  return { darkest: Math.min(...l), lightest: Math.max(...l) };
}

const SAMPLE_DEG = 3;
const linearLuminance = (c: Vec3) => {
  const [r, g, b] = c.map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The terrain sky's range: `skyColour` (the CPU twin of its sky shader) over the whole upper sphere, which the camera
 * sweeps as it turns, for the sky the scene picks for this state. Sampled every 3 degrees.
 */
export function terrainDrawn(state: SkyState): Range {
  const sky = chooseSky(terrainSkyFor(state));
  let darkest = Infinity;
  let lightest = -Infinity;
  for (let el = 0; el <= 90; el += SAMPLE_DEG) {
    for (let az = 0; az < 360; az += SAMPLE_DEG) {
      const e = (el * Math.PI) / 180;
      const a = (az * Math.PI) / 180;
      const l = linearLuminance(
        skyColour(sky, [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)])
      );
      darkest = Math.min(darkest, l);
      lightest = Math.max(lightest, l);
    }
  }
  return { darkest, lightest };
}
