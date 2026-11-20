import { describe, expect, it } from 'vitest';
import {
  DAY_FROM,
  MOMENT_IDS,
  localDate,
  localMinutes,
  momentFor,
  momentKey,
  seedFree,
  skyBand,
  zonedInstant,
} from './skyMoment';
import type { MomentId } from './skyMoment';
import { sunAt } from './sunAt';
import type { Place } from './view';

const PLACES: Record<string, Place> = {
  vienna: { id: 'vienna', lat: 48.19, lon: 16.35, altitudeKm: 0.18, tz: 'Europe/Vienna' },
  matterhorn: { id: 'matterhorn', lat: 45.98, lon: 7.78, altitudeKm: 3.1, tz: 'Europe/Zurich' },
  fuji: { id: 'fuji', lat: 35.31, lon: 138.63, altitudeKm: 0.4, tz: 'Asia/Tokyo' },
  amadablam: { id: 'amadablam', lat: 27.9, lon: 86.9, altitudeKm: 4.2, tz: 'Asia/Kathmandu' },
  halfdome: {
    id: 'halfdome',
    lat: 37.73,
    lon: -119.55,
    altitudeKm: 1.2,
    tz: 'America/Los_Angeles',
  },
};
const DAYS = ['2026-06-21', '2026-12-21', '2026-03-20'];
const MIN = 60_000;

/** 18:00 place-local on `date`: any instant of that local day names it, and one after the sun's noon, so Night is the coming midnight. */
const during = (date: string, p: Place): Date => zonedInstant(date, 1080, p.tz);
const at = (id: MomentId, p: Place, date: string): Date =>
  momentFor({ kind: 'named', id }, p, during(date, p));
const el = (p: Place, t: Date): number => sunAt(p, t).elevation;

describe('the named moments', () => {
  describe.each(Object.entries(PLACES))('%s', (_name, p) => {
    it.each(DAYS)(
      '%s: dawn < morning < noon < golden < dusk inside the local day, night after noon',
      (date) => {
        const t = Object.fromEntries(MOMENT_IDS.map((id) => [id, at(id, p, date).getTime()]));
        expect(t.dawn).toBeLessThan(t.morning);
        expect(t.morning).toBeLessThan(t.noon);
        expect(t.noon).toBeLessThan(t.golden);
        expect(t.golden).toBeLessThan(t.dusk);
        expect(t.night).toBeGreaterThan(t.noon);
        (['dawn', 'morning', 'noon', 'golden', 'dusk'] as const).forEach((id) =>
          expect(localDate(new Date(t[id]), p.tz)).toBe(date)
        );
      }
    );

    it.each(DAYS)('%s: each crossing is at its table elevation, within 0.05 degrees', (date) => {
      const noonEl = el(p, at('noon', p, date));
      expect(el(p, at('dawn', p, date))).toBeCloseTo(-3, 1);
      expect(el(p, at('morning', p, date))).toBeCloseTo(Math.min(15, noonEl / 2), 1);
      expect(el(p, at('golden', p, date))).toBeCloseTo(4, 1);
      expect(el(p, at('dusk', p, date))).toBeCloseTo(-3, 1);
    });

    it.each(DAYS)(
      '%s: noon is the day maximum and night the lowest of the 24 h after it',
      (date) => {
        const noon = at('noon', p, date);
        const night = at('night', p, date);
        for (let m = 0; m < 24 * 60; m += 5) {
          const t = new Date(noon.getTime() + m * MIN);
          expect(el(p, t)).toBeGreaterThanOrEqual(el(p, night) - 1e-3);
        }
        const dayStart = zonedInstant(date, 0, p.tz).getTime();
        for (let m = 0; m < 24 * 60; m += 5) {
          expect(el(p, new Date(dayStart + m * MIN))).toBeLessThanOrEqual(el(p, noon) + 1e-3);
        }
      }
    );
  });

  it('morning is half the noon elevation at Vienna in December (the 15 degree rule would never be met)', () => {
    const p = PLACES.vienna;
    const noonEl = el(p, at('noon', p, '2026-12-21'));
    expect(noonEl).toBeLessThan(30);
    expect(el(p, at('morning', p, '2026-12-21'))).toBeCloseTo(noonEl / 2, 1);
    expect(el(p, at('morning', p, '2026-06-21'))).toBeCloseTo(15, 1);
  });

  it('a named moment is today of the place: the same local date gives the same instant, the next day another', () => {
    const p = PLACES.fuji;
    const a = momentFor({ kind: 'named', id: 'dusk' }, p, zonedInstant('2026-12-21', 30, p.tz));
    const b = momentFor({ kind: 'named', id: 'dusk' }, p, zonedInstant('2026-12-21', 1400, p.tz));
    const c = momentFor({ kind: 'named', id: 'dusk' }, p, zonedInstant('2026-12-22', 30, p.tz));
    expect(a.getTime()).toBe(b.getTime());
    expect(c.getTime()).not.toBe(a.getTime());
  });

  it('is total at a pole, where there is no dawn or no dusk: it falls to noon or midnight', () => {
    const pole: Place = { id: 'pole', lat: 80, lon: 0, altitudeKm: 0, tz: 'UTC' };
    for (const date of ['2026-06-21', '2026-12-21']) {
      const now = zonedInstant(date, 720, 'UTC');
      for (const id of MOMENT_IDS) {
        const t = momentFor({ kind: 'named', id }, pole, now);
        expect(Number.isFinite(t.getTime())).toBe(true);
      }
    }
    const june = zonedInstant('2026-06-21', 720, 'UTC');
    expect(momentFor({ kind: 'named', id: 'dawn' }, pole, june).getTime()).toBe(
      momentFor({ kind: 'named', id: 'noon' }, pole, june).getTime()
    );
  });
});

