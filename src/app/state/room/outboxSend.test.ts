import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOutbox, failOutbox, loadOutbox } from './composerStore';
import { resendInterrupted, resendTracked, sendTracked } from './outboxSend';

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
  ({ getUserId: () => '@a:x', makeTxnId: () => 'txn-1', sendEvent: send } as never);

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
    expect(send).toHaveBeenCalledWith('!r:x', 'm.room.message', content, 'txn-1');
  });
});

describe('resendTracked', () => {
  beforeEach(stubLocalStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const entry = {
    txnId: 'txn-old',
    roomId: '!r:x',
    content: { msgtype: 'm.text', body: 'b' },
    status: 'failed' as const,
    ts: 1,
  };

  it('uses a fresh txn id while the SDK still holds the failed echo (it would throw on the old one)', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mx = {
      getUserId: () => '@a:x',
      makeTxnId: () => 'txn-new',
      sendEvent: send,
      getRoom: () => ({ getEventForTxnId: () => ({}) }),
    } as never;
    await resendTracked(mx, entry);
    expect(send).toHaveBeenCalledWith('!r:x', 'm.room.message', entry.content, 'txn-new');
  });

  it('reuses the txn id after a reload, when no echo exists, so the server deduplicates', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mx = {
      getUserId: () => '@a:x',
      makeTxnId: () => 'txn-new',
      sendEvent: send,
      getRoom: () => ({ getEventForTxnId: () => undefined }),
    } as never;
    await resendTracked(mx, entry);
    expect(send).toHaveBeenCalledWith('!r:x', 'm.room.message', entry.content, 'txn-old');
  });

  it('a synchronous throw from the SDK marks the entry failed instead of escaping', async () => {
    const mx = {
      getUserId: () => '@a:x',
      makeTxnId: () => 'txn-new',
      sendEvent: () => {
        throw new Error('addPendingEvent called on an event with known txnId');
      },
      getRoom: () => undefined,
    } as never;
    await sendTracked(mx, '!r:x', { body: 'x' });
    expect(loadOutbox('@a:x')[0]).toMatchObject({ status: 'failed' });
  });
});

describe('resendInterrupted', () => {
  beforeEach(stubLocalStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resends pending entries older than the page under their own txn id, and leaves failed ones', async () => {
    const send = vi.fn().mockResolvedValue({});
    const mx = {
      getUserId: () => '@a:x',
      makeTxnId: () => 'fresh',
      sendEvent: send,
      getRoom: () => undefined,
    } as never;
    enqueueOutbox('@a:x', { txnId: 'old', roomId: '!r:x', content: { body: 'o' } }, 5);
    enqueueOutbox('@a:x', { txnId: 'bad', roomId: '!r:x', content: { body: 'b' } }, 5);
    failOutbox('@a:x', 'bad', 'nope');
    enqueueOutbox('@a:x', { txnId: 'new', roomId: '!r:x', content: { body: 'n' } }, 500);
    await resendInterrupted(mx, 100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('!r:x', 'm.room.message', { body: 'o' }, 'old');
  });
});
