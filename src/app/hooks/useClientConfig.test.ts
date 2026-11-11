import { describe, expect, it } from 'vitest';
import { ClientConfig, clientDefaultServer } from './useClientConfig';
import config from '../../../config.json';

describe('default homeserver', () => {
  it('is chat.gamecult.org when the config names none', () => {
    expect(clientDefaultServer({})).toBe('chat.gamecult.org');
    expect(clientDefaultServer({ homeserverList: [] })).toBe('chat.gamecult.org');
  });

  it('is the listed server the config points at', () => {
    expect(
      clientDefaultServer({ homeserverList: ['chat.gamecult.org'], defaultHomeserver: 0 })
    ).toBe('chat.gamecult.org');
  });

  it('is chat.gamecult.org in the repo config.json too', () => {
    expect(clientDefaultServer(config as ClientConfig)).toBe('chat.gamecult.org');
  });
});
