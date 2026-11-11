// Which sky the signed-out page is drawn against. The choice is one value, kept in one
// localStorage key; whoever draws the sky (the scene, the title bar's control) reads it here, and
// `skyBackdrop` says how light or dark the sky behind the login text can be in each state, so the
// text colours can be checked against it. 'auto' is a choice, not a sky: it resolves from the
// clock to day, dusk or night (`resolveSkyState`), and every sky drawn is one of those three.
import { sunElevation } from '../../../sky/sun.js';
import type { FixedSkyState } from './skyBand';

export type SkyState = 'auto' | 'day' | 'dusk' | 'night';

export const SKY_STATES: readonly SkyState[] = ['auto', 'day', 'dusk', 'night'];
export const SKY_STATE_KEY = 'ratatoskr.skyState';

const isSkyState = (v: unknown): v is SkyState => SKY_STATES.includes(v as SkyState);

function load(): SkyState {
  try {
    const stored = localStorage.getItem(SKY_STATE_KEY);
    return isSkyState(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export type { FixedSkyState };

/** Where the clock puts the sun: the latitude the skies are baked for (src/sky/skyTokens.js MOMENTS), the longitude of this timezone. */
const LAT = 45;
/** Sun elevation (degrees) from which it is day, and below the negative of which it is night; between, dusk (dawn included). */
export const DAY_FROM = 6;

let clock: () => Date = () => new Date();
/** Minutes west of UTC of this timezone's standard time (the larger of its January and July offsets), so daylight saving does not move the sun. */
export const standardOffsetMinutes = (now: Date): number =>
  Math.max(
    new Date(now.getFullYear(), 0, 1).getTimezoneOffset(),
    new Date(now.getFullYear(), 6, 1).getTimezoneOffset()
  );

/** The fixed sky a choice draws now: itself, or for 'auto' the sky the sun's elevation here calls for. */
export function resolveSkyState(s: SkyState, now: Date = clock()): FixedSkyState {
  if (s !== 'auto') return s;
  const lon = -standardOffsetMinutes(now) / 4;
  const el = sunElevation(now, LAT, lon) as number;
  if (el >= DAY_FROM) return 'day';
  return el <= -DAY_FROM ? 'night' : 'dusk';
}

let current: SkyState | undefined;
const listeners = new Set<(s: FixedSkyState) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let shown: FixedSkyState | undefined;
const TICK_MS = 60_000;

/** The choice (what the control shows). */
export const getSkyState = (): SkyState => {
  current ??= load();
  return current;
};

/** The sky being drawn: the choice, resolved. */
export const getResolvedSkyState = (): FixedSkyState => resolveSkyState(getSkyState());

const emit = () => {
  shown = getResolvedSkyState();
  [...listeners].forEach((cb) => cb(shown as FixedSkyState));
};

// While anyone listens and the choice is 'auto', one timer checks the clock each minute and tells
// listeners when the resolved sky changes from the one last told (`shown`, set when telling and when the
// first listener arrives, never by a later arrival or departure). Otherwise there is no timer.
function sync(): void {
  clearTimeout(timer);
  timer = undefined;
  if (listeners.size === 0 || getSkyState() !== 'auto') return;
  const tick = () => {
    if (getResolvedSkyState() !== shown) emit();
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, TICK_MS);
}

/** Replace the clock (tests); no argument restores the real one. */
export function setSkyClock(now?: () => Date): void {
  clock = now ?? (() => new Date());
  sync();
}

export function setSkyState(s: SkyState): void {
  if (!isSkyState(s)) return;
  const changed = s !== getSkyState();
  current = s;
  try {
    localStorage.setItem(SKY_STATE_KEY, s);
  } catch {
    // Storage is refused (private mode, quota): the choice holds for this page load only.
  }
  if (changed) {
    sync();
    emit();
  }
}

/** Listeners hear the resolved sky: on a change of choice, and while 'auto', when the clock crosses a boundary. */
export function subscribe(cb: (s: FixedSkyState) => void): () => void {
  if (listeners.size === 0) shown = getResolvedSkyState();
  listeners.add(cb);
  sync();
  return () => {
    listeners.delete(cb);
    sync();
  };
}

/**
 * Relative luminance (WCAG, 0..1) of the lightest and darkest sky the state can show behind the
 * page. Light ink is worst against `lightest`, dark ink against `darkest`. 'auto' is the band of
 * the sky it resolves to now.
 */
export interface SkyBackdrop {
  readonly darkest: number;
  readonly lightest: number;
}

// The union of every sky a scene draws for the state: the ridge sky and the terrain sky, each from
// the function its scene uses (`ridgeDrawn`, `terrainDrawn` in skyForState.ts). Held as constants so
// this module, which the main chunk loads, does not pull in the terrain sky and the baked scattering
// tables with it; skyForState.test.ts fails when they drift from the computed union. The ridge sky counts
// over its whole range, the terrain sky over what its frozen camera reaches (TERRAIN_REACH_DEG, skyForState.ts).
// Night's lightest also covers a sky the page URL steers (shaped to the band ceiling, skyBand.ts).
// Bounds what the 8-bit screen shows too (one step each way for rounding and dither), rounded outward to six places.
const BACKDROPS: Record<FixedSkyState, SkyBackdrop> = {
  day: { darkest: 0.461063, lightest: 0.901108 },
  dusk: { darkest: 0.460352, lightest: 0.968744 },
  night: { darkest: 0.039159, lightest: 0.081642 },
};

export const skyBackdrop = (state: SkyState): SkyBackdrop => BACKDROPS[resolveSkyState(state)];
