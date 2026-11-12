import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_HIDDEN_MS, RESUME_DEBOUNCE_MS, startResumeSync } from './resumeSync';

class Target extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

const setup = () => {
  const doc = new Target();
  const win = new Target();
  const mx = { retryImmediately: vi.fn(() => true) };
  const stop = startResumeSync(mx, { doc: doc as never, win: win as never });
  const hide = () => {
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  const show = () => {
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc, win, mx, stop, hide, show };
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
    await vi.advanceTimersByTimeAsync(RESUME_DEBOUNCE_MS);
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

  it('removes listeners and cancels pending work on dispose', async () => {
    const t = setup();
    t.win.dispatchEvent(new Event('online'));
    t.stop();
    await settle();
    expect(t.mx.retryImmediately).not.toHaveBeenCalled();
    t.win.dispatchEvent(new Event('online'));
    await settle();
    expect(t.mx.retryImmediately).not.toHaveBeenCalled();
  });
});
