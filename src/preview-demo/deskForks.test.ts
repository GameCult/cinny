import { describe, expect, it } from 'vitest';
import { buildDesk } from '../app/features/desk/buildDesk';
import { ForkList } from '../app/features/desk/forkContract';
import { deskFor, setDeskSource } from '../app/features/desk/source';
import { unverifiedForks } from '../app/features/desk/optionsHash';
import { demoDesk } from './deskForks';

const KEYS = {
  list: ['schemaVersion', 'mind', 'stamp', 'open_count', 'recorded_count', 'forks', 'next_cursor'],
  card: [
    'schemaVersion',
    'fork_id',
    'title',
    'context',
    'options',
    'recommendation',
    'depends',
    'leans',
    'flag',
    'raised_in',
    'raised_at',
    'deciders',
    'decider_count',
    'status',
    'ruling',
    'ruled_from',
    'order',
    'options_hash',
  ],
  record: [
    'schemaVersion',
    'fork_id',
    'options_hash',
    'counted_answer_id',
    'answerer_count',
    'answers',
  ],
  answer: [
    'schemaVersion',
    'answer_id',
    'fork_id',
    'outcome',
    'of',
    'retracts',
    'code',
    'options_hash',
    'choice',
    'note',
    'answered_at',
    'received_at',
    'claim_in_future',
    'answerer',
    'authority',
    'request_id',
  ],
};
const sorted = (o: object) => Object.keys(o).sort();

describe('the demo desks', () => {
  const nibu = demoDesk('nibu') as ForkList;
  it('are contract-shaped: every key written, no others, counts matching the forks', () => {
    ['nibu', 'eureka'].forEach((m) => {
      const l = demoDesk(m) as ForkList;
      expect(sorted(l)).toEqual([...KEYS.list].sort());
      expect(l.open_count).toBe(l.forks.filter((f) => f.card.status === 'open').length);
      expect(l.recorded_count).toBe(l.forks.filter((f) => f.card.status === 'closed').length);
      l.forks.forEach(({ card, record }) => {
        expect(sorted(card)).toEqual([...KEYS.card].sort());
        expect(sorted(record)).toEqual([...KEYS.record].sort());
        expect(record.fork_id).toBe(card.fork_id);
        expect(record.options_hash).toBe(card.options_hash);
        record.answers.forEach((a) => expect(sorted(a)).toEqual([...KEYS.answer].sort()));
        const ids = record.answers.map((a) => a.answer_id);
        if (record.counted_answer_id !== null) expect(ids).toContain(record.counted_answer_id);
        expect(card.options.map((o) => o.id)).toContain(card.recommendation);
        if (card.status === 'closed') expect(card.ruling).not.toBeNull();
      });
    });
  });
  it('seed open forks, a counted answer with a note and one without, a revision, and a ruling', () => {
    const answers = nibu.forks.flatMap((f) => f.record.answers);
    const counted = nibu.forks.flatMap((f) =>
      f.record.answers.filter((a) => a.answer_id === f.record.counted_answer_id)
    );
    expect(nibu.open_count).toBe(3);
    expect(counted.some((a) => a.note !== null)).toBe(true);
    expect(counted.some((a) => a.note === null)).toBe(true);
    expect(answers.some((a) => a.outcome === 'Revision')).toBe(true);
    expect(buildDesk(nibu).recorded).toEqual([
      expect.objectContaining({ rulingId: 'demo:ruling:ridge-low-tier' }),
    ]);
    expect(nibu.forks.some((f) => f.card.leans !== null && f.card.flag !== null)).toBe(true);
  });
  it('leave other Minds unpublished, so their group shows no desk entry', () => {
    expect(demoDesk('kiko')).toBeUndefined();
  });
  it('are what the page reads once installed as the source', () => {
    setDeskSource(demoDesk);
    expect(deskFor('nibu')?.mind).toBe('nibu');
    setDeskSource(() => undefined);
  });
  it('carry the hash of what they show, so the desk shows every seeded card', async () => {
    expect(await unverifiedForks(nibu.forks)).toEqual(new Set());
    expect(await unverifiedForks((demoDesk('eureka') as ForkList).forks)).toEqual(new Set());
  });
});
