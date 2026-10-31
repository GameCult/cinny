// Drives the built client against fakehs.js on a phone viewport and asserts the estate navigator.
const { chromium } = require('playwright');
const fs = require('fs');
const out = (n) => `/out/${n}`;
const tl = [];
const fails = [];
const check = (ok, what) => { tl.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.goto('http://127.0.0.1:8080/');
  await pg.evaluate(() => { localStorage.setItem('cinny_access_token', 'tok'); localStorage.setItem('cinny_device_id', 'DEV'); localStorage.setItem('cinny_user_id', '@t:test'); localStorage.setItem('cinny_hs_base_url', 'http://127.0.0.1:8080'); });
  await pg.goto('http://127.0.0.1:8080/#/home/');
  await pg.getByText('Create Room').first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(2000);
  const text = () => pg.evaluate(() => document.body.innerText);
  const snap = async (n) => { await pg.screenshot({ path: out(n + '.png') }); };
  const open = async (name) => { const h = pg.getByText(name, { exact: true }); if (await h.count()) { await h.first().click(); await pg.waitForTimeout(300); } };

  // Entry points
  const t0 = await text();
  check(/Create Room/.test(t0) && /Join with Address/.test(t0), 'Create Room and Join with Address are navigator actions');
  await pg.getByText('Join with Address').first().click();
  await pg.waitForTimeout(400);
  check((await pg.locator('input[name="addressInput"]').count()) === 1, 'Join with Address opens its prompt');
  await pg.reload();
  await pg.getByText('Create Room').first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(2000);

  // Header search is the room finder, on a phone
  await pg.locator('[aria-label="Find a room"]').first().click();
  await pg.waitForTimeout(500);
  check((await pg.locator('input[placeholder="Search"]').count()) === 1 && !/#\/home\/search/.test(pg.url()), 'header search opens the room finder, not message search');
  await snap('finder');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);

  // Groups for an invitee, from the hierarchy alone; Elsewhere; invited DM
  for (const n of ['Projects', 'nibu', 'eureka', 'Nibu', 'Eureka', 'Elsewhere', 'Direct Messages']) await open(n);
  // A tier that was not rendered yet when its header was tapped is still collapsed.
  if (!(await text()).toLowerCase().includes('meeting')) await open('Elsewhere');
  await snap('expanded');
  const t1 = (await text()).toLowerCase();
  check(t1.includes('nibu') && t1.includes('eureka'), 'steward groups render for an invitee who cannot read Space state');
  check(t1.includes('elsewhere') && t1.includes('meeting'), 'a joined room outside the Space is listed under Elsewhere');
  check(t1.includes('direct messages') && (await pg.locator('[aria-label="Join Void"]').count()) === 1, 'an invited DM is listed with Join');

  // Join: no invite card at any frame, then the room
  await pg.locator('[aria-label="Join Aetheria"]').first().click();
  const t = Date.now();
  let card = 0, room = null;
  while (Date.now() - t < 6000) {
    const body = await text();
    if (/Summary card/.test(body)) card++;
    if (room === null && /welcome to Aetheria/.test(body)) room = Date.now() - t;
    await pg.waitForTimeout(40);
  }
  await snap('joined');
  check(card === 0, `no invite card at any frame after the tap (saw ${card})`);
  check(room !== null, `the room opened (after ${room} ms)`);

  // Join the DM: lands in the room too
  await pg.goto('http://127.0.0.1:8080/#/home/');
  await pg.waitForTimeout(3000);
  if (!(await pg.locator('[aria-label="Join Void"]').count())) await open('Direct Messages');
  check((await pg.locator('[aria-label="Join Void"]').count()) === 1, 'the DM invite is still listed after the other join');
  if (await pg.locator('[aria-label="Join Void"]').count()) {
    await pg.locator('[aria-label="Join Void"]').first().click();
    let dmCard = 0; const t2 = Date.now();
    while (Date.now() - t2 < 5000) { if (/Summary card/.test(await text())) dmCard++; await pg.waitForTimeout(40); }
    check(dmCard === 0 && /\/direct\//.test(pg.url()), 'the invited DM opens in Direct with no invite card');
  }
  await b.close();
})().catch((e) => { tl.push('ERROR ' + String(e.stack || e)); fails.push('error'); }).finally(() => {
  fs.writeFileSync(out('timeline.txt'), tl.join('\n'));
  console.log(tl.join('\n'));
  process.exitCode = fails.length ? 1 : 0;
});
