import { describe, expect, it } from 'vitest';
import { PUBLISH_KEY, foldVersions, replacesOf } from './versions';

type F = { id: string; sender: string; content: Record<string, unknown>; earlier: F[] };
const f = (id: string, replaces?: string, sender = '@m:x'): F => ({
  id,
  sender,
  content: replaces ? { [PUBLISH_KEY]: { replaces } } : {},
  earlier: [],
});
const shape = (files: F[]): unknown => files.map((x) => [x.id, x.earlier.map((e) => e.id)]);

describe('replacesOf', () => {
  it('reads the id the publisher key names', () => {
    expect(replacesOf({ [PUBLISH_KEY]: { replaces: '$a' } })).toBe('$a');
  });
  it('anything else says nothing', () => {
    expect(replacesOf({})).toBeUndefined();
    expect(replacesOf({ [PUBLISH_KEY]: {} })).toBeUndefined();
    expect(replacesOf({ [PUBLISH_KEY]: { replaces: 3 } })).toBeUndefined();
    expect(replacesOf({ [PUBLISH_KEY]: { replaces: '' } })).toBeUndefined();
    expect(replacesOf({ [PUBLISH_KEY]: 'x' })).toBeUndefined();
  });
});

describe('foldVersions', () => {
  it('files that replace nothing pass through in order, with nothing folded', () => {
    expect(shape(foldVersions([f('$a'), f('$b')]))).toEqual([
      ['$a', []],
      ['$b', []],
    ]);
  });

  it('shows the latest of a chain with earlier versions nearest first', () => {
    expect(shape(foldVersions([f('$a'), f('$b', '$a'), f('$c', '$b')]))).toEqual([
      ['$c', ['$b', '$a']],
    ]);
  });

  it('keeps unrelated files beside a chain, in order', () => {
    expect(shape(foldVersions([f('$a'), f('$x'), f('$b', '$a')]))).toEqual([
      ['$x', []],
      ['$b', ['$a']],
    ]);
  });

  it('a replacement whose target is not in the list stands alone', () => {
    expect(shape(foldVersions([f('$b', '$gone')]))).toEqual([['$b', []]]);
  });

  it('a file two others replace sits under both', () => {
    expect(shape(foldVersions([f('$a'), f('$b', '$a'), f('$c', '$a')]))).toEqual([
      ['$b', ['$a']],
      ['$c', ['$a']],
    ]);
  });

  it('a malformed loop shows no head and does not hang', () => {
    const out = foldVersions([f('$a', '$b'), f('$b', '$a'), f('$s', '$s')]);
    expect(out.map((x) => x.id)).toEqual(['$s']);
  });

  it('a loop reached from a head is walked once and ends', () => {
    const out = foldVersions([f('$a', '$b'), f('$b', '$a'), f('$h', '$a')]);
    expect(shape(out)).toEqual([['$h', ['$a', '$b']]]);
  });

  it('a replacement by another sender folds nothing', () => {
    const out = foldVersions([f('$victim', undefined, '@m:x'), f('$evil', '$victim', '@e:x')]);
    expect(shape(out)).toEqual([
      ['$victim', []],
      ['$evil', []],
    ]);
  });

  it('an empty list is empty', () => {
    expect(foldVersions([])).toEqual([]);
  });
});
