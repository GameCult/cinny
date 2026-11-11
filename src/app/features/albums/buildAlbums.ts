// Pure: turns the thread roots of a file-zone room and each root's thread replies, in the JSON
// Synapse returns from GET /rooms/{roomId}/threads and GET /rooms/{roomId}/relations/{root}/m.thread,
// into albums. See docs/file-zone.md for the rulings this encodes.
import { readersOf } from './fileReceipt';
import type { FileReader } from './fileReceipt';

/** The slice of a Matrix event this module reads. Every field may be missing. */
export type ZoneEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
  unsigned?: Record<string, unknown>;
};

export type AlbumInput = { root: ZoneEvent; replies: ZoneEvent[] };

export type FileKind = 'audio' | 'image' | 'video' | 'file';

export type AlbumFile = {
  id: string;
  kind: FileKind;
  name: string;
  ts: number;
  /** The event content, as RenderMessageContent reads it. */
  content: Record<string, unknown>;
  /** Receipts in this album that name this file, one per sender (the latest), oldest first. */
  readBy: FileReader[];
};

export type Album = {
  id: string;
  title: string;
  author: string;
  ts: number;
  cover?: AlbumFile;
  files: AlbumFile[];
  count: number;
};

// A Map, not an object: msgtype is server-supplied and "constructor" must not name a kind.
const KIND_OF_MSGTYPE = new Map<string, FileKind>([
  ['m.audio', 'audio'],
  ['m.image', 'image'],
  ['m.video', 'video'],
  ['m.file', 'file'],
]);

// A redacted event keeps its id but loses its content and gains unsigned.redacted_because.
const live = (
  e: ZoneEvent
): e is ZoneEvent & { event_id: string; content: Record<string, unknown> } =>
  !!e &&
  typeof e === 'object' &&
  !!e.event_id &&
  // An edit is an m.room.message too, but it revises an event; it is never a file or an album.
  (e.content?.['m.relates_to'] as { rel_type?: unknown } | undefined)?.rel_type !== 'm.replace' &&
  !e.unsigned?.redacted_because &&
  (e.type === undefined || e.type === 'm.room.message') &&
  typeof e.content?.msgtype === 'string';

const tsOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

const toFile = (e: ZoneEvent): AlbumFile | undefined => {
  if (!live(e)) return undefined;
  const kind = KIND_OF_MSGTYPE.get(e.content.msgtype as string);
  if (!kind) return undefined;
  return {
    id: e.event_id,
    kind,
    name: asString(e.content.filename) || asString(e.content.body),
    ts: tsOf(e.origin_server_ts),
    content: e.content,
    readBy: [],
  };
};

export const UNTITLED = 'Untitled album';

// An edited root carries its latest edit under unsigned["m.relations"]["m.replace"]; the title is
// that edit's m.new_content.body, else the original body.
const titleOf = (root: ZoneEvent & { content: Record<string, unknown> }): string => {
  const relations = root.unsigned?.['m.relations'] as Record<string, unknown> | undefined;
  const edit = relations?.['m.replace'] as ZoneEvent | undefined;
  const edited = (edit?.content?.['m.new_content'] as Record<string, unknown> | undefined)?.body;
  return asString(edited) || asString(root.content.body) || UNTITLED;
};

const toAlbum = (input: AlbumInput, server: string): Album | undefined => {
  const { root, replies } = input ?? {};
  if (!live(root)) return undefined;
  const seen = new Set<string>();
  const files = (Array.isArray(replies) ? replies : [])
    .map(toFile)
    .filter((f): f is AlbumFile => {
      if (!f || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    })
    .sort((a, b) => a.ts - b.ts)
    .map((f) => ({ ...f, readBy: readersOf(replies, f.id, f.content, server) }));
  return {
    id: root.event_id,
    title: titleOf(root),
    author: root.sender ?? '',
    ts: tsOf(root.origin_server_ts),
    cover: files.find((f) => f.kind === 'image'),
    files,
    count: files.length,
  };
};

/** Newest album first; files oldest first. Loose room messages never reach this function. */
/** `server` is the homeserver's own domain: only its Minds' receipts count. */
export const buildAlbums = (inputs: AlbumInput[], server = ''): Album[] => {
  const seen = new Set<string>();
  return inputs
    .map((i) => toAlbum(i, server))
    .filter((a): a is Album => {
      if (!a || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    })
    .sort((a, b) => b.ts - a.ts);
};
