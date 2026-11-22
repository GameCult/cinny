// A hand-written manifest schema 3 and index v1 (wire form, as export.py writes them): the runtime's tests need no real bake and no decoder. The ring is
// four tiles of 90 degrees, so a tile is a quarter of the compass and wrap-around at north is easy to meet.
import type { View } from './view';

/** A card's distance in each of the fixture's four tiles, metres, nearest card first; null where the tile holds no such card (the third card is absent over the south). */
export const DISTANCES: (number | null)[][] = [
  [1000, 1200, 1400, 1100],
  [10000, 12000, 14000, 11000],
  [40000, 41000, null, 39000],
];

/** A schema 3 manifest of `k` cards (1 to 3, nearest first), each a band of the 600-row plane, over four tiles of 1600 columns. */
export const wireManifest = (
  over: Record<string, unknown> = {},
  k = 3
): Record<string, unknown> => ({
  schema: 3,
  baker_version: 4,
  bake_id: 'abc123abc123',
  place: {
    id: 'vienna',
    name: 'Vienna',
    lat: 48.19,
    lon: 16.35,
    altitude_km: 0.183,
    tz: 'Europe/Vienna',
    eye_m: 1.7,
  },
  view: {
    look_az_deg: 214,
    plane_h: 600,
    px_per_deg_h: 6400 / 360,
    px_per_deg_v: 171.7,
    exaggeration: 10,
    horizon_row: 357,
    sky_row: 24,
    near_row: 396,
    ring_w: 6400,
    tile_w: 1600,
    tiles: 4,
    apron: 2,
  },
  curvature: { r_earth_m: 6371000, k_ref: 0.13 },
  encoding: { log_d_min: 4.6, log_d_max: 11.5, normal: 'rt8' },
  camera: { r_max_m: 100 },
  cards: Array.from({ length: k }, (_, i) => ({
    near_m: i ? 1000 * 10 ** (i - 1) * 4 : null,
    far_m: i < k - 1 ? 4000 * 10 ** i : null,
  })),
  tiles: Array.from({ length: 4 }, (_, t) =>
    Array.from({ length: k }, (_, i) => {
      const d = DISTANCES[i][t];
      return d === null
        ? null
        : {
            top: 100 * i,
            h: 600 - 100 * i,
            distance_m: d,
            colour: { file: `card-${i}-t${String(t).padStart(2, '0')}-colour.webp`, bytes: 1 },
            geometry: { file: `card-${i}-t${String(t).padStart(2, '0')}-geometry.webp`, bytes: 1 },
          };
    })
  ),
  bytes: 0,
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

/** A View that differs from FALLBACK_VIEW in every field the sky reads (place, altitude, look azimuth, horizon row), so a test can tell the two apart. */
export const ELSEWHERE_VIEW: View = {
  place: { id: 'elsewhere', lat: -33.9, lon: 151.2, altitudeKm: 1.5, tz: 'Australia/Sydney' },
  lookAzDeg: 20,
  ringW: 3600,
  tileW: 900,
  tiles: 4,
  apron: 2,
  planeH: 700,
  pxPerDegH: 10,
  pxPerDegV: 100,
  horizonRow: 250,
};
