import { StateEvent } from '../../types/matrix/room';

export const TRAINING_NOTICE_TEXT =
  "Everything said here may be used to train GameCult's AI stewards.";

/**
 * Heimdall's ruling: a room's notice is a room state event, not a pinned message. Type below,
 * state_key '', content `{version, scope}`; scope exactly one of show, study or train. Heimdall's
 * one version rule: a positive integer, no leading zeros, no greater than 4294967295; anything
 * else is malformed. Absent or malformed in any way means no train line.
 */
export const MAX_NOTICE_VERSION = 4294967295;
export const ROOM_NOTICE_EVENT_TYPE = StateEvent.GameCultNotice;

export type RoomNotice = { version: number; scope: 'show' | 'study' | 'train' };

/** The notice a state event's content declares, or undefined: no scope is ever inferred. */
export const parseRoomNotice = (content: unknown): RoomNotice | undefined => {
  if (typeof content !== 'object' || content === null) return undefined;
  const { version, scope } = content as { version?: unknown; scope?: unknown };
  if (
    typeof version === 'number' &&
    Number.isSafeInteger(version) &&
    version > 0 &&
    version <= MAX_NOTICE_VERSION &&
    (scope === 'show' || scope === 'study' || scope === 'train')
  ) {
    return { version, scope };
  }
  return undefined;
};

/** The line a room shows: only a notice that says `train` in terms gets the train sentence. */
export const roomTrainingLine = (notice: RoomNotice | undefined): string | undefined =>
  notice?.scope === 'train' ? TRAINING_NOTICE_TEXT : undefined;
