import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOutbox } from '../app/state/room/composerStore';
import { resendInterrupted, sendTracked } from '../app/state/room/outboxSend';
import { RECOVER_RELOAD_MIN_GAP_MS, ownPendingAges, reloadToRecoverSync } from './initMatrix';
import { SEND_STALL_MS, WATCHDOG_INTERVAL_MS, startWatchdog } from './watchdog';

// The dead-connection story from the user's side: a send hangs, the page notices and reloads
// itself once, and the message goes out again from the outbox under its own txn id.
const memoryStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
};

describe('a send that hangs on a dead connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', memoryStore());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is kept in the outbox, reloads the page once after the stall, and is resent under the same txn id', async () => {
    const hung = vi.fn(() => new Promise<never>(() => undefined));
    const mx = {
      getUserId: () => '@a:x',
      makeTxnId: () => 'txn-1',
      sendEvent: hung,
      getRoom: () => undefined,
    } as never;
    const reload = vi.fn();
    const session = memoryStore();
    const content = { msgtype: 'm.text', body: 'hello from a dead connection' };

    const stop = startWatchdog({
      pendingAges: () => ownPendingAges('@a:x'),
      isVisible: () => true,
      isOnline: () => true,
      recover: () => reloadToRecoverSync(Date.now(), () => session, reload),
    });
    // intentionally never settles: the request is hung
    sendTracked(mx, '!r:x', content);
    expect(loadOutbox('@a:x')).toMatchObject([{ txnId: 'txn-1', status: 'pending' }]);

    vi.advanceTimersByTime(SEND_STALL_MS - WATCHDOG_INTERVAL_MS);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * WATCHDOG_INTERVAL_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    // the stall persists across the reload guard window: no reload loop
    vi.advanceTimersByTime(RECOVER_RELOAD_MIN_GAP_MS - 2 * WATCHDOG_INTERVAL_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();

    // the reloaded page: the entry is older than the page, the network works again
    const send = vi.fn().mockResolvedValue({ event_id: '$e' });
    const reloaded = { ...mx, sendEvent: send } as never;
    await resendInterrupted(reloaded, Date.now() + 1);
    expect(send).toHaveBeenCalledWith('!r:x', 'm.room.message', content, 'txn-1');
    expect(loadOutbox('@a:x')).toEqual([]);
  });
});
