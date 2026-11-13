import {
  ClientEvent,
  createClient,
  MatrixClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  SyncState,
} from 'matrix-js-sdk';

import { wipeLocalData } from './wipeLocalData';
import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { startResumeSync } from './resumeSync';
import { startWatchdog } from './watchdog';
import { PAGE_ID, loadOutbox } from '../app/state/room/composerStore';
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

/** Reload to bring a dead connection back, at most once a minute, so a server that is down cannot loop us. */
export const reloadToRecoverSync = (
  now: number = Date.now(),
  getStore: () => Pick<Storage, 'getItem' | 'setItem'> = () => sessionStorage,
  reload: () => void = () => window.location.reload()
): boolean => {
  try {
    const store = getStore();
    const last = Number(store.getItem(RECOVER_RELOAD_KEY) ?? 0);
    if (now - last < RECOVER_RELOAD_MIN_GAP_MS) return false;
    store.setItem(RECOVER_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
};

/** Ages in ms of the sends this page made that are still pending: the only ones it may judge stalled. */
export const ownPendingAges = (userId: string, now: number = Date.now()): number[] =>
  loadOutbox(userId)
    .filter((e) => e.status === 'pending' && e.tab === PAGE_ID)
    .map((e) => now - e.ts);

const started = new WeakSet<MatrixClient>();

export const startClient = async (mx: MatrixClient) => {
  await startSync(mx);
  if (started.has(mx)) return;
  started.add(mx);
  startResumeSync(mx);
  startWatchdog({
    pendingAges: () => ownPendingAges(mx.getUserId() ?? ''),
    isVisible: () => document.visibilityState === 'visible',
    isOnline: () => navigator.onLine,
    recover: () => reloadToRecoverSync(),
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
  await wipeLocalData(mx);
  window.location.reload();
};

export const clearLoginData = async () => {
  await wipeLocalData();
  window.location.reload();
};
