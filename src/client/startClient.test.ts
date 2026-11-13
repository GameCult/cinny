import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOutbox } from '../app/state/room/composerStore';
import { PAGE_START } from '../app/state/room/outboxSend';
import { startClient } from './initMatrix';
import { startResumeSync } from './resumeSync';
import { startWatchdog } from './watchdog';

vi.mock('./resumeSync', () => ({ startResumeSync: vi.fn() }));
vi.mock('./watchdog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./watchdog')>()),
  startWatchdog: vi.fn(() => () => undefined),
}));

const memoryStore = (m = new Map<string, string>()) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, v);
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
});

// startClient is the one place the dead-connection pieces are wired to the page: what the watchdog reads,
// when it may fire, what it does, and what runs after the reload. These tests call it and exercise that wiring.
describe('startClient wiring', () => {
  let handlers: Array<(state: string) => void>;
  let mx: Record<string, unknown> & {
    sendEvent: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    handlers = [];
    vi.stubGlobal('localStorage', memoryStore());
    mx = {
      startClient: vi.fn().mockResolvedValue(undefined),
      getUserId: () => '@a:x',
      makeTxnId: () => 'txn-new',
      getRoom: () => undefined,
      sendEvent: vi.fn().mockResolvedValue({ event_id: '$e' }),
      on: (_ev: string, h: (state: string) => void) => {
        handlers.push(h);
      },
      off: vi.fn(),
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const watchdogOptions = () =>
    (startWatchdog as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Parameters<
      typeof startWatchdog
    >[0];

  it('starts sync, the resume nudge and the watchdog once per client', async () => {
    await startClient(mx as never);
    await startClient(mx as never);
    expect(mx.startClient).toHaveBeenCalledTimes(2);
    expect(startResumeSync).toHaveBeenCalledTimes(1);
    expect(startResumeSync).toHaveBeenCalledWith(mx);
    expect(startWatchdog).toHaveBeenCalledTimes(1);
  });

  it("feeds the watchdog this page's pending sends for this user", async () => {
    await startClient(mx as never);
    const { pendingAges } = watchdogOptions();
    expect(pendingAges()).toEqual([]);
    enqueueOutbox('@a:x', { txnId: 't', roomId: '!r:x', content: {} }, Date.now() - 7000);
    enqueueOutbox('@b:x', { txnId: 'u', roomId: '!r:x', content: {} }, Date.now() - 1000);
    const ages = pendingAges();
    expect(ages).toHaveLength(1);
    expect(ages[0]).toBeGreaterThanOrEqual(7000);
  });

  it('reads visibility and connectivity from the page', async () => {
    const doc = { visibilityState: 'visible' };
    const nav = { onLine: true };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', nav);
    await startClient(mx as never);
    const { isVisible, isOnline } = watchdogOptions();
    expect([isVisible(), isOnline()]).toEqual([true, true]);
    doc.visibilityState = 'hidden';
    nav.onLine = false;
    expect([isVisible(), isOnline()]).toEqual([false, false]);
  });

  it('recovers by a guarded reload, at most once a minute', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('sessionStorage', memoryStore());
    await startClient(mx as never);
    const { recover } = watchdogOptions();
    recover();
    recover();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('resends what a reload interrupted once sync is up, and only once', async () => {
    enqueueOutbox(
      '@a:x',
      { txnId: 'old', roomId: '!r:x', content: { body: 'x' } },
      PAGE_START - 5000
    );
    await startClient(mx as never);
    expect(handlers).toHaveLength(1);
    handlers[0]('CONNECTING');
    expect(mx.sendEvent).not.toHaveBeenCalled();
    handlers[0]('SYNCING');
    expect(mx.off).toHaveBeenCalledWith('sync', handlers[0]);
    expect(mx.sendEvent).toHaveBeenCalledWith('!r:x', 'm.room.message', { body: 'x' }, 'old');
  });
});
