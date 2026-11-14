// Share a set of files at once: one album root (a text message) and one thread reply per file.
// That is exactly the shape buildAlbums reads, so a set shared here and a set a Mind's mouth posts
// are the same thing to every viewer. Ports are injected so the order and the failure rules are
// testable without a homeserver. See docs/file-zone.md, "Share a set".

import { uploadReason } from '../../utils/uploadReason';

export type ShareFile = { name: string; mimeType: string };

/** What sendShareSet needs from the outside world. */
export type SharePort<F extends ShareFile> = {
  /** Send an event and return its id. */
  send: (content: Record<string, unknown>) => Promise<string>;
  /** Upload one file and build its message content (msgtype, url, info incl. sha256). */
  contentOf: (file: F) => Promise<Record<string, unknown>>;
  /** Called after each file settles, for progress. */
  onFile?: (index: number, result: 'sent' | 'failed') => void;
  /** Aborted to stop the send: the running upload is the port's to cancel, the rest are not started. */
  signal?: AbortSignal;
};

export type ShareResult = {
  /** The album root's event id; present as soon as the root is sent. */
  albumId: string;
  sent: number;
  failed: string[];
  /** Positions in the files array of those that failed; names can repeat, positions cannot. */
  failedAt: number[];
  /** Why each failed file failed, parallel to `failed`, when the homeserver's refusal is one we name. */
  reasons?: (string | undefined)[];
};

/** An album that already exists: new files join its thread after `lastId` (sent at `lastTs`), with no new root. */
export type ExistingAlbum = { albumId: string; lastId: string; lastTs: number };

/** An event as the room's live timeline holds it: its id, time, and the thread root it belongs to. */
export type ThreadEvent = { id: string; ts: number; threadRoot?: string };

/**
 * `album` with `lastId` moved to the newest event the room's timeline holds in that thread, when it
 * is newer than the one the album list knew. The list refreshes every 30 s; the timeline does not.
 */
export const freshest = (album: ExistingAlbum, events: ThreadEvent[]): ExistingAlbum =>
  events
    .filter((e) => e.threadRoot === album.albumId)
    .reduce((a, e) => (e.ts > a.lastTs ? { ...a, lastId: e.id, lastTs: e.ts } : a), album);

export const CANCELLED = 'stopped';

/** The short reason for a failure we can name (the homeserver's refusal or what the client saw), else undefined. */
export const refusalOf = (e: unknown): string | undefined => uploadReason(e)?.cause;

/** The reply relation Matrix clients expect for a thread message: root, with the last event as fallback reply. */
export const threadRelation = (rootId: string, lastId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: lastId },
});

export const DEFAULT_TITLE = 'Shared files';

export const titleOrDefault = (title: string): string => title.trim() || DEFAULT_TITLE;

/**
 * Files go one at a time, in the order given, so thread order is pick order. A file that fails
 * to upload is reported by name and the rest still go; the root is already out, so stopping would
 * leave an empty album and the sender nothing to retry from. A root that fails to send throws:
 * nothing exists yet.
 */
export const sendShareSet = async <F extends ShareFile>(
  port: SharePort<F>,
  into: string | ExistingAlbum,
  files: F[]
): Promise<ShareResult> => {
  const albumId =
    typeof into === 'string'
      ? await port.send({ msgtype: 'm.text', body: titleOrDefault(into) })
      : into.albumId;
  const result: ShareResult = { albumId, sent: 0, failed: [], failedAt: [], reasons: [] };
  let lastId = typeof into === 'string' ? albumId : into.lastId;
  // A stopped send leaves its file, and every file after it, unsent and picked, so one tap resumes.
  const stopFrom = (from: number) => {
    for (let j = from; j < files.length; j += 1) {
      result.failed.push(files[j].name);
      result.reasons?.push(CANCELLED);
      result.failedAt.push(j);
    }
  };
  for (let i = 0; i < files.length; i += 1) {
    if (port.signal?.aborted) {
      stopFrom(i);
      break;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const content = await port.contentOf(files[i]);
      if (port.signal?.aborted) {
        stopFrom(i);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      lastId = await port.send({ ...content, 'm.relates_to': threadRelation(albumId, lastId) });
      result.sent += 1;
      port.onFile?.(i, 'sent');
    } catch (e) {
      if (port.signal?.aborted) {
        stopFrom(i);
        break;
      }
      result.failed.push(files[i].name);
      result.reasons?.push(refusalOf(e));
      result.failedAt.push(i);
      port.onFile?.(i, 'failed');
    }
  }
  return result;
};

/**
 * What stays picked after a send: only the files that did not go, so a retry is one tap. A retry
 * of a new album makes a second album, and a share where nothing went
 * leaves its root as a lone message the album list does not show (it lists threads with replies).
 */
export const remainingAfter = <T>(files: T[], result: ShareResult): T[] =>
  files.filter((_, i) => result.failedAt.includes(i));

const failedList = (result: ShareResult): string =>
  result.failed
    .map((name, i) => (result.reasons?.[i] ? `${name} (${result.reasons[i]})` : name))
    .join(', ');

export const resultNote = (result: ShareResult): string => {
  if (result.failed.length === 0)
    return `Shared ${result.sent} ${result.sent === 1 ? 'file' : 'files'}.`;
  if (result.sent === 0) return `Nothing was shared. Not sent: ${failedList(result)}`;
  return `Shared ${result.sent}. Not sent: ${failedList(result)}`;
};
