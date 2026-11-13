import { describe, expect, it } from 'vitest';
import { viennaSun } from './vienna';
import {
  CLEAR_SKY,
  currentWeather,
  fetchWeatherFile,
  parseWeatherFile,
  OBSERVATION_STALE_MS,
  STALE_MS,
  WEATHER_ATTRIBUTION,
  weatherFromFile,
  clearSkyGhi,
  cloudEstimate,
  cloudFromGlow,
  WeatherFile,
} from './weatherFeed';

const file = (over: Partial<WeatherFile> = {}): WeatherFile => ({
  fetched_at: '2026-11-11T10:45:00Z',
  observed_at: '2026-11-11T10:40:00Z',
  station: 11035,
  precip_mm_10min: 0,
  humidity_pct: 60,
  glow_wm2: null,
  sunshine_s_10min: null,
  attribution: WEATHER_ATTRIBUTION,
  ...over,
});
const NOW = new Date('2026-11-11T10:50:00Z');

describe('weather from the file', () => {
  it('credits GeoSphere as its legal page asks, and claims no licence', () => {
    expect(WEATHER_ATTRIBUTION).toBe(
      'Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at'
    );
    expect(WEATHER_ATTRIBUTION).not.toMatch(/CC/);
  });
  it('rain is 0.8..1, by rate', () => {
    expect(weatherFromFile(file({ precip_mm_10min: 0.1 }), 20)).toBeCloseTo(0.813, 2);
    expect(weatherFromFile(file({ precip_mm_10min: 3 }), -20)).toBe(1);
  });
  it('the clear-sky radiation is Haurwitz: about 335 W/m2 at 21 degrees, none below the horizon', () => {
    expect(clearSkyGhi(21)).toBeCloseTo(335, -1);
    expect(clearSkyGhi(-5)).toBe(0);
  });
  it('noon clear: radiation at the clear-sky value is no cloud', () => {
    expect(
      weatherFromFile(
        file({ glow_wm2: clearSkyGhi(21), sunshine_s_10min: 600, humidity_pct: 95 }),
        21
      )
    ).toBe(0);
    expect(cloudFromGlow(300, 21)).toBeCloseTo(0.56, 1); // k = 0.9 is still a few oktas
  });
  it('noon overcast: a fifth of the clear-sky radiation is nearly full cloud, and with saturated air, mist', () => {
    expect(cloudFromGlow(0.2 * clearSkyGhi(21), 21)).toBeGreaterThan(0.9);
    expect(
      weatherFromFile(file({ glow_wm2: 0.2 * clearSkyGhi(21), humidity_pct: 80 }), 21)
    ).toBeGreaterThan(0.6);
    expect(weatherFromFile(file({ glow_wm2: 0.2 * clearSkyGhi(21), humidity_pct: 100 }), 21)).toBe(
      0.75
    );
  });
  it('the radiation, not the humidity, decides by day: humid air under a bright sky is clear', () => {
    expect(
      weatherFromFile(
        file({ glow_wm2: clearSkyGhi(30), sunshine_s_10min: 600, humidity_pct: 98 }),
        30
      )
    ).toBe(0);
  });
  it('dusk: with the sun at 3 degrees the humidity ramp speaks, cloud 0 at 60% and 1 at 95%', () => {
    expect(weatherFromFile(file({ glow_wm2: 5, sunshine_s_10min: 0, humidity_pct: 60 }), 3)).toBe(
      0
    );
    expect(
      weatherFromFile(file({ glow_wm2: 5, sunshine_s_10min: 0, humidity_pct: 77.5 }), 3)
    ).toBeCloseTo(0.35, 2);
    expect(
      weatherFromFile(file({ glow_wm2: 5, sunshine_s_10min: 0, humidity_pct: 95 }), 3)
    ).toBeCloseTo(0.7, 2);
  });
  it('night: the radiation and sunshine are 0.0 and the humidity speaks; saturated air is mist, 0.75', () => {
    expect(weatherFromFile(file({ glow_wm2: 0, humidity_pct: 40 }), -20)).toBe(0);
    expect(weatherFromFile(file({ glow_wm2: 0, humidity_pct: 100 }), -20)).toBe(0.75);
  });
  it('the 2026-11-10 midday fixture, GLOW 56-89 W/m2 under an overcast sky, is full cloud; the clear midday of 2026-10-15, 546-569, is none', () => {
    const nov = viennaSun(new Date('2026-11-10T10:40:00Z')).elevation;
    const oct = viennaSun(new Date('2026-10-15T10:50:00Z')).elevation;
    for (const g of [56, 72, 89]) expect(cloudFromGlow(g, nov)).toBeGreaterThan(0.95);
    for (const g of [546, 569]) expect(cloudFromGlow(g, oct)).toBe(0);
    expect(weatherFromFile(file({ glow_wm2: 72, sunshine_s_10min: 0 }), nov)).toBeGreaterThan(0.65);
    expect(
      weatherFromFile(file({ glow_wm2: 560, sunshine_s_10min: 600, humidity_pct: 70 }), oct)
    ).toBe(0);
  });
  it('the sunshine cross-checks the radiation: agreement keeps the radiation, a half-sky disagreement splits it', () => {
    expect(
      cloudEstimate(file({ glow_wm2: 0.2 * clearSkyGhi(21), sunshine_s_10min: 0 }), 21)
    ).toBeGreaterThan(0.9);
    // Radiation says clear, the sunshine says none: each is half trusted.
    expect(cloudEstimate(file({ glow_wm2: clearSkyGhi(21), sunshine_s_10min: 0 }), 21)).toBe(0.5);
    // No radiation reading by day: the sunshine speaks alone.
    expect(cloudEstimate(file({ glow_wm2: null, sunshine_s_10min: 300 }), 21)).toBe(0.5);
    expect(cloudEstimate(file({ glow_wm2: 0, sunshine_s_10min: 600 }), 21)).toBe(0);
  });
  it("with the sun below the instruments' reach there is no estimate: the humidity speaks", () => {
    expect(cloudEstimate(file({ glow_wm2: 3, sunshine_s_10min: 0 }), 3)).toBeNull();
  });
  it('null: unknown measurements are not zero, and nothing known is a clear sky', () => {
    expect(
      weatherFromFile(
        file({ glow_wm2: null, humidity_pct: null, precip_mm_10min: null, sunshine_s_10min: null }),
        21
      )
    ).toBe(CLEAR_SKY);
    expect(weatherFromFile(file({ glow_wm2: null, humidity_pct: 95 }), 21)).toBeCloseTo(0.7, 2);
  });
});

