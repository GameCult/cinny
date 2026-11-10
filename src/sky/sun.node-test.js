// Fixed-moment checks for sun.js. Plain node, no framework dependency:
//   node --test sun.node-test.js        (run from a copy next to sun.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { light, sunElevation } from './sun.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Greenwich, equator: sun overhead within a degree or two at equinox solar noon.
test('equinox noon on the equator: sun near the zenith, white-ish and bright', () => {
  const l = light({ time: '2026-03-20T12:00:00Z', lat: 0, lon: 0 });
  assert.ok(l.elevation > 85, `elevation ${l.elevation}`);
  assert.ok(l.direct[0] > 0.7 && l.direct[0] <= 1, `direct ${l.direct}`);
  assert.ok(l.direct[0] > l.direct[1] && l.direct[1] > l.direct[2], 'sun is warmer than white');
  assert.ok(l.diffuse[2] > l.diffuse[0], 'sky is blue');
  assert.equal(l.wetness, 0);
});

test('midsummer noon at Berlin: Meeus elevation 90 - 52.52 + 23.44 ~= 60.9', () => {
  near(sunElevation('2026-06-21T11:07:00Z', 52.52, 13.405), 60.9, 0.5, 'elevation');
});

test('midnight in Berlin in December: sun far below, direct is zero, sky at floor', () => {
  const l = light({ time: '2026-12-21T23:30:00Z', lat: 52.52, lon: 13.405 });
  assert.ok(l.elevation < -50, `elevation ${l.elevation}`);
  assert.deepEqual(l.direct, [0, 0, 0]);
  assert.ok(luma(l.diffuse) < 0.02, `diffuse ${l.diffuse}`);
  assert.ok(luma(l.diffuse) > 0, 'night is not pure black');
});

test('equinox sunrise on the equator at lon 0: ~06:00 UTC, sun on the horizon, red-orange and dim', () => {
  const l = light({ time: '2026-03-20T06:00:00Z', lat: 0, lon: 0 });
  near(l.elevation, 0, 2, 'elevation');
  const lo = light({ time: '2026-03-20T06:10:00Z', lat: 0, lon: 0 });
  assert.ok(lo.elevation > 0.5, `elevation ${lo.elevation}`);
  assert.ok(lo.direct[0] > 5 * lo.direct[2], `reddened ${lo.direct}`);
  assert.ok(lo.direct[0] < 0.5, `dim ${lo.direct}`);
});

test('cloud shrinks direct, grey-cools diffuse; rain is darker and wet', () => {
  const base = { time: '2026-06-21T11:07:00Z', lat: 52.52, lon: 13.405 };
  const clear = light(base);
  const cloudy = light({ ...base, cloud_cover: 1 });
  const rainy = light({ ...base, cloud_cover: 1, precipitation: 4 });
  assert.ok(luma(cloudy.direct) < 0.1 * luma(clear.direct));
  assert.ok(luma(cloudy.diffuse) > 0.5 * luma(clear.diffuse));
  const blueness = (c) => c[2] / c[0];
  assert.ok(blueness(cloudy.diffuse) < blueness(clear.diffuse), 'greyer');
  assert.ok(luma(rainy.diffuse) < luma(cloudy.diffuse), 'rain darker');
  assert.ok(rainy.wetness > 0.95 && cloudy.wetness === 0);
  assert.ok(light({ ...base, precipitation: 1 }).wetness > 0.6, 'rain with 0 cover still wet');
});

test('every channel is finite and non-negative across a day and bad inputs', () => {
  for (let h = 0; h < 24; h += 0.5) {
    for (const cc of [0, 0.5, 1, 7, -1]) {
      const l = light({ time: Date.UTC(2026, 10, 6, 0, 0) + h * 3600000, lat: 52.5, lon: 13.4, cloud_cover: cc, precipitation: cc > 0 ? 2 : 0 });
      for (const v of [...l.direct, ...l.diffuse, l.wetness]) assert.ok(Number.isFinite(v) && v >= 0, `${h} ${cc} ${v}`);
    }
  }
});
