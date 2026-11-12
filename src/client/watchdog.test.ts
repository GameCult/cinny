import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_STALL_MS, SYNC_BAD_TICKS, WATCHDOG_INTERVAL_MS, startWatchdog } from './watchdog';

const setup = (over: Partial<Parameters<typeof startWatchdog>[0]> = {}) => {
  const recover = vi.fn();
  const o = {
    getSyncState: () => 'SYNCING' as string | null,
    pendingAges: () => [] as number[],
    isVisible: () => true,
    recover,
    ...over,
  };
  const stop = startWatchdog(o);
  return { recover, stop };
};
const tick = (n: number) => vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS * n);

describe('watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet while sync is healthy and nothing is pending', () => {
    const t = setup();
    tick(100);
    expect(t.recover).not.toHaveBeenCalled();
    t.stop();
  });

  it('recovers when a send has been pending past the stall threshold', () => {
    let age = 0;
    const t = setup({ pendingAges: () => [age] });
    age = SEND_STALL_MS - 1;
    tick(1);
    expect(t.recover).not.toHaveBeenCalled();
    age = SEND_STALL_MS;
    tick(1);
    expect(t.recover).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it.each(['ERROR', 'STOPPED'])('recovers when sync sits in %s for the bad-tick count, not before', (state) => {
    const t = setup({ getSyncState: () => state });
    tick(SYNC_BAD_TICKS - 1);
    expect(t.recover).not.toHaveBeenCalled();
    tick(1);
    expect(t.recover).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it('a recovered sync resets the count; RECONNECTING and a null state are js-sdk working, not bad', () => {
    let state: string | null = 'ERROR';
    const t = setup({ getSyncState: () => state });
    tick(SYNC_BAD_TICKS - 1);
    state = 'SYNCING';
    tick(1);
    state = 'ERROR';
    tick(SYNC_BAD_TICKS - 1);
    state = 'RECONNECTING';
    tick(50);
    state = null;
    tick(50);
    expect(t.recover).not.toHaveBeenCalled();
    t.stop();
  });

  it('does nothing while the page is hidden', () => {
    const t = setup({ isVisible: () => false, pendingAges: () => [1e9], getSyncState: () => 'STOPPED' });
    tick(50);
    expect(t.recover).not.toHaveBeenCalled();
    t.stop();
  });

  it('stop() ends it', () => {
    const t = setup({ pendingAges: () => [1e9] });
    t.stop();
    tick(10);
    expect(t.recover).not.toHaveBeenCalled();
  });
});
