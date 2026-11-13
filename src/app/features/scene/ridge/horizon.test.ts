import { describe, expect, it } from 'vitest';
import bake from './viennaHorizon.json';
import { VIENNA } from './vienna';
import { horizonDistanceKm, horizonElevation, horizonNormal } from './horizon';

describe('the baked horizon', () => {
  it('was baked from the viewpoint the sun is computed for', () => {
    expect(bake.viewpoint.lat).toBe(VIENNA.lat);
    expect(bake.viewpoint.lon).toBe(VIENNA.lon);
    expect(bake.viewpoint.groundM / 1000).toBeCloseTo(VIENNA.altitudeKm, 2);
  });
  it('carries its source and licence beside the data', () => {
    expect(bake.source.licence).toMatch(/attribution required/);
    expect(bake.source.attribution).toMatch(/COPERNICUS/);
  });
  it('is a closed ring of plausible angles: the Wienerwald NW, open Marchfeld E', () => {
    expect(bake.elevationDeg).toHaveLength(720);
    expect(horizonElevation(0)).toBeCloseTo(horizonElevation(360), 6);
    expect(horizonElevation(305)).toBeGreaterThan(horizonElevation(70));
    expect(Math.max(...bake.elevationDeg)).toBeLessThan(5);
    expect(horizonDistanceKm(305)).toBeGreaterThan(1);
  });
  it('interpolates between samples and returns unit normals', () => {
    expect(horizonElevation(100.25)).toBeCloseTo(
      (bake.elevationDeg[200] + bake.elevationDeg[201]) / 2,
      6
    );
    expect(Math.hypot(...horizonNormal(250))).toBeCloseTo(1, 6);
  });
});
