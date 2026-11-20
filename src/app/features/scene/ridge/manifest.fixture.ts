// A hand-written manifest v2 and index v1 (wire form, as export.py writes them): the runtime's tests need no real bake and no decoder.
import type { View } from './view';

/** Card scales of the fixture, nearest first, as the baker derives them for a camera 200 m forward (distances 1.2 km, 12 km, 40 km). */
const SCALES = [1.2, 1.0167, 1.005] as const;

/** A v2 manifest of `k` cards (1 to 6), nearest first, each a band of the 600-row plane. */
export const wireManifest = (
  over: Record<string, unknown> = {},
  k = 3
): Record<string, unknown> => ({
  schema: 2,
  baker_version: 2,
  bake_id: 'abc123abc123',
  place: {
    id: 'vienna',
    name: 'Vienna',
    lat: 48.19,
    lon: 16.35,
    altitude_km: 0.183,
    eye_m: 1.7,
  },
  view: {
    look_az_deg: 214,
    window_deg: 72,
    plane_w: 1280,
    plane_h: 600,
    px_per_deg_h: 1280 / 72,
    px_per_deg_v: 177.8,
    exaggeration: 10,
    horizon_row: 314.5,
    sky_row: 24,
    near_row: 396,
  },
  curvature: { r_earth_m: 6371000, k_ref: 0.13 },
  encoding: { log_d_min: 4.6, log_d_max: 11.5, normal: 'rt8' },
  camera: { r_m: 200, heading_max_deg: 23 },
  cards: Array.from({ length: k }, (_, i) => ({
    top: 100 * i,
    h: 600 - 100 * i,
    near_m: i ? 1000 * i : null,
    far_m: i < k - 1 ? 1000 * (i + 1) : null,
    median_m: 1000 * (i + 1),
    distance_m: 1000 * (i + 1),
    scale: SCALES[i] ?? 1.001,
    colour: { file: `card-${i}-colour.webp`, bytes: 1 },
    geometry: { file: `card-${i}-geometry.webp`, bytes: 1 },
  })),
  w: 1280,
  h: 600,
  bytes: 2 * k,
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
  pxPerDegV: 100,
  horizonRow: 250,
};
