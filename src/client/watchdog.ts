/**
 * The page can go on looking alive while its connection is dead: sync polls are cut by their
 * own timeout and js-sdk retries them, but a send has no timeout at all, so on a half-open
 * connection it hangs SENDING and no request reaches the server. A send pending past
 * `stallMs` is the sign, and `recover` (a guarded reload) the answer; the outbox then sends
 * again what the reload interrupted. Sync state is not watched: ERROR is also what offline
 * looks like, and js-sdk recovers from that itself.
 * Nothing fires while the page is hidden (a frozen tab is not a dead connection) or offline
 * (a reload there only blanks the page).
 */
export type WatchdogOptions = {
  /** Ages in ms of this page's sends still pending. */
  pendingAges: () => number[];
  isVisible: () => boolean;
  isOnline: () => boolean;
  recover: () => void;
  intervalMs?: number;
  stallMs?: number;
};

export const WATCHDOG_INTERVAL_MS = 5000;
export const SEND_STALL_MS = 20_000;

export const startWatchdog = ({
  pendingAges,
  isVisible,
  isOnline,
  recover,
  intervalMs = WATCHDOG_INTERVAL_MS,
  stallMs = SEND_STALL_MS,
}: WatchdogOptions): (() => void) => {
  const id = setInterval(() => {
    if (!isVisible() || !isOnline()) return;
    if (pendingAges().some((age) => age >= stallMs)) recover();
  }, intervalMs);
  return () => clearInterval(id);
};
