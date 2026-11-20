/* eslint-disable no-restricted-syntax, no-continue -- test loops over sample times */
import { describe, expect, it } from 'vitest';
import {
  SLOTS,
  TWINKLE_GAIN,
  TWINKLE_PERIOD,
  activeAt,
  slotCount,
  slotOffset,
  slotPeriod,
  twinkleGain,
} from './stars';

/** A field the size of a night's visible stars. */
const N = 1200;

function hash2(a: number, b: number) {
  return ((a * 7919 + b * 104729) % 1000) / 1000;
}

describe('twinkle schedule', () => {
  const times = Array.from({ length: 400 }, (_, i) => i * 0.37);

  it('is a pure function of (seed, time): same t, same set and values', () => {
    for (const t of [0, 0.4, 13.7, 3599.9]) expect(activeAt(N, t)).toEqual(activeAt(N, t));
  });

  it('the set is SLOTS stars at every sampled time (inside 24..48), never more than the field has', () => {
    expect(SLOTS).toBeGreaterThanOrEqual(24);
    expect(SLOTS).toBeLessThanOrEqual(48);
    for (const t of times) expect(activeAt(N, t)).toHaveLength(SLOTS);
    expect(activeAt(10, 5)).toHaveLength(10);
    expect(slotCount(10)).toBe(10);
    expect(activeAt(0, 5)).toHaveLength(0);
  });

  it('no star is twice in the set at one instant, and every index is a real star', () => {
    for (const t of times) {
      const ids = activeAt(N, t).map((a) => a.star);
      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((i) => expect(i >= 0 && i < N).toBe(true));
    }
  });

  it("periods are each slot's own, within 2..7 s, and the offsets differ", () => {
    for (let j = 0; j < SLOTS; j += 1) {
      expect(slotPeriod(j)).toBeGreaterThanOrEqual(TWINKLE_PERIOD.min);
      expect(slotPeriod(j)).toBeLessThanOrEqual(TWINKLE_PERIOD.max);
    }
    expect(new Set(Array.from({ length: SLOTS }, (_, j) => slotPeriod(j))).size).toBe(SLOTS);
    expect(new Set(Array.from({ length: SLOTS }, (_, j) => slotOffset(j))).size).toBe(SLOTS);
    for (const a of activeAt(N, 100)) expect(a.period).toBeCloseTo(slotPeriod(a.slot), 12);
  });

  it('over an hour every star twinkles at least once', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 3600; t += 1) for (const a of activeAt(N, t + 0.5)) seen.add(a.star);
    expect(seen.size).toBe(N);
  });

  it('a star joins at its base brightness and leaves at exactly base, with no pop', () => {
    const seed = { flip: false, ripple: 3, phase: 1 };
    expect(twinkleGain(0, seed)).toBe(1);
    expect(twinkleGain(1, seed)).toBe(1);
    for (const flip of [true, false])
      for (const e of [1e-4, 1 - 1e-4])
        expect(Math.abs(twinkleGain(e, { ...seed, flip }) - 1)).toBeLessThan(0.01);
    // through the schedule: the instant a twinkle ends the slot is on a new star's first instant, at gain 1
    for (let j = 0; j < SLOTS; j += 1) {
      const end = slotOffset(j) + 40 * slotPeriod(j);
      const at = activeAt(N, end).find((a) => a.slot === j)!;
      expect(at.gain).toBeCloseTo(1, 9);
    }
  });

  it('the star that joins is never the one that just left', () => {
    for (let j = 0; j < SLOTS; j += 1) {
      let prev = -1;
      for (let k = 0; k < 300; k += 1) {
        const t = slotOffset(j) + (k + 0.5) * slotPeriod(j);
        const { star } = activeAt(N, t).find((a) => a.slot === j)!;
        expect(star).not.toBe(prev);
        prev = star;
      }
    }
  });

  it('joins never coincide: every (slot, cycle) start over an hour is distinct', () => {
    const starts: number[] = [];
    for (let j = 0; j < SLOTS; j += 1)
      for (let k = 0; slotOffset(j) + k * slotPeriod(j) < 3600; k += 1)
        starts.push(slotOffset(j) + k * slotPeriod(j));
    starts.sort((a, b) => a - b);
    let min = Infinity;
    for (let i = 1; i < starts.length; i += 1) min = Math.min(min, starts[i] - starts[i - 1]);
    expect(min).toBeGreaterThan(0);
    console.log(`joins/hour ${starts.length}, min gap between joins ${(min * 1000).toFixed(3)} ms`);
  });

  it('dims deeper than it brightens, within 0.35x..1.15x', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < 20; j += 1)
      for (let k = 0; k < 20; k += 1) {
        const seed = { flip: hash2(j, k) < 0.5, ripple: 2 + (k % 2), phase: j + k };
        for (let i = 0; i <= 200; i += 1) {
          const g = twinkleGain(i / 200, seed);
          lo = Math.min(lo, g);
          hi = Math.max(hi, g);
        }
      }
    expect(lo).toBeGreaterThanOrEqual(TWINKLE_GAIN.dim - 1e-9);
    expect(hi).toBeLessThanOrEqual(TWINKLE_GAIN.bright + 1e-9);
    expect(1 - lo).toBeGreaterThan(2 * (hi - 1));
  });

  it('stars outside the set are steady: only the active ones have a gain to apply', () => {
    const inSet = new Set(activeAt(N, 50).map((a) => a.star));
    expect(inSet.size).toBeLessThan(N / 4);
  });
});
