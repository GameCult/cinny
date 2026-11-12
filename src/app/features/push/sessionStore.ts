// The one thing a push needs that a closed app cannot give: the access token, to fetch the event a push names.
// Stored: `{ baseUrl, accessToken }`, one record, in this origin's IndexedDB `ratatoskr-sw` (not reachable by other
// origins; the token is already in the page's own storage). Written when the page hands the worker its session,
// deleted when the page hands it none (logout). Nothing else is stored, and nothing else reads it but the push handler.
export interface SessionRecord {
  baseUrl: string;
  accessToken: string;
}

/** The two operations the store needs from a key-value backend, so tests run without IndexedDB. */
export interface RecordPort {
  read(): Promise<unknown>;
  write(value: SessionRecord | undefined): Promise<void>;
}

const DB = 'ratatoskr-sw';
const STORE = 'session';
const KEY = 'session';

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function idbPort(factory: IDBFactory): RecordPort {
  const open = (): Promise<IDBDatabase> => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    return done(req);
  };
  return {
    async read() {
      const db = await open();
      try {
        return await done(db.transaction(STORE).objectStore(STORE).get(KEY));
      } finally {
        db.close();
      }
    },
    async write(value) {
      const db = await open();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const finished = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        if (value) store.put(value, KEY);
        else store.delete(KEY);
        await finished;
      } finally {
        db.close();
      }
    },
  };
}

export function sessionStore(port: RecordPort) {
  return {
    /** A valid session replaces the record; anything else (logout) deletes it. */
    async save(baseUrl: unknown, accessToken: unknown): Promise<void> {
      await port.write(
        typeof baseUrl === 'string' && typeof accessToken === 'string' && baseUrl && accessToken
          ? { baseUrl, accessToken }
          : undefined
      );
    },
    async load(): Promise<SessionRecord | undefined> {
      const v = (await port.read()) as Partial<SessionRecord> | undefined;
      return v && typeof v.baseUrl === 'string' && typeof v.accessToken === 'string'
        ? { baseUrl: v.baseUrl, accessToken: v.accessToken }
        : undefined;
    },
  };
}
