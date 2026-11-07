// Bundles entry.ts with the scene's ?raw GLSL imports into $OUT/bundle.js plus an index.html.
// usage: node bundle.cjs <outdir> [demo|ridge]     (esbuild from NODE_PATH). `demo` bundles the ray-march
// standalone page; `ridge` the ridge scene's page (open it with ?probe=1 for the cadence readout).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const demo = process.argv[3] === 'demo';
const ridge = process.argv[3] === 'ridge';
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
    entryPoints: [path.join(__dirname, ridge ? 'ridgeDemo.ts' : demo ? 'demo.ts' : 'entry.ts')],
    bundle: true,
    outfile: path.join(out, 'bundle.js'),
    plugins: [rawPlugin],
    format: 'iife',
    target: 'es2020',
  })
  .then(() => {
    if (ridge) {
      fs.writeFileSync(
        path.join(out, 'index.html'),
        '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Ratatoskr ridge scene</title><body style="margin:0;background:#07111a"><div id=stage style="position:relative;width:100vw;height:100vh;overflow:hidden"><canvas id=c style="width:100%;height:100%;display:block"></canvas></div><script src=bundle.js></script>'
      );
      return;
    }
    fs.writeFileSync(
      path.join(out, 'index.html'),
      '<!doctype html><meta charset=utf-8><title>Ratatoskr scene: trace prepass</title><body style="margin:0;background:#000"><canvas id=c style="width:100vw;height:100vh;display:block"></canvas>' +
        (demo
          ? '<div style="position:fixed;left:8px;top:8px;padding:6px 8px;background:#000a;color:#ddd;font:12px monospace"><label><input id=prepass type=checkbox checked> cone prepass</label> <label><input id=half type=checkbox> half-float start</label> <label>pull-back <input id=pull type=range min=0 max=1 step=0.05 value=0.6></label><pre id=out style="margin:4px 0 0;white-space:pre-wrap"></pre><details id=dev><summary>device</summary><pre id=info style="margin:4px 0 0;white-space:pre-wrap;max-height:50vh;overflow:auto"></pre></details></div>'
          : '') +
        '<script src=bundle.js></script>'
    );
  });
