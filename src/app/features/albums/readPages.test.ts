import { describe, expect, it } from 'vitest';
import { Page, readPages } from './readPages';

const pager = (pages: Page<number>[]) => {
  const froms: (string | undefined)[] = [];
  return {
    froms,
    fetchPage: async (from: string | undefined) => {
      froms.push(from);
      return pages[froms.length - 1] ?? {};
    },
  };
};

describe('readPages', () => {
  it('one page without a token is the whole read', async () => {
    const p = pager([{ chunk: [1, 2] }]);
    expect(await readPages(p.fetchPage)).toEqual({ items: [1, 2], truncated: false });
    expect(p.froms).toEqual([undefined]);
  });

  it('follows next_batch in order, passing each token back', async () => {
    const p = pager([
      { chunk: [1], next_batch: 'a' },
      { chunk: [2], next_batch: 'b' },
      { chunk: [3] },
    ]);
    expect(await readPages(p.fetchPage)).toEqual({ items: [1, 2, 3], truncated: false });
    expect(p.froms).toEqual([undefined, 'a', 'b']);
  });

  it('a missing chunk reads as empty', async () => {
    expect(await readPages(async () => ({}))).toEqual({ items: [], truncated: false });
  });

  it('an empty page ends the read even when it carries a token', async () => {
    const p = pager([
      { chunk: [1], next_batch: 'a' },
      { chunk: [], next_batch: 'b' },
    ]);
    expect(await readPages(p.fetchPage)).toEqual({ items: [1], truncated: false });
    expect(p.froms).toHaveLength(2);
  });

  it('the cap stops the read and says it was cut short', async () => {
    const p = pager(Array.from({ length: 10 }, (_, i) => ({ chunk: [i], next_batch: `t${i}` })));
    expect(await readPages(p.fetchPage, 3)).toEqual({ items: [0, 1, 2], truncated: true });
    expect(p.froms).toHaveLength(3);
  });

  it('a last page exactly at the cap is not truncated', async () => {
    const p = pager([{ chunk: [1], next_batch: 'a' }, { chunk: [2] }]);
    expect((await readPages(p.fetchPage, 2)).truncated).toBe(false);
  });
});
