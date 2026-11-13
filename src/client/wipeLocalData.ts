import type { MatrixClient } from 'matrix-js-sdk';

// The rust crypto databases the SDK names, for browsers without indexedDB.databases().
export const KNOWN_DATABASES = [
  'web-sync-store',
  'crypto-store',
  'matrix-js-sdk::matrix-sdk-crypto',
  'matrix-js-sdk::matrix-sdk-crypto-meta',
];

export type WipePorts = {
  indexedDB: Pick<IDBFactory, 'deleteDatabase'> & {
    databases?: () => Promise<{ name?: string }[]>;
  };
  storage: Pick<Storage, 'clear'>;
  /** How long a client store that will not close may hold the wipe up. */
  clearStoresTimeoutMs?: number;
};

const CLEAR_STORES_TIMEOUT_MS = 5000;

const deleteDatabase = (idb: WipePorts['indexedDB'], name: string) =>
  new Promise<void>((resolve) => {
    try {
      const req = idb.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      // one database failing must not stop the rest
      resolve();
    }
  });

/**
 * The one wipe of everything this browser holds for the account: client stores, every IndexedDB
 * database, localStorage. Hard logout, a soft logout answered by another user or device, and
 * "sign in as someone else" all end here. It never rejects, and localStorage (the access token
 * with it) is cleared whatever the databases do; a client store that hangs is given
 * `clearStoresTimeoutMs`, then the wipe goes on. Callers reload afterwards.
 */
export const wipeLocalData = async (
  mx?: MatrixClient,
  ports: WipePorts = { indexedDB: window.indexedDB, storage: window.localStorage }
): Promise<void> => {
  try {
    try {
      await Promise.race([
        mx?.clearStores(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, ports.clearStoresTimeoutMs ?? CLEAR_STORES_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // the databases go below regardless
    }
    let names = KNOWN_DATABASES;
    try {
      const listed = await ports.indexedDB.databases?.();
      if (listed) names = listed.map((db) => db.name).filter((n): n is string => !!n);
    } catch {
      // keep the known names
    }
    await Promise.all(names.map((name) => deleteDatabase(ports.indexedDB, name)));
  } finally {
    try {
      ports.storage.clear();
    } catch {
      // storage that refuses to clear cannot be helped; the reload still has to follow
    }
  }
};
