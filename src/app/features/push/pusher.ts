import type { IPusherRequest } from 'matrix-js-sdk';
import type { ActivePushConfig } from './config';

/** What the page needs of the homeserver client and the browser's push manager, so tests supply fakes. */
export interface PusherClient {
  setPusher(p: IPusherRequest): Promise<unknown>;
  getPushers(): Promise<{ pushers: { app_id: string; pushkey: string }[] }>;
}
export interface PushManagerPort {
  getSubscription(): Promise<PushSubscription | null>;
  subscribe(o: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array;
  }): Promise<PushSubscription>;
}

export function vapidKeyBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const b64url = (buf: ArrayBuffer | null): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf ?? new ArrayBuffer(0))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * The Matrix pusher for a browser subscription (Sygnal's `webpush` shape: the subscription's keys ride in `data`; the
 * pushkey is the subscription's p256dh key, as Element Web does). `event_id_only` asks the homeserver for ids, which
 * the worker resolves itself.
 */
export function webPushPusher(
  cfg: ActivePushConfig,
  sub: PushSubscription,
  deviceName: string
): IPusherRequest {
  const p256dh = b64url(sub.getKey('p256dh'));
  return {
    kind: 'http',
    app_id: cfg.appId,
    pushkey: p256dh,
    app_display_name: 'Ratatoskr',
    device_display_name: deviceName,
    lang: navigator.language || 'en',
    data: {
      url: cfg.gatewayUrl,
      format: 'event_id_only',
      endpoint: sub.endpoint,
      auth: b64url(sub.getKey('auth')),
      p256dh,
    },
    append: false,
  } as IPusherRequest;
}

const sameKey = (sub: PushSubscription, vapid: Uint8Array): boolean => {
  const have = sub.options?.applicationServerKey;
  return !have || b64url(have) === b64url(vapid.buffer as ArrayBuffer);
};

/** Subscribe (replacing a subscription made under another VAPID key), then register the pusher for this account. */
export async function enablePush(
  mx: PusherClient,
  push: PushManagerPort,
  cfg: ActivePushConfig,
  deviceName: string
): Promise<void> {
  const key = vapidKeyBytes(cfg.vapidPublicKey);
  let sub = await push.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub = sub ?? (await push.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  await mx.setPusher(webPushPusher(cfg, sub, deviceName));
}

/** On only when this browser holds a subscription AND this account has a pusher for it (the two live in different places). */
export async function pushIsOn(
  mx: PusherClient,
  push: PushManagerPort,
  cfg: ActivePushConfig
): Promise<boolean> {
  const sub = await push.getSubscription();
  if (!sub) return false;
  const pushkey = b64url(sub.getKey('p256dh'));
  const { pushers } = await mx.getPushers();
  return pushers.some((p) => p.app_id === cfg.appId && p.pushkey === pushkey);
}

/** Delete this account's pusher, then the subscription. The order matters: a pusher with no subscription would keep failing at the gateway. */
export async function disablePush(
  mx: PusherClient,
  push: PushManagerPort,
  cfg: ActivePushConfig
): Promise<void> {
  const sub = await push.getSubscription();
  if (!sub) return;
  await mx.setPusher({
    kind: null,
    app_id: cfg.appId,
    pushkey: b64url(sub.getKey('p256dh')),
  } as unknown as IPusherRequest);
  await sub.unsubscribe();
}
