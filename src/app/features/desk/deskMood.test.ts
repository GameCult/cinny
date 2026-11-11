import { describe, expect, it } from 'vitest';
import { MINDS, resolvePose } from '../../components/message/pose/poses';
import { MOOD_POSE, deskMood } from './deskMood';

describe('deskMood', () => {
  it('is neutral with the desk clear when nothing is open', () => {
    expect(deskMood(0, 0)).toEqual({
      mood: 'neutral',
      pose: 'neutral',
      line: "Desk's clear. I'll wave when something lands.",
    });
  });
  it('is triumph when every open fork is answered', () => {
    expect(deskMood(3, 3).mood).toBe('triumph');
    expect(deskMood(1, 1).mood).toBe('triumph');
  });
  it('is thinking when none is answered, and says whether it is one fork or several', () => {
    expect(deskMood(1, 0)).toMatchObject({ mood: 'thinking', line: 'Just one fork on the desk.' });
    expect(deskMood(4, 0)).toMatchObject({
      mood: 'thinking',
      line: '4 forks on the desk. No rush.',
    });
  });
  it('is determined partway, counting what is left', () => {
    expect(deskMood(5, 2)).toMatchObject({ mood: 'determined', line: '3 to go.' });
  });
  it('is happy when the pick is the recommendation', () => {
    expect(deskMood(2, 0, { type: 'picked', choice: 'B', recommended: 'B' }).mood).toBe('happy');
  });
  it('is surprised, and asks for a line on why, when the pick differs', () => {
    expect(deskMood(2, 0, { type: 'picked', choice: 'A', recommended: 'B' })).toMatchObject({
      mood: 'surprised',
      line: expect.stringContaining('A line in the note on why helps'),
    });
  });
  it('is surprised, not happy, when there is no recommendation to match', () => {
    expect(deskMood(2, 0, { type: 'picked', choice: 'A' }).mood).toBe('surprised');
  });
  it('is note when a pick is cleared, saying the note can carry the answer', () => {
    expect(deskMood(2, 1, { type: 'cleared' })).toMatchObject({
      mood: 'note',
      line: expect.stringContaining('note can carry the answer on its own'),
    });
  });
  it('is concerned when a send failed, even with everything answered', () => {
    expect(deskMood(2, 2, { type: 'sendFailed' }).mood).toBe('concerned');
  });
  it('is surprised when a new fork arrives, even on a clear desk', () => {
    expect(deskMood(0, 0, { type: 'newFork' })).toMatchObject({
      mood: 'surprised',
      line: 'New fork on the desk!',
    });
  });
  it('maps every mood to a label every Mind in the catalogue can show', () => {
    Object.values(MOOD_POSE).forEach((pose) =>
      MINDS.forEach((mind) => expect(resolvePose(mind, pose)).toBe(pose))
    );
  });
});
