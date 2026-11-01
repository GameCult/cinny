// Drives the scene in headless Chromium (software GL unless the host has a GPU).
// usage: node drive.cjs <bundledir> <mode> [outdir]     modes: compile | shots | measure
// Needs playwright from NODE_PATH and PLAYWRIGHT_BROWSERS_PATH. Prints one JSON report.
const { chromium } = require('playwright');
const path = require('path');
const [, , dir, mode, outdir = '.'] = process.argv;

(async () => {
  const b = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await b.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => process.stderr.write(`[page] ${m.text()}\n`));
  await page.goto('file://' + path.resolve(dir, 'index.html'));
  const report = { mode };
  report.renderer = await page.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    const e = g.getExtension('WEBGL_debug_renderer_info');
    return g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER);
  });

  if (mode === 'compile') {
    report.stages = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const S = window.__scene;
      return ['terrain', 'atmosphere', 'resolve', 'composite'].map((stage) => {
        const t0 = performance.now();
        try {
          const p = S.linkStage(gl, stage);
          return {
            stage,
            ok: true,
            ms: +(performance.now() - t0).toFixed(1),
            sourceBytes: S.fragmentSource(stage).length,
            log: gl.getProgramInfoLog(p),
          };
        } catch (e) {
          return {
            stage,
            ok: false,
            ms: +(performance.now() - t0).toFixed(1),
            log: String(e.log || e),
          };
        }
      });
    });
  }

  if (mode === 'phacelle') {
    report.probe = await page.evaluate(() =>
      window.__probePhacelle(
        window.__scene.WORLD.erodeSide.slice(),
        window.__scene.WORLD.erodeNorm,
        4
      )
    );
  }

  if (mode === 'shots') {
    await page.evaluate(() => {
      const c = document.getElementById('c');
      window.__s = window.__scene.createScene({
        canvas: c,
        unthrottled: true,
        fixedLevel: window.__scene.LEVELS[0],
      });
    });
    const wait = (ms) => page.waitForTimeout(ms);
    await wait(4000);
    await page.screenshot({ path: path.join(outdir, 'rest.png') });
    await page.evaluate(() => window.__s.login());
    await wait(3500);
    await page.screenshot({ path: path.join(outdir, 'mid-pullback.png') });
    await wait(9000);
    await page.screenshot({ path: path.join(outdir, 'pulled-back.png') });
    report.shots = ['rest.png', 'mid-pullback.png', 'pulled-back.png'];
  }

  if (mode === 'measure' || mode === 'variants') {
    const VARIANTS = {
      baseline: null,
      // What a public value-only fbm would cost: the same octaves without the gradient work.
      valueOnlyFbm: [
        'float terrainFbm(vec2 xz) { return cultmath_fbm_grad(vec3(xz * W_FREQ, 0.0), W_OCTAVES, W_LACUNARITY, W_GAIN).w; }',
        'float terrainFbm(vec2 xz) { float a = 1.0, fr = 1.0, v = 0.0; for (int i = 0; i < W_OCTAVES; i++) { v += a * cultmath_snoise(vec3(xz * W_FREQ * fr, 0.0)); fr *= W_LACUNARITY; a *= W_GAIN; } return v; }',
      ],
      noErosion: ['#define W_ERODE_ENABLED 1', '#define W_ERODE_ENABLED 0'],
      // Upper bound on what skipping sky rays would save: every upward ray misses at once.
      noSkyMarch: ['    bool hit = false;\n    bool onTree = false;', '    if (rd.y > 0.0) { o_color = vec4(0.0); o_depth = W_FAR; return; }\n    bool hit = false;\n    bool onTree = false;'],
      noTree: ['float dr = treeDistance(p, leafness);', 'float dr = 1e9; leafness = 0.0;'],
    };
    const wanted = mode === "variants" ? (process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(VARIANTS)) : ['baseline'];
    const sizes = [
      [960, 540],
      [540, 1200],
    ];
    report.runs = [];
    for (const [w, h] of sizes) {
      for (const [li, variant] of wanted.flatMap((v) =>
        mode === 'variants'
          ? [[0, v]]
          : [
              [0, v],
              [3, v],
            ]
      )) {
        await page.setViewportSize({ width: w, height: h });
        const r = await page.evaluate(
          ({ li, rep }) =>
            new Promise((res) => {
              const rows = [];
              const c = document.getElementById('c');
              const s = window.__scene.createScene({
                canvas: c,
                unthrottled: true,
                fixedLevel: window.__scene.LEVELS[li],
                patchSource: rep
                  ? (st, src) =>
                      st === 'terrain'
                        ? rep[0].startsWith('#define')
                          ? src.replace(/#define W_ERODE_ENABLED \d/, rep[1])
                          : src.split(rep[0]).join(rep[1])
                        : src
                  : undefined,
                onStats: (st) => {
                  rows.push(st);
                  if (rows.length === 40) {
                    s.dispose();
                    const keep = rows.slice(10);
                    const med = (k) =>
                      keep.map((x) => x.passMs[k]).sort((a, b) => a - b)[keep.length >> 1];
                    res({
                      solid: keep[0].solidSize,
                      atm: keep[0].atmosphereSize,
                      medianMs: {
                        terrain: med('terrain'),
                        atmosphere: med('atmosphere'),
                        resolve: med('resolve'),
                        composite: med('composite'),
                      },
                    });
                  }
                },
              });
              if (!s) res({ error: 'createScene returned null' });
            }),
          { li, rep: VARIANTS[variant] }
        );
        report.runs.push({ viewport: [w, h], level: li, variant, ...r });
      }
    }
  }

  console.log(JSON.stringify(report, null, 1));
  await b.close();
})().catch((e) => {
  console.log('ERR', String(e).slice(0, 2000));
  process.exit(1);
});
