const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago a question was raised, from the card's `raised_at` (an RFC3339 instant) and the clock the caller
 * holds. Nothing when there is no instant, it does not parse, or it is ahead of the clock: the desk shows no age
 * rather than a wrong one.
 */
export const raisedAge = (raisedAt: string | undefined, now: number): string | undefined => {
  const then = raisedAt === undefined ? NaN : Date.parse(raisedAt);
  const ms = now - then;
  if (Number.isNaN(ms) || ms < 0) return undefined;
  if (ms < HOUR) return 'raised just now';
  if (ms < DAY) return `raised ${Math.floor(ms / HOUR)}h ago`;
  return `raised ${Math.floor(ms / DAY)}d ago`;
};
