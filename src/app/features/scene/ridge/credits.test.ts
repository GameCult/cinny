import { describe, expect, it } from 'vitest';
import { HORIZON_CREDIT, WEATHER_CREDIT, WEATHER_CREDIT_URL, WEATHER_DATASET } from './credits';
import { HORIZON_ATTRIBUTION } from './horizon';
import { WEATHER_ATTRIBUTION } from './weatherFeed';

describe('the credits the Sky menu shows', () => {
  it('are the sources\' own', () => {
    expect(HORIZON_CREDIT).toBe(HORIZON_ATTRIBUTION);
    expect(WEATHER_CREDIT).toBe(WEATHER_ATTRIBUTION);
  });
  it('credit GeoSphere with its requested line, and state a licence only with the dataset named', () => {
    expect(WEATHER_CREDIT).toBe(`Datenquelle: GeoSphere Austria - ${WEATHER_CREDIT_URL}`);
    expect(WEATHER_CREDIT).not.toMatch(/CC BY/);
    expect(WEATHER_DATASET).toMatch(/TAWES.*10-minute.*CC BY 4\.0/);
  });
});
