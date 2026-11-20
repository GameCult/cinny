// Test helpers for the sky: a moment named by the clock of the place, and the sun of a band. Tests only.
import { momentFor } from './skyMoment';
import type { FixedSkyState } from './skyMoment';
import { sunAt } from './sunAt';
import type { SunSample } from './sunAt';
import { FALLBACK_VIEW } from './view';
import type { Place } from './view';

const VIENNA = FALLBACK_VIEW.place;

/** 22 September 2026 at h:m of local solar time at Vienna (the equinox: the sun is up from about 06:00 to 18:00 and the equation of time is a few minutes). */
export const atSolarTime = (h: number, m = 0): Date =>
  new Date(Date.UTC(2026, 8, 22, h, m) - VIENNA.lon * 4 * 60_000);

/** The sun of a band on the local day of `date` at `place`: Day is noon, Dusk the evening's -3 degrees, Night solar midnight. */
export const sunOfBand = (
  place: Place,
  band: FixedSkyState,
  date: Date,
): SunSample =>
  sunAt(
    place,
    momentFor(
      { kind: 'named', id: band === 'day' ? 'noon' : band },
      place,
      date
    )
  );
