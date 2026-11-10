import { describe, expect, it } from 'vitest';
import vectors from './optionsHashVectors.json';
import { STATES } from './fixtures';
import { Question } from './feedback';
import { canonicalShown, optionsHash, shownOf, unverifiedForks } from './optionsHash';

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
  const card = async (): Promise<Question> => {
    const q = structuredClone(STATES.noAnswers.questions[0]) as Question;
    return { ...q, options_hash: await optionsHash(shownOf(q)) };
  };
  it('passes a card whose hash is the hash of what it shows', async () => {
    expect(await unverifiedForks([await card()])).toEqual(new Set());
  });
  it('flags a card whose shown text, option, recommendation or depends changed after hashing', async () => {
    const q = await card();
    const edits: Partial<Question>[] = [
      { title: 'Other' },
      { body: 'Other context.' },
      { options: [...q.options].reverse() },
      { recommendation: 'A' },
      { dependsOn: [{ text: 'new line' }] },
    ];
    await Promise.all(
      edits.map(async (e) =>
        expect(await unverifiedForks([{ ...q, ...e }]), JSON.stringify(Object.keys(e))).toEqual(
          new Set([q.fork_id])
        )
      )
    );
  });
  it('does not read fork_id, status or asked time, which are not shown members', async () => {
    const q = await card();
    expect(
      await unverifiedForks([{ ...q, fork_id: 'x:question:y', askedAt: '2020-01-01T00:00:00Z' }])
    ).toEqual(new Set());
  });
});
