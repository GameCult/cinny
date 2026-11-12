import { describe, expect, it, vi } from 'vitest';
import { RECOVER_RELOAD_MIN_GAP_MS, reloadToRecoverSync } from './initMatrix';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => {
      m.set(k, v);
    } };
};

describe('reloadToRecoverSync', () => {
  it('reloads once, then refuses inside the gap so a down server cannot loop it', () => {
    const store = memory();
    const reload = vi.fn();
    expect(reloadToRecoverSync(1_000_000, store, reload)).toBe(true);
    expect(reloadToRecoverSync(1_000_000 + RECOVER_RELOAD_MIN_GAP_MS - 1, store, reload)).toBe(false);
    expect(reloadToRecoverSync(1_000_000 + RECOVER_RELOAD_MIN_GAP_MS, store, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
