import { describe, expect, it } from 'vitest';
import { idbPort, RecordPort, SessionRecord, sessionStore } from './sessionStore';

const memory = (): RecordPort & { held?: unknown } => {
  const m: RecordPort & { held?: unknown } = {
    async read() {
      return m.held;
    },
    async write(v) {
      m.held = v;
    },
  };
  return m;
};

describe('sessionStore', () => {
  it('saves a valid session and loads it back', async () => {
    const s = sessionStore(memory());
    await s.save('https://hs/', 'tok');
    expect(await s.load()).toEqual({ baseUrl: 'https://hs/', accessToken: 'tok' });
  });
  it('deletes the record on logout, and on anything that is not two strings', async () => {
    const port = memory();
    const s = sessionStore(port);
    await s.save('https://hs/', 'tok');
    await s.save(undefined, undefined);
    expect(port.held).toBeUndefined();
    await s.save('https://hs/', 'tok');
    await s.save('https://hs/', 5);
    expect(await s.load()).toBeUndefined();
  });
  it('keeps the token only while a push subscription exists', async () => {
    const port = memory();
    const s = sessionStore(port);
    await s.saveIfSubscribed('https://hs/', 'tok', async () => false);
    expect(port.held).toBeUndefined();
    await s.saveIfSubscribed('https://hs/', 'tok', async () => true);
    expect(await s.load()).toEqual({ baseUrl: 'https://hs/', accessToken: 'tok' });
    await s.saveIfSubscribed('https://hs/', 'tok', async () => false);
    expect(port.held).toBeUndefined();
    await s.saveIfSubscribed('https://hs/', 'tok', async () => true);
    await s.saveIfSubscribed('https://hs/', 'tok', () =>
      Promise.reject(new Error('no push manager'))
    );
    expect(port.held).toBeUndefined();
  });
  it('ignores a record that is not a session', async () => {
    const port = memory();
    port.held = { baseUrl: 1 };
    expect(await sessionStore(port).load()).toBeUndefined();
  });
});

// Just enough of IndexedDB for the port: one database, object stores of key -> value, async request callbacks.
function fakeIndexedDB(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const request = <T>(run: () => T) => {
    const r = {} as IDBRequest<T>;
    setTimeout(() => {
      (r as { result: T }).result = run();
      r.onsuccess?.(new Event('success'));
    }, 0);
    return r;
  };
  return {
    open(name: string) {
      const r = {} as IDBOpenDBRequest;
      setTimeout(() => {
        const fresh = !dbs.has(name);
        const stores = dbs.get(name) ?? new Map();
        dbs.set(name, stores);
        const db = {
          createObjectStore: (n: string) => stores.set(n, new Map()),
          close: () => undefined,
          transaction: (n: string) => {
            const tx = {} as IDBTransaction;
            const store = stores.get(n) as Map<string, unknown>;
            const api = {
              get: (k: string) => request(() => store.get(k)),
              put: (v: unknown, k: string) => {
                store.set(k, v);
                setTimeout(() => tx.oncomplete?.(new Event('complete')), 0);
              },
              delete: (k: string) => {
                store.delete(k);
                setTimeout(() => tx.oncomplete?.(new Event('complete')), 0);
              },
            };
            (tx as { objectStore: unknown }).objectStore = () => api;
            return tx;
          },
        } as unknown as IDBDatabase;
        (r as { result: IDBDatabase }).result = db;
        if (fresh) r.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
        r.onsuccess?.(new Event('success'));
      }, 0);
      return r;
    },
  } as unknown as IDBFactory;
}

describe('idbPort', () => {
  it('round-trips the one record through IndexedDB and deletes it', async () => {
    const s = sessionStore(idbPort(fakeIndexedDB()));
    expect(await s.load()).toBeUndefined();
    await s.save('https://hs/', 'tok');
    expect(await s.load()).toEqual<SessionRecord>({ baseUrl: 'https://hs/', accessToken: 'tok' });
    await s.save(undefined, undefined);
    expect(await s.load()).toBeUndefined();
  });
});
