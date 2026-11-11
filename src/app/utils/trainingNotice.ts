import { StateEvent } from '../../types/matrix/room';

export const TRAINING_NOTICE_TEXT =
  "Everything said here may be used to train GameCult's AI stewards.";

// Source: Meta, 2026-11-09: server-wide, human-to-human DMs excepted, estate-room exception open.
// Neither exception is implemented here: the registration notice is unconditional, and the room
// line follows only the room's notice event, with no check for direct messages or estate rooms.
// The agreed rule is an acknowledgment that Minds on the server read what is said and learn from
// it; it is not consent to training. TRAINING_NOTICE_TEXT still reads 'may be used to train', and
// that wording is Meta's to settle. It never mentions Discord (the test pins this). It renders in
// two places: the registration acknowledgement (PasswordRegisterForm.tsx, via TrainingNotice.tsx)
// and the line in any room whose org.gamecult.notice state event has scope 'train'
// (roomTrainingLine, shown by RoomTrainingLine.tsx from RoomView.tsx).
// The preview build runs against a pretend server where nothing is trained, so the real sentence
// would be false there.
export const PREVIEW_NOTICE_TEXT =
  'Pretend server: nothing you type here is stored or used to train anything.';

/** The one sentence every first-typing surface shows: the real one, or the pretend server's. */
export const trainingNoticeText = (previewDemo?: boolean): string =>
  previewDemo === true ? PREVIEW_NOTICE_TEXT : TRAINING_NOTICE_TEXT;

/**
 * Heimdall's ruling: a room's notice is a room state event, not a pinned message. Type below,
 * state_key '', content `{version, scope}`; scope exactly one of show, study or train. Heimdall's
 * one version rule: a positive integer, no leading zeros, no greater than 4294967295; anything
 * else is malformed. Absent or malformed in any way means no train line.
 */
export const MAX_NOTICE_VERSION = 4294967295;

/**
 * The version of the notice wording above. Registration shows it with the text, and a room's
 * notice event carries the same number, so one text has one version on both surfaces. Bump it
 * with the wording and nowhere else.
 */
export const TRAINING_NOTICE_VERSION = 1;
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
export const roomTrainingLine = (
  notice: RoomNotice | undefined,
  previewDemo?: boolean
): string | undefined => (notice?.scope === 'train' ? trainingNoticeText(previewDemo) : undefined);
