// Failure-mode scenarios for the estate join paths (estate tap and inbox Accept), run by run.sh
// against fakehs.cjs with the env flag each mode needs.
const { chromium } = require('playwright');
const { expect, done, isDm, mDirectPuts, joinsOf } = require('./check.cjs');
const MODE = process.env.MODE;
const T0 = Date.now(); const t = () => `+${Date.now() - T0}ms`;
const log = (...a) => console.log(`[${MODE}]`, ...a);
const HEADERS = ['GameCult', 'Projects', 'nibu', 'eureka', 'Nibu', 'Eureka', 'Elsewhere', 'Direct Messages'];
let b;
// Close the browser, but never wait on it: a hung close must not hang the run.
const quit = (code) => Promise.race([Promise.resolve(b && b.close()).catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]).finally(() => process.exit(code));
setTimeout(() => { console.log('DRIVER_TIMEOUT'); quit(3); }, 240000);
(async () => {
  b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const pg = await ctx.newPage(); pg.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.type(), m.text().slice(0, 160)); });
  const open = async (h = '#/home/') => { await pg.goto('http://127.0.0.1:8080/' + h); await pg.reload(); await pg.waitForTimeout(9000); };
  await pg.goto('http://127.0.0.1:8080/');
  await pg.evaluate(() => { localStorage.setItem('cinny_access_token', 'tok'); localStorage.setItem('cinny_device_id', 'DEV'); localStorage.setItem('cinny_user_id', '@t:test'); localStorage.setItem('cinny_hs_base_url', 'http://127.0.0.1:8080'); });
  await open();
  const body = async () => (await pg.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const reveal = async (name) => { const loc = pg.locator(`[aria-label="Join ${name}"]`); if (await loc.count()) return loc; for (let r = 0; r < 2; r++) for (const h of HEADERS) { const hl = pg.getByText(h, { exact: true }); if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); if (await loc.count()) return loc; } } return loc; };
  const tierOf = (name) => pg.evaluate((n) => { const s = document.body.innerText.split('\n').map((x) => x.trim()); const i = s.indexOf(n); if (i < 0) return 'absent'; for (let j = i; j >= 0; j--) if (/^(elsewhere|direct messages)$/i.test(s[j])) return s[j]; return 'none-above'; }, name);
  const tap = async (n) => { const l = await reveal(n); log('JOINCTRL', n, await l.count()); await l.first().click(); log('CLICK', n, t()); };
  const tiers = async (tag) => { await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(2500); for (const h of HEADERS) { const hl = pg.getByText(h, { exact: true }); if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); } } const r = { friend: await tierOf('Friend DM'), slow: await tierOf('Slow DM') }; log('TIER', tag, '| Friend DM', r.friend, '| Slow DM', r.slow); return r; };
  const neverUnfiled = () => mDirectPuts().every((b) => b.includes('!dm1:test'));
  const acceptInInbox = async (name) => {
    // reach the inbox through the navigator's own Inbox tab
    await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(2000);
    const tab = pg.locator('[aria-label="Inbox"], [aria-label*="nbox"]'); log('INBOX_TAB', await tab.count());
    if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(1500); }
    const inv = pg.getByText('Invites', { exact: true }); if (await inv.count()) { await inv.first().click(); await pg.waitForTimeout(1500); }
    log('URL', pg.url());
    if (!/invites/.test(pg.url())) { await pg.goto('http://127.0.0.1:8080/#/inbox/invites/'); await pg.waitForTimeout(3000); log('URL_FALLBACK', pg.url()); }
    { const pub = pg.getByText('Public', { exact: true }); log('PUBLIC_FILTER', await pub.count()); if (await pub.count()) { await pub.first().click(); await pg.waitForTimeout(1500); } }
    for (let r = 0; r < 3; r++) { const v = pg.getByText('View All', { exact: true }); if (!(await v.count())) break; await v.first().click(); await pg.waitForTimeout(800); }
    const b0 = await body(); const i = b0.indexOf(name); log('INBOX has', name, i >= 0, JSON.stringify(b0.slice(Math.max(0, i - 120), i + 120)));
    const card = pg.locator('div').filter({ hasText: name }).filter({ has: pg.getByText('Accept', { exact: true }) }).last();
    await card.getByText('Accept', { exact: true }).first().click(); log('ACCEPT', name, t());
  };
  if (MODE === 'pjfail') {
    await tap('Friend DM'); await pg.waitForTimeout(3000);
    const bb = await body(); const k = bb.search(/Internal server error/); log('AFTER_FAIL', k >= 0 ? bb.slice(Math.max(0, k - 40), k + 80) : 'no message');
    expect('a failed m.direct write shows the refusal', k >= 0, bb.slice(0, 200));
    expect('no join is sent while the filing is failing', joinsOf('!dm1:test') === 0, String(joinsOf('!dm1:test')));
    await tap('Friend DM'); await pg.waitForTimeout(6000); const r = await tiers('after retry');
    expect('the retry joins once', joinsOf('!dm1:test') === 1, String(joinsOf('!dm1:test')));
    expect('Friend DM is filed under Direct Messages after the retry', isDm(r.friend), r.friend);
  } else if (MODE === 'jdrop') {
    await tap('Friend DM'); await pg.waitForTimeout(4000);
    const bb = await body(); const k = bb.search(/tap again to retry/i); log('AFTER_DROP', k >= 0 ? bb.slice(Math.max(0, k - 60), k + 80) : 'no message');
    expect('a dropped join shows the retryable message', k >= 0, bb.slice(0, 200));
    await pg.waitForTimeout(6000); const r1 = await tiers('after drop'); await open(); const r2 = await tiers('after reload');
    expect('the entry is kept after the drop', isDm(r1.friend) && neverUnfiled(), r1.friend);
    expect('Friend DM is under Direct Messages after the reload', isDm(r2.friend), r2.friend);
  } else if (MODE === 'admin') {
    await tap('Friend DM'); await pg.waitForTimeout(6000); const r = await tiers('admin estate');
    expect('an admin-invited DM is filed under Direct Messages', isDm(r.friend), r.friend);
  } else if (MODE === 'inboxadmin') {
    await acceptInInbox('Friend DM'); await pg.waitForTimeout(6000); const r = await tiers('admin inbox');
    expect('an admin-invited DM accepted in the inbox is filed under Direct Messages', isDm(r.friend), r.friend);
  } else if (MODE === 'inboxreload') {
    await acceptInInbox('Slow DM'); await pg.waitForTimeout(2000); log('RELOAD', t()); await open('#/inbox/invites/');
    await pg.waitForTimeout(30000); const r = await tiers('inbox reload');
    expect('a DM accepted in the inbox is filed under Direct Messages after a reload', isDm(r.slow), r.slow);
  } else if (MODE === 'pjreload') {
    await tap('Slow DM'); await pg.waitForTimeout(2000); log('RELOAD', t()); await open();
    await pg.waitForTimeout(8000); await tiers('pjreload');
    const l = pg.locator('[aria-label="Join Slow DM"]'); const n = await l.count(); log('SLOW_DM_STILL_JOINABLE', n);
    expect('a join cut off by a reload stays joinable', n === 1, String(n));
  }
  await quit(done());
})().catch((e) => { log('ERROR', String(e.stack || e).slice(0, 300)); quit(1); });
