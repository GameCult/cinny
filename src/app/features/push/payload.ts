import type { SessionRecord } from './sessionStore';

/** What a push names. The homeserver sends ids only (`push.include_content: false`); a gateway may add text. */
export interface PushIds {
  roomId: string;
  eventId?: string;
  roomName?: string;
  sender?: string;
  text?: string;
}

export interface Shown {
  title: string;
  body: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The Matrix push body is `{ notification: {...} }`; a gateway may forward the inner object. No room id: not ours to show. */
export function parsePush(raw: unknown): PushIds | undefined {
  const top = (raw ?? {}) as Record<string, unknown>;
  const n = (top.notification ?? top) as Record<string, unknown>;
  const roomId = str(n.room_id);
  if (!roomId) return undefined;
  const content = (n.content ?? {}) as Record<string, unknown>;
  return {
    roomId,
    eventId: str(n.event_id),
    roomName: str(n.room_name),
    sender: str(n.sender_display_name) ?? str(n.sender),
    text: str(content.body),
  };
}

export const GENERIC: Shown = { title: 'Ratatoskr', body: 'New message' };
const MAX_BODY = 200;
const clip = (s: string): string => (s.length > MAX_BODY ? `${s.slice(0, MAX_BODY - 1)}…` : s);
const localpart = (userId: string): string => userId.replace(/^@/, '').split(':')[0];

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function getJson(
  f: Fetch,
  session: SessionRecord,
  path: string,
  timeoutMs: number
): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await f(`${session.baseUrl.replace(/\/+$/, '')}${path}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Title and body for a push. Text the push carried wins. Otherwise, with a session, the event and the room's name are
 * fetched (clear-text rooms; an encrypted event shows the generic body). Every failure ends at the generic notification:
 * a push must always show something.
 */
export async function describePush(
  ids: PushIds | undefined,
  session: SessionRecord | undefined,
  f: Fetch,
  timeoutMs = 4000
): Promise<Shown> {
  if (!ids) return GENERIC;
  let { roomName, sender, text } = ids;
  if (session && (!text || !roomName)) {
    const room = encodeURIComponent(ids.roomId);
    const [event, name] = await Promise.all([
      !text && ids.eventId
        ? getJson(
            f,
            session,
            `/_matrix/client/v3/rooms/${room}/event/${encodeURIComponent(ids.eventId)}`,
            timeoutMs
          )
        : undefined,
      !roomName
        ? getJson(f, session, `/_matrix/client/v3/rooms/${room}/state/m.room.name`, timeoutMs)
        : undefined,
    ]);
    const content = (event?.content ?? {}) as Record<string, unknown>;
    if (event?.type === 'm.room.message') text = str(content.body);
    if (!sender && str(event?.sender)) sender = localpart(event?.sender as string);
    roomName = roomName ?? str(name?.name);
  }
  let { body } = GENERIC;
  if (text) body = sender ? `${sender}: ${text}` : text;
  return { title: roomName ?? GENERIC.title, body: clip(body) };
}
