/** The slice of MatrixClient this module drives; a MatrixClient satisfies it. */
export type SyncHost = {
  retryImmediately(): boolean;
};

export const RESUME_DEBOUNCE_MS = 250;
export const MIN_HIDDEN_MS = 5000;

type ResumeSyncOptions = {
  /** Event sources and visibility; default to the browser globals. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
};

/**
 * A backgrounded tab or PWA leaves the sync long-poll dead until its 30 s timeout.
 * On return (visible after a real absence, pageshow from bfcache, online) nudge the
 * poll with retryImmediately. It never stops and restarts the client: stopClient() closes
 * the rust crypto's OlmMachine for good and startClient() does not reopen it. A connection
 * that stays dead is the watchdog's business. Returns a disposer that removes every
 * listener and timer.
 */
export const startResumeSync = (
  mx: SyncHost,
  { doc = document, win = window }: ResumeSyncOptions = {}
): (() => void) => {
  let hiddenAt: number | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const resume = () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      if (!disposed) mx.retryImmediately();
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
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('online', resume);
  };
};
