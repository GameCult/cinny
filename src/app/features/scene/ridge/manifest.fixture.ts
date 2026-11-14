// A hand-written manifest v1 and index v1 (wire form, as export.py writes them): the runtime's tests need no real bake and no decoder.
import { FRAME_KEYS } from './manifest';
import type { View } from './view';

const SUN: Record<typeof FRAME_KEYS[number], [number, number]> = {
  dawn: [100, 0],
  morning: [130, 20],
  noon: [180, 60],
  golden: [240, 6],
  dusk: [262, -2.5],
  night: [0, -12],
};

export const wireManifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1,
  baker_version: 1,
  bake_id: 'abc123abc123',
  place: {
    id: 'vienna',
    name: 'Vienna',
    lat: 48.19,
    lon: 16.35,
    altitude_km: 0.183,
    tz_h: 1,
    tz_name: 'CET',
    date: '2026-06-21',
  },
  view: {
    look_az_deg: 214,
    window_deg: 72,
    plane_w: 1280,
    plane_h: 600,
    px_per_deg_h: 1280 / 72,
    px_per_deg_v: 17.7,
    horizon_row: 314.5,
    sky_row: 0,
    near_row: 599,
  },
  frames: FRAME_KEYS.map((key) => ({
    key,
    sun: { az: SUN[key][0], el: SUN[key][1] },
    hour_utc: 0,
    planes: Object.fromEntries(
      ['far', 'mid', 'near'].map((n) => [
        n,
        { file: `${key}-${n}.webp`, bytes: 1, w: 1280, h: 600 },
      ])
    ),
    bytes: 3,
    luma: { min: 0.1, max: 0.5 },
  })),
  attribution: {
    credit_line: 'credit',
    licence: 'licence',
    dem_source: 'dem',
    url: 'https://example.test',
  },
  ...over,
});

export const wireIndex = {
  schema: 1,
  default: 'vienna',
  places: { vienna: 'vienna-abc123abc123', graz: 'graz-def456def456' },
};

/** A View that differs from FALLBACK_VIEW in every field the sky reads (place, altitude, look azimuth, window, horizon row), so a test can tell the two apart. */
export const ELSEWHERE_VIEW: View = {
  place: { id: 'elsewhere', lat: -33.9, lon: 151.2, altitudeKm: 1.5 },
  lookAzDeg: 20,
  windowDeg: 90,
  planeW: 1600,
  planeH: 700,
  pxPerDegH: 1600 / 90,
  horizonRow: 250,
};
