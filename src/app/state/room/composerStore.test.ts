import { describe, expect, it } from 'vitest';
import { Descendant } from 'slate';
import {
  clearDraft,
  enqueueOutbox,
  failOutbox,
  loadDraft,
  loadOutbox,
  removeOutbox,
  retryOutbox,
  saveDraft,
  subscribeOutbox,
} from './composerStore';

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
    size: () => m.size,
  };
};

const para = (text: string): Descendant[] => [{ type: 'paragraph', children: [{ text }] } as never];

describe('draft', () => {
  it('survives a reload: a new read of the same store returns what input wrote', () => {
    const store = memoryStore();
    saveDraft('@a:x', '!r:x', para('half a thought'), store);
    expect(loadDraft('@a:x', '!r:x', store)).toEqual(para('half a thought'));
  });

  it('is keyed by account and room', () => {
    const store = memoryStore();
    saveDraft('@a:x', '!r:x', para('one'), store);
    expect(loadDraft('@b:x', '!r:x', store)).toEqual([]);
    expect(loadDraft('@a:x', '!other:x', store)).toEqual([]);
  });

  it('emptying the editor removes the stored draft', () => {
    const store = memoryStore();
    saveDraft('@a:x', '!r:x', para('x'), store);
    saveDraft('@a:x', '!r:x', para(''), store);
    expect(store.size()).toBe(0);
  });

  it('clearDraft removes it; corrupt storage reads as no draft', () => {
    const store = memoryStore();
    saveDraft('@a:x', '!r:x', para('x'), store);
    clearDraft('@a:x', '!r:x', store);
    expect(loadDraft('@a:x', '!r:x', store)).toEqual([]);
    store.setItem('ratatoskr.draft.@a:x.!r:x', '{not json');
    expect(loadDraft('@a:x', '!r:x', store)).toEqual([]);
  });

  it('a throwing store (quota) does not throw into the composer', () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(() => saveDraft('@a:x', '!r:x', para('x'), store)).not.toThrow();
  });
});

describe('outbox', () => {
  const entry = { txnId: 't1', roomId: '!r:x', content: { msgtype: 'm.text', body: 'hi' } };

  it('keeps a sent message until it is confirmed, across a reload', () => {
    const store = memoryStore();
    enqueueOutbox('@a:x', entry, 5, store);
    const after = loadOutbox('@a:x', store);
    expect(after).toEqual([{ ...entry, status: 'pending', ts: 5 }]);
    removeOutbox('@a:x', 't1', store);
    expect(loadOutbox('@a:x', store)).toEqual([]);
    expect(store.size()).toBe(0);
  });

  it('a failed send stays, marked failed with its error; retry returns it to pending', () => {
    const store = memoryStore();
    enqueueOutbox('@a:x', entry, 5, store);
    failOutbox('@a:x', 't1', 'offline', store);
    expect(loadOutbox('@a:x', store)[0]).toMatchObject({ status: 'failed', error: 'offline' });
    retryOutbox('@a:x', 't1', store);
    expect(loadOutbox('@a:x', store)[0]).toMatchObject({ status: 'pending', txnId: 't1' });
    expect(loadOutbox('@a:x', store)[0].error).toBeUndefined();
  });

  it('re-enqueueing the same txn id does not duplicate it; other accounts are separate', () => {
    const store = memoryStore();
    enqueueOutbox('@a:x', entry, 5, store);
    enqueueOutbox('@a:x', entry, 6, store);
    expect(loadOutbox('@a:x', store)).toHaveLength(1);
    expect(loadOutbox('@b:x', store)).toEqual([]);
  });

  it('notifies subscribers on every change', () => {
    const store = memoryStore();
    let n = 0;
    const off = subscribeOutbox(() => {
      n += 1;
    });
    enqueueOutbox('@a:x', entry, 5, store);
    removeOutbox('@a:x', 't1', store);
    off();
    enqueueOutbox('@a:x', entry, 5, store);
    expect(n).toBe(2);
  });
});
