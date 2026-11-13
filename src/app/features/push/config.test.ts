import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activePushConfig } from './config';

describe('activePushConfig', () => {
  it('is off unless all three keys are filled', () => {
    expect(activePushConfig(undefined)).toBeUndefined();
    expect(activePushConfig({})).toBeUndefined();
    expect(
      activePushConfig({ vapidPublicKey: 'k', gatewayUrl: 'https://g/_matrix/push/v1/notify' })
    ).toBeUndefined();
    expect(activePushConfig({ vapidPublicKey: 'k', gatewayUrl: 'u', appId: 'a' })).toEqual({
      vapidPublicKey: 'k',
      gatewayUrl: 'u',
      appId: 'a',
    });
  });
  it('the shipped config.json carries the block empty, so push is off', () => {
    const cfg = JSON.parse(readFileSync(join(__dirname, '../../../../config.json'), 'utf8'));
    expect(cfg.push).toEqual({ vapidPublicKey: '', gatewayUrl: '', appId: '' });
    expect(activePushConfig(cfg.push)).toBeUndefined();
  });
});
