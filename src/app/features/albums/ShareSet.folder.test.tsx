import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { MediaConfig, MediaConfigProvider } from '../../hooks/useMediaConfig';

// ShareSet hands its folder to the title the send lands under. The controller is held still and its
// `run` captured, and sendShareSet records the title it was given, so the path from the `folder`
// prop to the album root's title is read without a homeserver or a DOM.
const captured = vi.hoisted(() => ({
  run: undefined as undefined | ((files: unknown[], title: string, onFile: () => void) => unknown),
  maxBytes: undefined as undefined | (() => number | undefined),
  titles: [] as string[],
}));

vi.mock('./shareController', () => ({
  createShareController: (deps: {
    run: NonNullable<typeof captured.run>;
    maxBytes: NonNullable<typeof captured.maxBytes>;
  }) => {
    captured.run = deps.run;
    captured.maxBytes = deps.maxBytes;
    return {
      subscribe: () => () => undefined,
      getState: () => ({ files: [], title: '', phase: { kind: 'idle' }, epoch: 0 }),
      pick: () => undefined,
      setTitle: () => undefined,
      send: () => undefined,
      cancel: () => undefined,
    };
  },
}));
vi.mock('./shareSet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shareSet')>()),
  sendShareSet: async (_port: unknown, into: string | { albumId: string; lastId: string }) => {
    captured.titles.push(typeof into === 'string' ? into : `into:${into.albumId}@${into.lastId}`);
    return { albumId: '$a', sent: 0, failed: [], failedAt: [] };
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  // The server renderer has no snapshot for an external store; read the client one.
  const useSyncExternalStore = (_sub: unknown, get: () => unknown) => get();
  return { ...actual, default: { ...actual, useSyncExternalStore }, useSyncExternalStore };
});

// eslint-disable-next-line import/first
import { ShareSet } from './ShareSet';

const timeline: unknown[] = [];
const ev = (id: string, ts: number, threadRootId?: string, status: string | null = null) => ({
  getId: () => id,
  getTs: () => ts,
  threadRootId,
  status,
});
const mount = (
  folder?: string[],
  into?: { albumId: string; lastId: string; lastTs: number },
  mediaConfig: MediaConfig = {}
) => {
  const room = {
    roomId: '!r:x',
    hasEncryptionStateEvent: () => false,
    getLiveTimeline: () => ({ getEvents: () => timeline }),
  } as never;
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MatrixClientProvider value={{ sendMessage: async () => ({ event_id: '$e' }) } as never}>
        <MediaConfigProvider value={mediaConfig}>
          <ShareSet room={room} folder={folder} into={into} />
        </MediaConfigProvider>
      </MatrixClientProvider>
    </QueryClientProvider>
  );
};
const send = async (typed: string) => {
  await captured.run?.([], typed, () => undefined);
  return captured.titles.at(-1);
};

describe('ShareSet: the folder reaches the album title', () => {
  beforeEach(() => {
    captured.run = undefined;
    captured.titles.length = 0;
    timeline.length = 0;
  });

  it('at the top, the typed title goes as typed', async () => {
    mount();
    expect(await send('Poses')).toBe('Poses');
  });

  it('inside a folder, the path prefixes the typed title', async () => {
    mount(['cast-art', 'poses']);
    expect(await send('Set 2')).toBe('cast-art/poses/Set 2');
  });

  it('an empty typed title falls back to the default, still under the folder', async () => {
    mount(['handoff']);
    expect(await send('  ')).toBe('handoff/Shared files');
  });

  it('a typed title containing a slash goes deeper', async () => {
    mount(['a']);
    expect(await send('b/c')).toBe('a/b/c');
  });

  it('an existing album takes the files instead of a title, whatever the folder', async () => {
    mount(['a'], { albumId: '$alb', lastId: '$last', lastTs: 5 });
    expect(await send('ignored')).toBe('into:$alb@$last');
  });

  it('the freshest sent event of that thread in the room timeline is where the files thread after', async () => {
    timeline.push(
      ev('$other', 99, '$else'),
      ev('$local', 98, '$alb', 'sending'),
      ev('$new', 50, '$alb'),
      ev('$sentNotEchoed', 60, '$alb', 'sent'),
      ev('$failed', 70, '$alb', 'not_sent')
    );
    mount(['a'], { albumId: '$alb', lastId: '$last', lastTs: 5 });
    expect(await send('x')).toBe('into:$alb@$sentNotEchoed');
  });
});

describe('ShareSet: the homeserver upload cap reaches the controller', () => {
  it('is the server-stated m.upload.size, and none when the server states none', () => {
    mount([], undefined, { 'm.upload.size': 52428800 });
    expect(captured.maxBytes?.()).toBe(52428800);
    mount([], undefined, {});
    expect(captured.maxBytes?.()).toBeUndefined();
    mount([], undefined, { 'm.upload.size': 0 });
    expect(captured.maxBytes?.()).toBeUndefined();
  });
});
