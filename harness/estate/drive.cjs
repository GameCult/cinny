const { chromium } = require('playwright');
const fs = require('fs');
const TAG = process.env.TAG;
const out = (n) => `/out/${TAG}-${n}`;
const tl = [];
const T0 = Date.now();
const t = () => `+${Date.now() - T0}ms`;
const HEADERS = ['GameCult', 'Projects', 'nibu', 'eureka', 'Nibu', 'Eureka', 'Elsewhere', 'Direct Messages'];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error' && !/OIDC|issuer|endpoint|supported|ERR_NAME|404/.test(m.text())) tl.push('console.error ' + m.text().slice(0, 200)); });
  await pg.goto('http://127.0.0.1:8080/');
  await pg.evaluate(() => { localStorage.setItem('cinny_access_token', 'tok'); localStorage.setItem('cinny_device_id', 'DEV'); localStorage.setItem('cinny_user_id', '@t:test'); localStorage.setItem('cinny_hs_base_url', 'http://127.0.0.1:8080'); });
  await pg.goto('http://127.0.0.1:8080/#/home/');
  await pg.waitForTimeout(12000);
  const text = () => pg.evaluate(() => document.body.innerText);
  const snap = async (n) => { await pg.screenshot({ path: out(n + '.png') }); tl.push(`--- ${n} ${t()} url=${pg.url()}\n${await text()}`); };
  const buttons = async () => tl.push('buttons ' + JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('button')].map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.innerText.slice(0, 30), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }))));
  const small = async () => tl.push('SMALL ' + JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('button, a, [role="button"]')].filter((e) => e.getClientRects().length).map((e) => [e.getAttribute('aria-label') || e.innerText.slice(0, 30), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).filter((r) => r[2] < 44))));
  const layout = async () => tl.push('layout ' + JSON.stringify(await pg.evaluate(() => ({ vw: innerWidth, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth }))));
  await snap('1-landing'); await buttons(); await layout(); await small();
  if (process.env.NOROOT === '1') {
    tl.push('has Create Room: ' + (await pg.getByText('Create Room', { exact: true }).count()) + ' Join with Address: ' + (await pg.getByText('Join with Address', { exact: true }).count()) + ' finder: ' + (await pg.locator('[aria-label="Find a room"]').count()));
    await b.close(); return;
  }
  const reveal = async (sel) => {
    const loc = pg.locator(sel);
    if (await loc.count()) return loc;
    for (let round = 0; round < 2; round++) for (const h of HEADERS) {
      const hl = pg.getByText(h, { exact: true });
      if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); if (await loc.count()) { tl.push(`revealed ${sel} via ${h}`); return loc; } }
    }
    tl.push(`could not reveal ${sel}`); return loc;
  };
  // expand everything once for the inventory
  for (const h of HEADERS) { const hl = pg.getByText(h, { exact: true }); if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); tl.push('clicked header ' + h); } }
  await snap('2-expanded'); await buttons(); await layout(); await small();
  // room finder
  const finder = pg.locator('[aria-label="Find a room"], [aria-label="Search"]').first();
  await finder.click(); await pg.waitForTimeout(800);
  tl.push('after finder url=' + pg.url() + ' dialogs=' + (await pg.locator('[role="dialog"]').count()) + ' inputs=' + JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.placeholder))));
  await snap('3-finder');
  await pg.keyboard.press('Escape'); await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(3000);
  // join with frame poll
  const joinPoll = async (name, ms) => {
    const loc = await reveal(`[aria-label="Join ${name}"]`);
    if (!(await loc.count())) { tl.push(`no Join ${name}`); return; }
    const u0 = pg.url(); await loc.first().click(); const c = Date.now(); tl.push(`CLICK Join ${name} ${t()}`);
    let card = 0, frames = 0, urlAt = null, firstCardAt = null;
    while (Date.now() - c < ms) {
      const s = await text(); frames++;
      if (s.includes('Summary card')) { card++; if (firstCardAt === null) firstCardAt = Date.now() - c; }
      if (urlAt === null && pg.url() !== u0) urlAt = Date.now() - c;
      await pg.waitForTimeout(40);
    }
    tl.push(`POLL ${name}: frames=${frames} cardFrames=${card} firstCardAt=${firstCardAt} urlChangedAt=${urlAt} url=${pg.url()}`);
    await snap(`4-join-${name.replace(/\W/g, '')}`);
    await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(2500);
  };
  await joinPoll('Commons', 6000);
  await joinPoll('Aetheria', 6000);
  await joinPoll('Friend DM', 6000);
  // timeout path, room
  const slow = async (name) => {
    const loc = await reveal(`[aria-label="Join ${name}"]`);
    if (!(await loc.count())) { tl.push(`no Join ${name}`); return; }
    await loc.first().click(); tl.push(`CLICK Join ${name} ${t()}`);
    await pg.waitForTimeout(21500); await snap(`5-slow-${name.replace(/\W/g, '')}-21s`);
    tl.push(`timeout msg shown: ${(await text()).includes('still on its way')}`);
    await pg.waitForTimeout(5500); await snap(`5-slow-${name.replace(/\W/g, '')}-27s`);
    tl.push(`after arrival: Join ${name} still present=${await pg.locator(`[aria-label="Join ${name}"]`).count()} url=${pg.url()}`);
  };
  await slow('Odin');
  await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(2500);
  await slow('Slow DM');
  // wide: tier placement (wide tiers start open)
  await pg.setViewportSize({ width: 1280, height: 800 });
  await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(6000); await snap('6-wide');
  await b.close();
})().catch((e) => { tl.push('ERROR ' + String(e.stack || e)); process.exitCode = 1; }).finally(() => fs.writeFileSync(out('timeline.txt'), tl.join('\n')));
