// The commit a bundle was built from, stamped into its index.html as <meta name="build-sha">, so a built
// folder says what it is without a build log: `grep -o 'build-sha" content="[^"]*' dist/index.html`.
// BUILD_SHA wins when it is a full sha (a build from a source archive has no git); otherwise git's HEAD,
// suffixed -dirty when the tree has uncommitted changes; otherwise 'unknown'.
import { execFileSync } from 'child_process';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export const readBuildSha = (env = process.env, run = git) => {
  const fromEnv = (env.BUILD_SHA ?? '').trim();
  if (/^[0-9a-f]{40}$/.test(fromEnv)) return fromEnv;
  try {
    const head = run('rev-parse', 'HEAD').trim();
    if (!/^[0-9a-f]{40}$/.test(head)) return 'unknown';
    return run('status', '--porcelain').trim() === '' ? head : `${head}-dirty`;
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
