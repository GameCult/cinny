import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOutbox } from '../../state/room/composerStore';
import { sendTracked } from './RoomOutbox';

const stubLocalStorage = () => {
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
};

const fakeClient = (send: (...a: unknown[]) => Promise<unknown>) =>
  ({ getUserId: () => '@a:x', makeTxnId: () => 'txn-1', sendMessage: send } as never);

describe('sendTracked', () => {
  beforeEach(stubLocalStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const content = { msgtype: 'm.text', body: 'typed before reload' };

  it('holds the message in the outbox while the send is in flight, so a reload keeps it', async () => {
    let finish!: () => void;
    const mx = fakeClient(
      () =>
        new Promise((r) => {
          finish = () => r({ event_id: '$e' });
        })
    );
    const done = sendTracked(mx, '!r:x', content);
    expect(loadOutbox('@a:x')).toMatchObject([{ txnId: 'txn-1', status: 'pending', content }]);
    finish();
    await done;
    expect(loadOutbox('@a:x')).toEqual([]);
  });

  it('a failed send stays, marked failed, and is not cleared', async () => {
    const mx = fakeClient(() => Promise.reject(new Error('ECONNRESET')));
    await sendTracked(mx, '!r:x', content);
    expect(loadOutbox('@a:x')).toMatchObject([
      { txnId: 'txn-1', status: 'failed', error: 'ECONNRESET', content },
    ]);
  });

  it('sends under the stored txn id, so a resend after an unknown outcome deduplicates', async () => {
    const send = vi.fn().mockResolvedValue({});
    await sendTracked(fakeClient(send), '!r:x', content);
    expect(send).toHaveBeenCalledWith('!r:x', content, 'txn-1');
  });
});
