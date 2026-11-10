import { describe, expect, it } from 'vitest';
import { LONG_OPEN_DAYS, buildDesk, countOpen } from './buildDesk';
import { NOW, STATES } from './fixtures';

const questions = (d: ReturnType<typeof buildDesk>) =>
  d.open.flatMap((r) => (r.kind === 'question' ? [r] : []));

describe('buildDesk', () => {
  it('says "not published" for a projection that never arrived, never "no questions"', () => {
    expect(buildDesk(undefined, NOW).published).toBe(false);
    expect(buildDesk(STATES.unpublished, NOW)).toMatchObject({
      published: false,
      open: [],
      counts: { open: 0, answered: 0 },
    });
  });
  it('is published and empty, with its sync time, when nothing is open', () => {
    const d = buildDesk(STATES.empty, NOW);
    expect(d).toMatchObject({ published: true, open: [], counts: { open: 0 } });
    expect(d.syncedAt).toBeDefined();
  });
  it('is stale only past thirty minutes since sync', () => {
    expect(buildDesk(STATES.noAnswers, NOW).stale).toBe(false);
    expect(buildDesk(STATES.stale, NOW).stale).toBe(true);
  });
  it('shows no answers as an empty list on an open row', () => {
    expect(questions(buildDesk(STATES.noAnswers, NOW))[0].answers).toEqual([]);
  });
  it('flags a question open past fourteen days and keeps it listed', () => {
    const [row] = questions(buildDesk(STATES.longOpen, NOW));
    expect(row).toMatchObject({ ageDays: 21, longOpen: true });
    expect(LONG_OPEN_DAYS).toBe(14);
    expect(questions(buildDesk(STATES.noAnswers, NOW))[0].longOpen).toBe(false);
  });
  it('puts the long-open line past fourteen days exactly: day 14 is not long, day 15 is', () => {
    const at = (days: number) => {
      const p = structuredClone(STATES.noAnswers);
      (p.questions[0] as { askedAt: string }).askedAt = new Date(
        NOW - days * 86400000
      ).toISOString();
      return questions(buildDesk(p, NOW))[0].longOpen;
    };
    expect([at(14), at(15)]).toEqual([false, true]);
  });
  it('resolves the recommendation to its option, marks only that option, and never preselects', () => {
    const [row] = questions(buildDesk(STATES.noAnswers, NOW));
    expect(row.recommended).toBe('Second way');
    expect(row.options.filter((o) => o.recommended).map((o) => o.id)).toEqual(['B']);
  });
  it('leaves the recommendation unresolved when it names no option', () => {
    const p = structuredClone(STATES.noAnswers);
    (p.questions[0] as { recommendation?: string }).recommendation = 'Z';
    const [row] = questions(buildDesk(p, NOW));
    expect(row.recommended).toBeUndefined();
    expect(row.options.some((o) => o.recommended)).toBe(false);
  });
  it('carries the status of a cited dependency, and none for one that cites no question', () => {
    const rows = questions(buildDesk(STATES.blocked, NOW));
    expect(rows.find((r) => r.forkId.endsWith('second'))?.depends).toEqual([
      { text: 'Needs the first one settled', status: 'open' },
    ]);
    expect(rows.find((r) => r.forkId.endsWith('first'))?.depends).toEqual([]);
  });
  it('lists a settled question under recorded rulings with its ruling id, not as open; drops a closed one', () => {
    const d = buildDesk(STATES.settled, NOW);
    expect(d.recorded).toEqual([
      { forkId: 'c:question:done', title: 'Question done', rulingId: 'ruling:done-1' },
    ]);
    expect(d.open.map((r) => r.forkId)).toEqual(['c:question:live']);
  });
  it('orders open rows oldest first', () => {
    const p = structuredClone(STATES.blocked);
    (p.questions[0] as { askedAt: string }).askedAt = new Date(NOW).toISOString();
    expect(buildDesk(p, NOW).open.map((r) => r.forkId)).toEqual([
      'c:question:second',
      'c:question:first',
    ]);
  });
  it('folds earlier answers by one account under its latest and shows choice as option text', () => {
    const [row] = questions(buildDesk(STATES.answered, NOW));
    expect(row.answers).toHaveLength(2);
    const first = row.answers.find((a) => a.recordId === 'plain.a2');
    expect(first).toMatchObject({ choice: 'Third way', text: 'On reflection, third.' });
    expect(row.answers.some((a) => a.recordId === 'plain.a1')).toBe(false);
  });
  it('lists answers oldest first and tallies nothing', () => {
    const [row] = questions(buildDesk(STATES.answered, NOW));
    const times = row.answers.map((a) => a.at);
    expect([...times].sort()).toEqual(times);
    expect(Object.keys(buildDesk(STATES.answered, NOW).counts).sort()).toEqual([
      'answered',
      'open',
    ]);
  });
  it('withholds a hidden answer and a hidden question, naming who hid them', () => {
    const d = buildDesk(STATES.hidden, NOW);
    expect(d.open.find((r) => r.kind === 'hidden')).toMatchObject({
      hidden: { by: 'Kiko', reason: 'PrivateMatter' },
    });
    const [row] = questions(d);
    expect(row.answers[0]).toMatchObject({ choice: undefined, text: undefined });
    expect(row.answers[0].withheld).toMatch(/^Hidden by Kiko, 2026-11-\d\d, Spam$/);
  });
  it('does not count a hidden question as open', () => {
    expect(buildDesk(STATES.hidden, NOW).counts.open).toBe(1);
    expect(countOpen(STATES.hidden)).toBe(1);
  });
  it('shows an erased author as "erased account" with no name or content, keeping kind and time', () => {
    const [row] = questions(buildDesk(STATES.erased, NOW));
    expect(row.answers[0]).toMatchObject({
      who: 'erased account',
      kind: 'Member',
      choice: undefined,
      text: undefined,
    });
    expect(row.answers[0].withheld).toBeDefined();
    expect(row.answers[0].at).toBeDefined();
  });
  it('counts answered only for the viewer, so a signed-out desk has none', () => {
    expect(buildDesk(STATES.answered, NOW).counts.answered).toBe(0);
    expect(buildDesk(STATES.answered, NOW, 'acct-1').counts.answered).toBe(1);
    expect(buildDesk(STATES.answered, NOW, 'acct-9').counts.answered).toBe(0);
  });
  it('does not count the viewer as answered when their only answer was hidden', () => {
    expect(buildDesk(STATES.hidden, NOW, 'acct-1').counts.answered).toBe(0);
  });
});
