import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShaPlugin, gitIn, readBuildSha } from './buildSha';

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
    // an explicit sha with a clean tree is just itself
    expect(readBuildSha({ BUILD_SHA: SHA }, gitAt('c'.repeat(40)))).toBe(SHA);
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

describe('readBuildSha against a real repository', () => {
  const made = [];
  afterEach(() => {
    made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  });
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'buildsha-'));
    made.push(dir);
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export {};\n');
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    return dir;
  };
  it("stays clean with vite's temp config file present, and is dirty with a stray source file", () => {
    const dir = repo();
    const run = gitIn(dir);
    writeFileSync(join(dir, 'vite.config.js.timestamp-1700000000-abc123.mjs'), '');
    expect(readBuildSha({}, run)).toMatch(/^[0-9a-f]{40}$/);
    writeFileSync(join(dir, 'src', 'zz-stray.ts'), '');
    expect(readBuildSha({}, run)).toMatch(/^[0-9a-f]{40}-dirty$/);
  });
});

describe('readBuildSha dirty rules against a real repository', () => {
  const made2 = [];
  afterEach(() => {
    made2.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  });
  const TEMP = 'vite.config.js.timestamp-1700000000-abc123.mjs';
  const repo2 = (tracked = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'buildsha-'));
    made2.push(dir);
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export {};\n');
    tracked.forEach((f) => writeFileSync(join(dir, f), 'x\n'));
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    return {
      dir,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(),
    };
  };
  it('does not let an explicit BUILD_SHA mask a dirty tree', () => {
    const { dir } = repo2();
    const run = gitIn(dir);
    expect(readBuildSha({ BUILD_SHA: SHA }, run)).toBe(SHA);
    writeFileSync(join(dir, 'src', 'zz-stray.ts'), '');
    expect(readBuildSha({ BUILD_SHA: SHA }, run)).toBe(`${SHA}-dirty`);
  });
  it('treats a stray source file as dirty even beside the vite temp file, in the root or a subfolder', () => {
    const { dir, head } = repo2();
    const run = gitIn(dir);
    writeFileSync(join(dir, TEMP), '');
    writeFileSync(join(dir, 'src', TEMP), '');
    expect(readBuildSha({}, run)).toBe(head);
    writeFileSync(join(dir, 'src', 'zz-stray.ts'), '');
    expect(readBuildSha({}, run)).toBe(`${head}-dirty`);
  });
  it('marks a tracked file of the temp name dirty once it changes', () => {
    const { dir, head } = repo2([TEMP]);
    const run = gitIn(dir);
    expect(readBuildSha({}, run)).toBe(head);
    writeFileSync(join(dir, TEMP), 'changed\n');
    expect(readBuildSha({}, run)).toBe(`${head}-dirty`);
  });
  it('marks an untracked file in a new folder dirty (status lists files, not the folder)', () => {
    const { dir, head } = repo2();
    mkdirSync(join(dir, 'new'));
    writeFileSync(join(dir, 'new', TEMP), '');
    expect(readBuildSha({}, gitIn(dir))).toBe(head);
    writeFileSync(join(dir, 'new', 'b.ts'), '');
    expect(readBuildSha({}, gitIn(dir))).toBe(`${head}-dirty`);
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
