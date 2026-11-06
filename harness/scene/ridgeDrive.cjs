// Drives the ridge/mesh page (bundle.cjs <out> ridge) in headless Chromium and prints the probe readout.
// usage: node ridgeDrive.cjs <bundledir> <outdir> [width height reps]   Needs playwright from NODE_PATH.
// Software GL (SwiftShader) unless the host has a GPU: the numbers are a CPU rasteriser's, not a phone's.
const { chromium } = require('playwright');
const path = require('path');
const [, , dir, outdir, w = '960', h = '540', reps = '1'] = process.argv;
const cases = [
  ['ridge', 'style=ridge'],
  ['ridge-rowhaze', 'rowhaze=1'],
  ['mesh', 'style=mesh'],
  ['mesh-low', 'style=mesh&tier=low'],
  ['mesh-still', 'style=mesh&tier=still'],
];
(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  for (const [name, qs] of cases.flatMap((c) => Array.from({ length: +reps }, () => c))) {
    const page = await b.newPage({ viewport: { width: +w, height: +h } });
    page.on('pageerror', (e) => process.stderr.write(`[pageerror ${name}] ${e}\n`));
    await page.goto(`file://${path.resolve(dir, 'index.html')}?probe=1&${qs}`);
    await page.waitForTimeout(3500);
    const text = await page.evaluate(() => document.querySelector('#stage > div')?.textContent ?? '(no readout)');
    await page.screenshot({ path: path.join(outdir, `${name}.png`) });
    console.log(`${name}\t${await page.title()}\t${text}`);
    await page.close();
  }
  await b.close();
})();
