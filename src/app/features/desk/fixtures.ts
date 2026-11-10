import { Answer, DeskProjection, Question } from './feedback';

/** The clock every fixture is written against. */
export const NOW = Date.parse('2026-11-10T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const q = (label: string, over: Partial<Question> = {}): Question => ({
  fork_id: `c:question:${label}`,
  owner: 'mind',
  title: `Question ${label}`,
  body: `Context for ${label}.`,
  options: [
    { id: 'A', text: 'First way' },
    { id: 'B', text: 'Second way' },
    { id: 'C', text: 'Third way' },
  ],
  recommendation: 'B',
  dependsOn: [],
  askedAt: ago(DAY),
  status: { state: 'open' },
  options_hash: `hash-${label}`,
  ...over,
});

const a = (label: string, n: number, over: Partial<Answer> = {}): Answer => ({
  recordId: `${label}.a${n}`,
  fork_id: `c:question:${label}`,
  options_hash: `hash-${label}`,
  answerer: `acct-${n}`,
  displayName: `Person ${n}`,
  kind: 'Member',
  weightPermille: 1000,
  answer: { choice: 'A' },
  answered_at: ago(DAY / 2),
  ...over,
});

const desk = (
  questions: DeskProjection['questions'],
  answers: Answer[] = [],
  syncedAt = ago(2 * MIN)
) => ({
  mind: 'mind',
  syncedAt,
  questions,
  answers,
});

/** One projection per state of doc section 8, plus the hidden and erased rows. */
export const STATES = {
  /** The projection never arrived. */
  unpublished: { mind: 'mind', questions: [], answers: [] } as DeskProjection,
  empty: desk([]),
  noAnswers: desk([q('plain')]),
  stale: desk([q('plain')], [], ago(45 * MIN)),
  longOpen: desk([q('old', { askedAt: ago(21 * DAY) })]),
  blocked: desk([
    q('first'),
    q('second', {
      dependsOn: [{ text: 'Needs the first one settled', questionId: 'c:question:first' }],
    }),
  ]),
  settled: desk([
    q('done', { status: { state: 'answered', rulingId: 'ruling:done-1' } }),
    q('shut', { status: { state: 'closed' } }),
    q('live'),
  ]),
  answered: desk(
    [q('plain')],
    [
      a('plain', 1, { answered_at: ago(DAY / 2) }),
      a('plain', 2, {
        answerer: 'acct-1',
        answer: { choice: 'C', text: 'On reflection, third.' },
        answered_at: ago(DAY / 4),
      }),
      a('plain', 3, { kind: 'Mind', answer: { text: 'Either, if measured first.' } }),
    ]
  ),
  hidden: desk(
    [
      q('plain'),
      { fork_id: 'c:question:gone', hidden: { by: 'Kiko', at: ago(DAY), reason: 'PrivateMatter' } },
    ],
    [a('plain', 1, { hidden: { by: 'Kiko', at: ago(DAY / 3), reason: 'Spam' }, answer: undefined })]
  ),
  erased: desk(
    [q('plain')],
    [
      a('plain', 1, {
        erased: true,
        answerer: undefined,
        displayName: undefined,
        answer: undefined,
      }),
    ]
  ),
} satisfies Record<string, DeskProjection>;
