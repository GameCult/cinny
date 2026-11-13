// The file-zone Mind contract (docs/file-zone-mind-contract.md): the plaintext hash a sender writes
// into a file event, and the receipt a Mind answers with.

import { MINDS } from '../../components/message/pose/poses';

/** A Mind's verified receipt for one file: its sender, who the Matrix server says posted it. */
export type FileReader = { sender: string; ts: number };

/** The slice of a Matrix event a receipt is read from. Every field may be missing. */
export type ReceiptEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
  unsigned?: Record<string, unknown>;
};

/** Hex sha256 of the plaintext bytes, written at `content.info[FILE_HASH_KEY]` in unencrypted rooms. */
export const FILE_HASH_KEY = 'sha256';

/** A Mind's receipt: event type, and the content key holding { event_id, sha256, size }. Inert: nothing in it is fetched or trusted but the sender and the hash. */
export const FILE_RECEIVED = 'org.gamecult.file_received';

export const sha256Hex = async (data: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** The hash to write for a file about to be sent in an unencrypted room; none when it cannot be computed. */
export const hashForSend = async (data: Blob): Promise<string | undefined> => {
  try {
    return await sha256Hex(data);
  } catch {
    return undefined;
  }
};

export const readLine = (readBy: FileReader[], name: (sender: string) => string): string =>
  `fetched for ${readBy.map((r) => name(r.sender)).join(', ')}`;

const receiptOf = (e: ReceiptEvent) => {
  if (!e || typeof e !== 'object' || e.type !== FILE_RECEIVED || !e.event_id) return undefined;
  if (e.unsigned?.redacted_because) return undefined;
  const body = e.content?.[FILE_RECEIVED] as { event_id?: unknown; sha256?: unknown } | undefined;
  if (typeof body?.event_id !== 'string' || typeof body.sha256 !== 'string') return undefined;
  if (typeof e.sender !== 'string') return undefined;
  // A reference to the file (Eureka's dedup, via /relations) must name the same event as the content, or the
  // receipt counts for nothing. Matching is by content.event_id; other relations (a thread) are not read.
  const rel = e.content?.['m.relates_to'] as { rel_type?: unknown; event_id?: unknown } | undefined;
  if (rel?.rel_type === 'm.reference' && rel.event_id !== body.event_id) return undefined;
  const ts = e.origin_server_ts;
  return {
    file: body.event_id,
    sender: e.sender,
    ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : 0,
    sha256: body.sha256,
  };
};

// Only the event's sender counts, never a name inside the content, and only a Mind's own Matrix
// identity on this homeserver (`@<mind>:<server>`, a mind named in the Persona catalogue).
const isMind = (sender: string, server: string) => MINDS.some((m) => sender === `@${m}:${server}`);

/**
 * Who has read the file `fileId`, from receipts found anywhere in `events` (an album's thread replies, or the room's
 * timeline: a receipt is a thread reply when the file has an album root, otherwise a plain room event; both count).
 * "Read" means verified: the receipt's sha256 must equal the file event's `info.sha256`, so a file with no hash, or a
 * mismatch, shows nothing. One entry per Mind (its latest), oldest first.
 */
export const readersOf = (
  events: ReceiptEvent[],
  fileId: string,
  fileContent: Record<string, unknown> | undefined,
  server: string
): FileReader[] => {
  const sent = (fileContent?.info as Record<string, unknown> | undefined)?.[FILE_HASH_KEY];
  if (typeof sent !== 'string') return [];
  const latest = new Map<string, FileReader>();
  events
    .map(receiptOf)
    .filter(
      (r): r is NonNullable<typeof r> =>
        !!r && r.file === fileId && r.sha256 === sent && isMind(r.sender, server)
    )
    .sort((a, b) => a.ts - b.ts)
    .forEach((r) => latest.set(r.sender, { sender: r.sender, ts: r.ts }));
  return [...latest.values()].sort((a, b) => a.ts - b.ts);
};
