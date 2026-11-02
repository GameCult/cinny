// Bundles entry.ts with the scene's ?raw GLSL imports into $OUT/bundle.js plus an index.html.
// usage: node bundle.cjs <outdir>     (esbuild from NODE_PATH)
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
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
    entryPoints: [path.join(__dirname, 'entry.ts')],
    bundle: true,
    outfile: path.join(out, 'bundle.js'),
    plugins: [rawPlugin],
    format: 'iife',
    target: 'es2020',
  })
  .then(() => {
    fs.writeFileSync(
      path.join(out, 'index.html'),
      '<!doctype html><meta charset=utf-8><body style="margin:0"><canvas id=c style="width:100vw;height:100vh;display:block"></canvas><script src=bundle.js></script>'
    );
  });
