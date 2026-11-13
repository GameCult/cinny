import { describe, expect, it } from 'vitest';
import { buildShaPlugin, readBuildSha } from './buildSha';

const SHA = 'b6b1d522f1c0a9d3e2b4c5d6e7f8091a2b3c4d5e';
const gitAt =
  (head, status = '') =>
  (cmd) =>
    cmd === 'rev-parse' ? `${head}\n` : status;

describe('readBuildSha', () => {
  it('reads the checkout it is built from', () => {
    expect(readBuildSha({}, gitAt(SHA))).toBe(SHA);
  });
  it('marks a tree with uncommitted changes, so a stamp never vouches for code it does not hold', () => {
    expect(readBuildSha({}, gitAt(SHA, ' M src/x.ts\n'))).toBe(`${SHA}-dirty`);
  });
  it('lets BUILD_SHA stand in where there is no git, and ignores a value that is not a full sha', () => {
    const noGit = () => {
      throw new Error('not a git repository');
    };
    expect(readBuildSha({ BUILD_SHA: SHA }, noGit)).toBe(SHA);
    expect(readBuildSha({ BUILD_SHA: 'main' }, noGit)).toBe('unknown');
  });
  it("says 'unknown' rather than failing the build when git is absent", () => {
    expect(
      readBuildSha({}, () => {
        throw new Error('spawn git ENOENT');
      })
    ).toBe('unknown');
  });
});

describe('buildShaPlugin', () => {
  it("hands vite a meta tag for the page's head carrying the sha", () => {
    const plugin = buildShaPlugin(SHA);
    expect(plugin.transformIndexHtml()).toEqual([
      { tag: 'meta', attrs: { name: 'build-sha', content: SHA }, injectTo: 'head-prepend' },
    ]);
  });
});
