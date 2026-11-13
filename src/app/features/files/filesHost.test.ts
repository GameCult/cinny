import { describe, expect, it, vi } from 'vitest';
import {
  FilesHostError,
  createFilesHost,
  isEntryName,
  joinPath,
  openIdTokenSource,
  parentPath,
  parseIndex,
} from './filesHost';

const file = { kind: 'file', name: 'a.wav', size: 10, mtime: 5, mime: 'audio/wav' };
const HASH = 'a'.repeat(64);

describe('parseIndex', () => {
  it('reads files and directories, keeping an absent hash absent', () => {
    expect(
      parseIndex({
        role: 'mind',
        path: 'commons/x',
        entries: [{ kind: 'dir', name: 'd', mtime: 1 }, file, { ...file, name: 'b', hash: HASH }],
      })
    ).toEqual({
      role: 'mind',
      path: 'commons/x',
      entries: [{ kind: 'dir', name: 'd', mtime: 1 }, file, { ...file, name: 'b', hash: HASH }],
    });
  });

  it('reads a role the client does not know as the least privilege, never as a known one', () => {
    expect(parseIndex({ role: 'root', path: '', entries: [] }).role).toBe('other');
    expect(parseIndex({ path: '', entries: [] }).role).toBe('other');
  });

  it.each([
    ['not an object', 'x'],
    ['no path', { entries: [] }],
    ['no entries', { path: '' }],
    ['entry not an object', { path: '', entries: [3] }],
    ['unknown kind', { path: '', entries: [{ ...file, kind: 'link' }] }],
    ['file without size', { path: '', entries: [{ ...file, size: undefined }] }],
    ['negative size', { path: '', entries: [{ ...file, size: -1 }] }],
    ['file without mime', { path: '', entries: [{ ...file, mime: '' }] }],
    ['no mtime', { path: '', entries: [{ ...file, mtime: 'now' }] }],
    ['hash not sha256 hex', { path: '', entries: [{ ...file, hash: 'abc' }] }],
    ['upper-case hash', { path: '', entries: [{ ...file, hash: 'A'.repeat(64) }] }],
  ])('refuses a malformed index: %s', (_why, raw) => {
    expect(() => parseIndex(raw)).toThrow(FilesHostError);
  });

  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b', '../x'])(
    'refuses an entry named %j, so a listed name can never be a path',
    (name) => {
      expect(() => parseIndex({ path: '', entries: [{ ...file, name }] })).toThrow(FilesHostError);
      expect(isEntryName(name)).toBe(false);
    }
  );
});

describe('paths', () => {
  it('joins a base and a listed name, and refuses a name that is a path', () => {
    expect(joinPath('', 'commons')).toBe('commons');
    expect(joinPath('commons/cast-art', 'poses')).toBe('commons/cast-art/poses');
    expect(joinPath('commons/', 'x')).toBe('commons/x');
    expect(() => joinPath('commons', '../handoff-private')).toThrow();
    expect(() => joinPath('commons', 'a/b')).toThrow();
  });

  it('goes up one level', () => {
    expect(parentPath('commons/a/b')).toBe('commons/a');
    expect(parentPath('commons')).toBe('');
    expect(parentPath('')).toBe('');
  });
});

describe('openIdTokenSource', () => {
  const mx = () => {
    let n = 0;
    return {
      getOpenIdToken: vi.fn(async () => {
        n += 1;
        return {
          access_token: `t${n}`,
          token_type: 'Bearer',
          matrix_server_name: 's',
          expires_in: 3600,
        };
      }),
    };
  };

  it('caches until a minute before expiry, then asks again', async () => {
    const client = mx();
    let t = 0;
    const source = openIdTokenSource(client, () => t);
    expect(await source()).toBe('t1');
    t = 3539_000;
    expect(await source()).toBe('t1');
    t = 3541_000;
    expect(await source()).toBe('t2');
    expect(client.getOpenIdToken).toHaveBeenCalledTimes(2);
  });

  it('asks again on fresh, whatever is cached', async () => {
    const source = openIdTokenSource(mx(), () => 0);
    await source();
    expect(await source({ fresh: true })).toBe('t2');
  });
});

describe('createFilesHost', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // the first token is the cached one, the second what a fresh ask returns
  const token = (cached: string, renewed = cached) =>
    vi.fn(async ({ fresh = false } = {}) => (fresh ? renewed : cached));

  it('asks for the index with the path encoded and the bearer token', async () => {
    const fetchFn = vi.fn(async () => json({ role: 'member', path: 'commons/a b', entries: [] }));
    const host = createFilesHost({ host: 'https://h.test/', token: token('t'), fetchFn });
    expect((await host.list('commons/a b')).path).toBe('commons/a b');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://h.test/index?path=commons%2Fa%20b');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer t', Accept: 'application/json' });
  });

  it('retries once with a fresh token on 401, and only once', async () => {
    const answers = [json({ code: 'c' }, 401), json({ role: 'member', path: '', entries: [] })];
    const fetchFn = vi.fn(async () => answers.shift() as Response);
    const tk = token('old', 'new');
    await createFilesHost({ host: 'https://h.test', token: tk, fetchFn }).list('');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toMatchObject({
      Authorization: 'Bearer new',
    });

    const always = vi.fn(async () => json({ code: 'c' }, 401));
    await expect(
      createFilesHost({ host: 'https://h.test', token: token('a', 'b'), fetchFn: always }).list('')
    ).rejects.toMatchObject({ status: 401, code: 'c' });
    expect(always).toHaveBeenCalledTimes(2);
  });

  it('carries the host code and message untouched, and keeps the status text when the body is not JSON', async () => {
    const host = (res: Response) =>
      createFilesHost({ host: 'https://h.test', token: token('t'), fetchFn: async () => res });
    await expect(
      host(json({ code: 'whatever', error: 'No' }, 403)).list('x')
    ).rejects.toMatchObject({ status: 403, code: 'whatever', message: 'No' });
    await expect(
      host(new Response('<html>', { status: 502, statusText: 'Bad Gateway' })).list('x')
    ).rejects.toMatchObject({ status: 502, code: undefined, message: 'Bad Gateway' });
  });

  it('refuses a malformed index from a host that answered 200', async () => {
    const host = createFilesHost({
      host: 'https://h.test',
      token: token('t'),
      fetchFn: async () => json({ nope: 1 }),
    });
    await expect(host.list('')).rejects.toBeInstanceOf(FilesHostError);
  });

  it('asks for a file with a Range when given one, and passes the signal on', async () => {
    const fetchFn = vi.fn(async () => new Response('x', { status: 206 }));
    const ctl = new AbortController();
    const host = createFilesHost({ host: 'https://h.test', token: token('t'), fetchFn });
    expect(
      (await host.file('aqua/shared/c.wav', { range: 'bytes=0-9', signal: ctl.signal })).status
    ).toBe(206);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://h.test/file?path=aqua%2Fshared%2Fc.wav');
    expect(init.headers).toMatchObject({ Range: 'bytes=0-9' });
    expect(init.signal).toBe(ctl.signal);
    await host.file('a');
    expect(
      (fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1].headers
    ).not.toHaveProperty('Range');
  });
});
