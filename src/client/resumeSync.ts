/** The slice of MatrixClient this module drives; a MatrixClient satisfies it. */
export type SyncHost = {
  getSyncState(): string | null;
  retryImmediately(): boolean;
  stopClient(): void;
};

// matrix-js-sdk SyncState values for a live sync loop.
const HEALTHY: ReadonlySet<string | null> = new Set(['PREPARED', 'SYNCING', 'CATCHUP']);

export const RESUME_DEBOUNCE_MS = 250;
export const MIN_HIDDEN_MS = 5000;
export const HEALTH_CHECK_MS = 3000;

type ResumeSyncOptions<Host> = {
  /** Event sources and visibility; default to the browser globals. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Restart the client after stopClient; must resolve once startClient has been issued. */
  restart: (mx: Host) => Promise<void>;
};

/**
 * A backgrounded tab or PWA leaves the sync long-poll dead until its 30 s timeout.
 * On return (visible after a real absence, pageshow from bfcache, online) nudge the
 * poll with retryImmediately; if sync is still unhealthy after HEALTH_CHECK_MS, do one
 * stop/start. Returns a disposer that removes every listener and timer.
 */
export const startResumeSync = <Host extends SyncHost>(
  mx: Host,
  { restart, doc = document, win = window }: ResumeSyncOptions<Host>
): (() => void) => {
  let hiddenAt: number | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let healthCheck: ReturnType<typeof setTimeout> | undefined;
  let restarting = false;
  let disposed = false;

  const check = async () => {
    healthCheck = undefined;
    if (disposed || restarting || HEALTHY.has(mx.getSyncState())) return;
    restarting = true;
    try {
      mx.stopClient();
      await restart(mx);
    } finally {
      restarting = false;
    }
  };

  const resume = () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      if (disposed || restarting || healthCheck !== undefined) return;
      mx.retryImmediately();
      healthCheck = setTimeout(check, HEALTH_CHECK_MS);
    }, RESUME_DEBOUNCE_MS);
  };

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt === undefined ? Infinity : Date.now() - hiddenAt;
    hiddenAt = undefined;
    if (away >= MIN_HIDDEN_MS) resume();
  };
  const onPageShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) resume();
  };

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('online', resume);

  return () => {
    disposed = true;
    if (debounce !== undefined) clearTimeout(debounce);
    if (healthCheck !== undefined) clearTimeout(healthCheck);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('online', resume);
  };
};
