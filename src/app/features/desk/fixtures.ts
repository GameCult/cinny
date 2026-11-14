import { DeskAnswer, ForkCard, ForkEntry, ForkList } from './forkContract';

/** A card as the server writes it: every key present. The hash is a stand-in; tests pass `unverified` directly. */
export const card = (label: string, over: Partial<ForkCard> = {}): ForkCard => ({
  schemaVersion: 'gamecult.fork.card.v0',
  fork_id: `c:question:${label}`,
  title: `Question ${label}`,
  context: `Context for ${label}.`,
  options: [
    { id: 'A', text: 'First way' },
    { id: 'B', text: 'Second way' },
    { id: 'C', text: 'Third way' },
  ],
  recommendation: 'B',
  depends: [],
  leans: null,
  flag: null,
  raised_in: null,
  raised_at: null,
  deciders: ['d1'],
  decider_count: 1,
  status: 'open',
  ruling: null,
  ruled_from: [],
  order: 1,
  options_hash: `hash-${label}`,
  ...over,
});

export const answer = (label: string, n: number, over: Partial<DeskAnswer> = {}): DeskAnswer => ({
  schemaVersion: 'gamecult.desk_answer.v0',
  answer_id: `n${n}`,
  fork_id: `c:question:${label}`,
  outcome: 'Counted',
  of: null,
  retracts: null,
  code: null,
  options_hash: `hash-${label}`,
  choice: 'A',
  note: null,
  answered_at: '2026-11-09T10:00:00Z',
  received_at: '2026-11-09T10:00:01Z',
  claim_in_future: false,
  answerer: 'acct-1',
  authority: 'Member',
  request_id: `r${n}`,
  ...over,
});

export const entry = (
  label: string,
  over: Partial<ForkCard> = {},
  answers: DeskAnswer[] = [],
  counted: string | null = null
): ForkEntry => {
  const c = card(label, over);
  return {
    schemaVersion: 'gamecult.fork.entry.v0',
    card: c,
    record: {
      schemaVersion: 'gamecult.fork.record.v0',
      fork_id: c.fork_id,
      options_hash: c.options_hash,
      counted_answer_id: counted,
      answerer_count: new Set(answers.map((a) => a.answerer)).size,
      answers,
    },
  };
};

export const list = (forks: ForkEntry[], openCount?: number): ForkList => ({
  schemaVersion: 'gamecult.fork.list.v0',
  mind: 'mind',
  stamp: 's12',
  open_count: openCount ?? forks.filter((f) => f.card.status === 'open').length,
  recorded_count: forks.filter((f) => f.card.status === 'closed').length,
  forks,
  next_cursor: null,
});

/** One list per state the desk shows. */
export const STATES = {
  empty: list([]),
  noAnswers: list([entry('plain')]),
  blocked: list([
    entry('first', { order: 1 }),
    entry('second', { order: 2, depends: ['Needs the first one settled'] }),
  ]),
  settled: list([
    entry('done', { status: 'closed', ruling: 'ruling:done-1', ruled_from: ['n1'] }),
    entry('shut', { status: 'closed' }),
    entry('live'),
  ]),
  answered: list([
    entry(
      'plain',
      {},
      [
        answer('plain', 1, { note: 'Because it is first.' }),
        answer('plain', 2, {
          outcome: 'Revision',
          of: 'n1',
          choice: 'C',
          note: null,
          answerer: 'acct-2',
        }),
        answer('plain', 3, { outcome: 'Retraction', retracts: 'n2', choice: null }),
        answer('plain', 4, {
          outcome: 'Refused',
          code: 'not_a_decider',
          choice: 'B',
          note: 'Let me in.',
        }),
        answer('plain', 5, { choice: null, note: 'Either, if measured first.' }),
      ],
      'n1'
    ),
  ]),
  /** Answers from a Guest (weight 0, served all the same) beside a Member's; ids are never shown. */
  guest: list([
    entry(
      'open',
      {},
      [
        answer('open', 1, { choice: 'A', answerer: 'acct-1', authority: 'Member' }),
        answer('open', 2, {
          choice: 'B',
          note: 'From outside the circle.',
          answerer: 'guest-1',
          authority: 'Guest',
        }),
      ],
      'n1'
    ),
  ]),
  /** Closed with a ruling while answers were still arriving: the card settled, the answers stay on its record. */
  settledWhileAnswered: list([
    entry(
      'late',
      { status: 'closed', ruling: 'ruling:late-1', ruled_from: ['n1'] },
      [answer('late', 1), answer('late', 2, { note: 'Arrived after.', answerer: 'acct-2' })],
      'n1'
    ),
  ]),
} satisfies Record<string, ForkList>;
