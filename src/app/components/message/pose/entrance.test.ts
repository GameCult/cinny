import { describe, expect, it } from 'vitest';
import { claimEntrance } from './entrance';

describe('claimEntrance', () => {
  it('animates a message once, never on a remount', () => {
    expect(claimEntrance('$once', 1_000_000)).toBe(0);
    expect(claimEntrance('$once', 1_000_500)).toBeUndefined();
  });
  it('staggers messages that mount together, capped so a long backlog still lands fast', () => {
    const t = 2_000_000;
    const delays = ['$a', '$b', '$c', '$d', '$e', '$f'].map((id) => claimEntrance(id, t));
    expect(delays.slice(0, 3)).toEqual([0, 300, 600]);
    expect(Math.max(...(delays as number[]))).toBe(900);
  });
  it('lets a lone later message in at once', () => {
    claimEntrance('$x', 3_000_000);
    expect(claimEntrance('$y', 3_010_000)).toBe(0);
  });
});
