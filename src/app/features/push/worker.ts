import { describePush, parsePush } from './payload';
import type { SessionRecord } from './sessionStore';

/** The slice of the service worker's scope the handlers use, so they run in tests without a worker. */
export interface WorkerPort {
  windows(): Promise<
    {
      visibilityState: string;
      focused: boolean;
      focus(): Promise<unknown>;
      postMessage(m: unknown): void;
    }[]
  >;
  openWindow(url: string): Promise<unknown>;
  show(title: string, options: NotificationOptions): Promise<void>;
  loadSession(): Promise<SessionRecord | undefined>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** The worker's scope URL: where a cold click opens the app. */
  scope: string;
}

export interface PushTarget {
  roomId: string;
  eventId?: string;
}

/** A push shows a notification, unless the app is open and focused (browsers allow that, and the page notifies itself). */
export async function handlePush(raw: unknown, w: WorkerPort): Promise<void> {
  const ids = parsePush(raw);
  const open = await w.windows().catch(() => []);
  if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return;
  const shown = await describePush(ids, await w.loadSession(), w.fetch);
  await w.show(shown.title, {
    body: shown.body,
    // One notification per room, replaced (and re-alerted) by the next message there.
    tag: ids?.roomId,
    renotify: !!ids?.roomId,
    icon: './public/android/android-chrome-192x192.png',
    data: ids ? ({ roomId: ids.roomId, eventId: ids.eventId } satisfies PushTarget) : undefined,
  } as NotificationOptions);
}

export const OPEN_ROOM = 'openRoom';
export const PUSH_ROOM_PARAM = 'pushRoom';
export const PUSH_EVENT_PARAM = 'pushEvent';

/** A click focuses an open window and tells it which room; with none open it starts the app with the room in the URL. */
export async function handleClick(target: PushTarget | undefined, w: WorkerPort): Promise<void> {
  const windows = await w.windows();
  const open = windows[0];
  if (open) {
    await open.focus();
    if (target?.roomId) open.postMessage({ type: OPEN_ROOM, ...target });
    return;
  }
  const url = new URL(w.scope);
  if (target?.roomId) {
    url.searchParams.set(PUSH_ROOM_PARAM, target.roomId);
    if (target.eventId) url.searchParams.set(PUSH_EVENT_PARAM, target.eventId);
  }
  await w.openWindow(url.href);
}
