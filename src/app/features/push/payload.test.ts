import { describe, expect, it } from 'vitest';
import { describePush, GENERIC, parsePush } from './payload';
import { matrixNotify, mockHomeserver, SESSION } from './testkit';

describe('parsePush', () => {
  it('reads the Matrix gateway body and the bare inner object', () => {
    const a = parsePush(matrixNotify('!r:x', '$e'));
    expect(a).toMatchObject({ roomId: '!r:x', eventId: '$e' });
    expect(parsePush({ room_id: '!r:x', event_id: '$e' })).toMatchObject({ roomId: '!r:x' });
  });
  it('rejects a body with no room id', () => {
    expect(parsePush({ notification: { event_id: '$e' } })).toBeUndefined();
    expect(parsePush(undefined)).toBeUndefined();
    expect(parsePush('x')).toBeUndefined();
  });
  it('carries text the gateway added', () => {
    expect(
      parsePush({
        notification: {
          room_id: '!r:x',
          room_name: 'Lobby',
          sender_display_name: 'Ann',
          content: { body: 'hi' },
        },
      })
    ).toMatchObject({ roomName: 'Lobby', sender: 'Ann', text: 'hi' });
  });
});

describe('describePush', () => {
  const ids = { roomId: '!r:x', eventId: '$e' };
  const event = {
    type: 'm.room.message',
    sender: '@ann:x',
    content: { msgtype: 'm.text', body: 'hello there' },
  };

  it('resolves ids through the homeserver with the stored token', async () => {
    const hs = mockHomeserver({
      token: 'tok-1',
      events: { $e: event },
      roomNames: { '!r:x': 'Lobby' },
    });
    expect(await describePush(ids, SESSION, hs.fetchFn)).toEqual({
      title: 'Lobby',
      body: 'ann: hello there',
    });
    expect(hs.seen).toHaveLength(2);
    expect(
      hs.seen.every(
        (r) => r.auth === 'Bearer tok-1' && r.url.startsWith('https://matrix.example/_matrix/')
      )
    ).toBe(true);
    expect(hs.seen[0].url).toContain('/rooms/!r%3Ax/');
  });
  it('shows the generic notification with no session, and asks nobody', async () => {
    const hs = mockHomeserver({ token: 'tok-1' });
    expect(await describePush(ids, undefined, hs.fetchFn)).toEqual({
      title: 'Ratatoskr',
      body: 'New message',
    });
    expect(hs.seen).toHaveLength(0);
  });
  it('falls back when the token is refused, the network is down, or the event is encrypted', async () => {
    const stale = mockHomeserver({ token: 'other', events: { $e: event } });
    expect(await describePush(ids, SESSION, stale.fetchFn)).toEqual(GENERIC);
    const down = mockHomeserver({ token: 'tok-1', failAll: true });
    expect(await describePush(ids, SESSION, down.fetchFn)).toEqual(GENERIC);
    const enc = mockHomeserver({
      token: 'tok-1',
      events: {
        $e: {
          type: 'm.room.encrypted',
          sender: '@ann:x',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      },
      roomNames: { '!r:x': 'Lobby' },
    });
    expect(await describePush(ids, SESSION, enc.fetchFn)).toEqual({
      title: 'Lobby',
      body: 'New message',
    });
  });
  it('does not fetch what the push already carried', async () => {
    const hs = mockHomeserver({ token: 'tok-1' });
    const shown = await describePush(
      { ...ids, roomName: 'R', sender: 'Bo', text: 'yo' },
      SESSION,
      hs.fetchFn
    );
    expect(shown).toEqual({ title: 'R', body: 'Bo: yo' });
    expect(hs.seen).toHaveLength(0);
  });
  it('clips a long body', async () => {
    const hs = mockHomeserver({
      token: 'tok-1',
      events: { $e: { ...event, content: { body: 'x'.repeat(500) } } },
    });
    const shown = await describePush(ids, SESSION, hs.fetchFn);
    expect(shown.body.length).toBeLessThanOrEqual(200);
    expect(shown.body.endsWith('…')).toBe(true);
  });
  it('shows the generic notification when the push names no room', async () => {
    const hs = mockHomeserver({ token: 'tok-1' });
    expect(await describePush(undefined, SESSION, hs.fetchFn)).toEqual(GENERIC);
  });
});
