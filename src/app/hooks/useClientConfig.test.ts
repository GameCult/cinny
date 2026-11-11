import { describe, expect, it } from 'vitest';
import { clientDefaultServer } from './useClientConfig';
import config from '../../../config.json';

describe('default homeserver', () => {
  it('is gamecult.org when the config names none', () => {
    expect(clientDefaultServer({})).toBe('gamecult.org');
    expect(clientDefaultServer({ homeserverList: [] })).toBe('gamecult.org');
  });

  it('is the listed server the config points at', () => {
    expect(
      clientDefaultServer({ homeserverList: ['chat.gamecult.org'], defaultHomeserver: 0 })
    ).toBe('chat.gamecult.org');
  });

  it('is gamecult.org in the repo config.json too', () => {
    expect(clientDefaultServer(config)).toBe('gamecult.org');
  });
});
