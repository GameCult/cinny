import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from './optionsHashVectors.json';
import { entry } from './fixtures';
import { ForkCard } from './forkContract';
import {
  canonicalShown,
  optionsHash,
  shownOf,
  unverifiedForks,
  unverifiedOrAll,
} from './optionsHash';

describe('options_hash against the CultLib vectors', () => {
  it('has all fifteen vectors', () => {
    expect(vectors.optionsHash).toHaveLength(15);
  });
  vectors.optionsHash.forEach((v) => {
    it(`${v.name}: canonical bytes and sha256 match`, async () => {
      expect(canonicalShown(v)).toBe(v.canonical);
      expect(await optionsHash(v)).toBe(v.sha256);
    });
  });
});

describe('unverifiedForks', () => {
  const sealed = async (over: Partial<ForkCard> = {}) => {
    const e = entry('plain', over);
    return { ...e, card: { ...e.card, options_hash: await optionsHash(shownOf(e.card)) } };
  };
  it('passes a card whose hash is the hash of what it shows', async () => {
    expect(await unverifiedForks([await sealed()])).toEqual(new Set());
  });
  it('flags a card whose shown title, context, option, recommendation or depends changed after hashing', async () => {
    const e = await sealed();
    const edits: Partial<ForkCard>[] = [
      { title: 'Other' },
      { context: 'Other context.' },
      { options: [...e.card.options].reverse() },
      { recommendation: 'A' },
      { depends: ['new line'] },
    ];
    await Promise.all(
      edits.map(async (x) =>
        expect(
          await unverifiedForks([{ ...e, card: { ...e.card, ...x } }]),
          JSON.stringify(Object.keys(x))
        ).toEqual(new Set([e.card.fork_id]))
      )
    );
  });
  it('does not read fork_id, status, order, leans or flag, which are not shown members', async () => {
    const e = await sealed();
    const card = { ...e.card, fork_id: 'x:question:y', order: 7, leans: 'A', flag: 'f' };
    expect(await unverifiedForks([{ ...e, card }])).toEqual(new Set());
  });
});

describe('unverifiedOrAll', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('answers as unverifiedForks does when the check runs', async () => {
    const e = entry('plain');
    expect(await unverifiedOrAll([e])).toEqual(await unverifiedForks([e]));
  });
  it('withdraws every card when the check cannot run', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    const a = entry('a');
    const b = entry('b');
    expect(await unverifiedOrAll([a, b])).toEqual(new Set([a.card.fork_id, b.card.fork_id]));
    expect(await unverifiedOrAll([])).toEqual(new Set());
  });
});
