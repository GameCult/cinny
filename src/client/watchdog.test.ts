import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_STALL_MS, WATCHDOG_INTERVAL_MS, startWatchdog } from './watchdog';

const setup = (over: Partial<Parameters<typeof startWatchdog>[0]> = {}) => {
  const recover = vi.fn();
  const stop = startWatchdog({
    pendingAges: () => [],
    isVisible: () => true,
    isOnline: () => true,
    recover,
    ...over,
  });
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

  it('stays quiet while nothing is pending', () => {
    const t = setup();
    tick(100);
    expect(t.recover).not.toHaveBeenCalled();
    t.stop();
  });

  it('recovers when a send has been pending past the stall threshold, not before', () => {
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

  it('does nothing while the page is hidden or offline', () => {
    const hidden = setup({ isVisible: () => false, pendingAges: () => [1e9] });
    const offline = setup({ isOnline: () => false, pendingAges: () => [1e9] });
    tick(50);
    expect(hidden.recover).not.toHaveBeenCalled();
    expect(offline.recover).not.toHaveBeenCalled();
    hidden.stop();
    offline.stop();
  });

  it('stop() ends it', () => {
    const t = setup({ pendingAges: () => [1e9] });
    t.stop();
    tick(10);
    expect(t.recover).not.toHaveBeenCalled();
  });
});
