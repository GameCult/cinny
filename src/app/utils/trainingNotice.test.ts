import { describe, expect, it } from 'vitest';
import {
  ROOM_NOTICE_EVENT_TYPE,
  TRAINING_NOTICE_TEXT,
  parseRoomNotice,
  roomTrainingLine,
} from './trainingNotice';

const lineFor = (content: unknown) => roomTrainingLine(parseRoomNotice(content));

describe('training notice', () => {
  it('says exactly the ruled sentence and never mentions Discord', () => {
    expect(TRAINING_NOTICE_TEXT).toBe(
      "Everything said here may be used to train GameCult's AI stewards."
    );
    expect(TRAINING_NOTICE_TEXT.toLowerCase()).not.toContain('discord');
  });

  it('reads the notice from the org.gamecult.notice state event', () => {
    expect(ROOM_NOTICE_EVENT_TYPE).toBe('org.gamecult.notice');
  });

  it('shows the train line only where the room declares train', () => {
    expect(parseRoomNotice({ version: 2, scope: 'train' })).toEqual({ version: 2, scope: 'train' });
    expect(lineFor({ version: 2, scope: 'train' })).toBe(TRAINING_NOTICE_TEXT);
    expect(lineFor({ version: 1, scope: 'study' })).toBeUndefined();
    expect(lineFor({ version: 1, scope: 'show' })).toBeUndefined();
  });

  it('shows nothing where the notice is absent', () => {
    expect(lineFor(undefined)).toBeUndefined();
    expect(lineFor(null)).toBeUndefined();
    expect(lineFor({})).toBeUndefined();
  });

  it('shows nothing where the notice is malformed in any way', () => {
    expect(lineFor('train')).toBeUndefined();
    expect(lineFor({ scope: 'train' })).toBeUndefined();
    expect(lineFor({ version: 1 })).toBeUndefined();
    expect(lineFor({ version: 0, scope: 'train' })).toBeUndefined();
    expect(lineFor({ version: -1, scope: 'train' })).toBeUndefined();
    expect(lineFor({ version: 1.5, scope: 'train' })).toBeUndefined();
    expect(lineFor({ version: '1', scope: 'train' })).toBeUndefined();
    expect(lineFor({ version: null, scope: 'train' })).toBeUndefined();
  });

  it('rejects a version written with leading zeros', () => {
    expect(lineFor({ version: '01', scope: 'train' })).toBeUndefined();
    expect(lineFor({ version: '007', scope: 'train' })).toBeUndefined();
  });

  it('rejects an unknown or wrongly cased scope', () => {
    expect(lineFor({ version: 1, scope: 'everything' })).toBeUndefined();
    expect(lineFor({ version: 1, scope: 'Train' })).toBeUndefined();
    expect(lineFor({ version: 1, scope: ['train'] })).toBeUndefined();
  });
});
