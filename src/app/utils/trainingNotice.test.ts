import { describe, expect, it } from 'vitest';
import {
  TRAINING_NOTICE_TEXT,
  TRAINING_NOTICE_VERSION,
  getNoticeAcceptance,
  needsFreshAcceptance,
  recordNoticeAcceptance,
} from './trainingNotice';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('training notice', () => {
  it('says exactly the ruled sentence and never mentions Discord', () => {
    expect(TRAINING_NOTICE_TEXT).toBe(
      "Everything said here may be used to train GameCult's AI stewards."
    );
    expect(TRAINING_NOTICE_TEXT.toLowerCase()).not.toContain('discord');
  });

  it('records the current version and time on acceptance', () => {
    const storage = memoryStorage();
    recordNoticeAcceptance(storage, new Date('2026-11-06T20:00:00Z'));
    expect(getNoticeAcceptance(storage)).toEqual({
      noticeVersion: TRAINING_NOTICE_VERSION,
      acceptedAt: '2026-11-06T20:00:00.000Z',
    });
    expect(needsFreshAcceptance(storage)).toBe(false);
  });

  it('asks again when the notice version changes', () => {
    const storage = memoryStorage();
    recordNoticeAcceptance(storage, new Date(), TRAINING_NOTICE_VERSION);
    expect(needsFreshAcceptance(storage, TRAINING_NOTICE_VERSION + 1)).toBe(true);
  });

  it('does not re-ask members who never registered here (no record)', () => {
    expect(needsFreshAcceptance(memoryStorage())).toBe(false);
  });

  it('treats a corrupt record as none', () => {
    const storage = memoryStorage();
    storage.setItem('trainingNoticeAcceptance', '{nope');
    expect(getNoticeAcceptance(storage)).toBeUndefined();
  });
});
