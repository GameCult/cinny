// Which sky the signed-out page is drawn against. The choice is one value, kept in one
// localStorage key; whoever draws the sky (the scene, the title bar's control) reads it here.
// 'auto' is a choice, not a sky: it resolves from the clock to day, dusk or night
// (`resolveSkyState`), and every sky drawn is one of those three.
import { sunElevation } from '../../../sky/sun.js';

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

/**
 * The three skies ever drawn. Each has the luminance band its theme ink needs against bare sky (WCAG relative luminance,
 * the `luminance` of src/sky/skyTokens.js): day, at least 0.2983 (the dark text ink #342d25); dusk, at least 0.4554 (the link
 * #2a4f27); night, at most 0.0931 (the light text ink #aeccff). The ridge scene's display budgets (ridge/toneMap.ts `BUDGET`)
 * sit inside them.
 */
export type FixedSkyState = 'day' | 'dusk' | 'night';

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

/** The constellation lines (a hidden extra, ruling ridge-constellation-lines-hidden-extra): on or off, per viewer, off by default. */
export const SKY_LINES_KEY = 'ratatoskr.skyLines';
let lines: boolean | undefined;

/** Whether the constellation lines are on: the stored choice of this viewer. They are drawn over the real stars of a night sky only. */
export const getConstellationLines = (): boolean => {
  if (lines === undefined) {
    try {
      lines = localStorage.getItem(SKY_LINES_KEY) === 'on';
    } catch {
      lines = false;
    }
  }
  return lines;
};

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

/** The moment the sky is drawn for: the real time, or the test clock. */
export const skyNow = (): Date => clock();

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

/**
 * A pick in the sky menu. Picking a state sets it; picking Night while the choice already is Night toggles the constellation lines, which
 * listeners hear as a sky change (the scene is rebuilt for it: `ridgeSkyKey` carries the flag).
 */
export function pickSkyState(s: SkyState): void {
  if (s === 'night' && getSkyState() === 'night') {
    lines = !getConstellationLines();
    try {
      localStorage.setItem(SKY_LINES_KEY, lines ? 'on' : 'off');
    } catch {
      // Storage is refused: the lines hold for this page load only.
    }
    emit();
    return;
  }
  setSkyState(s);
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
