/**
 * The page can go on looking alive while its connection is dead: sync polls get cut by their
 * own timeout, and a send has no timeout at all, so it hangs unsent while its echo sits in the
 * composer's room. This notices the two signs and calls `recover` (a guarded reload; the
 * outbox then resends what was interrupted).
 *  - a send pending past `stallMs`
 *  - sync stuck in ERROR or STOPPED for `syncBadTicks` consecutive ticks
 * Nothing fires while the page is hidden: a frozen background tab is not a dead connection.
 */
export type WatchdogOptions = {
  getSyncState: () => string | null;
  /** Ages in ms of sends still pending. */
  pendingAges: () => number[];
  isVisible: () => boolean;
  recover: () => void;
  intervalMs?: number;
  stallMs?: number;
  syncBadTicks?: number;
};

export const WATCHDOG_INTERVAL_MS = 5000;
export const SEND_STALL_MS = 20_000;
export const SYNC_BAD_TICKS = 6;

export const startWatchdog = ({
  getSyncState,
  pendingAges,
  isVisible,
  recover,
  intervalMs = WATCHDOG_INTERVAL_MS,
  stallMs = SEND_STALL_MS,
  syncBadTicks = SYNC_BAD_TICKS,
}: WatchdogOptions): (() => void) => {
  let badTicks = 0;
  const id = setInterval(() => {
    if (!isVisible()) {
      badTicks = 0;
      return;
    }
    const state = getSyncState();
    badTicks = state === 'ERROR' || state === 'STOPPED' ? badTicks + 1 : 0;
    if (badTicks >= syncBadTicks || pendingAges().some((age) => age >= stallMs)) {
      badTicks = 0;
      recover();
    }
  }, intervalMs);
  return () => clearInterval(id);
};