describe('zones', () => {
  it.each(['Europe/Vienna', 'Asia/Tokyo', 'Asia/Kathmandu', 'America/Phoenix'])(
    '%s: zonedInstant round-trips every minute of a day',
    (tz) => {
      for (let m = 0; m < 1440; m += 1) {
        const t = zonedInstant('2026-06-21', m, tz);
        expect(localDate(t, tz)).toBe('2026-06-21');
        expect(localMinutes(t, tz)).toBe(m);
      }
    }
  );

  it('Kathmandu is UTC+5:45 and Phoenix has no daylight saving', () => {
    expect(zonedInstant('2026-12-21', 720, 'Asia/Kathmandu').toISOString()).toBe(
      '2026-12-21T06:15:00.000Z'
    );
    expect(zonedInstant('2026-07-01', 720, 'America/Phoenix').toISOString()).toBe(
      '2026-07-01T19:00:00.000Z'
    );
  });

  it('a wall time in the spring-forward gap lands after it; one that happens twice is the first', () => {
    // Vienna, 2026-03-29: 02:00 became 03:00 (01:00Z). 2026-10-25: 03:00 became 02:00 (01:00Z).
    expect(zonedInstant('2026-03-29', 150, 'Europe/Vienna').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z'
    );
    expect(zonedInstant('2026-10-25', 150, 'Europe/Vienna').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z'
    );
  });

  it('the place decides, not the zone of the client', () => {
    const p = PLACES.fuji;
    const probe = () => ({
      noon: momentFor({ kind: 'named', id: 'noon' }, p, new Date('2026-12-21T05:00:00Z')).getTime(),
      free: momentFor({ kind: 'free', date: '2026-07-15', minutes: 330 }, p, new Date()).getTime(),
      date: localDate(new Date('2026-12-21T16:00:00Z'), p.tz),
      zi: zonedInstant('2026-03-29', 150, 'Europe/Vienna').getTime(),
    });
    const was = process.env.TZ;
    try {
      const seen = ['Pacific/Kiritimati', 'America/Anchorage', 'UTC'].map((tz) => {
        process.env.TZ = tz;
        return probe();
      });
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[2]).toEqual(seen[0]);
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });
});

describe('Fuji dawn is Japanese dawn', () => {
  it('lands in the Japanese morning, east of south-east, and a world away from the Vienna one', () => {
    const fuji = PLACES.fuji;
    const now = new Date('2026-12-21T04:00:00Z'); // local noon at Fuji
    const t = momentFor({ kind: 'named', id: 'dawn' }, fuji, now);
    const hourUtc = t.getUTCHours() + t.getUTCMinutes() / 60;
    expect(t.getUTCDate()).toBe(20); // the previous UTC day
    expect(hourUtc).toBeGreaterThan(20.5);
    expect(hourUtc).toBeLessThan(22);
    const s = sunAt(fuji, t);
    expect(s.elevation).toBeCloseTo(-3, 1);
    expect(s.azimuth).toBeGreaterThan(110);
    expect(s.azimuth).toBeLessThan(125);
    const vienna = momentFor({ kind: 'named', id: 'dawn' }, PLACES.vienna, now);
    expect(Math.abs(vienna.getTime() - t.getTime()) / 3_600_000).toBeGreaterThan(7);
    expect(Math.abs(vienna.getTime() - t.getTime()) / 3_600_000).toBeLessThan(9.5);
  });
});

