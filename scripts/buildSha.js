// The commit a bundle was built from, stamped into its index.html as <meta name="build-sha">, so a built
// folder says what it is without a build log: `grep -o 'build-sha" content="[^"]*' dist/index.html`.
// BUILD_SHA names the commit when it is a full sha (a build from a source archive has no git), otherwise git's
// HEAD does; either way -dirty is appended when git can see uncommitted changes, so an explicit sha never
// vouches for a tree that differs from it. No git and no BUILD_SHA: 'unknown'.
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Vite writes vite.config.js.timestamp-*.mjs next to the config while it loads it; that file is the
// build's own, not source, so an UNTRACKED one must not mark the tree dirty. A tracked file of that name,
// or any other change, still does. Filtering status lines (not a pathspec) is what keeps it untracked-only.
const VITE_TEMP = /^\?\? (?:.*\/)?vite\.config\.[^/]*\.timestamp-[^/]*\.mjs$/;

export const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export const readBuildSha = (env = process.env, run = gitIn(REPO_DIR)) => {
  const fromEnv = (env.BUILD_SHA ?? '').trim();
  const explicit = /^[0-9a-f]{40}$/.test(fromEnv) ? fromEnv : null;
  try {
    const head = run('rev-parse', 'HEAD').trim();
    const sha = explicit ?? head;
    if (!/^[0-9a-f]{40}$/.test(sha)) return 'unknown';
    const dirty = run('status', '--porcelain', '-uall', '--', '.')
      .split('\n')
      .some((l) => l.trim() !== '' && !VITE_TEMP.test(l));
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return explicit ?? 'unknown';
  }
};

export const buildShaPlugin = (sha = readBuildSha()) => ({
  name: 'ratatoskr-build-sha',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { name: 'build-sha', content: sha }, injectTo: 'head-prepend' },
  ],
});
