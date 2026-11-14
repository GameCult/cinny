// Pure: turns the thread roots of a file-zone room and each root's thread replies, in the JSON
// Synapse returns from GET /rooms/{roomId}/threads and GET /rooms/{roomId}/relations/{root}/m.thread,
// into albums. See docs/file-zone.md for the rulings this encodes.
import { readersOf } from './fileReceipt';
import type { FileReader } from './fileReceipt';
import { foldVersions } from './versions';

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
  sender: string;
  ts: number;
  /** The event content, as RenderMessageContent reads it. */
  content: Record<string, unknown>;
  /** Receipts in this album that name this file, one per sender (the latest), oldest first. */
  readBy: FileReader[];
  /** The versions this file supersedes, nearest first (`org.gamecult.publish.replaces`). */
  earlier: AlbumFile[];
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

export const toFile = (e: ZoneEvent): AlbumFile | undefined => {
  if (!live(e)) return undefined;
  const kind = KIND_OF_MSGTYPE.get(e.content.msgtype as string);
  if (!kind) return undefined;
  return {
    id: e.event_id,
    kind,
    name: asString(e.content.filename) || asString(e.content.body),
    sender: e.sender ?? '',
    ts: tsOf(e.origin_server_ts),
    content: e.content,
    readBy: [],
    earlier: [],
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
  const list = Array.isArray(replies) ? replies : [];
  const files = list
    .map(toFile)
    .filter((f): f is AlbumFile => {
      if (!f || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    })
    .sort((a, b) => a.ts - b.ts)
    .map((f) => ({ ...f, readBy: readersOf(list, f.id, f.content, server) }));
  const heads = foldVersions(files);
  return {
    id: root.event_id,
    title: titleOf(root),
    author: root.sender ?? '',
    ts: tsOf(root.origin_server_ts),
    cover: heads.find((f) => f.kind === 'image'),
    files: heads,
    count: heads.length,
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

/** The newest event in an album's thread (shown or folded), else its root: where a new file threads after. */
export const lastEvent = (album: Album): { id: string; ts: number } =>
  album.files
    .flatMap((f) => [f, ...f.earlier])
    .reduce<{ id: string; ts: number }>((a, f) => (f.ts >= a.ts ? { id: f.id, ts: f.ts } : a), {
      id: album.id,
      ts: album.ts,
    });

/** A room event with the thread root the SDK resolved for it, when it has one. */
export type TimelineEvent = ZoneEvent & { threadRoot?: string };

/**
 * File events that sit in the room outside any album thread: what a poster that does not thread
 * its files leaves behind. The album list never reads them (it lists threads), so they are named
 * to the sender instead of left out silently.
 */
export const looseFiles = (events: TimelineEvent[]): AlbumFile[] =>
  events
    .filter((e) => {
      const rel = e?.content?.['m.relates_to'] as { rel_type?: unknown } | undefined;
      return !e?.threadRoot && rel?.rel_type !== 'm.thread';
    })
    .map(toFile)
    .filter((f): f is AlbumFile => !!f);

const NAMED = 3;

/** The line that says loose files exist and are not listed; empty when there are none. */
export const looseNote = (files: AlbumFile[]): string => {
  if (files.length === 0) return '';
  const names = files.slice(0, NAMED).map((f) => f.name || 'unnamed');
  const more = files.length > NAMED ? ` and ${files.length - NAMED} more` : '';
  const what = files.length === 1 ? '1 file was' : `${files.length} files were`;
  return `${what} posted outside an album and ${
    files.length === 1 ? 'is' : 'are'
  } not listed here: ${names.join(', ')}${more}. ${
    files.length === 1 ? 'It is' : 'They are'
  } in the Timeline.`;
};