describe('the weather now', () => {
  it('uses the file while it is fresh', () => {
    expect(currentWeather(file({ glow_wm2: 0, humidity_pct: 95 }), NOW)).toBeCloseTo(0.7, 2);
  });
  it('falls back to a clear sky when the file was fetched more than 30 minutes ago', () => {
    const f = file({ humidity_pct: 100, fetched_at: '2026-11-11T10:19:00Z' });
    expect(NOW.getTime() - Date.parse(f.fetched_at)).toBeGreaterThan(STALE_MS);
    expect(currentWeather(f, NOW)).toBe(CLEAR_SKY);
  });
  it('the 30 minute mark itself is still fresh', () => {
    expect(
      currentWeather(
        file({ glow_wm2: 0, humidity_pct: 100, fetched_at: '2026-11-11T10:20:00Z' }),
        NOW
      )
    ).toBe(0.75);
  });
  it('falls back to a clear sky when the observation is more than 40 minutes old, though the file is fresh', () => {
    const f = file({ precip_mm_10min: 2, observed_at: '2026-11-11T10:09:00Z' });
    expect(NOW.getTime() - Date.parse(f.observed_at)).toBeGreaterThan(OBSERVATION_STALE_MS);
    expect(currentWeather(f, NOW)).toBe(CLEAR_SKY);
    expect(
      currentWeather(file({ precip_mm_10min: 2, observed_at: '2026-11-11T10:11:00Z' }), NOW)
    ).toBeGreaterThan(0.8);
  });
  it('falls back to a clear sky with no file, and with a fetch time from the future', () => {
    expect(currentWeather(null, NOW)).toBe(CLEAR_SKY);
    expect(
      currentWeather(file({ precip_mm_10min: 2, fetched_at: '2026-11-12T10:40:00Z' }), NOW)
    ).toBe(CLEAR_SKY);
  });
});

