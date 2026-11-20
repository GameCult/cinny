// What the ridge scene is told for a sky state. 'auto' is a choice, not a sky: it draws the sky it
// resolves to (`resolveSkyState`, the clock), so the scene paints one of day, dusk or night, fitted to that
// state's luminance budget (ridge/toneMap.ts). `skyBackdrop` bounds what comes out, and the login text was
// checked against that bound.
import type { SkyColours } from './ridge/skyColour';
import { makePhysicalSky } from './ridge/physicalSky';
import type { Place, View } from './ridge/view';
import { BUDGET } from './ridge/toneMap';
import { ridgeWeather, setFedWeather } from './ridge/weather';
import { currentWeather, fetchWeatherFile } from './ridge/weatherFeed';
import { resolveSkyState, skyNow } from './skyState';
import type { SkyState } from './skyState';

/**
 * What a rebuild of the ridge scene is for: the fixed state it draws and the weather. The sun moves with the clock inside a state and
 * is not part of the key (the scene is baked at its start), as the sky was one gradient per state before.
 */
export const ridgeSkyKey = (
  state: SkyState,
  view: View,
  weather: number = ridgeWeather(),
  now: Date = skyNow()
): string => `ridge:${resolveSkyState(state, now)}:${weather}:${view.place.id}`;

const WEATHER_REFRESH_MS = 10 * 60_000;
let weatherAt = -Infinity;
let weatherPlace = '';
/**
 * Read `weather.json` (the page's own, next to config.json) into the weather the ridge sky is drawn for; at most once in ten minutes.
 * Never throws: a missing, stale or broken file is a clear sky (`currentWeather`).
 */
export async function loadWeather(url: string, place: Place, now: Date = skyNow()): Promise<void> {
  if (place.id === weatherPlace && now.getTime() - weatherAt < WEATHER_REFRESH_MS) return;
  weatherAt = now.getTime();
  weatherPlace = place.id;
  setFedWeather(currentWeather(await fetchWeatherFile(url), place, now));
}

/**
 * The ridge scene's `sky` option: the physical sky over the View's place for the state ('auto': the real sun now; a forced state: the
 * sun of today at a moment inside it, `sunForState`), as a palette for the layers and stars plus the `physical` sky the host canvas
 * is painted from. The atmosphere LUTs are baked here, once per scene start (tens of ms).
 */
export function ridgeSkyFor(
  state: SkyState,
  view: View,
  weather: number = ridgeWeather(),
  now: Date = skyNow()
): SkyColours {
  const fixed = resolveSkyState(state, now);
  const physical = makePhysicalSky(fixed, now, weather, view);
  return {
    ...physical.stops,
    physical,
  };
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

