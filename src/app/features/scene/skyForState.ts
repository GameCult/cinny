// What each scene is told for a sky state. 'auto' returns nothing: the scene chooses for itself
// (the ridges' fixed dusk, the terrain's clock with `?sky=` `?sun=` `?az=`), exactly as before
// there was a state. The other states name a sky explicitly, drawn from the same gradients
// `skyBackdrop` bounds, so the colours a scene paints lie inside the luminance range the login
// text was checked against.
import { baked } from '../../../sky/baked';
import type { SkyName } from './terrain/terrainSky';
import type { SkyColours, Srgb } from './ridge/skyColour';
import { skyColours } from './ridge/skyColour';
import type { SkyState } from './skyState';

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
