import { describe, expect, it } from 'vitest';
import { buildAlbums } from './buildAlbums';
import type { Album, ZoneEvent } from './buildAlbums';
import { folderOf, listFolder, splitPath, titleIn } from './albumFolders';
import { DEFAULT_TITLE, sendShareSet } from './shareSet';

const album = (id: string, title: string, ts = 1): Album => ({
  id,
  title,
  author: '@a:x',
  ts,
  files: [],
  count: 0,
});
const names = (l: ReturnType<typeof listFolder>) => ({
  folders: l.folders.map((f) => `${f.name}:${f.albums}`),
  albums: l.albums.map((a) => `${a.album.id}=${a.leaf}`),
});

describe('splitPath', () => {
  it('drops empty segments and padding; dots are names, not navigation', () => {
    expect(splitPath(' a // b /')).toEqual(['a', 'b']);
    expect(splitPath('../x')).toEqual(['..', 'x']);
    expect(splitPath('///')).toEqual([]);
  });
});

describe('listFolder', () => {
  const all = [
    album('$1', 'handoff/2026-11/notes', 10),
    album('$2', 'handoff/2026-11/plan', 30),
    album('$3', 'handoff/readme', 20),
    album('$4', 'cast-art', 5),
    album('$5', 'Plain album', 40),
  ];

  it('root: first segments become folders (counted below, newest first); single-segment titles are albums', () => {
    expect(names(listFolder(all, []))).toEqual({
      folders: ['handoff:3'],
      albums: ['$5=Plain album', '$4=cast-art'],
    });
  });

  it('nested: a folder shows its sub-folders and its own albums under their leaf names', () => {
    expect(names(listFolder(all, ['handoff']))).toEqual({
      folders: ['2026-11:2'],
      albums: ['$3=readme'],
    });
    expect(names(listFolder(all, ['handoff', '2026-11']))).toEqual({
      folders: [],
      albums: ['$2=plan', '$1=notes'],
    });
  });

  it('an album titled exactly like a folder is not hidden by it', () => {
    const l = listFolder([album('$a', 'x'), album('$b', 'x/y')], []);
    expect(names(l)).toEqual({ folders: ['x:1'], albums: ['$a=x'] });
    expect(names(listFolder([album('$a', 'x'), album('$b', 'x/y')], ['x']))).toEqual({
      folders: [],
      albums: ['$b=y'],
    });
  });

  it('a path that exists nowhere lists nothing; the prefix match is by whole segment', () => {
    expect(names(listFolder(all, ['hand']))).toEqual({ folders: [], albums: [] });
  });

  it('an untitled or all-slash album stays at the root, nowhere else', () => {
    const odd = [album('$u', '///')];
    expect(names(listFolder(odd, []))).toEqual({ folders: [], albums: ['$u=///'] });
    expect(names(listFolder(odd, ['x']))).toEqual({ folders: [], albums: [] });
  });

  it('server-supplied names like "constructor" are folders, not prototype hits', () => {
    expect(names(listFolder([album('$c', 'constructor/a')], []))).toEqual({
      folders: ['constructor:1'],
      albums: [],
    });
  });
});

describe('titleIn and folderOf', () => {
  it('prefixes the folder, keeps a typed sub-path, falls back to the default title', () => {
    expect(titleIn([], '', DEFAULT_TITLE)).toBe(DEFAULT_TITLE);
    expect(titleIn([], ' Mine ', DEFAULT_TITLE)).toBe('Mine');
    expect(titleIn(['uploads', 'me'], '', DEFAULT_TITLE)).toBe(`uploads/me/${DEFAULT_TITLE}`);
    expect(titleIn(['uploads'], 'a/b', DEFAULT_TITLE)).toBe('uploads/a/b');
  });

  it('folderOf is the title path without its leaf', () => {
    expect(folderOf(album('$', 'a/b/c'))).toEqual(['a', 'b']);
    expect(folderOf(album('$', 'c'))).toEqual([]);
  });
});

describe('a share into a folder, read back as the viewer reads it', () => {
  it('posts a root titled under the folder, and buildAlbums + listFolder put it in that folder', async () => {
    const sent: Record<string, unknown>[] = [];
    const res = await sendShareSet(
      {
        send: async (c) => {
          sent.push(c);
          return `$e${sent.length}`;
        },
        contentOf: async (f) => ({ msgtype: 'm.file', body: f.name, filename: f.name }),
      },
      titleIn(['uploads', 'meta'], 'Photos', DEFAULT_TITLE),
      [{ name: 'a.png', mimeType: 'image/png' }]
    );
    expect(res.sent).toBe(1);
    expect(sent[0]).toEqual({ msgtype: 'm.text', body: 'uploads/meta/Photos' });

    const asEvent = (c: Record<string, unknown>, id: string): ZoneEvent => ({
      event_id: id,
      type: 'm.room.message',
      sender: '@a:x',
      origin_server_ts: 1,
      content: c,
    });
    const albums = buildAlbums([
      { root: asEvent(sent[0], '$e1'), replies: [asEvent(sent[1], '$e2')] },
    ]);
    expect(names(listFolder(albums, []))).toEqual({ folders: ['uploads:1'], albums: [] });
    expect(names(listFolder(albums, ['uploads', 'meta']))).toEqual({
      folders: [],
      albums: ['$e1=Photos'],
    });
  });
});
