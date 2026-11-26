// Which sky the signed-out page is drawn against: three small stores and the notice that one of them moved. The viewer's choice (Auto, a
// named moment, a free moment), the place the sky is over, and the constellation lines. They decide nothing: which instant is drawn is
// `momentFor` and which band it is, `skyBand` (ridge/skyMoment.ts); the resolved sky here is those two applied to the stores.
import { MOMENT_IDS, FREE_DATE_MAX, FREE_DATE_MIN, isDate, momentFor, momentKey, skyBand } from './ridge/skyMoment';
import type { FixedSkyState, MomentId, SkyChoice } from './ridge/skyMoment';
import { sunAt } from './ridge/sunAt';
import type { Place } from './ridge/view';

export const SKY_CHOICE_KEY = 'ratatoskr.skyChoice';

const AUTO: SkyChoice = { kind: 'auto' };

/** A stored value as a choice, or undefined when it is not one (wrong shape, unknown moment, a date outside 1900..2100, minutes outside 0..1439). */
export function parseSkyChoice(raw: unknown): SkyChoice | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const c = raw as Record<string, unknown>;
  if (c.kind === 'auto') return AUTO;
  if (c.kind === 'named' && MOMENT_IDS.includes(c.id as MomentId)) {
    return { kind: 'named', id: c.id as MomentId };
  }
  if (
    c.kind === 'free' &&
    isDate(c.date) &&
    c.date >= FREE_DATE_MIN &&
    c.date <= FREE_DATE_MAX &&
    Number.isInteger(c.minutes) &&
    (c.minutes as number) >= 0 &&
    (c.minutes as number) <= 1439
  ) {
    return { kind: 'free', date: c.date, minutes: c.minutes as number };
  }
  return undefined;
}

const same = (a: SkyChoice, b: SkyChoice): boolean => JSON.stringify(a) === JSON.stringify(b);

// The sky menu once held Auto, Day, Dusk and Night under another key. It is read once, here, and removed: Day became Noon.
const OLD_KEY = 'ratatoskr.skyState';
const FROM_OLD = new Map<string, SkyChoice>([
  ['auto', AUTO],
  ['day', { kind: 'named', id: 'noon' }],
  ['dusk', { kind: 'named', id: 'dusk' }],
  ['night', { kind: 'named', id: 'night' }],
]);

function load(): SkyChoice {
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (old !== null) {
      const migrated = FROM_OLD.get(old);
      if (migrated && localStorage.getItem(SKY_CHOICE_KEY) === null) {
        try {
          // The new key first: a refusal leaves the old one in place, and the pick holds for this page load.
          localStorage.setItem(SKY_CHOICE_KEY, JSON.stringify(migrated));
        } catch {
          return migrated;
        }
        localStorage.removeItem(OLD_KEY);
        return migrated;
      }
      localStorage.removeItem(OLD_KEY);
    }
    const stored = localStorage.getItem(SKY_CHOICE_KEY);
    return (stored !== null && parseSkyChoice(JSON.parse(stored))) || AUTO;
  } catch {
    return AUTO;
  }
}

let clock: () => Date = () => new Date();

/** The constellation lines: on or off, per viewer, off by default; set by `setConstellationLines`. */
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

let current: SkyChoice | undefined;
let place: Place | undefined;
const listeners = new Set<(s: FixedSkyState | undefined) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let shown: FixedSkyState | undefined;
let shownKey: string | undefined;
const TICK_MS = 60_000;

/** The choice (what the control shows). */
export const getSkyChoice = (): SkyChoice => {
  current ??= load();
  return current;
};

/** The place the sky is over: the loaded manifest's, set by skyPlace.ts; undefined until one is known. */
export const getSkyPlace = (): Place | undefined => place;

/** The moment the sky is drawn for: the real time, or the test clock. */
export const skyNow = (): Date => clock();

/** The band being drawn: the choice at the place, through `momentFor` and `skyBand`; undefined until a place is known (no sky is drawn for ink). */
export const getResolvedSkyState = (): FixedSkyState | undefined =>
  place && skyBand(sunAt(place, momentFor(getSkyChoice(), place, skyNow())).elevation);

/** What a rebuild would be for, of the moment now drawn (`momentKey`): a named moment's changes when the place-local day rolls over. */
const drawnKey = (): string | undefined => place && momentKey(getSkyChoice(), place, skyNow());

const emit = () => {
  shown = getResolvedSkyState();
  shownKey = drawnKey();
  [...listeners].forEach((cb) => cb(shown));
};

// While anyone listens and the choice is Auto or a named moment, one timer checks the clock each minute and tells
// listeners when the resolved band, or the moment drawn (an Auto band, a named moment's place-local day), changes from the one
// last told (`shown` and `shownKey`, set when telling and when the first listener arrives, never by a later arrival or departure).
// A free moment does not move with the clock, so it has no timer.
function sync(): void {
  clearTimeout(timer);
  timer = undefined;
  if (listeners.size === 0 || getSkyChoice().kind === 'free') return;
  const tick = () => {
    if (getResolvedSkyState() !== shown || drawnKey() !== shownKey) emit();
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, TICK_MS);
}

/** Replace the clock (tests); no argument restores the real one. */
export function setSkyClock(now?: () => Date): void {
  clock = now ?? (() => new Date());
  sync();
}

export function setSkyChoice(c: SkyChoice): void {
  const next = parseSkyChoice(c);
  if (!next) return;
  const changed = !same(next, getSkyChoice());
  current = next;
  try {
    localStorage.setItem(SKY_CHOICE_KEY, JSON.stringify(next));
  } catch {
    // Storage is refused (private mode, quota): the choice holds for this page load only.
  }
  if (changed) {
    sync();
    emit();
  }
}

/** The place the sky is over (skyPlace.ts, once the manifest is loaded). Listeners hear it, since the band depends on it. */
export function setSkyPlace(p: Place | undefined): void {
  if (p?.id === place?.id && p?.tz === place?.tz && p?.lat === place?.lat && p?.lon === place?.lon) {
    return;
  }
  place = p;
  emit();
}

/**
 * The constellation lines on or off (the Sky submenu of the scene view, ruling ridge-scene-view-submenus): per viewer, stored. Listeners hear it as a sky change
 * (the scene is rebuilt for it: `ridgeSkyKey` carries the flag), once, and only when the flag moved. This is the one setter; picking Night again sets nothing.
 */
export function setConstellationLines(on: boolean): void {
  if (getConstellationLines() === on) return;
  lines = on;
  try {
    localStorage.setItem(SKY_LINES_KEY, on ? 'on' : 'off');
  } catch {
    // Storage is refused: the lines hold for this page load only.
  }
  emit();
}

/** Listeners hear the resolved band: on a change of choice or place, while Auto, when the clock crosses a band, and while a named moment, when the place-local day rolls over. */
export function subscribe(cb: (s: FixedSkyState | undefined) => void): () => void {
  if (listeners.size === 0) {
    shown = getResolvedSkyState();
    shownKey = drawnKey();
  }
  listeners.add(cb);
  sync();
  return () => {
    listeners.delete(cb);
    sync();
  };
}
