// Seeded forks for the preview's Mind desks, shaped as Bifrost serves them (gamecult.fork.list.v0, CultLib
// fork-card.md). Invented here, public-safe, demo-only: no real question, person or decision. Answer times are
// written against the clock at the time of the call so they stay plausible.
import { DeskAnswer, ForkCard, ForkEntry, ForkList } from '../app/features/desk/forkContract';

const DAY = 24 * 60 * 60 * 1000;

// Each card's options_hash over what it shows (optionsHash.ts); deskForks.test.ts fails if a seed is edited without it.
const HASHES: Record<string, string> = {
  'sky-label': '727c7944919baf8953a0473bcbb38837c2e83c87d97a31a09ed6506a0e3b4028',
  'dusk-ink': 'e15b64509db522af68ad8904767edf0903a701809e50f1074c1c8b4b3660acae',
  'phone-gutter': '893d90ae7bc8e3204afb62501af76375e98597ec565856622401583d6db33324',
  'ridge-low-tier': '6edd4a08b6c86703d91b3f48bd697aca16450111573a8e391e3dfe3adc6cbf5f',
  'settled-window': 'b0dd0db3a37a256618d447ff8fb4067892b4f1f82d05a1e5bebf5563c447731c',
};

const card = (label: string, order: number, over: Partial<ForkCard>): ForkCard => ({
  schemaVersion: 'gamecult.fork.card.v0',
  fork_id: `demo:question:${label}`,
  title: label,
  context: '',
  options: [],
  recommendation: '',
  depends: [],
  leans: null,
  flag: null,
  raised_in: null,
  deciders: ['demo-decider'],
  status: 'open',
  ruling: null,
  ruled_from: [],
  order,
  options_hash: HASHES[label],
  ...over,
});

const answer = (
  c: ForkCard,
  n: number,
  daysAgo: number,
  over: Partial<DeskAnswer> = {}
): DeskAnswer => {
  const at = new Date(Date.now() - daysAgo * DAY).toISOString().replace(/\.\d+Z$/, 'Z');
  return {
    schemaVersion: 'gamecult.desk_answer.v0',
    answer_id: `n${n}`,
    fork_id: c.fork_id,
    outcome: 'Counted',
    of: null,
    retracts: null,
    code: null,
    options_hash: c.options_hash,
    choice: null,
    note: null,
    answered_at: at,
    received_at: at,
    claim_in_future: false,
    answerer: `demo-account-${n}`,
    authority: 'Member',
    request_id: `demo-request-${n}`,
    ...over,
  };
};

const entry = (
  c: ForkCard,
  answers: DeskAnswer[] = [],
  counted: string | null = null
): ForkEntry => ({
  schemaVersion: 'gamecult.fork.entry.v0',
  card: c,
  record: {
    schemaVersion: 'gamecult.fork.record.v0',
    fork_id: c.fork_id,
    options_hash: c.options_hash,
    counted_answer_id: counted,
    answers,
  },
});

const list = (mind: string, forks: ForkEntry[], stamp: string): ForkList => ({
  schemaVersion: 'gamecult.fork.list.v0',
  mind,
  stamp,
  open_count: forks.filter((f) => f.card.status === 'open').length,
  recorded_count: forks.filter((f) => f.card.status === 'closed').length,
  forks,
  next_cursor: null,
});

const nibu = (): ForkList => {
  const sky = card('sky-label', 4, {
    title: 'Where should the sky label sit on a phone?',
    context:
      'The label can ride the horizon or sit in the header. The horizon is prettier; the header never moves.',
    options: [
      { id: 'horizon', text: 'On the horizon, over the ridge' },
      { id: 'header', text: 'In the header, fixed' },
    ],
    recommendation: 'header',
    leans: 'header',
    flag: 'Blocks the dusk ink question',
  });
  const dusk = card('dusk-ink', 3, {
    title: 'Should the dusk ink follow the sky or the theme?',
    context:
      'Names in dusk are readable either way; following the sky is livelier, following the theme is steadier.',
    options: [
      { id: 'sky', text: 'Follow the sky' },
      { id: 'theme', text: 'Follow the theme' },
      { id: 'both', text: 'Sky by day, theme by night' },
    ],
    recommendation: 'sky',
    depends: ['Where the sky label sits'],
  });
  const gutter = card('phone-gutter', 2, {
    title: 'How wide is the phone gutter?',
    context: 'A narrow gutter fits more on screen; a wide one is easier to thumb past.',
    options: [
      { id: 'narrow', text: 'Narrow' },
      { id: 'wide', text: 'Wide' },
    ],
    recommendation: 'narrow',
  });
  const ridge = card('ridge-low-tier', 1, {
    title: 'Keep the ridge scene at the low tier?',
    context: 'The ridge costs a little on older phones.',
    options: [
      { id: 'keep', text: 'Keep it' },
      { id: 'drop', text: 'Drop it' },
    ],
    recommendation: 'keep',
    status: 'closed',
    ruling: 'demo:ruling:ridge-low-tier',
    ruled_from: ['n1'],
  });
  return list(
    'nibu',
    [
      entry(sky),
      entry(
        dusk,
        [
          answer(dusk, 2, 2, { choice: 'sky' }),
          answer(dusk, 3, 1, {
            outcome: 'Revision',
            of: 'n2',
            choice: 'both',
            answerer: 'demo-account-3',
          }),
        ],
        'n2'
      ),
      entry(
        gutter,
        [answer(gutter, 4, 1, { choice: 'narrow', note: 'Thumbs are smaller than we fear.' })],
        'n4'
      ),
      entry(
        ridge,
        [answer(ridge, 1, 12, { choice: 'keep', note: 'It is the best part of the page.' })],
        'n1'
      ),
    ],
    's41'
  );
};

const eureka = (): ForkList => {
  const window = card('settled-window', 1, {
    title: 'How long should a Mind keep a settled question on its desk?',
    context:
      'Settled questions are listed as rulings. A shorter window keeps the desk light; a longer one keeps context near.',
    options: [
      { id: '30d', text: 'Thirty days' },
      { id: '90d', text: 'Ninety days' },
      { id: 'always', text: 'Keep them all' },
    ],
    recommendation: '30d',
  });
  return list('eureka', [entry(window)], 's7');
};

const SEEDS: Record<string, () => ForkList> = { nibu, eureka };

/** The demo's desk for a Mind, or nothing: a Mind without seeds has not published yet. */
export const demoDesk = (mind: string): ForkList | undefined => SEEDS[mind]?.();
