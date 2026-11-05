// Bundles entry.ts with the scene's ?raw GLSL imports into $OUT/bundle.js plus an index.html.
// usage: node bundle.cjs <outdir> [demo]     (esbuild from NODE_PATH). `demo` bundles the standalone page.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const demo = process.argv[3] === 'demo';
fs.mkdirSync(out, { recursive: true });
const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({
      path: path.resolve(a.resolveDir, a.path.slice(0, -4)),
      namespace: 'raw',
    }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
      contents: fs.readFileSync(a.path, 'utf8'),
      loader: 'text',
    }));
  },
};
esbuild
  .build({
    entryPoints: [path.join(__dirname, demo ? 'demo.ts' : 'entry.ts')],
    bundle: true,
    outfile: path.join(out, 'bundle.js'),
    plugins: [rawPlugin],
    format: 'iife',
    target: 'es2020',
  })
  .then(() => {
    fs.writeFileSync(
      path.join(out, 'index.html'),
      '<!doctype html><meta charset=utf-8><title>Ratatoskr scene: trace prepass</title><body style="margin:0;background:#000"><canvas id=c style="width:100vw;height:100vh;display:block"></canvas>' +
        (demo
          ? '<div style="position:fixed;left:8px;top:8px;padding:6px 8px;background:#000a;color:#ddd;font:12px monospace"><label><input id=prepass type=checkbox checked> cone prepass</label> <label><input id=half type=checkbox> half-float start</label> <label>pull-back <input id=pull type=range min=0 max=1 step=0.05 value=0.6></label><pre id=out style="margin:4px 0 0;white-space:pre-wrap"></pre><details id=dev><summary>device</summary><pre id=info style="margin:4px 0 0;white-space:pre-wrap;max-height:50vh;overflow:auto"></pre></details></div>'
          : '') +
        '<script src=bundle.js></script>'
    );
  });
