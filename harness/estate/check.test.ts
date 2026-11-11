// @vitest-environment node
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// A drive that asserts nothing proves nothing: its exit code must say so.
const fresh = () => {
  const require = createRequire(import.meta.url);
  const path = require.resolve('./check.cjs');
  delete require.cache[path];
  return require('./check.cjs') as {
    expect: (label: string, ok: boolean, detail?: string) => void;
    done: () => number;
  };
};

describe('estate drive exit code', () => {
  it('is 5 when no assertion ran', () => {
    expect(fresh().done()).toBe(5);
  });

  it('is 0 when assertions ran and all held', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const c = fresh();
    c.expect('holds', true);
    expect(c.done()).toBe(0);
  });

  it('is 4 when any assertion failed', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const c = fresh();
    c.expect('holds', true);
    c.expect('breaks', false, 'detail');
    expect(c.done()).toBe(4);
  });
});
