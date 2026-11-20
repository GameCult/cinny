// Which instant the sky is drawn at, and which band it is. One owner, pure (no store, no React, no clock):
// `momentFor(choice, place, now)` turns the viewer's choice, the place and the time into the instant, and `skyBand` turns the sun
// at that instant into the sky the ink and the tone map are fitted to. Place-local time exists only here, through Intl with `place.tz`;
// the viewer's own zone decides nothing. The named moments are one table (`SKY_MOMENTS`), a row each, tuned by eye.
import type { Place } from './view';
import { sunAt } from './sunAt';

/**
 * The three skies ever drawn. Each has the luminance band its theme ink needs against bare sky (WCAG relative luminance,
 * the `luminance` of src/sky/skyTokens.js): day, at least 0.2983 (the dark text ink #342d25); dusk, at least 0.4554 (the link
 * #2a4f27); night, at most 0.0931 (the light text ink #aeccff). The ridge scene's display budgets (ridge/toneMap.ts `BUDGET`)
 * sit inside them.
 */
export type FixedSkyState = 'day' | 'dusk' | 'night';

/** Sun elevation (degrees) from which it is day, and below the negative of which it is night; between, dusk (dawn included). */
export const DAY_FROM = 6;

/** The one function that turns a sun into day, dusk or night. */
export const skyBand = (elevationDeg: number): FixedSkyState =>
  elevationDeg >= DAY_FROM ? 'day' : elevationDeg <= -DAY_FROM ? 'night' : 'dusk';

export const MOMENT_IDS = ['dawn', 'morning', 'noon', 'golden', 'dusk', 'night'] as const;
export type MomentId = typeof MOMENT_IDS[number];

/** What the viewer picked: the live sky, a named moment of today at the place, or a place-local date and minute of the day. */
export type SkyChoice =
  | { kind: 'auto' }
  | { kind: 'named'; id: MomentId }
  | { kind: 'free'; date: string; minutes: number };

/** The ephemeris range (sunAt.ts header): free dates are held inside it. */
export const FREE_DATE_MIN = '1900-01-01';
export const FREE_DATE_MAX = '2100-12-31';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// ---------------------------------------------------------------------------------------------------------------- place-local time

const formats = new Map<string, Intl.DateTimeFormat>();
const formatFor = (tz: string): Intl.DateTimeFormat => {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(tz, f);
  }
  return f;
};

