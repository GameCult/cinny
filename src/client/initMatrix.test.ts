import { describe, expect, it, vi } from 'vitest';
import { PAGE_ID, enqueueOutbox, failOutbox } from '../app/state/room/composerStore';
import { RECOVER_RELOAD_MIN_GAP_MS, ownPendingAges, reloadToRecoverSync } from './initMatrix';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
};

describe('reloadToRecoverSync', () => {
  it('reloads once, then refuses inside the gap so a down server cannot loop it', () => {
    const store = memory();
    const reload = vi.fn();
    expect(reloadToRecoverSync(1_000_000, () => store, reload)).toBe(true);
    expect(
      reloadToRecoverSync(1_000_000 + RECOVER_RELOAD_MIN_GAP_MS - 1, () => store, reload)
    ).toBe(false);
    expect(reloadToRecoverSync(1_000_000 + RECOVER_RELOAD_MIN_GAP_MS, () => store, reload)).toBe(
      true
    );
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('reloadToRecoverSync with unusable storage', () => {
  it('refuses instead of throwing when sessionStorage throws', () => {
    const reload = vi.fn();
    const denied = () => {
      throw new Error('SecurityError');
    };
    expect(reloadToRecoverSync(1, denied, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('ownPendingAges', () => {
  it("counts only this page's pending sends, not other pages' or failed ones", () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    });
    const e = (txnId: string) => ({ txnId, roomId: '!r:x', content: {} });
    enqueueOutbox('@a:x', e('mine'), 1000);
    enqueueOutbox('@a:x', e('failed'), 1000);
    failOutbox('@a:x', 'failed', 'x');
    enqueueOutbox('@a:x', e('theirs'), 1000);
    const entries = JSON.parse(m.get('ratatoskr.outbox.@a:x') as string);
    entries.find((x: { txnId: string }) => x.txnId === 'theirs').tab = `${PAGE_ID}-other`;
    m.set('ratatoskr.outbox.@a:x', JSON.stringify(entries));
    expect(ownPendingAges('@a:x', 1500)).toEqual([500]);
    vi.unstubAllGlobals();
  });
});
