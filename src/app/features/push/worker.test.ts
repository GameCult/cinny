import { describe, expect, it, vi } from 'vitest';
import { handleClick, handlePush, OPEN_ROOM, WorkerPort } from './worker';
import { matrixNotify, mockHomeserver, SESSION } from './testkit';

type Shown = { title: string; options: NotificationOptions & { renotify?: boolean } };

function port(over: Partial<WorkerPort> = {}) {
  const shown: Shown[] = [];
  const opened: string[] = [];
  const w: WorkerPort = {
    windows: async () => [],
    openWindow: async (u) => {
      opened.push(u);
    },
    show: async (title, options) => {
      shown.push({ title, options });
    },
    loadSession: async () => SESSION,
    fetch: mockHomeserver({ token: 'tok-1' }).fetchFn,
    scope: 'https://chat.example/',
    ...over,
  };
  return { w, shown, opened };
}

const msg = {
  type: 'm.room.message',
  sender: '@ann:x',
  content: { msgtype: 'm.text', body: 'hello' },
};

describe('push against a mock gateway and homeserver', () => {
  it('a push the homeserver sent for event_id_only becomes a notification naming room, sender and text', async () => {
    const hs = mockHomeserver({
      token: 'tok-1',
      events: { $e: msg },
      roomNames: { '!r:x': 'Lobby' },
    });
    const { w, shown } = port({ fetch: hs.fetchFn });
    await handlePush(matrixNotify('!r:x', '$e'), w);
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Lobby');
    expect(shown[0].options.body).toBe('ann: hello');
    expect(shown[0].options.tag).toBe('!r:x');
    expect(shown[0].options.renotify).toBe(true);
    expect(shown[0].options.data).toEqual({ roomId: '!r:x', eventId: '$e' });
  });
  it('with no stored session it still shows (a push must always show) and sends the token nowhere', async () => {
    const hs = mockHomeserver({ token: 'tok-1', events: { $e: msg } });
    const { w, shown } = port({ fetch: hs.fetchFn, loadSession: async () => undefined });
    await handlePush(matrixNotify('!r:x', '$e'), w);
    expect(shown[0]).toMatchObject({ title: 'Ratatoskr', options: { body: 'New message' } });
    expect(hs.seen).toHaveLength(0);
  });
  it('shows the generic notification for a body it cannot read', async () => {
    const { w, shown } = port();
    await handlePush(undefined, w);
    expect(shown[0].title).toBe('Ratatoskr');
    expect(shown[0].options.tag).toBeUndefined();
    expect(shown[0].options.data).toBeUndefined();
  });
  it('shows nothing while a window is visible and focused, and shows when the window is hidden', async () => {
    const win = (visibilityState: string, focused: boolean) => ({
      visibilityState,
      focused,
      focus: async () => undefined,
      postMessage: () => undefined,
    });
    const a = port({ windows: async () => [win('visible', true)] });
    await handlePush(matrixNotify('!r:x', '$e'), a.w);
    expect(a.shown).toHaveLength(0);
    const b = port({ windows: async () => [win('hidden', false), win('visible', false)] });
    await handlePush(matrixNotify('!r:x', '$e'), b.w);
    expect(b.shown).toHaveLength(1);
  });
});

describe('notification click', () => {
  it('focuses the open window and tells it the room', async () => {
    const focus = vi.fn(async () => undefined);
    const postMessage = vi.fn();
    const { w, opened } = port({
      windows: async () => [{ visibilityState: 'hidden', focused: false, focus, postMessage }],
    });
    await handleClick({ roomId: '!r:x', eventId: '$e' }, w);
    expect(focus).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: OPEN_ROOM, roomId: '!r:x', eventId: '$e' });
    expect(opened).toHaveLength(0);
  });
  it('with no window, starts the app with the room in the URL', async () => {
    const { w, opened } = port();
    await handleClick({ roomId: '!r:x', eventId: '$e' }, w);
    const u = new URL(opened[0]);
    expect(u.origin + u.pathname).toBe('https://chat.example/');
    expect(u.searchParams.get('pushRoom')).toBe('!r:x');
    expect(u.searchParams.get('pushEvent')).toBe('$e');
  });
  it('with no window and no target, just opens the app', async () => {
    const { w, opened } = port();
    await handleClick(undefined, w);
    expect(opened).toEqual(['https://chat.example/']);
  });
});
