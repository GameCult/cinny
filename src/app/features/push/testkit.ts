import type { SessionRecord } from './sessionStore';

/** A mock homeserver: answers the two reads the push handler makes, and records every request it saw. */
export function mockHomeserver(opts: {
  token: string;
  events?: Record<string, unknown>;
  roomNames?: Record<string, string>;
  failAll?: boolean;
}) {
  const seen: { url: string; auth: string | null }[] = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const auth = new Headers(init.headers).get('Authorization');
    seen.push({ url, auth });
    if (opts.failAll) throw new Error('network down');
    if (auth !== `Bearer ${opts.token}`) return new Response('{}', { status: 401 });
    const ev = /\/rooms\/([^/]+)\/event\/([^/]+)$/.exec(url);
    if (ev) {
      const e = opts.events?.[decodeURIComponent(ev[2])];
      return e ? new Response(JSON.stringify(e)) : new Response('{}', { status: 404 });
    }
    const nm = /\/rooms\/([^/]+)\/state\/m\.room\.name$/.exec(url);
    if (nm) {
      const name = opts.roomNames?.[decodeURIComponent(nm[1])];
      return name ? new Response(JSON.stringify({ name })) : new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchFn, seen };
}

export const SESSION: SessionRecord = { baseUrl: 'https://matrix.example/', accessToken: 'tok-1' };

/** The body a homeserver posts to a push gateway for `format: event_id_only` (Matrix push gateway API). */
export const matrixNotify = (roomId: string, eventId: string) => ({
  notification: {
    event_id: eventId,
    room_id: roomId,
    counts: { unread: 1 },
    devices: [{ app_id: 'org.gamecult.ratatoskr.web', pushkey: 'k', data: {} }],
  },
});
