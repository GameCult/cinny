/** The slice of MatrixClient this module drives; a MatrixClient satisfies it. */
export type SyncHost = {
  getSyncState(): string | null;
  retryImmediately(): boolean;
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
  /**
   * Called once when sync is still unhealthy after the nudge. It must not stop and restart the
   * client in place: stopClient() closes the rust crypto's OlmMachine for good and startClient()
   * does not reopen it, so every later encrypted send fails with "null pointer passed to rust".
   * A page reload is the only restart that brings crypto back.
   */
  recover: (mx: Host) => void;
};

/**
 * A backgrounded tab or PWA leaves the sync long-poll dead until its 30 s timeout.
 * On return (visible after a real absence, pageshow from bfcache, online) nudge the
 * poll with retryImmediately; if sync is still unhealthy after HEALTH_CHECK_MS, call recover once. Returns a disposer that removes every listener and timer.
 */
export const startResumeSync = <Host extends SyncHost>(
  mx: Host,
  { recover, doc = document, win = window }: ResumeSyncOptions<Host>
): (() => void) => {
  let hiddenAt: number | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let healthCheck: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const check = () => {
    healthCheck = undefined;
    if (disposed || HEALTHY.has(mx.getSyncState())) return;
    recover(mx);
  };

  const resume = () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      if (disposed || healthCheck !== undefined) return;
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
