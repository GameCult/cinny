// Seeded forks for the preview's Mind desks. Invented here, public-safe: no real question, person or
// decision. Written against the clock at the time of the call so ages and sync time stay plausible.
import { DeskProjection, Question } from '../app/features/desk/feedback';

const DAY = 24 * 60 * 60 * 1000;

// Each question's options_hash over what it shows (optionsHash.ts); deskForks.test.ts fails if a seed is edited without it.
const HASHES: Record<string, string> = {
  'sky-label': '727c7944919baf8953a0473bcbb38837c2e83c87d97a31a09ed6506a0e3b4028',
  'dusk-ink': 'e15b64509db522af68ad8904767edf0903a701809e50f1074c1c8b4b3660acae',
  'ridge-low-tier': '6edd4a08b6c86703d91b3f48bd697aca16450111573a8e391e3dfe3adc6cbf5f',
  'settled-window': 'b0dd0db3a37a256618d447ff8fb4067892b4f1f82d05a1e5bebf5563c447731c',
};

const fork = (mind: string, label: string, daysAgo: number, over: Partial<Question>): Question => ({
  fork_id: `demo:question:${label}`,
  owner: mind,
  title: label,
  body: '',
  options: [],
  recommendation: '',
  dependsOn: [],
  askedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
  status: { state: 'open' },
  options_hash: HASHES[label],
  ...over,
});

const SEEDS: Record<string, (now: number) => DeskProjection> = {
  nibu: (now) => ({
    mind: 'nibu',
    syncedAt: new Date(now - 4 * 60 * 1000).toISOString(),
    questions: [
      fork('nibu', 'sky-label', 3, {
        title: 'Where should the sky label sit on a phone?',
        body: 'The label can ride the horizon or sit in the header. The horizon is prettier; the header never moves.',
        options: [
          { id: 'horizon', text: 'On the horizon, over the ridge' },
          { id: 'header', text: 'In the header, fixed' },
        ],
        recommendation: 'header',
      }),
      fork('nibu', 'dusk-ink', 18, {
        title: 'Should the dusk ink follow the sky or the theme?',
        body: 'Names in dusk are readable either way; following the sky is livelier, following the theme is steadier.',
        options: [
          { id: 'sky', text: 'Follow the sky' },
          { id: 'theme', text: 'Follow the theme' },
          { id: 'both', text: 'Sky by day, theme by night' },
        ],
        recommendation: 'sky',
        dependsOn: [{ text: 'Where the sky label sits', questionId: 'demo:question:sky-label' }],
      }),
      fork('nibu', 'ridge-low-tier', 40, {
        title: 'Keep the ridge scene at the low tier?',
        body: 'The ridge costs a little on older phones.',
        options: [
          { id: 'keep', text: 'Keep it' },
          { id: 'drop', text: 'Drop it' },
        ],
        recommendation: 'keep',
        status: { state: 'answered', rulingId: 'demo:ruling:ridge-low-tier' },
      }),
    ],
    answers: [],
  }),
  eureka: (now) => ({
    mind: 'eureka',
    syncedAt: new Date(now - 2 * 60 * 1000).toISOString(),
    questions: [
      fork('eureka', 'settled-window', 1, {
        title: 'How long should a Mind keep a settled question on its desk?',
        body: 'Settled questions are listed as rulings. A shorter window keeps the desk light; a longer one keeps context near.',
        options: [
          { id: '30d', text: 'Thirty days' },
          { id: '90d', text: 'Ninety days' },
          { id: 'always', text: 'Keep them all' },
        ],
        recommendation: '30d',
      }),
    ],
    answers: [],
  }),
};

/** The demo's desk for a Mind, or nothing: a Mind without seeds has not published yet. */
export const demoDesk = (mind: string): DeskProjection | undefined => SEEDS[mind]?.(Date.now());