describe('bad instrument values', () => {
  it('a negative sunshine is no reading, not full cloud', () => {
    expect(cloudEstimate(file({ glow_wm2: null, sunshine_s_10min: -5 }), 21)).toBeNull();
  });
  it('the radiation is set against the sun of the ten minutes it averaged, not the sun now', () => {
    // Sun rising: 07:45Z observation (mean of 07:35-07:45), read 35 minutes later at the stale limit.
    const f = file({
      observed_at: '2026-11-11T07:45:00Z',
      fetched_at: '2026-11-11T07:46:00Z',
      glow_wm2: 100,
      sunshine_s_10min: null,
      humidity_pct: 50,
    });
    const at = (m: number) => currentWeather(f, new Date(Date.parse(f.observed_at) + m * 60_000));
    expect(at(0)).toBe(at(29));
  });
});

describe('reading weather.json', () => {
  it("reads Eureka's file as the host writes it: Z times, a whole-station gap as nulls, 0.0 at night", () => {
    const night = JSON.parse(
      '{"fetched_at":"2026-11-11T22:48:22Z","observed_at":"2026-11-11T22:40:00Z","station":11035,"precip_mm_10min":0.1,"humidity_pct":100.0,"sunshine_s_10min":0.0,"glow_wm2":0.0,"attribution":"Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at"}'
    );
    expect(parseWeatherFile(night)).toMatchObject({
      precip_mm_10min: 0.1,
      humidity_pct: 100,
      glow_wm2: 0,
      sunshine_s_10min: 0,
    });
    const gap = parseWeatherFile({
      ...night,
      precip_mm_10min: null,
      humidity_pct: null,
      sunshine_s_10min: null,
      glow_wm2: null,
    });
    expect(gap).toMatchObject({
      precip_mm_10min: null,
      humidity_pct: null,
      sunshine_s_10min: null,
      glow_wm2: null,
    });
    expect(currentWeather(gap, new Date('2026-11-11T22:50:00Z'))).toBe(CLEAR_SKY);
  });
  it("is not another station's file", () => {
    expect(parseWeatherFile({ ...file(), station: 11036 })).toBeNull();
  });
  it('parses the agreed shape, keeping nulls and the sunshine it never reads', () => {
    const raw = { ...file(), precip_mm_10min: null, glow_wm2: 12, sunshine_s_10min: 0 };
    expect(parseWeatherFile(raw)).toEqual(raw);
  });
  it('rejects a body without usable times, and anything not an object', () => {
    expect(parseWeatherFile({ ...file(), observed_at: 'yesterday' })).toBeNull();
    expect(parseWeatherFile({ ...file(), fetched_at: undefined })).toBeNull();
    expect(parseWeatherFile(null)).toBeNull();
    expect(parseWeatherFile('x')).toBeNull();
  });
  it("rejects a time with no zone: it would be read in the client's local time", () => {
    expect(parseWeatherFile({ ...file(), observed_at: '2026-11-10T10:40:00' })).toBeNull();
    expect(
      parseWeatherFile({ ...file(), observed_at: '2026-11-10T11:40:00+01:00' })
    ).not.toBeNull();
  });
  it('is no observation when the file is missing, fails, or is not JSON', async () => {
    expect(
      await fetchWeatherFile('/weather.json', (async () => ({
        ok: false,
      })) as unknown as typeof fetch)
    ).toBeNull();
    expect(
      await fetchWeatherFile('/weather.json', (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch)
    ).toBeNull();
    expect(
      await fetchWeatherFile('/weather.json', (async () => ({
        ok: true,
        json: async () => {
          throw new Error('bad');
        },
      })) as unknown as typeof fetch)
    ).toBeNull();
  });
  it('reads a good file', async () => {
    const f = (async () => ({ ok: true, json: async () => file() })) as unknown as typeof fetch;
    expect(await fetchWeatherFile('/weather.json', f)).toEqual(file());
  });
});
