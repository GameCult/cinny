import { describe, expect, it } from 'vitest';
import type { IPusherRequest } from 'matrix-js-sdk';
import { disablePush, enablePush, PushManagerPort, vapidKeyBytes, webPushPusher } from './pusher';

const cfg = {
  vapidPublicKey: 'BAUD',
  gatewayUrl: 'https://matrix.example/_matrix/push/v1/notify',
  appId: 'org.gamecult.ratatoskr.web',
};
const key = (...b: number[]) => Uint8Array.from(b).buffer;

function subscription(unsubscribed: string[] = []): PushSubscription {
  return {
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
  };
  const push: PushManagerPort = {
    getSubscription: async () => sub,
    subscribe: async (o) => {
      calls.push(`subscribe:${o.userVisibleOnly}:${o.applicationServerKey.length}`);
      sub = subscription(unsub);
      return sub;
    },
  };
  return { mx, push, calls, pushers, unsub };
}

describe('web push pusher', () => {
  it('decodes the URL-safe VAPID key', () => {
    expect([...vapidKeyBytes('-_8')]).toEqual([251, 255]);
  });
  it('is the Sygnal webpush shape: app id, p256dh pushkey, subscription in data, ids only', () => {
    const p = webPushPusher(cfg, subscription(), 'phone') as unknown as Record<string, unknown> & {
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
});
