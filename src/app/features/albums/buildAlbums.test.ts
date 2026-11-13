import { describe, expect, it } from 'vitest';
import { AlbumInput, ZoneEvent, buildAlbums, lastEventId } from './buildAlbums';

const root = (id: string, ts: number, over: Partial<ZoneEvent> = {}): ZoneEvent => ({
  event_id: id,
  type: 'm.room.message',
  sender: '@void:x',
  origin_server_ts: ts,
  content: { msgtype: 'm.text', body: `album ${id}` },
  ...over,
});
const reply = (id: string, ts: number, msgtype: string, body = id, extra = {}): ZoneEvent => ({
  event_id: id,
  type: 'm.room.message',
  sender: '@void:x',
  origin_server_ts: ts,
  content: { msgtype, body, ...extra },
});
const one = (r: ZoneEvent, replies: ZoneEvent[]) => buildAlbums([{ root: r, replies }])[0];

describe('buildAlbums', () => {
  it('lists the newest album first', () => {
    const inputs: AlbumInput[] = [
      { root: root('$old', 100), replies: [] },
      { root: root('$new', 300), replies: [] },
      { root: root('$mid', 200), replies: [] },
    ];
    expect(buildAlbums(inputs).map((a) => a.id)).toEqual(['$new', '$mid', '$old']);
  });

  it('takes title, author and date from the root', () => {
    const a = one(root('$r', 555, { sender: '@eureka:x' }), []);
    expect([a.title, a.author, a.ts]).toEqual(['album $r', '@eureka:x', 555]);
  });

  it('lists files oldest first whatever order the server returned them in', () => {
    const a = one(root('$r', 1), [
      reply('$c', 30, 'm.audio'),
      reply('$a', 10, 'm.audio'),
      reply('$b', 20, 'm.audio'),
    ]);
    expect(a.files.map((f) => f.id)).toEqual(['$a', '$b', '$c']);
  });

  it('counts media replies only; a text reply is not a file', () => {
    const a = one(root('$r', 1), [
      reply('$t', 5, 'm.text', 'nice'),
      reply('$n', 6, 'm.notice', 'bot'),
      reply('$a', 10, 'm.audio'),
      reply('$f', 11, 'm.file'),
    ]);
    expect(a.count).toBe(2);
    expect(a.files.map((f) => f.id)).toEqual(['$a', '$f']);
  });

  it('keeps a root with no media as an album of zero files', () => {
    const a = one(root('$r', 1), [reply('$t', 5, 'm.text')]);
    expect(a).toMatchObject({ id: '$r', count: 0, files: [], cover: undefined });
  });

  it('uses the first image as the cover', () => {
    const a = one(root('$r', 1), [
      reply('$a', 5, 'm.audio'),
      reply('$i2', 20, 'm.image'),
      reply('$i1', 10, 'm.image'),
    ]);
    expect(a.cover?.id).toBe('$i1');
    expect(one(root('$q', 1), [reply('$a', 5, 'm.audio')]).cover).toBeUndefined();
  });

  it('derives the kind from the msgtype', () => {
    const a = one(root('$r', 1), [
      reply('$1', 1, 'm.audio'),
      reply('$2', 2, 'm.image'),
      reply('$3', 3, 'm.video'),
      reply('$4', 4, 'm.file'),
    ]);
    expect(a.files.map((f) => f.kind)).toEqual(['audio', 'image', 'video', 'file']);
  });

  it('names a file by filename, else body', () => {
    const a = one(root('$r', 1), [
      reply('$1', 1, 'm.audio', 'caption', { filename: 'clip.wav' }),
      reply('$2', 2, 'm.audio', 'plain.wav'),
    ]);
    expect(a.files.map((f) => f.name)).toEqual(['clip.wav', 'plain.wav']);
  });

  it('does not duplicate a file the relations endpoint returned twice', () => {
    const a = one(root('$r', 1), [reply('$a', 5, 'm.audio'), reply('$a', 5, 'm.audio')]);
    expect(a.count).toBe(1);
  });

  it('does not duplicate an album listed twice', () => {
    expect(
      buildAlbums([
        { root: root('$r', 1), replies: [] },
        { root: root('$r', 1), replies: [] },
      ])
    ).toHaveLength(1);
  });

  it('skips redacted and empty events', () => {
    const redacted = {
      ...reply('$x', 5, 'm.audio'),
      content: {},
      unsigned: { redacted_because: {} },
    };
    const stillTyped = { ...reply('$y', 6, 'm.audio'), unsigned: { redacted_because: {} } };
    const empty: ZoneEvent = { event_id: '$z' };
    const a = one(root('$r', 1), [redacted, stillTyped, empty, reply('$ok', 7, 'm.audio')]);
    expect(a.files.map((f) => f.id)).toEqual(['$ok']);
    expect(buildAlbums([{ root: root('$g', 1, { content: {} }), replies: [] }])).toEqual([]);
    expect(
      buildAlbums([{ root: root('$h', 1, { unsigned: { redacted_because: {} } }), replies: [] }])
    ).toEqual([]);
  });

  it('tolerates events with missing fields', () => {
    const a = one({ event_id: '$r', content: { msgtype: 'm.text' } }, [
      { event_id: '$a', content: { msgtype: 'm.audio' } },
    ]);
    expect(a).toMatchObject({ title: 'Untitled album', author: '', ts: 0, count: 1 });
  });

  it('does not read inherited object keys as file kinds', () => {
    const a = one(root('$r', 1), [
      reply('$c', 1, 'constructor'),
      reply('$p', 2, '__proto__'),
      reply('$t', 3, 'toString'),
    ]);
    expect(a.count).toBe(0);
  });

  it('skips events that are not room messages even if their content looks like media', () => {
    const reaction = { ...reply('$x', 5, 'm.audio'), type: 'm.reaction' };
    const a = one(root('$r', 1), [reaction, reply('$ok', 6, 'm.audio')]);
    expect(a.files.map((f) => f.id)).toEqual(['$ok']);
    expect(buildAlbums([{ root: root('$g', 1, { type: 'm.reaction' }), replies: [] }])).toEqual([]);
  });

  it('skips events without an event id', () => {
    const anon: ZoneEvent = { type: 'm.room.message', content: { msgtype: 'm.audio', body: 'a' } };
    expect(one(root('$r', 1), [anon]).count).toBe(0);
    expect(
      buildAlbums([{ root: { content: { msgtype: 'm.text', body: 'x' } }, replies: [] }])
    ).toEqual([]);
  });

  it('titles an edited album by its latest edit', () => {
    const edited = root('$r', 1, {
      unsigned: {
        'm.relations': {
          'm.replace': { content: { 'm.new_content': { msgtype: 'm.text', body: 'renamed' } } },
        },
      },
    });
    expect(one(edited, []).title).toBe('renamed');
    const emptyEdit = root('$q', 1, { unsigned: { 'm.relations': { 'm.replace': {} } } });
    expect(one(emptyEdit, []).title).toBe('album $q');
  });

  it('survives null or non-object entries in inputs and replies', () => {
    const bad = [null, undefined, 'x', 7] as unknown as ZoneEvent[];
    const a = buildAlbums([
      null as unknown as AlbumInput,
      { root: null as unknown as ZoneEvent, replies: [] },
      { root: root('$r', 1), replies: [...bad, reply('$ok', 2, 'm.audio')] },
      { root: root('$s', 2), replies: null as unknown as ZoneEvent[] },
    ]);
    expect(a.map((x) => x.id)).toEqual(['$s', '$r']);
    expect(a[1].files.map((f) => f.id)).toEqual(['$ok']);
  });

  it('treats a non-numeric timestamp as 0 so it sorts first, not by string order', () => {
    const a = one(root('$r', 1), [
      reply('$b', 20, 'm.audio'),
      { ...reply('$bad', 0, 'm.audio'), origin_server_ts: '5' as unknown as number },
      { ...reply('$nan', 0, 'm.audio'), origin_server_ts: NaN },
      reply('$a', 10, 'm.audio'),
    ]);
    expect(a.files.map((f) => f.id)).toEqual(['$bad', '$nan', '$a', '$b']);
    const albums = buildAlbums([
      { root: root('$x', 100), replies: [] },
      { root: root('$y', 0, { origin_server_ts: '999' as unknown as number }), replies: [] },
    ]);
    expect(albums.map((x) => [x.id, x.ts])).toEqual([
      ['$x', 100],
      ['$y', 0],
    ]);
  });

  it('gives an album with an empty body a fallback title', () => {
    expect(one(root('$r', 1, { content: { msgtype: 'm.text', body: '' } }), []).title).toBe(
      'Untitled album'
    );
    expect(one(root('$q', 1, { content: { msgtype: 'm.text' } }), []).title).toBe('Untitled album');
  });

  it('never counts an edit event as a file or an album', () => {
    const edit = reply('$e', 9, 'm.audio', '* x', {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$a' },
      'm.new_content': { msgtype: 'm.audio', body: 'x' },
    });
    const a = one(root('$r', 1), [reply('$a', 5, 'm.audio'), edit]);
    expect(a.files.map((f) => f.id)).toEqual(['$a']);
    const rootEdit = root('$re', 1, {
      content: { msgtype: 'm.text', body: '* t', 'm.relates_to': { rel_type: 'm.replace' } },
    });
    expect(buildAlbums([{ root: rootEdit, replies: [] }])).toEqual([]);
    const threaded = reply('$t', 6, 'm.audio', 't', {
      'm.relates_to': { rel_type: 'm.thread', event_id: '$r' },
    });
    expect(one(root('$q', 1), [threaded]).count).toBe(1);
  });
});

