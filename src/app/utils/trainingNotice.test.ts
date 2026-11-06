import { describe, expect, it } from 'vitest';
import {
  ROOM_NOTICE_CONTENT_KEY,
  TRAINING_NOTICE_TEXT,
  parseRoomNotice,
  roomTrainingLine,
} from './trainingNotice';

const pinned = (notice: unknown) => ({ body: 'sample', [ROOM_NOTICE_CONTENT_KEY]: notice });

describe('training notice', () => {
  it('says exactly the ruled sentence and never mentions Discord', () => {
    expect(TRAINING_NOTICE_TEXT).toBe(
      "Everything said here may be used to train GameCult's AI stewards."
    );
    expect(TRAINING_NOTICE_TEXT.toLowerCase()).not.toContain('discord');
  });

  it('shows the train line only where the room declares train', () => {
    const train = parseRoomNotice(pinned({ version: 2, scope: 'train' }));
    expect(train).toEqual({ version: 2, scope: 'train' });
    expect(roomTrainingLine(train)).toBe(TRAINING_NOTICE_TEXT);
    expect(roomTrainingLine(parseRoomNotice(pinned({ version: 1, scope: 'study' })))).toBeUndefined();
    expect(roomTrainingLine(parseRoomNotice(pinned({ version: 1, scope: 'show' })))).toBeUndefined();
  });

  it('shows nothing where no notice is declared, and never infers train', () => {
    expect(roomTrainingLine(undefined)).toBeUndefined();
    expect(parseRoomNotice({ body: 'plain message' })).toBeUndefined();
    expect(parseRoomNotice(pinned({ scope: 'train' }))).toBeUndefined();
    expect(parseRoomNotice(pinned({ version: 0, scope: 'train' }))).toBeUndefined();
    expect(parseRoomNotice(pinned({ version: 1, scope: 'everything' }))).toBeUndefined();
  });
});
