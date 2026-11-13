import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_ID, loadOutbox } from '../app/state/room/composerStore';
import { resendInterrupted, sendTracked } from '../app/state/room/outboxSend';
import { RECOVER_RELOAD_MIN_GAP_MS, ownPendingAges, reloadToRecoverSync } from './initMatrix';
import { SEND_STALL_MS, WATCHDOG_INTERVAL_MS, startWatchdog } from './watchdog';

// The dead-connection story from the user's side: a send hangs, the page notices and reloads
// itself once, and the message goes out again from the outbox under its own txn id.
const memoryStore = (m = new Map<string, string>()) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, v);
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
});

const OUTBOX_KEY = 'ratatoskr.outbox.@a:x';

describe('a send that hangs on a dead connection', () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal('localStorage', memoryStore(storage));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Every send gets its own txn id, as the SDK's makeTxnId gives; a client that hands out one
  // constant id could not tell a resend of the right message from a resend of the wrong one.
  const hungClient = () => {
    let n = 0;
    return {
      getUserId: () => '@a:x',
      makeTxnId: () => {
        n += 1;
        return `txn-${n}`;
      },
      sendEvent: vi.fn(() => new Promise<never>(() => undefined)), // never settles: the request is hung
      getRoom: () => undefined,
    };
  };
  const watch = (env: { visible: boolean; online: boolean }) => {
    const reload = vi.fn();
    const session = memoryStore();
    const stop = startWatchdog({
      pendingAges: () => ownPendingAges('@a:x'),
      isVisible: () => env.visible,
      isOnline: () => env.online,
      recover: () => reloadToRecoverSync(Date.now(), () => session, reload),
    });
    return { reload, stop };
  };
  const stalled = () => vi.advanceTimersByTime(SEND_STALL_MS + 2 * WATCHDOG_INTERVAL_MS);

  it('is kept in the outbox, reloads the page once after the stall, and each message is resent under its own txn id', async () => {
    const mx = hungClient();
    const first = { msgtype: 'm.text', body: 'hello from a dead connection' };
    const second = { msgtype: 'm.text', body: 'and a second one' };
    const { reload, stop } = watch({ visible: true, online: true });

    sendTracked(mx as never, '!r:x', first);
    sendTracked(mx as never, '!q:x', second);
    expect(loadOutbox('@a:x')).toMatchObject([
      { txnId: 'txn-1', status: 'pending' },
      { txnId: 'txn-2', status: 'pending' },
    ]);

    vi.advanceTimersByTime(SEND_STALL_MS - WATCHDOG_INTERVAL_MS);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * WATCHDOG_INTERVAL_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    // the stall persists across the reload guard window: no reload loop
    vi.advanceTimersByTime(RECOVER_RELOAD_MIN_GAP_MS - 2 * WATCHDOG_INTERVAL_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();

    // the reloaded page: the entries are older than the page, the network works again
    const send = vi.fn().mockResolvedValue({ event_id: '$e' });
    const reloaded = { ...mx, sendEvent: send };
    await resendInterrupted(reloaded as never, Date.now() + 1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('!r:x', 'm.room.message', first, 'txn-1');
    expect(send).toHaveBeenCalledWith('!q:x', 'm.room.message', second, 'txn-2');
    expect(loadOutbox('@a:x')).toEqual([]);
  });

  it.each([
    ['hidden', { visible: false, online: true }],
    ['offline', { visible: true, online: false }],
  ])('does not reload a stalled page while it is %s, and does once it is back', (_name, env) => {
    const mx = hungClient();
    const state = { ...env };
    const { reload, stop } = watch(state);
    sendTracked(mx as never, '!r:x', { body: 'x' });
    stalled();
    vi.advanceTimersByTime(10 * SEND_STALL_MS);
    expect(reload).not.toHaveBeenCalled();
    state.visible = true;
    state.online = true;
    vi.advanceTimersByTime(2 * WATCHDOG_INTERVAL_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not reload for a send that belongs to another tab, or one that already failed', () => {
    const mx = hungClient();
    const { reload, stop } = watch({ visible: true, online: true });
    sendTracked(mx as never, '!r:x', { body: 'theirs' });
    sendTracked(mx as never, '!r:x', { body: 'failed' });
    const entries = JSON.parse(storage.get(OUTBOX_KEY) as string);
    entries[0].tab = `${PAGE_ID}-other`;
    entries[1].status = 'failed';
    storage.set(OUTBOX_KEY, JSON.stringify(entries));
    stalled();
    vi.advanceTimersByTime(10 * SEND_STALL_MS);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
