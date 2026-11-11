import { describe, expect, it } from 'vitest';
import { fetchObservation, parseTawes, weatherFromObservation } from './weatherFeed';

const tawes = (RR: number | null, RF: number | null, SO: number | null) => ({
  features: [{ properties: { parameters: { RR: { data: [RR] }, RF: { data: [RF] }, SO: { data: [SO] } } } }],
});

describe('weather from the TAWES observation', () => {
  it('rain is 0.8..1, by rate', () => {
    expect(weatherFromObservation({ rainMm: 0.1, humidity: 100, sunshineS: 0 }, false)).toBeCloseTo(0.813, 2);
    expect(weatherFromObservation({ rainMm: 3, humidity: 100, sunshineS: 0 }, true)).toBe(1);
  });
  it('a sunny dry day is clear and a sunless day overcast', () => {
    expect(weatherFromObservation({ rainMm: 0, humidity: 40, sunshineS: 600 }, true)).toBe(0);
    expect(weatherFromObservation({ rainMm: 0, humidity: 70, sunshineS: 0 }, true)).toBeCloseTo(0.55, 2);
  });
  it('a dry night is clear unless the air is saturated', () => {
    expect(weatherFromObservation({ rainMm: 0, humidity: 60, sunshineS: 0 }, false)).toBe(0);
    expect(weatherFromObservation({ rainMm: 0, humidity: 100, sunshineS: 0 }, false)).toBeCloseTo(0.75, 2);
  });
  it('parses the live response shape and rejects one without rain or humidity', () => {
    expect(parseTawes(tawes(0.1, 100, 0))).toEqual({ rainMm: 0.1, humidity: 100, sunshineS: 0 });
    expect(parseTawes(tawes(null, 100, 0))).toBeNull();
    expect(parseTawes({})).toBeNull();
  });
  it('a failed request is no observation', async () => {
    expect(await fetchObservation((async () => ({ ok: false })) as unknown as typeof fetch)).toBeNull();
  });
});
