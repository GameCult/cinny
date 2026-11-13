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
};

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
 * with it) is cleared whatever the databases do. Callers reload afterwards.
 */
export const wipeLocalData = async (
  mx?: MatrixClient,
  ports: WipePorts = { indexedDB: window.indexedDB, storage: window.localStorage }
): Promise<void> => {
  try {
    try {
      await mx?.clearStores();
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
    ports.storage.clear();
  }
};
