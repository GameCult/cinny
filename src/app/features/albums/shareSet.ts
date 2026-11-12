// Share a set of files at once: one album root (a text message) and one thread reply per file.
// That is exactly the shape buildAlbums reads, so a set shared here and a set a Mind's mouth posts
// are the same thing to every viewer. Ports are injected so the order and the failure rules are
// testable without a homeserver. See docs/file-zone.md, "Share a set".

export type ShareFile = { name: string; mimeType: string };

/** What sendShareSet needs from the outside world. */
export type SharePort<F extends ShareFile> = {
  /** Send an event and return its id. */
  send: (content: Record<string, unknown>) => Promise<string>;
  /** Upload one file and build its message content (msgtype, url, info incl. sha256). */
  contentOf: (file: F) => Promise<Record<string, unknown>>;
  /** Called after each file settles, for progress. */
  onFile?: (index: number, result: 'sent' | 'failed') => void;
};

export type ShareResult = {
  /** The album root's event id; present as soon as the root is sent. */
  albumId: string;
  sent: number;
  failed: string[];
  /** Positions in the files array of those that failed; names can repeat, positions cannot. */
  failedAt: number[];
};

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
  title: string,
  files: F[]
): Promise<ShareResult> => {
  const albumId = await port.send({ msgtype: 'm.text', body: titleOrDefault(title) });
  const result: ShareResult = { albumId, sent: 0, failed: [], failedAt: [] };
  let lastId = albumId;
  for (let i = 0; i < files.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const content = await port.contentOf(files[i]);
      // eslint-disable-next-line no-await-in-loop
      lastId = await port.send({ ...content, 'm.relates_to': threadRelation(albumId, lastId) });
      result.sent += 1;
      port.onFile?.(i, 'sent');
    } catch {
      result.failed.push(files[i].name);
      result.failedAt.push(i);
      port.onFile?.(i, 'failed');
    }
  }
  return result;
};

/**
 * What stays picked after a send: only the files that did not go, so a retry is one tap. A retry
 * makes a second album (adding to an existing one is not built), and a share where nothing went
 * leaves its root as a lone message the album list does not show (it lists threads with replies).
 */
export const remainingAfter = <F extends ShareFile>(files: F[], result: ShareResult): F[] =>
  files.filter((_, i) => result.failedAt.includes(i));

export const resultNote = (result: ShareResult): string => {
  if (result.failed.length === 0)
    return `Shared ${result.sent} ${result.sent === 1 ? 'file' : 'files'}.`;
  if (result.sent === 0) return `Nothing was shared. Not sent: ${result.failed.join(', ')}`;
  return `Shared ${result.sent}. Not sent: ${result.failed.join(', ')}`;
};
