// What a person is told when an upload fails: a cause they can name and the thing to do next.
// uploadFailure (matrix.ts) attaches the facts the client observed as `info`; the homeserver's
// refusals arrive as Matrix errcodes. The long diagnostic text stays on the error's message.

/** What the client observed at the moment an upload died. */
export type UploadFailureInfo = {
  /** The browser could not read the picked file back. */
  unreadable: boolean;
  /** navigator.onLine was false. */
  offline: boolean;
  /** The tab was in the background. */
  hidden: boolean;
  /** The request was aborted (the SDK reports a dropped XHR as an AbortError). */
  aborted: boolean;
  /** At least one progress event arrived before it died. */
  progressed: boolean;
  /** The sender pressed Stop. */
  stopped: boolean;
};

export const NO_INFO: UploadFailureInfo = {
  unreadable: false,
  offline: false,
  hidden: false,
  aborted: false,
  progressed: false,
  stopped: false,
};

export type UploadReason = { cause: string; action: string };

const REFUSALS: Record<string, UploadReason> = {
  M_TOO_LARGE: { cause: 'too large for this server', action: 'Pick a smaller file.' },
  M_FORBIDDEN: {
    cause: 'not allowed to upload here',
    action: 'Ask a steward if you should be able to.',
  },
  M_LIMIT_EXCEEDED: {
    cause: 'uploading too fast, try again shortly',
    action: 'Wait a moment and send again.',
  },
};

/** The reason for a failure we can name, or undefined when we cannot: then the text stays generic. */
export const uploadReason = (e: unknown): UploadReason | undefined => {
  const code = (e as { errcode?: unknown } | null)?.errcode;
  if (typeof code === 'string' && Object.hasOwn(REFUSALS, code)) return REFUSALS[code];
  const info = (e as { info?: Partial<UploadFailureInfo> } | null)?.info;
  if (!info) return undefined;
  if (info.stopped) return { cause: 'stopped', action: 'Send it again when you are ready.' };
  if (info.unreadable)
    return {
      cause: 'this device can no longer read the file',
      action: 'Pick it again; if it came from another app, save a copy first.',
    };
  // Offline and hidden-tab are only read as the cause of a dropped request, not of any failure.
  if (!info.aborted) return undefined;
  if (info.offline) return { cause: 'you are offline', action: 'Reconnect and send again.' };
  if (info.hidden)
    return {
      cause: 'the connection dropped (this tab was in the background)',
      action: 'Keep this tab open while it uploads, and send again.',
    };
  return info.progressed
    ? {
        cause: 'the connection dropped partway through',
        action: 'Send again; a large file is safer on Wi-Fi.',
      }
    : { cause: 'the connection dropped before the file started', action: 'Send again.' };
};

/** The line the upload card shows: the reason when there is one, else a generic line. */
export const uploadFailureText = (e: unknown): string => {
  const reason = uploadReason(e);
  return reason
    ? `Upload failed: ${reason.cause}. ${reason.action}`
    : 'Upload failed. Send again; if it keeps failing, show the details below to a steward.';
};