describe('versions', () => {
  const v = (id: string, ts: number, replaces?: string) =>
    reply(id, ts, 'm.file', id, replaces ? { 'org.gamecult.publish': { replaces } } : {});

  it('lists the latest of a chain and folds the earlier versions under it', () => {
    const a = one(root('$r', 1), [v('$v1', 10), v('$v2', 20, '$v1'), reply('$x', 30, 'm.file')]);
    expect(a.files.map((f) => [f.id, f.earlier.map((e) => e.id)])).toEqual([
      ['$v2', ['$v1']],
      ['$x', []],
    ]);
    expect(a.count).toBe(2);
  });
});

describe('versions: cover and sender', () => {
  it('the cover comes from the shown version, not a folded image', () => {
    const img = (id: string, ts: number, type: string, replaces?: string) =>
      reply(id, ts, type, id, replaces ? { 'org.gamecult.publish': { replaces } } : {});
    const a = one(root('$r', 1), [img('$v1', 10, 'm.image'), img('$v2', 20, 'm.file', '$v1')]);
    expect(a.files.map((f) => f.id)).toEqual(['$v2']);
    expect(a.cover).toBeUndefined();
  });
});

describe('lastEventId', () => {
  it('is the newest event of the thread, a folded version included; the root when empty', () => {
    const v = (id: string, ts: number, replaces?: string) =>
      reply(id, ts, 'm.file', id, replaces ? { 'org.gamecult.publish': { replaces } } : {});
    expect(lastEventId(one(root('$r', 1), [v('$a', 10), v('$b', 20, '$a'), v('$c', 15)]))).toBe(
      '$b'
    );
    expect(lastEventId(one(root('$r', 1), []))).toBe('$r');
  });
});

