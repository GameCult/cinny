/* eslint-disable @typescript-eslint/no-explicit-any -- DOM stubs, as the other scene tests */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showTierLabel } from './tierLabel';

let search: string;
let appended: any[];
const canvas = (parent: boolean) =>
  ({
    parentElement: parent
      ? {
          appendChild: (e: any) => appended.push(e),
        }
      : null,
  } as any);

beforeEach(() => {
  search = '';
  appended = [];
  vi.stubGlobal('window', {
    get location() {
      return { search };
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, remove: vi.fn(), textContent: '' }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('showTierLabel', () => {
  it('adds nothing in a normal build', () => {
    expect(showTierLabel(canvas(true), 'full')).toBeNull();
    expect(appended).toHaveLength(0);
  });

  it('names the path on screen when asked with ?tierlabel=1, and removes itself', () => {
    search = '?tierlabel=1';
    const remove = showTierLabel(canvas(true), 'sky-only');
    expect(appended).toHaveLength(1);
    expect(appended[0].textContent).toBe('terrain · sky-only');
    remove!();
    expect(appended[0].remove).toHaveBeenCalled();
  });

  it('has nowhere to go without a parent', () => {
    search = '?tierlabel=1';
    expect(showTierLabel(canvas(false), 'full')).toBeNull();
  });
});
