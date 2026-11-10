import { describe, expect, it } from 'vitest';
import { AlbumInput, ZoneEvent, buildAlbums } from './buildAlbums';

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
    expect(a).toMatchObject({ title: '', author: '', ts: 0, count: 1 });
  });
});
