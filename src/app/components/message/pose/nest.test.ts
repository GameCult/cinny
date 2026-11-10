import { describe, expect, it } from 'vitest';
import { alphaBounds, nestView } from './nest';
import boxes from './safeBoxes.json';

describe('nestView', () => {
  // Aqua neutral: 560x374, safe box [144,22,492,317] (right margin 68, top 22).
  it('crops half the right and top margins for a top-right nest', () => {
    expect(nestView([144, 22, 492, 317], [560, 374], true)).toEqual({
      x: 0,
      y: 11,
      width: 526,
      height: 363,
    });
  });

  it('crops the left margin instead for a top-left nest', () => {
    expect(nestView([144, 22, 492, 317], [560, 374], false)).toEqual({
      x: 72,
      y: 11,
      width: 488,
      height: 363,
    });
  });

  it('never crops the top of art already touching it (smug, headband at y=0)', () => {
    const v = nestView([140, 0, 487, 241], [560, 374], true);
    expect(v.y).toBe(0);
    expect(v.height).toBe(374);
  });

  it('can take the whole margin', () => {
    expect(nestView([10, 4, 90, 50], [100, 60], true, 1)).toEqual({
      x: 0,
      y: 4,
      width: 90,
      height: 56,
    });
  });

  it('keeps every measured safe box intact at the default share', () => {
    const aqua = boxes.aqua as Record<string, number[]>;
    expect(Object.keys(aqua)).toHaveLength(15);
    Object.values(aqua).forEach(([x0, y0, x1, y1, w, h]) => {
      const right = nestView([x0, y0, x1, y1], [w, h], true);
      expect(right.x).toBeLessThanOrEqual(x0);
      expect(right.x + right.width).toBeGreaterThanOrEqual(x1);
      expect(right.y).toBeLessThanOrEqual(y0);
      const left = nestView([x0, y0, x1, y1], [w, h], false);
      expect(left.x).toBeLessThanOrEqual(x0);
      expect(left.x + left.width).toBe(w);
    });
  });
});

describe('alphaBounds', () => {
  it('finds the opaque rectangle', () => {
    const w = 6;
    const h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    [
      [2, 1],
      [4, 3],
    ].forEach(([x, y]) => {
      data[(y * w + x) * 4 + 3] = 255;
    });
    expect(alphaBounds(data, w, h)).toEqual([2, 1, 5, 4]);
  });

  it('reports nothing for an empty image', () => {
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeUndefined();
  });
});
