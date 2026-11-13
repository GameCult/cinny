// The commit a bundle was built from, stamped into its index.html as <meta name="build-sha">, so a built
// folder says what it is without a build log: `grep -o 'build-sha" content="[^"]*' dist/index.html`.
// Where git governs the tree (REPO_DIR is a repository root) git decides: HEAD, suffixed -dirty when the tree has
// uncommitted changes, or `<BUILD_SHA>-mismatch` when an explicit BUILD_SHA names a different commit, so a stamp
// never vouches for code it does not hold; a git failure there is 'unknown'. Where git does not govern (a source
// archive), a full-sha BUILD_SHA stands, else 'unknown'.
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Vite writes vite.config.js.timestamp-*.mjs next to the config while it loads it; that file is the
// build's own, not source, so an UNTRACKED one must not mark the tree dirty. A tracked file of that name,
// or any other change, still does. Filtering status lines (not a pathspec) is what keeps it untracked-only.
const VITE_TEMP = /^\?\? (?:.*\/)?vite\.config\.[a-z]+\.timestamp-\d+-[0-9a-f]+\.mjs$/;

export const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const FULL_SHA = /^[0-9a-f]{40}$/;

export const readBuildSha = (env = process.env, run = gitIn(REPO_DIR)) => {
  const fromEnv = (env.BUILD_SHA ?? '').trim();
  const explicit = FULL_SHA.test(fromEnv) ? fromEnv : null;
  // Git governs this tree only when REPO_DIR is its root: a source archive unpacked inside some other
  // repository has no git of its own, and that repository's HEAD says nothing about it.
  let governed;
  try {
    governed = run('rev-parse', '--show-prefix').trim() === '';
  } catch {
    governed = false;
  }
  if (!governed) return explicit ?? 'unknown';
  // Git governs and answers: from here a failure is 'unknown', never the bare explicit sha.
  try {
    const head = run('rev-parse', 'HEAD').trim();
    if (!FULL_SHA.test(head)) return 'unknown';
    if (explicit && explicit !== head) return `${explicit}-mismatch`;
    const dirty = run('status', '--porcelain', '-uall', '--', '.')
      .split('\n')
      .some((l) => l.trim() !== '' && !VITE_TEMP.test(l));
    return dirty ? `${head}-dirty` : head;
  } catch {
    return 'unknown';
  }
};

export const buildShaPlugin = (sha = readBuildSha()) => ({
  name: 'ratatoskr-build-sha',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { name: 'build-sha', content: sha }, injectTo: 'head-prepend' },
  ],
});
