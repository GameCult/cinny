import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, MatrixClient, SyncState, createClient } from 'matrix-js-sdk';
import { DEMO_ORIGIN, ME, ROOMS, GENERAL, COMMONS } from './fixtures';
import { guardedFetch, installDemo, routeOf } from './install';
import { createDemoServer, DemoServer } from './server';
import { mindOfSender, POSE_KEY, resolvePose } from '../app/components/message/pose/poses';
import { parseRoomNotice, roomTrainingLine } from '../app/utils/trainingNotice';

const PAGE = 'https://page.test';
const never = vi.fn(async () => new Response('real network'));

const clientFor = (server: DemoServer): MatrixClient =>
  createClient({
    baseUrl: DEMO_ORIGIN,
    fetchFn: guardedFetch(server, PAGE, never as never) as never,
  });

const waitFor = <T>(read: () => T | undefined, ms = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const v = read();
      if (v !== undefined) resolve(v);
      else if (Date.now() - t0 > ms) reject(new Error('timed out'));
      else setTimeout(tick, 20);
    };
    tick();
  });

const live: { server: DemoServer; mx: MatrixClient }[] = [];
afterEach(() => {
  live.splice(0).forEach(({ server, mx }) => {
    mx.stopClient();
    server.close();
  });
  never.mockClear();
});

const syncedClient = async () => {
  const server = createDemoServer();
  const mx = clientFor(server);
  live.push({ server, mx });
  const login = await mx.loginWithPassword('demo', 'anything');
  mx.http.opts.accessToken = login.access_token;
  await mx.startClient({ initialSyncLimit: 20 });
  await waitFor(() => (mx.getSyncState() === SyncState.Syncing ? true : undefined));
  return { server, mx, login };
};

describe('routeOf', () => {
  it('lets own-origin requests through, answers the demo origin, refuses the rest', () => {
    expect(routeOf('/config.json', PAGE)).toBe('own');
    expect(routeOf(`${PAGE}/assets/a.js`, PAGE)).toBe('own');
    expect(routeOf('data:text/plain,hi', PAGE)).toBe('own');
    expect(routeOf(`${DEMO_ORIGIN}/_matrix/client/versions`, PAGE)).toBe('demo');
    expect(routeOf('https://matrix.org/_matrix/client/versions', PAGE)).toBe('refuse');
    expect(routeOf('https://page.test.evil.example/x', PAGE)).toBe('refuse');
    expect(routeOf('https://demo.invalid.evil.example/x', PAGE)).toBe('refuse');
    expect(routeOf('http://page.test/x', PAGE)).toBe('refuse');
    expect(routeOf('wss://matrix.org/socket', PAGE)).toBe('refuse');
    expect(routeOf('wss://page.test/socket', PAGE)).toBe('own');
  });
});