describe('Mind receipts', () => {
  const HASH = 'a'.repeat(64);
  const file = (id: string, sha?: string) =>
    reply(id, 10, 'm.audio', id, { info: sha ? { sha256: sha } : {} });
  const receipt = (
    id: string,
    ts: number,
    sender: string,
    fileId: unknown,
    sha?: unknown,
    extra: Record<string, unknown> = {}
  ) =>
    ({
      event_id: id,
      type: 'org.gamecult.file_received',
      sender,
      origin_server_ts: ts,
      content: { 'org.gamecult.file_received': { event_id: fileId, sha256: sha, ...extra } },
    } as ZoneEvent);

  const oneX = (r: ZoneEvent, replies: ZoneEvent[]) => buildAlbums([{ root: r, replies }], 'x')[0];

  it('shows who read a file when the receipt carries the file event hash', () => {
    const a = oneX(root('$r', 1), [file('$f', HASH), receipt('$x', 20, '@void:x', '$f', HASH)]);
    expect(a.files[0].readBy).toEqual([{ sender: '@void:x', ts: 20 }]);
    expect(a.count).toBe(1);
  });
  it('counts nothing for a hash that differs, a missing hash on either side, or a bad hash', () => {
    const a = oneX(root('$r', 1), [
      file('$f', HASH),
      file('$g'),
      receipt('$x', 20, '@void:x', '$f', 'b'.repeat(64)),
      receipt('$y', 21, '@void:x', '$g', HASH),
      receipt('$z', 22, '@void:x', '$f', undefined),
      receipt('$w', 23, '@void:x', '$f', 7),
    ]);
    expect(a.files.every((f) => f.readBy.length === 0)).toBe(true);
  });
  it('trusts the event sender, never a Mind field inside the content', () => {
    const a = oneX(root('$r', 1), [
      file('$f', HASH),
      receipt('$x', 20, '@mallory:x', '$f', HASH, { mind: 'void', sender: '@void:x' }),
    ]);
    expect(a.files[0].readBy).toEqual([]);
  });
  it('counts only a Mind of this homeserver: not another server, a lookalike, or a bare name', () => {
    const a = oneX(root('$r', 1), [
      file('$f', HASH),
      receipt('$x', 20, '@void-fan:x', '$f', HASH),
      receipt('$y', 21, '@x:void', '$f', HASH),
      receipt('$z', 22, '@aqua:x', '$f', HASH),
      receipt('$e', 23, '@void:evil.example', '$f', HASH),
      receipt('$b', 24, 'void:x', '$f', HASH),
    ]);
    expect(a.files[0].readBy.map((r) => r.sender)).toEqual(['@aqua:x']);
  });
  it('keeps one receipt per Mind, the latest, and a second Mind beside it', () => {
    const a = oneX(root('$r', 1), [
      file('$f', HASH),
      receipt('$1', 20, '@void:x', '$f', HASH),
      receipt('$2', 30, '@void:x', '$f', HASH),
      receipt('$3', 25, '@eureka:x', '$f', HASH),
    ]);
    expect(a.files[0].readBy).toEqual([
      { sender: '@eureka:x', ts: 25 },
      { sender: '@void:x', ts: 30 },
    ]);
  });
  it('ignores a receipt for a file not in the album, a malformed one, and a redacted one', () => {
    const redacted = {
      ...receipt('$d', 20, '@void:x', '$f', HASH),
      unsigned: { redacted_because: {} },
    };
    const a = oneX(root('$r', 1), [
      file('$f', HASH),
      receipt('$a', 20, '@void:x', '$elsewhere', HASH),
      receipt('$b', 21, '@void:x', 42, HASH),
      redacted,
    ]);
    expect(a.files[0].readBy).toEqual([]);
    expect(a.count).toBe(1);
  });
});
