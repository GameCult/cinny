import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadServerConfigs } from './ServerConfigsLoader';

const server = (authMetadata: () => Promise<unknown>) =>
  ({
    getCapabilities: async () => ({}),
    getMediaConfig: async () => ({ 'm.upload.size': 1 }),
    getAuthMetadata: authMetadata,
  } as unknown as Parameters<typeof loadServerConfigs>[0]);

describe('loadServerConfigs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs nothing when the homeserver has no OIDC (no auth metadata came back)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const configs = await loadServerConfigs(
      server(async () => {
        throw new Error('M_UNRECOGNIZED');
      })
    );
    expect(error).not.toHaveBeenCalled();
    expect(configs.authMetadata).toBeUndefined();
    expect(configs.mediaConfig).toEqual({ 'm.upload.size': 1 });
  });

  it('still logs and drops auth metadata that came back malformed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const configs = await loadServerConfigs(server(async () => ({ issuer: 'https://x' })));
    expect(error).toHaveBeenCalled();
    expect(configs.authMetadata).toBeUndefined();
  });
});
