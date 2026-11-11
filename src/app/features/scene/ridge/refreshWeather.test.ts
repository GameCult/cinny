import { describe, expect, it } from 'vitest';
// @ts-ignore the refresher is a plain node script
import { fileFromTawes } from '../../../../../scripts/refresh-weather.mjs';
import { parseWeatherFile } from './weatherFeed';

const live = {
  timestamps: ['2026-11-11T22:40+00:00'],
  features: [{ properties: { parameters: { RR: { data: [0.1] }, RF: { data: [100] }, GLOW: { data: [0] }, SO: { data: [0] } } } }],
};

describe('the reference refresher', () => {
  it('turns a TAWES response into the file the client parses, unchanged', () => {
    const f = fileFromTawes(live, new Date('2026-11-11T22:45:10Z'));
    expect(f).toEqual({
      fetched_at: '2026-11-11T22:45:10.000Z',
      observed_at: '2026-11-11T22:40:00.000Z',
      station: 11035,
      precip_mm_10min: 0.1,
      humidity_pct: 100,
      glow_wm2: 0,
      sunshine_s_10min: 0,
      attribution: 'Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at',
    });
    expect(parseWeatherFile(f)).toEqual(f);
  });
  it('keeps a missing measurement null and refuses a response with no observation time', () => {
    const f = fileFromTawes({ ...live, features: [{ properties: { parameters: { RR: { data: [null] } } } }] });
    expect([f?.precip_mm_10min, f?.humidity_pct, f?.glow_wm2, f?.sunshine_s_10min]).toEqual([null, null, null, null]);
    expect(fileFromTawes({ features: [] })).toBeNull();
  });
});
