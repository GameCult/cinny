// Drives the scene in headless Chromium (software GL unless the host has a GPU).
// usage: node drive.cjs <bundledir> <mode> [outdir]     modes: compile | shots | measure
// Needs playwright from NODE_PATH and PLAYWRIGHT_BROWSERS_PATH. Prints one JSON report.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
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
  page.on('pageerror', (e) => process.stderr.write(`[pageerror] ${e}\n`));
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

  if (mode === 'trace') {
    // Steps per pixel and pass ms at fixed camera poses, one scene per run. PREPASS=0,1 picks the arms.
    const arms = (process.env.PREPASS || '1').split(',').map((x) => x === '1');
    report.runs = [];
    for (const [w, h] of process.env.PORTRAIT === '0'
      ? [[960, 540]]
      : [
          [960, 540],
          [540, 1200],
        ]) {
      for (const pull of (process.env.PULLS || '0,0.5,1').split(',').map(Number)) {
        for (const prepass of arms) {
          await page.setViewportSize({ width: w, height: h });
          const r = await page.evaluate(
            ({ pull, prepass, FRAMES }) =>
              new Promise((res) => {
                const rows = [];
                const trace = [];
                let done = false;
                const finish = () => {
                  if (done || rows.length < FRAMES || trace.length < 4) return;
                  done = true;
                  s.dispose();
                  const keep = rows.slice(FRAMES >> 2);
                  const med = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
                  const tk = trace.slice(1);
                  const mean = (k) => tk.reduce((a, t) => a + t[k], 0) / tk.length;
                  res({
                    solid: keep[0].solidSize,
                    readbacks: tk.length,
                    traceSteps: +mean('traceSteps').toFixed(2),
                    prepassSteps: +mean('prepassSteps').toFixed(2),
                    stepsPerPixel: +mean('stepsPerPixel').toFixed(2),
                    medianMs: Object.fromEntries(
                      Object.keys(keep[0].passMs).map((k) => [k, +med(keep.map((x) => x.passMs[k])).toFixed(2)])
                    ),
                  });
                };
                const s = window.__scene.createScene({
                  canvas: document.getElementById('c'),
                  unthrottled: true,
                  fixedLevel: window.__scene.LEVELS[0],
                  fixedPull: pull,
                  prepass,
                  onTraceStats: (t) => {
                    trace.push(t);
                    finish();
                  },
                  onStats: (st) => {
                    rows.push(st);
                    finish();
                  },
                });
                if (!s) res({ error: 'createScene returned null' });
              }),
            { pull, prepass, FRAMES: +(process.env.FRAMES || 64) }
          );
          report.runs.push({ viewport: [w, h], pull, prepass, ...r });
        }
      }
    }
  }

  if (mode === 'diff') {
    // Same frozen frame (reduced motion: time 0, 32 frames) with and without the prepass, compared
    // pixel by pixel. The prepass is meant to change cost, not the picture.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 640, height: 360 });
    const shoot = async (pull, prepass, steps) => {
      await page.evaluate(
        ({ pull, prepass, steps }) => {
          // Reduced motion bounds the scene to 32 frames; each asks for the next with rAF, so the
          // count stops moving when it is done. Timer-query callbacks lag too far to count on.
          window.__raf = 0;
          if (!window.__rafPatched) {
            window.__rafPatched = true;
            const raf = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = (cb) => (window.__raf++, raf(cb));
          }
          window.__d = window.__scene.createScene({
            canvas: document.getElementById('c'),
            fixedLevel: { ...window.__scene.LEVELS[0], traceSteps: steps },
            fixedPull: pull,
            prepass,
          });
        },
        { pull, prepass, steps }
      );
      for (let last = -1, still = 0; still < 3; await page.waitForTimeout(1000)) {
        const n = await page.evaluate(() => window.__raf);
        still = n === last ? still + 1 : 0;
        last = n;
      }
      const png = await page.screenshot();
      await page.evaluate(() => window.__d.dispose());
      return png.toString('base64');
    };
    // The step cap makes a grazing ray give up and count as a hit, so the baseline is compared
    // with a 512-step render of the same frame as well: whichever is closer to it is the more
    // faithful one.
    const decode = (x) =>
      page.evaluate(
        (x) =>
          new Promise((r) => {
            const i = new Image();
            i.onload = () => {
              const c = document.createElement('canvas');
              c.width = i.width;
              c.height = i.height;
              const g = c.getContext('2d');
              g.drawImage(i, 0, 0);
              r(Array.from(g.getImageData(0, 0, i.width, i.height).data));
            };
            i.src = 'data:image/png;base64,' + x;
          }),
        x
      );
    const compare = (da, db) => {
      let max = 0, over = 0, sum = 0;
      const px = da.length / 4;
      for (let i = 0; i < da.length; i += 4) {
        let m = 0;
        for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(da[i + k] - db[i + k]));
        sum += m;
        if (m > max) max = m;
        if (m > 2) over++;
      }
      return { maxChannelDiff: max, pixelsOver2of255: over, ofPixels: px, meanMaxChannelDiff: +(sum / px).toFixed(3) };
    };
    report.diffs = [];
    for (const pull of (process.env.PULLS || '0,0.5,1').split(',').map(Number)) {
      const png = {
        off: await shoot(pull, false, 96),
        on: await shoot(pull, true, 96),
        ref: await shoot(pull, false, 512),
        off2: await shoot(pull, false, 96),
      };
      for (const k of Object.keys(png)) fs.writeFileSync(path.join(outdir, `diff-${k}-${pull}.png`), Buffer.from(png[k], 'base64'));
      const [off, on, ref, off2] = [await decode(png.off), await decode(png.on), await decode(png.ref), await decode(png.off2)];
      report.diffs.push({ pull, offVsOffAgain: compare(off, off2), offVsOn: compare(off, on), offVsRef512: compare(off, ref), onVsRef512: compare(on, ref) });
    }
  }

  console.log(JSON.stringify(report, null, 1));
  await b.close();
})().catch((e) => {
  console.log('ERR', String(e).slice(0, 2000));
  process.exit(1);
});