/** The wall clock of `t` in `tz`, read as if it were UTC (ms): its difference from `t` is the zone's offset. */
const wallAsUtc = (t: number, tz: string): number => {
  const v: Record<string, number> = {};
  formatFor(tz)
    .formatToParts(new Date(t))
    .forEach((p) => {
      if (p.type !== 'literal') v[p.type] = Number(p.value);
    });
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
};
const offsetAt = (t: number, tz: string): number => wallAsUtc(t, tz) - Math.floor(t / 1000) * 1000;

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const dateOf = (utcMs: number): string => {
  const d = new Date(utcMs);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const utcOfDate = (date: string): number => {
  const m = DATE.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** True for a real calendar date 'YYYY-MM-DD'. */
export const isDate = (date: unknown): date is string =>
  typeof date === 'string' && DATE.test(date) && dateOf(utcOfDate(date)) === date;

/** The place-local calendar date of `now`, 'YYYY-MM-DD'. */
export const localDate = (now: Date, tz: string): string => dateOf(wallAsUtc(now.getTime(), tz));

/** The place-local minute of the day (0..1439) of `now`. */
export const localMinutes = (now: Date, tz: string): number => {
  const wall = new Date(wallAsUtc(now.getTime(), tz));
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
};

/**
 * The instant at which the wall clock of `tz` reads `date` and `minutes`. A wall time that does not exist (the spring-forward gap) is
 * shifted forward by the gap, so it lands after it; one that happens twice (fall-back) resolves to the first.
 */
export function zonedInstant(date: string, minutes: number, tz: string): Date {
  const guess = utcOfDate(date) + minutes * MIN;
  const before = offsetAt(guess - DAY, tz);
  const after = offsetAt(guess + DAY, tz);
  const valid = [...new Set([before, after])]
    .map((o) => guess - o)
    .filter((t) => offsetAt(t, tz) === guess - t)
    .sort((a, b) => a - b);
  return new Date(valid.length ? valid[0] : guess - before);
}

/** The short name of the zone at that instant ('CET', 'GMT+5:45'): what the picker shows beside a place-local time. */
export const zoneName = (at: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value ?? tz;

// ---------------------------------------------------------------------------------------------------------------- the named moments

const elevationAt = (place: Place, t: number): number => sunAt(place, new Date(t)).elevation;
const STEP = 5 * MIN;

/** The time in [a, b] (ms) where `f` is largest (sign 1) or smallest (sign -1), to under a minute: the function is unimodal there. */
function extremum(f: (t: number) => number, a: number, b: number, sign: 1 | -1): number {
  let lo = a;
  let hi = b;
  while (hi - lo > MIN / 2) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (sign * f(m1) < sign * f(m2)) lo = m1;
    else hi = m2;
  }
  return (lo + hi) / 2;
}

/** The time in [from, to] where `f` is largest (sign 1) or smallest (sign -1): a scan in 5-minute steps, refined to under a minute. */
function peak(f: (t: number) => number, from: number, to: number, sign: 1 | -1): number {
  let best = from;
  let bestV = -Infinity;
  for (let t = from; t <= to; t += STEP) {
    const v = sign * f(t);
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return extremum(f, Math.max(from, best - STEP), Math.min(to, best + STEP), sign);
}

/** The first rising (or last setting) crossing of `deg` in [from, to]: a 5-minute scan, bisected under a second; undefined when there is none. */
function crossing(
  f: (t: number) => number,
  deg: number,
  from: number,
  to: number,
  rising: boolean
): number | undefined {
  const above = (t: number) => f(t) >= deg;
  let found: [number, number] | undefined;
  for (let a = from; a < to; a += STEP) {
    const b = Math.min(a + STEP, to);
    if (above(a) !== above(b) && above(b) === rising) {
      found = [a, b];
      if (rising) break;
    }
  }
  if (!found) return undefined;
  let [lo, hi] = found;
  while (hi - lo > 500) {
    const m = (lo + hi) / 2;
    if (above(m) === rising) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

/** The place-local day a named moment is a moment of: its start and end, and the sun's noon in between. */
interface Day {
  place: Place;
  from: number;
  to: number;
  noon: number;
  noonElevation: number;
}

interface Rule {
  /** 'noon' and 'midnight' are the extremes; 'rising' and 'setting' are the crossing of `deg` (a function of the day's noon elevation) before and after noon. */
  at: 'noon' | 'midnight' | 'rising' | 'setting';
  deg?: (noonElevation: number) => number;
}

/**
 * The named moments, one row each (tuned by eye, ruling ridge-look-tuned-by-eye-no-contrast-gates). A crossing the day does not have
 * (polar) falls to the day's noon (rising) or midnight (setting). Night is solar midnight, tonight's: before the day's noon the one that
 * just passed or is coming this morning, after it the one that is coming (`momentOf`'s `before`), never one a whole day away.
 */
export const SKY_MOMENTS: Record<MomentId, Rule> = {
  dawn: { at: 'rising', deg: () => -3 },
  morning: { at: 'rising', deg: (noon) => Math.min(15, noon / 2) },
  noon: { at: 'noon' },
  golden: { at: 'setting', deg: () => 4 },
  dusk: { at: 'setting', deg: () => -3 },
  night: { at: 'midnight' },
};

function momentOf(id: MomentId, d: Day, before: boolean): number {
  const rule = SKY_MOMENTS[id];
  const f = (t: number) => elevationAt(d.place, t);
  const midnight = () => peak(f, d.noon, d.noon + DAY, -1);
  if (rule.at === 'noon') return d.noon;
  if (rule.at === 'midnight') return before ? peak(f, d.noon - DAY, d.noon, -1) : midnight();
  const deg = rule.deg ? rule.deg(d.noonElevation) : 0;
  if (rule.at === 'rising') return crossing(f, deg, d.from, d.noon, true) ?? d.noon;
  return crossing(f, deg, d.noon, d.to, false) ?? midnight();
}

const days = new Map<string, Day>();
const named = new Map<string, number>();
/** The place-local day `date` at the place (memoised: a pure function of these). */
function dayOf(place: Place, date: string): Day {
  const key = `${date}|${place.tz}|${place.lat}|${place.lon}`;
  let d = days.get(key);
  if (!d) {
    const from = zonedInstant(date, 0, place.tz).getTime();
    const to = zonedInstant(dateOf(utcOfDate(date) + DAY), 0, place.tz).getTime();
    const noon = peak((x) => elevationAt(place, x), from, to, 1);
    d = { place, from, to, noon, noonElevation: elevationAt(place, noon) };
    if (days.size > 256) days.clear();
    days.set(key, d);
  }
  return d;
}

/** The instant of a named moment on a place-local date at the place (memoised). Only Night looks at `now`: which side of the day's noon it is. */
function namedInstant(id: MomentId, place: Place, date: string, now: Date): Date {
  const d = dayOf(place, date);
  const before = now.getTime() < d.noon;
  const key = `${id}|${date}|${before}|${place.tz}|${place.lat}|${place.lon}`;
  let t = named.get(key);
  if (t === undefined) {
    t = momentOf(id, d, before);
    if (named.size > 256) named.clear();
    named.set(key, t);
  }
  return new Date(t);
}

// ---------------------------------------------------------------------------------------------------------------- the one decision

/** A free date held inside the ephemeris range; anything that is not a date reads as the range's start. */
const clampDate = (date: string): string =>
  !isDate(date) || date < FREE_DATE_MIN
    ? FREE_DATE_MIN
    : date > FREE_DATE_MAX
    ? FREE_DATE_MAX
    : date;
const clampMinutes = (m: number): number => Math.min(1439, Math.max(0, Math.floor(m) || 0));

/** The instant the sky is drawn at for a choice at a place: auto is `now`; a named moment is today's at the place (Night: tonight's, the nearest one); a free moment is its own. */
export function momentFor(choice: SkyChoice, place: Place, now: Date): Date {
  if (choice.kind === 'auto') return now;
  if (choice.kind === 'named') return namedInstant(choice.id, place, localDate(now, place.tz), now);
  return zonedInstant(clampDate(choice.date), clampMinutes(choice.minutes), place.tz);
}

/** The free moment (place-local date, minute to the 5 the slider steps) a choice is drawing now: where the picker opens from. */
export function seedFree(
  choice: SkyChoice,
  place: Place,
  now: Date
): Extract<SkyChoice, { kind: 'free' }> {
  if (choice.kind === 'free') return choice;
  const at = momentFor(choice, place, now);
  return {
    kind: 'free',
    date: localDate(at, place.tz),
    minutes: Math.floor(localMinutes(at, place.tz) / 5) * 5,
  };
}

/** What a rebuild is for, of the moment: live for auto, the id and place-local date of the instant for a named one, the date and minutes for a free one. */
export function momentKey(choice: SkyChoice, place: Place, now: Date): string {
  if (choice.kind === 'auto') return 'live';
  if (choice.kind === 'named') return `${choice.id}@${localDate(momentFor(choice, place, now), place.tz)}`;
  return `${clampDate(choice.date)}@${clampMinutes(choice.minutes)}`;
}
