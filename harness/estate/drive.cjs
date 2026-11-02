const { chromium } = require('playwright');
const { expect, done, isDm, revealedTier } = require('./check.cjs');
const MODE = process.env.MODE; // twodm | reload
const T0 = Date.now(); const t = () => `+${Date.now() - T0}ms`;
const log = (...a) => console.log(`[${MODE}]`, ...a);
const HEADERS = ['GameCult', 'Projects', 'nibu', 'eureka', 'Nibu', 'Eureka', 'Elsewhere', 'Direct Messages'];
let tierBefore;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const pg = await ctx.newPage(); pg.on('console', (m) => { if (m.type() === 'error' || /command|direct/i.test(m.text())) console.log('[console]', m.type(), m.text().slice(0, 200)); });
  const open = async () => { await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.reload(); await pg.waitForTimeout(9000); };
  await pg.goto('http://127.0.0.1:8080/');
  await pg.evaluate(() => { localStorage.setItem('cinny_access_token', 'tok'); localStorage.setItem('cinny_device_id', 'DEV'); localStorage.setItem('cinny_user_id', '@t:test'); localStorage.setItem('cinny_hs_base_url', 'http://127.0.0.1:8080'); });
  await open();
  const text = () => pg.evaluate(() => document.body.innerText);
  const reveal = async (name) => { const loc = pg.locator(`[aria-label="Join ${name}"]`); if (await loc.count()) return loc; for (let r = 0; r < 2; r++) for (const h of HEADERS) { const hl = pg.getByText(h, { exact: true }); if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); if (await loc.count()) return loc; } } return loc; };
  const tierOf = (name) => revealedTier(pg, name);
  const tap = async (n) => { const l = await reveal(n); log('JOINCTRL', n, await l.count()); await l.first().click(); log('CLICK', n, t()); };
  if (MODE === 'twodm') {
    await tap('Slow DM'); await pg.waitForTimeout(300); await tap('Late DM');
    await pg.waitForTimeout(45000);
  } else if (MODE === 'convert') {
    await tap('Friend DM'); await pg.waitForTimeout(6000);
    tierBefore = await tierOf('Friend DM'); log('TIER before', tierBefore);
    await pg.goto('http://127.0.0.1:8080/#/direct/!dm1:test/'); await pg.waitForTimeout(4000);
    const ed = pg.locator('[contenteditable="true"]'); log('EDITORS', await ed.count(), pg.url());
    await ed.first().click(); await pg.keyboard.type('/converttoroom', { delay: 30 }); await pg.waitForTimeout(500);
    log('ED_TEXT', JSON.stringify(await ed.first().innerText())); log('BODY', JSON.stringify((await text()).slice(-600)));
    await pg.getByText('Convert direct message to room').first().click(); await pg.waitForTimeout(400); log('ED_PICKED', JSON.stringify(await ed.first().innerHTML()).slice(0, 300));
    await pg.keyboard.press('Enter'); log('SENT', t()); await pg.waitForTimeout(800); log('ED_TEXT2', JSON.stringify(await ed.first().innerText().catch(()=>'')));
    if (await ed.first().innerText().catch(() => '')) { await pg.keyboard.press('Enter'); log('SENT2', t()); }
    await pg.waitForTimeout(8000);
    await pg.goto('http://127.0.0.1:8080/#/home/'); await pg.waitForTimeout(3000);
  } else {
    await tap('Slow DM'); await pg.waitForTimeout(3000);
    log('RELOAD', t()); await open();
    await pg.waitForTimeout(30000);
  }
  const slow = await tierOf('Slow DM'), late = await tierOf('Late DM'), friend = await tierOf('Friend DM');
  log('TIER Slow DM', slow, '| Late DM', late, '| Friend DM', friend);
  if (MODE === 'twodm') { expect('Slow DM is filed under Direct Messages', isDm(slow), slow); expect('Late DM is filed under Direct Messages', isDm(late), late); }
  else if (MODE === 'convert') {
    expect('Friend DM was filed under Direct Messages before the conversion', isDm(tierBefore), tierBefore);
    expect('the converted room left Direct Messages and is still listed', !isDm(friend) && friend !== 'absent', friend);
  } else expect('Slow DM is filed under Direct Messages after the reload', isDm(slow), slow);
  await b.close(); process.exitCode = done();
})().catch((e) => { log('ERROR', String(e.stack || e)); process.exitCode = 1; });
