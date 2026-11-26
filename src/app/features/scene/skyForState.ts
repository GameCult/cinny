// What the ridge scene is told for a sky choice. The choice is not a sky: `momentFor` (ridge/skyMoment.ts) decides the instant it draws,
// the sun at that instant is what the physical sky is lit from, and its band (`skyBand`) picks the display's luminance budget (ridge/toneMap.ts).
import type { SkyColours } from './ridge/skyColour';
import { makePhysicalSky } from './ridge/physicalSky';
import { momentFor, momentKey, skyBand } from './ridge/skyMoment';
import type { FixedSkyState, SkyChoice } from './ridge/skyMoment';
import { sunAt } from './ridge/sunAt';
import type { Place, View } from './ridge/view';
import { BUDGET } from './ridge/toneMap';
import { ridgeWeather, setFedWeather } from './ridge/weather';
import { currentWeather, feedFor, fetchWeatherFile } from './ridge/weatherFeed';
import { getConstellationLines, skyNow } from './skyState';

/** A clear sky: what a free moment is drawn with (ruling ridge-weather-on-frozen-moments: today's weather says nothing of another date). */
export const CLEAR_SKY = 0;

/** The weather a choice is drawn with: a free moment is clear; Auto and the named moments of today draw today's weather. */
const weatherFor = (choice: SkyChoice): number =>
  choice.kind === 'free' ? CLEAR_SKY : ridgeWeather();

/**
 * What a rebuild of the ridge scene is for: the band and moment it draws, the weather, the place and, at night, the constellation lines.
 * The sun moves with the clock inside an Auto band and is not part of the key (the scene is baked at its start); a named moment is its id
 * and local date, a free one its date and minutes.
 */
export const ridgeSkyKey = (
  choice: SkyChoice,
  view: View,
  weather: number = weatherFor(choice),
  now: Date = skyNow()
): string => {
  const band = skyBand(sunAt(view.place, momentFor(choice, view.place, now)).elevation);
  return `ridge:${band}:${weather}:${view.place.id}:${momentKey(choice, view.place, now)}${band === 'night' && getConstellationLines() ? ':lines' : ''}`;
};

const WEATHER_REFRESH_MS = 10 * 60_000;
let weatherAt = -Infinity;
let weatherPlace = '';
/**
 * Read `weather.json` (the page's own, next to config.json) into the weather the ridge sky is drawn for; at most once in ten minutes.
 * Never throws: a missing, stale or broken file is a clear sky (`currentWeather`). A place with no feed (`feedFor`) is a clear sky and the file is not
 * fetched; the place is remembered all the same, so going back to a place with a feed reads the file at once.
 */
export async function loadWeather(url: string, place: Place, now: Date = skyNow()): Promise<void> {
  if (place.id === weatherPlace && now.getTime() - weatherAt < WEATHER_REFRESH_MS) return;
  weatherAt = now.getTime();
  weatherPlace = place.id;
  const feed = feedFor(place.id);
  if (!feed) {
    setFedWeather(CLEAR_SKY);
    return;
  }
  setFedWeather(currentWeather(await fetchWeatherFile(url, feed), place, now));
}

/**
 * The ridge scene's `sky` option: the physical sky over the View's place at the instant the choice draws (`momentFor`: Auto the real sun now,
 * a named or free moment its own), as a palette for the layers and stars plus the `physical` sky the host canvas
 * is painted from. The atmosphere LUTs are baked here, once per scene start (tens of ms).
 */
export function ridgeSkyFor(
  choice: SkyChoice,
  view: View,
  weather: number = weatherFor(choice),
  now: Date = skyNow()
): SkyColours {
  const physical = makePhysicalSky(sunAt(view.place, momentFor(choice, view.place, now)), weather, view);
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
export function ridgeDrawn(band: FixedSkyState): Range {
  const b = BUDGET[band];
  return { darkest: b.floor, lightest: b.ceiling };
}
