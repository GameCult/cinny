// Web Push is off unless the host's config.json fills all three keys (ships empty). The public key is not a secret;
// the gateway URL is the push gateway's notify endpoint the homeserver calls (`/_matrix/push/v1/notify`).
export type PushConfig = {
  vapidPublicKey?: string;
  gatewayUrl?: string;
  appId?: string;
};

export type ActivePushConfig = Required<PushConfig>;

export const activePushConfig = (c?: PushConfig): ActivePushConfig | undefined =>
  c?.vapidPublicKey && c.gatewayUrl && c.appId ? (c as ActivePushConfig) : undefined;
