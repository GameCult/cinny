import { describe, expect, it } from 'vitest';
import { buildDesk, countOpen } from '../app/features/desk/buildDesk';
import { deskFor, setDeskSource } from '../app/features/desk/source';
import { unverifiedForks } from '../app/features/desk/optionsHash';
import { demoDesk } from './deskForks';

describe('the demo desks', () => {
  it('seed the Minds whose groups the demo has, with open forks and a settled one', () => {
    const nibu = demoDesk('nibu');
    expect(countOpen(nibu)).toBe(2);
    expect(buildDesk(nibu, Date.now()).recorded).toHaveLength(1);
    expect(countOpen(demoDesk('eureka'))).toBe(1);
  });
  it('leave other Minds unpublished, so their group shows no desk entry', () => {
    expect(demoDesk('kiko')).toBeUndefined();
  });
  it('are what the page reads once installed as the source', () => {
    setDeskSource(demoDesk);
    expect(deskFor('nibu')?.mind).toBe('nibu');
    setDeskSource(() => undefined);
  });
  it('resolve every dependency they cite, so no seeded row waits on a ghost', () => {
    const nibu = demoDesk('nibu');
    const ids = new Set(nibu?.questions.map((q) => q.fork_id));
    nibu?.questions.forEach(
      (q) =>
        'dependsOn' in q &&
        q.dependsOn.forEach((d) => d.questionId && expect(ids.has(d.questionId)).toBe(true))
    );
  });
  it('carry the hash of what they show, so the desk shows every seeded card', async () => {
    expect(await unverifiedForks(demoDesk('nibu')?.questions ?? [])).toEqual(new Set());
    expect(await unverifiedForks(demoDesk('eureka')?.questions ?? [])).toEqual(new Set());
  });
});