describe('the pretend homeserver through matrix-js-sdk', () => {
  it('logs in as demo with any password', async () => {
    const server = createDemoServer();
    live.push({ server, mx: clientFor(server) });
    const res = await live[0].mx.loginWithPassword('demo', 'whatever');
    expect(res.user_id).toBe(ME);
    expect(res.access_token).toBeTruthy();
  });

  it('syncs the joined rooms, space tree, direct message and members', async () => {
    const { mx } = await syncedClient();
    const joined = ROOMS.filter((r) => r.joined);
    expect(
      mx
        .getRooms()
        .map((r) => r.roomId)
        .sort()
    ).toEqual(joined.map((r) => r.id).sort());
    expect(mx.getRoom(GENERAL)?.name).toBe('General');
    expect(mx.getRoom(COMMONS)).toBeNull();
    const direct = mx.getAccountData('m.direct')?.getContent() as Record<string, string[]>;
    expect(Object.values(direct).flat()).toContain(ROOMS.find((r) => r.direct)?.id);
    expect(mx.getRoom(GENERAL)?.getJoinedMemberCount()).toBeGreaterThan(3);
  });

  it('carries pose labels that the pose catalogue resolves, for known Minds only', async () => {
    const { mx } = await syncedClient();
    const events = mx
      .getRoom(GENERAL)!
      .getLiveTimeline()
      .getEvents()
      .filter((e) => e.getType() === 'm.room.message');
    const posed = events.filter((e) => e.getContent()[POSE_KEY]);
    expect(posed.length).toBeGreaterThan(3);
    posed.forEach((e) => {
      const local = e.getSender()!.slice(1).split(':')[0];
      const mind = mindOfSender(local, undefined);
      expect(mind, e.getSender()!).toBeDefined();
      expect(resolvePose(mind!, e.getContent()[POSE_KEY])).toBe(e.getContent()[POSE_KEY]);
    });
    expect(events.some((e) => mindOfSender(e.getSender()!.slice(1).split(':')[0]) === undefined)).toBe(true);
  });

  it('shows the training line only in the rooms whose notice says train', async () => {
    const { mx } = await syncedClient();
    const lines = ROOMS.filter((r) => r.joined && !r.space && !r.direct).map((r) => {
      const ev = mx.getRoom(r.id)!.currentState.getStateEvents('org.gamecult.notice', '');
      return [r.name, roomTrainingLine(parseRoomNotice(ev?.getContent())) !== undefined];
    });
    expect(Object.fromEntries(lines)).toEqual({ General: true, Ratatoskr: false, Huginn: false });
  });

  it('sends a message, echoes it once with its transaction id, and a Mind answers with a pose', async () => {
    const { mx } = await syncedClient();
    const room = mx.getRoom(GENERAL)!;
    const before = room.getLiveTimeline().getEvents().length;
    const sent = await mx.sendTextMessage(GENERAL, 'hello pretend world');
    const mine = await waitFor(() =>
      room.getLiveTimeline().getEvents().find((e) => e.getId() === sent.event_id && !e.status)
    );
    expect(mine.getSender()).toBe(ME);
    const reply = await waitFor(
      () => room.getLiveTimeline().getEvents().find((e) => e.getSender() !== ME && e.getContent().body?.length && room.getLiveTimeline().getEvents().indexOf(e) >= before + 1),
      6000
    );
    expect(reply.getContent()[POSE_KEY]).toBeTruthy();
    const ours = room.getLiveTimeline().getEvents().filter((e) => e.getContent().body === 'hello pretend world');
    expect(ours).toHaveLength(1);
  });

  it('joins the unjoined public room and then syncs it', async () => {
    const { mx } = await syncedClient();
    const joinedRoom = new Promise<string>((resolve) => mx.on(ClientEvent.Room, (r) => resolve(r.roomId)));
    await mx.joinRoom(COMMONS);
    expect(await joinedRoom).toBe(COMMONS);
  });

  it('resolves the root space alias and serves the hierarchy with steward metadata', async () => {
    const { mx } = await syncedClient();
    const alias = await mx.getRoomIdForAlias('#gamecult:demo.invalid');
    expect(alias.room_id).toBeTruthy();
    const h = await mx.getRoomHierarchy(alias.room_id);
    const stewards = h.rooms.flatMap((r) => r.children_state).map((c) => (c.content as Record<string, unknown>)['org.gamecult.steward']);
    expect(stewards.filter(Boolean).length).toBe(2);
  });

  it('answers a long poll with nothing new after its timeout', async () => {
    const server = createDemoServer();
    live.push({ server, mx: clientFor(server) });
    const first = await server.handle({ method: 'GET', url: `${DEMO_ORIGIN}/_matrix/client/v3/sync` });
    const token = (first.body as { next_batch: string }).next_batch;
    const t0 = Date.now();
    const idle = await server.handle({ method: 'GET', url: `${DEMO_ORIGIN}/_matrix/client/v3/sync?since=${token}&timeout=150` });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect((idle.body as { rooms: { join: object } }).rooms.join).toEqual({});
  });

  it('says so, rather than inventing an answer, for an endpoint it does not implement', async () => {
    const server = createDemoServer();
    live.push({ server, mx: clientFor(server) });
    const res = await server.handle({ method: 'GET', url: `${DEMO_ORIGIN}/_matrix/client/v3/something/new` });
    expect(res.status).toBe(404);
    expect((res.body as { errcode: string }).errcode).toBe('M_UNRECOGNIZED');
  });
});

describe('the guard', () => {
  it('refuses a real homeserver and never reaches the real fetch for it', async () => {
    const server = createDemoServer();
    live.push({ server, mx: clientFor(server) });
    const f = guardedFetch(server, PAGE, never as never);
    await expect(f('https://matrix.org/_matrix/client/versions')).rejects.toThrow(/pretend server only/);
    await expect(f(new Request('https://converser.eu/_matrix/client/v3/login'))).rejects.toThrow(/refused/);
    expect(never).not.toHaveBeenCalled();
    await f(`${PAGE}/config.json`);
    expect(never).toHaveBeenCalledTimes(1);
    const versions = await f(`${DEMO_ORIGIN}/_matrix/client/versions`);
    expect((await versions.json()).versions.length).toBeGreaterThan(0);
  });

  it('installDemo refuses WebSocket, XMLHttpRequest and beacons to foreign origins', () => {
    const store = new Map<string, string>();
    const open = vi.fn();
    class Sock {
      constructor(public url: string) {}
    }
    const win = {
      location: { origin: PAGE },
      fetch: never,
      WebSocket: Sock,
      XMLHttpRequest: { prototype: { open } },
      navigator: { sendBeacon: vi.fn(() => true) },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, setAttribute: () => {} }),
      body: { appendChild: vi.fn() },
    });
    const server = installDemo(win);
    live.push({ server, mx: clientFor(server) });
    expect(() => new win.WebSocket('wss://matrix.org/x')).toThrow(/refused/);
    expect(() => new win.WebSocket(`wss://page.test/x`)).not.toThrow();
    expect(() => win.XMLHttpRequest.prototype.open('GET', 'https://matrix.org/x')).toThrow(/refused/);
    win.XMLHttpRequest.prototype.open('GET', '/same-origin');
    expect(open).toHaveBeenCalledTimes(1);
    expect(win.navigator.sendBeacon('https://matrix.org/x')).toBe(false);
    expect(JSON.parse(store.get('settings')!)).toEqual({ poseBubbles: true });
    vi.unstubAllGlobals();
  });

  it('keeps stored settings a visitor already chose', () => {
    const store = new Map<string, string>([['settings', '{"poseBubbles":false}']]);
    const win = {
      location: { origin: PAGE },
      fetch: never,
      WebSocket: class {},
      XMLHttpRequest: { prototype: { open: vi.fn() } },
      navigator: {},
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: vi.fn() },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute: () => {} }), body: { appendChild: vi.fn() } });
    const server = installDemo(win);
    live.push({ server, mx: clientFor(server) });
    expect(win.localStorage.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
