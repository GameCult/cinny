import { describe, expect, it } from 'vitest';
import { drawRainTile, RAIN_TILES, streakCount } from './rain';

const recorder = () => {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) =>
      k in t ? t[k] : (...a: unknown[]) => calls.push(`${k}(${a.join(',')})`),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe('rain', () => {
  it('draws no streaks without rain and more with more', () => {
    expect(streakCount(RAIN_TILES[0], 0)).toBe(0);
    expect(streakCount(RAIN_TILES[0], 0.3)).toBeLessThan(streakCount(RAIN_TILES[0], 1));
    const { ctx, calls } = recorder();
    drawRainTile(ctx, RAIN_TILES[0], 0, [200, 210, 220], 1);
    expect(calls.filter((c) => c.startsWith('stroke'))).toHaveLength(0);
  });
  it('is the same tile every time, and every streak is drawn in the nine wraps so the tile repeats without a seam', () => {
    const a = recorder();
    const b = recorder();
    drawRainTile(a.ctx, RAIN_TILES[1], 1, [200, 210, 220], 1);
    drawRainTile(b.ctx, RAIN_TILES[1], 1, [200, 210, 220], 1);
    expect(a.calls).toEqual(b.calls);
    expect(a.calls.filter((c) => c.startsWith('stroke'))).toHaveLength(
      streakCount(RAIN_TILES[1], 1) * 9
    );
  });
});
