import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_CHECK_MS, MIN_HIDDEN_MS, RESUME_DEBOUNCE_MS, startResumeSync } from './resumeSync';

class Target extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

const setup = (state: string | null = 'SYNCING') => {
  const doc = new Target();
  const win = new Target();
  const mx = {
    state,
    getSyncState: () => mx.state,
    retryImmediately: vi.fn(() => true),
  };
  const recover = vi.fn();
  const stop = startResumeSync(mx, {
    recover,
    doc: doc as never,
    win: win as never,
  });
  const hide = () => {
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  const show = () => {
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc, win, mx, recover, stop, hide, show };
};

const settle = () => vi.advanceTimersByTimeAsync(RESUME_DEBOUNCE_MS);

describe('startResumeSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('nudges the poll when the tab returns after a real absence', async () => {
    const t = setup();
    t.hide();
    await vi.advanceTimersByTimeAsync(MIN_HIDDEN_MS);
    t.show();
    expect(t.mx.retryImmediately).not.toHaveBeenCalled();
    await settle();
    expect(t.mx.retryImmediately).toHaveBeenCalledTimes(1);
  });

  it('ignores a hide shorter than the minimum', async () => {
    const t = setup();
    t.hide();
    await vi.advanceTimersByTimeAsync(MIN_HIDDEN_MS - 1);
    t.show();
    await vi.advanceTimersByTimeAsync(RESUME_DEBOUNCE_MS + HEALTH_CHECK_MS);
    expect(t.mx.retryImmediately).not.toHaveBeenCalled();
  });

  it('handles pageshow only when restored from bfcache, and online always', async () => {
    const t = setup();
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    await settle();
    expect(t.mx.retryImmediately).not.toHaveBeenCalled();
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await settle();
    expect(t.mx.retryImmediately).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_MS);
    t.win.dispatchEvent(new Event('online'));
    await settle();
    expect(t.mx.retryImmediately).toHaveBeenCalledTimes(2);
  });

  it('debounces a burst of triggers into one nudge', async () => {
    const t = setup();
    t.win.dispatchEvent(new Event('online'));
    t.win.dispatchEvent(new Event('online'));
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await settle();
    expect(t.mx.retryImmediately).toHaveBeenCalledTimes(1);
  });

  it('does not restart when sync is healthy after the check window', async () => {
    for (const state of ['PREPARED', 'SYNCING', 'CATCHUP']) {
      const t = setup(state);
      t.win.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(RESUME_DEBOUNCE_MS + HEALTH_CHECK_MS);
      expect(t.recover).not.toHaveBeenCalled();
      t.stop();
    }
  });

  it('calls recover once when sync is still unhealthy, and never stops the client itself', async () => {
    const t = setup('RECONNECTING');
    t.win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(RESUME_DEBOUNCE_MS + HEALTH_CHECK_MS);
    expect(t.recover).toHaveBeenCalledTimes(1);
    expect(t.recover).toHaveBeenCalledWith(t.mx);
    expect(Object.keys(t.mx)).not.toContain('stopClient');
  });

  it('removes listeners and cancels pending work on dispose', async () => {
    const t = setup('ERROR');
    t.win.dispatchEvent(new Event('online'));
    await settle();
    t.stop();
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_MS);
    expect(t.recover).not.toHaveBeenCalled();
    t.win.dispatchEvent(new Event('online'));
    await settle();
    expect(t.mx.retryImmediately).toHaveBeenCalledTimes(1);
  });
});