describe("Night is tonight's, the nearest one", () => {
  const night = { kind: 'named', id: 'night' } as const;
  const p = PLACES.vienna;
  it('at 00:30 it is the midnight coming within the hour, not the one a day ahead; after noon the one coming', () => {
    const at = Date.parse('2026-06-21T22:30:00Z'); // 00:30 on June 22, Vienna
    const early = momentFor(night, p, new Date(at));
    expect(localDate(early, p.tz)).toBe('2026-06-22');
    expect(early.getTime() - at).toBeGreaterThan(0);
    expect(early.getTime() - at).toBeLessThan(2 * 3_600_000);
    const evening = momentFor(night, p, new Date('2026-06-22T12:00:00Z')); // 14:00 June 22
    expect(localDate(evening, p.tz)).toBe('2026-06-23');
    expect(evening.getTime() - early.getTime()).toBeGreaterThan(23.9 * 3_600_000);
    expect(evening.getTime() - early.getTime()).toBeLessThan(24.1 * 3_600_000);
    expect(momentFor(night, p, new Date('2026-06-22T18:00:00Z')).getTime()).toBe(evening.getTime());
  });
  it('the key follows the instant drawn: it is the same across the midnight roll and changes at the noon side', () => {
    const k = (iso: string) => momentKey(night, p, new Date(iso));
    expect(k('2026-06-21T22:30:00Z')).toBe(k('2026-06-21T21:30:00Z')); // 00:30 and 23:30
    expect(k('2026-06-21T22:30:00Z')).not.toBe(k('2026-06-22T12:00:00Z'));
    expect(k('2026-06-22T12:00:00Z')).toBe(k('2026-06-22T20:00:00Z'));
  });
});

describe('purity and bands', () => {
  it('auto is the time it is given', () => {
    const now = new Date('2026-05-05T05:05:05Z');
    expect(momentFor({ kind: 'auto' }, PLACES.vienna, now)).toBe(now);
    expect(momentKey({ kind: 'auto' }, PLACES.vienna, now)).toBe('live');
  });

  it('a free moment is the place-local wall time, held inside 1900..2100', () => {
    const p = PLACES.vienna;
    const t = momentFor({ kind: 'free', date: '2026-12-21', minutes: 400 }, p, new Date());
    expect(localDate(t, p.tz)).toBe('2026-12-21');
    expect(localMinutes(t, p.tz)).toBe(400);
    expect(
      localDate(momentFor({ kind: 'free', date: '1800-01-01', minutes: 0 }, p, new Date()), p.tz)
    ).toBe('1900-01-01');
    expect(
      localDate(momentFor({ kind: 'free', date: '2999-05-05', minutes: 0 }, p, new Date()), p.tz)
    ).toBe('2100-12-31');
  });

  it('skyBand: day at 6.0, night at -6.0, dusk between', () => {
    expect(skyBand(DAY_FROM)).toBe('day');
    expect(skyBand(-DAY_FROM)).toBe('night');
    expect(skyBand(DAY_FROM - 0.001)).toBe('dusk');
    expect(skyBand(-DAY_FROM + 0.001)).toBe('dusk');
    expect(skyBand(0)).toBe('dusk');
    expect(skyBand(80)).toBe('day');
    expect(skyBand(-80)).toBe('night');
  });

  it('the key of a moment follows its local date and id, or its date and minutes', () => {
    const p = PLACES.vienna;
    const n = { kind: 'named', id: 'noon' } as const;
    expect(momentKey(n, p, new Date('2026-06-21T10:00:00Z'))).toBe(
      momentKey(n, p, new Date('2026-06-21T20:00:00Z'))
    );
    expect(momentKey(n, p, new Date('2026-06-21T10:00:00Z'))).not.toBe(
      momentKey(n, p, new Date('2026-06-22T10:00:00Z'))
    );
    expect(momentKey({ kind: 'free', date: '2026-06-21', minutes: 5 }, p, new Date())).not.toBe(
      momentKey({ kind: 'free', date: '2026-06-21', minutes: 10 }, p, new Date())
    );
  });
});

describe('the picker seed', () => {
  it('opens from the moment Auto or a named choice is drawing, in the place zone, to the 5 minutes the slider steps', () => {
    const p = PLACES.fuji;
    const now = new Date('2026-12-21T04:03:00Z'); // 13:03 at Fuji
    expect(seedFree({ kind: 'auto' }, p, now)).toEqual({
      kind: 'free',
      date: '2026-12-21',
      minutes: 13 * 60,
    });
    const noon = seedFree({ kind: 'named', id: 'noon' }, p, now);
    expect(noon.date).toBe('2026-12-21');
    expect(Math.abs(noon.minutes - 11 * 60 - 45)).toBeLessThanOrEqual(15); // solar noon at 138.6 E is about 11:45 JST
    expect(noon.minutes % 5).toBe(0);
    const free = { kind: 'free', date: '2026-07-15', minutes: 330 } as const;
    expect(seedFree(free, p, now)).toBe(free);
  });
});
