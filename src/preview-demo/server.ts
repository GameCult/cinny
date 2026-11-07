// The preview-only pretend homeserver: a pure request handler over in-memory fixtures. It speaks
// just enough of the Matrix client-server API for matrix-js-sdk to log in, sync, show rooms,
// send messages and get a Mind's canned answer. It touches no network and no storage; the
// fetch guard that routes requests here lives in install.ts.
import {
  COMMONS,
  DEMO_DEVICE,
  DEMO_ORIGIN,
  DEMO_SERVER,
  DEMO_TOKEN,
  DemoEvent,
  DemoRoom,
  ME,
  MIND_IDS,
  REPLIES,
  ROOMS,
  USERS,
} from './fixtures';

export type DemoResponse = { status: number; body: unknown };
export type DemoRequest = { method: string; url: string; body?: unknown; signal?: AbortSignal };

const POSE_KEY = 'org.gamecult.pose';
const NOTICE_TYPE = 'org.gamecult.notice';
const MAX_LONG_POLL_MS = 15000;

const ok = (body: unknown = {}): DemoResponse => ({ status: 200, body });
const err = (status: number, errcode: string, error: string): DemoResponse => ({
  status,
  body: { errcode, error },
});

type Stamped = { version: number; roomId: string; event: DemoEvent };

export type DemoServer = {
  handle: (req: DemoRequest) => Promise<DemoResponse>;
  /** Stops the pending Mind replies and long polls. */
  close: () => void;
};

