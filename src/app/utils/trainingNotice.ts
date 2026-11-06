export const TRAINING_NOTICE_TEXT =
  "Everything said here may be used to train GameCult's AI stewards.";

/**
 * Where a room declares its notice. Heimdall's answer-collector-consent.md says the notice is pinned
 * with the sample and carries `notice_version` and a scope, but does not fix the pinned event's
 * encoding; this key is this client's provisional reading of it, and the one place to change.
 */
export const ROOM_NOTICE_CONTENT_KEY = 'org.gamecult.notice';

export type RoomNotice = { version: number; scope: 'show' | 'study' | 'train' };

/** The notice a pinned event declares, or undefined: no scope is ever inferred. */
export const parseRoomNotice = (content: unknown): RoomNotice | undefined => {
  const raw = (content as Record<string, unknown> | undefined)?.[ROOM_NOTICE_CONTENT_KEY] as
    | { version?: unknown; scope?: unknown }
    | undefined;
  if (
    raw &&
    typeof raw.version === 'number' &&
    Number.isInteger(raw.version) &&
    raw.version > 0 &&
    (raw.scope === 'show' || raw.scope === 'study' || raw.scope === 'train')
  ) {
    return { version: raw.version, scope: raw.scope };
  }
  return undefined;
};

/** The line a room shows: only a notice that says `train` in terms gets the train sentence. */
export const roomTrainingLine = (notice: RoomNotice | undefined): string | undefined =>
  notice?.scope === 'train' ? TRAINING_NOTICE_TEXT : undefined;
