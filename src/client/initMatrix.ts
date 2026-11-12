import {
  ClientEvent,
  createClient,
  MatrixClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  SyncState,
} from 'matrix-js-sdk';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { startResumeSync } from './resumeSync';
import { startWatchdog } from './watchdog';
import { loadOutbox } from '../app/state/room/composerStore';
import { resendInterrupted } from '../app/state/room/outboxSend';

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: 'web-sync-store',
  });

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, 'crypto-store');

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
  });

  await indexedDBStore.startup();
  await mx.initRustCrypto();

  mx.setMaxListeners(50);

  return mx;
};

const startSync = (mx: MatrixClient) =>
  mx.startClient({
    lazyLoadMembers: true,
  });

const RECOVER_RELOAD_KEY = 'ratatoskr.recoverReloadAt';
export const RECOVER_RELOAD_MIN_GAP_MS = 60_000;

/** Reload to bring a dead sync back, at most once a minute, so a server that is down cannot loop us. */
export const reloadToRecoverSync = (
  now: number = Date.now(),
  store: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  reload: () => void = () => window.location.reload()
): boolean => {
  const last = Number(store.getItem(RECOVER_RELOAD_KEY) ?? 0);
  if (now - last < RECOVER_RELOAD_MIN_GAP_MS) return false;
  store.setItem(RECOVER_RELOAD_KEY, String(now));
  reload();
  return true;
};

export const startClient = async (mx: MatrixClient) => {
  await startSync(mx);
  const recover = () => reloadToRecoverSync();
  startResumeSync(mx, { recover });
  startWatchdog({
    getSyncState: () => mx.getSyncState(),
    pendingAges: () =>
      loadOutbox(mx.getUserId() ?? '')
        .filter((e) => e.status === 'pending')
        .map((e) => Date.now() - e.ts),
    isVisible: () => document.visibilityState === 'visible',
    recover,
  });
  // What a reload interrupted is sent again once sync is up.
  const onSync = (state: SyncState) => {
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    mx.off(ClientEvent.Sync, onSync);
    resendInterrupted(mx);
  };
  mx.on(ClientEvent.Sync, onSync);
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  pushSessionToSW();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await mx.clearStores();
  window.localStorage.clear();
  window.location.reload();
};

export const clearLoginData = async () => {
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  window.location.reload();
};
