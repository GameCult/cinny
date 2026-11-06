export const TRAINING_NOTICE_TEXT =
  "Everything said here may be used to train GameCult's AI stewards.";

// Any change to the wording or scope is a new version, and a new version needs a fresh acceptance.
export const TRAINING_NOTICE_VERSION = 1;

const ACCEPTANCE_KEY = 'trainingNoticeAcceptance';

export type NoticeAcceptance = { noticeVersion: number; acceptedAt: string };

type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Written at registration only, so only newcomers have one; earlier members are never re-asked. */
export const recordNoticeAcceptance = (
  storage: NoticeStorage,
  now: Date = new Date(),
  noticeVersion: number = TRAINING_NOTICE_VERSION
): NoticeAcceptance => {
  const acceptance = { noticeVersion, acceptedAt: now.toISOString() };
  storage.setItem(ACCEPTANCE_KEY, JSON.stringify(acceptance));
  return acceptance;
};

export const getNoticeAcceptance = (storage: NoticeStorage): NoticeAcceptance | undefined => {
  try {
    const parsed = JSON.parse(storage.getItem(ACCEPTANCE_KEY) ?? 'null');
    if (typeof parsed?.noticeVersion === 'number' && typeof parsed?.acceptedAt === 'string') {
      return parsed;
    }
  } catch {
    // unreadable record counts as none
  }
  return undefined;
};

/** True when a newcomer's recorded acceptance is for an older notice version and must be renewed. */
export const needsFreshAcceptance = (
  storage: NoticeStorage,
  currentVersion: number = TRAINING_NOTICE_VERSION
): boolean => {
  const accepted = getNoticeAcceptance(storage);
  return accepted !== undefined && accepted.noticeVersion !== currentVersion;
};