export const createDemoServer = (now: () => number = Date.now): DemoServer => {
  let version = 1;
  let eventCounter = 0;
  const joined = new Set(ROOMS.filter((r) => r.joined).map((r) => r.id));
  const timeline: Stamped[] = [];
  const stateOf = new Map<string, DemoEvent[]>();
  const accountData = new Map<string, unknown>();
  const waiters = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let replyCounter = 0;
  let accountDataVersion = 0;
  let syncedJoined = new Set(joined);
  let polled = false;
  let closed = false;

  const mk = (
    type: string,
    sender: string,
    content: Record<string, unknown>,
    ts: number,
    stateKey?: string
  ): DemoEvent => {
    eventCounter += 1;
    return {
      type,
      sender,
      content,
      origin_server_ts: ts,
      event_id: `$demo${eventCounter}`,
      ...(stateKey === undefined ? {} : { state_key: stateKey }),
    };
  };
  const nameOf = (id: string) => USERS.find((u) => u.id === id)?.name ?? id;

  const buildState = (room: DemoRoom): DemoEvent[] => {
    const t0 = now() - 1000 * 60 * 60 * 24;
    const creator = room.members[0] ?? ME;
    const events: DemoEvent[] = [
      mk(
        'm.room.create',
        creator,
        room.space ? { type: 'm.space', room_version: '10' } : { room_version: '10' },
        t0,
        ''
      ),
      mk('m.room.name', creator, { name: room.name }, t0, ''),
      mk(
        'm.room.join_rules',
        creator,
        { join_rule: room.id === COMMONS ? 'public' : 'invite' },
        t0,
        ''
      ),
      mk('m.room.history_visibility', creator, { history_visibility: 'shared' }, t0, ''),
      mk(
        'm.room.power_levels',
        creator,
        { users: { [ME]: 100 }, users_default: 0, events_default: 0, state_default: 50 },
        t0,
        ''
      ),
      ...room.members.map((m) =>
        mk('m.room.member', m, { membership: 'join', displayname: nameOf(m) }, t0, m)
      ),
    ];
    if (room.topic) events.push(mk('m.room.topic', creator, { topic: room.topic }, t0, ''));
    if (room.alias)
      events.push(mk('m.room.canonical_alias', creator, { alias: room.alias }, t0, ''));
    if (room.notice)
      events.push(mk(NOTICE_TYPE, creator, { version: 1, scope: room.notice }, t0, ''));
    if (room.parent) {
      events.push(
        mk('m.space.parent', creator, { via: [DEMO_SERVER], canonical: true }, t0, room.parent)
      );
    }
    ROOMS.filter((c) => c.parent === room.id).forEach((c) => {
      events.push(
        mk(
          'm.space.child',
          creator,
          {
            via: [DEMO_SERVER],
            ...(c.steward
              ? {
                  'org.gamecult.steward': { ...c.steward, source: 'demo', steward: c.steward.mind },
                }
              : {}),
          },
          t0,
          c.id
        )
      );
    });
    return events;
  };

  ROOMS.forEach((room) => {
    stateOf.set(room.id, buildState(room));
    room.lines.forEach((l) => {
      timeline.push({
        version: 1,
        roomId: room.id,
        event: mk(
          'm.room.message',
          l.from,
          { msgtype: 'm.text', body: l.body, ...(l.pose ? { [POSE_KEY]: l.pose } : {}) },
          now() - l.minutesAgo * 60 * 1000
        ),
      });
    });
  });
  timeline.sort((a, b) => a.event.origin_server_ts - b.event.origin_server_ts);
  accountData.set('m.direct', {
    [`@eureka:${DEMO_SERVER}`]: ROOMS.filter((r) => r.direct).map((r) => r.id),
  });

  const notify = () => {
    waiters.forEach((w) => w());
    waiters.clear();
  };
  const push = (roomId: string, event: DemoEvent) => {
    version += 1;
    timeline.push({ version, roomId, event });
    notify();
  };
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!closed) fn();
    }, ms);
    timers.add(t);
  };

  // A Mind in the room answers whatever the visitor sent, with a pose from a short cycle.
  const scheduleReply = (room: DemoRoom) => {
    const mind = room.members.find((m) => MIND_IDS.includes(m));
    if (!mind) return;
    const reply = REPLIES[replyCounter % REPLIES.length];
    replyCounter += 1;
    later(1200, () =>
      push(
        room.id,
        mk(
          'm.room.message',
          mind,
          { msgtype: 'm.text', body: reply.body, [POSE_KEY]: reply.pose },
          now()
        )
      )
    );
  };

  const roomJson = (room: DemoRoom, since: number) => {
    const full = since === 0;
    const events = timeline
      .filter((t) => t.roomId === room.id && (full || t.version > since))
      .map((t) => t.event);
    return {
      state: { events: full ? stateOf.get(room.id) : [] },
      timeline: { events, limited: false, prev_batch: 'p0' },
      ephemeral: { events: [] },
      account_data: { events: [] },
      unread_notifications: { highlight_count: 0, notification_count: 0 },
      summary: {
        'm.joined_member_count': room.members.length,
        'm.invited_member_count': 0,
        'm.heroes': [],
      },
    };
  };

  const syncBody = (since: number, joinedBefore: Set<string>) => {
    const join: Record<string, unknown> = {};
    ROOMS.filter((r) => joined.has(r.id)).forEach((r) => {
      const newlyJoined = !joinedBefore.has(r.id);
      const j = roomJson(r, newlyJoined ? 0 : since);
      if (since === 0 || newlyJoined || (j.timeline.events as unknown[]).length) join[r.id] = j;
    });
    const ad: { type: string; content: unknown }[] = [];
    if (since === 0 || accountDataVersion > since) {
      accountData.forEach((content, type) => ad.push({ type, content }));
    }
    return {
      next_batch: `d${version}`,
      rooms: { join, invite: {}, leave: {} },
      account_data: { events: ad },
      presence: { events: [] },
      to_device: { events: [] },
      device_one_time_keys_count: { signed_curve25519: 50 },
    };
  };

  const sync = async (
    since: number,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<DemoResponse> => {
    if (since === 0) {
      syncedJoined = new Set(joined);
      return ok(syncBody(0, new Set()));
    }
    const changed = () => version > since || accountDataVersion > since;
    if (!changed()) {
      await new Promise<void>((resolve) => {
        const done = () => {
          waiters.delete(done);
          resolve();
        };
        waiters.add(done);
        // The first poll answers quickly so the client leaves its Connecting state.
        later(polled ? Math.min(timeoutMs, MAX_LONG_POLL_MS) : 200, done);
        polled = true;
        signal?.addEventListener('abort', done);
      });
    }
    const before = syncedJoined;
    syncedJoined = new Set(joined);
    return ok(syncBody(since, before));
  };

  const roomOf = (id: string) => ROOMS.find((r) => r.id === id);
  const hierarchy = () => {
    const entry = (r: DemoRoom) => ({
      room_id: r.id,
      name: r.name,
      topic: r.topic,
      canonical_alias: r.alias,
      num_joined_members: r.members.length,
      world_readable: false,
      guest_can_join: false,
      join_rule: r.id === COMMONS ? 'public' : 'invite',
      ...(r.space ? { room_type: 'm.space' } : {}),
      children_state: (stateOf.get(r.id) ?? []).filter((e) => e.type === 'm.space.child'),
    });
    return ROOMS.filter((r) => !r.direct).map(entry);
  };

  const handle = async (req: DemoRequest): Promise<DemoResponse> => {
    const u = new URL(req.url, DEMO_ORIGIN);
    const p = decodeURIComponent(u.pathname);
    const m = req.method.toUpperCase();
    const body = (req.body ?? {}) as Record<string, unknown>;
    let g: RegExpMatchArray | null;

    if (p === '/.well-known/matrix/client')
      return ok({ 'm.homeserver': { base_url: DEMO_ORIGIN } });
    if (!p.startsWith('/_matrix/')) return err(404, 'M_NOT_FOUND', 'Not found');
    const c = p.replace(/^\/_matrix\/client\/(v\d+|r0|unstable)/, '');
    if (p.endsWith('/versions'))
      return ok({ versions: ['v1.1', 'v1.5', 'v1.11'], unstable_features: {} });
    if (c === '/login') {
      if (m === 'GET') return ok({ flows: [{ type: 'm.login.password' }] });
      return ok({
        user_id: ME,
        access_token: DEMO_TOKEN,
        device_id: DEMO_DEVICE,
        home_server: DEMO_SERVER,
      });
    }
    if (c === '/register')
      return err(403, 'M_FORBIDDEN', 'Registration is closed on the pretend server.');
    if (c === '/account/whoami') return ok({ user_id: ME, device_id: DEMO_DEVICE });
    if (c === '/capabilities') return ok({ capabilities: {} });
    g = c.match(/^\/profile\/(.+)$/);
    if (g) return ok({ displayname: nameOf(g[1]) });
    if (c.endsWith('/filter') && m === 'POST') return ok({ filter_id: '1' });
    if (c.includes('/filter/')) return ok({});
    if (c === '/sync') {
      const raw = u.searchParams.get('since');
      const since = raw ? Number(raw.replace(/^d/, '')) || 0 : 0;
      return sync(since, Number(u.searchParams.get('timeout') ?? 0), req.signal);
    }
    if (c === '/pushrules/' || c === '/pushrules') {
      return ok({ global: { override: [], underride: [], room: [], sender: [], content: [] } });
    }
    g = c.match(/^\/user\/[^/]+\/account_data\/(.+)$/);
    if (g) {
      if (m === 'PUT') {
        accountData.set(g[1], req.body ?? {});
        version += 1;
        accountDataVersion = version;
        notify();
        return ok({});
      }
      return accountData.has(g[1])
        ? ok(accountData.get(g[1]))
        : err(404, 'M_NOT_FOUND', 'No account data');
    }
    g = c.match(/^\/directory\/room\/(.+)$/);
    if (g) {
      const room = ROOMS.find((r) => r.alias === g![1]);
      return room
        ? ok({ room_id: room.id, servers: [DEMO_SERVER] })
        : err(404, 'M_NOT_FOUND', 'Room alias not found');
    }
    if (c === '/joined_rooms') return ok({ joined_rooms: [...joined] });
    g = c.match(/^\/rooms\/([^/]+)\/hierarchy$/);
    if (g) return ok({ rooms: hierarchy() });
    g = c.match(/^\/(?:rooms\/([^/]+)\/join|join\/([^/]+))$/);
    if (g && m === 'POST') {
      const target = g[1] ?? g[2];
      const room = roomOf(target) ?? ROOMS.find((r) => r.alias === target);
      if (!room) return err(404, 'M_NOT_FOUND', 'No such room');
      if (!joined.has(room.id)) {
        joined.add(room.id);
        if (!room.members.includes(ME)) room.members.push(ME);
        stateOf.set(room.id, buildState(room));
        version += 1;
        notify();
      }
      return ok({ room_id: room.id });
    }
    g = c.match(
      /^\/rooms\/([^/]+)\/(?:leave|forget|read_markers|typing\/[^/]+|receipt\/.+|report\/.+)$/
    );
    if (g) return ok({});
    g = c.match(/^\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/);
    if (g && m === 'PUT') {
      const room = roomOf(g[1]);
      if (!room || !joined.has(room.id)) return err(403, 'M_FORBIDDEN', 'Not in room');
      const event = mk(g[2], ME, body, now());
      event.unsigned = { transaction_id: g[3] };
      push(room.id, event);
      if (g[2] === 'm.room.message') scheduleReply(room);
      return ok({ event_id: event.event_id });
    }
    g = c.match(/^\/rooms\/([^/]+)\/state\/([^/]+)(?:\/(.*))?$/);
    if (g) {
      const room = roomOf(g[1]);
      if (!room) return err(404, 'M_NOT_FOUND', 'No such room');
      const key = g[3] ?? '';
      if (m === 'PUT') {
        const event = mk(g[2], ME, body, now(), key);
        stateOf.set(room.id, [
          ...(stateOf.get(room.id) ?? []).filter((e) => !(e.type === g![2] && e.state_key === key)),
          event,
        ]);
        push(room.id, event);
        return ok({ event_id: event.event_id });
      }
      const found = (stateOf.get(room.id) ?? []).find(
        (e) => e.type === g![2] && e.state_key === key
      );
      return found ? ok(found.content) : err(404, 'M_NOT_FOUND', 'No such state event');
    }
    g = c.match(/^\/rooms\/([^/]+)\/state$/);
    if (g) return ok(stateOf.get(g[1]) ?? []);
    g = c.match(/^\/rooms\/([^/]+)\/members$/);
    if (g) {
      return ok({ chunk: (stateOf.get(g[1]) ?? []).filter((e) => e.type === 'm.room.member') });
    }
    g = c.match(/^\/rooms\/([^/]+)\/messages$/);
    if (g) return ok({ chunk: [], start: 'p0', end: 'p0' });
    g = c.match(/^\/rooms\/([^/]+)\/(?:summary|context\/.+)$/);
    if (g) return err(404, 'M_NOT_FOUND', 'Not available on the pretend server');
    if (c === '/keys/upload') return ok({ one_time_key_counts: { signed_curve25519: 50 } });
    if (c === '/keys/query') return ok({ device_keys: {}, failures: {} });
    if (c === '/keys/claim') return ok({ one_time_keys: {}, failures: {} });
    if (c === '/keys/changes') return ok({ changed: [], left: [] });
    if (c.startsWith('/keys/')) return ok({});
    if (c.startsWith('/sendToDevice/')) return ok({});
    if (c.startsWith('/room_keys/')) return err(404, 'M_NOT_FOUND', 'No backup');
    if (c === '/devices')
      return ok({ devices: [{ device_id: DEMO_DEVICE, display_name: 'Preview' }] });
    if (c === '/thirdparty/protocols' || c === '/voip/turnServer') return ok({});
    if (c.startsWith('/presence/')) return ok({});
    if (c === '/user_directory/search') return ok({ results: [], limited: false });
    if (p.endsWith('/media/config') || p.endsWith('/config')) return ok({ 'm.upload.size': 0 });
    return err(404, 'M_UNRECOGNIZED', `The pretend server does not implement ${m} ${p}`);
  };

  return {
    handle,
    close: () => {
      closed = true;
      timers.forEach(clearTimeout);
      timers.clear();
      notify();
    },
  };
};
