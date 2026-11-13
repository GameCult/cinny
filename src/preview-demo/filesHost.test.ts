import { describe, expect, it } from 'vitest';
import { createClient } from 'matrix-js-sdk';
import { createDemoServer } from './server';
import { guardedFetch } from './install';
import {
  createFilesHost,
  openIdTokenSource,
  FilesHostError,
} from '../app/features/files/filesHost';
import { DEMO_FILES_HOST } from './filesHost';
import { DEMO_ORIGIN, ME } from './fixtures';

const PAGE = 'https://page.test';
const never = (async () => new Response('real network')) as never;

// The client against the fake, through the same guard the page uses: what the Files desk will see in the preview.
const setup = () => {
  const server = createDemoServer();
  const fetchFn = guardedFetch(server, PAGE, never);
  const mx = createClient({
    baseUrl: DEMO_ORIGIN,
    userId: ME,
    accessToken: 'x',
    fetchFn: fetchFn as never,
  });
  const host = createFilesHost({
    host: DEMO_FILES_HOST,
    token: openIdTokenSource(mx),
    fetchFn: (u, i) => fetchFn(u, i),
  });
  return { server, host, fetchFn };
};

describe('the pretend file host', () => {
  it('lists the zones at the root and a zone one level at a time, with sniffed mime and a sha256 on files', async () => {
    const { host, server } = setup();
    const root = await host.list('');
    expect(root.entries.map((e) => e.name)).toEqual(['aqua', 'commons']);
    expect(root.role).toBe('member');
    const poses = await host.list('commons/cast-art/poses');
    expect(poses.entries).toEqual([
      expect.objectContaining({
        kind: 'file',
        name: 'aqua-calm.png',
        mime: 'image/png',
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      expect.objectContaining({ name: 'nibu-bright.png' }),
    ]);
    const commons = await host.list('commons');
    expect(commons.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:backlog',
      'dir:cast-art',
      'dir:uploads',
      'file:README.txt',
    ]);
    server.close();
  });

  it('serves the bytes of a file, whole and by range, and the hash is the hash of those bytes', async () => {
    const { host, server } = setup();
    const entry = (await host.list('aqua/shared')).entries.find((e) => e.name === 'clip-01.wav');
    if (entry?.kind !== 'file') throw new Error('no clip');
    const whole = await host.file('aqua/shared/clip-01.wav');
    const bytes = new Uint8Array(await whole.arrayBuffer());
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(bytes.length).toBe(entry.size);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    expect(
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    ).toBe(entry.hash);
    const part = await host.file('aqua/shared/clip-01.wav', { range: 'bytes=4-11' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-11/${entry.size}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(4, 12));
    const tail = await host.file('aqua/shared/clip-01.wav', { range: 'bytes=-4' });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(-4));
    await expect(
      host.file('aqua/shared/clip-01.wav', { range: `bytes=${entry.size}-` })
    ).rejects.toMatchObject({ status: 416 });
    server.close();
  });

  it.each([
    'handoff-private',
    'handoff-private/x',
    'commons/../aqua',
    '../etc/passwd',
    '/commons',
    'commons//cast-art',
    'commons/.hidden',
    'commons/nope',
    'nozone',
    'commons/README.txt/x',
  ])(
    'answers 404 for %j: a path the host would not resolve says nothing about what exists',
    async (path) => {
      const { host, server } = setup();
      await expect(host.list(path)).rejects.toMatchObject({ status: 404 });
      await expect(host.file(path)).rejects.toMatchObject({ status: 404 });
      server.close();
    }
  );

  it('refuses a request without the OpenID bearer, a wrong one, and any write', async () => {
    const { fetchFn, server } = setup();
    const url = `${DEMO_FILES_HOST}/index?path=`;
    expect((await fetchFn(url)).status).toBe(401);
    expect(
      (await fetchFn(url, { headers: { Authorization: 'Bearer demo-preview-token' } })).status
    ).toBe(401);
    const put = await fetchFn(`${DEMO_FILES_HOST}/file?path=commons/uploads/x.txt`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer demo-openid-token' },
      body: 'x',
    });
    expect(put.status).toBe(405);
    server.close();
  });

  it('refuses to list a file and to fetch a directory', async () => {
    const { host, server } = setup();
    await expect(host.list('commons/README.txt')).rejects.toBeInstanceOf(FilesHostError);
    await expect(host.file('commons/cast-art')).rejects.toBeInstanceOf(FilesHostError);
    server.close();
  });
});
