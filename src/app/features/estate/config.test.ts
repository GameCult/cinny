import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('repo config.json', () => {
  it('names the GameCult Space first, so a wholesale deploy resolves the estate root', () => {
    const config = JSON.parse(readFileSync('config.json', 'utf8'));
    expect(config.featuredCommunities.spaces[0]).toBe('#gamecult:gamecult.org');
  });
});
