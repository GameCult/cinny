// Drives the terrain-tier spike (bundle.cjs <out> terrain) in headless Chromium: capability, erosion-pass time and
// frame time at three grid sizes, at 1x and 4x CPU throttle, plus a screenshot per fallback path.
// usage: node terrainDrive.cjs <bundledir> <outdir>      Needs playwright from NODE_PATH.
// Software GL (SwiftShader) unless the host has a GPU: these are a CPU rasteriser's numbers, not a phone's. CDP CPU
// throttling slows the page's main thread only; the rasteriser runs in the GPU process and is not slowed by it.
const { chromium } = require('playwright');
const path = require('path');
const [, , dir, outdir = '.'] = process.argv;

(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const run = async (name, qs, cpu) => {
    const page = await b.newPage({ viewport: { width: 960, height: 540 } });
    page.on('pageerror', (e) => process.stderr.write(`[pageerror ${name}] ${e}\n`));
    page.on('console', (m) => process.stderr.write(`[page ${name}] ${m.text()}\n`));
    if (cpu > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`file://${path.resolve(dir, 'index.html')}?${qs}&cpu=${cpu}`);
    await page.waitForFunction(() => /^terrain: (done|off)/.test(document.title), null, { timeout: 280000 });
    const result = await page.evaluate(() => window.__result);
    await page.screenshot({ path: path.join(outdir, `${name}.png`) });
    await page.close();
    return { name, cpu, result };
  };
  const out = [];
  for (const cpu of [1, 4]) out.push(await run(`bench-cpu${cpu}`, 'bench=1', cpu));
  for (const f of ['half', 'rgba8', 'none']) out.push(await run(`force-${f}`, `bench=1&tier=0&force=${f}`, 1));
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
