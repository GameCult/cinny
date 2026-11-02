const { chromium } = require('playwright');
const { expect, done, isDm, mDirectPuts, hsLog, revealedTier, sawText } = require('./check.cjs');
const MODE = process.env.MODE; const T0 = Date.now(); const t = () => `+${Date.now() - T0}ms`;
const log = (...a) => console.log(`[${MODE}]`, ...a);
const HEADERS = ['GameCult', 'Projects', 'nibu', 'eureka', 'Nibu', 'Eureka', 'Elsewhere', 'Direct Messages'];
let b; const quit = (c) => Promise.race([Promise.resolve(b && b.close()).catch(() => 0), new Promise((r) => setTimeout(r, 5000))]).finally(() => process.exit(c));
setTimeout(() => { console.log('DRIVER_TIMEOUT'); quit(3); }, 120000);
(async () => {
  b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.goto('http://127.0.0.1:8080/');
  await pg.evaluate(() => { localStorage.setItem('cinny_access_token', 'tok'); localStorage.setItem('cinny_device_id', 'DEV'); localStorage.setItem('cinny_user_id', '@t:test'); localStorage.setItem('cinny_hs_base_url', 'http://127.0.0.1:8080'); });
  await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.reload(); await pg.waitForTimeout(9000);
  const body = async () => (await pg.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const tiers = async (tag) => { const f = await revealedTier(pg, 'Friend DM'); log('TIER', tag, '| Friend DM', f); return f; };
  let joined = false;
  if (MODE === 'deeplink') {
    for (const route of ['direct', 'home']) {
      await pg.goto(`http://127.0.0.1:8080/#/${route}/${encodeURIComponent('!dm1:test')}/`); await pg.waitForTimeout(4000);
      const bb = await body(); log('ROUTE', route, JSON.stringify(bb.slice(0, 300)));
      const j = pg.getByRole('button', { name: /^Join$/ }); log('JOIN_BUTTONS', route, await j.count());
      if (await j.count()) { joined = true; await j.first().click(); log('CLICK_JOIN', route, t()); await pg.waitForTimeout(6000); break; }
    }
    const f = await tiers('after deeplink join');
    const stamps = (re) => hsLog().filter((l) => re.test(l)).map((l) => Number(l.split(' ')[0]));
    const put = stamps(/ PUT .*m\.direct BODY .*!dm1:test/)[0], join = stamps(/ JOIN !dm1:test$/)[0];
    expect('the deep link offers one Join button', joined, 'no Join button');
    expect('the DM is filed before the join is sent', put !== undefined && join !== undefined && put <= join, `put ${put} join ${join}`);
    expect('the DM is filed under Direct Messages', isDm(f), f);
  } else if (MODE === 'gw504') {
    const HL = HEADERS; let l = pg.locator('[aria-label="Join Friend DM"]');
    for (let r = 0; r < 2 && !(await l.count()); r++) for (const h of HL) { const hl = pg.getByText(h, { exact: true }); if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); } }
    log('JOINCTRL', await l.count()); await l.first().click(); log('CLICK', t());
    const saw = await sawText(pg, /tap again to retry/, 3000); log('AFTER_504', saw);
    expect('a gateway timeout shows the retryable message', saw, (await body()).slice(0, 200));
    await pg.waitForTimeout(4000); const f = await tiers('after 504 (join delivered by sync)');
    expect('the DM stays filed after a gateway timeout', mDirectPuts().every((b) => b.includes('!dm1:test')) && mDirectPuts().length > 0, JSON.stringify(mDirectPuts()));
    expect('the DM is filed under Direct Messages once sync delivers it', isDm(f), f);
  }
  await quit(done());
})().catch((e) => { log('ERROR', String(e.stack || e).slice(0, 300)); quit(1); });
