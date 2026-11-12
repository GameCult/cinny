import { describe, expect, it } from 'vitest';
import type { IPusherRequest } from 'matrix-js-sdk';
import {
  disablePush,
  enablePush,
  PushManagerPort,
  pushIsOn,
  vapidKeyBytes,
  webPushPusher,
} from './pusher';

const cfg = {
  vapidPublicKey: 'BAUD',
  gatewayUrl: 'https://matrix.example/_matrix/push/v1/notify',
  appId: 'org.gamecult.ratatoskr.web',
};
const key = (...b: number[]) => Uint8Array.from(b).buffer;

function subscription(unsubscribed: string[], serverKey?: ArrayBuffer): PushSubscription {
  return {
    options: { applicationServerKey: serverKey ?? vapidKeyBytes(cfg.vapidPublicKey).buffer },
    endpoint: 'https://push.example/send/abc',
    getKey: (n: string) => (n === 'p256dh' ? key(251, 255, 1) : key(250, 2)),
    unsubscribe: async () => {
      unsubscribed.push('x');
      return true;
    },
  } as unknown as PushSubscription;
}

function world() {
  const calls: string[] = [];
  const pushers: IPusherRequest[] = [];
  let sub: PushSubscription | null = null;
  const unsub: string[] = [];
  const mx = {
    setPusher: async (p: IPusherRequest) => {
      calls.push(p.kind === null ? 'delete-pusher' : 'set-pusher');
      pushers.push(p);
    },
    // The account's pushers as the homeserver would list them: what setPusher last wrote, minus deletions.
    getPushers: async () => ({
      pushers: pushers
        .filter(
          (p, i) =>
            p.kind !== null &&
            !pushers.slice(i + 1).some((q) => q.kind === null && q.pushkey === p.pushkey)
        )
        .map((p) => ({ app_id: p.app_id, pushkey: p.pushkey })),
    }),
  };
  const push: PushManagerPort = {
    getSubscription: async () => sub,
    subscribe: async (o) => {
      calls.push(`subscribe:${o.userVisibleOnly}:${o.applicationServerKey.length}`);
      sub = subscription(unsub);
      return sub;
    },
  };
  const swapSub = (s: PushSubscription | null) => {
    sub = s;
  };
  return { mx, push, calls, pushers, unsub, swapSub };
}

describe('web push pusher', () => {
  it('decodes the URL-safe VAPID key', () => {
    expect([...vapidKeyBytes('-_8')]).toEqual([251, 255]);
  });
  it('is the Sygnal webpush shape: app id, p256dh pushkey, subscription in data, ids only', () => {
    const p = webPushPusher(cfg, subscription([]), 'phone') as unknown as Record<
      string,
      unknown
    > & {
      data: Record<string, unknown>;
    };
    expect(p).toMatchObject({
      kind: 'http',
      app_id: cfg.appId,
      pushkey: '-_8B',
      device_display_name: 'phone',
      append: false,
    });
    expect(p.data).toMatchObject({
      url: cfg.gatewayUrl,
      format: 'event_id_only',
      endpoint: 'https://push.example/send/abc',
      auth: '-gI',
      p256dh: '-_8B',
    });
  });
  it('enable subscribes with userVisibleOnly, then registers the pusher; a second enable reuses the subscription', async () => {
    const w = world();
    await enablePush(w.mx, w.push, cfg, 'phone');
    expect(w.calls).toEqual(['subscribe:true:3', 'set-pusher']);
    await enablePush(w.mx, w.push, cfg, 'phone');
    expect(w.calls).toEqual(['subscribe:true:3', 'set-pusher', 'set-pusher']);
  });
  it('disable deletes the pusher before the subscription, and does nothing when there is none', async () => {
    const w = world();
    await disablePush(w.mx, w.push, cfg);
    expect(w.calls).toEqual([]);
    await enablePush(w.mx, w.push, cfg, 'phone');
    await disablePush(w.mx, w.push, cfg);
    expect(w.calls.slice(-1)).toEqual(['delete-pusher']);
    expect(w.pushers.at(-1)).toMatchObject({ kind: null, app_id: cfg.appId, pushkey: '-_8B' });
    expect(w.unsub).toEqual(['x']);
  });
  it('a failed pusher write leaves the subscription alone', async () => {
    const w = world();
    await enablePush(w.mx, w.push, cfg, 'phone');
    w.mx.setPusher = async () => {
      throw new Error('homeserver said no');
    };
    await expect(disablePush(w.mx, w.push, cfg)).rejects.toThrow('homeserver said no');
    expect(w.unsub).toEqual([]);
  });
  it('the toggle is on only with a subscription and the pusher of this account for it', async () => {
    const w = world();
    expect(await pushIsOn(w.mx, w.push, cfg)).toBe(false);
    await enablePush(w.mx, w.push, cfg, 'phone');
    expect(await pushIsOn(w.mx, w.push, cfg)).toBe(true);
    // another account on the same browser: the subscription exists, its pusher does not
    const other = { ...w.mx, getPushers: async () => ({ pushers: [] }) };
    expect(await pushIsOn(other, w.push, cfg)).toBe(false);
    await disablePush(w.mx, w.push, cfg);
    expect(await pushIsOn(w.mx, w.push, cfg)).toBe(false);
  });
  it('a subscription made under another VAPID key is replaced, not reused', async () => {
    const w = world();
    const old = [] as string[];
    w.swapSub(subscription(old, Uint8Array.from([9, 9, 9]).buffer));
    await enablePush(w.mx, w.push, cfg, 'phone');
    expect(old).toEqual(['x']);
    expect(w.calls).toEqual(['subscribe:true:3', 'set-pusher']);
  });
  it('a failed pusher write after subscribing leaves the toggle off', async () => {
    const w = world();
    const fail = { ...w.mx, setPusher: async () => Promise.reject(new Error('no')) };
    await expect(enablePush(fail, w.push, cfg, 'phone')).rejects.toThrow('no');
    expect(await pushIsOn(w.mx, w.push, cfg)).toBe(false);
  });
});
