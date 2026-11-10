import { describe, expect, it } from 'vitest';
import { mapLimit } from './mapLimit';

describe('mapLimit', () => {
  it('keeps result order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => {
        setTimeout(r, n);
      });
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
  it('handles an empty list and rejects when a call rejects', async () => {
    expect(await mapLimit([], 3, async (n) => n)).toEqual([]);
    await expect(
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });
});
