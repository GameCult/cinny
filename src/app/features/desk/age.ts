const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago a question was raised, from the card's `raised_at` (an RFC3339 instant) and the clock the caller
 * holds. Nothing when there is no instant, it does not parse, or it is ahead of the clock: the desk shows no age
 * rather than a wrong one.
 */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Date.parse is lenient ("2026-11-06", "Nov 6 2026", "0"); the card's instant is RFC3339 and a real calendar day. */
const parseRfc3339 = (s: string): number => {
  const m = RFC3339.exec(s);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return NaN;
  return Date.parse(s);
};

export const raisedAge = (raisedAt: string | undefined, now: number): string | undefined => {
  const then = raisedAt === undefined ? NaN : parseRfc3339(raisedAt);
  const ms = now - then;
  if (Number.isNaN(ms) || ms < 0) return undefined;
  if (ms < HOUR) return 'raised just now';
  if (ms < DAY) return `raised ${Math.floor(ms / HOUR)}h ago`;
  return `raised ${Math.floor(ms / DAY)}d ago`;
};
