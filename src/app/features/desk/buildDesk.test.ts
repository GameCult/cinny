import { describe, expect, it } from 'vitest';
import { buildDesk } from './buildDesk';
import { STATES, entry, list } from './fixtures';

const questions = (d: ReturnType<typeof buildDesk>) =>
  d.open.flatMap((r) => (r.kind === 'question' ? [r] : []));

describe('buildDesk', () => {
  it('says "not published" for a list that never arrived, never "no questions"', () => {
    expect(buildDesk(undefined)).toMatchObject({ published: false, open: [], counts: { open: 0 } });
  });
  it('is published and empty when the list holds nothing', () => {
    expect(buildDesk(STATES.empty)).toMatchObject({
      published: true,
      open: [],
      counts: { open: 0 },
    });
  });
  it('shows no answers as an empty list on an open row', () => {
    expect(questions(buildDesk(STATES.noAnswers))[0].answers).toEqual([]);
  });
  it('resolves the recommendation to its option, marks only that option, and never preselects', () => {
    const [row] = questions(buildDesk(STATES.noAnswers));
    expect(row.recommended).toBe('Second way');
    expect(row.options.filter((o) => o.recommended).map((o) => o.id)).toEqual(['B']);
  });
  it('leaves the recommendation unresolved when it names no option', () => {
    const [row] = questions(buildDesk(list([entry('x', { recommendation: 'Z' })])));
    expect(row.recommended).toBeUndefined();
    expect(row.options.some((o) => o.recommended)).toBe(false);
  });
  it('carries the depends lines as the text they are', () => {
    const rows = questions(buildDesk(STATES.blocked));
    expect(rows.find((r) => r.forkId.endsWith('second'))?.depends).toEqual([
      'Needs the first one settled',
    ]);
    expect(rows.find((r) => r.forkId.endsWith('first'))?.depends).toEqual([]);
  });
  it('lists a closed card with a ruling as recorded, not open; omits one closed with no ruling', () => {
    const d = buildDesk(STATES.settled);
    expect(d.recorded).toEqual([
      { forkId: 'c:question:done', title: 'Question done', rulingId: 'ruling:done-1' },
    ]);
    expect(d.open.map((r) => r.forkId)).toEqual(['c:question:live']);
  });
  it('orders open rows by the card order, oldest admission first, whatever order the list came in', () => {
    const d = buildDesk(list([entry('late', { order: 9 }), entry('early', { order: 2 })]));
    expect(d.open.map((r) => r.forkId)).toEqual(['c:question:early', 'c:question:late']);
  });
  it('marks the answer the record names as counted, and no other', () => {
    const [row] = questions(buildDesk(STATES.answered));
    expect(row.answers.filter((a) => a.counted).map((a) => a.answerId)).toEqual(['n1']);
  });
  it('follows the record when a revision is the counted answer: nothing is re-derived', () => {
    const e = STATES.answered.forks[0];
    const moved = list([{ ...e, record: { ...e.record, counted_answer_id: 'n2' } }]);
    expect(
      questions(buildDesk(moved))[0]
        .answers.filter((a) => a.counted)
        .map((a) => a.answerId)
    ).toEqual(['n2']);
  });
  it('keeps answers in the served order and carries each outcome, target and refusal code', () => {
    const [row] = questions(buildDesk(STATES.answered));
    expect(row.answers.map((a) => [a.answerId, a.outcome, a.target, a.code])).toEqual([
      ['n1', 'Counted', undefined, undefined],
      ['n2', 'Revision', 'n1', undefined],
      ['n3', 'Retraction', 'n2', undefined],
      ['n4', 'Refused', undefined, 'not_a_decider'],
      ['n5', 'Counted', undefined, undefined],
    ]);
  });
  it('shows a choice as option text, passes an unknown id through, and leaves a null choice absent', () => {
    const [row] = questions(buildDesk(STATES.answered));
    expect(row.answers.map((a) => a.choice)).toEqual([
      'First way',
      'Third way',
      undefined,
      'Second way',
      undefined,
    ]);
    const odd = list([
      entry('odd', {}, [{ ...STATES.answered.forks[0].record.answers[0], choice: 'Q' }]),
    ]);
    expect(questions(buildDesk(odd))[0].answers[0].choice).toBe('Q');
  });
  it('carries a note verbatim when present and leaves it absent when null', () => {
    const [row] = questions(buildDesk(STATES.answered));
    expect(row.answers[0].note).toBe('Because it is first.');
    expect(row.answers[1].note).toBeUndefined();
  });
  it('withdraws an unverified open card and does not count it', () => {
    const d = buildDesk(STATES.noAnswers, new Set(['c:question:plain']));
    expect(d.open).toEqual([{ kind: 'unverified', forkId: 'c:question:plain' }]);
    expect(d.counts.open).toBe(0);
  });
});
